import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { AppError } from '@api/utils/errors';
import { env } from '@api/config/env';
import { redis, logRedisUnavailableOnce } from '@api/utils/redis/redis';
import { diagnosticarPagina, errorDePaginaSinContenido } from '@api/services/agent/pagina-sin-contenido';

const JINA_READER_PREFIX = 'https://r.jina.ai/';
const MAX_MARKDOWN_BYTES = 150 * 1024;
const CACHE_TTL_SEC = 7 * 24 * 3600;

/**
 * Cuánto se guarda una página que el diagnóstico marcó (muro de inicio de
 * sesión, error del sitio, página vacía).
 *
 * Con los 7 días de una página buena, el muro quedaba congelado: la docente
 * compartía la planilla, la volvía a agregar y le volvía el mismo muro desde la
 * caché. Diez minutos alcanzan para que un reintento inmediato —la
 * investigación que se relanza, el agente que insiste con el mismo enlace— no
 * vuelva a pagar la lectura, y no más.
 */
const CACHE_TTL_SIN_CONTENIDO_SEC = 10 * 60;

/**
 * Plazo de una lectura del lector.
 *
 * Sin plazo, una página colgada colgaba la investigación entera: su tope de 48 s
 * sólo impedía empezar lecturas nuevas, y el navegador se iba a los 30 s con
 * «Request timeout» mientras el servidor seguía esperando. Las lecturas medidas
 * tardan de 1 a 10 s; 15 s es margen para un día malo.
 */
export const PLAZO_DE_LECTURA_MS = 15_000;

/**
 * Plazo cuando la lectura la pidió la docente a mano (Fuentes → Página web,
 * «Volver a leer»): es una sola página y está esperando por ella, así que se le
 * da más aire, sin pasar los 30 s que el panel espera por defecto.
 */
export const PLAZO_DE_LECTURA_A_MANO_MS = 25_000;

export type FetchDocumentationUrlResult = {
  url: string;
  pageTitle: string;
  content: string;
  links: string[];
  contentTokens: number;
  fetchedAt: string;
  cacheHit: boolean;
};

type CachedFetchPayload = {
  url: string;
  pageTitle: string;
  rawMarkdown: string;
  links: string[];
  fetchedAt: string;
};

function isForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (isIPv4(host) || isIPv6(host)) {
    return true;
  }

  // Private IP ranges (RFC 1918 + link-local + loopback + cloud metadata).
  if (isIPv4(host)) {
    const parts = host.split('.').map((p) => parseInt(p, 10));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [a, b] = parts as [number, number, number, number];
      if (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return true;
      }
    }
  }

  // Common storage / metadata service hostnames that look public but aren't.
  const reservedHostnames = new Set([
    'metadata.google.internal',
    'metadata',
    'kubernetes.default',
    'kubernetes.default.svc',
    'localhost.localdomain',
    'host.docker.internal',
    'gateway.docker.internal'
  ]);
  if (reservedHostnames.has(host)) {
    return true;
  }

  return false;
}

export function assertFetchableDocumentationUrl(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError('Invalid documentation URL', 'INVALID_DOCUMENTATION_URL', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('Documentation URL must use http or https', 'INVALID_DOCUMENTATION_URL', 400);
  }

  if (isForbiddenHostname(parsed.hostname)) {
    throw new AppError('Documentation URL hostname is not allowed', 'INVALID_DOCUMENTATION_URL', 400);
  }

  return parsed;
}

function extractSameOriginLinks(markdown: string, origin: URL): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\[[^\]]*\]\((https?:[^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(markdown)) !== null) {
    try {
      const linkUrl = new URL(match[1]);
      if (linkUrl.protocol !== 'http:' && linkUrl.protocol !== 'https:') {
        continue;
      }

      if (linkUrl.hostname !== origin.hostname) {
        continue;
      }

      const normalized = linkUrl.href;

      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    } catch {
      // skip invalid URL in markdown
    }
  }

  return out;
}

function guessPageTitle(markdown: string, fallbackUrl: string): string {
  const trimmed = markdown.trim();
  const lines = trimmed.split('\n');
  const firstLine = lines[0] ?? '';

  if (firstLine.startsWith('# ')) {
    return firstLine.slice(2).trim();
  }

  if (firstLine.startsWith('#')) {
    return firstLine.replace(/^#+\s*/, '').trim();
  }

  // Jina Reader leads with a `Title: …` preamble rather than a markdown heading,
  // so the heading checks above never matched and every page fell through to the
  // hostname. Two Wikipedia articles saved as sources both came back named
  // "es.wikipedia.org", which is useless in the Sources list and worse in the
  // source pack, where the model uses these names to tell material apart.
  for (const line of lines.slice(0, 5)) {
    const match = line.match(/^Title:\s*(.+)$/i);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return 'Documentation';
  }
}

function truncateMarkdown(body: string): { text: string; truncated: boolean } {
  if (body.length <= MAX_MARKDOWN_BYTES) {
    return { text: body, truncated: false };
  }

  const suffix = '\n\n[Truncated: content exceeded 150 KB]';

  return {
    text: body.slice(0, MAX_MARKDOWN_BYTES - suffix.length) + suffix,
    truncated: true
  };
}

function wrapUntrustedMarkdown(url: string, markdown: string): string {
  const safeSrc = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  return `<external_untrusted_document src="${safeSrc}">\n${markdown}\n</external_untrusted_document>`;
}

export function countCompletedFetchDocumentationCalls(messages: unknown[]): number {
  let count = 0;

  for (const msg of messages as { parts?: unknown[] }[]) {
    const parts = msg.parts;

    if (!parts) {
      continue;
    }

    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const record = part as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      let toolName: string | null = null;

      if (type === 'tool-invocation') {
        toolName = (record.toolInvocation as { toolName?: string } | undefined)?.toolName ?? null;
      } else if (type.startsWith('tool-')) {
        toolName = type.slice(5);
      }

      if (toolName !== 'fetch_documentation_url') {
        continue;
      }

      const state = record.state;

      if (state === 'result' || state === 'output-available' || state === 'output-error') {
        count += 1;
      }
    }
  }

  return count;
}

async function redisSafeGet(key: string): Promise<string | null> {
  try {
    if (!redis.isOpen) {
      return null;
    }

    return await redis.get(key);
  } catch (error) {
    logRedisUnavailableOnce('fetch-url cache get failed', error);

    return null;
  }
}

/** Una entrada de la caché que no se pueda leer cuenta como que no está: se vuelve a bajar. */
function leerDeLaCache(raw: string | null): CachedFetchPayload | null {
  if (!raw) return null;

  try {
    const cached = JSON.parse(raw) as CachedFetchPayload;

    return typeof cached?.rawMarkdown === 'string' && typeof cached.url === 'string' ? cached : null;
  } catch {
    return null;
  }
}

async function redisSafeSet(key: string, value: string, ttlSec: number): Promise<void> {
  try {
    if (!redis.isOpen) {
      return;
    }

    await redis.set(key, value, { EX: ttlSec });
  } catch (error) {
    logRedisUnavailableOnce('fetch-url cache set failed', error);
  }
}

function esVencimiento(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function fetchMarkdownFromJina(
  url: string,
  opciones: { fresco: boolean; plazoMs: number }
): Promise<{ markdown: string; status: number }> {
  const readerHref = `${JINA_READER_PREFIX}${url}`;
  const headers: Record<string, string> = {};

  if (env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  }

  // El lector también guarda lo que leyó. Una lectura fresca que se saltea
  // NUESTRA caché y le pide al lector su copia vieja devolvería el mismo muro
  // que la docente acaba de destrabar compartiendo el documento.
  if (opciones.fresco) {
    headers['X-No-Cache'] = 'true';
  }

  // El plazo cubre también la lectura del cuerpo: la señal corta el stream si
  // la página manda las cabeceras y después se cuelga.
  const plazo = AbortSignal.timeout(opciones.plazoMs);

  let response: Response;
  let markdown: string;

  try {
    response = await fetch(readerHref, {
      headers,
      redirect: 'follow',
      signal: plazo
    });

    const status = response.status;

    if (!response.ok) {
      console.info('[fetch_documentation_url]', { url, status, bytes: response.headers.get('content-length') });

      throw new AppError(`Documentation fetch failed with status ${status}`, 'DOCUMENTATION_FETCH_FAILED', 502);
    }

    markdown = await response.text();
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (esVencimiento(error) || plazo.aborted) {
      console.info('[fetch_documentation_url]', { url, vencio: `${opciones.plazoMs} ms` });

      throw new AppError(
        `The page took longer than ${Math.round(opciones.plazoMs / 1000)} s to load`,
        'DOCUMENTATION_FETCH_TIMEOUT',
        504
      );
    }

    throw new AppError('Failed to reach documentation reader', 'DOCUMENTATION_FETCH_FAILED', 502);
  }

  console.info('[fetch_documentation_url]', { url, status: response.status, bytes: String(markdown.length) });

  return { markdown, status: response.status };
}

export async function fetchDocumentationUrl(params: {
  url: string;
  orgId: string;
  /**
   * Unused today (the cache is keyed per org) and optional because the course
   * wizard reads pages before a course exists. Kept for per-course metering.
   */
  courseId?: string;
  priorMessages: unknown[];
  /**
   * Leer la página de nuevo aunque esté en la caché, y reescribirla.
   *
   * Para cuando lo pide la docente a mano: si agrega una página es porque
   * quiere lo que la página dice HOY. Con la caché de 7 días, la planilla que
   * acababa de compartir le seguía devolviendo el muro de la primera vez.
   */
  fresco?: boolean;
  /** Plazo de la lectura; por defecto `PLAZO_DE_LECTURA_MS`. */
  plazoMs?: number;
}): Promise<FetchDocumentationUrlResult> {
  const { url, orgId, courseId, priorMessages } = params;
  const fresco = params.fresco === true;

  const normalizedUrl = assertFetchableDocumentationUrl(url);
  const normalizedHref = normalizedUrl.href;

  const priorFetches = countCompletedFetchDocumentationCalls(priorMessages);

  if (priorFetches >= env.AGENT_MAX_FETCHES_PER_CONVERSATION) {
    throw new AppError('Maximum documentation fetches per conversation reached', 'AGENT_FETCH_CONVERSATION_LIMIT', 429);
  }

  // No paid-plan gate and no per-org daily quota: on a self-hosted install the
  // operator supplies (and pays for) the Jina and model keys directly, so metering
  // here only blocked the instructor from using material they already own. The
  // per-conversation limit above stays — that one is a runaway-loop guard, not
  // monetization, and a teacher adding a source from the Sources panel bypasses it
  // naturally because that path has no prior fetches to count.
  const cacheKeyRaw = `${orgId}:${normalizedHref}`;
  const cacheKey = `agent:fetch_url:${createHash('sha256').update(cacheKeyRaw).digest('hex')}`;

  const cached = fresco ? null : leerDeLaCache(await redisSafeGet(cacheKey));

  if (cached) {
    // El diagnóstico corre también sobre lo guardado: una entrada escrita antes
    // de que existiera —con sus 7 días— puede ser un muro, y devolverla como
    // página sería el mismo agujero por la puerta de atrás.
    const diagnostico = diagnosticarPagina(cached.rawMarkdown);

    if (diagnostico) throw errorDePaginaSinContenido(diagnostico, cached.url);

    const truncated = truncateMarkdown(cached.rawMarkdown);

    return {
      url: cached.url,
      pageTitle: cached.pageTitle,
      content: wrapUntrustedMarkdown(cached.url, truncated.text),
      links: cached.links,
      contentTokens: Math.ceil(truncated.text.length / 4),
      fetchedAt: cached.fetchedAt,
      cacheHit: true
    };
  }

  const { markdown } = await fetchMarkdownFromJina(normalizedHref, {
    fresco,
    plazoMs: params.plazoMs ?? PLAZO_DE_LECTURA_MS
  });
  const truncated = truncateMarkdown(markdown);
  const pageTitle = guessPageTitle(truncated.text, normalizedHref);
  const links = extractSameOriginLinks(truncated.text, normalizedUrl);
  const fetchedAt = new Date().toISOString();

  const cachePayload: CachedFetchPayload = {
    url: normalizedHref,
    pageTitle,
    rawMarkdown: truncated.text,
    links,
    fetchedAt
  };

  const diagnostico = diagnosticarPagina(truncated.text);

  // Lo marcado se guarda igual, pero poco: ver CACHE_TTL_SIN_CONTENIDO_SEC.
  await redisSafeSet(
    cacheKey,
    JSON.stringify(cachePayload),
    diagnostico ? CACHE_TTL_SIN_CONTENIDO_SEC : CACHE_TTL_SEC
  );

  if (diagnostico) {
    console.info('[fetch_documentation_url] sin contenido', {
      url: normalizedHref,
      code: diagnostico.code,
      motivo: diagnostico.motivo
    });

    throw errorDePaginaSinContenido(diagnostico, normalizedHref);
  }

  void courseId;

  return {
    url: normalizedHref,
    pageTitle,
    content: wrapUntrustedMarkdown(normalizedHref, truncated.text),
    links,
    contentTokens: Math.ceil(truncated.text.length / 4),
    fetchedAt,
    cacheHit: false
  };
}

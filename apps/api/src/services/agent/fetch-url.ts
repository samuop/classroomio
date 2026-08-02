import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { AppError } from '@api/utils/errors';
import { env } from '@api/config/env';
import { redis, logRedisUnavailableOnce } from '@api/utils/redis/redis';

const JINA_READER_PREFIX = 'https://r.jina.ai/';
const MAX_MARKDOWN_BYTES = 150 * 1024;
const CACHE_TTL_SEC = 7 * 24 * 3600;

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
  const firstLine = trimmed.split('\n')[0] ?? '';

  if (firstLine.startsWith('# ')) {
    return firstLine.slice(2).trim();
  }

  if (firstLine.startsWith('#')) {
    return firstLine.replace(/^#+\s*/, '').trim();
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

async function fetchMarkdownFromJina(url: string): Promise<{ markdown: string; status: number }> {
  const readerHref = `${JINA_READER_PREFIX}${url}`;
  const headers: Record<string, string> = {};

  if (env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  }

  let response: Response;

  try {
    response = await fetch(readerHref, {
      headers,
      redirect: 'follow'
    });
  } catch {
    throw new AppError('Failed to reach documentation reader', 'DOCUMENTATION_FETCH_FAILED', 502);
  }

  const status = response.status;
  const bytesHint = response.headers.get('content-length');

  if (!response.ok) {
    console.info('[fetch_documentation_url]', { url, status, bytes: bytesHint });

    throw new AppError(`Documentation fetch failed with status ${status}`, 'DOCUMENTATION_FETCH_FAILED', 502);
  }

  const markdown = await response.text();

  console.info('[fetch_documentation_url]', { url, status, bytes: String(markdown.length) });

  return { markdown, status };
}

export async function fetchDocumentationUrl(params: {
  url: string;
  orgId: string;
  courseId: string;
  priorMessages: unknown[];
}): Promise<FetchDocumentationUrlResult> {
  const { url, orgId, courseId, priorMessages } = params;

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

  const cachedRaw = await redisSafeGet(cacheKey);

  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedFetchPayload;
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
    } catch {
      // fall through to refetch
    }
  }

  const { markdown } = await fetchMarkdownFromJina(normalizedHref);
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

  await redisSafeSet(cacheKey, JSON.stringify(cachePayload), CACHE_TTL_SEC);

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

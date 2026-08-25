/**
 * De dónde viene un request y con qué entra.
 *
 * Todo acá es puro y sin dependencias de Hono a propósito: la IP es un dato que
 * se persiste y del que después se sacan conclusiones ("este acceso vino de otro
 * lado"), así que conviene que la lógica esté a la vista y sea testeable, y no
 * escondida adentro de un middleware.
 */

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  browser: string | null;
}

/**
 * IP real de quien está del otro lado.
 *
 * En este despliegue el camino es Cloudflare → Nginx → dashboard
 * (adapter-node) → API, o Cloudflare → Nginx → API. Cada salto reescribe algo:
 *
 *   1. `cf-connecting-ip` — lo pone Cloudflare con la IP del visitante y el
 *      proxy del dashboard lo copia tal cual. Es el más confiable.
 *   2. `x-forwarded-for` — Nginx lo arma con `$proxy_add_x_forwarded_for` y el
 *      proxy del dashboard lo REESCRIBE con la IP de Cloudflare. Se toma la
 *      primera entrada, que es la del cliente original.
 *   3. `x-real-ip` — Nginx lo pone con `$remote_addr`. En el salto del
 *      dashboard vale 127.0.0.1, por eso va último.
 *
 * ⚠️ Cualquiera de estos headers puede ser inventado por quien llegue al origen
 * sin pasar por Cloudflare. Sirven para saber desde dónde trabaja la gente, no
 * como prueba en una investigación de seguridad.
 */
export function ipFromHeaders(headers: Headers): string | null {
  const direct = normalizeIp(headers.get('cf-connecting-ip'));
  if (direct) return direct;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = normalizeIp(forwarded.split(',')[0]);
    if (first) return first;
  }

  return normalizeIp(headers.get('x-real-ip'));
}

/**
 * Normaliza una IP para que la misma máquina no aparezca escrita de dos formas.
 * Node devuelve las IPv4 sobre sockets IPv6 como `::ffff:1.2.3.4`.
 */
export function normalizeIp(ip?: string | null): string | null {
  const trimmed = (ip ?? '').trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;

  // Tope defensivo: el header lo controla quien llama, no lo dejamos crecer.
  return withoutPrefix.slice(0, 45) || null;
}

// ── Dispositivo y navegador ──────────────────────────────────────────────────
//
// Parseo propio en vez de ua-parser-js: sólo hace falta el nivel
// "Windows / Android / iPhone", no la versión exacta del kernel. Una dependencia
// más para eso no se justifica, y el User-Agent crudo igual se guarda entero por
// si alguna vez hay que re-analizarlo con más detalle.

/** El orden importa: lo más específico primero (iPad matchea antes que Mac). */
const DEVICES: Array<[RegExp, string]> = [
  [/windows phone/i, 'Windows Phone'],
  [/windows|win32|win64/i, 'Windows'],
  [/android/i, 'Android'],
  [/iphone/i, 'iPhone'],
  [/ipad/i, 'iPad'],
  // El iPad moderno se anuncia como Mac y sólo se distingue por el touch, que no
  // viaja en el User-Agent. Se acepta la imprecisión.
  [/macintosh|mac os x/i, 'Mac'],
  [/cros/i, 'ChromeOS'],
  [/linux/i, 'Linux']
];

/** El orden importa: Edge y Opera se hacen pasar por Chrome; Chrome por Safari. */
const BROWSERS: Array<[RegExp, string]> = [
  [/edg[ea]?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios/i, 'Chrome'],
  [/safari/i, 'Safari'],
  // El dashboard también llama a la API desde su propio servidor (los `load` de
  // SvelteKit). Reconocerlo evita confundir un request de servidor con el
  // navegador de alguien.
  [/node|undici/i, 'Servidor']
];

/**
 * Deriva dispositivo y navegador del User-Agent.
 *
 * Devuelve null cuando no reconoce, en vez de inventar un "Desconocido": un null
 * en la base dice "no lo pudimos determinar", que es la verdad. El User-Agent
 * crudo se guarda aparte para poder revisarlo a mano.
 */
export function parseUserAgent(userAgent?: string | null): { device: string | null; browser: string | null } {
  const ua = (userAgent ?? '').trim();
  if (!ua) return { device: null, browser: null };

  return {
    device: DEVICES.find(([pattern]) => pattern.test(ua))?.[1] ?? null,
    browser: BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null
  };
}

/** Recorta el User-Agent antes de persistirlo: lo manda el cliente. */
export function truncateUserAgent(userAgent?: string | null): string | null {
  const trimmed = (userAgent ?? '').trim();

  return trimmed ? trimmed.slice(0, 512) : null;
}

/** Todo lo que se persiste del cliente, en una sola pasada por los headers. */
export function clientInfoFromHeaders(headers: Headers): ClientInfo {
  const userAgent = truncateUserAgent(headers.get('user-agent'));
  const { device, browser } = parseUserAgent(userAgent);

  return { ip: ipFromHeaders(headers), userAgent, device, browser };
}

/**
 * Mirrors `apps/tenant-router` path splitting for BYOD custom domains.
 *
 * Approximated forwards customer domains straight to the dashboard Render
 * service, so `/proxy/*` and `/api/auth/*` never reach the API unless we
 * forward them here. Tenant subdomains on `*.myclassroomio.com` hit the
 * Cloudflare Worker first and normally never exercise this path.
 */

const PROXY_PREFIX = '/proxy';
const AUTH_PREFIX = '/api/auth';

export function shouldForwardToApi(pathname: string): boolean {
  return (
    pathname === PROXY_PREFIX ||
    pathname.startsWith(`${PROXY_PREFIX}/`) ||
    pathname === AUTH_PREFIX ||
    pathname.startsWith(`${AUTH_PREFIX}/`)
  );
}

function resolveApiUpstreamPath(pathname: string): string {
  if (pathname === PROXY_PREFIX || pathname.startsWith(`${PROXY_PREFIX}/`)) {
    return pathname.slice(PROXY_PREFIX.length) || '/';
  }

  return pathname;
}

function resolveApiUpstreamBase(): string | null {
  const base = process.env.PRIVATE_SERVER_URL || process.env.PUBLIC_SERVER_URL;
  if (!base) return null;

  return base.replace(/\/$/, '');
}

function resolveOriginalHost(request: Request, url: URL): string {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
}

/**
 * Headers that describe THIS hop and must not be forwarded to the next one.
 *
 * RFC 7230 §6.1 calls these hop-by-hop, and undici enforces it: forwarding
 * `Connection` makes `fetch` throw `TypeError: fetch failed` with the cause
 * `invalid connection header`, which surfaces as a bare 500 with no hint of why.
 *
 * This deployment walks straight into it. Nginx sets `Connection: upgrade` on
 * the dashboard block so WebSockets work, so EVERY request arriving here carries
 * it, and the proxy copied the incoming headers wholesale — every `/proxy/*` and
 * `/api/auth/*` call died, which is every authenticated request once the browser
 * talks to the API same-origin. It went unnoticed upstream because their cloud
 * proxies through a Cloudflare Worker, which normalises these away before Node
 * ever sees them.
 *
 * `content-length` goes too: the body is re-sent as a buffer and undici sets the
 * length itself, so keeping the original risks a mismatch.
 */
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length'
];

export async function proxyRequestToApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const apiBase = resolveApiUpstreamBase();

  if (!apiBase) {
    console.error('proxyRequestToApi: missing PRIVATE_SERVER_URL / PUBLIC_SERVER_URL');
    return new Response('API upstream not configured', { status: 502 });
  }

  const upstreamPath = resolveApiUpstreamPath(url.pathname);
  const upstreamUrl = new URL(`${upstreamPath}${url.search}`, apiBase);
  const originalHost = resolveOriginalHost(request, url);

  const upstreamHeaders = new Headers(request.headers);

  for (const header of HOP_BY_HOP_HEADERS) {
    upstreamHeaders.delete(header);
  }

  upstreamHeaders.set('host', upstreamUrl.host);
  upstreamHeaders.set('x-forwarded-host', originalHost);
  upstreamHeaders.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const forwardedFor = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    upstreamHeaders.set('x-forwarded-for', forwardedFor);
  }

  const init: RequestInit = {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual'
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  return fetch(upstreamUrl, init);
}

/**
 * The proxy that carries every authenticated request once the browser talks to
 * the API same-origin. A header it must not forward took the whole thing down in
 * production, silently, as a bare 500.
 */
import { shouldForwardToApi, proxyRequestToApi } from '../proxy-api-request';

describe('shouldForwardToApi', () => {
  it('claims the API paths and nothing else', () => {
    expect(shouldForwardToApi('/proxy')).toBe(true);
    expect(shouldForwardToApi('/proxy/organization/first')).toBe(true);
    expect(shouldForwardToApi('/api/auth/get-session')).toBe(true);

    expect(shouldForwardToApi('/proxy-inexistente')).toBe(false);
    expect(shouldForwardToApi('/courses')).toBe(false);
  });
});

describe('proxyRequestToApi', () => {
  const originalFetch = global.fetch;
  let seen: { url: string; headers: Headers } | null = null;

  beforeEach(() => {
    process.env.PRIVATE_SERVER_URL = 'http://127.0.0.1:3081';
    seen = null;
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(url), headers: new Headers(init?.headers) };
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('drops the hop-by-hop headers undici refuses to send', async () => {
    // Nginx sets `Connection: upgrade` on the dashboard block for WebSockets, so
    // every request arriving here carries it. Forwarded, `fetch` throws
    // `invalid connection header` and the caller sees an unexplained 500.
    const response = await proxyRequestToApi(
      new Request('https://learn.tensor.com.ar/proxy/organization/first', {
        headers: {
          connection: 'upgrade',
          upgrade: 'websocket',
          'keep-alive': 'timeout=5',
          cookie: 'classroomio.session_token=abc'
        }
      })
    );

    expect(response.status).toBe(200);
    expect(seen!.headers.get('connection')).toBeNull();
    expect(seen!.headers.get('upgrade')).toBeNull();
    expect(seen!.headers.get('keep-alive')).toBeNull();
  });

  it('keeps the cookie, which is the entire point of proxying same-origin', async () => {
    await proxyRequestToApi(
      new Request('https://learn.tensor.com.ar/proxy/organization/first', {
        headers: { cookie: 'classroomio.session_token=abc' }
      })
    );

    expect(seen!.headers.get('cookie')).toBe('classroomio.session_token=abc');
  });

  it('strips the /proxy prefix and forwards the original host', async () => {
    await proxyRequestToApi(new Request('https://learn.ejemplo-cliente.com.ar/proxy/organization/first'));

    expect(seen!.url).toBe('http://127.0.0.1:3081/organization/first');
    expect(seen!.headers.get('x-forwarded-host')).toBe('learn.ejemplo-cliente.com.ar');
  });

  it('leaves /api/auth paths alone — Better Auth serves them at that exact path', async () => {
    await proxyRequestToApi(new Request('https://learn.tensor.com.ar/api/auth/get-session'));

    expect(seen!.url).toBe('http://127.0.0.1:3081/api/auth/get-session');
  });
});

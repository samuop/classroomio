/**
 * `POST /audit/incident` — por donde entra lo que sólo el navegador puede ver.
 *
 * Dos reglas de este endpoint no son negociables y por eso están acá:
 *
 *   1. **Responde 204 siempre**, pase lo que pase con el cuerpo. Un reporte de
 *      error que devuelve error haría que el frontend intente reportar ESE
 *      error, y así al infinito.
 *   2. **No exige autenticación.** Un error de la pantalla de ingreso, o uno que
 *      ocurre justo cuando la sesión venció, son los casos que más interesan y
 *      no habría forma de reportarlos si hiciera falta estar adentro.
 *
 * Y una tercera que es de confianza: el navegador **no puede fabricar una
 * incidencia del backend**. Lo que llega de afuera siempre queda marcado como lo
 * que es.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordIncident = vi.fn(async () => {});

vi.mock('@api/services/audit', () => ({
  recordIncident: (...args: unknown[]) => recordIncident(...(args as [])),
  recordEvent: vi.fn(async () => {})
}));

const { auditRouter } = await import('@api/routes/audit');

const ORG = '3f1c9f2e-8a4b-4c1d-9e7a-2b5d6c8f0a13';
const USER = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const SESSION = '9c8b7a65-4321-4fed-8cba-0987654321fe';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let currentUser: { id: string; email: string } | null = null;

/** Replica el middleware global de sesión de `app.ts`, que corre antes de la ruta. */
const app = new Hono()
  .use('*', async (c, next) => {
    if (currentUser) {
      c.set('user' as never, currentUser as never);
      c.set('session' as never, { id: SESSION } as never);
    }

    await next();
  })
  .route('/audit', auditRouter);

const VALID_REPORT = {
  kind: 'FRONTEND_ERROR',
  message: "Cannot read properties of undefined (reading 'byStudent')",
  stack: 'TypeError: ...\n    at Seguimiento',
  route: '/organization/tracking/overview',
  metadata: { screen: '/org/consultora/seguimiento' }
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/audit/incident', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': IPHONE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

const row = () => recordIncident.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: USER, email: 'ana@consultora-ejemplo.com.ar' };
});

describe('reporte válido', () => {
  it('guarda la incidencia con el dispositivo y la pantalla, y responde 204', async () => {
    const response = await post(VALID_REPORT, { 'cf-connecting-ip': '203.0.113.10', 'cio-org-id': ORG });

    expect(response.status).toBe(204);
    expect(row()).toMatchObject({
      kind: 'FRONTEND_ERROR',
      source: 'FRONTEND',
      message: "Cannot read properties of undefined (reading 'byStudent')",
      route: '/organization/tracking/overview',
      orgId: ORG,
      userId: USER,
      userLabel: 'ana@consultora-ejemplo.com.ar',
      sessionId: SESSION,
      ip: '203.0.113.10',
      device: 'iPhone',
      browser: 'Safari',
      metadata: { screen: '/org/consultora/seguimiento' }
    });
  });

  it('guarda igual cuando la sesión ya venció', async () => {
    // Es justamente el caso que más importa: sin usuario, pero con el error.
    currentUser = null;

    const response = await post(VALID_REPORT);

    expect(response.status).toBe(204);
    expect(row()).toMatchObject({ source: 'FRONTEND', userId: null, userLabel: null, sessionId: null });
  });

  it('acepta un request lento medido desde el navegador', async () => {
    await post({ kind: 'SLOW_REQUEST', message: 'GET /x tardó 4200ms', durationMs: 4200, status: 200 });

    expect(row()).toMatchObject({ kind: 'SLOW_REQUEST', durationMs: 4200 });
  });
});

describe('lo que llega de afuera no se cree', () => {
  it('el navegador no puede fabricar una incidencia del backend', async () => {
    // `BACKEND_ERROR` significa "el servidor se rompió y este es su stack". Si
    // se pudiera reportar desde afuera, la tabla dejaría de ser confiable justo
    // en la columna por la que se la consulta.
    const response = await post({ ...VALID_REPORT, kind: 'BACKEND_ERROR' });

    expect(response.status).toBe(204);
    expect(recordIncident).not.toHaveBeenCalled();
  });

  it('el origen lo pone el servidor, no el cuerpo', async () => {
    await post({ ...VALID_REPORT, source: 'BACKEND' });

    expect(row().source).toBe('FRONTEND');
  });

  it('descarta campos que no están declarados', async () => {
    await post({ ...VALID_REPORT, userId: 'otro-usuario', userLabel: 'admin@tensor.com.ar' });

    expect(row()).toMatchObject({ userId: USER, userLabel: 'ana@consultora-ejemplo.com.ar' });
  });

  it('rechaza un cuerpo inválido sin devolver error', async () => {
    const empty = await post({ kind: 'FRONTEND_ERROR', message: '   ' });
    const huge = await post({ kind: 'FRONTEND_ERROR', message: 'x'.repeat(5000) });
    const missing = await post({ message: 'sin kind' });

    expect([empty.status, huge.status, missing.status]).toEqual([204, 204, 204]);
    expect(recordIncident).not.toHaveBeenCalled();
  });

  it('sobrevive a un cuerpo que ni siquiera es JSON', async () => {
    const response = await post('no soy json {{{');

    expect(response.status).toBe(204);
    expect(recordIncident).not.toHaveBeenCalled();
  });

  it('sobrevive a un cuerpo vacío', async () => {
    const response = await app.request('/audit/incident', { method: 'POST' });

    expect(response.status).toBe(204);
    expect(recordIncident).not.toHaveBeenCalled();
  });
});

describe('nunca devuelve error', () => {
  it('responde 204 aunque el registro explote', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    recordIncident.mockRejectedValue(new Error('Postgres caído'));

    const response = await post(VALID_REPORT);

    expect(response.status).toBe(204);
    vi.restoreAllMocks();
  });
});

/**
 * El middleware de auditoría, contra una app Hono de verdad.
 *
 * Es la pieza que decide qué queda registrado, y la única que puede romper un
 * request real. Estos tests fijan cuatro cosas:
 *
 *   1. **La regla de decisión.** Falla, tarda de más, escribe, o es una lectura
 *      declarada. Nada más.
 *   2. **Que lee después de `next()`.** De ahí sale que un único montaje global
 *      sepa quién fue, aunque el middleware que puebla al usuario corra después.
 *   3. **Que un fallo de la auditoría no toca al usuario.** La respuesta ya
 *      salió; perder un renglón del registro es preferible a perder la acción.
 *   4. **Que las exclusiones cortan antes que todo lo demás.**
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Umbral de "lento" bajado para poder comprobarlo sin que el suite tarde dos
 * segundos. Se define ANTES de importar: `audit-map` lo lee de `env` al
 * cargarse.
 *
 * 500ms y no 20ms, que es donde estaba: con 20ms, un request normal cruzaba el
 * umbral bajo la carga de la suite completa y se registraba como lento, así que
 * el test de la lectura declarada —que afirma que NO hubo incidencia— fallaba
 * en la corrida entera y pasaba al correrlo solo. Un test que depende del
 * humor de la máquina es peor que no tenerlo. El margen entre "40ms no es
 * lento" y "600ms sí" no lo cruza ninguna carga razonable.
 */
process.env.AUDIT_SLOW_REQUEST_MS = '500';
const SLOW_ROUTE_MS = 600;

const recordEvent = vi.fn(async () => {});
const recordIncident = vi.fn(async () => {});

vi.mock('@api/services/audit', () => ({
  recordEvent: (...args: unknown[]) => recordEvent(...(args as [])),
  recordIncident: (...args: unknown[]) => recordIncident(...(args as []))
}));

const { auditRequest } = await import('@api/middlewares/audit-request');

const ORG = '3f1c9f2e-8a4b-4c1d-9e7a-2b5d6c8f0a13';
const USER = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const SESSION = '9c8b7a65-4321-4fed-8cba-0987654321fe';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** Quién está autenticado en el request en curso. `null` = anónimo. */
let currentUser: { id: string; email: string; role: string | null } | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * El registro se dispara SIN await, para no demorar la respuesta. Los tests
 * tienen que dejar correr esa cola antes de mirar los espías: sin esto pasarían
 * por casualidad o fallarían de forma intermitente, que es peor.
 */
const flushAudit = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

function buildApp() {
  return (
    new Hono()
      .use('*', auditRequest)
      // Va DESPUÉS de la auditoría a propósito: replica a `authMiddleware` y
      // `orgMemberMiddleware`, que en la app real corren dentro de cada ruta.
      //
      // `orgRoles` y no `userRole`: este arnés ponía `userRole`, que sólo escribe
      // `orgMemberMiddleware`. Las rutas de administración usan
      // `orgTeamMemberMiddleware`, que NO lo escribe — así que el test afirmaba
      // un rol que producción nunca producía y pasaba en verde con `org_role`
      // nulo en el 100% de las filas reales. Un arnés que finge un contexto que
      // la app no arma no prueba la app: prueba el arnés. `orgRoles` sí lo deja
      // `app.ts` para toda sesión, pase por el middleware que pase.
      .use('*', async (c, next) => {
        if (currentUser) {
          c.set('user' as never, currentUser as never);
          c.set('session' as never, { id: SESSION } as never);
          c.set('orgId' as never, ORG as never);
          c.set('orgRoles' as never, { [ORG]: 1 } as never);
        }

        await next();
      })
      .get('/organization/tracking/overview', (c) => c.json({ ok: true }))
      .get('/course/c1/lesson', (c) => c.json({ ok: true }))
      .post('/course/c1/section', (c) => c.json({ ok: true }, 201))
      .put('/organization', (c) => c.json({ ok: true }))
      .delete('/organization/team/m1', (c) => c.json({ ok: true }))
      .get('/organization/team', (c) => c.json({ error: 'nope' }, 403))
      .get('/lento', async (c) => {
        await sleep(SLOW_ROUTE_MS);
        return c.json({ ok: true });
      })
      .get('/explota', () => {
        throw new Error('Cannot read properties of undefined');
      })
      .get('/session', (c) => c.body(null, 401))
      .post('/audit/incident', (c) => c.body(null, 204))
  );
}

let app: ReturnType<typeof buildApp>;

const call = (path: string, init?: RequestInit) =>
  app.request(path, { headers: { 'user-agent': CHROME_WINDOWS }, ...init });

const eventRow = () => recordEvent.mock.calls[0]![0] as Record<string, unknown>;
const incidentRow = () => recordIncident.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: USER, email: 'ana@consultora-ejemplo.com.ar', role: null };
  app = buildApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lecturas', () => {
  it('registra una lectura declarada con nombre, quién y desde qué dispositivo', async () => {
    const response = await call('/organization/tracking/overview?scope=all');
    await flushAudit();

    expect(response.status).toBe(200);
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(eventRow()).toMatchObject({
      action: 'VIO_SEGUIMIENTO',
      userId: USER,
      userLabel: 'ana@consultora-ejemplo.com.ar',
      orgId: ORG,
      orgRole: 1,
      sessionId: SESSION,
      device: 'Windows',
      browser: 'Chrome',
      method: 'GET',
      route: '/organization/tracking/overview',
      status: 200,
      metadata: { scope: 'all' },
      always: false
    });
    expect(recordIncident).not.toHaveBeenCalled();
  });

  it('guarda la ruta sin el querystring', async () => {
    // El querystring puede llevar términos de búsqueda. Lo que se necesita para
    // agrupar es la ruta; lo que valga la pena del query lo declara el mapa.
    await call('/organization/tracking/overview?scope=all');
    await flushAudit();

    expect(eventRow().route).toBe('/organization/tracking/overview');
  });

  it('mide cuánto tardó', async () => {
    await call('/organization/tracking/overview');
    await flushAudit();

    expect(typeof eventRow().durationMs).toBe('number');
    expect(eventRow().durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('NO registra una lectura que salió bien y no está declarada', async () => {
    // Sin esto el registro se llena de listados y refrescos, y tapa justo lo que
    // se busca.
    await call('/course/c1/lesson');
    await flushAudit();

    expect(recordEvent).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
  });
});

describe('escrituras', () => {
  it('registra toda escritura, aunque no esté declarada, con nombre genérico', async () => {
    // Es lo que hace que un endpoint nuevo quede auditado sin que nadie se
    // acuerde de agregarlo al mapa.
    await call('/course/c1/section', { method: 'POST' });
    await flushAudit();

    expect(eventRow()).toMatchObject({
      action: 'POST /course/c1/section',
      method: 'POST',
      status: 201,
      always: true
    });
  });

  it('usa el nombre declarado cuando lo hay', async () => {
    await call('/organization', { method: 'PUT' });
    await flushAudit();

    expect(eventRow()).toMatchObject({ action: 'EDITO_EMPRESA' });
  });

  it('saltea la ventana anti-repetición: cada escritura cambió algo distinto', async () => {
    await call('/organization/team/m1', { method: 'DELETE' });
    await flushAudit();

    expect(eventRow()).toMatchObject({ action: 'SACO_DEL_EQUIPO', always: true });
  });
});

describe('fallos', () => {
  it('un 4xx queda como incidencia y NO como acción', async () => {
    // Una escritura que falló no cambió nada: registrarla como acción diría que
    // ocurrió algo que no ocurrió.
    await call('/organization/team');
    await flushAudit();

    expect(recordEvent).not.toHaveBeenCalled();
    expect(incidentRow()).toMatchObject({
      kind: 'REQUEST_FAILED',
      source: 'BACKEND',
      status: 403,
      route: '/organization/team',
      userLabel: 'ana@consultora-ejemplo.com.ar'
    });
  });

  it('un 4xx no guarda stack: no aporta y ocupa', async () => {
    await call('/organization/team');
    await flushAudit();

    expect(incidentRow().stack).toBeNull();
  });

  it('un error sin atrapar queda como BACKEND_ERROR con su mensaje real y su stack', async () => {
    // El mensaje sale de `c.error`, que Hono deja puesto al pasar por onError.
    // Sin eso la incidencia diría sólo "respondió 500", que no alcanza para
    // arreglar nada.
    await call('/explota');
    await flushAudit();

    expect(incidentRow()).toMatchObject({
      kind: 'BACKEND_ERROR',
      status: 500,
      message: 'Cannot read properties of undefined'
    });
    expect(incidentRow().stack).toContain('Error');
  });

  it('registra la incidencia aunque no haya usuario', async () => {
    // Los errores más interesantes pasan justo cuando la sesión se rompió.
    currentUser = null;

    await call('/organization/team');
    await flushAudit();

    expect(recordEvent).not.toHaveBeenCalled();
    expect(incidentRow()).toMatchObject({ status: 403, userId: null, userLabel: null });
  });
});

describe('lentitud', () => {
  it('registra un request lento aunque haya salido 200', async () => {
    await call('/lento');
    await flushAudit();

    expect(incidentRow()).toMatchObject({ kind: 'SLOW_REQUEST', status: 200, route: '/lento' });
    expect(incidentRow().durationMs as number).toBeGreaterThanOrEqual(500);
  });

  it('el request lento no impide que además se registre lo que hizo', async () => {
    // Son dos hechos distintos: qué quiso hacer, y que el sistema tardó.
    currentUser = { id: USER, email: 'ana@consultora-ejemplo.com.ar', role: null };

    await call('/lento', { method: 'GET' });
    await flushAudit();

    // `/lento` no es escritura ni lectura declarada, así que sólo hay incidencia.
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe('exclusiones', () => {
  it('no registra nada del sondeo de sesión, ni siquiera cuando devuelve 401', async () => {
    // Un 401 ahí es la respuesta normal a "no estoy logueado". Sin esta
    // exclusión, cada pestaña abierta escribiría incidencias todo el día.
    await call('/session');
    await flushAudit();

    expect(recordEvent).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
  });

  it('no se audita a sí misma', async () => {
    // Si se auditara, un fallo del propio endpoint de reporte se realimentaría.
    await call('/audit/incident', { method: 'POST' });
    await flushAudit();

    expect(recordEvent).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
  });
});

describe('la auditoría no puede tocar al usuario', () => {
  it('responde igual si el registro explota', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    recordEvent.mockRejectedValue(new Error('Postgres caído'));

    const response = await call('/organization', { method: 'PUT' });
    await flushAudit();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('no deja una promesa rechazada suelta', async () => {
    // Un `unhandledRejection` fuera del ciclo del request tumba el proceso. El
    // `.catch()` del middleware es lo único que lo evita.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    recordIncident.mockRejectedValue(new Error('Postgres caído'));
    await call('/explota');
    await flushAudit();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('no espera al registro para devolver la respuesta', async () => {
    let resolveWrite: (() => void) | undefined;
    recordEvent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );

    // Si el middleware esperara la escritura, este await no terminaría nunca.
    const response = await call('/organization', { method: 'PUT' });

    expect(response.status).toBe(200);
    resolveWrite?.();
  });
});

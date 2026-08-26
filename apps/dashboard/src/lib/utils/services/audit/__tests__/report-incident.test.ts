/**
 * El reportador de incidencias del navegador.
 *
 * Es telemetría, así que la regla que lo gobierna es al revés de la de una
 * función del producto: **nunca puede fallar hacia afuera**. Si no sale, no sale.
 * Lo que sí tiene que garantizar es no convertirse él mismo en el problema —
 * inundando la base desde un bucle de render, o reportando su propia caída.
 *
 * `base-url` se mockea porque importa `$app/environment` y `$env/dynamic/public`,
 * que sólo existen dentro del build de SvelteKit.
 */
vi.mock('$lib/utils/services/api/base-url', () => ({
  getRequestBaseUrl: () => 'https://learn.tensor.com.ar/proxy'
}));

type ReportModule = typeof import('../report-incident');

const ENDPOINT = 'https://learn.tensor.com.ar/proxy/audit/incident';

interface SeenCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

let seen: SeenCall[];
let report: ReportModule;

/**
 * Cada test arranca con el módulo recién cargado.
 *
 * El tope y el conjunto de firmas viven en el ámbito del módulo: sin resetear,
 * un test se comería la cuota del siguiente y el orden de ejecución pasaría a
 * cambiar los resultados.
 */
async function loadFresh(): Promise<ReportModule> {
  vi.resetModules();

  // Con Vitest el `import` sí vuelve a evaluar el módulo: `resetModules()`
  // vacía su registro. (Con Jest en CJS había que usar `require`, porque un
  // `await import()` devolvía la instancia vieja con la cuota ya gastada.)
  return (await import('../report-incident')) as ReportModule;
}

beforeEach(async () => {
  seen = [];
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    });

    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  report = await loadFresh();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('reportIncident', () => {
  it('manda el reporte a la API con lo que hace falta para ubicar el error', () => {
    report.reportIncident({
      kind: 'FRONTEND_ERROR',
      message: "Cannot read properties of undefined (reading 'byStudent')",
      stack: 'TypeError: ...',
      route: '/organization/tracking/overview',
      metadata: { origin: 'svelte.boundary' }
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(ENDPOINT);
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].body).toMatchObject({
      kind: 'FRONTEND_ERROR',
      message: "Cannot read properties of undefined (reading 'byStudent')",
      stack: 'TypeError: ...',
      route: '/organization/tracking/overview'
    });
    expect(seen[0].body.metadata).toMatchObject({ origin: 'svelte.boundary' });
  });

  it('no manda dos veces el mismo error', () => {
    // Un bucle de render tira el mismo error miles de veces por segundo. Sin la
    // firma, el navegador se dedicaría a repetir un renglón y encima haría más
    // lenta la pantalla ya rota.
    const incident = { kind: 'FRONTEND_ERROR' as const, message: 'boom', route: '/x' };

    report.reportIncident(incident);
    report.reportIncident(incident);
    report.reportIncident(incident);

    expect(seen).toHaveLength(1);
  });

  it('sí manda errores distintos', () => {
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'boom', route: '/x' });
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'otro', route: '/x' });
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'boom', route: '/y' });
    report.reportIncident({ kind: 'REQUEST_FAILED', message: 'boom', route: '/x' });

    expect(seen).toHaveLength(4);
  });

  it('nunca se reporta a sí mismo', () => {
    // Si el endpoint estuviera caído, cada intento fallido generaría otro
    // intento, y así al infinito.
    report.reportIncident({ kind: 'REQUEST_FAILED', message: 'Network error', route: '/audit/incident' });

    expect(seen).toHaveLength(0);
  });

  it('no tira ni deja rechazos sueltos aunque fetch explote', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('sin conexión'))) as unknown as typeof fetch;

    expect(() => report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'boom' })).not.toThrow();

    // Si el `.catch()` no estuviera, esto sería un unhandledRejection.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('no tira si fetch ni siquiera existe', () => {
    delete (globalThis as { fetch?: unknown }).fetch;

    expect(() => report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'boom' })).not.toThrow();
  });
});

describe('el tope y su ventana rodante', () => {
  it('corta a los 20 reportes', () => {
    for (let i = 0; i < 30; i++) {
      report.reportIncident({ kind: 'FRONTEND_ERROR', message: `error ${i}` });
    }

    expect(seen).toHaveLength(20);
  });

  it('vuelve a reportar pasada la ventana', () => {
    // Este es el test que importa. Este módulo TAMBIÉN corre en el servidor de
    // SvelteKit, que vive semanas: con un contador que sólo sube, después de
    // veinte errores dejaría de reportar para siempre y ese silencio se
    // confundiría con que no pasa nada.
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);

    for (let i = 0; i < 30; i++) {
      report.reportIncident({ kind: 'FRONTEND_ERROR', message: `error ${i}` });
    }
    expect(seen).toHaveLength(20);

    clock.mockReturnValue(start + 5 * 60 * 1000 + 1);
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'después de la ventana' });

    expect(seen).toHaveLength(21);
  });

  it('olvida las firmas al abrir una ventana nueva', () => {
    // Un error que sigue pasando cinco minutos después es información: dice que
    // no fue un hecho aislado.
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);

    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'el mismo de siempre' });
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'el mismo de siempre' });
    expect(seen).toHaveLength(1);

    clock.mockReturnValue(start + 5 * 60 * 1000 + 1);
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'el mismo de siempre' });

    expect(seen).toHaveLength(2);
  });
});

describe('navegador y servidor', () => {
  /**
   * Un `window` mínimo. Este test corre en el proyecto `logica`, que es Node
   * puro a propósito: el módulo también se ejecuta en el servidor y ahí no hay
   * DOM. Además el módulo sólo usa `location.pathname` y `addEventListener`, y
   * un doble de esos dos deja a la vista exactamente de qué depende — un jsdom
   * entero lo escondería.
   */
  function fakeWindow() {
    const listeners: Record<string, (event: unknown) => void> = {};

    (globalThis as { window?: unknown }).window = {
      location: { pathname: '/org/empresa-de-prueba/seguimiento' },
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        listeners[name] = handler;
      }
    };

    return listeners;
  }

  it('en el navegador agrega la pantalla y sobrevive al cierre de la pestaña', async () => {
    fakeWindow();
    report = await loadFresh();

    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'boom' });

    expect(seen[0].body.metadata).toMatchObject({ screen: '/org/empresa-de-prueba/seguimiento' });
    // `keepalive` es lo que hace que el reporte salga aunque la persona recargue
    // o cierre justo después de que se rompiera la pantalla.
    expect(seen[0].init.keepalive).toBe(true);
  });

  it('en el servidor se marca como SSR y reenvía los headers que le pasan', () => {
    // El reporte viaja desde el proceso de SvelteKit, no desde el navegador: sin
    // reenviar la cookie, la incidencia quedaría a nombre de nadie.
    report.reportIncident({
      kind: 'FRONTEND_ERROR',
      message: 'boom',
      headers: { cookie: 'classroomio.session_token=abc', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' }
    });

    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('cookie')).toBe('classroomio.session_token=abc');
    expect(headers.get('user-agent')).toBe('Mozilla/5.0 (Windows NT 10.0)');
    expect(seen[0].body.metadata).toMatchObject({ runtime: 'ssr' });
    expect(seen[0].init.keepalive).toBe(false);
  });

  it('los headers no viajan dentro del cuerpo', () => {
    report.reportIncident({ kind: 'FRONTEND_ERROR', message: 'boom', headers: { cookie: 'secreto' } });

    expect(seen[0].body).not.toHaveProperty('headers');
    expect(JSON.stringify(seen[0].body)).not.toContain('secreto');
  });

  it('el marcador de SSR no pisa el origen que declaró quien reporta', () => {
    report.reportIncident({
      kind: 'FRONTEND_ERROR',
      message: 'boom',
      metadata: { origin: 'sveltekit.handleError.server', routeId: '/(app)/org/[slug]/seguimiento' }
    });

    expect(seen[0].body.metadata).toMatchObject({
      origin: 'sveltekit.handleError.server',
      routeId: '/(app)/org/[slug]/seguimiento',
      runtime: 'ssr'
    });
  });
});

describe('installBrowserErrorReporting', () => {
  it('no hace nada sin navegador', () => {
    expect(() => report.installBrowserErrorReporting()).not.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('reporta un error de código suelto con dónde ocurrió', async () => {
    const listeners = fakeWindowWithListeners();
    report = await loadFresh();
    report.installBrowserErrorReporting();

    listeners.error?.({
      message: 'x is not a function',
      error: new Error('x is not a function'),
      filename: 'app.js',
      lineno: 12,
      colno: 3
    });

    expect(seen[0].body).toMatchObject({ kind: 'FRONTEND_ERROR', message: 'x is not a function' });
    expect(seen[0].body.metadata).toMatchObject({ file: 'app.js', line: 12, column: 3, origin: 'window.error' });
  });

  it('reporta una promesa rechazada sin catch', async () => {
    const listeners = fakeWindowWithListeners();
    report = await loadFresh();
    report.installBrowserErrorReporting();

    listeners.unhandledrejection?.({ reason: new Error('fetch falló') });

    expect(seen[0].body).toMatchObject({ kind: 'FRONTEND_ERROR', message: 'fetch falló' });
    expect(seen[0].body.metadata).toMatchObject({ origin: 'unhandledrejection' });
  });

  it('sobrevive a un rechazo que no es un Error', async () => {
    const listeners = fakeWindowWithListeners();
    report = await loadFresh();
    report.installBrowserErrorReporting();

    listeners.unhandledrejection?.({ reason: undefined });

    expect(seen[0].body).toMatchObject({ message: 'Promesa rechazada' });
  });

  function fakeWindowWithListeners() {
    const listeners: Record<string, ((event: never) => void) | undefined> = {};

    (globalThis as { window?: unknown }).window = {
      location: { pathname: '/org/empresa-de-prueba/seguimiento' },
      addEventListener: (name: string, handler: (event: never) => void) => {
        listeners[name] = handler;
      }
    };

    return listeners as Record<string, ((event: unknown) => void) | undefined>;
  }
});

describe('isSlowRequest', () => {
  it('marca lento a partir de 3 segundos', () => {
    // El umbral del navegador es más alto que el del servidor (2s) a propósito:
    // acá se mide la espera completa, con la red adentro.
    expect(report.isSlowRequest(2999)).toBe(false);
    expect(report.isSlowRequest(3000)).toBe(true);
  });
});

describe('shouldReportFailedRequest', () => {
  const should = (status: number, error: unknown = new Error('x')) => report.shouldReportFailedRequest(status, error);

  it('reporta lo que el servidor no puede ver', () => {
    expect(should(0)).toBe(true); // nunca llegó
    expect(should(408)).toBe(true); // el navegador se cansó de esperar
    expect(should(500)).toBe(true);
    expect(should(502)).toBe(true);
  });

  it('reporta el 429, que es el único lugar donde queda registro', () => {
    // El limitador de tasa corta ANTES del middleware de auditoría del servidor:
    // si el navegador tampoco lo reportara, un 429 no existiría en ningún lado.
    expect(should(429)).toBe(true);
  });

  it('NO reporta los 4xx esperables: la API ya los registró con más contexto', () => {
    expect(should(400)).toBe(false);
    expect(should(401)).toBe(false);
    expect(should(403)).toBe(false);
    expect(should(404)).toBe(false);
    expect(should(409)).toBe(false);
  });

  it('NO reporta un abort pedido por quien llamó', () => {
    // Cambiar de pantalla cancela los requests en vuelo. Reportarlos convertiría
    // el uso normal del dashboard en una lluvia de incidencias.
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';

    expect(should(0, abort)).toBe(false);
    expect(should(500, abort)).toBe(false);
  });

  it('sigue reportando si el error no es un Error', () => {
    expect(should(0, 'algo raro')).toBe(true);
    expect(should(0, undefined)).toBe(true);
  });
});

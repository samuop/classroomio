import { shouldReportFailedRequest, shouldReportRenderError } from './report-incident';

/**
 * Qué merece quedar registrado como incidencia, y qué es ruido.
 *
 * La tabla de incidencias sólo sirve si mirarla dice algo. Tiene un tope de 20
 * reportes cada cinco minutos, así que **cada renglón de basura desplaza uno
 * real**: no es una cuestión de prolijidad, es que la falla que importa puede no
 * entrar porque el cupo se lo comió un favicon.
 *
 * Eso pasó de verdad. En producción, dos de las primeras siete incidencias eran
 * `404 /favicon.ico` — el navegador lo pide solo cuando la página no declara
 * ícono, y acá a propósito no se declara ninguno. Estábamos registrando como
 * incidencia la consecuencia esperada de una decisión deliberada.
 */
describe('shouldReportRenderError', () => {
  it('ignora un 404: la ruta no existe, y eso no es una falla', () => {
    expect(shouldReportRenderError(404)).toBe(false);
  });

  it('registra un 500, que es una pantalla rota de verdad', () => {
    // El caso que dio origen a todo el sistema: el seguimiento de alumnos se
    // rompió, no se pudo reproducir y no quedó rastro en ningún lado.
    expect(shouldReportRenderError(500)).toBe(true);
  });

  it('registra un 403 al cargar una página', () => {
    // Este NO se puede tirar junto con el 404 aunque los dos sean 4xx: un 403 al
    // cargar lo produce una guarda de permisos de SvelteKit, no la API, así que
    // este es el único lugar donde se entera de que existió. Es justo lo que uno
    // quiere ver cuando revisa accesos.
    expect(shouldReportRenderError(403)).toBe(true);
  });

  it('registra un 401', () => {
    expect(shouldReportRenderError(401)).toBe(true);
  });
});

/**
 * La otra mitad de la política, para los fetch que fallan. Existía sin tests
 * propios pese a ser la regla que decide qué ve la auditoría del lado del
 * navegador.
 */
describe('shouldReportFailedRequest', () => {
  it('registra el request que nunca llegó', () => {
    // Status 0: sin conexión, DNS caído, Nginx muerto. Para el servidor este
    // pedido no existió nunca, así que si el navegador no lo cuenta, nadie lo
    // cuenta.
    expect(shouldReportFailedRequest(0, null)).toBe(true);
  });

  it('registra un 429, que el limitador corta antes de la auditoría del servidor', () => {
    expect(shouldReportFailedRequest(429, null)).toBe(true);
  });

  it('registra un 408 y los 5xx', () => {
    expect(shouldReportFailedRequest(408, null)).toBe(true);
    expect(shouldReportFailedRequest(500, null)).toBe(true);
    expect(shouldReportFailedRequest(503, null)).toBe(true);
  });

  it('NO registra los 4xx normales: la API ya los anotó con más contexto', () => {
    expect(shouldReportFailedRequest(400, null)).toBe(false);
    expect(shouldReportFailedRequest(401, null)).toBe(false);
    expect(shouldReportFailedRequest(403, null)).toBe(false);
    expect(shouldReportFailedRequest(404, null)).toBe(false);
  });

  it('no cuenta como falla un pedido que se canceló solo', () => {
    // Cambiar de pantalla o reescribir una búsqueda aborta requests todo el
    // tiempo: es el comportamiento normal, no un problema.
    const abort = new Error('cancelado');
    abort.name = 'AbortError';

    expect(shouldReportFailedRequest(0, abort)).toBe(false);
  });

  it('un AbortError tampoco se reporta aunque venga con status de servidor', () => {
    const abort = new Error('cancelado');
    abort.name = 'AbortError';

    expect(shouldReportFailedRequest(500, abort)).toBe(false);
  });
});

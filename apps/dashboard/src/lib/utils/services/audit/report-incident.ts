/**
 * Reporta a la API lo que sólo el navegador puede ver.
 *
 * Tres cosas que del lado del servidor son invisibles:
 *
 *   1. Una pantalla que se rompe al dibujarse. La API respondió 200 y quedó tan
 *      contenta; la persona ve una página en blanco y lo único que puede hacer
 *      es avisar por WhatsApp.
 *   2. Un request que nunca llegó (sin conexión, DNS, Nginx caído). Para el
 *      servidor no existió.
 *   3. Cuánto esperó realmente la persona. El servidor mide su propio tiempo de
 *      proceso; acá se mide la espera completa, con la red adentro. Si el
 *      servidor dice 50ms y el navegador 4s, el problema no es la aplicación.
 *
 * Nace de un caso concreto: la pantalla de seguimiento de alumnos se rompió una
 * vez, no se pudo volver a reproducir, y no quedó rastro en ningún lado.
 */

import { getRequestBaseUrl } from '$lib/utils/services/api/base-url';

/** A partir de acá, un request se considera lento desde la mirada del usuario. */
const SLOW_REQUEST_MS = 3000;

/**
 * Tope de reportes, en una ventana rodante.
 *
 * Un bucle de render puede tirar miles de errores por segundo. Sin tope, el
 * navegador se dedicaría a inundar la base con la misma línea repetida, y encima
 * haría más lenta la pantalla ya rota.
 *
 * **La ventana rodante no es un detalle de estilo.** Este módulo también corre
 * en el servidor de SvelteKit, que vive semanas: un contador que sólo sube
 * dejaría de reportar para siempre después de veinte errores, y el silencio se
 * confundiría con que no pasa nada. Cada cinco minutos se empieza de cero, así
 * que lo peor que puede pasar es perder los reportes de una ráfaga, nunca todos
 * los que vengan después.
 */
const MAX_PER_WINDOW = 20;
const WINDOW_MS = 5 * 60 * 1000;

let sent = 0;
let windowStartedAt = 0;

/** Firma de lo ya reportado, para no mandar el mismo error una y otra vez. */
let alreadyReported = new Set<string>();

/** ¿Hay lugar para un reporte más? Abre una ventana nueva si la anterior venció. */
function withinQuota(): boolean {
  const now = Date.now();

  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now;
    sent = 0;
    alreadyReported = new Set();
  }

  return sent < MAX_PER_WINDOW;
}

export type IncidentKind = 'FRONTEND_ERROR' | 'REQUEST_FAILED' | 'SLOW_REQUEST';

export interface IncidentReport {
  kind: IncidentKind;
  message: string;
  stack?: string;
  code?: string;
  status?: number;
  route?: string;
  method?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  /**
   * Headers extra para el reporte. Los usa el servidor de SvelteKit: reenviando
   * la cookie de sesión, la incidencia queda atribuida a la persona en vez de
   * anónima. En el navegador no hace falta (la cookie va sola).
   */
  headers?: Record<string, string>;
}

/**
 * Manda el reporte. Nunca tira ni devuelve error: es telemetría, no una función
 * del producto. Si falla, se pierde el renglón y nada más.
 */
export function reportIncident(incident: IncidentReport): void {
  try {
    if (!withinQuota()) return;

    // El endpoint de reporte no se reporta a sí mismo: si estuviera caído, cada
    // intento fallido generaría otro intento, y así al infinito.
    if (incident.route?.includes('/audit/incident')) return;

    const signature = `${incident.kind}|${incident.message}|${incident.route ?? ''}|${incident.status ?? ''}`;
    if (alreadyReported.has(signature)) return;

    alreadyReported.add(signature);
    sent++;

    const { headers, ...body } = incident;
    const isBrowser = typeof window !== 'undefined';

    void fetch(`${getRequestBaseUrl()}/audit/incident`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        ...body,
        metadata: {
          ...body.metadata,
          // En qué parte del sistema estaba. Es lo primero que se mira para
          // ubicar un error de pantalla.
          ...(isBrowser ? { screen: window.location.pathname } : { runtime: 'ssr' })
        }
      }),
      // No retiene el cierre de la pestaña si la persona se va justo ahora.
      keepalive: isBrowser
    }).catch(() => {
      /* telemetría: si no sale, no sale */
    });
  } catch {
    // Ni siquiera esto puede romper la pantalla del usuario.
  }
}

/** ¿Esta llamada tardó lo suficiente como para dejar registro? */
export function isSlowRequest(durationMs: number): boolean {
  return durationMs >= SLOW_REQUEST_MS;
}

/**
 * ¿Vale la pena que el NAVEGADOR reporte este fallo?
 *
 * El criterio es reportar sólo lo que el servidor no puede ver por su cuenta. Un
 * 403 ya quedó registrado del lado de la API con más contexto del que tiene el
 * navegador; duplicarlo sólo ensucia la tabla y hace más difícil encontrar lo
 * que importa.
 *
 * Queda afuera de `reportIncident` y exportado aparte porque es una decisión,
 * no un detalle de implementación: vive acá, al lado del umbral de lentitud, en
 * vez de enterrada dentro de un `catch` del cliente de API.
 */
export function shouldReportFailedRequest(status: number, error: unknown): boolean {
  // Un abort pedido por quien llamó (cambio de pantalla, búsqueda que se
  // reescribe) no es una falla: es el comportamiento normal.
  if (error instanceof Error && error.name === 'AbortError') return false;

  return (
    // Nunca llegó: para el servidor este request no existió.
    status === 0 ||
    // El navegador se cansó de esperar; el servidor puede haber terminado bien.
    status === 408 ||
    // Lo frenó el limitador, que corta ANTES de la auditoría del servidor: este
    // es el único lugar donde un 429 se entera de que existió.
    status === 429 ||
    // Se rompió del otro lado, y saber en qué pantalla estaba la persona agrega
    // algo que la API no sabe.
    status >= 500
  );
}

/**
 * Engancha los errores que SvelteKit no atrapa: los de código suelto y las
 * promesas rechazadas sin `catch`.
 *
 * El `handleError` de `hooks.client.ts` cubre los de navegación y renderizado, y
 * el `<svelte:boundary>` del layout autenticado cubre los que tira un componente
 * ya montado. Estos dos cubren el resto — por ejemplo un `setTimeout` que
 * explota, o un `await` sin `catch` dentro de un `$effect`.
 */
export function installBrowserErrorReporting(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    reportIncident({
      kind: 'FRONTEND_ERROR',
      message: event.message || 'Error de JavaScript',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      metadata: { file: event.filename, line: event.lineno, column: event.colno, origin: 'window.error' }
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;

    reportIncident({
      kind: 'FRONTEND_ERROR',
      message: reason instanceof Error ? reason.message : String(reason ?? 'Promesa rechazada'),
      stack: reason instanceof Error ? reason.stack : undefined,
      metadata: { origin: 'unhandledrejection' }
    });
  });
}

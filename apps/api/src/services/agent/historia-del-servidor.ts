/**
 * La conversación de la ronda, armada por el servidor con lo que tiene guardado.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * El navegador mandaba la conversación ENTERA en cada pedido, y el servidor la
 * usaba tal cual. Medido el 2026-11-03: una conversación de construcción llegó a
 * 1,4 MB por mensaje, y los envíos empezaron a cortarse («other side closed»,
 * cero bytes leídos, ningún rastro en la API). Además el servidor terminaba
 * creyéndole al navegador lo que la conversación decía, cuando la que guardó
 * cada ronda es la suya.
 *
 * Ahora el navegador manda sólo el mensaje nuevo, y esto lo pega a la historia
 * guardada. La historia la guarda el servidor desde que la ronda termina en el
 * servidor (`ronda-viva.ts`): al arrancar guarda el pedido, al terminar la
 * ronda entera.
 *
 * ── Las reglas, que antes aplicaba el navegador sobre su copia ───────────────
 *
 * - El mensaje ya está guardado (mismo id): se reemplaza en su lugar y se corta
 *   lo que venía después. Es «Reintentar» (`regenerate()` del SDK reenvía el
 *   último mensaje de la docente) y es reenviar un pedido que falló.
 * - `regenerate-message` sin ese id: se responde de nuevo el último mensaje de
 *   la docente guardado, sin lo que vino después.
 * - Una aprobación del plan nueva reemplaza a una aprobación anterior que quedó
 *   sin respuesta (`handleImplementPlan` hacía eso sobre su copia: apilarlas
 *   dejaba una aprobación muda por cada intento).
 *
 * Pura: sin base, para poder probarla entera.
 */

export interface MensajeDeLaConversacion {
  id?: string;
  role?: string;
  parts?: unknown[];
  metadata?: unknown;
}

export type DisparoDelPedido = 'submit-message' | 'regenerate-message';

function esAprobacionDelPlan(mensaje: MensajeDeLaConversacion | undefined): boolean {
  if (mensaje?.role !== 'user') return false;

  const metadata = mensaje.metadata as { plan?: { action?: unknown } } | null | undefined;

  return metadata?.plan?.action === 'implement_course_plan';
}

function idDe(mensaje: MensajeDeLaConversacion | undefined): string | undefined {
  return typeof mensaje?.id === 'string' && mensaje.id.length > 0 ? mensaje.id : undefined;
}

/**
 * La historia con la que corre la ronda.
 *
 * @param guardada lo que el servidor tiene de esta conversación (puede venir
 *   vacía: el primer mensaje de un chat nuevo).
 * @param mensaje el mensaje que mandó el navegador. Puede faltar en un
 *   «Reintentar» de un cliente que no lo manda.
 */
export function historiaDeLaRonda<M extends MensajeDeLaConversacion>(params: {
  guardada: readonly M[];
  mensaje?: M;
  disparo?: DisparoDelPedido;
}): M[] {
  const guardada = [...params.guardada];
  const { mensaje, disparo } = params;
  const id = idDe(mensaje);

  if (mensaje && id) {
    const indice = guardada.findIndex((existente) => idDe(existente) === id);

    if (indice >= 0) return [...guardada.slice(0, indice), mensaje];
  }

  if (disparo === 'regenerate-message') {
    const ultimoDeLaDocente = guardada.map((existente) => existente.role).lastIndexOf('user');

    if (ultimoDeLaDocente >= 0) {
      const base = guardada.slice(0, ultimoDeLaDocente + 1);

      // El mensaje que mandó, si vino, es la versión que hay que responder.
      return mensaje?.role === 'user' ? [...base.slice(0, -1), mensaje] : base;
    }
  }

  if (!mensaje) return guardada;

  const ultimo = guardada.at(-1);

  if (esAprobacionDelPlan(mensaje) && esAprobacionDelPlan(ultimo)) {
    return [...guardada.slice(0, -1), mensaje];
  }

  return [...guardada, mensaje];
}

/** Lo guardado en la fila, como lista de mensajes; cualquier otra cosa es vacío. */
export function mensajesGuardados<M extends MensajeDeLaConversacion>(valor: unknown): M[] {
  return Array.isArray(valor) ? (valor.filter((m) => typeof m === 'object' && m !== null) as M[]) : [];
}

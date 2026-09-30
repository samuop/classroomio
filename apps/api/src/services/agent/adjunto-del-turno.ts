/**
 * El documento de `context.documentId`: si es el adjunto de ESTE mensaje, y si
 * hace falta cargarlo entero.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * El panel manda `context.documentId` en TODOS los pedidos mientras la fuente
 * siga «adjunta» en el compositor, y la primera página que trajo la
 * investigación del asistente de creación quedó así durante toda la
 * construcción. Con el material como índice, el servidor la cargaba entera en
 * cada paso del constructor —unas 4.700 fichas de una página ajena al tema del
 * curso— y el prompt la presentaba como «el PDF que el docente acaba de
 * adjuntar… la fuente de verdad para armar el curso». Después de recargar la
 * página, la fuente adoptada habría sido la pantalla de inicio de sesión de
 * Google que había quedado guardada como fuente.
 *
 * Dos preguntas distintas, y por eso dos funciones:
 *
 * - ¿Hay que cargarlo entero? No, si ya es fuente del curso y el material
 *   viaja como índice: el índice lo lista y `read_source` lo lee. Cargarlo
 *   además duplica y le gana al índice en el prompt.
 * - ¿Lo adjuntó el docente con ESTE mensaje? Sólo entonces se le puede decir
 *   al modelo que es el foco del turno.
 */

type MensajeConAdjunto = {
  role?: string;
  metadata?: { attachment?: { documentId?: unknown; documentIds?: unknown } };
};

function nombraElDocumento(mensaje: MensajeConAdjunto | undefined, documentId: string): boolean {
  const adjunto = mensaje?.metadata?.attachment;

  if (!adjunto) return false;
  if (adjunto.documentId === documentId) return true;

  return Array.isArray(adjunto.documentIds) && adjunto.documentIds.includes(documentId);
}

/**
 * Si `documentId` llegó con el último mensaje del docente y con ninguno anterior.
 *
 * El panel repite el adjunto en cada mensaje que el docente escribe mientras la
 * fuente siga adjunta: que lo nombre el último mensaje no alcanza. Lo que
 * distingue un adjunto nuevo de uno que quedó pegado es que ningún mensaje
 * anterior lo nombraba.
 */
export function esAdjuntoDeEsteMensaje(messages: unknown[], documentId: string | undefined): boolean {
  if (!documentId) return false;

  const delDocente = (messages as MensajeConAdjunto[]).filter((mensaje) => mensaje?.role === 'user');
  const ultimo = delDocente[delDocente.length - 1];

  if (!nombraElDocumento(ultimo, documentId)) return false;

  return !delDocente.slice(0, -1).some((mensaje) => nombraElDocumento(mensaje, documentId));
}

/**
 * Qué documento va entero en el mensaje de contexto cuando el material viaja
 * como índice.
 *
 * Ninguno si ya es fuente del curso: está en el índice y se lee con
 * `read_source`, como cualquier otra. Sólo un documento que el índice no tiene
 * —porque el índice no se pudo armar, o porque todavía no es fuente— se carga
 * entero, porque si no el modelo no tendría ninguna forma de verlo.
 */
export function documentosEnLineaConIndice(params: { documentId?: string; idsDelIndice: string[] }): string[] {
  if (!params.documentId) return [];

  return params.idsDelIndice.includes(params.documentId) ? [] : [params.documentId];
}

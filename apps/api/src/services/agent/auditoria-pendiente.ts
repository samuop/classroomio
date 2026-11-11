/**
 * La auditoría de una ronda que no llegó a cerrar.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * Lo que el asistente cambia se audita al CERRAR la ronda, a partir de su
 * registro, que vive en la memoria del proceso (`auditoria-del-asistente.ts`).
 * Si el proceso moría antes —un deploy a mitad de una construcción, por
 * ejemplo— las lecciones escritas quedaban en el curso y de la ronda no quedaba
 * ni una fila: nadie podía saber después quién las había escrito. Medido el
 * 2026-11-11 matando el proceso: una lección con contenido, cero filas.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * Al terminar cada paso, el registro de la ronda queda a resguardo en Redis,
 * con quién la pidió. Si la ronda cierra bien, se audita como siempre y el
 * resguardo se borra. Si queda uno huérfano, se audita la próxima vez que se
 * vuelve sobre esa conversación —al empezar otra ronda, o cuando el panel
 * pregunta por ella y ya no hay ninguna viva—, marcado como de una ronda
 * interrumpida.
 *
 * Nada de esto puede romper ni demorar la ronda: sin Redis, o si falla, todo
 * queda como antes.
 */

import { auditarCambiosDeLaRonda, type IdentidadDelPedido } from '@api/services/agent/auditoria-del-asistente';
import type { RegistroDeRonda } from '@api/services/agent/round-ledger';

/** Lo que este módulo necesita de Redis; así los tests no levantan uno. */
export interface AlmacenDeAuditoria {
  set(clave: string, valor: string, opciones: { EX: number }): Promise<unknown>;
  get(clave: string): Promise<string | null>;
  del(clave: string): Promise<unknown>;
  /** Leer y borrar en un solo paso (Redis 6.2+). Sin él se lee y después se borra. */
  getDel?(clave: string): Promise<string | null>;
}

/** Un mes: de sobra para que alguien vuelva a abrir la conversación. */
const VENCE_EN_SEGUNDOS = 30 * 24 * 60 * 60;

const clave = (conversationId: string) => `agent:auditoria:pendiente:conversation:${conversationId}`;

interface Resguardo {
  identidad: IdentidadDelPedido;
  registro: RegistroDeRonda;
  courseId: string;
}

/** Deja a resguardo lo que la ronda lleva cambiado. Pisa el resguardo anterior de la misma ronda. */
export async function dejarAuditoriaPendiente(
  almacen: AlmacenDeAuditoria | null | undefined,
  datos: Resguardo & { conversationId: string }
): Promise<void> {
  if (!almacen || datos.registro.cambios.length === 0) return;

  try {
    const { conversationId, ...resguardo } = datos;

    await almacen.set(clave(conversationId), JSON.stringify(resguardo), { EX: VENCE_EN_SEGUNDOS });
  } catch (error) {
    console.error('[agent.chat] no se pudo dejar a resguardo la auditoría de la ronda:', error);
  }
}

/** La ronda cerró y ya se auditó: el resguardo no hace falta. */
export async function quitarAuditoriaPendiente(
  almacen: AlmacenDeAuditoria | null | undefined,
  conversationId: string
): Promise<void> {
  if (!almacen) return;

  try {
    await almacen.del(clave(conversationId));
  } catch (error) {
    console.error('[agent.chat] no se pudo borrar el resguardo de la auditoría:', error);
  }
}

/**
 * Audita lo que dejó una ronda que murió sin cerrar. Devuelve cuántos cambios
 * auditó (0 si no había nada).
 *
 * Sólo se llama cuando se sabe que esa conversación NO tiene una ronda viva:
 * con una viva, el resguardo es el suyo y todavía lo va a auditar ella.
 *
 * El resguardo se saca ANTES de auditar: dos pedidos que lleguen juntos no lo
 * auditan dos veces. Si la escritura falla después, esas filas se pierden —lo
 * mismo que pasaba siempre— en vez de duplicarse.
 */
export async function recuperarAuditoriaPendiente(params: {
  almacen: AlmacenDeAuditoria | null | undefined;
  conversationId: string;
  /** Para los tests. */
  auditar?: typeof auditarCambiosDeLaRonda;
}): Promise<number> {
  const { almacen, conversationId } = params;

  if (!almacen) return 0;

  try {
    const crudo = almacen.getDel ? await almacen.getDel(clave(conversationId)) : await leerYBorrar(almacen, conversationId);

    if (!crudo) return 0;

    const resguardo = JSON.parse(crudo) as Partial<Resguardo>;

    if (!resguardo.identidad || !resguardo.courseId || !Array.isArray(resguardo.registro?.cambios)) return 0;

    await (params.auditar ?? auditarCambiosDeLaRonda)({
      identidad: resguardo.identidad,
      registro: resguardo.registro,
      courseId: resguardo.courseId,
      conversationId,
      interrumpida: true
    });

    console.warn(
      `[agent.chat] auditados ${resguardo.registro.cambios.length} cambios de una ronda interrumpida de ${conversationId}`
    );

    return resguardo.registro.cambios.length;
  } catch (error) {
    console.error('[agent.chat] no se pudo recuperar la auditoría de una ronda interrumpida:', error);

    return 0;
  }
}

async function leerYBorrar(almacen: AlmacenDeAuditoria, conversationId: string): Promise<string | null> {
  const crudo = await almacen.get(clave(conversationId));

  if (crudo) await almacen.del(clave(conversationId));

  return crudo;
}

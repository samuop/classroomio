import type { CoursePlan } from './course-plan';
import { getAgentToolName, getAgentToolResult, getAgentToolStatus, isAgentToolPart } from './tool-parts';
import type { AiAssistantPlanProgress, AiAssistantPlanProgressItem } from './types';

export interface PlanDeLaConversacion {
  /** Distingue una versión del plan de otra. */
  id: string;
  plan: CoursePlan;
  messageId: string;
}

function esPlan(valor: unknown): valor is CoursePlan {
  const posible = valor as { title?: unknown; sections?: unknown } | null;

  return !!posible && typeof posible === 'object' && typeof posible.title === 'string' && Array.isArray(posible.sections);
}

/** El id de la llamada; en historiales que no lo guardaron, el mensaje y la posición. */
export function idDelPlan(messageId: string, parte: unknown, indice: number): string {
  const toolCallId = (parte as { toolCallId?: unknown } | null)?.toolCallId;

  return typeof toolCallId === 'string' && toolCallId ? toolCallId : `${messageId}:${indice}`;
}

/**
 * Todas las versiones del plan en la conversación, de la más vieja a la más nueva.
 *
 * Sólo las que terminaron bien: una llamada a medio escribir o que falló no es
 * una versión que se pueda revisar ni aprobar.
 */
export function planesDeLaConversacion(mensajes: Array<{ id: string; parts?: unknown[] }>): PlanDeLaConversacion[] {
  return mensajes.flatMap((mensaje) =>
    (mensaje.parts ?? []).flatMap((parte, indice) => {
      if (!isAgentToolPart(parte) || getAgentToolName(parte) !== 'generate_course_plan') return [];
      if (getAgentToolStatus(parte) !== 'completed') return [];

      const plan = getAgentToolResult(parte);

      return esPlan(plan) ? [{ id: idDelPlan(mensaje.id, parte, indice), plan, messageId: mensaje.id }] : [];
    })
  );
}

export type EstadoDelItem = AiAssistantPlanProgressItem['status'];

const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * El avance medido por el servidor, ubicado sobre el plan.
 *
 * El servidor recorre el plan en orden —cada sección y después sus ítems— y
 * devuelve una fila por cada uno con su título (`buildPlanProgressAnchor`). Se
 * aparean por tipo y título, avanzando en ese orden: dos lecciones que se llaman
 * igual en secciones distintas caen cada una en la suya.
 *
 * Las posiciones son `"0"` para la primera sección y `"0.2"` para su tercer ítem.
 * Un ítem sin fila apareada no tiene estado: mejor no marcar nada que marcar mal.
 */
export function estadosSobreElPlan(
  plan: CoursePlan,
  progreso: AiAssistantPlanProgress | null | undefined
): Map<string, EstadoDelItem> {
  const estados = new Map<string, EstadoDelItem>();
  const filas = progreso?.items ?? [];

  if (filas.length === 0) return estados;

  const usadas = new Set<number>();
  let cursor = 0;

  const buscar = (tipo: AiAssistantPlanProgressItem['kind'], titulo: string): number => {
    const buscado = normalizar(titulo);
    const coincide = (indice: number) =>
      !usadas.has(indice) && filas[indice].kind === tipo && normalizar(filas[indice].title) === buscado;

    for (let indice = cursor; indice < filas.length; indice += 1) if (coincide(indice)) return indice;
    for (let indice = 0; indice < cursor; indice += 1) if (coincide(indice)) return indice;

    return -1;
  };

  const marcar = (posicion: string, indice: number) => {
    if (indice < 0) return;

    usadas.add(indice);
    cursor = indice + 1;
    estados.set(posicion, filas[indice].status);
  };

  (plan.sections ?? []).forEach((seccion, s) => {
    marcar(String(s), buscar('section', seccion.title));

    (seccion.items ?? []).forEach((item, i) => {
      marcar(`${s}.${i}`, buscar(item.type === 'exercise' ? 'exercise' : 'lesson', item.title));
    });
  });

  return estados;
}

/** Cuántas secciones, lecciones y ejercicios trae un plan, contados como los cuenta la tarjeta. */
export function contarPlan(plan: CoursePlan): { secciones: number; lecciones: number; ejercicios: number } {
  let lecciones = 0;
  let ejercicios = 0;

  for (const seccion of plan.sections ?? []) {
    for (const item of seccion.items ?? []) {
      if (item.type === 'lesson') lecciones += 1;
      // Una lección con ejercicio suma un ejercicio: se construye como un ítem más.
      if (item.type === 'exercise' || item.hasExercise) ejercicios += 1;
    }
  }

  return { secciones: plan.sections?.length ?? 0, lecciones, ejercicios };
}

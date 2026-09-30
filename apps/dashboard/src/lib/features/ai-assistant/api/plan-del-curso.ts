import { classroomio } from '$lib/utils/services/api';
import { estadoDelPlan, type EstadoDelPlan } from '../utils/aprobacion';
import { claveDeConversacionActiva, planDelCurso } from '../utils/plan-del-curso.svelte';
import type { AiAssistantMessage } from '../utils/types';

function conversacionRecordada(courseId: string): string | null {
  try {
    return localStorage.getItem(claveDeConversacionActiva(courseId));
  } catch {
    return null;
  }
}

/**
 * En qué anda el plan del chat del curso.
 *
 * Si el chat está (o estuvo) abierto en esta visita, lo sabe él y lo publicó.
 * Si no, se lee la conversación que el panel abriría —la última que tuvo
 * abierta, o la más reciente— tal como está guardada. Nunca falla: sin poder
 * saberlo, no hay aviso.
 */
export async function leerEstadoDelPlanDelCurso(courseId: string): Promise<EstadoDelPlan> {
  const publicado = planDelCurso.de(courseId);

  if (publicado !== undefined) return publicado;

  try {
    let conversationId = conversacionRecordada(courseId);

    if (!conversationId) {
      const lista = await classroomio.agent.history.$get({ query: { courseId } });
      const listado = (await lista.json()) as { success?: boolean; data?: Array<{ id: string }> };

      conversationId = listado.success ? (listado.data?.[0]?.id ?? null) : null;
    }

    if (!conversationId) return null;

    const respuesta = await classroomio.agent.history[':conversationId'].$get({ param: { conversationId } });
    const conversacion = (await respuesta.json()) as { success?: boolean; data?: { messages?: unknown[] } };

    if (!conversacion.success) return null;

    return estadoDelPlan((conversacion.data?.messages ?? []) as AiAssistantMessage[]);
  } catch {
    return null;
  }
}

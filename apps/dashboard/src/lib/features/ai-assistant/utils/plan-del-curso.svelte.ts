import type { EstadoDelPlan } from './aprobacion';

/**
 * En qué anda el plan del chat del curso, para quien no es el chat.
 *
 * ── Para qué ─────────────────────────────────────────────────────────────────
 *
 * Una fuente agregada después de armar el plan queda afuera de la construcción:
 * cada lección del plan ya dice de qué fuentes sale, y el escritor sólo recibe
 * esas. Medido: la docente agregó una planilla mientras el plan esperaba su
 * aprobación, aprobó dos minutos después, y la construcción arrancó sin
 * mencionarla. Nada le avisó.
 *
 * La pantalla de Fuentes tiene que poder avisarlo, y el que sabe si hay plan es
 * el chat. El chat lo publica acá cada vez que cambia; si el panel nunca se abrió
 * en esta visita, Fuentes lo pregunta al servidor (ver `api/plan-del-curso.ts`).
 */
class PlanDelCurso {
  /** El curso del que habla `estado`: fuera de ese curso, esto no dice nada. */
  cursoId = $state<string | null>(null);
  estado = $state<EstadoDelPlan>(null);

  sincronizar(cursoId: string | null, estado: EstadoDelPlan) {
    this.cursoId = cursoId;
    this.estado = estado;
  }

  /** Lo que se sabe de este curso, o `undefined` si el chat no lo publicó. */
  de(cursoId: string): EstadoDelPlan | undefined {
    return this.cursoId === cursoId ? this.estado : undefined;
  }
}

export const planDelCurso = new PlanDelCurso();

/** La clave con que el panel recuerda qué conversación del curso tenía abierta. */
export function claveDeConversacionActiva(courseId: string): string {
  return `ai-chat-active-${courseId}`;
}

/** Un plan que todavía se va a construir, o que se está construyendo. */
export function planSinTerminar(estado: EstadoDelPlan | undefined): boolean {
  return estado === 'pendiente' || estado === 'construyendo';
}

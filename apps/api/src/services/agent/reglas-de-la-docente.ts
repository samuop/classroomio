import { guardarReglasDelCurso, reglasDelCurso, type ReglaDelCurso } from '@cio/db/queries/agent';

/**
 * Las reglas y correcciones de la docente que valen para ESTA ronda.
 *
 * Salen del curso, no de la conversación (ver `reglas-del-curso.ts` en
 * `@cio/db`): un chat nuevo sobre el mismo curso las recibe igual. Las del plan
 * aprobado se copian al curso la primera vez que se las ve.
 */
export interface ReglasVigentes {
  /** Todas las vigentes, de la más vieja a la más nueva. */
  todas: ReglaDelCurso[];
  /** Cómo se escribe el curso. */
  reglas: string[];
  /** Datos que ganan sobre lo que digan las fuentes. */
  correcciones: string[];
}

export function separarReglas(todas: readonly ReglaDelCurso[]): ReglasVigentes {
  return {
    todas: [...todas],
    reglas: todas.filter((regla) => regla.kind === 'rule').map((regla) => regla.rule),
    correcciones: todas.filter((regla) => regla.kind === 'correction').map((regla) => regla.rule)
  };
}

/**
 * Lee las reglas del curso, copiando antes las del plan aprobado que falten.
 *
 * Si la base falla, la ronda sigue con las del plan, que es lo que había antes:
 * perder la memoria del curso por un rato es mejor que no poder usar el chat.
 */
export async function reglasVigentesDelCurso(params: {
  courseId: string;
  delPlan: readonly string[];
  userId?: string | null;
  conversationId?: string | null;
}): Promise<ReglasVigentes> {
  try {
    if (params.delPlan.length > 0) {
      await guardarReglasDelCurso({
        courseId: params.courseId,
        reglas: params.delPlan.map((rule) => ({ kind: 'rule' as const, rule })),
        createdBy: params.userId ?? null,
        conversationId: params.conversationId ?? null
      });
    }

    return separarReglas(await reglasDelCurso(params.courseId));
  } catch (error) {
    console.error('[agent.chat] no se pudieron leer las reglas del curso; sigue con las del plan:', error);

    return { todas: [], reglas: [...params.delPlan], correcciones: [] };
  }
}

/** El id corto con el que el asistente nombra una regla para retirarla. */
export const idCorto = (id: string): string => id.slice(0, 8);

/**
 * Las reglas como las ve el asistente: con su id, para poder retirar una.
 * A los escritores les llegan sin id (`ReglasVigentes.reglas`).
 */
export function reglasConId(vigentes: ReglasVigentes, clase: ReglaDelCurso['kind']): string[] {
  return vigentes.todas.filter((regla) => regla.kind === clase).map((regla) => `${regla.rule} [id ${idCorto(regla.id)}]`);
}

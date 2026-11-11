import { and, asc, eq, isNull } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';

/**
 * Las reglas y correcciones que la docente dictó para un curso.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Medido el 2026-11-11, dos veces de dos en cada caso:
 *
 * - Una regla de estilo dictada al armar el curso («decí "vecino"») se perdía
 *   en cuanto la docente abría otro chat: las reglas se leían del plan aprobado
 *   de ESA conversación, y una nueva no tiene plan.
 * - Una regla dicha después del plan no se guardaba en ningún lado, y el
 *   asistente contestaba «Regla registrada».
 * - Una corrección de un dato («ya no son 48 horas, son siete días») vivía sólo
 *   en el texto de la lección corregida: una lección nueva volvía a la fuente.
 *
 * Acá viven por curso. Las del plan aprobado se copian al aprobarlo; las demás
 * las agrega el asistente con `remember_teacher_rule`, citando a la docente.
 */

export type ClaseDeRegla = 'rule' | 'correction';

export interface ReglaDelCurso {
  id: string;
  kind: ClaseDeRegla;
  rule: string;
  teacherWords: string | null;
  createdAt: string;
}

/** Para comparar dos reglas sin que una mayúscula o un punto final las haga distintas. */
export function reglaNormalizada(regla: string): string {
  return regla
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Las reglas vigentes de un curso, de la más vieja a la más nueva: la última gana. */
export async function reglasDelCurso(courseId: string): Promise<ReglaDelCurso[]> {
  const filas = await db
    .select({
      id: schema.aiCourseTeacherRule.id,
      kind: schema.aiCourseTeacherRule.kind,
      rule: schema.aiCourseTeacherRule.rule,
      teacherWords: schema.aiCourseTeacherRule.teacherWords,
      createdAt: schema.aiCourseTeacherRule.createdAt
    })
    .from(schema.aiCourseTeacherRule)
    .where(and(eq(schema.aiCourseTeacherRule.courseId, courseId), isNull(schema.aiCourseTeacherRule.retiredAt)))
    .orderBy(asc(schema.aiCourseTeacherRule.createdAt));

  return filas.map((fila) => ({ ...fila, kind: fila.kind === 'correction' ? 'correction' : 'rule' }));
}

/**
 * Agrega las reglas que todavía no estén (comparadas sin mayúsculas ni signos).
 * Devuelve las que quedaron guardadas ahora.
 *
 * Una regla que la docente RETIRÓ cuenta como que está: el plan aprobado sigue
 * trayendo sus reglas en cada ronda, y sin esto la retirada volvía sola.
 */
export async function guardarReglasDelCurso(params: {
  courseId: string;
  reglas: ReadonlyArray<{ kind: ClaseDeRegla; rule: string; teacherWords?: string | null }>;
  createdBy?: string | null;
  conversationId?: string | null;
}): Promise<ReglaDelCurso[]> {
  const limpias = params.reglas
    .map((regla) => ({ ...regla, rule: regla.rule.trim() }))
    .filter((regla) => regla.rule.length > 0);

  if (limpias.length === 0) return [];

  const todas = await db
    .select({ rule: schema.aiCourseTeacherRule.rule })
    .from(schema.aiCourseTeacherRule)
    .where(eq(schema.aiCourseTeacherRule.courseId, params.courseId));
  const yaEstan = new Set(todas.map((regla) => reglaNormalizada(regla.rule)));
  const nuevas = limpias.filter((regla) => {
    const clave = reglaNormalizada(regla.rule);

    if (yaEstan.has(clave)) return false;

    yaEstan.add(clave);

    return true;
  });

  if (nuevas.length === 0) return [];

  const guardadas = await db
    .insert(schema.aiCourseTeacherRule)
    .values(
      nuevas.map((regla) => ({
        courseId: params.courseId,
        kind: regla.kind,
        rule: regla.rule,
        teacherWords: regla.teacherWords ?? null,
        createdBy: params.createdBy ?? null,
        conversationId: params.conversationId ?? null
      }))
    )
    .returning({
      id: schema.aiCourseTeacherRule.id,
      kind: schema.aiCourseTeacherRule.kind,
      rule: schema.aiCourseTeacherRule.rule,
      teacherWords: schema.aiCourseTeacherRule.teacherWords,
      createdAt: schema.aiCourseTeacherRule.createdAt
    });

  return guardadas.map((fila) => ({ ...fila, kind: fila.kind === 'correction' ? 'correction' : 'rule' }));
}

/** Retira una regla del curso. Devuelve si había una vigente con ese id. */
export async function retirarReglaDelCurso(courseId: string, id: string): Promise<boolean> {
  const retiradas = await db
    .update(schema.aiCourseTeacherRule)
    .set({ retiredAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.aiCourseTeacherRule.id, id),
        eq(schema.aiCourseTeacherRule.courseId, courseId),
        isNull(schema.aiCourseTeacherRule.retiredAt)
      )
    )
    .returning({ id: schema.aiCourseTeacherRule.id });

  return retiradas.length > 0;
}

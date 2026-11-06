/**
 * Las preguntas cuyo fundamento ya no está en ninguna lección del curso.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Medido en producción (2026-11): una docente actualizó lecciones (el criterio
 * de un control cambió) y los cuestionarios siguieron preguntando por el
 * criterio viejo. Nada avisaba: cambiar una lección, con el asistente o a mano,
 * no dice nada sobre las preguntas que dependen de ella. Al revisarlo, cinco de
 * las seis preguntas viejas aparecieron con un solo cruce: la frase de la
 * lección en la que se basaba cada una ya no estaba en ninguna lección.
 *
 * Esa frase existe desde 2026-09: el escritor de preguntas la tiene que dar y
 * el servidor la verifica al crear (`evidencia-de-preguntas.ts`), y se guarda
 * en `settings.evidence`. Esto la vuelve a buscar DESPUÉS: si desapareció, la
 * pregunta queda «a revisar».
 *
 * ── Calculado, no guardado ───────────────────────────────────────────────────
 *
 * No se marca nada en la base. Se mide cada vez contra las lecciones de ahora,
 * así que cubre también lo que se cambió a mano en el editor, sin enganchar
 * nada en cada forma de guardar una lección, y una pregunta deja de estar a
 * revisar apenas se corrige ella o vuelve la frase.
 *
 * Una pregunta sin evidencia (anterior a 2026-09, o escrita a mano) no se
 * puede juzgar y no se marca.
 */
import type { TLocale } from '@cio/db/types';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { getExercisesByCourseId, getQuestionsByExerciseIds } from '@cio/db/queries/exercise/exercise';

import { textoDeLeccion } from '@api/services/agent/grounding';
import { esEvidenciaBuscable, verificarEvidencias } from '@api/services/agent/evidencia-de-preguntas';

/** Las herramientas que cambian el texto de una lección: tras una de éstas se vuelve a medir. */
export const HERRAMIENTAS_QUE_CAMBIAN_LECCIONES: ReadonlySet<string> = new Set([
  'write_lesson',
  'update_lesson_content',
  'replace_lesson_block',
  'edit_lesson_content',
  'delete_lesson'
]);

export interface PreguntaARevisar {
  exerciseId: string;
  exerciseTitle: string;
  questionId: string;
  questionTitle: string;
  evidence: string;
}

interface PreguntaGuardada {
  id?: string | number | null;
  title?: string | null;
  exerciseId?: string | null;
  settings?: unknown;
}

function evidenciaDe(settings: unknown): string | undefined {
  const evidence = (settings as { evidence?: unknown } | null | undefined)?.evidence;

  return typeof evidence === 'string' && evidence.trim() ? evidence.trim() : undefined;
}

/**
 * La decisión, sin base: qué preguntas tienen una evidencia que se puede buscar
 * y no aparece en ningún texto de lección.
 *
 * Sin ningún texto de lección no se juzga nada: es un curso en otro idioma o
 * todavía vacío, y marcarlo todo sería ruido.
 */
export function preguntasSinFundamento(params: {
  ejercicios: ReadonlyArray<{ id: string; title?: string | null }>;
  preguntas: readonly PreguntaGuardada[];
  textosDeLecciones: readonly string[];
}): PreguntaARevisar[] {
  const textos = params.textosDeLecciones.filter((texto) => texto.trim().length > 0);

  if (textos.length === 0) return [];

  const tituloDelEjercicio = new Map(params.ejercicios.map((ejercicio) => [ejercicio.id, ejercicio.title ?? '']));
  const juzgables = params.preguntas.flatMap((pregunta) => {
    const evidence = evidenciaDe(pregunta.settings);

    return evidence && esEvidenciaBuscable(evidence) && pregunta.exerciseId
      ? [{ pregunta, exerciseId: pregunta.exerciseId, evidence }]
      : [];
  });

  // Los textos se normalizan una vez para todas las preguntas: un curso de
  // cien preguntas y cincuenta lecciones haría cinco mil pasadas.
  const { rechazadas } = verificarEvidencias(
    juzgables.map(({ pregunta, evidence }) => ({ question: pregunta.title ?? '', evidence })),
    textos
  );

  return rechazadas.map(({ indice }) => {
    const { pregunta, exerciseId, evidence } = juzgables[indice];

    return {
      exerciseId,
      exerciseTitle: tituloDelEjercicio.get(exerciseId) ?? '',
      questionId: String(pregunta.id ?? ''),
      questionTitle: (pregunta.title ?? '').trim(),
      evidence
    };
  });
}

/** Las preguntas a revisar de un curso, contra sus lecciones en ese idioma. */
export async function preguntasARevisarDelCurso(courseId: string, locale: string): Promise<PreguntaARevisar[]> {
  const ejercicios = await getExercisesByCourseId(courseId);

  if (ejercicios.length === 0) return [];

  const [preguntas, lecciones] = await Promise.all([
    getQuestionsByExerciseIds(ejercicios.map((ejercicio) => ejercicio.id)),
    getCourseLessonContents(courseId, locale as TLocale)
  ]);

  return preguntasSinFundamento({
    ejercicios,
    preguntas: preguntas as PreguntaGuardada[],
    textosDeLecciones: lecciones.map((leccion) => textoDeLeccion(leccion.content ?? ''))
  });
}

/** Una línea por pregunta, para lo que lee el modelo. */
export function lineaDePreguntaARevisar(pregunta: PreguntaARevisar): string {
  const evidencia = pregunta.evidence.length > 90 ? `${pregunta.evidence.slice(0, 89)}…` : pregunta.evidence;

  return `«${pregunta.exerciseTitle}»: «${pregunta.questionTitle}» — it was based on «${evidencia}»`;
}

/** El bloque del mensaje de contexto, o nada si no hay preguntas a revisar. */
export function avisoDePreguntasARevisar(preguntas: readonly PreguntaARevisar[], maximo = 20): string | undefined {
  if (preguntas.length === 0) return undefined;

  const mostradas = preguntas.slice(0, maximo);
  const resto = preguntas.length - mostradas.length;

  return [
    '## Questions to review',
    '',
    'Each of these questions was written from a lesson sentence that is no longer in any lesson: the lesson changed after the question was written, so its answer may now be wrong. When the teacher asks about the course, its quizzes or a lesson these come from, tell them. Change a question only if the teacher asks you to update questions; then rewrite it from what the lesson says NOW.',
    '',
    ...mostradas.map((pregunta) => `- ${lineaDePreguntaARevisar(pregunta)}`),
    ...(resto > 0 ? [`- (and ${resto} more)`] : [])
  ].join('\n');
}

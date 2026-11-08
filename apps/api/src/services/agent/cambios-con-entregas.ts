/**
 * Un cambio que toca las notas de alumnos que ya entregaron no lo hace el modelo
 * solo: lo propone, y lo aprueba la docente.
 *
 * ── Qué pasó (producción, 2026-11-07) ────────────────────────────────────────
 *
 * Un pedido de revisión terminó con doce preguntas nuevas en un examen final
 * que cincuenta alumnos ya habían rendido. Nadie las pidió. El máximo de una
 * entrega se calcula con las preguntas de HOY (Calificaciones, seguimiento,
 * reporte), así que las cincuenta notas pasaron de ~87 % a ~42 % sin que nadie
 * tocara una entrega. Ninguna herramienta miró si el ejercicio tenía entregas.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * Sobre un ejercicio con entregas, agregar, reescribir o borrar preguntas —o
 * borrar el ejercicio— no se escribe: se guarda como propuesta con el efecto
 * calculado por el servidor, y la docente lo ve en una tarjeta con «Aprobar» y
 * «Cancelar». Aprobado, lo aplica el servidor con lo guardado.
 *
 * ── Por qué no una bandera que el modelo pueda poner ─────────────────────────
 *
 * «Pasá `confirmed: true` si la docente lo pidió» lo decide el modelo, y es el
 * mismo modelo que agregó doce preguntas que nadie pidió. La decisión tiene que
 * ser un clic de ella. Tampoco se usa la aprobación de herramientas del SDK: su
 * respuesta viaja como un mensaje del asistente, y el servidor dueño de la
 * conversación sólo acepta mensajes de la docente (ver `historia-del-servidor.ts`).
 */
import { randomUUID } from 'node:crypto';

import { guardarPropuesta, type PropuestaGuardada } from '@cio/db/queries/agent';
import { getExerciseSectionsByExerciseId } from '@cio/db/queries/exercise';
import {
  createExerciseSectionService,
  deleteExerciseForCourseService,
  getExercise,
  updateExerciseService
} from '@api/services/exercise/exercise';
import { buildUpdatedQuestions, type QuestionPatch } from '@api/services/agent/question-update';

/** El efecto en las notas, en números: la tarjeta lo dice con palabras. */
export interface ImpactoEnLasNotas {
  tipo: 'agregar' | 'reescribir' | 'borrar';
  /** Cuántas entregas hay. */
  entregas: number;
  maximoAntes: number;
  /** En `borrar`, 0: el ejercicio y sus entregas desaparecen. */
  maximoDespues: number;
  /** El promedio de las entregas sobre el máximo de hoy, en %. */
  promedioAntes: number | null;
  /** El MISMO puntaje sobre el máximo nuevo: así lo van a ver Calificaciones y el reporte. */
  promedioDespues: number | null;
  agregadas?: { cantidad: number; puntos: number };
  /** Las reescrituras, antes → después (ver `resumen-de-preguntas.ts`). */
  cambios?: string[];
}

export function calcularImpacto(params: {
  tipo: ImpactoEnLasNotas['tipo'];
  entregas: { cantidad: number; promedio: number | null };
  maximoAntes: number;
  maximoDespues: number;
  agregadas?: ImpactoEnLasNotas['agregadas'];
  cambios?: string[];
}): ImpactoEnLasNotas {
  const porcentaje = (puntos: number | null, maximo: number) =>
    puntos === null || maximo <= 0 ? null : Math.round((puntos / maximo) * 100);

  return {
    tipo: params.tipo,
    entregas: params.entregas.cantidad,
    maximoAntes: params.maximoAntes,
    maximoDespues: params.maximoDespues,
    promedioAntes: porcentaje(params.entregas.promedio, params.maximoAntes),
    promedioDespues: params.tipo === 'borrar' ? null : porcentaje(params.entregas.promedio, params.maximoDespues),
    ...(params.agregadas ? { agregadas: params.agregadas } : {}),
    ...(params.cambios?.length ? { cambios: params.cambios } : {})
  };
}

/** Lo que se aplica si ella aprueba. Lo arma la herramienta; lo lee `aplicarPropuesta`. */
export type CuerpoDePropuesta =
  | {
      tipo: 'agregar';
      /** Las preguntas como las manda `updateExerciseService`, sin `order`: se calcula al aplicar. */
      preguntas: Array<Record<string, unknown>>;
      /** El bloque al que van, si ya existe. */
      exerciseSectionId?: string;
      /** O el bloque nuevo que hay que crear para ellas (`write_questions` con `blockTitle`). */
      bloqueNuevo?: string;
    }
  | { tipo: 'reescribir'; parches: QuestionPatch[] }
  | { tipo: 'borrar' };

/** Una línea para el resumen de la ronda y la auditoría. */
export function resumenDelImpacto(impacto: ImpactoEnLasNotas): string {
  const efecto =
    impacto.tipo === 'borrar'
      ? `se borrarían ${impacto.entregas} entregas con sus notas`
      : impacto.maximoAntes !== impacto.maximoDespues
        ? `${impacto.entregas} entregas: el máximo pasaría de ${impacto.maximoAntes} a ${impacto.maximoDespues}` +
          (impacto.promedioAntes !== null && impacto.promedioDespues !== null
            ? ` y el promedio de ${impacto.promedioAntes} % a ${impacto.promedioDespues} %`
            : '')
        : `${impacto.entregas} entregas ya rendidas`;
  const que = impacto.agregadas
    ? `${impacto.agregadas.cantidad} ${impacto.agregadas.cantidad === 1 ? 'pregunta nueva' : 'preguntas nuevas'} ` +
      `(${impacto.agregadas.puntos} ${impacto.agregadas.puntos === 1 ? 'punto' : 'puntos'})`
    : impacto.tipo === 'borrar'
      ? 'borrar el ejercicio'
      : `${impacto.cambios?.length ?? 0} ${impacto.cambios?.length === 1 ? 'pregunta reescrita' : 'preguntas reescritas'}`;

  return `${que}; ${efecto}`;
}

/** Guarda la propuesta y devuelve lo que la herramienta le contesta al modelo. */
export async function proponerCambioConEntregas(params: {
  alcance: { orgId: string; courseId: string; conversationId?: string | null; userId: string };
  herramienta: string;
  exerciseId: string;
  exerciseTitle: string;
  cuerpo: CuerpoDePropuesta;
  impacto: ImpactoEnLasNotas;
}): Promise<Record<string, unknown>> {
  const id = randomUUID();

  await guardarPropuesta({
    ...params.alcance,
    id,
    herramienta: params.herramienta,
    exerciseId: params.exerciseId,
    exerciseTitle: params.exerciseTitle,
    cuerpo: params.cuerpo as unknown as Record<string, unknown>,
    impacto: params.impacto as unknown as Record<string, unknown>
  });

  return {
    status: 'needs_teacher_approval',
    proposalId: id,
    exerciseId: params.exerciseId,
    exerciseTitle: params.exerciseTitle,
    impact: params.impacto,
    note:
      `NOTHING WAS SAVED. ${params.impacto.entregas} students already submitted this exercise, so this change would move their grades ` +
      `(${resumenDelImpacto(params.impacto)}). The teacher now sees a card with the exact effect and approves or cancels it there. ` +
      'Tell her in one or two sentences what you propose and why. Do not retry this change, do not save it another way, and do not say it is done.'
  };
}

const COMO_QUEDO: Record<PropuestaGuardada['estado'], string> = {
  pendiente: 'WAITING for her decision — do not repeat it or save it another way; she decides from the card',
  aplicada: 'APPROVED by her and APPLIED by the server — it is done: do not apply it again',
  cancelada: 'CANCELLED by her — do not make this change',
  fallida: 'approved by her but the server could NOT apply it — tell her, do not retry on your own'
};

/**
 * Lo que la ronda tiene que saber de sus propuestas: cuáles esperan y cómo
 * resolvió la docente las demás desde la última ronda. Sin esto, el modelo no
 * sabe que su cambio se aplicó y lo propone de nuevo, o lo cuenta como hecho
 * cuando ella lo canceló.
 */
export function avisoDePropuestas(propuestas: ReadonlyArray<PropuestaGuardada>): string {
  if (propuestas.length === 0) return '';

  const lineas = propuestas.map(
    (propuesta) =>
      `- ${propuesta.herramienta} on «${propuesta.exerciseTitle}» (${resumenDelImpacto(propuesta.impacto as unknown as ImpactoEnLasNotas)}): ${COMO_QUEDO[propuesta.estado]}` +
      (propuesta.error ? ` (${propuesta.error})` : '')
  );

  return `## Changes to graded exercises you proposed\n\nThese touched exercises students already submitted, so they wait for the teacher's approval on a card:\n${lineas.join('\n')}`;
}

/** Las preguntas de un ejercicio como las quiere `buildUpdatedQuestions`. */
function preguntasParaParchar(ejercicio: Awaited<ReturnType<typeof getExercise>>) {
  return (ejercicio.questions || []).map((q) => ({
    id: q.id,
    title: q.title,
    questionTypeId: q.questionTypeId,
    points: q.points,
    order: q.order,
    exerciseSectionId: q.exerciseSectionId,
    settings: q.settings,
    options: q.options
  }));
}

/**
 * Aplica lo aprobado, contra el ejercicio como está AHORA: el orden de las
 * preguntas nuevas y los parches se calculan al aplicar, no al proponer, por si
 * el ejercicio cambió en el medio.
 */
export async function aplicarPropuesta(propuesta: PropuestaGuardada): Promise<void> {
  const cuerpo = propuesta.cuerpo as unknown as CuerpoDePropuesta;
  const exerciseId = propuesta.exerciseId;

  if (cuerpo.tipo === 'borrar') {
    await deleteExerciseForCourseService(propuesta.courseId, exerciseId);
    return;
  }

  const actual = await getExercise(exerciseId);

  if (cuerpo.tipo === 'reescribir') {
    const merged = buildUpdatedQuestions(
      preguntasParaParchar(actual) as Parameters<typeof buildUpdatedQuestions>[0],
      cuerpo.parches,
      exerciseId
    );

    await updateExerciseService(exerciseId, { questions: merged });
    return;
  }

  let exerciseSectionId = cuerpo.exerciseSectionId;

  if (cuerpo.bloqueNuevo) {
    const bloques = await getExerciseSectionsByExerciseId(exerciseId);
    const bloque = await createExerciseSectionService(exerciseId, { title: cuerpo.bloqueNuevo, order: bloques.length });

    exerciseSectionId = bloque.id;
  }

  const desde = (actual.questions || []).length;

  await updateExerciseService(exerciseId, {
    questions: cuerpo.preguntas.map((pregunta, i) => ({
      ...pregunta,
      order: desde + i,
      ...(exerciseSectionId ? { exerciseSectionId } : {})
    })) as Parameters<typeof updateExerciseService>[1]['questions']
  });
}

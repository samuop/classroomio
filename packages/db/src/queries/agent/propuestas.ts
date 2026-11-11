import { and, avg, count, desc, eq, inArray } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import { CHAT_RUN_PHASE, ensureChatRun } from './chat-run';

/**
 * Un cambio del asistente que toca notas, esperando que la docente lo apruebe.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * En producción (2026-11-07) el asistente agregó doce preguntas a un examen que
 * cincuenta alumnos ya habían rendido. Nadie lo pidió, y como el máximo de cada
 * entrega se calcula con las preguntas de HOY, las cincuenta notas se vinieron
 * abajo en Calificaciones sin que nadie tocara una entrega. Las herramientas que
 * escriben preguntas no miraban si el ejercicio tenía entregas.
 *
 * Ahora, sobre un ejercicio con entregas, la herramienta no escribe: deja acá lo
 * que habría escrito, con el efecto calculado por el servidor, y la docente lo
 * aprueba o lo cancela desde una tarjeta. Aplicarlo lo hace el servidor con lo
 * guardado, no el modelo.
 *
 * Vive en el run de la conversación como otro tipo de paso (`propuesta`): sin
 * cambio de esquema, y el registro del plan no lo ve. El `stepKey` es un uuid:
 * la tarjeta lo resuelve sin saber de qué conversación es.
 */
const PROPUESTA_STEP_TYPE = 'propuesta';

export type EstadoDePropuesta = 'pendiente' | 'aplicada' | 'cancelada' | 'fallida';

const ESTADO_POR_STATUS: Record<string, EstadoDePropuesta> = {
  queued: 'pendiente',
  completed: 'aplicada',
  canceled: 'cancelada',
  failed: 'fallida'
};

export interface PropuestaGuardada {
  id: string;
  estado: EstadoDePropuesta;
  herramienta: string;
  exerciseId: string;
  exerciseTitle: string;
  /** Lo que se aplica si la docente aprueba. Lo arma y lo lee la herramienta. */
  cuerpo: Record<string, unknown>;
  /** El efecto en las notas, calculado por el servidor al proponer. */
  impacto: Record<string, unknown>;
  courseId: string;
  conversationId: string | null;
  creadaEn: string;
  resueltaEn?: string;
  error?: string;
  /** Si la ronda siguiente ya se enteró de cómo se resolvió. */
  informada?: boolean;
}

type InputDePropuesta = {
  herramienta: string;
  exerciseId: string;
  exerciseTitle: string;
  cuerpo: Record<string, unknown>;
  impacto: Record<string, unknown>;
};

type OutputDePropuesta = { resueltaEn?: string; error?: string; informada?: boolean };

type RunScope = { orgId: string; courseId: string; conversationId?: string | null; userId: string };

function aPropuesta(
  fila: typeof schema.aiAgentRunStep.$inferSelect,
  run: { courseId: string | null; conversationId: string | null }
): PropuestaGuardada {
  const input = (fila.input ?? {}) as InputDePropuesta;
  const output = (fila.output ?? {}) as OutputDePropuesta;

  return {
    id: fila.stepKey,
    estado: ESTADO_POR_STATUS[fila.status] ?? 'pendiente',
    herramienta: input.herramienta,
    exerciseId: input.exerciseId,
    exerciseTitle: input.exerciseTitle,
    cuerpo: input.cuerpo ?? {},
    impacto: input.impacto ?? {},
    courseId: run.courseId ?? '',
    conversationId: run.conversationId,
    creadaEn: fila.createdAt,
    ...(output.resueltaEn ? { resueltaEn: output.resueltaEn } : {}),
    ...(output.error ? { error: output.error } : {}),
    ...(output.informada ? { informada: true } : {})
  };
}

export async function guardarPropuesta(params: RunScope & { id: string } & InputDePropuesta): Promise<void> {
  const run = await ensureChatRun(params);
  const input: InputDePropuesta = {
    herramienta: params.herramienta,
    exerciseId: params.exerciseId,
    exerciseTitle: params.exerciseTitle,
    cuerpo: params.cuerpo,
    impacto: params.impacto
  };

  await db.insert(schema.aiAgentRunStep).values({
    runId: run.id,
    stepKey: params.id,
    stepType: PROPUESTA_STEP_TYPE,
    status: 'queued',
    input
  });
}

/**
 * Una propuesta de ESTA docente en ESTE curso. Otra docente, u otro curso, no la
 * encuentran: la tarjeta vive en la conversación de quien la pidió.
 */
export async function leerPropuesta(params: {
  id: string;
  userId: string;
  courseId: string;
}): Promise<PropuestaGuardada | null> {
  const [fila] = await db
    .select({ paso: schema.aiAgentRunStep, run: schema.aiAgentRun })
    .from(schema.aiAgentRunStep)
    .innerJoin(schema.aiAgentRun, eq(schema.aiAgentRun.id, schema.aiAgentRunStep.runId))
    .where(
      and(
        eq(schema.aiAgentRunStep.stepKey, params.id),
        eq(schema.aiAgentRunStep.stepType, PROPUESTA_STEP_TYPE),
        eq(schema.aiAgentRun.userId, params.userId),
        eq(schema.aiAgentRun.courseId, params.courseId),
        eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
      )
    )
    .limit(1);

  return fila ? aPropuesta(fila.paso, fila.run) : null;
}

/**
 * La pasa de pendiente a resuelta, UNA vez. Devuelve `false` si ya no estaba
 * pendiente: dos clics, o dos pestañas, no aplican el cambio dos veces.
 */
export async function tomarPropuesta(params: {
  id: string;
  userId: string;
  courseId: string;
  estado: 'aplicada' | 'cancelada';
}): Promise<boolean> {
  const propia = await leerPropuesta(params);

  if (!propia || propia.estado !== 'pendiente') return false;

  const now = new Date().toISOString();
  const tomadas = await db
    .update(schema.aiAgentRunStep)
    .set({
      status: params.estado === 'aplicada' ? 'completed' : 'canceled',
      output: { resueltaEn: now },
      finishedAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(schema.aiAgentRunStep.stepKey, params.id),
        eq(schema.aiAgentRunStep.stepType, PROPUESTA_STEP_TYPE),
        eq(schema.aiAgentRunStep.status, 'queued')
      )
    )
    .returning({ id: schema.aiAgentRunStep.id });

  return tomadas.length > 0;
}

/** Aprobada pero no se pudo aplicar: queda dicho, con el error. */
export async function marcarPropuestaFallida(params: { id: string; error: string }): Promise<void> {
  const now = new Date().toISOString();

  await db
    .update(schema.aiAgentRunStep)
    .set({ status: 'failed', output: { resueltaEn: now, error: params.error.slice(0, 500) }, updatedAt: now })
    .where(and(eq(schema.aiAgentRunStep.stepKey, params.id), eq(schema.aiAgentRunStep.stepType, PROPUESTA_STEP_TYPE)));
}

/**
 * Las de esta conversación que la docente resolvió y la ronda todavía no sabe.
 * También las pendientes: el modelo tiene que saber que esperan, para no
 * volver a proponerlas.
 */
export async function propuestasParaLaRonda(params: RunScope): Promise<PropuestaGuardada[]> {
  if (!params.conversationId) return [];

  const filas = await db
    .select({ paso: schema.aiAgentRunStep, run: schema.aiAgentRun })
    .from(schema.aiAgentRunStep)
    .innerJoin(schema.aiAgentRun, eq(schema.aiAgentRun.id, schema.aiAgentRunStep.runId))
    .where(
      and(
        eq(schema.aiAgentRunStep.stepType, PROPUESTA_STEP_TYPE),
        eq(schema.aiAgentRun.conversationId, params.conversationId),
        eq(schema.aiAgentRun.userId, params.userId),
        eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
      )
    )
    .orderBy(desc(schema.aiAgentRunStep.createdAt))
    .limit(20);

  return filas.map((fila) => aPropuesta(fila.paso, fila.run)).filter((p) => p.estado === 'pendiente' || !p.informada);
}

/** La ronda ya se enteró de cómo se resolvieron. */
export async function marcarPropuestasInformadas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const filas = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(and(eq(schema.aiAgentRunStep.stepType, PROPUESTA_STEP_TYPE), inArray(schema.aiAgentRunStep.stepKey, ids)));

  for (const fila of filas) {
    if (fila.status === 'queued') continue;

    await db
      .update(schema.aiAgentRunStep)
      .set({ output: { ...((fila.output ?? {}) as OutputDePropuesta), informada: true } })
      .where(eq(schema.aiAgentRunStep.id, fila.id));
  }
}

/**
 * Lo que se va con una lección si se la borra: los ejercicios adjuntos que ya
 * tienen entregas, y cuántos alumnos la habían completado.
 *
 * Las claves foráneas borran en cascada (`exercise.lesson_id`,
 * `submission.exercise_id`, `lesson_completion.lesson_id`), así que borrar la
 * lección destruye las entregas calificadas de un ejercicio adjunto sin pasar
 * por ninguna aprobación. Medido el 2026-11-11: una entrega con su nota se fue
 * con un «borrá la lección», y la respuesta ofrecía revisar el cuestionario que
 * ya no existía.
 */
export async function loQueSeVaConLaLeccion(lessonId: string): Promise<{
  ejerciciosConEntregas: Array<{ id: string; title: string | null; entregas: number }>;
  alumnosQueLaCompletaron: number;
}> {
  const [ejercicios, [completadas]] = await Promise.all([
    db
      .select({ id: schema.exercise.id, title: schema.exercise.title, entregas: count(schema.submission.id) })
      .from(schema.exercise)
      .innerJoin(schema.submission, eq(schema.submission.exerciseId, schema.exercise.id))
      .where(eq(schema.exercise.lessonId, lessonId))
      .groupBy(schema.exercise.id, schema.exercise.title),
    db
      .select({ cantidad: count() })
      .from(schema.lessonCompletion)
      .where(and(eq(schema.lessonCompletion.lessonId, lessonId), eq(schema.lessonCompletion.isComplete, true)))
  ]);

  return {
    ejerciciosConEntregas: ejercicios.map((e) => ({ id: e.id, title: e.title, entregas: Number(e.entregas) })),
    alumnosQueLaCompletaron: Number(completadas?.cantidad ?? 0)
  };
}

/** Cuántos alumnos entregaron este ejercicio y con qué nota promedio. */
export async function entregasDelEjercicio(exerciseId: string): Promise<{ cantidad: number; promedio: number | null }> {
  const [fila] = await db
    .select({ cantidad: count(), promedio: avg(schema.submission.total) })
    .from(schema.submission)
    .where(eq(schema.submission.exerciseId, exerciseId));

  return {
    cantidad: Number(fila?.cantidad ?? 0),
    promedio: fila?.promedio === null || fila?.promedio === undefined ? null : Number(fila.promedio)
  };
}

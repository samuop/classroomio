import { and, asc, eq } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import { ensureChatRun } from './chat-run';

/**
 * El análisis de una fuente nueva contra el curso, guardado por conversación.
 *
 * ── Por qué se guarda ────────────────────────────────────────────────────────
 *
 * Comparar un documento nuevo con todas las lecciones del curso cuesta una
 * llamada a un modelo con las lecciones enteras adentro. El resultado —qué dato
 * viejo pasa a ser cuál— lo usan DOS momentos distintos y separados por la
 * aprobación del docente: la herramienta que lo calcula, para proponer el plan
 * de cambios, y la sincronización del plan aprobado, que le cuelga a cada ítem
 * los reemplazos que le tocan. Entre esos dos momentos puede pasar media hora.
 *
 * Sin guardarlo, la sincronización tendría que volver a pagar el análisis, o
 * —peor— confiar en que el modelo repita en el plan los valores exactos que
 * había encontrado. El plan dice qué lección tocar; los valores los sabe el
 * servidor.
 *
 * Reusa la corrida de chat (`chat-run.ts`) y `ai_agent_run_step`, igual que el
 * registro del plan: una fila por fuente analizada, distinguida por `stepType`.
 */

/** stepType de estas filas, para no cruzarlas con las del registro del plan. */
const SOURCE_ANALYSIS_STEP_TYPE = 'source_analysis';

/** Un dato del curso que el documento nuevo cambia. */
export interface CambioDeFuente {
  /** El valor viejo tal como aparece en la lección. */
  valorViejo: string;
  /** El valor que trae el documento nuevo. */
  valorNuevo: string;
  /** Por qué el documento lo cambia — lo lee el docente en la pantalla del plan. */
  motivo: string;
  /**
   * La forma más corta y distintiva del valor viejo («4400»), que es la que
   * también aparece en las preguntas. La frase de la lección no las encuentra:
   * ver `cambios-de-fuente.ts` en la API.
   */
  clave?: string;
  /** Las palabras que tienen que estar cerca para que la clave cuente («P2»). */
  contexto?: string[];
}

export interface AnalisisDeFuente {
  sourceId: string;
  fileName: string;
  cambios: CambioDeFuente[];
}

type RunScope = {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
};

const claveDe = (sourceId: string) => `analysis:${sourceId}`;

/** Guarda (o pisa) el análisis de una fuente. Best-effort: quien llama tolera el fallo. */
export async function guardarAnalisisDeFuente(params: RunScope & AnalisisDeFuente): Promise<void> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  const input = {
    sourceId: params.sourceId,
    fileName: params.fileName,
    cambios: params.cambios
  };

  await db
    .insert(schema.aiAgentRunStep)
    .values({
      runId: run.id,
      stepKey: claveDe(params.sourceId),
      stepType: SOURCE_ANALYSIS_STEP_TYPE,
      status: 'completed',
      input,
      finishedAt: now
    })
    .onConflictDoUpdate({
      target: [schema.aiAgentRunStep.runId, schema.aiAgentRunStep.stepKey],
      // Se pisa a propósito: si el docente vuelve a analizar la misma fuente es
      // porque algo cambió, y dos análisis de la misma fuente conviviendo
      // dejarían al plan colgado del más viejo.
      set: { status: 'completed', input, updatedAt: now }
    });
}

/**
 * Todo lo analizado en esta conversación, del más viejo al más nuevo.
 *
 * Nunca crea la corrida: leer un análisis que no existe es lo normal (la enorme
 * mayoría de los planes no salen de una fuente nueva) y no puede costar una
 * fila.
 */
export async function leerAnalisisDeFuente(params: RunScope): Promise<AnalisisDeFuente[]> {
  const whereConversation = params.conversationId
    ? and(
        eq(schema.aiAgentRun.conversationId, params.conversationId),
        eq(schema.aiAgentRun.userId, params.userId),
        eq(schema.aiAgentRun.phase, 'chat')
      )
    : and(
        eq(schema.aiAgentRun.courseId, params.courseId),
        eq(schema.aiAgentRun.userId, params.userId),
        eq(schema.aiAgentRun.phase, 'chat')
      );

  const [run] = await db
    .select({ id: schema.aiAgentRun.id })
    .from(schema.aiAgentRun)
    .where(whereConversation)
    .orderBy(asc(schema.aiAgentRun.createdAt))
    .limit(1);

  if (!run) return [];

  const steps = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(
      and(eq(schema.aiAgentRunStep.runId, run.id), eq(schema.aiAgentRunStep.stepType, SOURCE_ANALYSIS_STEP_TYPE))
    )
    .orderBy(asc(schema.aiAgentRunStep.createdAt));

  return steps.flatMap((step) => {
    const input = (step.input ?? {}) as Partial<AnalisisDeFuente>;

    if (!input.sourceId || !Array.isArray(input.cambios)) return [];

    return [{ sourceId: input.sourceId, fileName: input.fileName ?? '', cambios: input.cambios }];
  });
}

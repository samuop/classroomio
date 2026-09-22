import { generateObject } from 'ai';
import { z } from 'zod';
import {
  buildQuestionTypeListBlock,
  buildQuestionWriterPrompt,
  createModel,
  resolveModelName,
  type AIProviderConfig
} from '@cio/ai-assistant';
import { questionFields } from '@api/services/agent/agent-tool-schemas';
import { recordTokenUsage } from '@api/services/agent/usage';

/**
 * El escritor de preguntas: un sub-agente que escribe las preguntas de UN
 * ejercicio con el texto de las lecciones delante, y nada más.
 *
 * ── Qué arregla ──────────────────────────────────────────────────────────────
 *
 * Durante una construcción, el agente que arma el curso NO vio el texto de
 * ninguna lección: las escribe `write_lesson` con contexto limpio y a él le
 * vuelven unos cientos de caracteres. Escribía igual las preguntas, sobre lo que
 * suponía que cada lección decía. El control que había —«leíste estas lecciones
 * en esta ronda»— miraba el proceso: medido el 2026-09-21, 4 de 8 preguntas de
 * una autoevaluación no salían de la lección que evaluaban, con la lectura
 * hecha.
 *
 * Acá las escribe quien tiene el texto. Y cada pregunta vuelve con la frase que
 * evalúa, que el servidor busca en ese mismo texto antes de crear nada: ver
 * `evidencia-de-preguntas.ts`.
 *
 * ── Por qué el esquema no lleva la regla del tipo numérico ───────────────────
 *
 * `generateObject` valida el objeto entero: una refinación que falla no descarta
 * la pregunta mala, tira la llamada y se pierden las que estaban bien. El
 * esquema de salida son los campos (`questionFields`) y la regla la aplica quien
 * llama, pregunta por pregunta.
 */

/**
 * Tope de texto de lecciones que se le muestra.
 *
 * Más chico que el del escritor de lecciones (160.000) porque acá entran varias
 * lecciones ya escritas y no material crudo: un bloque del examen final son
 * tres o cuatro lecciones enteras. Lo que no entra se recorta con una marca que
 * se la dice, para que no pregunte sobre lo que no leyó.
 */
export const PRESUPUESTO_LECCIONES_CHARS = 120_000;

export interface LeccionParaPreguntar {
  title: string;
  text: string;
}

export interface PreguntaEscrita {
  question: string;
  questionTypeId: number;
  points: number;
  order: number;
  evidence: string;
  options: Array<{ label: string; isCorrect: boolean }>;
  settings?: Record<string, unknown>;
  /** Ver `camposDelEscritor`: la respuesta de una numérica, como campo plano. */
  numericAnswer?: number;
  numericTolerance?: number;
}

export type EscritorDePreguntas = (params: {
  exerciseTitle: string;
  brief?: string;
  count: number;
  lecciones: LeccionParaPreguntar[];
  locale: string;
}) => Promise<{ preguntas: PreguntaEscrita[]; nota?: string }>;

/**
 * Los campos que devuelve el escritor: los de siempre, más la respuesta de una
 * numérica como DOS campos planos.
 *
 * ── Por qué no alcanzaba con `settings` ─────────────────────────────────────
 *
 * `settings` es un mapa libre (`record(string, unknown)`), y un mapa libre no
 * es una instrucción: el proveedor no tiene nada que completar ahí, así que el
 * escritor devolvía la numérica sin `settings.correctValue` y el servidor la
 * descartaba al validarla. Medido el 2026-09-22 en dos construcciones
 * distintas: 5 preguntas numéricas escritas, 5 descartadas, todas con la
 * evidencia perfecta. El escritor no estaba equivocándose en lo difícil —
 * estaba dejando vacío un campo que el esquema no le pedía.
 *
 * Un campo declarado, con nombre y tipo, sí se completa. El servidor lo vuelca
 * a `settings.correctValue` antes de validar (ver `write_questions`), así que
 * la forma que llega a la base es la misma de siempre y nada más abajo cambia.
 */
export const camposDelEscritor = questionFields.extend({
  numericAnswer: z
    .number()
    .optional()
    .describe(
      'REQUIRED when questionTypeId is NUMERIC: the correct answer, as a number. A NUMERIC question without it is discarded and never reaches the course.'
    ),
  numericTolerance: z
    .number()
    .optional()
    .describe('Only for NUMERIC: how far from the answer still counts as correct. Leave out when the answer is exact.')
});

const Resultado = z.object({
  questions: z.array(camposDelEscritor).describe('The questions of this exercise, in the order a learner sees them.'),
  note: z
    .string()
    .optional()
    .describe('Optional, for the teacher: what the lessons did not let you cover. Leave out when there is nothing.')
});

/**
 * El texto de las lecciones dentro del presupuesto.
 *
 * Reparto parejo y no por orden de llegada, por el mismo motivo que
 * `armarMaterial` en `lesson-writer.ts`: una lección enorme primera se come el
 * lugar de las otras y deja al escritor preguntando sobre una sola.
 */
export function armarLecciones(
  lecciones: readonly LeccionParaPreguntar[],
  presupuesto = PRESUPUESTO_LECCIONES_CHARS
): { texto: string; recortadas: string[] } {
  if (lecciones.length === 0) return { texto: '', recortadas: [] };

  const cupos = new Array<number>(lecciones.length);
  let restante = presupuesto;

  lecciones
    .map((l, i) => ({ largo: l.text.length, i }))
    .sort((a, b) => a.largo - b.largo)
    .forEach(({ largo, i }, k, orden) => {
      const parte = Math.floor(restante / (orden.length - k));
      cupos[i] = Math.min(largo, parte);
      restante -= cupos[i];
    });

  const recortadas: string[] = [];

  const bloques = lecciones.map((l, i) => {
    if (cupos[i] >= l.text.length) return `--- Lesson: ${l.title} ---\n${l.text}`;

    recortadas.push(l.title);

    return (
      `--- Lesson: ${l.title} (only the first part — it did not fit) ---\n${l.text.slice(0, cupos[i])}\n` +
      `[… the rest of "${l.title}" was not shown to you. Do not write questions about what you have not read.]`
    );
  });

  return { texto: bloques.join('\n\n'), recortadas };
}

/**
 * Cuántas preguntas pedir cuando nadie lo dijo.
 *
 * La barra de calidad dice 6–10 «según cuánto tenga la lección», así que se
 * deriva del texto en vez de fijar un número: un ejercicio de diez preguntas
 * sobre una lección de dos párrafos sólo puede salir de inventar ocho.
 */
export function cuantasPreguntas(largoDelTexto: number): number {
  return Math.max(6, Math.min(10, Math.round(largoDelTexto / 1_800)));
}

export function crearEscritorDePreguntas(params: {
  orgId: string;
  userId: string;
  courseId: string;
  providerConfig: AIProviderConfig;
  isOrgOnPaidPlan: boolean;
}): EscritorDePreguntas {
  const modelName =
    process.env.AGENT_QUESTIONS_MODEL?.trim() ||
    params.providerConfig.model ||
    resolveModelName(params.providerConfig.provider);
  const model = createModel({ ...params.providerConfig, model: modelName });
  // La lista de tipos depende del plan de la organización y no de la llamada,
  // así que el prompt se arma una vez por ronda: es el mismo para todos los
  // ejercicios del curso y la caché del proveedor lo sirve desde el segundo.
  const system = buildQuestionWriterPrompt(buildQuestionTypeListBlock(params.isOrgOnPaidPlan));

  return async ({ exerciseTitle, brief, count, lecciones, locale }) => {
    const armado = armarLecciones(lecciones);
    const inicio = Date.now();

    const { object, usage } = await generateObject({
      model,
      schema: Resultado,
      system,
      prompt: [
        `## The lessons this exercise covers\n\n${armado.texto || '(no lesson text)'}`,
        `## This exercise\n\nTitle: ${exerciseTitle}\nWrite everything a learner reads in this language: ${locale}\nHow many questions: ${count}` +
          (brief ? `\n\nBrief:\n${brief}` : '')
      ].join('\n\n'),
      maxRetries: 1
    });

    await recordTokenUsage(
      params.orgId,
      params.userId,
      params.courseId,
      {
        promptTokens: usage.inputTokens ?? 0,
        completionTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens || undefined,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens || undefined
      },
      modelName,
      params.providerConfig.provider
    ).catch((error) => console.error('[question-writer] no se pudo registrar el consumo:', error));

    const preguntas = (object.questions ?? []) as PreguntaEscrita[];

    console.info(
      `[question-writer] "${exerciseTitle}": ${lecciones.length} lección(es), ${armado.texto.length} caracteres, ` +
        `${preguntas.length} pregunta(s) de ${count} pedidas, ${((Date.now() - inicio) / 1000).toFixed(1)} s` +
        (armado.recortadas.length ? `, recortadas: ${armado.recortadas.join(', ')}` : '')
    );

    return { preguntas, ...(object.note?.trim() ? { nota: object.note.trim() } : {}) };
  };
}

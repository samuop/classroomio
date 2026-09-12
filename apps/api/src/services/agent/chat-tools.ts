import { tool, type ToolSet } from 'ai';
import { CoursePlanSchema } from '@cio/ai-assistant';
import { AppError } from '@api/utils/errors';
import { trackAgentEvent, AgentEvent } from '@api/utils/tinybird';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getExerciseSectionsByExerciseId } from '@cio/db/queries/exercise';
import { bindPlanItem, resolvePlanBinding } from '@cio/db/queries/agent';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { semanticSearchDocument } from '@api/services/agent/embeddings';
import type { TCourseLandingPageUpdate } from '@cio/utils/validation/course';
import {
  listCourseSections,
  createCourseSection,
  updateCourseSectionService,
  deleteCourseSectionService
} from '@api/services/course/section';
import { createLesson, getLesson, updateLessonService, deleteLessonService } from '@api/services/lesson/lesson';
import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import {
  createExercise,
  getExercise,
  createExerciseSectionService,
  updateExerciseService,
  updateExerciseSectionMetadataService,
  deleteExerciseForCourseService
} from '@api/services/exercise/exercise';
import { reorderCourseContent } from '@api/services/course/content';
import {
  convertMarkdownMathToKatex,
  normalizeAgentLessonContent,
  repararDiagrama,
  validateLessonMath,
  validateLessonVisuals,
  validateSvgDiagram
} from '@api/services/agent/lesson-content';
import type { RedisClient } from '@api/utils/redis/redis';
import { textoDeLeccion, type FuenteVista, type Verificador } from '@api/services/agent/grounding';
import { textoParaTokens, verificarTokens } from '@api/services/agent/grounding-tokens';
import {
  avisoLeerAntes,
  leccionesSinLeer,
  MAX_LECTURA_LECCIONES_CHARS,
  type LeccionObjetivo
} from '@api/services/agent/exercise-reading';
import type { EscritorDeLecciones } from '@api/services/agent/lesson-writer';
import { avisoDeCobertura, medirCobertura } from '@api/services/agent/plan-coverage';
import { avisoDeConfirmacion, confirmacionCoincide } from '@api/services/agent/deletion';
import { leerFuente } from '@api/services/agent/source-index';
import { generateLessonImage, MAX_IMAGES_PER_ROUND } from '@api/services/agent/image-generation';
import { getOrgAiImageSettingsService } from '@api/services/organization/ai-images';
import { buildUpdatedQuestions } from '@api/services/agent/question-update';
import { updateCourseLandingPageService } from '@api/services/course/landing-page';
import { getCourseGoLiveReadiness, publishCourseWhenReady } from '@api/services/course/go-live-readiness';
import {
  assertValidUuid,
  verifyExerciseBelongsToCourse,
  verifyLessonBelongsToCourse,
  verifySectionBelongsToCourse
} from '@api/services/agent/chat-context';
import {
  addQuestionsParam,
  askTemplateQuestionsParam,
  askDiscoveryQuestionsParam,
  coursePlanParam,
  createExerciseParam,
  createExerciseSectionParam,
  createLessonParam,
  createSectionParam,
  deleteExerciseParam,
  deleteLessonParam,
  deleteSectionParam,
  editContentParam,
  emptyParam,
  exerciseReadParam,
  fetchDocumentationUrlParam,
  generateImageParam,
  goLiveParam,
  lessonReadParam,
  readLessonsParam,
  readSourceParam,
  reorderContentParam,
  replaceBlockParam,
  updateContentParam,
  updateCourseLandingPageParam,
  updateExerciseParam,
  searchDocumentParam,
  searchWebParam,
  updateExerciseSectionParam,
  updateLessonParam,
  updateQuestionsParam,
  updateSectionParam,
  writeLessonParam
} from '@api/services/agent/agent-tool-schemas';
import { fetchDocumentationUrl } from '@api/services/agent/fetch-url';
import { searchWeb } from '@api/services/agent/web-search';
import {
  findLessonBlock,
  preserveBlockId,
  replaceLessonBlock,
  summarizeLessonBlocks
} from '@api/services/agent/lesson-blocks';

function summarizeAgentDebugValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;

  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}… (${value.length} chars)` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[Array(${value.length})]`;
    }

    return {
      count: value.length,
      items: value.slice(0, 3).map((item) => summarizeAgentDebugValue(item, depth + 1))
    };
  }

  if (typeof value === 'object') {
    if (depth >= 2) {
      return '[Object]';
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        summarizeAgentDebugValue(nestedValue, depth + 1)
      ])
    );
  }

  return String(value);
}

/** Attribute-safe text for the one element the agent is handed pre-built. */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Normalize, save and check one lesson body — the single path for it.
 *
 * Shared by `update_lesson_content` and by `create_lesson` when it is handed a
 * body, so the one-call shape cannot drift from the two-call one: same
 * normalization, same diagram checks, same formula conversion.
 */
async function writeLessonBody(params: {
  lessonId: string;
  lessonTitle: string;
  locale: string;
  content: string;
  /** Sólo una construcción completa pide una ilustración — ver `buildAgentTools`. */
  isBuilding?: boolean;
  /** El chequeo de fundamento, si esta ronda lo tiene. Ver `grounding.ts`. */
  verificarFundamento?: Verificador;
  /** Lo que tuvo delante quien escribió, si se sabe: se contrasta contra eso. */
  fuentesDeLaLeccion?: FuenteVista[];
  /** Lo que el escritor avisó que no pudo cubrir, si avisó algo. */
  notaDelEscritor?: string;
}): Promise<{
  normalizedContent: string;
  svgWarnings: string[];
  mathWarnings: string[];
  visualWarnings: string[];
  groundingWarnings: string[];
}> {
  const normalizedContent = normalizeAgentLessonContent(params.content, params.lessonTitle);

  await upsertLessonLanguageService(params.lessonId, {
    locale: params.locale as 'en',
    content: normalizedContent
  });

  // El chequeo de fundamento sale a la red, así que arranca ANTES de las
  // comprobaciones locales y se espera al final: los avisos de SVG y de fórmulas
  // son puro cómputo y no tienen por qué hacer cola detrás de una llamada al
  // proveedor.
  // El fundamento NO depende de la fase, y esa fue la falla.
  //
  // Estaba atado a `isBuilding`, que es verdadero sólo cuando hay un plan
  // aprobado en los mensajes del chat. Así que pedir "completá la sección 2" en
  // una conversación nueva escribía sin ningún chequeo. Medido en producción el
  // 2026-09-12: tres lecciones, 31.600 caracteres y un examen de 7 preguntas,
  // todo sobre una estructura inventada, sin que nada lo mirara.
  //
  // Lo que decide si hay que verificar es lo que se está haciendo —guardar el
  // cuerpo entero de una lección— y no en qué modo está la conversación. Por
  // eso vive acá: los tres caminos que escriben una lección completa pasan por
  // esta función. Los retoques quirúrgicos (`edit_lesson_content`,
  // `replace_lesson_block`) no pasan, y está bien: son de una frase, con el
  // docente mirando.
  const fundamento = params.verificarFundamento
    ? params.verificarFundamento({
        lessonTitle: params.lessonTitle,
        contenido: normalizedContent,
        soloFuentes: params.fuentesDeLaLeccion
      })
    : Promise.resolve<string[]>([]);

  // Problems the prompt forbids but nothing used to catch (labels below the
  // readable size, rows stacked on top of each other, formulas KaTeX will never
  // reach). Reported rather than repaired:
  // fixing an overlap means moving a label, which needs to know what the diagram
  // is saying. Handing the warning back lets the model correct its own work
  // instead of shipping it broken.
  const svgWarnings = validateSvgDiagram(normalizedContent);

  /**
   * La mitad determinista del fundamento: los datos que se buscan, no se opinan.
   *
   * Corre siempre que se sepa con qué fuentes se escribió, no sale a la red y
   * no puede fallar la escritura. Va sólo al informe del docente y NO a los
   * avisos que vuelven al modelo — el porqué está en `grounding-tokens.ts`.
   */
  const tokenWarnings = params.fuentesDeLaLeccion?.length
    ? verificarTokens({ texto: textoParaTokens(normalizedContent), fuentes: params.fuentesDeLaLeccion })
    : [];

  const groundingWarnings = await fundamento;

  /**
   * Queda escrito de qué está hecha la lección.
   *
   * Todo esto ya se sabía acá y se devolvía al modelo, que lo contaba en prosa
   * en el chat — prosa que se va hacia arriba y desaparece. El docente abría la
   * lección y no tenía forma de distinguir el párrafo que salió de un documento
   * del que es relleno plausible: los dos se leen con la misma autoridad.
   *
   * Se guarda en la lección, al lado del contenido que describe, y nunca falla
   * el guardado: si esto se cae, la lección igual se escribió.
   */
  await updateLessonQuery(params.lessonId, {
    buildReport: {
      builtAt: new Date().toISOString(),
      sources: (params.fuentesDeLaLeccion ?? []).map((f) => f.fileName),
      groundingWarnings,
      diagramWarnings: svgWarnings,
      tokenWarnings,
      ...(params.notaDelEscritor ? { writerNote: params.notaDelEscritor } : {})
    }
  }).catch((error) => console.error('[lesson] no se pudo guardar el informe de la lección:', error));

  return {
    normalizedContent,
    svgWarnings,
    mathWarnings: validateLessonMath(normalizedContent),
    // Sólo durante una construcción: un docente que edita una lección a mano
    // puede querer exactamente el párrafo que pidió y nada más.
    visualWarnings: params.isBuilding ? validateLessonVisuals(normalizedContent) : [],
    groundingWarnings
  };
}

/** The `note` that goes with whatever came back broken, or nothing. */
function contentWarningFields(warnings: {
  svgWarnings: string[];
  mathWarnings: string[];
  visualWarnings?: string[];
  groundingWarnings?: string[];
}) {
  const visualWarnings = warnings.visualWarnings ?? [];
  const groundingWarnings = warnings.groundingWarnings ?? [];
  const notes: string[] = [];
  // El fundamento va primero a propósito. Los otros tres avisos son sobre cómo
  // se ve la lección; éste es sobre si lo que dice es cierto, y si hay que
  // elegir uno solo para atender, es ése.
  if (groundingWarnings.length > 0) notes.push('parts of it are not supported by the sources');
  if (warnings.svgWarnings.length > 0) notes.push('the diagram(s) above will not render legibly');
  if (warnings.mathWarnings.length > 0) notes.push('the formula(s) above will not render as maths');
  if (visualWarnings.length > 0) notes.push('it has no diagram and no picture');

  if (notes.length === 0) return {};

  return {
    ...(groundingWarnings.length > 0 ? { groundingWarnings } : {}),
    ...(warnings.svgWarnings.length > 0 ? { svgWarnings: warnings.svgWarnings } : {}),
    ...(warnings.mathWarnings.length > 0 ? { mathWarnings: warnings.mathWarnings } : {}),
    ...(visualWarnings.length > 0 ? { visualWarnings } : {}),
    note: `The lesson was saved, but ${notes.join(', and ')}. Fix that now with edit_lesson_content before moving on${groundingWarnings.length > 0 ? ', starting with the grounding warnings' : ''}.`
  };
}

function logAgentToolDebug(
  phase: 'start' | 'success' | 'error',
  toolName: string,
  details: { courseId: string; userId: string; args?: unknown; result?: unknown; error?: unknown }
) {
  const base = `[agent-tool:${phase}] ${toolName}`;

  if (phase === 'error') {
    console.error(base, {
      courseId: details.courseId,
      userId: details.userId,
      args: summarizeAgentDebugValue(details.args),
      error:
        details.error instanceof Error
          ? {
              message: details.error.message,
              stack: details.error.stack
            }
          : summarizeAgentDebugValue(details.error)
    });
    return;
  }

  console.info(base, {
    courseId: details.courseId,
    userId: details.userId,
    args: summarizeAgentDebugValue(details.args),
    result: summarizeAgentDebugValue(details.result)
  });
}

function sanitizeToolError(toolName: string, error: unknown): Error {
  if (error instanceof AppError) {
    return error;
  }

  const raw = error instanceof Error ? error.message : String(error);
  const looksLikeSqlLeak =
    /^Failed query:/i.test(raw) ||
    /\bparams:\s/i.test(raw) ||
    /\binvalid input syntax for type uuid\b/i.test(raw) ||
    /\bselect\s+.+\bfrom\s+/i.test(raw);

  if (looksLikeSqlLeak) {
    return new Error(
      `${toolName} failed because of an invalid or unknown ID. Call get_course_structure to fetch the current IDs and retry — never invent UUIDs.`
    );
  }

  return error instanceof Error ? error : new Error(raw);
}

/**
 * Shape returned to the MODEL when a tool fails.
 *
 * These errors used to be thrown, and a throw inside `execute` aborts the whole
 * stream: the round died, the teacher saw a red bubble, and had to re-send the
 * instruction — which re-ran every action that had already succeeded. The irony
 * was that the messages are written FOR the model ("call get_course_structure to
 * fetch real IDs and retry") and the model never got to read a single one.
 *
 * Returned as a result instead, the failure becomes an ordinary tool output the
 * model can act on: it reads the complaint and retries within the same round.
 * Runaway retries are bounded by `stopWhen: stepCountIs(MAX_STEPS_PER_ROUND)`.
 *
 * `ok: false` is the marker the dashboard keys on to paint the step as failed —
 * without it a returned error would render as a completed step.
 */
export interface AgentToolFailure {
  ok: false;
  error: string;
}

async function executeAgentTool<TArgs, TResult>(
  toolName: string,
  params: { orgId: string; userId: string; courseId: string; args?: TArgs },
  execute: () => Promise<TResult>
): Promise<TResult | AgentToolFailure> {
  trackAgentEvent(AgentEvent.TOOL_CALLED, {
    orgId: params.orgId,
    userId: params.userId,
    courseId: params.courseId,
    toolName
  });
  logAgentToolDebug('start', toolName, {
    courseId: params.courseId,
    userId: params.userId,
    args: params.args
  });

  try {
    const result = await execute();

    trackAgentEvent(AgentEvent.TOOL_COMPLETED, {
      orgId: params.orgId,
      userId: params.userId,
      courseId: params.courseId,
      toolName,
      success: true
    });
    logAgentToolDebug('success', toolName, {
      courseId: params.courseId,
      userId: params.userId,
      args: params.args,
      result
    });

    return result;
  } catch (error) {
    logAgentToolDebug('error', toolName, {
      courseId: params.courseId,
      userId: params.userId,
      args: params.args,
      error
    });

    trackAgentEvent(AgentEvent.TOOL_COMPLETED, {
      orgId: params.orgId,
      userId: params.userId,
      courseId: params.courseId,
      toolName,
      success: false
    });

    // Logged at error level even though it is no longer thrown — a failure the
    // model quietly recovers from must still be visible in the API log, or the
    // only trace of a systematically broken tool is that rounds take more steps.
    const failure = sanitizeToolError(toolName, error);
    console.error(`[agent-tool:failed] ${toolName}: ${failure.message}`);

    return { ok: false, error: failure.message };
  }
}

export function buildAgentTools(
  orgId: string,
  userId: string,
  courseId: string,
  priorMessages: unknown[],
  _options?: {
    isOrgOnPaidPlan?: boolean;
    conversationId?: string | null;
    searchableDocumentId?: string | null;
    isBuilding?: boolean;
    /**
     * Contrasta cada leccion escrita contra las fuentes del curso. Ausente
     * cuando el curso no tiene ninguna, o cuando el chequeo esta apagado.
     */
    verificarFundamento?: Verificador;
    /** Necesario para `read_source`: el texto de las fuentes vive cacheado ahí. */
    redis?: RedisClient;
    /** El sub-agente que escribe una lección con contexto limpio. Ver `lesson-writer.ts`. */
    escribirLeccion?: EscritorDeLecciones;
  }
): ToolSet {
  const conversationId = _options?.conversationId ?? null;
  const searchableDocumentId = _options?.searchableDocumentId ?? null;
  const isBuilding = _options?.isBuilding ?? false;
  const verificarFundamento = _options?.verificarFundamento;
  const redisParaFuentes = _options?.redis;
  const escribirLeccion = _options?.escribirLeccion;

  // Lecciones cuyo TEXTO pasó por el contexto del modelo en esta ronda: las que
  // leyó o escribió enteras él mismo. Las de write_lesson no — ésas las escribió
  // otro. Es lo que controla que las preguntas salgan de lo que la lección dice.
  // Ver `exercise-reading.ts`.
  const leccionesConocidas = new Set<string>();

  // Images are the only tool here that spends money per call rather than per
  // token, so the guard has to live where the calls are counted. The tool set is
  // rebuilt for each round, which makes this counter per-round by construction.
  let imagesGenerated = 0;

  /**
   * Lecciones escritas en esta ronda sin un plan aprobado.
   *
   * ── Por qué hay un tope ──────────────────────────────────────────────────
   *
   * Medido el 2026-09-12 con el mismo pedido, dos veces: sin fuentes el agente
   * escribió tres lecciones de una y armó el examen; con fuentes propuso un
   * plan y esperó. O sea que pasar por el plan —el único camino donde el
   * docente ve la forma ANTES de que se escriban treinta mil caracteres, donde
   * cada lección declara de qué fuente sale, y donde se mide la cobertura—
   * dependía del azar.
   *
   * El tope no prohíbe escribir: una o dos lecciones sueltas son un pedido
   * normal y siguen andando. Lo que corta es construir un curso entero de
   * prendida, que es otra cosa y tiene su camino.
   *
   * Como el juego de herramientas se rearma en cada ronda, el contador es por
   * ronda por construcción.
   */
  let leccionesEscritasSinPlan = 0;
  /** Dos son un pedido suelto; a la tercera ya es un curso, y eso va por el plan. */
  const MAX_LECCIONES_SIN_PLAN = 2;
  const runScope = { orgId, courseId, conversationId, userId };

  /**
   * Idempotency guard for the create_* tools.
   *
   * Returns the id already built for `planKey`, or null if there is none (or the
   * row it pointed at is gone — the teacher may have deleted it by hand). A
   * non-null result means the caller must NOT insert: the plan item is already
   * satisfied.
   *
   * This is deliberately the last line of defence rather than the only one. The
   * Plan Progress anchor can still misjudge an item and tell the model to create
   * it a second time; this makes that harmless instead of producing the duplicate
   * sections and lessons teachers were seeing.
   */
  async function findBoundEntity(
    planKey: string | undefined,
    kind: 'section' | 'lesson' | 'exercise'
  ): Promise<string | null> {
    if (!planKey) return null;

    try {
      const binding = await resolvePlanBinding({ ...runScope, planKey });

      if (!binding?.entityId) return null;

      if (kind === 'section') await verifySectionBelongsToCourse(binding.entityId, courseId);
      else if (kind === 'lesson') await verifyLessonBelongsToCourse(binding.entityId, courseId);
      else await verifyExerciseBelongsToCourse(binding.entityId, courseId);

      return binding.entityId;
    } catch {
      // Stale binding (row deleted, or moved to another course) — treat the plan
      // item as unbuilt and let the create proceed.
      return null;
    }
  }

  /** Record the row a plan item was built into. Best-effort: never fails a create. */
  async function recordBinding(planKey: string | undefined, entityId: string): Promise<void> {
    if (!planKey) return;

    try {
      await bindPlanItem({ ...runScope, planKey, entityId });
    } catch (error) {
      console.error('[agent-tool] failed to bind plan item', planKey, error);
    }
  }

  /**
   * La lección de un ítem del plan: la que ya se construyó para él, o una nueva.
   *
   * Compartida por `create_lesson` y `write_lesson` para que no puedan divergir
   * en lo único que importa acá, que es no duplicar. Con una copia en cada una,
   * el primer arreglo de idempotencia llegaría a una sola.
   */
  async function crearOReusarLeccion(args: {
    sectionId: string;
    title: string;
    order: number;
    planKey?: string;
  }): Promise<{ id: string; title: string; order: number; reused: boolean }> {
    await verifySectionBelongsToCourse(args.sectionId, courseId);

    const boundId = await findBoundEntity(args.planKey, 'lesson');

    if (boundId) {
      // getLesson throws when missing; the binding was just verified, so a
      // failure here is a race, not a real absence — fall back to the args.
      const existing = await getLesson(boundId).catch(() => null);

      return {
        id: boundId,
        title: existing?.title ?? args.title,
        order: existing?.order ?? args.order,
        reused: true
      };
    }

    const lesson = await createLesson(courseId, {
      title: args.title,
      courseId,
      sectionId: args.sectionId,
      order: args.order
    });
    // Bind before writing the body: if the content write fails, the retry has to
    // find this lesson and fill it, not create a second one.
    await recordBinding(args.planKey, lesson.id);

    return { id: lesson.id, title: lesson.title ?? args.title, order: lesson.order ?? args.order, reused: false };
  }

  /**
   * Las lecciones cuyo contenido cubre un ejercicio: la suya si está atado a
   * una, o las de su sección. Vacío cuando no hay ninguna: el examen final vive
   * en una sección sin lecciones, y ahí el control no tiene contra qué comparar
   * (lo cubre el prompt, que manda leer cada sección antes de su bloque).
   */
  async function leccionesQueCubre(params: { lessonId?: string; sectionId?: string }): Promise<LeccionObjetivo[]> {
    if (!params.lessonId && !params.sectionId) return [];

    const items = await getCourseContentItems(courseId);

    if (params.lessonId) {
      const leccion = items.find((item) => item.id === params.lessonId);

      return [{ id: params.lessonId, title: leccion?.title ?? null }];
    }

    return items
      .filter((item) => item.sectionId === params.sectionId && String(item.type).toLowerCase() === 'lesson')
      .map((item) => ({ id: item.id, title: item.title }));
  }

  return {
    read_source: tool({
      description:
        'Read one of the source documents the teacher attached to this course, by id from the "## Course Sources — index" list. Returns the text with line numbers, in pages: pass `offset` (the line to start at) and `limit` to keep reading a long document. Read the source BEFORE writing anything that claims to come from it — the index tells you what exists, this tells you what it says.',
      inputSchema: readSourceParam,
      execute: async (args) => {
        return executeAgentTool('read_source', { orgId, userId, courseId, args }, async () => {
          if (!redisParaFuentes) {
            throw new Error('Source reading is unavailable on this turn.');
          }

          const lectura = await leerFuente({
            documentId: args.sourceId,
            courseId,
            redis: redisParaFuentes,
            offset: args.offset,
            limit: args.limit
          });

          if (!lectura) {
            // Devuelto como resultado y no lanzado: el modelo lo lee, corrige el
            // id contra el índice y reintenta dentro de la misma ronda.
            throw new Error(
              `No source with id "${args.sourceId}" belongs to this course. Copy an id from the "## Course Sources — index" list — do not invent one.`
            );
          }

          return {
            fileName: lectura.fileName,
            fromLine: lectura.desdeLinea,
            toLine: lectura.hastaLinea,
            totalLines: lectura.totalLineas,
            content: lectura.content,
            ...(lectura.hayMas
              ? {
                  more: `${lectura.totalLineas - lectura.hastaLinea} more line(s). Call read_source again with offset ${lectura.hastaLinea + 1} to continue.`
                }
              : {})
          };
        });
      }
    }),

    search_document: tool({
      description:
        'Search the attached reference document for the fragments most relevant to a query, instead of reading the whole document. Use this when editing or extending a course from an attached document: search for the specific topic/section you need, then write from the returned fragments. Returns the top matching passages.',
      inputSchema: searchDocumentParam,
      execute: async (args) => {
        return executeAgentTool('search_document', { orgId, userId, courseId, args }, async () => {
          if (!searchableDocumentId) {
            return { fragments: [], note: 'No searchable document is attached to this conversation.' };
          }
          const results = await semanticSearchDocument({
            documentId: searchableDocumentId,
            query: args.query,
            limit: args.limit
          });
          return {
            fragments: results.map((r) => ({ content: r.content, relevance: Number((1 - r.distance).toFixed(3)) })),
            count: results.length
          };
        });
      }
    }),
    generate_image: tool({
      description:
        'Generate a real illustration (a raster picture) for a lesson and get back a permanent URL to embed with <img src="…">. Use it for what a diagram cannot show — a scene, an object, a place, an atmosphere, an analogy made visual. Do NOT use it for charts, flows, timelines, labelled structures or anything with data or text in it: those stay inline <svg>, which is sharper, editable, and free. Costs real money per call, so one image per lesson at most, and only where a picture genuinely teaches something.',
      inputSchema: generateImageParam,
      execute: async (args) => {
        return executeAgentTool('generate_image', { orgId, userId, courseId, args }, async () => {
          // Refused rather than thrown: an error would push the model to retry,
          // which is precisely what must not happen when the reason is spend.
          if (imagesGenerated >= MAX_IMAGES_PER_ROUND) {
            return {
              generated: false,
              note: `This round has already generated its limit of ${MAX_IMAGES_PER_ROUND} images. Continue without one — write the lesson, or draw an inline <svg> if the idea is structural. Do not call generate_image again this round.`
            };
          }

          if (args.lessonId) {
            await verifyLessonBelongsToCourse(args.lessonId, courseId);
          }

          // The organisation's look, read per call rather than per round: an
          // admin who changes the style mid-build should see it take effect on
          // the next image, not the next conversation.
          const style = await getOrgAiImageSettingsService(orgId).catch(() => null);

          const image = await generateLessonImage({
            subject: args.subject,
            courseId,
            lessonId: args.lessonId,
            locale: args.locale,
            aspectRatio: args.aspectRatio,
            styleReferenceUrl: style?.styleReferenceUrl,
            styleNote: style?.styleNote,
            orgId,
            userId
          });

          imagesGenerated += 1;

          return {
            generated: true,
            url: image.url,
            // Handed over ready to paste. The model is told never to invent an
            // <img>, so giving it the exact element removes the temptation to
            // improvise attributes the sanitizer would strip.
            html: `<img src="${image.url}" alt="${escapeHtmlAttribute(args.alt)}" />`,
            remaining: MAX_IMAGES_PER_ROUND - imagesGenerated,
            note: 'Insert the `html` above into the lesson body where the picture belongs. Use it verbatim — a different src will not load.'
          };
        });
      }
    }),

    // `update_course_todo_list` used to live here. It was the model's own build
    // checklist, and it asked for a bookkeeping call after every created item —
    // out of a 40-step round, roughly a third spent narrating instead of
    // building. The model sensibly stopped paying it, so the checklist read 1/32
    // while ten lessons already existed. Progress is now derived on the server
    // from the plan registry (buildPlanProgressAnchor), which cannot drift.

    get_course_structure: tool({
      description:
        'Get the full course structure including sections, lessons, and exercises as a tree. The courseId is automatically set — do not pass it.',
      inputSchema: emptyParam,
      execute: async () => {
        return executeAgentTool('get_course_structure', { orgId, userId, courseId }, async () => {
          const [items, sections] = await Promise.all([getCourseContentItems(courseId), listCourseSections(courseId)]);
          return { sections, items };
        });
      }
    }),

    get_lesson_content: tool({
      description:
        'Get the HTML content of a specific lesson in this course. The response also lists the addressable blocks — use a blockId with replace_lesson_block to change one of them.',
      inputSchema: lessonReadParam,
      execute: async (args) => {
        return executeAgentTool('get_lesson_content', { orgId, userId, courseId, args }, async () => {
          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await getLesson(args.lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const langContent = lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === args.locale);
          const content = langContent?.content || null;
          leccionesConocidas.add(args.lessonId);
          // The ids are already in the HTML above; listing them separately saves
          // the model from parsing them out, and is cheap — id plus a short
          // preview, not the block bodies again.
          const blocks = content ? summarizeLessonBlocks(content) : [];

          return {
            id: lesson.id,
            title: lesson.title,
            content,
            locale: args.locale,
            ...(blocks.length > 0 ? { blocks } : {})
          };
        });
      }
    }),

    read_lessons: tool({
      description:
        'Read the text of up to 12 lessons of this course at once, as plain text: no HTML, diagram labels kept as [diagram: …]. Use it before writing exercise questions — they must test what the lessons actually say — and to check what other lessons already cover. To EDIT a lesson use get_lesson_content instead: it returns the HTML and the block ids.',
      inputSchema: readLessonsParam,
      execute: async (args) => {
        return executeAgentTool('read_lessons', { orgId, userId, courseId, args }, async () => {
          const items = await getCourseContentItems(courseId);
          const lessons: Array<{ id: string; title: string | null; text: string }> = [];
          const noEncontradas: string[] = [];
          const recortadas: string[] = [];
          let usados = 0;

          for (const id of [...new Set(args.lessonIds)]) {
            const item = items.find((i) => i.id === id && String(i.type).toLowerCase() === 'lesson');

            if (!item) {
              noEncontradas.push(id);
              continue;
            }

            const lesson = (await getLesson(id)) as {
              lessonLanguages?: Array<{ locale: string; content: string | null }>;
            };
            const html = lesson.lessonLanguages?.find((ll) => ll.locale === args.locale)?.content ?? '';
            let texto = html ? textoDeLeccion(html) : '';
            const lugar = MAX_LECTURA_LECCIONES_CHARS - usados;
            const recortada = texto.length > lugar;

            if (recortada) {
              texto = `${texto.slice(0, Math.max(0, lugar))} […]`;
              recortadas.push(item.title ?? id);
            }

            usados += texto.length;

            // Una lección cortada no cuenta como leída: el modelo no vio el
            // resto, y el control de preguntas le va a pedir que la lea entera
            // en otra llamada, donde sí entra.
            if (!recortada) leccionesConocidas.add(id);

            lessons.push({ id, title: item.title, text: texto || '(This lesson has no content in this locale yet.)' });
          }

          return {
            count: lessons.length,
            lessons,
            ...(noEncontradas.length > 0
              ? {
                  notFound: noEncontradas,
                  note: 'These ids are not lessons of this course. Copy lesson ids from get_course_structure — never invent them.'
                }
              : {}),
            ...(recortadas.length > 0
              ? {
                  truncated: recortadas,
                  truncatedNote: 'The read budget ran out and these lessons were cut. Read them again in a separate call.'
                }
              : {})
          };
        });
      }
    }),

    get_exercise_details: tool({
      description:
        'Get an exercise with sections, questions, and answer options from this course. Each sections entry has an id — use it with update_exercise_section to change that question block title or description.',
      inputSchema: exerciseReadParam,
      execute: async (args) => {
        return executeAgentTool('get_exercise_details', { orgId, userId, courseId, args }, async () => {
          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);
          return getExercise(args.exerciseId);
        });
      }
    }),

    create_section: tool({
      description: 'Create a new section in this course.',
      inputSchema: createSectionParam,
      execute: async (args) => {
        return executeAgentTool('create_section', { orgId, userId, courseId, args }, async () => {
          const boundId = await findBoundEntity(args.planKey, 'section');

          if (boundId) {
            const existing = (await listCourseSections(courseId)).find((s) => s.id === boundId);
            return {
              id: boundId,
              title: existing?.title ?? args.title,
              order: existing?.order ?? args.order,
              reused: true,
              note: 'This plan item was already built. Reusing the existing section instead of creating a duplicate.'
            };
          }

          const section = await createCourseSection(courseId, { title: args.title, courseId, order: args.order });
          await recordBinding(args.planKey, section.id);
          return { id: section.id, title: section.title, order: section.order };
        });
      }
    }),

    update_section: tool({
      description:
        'Update metadata for an existing section in this course. Use this to rename a section or change its order instead of creating a new section.',
      inputSchema: updateSectionParam,
      execute: async (args) => {
        return executeAgentTool('update_section', { orgId, userId, courseId, args }, async () => {
          await verifySectionBelongsToCourse(args.sectionId, courseId);
          const section = await updateCourseSectionService(args.sectionId, {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.order !== undefined ? { order: args.order } : {})
          });

          return { id: section.id, title: section.title, updated: true };
        });
      }
    }),

    create_lesson: tool({
      description:
        'Create a new lesson within a section of this course, optionally writing its content in the SAME call by passing `content`. While building an approved plan, write lessons with write_lesson instead: it keeps the lesson HTML out of your context. Use create_lesson with `content` for a lesson you write yourself — a one-off, or the fallback when write_lesson fails. Creating a lesson empty and filling it with a follow-up update_lesson_content costs an extra round trip for nothing.',
      inputSchema: createLessonParam,
      execute: async (args) => {
        return executeAgentTool('create_lesson', { orgId, userId, courseId, args }, async () => {
          // Escribir un curso entero sin plan aprobado: se rechaza, no se
          // corrige después. Devuelto como resultado y no lanzado, para que el
          // modelo lea el motivo y llame a `generate_course_plan` en la misma
          // ronda en vez de reintentar lo mismo.
          if (!isBuilding && args.content && leccionesEscritasSinPlan >= MAX_LECCIONES_SIN_PLAN) {
            return {
              created: false,
              note:
                `Ya escribiste ${MAX_LECCIONES_SIN_PLAN} lecciones en esta ronda sin un plan aprobado. ` +
                'Escribir una sección o un curso entero va por el plan: llamá a generate_course_plan con lo que falta, ' +
                'declarando para cada lección de qué fuente sale, y esperá a que el docente lo apruebe. ' +
                'Así ve la forma antes de que se escriba, y cada lección queda atada a su material.'
            };
          }

          const leccion = await crearOReusarLeccion(args);

          if (leccion.reused) {
            // A retry after an interrupted round lands here. It still carries the
            // body, and the lesson it belongs to may well be empty — so write it
            // rather than returning early and stranding the content.
            const written = args.content
              ? await writeLessonBody({
                  lessonId: leccion.id,
                  lessonTitle: leccion.title,
                  locale: args.locale,
                  content: args.content,
                  isBuilding,
                  verificarFundamento
                })
              : null;

            if (written) leccionesConocidas.add(leccion.id);

            return {
              id: leccion.id,
              title: leccion.title,
              order: leccion.order,
              reused: true,
              ...(written
                ? {
                    contentWritten: true,
                    contentLength: written.normalizedContent.length,
                    ...contentWarningFields(written)
                  }
                : {
                    note: 'This plan item was already built. Reusing the existing lesson — write its content with update_lesson_content instead of creating a duplicate.'
                  })
            };
          }

          if (!args.content) {
            return { id: leccion.id, title: leccion.title, order: leccion.order };
          }

          if (!isBuilding) leccionesEscritasSinPlan += 1;

          const written = await writeLessonBody({
            lessonId: leccion.id,
            lessonTitle: leccion.title,
            locale: args.locale,
            content: args.content,
            isBuilding,
            verificarFundamento
          });
          leccionesConocidas.add(leccion.id);

          return {
            id: leccion.id,
            title: leccion.title,
            order: leccion.order,
            locale: args.locale,
            contentWritten: true,
            contentLength: written.normalizedContent.length,
            ...contentWarningFields(written)
          };
        });
      }
    }),

    write_lesson: tool({
      description:
        'Write ONE lesson through a dedicated writer that sees only the brief for this lesson, the course outline and the sources you list. While building an approved plan, this is how every lesson gets written: you send a short brief plus the sources the plan declared for it — never the lesson HTML — so your own context stays small for the whole course. Pass sectionId + title + order + planKey to create a lesson, or lessonId to rewrite one. The result carries the same checks as any saved lesson (diagrams, formulas, and grounding against exactly the sources the writer saw) and, when there is one, a writerNote about what the writer could not cover: pass that note on to the teacher.',
      inputSchema: writeLessonParam,
      execute: async (args) => {
        return executeAgentTool('write_lesson', { orgId, userId, courseId, args }, async () => {
          if (!escribirLeccion) {
            throw new Error(
              'The lesson writer is unavailable on this turn. Write the lesson yourself with create_lesson + content.'
            );
          }

          let leccion: { id: string; title: string; order: number | null | undefined; reused: boolean };

          if (args.lessonId) {
            await verifyLessonBelongsToCourse(args.lessonId, courseId);
            const existente = await getLesson(args.lessonId);
            leccion = { id: args.lessonId, title: existente.title, order: existente.order, reused: false };
          } else if (args.sectionId && args.title && args.order !== undefined) {
            leccion = await crearOReusarLeccion({
              sectionId: args.sectionId,
              title: args.title,
              order: args.order,
              planKey: args.planKey
            });
          } else {
            throw new Error('Pass lessonId to rewrite a lesson, or sectionId + title + order to create one.');
          }

          // Lo que ya tiene escrito, si algo. Al reescribir, el escritor tiene
          // que conservar lo que la consigna no pide cambiar —y las imágenes—;
          // en un reintento, no tirar lo que ya había quedado guardado.
          const actual = (await getLesson(leccion.id).catch(() => null)) as {
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          } | null;
          const contenidoActual =
            actual?.lessonLanguages?.find((ll) => ll.locale === args.locale)?.content || undefined;

          let escrito;

          try {
            escrito = await escribirLeccion({
              lessonTitle: leccion.title,
              brief: args.brief,
              locale: args.locale,
              sources: args.sources,
              contenidoActual
            });
          } catch (error) {
            const motivo = error instanceof Error ? error.message : String(error);
            const estado = contenidoActual ? 'keeps its previous content' : 'exists but is still empty';

            throw new Error(
              `The writer could not write "${leccion.title}": ${motivo} The lesson ${estado}. Retry write_lesson once; if it fails again, write it yourself with update_lesson_content.`
            );
          }

          /**
           * El escritor se nego: el material no sostiene esta leccion.
           *
           * La leccion queda PENDIENTE — creada y vacia, en su lugar del plan —
           * y no se rellena con nada. Un hueco declarado lo llena el docente
           * subiendo lo que falta; uno tapado con parrafos verosimiles no lo ve
           * nadie, y es como se construyo una seccion entera sobre un
           * organigrama que el agente nunca habia leido.
           *
           * Se devuelve como resultado y no como error a proposito: un error
           * invita a reintentar, y reintentar contra el mismo material vacio
           * termina en el relleno que esto vino a evitar.
           */
          if ('faltaMaterial' in escrito) {
            return {
              id: leccion.id,
              lessonId: leccion.id,
              title: leccion.title,
              order: leccion.order,
              locale: args.locale,
              contentWritten: false,
              pendingForLackOfMaterial: escrito.faltaMaterial,
              sourcesUsed: escrito.fuentesUsadas,
              ...(escrito.fuentesNoEncontradas.length > 0 ? { sourcesNotFound: escrito.fuentesNoEncontradas } : {}),
              note:
                'The lesson was left empty on purpose. Do NOT write it yourself and do NOT retry: tell the teacher, ' +
                'in the course language, what material this lesson needs so they can add it. Move on to the next item.'
            };
          }

          const written = await writeLessonBody({
            lessonId: leccion.id,
            lessonTitle: leccion.title,
            locale: args.locale,
            content: escrito.html,
            // El escritor es un paso de construcción por naturaleza, en cualquier
            // fase: el texto no lo dictó el docente, lo redactó un modelo a
            // partir de fuentes. Así que corren los chequeos de construcción,
            // fundamento incluido — contra lo que el escritor tuvo delante.
            isBuilding: true,
            verificarFundamento,
            fuentesDeLaLeccion: escrito.material,
            notaDelEscritor: escrito.nota
          });

          return {
            id: leccion.id,
            lessonId: leccion.id,
            title: leccion.title,
            lessonTitle: leccion.title,
            order: leccion.order,
            locale: args.locale,
            ...(leccion.reused ? { reused: true } : {}),
            contentWritten: true,
            contentLength: written.normalizedContent.length,
            sourcesUsed: escrito.fuentesUsadas,
            ...(escrito.fuentesNoEncontradas.length > 0 ? { sourcesNotFound: escrito.fuentesNoEncontradas } : {}),
            ...(escrito.recortadas.length > 0 ? { sourcesTruncated: escrito.recortadas } : {}),
            ...(escrito.nota ? { writerNote: escrito.nota } : {}),
            ...contentWarningFields(written)
          };
        });
      }
    }),

    update_lesson: tool({
      description:
        'Update metadata for an existing lesson in this course. Use this to rename, move, reorder, schedule, or change visibility/unlock settings instead of creating a new lesson.',
      inputSchema: updateLessonParam,
      execute: async (args) => {
        return executeAgentTool('update_lesson', { orgId, userId, courseId, args }, async () => {
          if (args.sectionId) {
            await verifySectionBelongsToCourse(args.sectionId, courseId);
          }

          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await updateLessonService(args.lessonId, {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.sectionId !== undefined ? { sectionId: args.sectionId } : {}),
            ...(args.order !== undefined ? { order: args.order } : {}),
            ...(args.lessonAt !== undefined ? { lessonAt: args.lessonAt } : {}),
            ...(args.callUrl !== undefined ? { callUrl: args.callUrl } : {}),
            ...(args.isUnlocked !== undefined ? { isUnlocked: args.isUnlocked } : {}),
            ...(args.public !== undefined ? { public: args.public } : {})
          });

          return { id: lesson.id, title: lesson.title, updated: true };
        });
      }
    }),

    update_lesson_content: tool({
      description:
        'Update the text content of a lesson in this course. Replaces full lesson HTML for the given locale. For lesson HTML, put only the lesson body in the content. Do not include the lesson title. Do not use h1 or h2 anywhere in lesson HTML. Start headings at h3 because that is the highest heading level allowed in lesson content.',
      inputSchema: updateContentParam,
      execute: async (args) => {
        return executeAgentTool('update_lesson_content', { orgId, userId, courseId, args }, async () => {
          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await getLesson(args.lessonId);

          const written = await writeLessonBody({
            lessonId: args.lessonId,
            lessonTitle: lesson.title,
            locale: args.locale,
            content: args.content,
            isBuilding,
            verificarFundamento
          });
          leccionesConocidas.add(args.lessonId);

          return {
            lessonId: args.lessonId,
            lessonTitle: lesson.title,
            locale: args.locale,
            contentLength: written.normalizedContent.length,
            updated: true,
            ...contentWarningFields(written)
          };
        });
      }
    }),

    replace_lesson_block: tool({
      description:
        'PREFERRED way to change part of a lesson: replace one block by its data-block-id, leaving the rest byte-for-byte untouched. Call get_lesson_content first and copy a blockId from its `blocks` list. You only write the new block — you do NOT have to reproduce the old one. Pass the complete replacement including its outer tag (e.g. "<p>…</p>"), or an empty string to delete the block. If the block has no id (older content), fall back to edit_lesson_content.',
      inputSchema: replaceBlockParam,
      execute: async (args) => {
        return executeAgentTool('replace_lesson_block', { orgId, userId, courseId, args }, async () => {
          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await getLesson(args.lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const current = lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === args.locale)?.content ?? '';

          if (!current) {
            throw new Error(
              `This lesson has no content in locale "${args.locale}" yet. Use update_lesson_content to write the initial content.`
            );
          }

          const block = findLessonBlock(current, args.blockId);

          if (!block) {
            const available = summarizeLessonBlocks(current);
            throw new Error(
              available.length === 0
                ? 'This lesson has no addressable blocks yet (it predates block ids). Use edit_lesson_content instead.'
                : `No block with id "${args.blockId}". Call get_lesson_content and copy an id from its blocks list. Available: ${available.map((b) => b.blockId).join(', ')}.`
            );
          }

          if (/<h[12][\s>]/i.test(args.html)) {
            throw new Error(
              'The replacement must not contain <h1> or <h2>. Lesson headings start at <h3>. Adjust the heading level and retry.'
            );
          }

          const repaired = convertMarkdownMathToKatex(
            args.html.includes('<svg') ? repararDiagrama(args.html) : args.html
          );
          // An empty replacement deletes the block; there is no id left to keep.
          const replacement = repaired.trim() ? preserveBlockId(repaired, args.blockId) : '';
          const updated = replaceLessonBlock(current, block, replacement);

          if (updated === current) {
            throw new Error('The replacement produced no change (the new block is identical to the old one).');
          }

          await upsertLessonLanguageService(args.lessonId, {
            locale: args.locale as 'en',
            content: updated
          });

          return {
            lessonId: args.lessonId,
            lessonTitle: lesson.title,
            locale: args.locale,
            blockId: args.blockId,
            deleted: replacement === '',
            contentLength: updated.length,
            updated: true,
            // Only inspect what this edit wrote — see the note in
            // edit_lesson_content about not sending the model after untouched
            // parts of the lesson.
            ...contentWarningFields({
              svgWarnings: replacement.includes('<svg') ? validateSvgDiagram(replacement) : [],
              mathWarnings: validateLessonMath(replacement)
            })
          };
        });
      }
    }),

    edit_lesson_content: tool({
      description:
        'FALLBACK for content with no block ids — prefer replace_lesson_block when the block you want has a data-block-id. Makes a TARGETED edit by find-and-replace: replaces one exact fragment of the lesson HTML, leaving the rest byte-for-byte untouched. Use this to redo just a diagram (the <svg>), fix or rewrite a single paragraph or sentence, or delete a block — NOT to write a lesson from scratch or rewrite the whole thing (use update_lesson_content for that). You MUST call get_lesson_content first and copy oldString VERBATIM from it. oldString must be unique in the lesson (include surrounding context) unless you pass replaceAll. Set newString to an empty string to delete the fragment.',
      inputSchema: editContentParam,
      execute: async (args) => {
        return executeAgentTool('edit_lesson_content', { orgId, userId, courseId, args }, async () => {
          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await getLesson(args.lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const current = lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === args.locale)?.content ?? '';

          if (!current) {
            throw new Error(
              `This lesson has no content in locale "${args.locale}" yet. Use update_lesson_content to write the initial content instead of edit_lesson_content.`
            );
          }

          const occurrences = current.split(args.oldString).length - 1;

          if (occurrences === 0) {
            throw new Error(
              'oldString was not found in the lesson. Call get_lesson_content and copy the fragment EXACTLY (verbatim: same whitespace, quotes, and HTML entities) before retrying.'
            );
          }

          if (occurrences > 1 && !args.replaceAll) {
            throw new Error(
              `oldString appears ${occurrences} times (ambiguous). Include more surrounding context to make it unique, or pass replaceAll: true to replace every occurrence.`
            );
          }

          if (/<h[12][\s>]/i.test(args.newString)) {
            throw new Error(
              'newString must not contain <h1> or <h2>. Lesson headings start at <h3>. Adjust the heading level and retry.'
            );
          }

          // Repair SVG geometry on the replacement fragment (edit_lesson_content is
          // often used to redo just a diagram); ensures the <svg> keeps viewBox +
          // explicit width/height so it isn't clipped. No-op for non-SVG fragments.
          const newString = convertMarkdownMathToKatex(
            args.newString.includes('<svg') ? repararDiagrama(args.newString) : args.newString
          );

          // String replace (no regex) so $&, $1, $$ etc. in newString are not interpreted.
          const updated = args.replaceAll
            ? current.split(args.oldString).join(newString)
            : current.replace(args.oldString, () => newString);

          if (updated === current) {
            throw new Error('The replacement produced no change (oldString and newString are equivalent).');
          }

          await upsertLessonLanguageService(args.lessonId, {
            locale: args.locale as 'en',
            content: updated
          });

          return {
            lessonId: args.lessonId,
            lessonTitle: lesson.title,
            locale: args.locale,
            replacements: args.replaceAll ? occurrences : 1,
            contentLength: updated.length,
            updated: true,
            // Only inspect what this edit wrote — warning about a pre-existing
            // diagram elsewhere in the lesson would send the model chasing
            // something the teacher didn't ask it to touch.
            ...contentWarningFields({
              svgWarnings: newString.includes('<svg') ? validateSvgDiagram(newString) : [],
              mathWarnings: validateLessonMath(newString)
            })
          };
        });
      }
    }),

    create_exercise: tool({
      description:
        'Create a new exercise with questions and answer options in this course. Its questions must test what the lessons it covers actually say: read those lessons first with read_lessons. The tool refuses questions for a lesson whose text you have not read in this round, and tells you which ids to read.',
      inputSchema: createExerciseParam,
      execute: async (args) => {
        return executeAgentTool('create_exercise', { orgId, userId, courseId, args }, async () => {
          if (args.lessonId) {
            await verifyLessonBelongsToCourse(args.lessonId, courseId);
          }

          if (args.sectionId) {
            await verifySectionBelongsToCourse(args.sectionId, courseId);
          }

          const boundId = await findBoundEntity(args.planKey, 'exercise');

          if (boundId) {
            const existing = await getExercise(boundId).catch(() => null);
            return {
              id: boundId,
              title: existing?.title ?? args.title,
              questionCount: existing?.questions?.length ?? 0,
              reused: true,
              note: 'This plan item was already built. Reusing the existing exercise — add questions with add_questions instead of creating a duplicate.'
            };
          }

          // Leer antes de preguntar: ver `exercise-reading.ts`.
          if (args.questions.length > 0) {
            const sinLeer = leccionesSinLeer(
              await leccionesQueCubre({ lessonId: args.lessonId, sectionId: args.sectionId }),
              leccionesConocidas
            );

            if (sinLeer.length > 0) throw new Error(avisoLeerAntes(sinLeer));
          }

          const exercise = await createExercise({
            title: args.title,
            description: args.description,
            courseId,
            lessonId: args.lessonId,
            sectionId: args.sectionId,
            order: args.order,
            questions: args.questions.map((q, i) => ({
              question: q.question,
              questionTypeId: q.questionTypeId,
              points: q.points,
              order: q.order ?? i,
              options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect }))
            }))
          });
          await recordBinding(args.planKey, exercise.id);
          return { id: exercise.id, title: exercise.title, questionCount: args.questions.length };
        });
      }
    }),

    update_exercise: tool({
      description:
        "Update an existing exercise's metadata (title, description, linked lesson, section, order, due date, lock state, allow-multiple-attempts). Use this for editing the exercise itself — not for changing its questions. To edit questions, use update_questions; to add questions, use add_questions.",
      inputSchema: updateExerciseParam,
      execute: async (args) => {
        return executeAgentTool('update_exercise', { orgId, userId, courseId, args }, async () => {
          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);

          if (args.lessonId) {
            await verifyLessonBelongsToCourse(args.lessonId, courseId);
          }

          if (args.sectionId) {
            await verifySectionBelongsToCourse(args.sectionId, courseId);
          }

          const updated = await updateExerciseService(args.exerciseId, {
            title: args.title,
            description: args.description,
            lessonId: args.lessonId,
            sectionId: args.sectionId,
            order: args.order,
            dueBy: args.dueBy,
            isUnlocked: args.isUnlocked,
            allowMultipleAttempts: args.allowMultipleAttempts
          });

          return {
            id: updated.id,
            title: updated.title,
            description: updated.description ?? null,
            dueBy: updated.dueBy ?? null,
            updated: true
          };
        });
      }
    }),

    update_exercise_section: tool({
      description:
        'Update the title and/or description of one section inside an exercise (question groups). This is not the same as update_section, which edits course outline sections. Always use ids from get_exercise_details `sections` for this tool.',
      inputSchema: updateExerciseSectionParam,
      execute: async (args) => {
        return executeAgentTool('update_exercise_section', { orgId, userId, courseId, args }, async () => {
          assertValidUuid('Exercise', args.exerciseId);
          assertValidUuid('ExerciseSection', args.exerciseSectionId);

          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);

          const updated = await updateExerciseSectionMetadataService(args.exerciseId, args.exerciseSectionId, {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.description !== undefined ? { description: args.description } : {})
          });

          return { ...updated, updated: true };
        });
      }
    }),

    create_exercise_section: tool({
      description:
        'Create a new section inside an existing exercise. Use this to add a question block before adding or moving questions into it.',
      inputSchema: createExerciseSectionParam,
      execute: async (args) => {
        return executeAgentTool('create_exercise_section', { orgId, userId, courseId, args }, async () => {
          assertValidUuid('Exercise', args.exerciseId);

          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);

          const created = await createExerciseSectionService(args.exerciseId, {
            title: args.title,
            description: args.description,
            order: args.order,
            colorTheme: args.colorTheme,
            afterBehavior: args.afterBehavior
          });

          return { ...created, created: true };
        });
      }
    }),

    add_questions: tool({
      description:
        'Add questions to an existing exercise in this course. When get_exercise_details lists in-exercise sections, pass exerciseSectionId so new questions are added to the correct block. Like create_exercise, it refuses questions for a lesson whose text you have not read in this round.',
      inputSchema: addQuestionsParam,
      execute: async (args) => {
        return executeAgentTool('add_questions', { orgId, userId, courseId, args }, async () => {
          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);

          if (args.exerciseSectionId !== undefined) {
            assertValidUuid('ExerciseSection', args.exerciseSectionId);

            const sections = await getExerciseSectionsByExerciseId(args.exerciseId);
            const belongs = sections.some((section) => section.id === args.exerciseSectionId);

            if (!belongs) {
              throw new AppError(
                'That exercise section was not found on this exercise. Call get_exercise_details and use a section id from the sections array.',
                'VALIDATION_ERROR',
                404
              );
            }
          }

          const existingExercise = await getExercise(args.exerciseId);

          if (args.questions.length > 0) {
            const vinculo = existingExercise as { lessonId?: string | null; sectionId?: string | null };
            const sinLeer = leccionesSinLeer(
              await leccionesQueCubre({
                lessonId: vinculo.lessonId ?? undefined,
                sectionId: vinculo.sectionId ?? undefined
              }),
              leccionesConocidas
            );

            if (sinLeer.length > 0) throw new Error(avisoLeerAntes(sinLeer));
          }
          const existingQuestions = existingExercise.questions || [];
          const nextOrder = existingQuestions.length;

          const newQuestions = args.questions.map((q, i) => ({
            question: q.question,
            questionTypeId: q.questionTypeId,
            points: q.points,
            order: q.order ?? nextOrder + i,
            ...(args.exerciseSectionId !== undefined ? { exerciseSectionId: args.exerciseSectionId } : {}),
            options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect }))
          }));

          const allQuestions = [
            ...existingQuestions.map((eq) => ({
              id: Number(eq.id),
              question: eq.title,
              questionTypeId: eq.questionTypeId,
              points: eq.points,
              order: eq.order,
              options: eq.options.map((o) => ({ id: Number(o.id), label: o.label || '', isCorrect: o.isCorrect }))
            })),
            ...newQuestions
          ];

          await updateExerciseService(args.exerciseId, { questions: allQuestions });
          return {
            exerciseId: args.exerciseId,
            exerciseTitle: existingExercise.title,
            addedCount: args.questions.length,
            totalCount: allQuestions.length
          };
        });
      }
    }),

    update_questions: tool({
      description:
        'Update existing questions in an exercise. Pass only fields you want to change; `id` identifies the question. Optional `exerciseSectionId` moves the question to another in-exercise block (use get_exercise_details section ids), or null to unassign. For NUMERIC, the correct answer is `settings.correctValue` (number) — do NOT add options to NUMERIC questions. For STAR use `settings.correctValue`. For WORD_BANK use `settings.correctAnswers` and `settings.template`. RADIO/CHECKBOX/TRUE_FALSE use `options[].isCorrect` (include option `id` to edit, omit `id` to add). `settings` is shallow-merged with existing settings. Omit `options` entirely to leave existing options untouched.',
      inputSchema: updateQuestionsParam,
      execute: async (args) => {
        return executeAgentTool('update_questions', { orgId, userId, courseId, args }, async () => {
          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);

          const sectionIdsInPatches = new Set<string>();
          for (const patch of args.questions) {
            if (patch.exerciseSectionId === undefined || patch.exerciseSectionId === null) {
              continue;
            }

            assertValidUuid('ExerciseSection', patch.exerciseSectionId);
            sectionIdsInPatches.add(patch.exerciseSectionId);
          }

          if (sectionIdsInPatches.size > 0) {
            const sections = await getExerciseSectionsByExerciseId(args.exerciseId);
            const validIds = new Set(sections.map((section) => section.id));

            for (const sectionId of sectionIdsInPatches) {
              if (!validIds.has(sectionId)) {
                throw new AppError(
                  'That exercise section was not found on this exercise. Call get_exercise_details and use a section id from the sections array.',
                  'VALIDATION_ERROR',
                  404
                );
              }
            }
          }

          const existing = await getExercise(args.exerciseId);

          const merged = buildUpdatedQuestions(
            (existing.questions || []).map((q) => ({
              id: q.id,
              title: q.title,
              questionTypeId: q.questionTypeId,
              points: q.points,
              order: q.order,
              exerciseSectionId: q.exerciseSectionId,
              settings: q.settings,
              options: q.options
            })),
            args.questions,
            args.exerciseId
          );

          await updateExerciseService(args.exerciseId, { questions: merged });

          return {
            exerciseId: args.exerciseId,
            exerciseTitle: existing.title,
            updatedCount: merged.length
          };
        });
      }
    }),

    reorder_content: tool({
      description:
        'Reorder sections, lessons, or exercises in this course. Can change the order of sections, change the order of lessons/exercises within a section, or move items between sections. Use get_course_structure first to see current order, and copy item IDs exactly from that response. Never rewrite or guess UUIDs.',
      inputSchema: reorderContentParam,
      execute: async (args) => {
        return executeAgentTool('reorder_content', { orgId, userId, courseId, args }, async () => {
          if (args.sections) {
            for (const section of args.sections) {
              await verifySectionBelongsToCourse(section.id, courseId);
            }
          }

          if (args.items) {
            for (const item of args.items) {
              if (item.type === 'LESSON') {
                await verifyLessonBelongsToCourse(item.id, courseId);
              } else {
                await verifyExerciseBelongsToCourse(item.id, courseId);
              }

              if (item.sectionId) {
                await verifySectionBelongsToCourse(item.sectionId, courseId);
              }
            }
          }

          return reorderCourseContent(courseId, {
            sections: args.sections,
            items: args.items
          });
        });
      }
    }),

    update_course_landing_page: tool({
      description:
        'Update course-level landing page fields for this course (public title, course description, overview, goals, requirements, the Description section after Requirements, instructor bio, pricing, banner image). The top-level course description field is plain text only—no HTML. All other narrative sections (overview, metadata goals/requirements, metadata description for the block after Requirements, instructor description, etc.) are HTML: paragraphs, lists, line breaks, bold, and italic only—never heading tags (h1–h6) because the UI shows section titles. Title is plain text. The courseId is automatically set — do not pass it.',
      inputSchema: updateCourseLandingPageParam,
      execute: async (args) => {
        return executeAgentTool('update_course_landing_page', { orgId, userId, courseId, args }, async () => {
          const result = await updateCourseLandingPageService(courseId, args as TCourseLandingPageUpdate);

          return {
            courseId: result.course.id,
            title: result.course.title,
            description: result.course.description,
            courseUrl: result.courseUrl,
            bannerImageUrl: result.bannerImageUrl,
            updated: true
          };
        });
      }
    }),

    check_course_go_live_readiness: tool({
      description:
        'Check whether this course is ready to go live. Returns blockers, warnings, suggested fixes, and the public course URL if available. This tool does not publish the course.',
      inputSchema: emptyParam,
      execute: async () => {
        return executeAgentTool('check_course_go_live_readiness', { orgId, userId, courseId }, async () => {
          return getCourseGoLiveReadiness(courseId);
        });
      }
    }),

    go_live_course: tool({
      description:
        'Publish this course only after the teacher explicitly asks to go live. Runs the readiness checklist first, generates a slug when needed, and fails with blockers if the course is not ready.',
      inputSchema: goLiveParam,
      execute: async (args) => {
        return executeAgentTool('go_live_course', { orgId, userId, courseId, args }, async () => {
          const result = await publishCourseWhenReady(courseId);

          return {
            courseId: result.course.id,
            title: result.course.title,
            slug: result.course.slug,
            isPublished: result.course.isPublished,
            readiness: result.readiness
          };
        });
      }
    }),

    /*
     * Borrar. Ver `deletion.ts` para por qué cada una pide el título.
     *
     * Son tres y no una genérica a propósito: una herramienta
     * `delete(type, id)` deja que un `type` equivocado apunte a la tabla que no
     * era, y acá el costo de equivocarse no se puede deshacer.
     */
    delete_lesson: tool({
      description:
        'Delete a lesson from this course, permanently. This also destroys its content, any exercise attached to it, and any learner progress on it — there is no undo. Pass `confirmTitle` with the lesson’s exact current title from get_course_structure; the delete is refused if it does not match. Only delete when the teacher asked for it: emptying a lesson is update_lesson_content with new text, not this.',
      inputSchema: deleteLessonParam,
      execute: async (args) => {
        return executeAgentTool('delete_lesson', { orgId, userId, courseId, args }, async () => {
          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await getLesson(args.lessonId);

          if (!confirmacionCoincide(args.confirmTitle, lesson.title)) {
            throw new Error(
              avisoDeConfirmacion({
                tipo: 'lesson',
                id: args.lessonId,
                declarado: args.confirmTitle,
                real: lesson.title
              })
            );
          }

          await deleteLessonService(args.lessonId);

          return {
            deleted: true,
            id: args.lessonId,
            title: lesson.title,
            note: 'The lesson is gone. If it was part of an approved plan, the Plan Progress block will now show it as missing and you must NOT rebuild it — tell the teacher it is out of the plan too.'
          };
        });
      }
    }),

    delete_exercise: tool({
      description:
        'Delete an exercise from this course, permanently, along with its questions and any learner submissions. There is no undo. Pass `confirmTitle` with the exercise’s exact current title from get_course_structure; the delete is refused if it does not match.',
      inputSchema: deleteExerciseParam,
      execute: async (args) => {
        return executeAgentTool('delete_exercise', { orgId, userId, courseId, args }, async () => {
          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);
          const exercise = await getExercise(args.exerciseId);

          if (!confirmacionCoincide(args.confirmTitle, exercise.title)) {
            throw new Error(
              avisoDeConfirmacion({
                tipo: 'exercise',
                id: args.exerciseId,
                declarado: args.confirmTitle,
                real: exercise.title
              })
            );
          }

          await deleteExerciseForCourseService(courseId, args.exerciseId);

          return { deleted: true, id: args.exerciseId, title: exercise.title };
        });
      }
    }),

    delete_section: tool({
      description:
        'Delete an EMPTY section from this course. If the section still contains lessons or exercises, the delete is refused and they are listed — remove them one by one first, so that destroying a whole branch of the course is never a single call. Pass `confirmTitle` with the section’s exact current title from get_course_structure.',
      inputSchema: deleteSectionParam,
      execute: async (args) => {
        return executeAgentTool('delete_section', { orgId, userId, courseId, args }, async () => {
          await verifySectionBelongsToCourse(args.sectionId, courseId);

          const [sections, items] = await Promise.all([listCourseSections(courseId), getCourseContentItems(courseId)]);
          const section = sections.find((s) => s.id === args.sectionId);

          if (!section) {
            throw new Error(
              `No section with id "${args.sectionId}" exists in this course. Call get_course_structure and use a real id.`
            );
          }

          // Una sección sin título no se puede confirmar por título, y ese es
          // justo el caso en que hay que negarse: sin nada contra qué contrastar,
          // el único control que tenemos no existe.
          if (!section.title) {
            throw new Error(
              `Section ${args.sectionId} has no title, so the confirmation check cannot run and this delete is refused. Give it a title with update_section first, or ask the teacher to delete it from the course page.`
            );
          }

          if (!confirmacionCoincide(args.confirmTitle, section.title)) {
            throw new Error(
              avisoDeConfirmacion({
                tipo: 'section',
                id: args.sectionId,
                declarado: args.confirmTitle,
                real: section.title
              })
            );
          }

          // Una sección borra en cascada todo lo que cuelga de ella. Que eso pase
          // en UNA llamada convierte un id equivocado en la pérdida de un curso
          // entero, así que se exige vaciarla primero: el modelo tiene que pasar
          // por cada hijo, y cada uno de esos pasos vuelve a pedir el título.
          const dentro = items.filter((i) => i.sectionId === args.sectionId);

          if (dentro.length > 0) {
            const lista = dentro.map((i) => `"${i.title ?? '(sin título)'}" (${i.type}, id: ${i.id})`).join(', ');

            throw new Error(
              `Refusing to delete section "${section.title}": it still contains ${dentro.length} item(s) — ${lista}. Nothing was deleted. Delete each one first with delete_lesson / delete_exercise, then delete the section. If the teacher only wanted the section EMPTIED, stop here: it is already empty once those are gone.`
            );
          }

          await deleteCourseSectionService(args.sectionId);

          return { deleted: true, id: args.sectionId, title: section.title };
        });
      }
    }),

    generate_course_plan: tool({
      description:
        'Generate a structured course plan with sections and lessons. Always use this when asked to design or plan a course.',
      inputSchema: coursePlanParam,
      execute: async (args) => {
        return executeAgentTool('generate_course_plan', { orgId, userId, courseId, args }, async () => {
          const envelope = coursePlanParam.parse(args);
          const plan = CoursePlanSchema.parse(envelope.plan);
          const sectionCount = plan.sections.length;
          const itemCount = plan.sections.reduce((sum, section) => sum + section.items.length, 0);

          trackAgentEvent(AgentEvent.PLAN_GENERATED, { orgId, userId, courseId, sectionCount, itemCount });

          // Cobertura: cuáles de estas lecciones tienen material atrás y cuáles
          // no. Se mide ACÁ, con el plan todavía sin construir, porque es el
          // único momento en que la respuesta puede ser "no la escribas".
          //
          // Nunca falla el plan: si las fuentes no se pueden listar, el plan
          // sale igual y sin aviso. Un plan es demasiado caro de rehacer como
          // para perderlo por una consulta que no anduvo.
          let cobertura;
          try {
            const fuentes = await listCourseSources(courseId);
            const items = plan.sections.flatMap((section) => section.items);
            const medida = medirCobertura(items, fuentes);
            const aviso = avisoDeCobertura(medida, fuentes.length);

            if (aviso) {
              cobertura = {
                sourcesAttached: fuentes.length,
                lessonsWithSource: medida.cubiertas,
                lessonsWithoutSource: medida.sinFuente,
                ...(medida.fuentesInexistentes.length > 0
                  ? { citedSourcesThatDoNotExist: medida.fuentesInexistentes }
                  : {}),
                note: aviso
              };
            }
          } catch (error) {
            console.error('[agent-tool] no se pudo medir la cobertura del plan:', error);
          }

          return cobertura ? { ...plan, coverage: cobertura } : plan;
        });
      }
    }),

    ask_template_questions: tool({
      description:
        'Render a structured questionnaire card to the teacher. Pause until the teacher submits via metadata.template.action submit_template_answers or skips via skip_template_form.',
      inputSchema: askTemplateQuestionsParam,
      execute: async (args) => {
        return executeAgentTool(
          'ask_template_questions',
          { orgId, userId, courseId, args },
          async () =>
            ({
              awaiting_user: true as const,
              templateId: args.templateId,
              title: args.title,
              description: args.description,
              fields: args.fields
            }) as const
        );
      }
    }),

    ask_discovery_questions: tool({
      description:
        'Render a dynamic discovery questionnaire card to the teacher (your own labels/options, rendered as-is) to gather missing course requirements before planning. Pause until the teacher submits via metadata.discovery.action submit_discovery_answers or skips via skip_discovery_form.',
      inputSchema: askDiscoveryQuestionsParam,
      execute: async (args) => {
        return executeAgentTool(
          'ask_discovery_questions',
          { orgId, userId, courseId, args },
          async () =>
            ({
              awaiting_user: true as const,
              title: args.title,
              intro: args.intro,
              formId: args.formId,
              fields: args.fields
            }) as const
        );
      }
    }),

    fetch_documentation_url: tool({
      description:
        'Fetch a public documentation URL via Jina Reader. Returns markdown wrapped as untrusted external content plus same-origin links for follow-up fetches.',
      inputSchema: fetchDocumentationUrlParam,
      execute: async (args) => {
        return executeAgentTool('fetch_documentation_url', { orgId, userId, courseId, args }, async () => {
          return fetchDocumentationUrl({
            url: args.url,
            orgId,
            courseId,
            priorMessages
          });
        });
      }
    }),
    /**
     * Finding material, as opposed to reading material you were handed.
     *
     * Runs on Gemini's Grounding with Google Search, but returns links only —
     * titles, URLs and snippets. Reading one is a separate
     * `fetch_documentation_url` call, which is what keeps a single code path
     * between a URL and course material: the 7-day cache, the SSRF guard and the
     * untrusted-content wrapper all live there.
     */
    search_web: tool({
      description:
        'Search the web for pages about a topic. Returns titles, URLs and snippets only — call fetch_documentation_url on a result to read it. Use when you need material the teacher has not supplied.',
      inputSchema: searchWebParam,
      execute: async (args) => {
        return executeAgentTool('search_web', { orgId, userId, courseId, args }, async () => {
          const results = await searchWeb({ query: args.query, limit: args.limit ?? 5 });

          return { query: args.query, results };
        });
      }
    })
  };
}

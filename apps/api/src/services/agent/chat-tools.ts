import { tool, type ToolSet } from 'ai';
import type { z } from 'zod';
import { CoursePlanSchema } from '@cio/ai-assistant';
import { AppError } from '@api/utils/errors';
import { trackAgentEvent, AgentEvent } from '@api/utils/tinybird';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { getExerciseSectionsByExerciseId } from '@cio/db/queries/exercise';
import { QUESTION_TYPE_IDS as QUESTION_TYPE } from '@cio/question-types';
import { bindPlanItem, confirmarItemDelPlan, readPlanRegistry, resolvePlanBinding } from '@cio/db/queries/agent';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { semanticSearchCourse, semanticSearchDocument } from '@api/services/agent/embeddings';
import type { TLocale } from '@cio/db/types';
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
import { redactarTokens, textoParaTokens, verificarTokens } from '@api/services/agent/grounding-tokens';
import {
  anotarChequeo,
  crearRegistroDeAvisos,
  revisarTrasEditar,
  tieneAvisosAbiertos,
  type RegistroDeAvisos
} from '@api/services/agent/revision-tras-editar';
import { fuentesParaContrastar } from '@api/services/agent/fuentes-para-contrastar';
import { piezaConContenido, piezaEquivalente, seccionEquivalente } from '@api/services/agent/pieza-existente';
import { buscarEnFuentes, type FuenteParaBuscar } from '@api/services/agent/source-search';
import { claveDeLectura, notaDeRelectura, type LecturaRegistrada } from '@api/services/agent/relecturas';
import {
  extraerEjemplos,
  extraerPasajesSinFuente,
  quitarPasajesMarcados
} from '@api/services/agent/unsupported-passages';
import {
  avisoDeEvidencia,
  verificarEvidencias,
  type LeccionObjetivo
} from '@api/services/agent/evidencia-de-preguntas';
import type { EscritorDeLecciones } from '@api/services/agent/lesson-writer';
import { cuantasPreguntas, type EscritorDePreguntas } from '@api/services/agent/question-writer';
import { avisoDeCobertura, buscarFuente, medirCobertura } from '@api/services/agent/plan-coverage';
import { avisoDeConfirmacion, confirmacionCoincide } from '@api/services/agent/deletion';
import { leerFuente, LINEAS_POR_LECTURA } from '@api/services/agent/source-index';
import {
  decidirSiGenerarImagen,
  generateLessonImage,
  MAX_IMAGES_PER_ROUND
} from '@api/services/agent/image-generation';
import {
  conAvisoDePresupuesto,
  type PresupuestoDePasos
} from '@api/services/agent/step-budget';
import { buscarEnLecciones } from '@api/services/agent/lesson-search';
import { anotarCambio, registroVacio, type RegistroDeRonda } from '@api/services/agent/round-ledger';
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
  analyzeSourceChangesParam,
  askTemplateQuestionsParam,
  askDiscoveryQuestionsParam,
  confirmChangeAppliedParam,
  coursePlanParam,
  createExerciseParam,
  createExerciseSectionParam,
  createLessonParam,
  createSectionParam,
  questionSchema,
  writeQuestionsParam,
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
  searchLessonsParam,
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
  asignarIdsDeBloque,
  findLessonBlock,
  preserveBlockId,
  replaceLessonBlock,
  summarizeLessonBlocks
} from '@api/services/agent/lesson-blocks';
import {
  crearResolutorDeManijas,
  describirCurso,
  esUuid,
  manijaDe,
  ManijaDesconocida,
  mapaDelCurso,
  resolverBloque,
  resolverEnMapa
} from '@api/services/agent/manijas';
import { barrerValores, valorDelCambio, type AnalistaDeCambios } from '@api/services/agent/cambios-de-fuente';
import { estadoDelContenido } from '@api/services/agent/plan-de-cambios';
import { guardarAnalisisDeFuente } from '@cio/db/queries/agent';

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

/**
 * Tope de texto que devuelve una sola lectura de lecciones (`read_lessons`).
 *
 * Vivía en `exercise-reading.ts`, que se borró con la compuerta de «leer antes
 * de preguntar»: leer ya no es lo que habilita a preguntar —eso lo decide la
 * evidencia de cada pregunta, ver `evidencia-de-preguntas.ts`— pero leer varias
 * lecciones de una sigue siendo útil y sigue necesitando un techo.
 */
const MAX_LECTURA_LECCIONES_CHARS = 60_000;

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
  /**
   * Las fuentes del curso, para contrastar cuando nadie declaró con cuáles se
   * escribió. Se llama sólo si hace falta — ver `fuentes-para-contrastar.ts`.
   */
  cargarFuentesDelCurso?: () => Promise<FuenteVista[]>;
  /** Lo que el escritor avisó que no pudo cubrir, si avisó algo. */
  notaDelEscritor?: string;
  /** Dónde anotar que esta lección cambió. Ver `round-ledger.ts`. */
  registro?: RegistroDeRonda;
  /** Dónde queda anotado que esta lección quedó con avisos. Ver `revision-tras-editar.ts`. */
  avisosDeFundamento?: RegistroDeAvisos;
}): Promise<{
  normalizedContent: string;
  svgWarnings: string[];
  mathWarnings: string[];
  visualWarnings: string[];
  groundingWarnings: string[];
  /** Nombres y números que no están en las fuentes y que nadie marcó. Ver B2. */
  unsupportedTokens: string[];
}> {
  /**
   * Los ids de bloque los pone el servidor, no el editor.
   *
   * Se estampan ACÁ, sobre el contenido ya normalizado y antes de guardar, así
   * que toda lección que el asistente escribe nace direccionable. Antes los
   * ponía sólo TipTap cuando el docente abría y guardaba, y hasta que eso
   * pasara `replace_lesson_block` —el único camino que cambia un dato sin
   * reescribir la lección entera— no existía para esa lección. Ver
   * `lesson-blocks.ts`.
   */
  const normalizedContent = asignarIdsDeBloque(normalizeAgentLessonContent(params.content, params.lessonTitle));

  await upsertLessonLanguageService(params.lessonId, {
    locale: params.locale as 'en',
    content: normalizedContent
  });

  // Anotado DESPUÉS de guardar, nunca antes: el registro dice lo que pasó, no
  // lo que se intentó. Si el guardado falla, esto no se ejecuta y la ronda no
  // reclama un cambio que no existe.
  if (params.registro) anotarCambio(params.registro, 'escribio', params.lessonTitle);

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
   * No sale a la red y no puede fallar la escritura. Va al informe del docente
   * y, desde que el escritor puede declarar un ejemplo, también de vuelta al
   * modelo como compuerta — el porqué del cambio está en `grounding-tokens.ts`.
   *
   * Lo que el escritor marcó se saca ANTES de contar: un ejemplo declarado como
   * inventado ya no es un dato sin respaldo, y seguir contándolo convertiría la
   * marca en un gesto sin efecto.
   *
   * Corre también cuando nadie declaró con qué fuentes se escribió. Antes no:
   * sólo `write_lesson` las pasaba, así que una lección reescrita desde el chat
   * se guardaba con `sources: []` y cero avisos, y el informe se leía como
   * limpio sin que el chequeo hubiera corrido. Ver `fuentes-para-contrastar.ts`.
   */
  const contraste = await fuentesParaContrastar({
    deLaLeccion: params.fuentesDeLaLeccion,
    cargarDelCurso: params.cargarFuentesDelCurso
  });
  const tokenWarnings =
    contraste.fuentes.length > 0
      ? verificarTokens({
          texto: textoParaTokens(quitarPasajesMarcados(normalizedContent)),
          fuentes: contraste.fuentes
        })
      : [];

  /**
   * Lo que el escritor marcó como propio: pasajes que el material no sostiene y
   * ejemplos que inventó a propósito.
   *
   * No es un chequeo: es su declaración, y se guarda tal cual, cada una en su
   * lista. Corre siempre —haya fuentes o no— porque el marcador también sirve en
   * una lección escrita desde conocimiento general, donde lo que hay que marcar
   * es cualquier cosa que suene a política de ESTA empresa.
   *
   * Y no vuelve al modelo como aviso: contarle lo que él mismo acaba de
   * declarar es ruido, y encima lo entrenaría a marcar menos.
   */
  const pasajesSinFuente = extraerPasajesSinFuente(normalizedContent);
  const ejemplos = extraerEjemplos(normalizedContent);

  const groundingWarnings = await fundamento;

  /**
   * Queda anotado para que una edición posterior pueda volver a mirar.
   *
   * Se anota SIEMPRE, con avisos o sin ellos: una lección reescrita limpia se
   * desmarca, y la próxima edición no paga un rechequeo que no hace falta.
   */
  if (params.avisosDeFundamento) {
    anotarChequeo(params.avisosDeFundamento, params.lessonId, {
      avisos: groundingWarnings,
      soloFuentes: params.fuentesDeLaLeccion
    });
  }

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
      // Contra qué se buscaron los datos: las fuentes de la lección, todas las
      // del curso (nadie declaró cuáles), o ninguna. Sin esto, «0 avisos» no
      // distingue «limpia» de «no se contrastó».
      checkedAgainst: contraste.alcance,
      groundingWarnings,
      diagramWarnings: svgWarnings,
      tokenWarnings,
      unsupportedPassages: pasajesSinFuente,
      examples: ejemplos,
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
    groundingWarnings,
    // Sólo cuando hubo contra qué contrastar. Sin fuentes el chequeo no corrió,
    // y devolver una lista vacía se leería como «limpia», que es otra cosa.
    unsupportedTokens: contraste.alcance !== 'none' ? redactarTokens(tokenWarnings) : []
  };
}

/** The `note` that goes with whatever came back broken, or nothing. */
function contentWarningFields(warnings: {
  svgWarnings: string[];
  mathWarnings: string[];
  visualWarnings?: string[];
  groundingWarnings?: string[];
  unsupportedTokens?: string[];
}) {
  const visualWarnings = warnings.visualWarnings ?? [];
  const groundingWarnings = warnings.groundingWarnings ?? [];
  const unsupportedTokens = warnings.unsupportedTokens ?? [];
  const notes: string[] = [];
  // El fundamento va primero a propósito. Los otros tres avisos son sobre cómo
  // se ve la lección; éste es sobre si lo que dice es cierto, y si hay que
  // elegir uno solo para atender, es ése.
  if (groundingWarnings.length > 0) notes.push('parts of it are not supported by the sources');
  if (unsupportedTokens.length > 0) notes.push('some names or numbers in it are neither in the sources nor marked');
  if (warnings.svgWarnings.length > 0) notes.push('the diagram(s) above will not render legibly');
  if (warnings.mathWarnings.length > 0) notes.push('the formula(s) above will not render as maths');
  if (visualWarnings.length > 0) notes.push('it has no diagram and no picture');

  if (notes.length === 0) return {};

  return {
    ...(groundingWarnings.length > 0 ? { groundingWarnings } : {}),
    ...(unsupportedTokens.length > 0 ? { unsupportedTokens } : {}),
    ...(warnings.svgWarnings.length > 0 ? { svgWarnings: warnings.svgWarnings } : {}),
    ...(warnings.mathWarnings.length > 0 ? { mathWarnings: warnings.mathWarnings } : {}),
    ...(visualWarnings.length > 0 ? { visualWarnings } : {}),
    note:
      `The lesson was saved, but ${notes.join(', and ')}. Fix that now with edit_lesson_content before moving on${groundingWarnings.length > 0 ? ', starting with the grounding warnings' : ''}.` +
      // La salida correcta para un token no es la misma que para lo demás: casi
      // siempre es un ejemplo que el escritor inventó y no declaró, y borrarlo
      // empeoraría la lección. Se dice cuál es, porque un aviso sin salida es un
      // aviso que se aprende a ignorar.
      //
      // Y el orden de las salidas importa tanto como cuáles son. Antes empezaba
      // por «marcalo… o borralo» y terminaba sin decir CÓMO: medido el
      // 2026-09-22, el modelo entendió «rehacé la lección» y la reescribió
      // entera dos veces, perdiendo tres ejemplos que ya estaban marcados. Acá
      // se nombra primero la herramienta quirúrgica y se prohíbe la reescritura
      // explícitamente.
      (unsupportedTokens.length > 0
        ? ' For the names/numbers: they are not in the sources and are not marked. Mark each one as an example you made up (data-ejemplo) with replace_lesson_block on that block, or as an unsupported claim (data-sin-fuente); delete it only if it is wrong. Never rewrite the lesson for this, and do not invent a source for it.'
        : '')
  };
}

/**
 * Lo que se le agrega al brief para que el escritor arregle lo que el servidor
 * encontró, sin rehacer la lección.
 *
 * «Keep everything else identical» es la frase que hace la diferencia: sin ella
 * el escritor entiende el pedido como una reescritura, devuelve otra lección
 * entera y el arreglo cuesta una tirada nueva de invenciones. Con ella, el
 * cambio típico es agregar un atributo.
 */
function briefDelRebote(written: { unsupportedTokens: string[]; groundingWarnings: string[] }): string {
  const partes = ['IMPORTANT — the server checked what you just wrote and found problems. Fix ONLY these.'];

  if (written.unsupportedTokens.length > 0) {
    partes.push(
      'These names/numbers are not in the source material and are not marked:\n' +
        written.unsupportedTokens.map((token) => `- ${token}`).join('\n') +
        '\nFor each one: if it belongs to an example you made up, mark the smallest element that carries it with ' +
        'data-ejemplo; if it is a claim about the organisation the material does not state, mark it with ' +
        'data-sin-fuente; if it is neither, remove it or replace it with what the material actually says. ' +
        'Never invent a source for it.'
    );
  }

  if (written.groundingWarnings.length > 0) {
    partes.push(
      'The grounding check reported:\n' +
        written.groundingWarnings.map((aviso) => `- ${aviso}`).join('\n') +
        '\nRewrite those passages so they say only what the material supports, mark them, or delete them.'
    );
  }

  partes.push(
    'Return the WHOLE lesson again, with everything else identical to what you just wrote — same structure, ' +
      'same wording, same diagrams, same images. This is a correction, not a rewrite.'
  );

  return partes.join('\n\n');
}

/** Hasta dónde se recorta el motivo de un rebote: entra en una línea de log y en el informe. */
const MAX_MOTIVO_DE_REBOTE = 300;

function recortarMotivo(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();

  return limpio.length > MAX_MOTIVO_DE_REBOTE ? `${limpio.slice(0, MAX_MOTIVO_DE_REBOTE)}…` : limpio;
}

/**
 * Una edición no puede llevarse puestos los ejemplos marcados.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22. El bloque de una lección era un `<ul>` con tres
 * `<li data-ejemplo>` («Caso 1/2/3»); la orden de trabajo decía «todavía está»
 * por un número que vivía dentro del Caso 2, y el modelo reemplazó el `<ul>`
 * ENTERO por un `<p>`. En la otra lección, un `<ul>` con cuatro casos marcados
 * terminó siendo un `<svg>`. Ocho marcas quedaron en una.
 *
 * El mecanismo es siempre el mismo: la orden pide cambiar UN dato, y la forma
 * más corta de hacer desaparecer ese dato es tirar el elemento que lo contiene.
 * Nadie miente y nadie desobedece — el riel medía «¿sigue el 4400?» y no
 * «¿sigue estando lo demás?».
 *
 * ── Por qué es una negativa y no un aviso ────────────────────────────────────
 *
 * Un aviso después de guardar llega tarde: el contenido ya no está y nadie
 * tiene el texto viejo para reponerlo. Y una marca `data-ejemplo` no es
 * decoración: es contenido que el docente conserva a propósito (ver
 * `unsupported-passages.ts`). Un reemplazo VACÍO sí se permite: borrar un
 * bloque es una decisión, no un accidente.
 */
function describirEjemplo(ejemplo: { texto: string; porque: string }): string {
  const descripcion = ejemplo.porque.trim() || ejemplo.texto.trim();

  return descripcion.length > 60 ? `${descripcion.slice(0, 60)}…` : descripcion;
}

function avisoDePerdidaDeEjemplos(params: {
  /** «This block» / «This lesson»: qué se estaba por pisar. */
  alcance: 'block' | 'lesson';
  antes: ReturnType<typeof extraerEjemplos>;
  faltan: number;
}): string {
  const donde = params.alcance === 'block' ? 'This block' : 'This lesson';
  const comoCambiar =
    params.alcance === 'block'
      ? 'change the value inside them (edit_lesson_content with the exact old fragment, or replace_lesson_block keeping every element marked data-ejemplo) — do not replace the list.'
      : 'change the value inside them (a smaller edit_lesson_content whose newString keeps every element marked data-ejemplo) — do not replace the list.';

  return (
    `${donde} holds ${params.antes.length} marked example(s) (${params.antes.map(describirEjemplo).join('; ')}) ` +
    `and your replacement drops ${params.faltan} of them. Marked examples are content the teacher keeps: ` +
    `${comoCambiar} To delete one example because it is wrong, replace only that element.`
  );
}

/** Nada se guarda si el reemplazo pierde marcas: se tira antes de tocar la base. */
function negarPerdidaDeEjemplos(params: {
  alcance: 'block' | 'lesson';
  antes: string;
  despues: string;
  /** Un reemplazo vacío: el modelo pidió BORRAR, y eso es una decisión, no un accidente. */
  esBorrado: boolean;
}): void {
  if (params.esBorrado) return;

  const antes = extraerEjemplos(params.antes);
  const despues = extraerEjemplos(params.despues);

  if (despues.length >= antes.length) return;

  throw new Error(avisoDePerdidaDeEjemplos({ alcance: params.alcance, antes, faltan: antes.length - despues.length }));
}

/**
 * Elementos que no pueden ser el envoltorio de un bloque suelto.
 *
 * Medido en la misma ronda: el modelo reemplazó un `<ul>` por un `<li>` suelto
 * y el servidor lo guardó. HTML inválido que el editor del dashboard no puede
 * volver a abrir — y no da ningún error en ningún lado.
 */
const NO_SON_BLOQUES = new Set(['li', 'td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'option']);

function negarBloqueSuelto(html: string): void {
  const externo = html.trim().match(/^<([a-z][a-z0-9]*)\b/i)?.[1]?.toLowerCase();

  if (!externo || !NO_SON_BLOQUES.has(externo)) return;

  throw new Error(
    `The replacement must be a standalone block: wrap the <${externo}> in <ul> or <ol> (a table row in <table>).`
  );
}

/** Dos preguntas son la misma cuando dicen lo mismo: es lo único comparable entre dos tandas. */
function claveDePregunta(pregunta: { question: string }): string {
  return pregunta.question.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Lo que se le devuelve al escritor de preguntas cuando omitió las opciones. */
function notaDeOpciones(sinOpciones: ReadonlyArray<{ question: string }>): string {
  return (
    `IMPORTANT — the server refused ${sinOpciones.length} of the questions you just wrote: they came back ` +
    `without options, and a question with no options is one the learner cannot answer.\n` +
    sinOpciones.map((pregunta) => `- ${pregunta.question}`).join('\n') +
    '\n\nWrite those questions again, WITH their options. A RADIO question needs at least two options with ' +
    'exactly one marked correct; a CHECKBOX needs at least two with at least one marked correct; a TRUE_FALSE ' +
    'needs exactly two options (the course language\'s words for True and False) with exactly one marked ' +
    'correct. Every question still quotes, in `evidence`, a sentence of the lessons copied verbatim.'
  );
}

/**
 * La respuesta de una numérica, del campo plano del escritor a `settings`.
 *
 * ── Por qué el servidor traduce en vez de pedir la forma final ──────────────
 *
 * `settings` es un mapa libre y el escritor lo dejaba vacío: medido el
 * 2026-09-22, 5 numéricas escritas y 5 descartadas por no traer
 * `settings.correctValue`, todas con su evidencia impecable. Un campo con
 * nombre y tipo (`numericAnswer`) sí se completa — ver `camposDelEscritor` en
 * `question-writer.ts`—, y la traducción a la forma que la base espera es un
 * renglón que el servidor puede hacer sin equivocarse nunca.
 *
 * Lo que el escritor haya puesto en `settings` gana: si acertó la forma final,
 * no se le pisa.
 */
function conRespuestaNumerica<T extends { questionTypeId: number; settings?: Record<string, unknown> }>(
  pregunta: T & { numericAnswer?: number; numericTolerance?: number }
): T {
  if (pregunta.questionTypeId !== QUESTION_TYPE.NUMERIC) return pregunta;
  if (typeof pregunta.numericAnswer !== 'number' || !Number.isFinite(pregunta.numericAnswer)) return pregunta;

  const settings = pregunta.settings ?? {};

  return {
    ...pregunta,
    settings: {
      ...settings,
      correctValue: settings.correctValue ?? pregunta.numericAnswer,
      ...(typeof pregunta.numericTolerance === 'number' && settings.tolerance === undefined
        ? { tolerance: pregunta.numericTolerance }
        : {})
    }
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
    /**
     * El sub-agente que escribe las preguntas de un ejercicio a partir del
     * texto de las lecciones. Ver `question-writer.ts`.
     *
     * Ausente, `write_questions` se niega y dice cómo seguir: el constructor
     * puede escribirlas él con `create_exercise`, que ahora exige la evidencia
     * de cada pregunta igual que acá.
     */
    escribirPreguntas?: EscritorDePreguntas;
    /**
     * El sub-agente que compara una fuente nueva contra el curso ya escrito.
     * Ver `cambios-de-fuente.ts`.
     *
     * Ausente, `analyze_source_changes` se niega: sin él la alternativa es que
     * el agente lea el documento y las lecciones y decida solo, que es
     * exactamente lo que costó 153 segundos y cuatro reescrituras por tres
     * datos.
     */
    analizarCambios?: AnalistaDeCambios;
    /**
     * En qué paso de la ronda va. Ausente, las herramientas no avisan nada —
     * que es lo que corresponde donde no hay un techo de pasos que gastar.
     */
    presupuesto?: PresupuestoDePasos;
    /** Dónde anotar lo que la ronda cambió de verdad. Ver `round-ledger.ts`. */
    registro?: RegistroDeRonda;
    /**
     * El idioma del curso, resuelto por la ronda.
     *
     * Se pasa en vez de dejarlo en los argumentos con default `'en'`, que es la
     * trampa que ya cobró una corrida entera: un curso en español buscado con
     * locale `en` no encuentra su propio contenido y el resultado vacío se lee
     * como "eso no está en el curso".
     */
    locale?: string;
    /**
     * Las lecciones que la orden de trabajo de esta ronda manda editar.
     *
     * Una edición sobre una lección que el plan mandó cambiar se rechequea
     * entera aunque nadie la haya marcado antes. El motivo es el mismo que el
     * de `revision-tras-editar.ts` y está medido: cambiar un dato por bloques
     * es lo correcto, pero un bloque nuevo es texto nuevo, y el único momento
     * en que se puede ver si trajo una afirmación que el material no sostiene
     * es justo después de escribirlo.
     *
     * Ausente fuera de un plan de cambios: entonces sólo se rechequea lo que
     * esta misma ronda dejó marcado, como hasta ahora.
     */
    leccionesBajoOrdenDeTrabajo?: ReadonlySet<string>;
    /**
     * Qué le manda hacer el plan a cada lección con una orden pendiente.
     *
     * Es el mismo conjunto que `leccionesBajoOrdenDeTrabajo`, con el dato que
     * ahí no hace falta y acá lo es todo: si la orden dice `edit` o `rewrite`.
     * Con `edit`, reescribir la lección entera está PROHIBIDO, no desaconsejado
     * — ver `negarReescrituraBajoOrden`.
     */
    accionPorLeccion?: ReadonlyMap<string, 'edit' | 'rewrite'>;
  }
): ToolSet {
  const conversationId = _options?.conversationId ?? null;
  const searchableDocumentId = _options?.searchableDocumentId ?? null;
  const isBuilding = _options?.isBuilding ?? false;
  const verificarFundamento = _options?.verificarFundamento;
  const redisParaFuentes = _options?.redis;
  const escribirLeccion = _options?.escribirLeccion;
  const escribirPreguntas = _options?.escribirPreguntas;
  const analizarCambios = _options?.analizarCambios;
  const locale = _options?.locale ?? 'en';
  // Sin registro provisto, se anota en uno propio que nadie lee: asi las
  // llamadas a `anotarCambio` no tienen que preguntar si existe.
  const registro = _options?.registro ?? registroVacio();
  // Por ronda, igual que `registro` y por el mismo motivo: dos rondas
  // simultáneas se pisarían el contador. Ver `revision-tras-editar.ts`.
  const avisosDeFundamento = crearRegistroDeAvisos();
  const leccionesBajoOrdenDeTrabajo = _options?.leccionesBajoOrdenDeTrabajo;
  const accionPorLeccion = _options?.accionPorLeccion;

  /**
   * El riel: bajo una orden de EDICIÓN, la lección no se reescribe entera.
   *
   * ── Por qué es una negativa y no un consejo ──────────────────────────────
   *
   * El prompt ya decía «no reescribas para cambiar un dato», y el resultado
   * medido el 2026-09-22 fue éste: el servidor devolvió un aviso que el modelo
   * no podía satisfacer bloque por bloque (una etiqueta de diagrama, ver
   * `grounding-tokens.ts`), y a la segunda vuelta hizo lo único que se le
   * ocurrió para cerrarlo — `update_lesson_content` con la lección entera. En
   * una de las dos lecciones desaparecieron los tres «Caso 1/2/3» que ya
   * estaban marcados como ejemplo: 3 `data-ejemplo` → 0, reemplazados por un
   * diagrama que nadie pidió.
   *
   * Una reescritura no es una edición más grande: es una lección nueva. Todo lo
   * que el docente no pidió cambiar está en juego, y el plan que él aprobó dice
   * exactamente qué pidió. Así que acá se contesta que no, con el camino
   * correcto adentro del mismo mensaje.
   *
   * Con `rewrite` el camino es el escritor y no la mano del constructor: el
   * escritor escribe contra las fuentes y lo que devuelve se contrasta contra
   * ellas; un cuerpo tipeado por el constructor —que durante una construcción
   * no leyó ninguna fuente— se salta todo eso.
   */
  function negarReescrituraBajoOrden(
    lessonId: string,
    herramienta: 'write_lesson' | 'update_lesson_content' | 'create_lesson'
  ): void {
    const accion = accionPorLeccion?.get(lessonId);

    if (!accion) return;

    if (accion === 'edit') {
      throw new Error(
        'This lesson is under an EDIT order: change only the blocks the Plan Progress names, with ' +
          'replace_lesson_block (or edit_lesson_content for a fragment). A full rewrite is not allowed here ' +
          'because it discards everything the teacher did not ask to change — in one measured round it deleted ' +
          'three worked examples. If the lesson really needs to be written again, tell the teacher.'
      );
    }

    if (herramienta !== 'write_lesson') {
      throw new Error(
        'This lesson is under a REWRITE order: write it with write_lesson, passing its lessonId and the sources ' +
          'that carry it. A body you type yourself is never checked against the material, which is the whole ' +
          'point of rewriting it from the sources.'
      );
    }
  }
  /**
   * Lecciones que ya se rechequearon por orden de trabajo en esta ronda.
   *
   * Tope de uno por lección, y sólo para las que NO están marcadas: editar una
   * lección larga son diez o quince llamadas a `replace_lesson_block`, y salir
   * a la red en cada coma costaría quince verificaciones del mismo texto casi
   * idéntico. Una lección marcada no cuenta contra este tope: ahí el lazo está
   * abierto y el rechequeo es justamente lo que lo cierra.
   */
  const rechequeadasPorOrden = new Set<string>();

  /**
   * El texto de las fuentes del curso, leído una sola vez por ronda y sólo si
   * alguna herramienta lo pide: la búsqueda (`search_document` sin adjunto) y el
   * contraste de una lección guardada sin fuentes declaradas
   * (`fuentes-para-contrastar.ts`).
   */
  let documentosDelCursoPromesa: Promise<FuenteParaBuscar[]> | null = null;
  const documentosDelCurso = (): Promise<FuenteParaBuscar[]> => {
    documentosDelCursoPromesa ??= listCourseSources(courseId).then((documentos) =>
      documentos.map((documento) => ({ id: documento.id, fileName: documento.fileName, text: documento.text ?? '' }))
    );
    return documentosDelCursoPromesa;
  };
  const cargarFuentesDelCurso = (): Promise<FuenteVista[]> =>
    documentosDelCurso().then((documentos) => documentos.map(({ fileName, text }) => ({ fileName, text })));

  /**
   * Lo que se vuelve a mirar después de una edición quirúrgica.
   *
   * Los dos tools que editan sin reescribir —`replace_lesson_block` y
   * `edit_lesson_content`— no pasan por `writeLessonBody`, así que los chequeos
   * de una lección entera no corren solos ahí. Rechequean en dos casos:
   *
   * - La lección quedó MARCADA en esta ronda: el lazo está abierto y cerrarlo
   *   es el motivo de `revision-tras-editar.ts` (arreglar la frase citada no es
   *   arreglar la afirmación: seguía en otros cinco lugares).
   * - La lección está en la ORDEN DE TRABAJO de la ronda: el plan mandó
   *   cambiarla, o sea que lo que se acaba de escribir es texto nuevo. Acá el
   *   tope es uno por lección y por ronda, porque una edición por bloques son
   *   diez o quince llamadas y no se sale a la red por cada coma.
   *
   * Los dos chequeos van juntos y sobre la lección ENTERA, porque el recorte al
   * fragmento es justamente el defecto que se está tapando.
   */
  async function revisarLeccionEditada(params: {
    lessonId: string;
    lessonTitle: string;
    /** La lección completa YA guardada. */
    contenido: string;
  }): Promise<{ groundingWarnings?: string[]; unsupportedTokens?: string[]; groundingResolved?: boolean }> {
    const marcada = tieneAvisosAbiertos(avisosDeFundamento, params.lessonId);
    const porOrden =
      !marcada &&
      (leccionesBajoOrdenDeTrabajo?.has(params.lessonId) ?? false) &&
      !rechequeadasPorOrden.has(params.lessonId);

    if (!marcada && !porOrden) return {};

    // Se anota antes de salir a la red: si la llamada falla, el tope igual se
    // gastó. Lo contrario —anotar después— haría que una caída del proveedor
    // habilitara un reintento por cada bloque que quede por editar.
    if (porOrden) rechequeadasPorOrden.add(params.lessonId);

    const revision = await revisarTrasEditar({
      registro: avisosDeFundamento,
      lessonId: params.lessonId,
      lessonTitle: params.lessonTitle,
      contenido: params.contenido,
      verificarFundamento,
      bajoOrdenDeTrabajo: porOrden
    });

    if (!revision) return {};

    /**
     * Y la mitad determinista, que es la que caza lo otro.
     *
     * El verificador con modelo mira afirmaciones; un bloque nuevo que trae un
     * teléfono o un nombre que no está en ninguna fuente pasa por debajo de él.
     * Contra las fuentes del CURSO —no las de la lección, que acá no se saben— y
     * sin lo que el escritor marcó.
     */
    const contraste = await fuentesParaContrastar({ cargarDelCurso: cargarFuentesDelCurso });
    const unsupportedTokens =
      contraste.alcance !== 'none'
        ? redactarTokens(
            verificarTokens({
              texto: textoParaTokens(quitarPasajesMarcados(params.contenido)),
              fuentes: contraste.fuentes
            })
          )
        : [];

    return {
      groundingWarnings: revision.groundingWarnings,
      unsupportedTokens,
      ...(revision.resuelto ? { groundingResolved: true } : {})
    };
  }

  /** Lo que `read_source` ya devolvió en esta ronda. Ver `relecturas.ts`. */
  const lecturasDeLaRonda = new Map<string, LecturaRegistrada>();

  // Images are the only tool here that spends money per call rather than per
  // token, so the guard has to live where the calls are counted. The tool set is
  // rebuilt for each round, which makes this counter per-round by construction.
  let imagesGenerated = 0;

  // Y el contador global no alcanza: la regla real es una imagen POR LECCIÓN, y
  // para verla hay que saber de qué lección se trata. Ver
  // `decidirSiGenerarImagen`, que documenta la ronda que pagó cuatro imágenes
  // que nadie insertó.
  const leccionesConImagen = new Set<string>();

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
   * Manijas cortas: toda herramienta acepta `S2.L3` donde acepta un id.
   *
   * El mapa se carga una vez por ronda y se tira cuando algo se crea, se borra
   * o se mueve — las manijas son POSICIONALES, así que una sección nueva corre
   * las de todo lo que venía después. Ver `manijas.ts`.
   */
  const manijas = crearResolutorDeManijas(() =>
    Promise.all([listCourseSections(courseId), getCourseContentItems(courseId)]).then(([secciones, items]) =>
      mapaDelCurso(secciones, items)
    )
  );

  /**
   * El bloque de preguntas de un ejercicio: `S1.E1.B2`, `B2`, o su id.
   *
   * Los bloques no están en el mapa del curso —viven colgados de un ejercicio—
   * así que se resuelven contra la lista de ese ejercicio, y sólo cuando hace
   * falta: un id se contesta sin salir a buscar nada.
   */
  async function resolverBloqueDeEjercicio(exerciseId: string, valor: string): Promise<string> {
    if (esUuid(valor)) return valor.trim();

    const bloques = await getExerciseSectionsByExerciseId(exerciseId);

    return resolverBloque(
      valor,
      bloques.map((bloque) => ({
        id: bloque.id,
        title: bloque.title,
        order: bloque.order,
        createdAt: bloque.createdAt
      })),
      manijaDe(await manijas.mapa(), exerciseId)
    );
  }

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

  /** Lo que se le contesta al modelo cuando la lección ya existía, escrita, y no se tocó. */
  async function leccionYaEscrita(leccion: { id: string; title: string; order: number }) {
    return {
      id: leccion.id,
      handle: await manijas.manijaDe(leccion.id),
      title: leccion.title,
      order: leccion.order,
      reused: true,
      contentWritten: false,
      note: 'This section already has this lesson, with content, so nothing was created and it was NOT overwritten. Treat it as built. If the teacher explicitly asked to rewrite it, call write_lesson with this lessonId.'
    };
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
  }): Promise<{
    id: string;
    title: string;
    order: number;
    reused: boolean;
    /**
     * Sólo para una lección hallada por título: ya tenía contenido. Quien llama
     * NO la escribe. Una atadura del registro la construyó esta conversación y
     * reescribirla es un reintento; una hallada por título la escribió otra, y
     * pisarla borraría el trabajo de alguien.
     */
    yaEscritaPorOtro?: boolean;
  }> {
    // La manija se resuelve ACÁ y no en cada herramienta: `create_lesson` y
    // `write_lesson` comparten este camino, y una manija que funcionara en una
    // sola de las dos sería peor que no tenerla.
    const sectionId = await manijas.seccion(args.sectionId);

    await verifySectionBelongsToCourse(sectionId, courseId);

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

    // Sin atadura: mirar si esta sección ya tiene esta lección. Ver pieza-existente.ts.
    const equivalente = piezaEquivalente(await getCourseContentItems(courseId), {
      tipo: 'lesson',
      sectionId,
      titulo: args.title
    });

    if (equivalente?.id) {
      await recordBinding(args.planKey, equivalente.id);

      return {
        id: equivalente.id,
        title: equivalente.title ?? args.title,
        order: equivalente.order ?? args.order,
        reused: true,
        yaEscritaPorOtro: piezaConContenido(equivalente)
      };
    }

    const lesson = await createLesson(courseId, {
      title: args.title,
      courseId,
      sectionId,
      order: args.order
    });
    // El curso cambió de forma: la lección nueva todavía no tiene manija, y las
    // de sus hermanas pueden haberse corrido.
    manijas.invalidar();
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

  /**
   * El texto plano contra el que se comprueba la evidencia de cada pregunta.
   *
   * Cuando el ejercicio no cuelga de ninguna lección se miran TODAS las del
   * curso, y no ninguna: ese es el examen final, que vive en una sección sin
   * lecciones y evalúa el curso entero. Dejarlo sin nada contra qué comparar era
   * dejar justo al examen más largo sin ningún control.
   */
  async function textosParaEvidencia(
    objetivo: readonly LeccionObjetivo[]
  ): Promise<{ textos: string[]; lecciones: LeccionObjetivo[] }> {
    const contenidos = await getCourseLessonContents(courseId, locale as TLocale);
    const ids = new Set(objetivo.map((leccion) => leccion.id));
    const elegidas = ids.size > 0 ? contenidos.filter((fila) => ids.has(fila.id)) : contenidos;

    return {
      textos: elegidas.map((fila) => textoDeLeccion(fila.content ?? '')).filter((texto) => texto.length > 0),
      lecciones: elegidas.map((fila) => ({ id: fila.id, title: fila.title }))
    };
  }

  /**
   * La compuerta: ninguna pregunta se crea si su evidencia no está en el curso.
   *
   * Rechaza la llamada ENTERA y no las preguntas malas, a diferencia de
   * `write_questions`. Acá las escribió el modelo que está conversando, tiene
   * las lecciones a un `read_lessons` de distancia y puede rehacer la llamada
   * con las frases bien copiadas; crear ocho de diez en silencio le escondería
   * que dos se perdieron.
   */
  async function exigirEvidencias(
    preguntas: ReadonlyArray<{ question: string; evidence?: string | null }>,
    objetivo: readonly LeccionObjetivo[]
  ): Promise<void> {
    if (preguntas.length === 0) return;

    const { textos, lecciones } = await textosParaEvidencia(objetivo);
    const { rechazadas } = verificarEvidencias(preguntas, textos);

    if (rechazadas.length > 0) throw new Error(avisoDeEvidencia(rechazadas, lecciones));
  }

  /**
   * La evidencia viaja con la pregunta, en `settings`.
   *
   * No es decoración: es lo que permite auditar después de qué frase salió cada
   * pregunta, igual que el informe de construcción de una lección dice de qué
   * fuente salió. Sin guardarla, el control sólo existiría en el instante de la
   * creación y nadie podría revisarlo.
   */
  function settingsConEvidencia(pregunta: {
    evidence?: string | null;
    settings?: Record<string, unknown>;
  }): Record<string, unknown> | undefined {
    const evidence = pregunta.evidence?.trim();

    if (!evidence) return pregunta.settings;

    return { ...(pregunta.settings ?? {}), evidence };
  }

  const herramientas: ToolSet = {
    read_source: tool({
      description:
        'Read one of the source documents the teacher attached to this course, by id from the "## Course Sources — index" list. Returns the text with line numbers, in pages: pass `offset` (the line to start at) and `limit` to keep reading a long document. Read the source BEFORE writing anything that claims to come from it — the index tells you what exists, this tells you what it says. If you do not know which source covers a topic, search first with search_document instead of opening them one by one. Reading the same lines of the same source twice in one round is refused: older results are trimmed from your context, so a second read would show you nothing new.',
      inputSchema: readSourceParam,
      execute: async (args) => {
        return executeAgentTool('read_source', { orgId, userId, courseId, args }, async () => {
          if (!redisParaFuentes) {
            throw new Error('Source reading is unavailable on this turn.');
          }

          const clave = claveDeLectura({
            sourceId: args.sourceId,
            offset: args.offset,
            limit: args.limit,
            limitePorDefecto: LINEAS_POR_LECTURA
          });
          const previa = lecturasDeLaRonda.get(clave);

          // Contestado y no lanzado: un error invita a reintentar, y reintentar
          // es exactamente el bucle que esto corta. Ver `relecturas.ts`.
          if (previa) {
            return { alreadyRead: true, fileName: previa.fileName, note: notaDeRelectura(previa) };
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

          // Anotada DESPUÉS de leer: una lectura que falló no cuenta como hecha.
          lecturasDeLaRonda.set(clave, {
            fileName: lectura.fileName,
            desde: lectura.desdeLinea,
            hasta: lectura.hastaLinea,
            paso: _options?.presupuesto?.paso
          });

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
        'Search the text of the course source documents for the passages about a topic, instead of reading whole sources — or, when a document is attached to this chat, search that document. Each course-source passage comes with every source that contains it and the line where it starts. Use it BEFORE read_source: to find which sources carry a lesson (pass exactly those to write_lesson), or where in a source to read.',
      inputSchema: searchDocumentParam,
      execute: async (args) => {
        return executeAgentTool('search_document', { orgId, userId, courseId, args }, async () => {
          /**
           * Sin documento adjunto, busca en las fuentes del curso.
           *
           * Antes contestaba «no hay documento adjunto» y nada más. Medido: el
           * agente la llamó seis veces en una ronda, recibió seis veces esa
           * frase, y resolvió leyendo las fuentes enteras — 31 lecturas, sin
           * llegar nunca a las dos que tenían el tema. Ver `source-search.ts`.
           */
          if (!searchableDocumentId) {
            const fuentes = await documentosDelCurso().catch((error: unknown) => {
              console.error('[search_document] no se pudieron leer las fuentes del curso:', error);
              return [] as FuenteParaBuscar[];
            });

            if (fuentes.length === 0) {
              return {
                passages: [],
                note: 'This course has no source documents to search, and no document is attached to this chat.'
              };
            }

            const resultado = buscarEnFuentes({ fuentes, consulta: args.query, maxPasajes: args.limit });

            return {
              searched: 'course_sources',
              ...resultado,
              note:
                resultado.passages.length > 0
                  ? 'Each passage lists every source that contains it and the line where it starts there. sourcesWithMatches is ordered strongest first: a source whose best passage matches only two of your words usually mentions the topic in passing and does not carry it. To have a lesson written, pass write_lesson the sources whose passages actually cover it. To read around a passage, call read_source with its sourceId and offset = fromLine.'
                  : 'No passage in the course sources contains these words. Try other words (a synonym, fewer words), or tell the teacher the material does not cover this — do not read every source looking for it.'
            };
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
          // La manija se resuelve ANTES de decidir: el tope es por LECCIÓN, y si
          // la misma lección llegara una vez como `S2.L3` y otra como id, el
          // contador las contaría como dos y pagaría dos imágenes.
          const lessonId = args.lessonId ? await manijas.leccion(args.lessonId) : undefined;
          // Refused rather than thrown: an error would push the model to retry,
          // which is precisely what must not happen when the reason is spend.
          const decision = decidirSiGenerarImagen({
            lessonId,
            yaIlustradas: leccionesConImagen,
            generadasEnLaRonda: imagesGenerated
          });

          if (!decision.generar) {
            return {
              generated: false,
              note:
                decision.motivo === 'ya_tiene_imagen'
                  ? // El caso medido: cuatro lecciones ilustradas y el modelo
                    // volvio a pedir las mismas cuatro con otro subject. Se le
                    // dice que ya la tiene y donde esta, para que no lo lea
                    // como un fallo que conviene reintentar.
                    'That lesson already got its illustration in this round — one picture per lesson is the limit, and the <img> is already in its body. Do not generate another for it: if the picture is wrong, change it with edit_lesson_content, and otherwise move on to the next lesson.'
                  : `This round has already generated its limit of ${MAX_IMAGES_PER_ROUND} images. Continue without one — write the lesson, or draw an inline <svg> if the idea is structural. Do not call generate_image again this round.`
            };
          }

          if (lessonId) {
            await verifyLessonBelongsToCourse(lessonId, courseId);
          }

          // The organisation's look, read per call rather than per round: an
          // admin who changes the style mid-build should see it take effect on
          // the next image, not the next conversation.
          const style = await getOrgAiImageSettingsService(orgId).catch(() => null);

          const image = await generateLessonImage({
            subject: args.subject,
            courseId,
            lessonId,
            locale,
            aspectRatio: args.aspectRatio,
            styleReferenceUrl: style?.styleReferenceUrl,
            styleNote: style?.styleNote,
            orgId,
            userId
          });

          imagesGenerated += 1;
          if (lessonId) leccionesConImagen.add(lessonId);
          anotarCambio(registro, 'ilustro', args.subject.slice(0, 60));

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

    /**
     * Buscar en lo que el curso YA dice.
     *
     * El constructor no tenía ninguna forma de hacerlo: para el contenido del
     * curso sólo existía «dame la lección entera». El tutor del alumno, en
     * cambio, tiene `search_course` con camino semántico Y respaldo literal
     * desde siempre — o sea que el agente que LEE el curso podía buscar y el
     * que lo EDITA no. Medido: 43 `get_lesson_content` sobre 13 lecciones en
     * una ronda, y 17 sobre 3 lecciones en otra.
     *
     * Literal PRIMERO y no semántico, porque el trabajo dominante del
     * constructor es «encontrá este texto para cambiarlo», y ahí la
     * coincidencia exacta es la respuesta correcta: devuelve la posición y el
     * `blockId`, que es lo que permite editar sin traer nada más. El semántico
     * entra sólo cuando el literal no encuentra nada, que es el caso «dónde
     * hablamos de esto».
     *
     * Un solo tool con los dos caminos y no dos tools con un modo: pedirle al
     * modelo que elija el modo es una decisión más para equivocarse, y la
     * respuesta correcta se puede deducir del resultado.
     */
    search_lessons: tool({
      description:
        'Search inside the lessons THIS COURSE already has, instead of fetching them one by one. Accents and capitalisation are ignored, so "mision" finds "misión". Each match gives you the lessonId, the blockId when the text sits in an addressable block, a readable snippet, and `textoExacto` — the surrounding text VERBATIM from the stored lesson. You can pass `textoExacto` straight to edit_lesson_content as oldString: for a find-and-replace across the course you do NOT need get_lesson_content at all. This searches the COURSE; search_document searches the attached source material.',
      inputSchema: searchLessonsParam,
      execute: async (args) => {
        return executeAgentTool('search_lessons', { orgId, userId, courseId, args }, async () => {
          const lecciones = await getCourseLessonContents(courseId, locale as TLocale);
          const literal = buscarEnLecciones({
            lecciones: lecciones.map((l) => ({
              id: l.id,
              title: l.title ?? '(untitled)',
              content: l.content ?? ''
            })),
            texto: args.query
          });

          if (literal.length > 0) {
            return { query: args.query, matchedBy: 'exact text' as const, matches: literal };
          }

          // Nada literal: quizá lo que se busca está dicho con otras palabras.
          // Sin `blockId` porque un fragmento del índice vectorial no sabe de
          // qué bloque salió; para editar hay que abrir esa lección.
          const titulos = new Map(lecciones.map((l) => [l.id, l.title ?? '(untitled)']));
          const semantico = await semanticSearchCourse({
            courseId,
            query: args.query,
            locale: locale as TLocale,
            limit: 6
          }).catch((error) => {
            console.warn('[search_lessons] la búsqueda semántica falló, se devuelve sólo el literal:', error);
            return [];
          });

          if (semantico.length === 0) {
            return {
              query: args.query,
              matches: [],
              note: 'Nothing in this course says that, literally or by meaning. If you expected it to be there, it is not — do not assume otherwise.'
            };
          }

          return {
            query: args.query,
            matchedBy: 'meaning' as const,
            note: 'No lesson contains those exact words. These are the passages closest in meaning — they have no blockId, so open the lesson to edit.',
            matches: semantico.map((s) => ({
              lessonId: s.lessonId,
              title: titulos.get(s.lessonId) ?? '(untitled)',
              fragmento: s.content.slice(0, 240)
            }))
          };
        });
      }
    }),

    get_course_structure: tool({
      description:
        'Get the full course structure as a tree: every section, lesson and exercise with its HANDLE (S2, S2.L3, S2.E1) and its id. Pass the handle to any tool that asks for a sectionId, lessonId or exerciseId. The courseId is automatically set — do not pass it.',
      inputSchema: emptyParam,
      execute: async () => {
        return executeAgentTool('get_course_structure', { orgId, userId, courseId }, async () => {
          // Se relee siempre: esto es lo que el modelo va a usar para nombrar
          // piezas durante el resto de la ronda, así que no puede salir de un
          // mapa cacheado antes de las últimas creaciones.
          manijas.invalidar();

          return describirCurso(await manijas.mapa());
        });
      }
    }),

    get_lesson_content: tool({
      description:
        'Get the HTML content of a specific lesson in this course. The response also lists the addressable blocks — use a blockId with replace_lesson_block to change one of them.',
      inputSchema: lessonReadParam,
      execute: async (args) => {
        return executeAgentTool('get_lesson_content', { orgId, userId, courseId, args }, async () => {
          const lessonId = await manijas.leccion(args.lessonId);
          await verifyLessonBelongsToCourse(lessonId, courseId);
          const lesson = await getLesson(lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const langContent = lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === locale);
          const content = langContent?.content || null;
          // The ids are already in the HTML above; listing them separately saves
          // the model from parsing them out, and is cheap — id plus a short
          // preview, not the block bodies again.
          const blocks = content ? summarizeLessonBlocks(content) : [];

          return {
            id: lesson.id,
            title: lesson.title,
            content,
            locale,
            ...(blocks.length > 0 ? { blocks } : {})
          };
        });
      }
    }),

    read_lessons: tool({
      description:
        'Read the text of up to 12 lessons of this course at once, as plain text: no HTML, diagram labels kept as [diagram: …]. Use it to check what other lessons already cover, and to copy the `evidence` sentence when the teacher dictates questions for create_exercise / add_questions. You do NOT need it before write_questions: that writer reads the lessons itself. To EDIT a lesson use get_lesson_content instead: it returns the HTML and the block ids.',
      inputSchema: readLessonsParam,
      execute: async (args) => {
        return executeAgentTool('read_lessons', { orgId, userId, courseId, args }, async () => {
          const items = await getCourseContentItems(courseId);
          const lessons: Array<{ id: string; title: string | null; text: string }> = [];
          const noEncontradas: string[] = [];
          const recortadas: string[] = [];
          let usados = 0;

          for (const valor of [...new Set(args.lessonIds)]) {
            // Una manija que no existe no corta la lectura entera: se anota como
            // no encontrada, igual que un id que no es de este curso. Cortar por
            // una sola haría que el modelo repitiera las once que sí estaban.
            //
            // Sólo ESA falla se traga: si lo que se cayó fue la base, la lectura
            // tiene que fallar fuerte y no informar que el curso no las tiene.
            const id = await manijas.leccion(valor).catch((error: unknown) => {
              if (error instanceof ManijaDesconocida) return null;

              throw error;
            });
            const item = id ? items.find((i) => i.id === id && String(i.type).toLowerCase() === 'lesson') : undefined;

            if (!id || !item) {
              noEncontradas.push(valor);
              continue;
            }

            const lesson = (await getLesson(id)) as {
              lessonLanguages?: Array<{ locale: string; content: string | null }>;
            };
            const html = lesson.lessonLanguages?.find((ll) => ll.locale === locale)?.content ?? '';
            let texto = html ? textoDeLeccion(html) : '';
            const lugar = MAX_LECTURA_LECCIONES_CHARS - usados;
            const recortada = texto.length > lugar;

            if (recortada) {
              texto = `${texto.slice(0, Math.max(0, lugar))} […]`;
              recortadas.push(item.title ?? id);
            }

            usados += texto.length;

            lessons.push({ id, title: item.title, text: texto || '(This lesson has no content in this locale yet.)' });
          }

          return {
            count: lessons.length,
            lessons,
            ...(noEncontradas.length > 0
              ? {
                  notFound: noEncontradas,
                  note: 'These are not lessons of this course. Use the handles from get_course_structure (for example S2.L3) — never invent a handle or an id.'
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
          const exerciseId = await manijas.ejercicio(args.exerciseId);
          await verifyExerciseBelongsToCourse(exerciseId, courseId);
          return getExercise(exerciseId);
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
              handle: await manijas.manijaDe(boundId),
              title: existing?.title ?? args.title,
              order: existing?.order ?? args.order,
              reused: true,
              note: 'This plan item was already built. Reusing the existing section instead of creating a duplicate.'
            };
          }

          // Sin atadura —una conversación nueva sobre un curso ya construido—,
          // lo único que evita duplicar es mirar el curso. Ver pieza-existente.ts.
          const equivalente = seccionEquivalente(await listCourseSections(courseId), args.title);

          if (equivalente) {
            await recordBinding(args.planKey, equivalente.id);
            return {
              id: equivalente.id,
              handle: await manijas.manijaDe(equivalente.id),
              title: equivalente.title,
              order: equivalente.order,
              reused: true,
              note: `This course already has this section ("${equivalente.title}"). Reusing it instead of creating a duplicate: build this plan section's lessons and exercises inside it.`
            };
          }

          /**
           * Insertar, no encimar.
           *
           * Medido el 2026-09-22: el modelo pidió una sección nueva con
           * `order: 2`, que era el del examen final, y el servidor la creó
           * igual. El curso quedó con dos secciones en la posición 2 y las
           * manijas —que son POSICIONALES— pasaron a depender del desempate:
           * `S3` podía ser cualquiera de las dos.
           *
           * El modelo no puede resolverlo solo porque no siempre sabe qué hay
           * en cada posición, y pedirle que lea la estructura antes de cada
           * alta es un paso más para un dato que el servidor tiene delante. Así
           * que corre a las que estorban, de mayor a menor para no chocar con
           * una posición ocupada en el camino, y lo dice en el resultado.
           */
          const existentes = await listCourseSections(courseId);
          const corridas = existentes
            .filter((s) => typeof s.order === 'number' && s.order >= args.order)
            .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

          for (const aCorrer of corridas) {
            await updateCourseSectionService(aCorrer.id, { order: (aCorrer.order ?? 0) + 1 });
          }

          const section = await createCourseSection(courseId, { title: args.title, courseId, order: args.order });
          // Una sección más cambia el mapa: la nueva no tiene manija todavía y
          // las que van detrás pueden haberse corrido.
          manijas.invalidar();
          await recordBinding(args.planKey, section.id);
          return {
            id: section.id,
            handle: await manijas.manijaDe(section.id),
            title: section.title,
            order: section.order,
            ...(corridas.length > 0
              ? { note: `Inserted at position ${args.order}; later sections were shifted.` }
              : {})
          };
        });
      }
    }),

    update_section: tool({
      description:
        'Update metadata for an existing section in this course. Use this to rename a section or change its order instead of creating a new section.',
      inputSchema: updateSectionParam,
      execute: async (args) => {
        return executeAgentTool('update_section', { orgId, userId, courseId, args }, async () => {
          const sectionId = await manijas.seccion(args.sectionId);
          await verifySectionBelongsToCourse(sectionId, courseId);
          const section = await updateCourseSectionService(sectionId, {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.order !== undefined ? { order: args.order } : {})
          });

          // Cambiarle el `order` a una sección reordena el curso, y las manijas
          // son posicionales. Renombrarla no mueve a nadie.
          if (args.order !== undefined) manijas.invalidar();

          return {
            id: section.id,
            title: section.title,
            updated: true,
            ...(args.order !== undefined
              ? { note: 'Handles changed: call get_course_structure before using one.' }
              : {})
          };
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

          if (leccion.yaEscritaPorOtro) return leccionYaEscrita(leccion);

          // Una lección recién creada no puede estar en la orden de trabajo:
          // esto sólo muerde cuando `crearOReusarLeccion` reusó una existente,
          // que es justo por donde una reescritura se colaría sin nombrarse.
          if (args.content) negarReescrituraBajoOrden(leccion.id, 'create_lesson');

          const handle = await manijas.manijaDe(leccion.id);

          if (leccion.reused) {
            // A retry after an interrupted round lands here. It still carries the
            // body, and the lesson it belongs to may well be empty — so write it
            // rather than returning early and stranding the content.
            const written = args.content
              ? await writeLessonBody({
                  registro,
                  lessonId: leccion.id,
                  lessonTitle: leccion.title,
                  locale,
                  content: args.content,
                  isBuilding,
                  verificarFundamento,
                  avisosDeFundamento,
                  cargarFuentesDelCurso
                })
              : null;

            return {
              id: leccion.id,
              handle,
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
            return { id: leccion.id, handle, title: leccion.title, order: leccion.order };
          }

          if (!isBuilding) leccionesEscritasSinPlan += 1;

          const written = await writeLessonBody({
            registro,
            lessonId: leccion.id,
            lessonTitle: leccion.title,
            locale,
            content: args.content,
            isBuilding,
            verificarFundamento,
            avisosDeFundamento,
            cargarFuentesDelCurso
          });

          return {
            id: leccion.id,
            handle,
            title: leccion.title,
            order: leccion.order,
            locale,
            contentWritten: true,
            contentLength: written.normalizedContent.length,
            ...contentWarningFields(written)
          };
        });
      }
    }),

    write_lesson: tool({
      description:
        'Write ONE lesson through a dedicated writer that sees only the brief for this lesson, the course outline and the sources you list. This is how a whole lesson gets written or rewritten from the course material — every lesson of an approved plan, and any single lesson the teacher asks you to write or rewrite in chat. You send a short brief plus the sources that carry it — never the lesson HTML — so your own context stays small. Pass sectionId + title + order + planKey to create a lesson, or lessonId to rewrite one. The result carries the same checks as any saved lesson (diagrams, formulas, and grounding against exactly the sources the writer saw) and, when there is one, a writerNote about what the writer could not cover: pass that note on to the teacher.',
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
            const lessonId = await manijas.leccion(args.lessonId);
            await verifyLessonBelongsToCourse(lessonId, courseId);
            // Antes de gastar la llamada al escritor: bajo una orden de edición
            // esta reescritura no se va a guardar, así que tampoco se paga.
            negarReescrituraBajoOrden(lessonId, 'write_lesson');
            const existente = await getLesson(lessonId);
            leccion = { id: lessonId, title: existente.title, order: existente.order, reused: false };
          } else if (args.sectionId && args.title && args.order !== undefined) {
            const encontrada = await crearOReusarLeccion({
              sectionId: args.sectionId,
              title: args.title,
              order: args.order,
              planKey: args.planKey
            });

            // Sin esto, el escritor reescribiría una lección que otro ya escribió.
            if (encontrada.yaEscritaPorOtro) return leccionYaEscrita(encontrada);

            leccion = encontrada;
          } else {
            throw new Error('Pass lessonId to rewrite a lesson, or sectionId + title + order to create one.');
          }

          // Lo que ya tiene escrito, si algo. Al reescribir, el escritor tiene
          // que conservar lo que la consigna no pide cambiar —y las imágenes—;
          // en un reintento, no tirar lo que ya había quedado guardado.
          const actual = (await getLesson(leccion.id).catch(() => null)) as {
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          } | null;
          const contenidoActual = actual?.lessonLanguages?.find((ll) => ll.locale === locale)?.content || undefined;

          let escrito;

          try {
            escrito = await escribirLeccion({
              lessonTitle: leccion.title,
              brief: args.brief,
              locale,
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
              handle: await manijas.manijaDe(leccion.id),
              lessonId: leccion.id,
              title: leccion.title,
              order: leccion.order,
              locale,
              contentWritten: false,
              pendingForLackOfMaterial: escrito.faltaMaterial,
              sourcesUsed: escrito.fuentesUsadas,
              ...(escrito.fuentesNoEncontradas.length > 0 ? { sourcesNotFound: escrito.fuentesNoEncontradas } : {}),
              note:
                'The lesson was left empty on purpose. Do NOT write it yourself and do NOT retry: tell the teacher, ' +
                'in the course language, what material this lesson needs so they can add it. Move on to the next item.'
            };
          }

          const guardar = (contenido: string, material: FuenteVista[], nota?: string) =>
            writeLessonBody({
              registro,
              lessonId: leccion.id,
              lessonTitle: leccion.title,
              locale,
              content: contenido,
              // El escritor es un paso de construcción por naturaleza, en cualquier
              // fase: el texto no lo dictó el docente, lo redactó un modelo a
              // partir de fuentes. Así que corren los chequeos de construcción,
              // fundamento incluido — contra lo que el escritor tuvo delante.
              isBuilding: true,
              verificarFundamento,
              avisosDeFundamento,
              fuentesDeLaLeccion: material,
              notaDelEscritor: nota
            });

          let written = await guardar(escrito.html, escrito.material, escrito.nota);

          /**
           * El rebote: si el servidor encontró algo, vuelve el escritor. UNA vez.
           *
           * Quien tiene el material delante es él, no el constructor. Devolverle
           * los hallazgos al constructor lo pone a arreglar una lección que nunca
           * leyó, con las fuentes fuera de su contexto: lo medido es que en ese
           * caso reescribe la lección entera «por las dudas», y cada reescritura
           * es una oportunidad nueva de inventar.
           *
           * Una vez y no hasta que quede limpio: el segundo intento es barato y
           * suele alcanzar —casi siempre la respuesta correcta es marcar un
           * ejemplo, que no cambia el texto—, y un tercero ya es gastar una
           * llamada de escritor entera por un aviso que el docente puede ver en
           * el informe. Si sigue habiendo hallazgos, la lección se guarda igual y
           * vuelven como avisos.
           */
          const hallazgos = [...written.unsupportedTokens, ...written.groundingWarnings];
          let writerRetried = false;
          /**
           * Por QUÉ rebotó, escrito una sola vez y contado en dos lados.
           *
           * `writerRetried: true` decía que hubo rebote y nada más, así que no
           * había forma de medir si los falsos positivos del chequeo de tokens
           * (F1) se habían arreglado: en la corrida del 2026-09-22 rebotaron 5
           * de 5 lecciones y el registro no dice por cuál hallazgo. Va al log
           * —para poder contarlo sobre una corrida entera— y al resultado, que
           * es lo que queda guardado en el informe de la ronda.
           */
          const motivoDelRebote = recortarMotivo(hallazgos.join(' | '));

          if (hallazgos.length > 0) {
            console.log(`[write_lesson] rebote «${leccion.title}»: ${motivoDelRebote}`);

            const reintento = await escribirLeccion({
              lessonTitle: leccion.title,
              brief: `${args.brief}\n\n${briefDelRebote(written)}`,
              locale,
              sources: args.sources,
              // Lo recién escrito, para que corrija en vez de empezar de nuevo.
              contenidoActual: written.normalizedContent
            }).catch((error) => {
              // Falla abierto: la primera versión ya está guardada y sus avisos
              // vuelven igual. Perder la lección por no poder pulirla sería
              // cambiar un defecto chico por uno grande.
              console.error('[write_lesson] el rebote al escritor falló:', error);
              return null;
            });

            // Una negativa acá no deja la lección vacía: ya hay una versión
            // guardada, y borrarla porque el segundo intento se arrepintió
            // sería peor que quedarse con la que tiene avisos.
            if (reintento && !('faltaMaterial' in reintento)) {
              escrito = reintento;
              written = await guardar(reintento.html, reintento.material, reintento.nota);
              writerRetried = true;
            }
          }

          return {
            id: leccion.id,
            handle: await manijas.manijaDe(leccion.id),
            lessonId: leccion.id,
            title: leccion.title,
            lessonTitle: leccion.title,
            order: leccion.order,
            locale,
            ...(leccion.reused ? { reused: true } : {}),
            contentWritten: true,
            contentLength: written.normalizedContent.length,
            sourcesUsed: escrito.fuentesUsadas,
            ...(escrito.fuentesNoEncontradas.length > 0 ? { sourcesNotFound: escrito.fuentesNoEncontradas } : {}),
            ...(escrito.recortadas.length > 0 ? { sourcesTruncated: escrito.recortadas } : {}),
            ...(escrito.nota ? { writerNote: escrito.nota } : {}),
            ...(writerRetried ? { writerRetried: true, writerRetryReason: motivoDelRebote } : {}),
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
          const sectionId = args.sectionId ? await manijas.seccion(args.sectionId) : undefined;
          const lessonId = await manijas.leccion(args.lessonId);

          if (sectionId) {
            await verifySectionBelongsToCourse(sectionId, courseId);
          }

          await verifyLessonBelongsToCourse(lessonId, courseId);
          const lesson = await updateLessonService(lessonId, {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(sectionId !== undefined ? { sectionId } : {}),
            ...(args.order !== undefined ? { order: args.order } : {}),
            ...(args.lessonAt !== undefined ? { lessonAt: args.lessonAt } : {}),
            ...(args.callUrl !== undefined ? { callUrl: args.callUrl } : {}),
            ...(args.isUnlocked !== undefined ? { isUnlocked: args.isUnlocked } : {}),
            ...(args.public !== undefined ? { public: args.public } : {})
          });

          // Mover una lección de sección o cambiarle el orden la corre de lugar,
          // y con ella las manijas de sus hermanas.
          const movida = sectionId !== undefined || args.order !== undefined;

          if (movida) manijas.invalidar();

          return {
            id: lesson.id,
            title: lesson.title,
            updated: true,
            ...(movida ? { note: 'Handles changed: call get_course_structure before using one.' } : {})
          };
        });
      }
    }),

    update_lesson_content: tool({
      description:
        'Update the text content of a lesson in this course. Replaces full lesson HTML for the given locale. For lesson HTML, put only the lesson body in the content. Do not include the lesson title. Do not use h1 or h2 anywhere in lesson HTML. Start headings at h3 because that is the highest heading level allowed in lesson content. To write or rewrite a whole lesson from the course material, use write_lesson instead: it writes against the sources and its result is checked against them. Use this tool for text the teacher dictated or pasted, or when write_lesson has failed twice.',
      inputSchema: updateContentParam,
      execute: async (args) => {
        return executeAgentTool('update_lesson_content', { orgId, userId, courseId, args }, async () => {
          const lessonId = await manijas.leccion(args.lessonId);
          await verifyLessonBelongsToCourse(lessonId, courseId);
          negarReescrituraBajoOrden(lessonId, 'update_lesson_content');
          const lesson = await getLesson(lessonId);

          const written = await writeLessonBody({
            registro,
            lessonId,
            lessonTitle: lesson.title,
            locale,
            content: args.content,
            isBuilding,
            verificarFundamento,
            avisosDeFundamento,
            // Nadie dice con qué fuentes se escribió este cuerpo: se contrasta
            // contra las del curso en vez de no contrastar.
            cargarFuentesDelCurso
          });

          return {
            lessonId,
            lessonTitle: lesson.title,
            locale,
            contentLength: written.normalizedContent.length,
            updated: true,
            ...contentWarningFields(written)
          };
        });
      }
    }),

    replace_lesson_block: tool({
      description:
        'PREFERRED way to change part of a lesson: replace one block by its data-block-id, leaving the rest byte-for-byte untouched. Take the blockId from a search_lessons match (the direct route) or from the `blocks` list of get_lesson_content — never invent one. You only write the new block — you do NOT have to reproduce the old one. Pass the complete replacement including its outer tag (e.g. "<p>…</p>"), or an empty string to delete the block. If the block has no id (older content), fall back to edit_lesson_content.',
      inputSchema: replaceBlockParam,
      execute: async (args) => {
        return executeAgentTool('replace_lesson_block', { orgId, userId, courseId, args }, async () => {
          const lessonId = await manijas.leccion(args.lessonId);
          await verifyLessonBelongsToCourse(lessonId, courseId);
          const lesson = await getLesson(lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const current = lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === locale)?.content ?? '';

          if (!current) {
            throw new Error(
              `This lesson has no content in locale "${locale}" yet. Use write_lesson to write the initial content.`
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

          // Los dos rieles de la edición por bloques, ANTES de tocar nada. Ver
          // `negarPerdidaDeEjemplos` y `negarBloqueSuelto`.
          negarBloqueSuelto(args.html);
          negarPerdidaDeEjemplos({
            alcance: 'block',
            antes: block.html,
            despues: args.html,
            esBorrado: !args.html.trim()
          });

          const repaired = convertMarkdownMathToKatex(
            args.html.includes('<svg') ? repararDiagrama(args.html) : args.html
          );
          // An empty replacement deletes the block; there is no id left to keep.
          const replacement = repaired.trim() ? preserveBlockId(repaired, args.blockId) : '';
          const empalmado = replaceLessonBlock(current, block, replacement);

          if (empalmado === current) {
            throw new Error('The replacement produced no change (the new block is identical to the old one).');
          }

          // El reemplazo puede traer bloques NUEVOS al lado del que se pisó (un
          // párrafo partido en dos, una lista que se agrega): sin esto, nacen sin
          // id y no se pueden volver a editar por bloque. Ver `lesson-blocks.ts`.
          const updated = asignarIdsDeBloque(empalmado);

          await upsertLessonLanguageService(lessonId, {
            locale: locale as 'en',
            content: updated
          });

          // Anotado despues de guardar: el registro dice lo que paso.
          anotarCambio(registro, 'edito', (lesson as { title?: string | null })?.title ?? lessonId);

          // Si esta lección quedó marcada —o el plan mandó cambiarla— se la
          // vuelve a mirar ENTERA: la afirmación que el aviso señalaba suele
          // vivir también fuera del bloque que se acaba de cambiar, y un bloque
          // nuevo es texto que nadie miró. Ver `revisarLeccionEditada`.
          const revision = await revisarLeccionEditada({
            lessonId,
            lessonTitle: lesson.title,
            contenido: updated
          });

          return {
            lessonId,
            lessonTitle: lesson.title,
            locale,
            blockId: args.blockId,
            deleted: replacement === '',
            contentLength: updated.length,
            updated: true,
            ...(revision.groundingResolved ? { groundingResolved: true } : {}),
            // Only inspect what this edit wrote — see the note in
            // edit_lesson_content about not sending the model after untouched
            // parts of the lesson. El fundamento es la excepción: ahí el recorte
            // era el defecto, y por eso `revision` mira la lección entera.
            ...contentWarningFields({
              svgWarnings: replacement.includes('<svg') ? validateSvgDiagram(replacement) : [],
              mathWarnings: validateLessonMath(replacement),
              groundingWarnings: revision.groundingWarnings,
              unsupportedTokens: revision.unsupportedTokens
            })
          };
        });
      }
    }),

    edit_lesson_content: tool({
      description:
        'FALLBACK for content with no block ids — prefer replace_lesson_block when the block you want has a data-block-id. Makes a TARGETED edit by find-and-replace: replaces one exact fragment of the lesson HTML, leaving the rest byte-for-byte untouched. Use this to redo just a diagram (the <svg>), fix or rewrite a single paragraph or sentence, or delete a block — NOT to write a lesson from scratch or rewrite the whole thing (use write_lesson for that). oldString must be text you have VERBATIM from the server, never text you reconstructed from memory — either the `textoExacto` of a search_lessons match (the direct route: no other call needed) or a fragment copied from get_lesson_content. oldString must be unique in the lesson (include surrounding context) unless you pass replaceAll. Set newString to an empty string to delete the fragment.',
      inputSchema: editContentParam,
      execute: async (args) => {
        return executeAgentTool('edit_lesson_content', { orgId, userId, courseId, args }, async () => {
          const lessonId = await manijas.leccion(args.lessonId);
          await verifyLessonBelongsToCourse(lessonId, courseId);
          const lesson = await getLesson(lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const current = lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === locale)?.content ?? '';

          if (!current) {
            throw new Error(
              `This lesson has no content in locale "${locale}" yet. Use write_lesson to write the initial content instead of edit_lesson_content.`
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
          const reemplazado = args.replaceAll
            ? current.split(args.oldString).join(newString)
            : current.replace(args.oldString, () => newString);

          if (reemplazado === current) {
            throw new Error('The replacement produced no change (oldString and newString are equivalent).');
          }

          // Acá el riel se mide sobre la lección ENTERA y no sobre el fragmento:
          // `oldString` puede ser un pedacito de un `<ul>` y llevarse el cierre,
          // y lo único que dice si se perdió un ejemplo es cuántas marcas
          // quedaron en el resultado. Ver `negarPerdidaDeEjemplos`.
          negarPerdidaDeEjemplos({
            alcance: 'lesson',
            antes: current,
            despues: reemplazado,
            esBorrado: !args.newString.trim()
          });

          // Un bloque entero pegado por acá nace sin id y no se podría volver a
          // editar por bloque; y una lección vieja, anterior a los ids, se vuelve
          // direccionable en su primera edición. Ver `lesson-blocks.ts`.
          const updated = asignarIdsDeBloque(reemplazado);

          await upsertLessonLanguageService(lessonId, {
            locale: locale as 'en',
            content: updated
          });

          // Anotado despues de guardar: el registro dice lo que paso.
          anotarCambio(registro, 'edito', (lesson as { title?: string | null })?.title ?? lessonId);

          // Si esta lección quedó marcada —o el plan mandó cambiarla— se la
          // vuelve a mirar ENTERA. Es el caso que dejó pasar una afirmación sin
          // respaldo: el agente arregló la frase citada y la misma afirmación
          // siguió en otros cinco lugares. Ver `revisarLeccionEditada`.
          const revision = await revisarLeccionEditada({
            lessonId,
            lessonTitle: lesson.title,
            contenido: updated
          });

          return {
            lessonId,
            lessonTitle: lesson.title,
            locale,
            replacements: args.replaceAll ? occurrences : 1,
            contentLength: updated.length,
            updated: true,
            ...(revision.groundingResolved ? { groundingResolved: true } : {}),
            // Only inspect what this edit wrote — warning about a pre-existing
            // diagram elsewhere in the lesson would send the model chasing
            // something the teacher didn't ask it to touch. El fundamento es la
            // excepción: ahí el recorte era el defecto.
            ...contentWarningFields({
              svgWarnings: newString.includes('<svg') ? validateSvgDiagram(newString) : [],
              mathWarnings: validateLessonMath(newString),
              groundingWarnings: revision.groundingWarnings,
              unsupportedTokens: revision.unsupportedTokens
            })
          };
        });
      }
    }),

    create_exercise: tool({
      description:
        'Create a new exercise with questions and answer options in this course — for questions the TEACHER dictated. To build an exercise from the lessons, use write_questions instead: a writer that sees the lessons in full writes them. Every question needs its `evidence`: the sentence of the lesson it tests, copied verbatim (read the lessons with read_lessons and copy from there). The server checks each evidence against the lessons this exercise covers and creates nothing if one of them is not there.',
      inputSchema: createExerciseParam,
      execute: async (args) => {
        return executeAgentTool('create_exercise', { orgId, userId, courseId, args }, async () => {
          const lessonId = args.lessonId ? await manijas.leccion(args.lessonId) : undefined;
          const sectionId = args.sectionId ? await manijas.seccion(args.sectionId) : undefined;

          if (lessonId) {
            await verifyLessonBelongsToCourse(lessonId, courseId);
          }

          if (sectionId) {
            await verifySectionBelongsToCourse(sectionId, courseId);
          }

          const boundId = await findBoundEntity(args.planKey, 'exercise');

          if (boundId) {
            const existing = await getExercise(boundId).catch(() => null);
            return {
              id: boundId,
              handle: await manijas.manijaDe(boundId),
              title: existing?.title ?? args.title,
              questionCount: existing?.questions?.length ?? 0,
              reused: true,
              note: 'This plan item was already built. Reusing the existing exercise — add questions with write_questions (passing this exerciseId) instead of creating a duplicate.'
            };
          }

          // Sin atadura: mirar si esta sección ya tiene este ejercicio. Ver pieza-existente.ts.
          if (sectionId) {
            const equivalente = piezaEquivalente(await getCourseContentItems(courseId), {
              tipo: 'exercise',
              sectionId,
              titulo: args.title
            });

            if (equivalente?.id) {
              await recordBinding(args.planKey, equivalente.id);
              const preguntas = equivalente.questionCount ?? 0;

              return {
                id: equivalente.id,
                handle: await manijas.manijaDe(equivalente.id),
                title: equivalente.title ?? args.title,
                questionCount: preguntas,
                reused: true,
                note:
                  preguntas > 0
                    ? `This section already has this exercise, with ${preguntas} questions, so nothing was created. Treat it as built.`
                    : 'This section already has this exercise, but with no questions. Nothing was created: fill it with write_questions, passing this exerciseId and the lessons it covers.'
              };
            }
          }

          /**
           * Un ejercicio sin preguntas no es un ejercicio: es una cáscara.
           *
           * Se aceptaba en silencio y se contestaba `questionCount: 0` sin
           * objetar nada. Así quedó el examen final de un curso real: en su
           * último paso la ronda creó el contenedor vacío y nunca volvió. El
           * contenedor existe, así que ningún chequeo lo extraña como faltante,
           * y el alumno abre un examen sin nada que responder.
           *
           * Se rechaza en vez de avisar porque acá el modelo TIENE la salida a
           * mano: si no le entran las preguntas en lo que le queda de ronda, lo
           * correcto es no crearlo y decirlo.
           */
          if (args.questions.length === 0) {
            throw new Error(
              'An exercise needs at least one question. Do not create an empty shell to fill in later: it counts as built and nothing will flag it as missing. If the questions will not fit in what is left of this round, skip it and say so in your reply.'
            );
          }

          // Cada pregunta tiene que salir de una frase que la lección dice, y
          // esa frase se busca. Ver `evidencia-de-preguntas.ts`.
          await exigirEvidencias(args.questions, await leccionesQueCubre({ lessonId, sectionId }));

          const exercise = await createExercise({
            title: args.title,
            description: args.description,
            courseId,
            lessonId,
            sectionId,
            order: args.order,
            questions: args.questions.map((q, i) => ({
              question: q.question,
              questionTypeId: q.questionTypeId,
              points: q.points,
              order: q.order ?? i,
              options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
              // Donde vive la respuesta de los tipos que no usan opciones, y
              // desde ahora también la evidencia de la pregunta.
              settings: settingsConEvidencia(q)
            }))
          });
          // Un ejercicio más en una sección: su manija no existía hasta recién.
          manijas.invalidar();
          await recordBinding(args.planKey, exercise.id);
          return {
            id: exercise.id,
            handle: await manijas.manijaDe(exercise.id),
            title: exercise.title,
            questionCount: args.questions.length
          };
        });
      }
    }),

    update_exercise: tool({
      description:
        "Update an existing exercise's metadata (title, description, linked lesson, section, order, due date, lock state, allow-multiple-attempts). Use this for editing the exercise itself — not for changing its questions. To edit questions, use update_questions; to add questions, use add_questions.",
      inputSchema: updateExerciseParam,
      execute: async (args) => {
        return executeAgentTool('update_exercise', { orgId, userId, courseId, args }, async () => {
          const exerciseId = await manijas.ejercicio(args.exerciseId);
          const lessonId = args.lessonId ? await manijas.leccion(args.lessonId) : undefined;
          const sectionId = args.sectionId ? await manijas.seccion(args.sectionId) : undefined;

          await verifyExerciseBelongsToCourse(exerciseId, courseId);

          if (lessonId) {
            await verifyLessonBelongsToCourse(lessonId, courseId);
          }

          if (sectionId) {
            await verifySectionBelongsToCourse(sectionId, courseId);
          }

          const updated = await updateExerciseService(exerciseId, {
            title: args.title,
            description: args.description,
            lessonId,
            sectionId,
            order: args.order,
            dueBy: args.dueBy,
            isUnlocked: args.isUnlocked,
            allowMultipleAttempts: args.allowMultipleAttempts
          });

          // Mudarlo de sección o reordenarlo cambia su lugar, y la manija es el
          // lugar.
          const movido = sectionId !== undefined || args.order !== undefined;

          if (movido) manijas.invalidar();

          return {
            id: updated.id,
            title: updated.title,
            description: updated.description ?? null,
            dueBy: updated.dueBy ?? null,
            updated: true,
            ...(movido ? { note: 'Handles changed: call get_course_structure before using one.' } : {})
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
          const exerciseId = await manijas.ejercicio(args.exerciseId);
          const exerciseSectionId = await resolverBloqueDeEjercicio(exerciseId, args.exerciseSectionId);

          assertValidUuid('Exercise', exerciseId);
          assertValidUuid('ExerciseSection', exerciseSectionId);

          await verifyExerciseBelongsToCourse(exerciseId, courseId);

          const updated = await updateExerciseSectionMetadataService(exerciseId, exerciseSectionId, {
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
          const exerciseId = await manijas.ejercicio(args.exerciseId);

          assertValidUuid('Exercise', exerciseId);

          await verifyExerciseBelongsToCourse(exerciseId, courseId);

          // Sin `manijas.invalidar()` a propósito: el mapa del curso no lleva
          // bloques —se resuelven contra el ejercicio en cada llamada— así que
          // un bloque nuevo no puede dejarlo viejo.
          const created = await createExerciseSectionService(exerciseId, {
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
        'Add questions the TEACHER dictated to an existing exercise in this course. To add questions written from the lessons, use write_questions instead. When get_exercise_details lists in-exercise sections, pass exerciseSectionId so new questions are added to the correct block. Like create_exercise, every question needs its `evidence` — the sentence of the lesson it tests, copied verbatim — and nothing is added if one of them is not in the lessons this exercise covers.',
      inputSchema: addQuestionsParam,
      execute: async (args) => {
        return executeAgentTool('add_questions', { orgId, userId, courseId, args }, async () => {
          const exerciseId = await manijas.ejercicio(args.exerciseId);
          const exerciseSectionId =
            args.exerciseSectionId !== undefined
              ? await resolverBloqueDeEjercicio(exerciseId, args.exerciseSectionId)
              : undefined;

          await verifyExerciseBelongsToCourse(exerciseId, courseId);

          if (exerciseSectionId !== undefined) {
            assertValidUuid('ExerciseSection', exerciseSectionId);

            const sections = await getExerciseSectionsByExerciseId(exerciseId);
            const belongs = sections.some((section) => section.id === exerciseSectionId);

            if (!belongs) {
              throw new AppError(
                'That exercise section was not found on this exercise. Call get_exercise_details and use a section id from the sections array.',
                'VALIDATION_ERROR',
                404
              );
            }
          }

          const existingExercise = await getExercise(exerciseId);

          const vinculo = existingExercise as { lessonId?: string | null; sectionId?: string | null };
          await exigirEvidencias(
            args.questions,
            await leccionesQueCubre({
              lessonId: vinculo.lessonId ?? undefined,
              sectionId: vinculo.sectionId ?? undefined
            })
          );

          const existingQuestions = existingExercise.questions || [];
          const nextOrder = existingQuestions.length;

          const newQuestions = args.questions.map((q, i) => ({
            question: q.question,
            questionTypeId: q.questionTypeId,
            points: q.points,
            order: q.order ?? nextOrder + i,
            ...(exerciseSectionId !== undefined ? { exerciseSectionId } : {}),
            options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
            // Donde vive la respuesta de los tipos que no usan opciones, y
            // desde ahora también la evidencia de la pregunta.
            settings: settingsConEvidencia(q)
          }));

          // Sólo las nuevas: el servicio no toca las preguntas que no recibe. Reenviar
          // las viejas era reescribirlas, y así se perdía la respuesta de las numéricas.
          await updateExerciseService(exerciseId, { questions: newQuestions });
          return {
            exerciseId,
            exerciseTitle: existingExercise.title,
            addedCount: args.questions.length,
            totalCount: existingQuestions.length + newQuestions.length
          };
        });
      }
    }),

    /**
     * Las preguntas las escribe quien leyó las lecciones.
     *
     * ── Por qué una herramienta y no una instrucción ─────────────────────────
     *
     * Durante una construcción el constructor NO vio el texto de ninguna
     * lección: las escribe `write_lesson` con contexto limpio. Escribía igual
     * las preguntas, sobre lo que suponía que cada lección decía. Medido el
     * 2026-09-21: 4 de 8 preguntas de una autoevaluación no salían de la
     * lección que evaluaban, con el viejo control de lectura en verde — porque
     * ese control comprobaba que hubiera LEÍDO, no que hubiera USADO.
     *
     * Acá el texto va a quien escribe, y lo que vuelve trae la frase de la
     * lección que cada pregunta evalúa. Esa frase se busca en el servidor: la
     * pregunta cuya evidencia no aparece se descarta y nunca llega al curso.
     *
     * ── Por qué descarta en vez de rechazar todo ─────────────────────────────
     *
     * Al revés que `create_exercise`. Ahí las preguntas las escribió el modelo
     * que está conversando, que puede corregirlas y reintentar; acá las escribió
     * un sub-agente que ya cobró su llamada, y tirar ocho preguntas buenas
     * porque dos no verifican sería pagar de nuevo por lo mismo. Las descartadas
     * vuelven en el resultado, para que el constructor pueda contarlo.
     */
    write_questions: tool({
      description:
        'Write the questions of an exercise FROM the lessons it covers — the normal way to build an exercise. A writer sees the full text of the lessons you list (and nothing else), writes the questions, and returns with each one the sentence of the lesson it tests; the server checks that sentence is really there and drops any question whose sentence is not. Pass exerciseId to add to an existing exercise, or title + sectionId/lessonId (+ order, planKey) to create it. Use blockTitle to put them in a new question block — that is how the final exam is built, one call per prior course section. You do NOT need to read the lessons first: the writer reads them.',
      inputSchema: writeQuestionsParam,
      execute: async (args) => {
        return executeAgentTool('write_questions', { orgId, userId, courseId, args }, async () => {
          if (!escribirPreguntas) {
            throw new Error(
              'The question writer is unavailable on this turn. Read the lessons with read_lessons and write the questions yourself with create_exercise or add_questions, giving each one its evidence.'
            );
          }

          /**
           * El texto de las lecciones, ANTES de gastar la llamada al escritor.
           *
           * Una lección vacía no puede sostener una pregunta, y pedírselas al
           * escritor sobre un texto que no existe termina en preguntas
           * inventadas que la evidencia después descarta: el mismo resultado,
           * pagando la llamada.
           */
          const contenidos = await getCourseLessonContents(courseId, locale as TLocale);
          const porId = new Map(contenidos.map((fila) => [fila.id, fila]));
          const lecciones: Array<{ id: string; title: string; text: string }> = [];
          const sinContenido: string[] = [];

          for (const valor of [...new Set(args.lessons)]) {
            const lessonId = await manijas.leccion(valor);
            await verifyLessonBelongsToCourse(lessonId, courseId);

            const fila = porId.get(lessonId);
            const texto = textoDeLeccion(fila?.content ?? '');

            if (!texto) {
              sinContenido.push(fila?.title ?? valor);
              continue;
            }

            lecciones.push({ id: lessonId, title: fila?.title ?? '(untitled)', text: texto });
          }

          if (lecciones.length === 0) {
            throw new Error(
              `Nothing was created: none of those lessons has content in "${locale}" yet${
                sinContenido.length > 0 ? ` (${sinContenido.join(', ')})` : ''
              }. Write the lessons first — an exercise cannot test what is not written.`
            );
          }

          // En qué ejercicio van. El nuevo NO se crea todavía: un ejercicio sin
          // preguntas es una cáscara que cuenta como construida y que nada
          // reclama como faltante, así que primero tiene que haber preguntas.
          const sectionId = args.sectionId ? await manijas.seccion(args.sectionId) : undefined;
          const lessonId = args.lessonId ? await manijas.leccion(args.lessonId) : undefined;

          if (sectionId) await verifySectionBelongsToCourse(sectionId, courseId);
          if (lessonId) await verifyLessonBelongsToCourse(lessonId, courseId);

          let exerciseId: string | null = null;
          let exerciseTitle = args.title ?? '';
          let preguntasQueYaTiene = 0;

          if (args.exerciseId) {
            exerciseId = await manijas.ejercicio(args.exerciseId);
            await verifyExerciseBelongsToCourse(exerciseId, courseId);

            const existente = await getExercise(exerciseId).catch(() => null);
            exerciseTitle = existente?.title ?? exerciseTitle;
            preguntasQueYaTiene = existente?.questions?.length ?? 0;
          } else {
            if (!args.title) {
              throw new Error(
                'Pass exerciseId to add questions to an existing exercise, or title (plus sectionId and order, or lessonId) to create one.'
              );
            }

            // Anti-duplicado, el mismo de `create_exercise`: la atadura del
            // plan primero, y si no hay, la pieza equivalente de esa sección.
            const yaConstruido =
              (await findBoundEntity(args.planKey, 'exercise')) ??
              (sectionId
                ? (piezaEquivalente(await getCourseContentItems(courseId), {
                    tipo: 'exercise',
                    sectionId,
                    titulo: args.title
                  })?.id ?? null)
                : null);

            if (yaConstruido) {
              await recordBinding(args.planKey, yaConstruido);
              const existente = await getExercise(yaConstruido).catch(() => null);
              const preguntas = existente?.questions?.length ?? 0;

              // Ya tiene preguntas y no se pidió un bloque nuevo: es un
              // reintento sobre algo hecho, y escribir otra vez lo duplicaría.
              // Con `blockTitle` sí se sigue: cada bloque es otro tramo del
              // examen y el ejercicio se llena de a uno.
              if (preguntas > 0 && !args.blockTitle) {
                return {
                  exerciseId: yaConstruido,
                  handle: await manijas.manijaDe(yaConstruido),
                  title: existente?.title ?? args.title,
                  added: 0,
                  questionCount: preguntas,
                  reused: true,
                  note: `This exercise already exists with ${preguntas} question(s), so nothing was written. Treat it as built.`
                };
              }

              exerciseId = yaConstruido;
              exerciseTitle = existente?.title ?? args.title;
              preguntasQueYaTiene = preguntas;
            }
          }

          const totalTexto = lecciones.reduce((suma, leccion) => suma + leccion.text.length, 0);
          const cuantas = args.count ?? cuantasPreguntas(totalTexto);

          let escrito;

          try {
            escrito = await escribirPreguntas({
              exerciseTitle: exerciseTitle || args.title || 'Exercise',
              brief: args.brief,
              count: cuantas,
              lecciones: lecciones.map(({ title, text }) => ({ title, text })),
              locale
            });
          } catch (error) {
            const motivo = error instanceof Error ? error.message : String(error);

            throw new Error(
              `The question writer failed: ${motivo} Nothing was created. Retry write_questions once; if it fails again, read the lessons with read_lessons and write the questions yourself with create_exercise, giving each one its evidence.`
            );
          }

          const textosDeLasLecciones = lecciones.map((leccion) => leccion.text);

          /**
           * Una tanda del escritor, revisada: la evidencia primero y la regla
           * del tipo después.
           *
           * La evidencia se contrasta contra el texto de ESTAS lecciones y no
           * el del curso: el escritor no vio ninguna otra, así que una frase
           * que aparece en otra lección no salió de lo que él leyó.
           */
          const revisarTanda = (preguntas: typeof escrito.preguntas) => {
            const { validas, rechazadas } = verificarEvidencias(preguntas, textosDeLasLecciones);
            const descartadas = rechazadas.map((rechazada) => ({
              question: rechazada.question,
              evidence: rechazada.evidence,
              reason: 'its evidence is not in the lessons this exercise covers',
              porOpciones: false
            }));
            const aceptadas: Array<z.infer<typeof questionSchema>> = [];
            const sinOpciones: Array<{ question: string; questionTypeId: number }> = [];

            // Y la regla de cada tipo, que el esquema de salida del escritor no
            // lleva a propósito: una numérica sin respuesta la rechaza después
            // el servicio, y ahí se cae la llamada entera en vez de esa pregunta.
            for (const pregunta of validas) {
              const revisada = questionSchema.safeParse(conRespuestaNumerica(pregunta));

              if (revisada.success) {
                aceptadas.push(revisada.data);
                continue;
              }

              const porOpciones = revisada.error.issues.some((issue) => issue.path[0] === 'options');

              if (porOpciones) sinOpciones.push({ question: pregunta.question, questionTypeId: pregunta.questionTypeId });

              descartadas.push({
                question: pregunta.question,
                evidence: pregunta.evidence,
                reason: revisada.error.issues.map((issue) => issue.message).join(' '),
                porOpciones
              });
            }

            return { aceptadas, descartadas, sinOpciones };
          };

          const primeraTanda = revisarTanda(escrito.preguntas);
          const aceptadas = [...primeraTanda.aceptadas];
          let descartadas = primeraTanda.descartadas;
          const vistas = new Set(aceptadas.map(claveDePregunta));

          /**
           * El rebote por opciones: se le vuelve a pedir UNA vez.
           *
           * Mismo patrón que el rebote de `write_lesson`, y por el mismo motivo:
           * quien tiene las lecciones delante es el escritor, no el constructor,
           * y devolverle el hueco al constructor lo pone a escribir preguntas
           * sobre un texto que no leyó. Medido el 2026-09-22: cinco preguntas de
           * opción creadas sin una sola opción, imposibles de contestar.
           *
           * Una vez y no hasta que quede limpio: lo que falta acá es un campo
           * que el escritor omitió, no un juicio difícil, y un tercer intento es
           * pagar otra llamada entera por lo mismo.
           */
          if (primeraTanda.sinOpciones.length > 0) {
            console.log(
              `[question-writer] "${exerciseTitle || args.title}": ${primeraTanda.sinOpciones.length} sin opciones, rebote`
            );

            const reintento = await escribirPreguntas({
              exerciseTitle: exerciseTitle || args.title || 'Exercise',
              brief: [args.brief, notaDeOpciones(primeraTanda.sinOpciones)].filter(Boolean).join('\n\n'),
              count: primeraTanda.sinOpciones.length,
              lecciones: lecciones.map(({ title, text }) => ({ title, text })),
              locale
            }).catch((error: unknown) => {
              // Falla abierto: lo que la primera tanda aceptó ya está bien, y
              // perderlo porque el rebote no salió sería peor que quedarse con
              // menos preguntas.
              console.error('[question-writer] el rebote por opciones falló:', error);
              return null;
            });

            if (reintento) {
              const segundaTanda = revisarTanda(reintento.preguntas);

              for (const pregunta of segundaTanda.aceptadas) {
                const clave = claveDePregunta(pregunta);

                // Sin repetir por texto: el escritor puede devolver de nuevo una
                // que ya había salido bien en la primera tanda.
                if (vistas.has(clave)) continue;

                vistas.add(clave);
                aceptadas.push(pregunta);
              }

              // Las que el rebote arregló dejan de estar rechazadas; las que
              // siguen faltando quedan, con el motivo de la segunda vuelta.
              descartadas = [
                ...primeraTanda.descartadas.filter(
                  (descartada) => !descartada.porOpciones || !vistas.has(claveDePregunta(descartada))
                ),
                ...segundaTanda.descartadas
              ];
            }
          }

          /**
           * Lo rechazado, como lo lee el modelo.
           *
           * `porOpciones` es contabilidad interna del rebote y no sale. Y se
           * deduplica por texto: el escritor puede devolver la misma pregunta
           * mal dos veces, y listarla dos veces sólo haría más larga la lista
           * sin decir nada nuevo.
           */
          const rechazadasParaElModelo = () => {
            const porTexto = new Map<string, { question: string; evidence: string; reason: string }>();

            for (const { question, evidence, reason } of descartadas) {
              porTexto.set(claveDePregunta({ question }), { question, evidence, reason });
            }

            return [...porTexto.values()];
          };

          if (aceptadas.length === 0) {
            return {
              ...(exerciseId ? { exerciseId } : {}),
              added: 0,
              rejected: rechazadasParaElModelo(),
              ...(escrito.nota ? { writerNote: escrito.nota } : {}),
              note: 'Nothing was created: not one question came back with a sentence that is actually in those lessons. Do NOT write the questions yourself to fill the gap — check you passed the right lessons, and tell the teacher if those lessons have nothing to assess.'
            };
          }

          const filasDePregunta = (desde: number, exerciseSectionId?: string) =>
            aceptadas.map((pregunta, i) => ({
              question: pregunta.question,
              questionTypeId: pregunta.questionTypeId,
              points: pregunta.points,
              order: desde + i,
              ...(exerciseSectionId ? { exerciseSectionId } : {}),
              options: pregunta.options.map((opcion) => ({ label: opcion.label, isCorrect: opcion.isCorrect })),
              settings: settingsConEvidencia(pregunta)
            }));

          let creado = false;

          if (!exerciseId) {
            // Sin bloque, el ejercicio nace con sus preguntas adentro, en una
            // sola transacción: es lo que evita la cáscara vacía que un fallo a
            // mitad de camino dejaría. Con bloque hay que crearlo antes de
            // poder asignarlas, y ahí sí son dos pasos.
            const exercise = await createExercise({
              title: args.title!,
              courseId,
              lessonId,
              sectionId,
              order: args.order,
              questions: args.blockTitle ? [] : filasDePregunta(0)
            });

            // El ejercicio nuevo todavía no tiene manija, y las de sus hermanos
            // pueden haberse corrido.
            manijas.invalidar();
            await recordBinding(args.planKey, exercise.id);

            exerciseId = exercise.id;
            exerciseTitle = exercise.title ?? args.title!;
            creado = true;
          }

          let exerciseSectionId: string | undefined;

          if (args.blockTitle) {
            const bloques = await getExerciseSectionsByExerciseId(exerciseId);
            const bloque = await createExerciseSectionService(exerciseId, {
              title: args.blockTitle,
              order: bloques.length
            });

            exerciseSectionId = bloque.id;
          }

          // Sólo cuando las preguntas no viajaron ya en el alta. Se mandan sólo
          // las nuevas: reenviar las viejas las reescribe, y así se perdía la
          // respuesta de las numéricas.
          if (exerciseSectionId || !creado) {
            await updateExerciseService(exerciseId, {
              questions: filasDePregunta(preguntasQueYaTiene, exerciseSectionId)
            });
          }

          anotarCambio(registro, 'pregunto', exerciseTitle);

          return {
            exerciseId,
            handle: await manijas.manijaDe(exerciseId),
            title: exerciseTitle,
            added: aceptadas.length,
            ...(creado ? { created: true } : {}),
            ...(exerciseSectionId ? { exerciseSectionId, blockTitle: args.blockTitle } : {}),
            ...(descartadas.length > 0 ? { rejected: rechazadasParaElModelo() } : {}),
            ...(sinContenido.length > 0 ? { lessonsWithoutContent: sinContenido } : {}),
            ...(escrito.nota ? { writerNote: escrito.nota } : {}),
            note:
              'Every question saved quotes a sentence of the lessons you listed. Do not restate them in chat — the teacher reads them in the exercise.' +
              (descartadas.length > 0
                ? ` ${descartadas.length} question(s) were discarded because the server could not find their evidence in those lessons: that is the check doing its job, so do NOT write them by hand.`
                : '') +
              (escrito.nota ? ' Pass the writerNote on to the teacher.' : '')
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
          const exerciseId = await manijas.ejercicio(args.exerciseId);
          await verifyExerciseBelongsToCourse(exerciseId, courseId);

          // Los parches se resuelven acá, una vez, y desde acá se trabaja con la
          // copia resuelta: si el modelo nombró el bloque por manija, el id que
          // llega a la base tiene que ser el mismo que se validó.
          const parches = await Promise.all(
            args.questions.map(async (patch) => ({
              ...patch,
              ...(patch.exerciseSectionId
                ? { exerciseSectionId: await resolverBloqueDeEjercicio(exerciseId, patch.exerciseSectionId) }
                : {})
            }))
          );

          const sectionIdsInPatches = new Set<string>();
          for (const patch of parches) {
            if (patch.exerciseSectionId === undefined || patch.exerciseSectionId === null) {
              continue;
            }

            assertValidUuid('ExerciseSection', patch.exerciseSectionId);
            sectionIdsInPatches.add(patch.exerciseSectionId);
          }

          if (sectionIdsInPatches.size > 0) {
            const sections = await getExerciseSectionsByExerciseId(exerciseId);
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

          const existing = await getExercise(exerciseId);

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
            parches,
            exerciseId
          );

          await updateExerciseService(exerciseId, { questions: merged });

          return {
            exerciseId,
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
          // Todo se resuelve ANTES de mover nada: una manija se lee contra el
          // orden viejo, y a mitad de un reordenamiento ya no significa lo mismo.
          const secciones = args.sections
            ? await Promise.all(
                args.sections.map(async (section) => ({ ...section, id: await manijas.seccion(section.id) }))
              )
            : undefined;
          const items = args.items
            ? await Promise.all(
                args.items.map(async (item) => ({
                  ...item,
                  id: item.type === 'LESSON' ? await manijas.leccion(item.id) : await manijas.ejercicio(item.id),
                  ...(item.sectionId ? { sectionId: await manijas.seccion(item.sectionId) } : {})
                }))
              )
            : undefined;

          if (secciones) {
            for (const section of secciones) {
              await verifySectionBelongsToCourse(section.id, courseId);
            }
          }

          if (items) {
            for (const item of items) {
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

          const resultado = await reorderCourseContent(courseId, { sections: secciones, items });

          // Esto es lo único que mueve a todo el mundo de lugar: después de acá,
          // cualquier manija que el modelo tenga anotada apunta a otra pieza.
          manijas.invalidar();

          return {
            ...resultado,
            note: 'Handles changed: call get_course_structure before using one.'
          };
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
          const lessonId = await manijas.leccion(args.lessonId);
          await verifyLessonBelongsToCourse(lessonId, courseId);
          const lesson = await getLesson(lessonId);

          if (!confirmacionCoincide(args.confirmTitle, lesson.title)) {
            throw new Error(
              avisoDeConfirmacion({
                tipo: 'lesson',
                id: lessonId,
                declarado: args.confirmTitle,
                real: lesson.title
              })
            );
          }

          await deleteLessonService(lessonId);
          // Borrar corre a las que venían detrás: la manija de cada una bajó uno.
          manijas.invalidar();

          return {
            deleted: true,
            id: lessonId,
            title: lesson.title,
            note: 'The lesson is gone, and the handles after it have shifted: call get_course_structure before using one. If it was part of an approved plan, the Plan Progress block will now show it as missing and you must NOT rebuild it — tell the teacher it is out of the plan too.'
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
          const exerciseId = await manijas.ejercicio(args.exerciseId);
          await verifyExerciseBelongsToCourse(exerciseId, courseId);
          const exercise = await getExercise(exerciseId);

          if (!confirmacionCoincide(args.confirmTitle, exercise.title)) {
            throw new Error(
              avisoDeConfirmacion({
                tipo: 'exercise',
                id: exerciseId,
                declarado: args.confirmTitle,
                real: exercise.title
              })
            );
          }

          await deleteExerciseForCourseService(courseId, exerciseId);
          manijas.invalidar();

          return {
            deleted: true,
            id: exerciseId,
            title: exercise.title,
            note: 'Handles changed: call get_course_structure before using one.'
          };
        });
      }
    }),

    delete_section: tool({
      description:
        'Delete an EMPTY section from this course. If the section still contains lessons or exercises, the delete is refused and they are listed — remove them one by one first, so that destroying a whole branch of the course is never a single call. Pass `confirmTitle` with the section’s exact current title from get_course_structure.',
      inputSchema: deleteSectionParam,
      execute: async (args) => {
        return executeAgentTool('delete_section', { orgId, userId, courseId, args }, async () => {
          const sectionId = await manijas.seccion(args.sectionId);
          await verifySectionBelongsToCourse(sectionId, courseId);

          const [sections, items] = await Promise.all([listCourseSections(courseId), getCourseContentItems(courseId)]);
          const section = sections.find((s) => s.id === sectionId);

          if (!section) {
            throw new Error(
              `No section with id "${sectionId}" exists in this course. Call get_course_structure and use a real id.`
            );
          }

          // Una sección sin título no se puede confirmar por título, y ese es
          // justo el caso en que hay que negarse: sin nada contra qué contrastar,
          // el único control que tenemos no existe.
          if (!section.title) {
            throw new Error(
              `Section ${sectionId} has no title, so the confirmation check cannot run and this delete is refused. Give it a title with update_section first, or ask the teacher to delete it from the course page.`
            );
          }

          if (!confirmacionCoincide(args.confirmTitle, section.title)) {
            throw new Error(
              avisoDeConfirmacion({
                tipo: 'section',
                id: sectionId,
                declarado: args.confirmTitle,
                real: section.title
              })
            );
          }

          // Una sección borra en cascada todo lo que cuelga de ella. Que eso pase
          // en UNA llamada convierte un id equivocado en la pérdida de un curso
          // entero, así que se exige vaciarla primero: el modelo tiene que pasar
          // por cada hijo, y cada uno de esos pasos vuelve a pedir el título.
          const dentro = items.filter((i) => i.sectionId === sectionId);

          if (dentro.length > 0) {
            const lista = dentro.map((i) => `"${i.title ?? '(sin título)'}" (${i.type}, id: ${i.id})`).join(', ');

            throw new Error(
              `Refusing to delete section "${section.title}": it still contains ${dentro.length} item(s) — ${lista}. Nothing was deleted. Delete each one first with delete_lesson / delete_exercise, then delete the section. If the teacher only wanted the section EMPTIED, stop here: it is already empty once those are gone.`
            );
          }

          await deleteCourseSectionService(sectionId);
          manijas.invalidar();

          return {
            deleted: true,
            id: sectionId,
            title: section.title,
            note: 'Handles changed: call get_course_structure before using one.'
          };
        });
      }
    }),

    generate_course_plan: tool({
      description:
        'Generate a structured course plan with sections and lessons. Always use this when asked to design or plan a course. When the course already has content and the teacher asked to change PART of it, set scope to "changes" and list only the sections you touch, each item with its action/target/changes.',
      inputSchema: coursePlanParam,
      execute: async (args) => {
        return executeAgentTool('generate_course_plan', { orgId, userId, courseId, args }, async () => {
          const envelope = coursePlanParam.parse(args);
          const plan = CoursePlanSchema.parse(envelope.plan);
          const sectionCount = plan.sections.length;
          const itemCount = plan.sections.reduce((sum, section) => sum + section.items.length, 0);

          trackAgentEvent(AgentEvent.PLAN_GENERATED, { orgId, userId, courseId, sectionCount, itemCount });

          /**
           * Un plan de cambios nombra piezas que ya existen: se resuelven ACÁ.
           *
           * El momento es el punto. Un `target` que no apunta a nada no falla al
           * aprobar ni al construir: falla en silencio, y el docente aprueba una
           * orden que nunca se va a poder ejecutar. Resolverlo antes de que la
           * tarjeta se dibuje deja el error donde se puede corregir en un paso,
           * que es dentro de la misma ronda del modelo.
           */
          let atadura;

          if (plan.scope === 'changes') {
            const mapa = await manijas.mapa();
            const resolved: Array<{ title: string; handle: string; id: string }> = [];
            const unresolved: Array<{ title: string; target: string }> = [];

            const anotar = (titulo: string, valor: string, tipo: 'section' | 'lesson' | 'exercise') => {
              try {
                const id = resolverEnMapa(mapa, valor, tipo);
                const manija = mapa.manijaPorId.get(id);

                // Un UUID lo deja pasar `resolverEnMapa` sin mirar nada: si no
                // está en el mapa, es de otro curso o está inventado, y los dos
                // casos se contestan igual.
                if (!manija) {
                  unresolved.push({ title: titulo, target: valor });
                  return;
                }

                resolved.push({ title: titulo, handle: manija, id });
              } catch {
                unresolved.push({ title: titulo, target: valor });
              }
            };

            for (const seccion of plan.sections) {
              if (seccion.sectionId) anotar(seccion.title, seccion.sectionId, 'section');

              for (const item of seccion.items) {
                if ((item.action ?? 'create') === 'create') continue;
                if (item.target) anotar(item.title, item.target, item.type);
              }
            }

            atadura = {
              resolved,
              ...(unresolved.length > 0
                ? {
                    unresolved,
                    note: 'Some targets of this plan do not name anything in this course. Fix these BEFORE the teacher sees it: call get_course_structure, take the right handles, and call generate_course_plan again with the same plan.'
                  }
                : {})
            };
          }

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
            // Sólo lo que se va a ESCRIBIR de cero. Una lección que ya existe y
            // que el plan manda retocar no necesita declarar de qué fuente sale:
            // salió de la que la escribió, y pedírselo devolvería una lista de
            // huérfanas que no se pueden arreglar sin reescribirlas.
            const items = plan.sections
              .flatMap((section) => section.items)
              .filter((item) => (item.action ?? 'create') === 'create');
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

          return { ...plan, ...(cobertura ? { coverage: cobertura } : {}), ...(atadura ?? {}) };
        });
      }
    }),

    /**
     * Qué del curso deja viejo un documento nuevo.
     *
     * Es de LECTURA: no cambia nada, propone. Lo que devuelve es el insumo del
     * plan de cambios, y lo que guarda es lo que después le permite al servidor
     * medir si la orden se cumplió — ver `cambios-de-fuente.ts`.
     */
    analyze_source_changes: tool({
      description:
        'Compare a NEW source document against everything this course already says, and get back the list of facts it changes: the old value, the new one, why, and exactly where the old one still is (which lesson, which block, which question). Call this FIRST when the teacher uploads a document that updates the course, BEFORE proposing a plan — then propose a change plan with one edit item per lesson or exercise listed here. It changes nothing on its own.',
      inputSchema: analyzeSourceChangesParam,
      execute: async (args) => {
        return executeAgentTool('analyze_source_changes', { orgId, userId, courseId, args }, async () => {
          if (!analizarCambios) {
            throw new Error('Source analysis is unavailable on this turn.');
          }

          const fuentes = await documentosDelCurso();
          const fuente = buscarFuente(args.sourceId, fuentes);

          if (!fuente) {
            throw new Error(
              `No source called "${args.sourceId}" belongs to this course. Copy an id or a file name from the "## Course Sources — index" list — do not invent one.`
            );
          }

          if (!fuente.text.trim()) {
            throw new Error(
              `"${fuente.fileName}" has no readable text, so there is nothing to compare. Tell the teacher the file could not be read.`
            );
          }

          const [estado, mapa] = await Promise.all([estadoDelContenido(courseId, locale), manijas.mapa()]);
          const mapeadas = [...mapa.sections.flatMap((s) => s.lessons), ...mapa.unfiled.lessons];
          const lecciones = mapeadas
            .map((leccion) => ({
              id: leccion.id,
              handle: leccion.manija,
              title: leccion.title,
              html: estado.textoPorLeccion.get(leccion.id) ?? ''
            }))
            .filter((leccion) => leccion.html.trim().length > 0);

          if (lecciones.length === 0) {
            return {
              source: fuente.fileName,
              changes: [],
              note: 'This course has no written lessons in this language yet, so nothing can be out of date. Build it from this source instead of updating it.'
            };
          }

          const { cambios } = await analizarCambios({
            fuenteNueva: { fileName: fuente.fileName, text: fuente.text },
            lecciones: lecciones.map((leccion) => ({
              handle: leccion.handle,
              title: leccion.title,
              text: textoDeLeccion(leccion.html)
            }))
          });

          // El barrido: el modelo dice QUÉ cambió, el servidor dice DÓNDE está.
          // Un valor que no aparece en ninguna parte se descarta acá — es la
          // mitad determinista, y es lo que impide que una orden de edición
          // mande a cambiar algo que el curso nunca dijo.
          const preguntas = [...estado.preguntasPorEjercicio.values()].flat();
          const ocurrencias = barrerValores({
            // Con la clave y su contexto: la frase larga de la lección no
            // aparece en las preguntas, que dicen el mismo dato con otras
            // palabras. Ver `cambios-de-fuente.ts`.
            valores: cambios.map(valorDelCambio),
            lecciones: lecciones.map((leccion) => ({
              id: leccion.id,
              title: leccion.title,
              content: leccion.html
            })),
            preguntas
          });

          const conLugar = cambios
            .map((cambio) => ({
              cambio,
              donde: ocurrencias.filter((o) => o.valorViejo === cambio.valorViejo.trim())
            }))
            .filter((fila) => fila.donde.length > 0);

          await guardarAnalisisDeFuente({
            ...runScope,
            sourceId: fuente.id,
            fileName: fuente.fileName,
            cambios: conLugar.map((fila) => fila.cambio)
          }).catch((error: unknown) =>
            console.error('[analyze_source_changes] no se pudo guardar el análisis:', error)
          );

          const descartados = cambios.length - conLugar.length;

          return {
            source: fuente.fileName,
            changes: conLugar.map((fila) => ({
              old: fila.cambio.valorViejo,
              new: fila.cambio.valorNuevo,
              why: fila.cambio.motivo,
              occurrences: fila.donde.map((ocurrencia) => ({
                handle: manijaDe(mapa, ocurrencia.lessonId ?? ocurrencia.exerciseId ?? ''),
                ...(ocurrencia.blockId ? { blockId: ocurrencia.blockId } : {}),
                ...(ocurrencia.questionId !== undefined ? { questionId: ocurrencia.questionId } : {}),
                text: ocurrencia.texto
              }))
            })),
            ...(descartados > 0
              ? {
                  discarded: descartados,
                  discardedNote: `${descartados} proposed change(s) named a value that is nowhere in this course, so they were dropped.`
                }
              : {}),
            note:
              conLugar.length === 0
                ? 'This document changes nothing the course already says. Tell the teacher that, and do not propose a plan.'
                : 'Propose a change plan (generate_course_plan with scope "changes"): one edit item per lesson AND one per exercise listed here, with target = its handle and `changes` saying what replaces what. An occurrence with a questionId is a question that still teaches the old value — the exercise needs its own edit item, or the course will teach the new value and test the old one. The server will attach these replacements to the plan and check they are really gone.'
          };
        });
      }
    }),

    /**
     * La salida declarada para un «todavía está» que el servidor no puede
     * resolver.
     *
     * ── Qué se midió ────────────────────────────────────────────────────────
     *
     * 2026-09-22. Un cambio pedía reemplazar «2 horas» con el contexto `["P2",
     * "primera respuesta"]`. La lección de escalamiento dice, legítimamente,
     * «Incidente P1 (Crítica) … Sin resolver a las 2 horas … Incidente P2
     * (Alta)»: un diagrama, todo en un bloque y sin puntos. El `P2` queda a
     * menos de 160 caracteres de esa «2 horas» que es del P1, así que el
     * barrido dice «todavía está» y el ítem no se puede dar por hecho NUNCA.
     * Costó dos rondas (260 s), dos `replace_lesson_block` que no cambiaron
     * nada, y al final el modelo escribió «2 h» en lugar de «2 horas» para que
     * el riel se callara: deformó una frase correcta para salir del bucle.
     *
     * Se probaron sobre el texto real la heurística de distancia y la de
     * oración: en ese diagrama el P2 está MÁS cerca que el P1. Ninguna regla
     * determinista los distingue ahí; sólo el modelo puede, y no tenía cómo
     * decirlo.
     *
     * ── Qué comprueba el servidor antes de aceptarla ────────────────────────
     *
     * Que el ítem exista en el registro, que sea una orden de cambio y que su
     * contenido YA haya cambiado respecto de la línea de base. Sin lo último
     * esto sería un botón de «dar por hecho» sin editar nada, que es peor que
     * el bucle: primero hay que haber hecho el cambio.
     */
    confirm_change_applied: tool({
      description:
        'Declare that a change-plan item is done even though the Plan Progress still finds the old value, because the remaining occurrences belong to a DIFFERENT rule or context than the one the source changed (for example a "2 horas" that is the P1 deadline, not the P2 one the new document changed). The server cannot tell those apart; you can. It accepts this only for an item you have already edited in this conversation, and records your reason next to the item so the teacher sees it was a judgement, not a measurement. Never rewrite a correct sentence just to make the check go quiet, and never use this instead of making a change you have not made.',
      inputSchema: confirmChangeAppliedParam,
      execute: async (args) => {
        return executeAgentTool('confirm_change_applied', { orgId, userId, courseId, args }, async () => {
          const registroDelPlan = await readPlanRegistry(runScope);
          const entrada = registroDelPlan.find((fila) => fila.key === args.planKey);

          if (!entrada) {
            throw new Error(
              `No plan item with key "${args.planKey}". Copy the [key] the Plan Progress block shows beside the item — do not invent one.`
            );
          }

          if (!entrada.action || entrada.action === 'create') {
            throw new Error(
              `Plan item "${args.planKey}" is not a change order (it is a ${entrada.action ?? 'create'} item), so there is nothing to confirm. Build it instead.`
            );
          }

          if (!entrada.entityId || !entrada.baseline) {
            throw new Error(
              `Plan item "${args.planKey}" has no baseline recorded, so the server cannot tell whether you changed anything. Make the edit the Plan Progress asks for.`
            );
          }

          const estado = await estadoDelContenido(courseId, locale);
          const hashActual =
            entrada.kind === 'lesson'
              ? estado.hashPorLeccion.get(entrada.entityId)
              : estado.hashPorEjercicio.get(entrada.entityId);

          if (hashActual === undefined || hashActual === entrada.baseline.contentHash) {
            throw new Error(
              `Nothing was recorded: "${entrada.title}" is byte-for-byte what it was when the plan was approved, so there is no change to confirm. Make the edit the Plan Progress asks for first; this tool is only for the occurrences that legitimately stay behind afterwards.`
            );
          }

          const guardado = await confirmarItemDelPlan({ ...runScope, planKey: args.planKey, reason: args.reason });

          if (!guardado) {
            throw new Error(
              `No plan item with key "${args.planKey}" in this conversation's registry. Copy the [key] from the Plan Progress block.`
            );
          }

          return {
            ok: true as const,
            planKey: args.planKey,
            title: entrada.title,
            note: 'Recorded. The Plan Progress will show this item as done, with your reason beside it so the teacher can see it was your judgement.'
          };
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

  return _options?.presupuesto ? conAvisoDePresupuesto(herramientas, _options.presupuesto) : herramientas;
}

import { z } from 'zod';
import { CoursePlanSchema } from '@cio/ai-assistant';
import {
  LANDING_PAGE_COURSE_DESCRIPTION_PLAIN_HINT,
  LANDING_PAGE_METADATA_DESCRIPTION_SECTION_HINT,
  LANDING_PAGE_SECTION_HTML_AGENT_HINT
} from '@cio/ai-assistant/tools';
import { QUESTION_TYPE_IDS as QUESTION_TYPE, QUESTION_TYPE_REGISTRY } from '@cio/question-types';
import { ZExerciseSectionAfterBehavior } from '@cio/utils/validation/exercise';
import { ZCourseLandingPageUpdate, ZCourseLandingPageMetadataUpdate } from '@cio/utils/validation/course';

// courseId is NOT a parameter — it's injected from the authenticated request context.
// This prevents prompt injection from tricking the LLM into targeting another course.

export const emptyParam = z.object({});

/**
 * Cómo se nombra una pieza del curso en cualquier argumento.
 *
 * La manija (`S2.L3`) se DERIVA de la estructura; el UUID hay que COPIARLO de un
 * resultado que el recorte de contexto quizá ya sacó de la vista, y eso es lo
 * que salió mal seis veces en dos días de pruebas. Ver `manijas.ts`.
 */
const piezaPorManija = (que: string) =>
  `The ${que}: its handle from get_course_structure (for example S2.L3), or the id a tool returned. Never invent either one.`;

/**
 * El idioma NO es argumento de ninguna herramienta.
 *
 * Lo elegía el modelo con un `default('en')`, y así dos lecciones de un curso en
 * español se guardaron en inglés: contenido que el editor no muestra y que la
 * búsqueda no encuentra. Ahora lo pone el servidor con el de la ronda
 * (`buildAgentTools(..., { locale })`), que es el del curso que el docente tiene
 * abierto. No hay forma de pedir otro.
 */

export const lessonReadParam = z.object({ lessonId: z.string().describe(piezaPorManija('lesson to read')) });

/**
 * Leer varias lecciones de una vez, como texto. Es para escribir preguntas que
 * salgan de lo que las lecciones dicen: el constructor ya no las escribe él
 * mismo, así que no tiene su texto. Hasta 12 por llamada alcanza para una
 * sección entera, o para un bloque del examen final, en un solo paso.
 */
export const readLessonsParam = z.object({
  lessonIds: z
    .array(z.string())
    .min(1)
    .max(12)
    .describe('The lessons to read, by their handle from get_course_structure (for example S2.L3) or by id.')
});

// RAG for edits (step 6): search relevant fragments of an attached document
// instead of reading the whole thing. documentId is injected from context.
/**
 * Buscar en lo que el CURSO ya dice, que es distinto de buscar en las fuentes.
 *
 * Literal y no semántica a propósito: el caso es «dónde dice esto que hay que
 * sacar», y para eso una coincidencia exacta es la respuesta correcta. La
 * búsqueda por significado ya existe para las fuentes (`search_document`).
 */
export const searchLessonsParam = z.object({
  query: z
    .string()
    .min(3)
    .max(200)
    .describe('The exact words to find inside the course lessons. Accents and case are ignored.')
});

export const searchDocumentParam = z.object({
  query: z
    .string()
    .min(1)
    .max(300)
    .describe(
      'What to look for, in a few key words (for example "plazo de cambio proveedor"). Words are matched without accents or case, singular or plural; passages that contain more of them rank first.'
    ),
  limit: z.number().int().min(1).max(10).default(6)
});
/**
 * Leer una fuente del curso, por tramos.
 *
 * `offset`/`limit` en LÍNEAS y no en caracteres porque es lo que el modelo puede
 * seguir sin llevar la cuenta: la lectura vuelve numerada, así que continuar es
 * pedir desde la última línea que vio.
 */
export const readSourceParam = z.object({
  sourceId: z
    .string()
    .min(1)
    .describe('The id of the source, copied exactly from the "## Course Sources — index" list.'),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First line to read (1-based). Omit to start at the beginning.'),
  limit: z.number().int().min(1).max(2000).optional().describe('How many lines to read. Defaults to 600.')
});

/**
 * Comparar una fuente nueva contra el curso ya escrito.
 *
 * Un solo argumento a propósito: el trabajo es del servidor, y cuanto menos
 * tenga que declarar el modelo acá, menos hay que inventar. Qué lecciones se
 * comparan no es una decisión suya — son todas, porque un dato viejo que quedó
 * en la lección que nadie miró es exactamente el que se busca.
 */
export const analyzeSourceChangesParam = z.object({
  sourceId: z
    .string()
    .min(1)
    .describe(
      'The NEW document, by its id from the "## Course Sources — index" list (its file name also works). The server compares it against every lesson and question of this course.'
    )
});

/**
 * Declarar que una orden de cambio ya está cumplida aunque el barrido siga
 * encontrando el valor viejo.
 *
 * `reason` no es opcional a propósito: lo que se guarda al lado del ✅ es lo que
 * el docente lee para decidir si le cree. Una confirmación sin motivo sería un
 * botón de «dar por hecho», que es exactamente lo que esto NO es.
 */
export const confirmChangeAppliedParam = z.object({
  planKey: z
    .string()
    .min(1)
    .describe('The [key] shown beside the item in the Plan Progress block (for example "s1.2"). Copy it, never guess.'),
  reason: z
    .string()
    .min(12)
    .describe(
      'Why the remaining occurrences of the old value are legitimate: which other rule or context they belong to. The teacher reads this next to the item, so write it in the course language and name the distinction (for example: the remaining "2 horas" is the P1 deadline, which the new circular does not change).'
    )
});

export const exerciseReadParam = z.object({
  exerciseId: z.string().describe(piezaPorManija('exercise to read'))
});

/**
 * Borrar exige decir QUÉ se borra, no sólo cuál id.
 *
 * `confirmTitle` no es cortesía: es el único control que atrapa el error que de
 * verdad ocurre, que es un id equivocado. Un id equivocado apunta a otra fila, y
 * esa fila casi nunca se llama igual. Ver `deletion.ts`.
 */
const confirmTitleParam = z
  .string()
  .min(1)
  .describe(
    'The exact current title of the item you are deleting, copied from get_course_structure. The server refuses the delete if it does not match the row this id points at — that is what stops a wrong id from destroying the wrong work.'
  );

export const deleteLessonParam = z.object({
  lessonId: z.string().describe(piezaPorManija('lesson to delete')),
  confirmTitle: confirmTitleParam
});
export const deleteExerciseParam = z.object({
  exerciseId: z.string().describe(piezaPorManija('exercise to delete')),
  confirmTitle: confirmTitleParam
});
export const deleteSectionParam = z.object({
  sectionId: z.string().describe(piezaPorManija('section to delete')),
  confirmTitle: confirmTitleParam
});

/**
 * Ties a create_* call back to the plan item it implements. Optional and free of
 * validation constraints on purpose: a missing or unknown key must degrade to a
 * plain create, never to a tool-input error.
 *
 * When present, the create becomes idempotent — a second call with the same key
 * returns the row already built instead of inserting a duplicate. That is the
 * hard stop for the duplication the title-matching anchor used to cause.
 */
const planKeyParam = z
  .string()
  .min(1)
  .max(128)
  .optional()
  .describe(
    'The planKey shown next to this item in the Plan Progress block (e.g. "s1", "s1.2"). Always pass it when building an approved plan — it prevents duplicates if this item was already created.'
  );

export const createSectionParam = z.object({
  title: z.string().min(1),
  order: z.number().int().min(0),
  planKey: planKeyParam
});
export const updateSectionParam = z
  .object({
    sectionId: z.string().describe(piezaPorManija('section to update')),
    title: z.string().min(1).optional(),
    order: z.number().int().min(0).optional()
  })
  .refine((data) => data.title !== undefined || data.order !== undefined, {
    message: 'Provide at least one field to update'
  });
export const createLessonParam = z.object({
  sectionId: z.string().describe(piezaPorManija('section this lesson goes in')),
  title: z.string().min(1),
  order: z.number().int().min(0),
  planKey: planKeyParam,
  // Writing the body here instead of in a follow-up `update_lesson_content` call
  // saves a whole round trip per lesson. A build round re-sends the entire
  // context on every step (~25k tokens), so the second call costs that much to
  // carry information the model already had when it made the first one.
  content: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Lesson body HTML. Pass it here to create the lesson AND write its content in ONE call — this is the normal way to build a planned lesson. Same rules as update_lesson_content: body only, no lesson title, headings start at h3.'
    )
});
/**
 * Escribir una lección con el sub-agente escritor.
 *
 * La entrada es CHICA a propósito, y es la mitad del beneficio: el agente que
 * construye el curso manda una consigna y una lista de fuentes, no veinte mil
 * caracteres de HTML. Esa entrada queda en su contexto por el resto de la ronda;
 * con `create_lesson` + `content`, a la lección doce arrastraba las once
 * anteriores enteras.
 *
 * Un solo objeto con `.refine` y no una unión: la unión se serializa como
 * `anyOf`, y el mismo archivo documenta más abajo que el modelo, antes que
 * armarla mal, prefiere omitir la clave entera.
 */
export const writeLessonParam = z
  .object({
    lessonId: z
      .string()
      .optional()
      .describe(
        `Rewrite this existing lesson — ${piezaPorManija('lesson')} Omit it to create a new lesson with sectionId, title and order.`
      ),
    sectionId: z.string().optional().describe(piezaPorManija('section a new lesson goes in')),
    title: z.string().min(1).optional().describe('Title for a new lesson.'),
    order: z.number().int().min(0).optional().describe('Order of a new lesson within its section.'),
    planKey: planKeyParam,
    brief: z
      .string()
      .min(1)
      .describe(
        'What this lesson must teach: its description from the plan, plus anything the teacher asked for it. The writer sees ONLY this brief, the course outline and the sources you list — so be specific about scope, and about what the neighbouring lessons already cover. When rewriting an existing lesson, the writer sees its current content and keeps what the brief does not ask to change: say so in the brief when the teacher wants it rewritten from scratch.'
      ),
    sources: z
      .array(z.string())
      .describe(
        'The sources that carry this lesson (file names or ids from the Course Sources list): during a build, exactly as the approved plan declared them; for a single lesson asked for in chat, the ones whose material covers it. An empty array means it is written from general professional knowledge.'
      )
  })
  .refine((d) => !!d.lessonId || (!!d.sectionId && !!d.title && d.order !== undefined), {
    message: 'Pass lessonId to rewrite an existing lesson, or sectionId + title + order to create a new one.'
  });

export const updateLessonParam = z
  .object({
    lessonId: z.string().describe(piezaPorManija('lesson to update')),
    title: z.string().min(1).optional(),
    sectionId: z.string().optional().describe(piezaPorManija('section to move it to')),
    order: z.number().int().min(0).optional(),
    lessonAt: z.string().optional(),
    callUrl: z.string().optional(),
    isUnlocked: z.boolean().optional(),
    public: z.boolean().optional()
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.sectionId !== undefined ||
      data.order !== undefined ||
      data.lessonAt !== undefined ||
      data.callUrl !== undefined ||
      data.isUnlocked !== undefined ||
      data.public !== undefined,
    {
      message: 'Provide at least one field to update'
    }
  );
export const updateContentParam = z.object({
  lessonId: z.string().describe(piezaPorManija('lesson to write')),
  content: z.string().min(1)
});

export const editContentParam = z.object({
  lessonId: z.string().describe(piezaPorManija('lesson to edit')),
  oldString: z
    .string()
    .min(1)
    .describe(
      'Exact, VERBATIM text/HTML to replace, copied as-is from get_lesson_content (same whitespace, quotes, and HTML entities). Must appear exactly once unless replaceAll is true. Include enough surrounding context to make it unique.'
    ),
  newString: z
    .string()
    .describe(
      'Replacement text/HTML. May be an empty string to delete the fragment. Keep headings at h3 or lower and use only allowed HTML.'
    ),
  replaceAll: z
    .boolean()
    .optional()
    .describe('If true, replace ALL occurrences. Defaults to false, which requires oldString to be unique.')
});

export const replaceBlockParam = z.object({
  lessonId: z.string().describe(piezaPorManija('lesson that contains the block')),
  blockId: z
    .string()
    .min(1)
    .describe('The data-block-id of the block to replace, taken from get_lesson_content. Not a guess — copy it.'),
  html: z
    .string()
    .describe(
      'The complete replacement block, including its own outer tag (e.g. "<p>…</p>"). May be an empty string to delete the block. Keep headings at h3 or lower and use only allowed HTML.'
    )
});

/**
 * Una pregunta tal como la crea el agente.
 *
 * `settings` existe porque sin él había tipos IMPOSIBLES de crear bien. Una
 * pregunta numérica guarda su respuesta en `settings.correctValue`, y este
 * esquema no tenía el campo: la única forma de escribir un número era meterlo
 * en `options`, que para este tipo no se lee. El modelo no estaba siendo
 * descuidado, estaba usando el único campo que existía, y el resultado es una
 * pregunta que le pone cero a todo el mundo. Medido en producción: 3 de 27
 * numéricas quedaron así.
 *
 * Con el campo, además, se crea de UNA llamada: antes hacían falta dos
 * (`create_exercise` y después `update_questions` para el ajuste), y la segunda
 * es justo la que se pierde cuando la ronda se queda sin pasos.
 *
 * Los campos van en `questionFields` y la regla del tipo numérico en
 * `questionSchema`, que es el que usan las herramientas.
 */

/**
 * Los campos de una pregunta, SIN la regla del tipo numérico.
 *
 * Existe aparte porque el escritor de preguntas (`question-writer.ts`) lo usa
 * como esquema de salida de `generateObject`, y ahí una refinación que falla no
 * descarta la pregunta mala: tumba la llamada entera y se pierden las ocho que
 * estaban bien. Quien llama valida cada pregunta por separado con
 * `questionSchema` y descarta sólo la que no pasa.
 */
export const questionFields = z.object({
  question: z.string().min(1),
  questionTypeId: z
    .number()
    .int()
    .min(1)
    .max(QUESTION_TYPE_REGISTRY.length)
    .describe(
      'Required. Use the numeric question type IDs from the teacher system prompt (Question Types). Omitting this field is invalid — set an explicit type on every question and vary types within each exercise.'
    ),
  points: z.number().min(0).default(1),
  order: z.number().int().min(0),
  /**
   * La evidencia: la frase de la lección que esta pregunta evalúa.
   *
   * Es el reemplazo del control «leíste estas lecciones en esta ronda», que
   * comprobaba el PROCESO y no el resultado. Medido el 2026-09-21: 4 de 8
   * preguntas de una autoevaluación no salían de la lección que decían evaluar,
   * con la lectura hecha y el control en verde.
   *
   * Una pregunta inventada puede sonar perfecta; su evidencia no, porque está
   * en la lección o no está, y eso el servidor lo busca.
   */
  evidence: z
    .string()
    .min(12)
    .describe(
      'The sentence of the lesson this question tests, copied VERBATIM (12+ characters). The server checks it appears in a lesson the exercise covers; a question whose evidence is not there is refused.'
    ),
  options: z
    .array(z.object({ label: z.string().min(1), isCorrect: z.boolean() }))
    .default([])
    .describe('Answer options. Leave empty for types whose answer lives in `settings`, such as NUMERIC.'),
  settings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Per-type answer storage. NUMERIC: { correctValue: number, tolerance?: number } — REQUIRED, and the question takes no options. STAR: { correctValue: number }. WORD_BANK: { correctAnswers: string[], template: string }.'
    )
});

/**
 * Cuántas opciones y cuántas correctas pide cada tipo de opción.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22: la práctica de una sección se creó con cinco
 * preguntas —dos RADIO, una CHECKBOX, una TRUE_FALSE y otra RADIO— SIN NINGUNA
 * opción, y el servidor las guardó las cinco. El log decía «6 pregunta(s) de 6
 * pedidas» y el resultado `added: 6`. Causa: `options` tiene `.default([])`, o
 * sea que omitirlo es válido, y la única regla de tipo que había miraba NUMERIC.
 *
 * Una pregunta de opción sin opciones es una pregunta que el alumno no puede
 * contestar, y encima es invisible para todo lo demás: el barrido de datos
 * viejos busca en las etiquetas de las opciones, y ahí no había ninguna.
 *
 * Esto vive en `questionSchema` —el esquema de CREACIÓN— y NO en
 * `updateQuestionPatchSchema`: una actualización parcial `{ id, question }`
 * tiene que seguir valiendo, porque ahí las opciones que no viajan son las que
 * ya están guardadas.
 */
const REGLA_POR_TIPO: Readonly<Record<number, { minimo: number; exacto?: number; correctas: 'una' | 'al-menos-una'; nombre: string }>> =
  {
    [QUESTION_TYPE.RADIO]: { minimo: 2, correctas: 'una', nombre: 'RADIO' },
    [QUESTION_TYPE.CHECKBOX]: { minimo: 2, correctas: 'al-menos-una', nombre: 'CHECKBOX' },
    [QUESTION_TYPE.TRUE_FALSE]: { minimo: 2, exacto: 2, correctas: 'una', nombre: 'TRUE_FALSE' }
  };

export const questionSchema = questionFields.superRefine((question, ctx) => {
    const regla = REGLA_POR_TIPO[question.questionTypeId];

    if (regla) {
      const opciones = question.options.length;
      const correctas = question.options.filter((opcion) => opcion.isCorrect).length;
      const cuantas =
        regla.exacto !== undefined ? `exactly ${regla.exacto} options` : `at least ${regla.minimo} options`;
      const cualCorrecta =
        regla.correctas === 'una' ? 'exactly one marked correct' : 'at least one marked correct';
      const mal =
        (regla.exacto !== undefined && opciones !== regla.exacto) ||
        opciones < regla.minimo ||
        (regla.correctas === 'una' ? correctas !== 1 : correctas < 1);

      if (mal) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message:
            `A ${regla.nombre} question needs ${cuantas} with ${cualCorrecta}; this one came with ` +
            `${opciones} option(s) and ${correctas} marked correct. A question with no options is one the ` +
            `learner cannot answer.`
        });
      }
    }

    if (question.questionTypeId !== QUESTION_TYPE.NUMERIC) return;

    const raw = question.settings?.correctValue;
    const correcto = typeof raw === 'number' ? raw : raw != null ? Number(raw) : Number.NaN;

    if (!Number.isFinite(correcto)) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings'],
        message:
          'A NUMERIC question needs its answer in settings.correctValue, as a number (add settings.tolerance too unless the answer is exact). Without it the grader awards 0 points to every submission.'
      });
    }

    if (question.options.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'A NUMERIC question takes no options: the answer goes in settings.correctValue, not in an option.'
      });
    }
  });

export const createExerciseParam = z.object({
  lessonId: z.string().optional().describe(piezaPorManija('lesson this exercise belongs to')),
  sectionId: z.string().optional().describe(piezaPorManija('section this exercise goes in')),
  title: z.string().min(1),
  description: z.string().optional().describe('Optional short description shown to students above the questions.'),
  order: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Display order within the section (0-based). Required when sectionId is provided. Lessons and exercises share the same order space within a section.'
    ),
  questions: z.array(questionSchema),
  planKey: planKeyParam
});

export const updateExerciseParam = z
  .object({
    exerciseId: z.string().describe(piezaPorManija('exercise to update')),
    title: z.string().min(1).optional().describe('New exercise title. Omit to keep unchanged.'),
    description: z
      .string()
      .optional()
      .describe('New short description shown to students. Pass an empty string to clear it.'),
    lessonId: z.string().optional().describe(`Link the exercise to a lesson. ${piezaPorManija('lesson')}`),
    sectionId: z.string().optional().describe(`Move the exercise to a section. ${piezaPorManija('section')}`),
    order: z.number().int().min(0).optional().describe('New order within the section (0-based).'),
    dueBy: z
      .string()
      .optional()
      .describe('Due date in ISO 8601 format (e.g. 2026-05-01T23:59:00Z). Omit to keep unchanged.'),
    isUnlocked: z.boolean().optional().describe('Whether the exercise is unlocked for students.'),
    allowMultipleAttempts: z.boolean().optional().describe('Whether students can re-take the exercise.')
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.lessonId !== undefined ||
      data.sectionId !== undefined ||
      data.order !== undefined ||
      data.dueBy !== undefined ||
      data.isUnlocked !== undefined ||
      data.allowMultipleAttempts !== undefined,
    {
      message: 'Provide at least one field to update'
    }
  );

export const updateExerciseSectionParam = z
  .object({
    exerciseId: z.string().describe(piezaPorManija('exercise that contains this block')),
    exerciseSectionId: z
      .string()
      .describe(
        'The question block inside that exercise: its handle (for example S2.E1.B2, or just B2) or the id from get_exercise_details `sections[].id` — not a course section id.'
      ),
    title: z.string().min(1).optional().describe('New section heading shown above questions in this block.'),
    description: z.string().optional().describe('Optional intro HTML for this block. Pass an empty string to clear it.')
  })
  .refine((data) => data.title !== undefined || data.description !== undefined, {
    message: 'Provide at least title or description to update'
  });

export const createExerciseSectionParam = z.object({
  exerciseId: z.string().describe(piezaPorManija('exercise that will contain this block')),
  title: z.string().min(1).describe('Section heading shown above the questions in this block.'),
  description: z
    .string()
    .optional()
    .describe('Optional intro HTML for this block. Pass an empty string to leave it blank.'),
  order: z.number().int().min(0).describe('Display order within the exercise (0-based).'),
  colorTheme: z.enum(['blue', 'green', 'amber', 'rose', 'violet', 'slate']).optional(),
  afterBehavior: ZExerciseSectionAfterBehavior.optional()
});

/**
 * Escribir las preguntas de un ejercicio con el sub-agente escritor.
 *
 * La entrada es chica por el mismo motivo que la de `write_lesson`: el
 * constructor manda las manijas de las lecciones y una consigna, no el texto.
 * Quien lee las lecciones enteras es el escritor, con contexto limpio, y lo que
 * vuelve son las preguntas ya verificadas contra ese texto.
 */
export const writeQuestionsParam = z.object({
  exerciseId: z
    .string()
    .optional()
    .describe(
      `Add the questions to this EXISTING exercise — ${piezaPorManija('exercise')} Omit it to create the exercise: then pass title, and sectionId (+ order) or lessonId.`
    ),
  sectionId: z.string().optional().describe(piezaPorManija('section a new exercise goes in')),
  lessonId: z.string().optional().describe(piezaPorManija('lesson a new exercise belongs to')),
  title: z.string().min(1).optional().describe('Title for a new exercise.'),
  order: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Order of a new exercise within its section (0-based). Lessons and exercises share the same order space.'),
  planKey: planKeyParam,
  blockTitle: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Put these questions in a NEW question block with this heading, instead of adding them loose. This is how the final exam is built: one call per prior course section, blockTitle = that section topic.'
    ),
  lessons: z
    .array(z.string())
    .min(1)
    .max(12)
    .describe(
      'The lessons this exercise covers, by handle (for example S2.L3) or id. The writer sees the full text of exactly these and nothing else, so every question will come from them.'
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('How many questions to write. Omit for the default (6–10, from how much the lessons say).'),
  brief: z
    .string()
    .optional()
    .describe(
      'One or two lines on what this exercise must assess: its description from the plan, plus anything the teacher asked for it.'
    )
});

export const addQuestionsParam = z.object({
  exerciseId: z.string().describe(piezaPorManija('exercise to add questions to')),
  exerciseSectionId: z
    .string()
    .optional()
    .describe(
      'The question block the new questions go in: its handle (for example S2.E1.B2, or just B2) or the id from get_exercise_details `sections[].id` — not a course outline section id.'
    ),
  questions: z.array(questionSchema)
});

export const updateQuestionSettingsSchema = z
  .object({
    correctValue: z.union([z.number(), z.string(), z.boolean()]).optional(),
    tolerance: z.number().min(0).optional(),
    correctAnswers: z.array(z.string().min(1)).optional(),
    template: z.string().min(1).optional(),
    maxStars: z.number().int().min(1).optional(),
    caseSensitive: z.boolean().optional(),
    distractors: z.array(z.string().min(1)).optional()
  })
  .passthrough()
  .refine((settings) => Object.keys(settings).length > 0, {
    message: 'Provide at least one settings field'
  })
  .describe(
    'Per-type correct-answer storage. NUMERIC: { correctValue: number, tolerance?: number }. STAR: { correctValue: number }. WORD_BANK: { correctAnswers: string[], template: string }.'
  );

export const updateOptionSchema = z.object({
  id: z.number().int().optional(),
  label: z.string().min(1).optional(),
  isCorrect: z.boolean().optional(),
  settings: updateQuestionSettingsSchema.optional()
});

export const updateQuestionPatchSchema = z
  .object({
    id: z.number().int(),
    question: z.string().min(1).optional(),
    questionTypeId: z.number().int().min(1).max(QUESTION_TYPE_REGISTRY.length).optional(),
    points: z.number().min(0).optional(),
    order: z.number().int().min(0).optional(),
    exerciseSectionId: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Move the question to this question block: its handle (for example S2.E1.B2, or just B2) or the id from get_exercise_details `sections[].id`. Use null to clear the block assignment.'
      ),
    settings: updateQuestionSettingsSchema.optional(),
    options: z.array(updateOptionSchema).optional()
  })
  .refine(
    (patch) =>
      patch.question !== undefined ||
      patch.questionTypeId !== undefined ||
      patch.points !== undefined ||
      patch.order !== undefined ||
      patch.exerciseSectionId !== undefined ||
      patch.settings !== undefined ||
      patch.options !== undefined,
    {
      message: 'Provide at least one field to update besides id'
    }
  );

export const updateQuestionsParam = z.object({
  exerciseId: z.string().describe(piezaPorManija('exercise whose questions change')),
  questions: z.array(updateQuestionPatchSchema).min(1)
});
export const coursePlanParam = z.object({ plan: CoursePlanSchema });

const courseTemplateIdParam = z.enum(['product_101', 'product_onboarding', 'expert_on_x']);

const agentTemplateFormFieldBase = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional()
});

/**
 * Deliberately NOT a `z.discriminatedUnion` on `type` — the same reasoning as
 * `TemplateFormFieldSchema` in `@cio/ai-assistant`, which was flattened for this
 * exact reason. A union serialises to JSON Schema as `anyOf` + `const`
 * discriminators, and MiniMax cannot reliably produce that shape.
 *
 * The earlier fix only reached the dashboard-facing schema; this is the one the
 * MODEL actually sees, and it stayed a union. Observed consequence: rather than
 * emit a malformed `fields` array, the model dropped the key entirely and sent
 * `{title, intro, formId}` — twice in a row — so `ask_discovery_questions` failed
 * validation and the plan never got generated.
 *
 * Flat enum + a conditional refinement expresses the same contract in a shape a
 * model can hit, and stays strict where it matters: `select` still needs options.
 */
const agentTemplateFormFieldParam = agentTemplateFormFieldBase
  .extend({
    type: z
      .enum(['text', 'textarea', 'url', 'select'])
      .describe('Input kind. Use "select" only when you also supply `options`.'),
    options: z
      .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
      .optional()
      .describe('Required when type is "select"; omit otherwise.')
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select' && !field.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'A field of type "select" needs at least one option ({ value, label }).'
      });
    }
  });

export const askTemplateQuestionsParam = z.object({
  templateId: courseTemplateIdParam,
  title: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(agentTemplateFormFieldParam).min(1)
});

export const askDiscoveryQuestionsParam = z.object({
  title: z.string().min(1).optional(),
  intro: z.string().optional(),
  formId: z.string().min(1),
  // Described explicitly because it carries the entire point of the call and was
  // the field the model kept omitting. An untyped bare array gave it no signal
  // that the questions themselves go here.
  fields: z
    .array(agentTemplateFormFieldParam)
    .min(1)
    .max(6)
    .describe(
      'REQUIRED — the questions to render, 1 to 6 of them. Each needs an `id`, a `label` (the question as the teacher reads it) and a `type`. Without this the card has nothing to show and the call fails.'
    )
});

export const fetchDocumentationUrlParam = z.object({
  url: z.string().url()
});

export const searchWebParam = z.object({
  query: z
    .string()
    .min(3)
    .describe(
      'REQUIRED — what to search for, written as you would type it into a search engine. Use the same language as the course.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('How many results to return. Defaults to 5.')
});

// Gemini's tool-schema validator only accepts string enums, so numeric/boolean
// `z.literal` values must be relaxed to plain types in the schemas the model sees.
export const agentLessonTabsOrder = z.array(
  z.object({
    id: z.number().int().min(1).max(4),
    name: z.string()
  })
);
export const agentLandingPageMetadataUpdate = ZCourseLandingPageMetadataUpdate.extend({
  lessonTabsOrder: agentLessonTabsOrder.optional(),
  requirements: z.string().optional().describe(LANDING_PAGE_SECTION_HTML_AGENT_HINT),
  description: z.string().optional().describe(LANDING_PAGE_METADATA_DESCRIPTION_SECTION_HINT),
  goals: z.string().optional().describe(LANDING_PAGE_SECTION_HTML_AGENT_HINT),
  instructor: z
    .object({
      name: z.string().optional(),
      role: z.string().optional(),
      coursesNo: z.number().optional(),
      description: z.string().optional().describe(LANDING_PAGE_SECTION_HTML_AGENT_HINT),
      imgUrl: z.string().optional()
    })
    .optional()
});
export const updateCourseLandingPageParam = ZCourseLandingPageUpdate.extend({
  title: z.string().min(1).optional().describe('Plain-text public course title (no HTML).'),
  description: z.string().min(1).optional().describe(LANDING_PAGE_COURSE_DESCRIPTION_PLAIN_HINT),
  overview: z.string().optional().describe(LANDING_PAGE_SECTION_HTML_AGENT_HINT),
  generateImage: z
    .boolean()
    .optional()
    .describe(
      'Set true to auto-resolve a banner image from Unsplash. The server searches Unsplash using imageQuery if provided, otherwise the course title. Use this to fix a missing-banner blocker — do NOT ask the teacher to describe an image.'
    ),
  imageQuery: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Optional Unsplash search query (1–120 chars). Omit to let the server use the course title.'),
  metadata: agentLandingPageMetadataUpdate.optional()
}).refine(
  (data) =>
    data.title !== undefined ||
    data.description !== undefined ||
    data.overview !== undefined ||
    data.cost !== undefined ||
    data.currency !== undefined ||
    data.imageUrl !== undefined ||
    data.generateImage !== undefined ||
    data.imageQuery !== undefined ||
    data.metadata !== undefined,
  {
    message: 'Provide at least one landing-page field to update'
  }
);
export const goLiveParam = z.object({
  confirmPublish: z
    .boolean()
    .describe('Must be true. Only use this after the teacher explicitly asks to publish or go live.')
});

export const reorderContentParam = z.object({
  sections: z
    .array(
      z.object({
        id: z.string().min(1).describe(piezaPorManija('section to move')),
        order: z.number().int().min(0)
      })
    )
    .optional()
    .describe('Reorder sections by setting new order values'),
  items: z
    .array(
      z.object({
        id: z.string().min(1).describe(piezaPorManija('lesson or exercise to move')),
        type: z.enum(['LESSON', 'EXERCISE']),
        order: z.number().int().min(0).optional().describe('New order within the section'),
        sectionId: z
          .string()
          .nullable()
          .optional()
          .describe(`Move item to a different section. ${piezaPorManija('target section')}`)
      })
    )
    .optional()
    .describe('Reorder or move lessons/exercises')
});

/**
 * The subject is prose, not a style sheet: the service appends the house style
 * and the no-text-in-the-image rule, so a caller that also describes those wastes
 * prompt on instructions that are already there.
 */
export const generateImageParam = z.object({
  subject: z
    .string()
    .min(12)
    .max(600)
    .describe(
      'What the picture should show, in one or two plain sentences. Describe the SCENE — the objects, the setting, the action, the point of view. Do NOT ask for text, labels or numbers inside the image: they come out wrong and the lesson supplies its own wording around it.'
    ),
  lessonId: z
    .string()
    .optional()
    .describe(
      `The lesson this illustrates, when there is one. Used to group the stored file and to keep the one-picture-per-lesson limit. ${piezaPorManija('lesson')}`
    ),
  aspectRatio: z
    .enum(['16:9', '4:3', '1:1', '3:4'])
    .default('16:9')
    .describe('16:9 for a banner or a wide scene, 4:3 or 1:1 for an object or a portrait subject.'),
  alt: z
    .string()
    .min(3)
    .max(200)
    .describe(
      'Alt text describing the image for a student using a screen reader. Written in the lesson’s language.'
    )
});

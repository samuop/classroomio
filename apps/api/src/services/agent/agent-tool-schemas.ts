import { z } from 'zod';
import { CoursePlanSchema } from '@cio/ai-assistant';
import {
  LANDING_PAGE_COURSE_DESCRIPTION_PLAIN_HINT,
  LANDING_PAGE_METADATA_DESCRIPTION_SECTION_HINT,
  LANDING_PAGE_SECTION_HTML_AGENT_HINT
} from '@cio/ai-assistant/tools';
import { QUESTION_TYPE_REGISTRY } from '@cio/question-types';
import { ZExerciseSectionAfterBehavior } from '@cio/utils/validation/exercise';
import { ZCourseLandingPageUpdate, ZCourseLandingPageMetadataUpdate } from '@cio/utils/validation/course';

// courseId is NOT a parameter — it's injected from the authenticated request context.
// This prevents prompt injection from tricking the LLM into targeting another course.

export const emptyParam = z.object({});

export const lessonReadParam = z.object({ lessonId: z.string(), locale: z.string().default('en') });

// RAG for edits (step 6): search relevant fragments of an attached document
// instead of reading the whole thing. documentId is injected from context.
export const searchDocumentParam = z.object({
  query: z
    .string()
    .min(1)
    .max(300)
    .describe('What to look for in the attached document (a topic, concept, or question).'),
  limit: z.number().int().min(1).max(10).default(6)
});
export const exerciseReadParam = z.object({ exerciseId: z.string() });

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
    sectionId: z.string(),
    title: z.string().min(1).optional(),
    order: z.number().int().min(0).optional()
  })
  .refine((data) => data.title !== undefined || data.order !== undefined, {
    message: 'Provide at least one field to update'
  });
export const createLessonParam = z.object({
  sectionId: z.string(),
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
    ),
  // Defaults to 'en' like every other content tool. Passing the course locale
  // matters: content written under the wrong one is invisible to the editor and
  // to RAG, which is how a course ended up with orphaned `en` rows once already.
  locale: z
    .string()
    .default('en')
    .describe('Locale for `content` — pass the course locale from the Current Context. Ignored when `content` is omitted.')
});
export const updateLessonParam = z
  .object({
    lessonId: z.string(),
    title: z.string().min(1).optional(),
    sectionId: z.string().optional(),
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
  lessonId: z.string(),
  locale: z.string().default('en'),
  content: z.string().min(1)
});

export const editContentParam = z.object({
  lessonId: z.string(),
  locale: z.string().default('en'),
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
  lessonId: z.string(),
  locale: z.string().default('en'),
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

export const questionSchema = z.object({
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
  options: z.array(z.object({ label: z.string().min(1), isCorrect: z.boolean() }))
});

export const createExerciseParam = z.object({
  lessonId: z.string().optional(),
  sectionId: z.string().optional(),
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
    exerciseId: z.string().describe('The exercise to update. Must be a real UUID returned by a prior tool call.'),
    title: z.string().min(1).optional().describe('New exercise title. Omit to keep unchanged.'),
    description: z
      .string()
      .optional()
      .describe('New short description shown to students. Pass an empty string to clear it.'),
    lessonId: z.string().optional().describe('Link the exercise to a lesson in this course.'),
    sectionId: z.string().optional().describe('Move the exercise to a section in this course.'),
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
    exerciseId: z
      .string()
      .describe('The exercise that contains this section. Must match the exercise you read with get_exercise_details.'),
    exerciseSectionId: z
      .string()
      .describe('The exercise section id from get_exercise_details `sections[].id` — not a course section id.'),
    title: z.string().min(1).optional().describe('New section heading shown above questions in this block.'),
    description: z.string().optional().describe('Optional intro HTML for this block. Pass an empty string to clear it.')
  })
  .refine((data) => data.title !== undefined || data.description !== undefined, {
    message: 'Provide at least title or description to update'
  });

export const createExerciseSectionParam = z.object({
  exerciseId: z.string().describe('The exercise that will contain this section.'),
  title: z.string().min(1).describe('Section heading shown above the questions in this block.'),
  description: z
    .string()
    .optional()
    .describe('Optional intro HTML for this block. Pass an empty string to leave it blank.'),
  order: z.number().int().min(0).describe('Display order within the exercise (0-based).'),
  colorTheme: z.enum(['blue', 'green', 'amber', 'rose', 'violet', 'slate']).optional(),
  afterBehavior: ZExerciseSectionAfterBehavior.optional()
});

export const addQuestionsParam = z.object({
  exerciseId: z.string(),
  exerciseSectionId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'In-exercise section id from get_exercise_details `sections[].id` where the new questions should appear (not a course outline section id).'
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
      .uuid()
      .nullable()
      .optional()
      .describe(
        'Move the question to this in-exercise block (get_exercise_details sections[].id). Use null to clear section assignment.'
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
  exerciseId: z.string(),
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
        id: z.string().min(1),
        order: z.number().int().min(0)
      })
    )
    .optional()
    .describe('Reorder sections by setting new order values'),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.enum(['LESSON', 'EXERCISE']),
        order: z.number().int().min(0).optional().describe('New order within the section'),
        sectionId: z.string().nullable().optional().describe('Move item to a different section')
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
    .describe('The lesson this illustrates, when there is one. Used to group the stored file.'),
  locale: z.string().default('en').describe('Locale of the lesson, from the Current Context.'),
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

import { AppError } from '@api/utils/errors';
import { getDocumentText, getDocumentSummary } from '@api/services/agent/document';
import { redis } from '@api/utils/redis/redis';
import { getCourseSectionBinding, getExerciseCourseBinding, getLessonCourseBinding } from '@cio/db/queries/agent';
import { z } from 'zod';
import { CoursePlanFieldsSchema, type CourseTemplateId } from '@cio/ai-assistant';

type ResourceOwnershipRow = {
  courseId: string | null;
  title?: string | null;
};

function buildResourceOwnershipError(params: {
  resourceType: 'Lesson' | 'Exercise' | 'Section';
  resourceId: string;
  courseId: string;
  resource?: ResourceOwnershipRow;
}) {
  const { resourceType, resourceId, resource } = params;

  if (!resource) {
    return new AppError(
      `${resourceType} ${resourceId} does not exist in this course. The ID may have been hallucinated — call get_course_structure to fetch real IDs and retry.`,
      'RESOURCE_NOT_IN_COURSE',
      403
    );
  }

  const titleSuffix = resource.title ? ` (${resource.title})` : '';

  return new AppError(
    `${resourceType} ${resourceId}${titleSuffix} belongs to a different course. Call get_course_structure to fetch IDs for the current course and retry.`,
    'RESOURCE_NOT_IN_COURSE',
    403
  );
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidUuid(
  resourceType: 'Lesson' | 'Exercise' | 'Section' | 'ExerciseSection',
  value: string
): void {
  if (!UUID_REGEX.test(value)) {
    throw new AppError(
      `${resourceType} id "${value}" is not a valid UUID. Call get_course_structure to fetch real IDs and try again — never invent or guess UUIDs.`,
      'INVALID_RESOURCE_ID',
      400
    );
  }
}

export async function verifyLessonBelongsToCourse(lessonId: string, courseId: string): Promise<void> {
  assertValidUuid('Lesson', lessonId);

  const lesson = await getLessonCourseBinding(lessonId);

  if (!lesson || lesson.courseId !== courseId) {
    throw buildResourceOwnershipError({
      resourceType: 'Lesson',
      resourceId: lessonId,
      courseId,
      resource: lesson
    });
  }
}

export async function verifyExerciseBelongsToCourse(exerciseId: string, courseId: string): Promise<void> {
  assertValidUuid('Exercise', exerciseId);

  const exercise = await getExerciseCourseBinding(exerciseId);

  if (!exercise || exercise.courseId !== courseId) {
    throw buildResourceOwnershipError({
      resourceType: 'Exercise',
      resourceId: exerciseId,
      courseId,
      resource: exercise
    });
  }
}

export async function verifySectionBelongsToCourse(sectionId: string, courseId: string): Promise<void> {
  assertValidUuid('Section', sectionId);

  const section = await getCourseSectionBinding(sectionId);

  if (!section || section.courseId !== courseId) {
    throw buildResourceOwnershipError({
      resourceType: 'Section',
      resourceId: sectionId,
      courseId,
      resource: section
    });
  }
}

type AttachedMessage = { metadata?: { attachment?: { documentId?: string } } };

export function collectDocumentIds(messages: unknown[], currentDocumentId?: string): string[] {
  const ids = new Set<string>();

  for (const msg of messages as AttachedMessage[]) {
    const id = msg?.metadata?.attachment?.documentId;

    if (id) ids.add(id);
  }

  if (currentDocumentId) ids.add(currentDocumentId);

  return Array.from(ids);
}

/**
 * Build the document context block. The document attached to the CURRENT user
 * message (`currentDocumentId`) is injected as full text; documents seen only in
 * prior history are injected as short cached summaries instead — this avoids
 * re-sending ~75K tokens of full document text on every follow-up turn.
 */
export async function loadDocumentsContext(
  documentIds: string[],
  currentDocumentId: string | undefined,
  userId: string
): Promise<string | undefined> {
  const loaded = await Promise.all(
    documentIds.map(async (id) => {
      if (id === currentDocumentId) {
        const text = await getDocumentText(id, userId, redis);

        return text ? { id, kind: 'full' as const, body: text } : null;
      }

      const summary = await getDocumentSummary(id, userId, redis);

      return summary ? { id, kind: 'summary' as const, body: summary } : null;
    })
  );

  const sections = loaded
    .filter((d): d is { id: string; kind: 'full' | 'summary'; body: string } => d !== null)
    .map((d, i) =>
      d.kind === 'full'
        ? `--- Document ${i + 1} (id: ${d.id}, full text) ---\n${d.body}`
        : `--- Document ${i + 1} (id: ${d.id}, summary of a previously shared document) ---\n${d.body}`
    );

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

type PlanMetadataMessage = {
  role?: string;
  metadata?: {
    plan?: {
      action?: string;
      payload?: unknown;
    };
  };
};

export function getLatestImplementationPlan(messages: unknown[]): z.infer<typeof CoursePlanFieldsSchema> | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as PlanMetadataMessage;

    if (message?.role !== 'user') {
      continue;
    }

    if (message?.metadata?.plan?.action !== 'implement_course_plan') {
      continue;
    }

    const parsedPlan = CoursePlanFieldsSchema.safeParse(message.metadata.plan.payload);

    if (parsedPlan.success) {
      return parsedPlan.data;
    }
  }

  return undefined;
}

/**
 * Real course item as returned by getCourseContentItems — only the fields this
 * module needs. Kept structural (not imported) so the DB row type can evolve
 * without coupling the anchor to it.
 */
type CourseItemState = {
  type: string;
  title: string | null;
  sectionId: string | null;
  hasNoteContent?: boolean | null;
  questionCount?: number | null;
};

type CourseSectionState = { id: string; title: string | null };

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compares the approved plan (the Syllabus — the source of truth for WHAT to build)
 * against the course's REAL current state (from get_course_structure) and returns a
 * compact progress anchor injected into every implementation turn.
 *
 * This is the fix for "the agent said it finished but hadn't / skipped sub-topics":
 * the model no longer depends on the (trimmed) chat history to remember what it did.
 * It always sees, per plan item, whether it is ✅ done, ⚠️ present-but-empty, or ⬜ missing,
 * plus an explicit "you are NOT done until every ⬜/⚠️ is resolved" instruction.
 *
 * Matching is by normalized title (the same heuristic the prompt already uses).
 * Returns undefined when there is no plan (nothing to anchor against).
 *
 * `pendingCount`/`emptyCount` are also surfaced so the API can tell the UI the plan
 * is not actually finished (⬜ missing + ⚠️ empty) even when the model wrongly claimed
 * completion — that's what powers the "Continue" button after a false "done".
 */
export interface PlanProgress {
  anchorText: string;
  pendingCount: number;
  emptyCount: number;
}

export function buildPlanProgressAnchor(
  plan: z.infer<typeof CoursePlanFieldsSchema> | undefined,
  sections: CourseSectionState[],
  items: CourseItemState[]
): PlanProgress | undefined {
  if (!plan || plan.sections.length === 0) return undefined;

  const sectionIdByTitle = new Map<string, string>();
  for (const s of sections) {
    sectionIdByTitle.set(normalizeTitle(s.title), s.id);
  }

  // Index real items by sectionId + normalized title for O(1) lookup.
  const itemsBySectionAndTitle = new Map<string, CourseItemState>();
  for (const it of items) {
    if (it.type === 'section') continue;
    itemsBySectionAndTitle.set(`${it.sectionId ?? ''}::${normalizeTitle(it.title)}`, it);
  }

  const lines: string[] = [];
  let pendingCount = 0;
  let emptyCount = 0;

  for (const planSection of plan.sections) {
    const realSectionId = sectionIdByTitle.get(normalizeTitle(planSection.title));
    if (!realSectionId) {
      lines.push(`Section "${planSection.title}" ⬜ NOT CREATED — create it and everything below.`);
      for (const item of planSection.items) {
        pendingCount += 1;
        lines.push(`  - ${item.type} "${item.title}" ⬜ missing`);
      }
      continue;
    }

    const itemStatuses: string[] = [];
    let sectionComplete = true;

    for (const item of planSection.items) {
      const real = itemsBySectionAndTitle.get(`${realSectionId}::${normalizeTitle(item.title)}`);
      if (!real) {
        pendingCount += 1;
        sectionComplete = false;
        itemStatuses.push(`  - ${item.type} "${item.title}" ⬜ missing — create it`);
        continue;
      }
      // Lesson present but no written content, or exercise with no questions → not done.
      if (real.type === 'lesson' && real.hasNoteContent === false) {
        emptyCount += 1;
        sectionComplete = false;
        itemStatuses.push(`  - lesson "${item.title}" ⚠️ EXISTS BUT EMPTY — write its content`);
      } else if (real.type === 'exercise' && (real.questionCount ?? 0) === 0) {
        emptyCount += 1;
        sectionComplete = false;
        itemStatuses.push(`  - exercise "${item.title}" ⚠️ EXISTS BUT HAS NO QUESTIONS — add questions`);
      } else {
        itemStatuses.push(`  - ${item.type} "${item.title}" ✅`);
      }
    }

    lines.push(`Section "${planSection.title}" ${sectionComplete ? '✅ complete' : '⬜ incomplete'}`);
    lines.push(...itemStatuses);
  }

  if (pendingCount === 0 && emptyCount === 0) {
    return {
      pendingCount,
      emptyCount,
      anchorText: `## Plan Progress (source of truth)

Every item in the approved plan is present and has content. The course matches the plan. If the teacher hasn't asked for anything new, you are done — do NOT recreate existing items.`
    };
  }

  return {
    pendingCount,
    emptyCount,
    anchorText: `## Plan Progress — YOU ARE NOT DONE (source of truth)

This is the REAL state of the course right now (from the live structure), compared against the approved plan. Trust THIS, not your memory of what you did — the chat history may be trimmed.

${lines.join('\n')}

${pendingCount} item(s) still missing and ${emptyCount} item(s) exist but are empty. You are NOT finished until every ⬜ and ⚠️ above is resolved. Continue implementing now — create the missing items and fill the empty ones, in plan order, without pausing to ask the teacher. Never claim the course is complete while any ⬜ or ⚠️ remains.`
  };
}

/**
 * Render the persisted course-build TODO list (Task Manager) as a context block so
 * the model always sees its own task list — even after history trimming. This is the
 * model's self-declared plan of record; the Plan Progress anchor above is the
 * server's independent verification against the live course (double safety net).
 */
export function buildTodoListAnchor(
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority: string }>
): string | undefined {
  if (!todos || todos.length === 0) return undefined;

  const icon = (s: string) => (s === 'completed' ? '✅' : s === 'in_progress' ? '🔄' : '⬜');
  const lines = todos.map((t) => `- ${icon(t.status)} ${t.content}`);
  const remaining = todos.filter((t) => t.status !== 'completed').length;

  if (remaining === 0) {
    return `## Your Task List (Task Manager)

Every task you registered is completed:
${lines.join('\n')}

If the teacher hasn't asked for anything new, your task list is done.`;
  }

  return `## Your Task List (Task Manager) — ${remaining} task(s) remaining

This is YOUR task list, saved outside the chat so you never lose it:
${lines.join('\n')}

Keep working through it: exactly one task 🔄 in_progress at a time, mark it ✅ completed the moment it's actually built, then start the next ⬜. Call update_course_todo_list to update this list. You are NOT finished while any ⬜ or 🔄 remains.`;
}

const COURSE_TEMPLATE_ID_SET = new Set<CourseTemplateId>(['product_101', 'product_onboarding', 'expert_on_x']);

export function getActiveCourseTemplateId(messages: unknown[]): CourseTemplateId | undefined {
  for (const message of messages) {
    const candidate = message as {
      role?: string;
      metadata?: { template?: { id?: string; templateId?: string } };
    };

    if (candidate.role !== 'user') {
      continue;
    }

    // Activation marker `{ id }` (template picked, form pending) OR a wizard
    // submission `{ action: 'submit_template_answers', templateId, ... }`.
    const id = candidate.metadata?.template?.id ?? candidate.metadata?.template?.templateId;

    if (id && COURSE_TEMPLATE_ID_SET.has(id as CourseTemplateId)) {
      return id as CourseTemplateId;
    }
  }

  return undefined;
}

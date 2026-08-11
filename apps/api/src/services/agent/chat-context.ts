import { AppError } from '@api/utils/errors';
import { getDocumentText, getDocumentSummary } from '@api/services/agent/document';
import { redis } from '@api/utils/redis/redis';
import {
  getCourseSectionBinding,
  getExerciseCourseBinding,
  getLessonCourseBinding,
  type PlanRegistryEntry
} from '@cio/db/queries/agent';
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

type AttachedMessage = {
  metadata?: { attachment?: { documentId?: string; documentIds?: unknown } };
};

export function collectDocumentIds(messages: unknown[], currentDocumentId?: string): string[] {
  const ids = new Set<string>();

  for (const msg of messages as AttachedMessage[]) {
    const attachment = msg?.metadata?.attachment;

    if (attachment?.documentId) ids.add(attachment.documentId);

    // A message can carry more than one document — the course wizard takes up
    // to 10 files but only one of them can be *the* attachment. Reading just
    // `documentId` meant the extra uploads were never loaded into context and
    // never persisted as sources.
    if (Array.isArray(attachment?.documentIds)) {
      for (const id of attachment.documentIds) {
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
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
  userId: string,
  /**
   * When set, the full text of this document id is OMITTED from the inline
   * context — used when the document has been placed in a Gemini explicit cache
   * and is referenced via providerOptions instead of being re-sent every turn.
   */
  excludeFullTextForId?: string
): Promise<string | undefined> {
  const loaded = await Promise.all(
    documentIds.map(async (id) => {
      if (id === excludeFullTextForId) {
        // Cached separately (Gemini cachedContent) — do not inline its text.
        return null;
      }

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
  /** Present on rows from getCourseContentItems; the plan registry resolves by it. */
  id?: string;
  type: string;
  title: string | null;
  sectionId: string | null;
  hasNoteContent?: boolean | null;
  questionCount?: number | null;
};

/**
 * `order` is read explicitly rather than trusting array position:
 * `getCourseSectionsByCourseId` has no ORDER BY, so the rows arrive in whatever
 * order Postgres happens to return.
 */
type CourseSectionState = { id: string; title: string | null; order?: number | null };

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
 * Matching is by plan-registry binding: each plan item records the id of the row
 * built from it, so reconciliation asks "does row <uuid> still exist?". Title
 * matching survives only as a fallback for plans that predate the registry.
 *
 * That distinction is the whole point. While this compared titles, a lesson the
 * model had renamed while writing it ("1.1 Introducción" for a plan item called
 * "Introducción") read as ⬜ missing, and the anchor — in the strongest wording of
 * the prompt — ordered it built again. The duplicates teachers reported were the
 * server instructing the model to duplicate, not the model losing its place.
 *
 * Returns undefined when there is no plan (nothing to anchor against).
 *
 * `pendingCount`/`emptyCount` are also surfaced so the API can tell the UI the plan
 * is not actually finished (⬜ missing + ⚠️ empty) even when the model wrongly claimed
 * completion — that's what powers the "Continue" button after a false "done".
 * `items`/`total`/`completed` are the same reconciliation as structured data, so the
 * UI checklist can render server truth instead of the model's self-report.
 */
export type PlanProgressStatus = 'done' | 'empty' | 'missing';

export interface PlanProgressItem {
  /** Registry key (`s1`, `s1.2`); empty for legacy plans with no registry. */
  key: string;
  kind: 'section' | 'lesson' | 'exercise';
  title: string;
  status: PlanProgressStatus;
}

export interface PlanProgress {
  anchorText: string;
  pendingCount: number;
  emptyCount: number;
  /**
   * Sections that exist but sit in a different position than the plan puts them.
   *
   * Existence and content were the only things checked before, so nothing in the
   * system could contradict the model when it announced a reordering it never
   * performed — it reported the order it intended while the course kept the old
   * one. Deliberately NOT wired into the auto-continue condition: a wrong order
   * the model cannot fix would spin rounds forever. It belongs in the anchor,
   * where it stops the model from claiming a reorder happened.
   */
  misorderedCount: number;
  items: PlanProgressItem[];
  total: number;
  completed: number;
}

/**
 * Whether this round's progress is worth drawing as a checklist.
 *
 * The anchor is measured on EVERY round for as long as an approved plan exists,
 * which is right for the prompt and wrong for the UI: once a course was built,
 * all of its rows reappeared under every later answer, including plain edit
 * chat where they report nothing new. A checklist earns its place when there is
 * still something outstanding, or when this round moved the count — the latter
 * covering the round that reaches 100%, so completion still announces itself.
 *
 * `completedBefore` is undefined when the round started with no measurement to
 * compare against; that counts as news rather than silence.
 */
export function isChecklistWorthShowing(progress: PlanProgress, completedBefore: number | undefined): boolean {
  if (progress.pendingCount > 0 || progress.emptyCount > 0) return true;

  return completedBefore === undefined || progress.completed !== completedBefore;
}

export function buildPlanProgressAnchor(
  plan: z.infer<typeof CoursePlanFieldsSchema> | undefined,
  sections: CourseSectionState[],
  items: CourseItemState[],
  registry: PlanRegistryEntry[] = []
): PlanProgress | undefined {
  if (!plan || plan.sections.length === 0) return undefined;

  const sectionById = new Map(sections.map((s) => [s.id, s] as const));
  const itemById = new Map(
    items.filter((it) => it.type !== 'section' && it.id).map((it) => [it.id as string, it] as const)
  );

  const sectionIdByTitle = new Map<string, string>();
  for (const s of sections) {
    sectionIdByTitle.set(normalizeTitle(s.title), s.id);
  }

  // Index real items by sectionId + normalized title — the fallback path, used
  // only when a plan item has no registry binding yet.
  const itemsBySectionAndTitle = new Map<string, CourseItemState>();
  for (const it of items) {
    if (it.type === 'section') continue;
    itemsBySectionAndTitle.set(`${it.sectionId ?? ''}::${normalizeTitle(it.title)}`, it);
  }

  // Registry lookups mirror how syncPlanRegistry assigned the keys: sections by
  // plan title, items by owning-section key + plan title.
  const registrySectionByTitle = new Map<string, PlanRegistryEntry>();
  const registryItemByPath = new Map<string, PlanRegistryEntry>();
  for (const entry of registry) {
    if (entry.kind === 'section') {
      registrySectionByTitle.set(normalizeTitle(entry.title), entry);
    } else {
      registryItemByPath.set(`${entry.sectionKey ?? ''}::${normalizeTitle(entry.title)}`, entry);
    }
  }

  const lines: string[] = [];
  const progressItems: PlanProgressItem[] = [];
  let pendingCount = 0;
  let emptyCount = 0;
  /** Plan position → live section, for the order check after the loop. */
  const placedSections: Array<{ planIndex: number; title: string; liveOrder: number }> = [];

  /** `[s1.2] ` prefix so the model can echo the key back in its create_* call. */
  const tag = (key: string) => (key ? `[${key}] ` : '');

  for (const [planIndex, planSection] of plan.sections.entries()) {
    const regSection = registrySectionByTitle.get(normalizeTitle(planSection.title));
    const sectionKey = regSection?.key ?? '';

    // Bound id first; title only as a fallback for pre-registry plans.
    const boundSectionId =
      regSection?.entityId && sectionById.has(regSection.entityId) ? regSection.entityId : undefined;
    const realSectionId = boundSectionId ?? sectionIdByTitle.get(normalizeTitle(planSection.title));

    if (!realSectionId) {
      lines.push(`${tag(sectionKey)}Section "${planSection.title}" ⬜ NOT CREATED — create it and everything below.`);
      progressItems.push({ key: sectionKey, kind: 'section', title: planSection.title, status: 'missing' });
      for (const item of planSection.items) {
        pendingCount += 1;
        const itemKey = registryItemByPath.get(`${sectionKey}::${normalizeTitle(item.title)}`)?.key ?? '';
        lines.push(`  - ${tag(itemKey)}${item.type} "${item.title}" ⬜ missing`);
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'missing' });
      }
      continue;
    }

    const liveSection = sectionById.get(realSectionId);
    if (typeof liveSection?.order === 'number') {
      placedSections.push({ planIndex, title: planSection.title, liveOrder: liveSection.order });
    }

    const itemStatuses: string[] = [];
    let sectionComplete = true;

    for (const item of planSection.items) {
      const regItem = registryItemByPath.get(`${sectionKey}::${normalizeTitle(item.title)}`);
      const itemKey = regItem?.key ?? '';
      const boundItem = regItem?.entityId ? itemById.get(regItem.entityId) : undefined;
      const real = boundItem ?? itemsBySectionAndTitle.get(`${realSectionId}::${normalizeTitle(item.title)}`);

      if (!real) {
        pendingCount += 1;
        sectionComplete = false;
        itemStatuses.push(`  - ${tag(itemKey)}${item.type} "${item.title}" ⬜ missing — create it`);
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'missing' });
        continue;
      }
      // Lesson present but no written content, or exercise with no questions → not done.
      if (real.type === 'lesson' && real.hasNoteContent === false) {
        emptyCount += 1;
        sectionComplete = false;
        itemStatuses.push(
          `  - ${tag(itemKey)}lesson "${real.title ?? item.title}" ⚠️ EXISTS (id ${real.id ?? '?'}) BUT EMPTY — write its content, do NOT create it again`
        );
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'empty' });
      } else if (real.type === 'exercise' && (real.questionCount ?? 0) === 0) {
        emptyCount += 1;
        sectionComplete = false;
        itemStatuses.push(
          `  - ${tag(itemKey)}exercise "${real.title ?? item.title}" ⚠️ EXISTS (id ${real.id ?? '?'}) BUT HAS NO QUESTIONS — add questions, do NOT create it again`
        );
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'empty' });
      } else {
        itemStatuses.push(`  - ${tag(itemKey)}${item.type} "${real.title ?? item.title}" ✅`);
        progressItems.push({ key: itemKey, kind: item.type, title: item.title, status: 'done' });
      }
    }

    lines.push(`${tag(sectionKey)}Section "${planSection.title}" ${sectionComplete ? '✅ complete' : '⬜ incomplete'}`);
    lines.push(...itemStatuses);
    progressItems.push({
      key: sectionKey,
      kind: 'section',
      title: planSection.title,
      status: sectionComplete ? 'done' : 'empty'
    });
  }

  const total = progressItems.length;
  const completed = progressItems.filter((entry) => entry.status === 'done').length;

  // Order check: walk the sections as the COURSE has them and see whether their
  // plan positions come out ascending. Comparing live `order` values to plan
  // indexes directly would false-positive on any gap in the numbering (deleted
  // sections leave holes), and only the relative sequence actually matters.
  const liveSequence = [...placedSections].sort((a, b) => a.liveOrder - b.liveOrder);
  const orderLines: string[] = [];
  for (let i = 1; i < liveSequence.length; i += 1) {
    if (liveSequence[i].planIndex < liveSequence[i - 1].planIndex) {
      orderLines.push(
        `  - "${liveSequence[i].title}" sits after "${liveSequence[i - 1].title}" in the course, but the plan puts it before.`
      );
    }
  }
  const misorderedCount = orderLines.length;

  if (pendingCount === 0 && emptyCount === 0 && misorderedCount === 0) {
    return {
      pendingCount,
      emptyCount,
      misorderedCount,
      items: progressItems,
      total,
      completed,
      anchorText: `## Plan Progress (source of truth)

Every item in the approved plan is present, has content, and sits in plan order. The course matches the plan. If the teacher hasn't asked for anything new, you are done — do NOT recreate existing items.`
    };
  }

  const orderSection =
    misorderedCount > 0
      ? `\n\n### Section order does NOT match the plan\n${orderLines.join('\n')}\n\nThis is the course's REAL order, read from the database just now. Do not describe the order you intend — call \`reorder_content\` and fix it. Never report a reordering you have not performed.`
      : '';

  return {
    pendingCount,
    emptyCount,
    misorderedCount,
    items: progressItems,
    total,
    completed,
    anchorText: `## Plan Progress — YOU ARE NOT DONE (source of truth)

This is the REAL state of the course right now (from the live structure), compared against the approved plan. Trust THIS, not your memory of what you did — the chat history may be trimmed.

${lines.join('\n')}${orderSection}

${pendingCount} item(s) still missing and ${emptyCount} item(s) exist but are empty. You are NOT finished until every ⬜ and ⚠️ above is resolved. Continue implementing now — create the missing items and fill the empty ones, in plan order, without pausing to ask the teacher. Never claim the course is complete while any ⬜ or ⚠️ remains.

When you create an item, pass the \`[key]\` shown beside it as \`planKey\` (e.g. planKey: "s1.2"). Items marked ⚠️ already exist — fill them in by id, never create them again.`
  };
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

/**
 * Which slice of the teacher prompt — and which tools — this turn gets.
 *
 * - `build`: a plan was approved in this conversation. Implementation rules.
 * - `plan`:  nothing exists to edit yet. Planning rules, and READ-ONLY tools,
 *            which is what enforces "propose before you build".
 * - `full`:  there is already something to edit. Everything, including the
 *            content-writing rules and tools.
 *
 * `existingSectionCount` is the part that is easy to get wrong. The phase used
 * to be derived from the transcript alone, so a NEW conversation about an
 * already-built course found no approved plan and fell into `plan` — read-only.
 * The agent then told the teacher, correctly for the tools it had been given,
 * that it could not write lesson content, on a course full of lessons. A course
 * with sections is being maintained, not planned from a blank page.
 */
export function resolveTeacherPromptMode(params: {
  isTeacher: boolean;
  hasApprovedPlan: boolean;
  lessonId?: string;
  existingSectionCount: number;
}): 'plan' | 'build' | 'full' {
  const { isTeacher, hasApprovedPlan, lessonId, existingSectionCount } = params;

  // Students always get the unrestricted tutor prompt; phases are a teacher concept.
  if (!isTeacher) return 'full';
  if (hasApprovedPlan) return 'build';
  if (lessonId || existingSectionCount > 0) return 'full';

  return 'plan';
}

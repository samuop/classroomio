import { and, asc, eq } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import { CHAT_RUN_PHASE, ensureChatRun } from './chat-run';

/**
 * Plan registry — the durable binding between an approved plan item and the real
 * course row that was built from it.
 *
 * Why this exists: progress used to be reconciled by comparing plan titles to
 * course titles. The model routinely improves a title while building ("1.1
 * Introducción" for a plan item called "Introducción"), so a lesson that existed
 * was reported missing, and the anchor then ordered the model — in the strongest
 * wording of the whole prompt — to create it again. That is where duplicate
 * sections and lessons came from: not the model losing track, but the server
 * telling it to duplicate.
 *
 * A registry entry pins each plan item to a `stepKey` that survives re-planning,
 * and records the `entityId` actually created for it. Reconciliation then asks
 * "does row <uuid> still exist?" instead of "does some row have this title?".
 *
 * Storage reuses the chat-scoped run from {@link ./chat-run.ts} — one run per
 * conversation, one step per plan item — so this needs no schema change.
 */

/** What a plan item becomes in the course. */
export type PlanItemKind = 'section' | 'lesson' | 'exercise';

/** stepType for registry rows, keeping them distinct from `course_todo` steps. */
const PLAN_ITEM_STEP_TYPE = 'plan_item';

export interface PlanRegistryEntry {
  /** Stable short key the model echoes back in create_* calls (e.g. `s1`, `s1.2`). */
  key: string;
  kind: PlanItemKind;
  title: string;
  /** For lesson/exercise entries, the key of the owning section. */
  sectionKey: string | null;
  /** Position within the flattened plan, for stable display order. */
  position: number;
  /** The course row built from this plan item, once it exists. */
  entityId: string | null;
}

/**
 * Structural shape of an approved plan. Declared here rather than imported from
 * `@cio/ai-assistant` so the db package stays free of that dependency.
 */
export interface PlanShape {
  sections: Array<{
    title: string;
    items: Array<{ type: 'lesson' | 'exercise'; title: string }>;
  }>;
}

// Type aliases, not interfaces: the `input`/`output` jsonb columns are typed
// `Record<string, unknown>`, and only a type alias is structurally assignable to
// an index-signature type.
type RegistryStepInput = {
  kind: PlanItemKind;
  title: string;
  sectionKey: string | null;
  position: number;
};

type RegistryStepOutput = {
  entityId?: string;
};

type RunScope = {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
};

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Read every registry row for the conversation, INCLUDING canceled ones. A key
 * that was dropped from the plan and later restored must come back with its
 * binding intact — otherwise removing and re-adding a section in the plan would
 * orphan the lessons already built under it.
 */
async function readAllEntries(runId: string) {
  const steps = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(and(eq(schema.aiAgentRunStep.runId, runId), eq(schema.aiAgentRunStep.stepType, PLAN_ITEM_STEP_TYPE)))
    .orderBy(asc(schema.aiAgentRunStep.createdAt));

  return steps.map((step) => {
    const input = (step.input ?? {}) as Partial<RegistryStepInput>;
    const output = (step.output ?? {}) as RegistryStepOutput;

    return {
      key: step.stepKey,
      status: step.status,
      kind: (input.kind ?? 'lesson') as PlanItemKind,
      title: input.title ?? '',
      sectionKey: input.sectionKey ?? null,
      position: input.position ?? 0,
      entityId: output.entityId ?? null
    };
  });
}

/**
 * Reconcile an approved plan into the registry.
 *
 * Keys are matched by normalized title — sections within the plan, items within
 * their section — so an existing key (and its binding) is preserved whenever the
 * plan is regenerated or edited. Items the new plan no longer contains are marked
 * canceled rather than deleted, so their bindings survive a later restore.
 *
 * This is what makes the plan mutable: the teacher can ask for an extra section
 * mid-build, the plan is regenerated, and everything already built keeps its
 * identity instead of looking "missing" and being rebuilt.
 */
export async function syncPlanRegistry(
  params: RunScope & { plan: PlanShape }
): Promise<PlanRegistryEntry[]> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  const existing = await readAllEntries(run.id);
  const usedKeys = new Set(existing.map((e) => e.key));
  const bindingByKey = new Map(existing.map((e) => [e.key, e.entityId] as const));

  // Existing keys indexed the way we look them up: sections by title, items by
  // (owning section key + title).
  const sectionKeyByTitle = new Map<string, string>();
  const itemKeyBySectionAndTitle = new Map<string, string>();

  for (const entry of existing) {
    if (entry.kind === 'section') {
      sectionKeyByTitle.set(normalizeTitle(entry.title), entry.key);
    } else {
      itemKeyBySectionAndTitle.set(`${entry.sectionKey ?? ''}::${normalizeTitle(entry.title)}`, entry.key);
    }
  }

  function allocateSectionKey(): string {
    for (let n = 1; ; n++) {
      const candidate = `s${n}`;
      if (!usedKeys.has(candidate)) {
        usedKeys.add(candidate);
        return candidate;
      }
    }
  }

  function allocateItemKey(sectionKey: string): string {
    for (let n = 1; ; n++) {
      const candidate = `${sectionKey}.${n}`;
      if (!usedKeys.has(candidate)) {
        usedKeys.add(candidate);
        return candidate;
      }
    }
  }

  const desired: PlanRegistryEntry[] = [];
  let position = 0;

  for (const planSection of params.plan.sections) {
    const sectionKey = sectionKeyByTitle.get(normalizeTitle(planSection.title)) ?? allocateSectionKey();

    desired.push({
      key: sectionKey,
      kind: 'section',
      title: planSection.title,
      sectionKey: null,
      position: position++,
      entityId: bindingByKey.get(sectionKey) ?? null
    });

    for (const item of planSection.items) {
      const lookup = `${sectionKey}::${normalizeTitle(item.title)}`;
      const itemKey = itemKeyBySectionAndTitle.get(lookup) ?? allocateItemKey(sectionKey);

      desired.push({
        key: itemKey,
        kind: item.type,
        title: item.title,
        sectionKey,
        position: position++,
        entityId: bindingByKey.get(itemKey) ?? null
      });
    }
  }

  for (const entry of desired) {
    const input: RegistryStepInput = {
      kind: entry.kind,
      title: entry.title,
      sectionKey: entry.sectionKey,
      position: entry.position
    };
    // A bound item is 'completed', an unbound one 'queued'. `output` is left out
    // of the update set on purpose: re-syncing a plan must never drop a binding.
    const status = entry.entityId ? 'completed' : 'queued';

    await db
      .insert(schema.aiAgentRunStep)
      .values({
        runId: run.id,
        stepKey: entry.key,
        stepType: PLAN_ITEM_STEP_TYPE,
        status,
        input
      })
      .onConflictDoUpdate({
        target: [schema.aiAgentRunStep.runId, schema.aiAgentRunStep.stepKey],
        set: { status, input, updatedAt: now }
      });
  }

  const desiredKeys = new Set(desired.map((e) => e.key));

  for (const entry of existing) {
    if (!desiredKeys.has(entry.key) && entry.status !== 'canceled') {
      await db
        .update(schema.aiAgentRunStep)
        .set({ status: 'canceled', updatedAt: now })
        .where(and(eq(schema.aiAgentRunStep.runId, run.id), eq(schema.aiAgentRunStep.stepKey, entry.key)));
    }
  }

  return desired;
}

/** Read the active (non-canceled) registry, in plan order. */
export async function readPlanRegistry(params: RunScope & { runId?: string }): Promise<PlanRegistryEntry[]> {
  let runId = params.runId;

  if (!runId) {
    // Read-only path: never create a run just to read an empty registry.
    const whereConversation = params.conversationId
      ? and(
          eq(schema.aiAgentRun.conversationId, params.conversationId),
          eq(schema.aiAgentRun.userId, params.userId),
          eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
        )
      : and(
          eq(schema.aiAgentRun.courseId, params.courseId),
          eq(schema.aiAgentRun.userId, params.userId),
          eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
        );

    const [run] = await db
      .select({ id: schema.aiAgentRun.id })
      .from(schema.aiAgentRun)
      .where(whereConversation)
      .orderBy(asc(schema.aiAgentRun.createdAt))
      .limit(1);

    if (!run) return [];
    runId = run.id;
  }

  const entries = await readAllEntries(runId);

  return entries
    .filter((entry) => entry.status !== 'canceled')
    .map(({ key, kind, title, sectionKey, position, entityId }) => ({
      key,
      kind,
      title,
      sectionKey,
      position,
      entityId
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * Record which course row a plan item was built into. Called by the create_*
 * tools right after a successful insert; from then on the item is identified by
 * id, and renaming it can no longer make it look missing.
 */
export async function bindPlanItem(
  params: RunScope & { planKey: string; entityId: string }
): Promise<void> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  await db
    .update(schema.aiAgentRunStep)
    .set({
      status: 'completed',
      output: { entityId: params.entityId },
      finishedAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(schema.aiAgentRunStep.runId, run.id),
        eq(schema.aiAgentRunStep.stepKey, params.planKey),
        eq(schema.aiAgentRunStep.stepType, PLAN_ITEM_STEP_TYPE)
      )
    );
}

/**
 * Look up the row already built for a plan key, if any. The create_* tools use
 * this to stay idempotent: a second create for the same key returns what exists
 * instead of inserting a duplicate.
 */
export async function resolvePlanBinding(
  params: RunScope & { planKey: string }
): Promise<{ key: string; kind: PlanItemKind; title: string; entityId: string } | null> {
  const entries = await readPlanRegistry(params);
  const entry = entries.find((e) => e.key === params.planKey);

  if (!entry?.entityId) return null;

  return { key: entry.key, kind: entry.kind, title: entry.title, entityId: entry.entityId };
}

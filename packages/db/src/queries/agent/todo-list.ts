import { and, asc, eq } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import type { TAiAgentRun, TAiAgentRunStep } from '@db/types';

/**
 * Course-build TODO list, persisted OUTSIDE the chat transcript.
 *
 * The live chat (POST /agent/chat) does not run the durable-run worker; it drives
 * the model directly via streamText. But the model still needs a persistent task
 * list it cannot forget when the history is trimmed (MAX_MESSAGES) or when it
 * falsely believes it finished. We reuse the already-built `ai_agent_run` /
 * `ai_agent_run_step` tables for that: one lightweight run per conversation acts
 * as the container ("chat" phase), and each todo item is a run step keyed by a
 * stable slug so the model can update it in place (upsert on runId+stepKey).
 *
 * This is deliberately a thin, self-contained layer over run-state.ts — no schema
 * change, no worker, no locking. It is additive and safe: if anything here throws,
 * the caller swallows it and the chat proceeds without the list.
 */

/** Status values the model may set on a todo item, mapped onto the run-step status enum. */
export type CourseTodoStatus = 'pending' | 'in_progress' | 'completed';

/** Priority is advisory only (ordering hint); stored inside the step input JSON. */
export type CourseTodoPriority = 'low' | 'medium' | 'high';

export interface CourseTodoItem {
  /** Stable slug identifying the task across updates (upsert key). */
  key: string;
  content: string;
  status: CourseTodoStatus;
  priority: CourseTodoPriority;
}

/** The phase we tag chat-driven runs with, to distinguish from durable worker runs. */
const CHAT_RUN_PHASE = 'chat';
/** stepType for todo-list steps, so a future UI/query can filter them. */
const TODO_STEP_TYPE = 'course_todo';

const RUN_STATUS_BY_TODO: Record<CourseTodoStatus, TAiAgentRunStep['status']> = {
  pending: 'queued',
  in_progress: 'running',
  completed: 'completed'
};

const TODO_STATUS_BY_RUN: Partial<Record<TAiAgentRunStep['status'], CourseTodoStatus>> = {
  queued: 'pending',
  running: 'in_progress',
  waiting_for_input: 'in_progress',
  paused: 'in_progress',
  completed: 'completed',
  failed: 'pending',
  canceled: 'pending'
};

/**
 * Find (or create) the single chat-scoped run that owns this conversation's todo
 * list. Idempotent: reuses the most recent `chat` run for the conversation.
 */
export async function ensureChatRun(params: {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
}): Promise<TAiAgentRun> {
  const { orgId, courseId, conversationId, userId } = params;

  // A conversation is the natural scope. When there's no conversationId (rare —
  // pre-save wizard), fall back to the newest chat run for this course+user so we
  // don't orphan a fresh run on every message.
  const whereConversation = conversationId
    ? and(
        eq(schema.aiAgentRun.conversationId, conversationId),
        eq(schema.aiAgentRun.userId, userId),
        eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
      )
    : and(
        eq(schema.aiAgentRun.courseId, courseId),
        eq(schema.aiAgentRun.userId, userId),
        eq(schema.aiAgentRun.phase, CHAT_RUN_PHASE)
      );

  const [existing] = await db
    .select()
    .from(schema.aiAgentRun)
    .where(whereConversation)
    .orderBy(asc(schema.aiAgentRun.createdAt))
    .limit(1);

  if (existing) return existing;

  const [row] = await db
    .insert(schema.aiAgentRun)
    .values({
      orgId,
      courseId,
      conversationId: conversationId ?? null,
      userId,
      status: 'running',
      phase: CHAT_RUN_PHASE,
      approvedPlan: null,
      executionCursor: {},
      sourceIds: [],
      modelSummary: '',
      queuedInstructions: []
    })
    .returning();

  if (!row) throw new Error('ensureChatRun: insert returned no row');
  return row;
}

/**
 * Replace the whole todo list for a conversation in one shot. The model sends the
 * full list each call (like Claude Code's TodoWrite), so we upsert every item and
 * mark any previously-tracked item absent from the new list as canceled — the list
 * the model sees always matches the list it last wrote.
 */
export async function writeCourseTodoList(params: {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
  items: CourseTodoItem[];
}): Promise<CourseTodoItem[]> {
  const run = await ensureChatRun(params);
  const now = new Date().toISOString();

  const incomingKeys = new Set(params.items.map((it) => it.key));

  // Upsert each incoming item (keyed by stepKey → in-place update on repeat).
  for (const item of params.items) {
    const runStatus = RUN_STATUS_BY_TODO[item.status] ?? 'queued';
    await db
      .insert(schema.aiAgentRunStep)
      .values({
        runId: run.id,
        stepKey: item.key,
        stepType: TODO_STEP_TYPE,
        status: runStatus,
        input: { content: item.content, priority: item.priority },
        finishedAt: item.status === 'completed' ? now : null
      })
      .onConflictDoUpdate({
        target: [schema.aiAgentRunStep.runId, schema.aiAgentRunStep.stepKey],
        set: {
          status: runStatus,
          input: { content: item.content, priority: item.priority },
          finishedAt: item.status === 'completed' ? now : null,
          updatedAt: now
        }
      });
  }

  // Cancel steps the model dropped from the list (kept as rows for history, but
  // hidden from the active list via 'canceled' status).
  const existingSteps = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(and(eq(schema.aiAgentRunStep.runId, run.id), eq(schema.aiAgentRunStep.stepType, TODO_STEP_TYPE)));

  for (const step of existingSteps) {
    if (!incomingKeys.has(step.stepKey) && step.status !== 'canceled') {
      await db
        .update(schema.aiAgentRunStep)
        .set({ status: 'canceled', updatedAt: now })
        .where(eq(schema.aiAgentRunStep.id, step.id));
    }
  }

  return readCourseTodoList({ ...params, runId: run.id });
}

/** Read the current (non-canceled) todo list for a conversation, in stable order. */
export async function readCourseTodoList(params: {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
  /** Optional: skip the ensureChatRun lookup when the caller already has the run id. */
  runId?: string;
}): Promise<CourseTodoItem[]> {
  let runId = params.runId;
  if (!runId) {
    // Read-only path: don't create a run just to read an empty list.
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

  const steps = await db
    .select()
    .from(schema.aiAgentRunStep)
    .where(and(eq(schema.aiAgentRunStep.runId, runId), eq(schema.aiAgentRunStep.stepType, TODO_STEP_TYPE)))
    .orderBy(asc(schema.aiAgentRunStep.createdAt));

  return steps
    .filter((step) => step.status !== 'canceled')
    .map((step) => {
      const input = (step.input ?? {}) as { content?: string; priority?: CourseTodoPriority };
      return {
        key: step.stepKey,
        content: input.content ?? step.stepKey,
        status: TODO_STATUS_BY_RUN[step.status] ?? 'pending',
        priority: input.priority ?? 'medium'
      } satisfies CourseTodoItem;
    });
}

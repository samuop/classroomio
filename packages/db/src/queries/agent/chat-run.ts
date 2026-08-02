import { and, asc, eq } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';
import type { TAiAgentRun } from '@db/types';

/**
 * The chat-scoped agent run — a container for per-conversation state that must
 * outlive the chat transcript.
 *
 * The live chat (POST /agent/chat) does not run the durable-run worker; it drives
 * the model directly via streamText. But state like the plan registry still needs
 * somewhere durable to live, because history gets trimmed and build mode discards
 * the transcript entirely. Rather than add tables, we reuse `ai_agent_run` /
 * `ai_agent_run_step`: one lightweight run per conversation, tagged with the
 * `chat` phase, and one step per tracked item (distinguished by `stepType`).
 *
 * Thin and self-contained — no worker, no locking. Callers treat failures here as
 * non-fatal and proceed without the state.
 */

/** Phase tag separating chat-driven runs from durable worker runs. */
export const CHAT_RUN_PHASE = 'chat';

/**
 * Find (or create) the single chat-scoped run that owns this conversation's
 * state. Idempotent: reuses the oldest `chat` run for the conversation.
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

import { listChatDocumentsByCourse } from '@cio/db/queries/agent/chat-document';
import { getDocumentText, getDocumentSummary } from '@api/services/agent/document';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * The source pack — every document attached to a course, assembled into one
 * stable block of context.
 *
 * Planning and building a course is not a retrieval problem. To decide what the
 * sections should be, and to write a lesson that doesn't contradict page 200, the
 * model needs the material *at once*; RAG answers "which passage mentions X",
 * which is the wrong question. So the pack inlines full text and leans on prompt
 * caching to make re-sending it affordable.
 *
 * Two properties matter and both are easy to lose:
 *
 *  - **Completeness.** The previous loader gave full text only to the document
 *    attached to the current message and degraded every other source to a short
 *    summary. A teacher with three PDFs was planning from one.
 *
 *  - **Byte stability.** A prompt cache is a prefix match. The pack is ordered by
 *    creation time and carries no per-turn data, so the same course produces the
 *    same bytes every turn and the provider can serve it from cache. Anything
 *    volatile (course structure, plan progress) must live in a LATER message —
 *    mixing them is what made the cache miss on every build turn.
 */

/** ~4 chars per token; good enough for a budget guard, and deliberately cheap. */
const CHARS_PER_TOKEN = 4;

/**
 * Token ceiling for the whole pack. Both supported providers (MiniMax-M3 and
 * Gemini) have very large windows, so this is a cost/attention guard rather than a
 * hard limit: past a few hundred thousand tokens, recall in the middle of the
 * context degrades and every turn gets expensive. Override with
 * AGENT_SOURCE_PACK_BUDGET.
 */
export const DEFAULT_SOURCE_PACK_BUDGET = 300_000;

export function resolveSourcePackBudget(): number {
  const raw = process.env.AGENT_SOURCE_PACK_BUDGET?.trim();
  if (!raw) return DEFAULT_SOURCE_PACK_BUDGET;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SOURCE_PACK_BUDGET;
}

export interface SourcePackEntry {
  id: string;
  fileName: string;
  /** `full` = complete text; `summary` = trimmed because the budget ran out. */
  kind: 'full' | 'summary';
  chars: number;
}

export interface SourcePack {
  /** The context block, or undefined when the course has no usable sources. */
  text?: string;
  entries: SourcePackEntry[];
  /** Sources that had to be degraded to a summary — surfaced so the UI can warn. */
  truncatedCount: number;
  estimatedTokens: number;
}

const EMPTY_PACK: SourcePack = { entries: [], truncatedCount: 0, estimatedTokens: 0 };

/**
 * Assemble every source for a course into one context block.
 *
 * Documents are taken oldest-first (the order the teacher added them, which is
 * also the order they think of them in) until the budget is spent; the remainder
 * degrade to summaries with a pointer to `search_document` for detail. Failing to
 * load one source never fails the pack.
 */
export async function buildSourcePack(params: {
  courseId: string;
  userId: string;
  redis: RedisClient;
  budgetTokens?: number;
  /**
   * Skip this document's full text — it lives in a provider-side explicit cache
   * (Gemini `cachedContents`) and is referenced through providerOptions instead.
   */
  excludeFullTextForId?: string;
}): Promise<SourcePack> {
  const { courseId, userId, redis, excludeFullTextForId } = params;
  const budgetChars = (params.budgetTokens ?? resolveSourcePackBudget()) * CHARS_PER_TOKEN;

  let documents;
  try {
    documents = await listChatDocumentsByCourse(courseId, userId);
  } catch (error) {
    console.error('[source-pack] failed to list course sources:', error);
    return EMPTY_PACK;
  }

  if (documents.length === 0) return EMPTY_PACK;

  // Oldest first: deterministic, and independent of which document happens to be
  // attached to this turn — that is what keeps the block byte-stable.
  const ordered = [...documents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const entries: SourcePackEntry[] = [];
  const blocks: string[] = [];
  let usedChars = 0;
  let truncatedCount = 0;

  for (const doc of ordered) {
    if (doc.id === excludeFullTextForId) continue;

    let body: string | null = null;
    let kind: 'full' | 'summary' = 'full';

    try {
      const text = await getDocumentText(doc.id, userId, redis);

      if (text && usedChars + text.length <= budgetChars) {
        body = text;
      } else if (text) {
        // Over budget: keep the source present as a summary rather than dropping
        // it, so the model knows it exists and can search it.
        body = await getDocumentSummary(doc.id, userId, redis);
        kind = 'summary';
        truncatedCount += 1;
      }
    } catch (error) {
      console.error(`[source-pack] failed to load source ${doc.id}:`, error);
      continue;
    }

    if (!body) continue;

    usedChars += body.length;
    entries.push({ id: doc.id, fileName: doc.fileName, kind, chars: body.length });
    blocks.push(
      kind === 'full'
        ? `--- Source: ${doc.fileName} (id: ${doc.id}, full text) ---\n${body}`
        : `--- Source: ${doc.fileName} (id: ${doc.id}, summary — the full text did not fit; use search_document for detail) ---\n${body}`
    );
  }

  if (blocks.length === 0) return EMPTY_PACK;

  const header =
    `## Course Sources (${entries.length})\n\n` +
    `These are the teacher's source materials for this course. Plan and write from them; ` +
    `do not invent material they do not support.\n\n`;

  return {
    text: header + blocks.join('\n\n'),
    entries,
    truncatedCount,
    estimatedTokens: Math.ceil(usedChars / CHARS_PER_TOKEN)
  };
}

import type { AiAssistantMessage, AiAssistantMessageMetadata } from './types';

const APPROX_CHARS_PER_TOKEN = 4;
const MAX_TOOL_OUTPUT_CHARS = 2000;

export interface ContextUsage {
  /** Tokens used by the latest model request, or an estimate before the first response */
  usedTokens: number;
  /** Maximum context window size for the model */
  maxTokens: number;
  /** Percentage of context used (0-100) */
  percentage: number;
  /** Whether the context is nearly full (>= threshold) */
  isNearlyFull: boolean;
  /** Whether the context is completely full (>= 100%) */
  isFull: boolean;
  /**
   * Tokens compacting would actually reclaim: the transcript, and nothing else.
   * Undefined when the server did not report a breakdown (older messages).
   */
  compactableTokens?: number;
  /** Sources + system prompt + tool schemas: re-sent every turn, immune to compaction. */
  fixedTokens?: number;
  /**
   * The course material alone, broken out of `fixedTokens`.
   *
   * It is the single reason the gauge swings: the pack rides along when the
   * agent may need every source at once and is left out on a single-lesson
   * edit, which moves the reading by tens of thousands of tokens between one
   * message and the next. Without this line the teacher sees a number jump from
   * 13% to 70% and back with nothing to attribute it to.
   */
  sourcesTokens?: number;
  /**
   * Whether compaction is worth offering. False when the window is full of
   * material rather than conversation — there, the honest advice is to split
   * the course, not to summarize a short chat.
   */
  isCompactionWorthwhile: boolean;
}

/** Threshold percentage at which we consider context "nearly full" */
export const CONTEXT_NEARLY_FULL_THRESHOLD = 90;

/** Threshold percentage at which we consider context "full" and block input */
export const CONTEXT_FULL_THRESHOLD = 95;

/**
 * Minimum share of the window the transcript must occupy before compaction is
 * worth proposing. Summarizing costs a model call and loses detail; below this
 * it cannot move the gauge enough to be worth either.
 */
export const COMPACTABLE_SHARE_THRESHOLD = 15;

function getSerializedLength(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'string') {
    return value.length;
  }

  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function estimatePartChars(part: unknown): number {
  if (!part || typeof part !== 'object') {
    return getSerializedLength(part);
  }

  const record = part as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'step-start') {
    return 0;
  }

  if (type.startsWith('tool-')) {
    const outputChars =
      record.state === 'output-available' ? Math.min(getSerializedLength(record.output), MAX_TOOL_OUTPUT_CHARS) : 0;

    return type.length + getSerializedLength(record.input) + outputChars + getSerializedLength(record.errorText);
  }

  if (typeof record.text === 'string') {
    return record.text.length;
  }

  return getSerializedLength(record);
}

function estimateContextTokens(messages: AiAssistantMessage[]): number {
  const chars = messages.reduce((messageTotal, message) => {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const partsChars = parts.reduce((partTotal, part) => partTotal + estimatePartChars(part), 0);

    return messageTotal + message.role.length + partsChars;
  }, 0);

  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

/**
 * Tracks the latest provider-reported request size as the context guard.
 * Do not sum historical usage: every assistant turn can include a full prompt
 * replay, so summing turns overstates current context. The character estimate
 * is only a fallback before the first provider usage report exists.
 *
 * Prefer `contextTokens` (input size of the last request) over `totalTokens`.
 * `totalTokens` is a BILLING figure that AI SDK v7 aggregates over every step
 * of the round: one turn that called a tool over a 110k-token document reported
 * ~222k and pushed a brand-new conversation to "context full" against the 200k
 * budget, prompting the teacher to compact a chat with two messages in it.
 * `totalTokens` remains the fallback for messages persisted before the field.
 */
export function calculateContextUsage(messages: AiAssistantMessage[], contextWindow: number): ContextUsage {
  const latestTokenUsage = [...messages]
    .reverse()
    .map((message) => (message.metadata as AiAssistantMessageMetadata | undefined)?.tokenUsage)
    .find((tokenUsage) => tokenUsage !== undefined);
  const usedTokens =
    latestTokenUsage?.contextTokens ?? latestTokenUsage?.totalTokens ?? estimateContextTokens(messages);

  const percentage = contextWindow > 0 ? Math.min(100, Math.round((usedTokens / contextWindow) * 100)) : 0;

  const breakdown = latestTokenUsage?.contextBreakdown;
  const compactableTokens = breakdown?.conversationTokens;
  const fixedTokens = breakdown
    ? breakdown.sourcesTokens + breakdown.systemTokens + breakdown.turnContextTokens + breakdown.overheadTokens
    : undefined;

  // Without a breakdown we cannot tell transcript from material, so fall back to
  // the old behaviour and let the teacher decide.
  const compactableShare =
    compactableTokens !== undefined && contextWindow > 0 ? (compactableTokens / contextWindow) * 100 : undefined;

  return {
    usedTokens,
    maxTokens: contextWindow,
    percentage,
    isNearlyFull: percentage >= CONTEXT_NEARLY_FULL_THRESHOLD,
    isFull: percentage >= CONTEXT_FULL_THRESHOLD,
    compactableTokens,
    fixedTokens,
    sourcesTokens: breakdown?.sourcesTokens,
    isCompactionWorthwhile: compactableShare === undefined || compactableShare >= COMPACTABLE_SHARE_THRESHOLD
  };
}

/**
 * Formats token count for display (e.g., "125K" for 125000)
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }

  return tokens.toString();
}

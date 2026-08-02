const MAX_MESSAGES = 20;
const KEEP_RECENT = 16;
const MAX_TOOL_OUTPUT_CHARS = 2000;
const APPROX_CHARS_PER_TOKEN = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimToolOutputs(messages: any[]): any[] {
  return messages.map((message) => {
    if (!Array.isArray(message.parts)) return message;

    const trimmedParts = message.parts.map((part: any) => {
      if (part.state !== 'output-available' || part.output == null) return part;

      const serialized = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
      if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) return part;

      const truncated = serialized.slice(0, MAX_TOOL_OUTPUT_CHARS) + '…[truncated]';
      return { ...part, output: truncated };
    });

    if (trimmedParts === message.parts) return message;

    return { ...message, parts: trimmedParts };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trimMessageHistory(messages: any[]): any[] {
  const countTrimmed = messages.length <= MAX_MESSAGES ? messages : [messages[0], ...messages.slice(-KEEP_RECENT)];

  return trimToolOutputs(countTrimmed);
}

/**
 * What the context window is actually made of this turn.
 *
 * A single occupancy percentage is not enough to act on, because only ONE of
 * these segments can be reclaimed. On a teacher turn the source pack alone is
 * ~71k tokens and is re-sent verbatim every request by design — the instructor
 * agent needs every source at once. Compacting summarizes the TRANSCRIPT and
 * nothing else, so a gauge reading 90% can be almost entirely uncompactable,
 * and offering "compact" there burns a summarization call to reclaim nothing.
 *
 * `conversationTokens` is therefore the number that should drive compaction,
 * not the total.
 */
export interface ContextBreakdown {
  /** Prompt slice for this phase. Fixed for the turn; not reclaimable. */
  systemTokens: number;
  /** Full text of every course source. Fixed for the course; not reclaimable. */
  sourcesTokens: number;
  /** Per-turn block: course structure, plan progress, open lesson. Rebuilt each turn. */
  turnContextTokens: number;
  /** The chat transcript — the only segment compaction can shrink. */
  conversationTokens: number;
  /**
   * Provider total minus everything measured above: tool schemas plus whatever
   * framing the provider adds. Derived rather than measured, so it also absorbs
   * the error in the char-based estimates and keeps the parts summing to the
   * exact figure the provider reported.
   */
  overheadTokens: number;
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageChars(messages: any[]): number {
  return messages.reduce((total, message) => {
    if (!message) return total;
    if (typeof message.content === 'string') return total + message.content.length;

    if (Array.isArray(message.content)) {
      return (
        total +
        message.content.reduce((partTotal: number, part: unknown) => {
          if (typeof part === 'string') return partTotal + part.length;
          try {
            return partTotal + JSON.stringify(part).length;
          } catch {
            return partTotal;
          }
        }, 0)
      );
    }

    try {
      return total + JSON.stringify(message).length;
    } catch {
      return total;
    }
  }, 0);
}

export function measureContextBreakdown(params: {
  /** Exact input size of the last request, as reported by the provider. */
  totalContextTokens: number;
  systemPrompt: string;
  /** Prefer the pack's own estimate so this agrees with the build-time log. */
  sourcePackTokens?: number;
  turnContextText: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversationMessages: any[];
}): ContextBreakdown | undefined {
  const { totalContextTokens, systemPrompt, sourcePackTokens, turnContextText, conversationMessages } = params;

  // Without the provider's figure there is nothing to apportion, and a purely
  // estimated breakdown would invite decisions based on made-up numbers.
  if (!totalContextTokens || totalContextTokens <= 0) return undefined;

  const systemTokens = estimateTokens(systemPrompt.length);
  const sourcesTokens = sourcePackTokens ?? 0;
  const turnContextTokens = estimateTokens(turnContextText.length);
  const conversationTokens = estimateTokens(messageChars(conversationMessages));

  const measured = systemTokens + sourcesTokens + turnContextTokens + conversationTokens;

  return {
    systemTokens,
    sourcesTokens,
    turnContextTokens,
    conversationTokens,
    overheadTokens: Math.max(0, totalContextTokens - measured)
  };
}

import type { ProgressStep } from './tool-labels';
import { getCompletedToolLine, getPendingToolLine } from './tool-labels';

export interface AgentToolPart {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolInvocation?: {
    toolName?: string;
    result?: unknown;
  };
}

export function isAgentToolPart(part: unknown): part is AgentToolPart {
  if (!part || typeof part !== 'object') {
    return false;
  }

  const record = part as Record<string, unknown>;

  if (record.type === 'tool-invocation') {
    return true;
  }

  return typeof record.type === 'string' && record.type.startsWith('tool-');
}

export function getAgentToolName(part: AgentToolPart): string | null {
  if (part.type === 'tool-invocation') {
    return part.toolInvocation?.toolName ?? null;
  }

  if (!part.type.startsWith('tool-')) {
    return null;
  }

  return part.type.slice(5);
}

export function getAgentToolResult(part: AgentToolPart): unknown {
  if (part.type === 'tool-invocation') {
    return part.toolInvocation?.result;
  }

  return part.output;
}

export function getAgentToolInput(part: AgentToolPart): unknown {
  return (part as { input?: unknown }).input;
}

/**
 * Tools that render their own rich card in the message bubble (plan view,
 * template/discovery forms) — excluded from the generic step list.
 */
const SELF_RENDERED_TOOLS = new Set([
  'generate_course_plan',
  'ask_template_questions',
  'ask_discovery_questions'
]);

/**
 * Derive the agent's step list from a single message's parts. Because parts are
 * persisted per message, this lets any past assistant message show what steps it
 * ran — not just the live one. Mirrors the mapping in `planExecutionState`.
 */
export function getAgentStepsForMessage(message: { parts?: unknown[] }): ProgressStep[] {
  const parts = (message.parts ?? []) as unknown[];

  return parts.flatMap((part) => {
    if (!isAgentToolPart(part)) {
      return [];
    }

    const toolName = getAgentToolName(part);

    if (!toolName || SELF_RENDERED_TOOLS.has(toolName)) {
      return [];
    }

    const status = getAgentToolStatus(part);
    const line =
      status === 'completed'
        ? getCompletedToolLine(toolName, getAgentToolResult(part))
        : getPendingToolLine(toolName, getAgentToolInput(part));

    return [{ line, status } satisfies ProgressStep];
  });
}

export function getAgentToolStatus(part: AgentToolPart): ProgressStep['status'] {
  if (part.state === 'result' || part.state === 'output-available') {
    return 'completed';
  }

  if (part.state === 'output-error') {
    return 'failed';
  }

  if (
    part.state === 'call' ||
    part.state === 'partial-call' ||
    part.state === 'input-streaming' ||
    part.state === 'input-available'
  ) {
    return 'in_progress';
  }

  return 'pending';
}

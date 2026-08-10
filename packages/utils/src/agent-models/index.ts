/**
 * Shared registry of LLM models the AI assistant can use.
 *
 * The model/provider is chosen server-side by the API (see
 * pickAnyConfiguredProvider in @cio/ai-assistant) and any `model` the client
 * sends is ignored. The descriptors here exist for:
 *  - The dashboard's in-chat "context used" indicator (reads `contextWindow`).
 *  - Historical conversation records that may still reference an old id.
 *  - Optional future picker / cost-tier badges.
 *
 * **Privacy contract**: `label` is the only field that may reach the client
 * and MUST stay generic — clients should never learn which provider, company
 * or specific model powers the assistant. The other fields (`provider`,
 * `backendModelId`) are backend-internal even though they live in this
 * shared package.
 */

const ASSISTANT_LABEL = 'Asistente IA';

export const AGENT_MODEL_IDS = [
  'minimax-m3',
  // Kept for backend/historical compatibility — not shown in the picker.
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gpt-5.4-mini',
  'claude-sonnet-3-5',
  'kimi-k2.6'
] as const;

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];
export type AgentModelProvider = 'google' | 'openai' | 'anthropic' | 'moonshot' | 'minimax';
export type AgentModelCostTier = 'low' | 'high';

export interface AgentModelDescriptor {
  /** Backend-internal — DO NOT expose to the client. */
  provider: AgentModelProvider;
  /**
   * User-facing display name. Must stay generic (e.g. "Asistente IA") so
   * the client never learns which model or company is in use.
   */
  label: string;
  /** The exact model id passed to the provider SDK. Backend-internal. */
  backendModelId: string;
  /** Whether this model is available on the free plan. */
  isFree: boolean;
  /** Cost tier — safe to expose (no provider/model info leaked). */
  costTier: AgentModelCostTier;
  /** Context window size in tokens. Safe to expose (used by the indicator). */
  contextWindow: number;
}

export const AGENT_MODELS: Record<AgentModelId, AgentModelDescriptor> = {
  'minimax-m3': {
    provider: 'minimax',
    label: ASSISTANT_LABEL,
    backendModelId: 'MiniMax-M3',
    isFree: false,
    costTier: 'high',
    contextWindow: 1_000_000
  },
  'gemini-flash-latest': {
    provider: 'google',
    label: ASSISTANT_LABEL,
    backendModelId: 'gemini-flash-latest',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-flash-lite-latest': {
    provider: 'google',
    label: ASSISTANT_LABEL,
    backendModelId: 'gemini-flash-lite-latest',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-2.5-flash-lite': {
    provider: 'google',
    label: ASSISTANT_LABEL,
    backendModelId: 'gemini-2.5-flash-lite',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-3.1-flash-lite': {
    provider: 'google',
    label: ASSISTANT_LABEL,
    backendModelId: 'gemini-3.1-flash-lite',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-3.5-flash-lite': {
    provider: 'google',
    label: ASSISTANT_LABEL,
    backendModelId: 'gemini-3.5-flash-lite',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gpt-5.4-mini': {
    provider: 'openai',
    label: ASSISTANT_LABEL,
    backendModelId: 'gpt-5.4-mini',
    isFree: false,
    costTier: 'low',
    contextWindow: 400_000
  },
  'claude-sonnet-3-5': {
    provider: 'anthropic',
    label: ASSISTANT_LABEL,
    backendModelId: 'claude-sonnet-4-6',
    isFree: false,
    costTier: 'high',
    contextWindow: 1_000_000
  },
  'kimi-k2.6': {
    provider: 'moonshot',
    label: ASSISTANT_LABEL,
    backendModelId: 'kimi-k2.6',
    isFree: true,
    costTier: 'low',
    contextWindow: 262_144
  }
};

export const UI_PICKER_MODEL_IDS = ['minimax-m3'] as const satisfies readonly AgentModelId[];

export const DEFAULT_PICKER_MODEL_ID: AgentModelId = 'minimax-m3';

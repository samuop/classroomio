/**
 * Shared registry of LLM models the AI assistant can use.
 *
 * - `AGENT_MODELS` is the full set the backend supports.
 * - `UI_PICKER_MODEL_IDS` is the subset shown in the dashboard model picker.
 *
 * This deployment only configures a Google (Gemini) API key, so the picker is
 * scoped to Gemini variants. OpenAI / Anthropic / Moonshot descriptors are kept
 * in `AGENT_MODELS` (so backend code paths and historical records keep
 * resolving) but are intentionally NOT offered in the UI — selecting them would
 * fail without their API keys.
 *
 * The Gemini ids use Google's `*-latest` aliases where possible so they never
 * point at a discontinued version (see resolveModelName in @cio/ai-assistant).
 */

export const AGENT_MODEL_IDS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  // Kept for backend/historical compatibility — not shown in the picker.
  'gpt-5.4-mini',
  'claude-sonnet-3-5',
  'kimi-k2.6'
] as const;

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];
export type AgentModelProvider = 'google' | 'openai' | 'anthropic' | 'moonshot';
export type AgentModelCostTier = 'low' | 'high';

export interface AgentModelDescriptor {
  provider: AgentModelProvider;
  label: string;
  /** The exact model id passed to the provider SDK. */
  backendModelId: string;
  /** Whether this model is available on the free plan. */
  isFree: boolean;
  /** Cost tier shown in the model picker — 'low' ($) or 'high' ($$$). */
  costTier: AgentModelCostTier;
  /** Context window size in tokens. Used to show context usage indicator. */
  contextWindow: number;
}

export const AGENT_MODELS: Record<AgentModelId, AgentModelDescriptor> = {
  // ─── Gemini (the only provider with a configured key here) ──────────────────
  'gemini-flash-latest': {
    provider: 'google',
    label: 'Gemini Flash (último)',
    backendModelId: 'gemini-flash-latest',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-flash-lite-latest': {
    provider: 'google',
    label: 'Gemini Flash Lite (último)',
    backendModelId: 'gemini-flash-lite-latest',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-2.5-flash-lite': {
    provider: 'google',
    label: 'Gemini 2.5 Flash Lite',
    backendModelId: 'gemini-2.5-flash-lite',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  'gemini-3.1-flash-lite': {
    provider: 'google',
    label: 'Gemini 3.1 Flash Lite',
    backendModelId: 'gemini-3.1-flash-lite',
    isFree: true,
    costTier: 'low',
    contextWindow: 1_048_576
  },
  // ─── Other providers: backend-only, hidden from the picker ──────────────────
  'gpt-5.4-mini': {
    provider: 'openai',
    label: 'GPT-5.4 Mini',
    backendModelId: 'gpt-5.4-mini',
    isFree: false,
    costTier: 'low',
    contextWindow: 400_000
  },
  'claude-sonnet-3-5': {
    provider: 'anthropic',
    label: 'Claude Sonnet 4.6',
    backendModelId: 'claude-sonnet-4-6',
    isFree: false,
    costTier: 'high',
    contextWindow: 1_000_000
  },
  'kimi-k2.6': {
    provider: 'moonshot',
    label: 'Kimi K2.6',
    backendModelId: 'kimi-k2.6',
    isFree: true,
    costTier: 'low',
    contextWindow: 262_144
  }
};

export const UI_PICKER_MODEL_IDS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite'
] as const satisfies readonly AgentModelId[];

export const DEFAULT_PICKER_MODEL_ID: AgentModelId = 'gemini-flash-latest';

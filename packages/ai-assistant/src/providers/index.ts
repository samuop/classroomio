import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import type { EmbeddingModel, ImageModel, LanguageModel, Tool } from 'ai';
import { AIProvider, type AIProviderConfig } from '../types';

/**
 * Embedding model for semantic search (RAG). Google's gemini-embedding-001 at its
 * full 3072 dimensions (maximum semantic quality; must match EMBEDDING_DIMENSIONS
 * in @cio/db schema, stored as halfvec). At full 3072 dims the model returns
 * already-normalized vectors, so no manual L2 normalization is needed (unlike the
 * truncated <3072 case). Returns null when GOOGLE_API_KEY is unset, so callers can
 * fall back to literal search.
 */
export const EMBEDDING_MODEL_NAME = 'gemini-embedding-001';
export const EMBEDDING_OUTPUT_DIMENSIONS = 3072;

export function getEmbeddingModel(): EmbeddingModel | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });
  return google.textEmbeddingModel(EMBEDDING_MODEL_NAME);
}

/**
 * Image model for lesson illustrations ("Nano Banana 2").
 *
 * Google-only and independent of `CHAT_PROVIDER`, for the same reason as
 * embeddings: it is the only configured provider that generates images, and the
 * chat flag is about which model writes prose. `GOOGLE_API_KEY` is the same key
 * the RAG already uses — there is not one key per service.
 *
 * `gemini-3.1-flash-image` at 1K is the deliberate middle tier: US$0.067 an
 * image against US$0.0336 for the lite model and US$0.134 for pro. At one image
 * per lesson a 49-lesson course costs ~US$3.28 — more than the entire text
 * generation of that same course, which is why `MAX_IMAGES_PER_ROUND` exists.
 * Images are billed per image, not per token, so they never touch the org's
 * monthly token allowance.
 */
export const IMAGE_MODEL_NAME = 'gemini-3.1-flash-image';
export const IMAGE_SIZE = '1K';

export function getImageModel(): ImageModel | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });

  return google.image(process.env.GOOGLE_IMAGE_MODEL || IMAGE_MODEL_NAME);
}

/**
 * The model and the tool that do web research, for the course wizard and the
 * agent's `search_web`.
 *
 * Google-only and independent of `CHAT_PROVIDER`, for the same reason as
 * embeddings and images: Grounding with Google Search is a Gemini server-side
 * tool, so it is available whenever `GOOGLE_API_KEY` is set — even on an install
 * whose chat runs on MiniMax. There is not one key per service; this is the same
 * key the RAG already uses.
 *
 * `GOOGLE_SEARCH_MODEL` exists as its own knob because grounding is a per-model
 * capability: pointing `GOOGLE_MODEL` at something that does not support the
 * tool would take research down with the chat, and the two decisions are not the
 * same decision. Unset, it follows `GOOGLE_MODEL` — which in production is
 * `gemini-3.5-flash-lite`, a model that does support it.
 *
 * The tool must be named `google_search` in the tool set; the provider matches
 * it by name.
 */
export function getWebSearchModel(): { model: LanguageModel; searchTool: Tool } | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });
  const modelName = process.env.GOOGLE_SEARCH_MODEL?.trim() || resolveModelName(AIProvider.GOOGLE);

  return {
    model: google(modelName),
    searchTool: google.tools.googleSearch({}) as Tool
  };
}

/**
 * providerOptions to pass to embed()/embedMany() so Gemini returns the full
 * 3072-dim vectors explicitly (the model default, stated here for clarity).
 */
export const EMBEDDING_PROVIDER_OPTIONS = {
  google: { outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONS }
} as const;

/**
 * Per-provider env var to override the model name without code changes.
 * E.g. set GOOGLE_MODEL="gemini-flash-latest" in the API .env.
 */
const PROVIDER_MODEL_ENV: Record<AIProvider, string> = {
  [AIProvider.OPENAI]: 'OPENAI_MODEL',
  [AIProvider.ANTHROPIC]: 'ANTHROPIC_MODEL',
  [AIProvider.GOOGLE]: 'GOOGLE_MODEL',
  [AIProvider.MOONSHOT]: 'MOONSHOT_MODEL',
  [AIProvider.MINIMAX]: 'MINIMAX_MODEL'
};

/**
 * MiniMax exposes an Anthropic-compatible endpoint we consume through the
 * Anthropic SDK via a custom baseURL. We use the Anthropic adapter (not the
 * OpenAI one) because the MiniMax docs recommend it for prompt-cache benefits,
 * and the dashboard only exposes MiniMax to instructors.
 *
 * **Note on the path:** the Vercel Anthropic SDK (`@ai-sdk/anthropic@4.x`)
 * builds the request URL as `${baseURL}/messages` WITHOUT prepending `/v1`.
 * So if the baseURL is `https://api.minimax.io/anthropic`, the final URL
 * becomes `https://api.minimax.io/anthropic/messages` and MiniMax returns
 * 404. The baseURL must therefore include the `/v1` segment so the SDK
 * produces `https://api.minimax.io/anthropic/v1/messages`, which is the
 * path MiniMax actually serves.
 */
const MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic/v1';

/**
 * Anthropic-compatible providers — consume MiniMax-M3 and Claude through the
 * Anthropic SDK with the same wire format (`/messages`, `cache_control`, etc.).
 * Used wherever the agent needs to know whether to send Anthropic-style
 * request shaping (cache_control tags, beta headers, etc.) — the two providers
 * are interchangeable at the protocol level even though the API keys and
 * base URLs differ.
 */
export const ANTHROPIC_COMPATIBLE_PROVIDERS: readonly AIProvider[] = [
  AIProvider.ANTHROPIC,
  AIProvider.MINIMAX
] as const;

export function isAnthropicCompatibleProvider(provider: AIProvider): boolean {
  return ANTHROPIC_COMPATIBLE_PROVIDERS.includes(provider);
}

/**
 * Built-in fallbacks used when the env override is unset.
 *
 * For Google we default to the `*-latest` alias on purpose: Google keeps it
 * pointed at the newest stable Flash-Lite, so it never goes obsolete even if a
 * pinned version (e.g. gemini-3.1-flash-lite) is later discontinued. Operators
 * who want a fixed version can pin it via GOOGLE_MODEL.
 */
const DEFAULT_MODELS: Record<AIProvider, string> = {
  [AIProvider.OPENAI]: 'gpt-5.4-mini',
  [AIProvider.ANTHROPIC]: 'claude-sonnet-4-20250514',
  [AIProvider.GOOGLE]: 'gemini-flash-lite-latest',
  [AIProvider.MOONSHOT]: 'kimi-k2.6',
  [AIProvider.MINIMAX]: 'MiniMax-M3'
};

const PROVIDER_API_KEY_ENV: Record<AIProvider, string> = {
  [AIProvider.OPENAI]: 'OPENAI_API_KEY',
  [AIProvider.ANTHROPIC]: 'ANTHROPIC_API_KEY',
  [AIProvider.GOOGLE]: 'GOOGLE_API_KEY',
  [AIProvider.MOONSHOT]: 'MOONSHOT_API_KEY',
  [AIProvider.MINIMAX]: 'MINIMAX_API_KEY'
};

/**
 * Resolves the model name for a provider, preferring the env override
 * (e.g. GOOGLE_MODEL) and falling back to the built-in default. Centralizing
 * this lets the whole codebase pick the model from config, not hardcoded names.
 */
export function resolveModelName(provider: AIProvider): string {
  const override = process.env[PROVIDER_MODEL_ENV[provider]]?.trim();
  return override || DEFAULT_MODELS[provider];
}

/**
 * Creates an AI SDK LanguageModel from provider configuration.
 * Normalizes OpenAI, Anthropic, and Google into a single interface for streamText().
 */
export function createModel(config: AIProviderConfig): LanguageModel {
  const modelName = config.model || resolveModelName(config.provider);

  switch (config.provider) {
    case AIProvider.OPENAI: {
      const openai = createOpenAI({ apiKey: config.apiKey });
      return openai(modelName);
    }
    case AIProvider.ANTHROPIC: {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(modelName);
    }
    case AIProvider.GOOGLE: {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return google(modelName);
    }
    case AIProvider.MOONSHOT: {
      const moonshot = createMoonshotAI({ apiKey: config.apiKey });
      return moonshot(modelName);
    }
    case AIProvider.MINIMAX: {
      // MiniMax is consumed through the Anthropic SDK with a custom base URL.
      const minimax = createAnthropic({ apiKey: config.apiKey, baseURL: MINIMAX_BASE_URL });
      return minimax(modelName);
    }
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

/**
 * Reads the API key for a specific provider from its dedicated env var.
 * Returns null when the key is unset, so callers can decide whether to 503.
 */
export function getProviderConfigForProvider(provider: AIProvider): AIProviderConfig | null {
  const apiKey = process.env[PROVIDER_API_KEY_ENV[provider]];
  if (!apiKey) return null;

  return { provider, apiKey };
}

/**
 * Returns the first provider that has a key configured, in preference order.
 * Used by routes that don't take an explicit model (status check, title generation).
 */
export function pickAnyConfiguredProvider(): AIProviderConfig | null {
  // Chat provider is operator-controlled via the `CHAT_PROVIDER` env var.
  // This deployment is locked to two providers — MiniMax (Anthropic-
  // compatible) and Google. The flag is the source of truth for which one
  // is the *preferred* provider, but with soft fallback to the other one
  // when the preferred key is missing (so a misconfigured deploy reports
  // `enabled: true` on the other key instead of silently disabling the
  // agent). Anthropic, OpenAI and Moonshot are not considered at chat time
  // even if their env vars are set — the AGENT_MODELS registry still
  // describes them for historical conversation records.
  //
  // Embeddings (RAG) are NOT routed through this function — they always
  // come from Google via `getEmbeddingModel()` (the only provider that
  // exposes an embedding endpoint).
  //
  // Valid flag values: "minimax" (default), "google". Empty/undefined
  // defaults to "minimax". Any other value logs a one-time warning and
  // falls back to "minimax".
  const raw = process.env.CHAT_PROVIDER?.toLowerCase().trim();
  const preferred: AIProvider = resolveChatProviderPreference(raw);

  const order: AIProvider[] =
    preferred === AIProvider.GOOGLE
      ? [AIProvider.GOOGLE, AIProvider.MINIMAX]
      : [AIProvider.MINIMAX, AIProvider.GOOGLE];

  for (const provider of order) {
    const config = getProviderConfigForProvider(provider);
    if (config) return config;
  }

  return null;
}

/**
 * Parses the CHAT_PROVIDER env var into an AIProvider. Logs a warning when
 * the value is unrecognized (typo, deprecated name, etc.) so the operator
 * notices in the API logs that their flag is being ignored. The warning is
 * intentionally emitted on every call (no one-shot latch) — misconfiguration
 * should be loud, not silent.
 */
function resolveChatProviderPreference(raw: string | undefined): AIProvider {
  if (raw === undefined || raw === '') return AIProvider.MINIMAX;
  if (raw === 'minimax') return AIProvider.MINIMAX;
  if (raw === 'google') return AIProvider.GOOGLE;
  console.warn(
    `[providers] Unknown CHAT_PROVIDER="${raw}", falling back to "minimax". Valid values: "minimax", "google".`
  );
  return AIProvider.MINIMAX;
}

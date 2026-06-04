import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { AIProvider, type AIProviderConfig } from '../types';

/**
 * Embedding model for semantic search (RAG). We use Google's gemini-embedding-001
 * truncated to 768 dims (must match EMBEDDING_DIMENSIONS in @cio/db schema) via
 * outputDimensionality. NOTE: gemini-embedding-001 does NOT auto-normalize reduced
 * dimensions — callers must L2-normalize the vector (see normalizeEmbedding) so
 * cosine distance is meaningful. Returns null when GOOGLE_API_KEY is unset, so
 * callers can fall back to literal search.
 */
export const EMBEDDING_MODEL_NAME = 'gemini-embedding-001';
export const EMBEDDING_OUTPUT_DIMENSIONS = 768;

export function getEmbeddingModel(): EmbeddingModel | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });
  return google.textEmbeddingModel(EMBEDDING_MODEL_NAME);
}

/**
 * providerOptions to pass to embed()/embedMany() so Gemini returns 768-dim
 * vectors (Matryoshka truncation) instead of the default 3072.
 */
export const EMBEDDING_PROVIDER_OPTIONS = {
  google: { outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONS }
} as const;

/**
 * L2-normalize an embedding so cosine distance behaves correctly. Required for
 * gemini-embedding-001 at reduced dimensionality (it returns un-normalized vectors).
 */
export function normalizeEmbedding(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

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

/** MiniMax exposes an OpenAI-compatible endpoint, so we reuse @ai-sdk/openai with this base URL. */
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

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
  [AIProvider.MINIMAX]: 'MiniMax-M2.7'
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
      // MiniMax is OpenAI-compatible; point the OpenAI provider at its base URL.
      const minimax = createOpenAI({ apiKey: config.apiKey, baseURL: MINIMAX_BASE_URL });
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
  const order: AIProvider[] = [
    AIProvider.GOOGLE,
    AIProvider.OPENAI,
    AIProvider.ANTHROPIC,
    AIProvider.MOONSHOT,
    AIProvider.MINIMAX
  ];

  for (const provider of order) {
    const config = getProviderConfigForProvider(provider);
    if (config) return config;
  }

  return null;
}

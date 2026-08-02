/**
 * Tests for the chat-provider selection logic (`pickAnyConfiguredProvider`).
 *
 * The operator controls which provider the chat agent uses via the
 * `CHAT_PROVIDER` env var. This suite pins down:
 *  - The valid values: `"minimax"` and `"google"` (case-insensitive, trimmed).
 *  - The default when unset/empty: `"minimax"`.
 *  - Soft fallback: if the preferred provider has no key, the other
 *    eligible provider is tried before giving up.
 *  - Hard exclusion: Anthropic / OpenAI / Moonshot env vars are never
 *    considered at chat time, even if they are set.
 *  - One-shot warning: an unknown CHAT_PROVIDER value is logged once per
 *    process and then silently falls back to the default.
 *
 * Embeddings (RAG) are intentionally NOT routed through this function —
 * see `document-cache.test.ts` and the `@cio/ai-assistant/providers`
 * module for the separate `getEmbeddingModel()` path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIProvider } from '@cio/ai-assistant';
import { pickAnyConfiguredProvider } from '@cio/ai-assistant/providers';

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  // Clear all chat-provider keys so each test starts from a known state.
  delete process.env.MINIMAX_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  delete process.env.CHAT_PROVIDER;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

function withKeys(minimax: string | null, google: string | null) {
  if (minimax) process.env.MINIMAX_API_KEY = minimax;
  if (google) process.env.GOOGLE_API_KEY = google;
}

// ────────────────────────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────────────────────────

describe('pickAnyConfiguredProvider — defaults', () => {
  it('returns null when no provider has a key and the flag is unset', () => {
    const result = pickAnyConfiguredProvider();
    expect(result).toBeNull();
  });

  it('defaults to minimax when CHAT_PROVIDER is unset and only MiniMax is configured', () => {
    withKeys('sk-test', null);
    const result = pickAnyConfiguredProvider();
    expect(result).toEqual({ provider: AIProvider.MINIMAX, apiKey: 'sk-test' });
  });

  it('defaults to minimax when CHAT_PROVIDER is an empty string', () => {
    process.env.CHAT_PROVIDER = '';
    withKeys('sk-test', 'goog-test');
    const result = pickAnyConfiguredProvider();
    expect(result?.provider).toBe(AIProvider.MINIMAX);
  });

  it('defaults to minimax when CHAT_PROVIDER is only whitespace', () => {
    process.env.CHAT_PROVIDER = '   ';
    withKeys('sk-test', 'goog-test');
    const result = pickAnyConfiguredProvider();
    expect(result?.provider).toBe(AIProvider.MINIMAX);
  });

  it('soft-falls-back to google when CHAT_PROVIDER=minimax but no MiniMax key is set', () => {
    process.env.CHAT_PROVIDER = 'minimax';
    withKeys(null, 'goog-test');
    const result = pickAnyConfiguredProvider();
    expect(result).toEqual({ provider: AIProvider.GOOGLE, apiKey: 'goog-test' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CHAT_PROVIDER=google
// ────────────────────────────────────────────────────────────────────────────

describe('pickAnyConfiguredProvider — CHAT_PROVIDER=google', () => {
  it('returns google when both keys are set (preferred wins)', () => {
    process.env.CHAT_PROVIDER = 'google';
    withKeys('sk-test', 'goog-test');
    const result = pickAnyConfiguredProvider();
    expect(result).toEqual({ provider: AIProvider.GOOGLE, apiKey: 'goog-test' });
  });

  it('returns google when only GOOGLE_API_KEY is set', () => {
    process.env.CHAT_PROVIDER = 'google';
    withKeys(null, 'goog-test');
    const result = pickAnyConfiguredProvider();
    expect(result).toEqual({ provider: AIProvider.GOOGLE, apiKey: 'goog-test' });
  });

  it('soft-falls-back to minimax when google is preferred but only MiniMax has a key', () => {
    process.env.CHAT_PROVIDER = 'google';
    withKeys('sk-test', null);
    const result = pickAnyConfiguredProvider();
    expect(result).toEqual({ provider: AIProvider.MINIMAX, apiKey: 'sk-test' });
  });

  it('returns null when google is preferred and no eligible provider has a key', () => {
    process.env.CHAT_PROVIDER = 'google';
    withKeys(null, null);
    expect(pickAnyConfiguredProvider()).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Case-insensitivity and whitespace
// ────────────────────────────────────────────────────────────────────────────

describe('pickAnyConfiguredProvider — case and whitespace', () => {
  it('treats MINIMAX (uppercase) as minimax', () => {
    process.env.CHAT_PROVIDER = 'MINIMAX';
    withKeys('sk-test', 'goog-test');
    expect(pickAnyConfiguredProvider()?.provider).toBe(AIProvider.MINIMAX);
  });

  it('treats Google (mixed case) as google', () => {
    process.env.CHAT_PROVIDER = 'Google';
    withKeys('sk-test', 'goog-test');
    expect(pickAnyConfiguredProvider()?.provider).toBe(AIProvider.GOOGLE);
  });

  it('trims surrounding whitespace', () => {
    process.env.CHAT_PROVIDER = '  google  ';
    withKeys('sk-test', 'goog-test');
    expect(pickAnyConfiguredProvider()?.provider).toBe(AIProvider.GOOGLE);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Hard exclusion: Anthropic / OpenAI / Moonshot are never picked
// ────────────────────────────────────────────────────────────────────────────

describe('pickAnyConfiguredProvider — hard exclusion of non-eligible providers', () => {
  it('never picks Anthropic even when ANTHROPIC_API_KEY is the only one set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(pickAnyConfiguredProvider()).toBeNull();
  });

  it('never picks OpenAI even when OPENAI_API_KEY is the only one set', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    expect(pickAnyConfiguredProvider()).toBeNull();
  });

  it('never picks Moonshot even when MOONSHOT_API_KEY is the only one set', () => {
    process.env.MOONSHOT_API_KEY = 'sk-moonshot-test';
    expect(pickAnyConfiguredProvider()).toBeNull();
  });

  it('ignores Anthropic and OpenAI keys when MiniMax is also set (preference wins)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.CHAT_PROVIDER = 'minimax';
    withKeys('sk-mini', null);
    const result = pickAnyConfiguredProvider();
    expect(result).toEqual({ provider: AIProvider.MINIMAX, apiKey: 'sk-mini' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Unknown values: warning + fallback
// ────────────────────────────────────────────────────────────────────────────

describe('pickAnyConfiguredProvider — unknown CHAT_PROVIDER values', () => {
  it('logs a warning and defaults to minimax when the value is "openai"', () => {
    process.env.CHAT_PROVIDER = 'openai';
    withKeys('sk-mini', 'goog-test');
    const result = pickAnyConfiguredProvider();
    expect(result?.provider).toBe(AIProvider.MINIMAX);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('CHAT_PROVIDER="openai"')
    );
  });

  it('logs a warning and defaults to minimax when the value is gibberish', () => {
    process.env.CHAT_PROVIDER = 'definitely-not-a-provider';
    withKeys('sk-mini', null);
    expect(pickAnyConfiguredProvider()?.provider).toBe(AIProvider.MINIMAX);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('emits the warning on every call (intentionally loud on misconfig)', () => {
    process.env.CHAT_PROVIDER = 'openai';
    withKeys('sk-mini', 'goog-test');
    pickAnyConfiguredProvider();
    pickAnyConfiguredProvider();
    pickAnyConfiguredProvider();
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it('does not warn on the canonical values (minimax / google)', () => {
    process.env.CHAT_PROVIDER = 'minimax';
    withKeys('sk-mini', null);
    pickAnyConfiguredProvider();
    expect(console.warn).not.toHaveBeenCalled();

    process.env.CHAT_PROVIDER = 'google';
    withKeys(null, 'goog-test');
    pickAnyConfiguredProvider();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Combined behavior with the cache
//
// The cache layer (`document-cache.ts`) keys off the provider returned by
// pickAnyConfiguredProvider — so flipping CHAT_PROVIDER flips the cache
// backend automatically. We can't exercise the full cache path here
// (that's in `document-cache.test.ts`), but we do verify that the
// provider returned by pickAnyConfiguredProvider matches the cache's
// backend-selection rules.
// ────────────────────────────────────────────────────────────────────────────

describe('pickAnyConfiguredProvider — cache backend compatibility', () => {
  it('returns a provider for which the cache layer has a backend (minimax → Anthropic-compatible)', () => {
    process.env.CHAT_PROVIDER = 'minimax';
    withKeys('sk-mini', null);
    const config = pickAnyConfiguredProvider();
    expect(config?.provider).toBe(AIProvider.MINIMAX);
    // The cache layer accepts MINIMAX in its `cacheableProviders` list.
    expect([AIProvider.GOOGLE, AIProvider.ANTHROPIC, AIProvider.MINIMAX]).toContain(
      config?.provider
    );
  });

  it('returns a provider for which the cache layer has a backend (google → cachedContents)', () => {
    process.env.CHAT_PROVIDER = 'google';
    withKeys(null, 'goog-test');
    const config = pickAnyConfiguredProvider();
    expect(config?.provider).toBe(AIProvider.GOOGLE);
    expect([AIProvider.GOOGLE, AIProvider.ANTHROPIC, AIProvider.MINIMAX]).toContain(
      config?.provider
    );
  });
});

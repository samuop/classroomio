/**
 * Unit tests for the document-cache module (Capa 2b).
 *
 * Covers the dual-backend refactor: Google `cachedContents` (legacy) and
 * Anthropic-compatible `cache_control: ephemeral` (MiniMax-M3 / Claude). The
 * two backends share the public surface (`resolveDocumentCache`,
 * `releaseDocumentCaches`, `classifyDocumentForCache`,
 * `isDocumentCacheEnabled`) and the Redis dedup key, but the cache
 * lifecycle is fundamentally different — Gemini is explicit (we create and
 * DELETE the resource), Anthropic-compatible is implicit (the server manages
 * it from a `cache_control` hint in the request). These tests pin down that
 * divergence so future refactors don't accidentally conflate them.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest';
import { AIProvider } from '@cio/ai-assistant';
import { getDocumentText } from '@api/services/agent/document';

// Module mocks must be registered before the import under test is evaluated.
vi.mock('@api/services/agent/document', () => ({
  getDocumentText: vi.fn()
}));

import {
  classifyDocumentForCache,
  getDocumentCacheStatus,
  isDocumentCacheEnabled,
  MAX_CACHE_CHARS,
  MAX_CACHE_TOKENS,
  MIN_CACHE_DOCUMENT_CHARS,
  reconcileCourseSourceCache,
  recordAnthropicCacheHit,
  refreshDocumentCache,
  releaseDocumentCaches,
  resolveDocumentCache
} from '@api/services/agent/document-cache';
import {
  agentDocumentCacheKey,
  agentDocumentCacheKeyByContent
} from '@api/utils/redis/key-generators';

const mockedGetDocumentText = vi.mocked(getDocumentText);

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

type RedisState = Map<string, { value: string; expiresAt: number }>;

function makeFakeRedis() {
  const state: RedisState = new Map();
  return {
    state,
    get: vi.fn(async (key: string) => {
      const entry = state.get(key);
      if (!entry) return null;
      if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
        state.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: string, opts?: { EX?: number }) => {
      const expiresAt = opts?.EX ? Date.now() + opts.EX * 1000 : 0;
      state.set(key, { value, expiresAt });
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = state.delete(key);
      return existed ? 1 : 0;
    })
  };
}

/** A document large enough to be cacheable (>= 16k chars). */
const BIG_DOC = 'x'.repeat(MIN_CACHE_DOCUMENT_CHARS + 1000);

/** A document just below the cache threshold (< 16k chars). */
const SMALL_DOC = 'x'.repeat(MIN_CACHE_DOCUMENT_CHARS - 1);

/** A document that exceeds the 400k-token policy cap. */
const HUGE_DOC = 'x'.repeat(MAX_CACHE_CHARS + 1);

let fetchSpy: MockInstance<typeof fetch>;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  // Default: cache enabled, no real API key, fresh fetch mock.
  process.env.DOCUMENT_CACHE_ENABLED = 'true';
  process.env.GEMINI_EXPLICIT_CACHE = '';
  process.env.GOOGLE_API_KEY = 'test-google-key';
  mockedGetDocumentText.mockReset();
  mockedGetDocumentText.mockResolvedValue(BIG_DOC);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockReset();
});

afterEach(() => {
  fetchSpy.mockRestore();
  process.env = originalEnv;
  vi.unstubAllEnvs();
});

/**
 * Stub a successful Gemini cachedContents create response.
 * Returns the `name` (cacheName) the API would return.
 */
function stubGeminiCreate(cacheName: string) {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify({ name: cacheName }), { status: 200 })
  );
}

/**
 * Stub a Gemini cachedContents TTL renew response. The renew endpoint
 * returns the updated cache; the SDK doesn't read the body, so an empty 200
 * is enough — we just need it not to throw.
 */
function stubGeminiRenew(ok = true) {
  fetchSpy.mockResolvedValueOnce(new Response('', { status: ok ? 200 : 500 }));
}

/** Stub a Gemini cachedContents DELETE response (always 200 in the happy path). */
function stubGeminiDelete() {
  fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));
}

// ────────────────────────────────────────────────────────────────────────────
// isDocumentCacheEnabled
// ────────────────────────────────────────────────────────────────────────────

describe('isDocumentCacheEnabled', () => {
  it('returns false when neither env var is set', () => {
    delete process.env.DOCUMENT_CACHE_ENABLED;
    delete process.env.GEMINI_EXPLICIT_CACHE;
    expect(isDocumentCacheEnabled()).toBe(false);
  });

  it('returns true when DOCUMENT_CACHE_ENABLED=true', () => {
    process.env.DOCUMENT_CACHE_ENABLED = 'true';
    expect(isDocumentCacheEnabled()).toBe(true);
  });

  it('returns true via the legacy GEMINI_EXPLICIT_CACHE env var', () => {
    delete process.env.DOCUMENT_CACHE_ENABLED;
    process.env.GEMINI_EXPLICIT_CACHE = 'true';
    expect(isDocumentCacheEnabled()).toBe(true);
  });

  it('returns false for any value other than "true"', () => {
    process.env.DOCUMENT_CACHE_ENABLED = '1';
    expect(isDocumentCacheEnabled()).toBe(false);
    process.env.DOCUMENT_CACHE_ENABLED = 'yes';
    expect(isDocumentCacheEnabled()).toBe(false);
    process.env.GEMINI_EXPLICIT_CACHE = 'false';
    expect(isDocumentCacheEnabled()).toBe(false);
  });

  it('lets DOCUMENT_CACHE_ENABLED win when both are set', () => {
    process.env.DOCUMENT_CACHE_ENABLED = 'true';
    process.env.GEMINI_EXPLICIT_CACHE = 'false';
    expect(isDocumentCacheEnabled()).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// classifyDocumentForCache
// ────────────────────────────────────────────────────────────────────────────

describe('classifyDocumentForCache', () => {
  it('returns too_small for null', () => {
    expect(classifyDocumentForCache(null)).toBe('too_small');
  });

  it('returns too_small for undefined', () => {
    expect(classifyDocumentForCache(undefined)).toBe('too_small');
  });

  it('returns too_small for an empty string', () => {
    expect(classifyDocumentForCache('')).toBe('too_small');
  });

  it('returns too_small for text under the 16k threshold', () => {
    expect(classifyDocumentForCache(SMALL_DOC)).toBe('too_small');
  });

  it('returns cache for text at the threshold', () => {
    expect(classifyDocumentForCache('x'.repeat(MIN_CACHE_DOCUMENT_CHARS))).toBe('cache');
  });

  it('returns cache for text comfortably above the threshold', () => {
    expect(classifyDocumentForCache(BIG_DOC)).toBe('cache');
  });

  it('returns over_limit for text beyond MAX_CACHE_CHARS (400k-token policy cap)', () => {
    expect(classifyDocumentForCache(HUGE_DOC)).toBe('over_limit');
  });

  it('keeps the policy cap consistent: MAX_CACHE_CHARS == MAX_CACHE_TOKENS * 4', () => {
    expect(MAX_CACHE_CHARS).toBe(MAX_CACHE_TOKENS * 4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveDocumentCache — guard rails (apply to every backend)
// ────────────────────────────────────────────────────────────────────────────

describe('resolveDocumentCache — guard rails', () => {
  it('returns empty when caching is disabled, even with a valid doc', async () => {
    process.env.DOCUMENT_CACHE_ENABLED = 'false';
    process.env.GEMINI_EXPLICIT_CACHE = '';
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-1',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
    expect(redis.set).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedGetDocumentText).not.toHaveBeenCalled();
  });

  it('returns empty when no currentDocumentId is provided', async () => {
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: undefined,
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
    expect(mockedGetDocumentText).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('returns empty for providers we do not cache (OPENAI, MOONSHOT)', async () => {
    const redis = makeFakeRedis();
    for (const provider of [AIProvider.OPENAI, AIProvider.MOONSHOT]) {
      const result = await resolveDocumentCache({
        provider,
        currentDocumentId: 'doc-1',
        userId: 'user-1',
        redis: redis as any
      });
      expect(result).toEqual({});
    }
  });

  it('fetches the document text once per call', async () => {
    const redis = makeFakeRedis();
    await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-1',
      userId: 'user-1',
      redis: redis as any
    });
    expect(mockedGetDocumentText).toHaveBeenCalledTimes(1);
    expect(mockedGetDocumentText).toHaveBeenCalledWith('doc-1', 'user-1', redis);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveDocumentCache — Anthropic-compatible backend (MiniMax / Claude)
// ────────────────────────────────────────────────────────────────────────────

describe('resolveDocumentCache — Anthropic-compatible backend', () => {
  it('returns a cache_control: ephemeral providerOptions WITHOUT excluding the document (cache is inline)', async () => {
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-anthropic-1',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
    });
    // CRITICAL: Anthropic-compatible cache is INLINE — the document text must
    // remain in the prompt so the cache_control hint can mark THAT block. The
    // Gemini backend, by contrast, stores text in a separate server-side
    // cachedContent resource and excludes it from the inline prompt.
    expect(result.excludeDocumentId).toBeUndefined();
    // No fetch — Anthropic-compatible is implicit / hint-based.
    expect(fetchSpy).not.toHaveBeenCalled();
    // And NO handle is written. Asking for a cache is not evidence of one:
    // only usage.cacheReadTokens on the response proves the provider cached
    // anything, and that is recorded later via recordAnthropicCacheHit.
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('treats the Anthropic provider identically to MiniMax (same backend)', async () => {
    const redisA = makeFakeRedis();
    const redisB = makeFakeRedis();
    const a = await resolveDocumentCache({
      provider: AIProvider.ANTHROPIC,
      currentDocumentId: 'doc-x',
      userId: 'user-1',
      redis: redisA as any
    });
    const b = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-x',
      userId: 'user-1',
      redis: redisB as any
    });
    expect(a.providerOptions).toEqual(b.providerOptions);
    // Both providers must keep the document inline (no exclusion).
    expect(a.excludeDocumentId).toBeUndefined();
    expect(b.excludeDocumentId).toBeUndefined();
  });

  it('leaves an existing fresh handle untouched (it is evidence, not a lease to renew)', async () => {
    const redis = makeFakeRedis();
    const preHandle = {
      type: 'anthropic',
      documentId: 'doc-anthropic-2',
      observedAt: Date.now() - 60_000,
      lastCacheReadTokens: 11_264,
      expireAt: Date.now() + 10 * 60 * 1000
    };
    redis.state.set('agent:document:cache:doc-anthropic-2', {
      value: JSON.stringify(preHandle),
      expiresAt: preHandle.expireAt
    });

    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-anthropic-2',
      userId: 'user-1',
      redis: redis as any
    });

    // Anthropic-compatible cache is INLINE — the document must stay in the
    // prompt so cache_control can mark the block. No exclusion.
    expect(result.excludeDocumentId).toBeUndefined();
    expect(result.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } }
    });
    // The handle records an observation that already happened. Sliding it
    // forward here would keep the badge lit forever off a single old hit.
    expect(redis.set).not.toHaveBeenCalled();
    expect(JSON.parse(redis.state.get('agent:document:cache:doc-anthropic-2')!.value)).toEqual(
      preHandle
    );
  });

  it('does not resurrect an expired handle', async () => {
    const redis = makeFakeRedis();
    const expired = {
      type: 'anthropic',
      documentId: 'doc-anthropic-4',
      expireAt: Date.now() - 1
    };
    redis.state.set('agent:document:cache:doc-anthropic-4', {
      value: JSON.stringify(expired),
      expiresAt: 0
    });

    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-anthropic-4',
      userId: 'user-1',
      redis: redis as any
    });

    expect(result.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } }
    });
    // Expiry means "the provider's window lapsed". Only a fresh cached read
    // may re-light it, and that comes from the response, not from asking.
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('ignores a Gemini handle in the same key (does not try to read .cacheName as a real name)', async () => {
    const redis = makeFakeRedis();
    const staleGeminiHandle = {
      type: 'gemini',
      cacheName: 'cachedContents/should-not-be-used',
      model: 'models/gemini-flash-lite-latest',
      expireAt: Date.now() + 10 * 60 * 1000
    };
    redis.state.set('agent:document:cache:doc-mixed-1', {
      value: JSON.stringify(staleGeminiHandle),
      expiresAt: staleGeminiHandle.expireAt
    });

    // No GOOGLE_API_KEY is needed for the Anthropic path, but we set it to
    // prove the call goes to the Anthropic backend (not the Gemini one).
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-mixed-1',
      userId: 'user-1',
      redis: redis as any
    });

    expect(result.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } }
    });
    expect(result.excludeDocumentId).toBeUndefined();
  });

  it('falls back to empty when the document is too small', async () => {
    mockedGetDocumentText.mockResolvedValue(SMALL_DOC);
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-small',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('returns { overLimit: true } when the document exceeds the 400k-token cap', async () => {
    mockedGetDocumentText.mockResolvedValue(HUGE_DOC);
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-huge',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({ overLimit: true });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('works even when GOOGLE_API_KEY is unset (proves backend isolation)', async () => {
    delete process.env.GOOGLE_API_KEY;
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-no-google',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } }
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveDocumentCache — Google backend
// ────────────────────────────────────────────────────────────────────────────

describe('resolveDocumentCache — Google backend', () => {
  it('returns google.cachedContent and excludeDocumentId after creating a cache', async () => {
    stubGeminiCreate('cachedContents/abc-123');
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-gemini-1',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({
      providerOptions: { google: { cachedContent: 'cachedContents/abc-123' } },
      excludeDocumentId: 'doc-gemini-1'
    });
    // Persisted a Gemini-shaped handle (not the Anthropic one).
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, raw] = redis.set.mock.calls[0];
    expect(key).toBe('agent:document:cache:doc-gemini-1');
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe('gemini');
    expect(parsed.cacheName).toBe('cachedContents/abc-123');
  });

  it('calls Gemini with the model resolved from GOOGLE_MODEL and a 900s TTL', async () => {
    process.env.GOOGLE_MODEL = 'gemini-flash-latest';
    stubGeminiCreate('cachedContents/xyz');
    const redis = makeFakeRedis();
    await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-gemini-2',
      userId: 'user-1',
      redis: redis as any
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url.toString()).toContain('generativelanguage.googleapis.com/v1beta/cachedContents');
    expect(url.toString()).toContain('key=test-google-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('models/gemini-flash-latest');
    expect(body.ttl).toBe('900s');
    expect(body.displayName).toBe('cio-agent-document');
  });

  it('falls back to empty when GOOGLE_API_KEY is unset', async () => {
    delete process.env.GOOGLE_API_KEY;
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-no-key',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to empty when the Gemini create call fails (500)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('internal error', { status: 500 }));
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-fail',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to empty when the Gemini create call returns no name', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-no-name',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
  });

  it('falls back to empty when the Gemini create call throws (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-throw',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
  });

  it('reuses a fresh Gemini handle without calling the API', async () => {
    process.env.GOOGLE_MODEL = 'gemini-flash-latest';
    const redis = makeFakeRedis();
    const existingHandle = {
      type: 'gemini',
      cacheName: 'cachedContents/existing',
      model: 'models/gemini-flash-latest',
      expireAt: Date.now() + 10 * 60 * 1000
    };
    redis.state.set('agent:document:cache:doc-reuse', {
      value: JSON.stringify(existingHandle),
      expiresAt: existingHandle.expireAt
    });

    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-reuse',
      userId: 'user-1',
      redis: redis as any
    });

    expect(result).toEqual({
      providerOptions: { google: { cachedContent: 'cachedContents/existing' } },
      excludeDocumentId: 'doc-reuse'
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replaces a handle whose model differs from the current GOOGLE_MODEL', async () => {
    const redis = makeFakeRedis();
    const staleHandle = {
      type: 'gemini',
      cacheName: 'cachedContents/old-model',
      model: 'models/gemini-2.5-flash-lite',
      expireAt: Date.now() + 10 * 60 * 1000
    };
    redis.state.set('agent:document:cache:doc-model-change', {
      value: JSON.stringify(staleHandle),
      expiresAt: staleHandle.expireAt
    });
    process.env.GOOGLE_MODEL = 'gemini-flash-latest';
    stubGeminiCreate('cachedContents/new-model');

    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-model-change',
      userId: 'user-1',
      redis: redis as any
    });

    expect(result.providerOptions).toEqual({
      google: { cachedContent: 'cachedContents/new-model' }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // recreated
  });

  it('replaces a handle whose Anthropic shape is left over from a previous provider', async () => {
    const redis = makeFakeRedis();
    // Operator switched from MiniMax to Gemini on the same documentId.
    const staleAnthropicHandle = {
      type: 'anthropic',
      documentId: 'doc-switched',
      expireAt: Date.now() + 10 * 60 * 1000
    };
    redis.state.set('agent:document:cache:doc-switched', {
      value: JSON.stringify(staleAnthropicHandle),
      expiresAt: staleAnthropicHandle.expireAt
    });
    stubGeminiCreate('cachedContents/switched');

    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-switched',
      userId: 'user-1',
      redis: redis as any
    });

    expect(result.providerOptions).toEqual({
      google: { cachedContent: 'cachedContents/switched' }
    });
  });

  it('falls back to empty when the document is too small', async () => {
    mockedGetDocumentText.mockResolvedValue(SMALL_DOC);
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-small-g',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns { overLimit: true } for documents over the policy cap', async () => {
    mockedGetDocumentText.mockResolvedValue(HUGE_DOC);
    const redis = makeFakeRedis();
    const result = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-huge-g',
      userId: 'user-1',
      redis: redis as any
    });
    expect(result).toEqual({ overLimit: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// releaseDocumentCaches
// ────────────────────────────────────────────────────────────────────────────

describe('releaseDocumentCaches', () => {
  it('DELETEs a Gemini cachedContent and clears the Redis handle', async () => {
    stubGeminiDelete();
    const redis = makeFakeRedis();
    redis.state.set('agent:document:cache:doc-g1', {
      value: JSON.stringify({
        type: 'gemini',
        cacheName: 'cachedContents/to-delete',
        model: 'models/gemini-flash-latest',
        expireAt: Date.now() + 10 * 60 * 1000
      }),
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await releaseDocumentCaches(['doc-g1'], redis as any);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url.toString()).toContain('cachedContents/to-delete');
    expect(init.method).toBe('DELETE');
    expect(redis.del).toHaveBeenCalledWith('agent:document:cache:doc-g1');
  });

  it('clears the Redis handle for an Anthropic-shaped entry WITHOUT calling fetch', async () => {
    const redis = makeFakeRedis();
    redis.state.set('agent:document:cache:doc-a1', {
      value: JSON.stringify({
        type: 'anthropic',
        documentId: 'doc-a1',
        expireAt: Date.now() + 10 * 60 * 1000
      }),
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await releaseDocumentCaches(['doc-a1'], redis as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('agent:document:cache:doc-a1');
  });

  it('is a no-op when there is no handle in Redis', async () => {
    const redis = makeFakeRedis();
    await releaseDocumentCaches(['doc-missing'], redis as any);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('agent:document:cache:doc-missing');
  });

  it('does not throw when the Gemini DELETE fails (best-effort)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const redis = makeFakeRedis();
    redis.state.set('agent:document:cache:doc-fail-del', {
      value: JSON.stringify({
        type: 'gemini',
        cacheName: 'cachedContents/forbidden',
        model: 'models/gemini-flash-latest',
        expireAt: Date.now() + 10 * 60 * 1000
      }),
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await expect(
      releaseDocumentCaches(['doc-fail-del'], redis as any)
    ).resolves.toBeUndefined();
    // Still cleared the local handle so the user doesn't see a stale cache pointer.
    expect(redis.del).toHaveBeenCalledWith('agent:document:cache:doc-fail-del');
  });

  it('processes a mixed list of Gemini and Anthropic documents in one call', async () => {
    stubGeminiDelete();
    const redis = makeFakeRedis();
    redis.state.set('agent:document:cache:doc-mix-1', {
      value: JSON.stringify({
        type: 'gemini',
        cacheName: 'cachedContents/mix-1',
        model: 'models/gemini-flash-latest',
        expireAt: Date.now() + 10 * 60 * 1000
      }),
      expiresAt: Date.now() + 10 * 60 * 1000
    });
    redis.state.set('agent:document:cache:doc-mix-2', {
      value: JSON.stringify({
        type: 'anthropic',
        documentId: 'doc-mix-2',
        expireAt: Date.now() + 10 * 60 * 1000
      }),
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await releaseDocumentCaches(['doc-mix-1', 'doc-mix-2'], redis as any);

    // Only the Gemini one needed a fetch call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledTimes(2);
    expect(redis.state.has('agent:document:cache:doc-mix-1')).toBe(false);
    expect(redis.state.has('agent:document:cache:doc-mix-2')).toBe(false);
  });

  it('continues processing remaining docs when one Redis read throws', async () => {
    const redis = makeFakeRedis();
    const originalGet = redis.get.getMockImplementation();
    let calls = 0;
    redis.get.mockImplementation(async (key: string) => {
      calls += 1;
      if (calls === 1) throw new Error('redis blip');
      return originalGet ? originalGet(key) : null;
    });
    // Second doc has a valid Gemini handle.
    stubGeminiDelete();
    redis.state.set('agent:document:cache:doc-after-blip', {
      value: JSON.stringify({
        type: 'gemini',
        cacheName: 'cachedContents/after-blip',
        model: 'models/gemini-flash-latest',
        expireAt: Date.now() + 10 * 60 * 1000
      }),
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await expect(
      releaseDocumentCaches(['doc-blip', 'doc-after-blip'], redis as any)
    ).resolves.toBeUndefined();

    // The second doc still got its DELETE + del.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// classifyDocumentForCache — boundary cases
//
// The threshold (16_000 chars) and cap (1_600_000 chars) bracket the
// "cacheable" range. These tests pin down the exact edges so a typo in the
// inequality (off-by-one) gets caught immediately. The boundaries also line
// up with real provider minimums: 4096 cached tokens for Gemini ≈ 16k chars,
// 1024 tokens for Anthropic ≈ 4k chars — we pick the higher of the two so
// both backends can serve the document without a rejected create call.
// ────────────────────────────────────────────────────────────────────────────

describe('classifyDocumentForCache — boundary cases', () => {
  it('one char below the threshold is too_small', () => {
    expect(classifyDocumentForCache('x'.repeat(MIN_CACHE_DOCUMENT_CHARS - 1))).toBe('too_small');
  });

  it('exactly at the threshold is cacheable', () => {
    expect(classifyDocumentForCache('x'.repeat(MIN_CACHE_DOCUMENT_CHARS))).toBe('cache');
  });

  it('one char above the threshold is cacheable', () => {
    expect(classifyDocumentForCache('x'.repeat(MIN_CACHE_DOCUMENT_CHARS + 1))).toBe('cache');
  });

  it('one char below the cap is cacheable', () => {
    expect(classifyDocumentForCache('x'.repeat(MAX_CACHE_CHARS - 1))).toBe('cache');
  });

  it('exactly at the cap is cacheable (last byte that fits)', () => {
    expect(classifyDocumentForCache('x'.repeat(MAX_CACHE_CHARS))).toBe('cache');
  });

  it('one char above the cap is over_limit', () => {
    expect(classifyDocumentForCache('x'.repeat(MAX_CACHE_CHARS + 1))).toBe('over_limit');
  });

  it('a 100k char document (~25k tokens) is cacheable', () => {
    // This is the sweet-spot size: big enough that inline cost matters,
    // small enough that the Gemini minimum is comfortably exceeded.
    expect(classifyDocumentForCache('x'.repeat(100_000))).toBe('cache');
  });

  it('a 500k char document (~125k tokens) is cacheable', () => {
    expect(classifyDocumentForCache('x'.repeat(500_000))).toBe('cache');
  });

  it('a 1M char document (~250k tokens) is cacheable', () => {
    expect(classifyDocumentForCache('x'.repeat(1_000_000))).toBe('cache');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// classifyDocumentForCache — real-looking text
//
// The above tests all use 'x'.repeat() which is degenerate: 1 char == 1
// token in some tokenizers but completely unrealistic for real documents.
// These tests use a chunk of prose to make sure whitespace and unicode don't
// trip the threshold logic.
// ────────────────────────────────────────────────────────────────────────────

describe('classifyDocumentForCache — real-looking text', () => {
  // ~3.5k chars of Spanish prose; padded with whitespace to push it past the
  // 16k threshold so we know the length check is on .length (UTF-16 code
  // units), not on a token estimate.
  const SPANISH_CHUNK =
    'La educación es un derecho fundamental que debe ser garantizado a todas las personas, sin distinción alguna. ' +
    'En un mundo cada vez más globalizado e interconectado, el acceso a una educación de calidad se vuelve aún más crucial. ';

  it('returns too_small for a paragraph that is genuinely below the threshold', () => {
    expect(classifyDocumentForCache(SPANISH_CHUNK)).toBe('too_small');
  });

  it('returns cache when the same paragraph is padded past the threshold with whitespace', () => {
    // SPANISH_CHUNK is ~250 chars. Repeat it enough to cross the 16k threshold.
    // We pick factors that give us clear, well-separated lengths on either side.
    const padded = SPANISH_CHUNK.repeat(40); // ~10k chars — still too_small
    const bigPadded = SPANISH_CHUNK.repeat(80); // ~20k chars — cacheable
    expect(padded.length).toBeLessThan(MIN_CACHE_DOCUMENT_CHARS);
    expect(bigPadded.length).toBeGreaterThan(MIN_CACHE_DOCUMENT_CHARS);
    expect(classifyDocumentForCache(padded)).toBe('too_small');
    expect(classifyDocumentForCache(bigPadded)).toBe('cache');
  });

  it('counts multi-byte characters by .length (UTF-16 code units), matching the real input shape', () => {
    // Emoji takes 2 UTF-16 code units in JS strings. 16_000 emojis is 32_000
    // .length — far above the threshold.
    const emojiDoc = '🎓'.repeat(MIN_CACHE_DOCUMENT_CHARS);
    expect(emojiDoc.length).toBe(MIN_CACHE_DOCUMENT_CHARS * 2);
    expect(classifyDocumentForCache(emojiDoc)).toBe('cache');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// agentDocumentCacheKey — pure function
//
// This is the dedup key shared by both backends. If a refactor renames it or
// changes its shape, the existing Gemini caches in flight would be orphaned
// and the Anthropic handle would be lost. Pin the shape so changes are
// intentional.
// ────────────────────────────────────────────────────────────────────────────

describe('agentDocumentCacheKey', () => {
  it('returns the canonical key shape', () => {
    expect(agentDocumentCacheKey('doc-abc')).toBe('agent:document:cache:doc-abc');
  });

  it('preserves the documentId verbatim (no encoding, no truncation)', () => {
    const weird = 'doc/with spaces & ñ-emoji-🎓';
    expect(agentDocumentCacheKey(weird)).toBe(`agent:document:cache:${weird}`);
  });

  it('uses the same key for both providers (the handle carries the type)', () => {
    // The dedup key is provider-agnostic; the type field in the handle JSON
    // tells the read path which backend to use. If a future refactor splits
    // the key by provider, both backends must be updated together.
    expect(agentDocumentCacheKey('doc-x')).toBe(agentDocumentCacheKey('doc-x'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// recordAnthropicCacheHit — the ONLY writer of an Anthropic handle
//
// The Anthropic-compatible API exposes no cache-status endpoint, so the only
// evidence a cache exists is usage.inputTokenDetails.cacheReadTokens on a real
// turn. These tests pin that down: nothing else may light the badge, and the
// (courseId, contentHash) shared key must be preferred so two users who
// uploaded the same PDF to the same course read one handle (§11).
// ────────────────────────────────────────────────────────────────────────────

describe('recordAnthropicCacheHit', () => {
  it('writes nothing when the turn reported no cached reads (a cache MISS)', async () => {
    const redis = makeFakeRedis();
    const handle = await recordAnthropicCacheHit({
      documentId: 'doc-miss',
      cacheReadTokens: 0,
      redis: redis as any
    });
    expect(handle).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('writes nothing on the first turn of a conversation (read=0 is the normal miss)', async () => {
    // Regression guard for the bug this replaced: the badge used to light up
    // from a speculative handle, so a first turn — which ALWAYS misses —
    // looked identical to a confirmed hit.
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-first-turn',
      courseId: 'course-1',
      contentHash: 'hash-1',
      cacheReadTokens: 0,
      redis: redis as any
    });
    const status = await getDocumentCacheStatus(
      'doc-first-turn',
      redis as any,
      'course-1',
      'hash-1'
    );
    expect(status.cached).toBe(false);
  });

  it('writes the handle to the SHARED (courseId, contentHash) key when both are known', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-shared',
      courseId: 'course-42',
      contentHash: 'abc123',
      cacheReadTokens: 11_264,
      redis: redis as any
    });

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, raw, opts] = redis.set.mock.calls[0];
    expect(key).toBe('agent:document:cache:course:course-42:abc123');
    // Matches the `ttl: '1h'` we request on the cached blocks. This asserted 300
    // on the assumption that MiniMax evicts after the standard 5-minute window;
    // production data disproved it (a turn read 110,464 cached tokens 19.8
    // minutes after the previous one), and the short window was hiding a live
    // cache rather than protecting against an over-claim.
    expect(opts.EX).toBe(3600);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe('anthropic');
    expect(parsed.documentId).toBe('doc-shared');
    expect(parsed.lastCacheReadTokens).toBe(11_264);
    expect(parsed.observedAt).toBeGreaterThan(0);
    expect(parsed.expireAt - Date.now()).toBeLessThanOrEqual(3_600_000);
  });

  it('falls back to the per-document key for legacy rows with no contentHash', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-legacy',
      courseId: 'course-42',
      contentHash: undefined,
      cacheReadTokens: 500,
      redis: redis as any
    });
    const [key] = redis.set.mock.calls[0];
    expect(key).toBe('agent:document:cache:doc-legacy');
  });

  it('reports the observed read, not a predicted remaining lifetime', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-observed',
      cacheReadTokens: 110_464,
      redis: redis as any
    });

    const status = await getDocumentCacheStatus('doc-observed', redis as any);

    // These three are the honest fields: the provider has no cache-status
    // endpoint, so what the badge may claim is "it served us N cached tokens,
    // this long ago" — never "the cache expires in N minutes".
    expect(status.cached).toBe(true);
    expect(status.lastCacheReadTokens).toBe(110_464);
    expect(status.observedSecondsAgo).toBeGreaterThanOrEqual(0);
    expect(status.observedAt).not.toBeNull();
  });

  it('leaves the observation fields null when nothing was ever read from cache', async () => {
    const redis = makeFakeRedis();
    const status = await getDocumentCacheStatus('doc-cold', redis as any);

    expect(status.cached).toBe(false);
    expect(status.observedAt).toBeNull();
    expect(status.observedSecondsAgo).toBeNull();
    expect(status.lastCacheReadTokens).toBeNull();
  });

  it('lets a second user in the same course read the first user\'s handle (§11 sharing)', async () => {
    const redis = makeFakeRedis();
    // Alice's chat turn confirms a cached read.
    await recordAnthropicCacheHit({
      documentId: 'doc-alice',
      courseId: 'course-shared',
      contentHash: 'same-content',
      cacheReadTokens: 9_000,
      redis: redis as any
    });

    // Bob uploaded the same file: dedup gave him Alice's documentId, and even
    // if it hadn't, the (course, hash) key is what the status read resolves.
    const status = await getDocumentCacheStatus(
      'doc-bob',
      redis as any,
      'course-shared',
      'same-content'
    );
    expect(status.cached).toBe(true);
    expect(status.provider).toBe('anthropic');
  });

  it('does NOT share across different courses with identical content', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-a',
      courseId: 'course-A',
      contentHash: 'identical',
      cacheReadTokens: 9_000,
      redis: redis as any
    });
    const other = await getDocumentCacheStatus('doc-b', redis as any, 'course-B', 'identical');
    expect(other.cached).toBe(false);
  });

  it('refreshes the window on every confirmed hit (the provider refreshes its cache for free)', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-slide',
      courseId: 'c',
      contentHash: 'h',
      cacheReadTokens: 100,
      redis: redis as any
    });
    const firstExpire = JSON.parse(redis.set.mock.calls[0][1]).expireAt;

    await new Promise((r) => setTimeout(r, 5));
    await recordAnthropicCacheHit({
      documentId: 'doc-slide',
      courseId: 'c',
      contentHash: 'h',
      cacheReadTokens: 250,
      redis: redis as any
    });
    const secondCall = JSON.parse(redis.set.mock.calls[1][1]);
    expect(secondCall.expireAt).toBeGreaterThan(firstExpire);
    expect(secondCall.lastCacheReadTokens).toBe(250);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The badge must not light up without provider evidence
// ────────────────────────────────────────────────────────────────────────────

describe('honest cache badge', () => {
  // contentHash must look like real SHA-256 hex: agentDocumentCacheKeyByContent
  // strips every non-hex char, so 'h1' would silently become '1'.
  const HASH = 'deadbeef0123abcd';
  const bigDoc = { id: 'doc-honest', text: BIG_DOC, courseId: 'c1', contentHash: HASH };

  it('reconcile does not create a handle for an eligible document (this was the bug)', async () => {
    // Opening the Sources panel triggers reconcile. It used to fabricate a
    // handle here, so the badge went green with zero traffic to the model.
    const redis = makeFakeRedis();
    const [result] = await reconcileCourseSourceCache([bigDoc], redis as any);

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('awaiting_cache_hit');
    expect(redis.set).not.toHaveBeenCalled();

    const status = await getDocumentCacheStatus('doc-honest', redis as any, 'c1', HASH);
    expect(status.cached).toBe(false);
  });

  it('reconcile keeps a handle that a real cached read produced', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-honest',
      courseId: 'c1',
      contentHash: HASH,
      cacheReadTokens: 8_000,
      redis: redis as any
    });

    const [result] = await reconcileCourseSourceCache([bigDoc], redis as any);
    expect(result.action).toBe('kept');
    expect(result.status?.cached).toBe(true);
  });

  it('reconcile releases an expired handle instead of rebuilding it', async () => {
    const redis = makeFakeRedis();
    redis.state.set(agentDocumentCacheKeyByContent('c1', HASH), {
      value: JSON.stringify({
        type: 'anthropic',
        documentId: 'doc-honest',
        expireAt: Date.now() - 1
      }),
      expiresAt: 0
    });

    const [result] = await reconcileCourseSourceCache([bigDoc], redis as any);
    expect(result.action).toBe('released');
    expect(result.reason).toBe('expired');
    expect(result.status).toBeNull();
  });

  it('refresh clears the evidence and reports uncached (no instant green badge)', async () => {
    const redis = makeFakeRedis();
    await recordAnthropicCacheHit({
      documentId: 'doc-honest',
      courseId: 'c1',
      contentHash: HASH,
      cacheReadTokens: 8_000,
      redis: redis as any
    });

    const status = await refreshDocumentCache('doc-honest', redis as any, 'c1', HASH);
    expect(status.cached).toBe(false);
    expect(status.expireAt).toBeNull();
    expect(redis.state.has(agentDocumentCacheKeyByContent('c1', HASH))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// End-to-end: real-looking document → Anthropic handle → release
//
// One happy-path test that exercises the full lifecycle of an Anthropic-shaped
// document cache: classify → ensure → re-read → release. Uses realistic text
// (not 'x'.repeat) to make sure the full path is exercised against something
// the production code would actually see.
// ────────────────────────────────────────────────────────────────────────────

describe('Anthropic end-to-end lifecycle', () => {
  it('classify → ensure → reuse → release without ever calling fetch', async () => {
    const text = 'Bienvenido al curso de programación. '.repeat(500); // ~17k chars
    expect(text.length).toBeGreaterThan(MIN_CACHE_DOCUMENT_CHARS);
    expect(classifyDocumentForCache(text)).toBe('cache');

    const redis = makeFakeRedis();
    mockedGetDocumentText.mockResolvedValue(text);

    // Turn 1: ask for the cache. This ALWAYS misses (nothing is stored yet),
    // so no handle is written and the badge stays dark.
    const first = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-e2e',
      userId: 'user-1',
      redis: redis as any
    });
    expect(first.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } }
    });
    expect(redis.set).not.toHaveBeenCalled();
    await recordAnthropicCacheHit({
      documentId: 'doc-e2e',
      cacheReadTokens: 0,
      redis: redis as any
    });
    expect(await getDocumentCacheStatus('doc-e2e', redis as any)).toMatchObject({ cached: false });

    // Turn 2: same prefix, so the provider now bills a cached read. THAT is
    // what lights the badge.
    const second = await resolveDocumentCache({
      provider: AIProvider.MINIMAX,
      currentDocumentId: 'doc-e2e',
      userId: 'user-1',
      redis: redis as any
    });
    expect(second.providerOptions).toEqual(first.providerOptions);
    await recordAnthropicCacheHit({
      documentId: 'doc-e2e',
      cacheReadTokens: 11_264,
      redis: redis as any
    });
    expect(await getDocumentCacheStatus('doc-e2e', redis as any)).toMatchObject({
      cached: true,
      provider: 'anthropic'
    });

    // Document is deleted (conversation closed) → release clears the handle.
    await releaseDocumentCaches(['doc-e2e'], redis as any);
    expect(fetchSpy).not.toHaveBeenCalled(); // Anthropic is server-managed
    expect(redis.state.has('agent:document:cache:doc-e2e')).toBe(false);
  });

  it('Google end-to-end: classify → ensure → reuse → release makes exactly 2 fetch calls (1 create + 1 delete)', async () => {
    process.env.GOOGLE_MODEL = 'gemini-flash-latest';
    const text = 'Lorem ipsum dolor sit amet. '.repeat(800); // ~22k chars
    expect(classifyDocumentForCache(text)).toBe('cache');

    const redis = makeFakeRedis();
    mockedGetDocumentText.mockResolvedValue(text);
    stubGeminiCreate('cachedContents/e2e-1');

    // First call: ensure creates the cache.
    const first = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-gemini-e2e',
      userId: 'user-1',
      redis: redis as any
    });
    expect(first.providerOptions).toEqual({
      google: { cachedContent: 'cachedContents/e2e-1' }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // create

    // Second call: reuse, no fetch.
    const second = await resolveDocumentCache({
      provider: AIProvider.GOOGLE,
      currentDocumentId: 'doc-gemini-e2e',
      userId: 'user-1',
      redis: redis as any
    });
    expect(second.providerOptions).toEqual(first.providerOptions);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still just the create

    // Release: explicit DELETE.
    stubGeminiDelete();
    await releaseDocumentCaches(['doc-gemini-e2e'], redis as any);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // create + delete
  });
});

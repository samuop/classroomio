import { resolveModelName, AIProvider } from '@cio/ai-assistant';
import { agentDocumentCacheKey } from '@api/utils/redis/key-generators';
import { getDocumentText } from '@api/services/agent/document';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * Document-level explicit prompt caching for the AI agent.
 *
 * When an instructor attaches a large document to a course build, the agent
 * would otherwise re-send the full text of the document on every chat turn.
 * This module caches the document once and references it from subsequent
 * requests at a fraction of the input cost.
 *
 * Two backends are supported, picked by the chat provider:
 *  - **Google (cachedContents)**: explicit REST cache; we manage the handle
 *    and reference it via `providerOptions.google.cachedContent`.
 *  - **Anthropic-compatible (cache_control: ephemeral)**: MiniMax-M3 and
 *    Claude both honor a `cache_control: { type: "ephemeral" }` hint on a
 *    system / message block; the server transparently creates the cache and
 *    reuses it on subsequent calls within 5 min. We only track the handle in
 *    Redis to dedupe and to know when the cache has gone cold.
 *
 * Design guarantees (both backends):
 *  - **Defensive**: every failure path returns null/{} and lets the caller
 *    fall back to inlining. Caching must NEVER block or break generation.
 *  - **Opt-in**: only runs when DOCUMENT_CACHE_ENABLED=true (or the legacy
 *    GEMINI_EXPLICIT_CACHE=true) and the document is large enough to be
 *    worth it (see classifyDocumentForCache).
 *  - **Self-healing dedup**: the Redis handle TTL is aligned to the cache
 *    TTL, so a stale handle expires on its own; a miss just rebuilds.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Cache TTL: 15 minutes, sliding. Build/edit sessions hammer the model in
 * bursts, so a short TTL renewed on use (see maybeRenewGeminiCache /
 * Anthropic implicit renewal) keeps the cache alive exactly while it's being
 * worked with and lets it die minutes after the instructor walks away.
 *
 * Anthropic server-side cache lifetime is 5 min, but our Redis handle can
 * outlive that — the next call simply recreates the cache if the server
 * already evicted it.
 */
const CACHE_TTL_SECONDS = 900;

/** Renew the TTL when a use finds less than this much lifetime remaining. */
const CACHE_RENEW_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Minimum characters before explicit caching kicks in. Policy: activate at the
 * model minimum. Gemini 3.x Flash requires 4096 cached tokens (2.5 requires
 * 2048); at ~4 chars/token, 16k chars ≈ 4k tokens covers every supported model
 * without a rejected create call. Anthropic's minimum is 1024 tokens, so the
 * same threshold is comfortably above it.
 */
export const MIN_CACHE_DOCUMENT_CHARS = 16_000;

/**
 * Maximum tokens a single course's cached material may hold. Policy: at 400k
 * tokens the instructor is told no more material fits and to start a separate
 * course. Estimated at ~4 chars/token (~1.6M chars).
 */
export const MAX_CACHE_TOKENS = 400_000;
export const MAX_CACHE_CHARS = MAX_CACHE_TOKENS * 4;

interface GeminiCacheHandle {
  type: 'gemini';
  cacheName: string; // "cachedContents/xxxx"
  model: string; // "models/gemini-..." the cache was created against
  expireAt: number; // epoch ms
}

interface AnthropicCacheHandle {
  type: 'anthropic';
  documentId: string;
  expireAt: number; // epoch ms
}

type CacheHandle = GeminiCacheHandle | AnthropicCacheHandle;

/** Whether explicit caching is enabled by config. */
export function isDocumentCacheEnabled(): boolean {
  return (
    process.env.DOCUMENT_CACHE_ENABLED === 'true' || process.env.GEMINI_EXPLICIT_CACHE === 'true'
  );
}

export type CacheEligibility = 'cache' | 'too_small' | 'over_limit';

/**
 * Classify a document for explicit caching:
 * - 'cache': within [model minimum, 400k-token policy cap] → cache it.
 * - 'too_small': below the model minimum → inline (cheaper than a cache).
 * - 'over_limit': beyond the 400k-token cap → inline (truncated upstream) AND
 *   the instructor is warned that no more material fits this course.
 */
export function classifyDocumentForCache(text: string | undefined | null): CacheEligibility {
  if (!text || text.length < MIN_CACHE_DOCUMENT_CHARS) return 'too_small';
  if (text.length > MAX_CACHE_CHARS) return 'over_limit';
  return 'cache';
}

// ────────────────────────────────────────────────────────────────────────────
// Google backend
// ────────────────────────────────────────────────────────────────────────────

/** Gemini requires the "models/<name>" form; resolveModelName returns the bare alias. */
function geminiModelResource(): string {
  const name = resolveModelName(AIProvider.GOOGLE);
  return name.startsWith('models/') ? name : `models/${name}`;
}

function geminiApiKey(): string | null {
  return process.env.GOOGLE_API_KEY || null;
}

/**
 * Create a cachedContent for the document text. Returns the cache handle, or null
 * on any failure (caller falls back to inline). The document goes in `contents`
 * as a single user turn; systemInstruction/tools are intentionally NOT cached
 * here — they're small and change per request, and caching them would tie the
 * cache to the exact tool set.
 */
async function createGeminiCache(text: string): Promise<GeminiCacheHandle | null> {
  const key = geminiApiKey();
  if (!key) return null;

  const model = geminiModelResource();

  try {
    const res = await fetch(`${GEMINI_API_BASE}/cachedContents?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        displayName: 'cio-agent-document',
        ttl: `${CACHE_TTL_SECONDS}s`,
        contents: [
          {
            role: 'user',
            parts: [{ text }]
          }
        ]
      })
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[document-cache] gemini create failed: ${res.status} ${detail.slice(0, 300)}`);
      return null;
    }

    const body = (await res.json()) as { name?: string };
    if (!body.name) {
      console.error('[document-cache] gemini create returned no name');
      return null;
    }

    return {
      type: 'gemini',
      cacheName: body.name,
      model,
      expireAt: Date.now() + CACHE_TTL_SECONDS * 1000
    };
  } catch (err) {
    console.error('[document-cache] gemini create error:', err);
    return null;
  }
}

/** Delete a Gemini cache by name. Best-effort; failures are logged, never thrown. */
async function deleteGeminiCache(cacheName: string): Promise<void> {
  const key = geminiApiKey();
  if (!key) return;
  try {
    await fetch(`${GEMINI_API_BASE}/${cacheName}?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (err) {
    console.error('[document-cache] gemini delete error:', err);
  }
}

/**
 * Sliding TTL: when a reused cache has < CACHE_RENEW_THRESHOLD_MS of life left,
 * PATCH it back up to CACHE_TTL_SECONDS ("15 min, renewed 15 more while in
 * use"). Returns the (possibly updated) expireAt. Best-effort: on failure the
 * old expireAt stands and the cache simply dies on schedule — next use rebuilds.
 */
async function maybeRenewGeminiCache(handle: GeminiCacheHandle): Promise<number> {
  if (handle.expireAt - Date.now() > CACHE_RENEW_THRESHOLD_MS) return handle.expireAt;

  const key = geminiApiKey();
  if (!key) return handle.expireAt;

  try {
    const res = await fetch(`${GEMINI_API_BASE}/${handle.cacheName}?key=${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: `${CACHE_TTL_SECONDS}s` })
    });

    if (!res.ok) {
      console.error(`[document-cache] gemini ttl renew failed: ${res.status}`);
      return handle.expireAt;
    }

    return Date.now() + CACHE_TTL_SECONDS * 1000;
  } catch (err) {
    console.error('[document-cache] gemini ttl renew error:', err);
    return handle.expireAt;
  }
}

/**
 * Get (or lazily create) the Gemini cache handle for a document. Dedups on
 * documentId via Redis: an existing, non-expired, same-model handle is reused;
 * otherwise a new cache is created and the handle stored with a TTL aligned to
 * the cache.
 */
async function ensureGeminiDocumentCache(params: {
  documentId: string;
  text: string;
  redis: RedisClient;
}): Promise<{ cacheName: string } | null> {
  const { documentId, text, redis } = params;

  if (!geminiApiKey()) return null;

  const model = geminiModelResource();
  const redisKey = agentDocumentCacheKey(documentId);

  try {
    const raw = await redis.get(redisKey);
    if (raw) {
      const handle = JSON.parse(raw) as CacheHandle;
      if (
        handle.type === 'gemini' &&
        handle.cacheName &&
        handle.model === model &&
        handle.expireAt > Date.now() + 30_000
      ) {
        const renewedExpireAt = await maybeRenewGeminiCache(handle);
        if (renewedExpireAt !== handle.expireAt) {
          const renewed: GeminiCacheHandle = { ...handle, expireAt: renewedExpireAt };
          try {
            await redis.set(redisKey, JSON.stringify(renewed), { EX: CACHE_TTL_SECONDS });
          } catch (err) {
            console.error('[document-cache] gemini redis renew-write error:', err);
          }
        }
        return { cacheName: handle.cacheName };
      }
    }
  } catch (err) {
    console.error('[document-cache] gemini redis read error (continuing to create):', err);
  }

  const handle = await createGeminiCache(text);
  if (!handle) return null;

  try {
    await redis.set(redisKey, JSON.stringify(handle), { EX: CACHE_TTL_SECONDS });
  } catch (err) {
    // Cache exists in Gemini but we couldn't persist the handle. Still usable
    // this turn; it just won't be deduped next turn.
    console.error('[document-cache] gemini redis write error (cache still usable this turn):', err);
  }

  return { cacheName: handle.cacheName };
}

// ────────────────────────────────────────────────────────────────────────────
// Anthropic-compatible backend (MiniMax-M3, Claude, etc.)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The Anthropic-compatible backend is *implicit*: the cache lives server-side
 * and is created when the request carries a `cache_control: ephemeral` block.
 * We don't talk to the model here — we just track in Redis that we expect a
 * cache to be alive for this document, so subsequent calls can keep marking
 * the same content and the server reuses the cache within its 5-min window.
 *
 * If the server already evicted the cache (e.g. > 5 min idle), the next call
 * simply creates a new one; the only "cost" is one extra cache_write charge.
 */
async function ensureAnthropicDocumentCache(params: {
  documentId: string;
  redis: RedisClient;
}): Promise<AnthropicCacheHandle | null> {
  const redisKey = agentDocumentCacheKey(params.documentId);

  try {
    const raw = await params.redis.get(redisKey);
    if (raw) {
      const handle = JSON.parse(raw) as CacheHandle;
      if (
        handle.type === 'anthropic' &&
        handle.documentId === params.documentId &&
        handle.expireAt > Date.now() + 30_000
      ) {
        // Slide the local handle forward — it represents the freshness of the
        // server-side cache as far as we're willing to trust it. Unlike the
        // Gemini backend (which makes an HTTP PATCH to renew), this is just a
        // Redis SET, so we always do it: even within the same tick a renew
        // bumps expireAt and is a no-op semantically.
        const renewed: AnthropicCacheHandle = {
          ...handle,
          expireAt: Date.now() + CACHE_TTL_SECONDS * 1000
        };
        try {
          await params.redis.set(redisKey, JSON.stringify(renewed), { EX: CACHE_TTL_SECONDS });
        } catch (err) {
          console.error('[document-cache] anthropic redis renew-write error:', err);
        }
        return renewed;
      }
    }
  } catch (err) {
    console.error('[document-cache] anthropic redis read error (continuing to create handle):', err);
  }

  const handle: AnthropicCacheHandle = {
    type: 'anthropic',
    documentId: params.documentId,
    expireAt: Date.now() + CACHE_TTL_SECONDS * 1000
  };

  try {
    await params.redis.set(redisKey, JSON.stringify(handle), { EX: CACHE_TTL_SECONDS });
  } catch (err) {
    console.error('[document-cache] anthropic redis write error (handle not persisted):', err);
  }

  return handle;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Release the document caches (and their Redis handles) for a set of
 * documents — called when the conversation that owns them is deleted, so
 * storage stops being billed for material of a chat that no longer exists.
 * Best-effort: failures are logged and never propagate.
 *
 * - Gemini: explicitly DELETE the cachedContent.
 * - Anthropic-compatible: the server-side cache expires on its own TTL; we
 *   just clear the local Redis handle.
 */
export async function releaseDocumentCaches(documentIds: string[], redis: RedisClient): Promise<void> {
  for (const documentId of documentIds) {
    const redisKey = agentDocumentCacheKey(documentId);
    try {
      const raw = await redis.get(redisKey);
      if (raw) {
        const handle = JSON.parse(raw) as CacheHandle;
        if (handle.type === 'gemini' && handle.cacheName) {
          await deleteGeminiCache(handle.cacheName);
        }
        // Anthropic: nothing to delete on the server; the handle is local-only.
      }
      await redis.del(redisKey);
    } catch (err) {
      console.error(`[document-cache] release error for document ${documentId}:`, err);
    }
  }
}

/**
 * Public-facing cache status for the Sources panel. Tells the UI whether the
 * document is currently cached and how much time is left on the handle so the
 * user can see at a glance which sources are "hot" (will hit cache on the
 * next chat turn) vs "cold" (will rebuild and pay full input price).
 */
export interface DocumentCacheStatus {
  documentId: string;
  cached: boolean;
  /** Which provider's cache the handle was created against. null when there's
   * no live handle. */
  provider: 'gemini' | 'anthropic' | null;
  /** ISO string. null when not cached. */
  expireAt: string | null;
  /** Seconds until the handle expires. Negative means expired. null when
   * not cached. */
  secondsRemaining: number | null;
}

export async function getDocumentCacheStatus(
  documentId: string,
  redis: RedisClient
): Promise<DocumentCacheStatus> {
  const handle = await readCacheHandle(documentId, redis);
  if (!handle) {
    return { documentId, cached: false, provider: null, expireAt: null, secondsRemaining: null };
  }

  const secondsRemaining = Math.round((handle.expireAt - Date.now()) / 1000);
  const cached = secondsRemaining > 30; // 30s slack so we don't report "cached" right at expiry
  return {
    documentId,
    cached,
    provider: handle.type,
    expireAt: new Date(handle.expireAt).toISOString(),
    secondsRemaining: Math.max(0, secondsRemaining)
  };
}

async function readCacheHandle(documentId: string, redis: RedisClient): Promise<CacheHandle | null> {
  try {
    const raw = await redis.get(agentDocumentCacheKey(documentId));
    if (!raw) return null;
    return JSON.parse(raw) as CacheHandle;
  } catch {
    return null;
  }
}

/**
 * Force-rebuild a cache handle for the document. Equivalent to calling
 * resolveDocumentCache() at chat time: drops any existing handle and creates
 * a fresh one on the next chat turn. The actual server-side cache (Gemini
 * cachedContent or Anthropic's implicit cache_control) is created lazily when
 * the agent actually sends a request — we just clear our handle so the next
 * chat rebuilds it.
 */
export async function refreshDocumentCache(
  documentId: string,
  redis: RedisClient
): Promise<DocumentCacheStatus> {
  // Drop the existing handle. For Gemini this also DELETEs the server-side
  // cachedContent so we don't keep paying for storage. For Anthropic the
  // server cache expires on its own TTL; we just clear our local handle.
  await releaseDocumentCaches([documentId], redis);

  // Create a fresh handle on the way out — the Sources UI needs to render
  // the new "cached" badge immediately without forcing a chat turn first.
  const cached = await ensureAnthropicDocumentCache({ documentId, redis });
  if (!cached) {
    return { documentId, cached: false, provider: null, expireAt: null, secondsRemaining: null };
  }

  return getDocumentCacheStatus(documentId, redis);
}

/**
 * Per-document result returned by reconcileCourseSourceCache — used by the
 * Sources panel to show the user which sources were rebuilt and why.
 */
export interface ReconcileResult {
  documentId: string;
  /** What we did with the cache for this document. */
  action: 'kept' | 'rebuilt' | 'released' | 'skipped';
  /** Reason the action was taken; null when action === 'kept'. */
  reason: string | null;
  /** Status after the reconcile pass (null when action === 'released'). */
  status: DocumentCacheStatus | null;
}

/**
 * Reconcile the cache state for every document in a course.
 *
 * The auto-sync sub-agent: keeps the cache handle set in sync with the
 * document set, and rebuilds handles that have gone stale or whose backing
 * text has been edited out-of-band. Idempotent, defensive, and best-effort —
 * every step has its own try/catch so one bad document can't poison the
 * whole pass.
 *
 * Trigger points (Phase 4):
 *   - On GET /agent/documents — the dashboard renders "reconciling…" while
 *     this runs in the background, then refreshes the badges.
 *   - On POST /agent/documents/reconcile — explicit refresh button (also
 *     exposed to the chat panel via the same `loadCourseSources` flow).
 *   - On upload/delete — handled inline today (no need for a separate pass).
 *
 * Reconciliation policy per document:
 *   - No handle in Redis             → create one (rebuilt/reason: no_handle)
 *   - Handle expired                 → create one (rebuilt/reason: expired)
 *   - Handle valid + text unchanged  → keep (kept)
 *   - Handle valid + text changed    → rebuild (rebuilt/reason: text_updated)
 *   - Document too small for cache   → release any leftover handle
 *     (skipped if there was nothing to release)
 */
export async function reconcileCourseSourceCache(
  documents: Array<{ id: string; text: string; updatedAt?: string }>,
  redis: RedisClient
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];

  for (const doc of documents) {
    try {
      const result = await reconcileOneDocument(doc, redis);
      results.push(result);
    } catch (err) {
      console.error(`[document-cache] reconcile error for ${doc.id}:`, err);
      // Best-effort: surface a 'skipped' result so the UI can show it.
      results.push({ documentId: doc.id, action: 'skipped', reason: 'error', status: null });
    }
  }

  return results;
}

async function reconcileOneDocument(
  doc: { id: string; text: string; updatedAt?: string },
  redis: RedisClient
): Promise<ReconcileResult> {
  const eligibility = classifyDocumentForCache(doc.text);
  const existingHandle = await readCacheHandle(doc.id, redis);

  // Document too small to cache → drop any handle we may have left over.
  if (eligibility === 'too_small' || eligibility === 'over_limit') {
    if (existingHandle) {
      await releaseDocumentCaches([doc.id], redis);
      return { documentId: doc.id, action: 'released', reason: eligibility, status: null };
    }
    return { documentId: doc.id, action: 'skipped', reason: eligibility, status: null };
  }

  // No handle at all → create one.
  if (!existingHandle) {
    const fresh = await ensureAnthropicDocumentCache({ documentId: doc.id, redis });
    if (!fresh) {
      return { documentId: doc.id, action: 'skipped', reason: 'handle_create_failed', status: null };
    }
    return {
      documentId: doc.id,
      action: 'rebuilt',
      reason: 'no_handle',
      status: await getDocumentCacheStatus(doc.id, redis)
    };
  }

  // Handle exists. If it's expired, rebuild.
  if (existingHandle.expireAt <= Date.now()) {
    await releaseDocumentCaches([doc.id], redis);
    const fresh = await ensureAnthropicDocumentCache({ documentId: doc.id, redis });
    if (!fresh) {
      return { documentId: doc.id, action: 'skipped', reason: 'handle_create_failed', status: null };
    }
    return {
      documentId: doc.id,
      action: 'rebuilt',
      reason: 'expired',
      status: await getDocumentCacheStatus(doc.id, redis)
    };
  }

  // Handle is live — assume it's still good. The text-updated check would
  // require storing a hash of the previous text in the handle, which we
  // don't do today; the explicit Refresh button handles that case.
  return {
    documentId: doc.id,
    action: 'kept',
    reason: null,
    status: await getDocumentCacheStatus(doc.id, redis)
  };
}

export interface ResolvedDocumentCache {
  /** Spread into `streamText({ providerOptions })`. Provider-specific shape. */
  providerOptions?: Record<string, unknown>;
  /** When set, the caller should exclude this document from the inlined context. */
  excludeDocumentId?: string;
  /** True when the document exceeds MAX_CACHE_CHARS — caller surfaces a cap notice. */
  overLimit?: boolean;
}

/**
 * Decide whether the CURRENT document should be served from an explicit cache,
 * and if so ensure the cache exists. Returns provider-agnostic options the
 * caller spreads into `streamText({ providerOptions })`. Fully defensive: any
 * miss (disabled, wrong provider, small doc, no text, API failure) returns an
 * empty result and the caller inlines the document text as before.
 */
export async function resolveDocumentCache(params: {
  provider: AIProvider;
  currentDocumentId: string | undefined;
  userId: string;
  redis: RedisClient;
}): Promise<ResolvedDocumentCache> {
  const { provider, currentDocumentId, userId, redis } = params;

  if (!isDocumentCacheEnabled() || !currentDocumentId) return {};

  // Only the providers we know how to cache. Others fall back to inline.
  const cacheableProviders: AIProvider[] = [
    AIProvider.GOOGLE,
    AIProvider.ANTHROPIC,
    AIProvider.MINIMAX
  ];
  if (!cacheableProviders.includes(provider)) return {};

  const text = await getDocumentText(currentDocumentId, userId, redis);
  const eligibility = classifyDocumentForCache(text);

  if (eligibility === 'over_limit') {
    // Policy: at 400k tokens the course's material is full — inline (truncated
    // upstream) and surface a warning so the instructor starts a separate course.
    return { overLimit: true };
  }

  if (eligibility === 'too_small') return {};

  if (provider === AIProvider.GOOGLE) {
    const cache = await ensureGeminiDocumentCache({ documentId: currentDocumentId, text: text!, redis });
    if (!cache) return {};
    return {
      providerOptions: { google: { cachedContent: cache.cacheName } },
      excludeDocumentId: currentDocumentId
    };
  }

  // Anthropic-compatible (MiniMax, Claude).
  //
  // CRITICAL: unlike the Gemini backend (which stores the document in a separate
  // server-side `cachedContent` resource and references it by name), the
  // Anthropic-compatible backend has NO standalone cache resource. The "cache"
  // here is just a `cache_control: ephemeral` hint attached to a content block
  // in the request — MiniMax then caches THAT BLOCK's tokens on its end and
  // bills them at ~10% on subsequent reads.
  //
  // Implication: the document text MUST remain inline (so it can be cached).
  // Setting `excludeDocumentId` would remove the document from the prompt
  // entirely, leaving MiniMax to cache only the system prompt + user message
  // (with no PDF inside) — and the agent would then see no document at all.
  //
  // The caller's streamText() also tags the system message + last user turn
  // with cache_control, so the cached prefix is: system + context-with-PDF +
  // user-message. On the next turn within the TTL window the PDF block is
  // served from cache at ~10% cost.
  const cache = await ensureAnthropicDocumentCache({ documentId: currentDocumentId, redis });
  if (!cache) return {};
  return {
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
  };
}

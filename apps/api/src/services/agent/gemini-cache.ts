import { resolveModelName, AIProvider } from '@cio/ai-assistant';
import { agentDocumentGeminiCacheKey } from '@api/utils/redis/key-generators';
import { getDocumentText } from '@api/services/agent/document';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * Gemini explicit context caching (Capa 2b).
 *
 * The AI SDK only *references* a cache (providerOptions.google.cachedContent =
 * "cachedContents/xyz"); it does NOT create one. This module manages the cache
 * lifecycle directly against the Gemini REST API and dedups by documentId in
 * Redis so a large document is uploaded to the cache ONCE and then referenced at
 * ~10% input cost across every turn of a course build.
 *
 * Design guarantees:
 * - **Defensive**: every failure path returns null and lets the caller fall back
 *   to inlining the document text. Caching must NEVER block or break generation.
 * - **Opt-in**: only runs when GEMINI_EXPLICIT_CACHE=true, the provider is Google,
 *   and the document is large enough to be worth it (see shouldCacheDocument).
 * - **Self-healing dedup**: the Redis handle TTL is aligned to the cache TTL, so a
 *   stale handle expires on its own; a 404 on reference just triggers a rebuild.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Cache TTL: 15 minutes, sliding. Build/edit sessions hammer the model in
 * bursts, so a short TTL renewed on use (see maybeRenewGeminiCache) keeps the
 * cache alive exactly while it's being worked with and lets it die minutes
 * after the instructor walks away — minimizing the per-hour storage meter.
 */
const CACHE_TTL_SECONDS = 900;

/** Renew the TTL when a use finds less than this much lifetime remaining. */
const CACHE_RENEW_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Minimum characters before explicit caching kicks in. Policy: activate at the
 * model minimum. Gemini 3.x Flash requires 4096 cached tokens (2.5 requires
 * 2048); at ~4 chars/token, 16k chars ≈ 4k tokens covers every supported model
 * without a rejected create call.
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
  cacheName: string; // "cachedContents/xxxx"
  model: string; // "models/gemini-..." the cache was created against
  expireAt: number; // epoch ms
}

/** Whether explicit caching is enabled by config. */
export function isGeminiCacheEnabled(): boolean {
  return process.env.GEMINI_EXPLICIT_CACHE === 'true';
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

/** Gemini requires the "models/<name>" form; resolveModelName returns the bare alias. */
function geminiModelResource(): string {
  const name = resolveModelName(AIProvider.GOOGLE);
  return name.startsWith('models/') ? name : `models/${name}`;
}

function apiKey(): string | null {
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
  const key = apiKey();
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
      console.error(`[gemini-cache] create failed: ${res.status} ${detail.slice(0, 300)}`);
      return null;
    }

    const body = (await res.json()) as { name?: string };
    if (!body.name) {
      console.error('[gemini-cache] create returned no name');
      return null;
    }

    return {
      cacheName: body.name,
      model,
      expireAt: Date.now() + CACHE_TTL_SECONDS * 1000
    };
  } catch (err) {
    console.error('[gemini-cache] create error:', err);
    return null;
  }
}

/** Delete a cache by name. Best-effort; failures are logged, never thrown. */
export async function deleteGeminiCache(cacheName: string): Promise<void> {
  const key = apiKey();
  if (!key) return;
  try {
    await fetch(`${GEMINI_API_BASE}/${cacheName}?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (err) {
    console.error('[gemini-cache] delete error:', err);
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

  const key = apiKey();
  if (!key) return handle.expireAt;

  try {
    const res = await fetch(`${GEMINI_API_BASE}/${handle.cacheName}?key=${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: `${CACHE_TTL_SECONDS}s` })
    });

    if (!res.ok) {
      console.error(`[gemini-cache] ttl renew failed: ${res.status}`);
      return handle.expireAt;
    }

    return Date.now() + CACHE_TTL_SECONDS * 1000;
  } catch (err) {
    console.error('[gemini-cache] ttl renew error:', err);
    return handle.expireAt;
  }
}

/**
 * Get (or lazily create) the Gemini cache handle for a document. Dedups on
 * documentId via Redis: an existing, non-expired, same-model handle is reused;
 * otherwise a new cache is created and the handle stored with a TTL aligned to
 * the cache. Returns null when disabled/unconfigured/failed — caller inlines.
 */
export async function ensureGeminiDocumentCache(params: {
  documentId: string;
  text: string;
  redis: RedisClient;
}): Promise<{ cacheName: string } | null> {
  const { documentId, text, redis } = params;

  if (!isGeminiCacheEnabled() || !apiKey()) return null;

  const model = geminiModelResource();
  const redisKey = agentDocumentGeminiCacheKey(documentId);

  // Reuse an existing handle when present, not expired, and same model. A model
  // change (GOOGLE_MODEL edited) invalidates the cache — rebuild against the new
  // one. On reuse, slide the TTL forward when it's close to expiring.
  try {
    const raw = await redis.get(redisKey);
    if (raw) {
      const handle = JSON.parse(raw) as GeminiCacheHandle;
      if (handle.cacheName && handle.model === model && handle.expireAt > Date.now() + 30_000) {
        const renewedExpireAt = await maybeRenewGeminiCache(handle);
        if (renewedExpireAt !== handle.expireAt) {
          const renewed: GeminiCacheHandle = { ...handle, expireAt: renewedExpireAt };
          try {
            await redis.set(redisKey, JSON.stringify(renewed), { EX: CACHE_TTL_SECONDS });
          } catch (err) {
            console.error('[gemini-cache] redis renew-write error:', err);
          }
        }
        return { cacheName: handle.cacheName };
      }
    }
  } catch (err) {
    console.error('[gemini-cache] redis read error (continuing to create):', err);
  }

  const handle = await createGeminiCache(text);
  if (!handle) return null;

  try {
    await redis.set(redisKey, JSON.stringify(handle), { EX: CACHE_TTL_SECONDS });
  } catch (err) {
    // Cache exists in Gemini but we couldn't persist the handle. Still usable this
    // turn; it just won't be deduped next turn (worst case: a second cache created).
    console.error('[gemini-cache] redis write error (cache still usable this turn):', err);
  }

  return { cacheName: handle.cacheName };
}

/**
 * Release the Gemini caches (and their Redis handles) for a set of documents —
 * called when the conversation that owns them is deleted, so storage stops
 * being billed for material of a chat that no longer exists. Best-effort:
 * failures are logged and never propagate (the cache would die by TTL anyway).
 */
export async function releaseDocumentCaches(documentIds: string[], redis: RedisClient): Promise<void> {
  for (const documentId of documentIds) {
    const redisKey = agentDocumentGeminiCacheKey(documentId);
    try {
      const raw = await redis.get(redisKey);
      if (raw) {
        const handle = JSON.parse(raw) as GeminiCacheHandle;
        if (handle.cacheName) await deleteGeminiCache(handle.cacheName);
      }
      await redis.del(redisKey);
    } catch (err) {
      console.error(`[gemini-cache] release error for document ${documentId}:`, err);
    }
  }
}

/**
 * Decide whether the CURRENT document should be served from a Gemini explicit
 * cache, and if so ensure the cache exists. Returns the cache name to reference
 * and the document id to exclude from inline context. Fully defensive: any
 * miss (disabled, wrong provider, small doc, no text, API failure) returns an
 * empty result and the caller inlines the document text as before.
 */
export async function resolveDocumentCache(params: {
  provider: AIProvider;
  currentDocumentId: string | undefined;
  userId: string;
  redis: RedisClient;
}): Promise<{ cachedContentName?: string; excludeDocumentId?: string; overLimit?: boolean }> {
  const { provider, currentDocumentId, userId, redis } = params;

  // Explicit caching is a Gemini feature; other providers keep inlining.
  if (provider !== AIProvider.GOOGLE) return {};
  if (!currentDocumentId || !isGeminiCacheEnabled() || !apiKey()) return {};

  const text = await getDocumentText(currentDocumentId, userId, redis);
  const eligibility = classifyDocumentForCache(text);

  if (eligibility === 'over_limit') {
    // Policy: at 400k tokens the course's material is full — inline (truncated
    // upstream) and surface a warning so the instructor starts a separate course.
    return { overLimit: true };
  }

  if (eligibility === 'too_small') return {};

  const cache = await ensureGeminiDocumentCache({ documentId: currentDocumentId, text: text!, redis });
  if (!cache) return {}; // creation failed → inline fallback

  return { cachedContentName: cache.cacheName, excludeDocumentId: currentDocumentId };
}

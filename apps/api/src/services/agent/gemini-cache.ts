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

/** Cache TTL. 1h matches the document Redis TTL and covers most build loops. */
const CACHE_TTL_SECONDS = 3600;

/**
 * Minimum characters of document text before explicit caching is worth the
 * create + hourly-storage overhead. Small docs re-sent inline are cheaper than a
 * cache. ~50k chars ≈ 12k tokens — comfortably above Gemini's 2048-token floor
 * and large enough that re-sending it every turn actually hurts.
 */
export const MIN_CACHE_DOCUMENT_CHARS = 50_000;

interface GeminiCacheHandle {
  cacheName: string; // "cachedContents/xxxx"
  model: string; // "models/gemini-..." the cache was created against
  expireAt: number; // epoch ms
}

/** Whether explicit caching is enabled by config. */
export function isGeminiCacheEnabled(): boolean {
  return process.env.GEMINI_EXPLICIT_CACHE === 'true';
}

/** Whether a given document is large enough to justify explicit caching. */
export function shouldCacheDocument(text: string | undefined | null): boolean {
  return !!text && text.length >= MIN_CACHE_DOCUMENT_CHARS;
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
  // change (GOOGLE_MODEL edited) invalidates the cache — rebuild against the new one.
  try {
    const raw = await redis.get(redisKey);
    if (raw) {
      const handle = JSON.parse(raw) as GeminiCacheHandle;
      if (handle.cacheName && handle.model === model && handle.expireAt > Date.now() + 30_000) {
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
}): Promise<{ cachedContentName?: string; excludeDocumentId?: string }> {
  const { provider, currentDocumentId, userId, redis } = params;

  // Explicit caching is a Gemini feature; other providers keep inlining.
  if (provider !== AIProvider.GOOGLE) return {};
  if (!currentDocumentId || !isGeminiCacheEnabled() || !apiKey()) return {};

  const text = await getDocumentText(currentDocumentId, userId, redis);
  if (!shouldCacheDocument(text)) return {};

  const cache = await ensureGeminiDocumentCache({ documentId: currentDocumentId, text: text!, redis });
  if (!cache) return {}; // creation failed → inline fallback

  return { cachedContentName: cache.cacheName, excludeDocumentId: currentDocumentId };
}

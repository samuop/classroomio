import { AIProvider } from '@cio/ai-assistant';
import {
  agentDocumentCacheKey,
  agentDocumentCacheKeyByContent
} from '@api/utils/redis/key-generators';
import { getDocumentText } from '@api/services/agent/document';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * Document-level prompt caching for the AI agent.
 *
 * When an instructor attaches a large document to a course build, the agent
 * re-sends that material on every chat turn. Caching lets the provider serve
 * it at a fraction of the input price.
 *
 * How each provider gets there is NOT symmetric:
 *
 *  - **Anthropic-compatible (MiniMax-M3, Claude)**: we ask, with a
 *    `cache_control: { type: "ephemeral" }` hint on a system / message block.
 *    The server decides and manages the cache; we never create a resource.
 *
 *  - **Google (Gemini)**: caching is *automatic*. Gemini matches the request
 *    prefix against what it already processed and bills the overlap at the
 *    cached rate with nothing asked for and nothing to manage. Measured on
 *    `gemini-3.5-flash-lite` with this agent's request shape (stable system
 *    prompt + source pack + growing transcript, ~53k tokens):
 *
 *        turn 1  prompt 53065  cached     0   0%   ← always a miss, it's new
 *        turn 2  prompt 53094  cached 49102  92%
 *        turn 3  prompt 53130  cached 49095  92%
 *        turn 4  prompt 53164  cached 49088  92%
 *
 * **Gemini's explicit cache (`cachedContents`) is deliberately NOT used**, and
 * this is the trap to remember if someone reaches for it again. The API refuses
 * to combine a cached handle with a request that carries tools:
 *
 *     400 CachedContent can not be used with GenerateContent request setting
 *         system_instruction, tools or tool_config.
 *
 * Our agent always sends both a system prompt and ~26 tools, so referencing a
 * `cachedContents` handle fails EVERY teacher turn — verified against the live
 * API, not inferred. Moving system+tools inside the cache is what the error
 * suggests, and it does work, but it welds the cache to one exact prompt
 * version and tool set (which changes per phase, plan vs build) and forces the
 * request to omit fields the AI SDK always sends. The automatic cache above
 * gives a better discount over a *wider* prefix, for free, with no resource to
 * create, renew, bill or leak. So the document stays inline for Google.
 *
 * What this module still does, for both providers:
 *  - **Decides eligibility** (see classifyDocumentForCache) and surfaces the
 *    400k-token material cap to the instructor.
 *  - **Records evidence** of cached reads the provider actually billed, which
 *    is what the Sources panel badge reports.
 *
 * Design guarantees:
 *  - **Defensive**: every failure path returns null/{} and lets the caller
 *    fall back to inlining. Caching must NEVER block or break generation.
 *  - **Opt-in**: only runs when DOCUMENT_CACHE_ENABLED=true (or the legacy
 *    GEMINI_EXPLICIT_CACHE=true).
 *  - **Never fabricated**: a handle in Redis means the provider billed us for
 *    cached reads, never that we hope it did.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * How long a recorded cache observation stays worth showing: 1 hour, matching
 * the `cacheControl: { ttl: '1h' }` we actually request on the cached blocks.
 *
 * This was 300s, on the assumption that MiniMax evicts after the standard
 * 5-minute Anthropic window. Production data says otherwise — a turn at 05:25
 * read 110,464 cached tokens **19.8 minutes** after the previous turn, and no
 * miss in the sample has the shape of an expiry (every `cacheRead = 0` row is a
 * new conversation sending a fresh prefix). The short TTL made the Sources badge
 * go dark while the cache was demonstrably still live.
 *
 * It is a retention window for *evidence*, not a claim about the provider's
 * cache: the status object reports when the read was observed and how many
 * tokens it covered, so the UI states a fact with its age instead of predicting
 * a remaining lifetime we cannot actually see. That holds for Gemini too — its
 * automatic cache is no more inspectable than MiniMax's.
 */
const OBSERVED_CACHE_TTL_SECONDS = 3600;

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

/**
 * A `cachedContents` lease this code used to create before the tools conflict
 * documented above was found. No new ones are ever written; the shape survives
 * only so `releaseDocumentCaches` can still DELETE a leftover from an older
 * deploy instead of paying its storage until Google expires it.
 */
interface LegacyGeminiLeaseHandle {
  type: 'gemini';
  cacheName: string; // "cachedContents/xxxx"
  model: string;
  expireAt: number; // epoch ms
}

/**
 * Evidence that the provider served cached tokens for a document's material.
 * Written only by `recordObservedCacheHit` from observed usage — never
 * speculatively. Neither provider exposes an endpoint to query cache state
 * (Gemini's automatic cache is as opaque as MiniMax's), so a billed read is
 * the only signal either of them gives us.
 */
interface ObservedCacheHandle {
  type: 'observed';
  documentId: string;
  /** Which provider served the cached tokens. */
  provider: 'gemini' | 'anthropic';
  /** Optional: when the handle is shared across users via contentHash. */
  courseId?: string;
  contentHash?: string;
  /** Epoch ms of the chat turn whose usage reported the cached read. */
  observedAt?: number;
  /** cacheReadTokens the provider billed on that turn. */
  lastCacheReadTokens?: number;
  expireAt: number; // epoch ms
}

type CacheHandle = LegacyGeminiLeaseHandle | ObservedCacheHandle;

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
// Legacy Gemini lease cleanup
// ────────────────────────────────────────────────────────────────────────────

function geminiApiKey(): string | null {
  return process.env.GOOGLE_API_KEY || null;
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

// ────────────────────────────────────────────────────────────────────────────
// Observed cache reads (the only thing either provider lets us know)
// ────────────────────────────────────────────────────────────────────────────
/**
 * **Neither provider exposes a way to query cache state.** MiniMax has no
 * `cachedContents` resource and no status endpoint — you attach
 * `cache_control: ephemeral` and the server decides. Gemini's automatic cache
 * is matched per request against a prefix we never named. In both cases the
 * only ground truth is `usage.inputTokenDetails.cacheReadTokens > 0` coming
 * back on a real turn.
 *
 * So a handle in Redis means exactly one thing:
 *
 *   "the provider billed us for cached reads of this material at `observedAt`"
 *
 * It is written ONLY here, from observed usage. Nothing else may fabricate one.
 * An earlier implementation created handles speculatively (on chat, on
 * reconcile, on refresh), which made the Sources panel light its "cached" badge
 * merely because the panel had been opened — asserting a provider-side cache
 * that had never been requested, let alone confirmed. See
 * knowledge/minimax-integration.md §5.
 *
 * Multi-user sharing: when `courseId` + `contentHash` are known the handle is
 * keyed on (courseId, contentHash) so two users who uploaded the same PDF to
 * the same course read one handle. Falls back to the per-document key for
 * legacy rows whose `content_hash` is NULL.
 */
export async function recordObservedCacheHit(params: {
  documentId: string;
  provider: 'gemini' | 'anthropic';
  courseId?: string;
  contentHash?: string;
  cacheReadTokens: number;
  redis: RedisClient;
}): Promise<ObservedCacheHandle | null> {
  // No confirmed read → no handle. A cache MISS (the first turn, always) must
  // not light the badge: the cached prefix may or may not have been stored,
  // and MiniMax frequently reports cacheWriteTokens=0 even when it did store
  // it, so a write count cannot be used as evidence either.
  if (!(params.cacheReadTokens > 0)) return null;

  const key =
    params.courseId && params.contentHash
      ? agentDocumentCacheKeyByContent(params.courseId, params.contentHash)
      : agentDocumentCacheKey(params.documentId);

  const handle: ObservedCacheHandle = {
    type: 'observed',
    documentId: params.documentId,
    provider: params.provider,
    courseId: params.courseId,
    contentHash: params.contentHash,
    observedAt: Date.now(),
    lastCacheReadTokens: params.cacheReadTokens,
    // How long this observation stays on display. Refreshed by every new hit, so
    // material that stops being read fades out on its own.
    expireAt: Date.now() + OBSERVED_CACHE_TTL_SECONDS * 1000
  };

  try {
    await params.redis.set(key, JSON.stringify(handle), { EX: OBSERVED_CACHE_TTL_SECONDS });
  } catch (err) {
    console.error('[document-cache] redis write error (cache observation not persisted):', err);
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
 * Nothing we write today has a server-side resource behind it, so this is
 * normally just a Redis delete. The one exception is a `cachedContents` lease
 * created by an older deploy: those bill storage by the hour, so if one is
 * still sitting in Redis we DELETE it at Google rather than wait it out.
 */
export async function releaseDocumentCaches(
  documentIds: string[],
  redis: RedisClient,
  courseId?: string,
  contentHash?: string
): Promise<void> {
  for (const documentId of documentIds) {
    const legacyKey = agentDocumentCacheKey(documentId);
    const sharedKey =
      courseId && contentHash ? agentDocumentCacheKeyByContent(courseId, contentHash) : null;
    try {
      for (const redisKey of [legacyKey, sharedKey].filter(Boolean) as string[]) {
        const raw = await redis.get(redisKey);
        if (raw) {
          const handle = JSON.parse(raw) as CacheHandle;
          if (handle.type === 'gemini' && handle.cacheName) {
            // Leftover lease from before the tools conflict was found. Stop
            // paying for it.
            await deleteGeminiCache(handle.cacheName);
          }
          // Observed handles are local-only: nothing to delete on the server.
        }
        await redis.del(redisKey);
      }
    } catch (err) {
      console.error(`[document-cache] release error for document ${documentId}:`, err);
    }
  }
}

/**
 * Public-facing cache status for the Sources panel.
 *
 * This reports an **observation, not a prediction**: when the provider last
 * billed us for cached reads covering this material, and how many tokens that
 * was. Neither provider has a status endpoint, so "~N minutes remaining" was
 * always a guess about someone else's eviction policy — and it guessed wrong
 * (it assumed a 5-minute window while reads were landing 20 minutes apart).
 *
 * `secondsRemaining` is therefore how long this *observation* stays on display,
 * never a lease. It used to be a real countdown for Gemini, back when we
 * created `cachedContents` resources; we don't anymore (see the module header),
 * so nothing here is a claim about the provider's own cache.
 */
export interface DocumentCacheStatus {
  documentId: string;
  cached: boolean;
  /** Which provider served the cached read. null when there's no live handle. */
  provider: 'gemini' | 'anthropic' | null;
  /** ISO string. null when not cached. */
  expireAt: string | null;
  /** Seconds until the observation stops being displayed. null when not cached. */
  secondsRemaining: number | null;
  /** When the provider last served cached tokens for this material (ISO) —
   *  the observed fact the badge states. */
  observedAt: string | null;
  /** Seconds since that observation. */
  observedSecondsAgo: number | null;
  /** cacheReadTokens the provider billed on that turn. */
  lastCacheReadTokens: number | null;
}

export async function getDocumentCacheStatus(
  documentId: string,
  redis: RedisClient,
  courseId?: string,
  contentHash?: string
): Promise<DocumentCacheStatus> {
  const handle = await readCacheHandle(documentId, redis, courseId, contentHash);
  if (!handle) {
    return {
      documentId,
      cached: false,
      provider: null,
      expireAt: null,
      secondsRemaining: null,
      observedAt: null,
      observedSecondsAgo: null,
      lastCacheReadTokens: null
    };
  }

  const secondsRemaining = Math.round((handle.expireAt - Date.now()) / 1000);
  const cached = secondsRemaining > 30; // 30s slack so we don't report "cached" right at expiry
  const observed = handle.type === 'observed' ? handle : null;
  const observedAt = observed?.observedAt ?? null;

  return {
    documentId,
    cached,
    // A legacy lease says which provider it belonged to by its own type.
    provider: observed ? observed.provider : 'gemini',
    expireAt: new Date(handle.expireAt).toISOString(),
    secondsRemaining: Math.max(0, secondsRemaining),
    observedAt: observedAt ? new Date(observedAt).toISOString() : null,
    observedSecondsAgo: observedAt ? Math.max(0, Math.round((Date.now() - observedAt) / 1000)) : null,
    lastCacheReadTokens: observed?.lastCacheReadTokens ?? null
  };
}

async function readCacheHandle(
  documentId: string,
  redis: RedisClient,
  courseId?: string,
  contentHash?: string
): Promise<CacheHandle | null> {
  try {
    // Prefer the shared (courseId, contentHash) key when available so multi-user
    // paths read from the same handle. Fall back to per-document for legacy.
    if (courseId && contentHash) {
      const sharedRaw = await redis.get(
        agentDocumentCacheKeyByContent(courseId, contentHash)
      );
      if (sharedRaw) return JSON.parse(sharedRaw) as CacheHandle;
    }
    const raw = await redis.get(agentDocumentCacheKey(documentId));
    if (!raw) return null;
    return JSON.parse(raw) as CacheHandle;
  } catch {
    return null;
  }
}

/**
 * Invalidate what we know about the document's cache. For Gemini this DELETEs
 * the server-side cachedContent so storage stops being billed. For the
 * Anthropic-compatible backend there is nothing to delete — the provider's cache
 * ages out on its own — so this only drops our evidence of it.
 *
 * It deliberately does NOT report `cached: true` on the way out. The badge can
 * only turn back on when a real chat turn reports cached reads again; claiming
 * otherwise is what made the indicator meaningless in the first place.
 */
export async function refreshDocumentCache(
  documentId: string,
  redis: RedisClient,
  courseId?: string,
  contentHash?: string
): Promise<DocumentCacheStatus> {
  await releaseDocumentCaches([documentId], redis, courseId, contentHash);

  return {
    documentId,
    cached: false,
    provider: null,
    expireAt: null,
    secondsRemaining: null,
    observedAt: null,
    observedSecondsAgo: null,
    lastCacheReadTokens: null
  };
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
  documents: Array<{ id: string; text: string; courseId?: string; contentHash?: string }>,
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
  doc: { id: string; text: string; courseId?: string; contentHash?: string },
  redis: RedisClient
): Promise<ReconcileResult> {
  const eligibility = classifyDocumentForCache(doc.text);
  const existingHandle = await readCacheHandle(doc.id, redis, doc.courseId, doc.contentHash);

  // Document too small to cache → drop any handle we may have left over.
  if (eligibility === 'too_small' || eligibility === 'over_limit') {
    if (existingHandle) {
      await releaseDocumentCaches([doc.id], redis, doc.courseId, doc.contentHash);
      return { documentId: doc.id, action: 'released', reason: eligibility, status: null };
    }
    return { documentId: doc.id, action: 'skipped', reason: eligibility, status: null };
  }

  // No handle at all → the material is eligible but the provider has not yet
  // served a cached read for it. We cannot create that state from here: only a
  // real chat turn can, and only the usage it reports proves it happened.
  // Reporting `skipped` keeps the badge dark until there is evidence.
  if (!existingHandle) {
    return { documentId: doc.id, action: 'skipped', reason: 'awaiting_cache_hit', status: null };
  }

  // Handle expired → the provider's 5-min window lapsed with no further reads.
  // Drop our stale evidence; the next cached read re-establishes it.
  if (existingHandle.expireAt <= Date.now()) {
    await releaseDocumentCaches([doc.id], redis, doc.courseId, doc.contentHash);
    return { documentId: doc.id, action: 'released', reason: 'expired', status: null };
  }

  // Handle is live — assume it's still good. The text-updated check would
  // require storing a hash of the previous text in the handle, which we
  // don't do today; the explicit Refresh button handles that case.
  return {
    documentId: doc.id,
    action: 'kept',
    reason: null,
    status: await getDocumentCacheStatus(doc.id, redis, doc.courseId, doc.contentHash)
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
 * Decide what, if anything, to ask the provider for regarding the CURRENT
 * document. Returns provider-agnostic options the caller spreads into
 * `streamText({ providerOptions })`. Fully defensive: any miss (disabled, wrong
 * provider, small doc, no text) returns an empty result and the caller inlines
 * the document text as before.
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
    // Nothing to ask for, and that is the correct behaviour — not a gap.
    //
    // Gemini caches the request prefix automatically, so the document earns its
    // discount by staying INLINE where the prefix can cover it (measured 92% of
    // a 53k-token prompt served cached from turn 2; see the module header).
    //
    // The alternative — a `cachedContents` handle via
    // `providerOptions.google.cachedContent` — is not merely unnecessary, it is
    // a hard 400: "CachedContent can not be used with GenerateContent request
    // setting system_instruction, tools or tool_config". This agent sends both
    // on every turn. Returning `{}` here is what keeps that request legal.
    //
    // Note there is deliberately NO `excludeDocumentId`: dropping the text from
    // the prompt would leave the agent with no document at all.
    return {};
  }

  // Anthropic-compatible (MiniMax, Claude).
  //
  // The "cache" here is just a `cache_control: ephemeral` hint attached to a
  // content block in the request — MiniMax then caches THAT BLOCK's tokens on
  // its end and bills them at ~10% on subsequent reads. Unlike Gemini, nothing
  // happens unless we ask.
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
  // No handle is written here. Asking for the cache is just the hint below;
  // whether a cache actually exists is only knowable from the usage numbers on
  // the response, which the caller feeds back via `recordObservedCacheHit`.
  return {
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
  };
}

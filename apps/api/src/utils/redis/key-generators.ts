/**
 * Key generation utilities for rate limiting
 * These functions help create consistent and secure rate limit keys
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createHash } from 'node:crypto';

function normalizeIp(value: string | null | undefined): string | null {
  const ip = value?.trim();

  if (!ip) return null;

  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

/**
 * Extract real client IP address considering various proxy headers
 */
export const extractClientIp = (c: Context): string => {
  // Priority order (most trusted first):
  // 1. CF-Connecting-IP (Cloudflare)
  // 2. X-Real-IP (nginx)
  // 3. X-Forwarded-For (standard, but can be spoofed)
  // 4. Connection IP (least reliable)

  const cfConnectingIp = normalizeIp(c.req.header('cf-connecting-ip'));
  const realIp = normalizeIp(c.req.header('x-real-ip'));
  const forwardedFor = c.req.header('x-forwarded-for');
  const connInfo = getConnInfo(c);
  const remoteAddress = normalizeIp(connInfo.remote.address);

  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  if (realIp) {
    return realIp;
  }

  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
    // The first IP is usually the original client
    return normalizeIp(forwardedFor.split(',')[0]) ?? 'unknown';
  }

  if (remoteAddress) {
    return remoteAddress;
  }

  // Fallback - this might be a proxy IP
  return 'unknown';
};

/**
 * Generate rate limit key for authenticated users
 */
export const userKeyGenerator = (c: Context): string => {
  const user = c.get('user'); // Already extracted by global middleware

  if (user?.id) {
    return `user:${user.id}`;
  }

  // No valid auth, fall back to IP
  return `ip:${extractClientIp(c)}`;
};

/**
 * Generate rate limit key for API keys
 */
export const apiKeyGenerator = (c: Context): string => {
  const apiKey = c.req.header('X-API-Key');

  if (apiKey) {
    return `api:${apiKey}`;
  }

  // Fallback to IP if no API key
  return `ip:${extractClientIp(c)}`;
};

/**
 * Generate rate limit key based on IP only
 */
export const ipKeyGenerator = (c: Context): string => {
  return `ip:${extractClientIp(c)}`;
};

/**
 * Generate rate limit key for specific endpoints
 */
export const endpointKeyGenerator =
  (endpoint: string) =>
  (c: Context): string => {
    const baseKey = userKeyGenerator(c);
    return `${baseKey}:${endpoint}`;
  };

// ─── Agent Document Keys ─────────────────────────────────────────────────────

/**
 * Redis key for storing extracted document text from AI assistant uploads.
 * TTL: 3600 seconds (1 hour).
 */
export const agentDocumentKey = (documentId: string): string => {
  return `agent:document:${documentId}`;
};

/**
 * Redis key for the cached short summary of an uploaded document, injected on
 * follow-up turns instead of the full text. TTL: 3600 seconds (1 hour).
 */
export const agentDocumentSummaryKey = (documentId: string): string => {
  return `agent:document:summary:${documentId}`;
};

/**
 * Redis key holding the Gemini explicit-cache handle for a large uploaded
 * document: JSON document-cache handle (gemini cachedContents or anthropic
 * cache_control). Lets us reference an existing cache across turns instead of
 * re-creating it. TTL is aligned to the cache's own TTL so a stale handle
 * self-evicts.
 *
 * NOTE: this key is keyed by `documentId`. With multi-user sharing on the
 * same course, prefer `agentDocumentCacheKeyByContent` (keyed by course +
 * content hash) so two users uploading the same PDF share one cache.
 * Kept as a fallback for single-user paths and for backward compat with
 * handles written before the migration.
 */
export const agentDocumentCacheKey = (documentId: string): string => {
  return `agent:document:cache:${documentId}`;
};

/**
 * Multi-user shared cache key. Same idea as `agentDocumentCacheKey` but scoped
 * to (courseId, contentHash) instead of documentId. Two users of the same
 * course uploading the same PDF (byte-for-byte) end up sharing one cache
 * entry — the second upload doesn't pay the cache-creation cost and the
 * second user's chat turns read at the cache_read price.
 *
 * Format: `agent:document:cache:course:<courseId>:<hash>`.
 * `hash` is the first 16 hex chars of SHA-256 (collision-resistant for our
 * purposes; full 64 chars is overkill for a Redis key length budget).
 */
export const agentDocumentCacheKeyByContent = (
  courseId: string,
  contentHash: string
): string => {
  // Trim hash defensively so callers can't blow up the key length.
  const safeHash = contentHash.replace(/[^a-f0-9]/gi, '').slice(0, 32);
  return `agent:document:cache:course:${courseId}:${safeHash}`;
};

/**
 * Rate limit key for agent chat endpoint (per-user).
 */
export const agentChatKeyGenerator = (c: Context): string => {
  const baseKey = userKeyGenerator(c);
  return `${baseKey}:agent:chat`;
};

/**
 * SHA-256 of the given string, returned as hex. Used by the Sources panel
 * to deduplicate uploads across users of the same course: if Alice and Bob
 * both upload the same PDF (byte-for-byte) to the same course, they end up
 * with the same content hash and the same shared cache handle.
 *
 * Empty input returns an empty hash so callers can use it before the upload
 * completes.
 */
export const computeContentHash = (text: string): string => {
  if (!text) return '';
  // Use Node's built-in crypto (sync — text is small enough; the PDF-parsed
  // text is usually <1MB and hashing 1MB takes ~5ms).
  return createHash('sha256').update(text, 'utf8').digest('hex');
};

// ─── Dashboard / analytics cache ─────────────────────────────────────────────

/**
 * Redis key for `getStudentLoginActivity` (day-of-week chart per org and window).
 * Value: JSON array `{ day, count }[]`. TTL: 24h.
 */
export function dashLoginActivityKey(orgId: string, days: number): string {
  return `dash:login-activity:${orgId}:${days}`;
}

/**
 * Rate limit key for agent upload endpoint (per-user).
 */
export const agentUploadKeyGenerator = (c: Context): string => {
  const baseKey = userKeyGenerator(c);
  return `${baseKey}:agent:upload`;
};

/**
 * Redis keys for engagement analytics read endpoints (landing-stats, funnel,
 * country breakdown, time-to-enrollment). Value: JSON.
 */
export function dashAnalyticsKey(route: string, orgId: string, days: number, extra?: string): string {
  const suffix = extra ? `:${extra}` : '';
  return `dash:analytics:${route}:${orgId}:${days}${suffix}`;
}

/** TTL for engagement analytics caches (10 min). */
export const DASH_ANALYTICS_TTL_SECONDS = 600;

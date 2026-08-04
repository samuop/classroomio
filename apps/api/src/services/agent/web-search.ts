import { createHash } from 'node:crypto';
import { AppError } from '@api/utils/errors';
import { env } from '@api/config/env';
import { redis, logRedisUnavailableOnce } from '@api/utils/redis/redis';
import { assertFetchableDocumentationUrl } from '@api/services/agent/fetch-url';

const JINA_SEARCH_ENDPOINT = 'https://s.jina.ai/';
const CACHE_TTL_SEC = 24 * 3600;
const MAX_RESULTS_PER_QUERY = 20;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Why search lives here and not inside the model.
 *
 * The deployment talks to MiniMax through the Anthropic-compatible shim
 * (`api.minimax.io/anthropic/v1`), which does NOT implement Anthropic's
 * server-side `web_search` tool — MiniMax only ships search as an MCP server for
 * its Coding Plan. Gemini's Search grounding would work but only when
 * CHAT_PROVIDER=google, and it returns synthesized prose rather than pages we can
 * persist as course sources, which is the whole point here.
 *
 * So search is ours. Jina is the natural home: `fetch_documentation_url` already
 * reads pages through `r.jina.ai`, and `s.jina.ai` is the same service, the same
 * key and the same bill.
 */
export const WEB_SEARCH_UNCONFIGURED =
  'Web search is not configured: JINA_API_KEY must be set on the API. Get a key at https://jina.ai.';

export function isWebSearchConfigured(): boolean {
  return Boolean(env.JINA_API_KEY);
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}

type CachedSearchPayload = {
  results: WebSearchResult[];
  searchedAt: string;
};

async function redisSafeGet(key: string): Promise<string | null> {
  try {
    if (!redis.isOpen) {
      return null;
    }

    return await redis.get(key);
  } catch (error) {
    logRedisUnavailableOnce('web-search cache get failed', error);

    return null;
  }
}

async function redisSafeSet(key: string, value: string, ttlSec: number): Promise<void> {
  try {
    if (!redis.isOpen) {
      return;
    }

    await redis.set(key, value, { EX: ttlSec });
  } catch (error) {
    logRedisUnavailableOnce('web-search cache set failed', error);
  }
}

/**
 * Hosts whose pages come back as furniture rather than content.
 *
 * Measured, not assumed. A research run on "colorimetría de pinturas de paredes"
 * returned nine pages, and four of them were these: both Facebook posts were a
 * login wall ("Log in / Forgotten account?"), the Instagram reel was the same,
 * and the YouTube page carried `Warning: Target URL returned error 401` followed
 * by comment counts and a description — no transcript. Together they were 44% of
 * the pages and, worse, they go into the source pack the model writes the course
 * from.
 *
 * The reader cannot fix this: the content is behind a login or is a video. The
 * cheapest place to deal with it is here, before a fetch is spent on it.
 */
const CONTENT_FREE_HOSTS = [
  'facebook.com',
  'instagram.com',
  'threads.net',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  'pinterest.com',
  'linkedin.com',
  'quora.com'
];

function isContentFreeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');

  return CONTENT_FREE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * Keeps only results we could actually read afterwards.
 *
 * `assertFetchableDocumentationUrl` is the same guard the reader uses (no
 * localhost, no private ranges, no cloud metadata hosts). Running it here means a
 * hostile search result is dropped at discovery time instead of becoming a failed
 * fetch — and it guarantees every URL this function hands back is one the reader
 * will accept.
 */
function keepFetchableResults(results: WebSearchResult[]): WebSearchResult[] {
  const out: WebSearchResult[] = [];

  for (const result of results) {
    try {
      const parsed = assertFetchableDocumentationUrl(result.url);

      if (isContentFreeHost(parsed.hostname)) {
        continue;
      }

      out.push(result);
    } catch {
      // Not reachable by the reader — drop it rather than fail the search.
    }
  }

  return out;
}

function parseJinaResults(payload: unknown): WebSearchResult[] {
  const data = (payload as { data?: unknown })?.data;

  if (!Array.isArray(data)) {
    return [];
  }

  const out: WebSearchResult[] = [];

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';

    if (!url) {
      continue;
    }

    out.push({
      url,
      title: typeof record.title === 'string' ? record.title.trim() : url,
      snippet: typeof record.description === 'string' ? record.description.trim() : ''
    });
  }

  return out;
}

/**
 * One query in, a ranked list of readable URLs out.
 *
 * **`X-Respond-With: no-content` is deliberate.** Jina will happily return each
 * result's full text in the same call, but then the page bypasses
 * `fetchDocumentationUrl` — and with it the 7-day cache, the SSRF guard, the
 * 150 KB truncation and the `<external_untrusted_document>` wrapper that keeps a
 * web page from reading as instructions to the model. Asking for links only keeps
 * exactly one code path that turns a URL into material, and makes the search call
 * cheap: Jina bills a flat 10k tokens per search regardless.
 */
export async function searchWeb(params: { query: string; limit?: number }): Promise<WebSearchResult[]> {
  const query = params.query.trim();

  if (!query) {
    throw new AppError('Search query is empty', 'INVALID_SEARCH_QUERY', 400);
  }

  if (!env.JINA_API_KEY) {
    // Named, not generic: this is the one failure the operator can fix, and the
    // person who sees it is usually that operator.
    throw new AppError(WEB_SEARCH_UNCONFIGURED, 'WEB_SEARCH_UNCONFIGURED', 503);
  }

  const limit = Math.min(Math.max(params.limit ?? 10, 1), MAX_RESULTS_PER_QUERY);
  const cacheKey = `agent:web_search:${createHash('sha256').update(query.toLowerCase()).digest('hex')}`;
  const cachedRaw = await redisSafeGet(cacheKey);

  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedSearchPayload;

      return cached.results.slice(0, limit);
    } catch {
      // fall through and search again
    }
  }

  const url = `${JINA_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        Accept: 'application/json',
        'X-Respond-With': 'no-content'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new AppError('Failed to reach the search service', 'WEB_SEARCH_FAILED', 502);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    console.info('[search_web]', { query, status: response.status, detail: detail.slice(0, 200) });

    throw new AppError(`Search failed with status ${response.status}`, 'WEB_SEARCH_FAILED', 502);
  }

  const payload = await response.json().catch(() => null);
  const results = keepFetchableResults(parseJinaResults(payload));

  console.info('[search_web]', { query, status: response.status, results: results.length });

  await redisSafeSet(cacheKey, JSON.stringify({ results, searchedAt: new Date().toISOString() }), CACHE_TTL_SEC);

  return results.slice(0, limit);
}

/**
 * Runs several queries and merges them into one ranked list.
 *
 * Results are deduplicated by origin+pathname, so `example.com/a`, and
 * `example.com/a?utm_source=x` and `example.com/a#section` count once — search
 * engines return those variants constantly and each one would otherwise be
 * fetched, stored and billed as a separate source.
 *
 * Interleaved rather than concatenated: taking rank 1 from every query before
 * rank 2 keeps a single broad query from filling the whole budget with its own
 * long tail while a narrower query contributes nothing.
 */
export function mergeSearchResults(perQuery: WebSearchResult[][], limit: number): WebSearchResult[] {
  const seen = new Set<string>();
  const merged: WebSearchResult[] = [];
  const depth = Math.max(0, ...perQuery.map((results) => results.length));

  for (let rank = 0; rank < depth && merged.length < limit; rank += 1) {
    for (const results of perQuery) {
      if (merged.length >= limit) {
        break;
      }

      const result = results[rank];

      if (!result) {
        continue;
      }

      let key: string;

      try {
        const parsed = new URL(result.url);
        key = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
      } catch {
        key = result.url;
      }

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(result);
    }
  }

  return merged;
}

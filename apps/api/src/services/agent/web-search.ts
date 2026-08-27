import { createHash } from 'node:crypto';
import { generateText } from 'ai';
import { getWebSearchModel } from '@cio/ai-assistant';
import { AppError } from '@api/utils/errors';
import { redis, logRedisUnavailableOnce } from '@api/utils/redis/redis';
import { assertFetchableDocumentationUrl } from '@api/services/agent/fetch-url';

const CACHE_TTL_SEC = 24 * 3600;
const MAX_RESULTS_PER_QUERY = 20;
/**
 * Measured at 13s for a survey that ran seven searches and cited 22 pages. 25s
 * is room for a bad day; much more than that and a slow search would eat the
 * reading half of `RESEARCH_DEADLINE_MS` before the reader gets a turn.
 */
const SEARCH_TIMEOUT_MS = 25_000;
const REDIRECT_TIMEOUT_MS = 8_000;
const REDIRECT_CONCURRENCY = 8;
const MAX_SNIPPET_CHARS = 300;

/** The host every grounded citation arrives under. See `resolveGroundingRedirect`. */
const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

/**
 * Why search is Gemini's Grounding with Google Search, and what it does NOT do.
 *
 * Search used to run on `s.jina.ai`, chosen back when chat ran on MiniMax through
 * the Anthropic-compatible shim — an endpoint with no server-side search of its
 * own. Production has run on Gemini since 2026-08-10 (`CHAT_PROVIDER=google`), so
 * the reason for an outside search vendor is gone: grounding ships with the model
 * we already pay for, and its free tier (5.000 searches a month across Gemini
 * 3.x) covers this install several times over. Google's Custom Search JSON API
 * would have been the closer match to a plain search API, but it is closed to new
 * customers and stops serving on 2027-01-01 — a dead end to build on.
 *
 * What changed is only **discovery**: topic in, URLs out. Reading a page is still
 * `fetchDocumentationUrl` through `r.jina.ai`, and deliberately so. Gemini's
 * `url_context` tool can read a page too, but the text lands in the model's
 * context instead of coming back to us — and then there is nothing to store as a
 * source, nothing to cache for 7 days, nothing to wrap in
 * `<external_untrusted_document>`. Discovery is the only piece grounding can take
 * over without dismantling the rest.
 */
export const WEB_SEARCH_UNCONFIGURED =
  'Web search is not configured: GOOGLE_API_KEY must be set on the API. Get a key at https://aistudio.google.com/apikey.';

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_API_KEY);
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface GroundedSearchOutcome {
  /** The searches Gemini actually ran, as it reported them. */
  queries: string[];
  results: WebSearchResult[];
}

type CachedSearchPayload = GroundedSearchOutcome & {
  searchedAt: string;
};

type GroundingChunk = {
  web?: { uri?: string | null; title?: string | null } | null;
};

type GroundingSupport = {
  segment?: { text?: string | null } | null;
  groundingChunkIndices?: number[] | null;
};

type GroundingMetadata = {
  webSearchQueries?: string[] | null;
  groundingChunks?: GroundingChunk[] | null;
  groundingSupports?: GroundingSupport[] | null;
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
 *
 * It runs AFTER the redirect is resolved, never before: every grounded citation
 * arrives on the same Google host, so guarding the URL Gemini hands over would
 * only ever be checking Google. The address that matters is the one underneath.
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

/**
 * Turns a grounded citation into an address we can keep.
 *
 * Grounding never hands back the page's own URL. Every citation arrives as
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/<opaque>`, and the
 * accompanying title is usually the bare domain — there is no field carrying the
 * real address, which is a documented and long-standing complaint about the API.
 * Left alone, that URL is unusable for us twice over: the Sources panel would
 * show an opaque Google link instead of the page the teacher can open and check,
 * and the link expires, so a source saved today stops resolving later.
 *
 * One request per citation fixes it. `redirect: 'manual'` stops fetch from
 * following the hop and leaves the destination in the `Location` header, which is
 * exactly the string we want and costs no page download. A citation we cannot
 * resolve is dropped rather than stored: an address that expires is worse than a
 * missing source, because it looks like a source right up until someone clicks it.
 */
async function resolveGroundingRedirect(uri: string): Promise<string | null> {
  let parsed: URL;

  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  // Already a real address. The API has been asked to return these directly; if
  // it ever starts to, nothing here needs to change.
  if (parsed.hostname.toLowerCase() !== GROUNDING_REDIRECT_HOST) {
    return uri;
  }

  try {
    const response = await fetch(uri, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS)
    });
    const location = response.headers.get('location');

    // A 3xx carries no body, but an unread stream still holds the socket open.
    await response.body?.cancel().catch(() => undefined);

    if (!location) {
      return null;
    }

    return new URL(location, uri).href;
  } catch {
    return null;
  }
}

async function resolveAll(uris: string[]): Promise<(string | null)[]> {
  const resolved: (string | null)[] = new Array(uris.length).fill(null);
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next++;
      const uri = uris[index];

      if (uri === undefined) {
        return;
      }

      resolved[index] = await resolveGroundingRedirect(uri);
    }
  }

  const workers = Math.max(1, Math.min(REDIRECT_CONCURRENCY, uris.length));

  await Promise.all(Array.from({ length: workers }, worker));

  return resolved;
}

/**
 * The sentence Gemini wrote while citing each page, used as that page's snippet.
 *
 * Grounding has no snippet field — `groundingSupports` instead ties spans of the
 * answer back to the chunks that support them. Read from that direction it beats
 * a search-engine snippet: it is not the page's own blurb but a statement of what
 * the page actually contributed, which is precisely what the agent needs when it
 * decides which result is worth reading in full.
 */
export function collectSnippets(supports: GroundingSupport[], chunkCount: number): string[] {
  const snippets: string[] = new Array(chunkCount).fill('');

  for (const support of supports) {
    const text = support.segment?.text?.trim();

    if (!text) {
      continue;
    }

    for (const index of support.groundingChunkIndices ?? []) {
      const current = snippets[index];

      if (current === undefined || current.length >= MAX_SNIPPET_CHARS) {
        continue;
      }

      snippets[index] = current ? `${current} ${text}` : text;
    }
  }

  return snippets.map((snippet) => snippet.slice(0, MAX_SNIPPET_CHARS));
}

function pageKey(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * Deduplicates by origin+pathname, so a page cited three times in one answer is
 * one candidate. Grounding repeats a chunk once per supported span, so this is
 * the common case rather than the exception.
 */
function dedupeByPage(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];

  for (const result of results) {
    const key = pageKey(result.url);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(result);
  }

  return out;
}

/**
 * One grounded call in, a list of readable URLs out.
 *
 * `instruction` says what kind of pages are wanted and `prompt` says what about;
 * the queries themselves are Gemini's to write. That is the point of moving here:
 * research used to spend a separate model call turning a topic into three search
 * strings, and grounding does that inside the same request that runs them — the
 * queries it chose come back in `webSearchQueries`, so nothing is lost by not
 * writing them ourselves.
 *
 * The answer text is thrown away on purpose. What we keep are its citations,
 * because a course has to be built from pages a teacher can open and check, not
 * from a model's summary of pages.
 */
export async function groundedSearch(params: {
  instruction: string;
  prompt: string;
  limit?: number;
}): Promise<GroundedSearchOutcome> {
  const prompt = params.prompt.trim();

  if (!prompt) {
    throw new AppError('Search query is empty', 'INVALID_SEARCH_QUERY', 400);
  }

  const search = getWebSearchModel();

  if (!search) {
    // Named, not generic: this is the one failure the operator can fix, and the
    // person who sees it is usually that operator.
    throw new AppError(WEB_SEARCH_UNCONFIGURED, 'WEB_SEARCH_UNCONFIGURED', 503);
  }

  const limit = Math.min(Math.max(params.limit ?? 10, 1), MAX_RESULTS_PER_QUERY);
  const cacheKey = `agent:web_search:g:${createHash('sha256')
    .update(`${params.instruction} :: ${prompt.toLowerCase()}`)
    .digest('hex')}`;
  const cachedRaw = await redisSafeGet(cacheKey);

  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedSearchPayload;

      return { queries: cached.queries, results: cached.results.slice(0, limit) };
    } catch {
      // fall through and search again
    }
  }

  let providerMetadata: Record<string, unknown> | undefined;

  try {
    const generated = await generateText({
      model: search.model,
      // Provider-executed: Gemini runs the searches inside this one request, so
      // there is no tool round trip and no second step to wait for.
      tools: { google_search: search.searchTool },
      maxRetries: 1,
      maxOutputTokens: 2048,
      system: params.instruction,
      prompt,
      abortSignal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });

    providerMetadata = generated.providerMetadata as Record<string, unknown> | undefined;
  } catch (error) {
    console.info('[search_web]', {
      prompt: prompt.slice(0, 80),
      error: error instanceof Error ? error.message : error
    });

    throw new AppError('Failed to reach the search service', 'WEB_SEARCH_FAILED', 502);
  }

  const grounding = (providerMetadata?.google as { groundingMetadata?: GroundingMetadata } | undefined)
    ?.groundingMetadata;
  const chunks = grounding?.groundingChunks ?? [];
  const queries = (grounding?.webSearchQueries ?? []).filter((query): query is string => Boolean(query?.trim()));
  const snippets = collectSnippets(grounding?.groundingSupports ?? [], chunks.length);

  const cited = chunks
    .map((chunk, index) => ({
      uri: chunk.web?.uri?.trim() ?? '',
      // Grounding titles are usually the bare domain. Kept anyway: for research
      // the reader replaces it with the page's real title, and for the agent the
      // snippet is what carries the meaning.
      title: chunk.web?.title?.trim() ?? '',
      snippet: snippets[index] ?? ''
    }))
    .filter((entry) => entry.uri);

  const resolvedUrls = await resolveAll(cited.map((entry) => entry.uri));
  const resolved: WebSearchResult[] = [];

  cited.forEach((entry, index) => {
    const url = resolvedUrls[index];

    if (!url) {
      return;
    }

    resolved.push({ url, title: entry.title || url, snippet: entry.snippet });
  });

  const results = keepFetchableResults(dedupeByPage(resolved));

  console.info('[search_web]', {
    prompt: prompt.slice(0, 80),
    queries: queries.length,
    cited: cited.length,
    kept: results.length
  });

  await redisSafeSet(cacheKey, JSON.stringify({ queries, results, searchedAt: new Date().toISOString() }), CACHE_TTL_SEC);

  return { queries, results: results.slice(0, limit) };
}

/**
 * The agent's `search_web`: one query the model wrote, links back.
 *
 * The instruction asks for a cited list rather than an answer because the
 * citations ARE the result here — a chatty reply grounded in two pages returns
 * two URLs, and the agent is looking for material to read, not for prose.
 */
export async function searchWeb(params: { query: string; limit?: number }): Promise<WebSearchResult[]> {
  const { results } = await groundedSearch({
    instruction: [
      'You find reading material on the web. Search for pages that answer the request and',
      'list what each one covers, one short line per page, citing every line.',
      'Cover as many distinct, relevant pages as you can rather than elaborating on one.',
      'Prefer explanations, guides, documentation, standards and reference tables.',
      'Search in the SAME LANGUAGE as the request.'
    ].join(' '),
    prompt: params.query,
    limit: params.limit
  });

  return results;
}

/**
 * Runs several searches and merges them into one ranked list.
 *
 * Results are deduplicated by origin+pathname, so `example.com/a`, and
 * `example.com/a?utm_source=x` and `example.com/a#section` count once — search
 * engines return those variants constantly and each one would otherwise be
 * fetched, stored and billed as a separate source.
 *
 * Interleaved rather than concatenated: taking rank 1 from every search before
 * rank 2 keeps a single broad angle from filling the whole budget with its own
 * long tail while a narrower angle contributes nothing.
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

      const key = pageKey(result.url);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(result);
    }
  }

  return merged;
}

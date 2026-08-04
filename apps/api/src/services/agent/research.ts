import { generateText } from 'ai';
import { AIProvider, type AIProviderConfig, createModel, resolveModelName } from '@cio/ai-assistant';
import { MAX_DOCUMENT_TEXT_LENGTH } from '@cio/ai-assistant';
import { searchWeb, mergeSearchResults, type WebSearchResult } from '@api/services/agent/web-search';
import { fetchDocumentationUrl } from '@api/services/agent/fetch-url';
import {
  storeDraftDocument,
  storeUrlDocument,
  URL_SOURCE_MIME_TYPE,
  type ParsedDocument
} from '@api/services/agent/document';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * Research depth, chosen by the teacher on the course wizard.
 *
 * Deliberately a small closed set rather than a number: every page is a few
 * seconds of waiting and a slice of the source-pack budget, so the cost has to be
 * legible at the moment of choosing. "How many web pages should I read" is not a
 * question a teacher should have to answer in integers.
 */
export const RESEARCH_DEPTHS = ['quick', 'normal', 'deep'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

const PAGES_PER_DEPTH: Record<ResearchDepth, number> = {
  quick: 5,
  normal: 10,
  deep: 20
};

const QUERIES_PER_DEPTH: Record<ResearchDepth, number> = {
  quick: 2,
  normal: 3,
  deep: 4
};

/**
 * How many pages we read at once.
 *
 * Measured: nine pages at a concurrency of 5 took 60.7s, and production Nginx
 * has no `proxy_read_timeout` so the default 60s applies — the request was
 * already at the edge of a 504, and a deep run would have sailed past it. The
 * reader is slow per page, so the only lever is width. Jina's paid tiers allow
 * hundreds of requests a minute; 8 is comfortable and still polite.
 */
const FETCH_CONCURRENCY = 8;

/**
 * Hard stop for the whole harvest, under Nginx's 60s.
 *
 * Whatever has been read by then is returned instead of the request dying at the
 * gateway: eight pages in hand beat a 504 and nothing. Deep runs are the case
 * that hits this, which is why the depth control says "~20 pages" rather than
 * promising exactly twenty.
 */
const RESEARCH_DEADLINE_MS = 45_000;

/** A page that adds nothing but noise to a course. */
const MIN_USEFUL_CHARS = 400;

/**
 * Whether a fetched page carries prose or just furniture.
 *
 * Two failures look like success to the reader and were both observed on the
 * first real run:
 *
 *  - Jina returns 200 with `Warning: Target URL returned error 401` and then the
 *    page chrome, so a YouTube video became a "source" made of comment counts.
 *  - A login wall is a genuine page: Facebook and Instagram both came back as
 *    5-22 KB of "Log in / Sign Up" and navigation links.
 *
 * Length alone cannot tell these apart from an article — the Instagram reel was
 * larger than three of the good sources. What separates them is that almost all
 * of their bytes are links, so the prose left after stripping markdown link
 * syntax is what gets measured.
 */
export function readableProseLength(markdown: string): number {
  return markdown
    .replace(/<external_untrusted_document[^>]*>|<\/external_untrusted_document>/g, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*(Title|URL Source|Markdown Content|Published Time):.*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function isUnreadablePage(markdown: string): boolean {
  if (/Warning:\s*Target URL returned error\s*\d+/i.test(markdown)) {
    return true;
  }

  return readableProseLength(markdown) < MIN_USEFUL_CHARS;
}

export interface ResearchSource {
  documentId: string;
  title: string;
  url: string;
  chars: number;
}

export interface ResearchOutcome {
  queries: string[];
  sources: ResearchSource[];
  /** Pages that were found but could not be read. Reported, never fatal. */
  failedCount: number;
}

/**
 * Who the course is for. Optional, because research from the Sources panel is a
 * targeted top-up on an existing course and carries no audience of its own.
 */
export interface ResearchBrief {
  audience?: string;
  level?: 'intro' | 'intermediate' | 'advanced';
}

const LEVEL_GUIDANCE: Record<NonNullable<ResearchBrief['level']>, string> = {
  intro: 'Prefer introductory explanations over specialist literature.',
  intermediate: 'Prefer working, applied material over both beginner overviews and research papers.',
  advanced: 'Prefer specialist, technical and normative sources over introductory overviews.'
};

/**
 * The brief the planner reads.
 *
 * It used to receive the topic and nothing else, which made two very different
 * courses produce identical research: colorimetry for paint-shop staff wants
 * colour charts and how to advise a customer, the same words for formulation
 * chemists want spectrophotometry and standards. The audience is not decoration
 * here — it is most of what decides whether a page is useful.
 */
export function buildBriefPrompt(topic: string, brief: ResearchBrief): string {
  const lines = [`Course brief: ${topic.slice(0, 900)}`];

  if (brief.audience?.trim()) {
    lines.push(`Learners: ${brief.audience.trim().slice(0, 300)}`);
  }

  if (brief.level) {
    lines.push(LEVEL_GUIDANCE[brief.level]);
  }

  return lines.join('\n');
}

/**
 * Pulls the queries out of whatever shape the model answered in.
 *
 * One per line, tolerating the decorations models add unasked: bullets, numbering,
 * surrounding quotes, a "1." prefix, a stray heading. Anything that survives and
 * looks like a search phrase is a query.
 */
export function parseQueryLines(text: string, wanted: number): string[] {
  const out: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw
      .trim()
      .replace(/^[-*•\d.)\s]+/, '')
      .replace(/^["'«]|["'»]$/g, '')
      .trim();

    // Headings and commentary rather than a query.
    if (line.length < 8 || line.length > 200 || line.endsWith(':') || line.startsWith('#')) {
      continue;
    }

    if (!out.includes(line)) {
      out.push(line);
    }

    if (out.length >= wanted) {
      break;
    }
  }

  return out;
}

/**
 * Turns a course topic into the handful of searches a researcher would actually
 * run.
 *
 * One query is not enough: "colorimetría de pinturas de paredes" as a single
 * search returns paint-shop catalogues. Splitting it into the theory, the
 * practice and the standards is what makes the difference between a course built
 * from adverts and one built from material.
 *
 * The model is asked for queries in the same language as the topic — Spanish
 * material for a Spanish course is the whole point, and an English-only search
 * quietly changes what the course can be built from.
 */
export async function deriveSearchQueries(
  topic: string,
  depth: ResearchDepth,
  providerConfig: AIProviderConfig,
  brief: ResearchBrief = {}
): Promise<string[]> {
  const wanted = QUERIES_PER_DEPTH[depth];
  const model = createModel({
    ...providerConfig,
    model:
      providerConfig.provider === AIProvider.GOOGLE
        ? resolveModelName(AIProvider.GOOGLE)
        : undefined
  });

  try {
    // Plain text, one query per line — NOT generateObject.
    //
    // Structured output failed intermittently against MiniMax-M3 with
    // `NoObjectGeneratedError: the model did not return a response`: it is a
    // reasoning model behind an Anthropic-compatible shim, and the tool-call
    // round trip that generateObject needs comes back empty often enough to
    // matter. The cost was invisible and expensive — the run silently degraded
    // to searching the raw topic, which returned three pages where a plan
    // returned nine. Three short lines of text need no schema negotiation.
    const { text } = await generateText({
      model,
      maxRetries: 1,
      maxOutputTokens: 1024,
      system: [
        'You plan the web research for a training course.',
        `Write exactly ${wanted} web search queries that together cover the subject:`,
        'foundations and definitions, practical or applied material, and standards or',
        'reference tables where the subject has them.',
        'Write them in the SAME LANGUAGE as the brief.',
        // Measured failure: for a colorimetry course the planner wrote
        // "aplicación práctica de colorimetría…", the search engine read
        // "aplicación" as "app", and three of ten pages were listicles of phone
        // apps for repainting a room. Naming the trap is cheaper than filtering
        // its results, which sit on perfectly ordinary domains.
        'Aim at teaching and reference material: explanations, guides, standards, tables.',
        'Avoid wording a shop or an app store would match — no "app", "aplicación", "mejores",',
        '"top 10", "comprar", "precio", "opiniones", "descargar".',
        'Output ONE query per line, nothing else — no numbering, no quotes, no commentary.'
      ].join(' '),
      prompt: buildBriefPrompt(topic, brief)
    });

    const queries = parseQueryLines(text ?? '', wanted);

    return queries.length > 0 ? queries : [topic];
  } catch (error) {
    // A failed query plan must not cancel the research — searching the raw topic
    // is worse than a planned set, and far better than nothing.
    console.warn('[research] query planning failed, falling back to the raw topic:', error);

    return [topic];
  }
}

function toParsedDocument(page: { url: string; pageTitle: string; content: string }): ParsedDocument {
  const text = page.content.slice(0, MAX_DOCUMENT_TEXT_LENGTH);
  const hostname = (() => {
    try {
      return new URL(page.url).hostname;
    } catch {
      return page.url;
    }
  })();
  const title = page.pageTitle?.trim();
  // Same naming as storeUrlDocument, so a researched page and a page the teacher
  // pasted by hand are indistinguishable in the Sources panel — because they are.
  const fileName = title ? (title === hostname ? page.url : `${title} (${hostname})`) : page.url;

  return {
    text,
    fileName,
    mimeType: URL_SOURCE_MIME_TYPE,
    pageCount: null,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    textPreview: text.slice(0, 500),
    truncated: page.content.length > MAX_DOCUMENT_TEXT_LENGTH
  };
}

/**
 * Reads pages with a fixed number of workers and one shared deadline.
 *
 * A worker pool rather than fixed batches because the reader's per-page time
 * varies wildly: in batches, one slow page holds up the other seven and the whole
 * run pays for the worst case in every round. Workers pull the next URL as soon
 * as they are free, so the slow page costs only itself.
 */
/**
 * Persists one page, as a course source when there is a course and as a draft
 * when there is not.
 *
 * The wizard researches before the course exists, so its pages can only be
 * drafts (Redis), promoted on the first chat turn like an uploaded PDF. But
 * research started from a course that already exists has somewhere to put them
 * NOW, and putting them anywhere else would mean the Sources tab stays empty
 * until the teacher happens to send a message — with the material silently
 * expiring an hour later if they do not.
 */
async function persistPage(
  page: { url: string; pageTitle: string; content: string },
  parsed: ParsedDocument,
  params: { orgId: string; courseId?: string; conversationId?: string; userId: string; redis: RedisClient }
): Promise<string> {
  if (params.courseId && params.conversationId) {
    const stored = await storeUrlDocument({
      url: page.url,
      pageTitle: page.pageTitle,
      markdown: page.content,
      orgId: params.orgId,
      userId: params.userId,
      courseId: params.courseId,
      conversationId: params.conversationId,
      redis: params.redis
    });

    return stored.documentId;
  }

  const { documentId } = await storeDraftDocument(parsed, params.userId, params.redis);

  return documentId;
}

async function readPages(
  results: WebSearchResult[],
  budget: number,
  params: { orgId: string; courseId?: string; conversationId?: string; userId: string; redis: RedisClient }
): Promise<{ sources: ResearchSource[]; failedCount: number; timedOut: boolean }> {
  const sources: ResearchSource[] = [];
  const deadline = Date.now() + RESEARCH_DEADLINE_MS;
  let failedCount = 0;
  let timedOut = false;
  let next = 0;
  let inFlight = 0;

  async function worker() {
    for (;;) {
      if (Date.now() >= deadline) {
        timedOut = true;

        return;
      }

      // Claim a slot before reading, counting pages already being read.
      //
      // Without the in-flight term, workers keep pulling while the first results
      // are still being stored — a budget of 5 cost 9 reads, because nothing had
      // landed yet when the sixth was claimed. Spares are meant to replace
      // failures, not to be read speculatively; each one is a paid fetch and a
      // second or two of the deadline.
      if (sources.length + inFlight >= budget) {
        if (inFlight === 0) {
          return;
        }

        // Others are still reading: one of them may fail and free this slot.
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }

      const index = next++;
      const result = results[index];

      if (!result) {
        return;
      }

      inFlight += 1;

      try {
        const page = await fetchDocumentationUrl({
          url: result.url,
          orgId: params.orgId,
          courseId: params.courseId,
          // A teacher asking for research is not the runaway-agent case the
          // per-conversation fetch limit guards against — same reasoning as the
          // Sources panel's own URL route.
          priorMessages: []
        });

        if (isUnreadablePage(page.content)) {
          throw new Error(`no readable content at ${result.url}`);
        }

        const parsed = toParsedDocument(page);
        const documentId = await persistPage(page, parsed, params);

        sources.push({
          documentId,
          title: parsed.fileName,
          url: page.url,
          chars: parsed.text.length
        });
      } catch (error) {
        failedCount += 1;
        console.info('[research] page skipped:', error instanceof Error ? error.message : error);
      } finally {
        inFlight -= 1;
      }
    }
  }

  const workers = Math.max(1, Math.min(FETCH_CONCURRENCY, budget, results.length));

  await Promise.all(Array.from({ length: workers }, worker));

  return { sources: sources.slice(0, budget), failedCount, timedOut };
}

/**
 * Search the web on a topic and keep what is worth keeping.
 *
 * The result is a set of DRAFT documents, not course sources, because this runs
 * from the course wizard where **the course does not exist yet** — the teacher is
 * still describing it. Drafts live in Redis exactly like a PDF uploaded on that
 * same screen, and `promoteDraftDocuments` turns both into real sources on the
 * first chat turn. Reusing that path is what makes a researched page and an
 * uploaded PDF land in the same Sources panel and the same cached source pack,
 * instead of research becoming a second, parallel notion of "material".
 *
 * Nothing here is fatal. A dead link, a page behind a paywall or a search that
 * returns junk reduce the harvest; they do not fail the request, because a course
 * built from eight good pages is worth more than an error message.
 */
export async function runResearch(params: {
  topic: string;
  depth: ResearchDepth;
  orgId: string;
  /** Absent when the course wizard researches before the course exists. */
  courseId?: string;
  /** Set together with courseId — pages then land in the Sources tab immediately. */
  conversationId?: string;
  userId: string;
  redis: RedisClient;
  providerConfig: AIProviderConfig;
  /** Who the course is for — shapes what counts as useful material. */
  brief?: ResearchBrief;
}): Promise<ResearchOutcome> {
  const { topic, depth, providerConfig, brief } = params;
  const pageBudget = PAGES_PER_DEPTH[depth];

  const queries = await deriveSearchQueries(topic, depth, providerConfig, brief ?? {});

  // Over-fetch the candidate list: some pages will be unreadable, and it is
  // cheaper to have spares than to come up short of the depth the teacher chose.
  const perQuery = await Promise.all(
    queries.map(async (query) => {
      try {
        return await searchWeb({ query, limit: pageBudget });
      } catch (error) {
        console.warn(`[research] search failed for "${query}":`, error);

        return [] as WebSearchResult[];
      }
    })
  );

  // Spares, not a bigger harvest: login walls and video pages are only detected
  // after reading them, so a run with no slack comes back short of its depth.
  const candidates = mergeSearchResults(perQuery, pageBudget * 2);

  if (candidates.length === 0) {
    return { queries, sources: [], failedCount: 0 };
  }

  const { sources, failedCount, timedOut } = await readPages(candidates, pageBudget, params);

  console.info('[research] done', {
    topic: topic.slice(0, 80),
    depth,
    queries: queries.length,
    kept: sources.length,
    failed: failedCount,
    timedOut
  });

  return { queries, sources, failedCount };
}

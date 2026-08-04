import { generateObject } from 'ai';
import { z } from 'zod';
import { AIProvider, type AIProviderConfig, createModel, resolveModelName } from '@cio/ai-assistant';
import { MAX_DOCUMENT_TEXT_LENGTH } from '@cio/ai-assistant';
import { searchWeb, mergeSearchResults, type WebSearchResult } from '@api/services/agent/web-search';
import { fetchDocumentationUrl } from '@api/services/agent/fetch-url';
import { storeDraftDocument, URL_SOURCE_MIME_TYPE, type ParsedDocument } from '@api/services/agent/document';
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

/** How many pages we read at once. Bounded so a deep run cannot stall the request. */
const FETCH_CONCURRENCY = 5;

/** A page that adds nothing but noise to a course. */
const MIN_USEFUL_CHARS = 400;

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

const ZQueries = z.object({
  queries: z.array(z.string().min(3)).min(1).max(6)
});

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
  providerConfig: AIProviderConfig
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
    const { object } = await generateObject({
      model,
      schema: ZQueries,
      maxRetries: 1,
      system: [
        'You plan the web research for a training course.',
        `Return exactly ${wanted} web search queries that together cover the topic:`,
        'foundations and definitions, practical/applied material, and standards or',
        'reference tables where the topic has them.',
        'Write the queries in the SAME LANGUAGE as the topic.',
        'Each query must stand alone as something you would type into a search engine.'
      ].join(' '),
      prompt: topic.slice(0, 500)
    });

    const queries = object.queries.map((q) => q.trim()).filter(Boolean).slice(0, wanted);

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

async function readPagesInBatches(
  results: WebSearchResult[],
  params: { orgId: string; courseId?: string; userId: string; redis: RedisClient }
): Promise<{ sources: ResearchSource[]; failedCount: number }> {
  const sources: ResearchSource[] = [];
  let failedCount = 0;

  for (let start = 0; start < results.length; start += FETCH_CONCURRENCY) {
    const batch = results.slice(start, start + FETCH_CONCURRENCY);

    const settled = await Promise.allSettled(
      batch.map(async (result) => {
        const page = await fetchDocumentationUrl({
          url: result.url,
          orgId: params.orgId,
          courseId: params.courseId,
          // A teacher asking for research is not the runaway-agent case the
          // per-conversation fetch limit guards against — same reasoning as the
          // Sources panel's own URL route.
          priorMessages: []
        });

        if (page.content.length < MIN_USEFUL_CHARS) {
          throw new Error(`too little content at ${result.url}`);
        }

        const parsed = toParsedDocument(page);
        const { documentId } = await storeDraftDocument(parsed, params.userId, params.redis);

        return {
          documentId,
          title: parsed.fileName,
          url: page.url,
          chars: parsed.text.length
        } satisfies ResearchSource;
      })
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        sources.push(outcome.value);
      } else {
        failedCount += 1;
        console.info('[research] page skipped:', outcome.reason);
      }
    }
  }

  return { sources, failedCount };
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
  userId: string;
  redis: RedisClient;
  providerConfig: AIProviderConfig;
}): Promise<ResearchOutcome> {
  const { topic, depth, providerConfig } = params;
  const pageBudget = PAGES_PER_DEPTH[depth];

  const queries = await deriveSearchQueries(topic, depth, providerConfig);

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

  const candidates = mergeSearchResults(perQuery, Math.ceil(pageBudget * 1.5));

  if (candidates.length === 0) {
    return { queries, sources: [], failedCount: 0 };
  }

  const { sources, failedCount } = await readPagesInBatches(candidates.slice(0, pageBudget), params);

  console.info('[research] done', {
    topic: topic.slice(0, 80),
    depth,
    queries: queries.length,
    kept: sources.length,
    failed: failedCount
  });

  return { queries, sources, failedCount };
}

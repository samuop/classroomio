import { embed, embedMany } from 'ai';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@cio/db';
import * as schema from '@cio/db/schema';
import { getEmbeddingModel, EMBEDDING_PROVIDER_OPTIONS } from '@cio/ai-assistant';
import type { TLocale } from '@db/types';

/**
 * Semantic indexing for the student AI tutor (RAG).
 *
 * Lesson content is chunked, embedded with Gemini, and stored in
 * `lesson_embedding` (one row per chunk). The student `search_course` tool then
 * does a vector similarity search instead of a literal ILIKE, so it can match by
 * meaning (synonyms / paraphrase), not just shared words.
 *
 * Everything degrades gracefully: with no GOOGLE_API_KEY, indexing is a no-op and
 * search falls back to literal matching.
 */

const MAX_CHUNK_CHARS = 1800; // ~450 tokens — comfortable for text-embedding-004
const CHUNK_OVERLAP_CHARS = 200;

/** Strip HTML to readable plain text for embedding. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ') // diagrams aren't useful as embedded text
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split plain text into overlapping chunks. Prefers paragraph boundaries; falls
 * back to hard slicing for very long paragraphs. Overlap preserves context across
 * chunk borders so a concept split mid-section is still retrievable.
 */
export function chunkText(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= MAX_CHUNK_CHARS) return [clean];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const para of paragraphs) {
    if (para.length > MAX_CHUNK_CHARS) {
      // Hard-slice an oversized paragraph with overlap.
      pushCurrent();
      current = '';
      for (let start = 0; start < para.length; start += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
        chunks.push(para.slice(start, start + MAX_CHUNK_CHARS).trim());
      }
      continue;
    }

    if ((current + '\n\n' + para).length > MAX_CHUNK_CHARS) {
      pushCurrent();
      // Start the next chunk with a tail of the previous one for overlap.
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      current = `${tail}\n\n${para}`;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  pushCurrent();

  return chunks.filter((c) => c.length > 0);
}

/**
 * Re-index a single (lesson, locale). Idempotent: deletes the old chunks for that
 * pair and inserts fresh ones. No-op when embeddings are unavailable or the
 * content is empty.
 */
export async function indexLessonLanguage(params: {
  lessonId: string;
  courseId: string;
  locale: TLocale;
  content: string | null | undefined;
}): Promise<{ indexed: number }> {
  const model = getEmbeddingModel();
  if (!model) return { indexed: 0 };

  const { lessonId, courseId, locale } = params;

  // Always clear existing chunks for this (lesson, locale) so stale content goes away.
  await db
    .delete(schema.lessonEmbedding)
    .where(and(eq(schema.lessonEmbedding.lessonId, lessonId), eq(schema.lessonEmbedding.locale, locale)));

  const text = htmlToText(params.content ?? '');
  const chunks = chunkText(text);
  if (chunks.length === 0) return { indexed: 0 };

  const { embeddings } = await embedMany({
    model,
    values: chunks,
    providerOptions: EMBEDDING_PROVIDER_OPTIONS
  });

  await db.insert(schema.lessonEmbedding).values(
    chunks.map((content, chunkIndex) => ({
      lessonId,
      courseId,
      locale,
      chunkIndex,
      content,
      embedding: embeddings[chunkIndex]
    }))
  );

  return { indexed: chunks.length };
}

/**
 * Fire-and-forget re-index after a lesson save. Never throws into the caller —
 * indexing must not break content saving. Skips silently when embeddings are off.
 */
export function reindexLessonLanguageInBackground(params: {
  lessonId: string;
  courseId: string | null | undefined;
  locale: TLocale;
  content: string | null | undefined;
}): void {
  if (!params.courseId) return;
  if (!getEmbeddingModel()) return;

  void indexLessonLanguage({
    lessonId: params.lessonId,
    courseId: params.courseId,
    locale: params.locale,
    content: params.content
  }).catch((error) => {
    console.warn('[embeddings] background re-index failed for lesson', params.lessonId, error);
  });
}

/**
 * Vector similarity search over a course's indexed lesson chunks.
 * Returns the most semantically similar chunks for the query, pre-filtered by
 * course (and locale when given). Empty array when embeddings are unavailable —
 * callers fall back to literal search.
 */
export async function semanticSearchCourse(params: {
  courseId: string;
  query: string;
  locale?: TLocale;
  limit?: number;
}): Promise<Array<{ lessonId: string; chunkIndex: number; content: string; distance: number }>> {
  const model = getEmbeddingModel();
  if (!model) return [];

  const limit = params.limit ?? 8;
  const { embedding } = await embed({
    model,
    value: params.query,
    providerOptions: EMBEDDING_PROVIDER_OPTIONS
  });
  const queryVec = `[${embedding.join(',')}]`;

  const localeFilter = params.locale
    ? sql`AND locale = ${params.locale}`
    : sql``;

  // <=> is pgvector cosine distance (smaller = closer). Parameterized query vector.
  // The postgres-js driver returns the row array directly from db.execute().
  const rows = (await db.execute(sql`
    SELECT lesson_id, chunk_index, content, (embedding <=> ${queryVec}::halfvec) AS distance
    FROM lesson_embedding
    WHERE course_id = ${params.courseId} ${localeFilter}
    ORDER BY embedding <=> ${queryVec}::halfvec
    LIMIT ${limit}
  `)) as unknown as Array<{
    lesson_id: string;
    chunk_index: number;
    content: string;
    distance: number;
  }>;

  return rows.map((r) => ({
    lessonId: r.lesson_id,
    chunkIndex: Number(r.chunk_index),
    content: r.content,
    distance: Number(r.distance)
  }));
}

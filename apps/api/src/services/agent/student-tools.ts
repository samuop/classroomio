import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { db } from '@cio/db';
import * as schema from '@cio/db/schema';
import type { AiTutorSettings } from '@cio/ai-assistant';

import { getLesson } from '@api/services/lesson/lesson';
import { getExercise } from '@api/services/exercise/exercise';
import { listCourseSections } from '@api/services/course/section';
import { AppError } from '@api/utils/errors';
import { AgentEvent, trackAgentEvent } from '@api/utils/tinybird';
import { verifyExerciseBelongsToCourse, verifyLessonBelongsToCourse } from './chat-context';
import { semanticSearchCourse } from './embeddings';
import {
  dedupeByLesson,
  mergeCourseSearchResults,
  type CourseSearchHit
} from './course-search-merge';
import type { TLocale } from '@db/types';

/**
 * Student agent tools — read-only, course-scoped.
 *
 * Every tool re-verifies the resource belongs to `courseId` so a poisoned model
 * cannot reach into other courses or other learners' data. Exercise reads strip
 * answer keys and per-question scoring data before returning.
 */

const SEARCH_SNIPPET_RADIUS = 80;

/**
 * How many chunks to pull per requested result before collapsing them by
 * lesson. Three covers the usual case of one lesson owning a topic without
 * making pgvector scan much more than it already does.
 */
const SEMANTIC_CHUNK_OVERFETCH = 3;

function logToolEvent(
  phase: 'start' | 'success' | 'error',
  toolName: string,
  details: { orgId: string; userId: string; courseId: string; args?: unknown; error?: unknown }
) {
  const base = `[student-tool:${phase}] ${toolName}`;

  if (phase === 'error') {
    console.error(base, {
      courseId: details.courseId,
      userId: details.userId,
      args: details.args,
      error: details.error instanceof Error ? details.error.message : details.error
    });
    return;
  }

  console.info(base, {
    courseId: details.courseId,
    userId: details.userId
  });
}

async function executeStudentTool<T>(
  toolName: string,
  ctx: { orgId: string; userId: string; courseId: string; args?: unknown },
  execute: () => Promise<T>
): Promise<T> {
  trackAgentEvent(AgentEvent.TOOL_CALLED, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    courseId: ctx.courseId,
    toolName
  });
  logToolEvent('start', toolName, ctx);

  try {
    const result = await execute();
    trackAgentEvent(AgentEvent.TOOL_COMPLETED, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      courseId: ctx.courseId,
      toolName,
      success: true
    });
    logToolEvent('success', toolName, ctx);

    return result;
  } catch (error) {
    logToolEvent('error', toolName, { ...ctx, error });

    if (error instanceof AppError) throw error;
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function stripAnswerKeysFromQuestion(question: {
  id: number | string;
  title: string;
  questionTypeId: number;
  order: number | null;
  points: number | null;
  options?: { label: string | null }[];
}): {
  id: number | string;
  question: string;
  questionTypeId: number;
  order: number | null;
  options: { label: string }[];
} {
  return {
    id: question.id,
    question: question.title,
    questionTypeId: question.questionTypeId,
    order: question.order,
    options: (question.options ?? []).filter((o) => o.label != null).map((o) => ({ label: o.label as string }))
  };
}

function makeSnippet(text: string, query: string, radius: number = SEARCH_SNIPPET_RADIUS): string {
  if (!text) return '';
  const normalized = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = normalized.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return normalized.slice(0, radius * 2) + (normalized.length > radius * 2 ? '…' : '');

  const start = Math.max(0, idx - radius);
  const end = Math.min(normalized.length, idx + query.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

/**
 * Literal search over this course's exercises. Separate from the lesson search
 * because lessons have embeddings and exercises do not, so the two can never
 * share a ranking — but both have to run, always. See the comment in
 * `search_course`.
 *
 * Never throws: exercises widen the answer, they are not the answer. A failure
 * here must degrade to "no exercises matched" rather than take the lesson
 * results down with it — and it must not surface as "semantic search failed"
 * either, which is what an exception thrown inside the caller's try block would
 * be logged as.
 */
async function searchExercises(
  courseId: string,
  query: string,
  limit: number
): Promise<CourseSearchHit[]> {
  const pattern = `%${query}%`;

  try {
    const matches = await db
      .select({
        id: schema.exercise.id,
        title: schema.exercise.title,
        description: schema.exercise.description
      })
      .from(schema.exercise)
      .where(
        and(
          eq(schema.exercise.courseId, courseId),
          or(ilike(schema.exercise.title, pattern), ilike(schema.exercise.description, pattern))
        )
      )
      .limit(limit);

    return matches.map((em) => ({
      type: 'exercise' as const,
      id: em.id,
      title: em.title,
      snippet: makeSnippet(em.description ?? em.title ?? '', query)
    }));
  } catch (error) {
    console.warn('[search_course] exercise search failed, returning lessons only:', error);
    return [];
  }
}

const listCourseOutlineParam = z.object({});
const readLessonParam = z.object({ lessonId: z.string() });
const readExerciseParam = z.object({ exerciseId: z.string() });
const searchCourseParam = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(8)
});

export function buildStudentAgentTools(
  orgId: string,
  userId: string,
  courseId: string,
  _settings: AiTutorSettings,
  locale: TLocale = 'en'
): ToolSet {
  return {
    list_course_outline: tool({
      description:
        'List the course outline (sections with their lessons and exercises). The courseId is automatically scoped — do not pass it. Returns titles and ids only.',
      inputSchema: listCourseOutlineParam,
      execute: async () => {
        return executeStudentTool('list_course_outline', { orgId, userId, courseId }, async () => {
          const [sections, lessons, exercises] = await Promise.all([
            listCourseSections(courseId),
            db
              .select({
                id: schema.lesson.id,
                title: schema.lesson.title,
                sectionId: schema.lesson.sectionId,
                order: schema.lesson.order
              })
              .from(schema.lesson)
              .where(eq(schema.lesson.courseId, courseId))
              .orderBy(asc(schema.lesson.order)),
            db
              .select({
                id: schema.exercise.id,
                title: schema.exercise.title,
                lessonId: schema.exercise.lessonId,
                sectionId: schema.exercise.sectionId,
                order: schema.exercise.order
              })
              .from(schema.exercise)
              .where(eq(schema.exercise.courseId, courseId))
              .orderBy(asc(schema.exercise.order))
          ]);

          return { sections, lessons, exercises };
        });
      }
    }),

    read_lesson: tool({
      description:
        'Read the title and body of a specific lesson in the current course. Use this when the learner refers to a lesson that is not already loaded in your context.',
      inputSchema: readLessonParam,
      execute: async (args) => {
        return executeStudentTool('read_lesson', { orgId, userId, courseId, args }, async () => {
          await verifyLessonBelongsToCourse(args.lessonId, courseId);
          const lesson = await getLesson(args.lessonId);
          const lessonWithLangs = lesson as {
            id: string;
            title: string;
            note?: string | null;
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const content =
            lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === locale)?.content ??
            lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === 'en')?.content ??
            null;

          return {
            id: lesson.id,
            title: lesson.title,
            content,
            note: lessonWithLangs.note ?? null
          };
        });
      }
    }),

    read_exercise: tool({
      description:
        'Read an exercise prompt — the question text and options visible to a student. Answer keys, correct flags, and marking schemes are stripped before returning.',
      inputSchema: readExerciseParam,
      execute: async (args) => {
        return executeStudentTool('read_exercise', { orgId, userId, courseId, args }, async () => {
          await verifyExerciseBelongsToCourse(args.exerciseId, courseId);
          const exercise = await getExercise(args.exerciseId);

          const questions = (exercise.questions ?? []).map((q) =>
            stripAnswerKeysFromQuestion({
              id: q.id,
              title: q.title,
              questionTypeId: q.questionTypeId,
              order: q.order,
              points: q.points ?? null,
              options: q.options ?? []
            })
          );

          return {
            id: exercise.id,
            title: exercise.title,
            description: exercise.description,
            questions
          };
        });
      }
    }),

    search_course: tool({
      description:
        'Search this course for lessons and exercises whose title or body contains the query. Returns up to `limit` ranked snippets with ids you can pass to read_lesson / read_exercise.',
      inputSchema: searchCourseParam,
      execute: async (args) => {
        return executeStudentTool('search_course', { orgId, userId, courseId, args }, async () => {
          const limit = args.limit ?? 8;

          // Exercises are ALWAYS searched, on every path.
          //
          // They used to be searched only in the literal fallback, so the moment
          // a course had indexed lessons the semantic branch returned and no
          // exercise could ever come back — while the tool description promised
          // "lessons and exercises". The learner asked about an exercise, got an
          // empty result the model had no reason to doubt, and was told the
          // material is not in the course. There is no exercise embedding table,
          // so literal matching is what we have for them.
          const exerciseSearch = searchExercises(courseId, args.query, limit);

          // Primary path for lessons: semantic (vector) search over indexed
          // chunks. Matches by meaning, so synonyms/paraphrase work. Falls
          // through to the literal ILIKE search below if embeddings are
          // unavailable or nothing is indexed for this course yet.
          //
          // Asks for more chunks than it needs because chunks are not lessons: a
          // thorough lesson wins several of them, and after deduping those
          // collapse into one result. Fetching `limit` chunks would hand back
          // three or four distinct lessons where the learner asked for eight.
          try {
            const semantic = await semanticSearchCourse({
              courseId,
              query: args.query,
              locale,
              limit: limit * SEMANTIC_CHUNK_OVERFETCH
            });

            if (semantic.length > 0) {
              const ids = [...new Set(semantic.map((s) => s.lessonId))];
              const titles = await db
                .select({ id: schema.lesson.id, title: schema.lesson.title })
                .from(schema.lesson)
                .where(and(eq(schema.lesson.courseId, courseId), inArray(schema.lesson.id, ids)));
              const titleById = new Map(titles.map((t) => [t.id, t.title]));

              // Already ordered closest-first, so deduping keeps each lesson's
              // best-matching chunk.
              const lessons = dedupeByLesson(
                semantic.map((s) => ({
                  type: 'lesson' as const,
                  id: s.lessonId,
                  title: titleById.get(s.lessonId) ?? '',
                  snippet: makeSnippet(s.content, args.query)
                }))
              );

              return {
                query: args.query,
                results: mergeCourseSearchResults(lessons, await exerciseSearch, limit)
              };
            }
          } catch (error) {
            console.warn('[search_course] semantic search failed, falling back to literal:', error);
          }

          const pattern = `%${args.query}%`;

          const lessonMatches = await db
            .select({
              id: schema.lesson.id,
              title: schema.lesson.title,
              content: schema.lessonLanguage.content
            })
            .from(schema.lesson)
            .leftJoin(
              schema.lessonLanguage,
              and(eq(schema.lessonLanguage.lessonId, schema.lesson.id), eq(schema.lessonLanguage.locale, locale))
            )
            .where(
              and(
                eq(schema.lesson.courseId, courseId),
                or(ilike(schema.lesson.title, pattern), ilike(schema.lessonLanguage.content, pattern))
              )
            )
            .limit(limit);

          const lessonsResult = lessonMatches.map((lm) => ({
            type: 'lesson' as const,
            id: lm.id,
            title: lm.title,
            snippet: makeSnippet(lm.content ?? lm.title ?? '', args.query)
          }));

          return {
            query: args.query,
            results: mergeCourseSearchResults(lessonsResult, await exerciseSearch, limit)
          };
        });
      }
    })
  };
}

export type StudentAgentTools = ReturnType<typeof buildStudentAgentTools>;

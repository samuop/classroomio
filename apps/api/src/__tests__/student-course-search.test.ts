/**
 * The learner tutor's `search_course` must return exercises.
 *
 * It did not. The semantic (vector) branch returned lessons and stopped, so on
 * any course with indexed lessons — the normal case — no exercise could ever
 * come back, while the tool's own description promised "lessons and exercises".
 * The model has no way to doubt an empty result, so learners were told the
 * material is not in the course.
 *
 * These pin the merge policy that fixes it: exercises always get a share of the
 * slots, and neither side may silently swallow the other.
 */

import { describe, expect, it } from 'vitest';
import {
  dedupeByLesson,
  mergeCourseSearchResults,
  type CourseSearchHit
} from '@api/services/agent/course-search-merge';
import {
  MAX_OUTPUT_TOKENS_STUDENT,
  MAX_STEPS_PER_ROUND,
  MAX_STEPS_PER_ROUND_STUDENT
} from '@cio/ai-assistant';

function lessons(n: number): CourseSearchHit[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'lesson' as const,
    id: `l${i}`,
    title: `Lección ${i}`,
    snippet: '…'
  }));
}

function exercises(n: number): CourseSearchHit[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'exercise' as const,
    id: `e${i}`,
    title: `Ejercicio ${i}`,
    snippet: '…'
  }));
}

const countOf = (hits: CourseSearchHit[], type: 'lesson' | 'exercise') =>
  hits.filter((h) => h.type === type).length;

describe('mergeCourseSearchResults', () => {
  it('keeps an exercise even when lessons alone could fill every slot', () => {
    // THE regression. Appending exercises and slicing to `limit` drops them all
    // here, which is exactly what shipped.
    const merged = mergeCourseSearchResults(lessons(20), exercises(3), 8);

    expect(merged).toHaveLength(8);
    expect(countOf(merged, 'exercise')).toBeGreaterThan(0);
  });

  it('still returns mostly lessons — a concept question is not an exercise question', () => {
    const merged = mergeCourseSearchResults(lessons(20), exercises(20), 8);

    expect(countOf(merged, 'lesson')).toBe(6);
    expect(countOf(merged, 'exercise')).toBe(2);
  });

  it('gives exercises the slots the lessons did not use', () => {
    const merged = mergeCourseSearchResults(lessons(1), exercises(10), 8);

    expect(merged).toHaveLength(8);
    expect(countOf(merged, 'lesson')).toBe(1);
    expect(countOf(merged, 'exercise')).toBe(7);
  });

  it('gives lessons every slot when nothing matched an exercise', () => {
    const merged = mergeCourseSearchResults(lessons(10), [], 8);

    expect(merged).toHaveLength(8);
    expect(countOf(merged, 'exercise')).toBe(0);
  });

  it('returns only exercises when no lesson matched', () => {
    // The half-indexed-course case: semantic search finds nothing, literal
    // finds no lesson either, but the exercise is right there.
    const merged = mergeCourseSearchResults([], exercises(4), 8);

    expect(merged).toHaveLength(4);
    expect(countOf(merged, 'exercise')).toBe(4);
  });

  it('reserves at least one exercise slot at the smallest limit', () => {
    const merged = mergeCourseSearchResults(lessons(5), exercises(5), 1);

    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('exercise');
  });

  it('never exceeds the requested limit', () => {
    for (const limit of [1, 2, 3, 5, 8, 20]) {
      expect(mergeCourseSearchResults(lessons(30), exercises(30), limit)).toHaveLength(limit);
    }
  });

  it('returns nothing when nothing matched', () => {
    expect(mergeCourseSearchResults([], [], 8)).toEqual([]);
  });
});

describe('dedupeByLesson', () => {
  it('collapses several chunks of one lesson into its best match', () => {
    // Observed in production: "cómo cotizo a un cliente" spent two of eight
    // slots on the same lesson, because vector search ranks chunks, not lessons.
    const hits: CourseSearchHit[] = [
      { type: 'lesson', id: 'tango', title: 'Cotizaciones en Tango Delta', snippet: 'el mejor' },
      { type: 'lesson', id: 'turnero', title: 'Turnero de mostrador', snippet: '…' },
      { type: 'lesson', id: 'tango', title: 'Cotizaciones en Tango Delta', snippet: 'otro trozo' }
    ];

    const deduped = dedupeByLesson(hits);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((h) => h.id)).toEqual(['tango', 'turnero']);
    // Closest-first ordering means the first occurrence is the best one.
    expect(deduped[0].snippet).toBe('el mejor');
  });

  it('leaves already-distinct results untouched', () => {
    const hits = lessons(5);
    expect(dedupeByLesson(hits)).toEqual(hits);
  });

  it('handles an empty result', () => {
    expect(dedupeByLesson([])).toEqual([]);
  });
});

describe('learner-round budgets', () => {
  // These were the course-builder's numbers until they were split by role. The
  // tutor searches, reads a lesson or two, and answers; the builder emits lesson
  // HTML across dozens of tool calls. Sharing one budget meant one learner
  // question could cost ~40 full-price requests when the tutor got stuck in a
  // retry loop.
  it('caps a learner round well below a build round', () => {
    expect(MAX_STEPS_PER_ROUND_STUDENT).toBeLessThan(MAX_STEPS_PER_ROUND);
  });

  it('still leaves room for search → read → read → answer', () => {
    expect(MAX_STEPS_PER_ROUND_STUDENT).toBeGreaterThanOrEqual(4);
  });

  it('caps learner output below the lesson-HTML ceiling but above a long answer', () => {
    expect(MAX_OUTPUT_TOKENS_STUDENT).toBeLessThan(16384);
    // ~3,000 words: past the longest answer the tutor's own settings ask for.
    expect(MAX_OUTPUT_TOKENS_STUDENT).toBeGreaterThanOrEqual(4096);
  });
});

/**
 * How a learner's `search_course` combines lesson hits with exercise hits.
 *
 * Its own module, with no database imports, so the policy can be tested without
 * standing up the whole service graph — same reason `delivery-auth.ts` exists.
 *
 * The rule it encodes came from a real failure: exercises used to be searched
 * only on the literal fallback path, so a course with indexed lessons could
 * never return one, and the tutor told learners the material was not in the
 * course. Both sets are now always searched, and this decides how they share
 * the result slots.
 */

export interface CourseSearchHit {
  type: 'lesson' | 'exercise';
  id: string;
  title: string;
  snippet: string;
}

/**
 * How many of the `limit` slots exercise matches may take when lessons also
 * matched. A quarter, at least one: enough that "where was the exercise about
 * X?" is answerable, few enough that a concept question still comes back mostly
 * lessons.
 */
function exerciseSlots(limit: number): number {
  return Math.max(1, Math.floor(limit / 4));
}

/**
 * Collapse repeated hits on the same lesson, keeping the first (closest) one.
 *
 * Semantic search ranks CHUNKS, so a lesson that covers a topic thoroughly wins
 * several of them and crowds the results with itself — one real query spent two
 * of eight slots on the same lesson. The tutor gets a lesson id either way and
 * can read the whole thing, so a second chunk of a lesson it already has buys
 * nothing, while a different lesson might have been the answer.
 */
export function dedupeByLesson(hits: CourseSearchHit[]): CourseSearchHit[] {
  const vistos = new Set<string>();
  return hits.filter((hit) => {
    if (vistos.has(hit.id)) return false;
    vistos.add(hit.id);
    return true;
  });
}

/**
 * Merge the two result sets, letting either take the slots the other did not
 * use.
 *
 * The obvious implementation — concatenate, then `slice(0, limit)` — is the bug
 * this replaces: whenever lessons alone fill the limit, every exercise is
 * silently dropped.
 */
export function mergeCourseSearchResults(
  lessons: CourseSearchHit[],
  exercises: CourseSearchHit[],
  limit: number
): CourseSearchHit[] {
  if (exercises.length === 0) return lessons.slice(0, limit);

  const forExercises = Math.min(exercises.length, exerciseSlots(limit));
  const takenLessons = lessons.slice(0, Math.max(0, limit - forExercises));
  const takenExercises = exercises.slice(0, limit - takenLessons.length);

  return [...takenLessons, ...takenExercises];
}

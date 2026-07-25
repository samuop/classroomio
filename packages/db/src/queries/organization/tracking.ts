import { sql } from 'drizzle-orm';

import { db } from '@db/drizzle';
import { ROLE } from '@cio/utils/constants';

/**
 * CANONICAL student-tracking aggregation.
 *
 * A single SQL pass computes, per (student, course) enrolment in an org, the
 * same progress and grade numbers the per-course pages show — but for every
 * learner at once. This is the *single source of truth* the tracking hub reads
 * from, so the roster, the per-course view and the summary can never drift from
 * one another (and, importantly, must match `getCourseProgress` /
 * `getUserExercisesStats`, whose logic is mirrored here in SQL):
 *
 *   · progress % = completed lessons / total lessons in the course
 *   · grade %    = earned exercise points / max exercise points
 *                  (exercise belongs to the course directly OR via its lesson)
 *   · earned points = SUM(submission.total) for the learner's group membership
 *   · max points    = SUM(question.points) over the course's exercises
 *
 * Correlated sub-selects per course avoid a lessons×exercises join fan-out that
 * would otherwise multiply rows and corrupt the counts.
 *
 * Only STUDENT-role memberships are aggregated, matching how every other
 * tracking surface counts students (tutors/admins excluded).
 */

const STUDENT = ROLE.STUDENT;

/** One (student, course) enrolment row with progress + grade. */
export interface TrackingEnrolmentRow {
  profileId: string;
  fullname: string;
  email: string;
  avatarUrl: string;
  courseId: string;
  courseTitle: string;
  enrolledAt: string | null;
  certificateEarnedAt: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  /** 0–100, rounded. */
  progressPct: number;
  earnedPoints: number;
  maxPoints: number;
  /** 0–100, rounded. Null when the course has no gradeable exercises. */
  gradePct: number | null;
}

/**
 * Returns every (student, course) enrolment in the org with progress + grade,
 * computed in one aggregated query. Callers roll this up per-student or
 * per-course in memory (cheap — the heavy lifting is already done in SQL).
 */
interface TrackingEnrolmentRaw {
  profile_id: string;
  fullname: string | null;
  email: string | null;
  avatar_url: string | null;
  course_id: string;
  course_title: string | null;
  enrolled_at: string | null;
  certificate_earned_at: string | null;
  lessons_total: number;
  lessons_completed: number;
  earned_points: number;
  max_points: number;
}

export async function getOrgTrackingEnrolments(orgId: string): Promise<TrackingEnrolmentRow[]> {
  // postgres-js returns rows as a plain array from db.execute (no `.rows`).
  const result = await db.execute(sql`
    WITH enrolment AS (
      SELECT
        gm.id            AS group_member_id,
        gm.profile_id    AS profile_id,
        gm.created_at    AS enrolled_at,
        gm.certificate_earned_at AS certificate_earned_at,
        c.id             AS course_id,
        c.title          AS course_title
      FROM groupmember gm
      JOIN "group" g   ON g.id = gm.group_id
      JOIN course c    ON c.group_id = gm.group_id
      WHERE g.organization_id = ${orgId}
        AND gm.role_id = ${STUDENT}
        AND gm.profile_id IS NOT NULL
    )
    SELECT
      e.profile_id,
      p.fullname,
      COALESCE(p.email, om.email) AS email,
      p.avatar_url,
      e.course_id,
      e.course_title,
      e.enrolled_at,
      e.certificate_earned_at,
      -- total lessons in the course
      (SELECT COUNT(*) FROM lesson l WHERE l.course_id = e.course_id)::int
        AS lessons_total,
      -- lessons this learner completed
      (SELECT COUNT(*) FROM lesson_completion lc
         JOIN lesson l ON l.id = lc.lesson_id
        WHERE l.course_id = e.course_id
          AND lc.profile_id = e.profile_id
          AND lc.is_complete = true)::int
        AS lessons_completed,
      -- earned exercise points (learner's submissions on the course's exercises)
      COALESCE((
        SELECT SUM(s.total)
          FROM submission s
          JOIN exercise ex ON ex.id = s.exercise_id
          LEFT JOIN lesson el ON el.id = ex.lesson_id
         WHERE s.submitted_by = e.group_member_id
           AND (ex.course_id = e.course_id OR el.course_id = e.course_id)
      ), 0)::int AS earned_points,
      -- max exercise points (sum of question points over the course's exercises)
      COALESCE((
        SELECT SUM(q.points)
          FROM question q
          JOIN exercise ex ON ex.id = q.exercise_id
          LEFT JOIN lesson el ON el.id = ex.lesson_id
         WHERE (ex.course_id = e.course_id OR el.course_id = e.course_id)
      ), 0)::int AS max_points
    FROM enrolment e
    JOIN profile p ON p.id = e.profile_id
    LEFT JOIN organizationmember om
      ON om.profile_id = e.profile_id AND om.organization_id = ${orgId}
    ORDER BY p.fullname ASC, e.course_title ASC
  `);

  const rows = result as unknown as TrackingEnrolmentRaw[];

  return rows.map((r) => {
    const lessonsTotal = Number(r.lessons_total) || 0;
    const lessonsCompleted = Number(r.lessons_completed) || 0;
    const earnedPoints = Number(r.earned_points) || 0;
    const maxPoints = Number(r.max_points) || 0;
    const progressPct = lessonsTotal > 0 ? Math.round((lessonsCompleted / lessonsTotal) * 100) : 0;
    const gradePct = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : null;

    return {
      profileId: r.profile_id,
      fullname: r.fullname ?? '',
      email: r.email ?? '',
      avatarUrl: r.avatar_url ?? '',
      courseId: r.course_id,
      courseTitle: r.course_title ?? '',
      enrolledAt: r.enrolled_at ?? null,
      certificateEarnedAt: r.certificate_earned_at ?? null,
      lessonsTotal,
      lessonsCompleted,
      progressPct,
      earnedPoints,
      maxPoints,
      gradePct
    };
  });
}

/** Rounds a mean of 0–100 values; empty input → 0. */
function meanPct(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/* -------------------------------------------------------------------------- */
/*  Roll-up: PER STUDENT (each learner once, averaged across their courses)   */
/* -------------------------------------------------------------------------- */

export interface StudentCourseCell {
  courseId: string;
  courseTitle: string;
  progressPct: number;
  gradePct: number | null;
  isComplete: boolean;
  certificateEarnedAt: string | null;
}

export interface TrackingStudentRow {
  profileId: string;
  fullname: string;
  email: string;
  avatarUrl: string;
  coursesCount: number;
  coursesCompleted: number;
  /** Mean progress across the learner's courses, 0–100. */
  averageProgress: number;
  /** Mean grade across courses that have a grade, 0–100. */
  averageGrade: number;
  courses: StudentCourseCell[];
}

/**
 * One row per student, aggregated across all their courses. The eje "Por
 * alumno" of the tracking hub — a learner enrolled in five courses appears
 * once, with their per-course cells kept for the drill-down.
 */
export async function getOrgTrackingByStudent(orgId: string): Promise<TrackingStudentRow[]> {
  const enrolments = await getOrgTrackingEnrolments(orgId);

  const byProfile = new Map<string, TrackingStudentRow>();

  for (const e of enrolments) {
    let row = byProfile.get(e.profileId);
    if (!row) {
      row = {
        profileId: e.profileId,
        fullname: e.fullname,
        email: e.email,
        avatarUrl: e.avatarUrl,
        coursesCount: 0,
        coursesCompleted: 0,
        averageProgress: 0,
        averageGrade: 0,
        courses: []
      };
      byProfile.set(e.profileId, row);
    }

    const isComplete = e.lessonsTotal > 0 && e.lessonsCompleted >= e.lessonsTotal;
    row.courses.push({
      courseId: e.courseId,
      courseTitle: e.courseTitle,
      progressPct: e.progressPct,
      gradePct: e.gradePct,
      isComplete,
      certificateEarnedAt: e.certificateEarnedAt
    });
  }

  for (const row of byProfile.values()) {
    row.coursesCount = row.courses.length;
    row.coursesCompleted = row.courses.filter((c) => c.isComplete).length;
    row.averageProgress = meanPct(row.courses.map((c) => c.progressPct));
    const graded = row.courses.map((c) => c.gradePct).filter((g): g is number => g !== null);
    row.averageGrade = meanPct(graded);
  }

  return Array.from(byProfile.values()).sort((a, b) => a.fullname.localeCompare(b.fullname));
}

/* -------------------------------------------------------------------------- */
/*  Roll-up: PER COURSE (each course with its enrolment stats)                */
/* -------------------------------------------------------------------------- */

export interface TrackingCourseRow {
  courseId: string;
  courseTitle: string;
  enrolledCount: number;
  /** Mean progress across enrolled students, 0–100. */
  averageProgress: number;
  /** Mean grade across students with a grade, 0–100. */
  averageGrade: number;
  completedCount: number;
}

/**
 * One row per course, aggregated across its enrolled students. The eje "Por
 * curso" of the tracking hub. A student in several courses is counted in each.
 */
export async function getOrgTrackingByCourse(orgId: string): Promise<TrackingCourseRow[]> {
  const enrolments = await getOrgTrackingEnrolments(orgId);

  const byCourse = new Map<string, { title: string; progress: number[]; grades: number[]; completed: number; count: number }>();

  for (const e of enrolments) {
    let agg = byCourse.get(e.courseId);
    if (!agg) {
      agg = { title: e.courseTitle, progress: [], grades: [], completed: 0, count: 0 };
      byCourse.set(e.courseId, agg);
    }
    agg.count += 1;
    agg.progress.push(e.progressPct);
    if (e.gradePct !== null) agg.grades.push(e.gradePct);
    if (e.lessonsTotal > 0 && e.lessonsCompleted >= e.lessonsTotal) agg.completed += 1;
  }

  return Array.from(byCourse.entries())
    .map(([courseId, agg]) => ({
      courseId,
      courseTitle: agg.title,
      enrolledCount: agg.count,
      averageProgress: meanPct(agg.progress),
      averageGrade: meanPct(agg.grades),
      completedCount: agg.completed
    }))
    .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle));
}

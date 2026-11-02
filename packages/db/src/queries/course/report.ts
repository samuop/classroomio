import { sql } from 'drizzle-orm';

import { db } from '@db/drizzle';
import { ROLE } from '@cio/utils/constants';

/**
 * Lo que hace falta para el reporte de alumnos de un curso: quién está, cuánto
 * avanzó, qué entregó y cuándo, y a quién se invitó y todavía no entró.
 *
 * Las cuentas son las mismas que las del seguimiento (`organization/tracking.ts`):
 * lecciones del curso, lecciones completadas por la persona, y ejercicios que
 * pertenecen al curso directamente o a través de su lección. Si el reporte y la
 * pantalla de seguimiento contaran distinto, la docente vería dos avances para
 * la misma persona.
 *
 * Trae las fechas en ISO crudo: quien escribe el archivo decide cómo mostrarlas.
 */

export interface TCourseReportCourse {
  id: string;
  title: string;
  orgId: string;
  orgName: string;
  orgAvatarUrl: string | null;
}

export interface TCourseReportStudent {
  groupMemberId: string;
  profileId: string;
  fullname: string;
  email: string;
  enrolledAt: string | null;
  lessonsCompleted: number;
  /** Cuándo completó su última lección, o `null` si no completó ninguna. */
  lastLessonCompletedAt: string | null;
}

export interface TCourseReportSubmission {
  groupMemberId: string;
  exerciseId: string;
  total: number | null;
  statusId: number | null;
  submittedAt: string;
}

/** Una invitación al curso que nadie aceptó todavía. */
export interface TCourseReportPendingInvite {
  email: string;
  invitedAt: string;
  expiresAt: string;
}

export interface TCourseReportData {
  course: TCourseReportCourse;
  lessonsTotal: number;
  students: TCourseReportStudent[];
  submissions: TCourseReportSubmission[];
  pendingInvites: TCourseReportPendingInvite[];
}

interface CourseRaw {
  id: string;
  title: string | null;
  org_id: string;
  org_name: string | null;
  org_avatar_url: string | null;
  lessons_total: number;
}

interface StudentRaw {
  group_member_id: string;
  profile_id: string;
  fullname: string | null;
  email: string | null;
  enrolled_at: string | null;
  lessons_completed: number;
  last_lesson_completed_at: string | null;
}

interface SubmissionRaw {
  group_member_id: string;
  exercise_id: string;
  total: number | null;
  status_id: number | null;
  submitted_at: string;
}

interface InviteRaw {
  email: string;
  invited_at: string;
  expires_at: string;
}

const iso = (value: string | Date | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** `null` si el curso no existe. */
export async function getCourseReportData(courseId: string): Promise<TCourseReportData | null> {
  // postgres-js devuelve las filas como un array plano desde db.execute.
  const [course] = (await db.execute(sql`
    SELECT c.id, c.title, g.organization_id AS org_id, o.name AS org_name, o.avatar_url AS org_avatar_url,
           (SELECT COUNT(*) FROM lesson l WHERE l.course_id = c.id)::int AS lessons_total
      FROM course c
      JOIN "group" g ON g.id = c.group_id
      JOIN organization o ON o.id = g.organization_id
     WHERE c.id = ${courseId}
  `)) as unknown as CourseRaw[];

  if (!course) return null;

  const [students, submissions, invites] = await Promise.all([
    db.execute(sql`
      SELECT gm.id AS group_member_id,
             gm.profile_id,
             p.fullname,
             COALESCE(p.email, om.email) AS email,
             gm.created_at AS enrolled_at,
             (SELECT COUNT(*) FROM lesson_completion lc
                JOIN lesson l ON l.id = lc.lesson_id
               WHERE l.course_id = c.id AND lc.profile_id = gm.profile_id AND lc.is_complete = true)::int
               AS lessons_completed,
             (SELECT MAX(COALESCE(lc.updated_at, lc.created_at)) FROM lesson_completion lc
                JOIN lesson l ON l.id = lc.lesson_id
               WHERE l.course_id = c.id AND lc.profile_id = gm.profile_id AND lc.is_complete = true)
               AS last_lesson_completed_at
        FROM course c
        JOIN groupmember gm ON gm.group_id = c.group_id
        JOIN profile p ON p.id = gm.profile_id
        JOIN "group" g ON g.id = c.group_id
        LEFT JOIN organizationmember om
          ON om.profile_id = gm.profile_id AND om.organization_id = g.organization_id
       WHERE c.id = ${courseId}
         AND gm.role_id = ${ROLE.STUDENT}
         AND gm.profile_id IS NOT NULL
    `) as unknown as Promise<StudentRaw[]>,

    db.execute(sql`
      SELECT s.submitted_by AS group_member_id, s.exercise_id, s.total, s.status_id, s.created_at AS submitted_at
        FROM submission s
        JOIN exercise ex ON ex.id = s.exercise_id
        LEFT JOIN lesson el ON el.id = ex.lesson_id
       WHERE (ex.course_id = ${courseId} OR el.course_id = ${courseId})
         AND s.submitted_by IS NOT NULL
    `) as unknown as Promise<SubmissionRaw[]>,

    // La invitación por correo lleva los cursos en `metadata.courseIds`. Si a
    // alguien se le renovó, cuenta la última.
    db.execute(sql`
      SELECT DISTINCT ON (lower(i.email)) i.email, i.created_at AS invited_at, i.expires_at
        FROM organization_invite i
       WHERE i.organization_id = ${course.org_id}
         AND i.accepted_at IS NULL
         AND i.is_revoked = false
         AND i.metadata -> 'courseIds' ? ${courseId}
       ORDER BY lower(i.email), i.created_at DESC
    `) as unknown as Promise<InviteRaw[]>
  ]);

  return {
    course: {
      id: course.id,
      title: course.title ?? '',
      orgId: course.org_id,
      orgName: course.org_name ?? '',
      orgAvatarUrl: course.org_avatar_url ?? null
    },
    lessonsTotal: Number(course.lessons_total) || 0,
    students: students.map((s) => ({
      groupMemberId: s.group_member_id,
      profileId: s.profile_id,
      fullname: s.fullname ?? '',
      email: s.email ?? '',
      enrolledAt: iso(s.enrolled_at),
      lessonsCompleted: Number(s.lessons_completed) || 0,
      lastLessonCompletedAt: iso(s.last_lesson_completed_at)
    })),
    submissions: submissions.map((s) => ({
      groupMemberId: s.group_member_id,
      exerciseId: s.exercise_id,
      total: s.total === null ? null : Number(s.total),
      statusId: s.status_id === null ? null : Number(s.status_id),
      submittedAt: iso(s.submitted_at)!
    })),
    pendingInvites: invites.map((i) => ({
      email: i.email,
      invitedAt: iso(i.invited_at)!,
      expiresAt: iso(i.expires_at)!
    }))
  };
}

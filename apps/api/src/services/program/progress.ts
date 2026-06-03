import { AppError, ErrorCodes } from '@api/utils/errors';
import { calcPercentageWithRounding } from '@api/services/course/utils';
import { getCourseProgress, getCoursesByProgram, getProgramById, getProgramMembers } from '@cio/db/queries';
import { ROLE } from '@cio/utils/constants';

export interface ProgramProgressSummary {
  totalMembers: number;
  totalCourses: number;
  averageProgress: number;
  /** Number of (member, course) cells at 100%. */
  completedCount: number;
}

export interface ProgramProgressCourse {
  courseId: string;
  title: string;
}

export interface ProgramProgressMember {
  profileId: string;
  fullname: string;
  email: string;
  avatarUrl: string;
  overallProgress: number;
  /** Map of courseId -> progress percentage (0–100). */
  perCourse: Record<string, number>;
}

export interface ProgramProgress {
  summary: ProgramProgressSummary;
  courses: ProgramProgressCourse[];
  members: ProgramProgressMember[];
}

/**
 * Builds a program-wide progress rollup: a summary plus a members × courses
 * matrix of per-course completion percentages. Mirrors the student-overview
 * service (composes getCourseProgress per course) and the compliance-overview
 * response shape (summary + columns + flat member rows).
 *
 * Only STUDENT-role members are included, matching how programs already count
 * students elsewhere. Tutors/admins are excluded from the matrix and stats.
 *
 * Note: this runs M students × C courses getCourseProgress calls (batched via
 * Promise.all). Fine for typical program sizes; for very large programs a
 * single batched SQL aggregate would be more efficient — defer until needed.
 */
export async function getProgramProgress(programId: string): Promise<ProgramProgress> {
  const program = await getProgramById(programId);
  if (!program) {
    throw new AppError('Program not found', ErrorCodes.NOT_FOUND, 404);
  }

  const [members, courses] = await Promise.all([getProgramMembers(programId), getCoursesByProgram(programId)]);

  const studentMembers = members.filter((member) => member.roleId === ROLE.STUDENT && member.profile);
  const courseColumns: ProgramProgressCourse[] = courses.map((row) => ({
    courseId: row.course.id,
    title: row.course.title ?? ''
  }));

  // Flatten (member × course) into one promise list so all progress lookups run
  // concurrently, then regroup by profile.
  const cells = await Promise.all(
    studentMembers.flatMap((member) =>
      courseColumns.map(async (course) => {
        const progress = await getCourseProgress(course.courseId, member.profileId!);
        const percentage = calcPercentageWithRounding(progress.lessonsCompleted, progress.lessonsCount);

        return { profileId: member.profileId!, courseId: course.courseId, percentage };
      })
    )
  );

  const perCourseByProfile = new Map<string, Record<string, number>>();
  for (const cell of cells) {
    const existing = perCourseByProfile.get(cell.profileId) ?? {};
    existing[cell.courseId] = cell.percentage;
    perCourseByProfile.set(cell.profileId, existing);
  }

  let completedCount = 0;
  const programMembers: ProgramProgressMember[] = studentMembers.map((member) => {
    const perCourse = perCourseByProfile.get(member.profileId!) ?? {};
    const values = courseColumns.map((course) => perCourse[course.courseId] ?? 0);
    completedCount += values.filter((value) => value >= 100).length;
    const overallProgress = values.length > 0 ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;

    return {
      profileId: member.profileId!,
      fullname: member.profile?.fullname ?? '',
      email: member.profile?.email ?? '',
      avatarUrl: member.profile?.avatarUrl ?? '',
      overallProgress,
      perCourse
    };
  });

  const averageProgress =
    programMembers.length > 0
      ? Math.round(programMembers.reduce((sum, m) => sum + m.overallProgress, 0) / programMembers.length)
      : 0;

  return {
    summary: {
      totalMembers: programMembers.length,
      totalCourses: courseColumns.length,
      averageProgress,
      completedCount
    },
    courses: courseColumns,
    members: programMembers
  };
}

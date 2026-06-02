import { AppError, ErrorCodes } from '@api/utils/errors';
import { calcPercentageWithRounding, formatLastSeen } from '@api/services/course/utils';
import {
  getCourseProgress,
  getEnrolledProgramsByProfile,
  getProfileById,
  getProfileEnrolledCourses,
  getProfileLastActivity,
  getUserExercisesStats
} from '@cio/db/queries';
import { ROLE } from '@cio/utils/constants';

export interface StudentOverviewCourse {
  courseId: string;
  courseTitle: string;
  roleId: number;
  enrolledAt: string | null;
  certificateEarnedAt: string | null;
  lessonsCount: number;
  lessonsCompleted: number;
  exercisesCount: number;
  exercisesCompleted: number;
  progressPercentage: number;
  averageGrade: number;
  isComplete: boolean;
}

export interface StudentOverviewProgram {
  id: string;
  name: string | null;
  roleId: number;
  courseCount: number;
}

export interface StudentOverview {
  user: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl: string;
    lastSeen: string;
    lastActivityAt: string | null;
  };
  summary: {
    totalCourses: number;
    coursesCompleted: number;
    averageProgress: number;
    averageGrade: number;
    totalPrograms: number;
  };
  courses: StudentOverviewCourse[];
  programs: StudentOverviewProgram[];
}

/**
 * Aggregates a single learner's academic record across all their courses and
 * programs within an org (the "student 360" view). Reuses the per-course
 * progress query and the cross-source last-activity query so the numbers match
 * what the per-course pages already show.
 */
export async function getStudentOverview(profileId: string, organizationId: string): Promise<StudentOverview> {
  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new AppError('User profile not found', ErrorCodes.PROFILE_NOT_FOUND, 404);
  }

  const [enrolledCourses, programs, lastActivityAt] = await Promise.all([
    getProfileEnrolledCourses(profileId, organizationId),
    getEnrolledProgramsByProfile(profileId),
    getProfileLastActivity(profileId)
  ]);

  const courses: StudentOverviewCourse[] = await Promise.all(
    enrolledCourses.map(async (enrolled) => {
      const [progress, exerciseStats] = await Promise.all([
        getCourseProgress(enrolled.courseId, profileId),
        getUserExercisesStats(enrolled.courseId, profileId)
      ]);
      const progressPercentage = calcPercentageWithRounding(progress.lessonsCompleted, progress.lessonsCount);

      // Average grade = earned points / max points across the course's exercises
      // (a true 0–100 percentage), matching the per-course analytics page.
      const earnedPoints = exerciseStats.reduce((sum, exercise) => sum + exercise.score, 0);
      const maxPoints = exerciseStats.reduce((sum, exercise) => sum + exercise.totalPoints, 0);
      const averageGrade = calcPercentageWithRounding(earnedPoints, maxPoints);

      return {
        courseId: enrolled.courseId,
        courseTitle: enrolled.courseTitle,
        roleId: enrolled.roleId,
        enrolledAt: enrolled.enrolledAt,
        certificateEarnedAt: enrolled.certificateEarnedAt,
        lessonsCount: progress.lessonsCount,
        lessonsCompleted: progress.lessonsCompleted,
        exercisesCount: progress.exercisesCount,
        exercisesCompleted: progress.exercisesCompleted,
        progressPercentage,
        averageGrade,
        isComplete: progress.lessonsCount > 0 && progress.lessonsCompleted >= progress.lessonsCount
      };
    })
  );

  // Summary aggregates are computed over courses where the learner is a student,
  // so tutor/admin memberships don't skew completion rates.
  const studentCourses = courses.filter((course) => course.roleId === ROLE.STUDENT);
  const coursesCompleted = studentCourses.filter((course) => course.isComplete).length;
  const totalProgress = studentCourses.reduce((sum, course) => sum + course.progressPercentage, 0);
  const averageProgress = studentCourses.length > 0 ? Math.round(totalProgress / studentCourses.length) : 0;
  // Mean of per-course grade percentages (each already 0–100).
  const totalGrade = studentCourses.reduce((sum, course) => sum + course.averageGrade, 0);
  const averageGrade = studentCourses.length > 0 ? Math.round(totalGrade / studentCourses.length) : 0;

  return {
    user: {
      id: profileId,
      fullName: profile.fullname || '',
      email: profile.email || '',
      avatarUrl: profile.avatarUrl || '',
      lastSeen: formatLastSeen(lastActivityAt),
      lastActivityAt
    },
    summary: {
      totalCourses: studentCourses.length,
      coursesCompleted,
      averageProgress,
      averageGrade,
      totalPrograms: programs.length
    },
    courses,
    programs: programs.map((program) => ({
      id: program.id,
      name: program.name,
      roleId: program.roleId,
      courseCount: program.courseCount
    }))
  };
}

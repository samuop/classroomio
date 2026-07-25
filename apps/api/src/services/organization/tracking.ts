import {
  getLastActivityForProfiles
} from '@cio/db/queries';
import {
  getOrgTrackingByCourse,
  getOrgTrackingByStudent,
  type TrackingCourseRow,
  type TrackingStudentRow
} from '@cio/db/queries/organization';

import { getAtRiskLearners } from '@api/services/organization/at-risk';

/**
 * Tracking hub overview — the unified student-tracking data source.
 *
 * Composes the canonical aggregated progress/grade (getOrgTracking*) with the
 * existing at-risk engine (so a learner's "estado" here matches the En Riesgo
 * tab exactly) and last-activity. Returns both reading axes — Por alumno and
 * Por curso — plus the summary KPIs, in one call.
 */

export type TrackingStatus = 'ok' | 'attention' | 'at_risk';

export interface TrackingStudentView extends TrackingStudentRow {
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  status: TrackingStatus;
  /** Risk reasons from the at-risk engine (empty when not at risk). */
  reasons: string[];
}

export interface TrackingOverview {
  summary: {
    totalStudents: number;
    atRiskCount: number;
    averageProgress: number;
    totalCourses: number;
    /** Average enrolments per student (courses per person). */
    enrolmentsPerStudent: number;
  };
  byStudent: TrackingStudentView[];
  byCourse: TrackingCourseRow[];
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export async function getTrackingOverview(orgId: string): Promise<TrackingOverview> {
  // Run the three sources in parallel; each is already batched internally.
  const [byStudent, byCourse, atRisk] = await Promise.all([
    getOrgTrackingByStudent(orgId),
    getOrgTrackingByCourse(orgId),
    getAtRiskLearners(orgId)
  ]);

  // Index at-risk reasons by profile so status/reasons match the En Riesgo tab.
  const reasonsByProfile = new Map<string, string[]>();
  for (const learner of atRisk.learners) {
    reasonsByProfile.set(learner.profileId, learner.reasons);
  }

  const activity = await getLastActivityForProfiles(byStudent.map((s) => s.profileId));
  const now = Date.now();

  const studentViews: TrackingStudentView[] = byStudent.map((s) => {
    const lastActivityAt = activity.get(s.profileId) ?? null;
    const reasons = reasonsByProfile.get(s.profileId) ?? [];

    // "attention" = has at least one soft signal but the at-risk engine did not
    // flag it (kept simple: at-risk wins, otherwise low progress is attention).
    let status: TrackingStatus = 'ok';
    if (reasons.length > 0) {
      status = 'at_risk';
    } else if (s.averageProgress < 40) {
      status = 'attention';
    }

    return {
      ...s,
      lastActivityAt,
      daysSinceActivity: daysSince(lastActivityAt, now),
      status,
      reasons
    };
  });

  const totalStudents = studentViews.length;
  const totalEnrolments = studentViews.reduce((sum, s) => sum + s.coursesCount, 0);
  const averageProgress =
    totalStudents > 0
      ? Math.round(studentViews.reduce((sum, s) => sum + s.averageProgress, 0) / totalStudents)
      : 0;
  const enrolmentsPerStudent =
    totalStudents > 0 ? Math.round((totalEnrolments / totalStudents) * 10) / 10 : 0;

  return {
    summary: {
      totalStudents,
      atRiskCount: atRisk.summary.atRiskCount,
      averageProgress,
      totalCourses: byCourse.length,
      enrolmentsPerStudent
    },
    byStudent: studentViews,
    byCourse
  };
}

import {
  getLastActivityForProfiles
} from '@cio/db/queries';
import {
  getOrgTrackingByCourse,
  getOrgTrackingByStudent,
  getTrackingScopeCompanies,
  type TrackingCourseRow,
  type TrackingScopeCompany,
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
 *
 * A consultancy reads its client companies together. That is not a nicety: its
 * own organisation holds the master courses and no learners at all, so scoped to
 * itself the page it exists for shows zero of everything.
 */

export type TrackingStatus = 'ok' | 'attention' | 'at_risk';

export interface TrackingStudentView extends TrackingStudentRow {
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  status: TrackingStatus;
  /** Risk reasons from the at-risk engine (empty when not at risk). */
  reasons: string[];
}

export type TrackingScope = 'own' | 'all';

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
  /** What this response actually covers, so the page can say so. */
  scope: TrackingScope;
  companies: TrackingScopeCompany[];
  /** True when the asking company has client companies at all. */
  hasClients: boolean;
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export async function getTrackingOverview(orgId: string, scope: TrackingScope = 'own'): Promise<TrackingOverview> {
  const companies = await getTrackingScopeCompanies(orgId);
  const hasClients = companies.some((company) => company.isClient);
  const covered = scope === 'all' ? companies : companies.filter((company) => company.id === orgId);
  const orgIds = covered.map((company) => company.id);

  // Run the sources in parallel; the two roll-ups are one SQL pass each.
  //
  // At-risk is still one call per company: its engine reads that org's
  // thresholds and its compliance rows, both of which are per-organisation, so
  // a client with stricter settings must be judged by its own. Cost is O(orgs ×
  // students × courses) — fine for a consultancy's client list, and the place to
  // look first if this page ever gets slow.
  const [byStudent, byCourse, atRiskPerOrg] = await Promise.all([
    getOrgTrackingByStudent(orgIds),
    getOrgTrackingByCourse(orgIds),
    Promise.all(orgIds.map(async (id) => ({ id, result: await getAtRiskLearners(id) })))
  ]);

  // Keyed by company AND profile: the same person in two client companies can be
  // at risk in one and fine in the other, and each row must say which.
  const reasonsByKey = new Map<string, string[]>();
  let atRiskCount = 0;
  for (const { id, result } of atRiskPerOrg) {
    atRiskCount += result.summary.atRiskCount;
    for (const learner of result.learners) {
      reasonsByKey.set(`${id}:${learner.profileId}`, learner.reasons);
    }
  }

  const activity = await getLastActivityForProfiles(byStudent.map((s) => s.profileId));
  const now = Date.now();

  const studentViews: TrackingStudentView[] = byStudent.map((s) => {
    const lastActivityAt = activity.get(s.profileId) ?? null;
    const reasons = reasonsByKey.get(s.key) ?? [];

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
      atRiskCount,
      averageProgress,
      totalCourses: byCourse.length,
      enrolmentsPerStudent
    },
    byStudent: studentViews,
    byCourse,
    scope,
    companies: covered,
    hasClients
  };
}

import { AppError } from '@api/utils/errors';
import { DEFAULT_AT_RISK_SETTINGS, type TAtRiskOverview, type TAtRiskSettings } from '@cio/utils/validation/at-risk';
import {
  getOrgAtRiskSettings,
  getOrgStudentProfiles,
  getOrganizationById,
  updateOrganization
} from '@cio/db/queries/organization';
import { getLastActivityForProfiles } from '@cio/db/queries';
import { getOrgComplianceLearnerRows } from '@cio/db/queries/course/compliance';

import { getStudentOverview } from '@api/services/student/overview';

/** Compliance statuses that count as a risk signal (anything not healthy/administrative). */
const AT_RISK_COMPLIANCE_STATUSES = new Set(['expiring_soon', 'in_grace_period', 'non_compliant']);

export type AtRiskReason = 'inactive' | 'low_progress' | 'low_grade' | 'compliance';

export interface AtRiskLearnerRow {
  profileId: string;
  fullname: string;
  email: string;
  avatarUrl: string;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  averageProgress: number;
  averageGrade: number;
  reasons: AtRiskReason[];
}

export interface AtRiskOverview {
  thresholds: TAtRiskSettings;
  summary: {
    totalStudents: number;
    atRiskCount: number;
    byReason: Record<AtRiskReason, number>;
  };
  learners: AtRiskLearnerRow[];
}

/** Stored thresholds merged onto the defaults (single source of truth = DEFAULT_AT_RISK_SETTINGS). */
export async function getOrgAtRiskSettingsService(orgId: string): Promise<TAtRiskSettings> {
  const stored = await getOrgAtRiskSettings(orgId);
  return { ...DEFAULT_AT_RISK_SETTINGS, ...(stored ?? {}) };
}

/**
 * Merges the patch into the stored at-risk settings. Reuses the deep-merging
 * `updateOrganization` so `settings.signup` (and any other top-level key) is
 * preserved — only `settings.atRisk` is touched.
 */
export async function updateOrgAtRiskSettingsService(
  orgId: string,
  patch: Partial<TAtRiskSettings>
): Promise<TAtRiskSettings> {
  const org = await getOrganizationById(orgId);
  if (!org) {
    throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
  }

  const current = await getOrgAtRiskSettingsService(orgId);
  const next: TAtRiskSettings = { ...current, ...patch };

  await updateOrganization(orgId, { settings: { atRisk: next } });

  return next;
}

/**
 * Scans every student in the org and flags those tripping at least one risk
 * signal. The two cross-learner signals (last activity, compliance) are fetched
 * once per request; the per-learner progress/grade comes from `getStudentOverview`
 * batched with `Promise.all`. Scan cost is O(students × courses); a single
 * aggregated SQL query would be the future optimization for very large orgs.
 */
export async function getAtRiskLearners(orgId: string, overrides?: TAtRiskOverview): Promise<AtRiskOverview> {
  const thresholds = await getOrgAtRiskSettingsService(orgId);
  if (overrides) {
    if (overrides.inactiveDays !== undefined) thresholds.inactiveDays = overrides.inactiveDays;
    if (overrides.lowProgressPct !== undefined) thresholds.lowProgressPct = overrides.lowProgressPct;
    if (overrides.lowGradePct !== undefined) thresholds.lowGradePct = overrides.lowGradePct;
  }

  const students = await getOrgStudentProfiles(orgId);
  const totalStudents = students.length;

  const byReason: Record<AtRiskReason, number> = {
    inactive: 0,
    low_progress: 0,
    low_grade: 0,
    compliance: 0
  };

  if (totalStudents === 0) {
    return { thresholds, summary: { totalStudents: 0, atRiskCount: 0, byReason }, learners: [] };
  }

  const profileIds = students.map((student) => student.profileId);

  // Cross-learner signals: fetched once, not per learner.
  const [activityByProfile, complianceRows] = await Promise.all([
    getLastActivityForProfiles(profileIds),
    getOrgComplianceLearnerRows(orgId)
  ]);

  const profilesWithComplianceRisk = new Set<string>();
  for (const row of complianceRows) {
    if (row.profileId && AT_RISK_COMPLIANCE_STATUSES.has(row.status)) {
      profilesWithComplianceRisk.add(row.profileId);
    }
  }

  const now = Date.now();
  const overviews = await Promise.all(
    students.map((student) => getStudentOverview(student.profileId, orgId))
  );

  const learners: AtRiskLearnerRow[] = [];

  for (let i = 0; i < students.length; i++) {
    const student = students[i]!;
    const overview = overviews[i]!;

    const lastActivityAt = activityByProfile.get(student.profileId) ?? null;
    const daysSinceActivity =
      lastActivityAt !== null ? Math.floor((now - new Date(lastActivityAt).getTime()) / 86_400_000) : null;

    const reasons: AtRiskReason[] = [];

    // Inactive: never active, or last activity older than the threshold.
    if (daysSinceActivity === null || daysSinceActivity > thresholds.inactiveDays) {
      reasons.push('inactive');
    }
    if (overview.summary.averageProgress < thresholds.lowProgressPct) {
      reasons.push('low_progress');
    }
    if (overview.summary.averageGrade < thresholds.lowGradePct) {
      reasons.push('low_grade');
    }
    if (profilesWithComplianceRisk.has(student.profileId)) {
      reasons.push('compliance');
    }

    if (reasons.length === 0) continue;

    for (const reason of reasons) {
      byReason[reason] += 1;
    }

    learners.push({
      profileId: student.profileId,
      fullname: student.fullname,
      email: student.email,
      avatarUrl: student.avatarUrl,
      lastActivityAt,
      daysSinceActivity,
      averageProgress: overview.summary.averageProgress,
      averageGrade: overview.summary.averageGrade,
      reasons
    });
  }

  return {
    thresholds,
    summary: { totalStudents, atRiskCount: learners.length, byReason },
    learners
  };
}

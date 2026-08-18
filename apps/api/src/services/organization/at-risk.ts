import { AppError } from '@api/utils/errors';
import { DEFAULT_AT_RISK_SETTINGS, type TAtRiskOverview, type TAtRiskSettings } from '@cio/utils/validation/at-risk';
import {
  getOrgAtRiskSettings,
  getOrgStudentProfiles,
  getOrganizationById,
  getTrackingScopeCompanies,
  updateOrganization,
  type TrackingScopeCompany
} from '@cio/db/queries/organization';

import type { TrackingScope } from '@api/services/organization/tracking';
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

/** A learner row that says which company it came from. */
export interface AtRiskScopedLearnerRow extends AtRiskLearnerRow {
  orgId: string;
  orgName: string;
}

export interface AtRiskScopedOverview extends Omit<AtRiskOverview, 'learners'> {
  learners: AtRiskScopedLearnerRow[];
  scope: TrackingScope;
  companies: TrackingScopeCompany[];
  hasClients: boolean;
  /**
   * Per-company totals.
   *
   * `totalStudents` cannot be recovered from `learners` — that list only holds
   * the flagged ones — so filtering the screen to one company would otherwise
   * have no honest denominator for "8 de N alumnos".
   */
  perCompany: Array<{ orgId: string; orgName: string; totalStudents: number; atRiskCount: number }>;
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

/**
 * The same scan, optionally across the asking company's client companies.
 *
 * Run once per company rather than as one widened query, because the thresholds
 * and the compliance rows the scan reads are per-organisation: a client with
 * stricter settings has to be judged by its own, not by the consultancy's.
 *
 * The thresholds reported back are the asking company's — they are what the
 * settings screen edits. When clients differ, each client's rows were still
 * decided by that client's numbers.
 */
export async function getAtRiskLearnersForScope(
  orgId: string,
  scope: TrackingScope,
  overrides?: TAtRiskOverview
): Promise<AtRiskScopedOverview> {
  const companies = await getTrackingScopeCompanies(orgId);
  const hasClients = companies.some((company) => company.isClient);
  const covered = scope === 'all' ? companies : companies.filter((company) => company.id === orgId);

  const results = await Promise.all(
    covered.map(async (company) => ({ company, overview: await getAtRiskLearners(company.id, overrides) }))
  );

  const byReason: Record<AtRiskReason, number> = { inactive: 0, low_progress: 0, low_grade: 0, compliance: 0 };
  const learners: AtRiskScopedLearnerRow[] = [];
  const perCompany: AtRiskScopedOverview['perCompany'] = [];
  let totalStudents = 0;
  let atRiskCount = 0;

  for (const { company, overview } of results) {
    totalStudents += overview.summary.totalStudents;
    atRiskCount += overview.summary.atRiskCount;
    perCompany.push({
      orgId: company.id,
      orgName: company.name,
      totalStudents: overview.summary.totalStudents,
      atRiskCount: overview.summary.atRiskCount
    });

    for (const reason of Object.keys(byReason) as AtRiskReason[]) {
      byReason[reason] += overview.summary.byReason[reason];
    }

    for (const learner of overview.learners) {
      learners.push({ ...learner, orgId: company.id, orgName: company.name });
    }
  }

  learners.sort((a, b) => a.orgName.localeCompare(b.orgName) || b.reasons.length - a.reasons.length);

  const thresholds = results.find(({ company }) => company.id === orgId)?.overview.thresholds
    ?? (await getOrgAtRiskSettingsService(orgId));

  return {
    thresholds,
    summary: { totalStudents, atRiskCount, byReason },
    learners,
    scope,
    companies: covered,
    hasClients,
    perCompany
  };
}

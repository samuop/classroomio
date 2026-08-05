export const PLAN = {
  BASIC: 'BASIC',
  EARLY_ADOPTER: 'EARLY_ADOPTER',
  ENTERPRISE: 'ENTERPRISE'
};

export const PLAN_NAMES = {
  [PLAN.BASIC]: 'Free',
  [PLAN.EARLY_ADOPTER]: 'Early Adopter',
  [PLAN.ENTERPRISE]: 'Enterprise'
};

export const FEATURES = {
  BACIC_STUDENTS_50: 'BACIC_STUDENTS_50',
  EA_STUDENTS_10000: 'EA_STUDENTS_10000',
  EA_VIDEO_UPLOAD: 'EA_VIDEO_UPLOAD',
  EA_CERTIFICATE: 'EA_CERTIFICATE',
  EA_UPCOMING_FEATURES: 'EA_UPCOMING_FEATURES',
  ENTERPRISE_STUDENTS_UNLIMITED: 'ENTERPRISE_STUDENTS_UNLIMITED',
  ENTERPRISE_CUSTOM_DOMAIN: 'ENTERPRISE_CUSTOM_DOMAIN',
  ENTERPRISE_MULTI_WORKSPACE: 'ENTERPRISE_MULTI_WORKSPACE'
};

export const BASIC_FEATURES = [FEATURES.BACIC_STUDENTS_50];

export const EARYL_ADOPTER_FEATURES = [
  ...BASIC_FEATURES,
  FEATURES.EA_STUDENTS_10000,
  FEATURES.EA_VIDEO_UPLOAD,
  FEATURES.EA_CERTIFICATE,
  FEATURES.EA_UPCOMING_FEATURES
];

export const ENTERPRISE_FEATURES = [
  ...EARYL_ADOPTER_FEATURES,
  FEATURES.ENTERPRISE_STUDENTS_UNLIMITED,
  FEATURES.ENTERPRISE_CUSTOM_DOMAIN,
  FEATURES.ENTERPRISE_MULTI_WORKSPACE
];

export const PLANS_BY_FEATURE = {
  [PLAN.BASIC]: BASIC_FEATURES,
  [PLAN.EARLY_ADOPTER]: EARYL_ADOPTER_FEATURES,
  [PLAN.ENTERPRISE]: ENTERPRISE_FEATURES
};

/**
 * Total workspaces (primary + secondaries) allowed per plan. `null` means
 * unlimited — not `Infinity`, which JSON.stringify turns into `null` anyway on
 * the way to the browser, so the honest value travels instead of an accident.
 *
 * Multi-workspace is Enterprise-only. On Enterprise it is uncapped because a
 * consultancy opens one workspace per client company: how many clients they win
 * is their business, and a cap there is a wall in the middle of their growth.
 */
export const WORKSPACES_INCLUDED: Record<string, number | null> = {
  [PLAN.BASIC]: 1,
  [PLAN.EARLY_ADOPTER]: 1,
  [PLAN.ENTERPRISE]: null
};

/**
 * Reads an allowance out of a plan→allowance table, keeping apart two absences
 * that `??` would collapse into one: a `null` entry is a plan with no cap,
 * while a missing entry is a plan we do not recognise and cap at one.
 *
 * Collapsing them is not a cosmetic slip. The daily over-allowance sweep reads
 * this table, so reading "uncapped" as "one" marks every account that has any
 * secondary workspace as an offender and locks all of them read-only.
 */
export function resolveWorkspaceAllowance(
  allowanceByPlan: Record<string, number | null>,
  planName: string | null | undefined
): number | null {
  const configured = allowanceByPlan[planName ?? ''];

  return configured === undefined ? 1 : configured;
}

export function getWorkspaceAllowance(planName: string | null | undefined): number | null {
  return resolveWorkspaceAllowance(WORKSPACES_INCLUDED, planName);
}

export function canCreateWorkspaces(planName: string | null | undefined): boolean {
  return planName === PLAN.ENTERPRISE;
}

import { AppError, ErrorCodes } from '@api/utils/errors';
import { isSelectableChatModel } from '@api/services/platform/settings';
import {
  getPlatformOrganizationDetail,
  listPlatformOrganizations,
  setPlatformOrganizationPlan,
  setPlatformOrganizationSuspension,
  updatePlatformOrganization,
  type ListPlatformOrgsParams,
  type PlatformPlanName
} from '@cio/db/queries/platform';
import {
  assertSupportedCustomDomain,
  connectDomain,
  normalizeCustomDomain,
  refreshDomain,
  removeDomain,
  type DomainSetupResult
} from '@api/services/org/domain';

import { getProfileByEmail, markUserAndProfileEmailVerified, updateProfile } from '@cio/db/queries/auth';

import type { TPlatformCreateOrg } from '@cio/utils/validation/platform';
import { auth } from '@cio/db/auth';
import { checkSiteNameExists } from '@cio/db/queries/organization';
import { createOrganizationWithOwner } from '@api/services/onboarding';
import { getCourseBaseUrl } from '@api/services/widget-payload';
import { updateOrg } from '@api/services/organization';

/** Start of the current calendar month in ISO form (for "tokens this period"). */
function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function listOrganizations(params: Omit<ListPlatformOrgsParams, 'since'>) {
  const since = startOfCurrentMonthIso();
  const { items, total } = await listPlatformOrganizations({ ...params, since });

  return {
    items,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit)
    }
  };
}

export async function getOrganizationDetail(orgId: string) {
  const detail = await getPlatformOrganizationDetail(orgId);
  if (!detail) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  // The tenant subdomain (`<siteName>.<tenant root>`) is derived from siteName —
  // no per-org setup or Approximated needed. A custom domain, when set, wins.
  const tenantUrl = getCourseBaseUrl(detail.siteName ?? '', null);

  return {
    ...detail,
    tenantUrl,
    domains: {
      tenantUrl,
      customDomain: detail.customDomain,
      isCustomDomainVerified: detail.isCustomDomainVerified ?? false
    }
  };
}

export async function updateOrganization(orgId: string, data: { name?: string }) {
  const updated = await updatePlatformOrganization(orgId, data);
  if (!updated) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  return updated;
}

export async function suspendOrganization(orgId: string, suspend: boolean, readOnlyUntil?: string | null) {
  const updated = await setPlatformOrganizationSuspension(orgId, suspend, readOnlyUntil);
  if (!updated) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  return updated;
}

/**
 * Assigns a plan to an organization (platform admin action). Changing the plan
 * immediately changes its token allowance, student limit, and feature access.
 */
export async function setOrganizationPlan(
  orgId: string,
  planName: PlatformPlanName,
  aiTokenAllowance?: number | null,
  aiModel?: string | null
) {
  // Checked against the same list the panel offers (Google's, when it answers),
  // so a model can never be offered and then rejected on save.
  if (typeof aiModel === 'string' && !(await isSelectableChatModel(aiModel))) {
    throw new AppError(`Unsupported chat model: ${aiModel}`, ErrorCodes.VALIDATION_ERROR, 400);
  }

  const result = await setPlatformOrganizationPlan(orgId, planName, aiTokenAllowance, aiModel);
  if (!result) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  return result;
}

/**
 * Creates the owner's account when `ownerEmail` belongs to nobody yet.
 *
 * The signup goes through Better Auth rather than writing `user` and `account`
 * rows here, so the password hashing stays defined in exactly one place
 * (packages/db/src/auth/email-password.ts) and the `user.create` hook still
 * gets to build the profile. Hand-rolling the rows would fork both.
 *
 * The email is marked verified because a platform admin typing a client's
 * address IS the verification, and an unverified profile lands in a dashboard
 * whose interactions are disabled until the modal is satisfied — the account
 * would exist and still be unusable.
 */
async function provisionOwnerAccount(input: TPlatformCreateOrg & { ownerPassword: string }) {
  await auth.api.signUpEmail({
    body: {
      email: input.ownerEmail,
      password: input.ownerPassword,
      name: input.ownerName ?? input.ownerEmail.split('@')[0]
    }
  });

  const profile = await getProfileByEmail(input.ownerEmail);
  if (!profile) {
    throw new AppError('The owner account was created but its profile is missing', ErrorCodes.INTERNAL_ERROR, 500);
  }

  await markUserAndProfileEmailVerified(profile.id);

  // The profile hook names people after the local part of their email, which
  // reads badly for a client's admin. Use the given name when there is one.
  if (input.ownerName) {
    await updateProfile(profile.id, { fullname: input.ownerName });
  }

  return { ...profile, fullname: input.ownerName ?? profile.fullname };
}

/**
 * Creates an org and assigns a user (by email) as its admin owner, creating
 * that account first when a temporary password is supplied.
 */
export async function createOrganization(input: TPlatformCreateOrg) {
  const existingProfile = await getProfileByEmail(input.ownerEmail);

  if (!existingProfile && !input.ownerPassword) {
    throw new AppError(
      `No user found with email '${input.ownerEmail}'. Set a temporary password to create the account, or have them sign up first.`,
      ErrorCodes.PROFILE_NOT_FOUND,
      404,
      'ownerEmail'
    );
  }

  // Check the site name before creating any account. `createOrganizationWithOwner`
  // checks it too, but by then the owner would already exist: a retry with a
  // corrected site name finds that account and silently ignores the new
  // temporary password, leaving the operator handing over a dead one.
  if (!existingProfile && (await checkSiteNameExists(input.siteName))) {
    throw new AppError(`Site name '${input.siteName}' already exists`, ErrorCodes.SITENAME_EXISTS, 409, 'siteName');
  }

  const ownerProfile =
    existingProfile ?? (await provisionOwnerAccount({ ...input, ownerPassword: input.ownerPassword! }));

  const result = await createOrganizationWithOwner(ownerProfile.id, {
    fullname: ownerProfile.fullname,
    orgName: input.orgName,
    siteName: input.siteName
  });

  // `createOrganizationWithOwner` only assigns a plan on self-hosted instances,
  // where the single org is implicitly Enterprise. Multi-tenant deployments run
  // with that flag off, so a workspace created here would otherwise start with
  // no allowance and gated features.
  await setPlatformOrganizationPlan(result.organization.id, input.planName);

  return result.organization;
}

async function assertOrgExists(orgId: string) {
  const detail = await getPlatformOrganizationDetail(orgId);
  if (!detail) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  return detail;
}

/**
 * Connects (or reconnects) a custom domain for any organization and persists the
 * result. Reuses the org-level Approximated integration; the only difference is
 * the target org is chosen by the platform admin rather than the request's
 * active org. `empresa1.tensor.com.ar`-style tenant subdomains are NOT
 * managed here — those resolve automatically from siteName.
 */
export async function connectOrgCustomDomain(orgId: string, domain: string): Promise<DomainSetupResult> {
  await assertOrgExists(orgId);

  const normalized = normalizeCustomDomain(domain);
  assertSupportedCustomDomain(normalized);

  const result = await connectDomain(normalized);
  await updateOrg(orgId, { customDomain: normalized, isCustomDomainVerified: result.verified });

  return result;
}

export async function refreshOrgCustomDomain(orgId: string): Promise<DomainSetupResult> {
  const org = await assertOrgExists(orgId);
  if (!org.customDomain) {
    throw new AppError('This organization has no custom domain to refresh', ErrorCodes.VALIDATION_ERROR, 400, 'domain');
  }

  const result = await refreshDomain(org.customDomain);
  await updateOrg(orgId, { isCustomDomainVerified: result.verified });

  return result;
}

export async function removeOrgCustomDomain(orgId: string): Promise<DomainSetupResult> {
  const org = await assertOrgExists(orgId);
  if (!org.customDomain) {
    throw new AppError('This organization has no custom domain to remove', ErrorCodes.VALIDATION_ERROR, 400, 'domain');
  }

  const result = await removeDomain(org.customDomain);
  await updateOrg(orgId, { customDomain: null, isCustomDomainVerified: false });

  return result;
}

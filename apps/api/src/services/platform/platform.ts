import { AppError, ErrorCodes } from '@api/utils/errors';
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

import type { TPlatformCreateOrg } from '@cio/utils/validation/platform';
import { createOrganizationWithOwner } from '@api/services/onboarding';
import { getCourseBaseUrl } from '@api/services/widget-payload';
import { getProfileByEmail } from '@cio/db/queries/auth';
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
export async function setOrganizationPlan(orgId: string, planName: PlatformPlanName) {
  const result = await setPlatformOrganizationPlan(orgId, planName);
  if (!result) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  return result;
}

/**
 * Creates an org and assigns an existing user (by email) as its admin owner.
 * The owner must already have an account — platform creation does not invite
 * new users (that stays in the org-level team-invite flow).
 */
export async function createOrganization(input: TPlatformCreateOrg) {
  const ownerProfile = await getProfileByEmail(input.ownerEmail);
  if (!ownerProfile) {
    throw new AppError(
      `No user found with email '${input.ownerEmail}'. The owner must have an account before you can assign the workspace.`,
      ErrorCodes.PROFILE_NOT_FOUND,
      404,
      'ownerEmail'
    );
  }

  const result = await createOrganizationWithOwner(ownerProfile.id, {
    fullname: ownerProfile.fullname,
    orgName: input.orgName,
    siteName: input.siteName
  });

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

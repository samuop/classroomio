import type { Context } from 'hono';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { ROLE } from '@cio/utils/constants';

/**
 * Asserts the caller may read the organisation named in a REQUEST PARAMETER.
 *
 * The `/dash/*` routes take `orgId` in the query string while their middleware
 * only ever checked `cio-org-id`. Nothing tied the two together, so an admin of
 * one company could read another company's dashboard by editing the query — 
 * verified against a live server: an admin of Cliente Norte pulled Cliente Sur's
 * student count, course list and completion rates.
 *
 * The check reuses `orgRoles` from the session, which is also where the
 * consultancy → client derivation already lives (`getUserOrgRolesMap`). So a
 * consultancy admin legitimately reading one of its clients still passes, and
 * that is deliberate: it is the same permission the tracking hub relies on.
 */
export function assertOrgAccess(
  c: Context,
  requestedOrgId: string | undefined,
  options: { requireAdmin?: boolean } = {}
) {
  // Two of these routes accept `siteName` INSTEAD of `orgId`, and the service
  // then resolves the site name to an organisation and returns exactly the same
  // private figures. Skipping the check when `orgId` is absent would leave the
  // hole open through the other door, so an authenticated dashboard route has to
  // name the organisation by id. Nothing calls the site-name form: on
  // /login-activity it was already broken (the org id was asserted non-null and
  // passed through undefined), and /dash/stats has no caller at all.
  if (!requestedOrgId) {
    throw new AppError('An organization id is required', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const roles = (c.get('orgRoles') as Record<string, number> | undefined) ?? {};
  const role = roles[requestedOrgId];

  if (role === undefined) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  if (options.requireAdmin && role !== ROLE.ADMIN) {
    throw new AppError(
      'Only organization admins can perform this action',
      ErrorCodes.ORG_TEAM_NOT_AUTHORIZED,
      403
    );
  }
}

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
export function assertOrgAccess(c: Context, requestedOrgId: string, options: { requireAdmin?: boolean } = {}) {
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

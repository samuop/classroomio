import { AppError, ErrorCodes } from '@api/utils/errors';

import { ROLE } from '@cio/utils/constants';

/**
 * Authorizes copying a course out of one organization and into another.
 *
 * Both ends need checking and neither used to be. The membership middleware
 * only proves the caller belongs to whatever organization the request names in
 * its header, while the course being copied and the organization it lands in
 * both arrive in the payload — so a member of any organization could copy a
 * course they cannot see into a company they have nothing to do with. Once a
 * consultancy's client companies live side by side, that is one client's
 * material appearing inside another's.
 *
 * Reading the source is enough to copy *from* it; landing a course in a company
 * is an administrative act *there*.
 *
 * Kept apart from the cloning itself so the rule can be read, and tested,
 * without the machinery that copies lessons and exercises.
 */
export function assertCourseDeliveryAllowed(
  orgRoles: Record<string, number>,
  sourceOrgId: string | null,
  destinationOrgId: string
): void {
  if (!sourceOrgId || orgRoles[sourceOrgId] === undefined) {
    // Deliberately "not found" rather than "forbidden": whether a course exists
    // is not something a stranger to its organization should learn from the
    // difference between two errors.
    throw new AppError('Course not found', ErrorCodes.COURSE_NOT_FOUND, 404);
  }

  if (orgRoles[destinationOrgId] !== ROLE.ADMIN) {
    throw new AppError(
      'Only an admin of the destination organization can copy a course into it',
      ErrorCodes.ORG_TEAM_NOT_AUTHORIZED,
      403,
      'organizationId'
    );
  }
}

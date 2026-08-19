import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  createOrganizationMember,
  getOrganizationById,
  getOrganizationByProfileId,
  getOrganizationMemberIdByOrgAndProfile
} from '@cio/db/queries/organization';

import { ROLE } from '@cio/utils/constants';
import { getProfileById } from '@cio/db/queries/auth';

interface OrgSignupSettings {
  signup?: {
    inviteOnly?: boolean;
  };
}

export interface AutoEnrollResult {
  alreadyMember: boolean;
}

/**
 * Auto-enroll the authenticated user as a STUDENT in the given org. Used by
 * the dashboard when a newly-signed-in user lands on a tenant site they
 * aren't yet a member of (free-tier `<org>.myclassroomio.com` or a verified
 * BYOD domain).
 *
 * Idempotent: existing members get an `alreadyMember: true` no-op so invited
 * admins/tutors don't get downgraded.
 *
 * Respects the same org policies as `signupGuard` does for email/password
 * signups: `disableSignup` and `settings.signup.inviteOnly` both block the
 * insert.
 */
export async function autoEnrollStudent(userId: string, orgId: string): Promise<AutoEnrollResult> {
  const existingMemberId = await getOrganizationMemberIdByOrgAndProfile(orgId, userId);
  if (existingMemberId) {
    return { alreadyMember: true };
  }

  const organization = await getOrganizationById(orgId);
  if (!organization) {
    throw new AppError('Organization not found', ErrorCodes.NOT_FOUND, 404);
  }

  // Ya pertenece a esta cuenta por otra de sus empresas: no lo inscribas.
  //
  // En el dominio de una consultora conviven la consultora y sus empresas
  // cliente. A alguien invitado como administrador de una empresa cliente,
  // entrar por ese dominio lo anotaba de ALUMNO de la consultora: le ensuciaba
  // la audiencia a quien no correspondía y, peor, lo volvía miembro de la dueña
  // del dominio, que es la empresa en la que el dashboard lo hacía aterrizar —
  // veía la consultora, con rol de alumno, en vez de su propia empresa.
  //
  // La comprobación de arriba no alcanza porque mira SOLO esta empresa.
  const accountRootId = organization.parentOrganizationId ?? organization.id;
  const memberships = await getOrganizationByProfileId(userId);
  const belongsToAccount = memberships.some((org) => (org.parentOrganizationId ?? org.id) === accountRootId);

  if (belongsToAccount) {
    return { alreadyMember: true };
  }

  if (organization.disableSignup) {
    throw new AppError('Signup is disabled for this organization', ErrorCodes.FORBIDDEN, 403);
  }

  const settings = organization.settings as OrgSignupSettings | null;
  if (settings?.signup?.inviteOnly) {
    throw new AppError('This organization requires an invitation to join', ErrorCodes.FORBIDDEN, 403);
  }

  const profile = await getProfileById(userId);
  if (!profile?.email) {
    throw new AppError('Profile email not found', ErrorCodes.NOT_FOUND, 404);
  }

  await createOrganizationMember({
    organizationId: orgId,
    profileId: userId,
    email: profile.email,
    roleId: ROLE.STUDENT,
    verified: true
  });

  return { alreadyMember: false };
}

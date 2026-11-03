import type {
  TPublicApiAssignAudienceCourses,
  TPublicApiAudienceMemberParam,
  TPublicApiAudienceQuery,
  TPublicApiCreateAudience,
  TPublicApiUpdateAudience
} from '@cio/utils/validation/public-api';

import {
  assignAudienceToCourses,
  importAudienceMembers,
  updatePendingAudienceMemberEmail
} from '@api/services/organization/audience';
import {
  deleteOrganizationAudienceMember,
  getOrganizationStudentsByEmails,
  revokeActiveOrganizationInvitesByEmails
} from '@cio/db/queries/organization';
import { getOrgAudience, getOrgAudienceMember, removeAudienceMember } from '@api/services/organization';
import { AppError, ErrorCodes } from '@api/utils/errors';

export async function listAudienceService(orgId: string, query: TPublicApiAudienceQuery) {
  return getOrgAudience(orgId, query);
}

export async function createAudienceService(orgId: string, actorId: string | null, payload: TPublicApiCreateAudience) {
  if (!actorId) {
    throw new AppError('Automation actor is required', ErrorCodes.UNAUTHORIZED, 401);
  }

  return importAudienceMembers(
    orgId,
    {
      recipientCsv: payload.email,
      courseIds: payload.courseIds,
      programIds: payload.programIds,
      allCourses: false,
      allPrograms: false,
      sendEmail: payload.sendEmail
    },
    actorId
  );
}

export async function getAudienceMemberService(orgId: string, params: TPublicApiAudienceMemberParam) {
  return getOrgAudienceMember(orgId, params.memberId);
}

export async function assignAudienceCoursesService(orgId: string, payload: TPublicApiAssignAudienceCourses) {
  return assignAudienceToCourses(orgId, payload);
}

export async function removeAudienceService(orgId: string, memberId: number, actorId?: string | null) {
  return removeAudienceMember(orgId, memberId, actorId ?? undefined);
}

/**
 * Saca a un alumno de la organización por su correo exacto y le revoca las invitaciones que tenga sin
 * aceptar. Lo usa Seguimiento (SaaS-RRHH, fase 23) cuando alguien egresa: sin la membresía de la
 * organización ya no entra a sus cursos ni a sus programas. No se borra nada más: su inscripción, su
 * avance y sus certificados quedan, y volver a invitarlo se los devuelve.
 *
 * Por correo y no por `memberId`: el listado busca por parecido (`%…%`, y el `_` es comodín), y un
 * correo en la dirección quedaría en los registros del servidor. Sólo alumnos: al equipo no lo toca.
 * Si no estaba, no es un error: `removed` y `invitesRevoked` en cero.
 */
export async function removeAudienceByEmailService(orgId: string, actorId: string | null, email: string) {
  if (!actorId) {
    throw new AppError('Automation actor is required', ErrorCodes.UNAUTHORIZED, 401);
  }

  const normalized = email.toLowerCase().trim();
  const students = await getOrganizationStudentsByEmails(orgId, [normalized]);

  let removed = 0;
  for (const student of students) {
    if (await deleteOrganizationAudienceMember(orgId, student.memberId)) removed++;
  }
  // También si no era miembro: una invitación sin aceptar le daría la entrada otra vez
  const revoked = await revokeActiveOrganizationInvitesByEmails(orgId, [normalized], actorId);

  return { removed, invitesRevoked: revoked.length };
}

export async function updateAudienceService(
  orgId: string,
  memberId: number,
  actorId: string | null,
  payload: TPublicApiUpdateAudience
) {
  if (!actorId) {
    throw new AppError('Automation actor is required', ErrorCodes.UNAUTHORIZED, 401);
  }

  await updatePendingAudienceMemberEmail(orgId, memberId, payload, actorId);

  return getOrgAudienceMember(orgId, memberId);
}

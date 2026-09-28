import * as schema from '@db/schema';

import { TNewGroup, TNewGroupmember } from '@db/types';
import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { ROLE } from '@cio/utils/constants';
import { db, type DbOrTxClient } from '@db/drizzle';
import { isPlatformAdminCondition } from '../organization/platform-access';

export async function createGroup(values: TNewGroup, dbClient: DbOrTxClient = db) {
  try {
    return dbClient.insert(schema.group).values(values).returning();
  } catch (error) {
    console.error('createGroup error:', error);
    throw new Error(`Failed to create group: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function addGroupMember(values: TNewGroupmember, dbClient: DbOrTxClient = db) {
  try {
    return dbClient.insert(schema.groupmember).values(values).returning();
  } catch (error) {
    console.error('addGroupMember error:', error);
    throw new Error(`Failed to add group member: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function addGroupMembers(values: TNewGroupmember[]) {
  if (values.length === 0) return [];
  try {
    return db.insert(schema.groupmember).values(values).returning();
  } catch (error) {
    console.error('addGroupMembers error:', error);
    throw new Error(`Failed to bulk add group members: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function getExistingGroupMembers(
  pairs: Array<{ groupId: string; profileId: string }>
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  try {
    const groupIds = [...new Set(pairs.map((p) => p.groupId))];
    const profileIds = [...new Set(pairs.map((p) => p.profileId))];

    const rows = await db
      .select({ groupId: schema.groupmember.groupId, profileId: schema.groupmember.profileId })
      .from(schema.groupmember)
      .where(and(inArray(schema.groupmember.groupId, groupIds), inArray(schema.groupmember.profileId, profileIds)));

    return new Set(rows.map((r) => `${r.groupId}:${r.profileId}`));
  } catch (error) {
    console.error('getExistingGroupMembers error:', error);
    throw new Error(
      `Failed to check existing group members: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Enroll users in course groups, skipping any existing memberships.
 * Returns the count of newly inserted memberships.
 */
export async function enrollUsersInCourseGroups(
  groupIds: string[],
  users: Array<{ profileId: string; email?: string }>,
  roleId: number
): Promise<number> {
  if (groupIds.length === 0 || users.length === 0) return 0;

  const pairs = users.flatMap((u) => groupIds.map((groupId) => ({ groupId, profileId: u.profileId })));
  const existingSet = await getExistingGroupMembers(pairs);
  const emailByProfile = new Map(users.map((u) => [u.profileId, u.email]));

  const toInsert = pairs
    .filter((p) => !existingSet.has(`${p.groupId}:${p.profileId}`))
    .map((p) => ({
      groupId: p.groupId,
      roleId,
      profileId: p.profileId,
      email: emailByProfile.get(p.profileId) ?? undefined
    }));

  if (toInsert.length > 0) {
    await addGroupMembers(toInsert);
  }

  return toInsert.length;
}

/**
 * Checks if a profile is already a member of a specific group
 * @param groupId Group ID
 * @param profileId Profile ID
 * @returns true if the user is already a member
 */
export async function isGroupMember(groupId: string, profileId: string): Promise<boolean> {
  try {
    const [existing] = await db
      .select({ id: schema.groupmember.id })
      .from(schema.groupmember)
      .where(and(eq(schema.groupmember.groupId, groupId), eq(schema.groupmember.profileId, profileId)))
      .limit(1);

    return !!existing;
  } catch (error) {
    console.error('isGroupMember error:', error);
    throw new Error(`Failed to check group membership: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Checks if a user is a member of a course's group (any role)
 * @param courseId Course ID
 * @param profileId Profile ID to check
 */
export const isUserCourseMember = async (
  courseId: string,
  profileId: string
): Promise<{ isMember: boolean; organizationId: string | null }> => {
  const result = await db
    .select({ organizationId: schema.group.organizationId, roleId: schema.groupmember.roleId })
    .from(schema.groupmember)
    .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
    .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
    .where(and(eq(schema.course.id, courseId), eq(schema.groupmember.profileId, profileId)))
    .limit(1);

  return {
    isMember: result.length > 0,
    organizationId: result[0].organizationId
  };
};

/**
 * ¿Puede esta persona entrar al curso? Una sola consulta, para el middleware.
 *
 * Entra quien es miembro del grupo del curso (con los roles que se pidan), quien
 * es ADMIN de la empresa dueña del curso, quien es ADMIN de la empresa MADRE de
 * esa empresa, y el operador de plataforma.
 *
 * ── Por qué también la empresa madre ──────────────────────────────────────
 *
 * El permiso de la consultora sobre sus empresas cliente se DERIVA (ser ADMIN
 * de la madre da ADMIN de las hijas, ver `getUserOrgRolesMap`), y toda la app
 * lo lee de la sesión. Estas dos consultas eran la excepción: miraban sólo la
 * fila directa de `organizationmember`. No se notó durante un mes porque la
 * consultora había creado ella misma a sus dos clientes y quedó con fila
 * directa en cada uno. La primera empresa hija creada por OTRA persona (el
 * operador, 2026-09-28) dejó a la ADMIN de la consultora adentro de la empresa
 * pero con 403 en cada curso: «No pudimos abrir este curso».
 *
 * Un solo nivel y sólo desde ADMIN, igual que `orgIdsAdministeredBy`.
 */
async function puedeEntrarAlCurso(courseId: string, profileId: string, rolesDelGrupo?: number[]): Promise<boolean> {
  const adminDeLaMadre = alias(schema.organizationmember, 'admin_de_la_madre');

  const result = await db
    .select({
      groupMemberId: schema.groupmember.id,
      orgMemberId: schema.organizationmember.id,
      parentAdminId: adminDeLaMadre.id
    })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
    .innerJoin(schema.organization, eq(schema.organization.id, schema.group.organizationId))
    .leftJoin(
      schema.groupmember,
      and(
        eq(schema.groupmember.groupId, schema.group.id),
        eq(schema.groupmember.profileId, profileId),
        ...(rolesDelGrupo ? [inArray(schema.groupmember.roleId, rolesDelGrupo)] : [])
      )
    )
    .leftJoin(
      schema.organizationmember,
      and(
        eq(schema.organizationmember.organizationId, schema.group.organizationId),
        eq(schema.organizationmember.profileId, profileId),
        eq(schema.organizationmember.roleId, ROLE.ADMIN)
      )
    )
    .leftJoin(
      adminDeLaMadre,
      and(
        eq(adminDeLaMadre.organizationId, schema.organization.parentOrganizationId),
        eq(adminDeLaMadre.profileId, profileId),
        eq(adminDeLaMadre.roleId, ROLE.ADMIN)
      )
    )
    .where(
      and(
        eq(schema.course.id, courseId),
        or(
          isNotNull(schema.groupmember.id),
          isNotNull(schema.organizationmember.id),
          isNotNull(adminDeLaMadre.id),
          // The platform operator administers every organization (see platform-access.ts).
          isPlatformAdminCondition(profileId)
        )
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Checks if a user is either:
 * - a member of the course's group (any role), OR
 * - an ADMIN of the organization that owns the course's group (or of its parent).
 *
 * This is designed for middleware use to avoid doing multiple DB queries.
 */
export const isUserCourseMemberOrOrgAdmin = async (courseId: string, profileId: string): Promise<boolean> => {
  return puedeEntrarAlCurso(courseId, profileId);
};

/**
 * Gets a user's role in a course's group
 * @param courseId Course ID
 * @param profileId Profile ID to check
 * @returns Role ID if user is a member, null otherwise
 */
export const getUserCourseRole = async (courseId: string, profileId: string): Promise<number | null> => {
  const result = await db
    .select({ roleId: schema.groupmember.roleId })
    .from(schema.groupmember)
    .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
    .where(and(eq(schema.course.id, courseId), eq(schema.groupmember.profileId, profileId)))
    .limit(1);

  return result.length > 0 ? Number(result[0].roleId) : null;
};

/**
 * Checks if a user is either:
 * - a team member (ADMIN or TUTOR) of the course's group, OR
 * - an ADMIN of the organization that owns the course's group.
 *
 * This is designed for middleware use to avoid doing multiple DB queries.
 */
export const isCourseTeamMemberOrOrgAdmin = async (courseId: string, profileId: string): Promise<boolean> => {
  return puedeEntrarAlCurso(courseId, profileId, [ROLE.ADMIN, ROLE.TUTOR]);
};

/**
 * Resolves program-based access to a course.
 * Returns the course group/org context plus the matched program member role.
 */
export async function getCourseProgramAccess(
  courseId: string,
  profileId: string
): Promise<{
  courseId: string;
  courseGroupId: string;
  organizationId: string | null;
  profileEmail: string | null;
  roleId: number;
} | null> {
  try {
    const result = await db
      .select({
        courseId: schema.course.id,
        courseGroupId: schema.group.id,
        organizationId: schema.group.organizationId,
        profileEmail: schema.profile.email,
        roleId: schema.programMember.roleId
      })
      .from(schema.course)
      .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
      .innerJoin(schema.programCourse, eq(schema.course.id, schema.programCourse.courseId))
      .innerJoin(
        schema.program,
        and(eq(schema.program.id, schema.programCourse.programId), eq(schema.program.status, 'ACTIVE'))
      )
      .innerJoin(
        schema.programMember,
        and(eq(schema.programMember.programId, schema.program.id), eq(schema.programMember.profileId, profileId))
      )
      .leftJoin(schema.profile, eq(schema.programMember.profileId, schema.profile.id))
      .where(eq(schema.course.id, courseId))
      .orderBy(asc(schema.programMember.roleId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return {
      ...result[0],
      roleId: Number(result[0].roleId)
    };
  } catch (error) {
    console.error('getCourseProgramAccess error:', error);
    throw new Error(`Failed to get course program access: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets the group member ID for a user in a course
 * @param courseId Course ID
 * @param profileId Profile ID
 * @returns Group member ID or null if not found
 */
export const getGroupMemberIdByCourseAndProfile = async (
  courseId: string,
  profileId: string
): Promise<string | null> => {
  const result = await db
    .select({ id: schema.groupmember.id })
    .from(schema.groupmember)
    .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
    .where(and(eq(schema.course.id, courseId), eq(schema.groupmember.profileId, profileId)))
    .limit(1);

  return result.length > 0 ? result[0].id : null;
};

export async function getGroupMemberIdByGroupAndProfile(
  groupId: string,
  profileId: string,
  dbClient: DbOrTxClient = db
): Promise<string | null> {
  try {
    const [row] = await dbClient
      .select({ id: schema.groupmember.id })
      .from(schema.groupmember)
      .where(and(eq(schema.groupmember.groupId, groupId), eq(schema.groupmember.profileId, profileId)))
      .limit(1);

    return row?.id ?? null;
  } catch (error) {
    console.error('getGroupMemberIdByGroupAndProfile error:', error);
    throw new Error(`Failed to resolve group membership: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function insertGroupMembersOnConflictDoNothing(
  values: TNewGroupmember[],
  dbClient: DbOrTxClient = db
): Promise<void> {
  if (values.length === 0) return;

  try {
    await dbClient.insert(schema.groupmember).values(values).onConflictDoNothing();
  } catch (error) {
    console.error('insertGroupMembersOnConflictDoNothing error:', error);
    throw new Error(`Failed to insert group members: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

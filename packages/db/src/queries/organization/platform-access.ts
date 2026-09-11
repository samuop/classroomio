import * as schema from '@db/schema';

import { and, eq, exists, isNull, or, type SQL } from 'drizzle-orm';

import { PLATFORM_ROLE } from '@cio/utils/constants';
import { db } from '@db/drizzle';

/**
 * The platform operator — Better Auth's global `user.role` set to
 * `platformAdmin` — administers every organization: the top-level accounts, the
 * consultancies, and each consultancy's client companies.
 *
 * Until this existed the role opened the cross-org /platform panel and nothing
 * else. It could change a company's plan or chat model but not open one of its
 * courses: every org-scoped check asked for a membership row and answered 403.
 * Operating the SaaS — fixing a client's course, finding out why a learner is
 * stuck — meant joining that company's team, where the client sees you.
 *
 * Derived rather than written as membership rows, for the same reason as the
 * consultancy → client grant in `getUserOrgRolesMap`: there is nothing to forget
 * to remove. Take the role away and the access goes with it.
 *
 * A banned account is not an operator even while it still holds the role, so a
 * ban cuts an operator credential off in one step. Checks that read `orgRoles`
 * off the session see it when the session's cookie cache refreshes (up to an
 * hour); the ones in this module see it on the next request.
 */
function platformAdminWhere(profileId: string) {
  return and(
    eq(schema.user.id, profileId),
    eq(schema.user.role, PLATFORM_ROLE.ADMIN),
    or(isNull(schema.user.banned), eq(schema.user.banned, false))
  );
}

/** Whether `profileId` operates the platform. */
export async function isPlatformAdmin(profileId: string): Promise<boolean> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(platformAdminWhere(profileId)).limit(1);

  return rows.length > 0;
}

/**
 * The same test as a SQL condition, for the checks that are a single query: it
 * joins their existing round trip instead of adding one on routes that run it
 * on every request.
 */
export function isPlatformAdminCondition(profileId: string): SQL {
  return exists(db.select({ id: schema.user.id }).from(schema.user).where(platformAdminWhere(profileId)));
}

/**
 * Whether `profileId` operates the platform AND `orgId` is a live organization.
 *
 * The session map only ever lists live organizations, so the checks that ask the
 * database directly must not reach one that was deleted either — otherwise a
 * saved URL would open a company that no longer exists anywhere else.
 */
export async function operatesOrganization(profileId: string, orgId: string): Promise<boolean> {
  const liveOrganization = db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(and(eq(schema.organization.id, orgId), isNull(schema.organization.deletedAt)));

  const rows = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(platformAdminWhere(profileId), exists(liveOrganization)))
    .limit(1);

  return rows.length > 0;
}

/** Every live organization: what a platform admin's derived access covers. */
export async function selectLiveOrganizations() {
  return db.select().from(schema.organization).where(isNull(schema.organization.deletedAt));
}

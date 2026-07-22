import { db, eq, inArray, user } from '@db/drizzle';

import { PLATFORM_ROLE } from '@cio/utils/constants';

/**
 * Promotes the SaaS operator account(s) to the global `platformAdmin` role on
 * Better Auth's `user.role`. This is what unlocks the cross-organization
 * /platform panel (see platformAdminMiddleware).
 *
 * Emails come from `PLATFORM_ADMIN_EMAILS` (comma-separated) when set; otherwise
 * the local demo admin `admin@test.com` is promoted so the panel is reachable
 * out of the box in development.
 */
function resolvePlatformAdminEmails(): string[] {
  const fromEnv = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  if (fromEnv.length > 0) {
    return fromEnv;
  }

  return ['admin@test.com'];
}

export async function seedPlatformAdmin() {
  const emails = resolvePlatformAdminEmails();

  const matchingUsers = await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.email, emails));

  if (matchingUsers.length === 0) {
    console.log(`   ⚠ No users matched platform admin emails (${emails.join(', ')}); skipping`);
    return;
  }

  await db
    .update(user)
    .set({ role: PLATFORM_ROLE.ADMIN })
    .where(
      inArray(
        user.id,
        matchingUsers.map((matched) => matched.id)
      )
    );

  console.log(`   ✓ Promoted ${matchingUsers.length} user(s) to platform admin: ${matchingUsers.map((u) => u.email).join(', ')}`);
}

/** Demotes a single user from platform admin back to a regular user. */
export async function revokePlatformAdmin(email: string) {
  await db.update(user).set({ role: null }).where(eq(user.email, email.trim().toLowerCase()));
}

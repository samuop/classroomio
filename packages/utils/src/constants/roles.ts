export const ROLE = {
  ADMIN: 1,
  TUTOR: 2,
  STUDENT: 3
} as const;

/**
 * Platform-level (cross-organization) roles. These live on Better Auth's global
 * `user.role` field — distinct from ROLE above, which is the per-organization
 * membership role (numeric, on `organizationmember.roleId`).
 *
 * A platform admin operates the SaaS as its owner: they can view every
 * organization, its token consumption, and manage organizations globally,
 * bypassing the per-org `cio-org-id` authorization used everywhere else.
 */
export const PLATFORM_ROLE = {
  ADMIN: 'platformAdmin'
} as const;

export type PlatformRole = (typeof PLATFORM_ROLE)[keyof typeof PLATFORM_ROLE];

/** Returns true when the given Better Auth global role is a platform admin. */
export function isPlatformAdminRole(role: string | null | undefined): boolean {
  return role === PLATFORM_ROLE.ADMIN;
}

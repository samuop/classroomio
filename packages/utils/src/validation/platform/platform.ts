import * as z from 'zod';

/** Query params for the cross-org listing. Values arrive as strings. */
export const ZPlatformOrgListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name', 'tokens']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});
export type TPlatformOrgListQuery = z.infer<typeof ZPlatformOrgListQuery>;

export const ZPlatformOrgIdParam = z.object({
  orgId: z.string().uuid()
});
export type TPlatformOrgIdParam = z.infer<typeof ZPlatformOrgIdParam>;

export const ZPlatformUpdateOrg = z.object({
  name: z.string().min(2).max(120).optional()
});
export type TPlatformUpdateOrg = z.infer<typeof ZPlatformUpdateOrg>;

export const ZPlatformSuspendOrg = z.object({
  suspend: z.boolean(),
  /** Optional ISO date; only meaningful when suspend is true. */
  readOnlyUntil: z.string().datetime().nullable().optional()
});
export type TPlatformSuspendOrg = z.infer<typeof ZPlatformSuspendOrg>;

export const ZPlatformSetPlan = z.object({
  planName: z.enum(['BASIC', 'EARLY_ADOPTER', 'ENTERPRISE'])
});
export type TPlatformSetPlan = z.infer<typeof ZPlatformSetPlan>;

export const ZPlatformDomainAction = z.object({
  action: z.enum(['connect', 'refresh', 'remove']),
  /** Required for `connect`; ignored for refresh/remove (server uses the stored domain). */
  domain: z.string().optional()
});
export type TPlatformDomainAction = z.infer<typeof ZPlatformDomainAction>;

export const ZPlatformCreateOrg = z.object({
  orgName: z
    .string()
    .min(2)
    .max(120)
    .refine((val) => !/^[-]|[-]$/.test(val), { message: 'validations.organization_name.hyphen_rule' }),
  siteName: z
    .string()
    .min(3)
    .max(63)
    .refine((val) => !/^[-]|[-]$/.test(val), { message: 'validations.site_name.hyphen_rule' }),
  /** Email of the user who becomes the org's admin owner. */
  ownerEmail: z.string().email(),
  /**
   * Temporary password. Only read when `ownerEmail` has no account yet, in
   * which case the account is created with it and the operator passes it on.
   * Without it, an owner who has never signed up is a dead end: the platform
   * panel is the one place that manages other people's workspaces.
   */
  ownerPassword: z.string().min(8).max(128).optional(),
  /** Display name for a newly created owner. Ignored if the account exists. */
  ownerName: z.string().trim().min(2).max(120).optional(),
  /**
   * A workspace with no plan has no token allowance and gated features, so
   * creating one always picks a plan rather than leaving it unset.
   */
  planName: z.enum(['BASIC', 'EARLY_ADOPTER', 'ENTERPRISE']).default('ENTERPRISE')
});
export type TPlatformCreateOrg = z.infer<typeof ZPlatformCreateOrg>;

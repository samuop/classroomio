import * as z from 'zod';
import { ZSiteName } from '../organization/site-name';

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
  name: z.string().min(2).max(120).optional(),
  /**
   * Cambiar el subdominio de una empresa.
   *
   * Antes no habia forma de tocarlo en ningun lado: se fijaba al crear y quedaba
   * asi para siempre, aunque tuviera un error de tipeo. Y como no se validaba
   * como hostname, un error de tipeo podia dejar la empresa en una direccion que
   * ni siquiera resuelve.
   *
   * Es un cambio con consecuencias — la direccion vieja deja de funcionar — asi
   * que vive solo en el panel de plataforma, no en la configuracion que ve cada
   * empresa.
   */
  siteName: ZSiteName.optional()
});
export type TPlatformUpdateOrg = z.infer<typeof ZPlatformUpdateOrg>;

export const ZPlatformSuspendOrg = z.object({
  suspend: z.boolean(),
  /** Optional ISO date; only meaningful when suspend is true. */
  readOnlyUntil: z.string().datetime().nullable().optional()
});
export type TPlatformSuspendOrg = z.infer<typeof ZPlatformSuspendOrg>;

export const ZPlatformSetPlan = z.object({
  planName: z.enum(['BASIC', 'EARLY_ADOPTER', 'ENTERPRISE']),
  /**
   * This organisation's own monthly token cap, overriding the plan's default.
   *
   * Three states, and they mean different things: omit it to leave the current
   * cap untouched, send `null` to drop the override and go back to the plan's
   * number, or send a count to set one. Zero is legitimate — it turns AI off for
   * the organisation without touching its plan or its data.
   *
   * The ceiling is a guard against a typo costing real money: at Flash-Lite
   * prices a mis-keyed extra digit is the difference between a month's budget
   * and ten of them.
   */
  aiTokenAllowance: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  /**
   * Run this organisation on a specific chat model instead of the deployment's.
   *
   * Same three states as the cap: omit to keep, null to clear, a name to set.
   * The name is validated against the selectable list on the server rather than
   * here, because that list lives with the cost multipliers it must agree with.
   */
  aiModel: z.string().trim().min(1).max(100).nullable().optional()
});
export type TPlatformSetPlan = z.infer<typeof ZPlatformSetPlan>;

/** Deployment-wide settings editable from the platform panel. */
export const ZPlatformSettingsUpdate = z.object({
  /** null clears the stored choice and hands resolution back to the environment. */
  chatModel: z.string().trim().min(1).max(100).nullable()
});
export type TPlatformSettingsUpdate = z.infer<typeof ZPlatformSettingsUpdate>;

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
  siteName: ZSiteName,
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

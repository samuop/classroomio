import * as z from 'zod';

/**
 * At-risk student detection settings, stored per-organization under
 * `organization.settings.atRisk` (no dedicated column — see schema.ts).
 *
 * A student is "at risk" when they trip at least one of four signals:
 *  1. Inactive       — no activity in more than `inactiveDays` days.
 *  2. Low progress   — average course progress below `lowProgressPct`.
 *  3. Low grade      — average grade below `lowGradePct`.
 *  4. Compliance     — has a compliance course in a non-healthy state.
 *
 * `DEFAULT_AT_RISK_SETTINGS` is the single source of truth for the thresholds;
 * the service layer merges stored overrides on top of these.
 */
export const DEFAULT_AT_RISK_SETTINGS = {
  enabled: true,
  inactiveDays: 14,
  lowProgressPct: 30,
  lowGradePct: 60
} as const;

export const ZAtRiskSettings = z.object({
  enabled: z.boolean(),
  inactiveDays: z.number().int().min(1).max(365),
  lowProgressPct: z.number().int().min(0).max(100),
  lowGradePct: z.number().int().min(0).max(100)
});

export type TAtRiskSettings = z.infer<typeof ZAtRiskSettings>;

/** Partial — used for the org-level PUT (merge patch). */
export const ZAtRiskSettingsUpdate = ZAtRiskSettings.partial();
export type TAtRiskSettingsUpdate = z.infer<typeof ZAtRiskSettingsUpdate>;

/**
 * Optional per-request threshold overrides for the overview query, so an admin
 * can preview the effect of different thresholds without persisting them.
 * `orgId` is not accepted here — it comes from the `cio-org-id` header.
 */
export const ZAtRiskOverview = z.object({
  inactiveDays: z.coerce.number().int().min(1).max(365).optional(),
  lowProgressPct: z.coerce.number().int().min(0).max(100).optional(),
  lowGradePct: z.coerce.number().int().min(0).max(100).optional()
});

export type TAtRiskOverview = z.infer<typeof ZAtRiskOverview>;

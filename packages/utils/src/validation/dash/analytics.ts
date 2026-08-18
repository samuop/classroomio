import * as z from 'zod';

export const ZDashAnalyticsRange = z.object({
  orgId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(365).default(30)
});

export const ZDashCourseFunnel = z.object({
  orgId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  courseId: z.string().uuid().optional()
});

export const ZDashComplianceOverview = z.object({
  orgId: z.string().uuid(),
  /** `all` widens the overview to the asking company's client companies. */
  scope: z.enum(['own', 'all']).default('own')
});

export type TDashAnalyticsRange = z.infer<typeof ZDashAnalyticsRange>;
export type TDashCourseFunnel = z.infer<typeof ZDashCourseFunnel>;
export type TDashComplianceOverview = z.infer<typeof ZDashComplianceOverview>;

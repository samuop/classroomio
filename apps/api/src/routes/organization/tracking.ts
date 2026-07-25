import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { handleError } from '@api/utils/errors';

import { getTrackingOverview } from '@api/services/organization/tracking';

/**
 * Unified student-tracking hub.
 *
 * GET /organization/tracking/overview — org admin only. Returns both reading
 * axes (Por alumno / Por curso) plus summary KPIs, from the canonical
 * aggregated progress source.
 */
export const organizationTrackingRouter = new Hono().get(
  '/overview',
  authMiddleware,
  orgAdminMiddleware,
  async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const overview = await getTrackingOverview(orgId);

      return c.json({ success: true as const, data: overview });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch tracking overview');
    }
  }
);

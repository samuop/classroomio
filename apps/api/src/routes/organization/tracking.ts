import * as z from 'zod';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

import { getTrackingOverview } from '@api/services/organization/tracking';

/**
 * Unified student-tracking hub.
 *
 * GET /organization/tracking/overview — org admin only. Returns both reading
 * axes (Por alumno / Por curso) plus summary KPIs, from the canonical
 * aggregated progress source.
 *
 * `scope=all` widens it to the asking company's client companies. It carries no
 * ids: the server derives them from `parent_organization_id`, so the widening
 * can only ever reach one level down from an organisation the caller already
 * administers. Being an admin of a consultancy is the whole authorisation, which
 * is the same rule the rest of the app derives (`getUserOrgRolesMap`).
 */
const ZTrackingQuery = z.object({
  scope: z.enum(['own', 'all']).default('own')
});

export const organizationTrackingRouter = new Hono().get(
  '/overview',
  authMiddleware,
  orgAdminMiddleware,
  zValidator('query', ZTrackingQuery),
  async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const { scope } = c.req.valid('query');
      const overview = await getTrackingOverview(orgId, scope);

      return c.json({ success: true as const, data: overview });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch tracking overview');
    }
  }
);

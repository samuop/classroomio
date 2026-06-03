import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';
import { ZAtRiskOverview, ZAtRiskSettingsUpdate } from '@cio/utils/validation/at-risk';

import {
  getAtRiskLearners,
  getOrgAtRiskSettingsService,
  updateOrgAtRiskSettingsService
} from '@api/services/organization/at-risk';

/**
 * Org-level at-risk student detection.
 *
 * GET  /organization/at-risk           — any org member reads the resolved thresholds.
 * GET  /organization/at-risk/overview  — org admin only; scans learners (optional threshold overrides).
 * PUT  /organization/at-risk           — org admin only; merges the patch into stored thresholds.
 */
export const organizationAtRiskRouter = new Hono()
  .get('/', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const settings = await getOrgAtRiskSettingsService(orgId);

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch at-risk settings');
    }
  })
  .get('/overview', authMiddleware, orgAdminMiddleware, zValidator('query', ZAtRiskOverview), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const overrides = c.req.valid('query');
      const overview = await getAtRiskLearners(orgId, overrides);

      return c.json({ success: true as const, data: overview });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch at-risk overview');
    }
  })
  .put('/', authMiddleware, orgAdminMiddleware, zValidator('json', ZAtRiskSettingsUpdate), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const patch = c.req.valid('json');
      const updated = await updateOrgAtRiskSettingsService(orgId, patch);

      return c.json({ success: true as const, data: updated });
    } catch (error) {
      return handleError(c, error, 'Failed to update at-risk settings');
    }
  });

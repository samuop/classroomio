import { Hono } from '@api/utils/hono';
import { ZStudentOverviewParam } from '@cio/utils/validation/student';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { getStudentOverview } from '@api/services/student/overview';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

export const studentRouter = new Hono().get(
  '/:profileId/overview',
  authMiddleware,
  orgMemberMiddleware,
  zValidator('param', ZStudentOverviewParam),
  async (c) => {
    try {
      const { profileId } = c.req.valid('param');
      const orgId = c.get('orgId')!;

      const overview = await getStudentOverview(profileId, orgId);

      return c.json({ success: true as const, data: overview }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load student overview');
    }
  }
);

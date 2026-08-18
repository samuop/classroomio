import { Hono } from '@api/utils/hono';
import { ROLE } from '@cio/utils/constants';
import { ZStudentOverviewParam } from '@cio/utils/validation/student';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { getStudentOverview } from '@api/services/student/overview';
import { ErrorCodes, handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

/**
 * The learner's full record: every course with its progress, grades, exercise
 * results, certificates and last activity.
 *
 * `orgMemberMiddleware` scopes it to one organisation but says nothing about WHO
 * may ask, and this route never read the role it leaves behind — so any member,
 * students included, could read any other member's record given their profile
 * id. Profile ids are UUIDs rather than guessable, but they travel in ordinary
 * responses (people lists, comment authors), so they are not a secret.
 *
 * Admins see anyone in their organisation; everyone else sees only themselves.
 * Tutors are deliberately NOT included yet: giving a tutor the whole roster is
 * the wrong shape — they should see the learners they actually teach, which
 * needs the shared-course check that the tutor tracking view will introduce.
 */
export const studentRouter = new Hono().get(
  '/:profileId/overview',
  authMiddleware,
  orgMemberMiddleware,
  zValidator('param', ZStudentOverviewParam),
  async (c) => {
    try {
      const { profileId } = c.req.valid('param');
      const orgId = c.get('orgId')!;

      const isOrgAdmin = c.get('userRole') === ROLE.ADMIN;
      const isSelf = c.get('user')?.id === profileId;

      if (!isOrgAdmin && !isSelf) {
        return c.json(
          {
            success: false as const,
            error: 'You can only view your own learner record',
            code: ErrorCodes.ORG_TEAM_NOT_AUTHORIZED
          },
          403
        );
      }

      const overview = await getStudentOverview(profileId, orgId);

      return c.json({ success: true as const, data: overview }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load student overview');
    }
  }
);

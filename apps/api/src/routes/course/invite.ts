import {
  ZCourseInvitationRemove,
  ZCourseInviteAuditParam,
  ZCourseInviteParam,
  ZCourseInviteRevokeParam,
  ZCreateCourseInvite
} from '@cio/utils/validation/course/invite';
import {
  createStudentInvite,
  getStudentInviteAuditTrail,
  listStudentInvites,
  revokeStudentInvite
} from '@api/services/course/invite';
import { listCourseInvitations, removeCourseInvitation } from '@api/services/course/invitations';

import { Hono } from '@api/utils/hono';
import { anotarAuditoria } from '@api/utils/audit-detail';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

export const invitesRouter = new Hono()
  /**
   * GET /course/:courseId/invites
   * Lists secure invites for a course (team/admin only)
   */
  .get('/', authMiddleware, courseTeamMemberMiddleware, zValidator('param', ZCourseInviteParam), async (c) => {
    try {
      const { courseId } = c.req.valid('param');
      const invites = await listStudentInvites(courseId);

      return c.json(
        {
          success: true,
          data: invites
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to list invites');
    }
  })
  /**
   * GET /course/:courseId/invites/students
   * Lists the people invited to this course and whether they joined (team/admin only).
   *
   * Distinct from GET / above: that lists this course's own invite *links*,
   * while these are the per-person organization invites the audience import
   * creates, which is what the "Invitar nuevos alumnos" box actually sends.
   */
  .get('/students', authMiddleware, courseTeamMemberMiddleware, zValidator('param', ZCourseInviteParam), async (c) => {
    try {
      const { courseId } = c.req.valid('param');
      const result = await listCourseInvitations(courseId);

      return c.json(
        {
          success: true,
          data: result
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to list course invitations');
    }
  })
  /**
   * DELETE /course/:courseId/invites/students
   * Removes a person's finished invitations from this course's list (team/admin only).
   * A pending one answers 409: it has to be revoked first.
   */
  .delete(
    '/students',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZCourseInviteParam),
    zValidator('json', ZCourseInvitationRemove),
    async (c) => {
      try {
        const { courseId } = c.req.valid('param');
        const { email } = c.req.valid('json');
        anotarAuditoria(c, { metadata: { email } });

        const result = await removeCourseInvitation(courseId, email);

        return c.json(
          {
            success: true,
            data: result
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to remove course invitation');
      }
    }
  )
  /**
   * POST /course/:courseId/invites
   * Creates a secure student invite token for a course (team/admin only)
   */
  .post(
    '/',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZCourseInviteParam),
    zValidator('json', ZCreateCourseInvite),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId } = c.req.valid('param');
        const payload = c.req.valid('json');

        const invite = await createStudentInvite(courseId, user.id, payload);

        return c.json(
          {
            success: true,
            data: invite
          },
          201
        );
      } catch (error) {
        return handleError(c, error, 'Failed to create invite');
      }
    }
  )
  /**
   * POST /course/:courseId/invites/:inviteId/revoke
   * Revokes a secure invite (team/admin only)
   */
  .post(
    '/:inviteId/revoke',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZCourseInviteRevokeParam),
    async (c) => {
      try {
        const { courseId, inviteId } = c.req.valid('param');
        const user = c.get('user')!;
        const revoked = await revokeStudentInvite(courseId, inviteId, user.id);

        return c.json(
          {
            success: true,
            data: revoked
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to revoke invite');
      }
    }
  )
  /**
   * GET /course/:courseId/invites/:inviteId/audit
   * Lists audit trail for an invite (team/admin only)
   */
  .get(
    '/:inviteId/audit',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZCourseInviteAuditParam),
    async (c) => {
      try {
        const { courseId, inviteId } = c.req.valid('param');
        const audit = await getStudentInviteAuditTrail(courseId, inviteId);

        return c.json(
          {
            success: true,
            data: audit
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to load invite audit');
      }
    }
  );

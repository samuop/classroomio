import { Context, Next } from 'hono';

import { ErrorCodes } from '@api/utils/errors';
import { isUserCourseMemberOrOrgAdmin } from '@cio/db/queries/group';
import { ensureProgramCourseAccess } from '@api/services/course/course';

/**
 * Si esta persona cursa (o administra) el curso: es miembro de su grupo, o le
 * llega por un programa —y en ese caso se la inscribe al pasar—. Es la misma
 * regla para abrir una lección que para hablarle al tutor: el tutor lee
 * lecciones, y sin esta regla se las leía a cualquiera de la empresa.
 */
export async function cursaElCurso(courseId: string, userId: string): Promise<boolean> {
  if (await isUserCourseMemberOrOrgAdmin(courseId, userId)) return true;

  return Boolean(await ensureProgramCourseAccess(courseId, userId));
}

/**
 * Middleware to check if the authenticated user is a member of a course's group
 * Requires authMiddleware to be applied first
 * Extracts courseId from request params, query, or body
 */
export const courseMemberMiddleware = async (c: Context, next: Next) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED'
        },
        401
      );
    }

    const courseId = c.req.param('courseId') || c.req.query('courseId');
    if (!courseId) {
      return c.json(
        {
          success: false,
          error: 'Course ID is required',
          code: 'COURSE_ID_REQUIRED'
        },
        400
      );
    }

    if (await cursaElCurso(courseId, user.id)) {
      return next();
    }

    return c.json(
      {
        success: false,
        error: 'You must be a member of this course to perform this action',
        code: ErrorCodes.ORG_TEAM_NOT_AUTHORIZED
      },
      403
    );
  } catch (error) {
    console.error('Error in courseMemberMiddleware:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to verify course membership',
        code: 'COURSE_MEMBER_CHECK_FAILED'
      },
      500
    );
  }
};

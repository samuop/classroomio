import { Context, Next } from 'hono';

import { ErrorCodes } from '@api/utils/errors';
import { isEnrolledCourseStudent, isUserCourseMemberOrOrgAdmin } from '@cio/db/queries/group';
import { ensureProgramCourseAccess } from '@api/services/course/course';

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

    const isAllowed = await isUserCourseMemberOrOrgAdmin(courseId, user.id);
    if (isAllowed) {
      return next();
    }

    const backfilledFromProgram = await ensureProgramCourseAccess(courseId, user.id);
    if (backfilledFromProgram) {
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

/**
 * Para bajar el certificado: lo mismo que `courseMemberMiddleware`, y además quien
 * sigue inscripto como alumno aunque ya no sea miembro de la empresa. Es quien
 * egresó en Seguimiento (SaaS-RRHH, fase 23): ya no entra a las lecciones, pero el
 * certificado que ganó es suyo. Si de verdad lo ganó lo decide la ruta
 * (`assertCertificateDownloadAllowed`), igual que para cualquier alumno.
 */
export const courseCertificateMiddleware = async (c: Context, next: Next) => {
  let inscripto = false;
  try {
    const user = c.get('user');
    const courseId = c.req.param('courseId') || c.req.query('courseId');
    inscripto = Boolean(user && courseId && (await isEnrolledCourseStudent(courseId, user.id)));
  } catch (error) {
    console.error('Error in courseCertificateMiddleware:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to verify course membership',
        code: 'COURSE_MEMBER_CHECK_FAILED'
      },
      500
    );
  }

  return inscripto ? next() : courseMemberMiddleware(c, next);
};

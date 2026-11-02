import { Context, Next } from 'hono';
import { getGroupMemberIdByCourseAndProfile, isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';

import { ErrorCodes } from '@api/utils/errors';
import { getLessonCommentAuthorAndCourse } from '@cio/db/queries/lesson';

/**
 * Un comentario de una lección lo edita o lo borra quien lo escribió, o el equipo
 * del curso. Hasta 2026-11-02 alcanzaba con ser miembro de cualquier curso: un
 * alumno podía cambiar o borrar lo que escribió otro, también en un curso ajeno.
 *
 * Mismo criterio que `newsfeedCommentAuthorOrTeamMiddleware`, más uno: el
 * comentario tiene que ser del curso de la ruta, así uno ajeno no se alcanza
 * desde la URL de un curso propio. Requiere authMiddleware antes.
 */
export const lessonCommentAuthorOrTeamMiddleware = async (c: Context, next: Next) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    const commentInfo = await getLessonCommentAuthorAndCourse(Number(c.req.param('commentId')));
    if (!commentInfo?.courseId || commentInfo.courseId !== c.req.param('courseId')) {
      return c.json({ success: false, error: 'Comment not found', code: ErrorCodes.COMMENT_NOT_FOUND }, 404);
    }

    const authorGroupMemberId = await getGroupMemberIdByCourseAndProfile(commentInfo.courseId, user.id);
    if (authorGroupMemberId && commentInfo.authorId === authorGroupMemberId) {
      return next();
    }

    if (await isCourseTeamMemberOrOrgAdmin(commentInfo.courseId, user.id)) {
      return next();
    }

    return c.json(
      {
        success: false,
        error: 'Only the author or course team members can perform this action',
        code: ErrorCodes.ORG_TEAM_NOT_AUTHORIZED
      },
      403
    );
  } catch (error) {
    console.error('Error in lessonCommentAuthorOrTeamMiddleware:', error);
    return c.json(
      { success: false, error: 'Failed to verify comment authorization', code: 'COMMENT_AUTH_CHECK_FAILED' },
      500
    );
  }
};

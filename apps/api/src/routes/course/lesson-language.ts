import {
  ZLessonLanguageCreate,
  ZLessonLanguageGetByLocaleParam,
  ZLessonLanguageGetParam,
  ZLessonLanguageUpdate
} from '@cio/utils/validation/lesson';
import {
  getLessonLanguage,
  listLessonLanguages,
  updateLessonLanguageService,
  upsertLessonLanguageService
} from '@api/services/lesson-language';

import { Hono } from '@api/utils/hono';
import type { TLocale } from '@db/types';
import { authMiddleware } from '@api/middlewares/auth';
import { courseMemberMiddleware } from '@api/middlewares/course-member';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { lessonInCourse } from '@api/services/course/course-binding';
import { canReadLesson } from '@api/services/course/locked-content';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

export const lessonLanguageRouter = new Hono()
  /**
   * GET /course/:courseId/lesson/:lessonId/language
   * Gets all language translations for a lesson
   * Requires authentication and course membership
   */
  .get('/', authMiddleware, courseMemberMiddleware, zValidator('param', ZLessonLanguageGetParam), async (c) => {
    try {
      const { lessonId } = c.req.valid('param');
      // El texto de una lección bloqueada no le llega al alumno (ver locked-content.ts).
      const languages = (await canReadLesson(c.req.param('courseId')!, lessonId, c.get('user')!.id))
        ? await listLessonLanguages(lessonId)
        : [];

      return c.json(
        {
          success: true,
          data: languages
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to fetch lesson languages');
    }
  })
  /**
   * GET /course/:courseId/lesson/:lessonId/language/:locale
   * Gets a single lesson language by locale
   * Requires authentication and course membership
   */
  .get(
    '/:locale',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonLanguageGetByLocaleParam),
    async (c) => {
      try {
        const { lessonId, locale } = c.req.valid('param');
        // Bloqueada para el alumno: responde como una lección sin ese idioma.
        const language = (await canReadLesson(c.req.param('courseId')!, lessonId, c.get('user')!.id))
          ? await getLessonLanguage(lessonId, locale as TLocale)
          : null;

        if (!language) {
          return c.json(
            {
              success: false,
              error: 'Lesson language not found'
            },
            404
          );
        }

        return c.json(
          {
            success: true,
            data: language
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to fetch lesson language');
      }
    }
  )
  /**
   * POST /course/:courseId/lesson/:lessonId/language
   * Creates or updates a lesson language translation (upsert)
   * Sólo el equipo del curso: es el texto de la lección.
   */
  .post(
    '/',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZLessonLanguageGetParam),
    zValidator('json', ZLessonLanguageCreate),
    async (c) => {
      try {
        const { lessonId } = c.req.valid('param');
        const data = c.req.valid('json');

        await lessonInCourse(c.req.param('courseId')!, lessonId);
        const language = await upsertLessonLanguageService(lessonId, data);

        return c.json(
          {
            success: true,
            data: language
          },
          201
        );
      } catch (error) {
        return handleError(c, error, 'Failed to create or update lesson language');
      }
    }
  )
  /**
   * PUT /course/:courseId/lesson/:lessonId/language/:locale
   * Updates a lesson language translation
   * Sólo el equipo del curso.
   */
  .put(
    '/:locale',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZLessonLanguageGetByLocaleParam),
    zValidator('json', ZLessonLanguageUpdate),
    async (c) => {
      try {
        const { lessonId, locale } = c.req.valid('param');
        const data = c.req.valid('json');

        await lessonInCourse(c.req.param('courseId')!, lessonId);
        const language = await updateLessonLanguageService(lessonId, locale as TLocale, data);

        return c.json(
          {
            success: true,
            data: language
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to update lesson language');
      }
    }
  );

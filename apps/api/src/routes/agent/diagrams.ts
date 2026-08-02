import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';
import { ZAgentDiagramParam, ZAgentDiagramBody } from '@cio/utils/validation/agent';
import { handleError, AppError } from '@api/utils/errors';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { pickAnyConfiguredProvider } from '@cio/ai-assistant';
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { verifyLessonBelongsToCourse } from '@api/services/agent/chat-context';
import { regenerateLessonDiagram, listLessonDiagrams } from '@api/services/agent/diagram';

/**
 * Diagram sub-router — redraw one SVG inside a lesson, in place.
 *
 * Backs the control that appears over a diagram when an instructor views a
 * lesson: "Regenerate", or a plain-language instruction like "the labels overlap".
 * Deliberately separate from the chat agent: the chat edits by exact string
 * match, which the model routinely fails to reproduce, while here the server
 * splices by position so nothing else in the lesson can be disturbed.
 */
export const agentDiagramsRouter = new Hono().post(
  '/:lessonId/diagram',
  authMiddleware,
  orgMemberMiddleware,
  zValidator('param', ZAgentDiagramParam),
  zValidator('json', ZAgentDiagramBody),
  async (c) => {
    try {
      const user = c.get('user')!;
      const { lessonId } = c.req.valid('param');
      const { courseId, locale, index, instruction } = c.req.valid('json');

      const allowed = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
      if (!allowed) {
        throw new AppError('Not authorized for this course', 'COURSE_FORBIDDEN', 403);
      }

      // Guards against a lesson id from another course being passed in.
      await verifyLessonBelongsToCourse(lessonId, courseId);

      const providerConfig = pickAnyConfiguredProvider();
      if (!providerConfig) {
        throw new AppError('No AI provider is configured', 'AI_PROVIDER_NOT_CONFIGURED', 503);
      }

      const lesson = await getLesson(lessonId);
      const languages = (lesson as { lessonLanguages?: Array<{ locale: string; content: string | null }> })
        .lessonLanguages;
      const current = languages?.find((entry) => entry.locale === locale);
      const content = current?.content ?? '';

      if (!content) {
        throw new AppError('This lesson has no content in that language yet.', 'LESSON_CONTENT_EMPTY', 404);
      }

      const result = await regenerateLessonDiagram({
        content,
        index,
        lessonTitle: lesson.title,
        locale,
        instruction,
        providerConfig
      });

      await upsertLessonLanguageService(lessonId, {
        locale: locale as 'en',
        content: result.content
      });

      console.log(
        `[agent.diagram] lesson=${lessonId} index=${index} attempts=${result.attempts} warnings=${result.warnings.length}`
      );

      return c.json({
        success: true as const,
        data: {
          svg: result.svg,
          content: result.content,
          warnings: result.warnings,
          diagramCount: listLessonDiagrams(result.content).length
        }
      });
    } catch (error) {
      return handleError(c, error, 'Failed to regenerate the diagram');
    }
  }
);

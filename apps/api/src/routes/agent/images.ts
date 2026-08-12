import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';
import { ZAgentDiagramParam, ZAgentImageBody, ZAgentDiagramToImageBody } from '@cio/utils/validation/agent';
import { handleError, AppError } from '@api/utils/errors';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { verifyLessonBelongsToCourse } from '@api/services/agent/chat-context';
import { listLessonDiagrams } from '@api/services/agent/diagram';
import { listLessonImages, regenerateLessonImage, replaceDiagramWithImage } from '@api/services/agent/lesson-images';

/**
 * Illustration sub-router — the picture counterpart of `diagrams.ts`.
 *
 * Both endpoints splice by position into SAVED content, so nothing depends on a
 * model reproducing surrounding markup, and an unsaved draft would be silently
 * overwritten — which is why the control that calls them is disabled while the
 * lesson is dirty.
 */
async function loadLessonContent(lessonId: string, courseId: string, locale: string, userId: string) {
  const allowed = await isCourseTeamMemberOrOrgAdmin(courseId, userId);
  if (!allowed) {
    throw new AppError('Not authorized for this course', 'COURSE_FORBIDDEN', 403);
  }

  await verifyLessonBelongsToCourse(lessonId, courseId);

  const lesson = await getLesson(lessonId);
  const languages = (lesson as { lessonLanguages?: Array<{ locale: string; content: string | null }> }).lessonLanguages;
  const content = languages?.find((entry) => entry.locale === locale)?.content ?? '';

  if (!content) {
    throw new AppError('This lesson has no content in that language yet.', 'LESSON_CONTENT_EMPTY', 404);
  }

  return { lesson, content };
}

export const agentImagesRouter = new Hono()
  .post(
    '/:lessonId/image',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentDiagramParam),
    zValidator('json', ZAgentImageBody),
    async (c) => {
      try {
        const user = c.get('user')!;
        const orgId = c.req.header('cio-org-id')!;
        const { lessonId } = c.req.valid('param');
        const { courseId, locale, index, instruction } = c.req.valid('json');

        const { content } = await loadLessonContent(lessonId, courseId, locale, user.id);

        const result = await regenerateLessonImage({
          content,
          index,
          orgId,
          courseId,
          lessonId,
          locale,
          instruction
        });

        await upsertLessonLanguageService(lessonId, { locale: locale as 'en', content: result.content });

        console.log(`[agent.image] lesson=${lessonId} index=${index} instruction=${instruction ? 'yes' : 'no'}`);

        return c.json({
          success: true as const,
          data: {
            url: result.url,
            alt: result.alt,
            content: result.content,
            imageCount: listLessonImages(result.content).length
          }
        });
      } catch (error) {
        return handleError(c, error, 'Failed to regenerate the image');
      }
    }
  )
  .post(
    '/:lessonId/diagram-to-image',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentDiagramParam),
    zValidator('json', ZAgentDiagramToImageBody),
    async (c) => {
      try {
        const user = c.get('user')!;
        const orgId = c.req.header('cio-org-id')!;
        const { lessonId } = c.req.valid('param');
        const { courseId, locale, index, subject } = c.req.valid('json');

        const { content } = await loadLessonContent(lessonId, courseId, locale, user.id);

        const diagrams = listLessonDiagrams(content);
        const target = diagrams[index];

        if (!target) {
          throw new AppError(
            `This lesson has ${diagrams.length} diagram(s); there is none at position ${index}. Reload the lesson and try again.`,
            'DIAGRAM_NOT_FOUND',
            404
          );
        }

        const result = await replaceDiagramWithImage({
          content,
          diagramStart: target.start,
          diagramEnd: target.end,
          subject,
          orgId,
          courseId,
          lessonId,
          locale
        });

        await upsertLessonLanguageService(lessonId, { locale: locale as 'en', content: result.content });

        console.log(`[agent.image] lesson=${lessonId} diagram=${index} replaced by a generated illustration`);

        return c.json({
          success: true as const,
          data: {
            url: result.url,
            alt: result.alt,
            content: result.content,
            diagramCount: listLessonDiagrams(result.content).length,
            imageCount: listLessonImages(result.content).length
          }
        });
      } catch (error) {
        return handleError(c, error, 'Failed to replace the diagram with an image');
      }
    }
  );

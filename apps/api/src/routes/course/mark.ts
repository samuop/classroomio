import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseMemberMiddleware } from '@api/middlewares/course-member';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { getGradebook } from '@api/services/mark/gradebook';
import { getMarks } from '@api/services/mark';
import { generateCourseReport } from '@api/services/course/course-report';
import { handleError } from '@api/utils/errors';
import { isRenderConfigured, RENDER_UNCONFIGURED_MESSAGE } from '@api/utils/render';
import { ZCourseReportQuery } from '@cio/utils/validation/course';
import { zValidator } from '@hono/zod-validator';

const CONTENT_TYPE = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf'
} as const;

function fileNameFor(title: string, format: keyof typeof CONTENT_TYPE): string {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'curso';

  return `${slug}-alumnos.${format}`;
}

export const markRouter = new Hono()
  .get('/gradebook', authMiddleware, courseMemberMiddleware, async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const gradebook = await getGradebook(courseId);
      return c.json({ success: true, data: gradebook }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to get gradebook');
    }
  })
  /**
   * GET /course/:courseId/mark/report?format=xlsx|pdf
   * Quién hizo el curso y con qué nota (sólo el equipo del curso o un admin).
   */
  .get(
    '/report',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('query', ZCourseReportQuery),
    async (c) => {
      const { format } = c.req.valid('query');

      try {
        const courseId = c.req.param('courseId')!;
        const { file, title } = await generateCourseReport(courseId, format);

        c.header('Content-Type', CONTENT_TYPE[format]);
        c.header('Content-Disposition', `attachment; filename="${fileNameFor(title, format)}"`);

        return c.body(
          new ReadableStream({
            start(controller) {
              controller.enqueue(file);
              controller.close();
            }
          })
        );
      } catch (error) {
        const message =
          format === 'pdf' && !isRenderConfigured() ? RENDER_UNCONFIGURED_MESSAGE : 'Failed to build course report';
        return handleError(c, error, message);
      }
    }
  )
  .get('/', authMiddleware, courseMemberMiddleware, async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const marks = await getMarks(courseId);

      return c.json({ success: true, data: marks }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to get marks');
    }
  });

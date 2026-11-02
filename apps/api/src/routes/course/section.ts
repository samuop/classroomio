import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { handleError } from '@api/utils/errors';
import { assertInCourse, sectionInCourse } from '@api/services/course/course-binding';
import {
  createCourseSection,
  deleteCourseSectionService,
  promoteUngroupedSection,
  reorderCourseSections,
  updateCourseSectionService
} from '@api/services/course/section';
import {
  ZCourseSectionCreate,
  ZCourseSectionGetParam,
  ZCourseSectionPromoteUngrouped,
  ZCourseSectionReorder,
  ZCourseSectionUpdate
} from '@cio/utils/validation/course';
import { zValidator } from '@hono/zod-validator';

/**
 * Las secciones son la estructura del curso: las arma el equipo. Hasta
 * 2026-11-02 alcanzaba con ser miembro del curso, y un alumno podía crearlas,
 * renombrarlas o borrarlas llamando a la API.
 */
export const sectionRouter = new Hono()
  .post('/', authMiddleware, courseTeamMemberMiddleware, zValidator('json', ZCourseSectionCreate), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = c.req.valid('json');

      const section = await createCourseSection(courseId, { ...data, courseId });

      return c.json({ success: true, data: section }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create course section');
    }
  })
  .post(
    '/promote-ungrouped',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('json', ZCourseSectionPromoteUngrouped),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const data = c.req.valid('json');

        const result = await promoteUngroupedSection(courseId, data);

        return c.json({ success: true, data: result }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to promote ungrouped section');
      }
    }
  )
  .put(
    '/:sectionId',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZCourseSectionGetParam),
    zValidator('json', ZCourseSectionUpdate),
    async (c) => {
      try {
        const { sectionId } = c.req.valid('param');
        const data = c.req.valid('json');

        await sectionInCourse(c.req.param('courseId')!, sectionId);
        const section = await updateCourseSectionService(sectionId, data);

        return c.json({ success: true, data: section }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update course section');
      }
    }
  )
  .delete(
    '/:sectionId',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZCourseSectionGetParam),
    async (c) => {
      try {
        const { sectionId } = c.req.valid('param');

        await sectionInCourse(c.req.param('courseId')!, sectionId);
        const section = await deleteCourseSectionService(sectionId);

        return c.json({ success: true, data: section }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to delete course section');
      }
    }
  )
  .post(
    '/reorder',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('json', ZCourseSectionReorder),
    async (c) => {
      try {
        const { sections } = c.req.valid('json');

        await assertInCourse(c.req.param('courseId')!, { sectionIds: sections.map((section) => section.id) });
        const updated = await reorderCourseSections(sections);

        return c.json({ success: true, data: updated }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to reorder course sections');
      }
    }
  );

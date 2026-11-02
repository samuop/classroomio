import { Hono } from '@api/utils/hono';
import { ZAttendanceUpsert } from '@cio/utils/validation/attendance';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { lessonInCourse } from '@api/services/course/course-binding';
import { ErrorCodes, handleError } from '@api/utils/errors';
import { upsertAttendanceService } from '@api/services/attendance';
import { zValidator } from '@hono/zod-validator';

/**
 * La asistencia la marca el equipo del curso (la pantalla ya le deshabilita las
 * casillas al alumno). Hasta 2026-11-02 alcanzaba con ser miembro: un alumno
 * podía marcarse presente, a sí mismo o a otro, llamando a la API.
 */
export const attendanceRouter = new Hono().post(
  '/',
  authMiddleware,
  courseTeamMemberMiddleware,
  zValidator('json', ZAttendanceUpsert),
  async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = c.req.valid('json');

      if (data.courseId !== courseId) {
        return c.json(
          { success: false, error: 'Course does not match the route', code: ErrorCodes.VALIDATION_ERROR },
          400
        );
      }
      await lessonInCourse(courseId, data.lessonId);
      const attendance = await upsertAttendanceService(data);

      return c.json({ success: true, data: attendance }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to upsert attendance');
    }
  }
);

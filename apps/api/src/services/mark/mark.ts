import { AppError, ErrorCodes } from '@api/utils/errors';
import { getMarksByCourseId } from '@cio/db/queries/mark';
import { getCourseMembers } from '@cio/db/queries/course/people';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';

/**
 * Gets marks for a course
 * Marks are computed from submissions and exercises using a database function
 * Trae las notas de TODOS: para contestarle a una persona, usar `getMarksFor`.
 * @param courseId Course ID
 * @returns Array of mark records
 */
export async function getMarks(courseId: string) {
  try {
    return await getMarksByCourseId(courseId);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Failed to get marks', ErrorCodes.INTERNAL_ERROR, 500);
  }
}

/**
 * Las notas según quién las pide: el equipo del curso, todas; un alumno, las
 * suyas. Las filas sin alumno (un ejercicio que nadie entregó) se conservan:
 * dicen qué ejercicios hay, no de quién son. Ver `getGradebookFor`.
 */
export async function getMarksFor(courseId: string, viewerId: string) {
  const [notas, esDelEquipo] = await Promise.all([
    getMarks(courseId),
    isCourseTeamMemberOrOrgAdmin(courseId, viewerId)
  ]);

  if (esDelEquipo) return notas;

  const miembros = await getCourseMembers(courseId);
  const propias = new Set(miembros.filter((m) => m.profileId === viewerId).map((m) => m.id));

  return notas.filter((nota) => !nota.groupmemberId || propias.has(nota.groupmemberId));
}

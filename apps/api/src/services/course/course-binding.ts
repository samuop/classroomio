import {
  getCourseSectionBinding,
  getExerciseCourseBinding,
  getLessonCourseBinding,
  type ResourceCourseBinding
} from '@cio/db/queries/agent';

import { AppError, ErrorCodes } from '@api/utils/errors';

/**
 * Lo que no es del curso de la ruta no existe.
 *
 * Los middlewares de curso validan a la persona contra el curso de la URL, pero
 * hasta 2026-11-02 las rutas de lecciones, secciones y ejercicios tomaban el id
 * del recurso y lo usaban sin mirar de qué curso era: el docente de un curso
 * podía editar o borrar, por id, una lección de un curso ajeno, también de otra
 * empresa. Cada ruta que recibe un id lo pasa por acá antes de tocarlo.
 */

async function inCourse(
  courseId: string,
  id: string,
  load: (id: string) => Promise<ResourceCourseBinding | undefined>,
  notFound: () => AppError
): Promise<ResourceCourseBinding> {
  const binding = await load(id);
  if (!binding || binding.courseId !== courseId) throw notFound();
  return binding;
}

export function lessonInCourse(courseId: string, lessonId: string): Promise<ResourceCourseBinding> {
  return inCourse(courseId, lessonId, getLessonCourseBinding, () => {
    return new AppError('Lesson not found', ErrorCodes.LESSON_NOT_FOUND, 404);
  });
}

export function exerciseInCourse(courseId: string, exerciseId: string): Promise<ResourceCourseBinding> {
  return inCourse(courseId, exerciseId, getExerciseCourseBinding, () => {
    return new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  });
}

export function sectionInCourse(courseId: string, sectionId: string): Promise<ResourceCourseBinding> {
  return inCourse(courseId, sectionId, getCourseSectionBinding, () => {
    return new AppError('Section not found', ErrorCodes.COURSE_SECTION_NOT_FOUND, 404);
  });
}

/** Para los ids opcionales del cuerpo (la sección o la lección donde va algo nuevo). */
export async function assertInCourse(
  courseId: string,
  ids: { lessonIds?: Array<string | null | undefined>; sectionIds?: Array<string | null | undefined> }
): Promise<void> {
  const present = (list?: Array<string | null | undefined>) => [...new Set(list?.filter((id): id is string => !!id))];

  await Promise.all([
    ...present(ids.lessonIds).map((id) => lessonInCourse(courseId, id)),
    ...present(ids.sectionIds).map((id) => sectionInCourse(courseId, id))
  ]);
}

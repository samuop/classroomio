import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import type { LessonById } from '@cio/db/queries/lesson';

import { exerciseInCourse, lessonInCourse } from '@api/services/course/course-binding';
import { exerciseForStudent } from '@api/services/exercise/answer-key';
import { getExercise } from '@api/services/exercise/exercise';
import { getLesson } from '@api/services/lesson/lesson';
import { AppError, ErrorCodes } from '@api/utils/errors';

/**
 * Lo que el docente bloquea, el alumno no lo lee por ninguna vía.
 *
 * Hasta 2026-11-02 el bloqueo vivía sólo en la pantalla: la API le mandaba al
 * navegador del alumno el texto de la lección o las preguntas del ejercicio, y la
 * página los tapaba con un cartel. Quien abriera las herramientas del navegador
 * los leía, y el tutor de IA los buscaba y los citaba como cualquier otra lección.
 *
 * La regla, en un solo lugar:
 *
 *  - Bloqueado es `isUnlocked === false`. Un `null` no bloquea, igual que en el
 *    menú del curso.
 *  - El equipo del curso y los admins de la empresa ven todo: son quienes lo arman.
 *  - Al alumno lo bloqueado le llega con la misma forma pero SIN contenido, así la
 *    pantalla sigue mostrando su cartel de «contenido bloqueado» en vez de un error.
 *  - Lo que no es del curso de la ruta no existe: antes cualquier miembro de un
 *    curso podía pedir por id una lección de otro.
 */

export function isLocked(item: { isUnlocked?: boolean | null }): boolean {
  return item.isUnlocked === false;
}

/** Quien arma el curso ve lo bloqueado y la clave de respuestas; el alumno, no. */
export async function seesLockedContent(courseId: string, userId: string): Promise<boolean> {
  return isCourseTeamMemberOrOrgAdmin(courseId, userId);
}

/** La lección como la ve un alumno mientras está bloqueada: el título y su lugar en el curso. */
export function lessonWithoutContent<T extends Partial<LessonById>>(lesson: T): T {
  return {
    ...lesson,
    note: null,
    videoUrl: null,
    slideUrl: null,
    callUrl: null,
    videos: [],
    documents: [],
    ...(lesson.lessonLanguages ? { lessonLanguages: [] } : {})
  } as T;
}

/** El ejercicio como lo ve un alumno mientras está bloqueado: el título, sin consigna ni preguntas. */
export function exerciseWithoutContent<T extends { description?: string | null; questions?: unknown[] }>(
  exercise: T
): T {
  return { ...exercise, description: null, questions: [], sections: [] } as T;
}

export async function lessonForViewer(courseId: string, lessonId: string, userId: string) {
  const lesson = await getLesson(lessonId);

  if (lesson.courseId !== courseId) {
    throw new AppError('Lesson not found', ErrorCodes.LESSON_NOT_FOUND, 404);
  }
  if (isLocked(lesson) && !(await seesLockedContent(courseId, userId))) {
    return lessonWithoutContent(lesson);
  }

  return lesson;
}

export async function lessonsForViewer<T extends Partial<LessonById> & { isUnlocked?: boolean | null }>(
  courseId: string,
  lessons: T[],
  userId: string
): Promise<T[]> {
  if (!lessons.some(isLocked) || (await seesLockedContent(courseId, userId))) return lessons;

  return lessons.map((lesson) => (isLocked(lesson) ? lessonWithoutContent(lesson) : lesson));
}

export async function exerciseForViewer(courseId: string, exerciseId: string, userId: string) {
  const exercise = await getExercise(exerciseId, undefined, userId);

  if (exercise.courseId !== courseId) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }
  if (await seesLockedContent(courseId, userId)) return exercise;
  if (isLocked(exercise)) return exerciseWithoutContent(exercise);

  // Abierto, para un alumno: las preguntas sí, la clave de respuestas según
  // haya entregado (ver answer-key.ts).
  return exerciseForStudent(exercise, userId);
}

export async function exercisesForViewer<T extends { description?: string | null; isUnlocked?: boolean | null }>(
  courseId: string,
  exercises: T[],
  userId: string
): Promise<T[]> {
  if (!exercises.some(isLocked) || (await seesLockedContent(courseId, userId))) return exercises;

  return exercises.map((exercise) => (isLocked(exercise) ? ({ ...exercise, description: null } as T) : exercise));
}

/**
 * Si quien pide puede leer el texto de la lección. `false` para el alumno
 * mientras está bloqueada; 404 si la lección no es de este curso.
 */
export async function canReadLesson(courseId: string, lessonId: string, userId: string): Promise<boolean> {
  const binding = await lessonInCourse(courseId, lessonId);

  return !isLocked(binding) || seesLockedContent(courseId, userId);
}

const LOCKED = () => new AppError('This content is locked', ErrorCodes.FORBIDDEN, 403);

/**
 * Para lo que el alumno HACE con una lección: completarla. Lo que no puede ver
 * tampoco lo puede hacer.
 */
export async function assertLessonWorkable(courseId: string, lessonId: string, userId: string): Promise<void> {
  if (!(await canReadLesson(courseId, lessonId, userId))) throw LOCKED();
}

/** Lo mismo para entregar un ejercicio. */
export async function assertExerciseWorkable(courseId: string, exerciseId: string, userId: string): Promise<void> {
  const binding = await exerciseInCourse(courseId, exerciseId);

  if (isLocked(binding) && !(await seesLockedContent(courseId, userId))) throw LOCKED();
}

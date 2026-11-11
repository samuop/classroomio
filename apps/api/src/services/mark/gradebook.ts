import { ContentType, ROLE } from '@cio/utils/constants';
import { getMarksByCourseId, type Mark } from '@cio/db/queries/mark';
import { getCourseMembers } from '@cio/db/queries/course/people';
import { getCourseWithRelations } from '@cio/db/queries/course';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { buildCourseContent, type CourseContentItem } from '@api/services/course/utils';
import { AppError, ErrorCodes } from '@api/utils/errors';

export type GradebookExercise = {
  id: string;
  title: string;
  points: number;
};

export type GradebookStudentMarks = Record<string, Record<string, string>>;

export type GradebookResponse = {
  students: Awaited<ReturnType<typeof getCourseMembers>>;
  exercises: GradebookExercise[];
  studentMarksByExerciseId: GradebookStudentMarks;
  /** Ejercicios que el docente todavía no habilitó: no tienen columna ni cuentan en el promedio. */
  lockedExercises: number;
};

function buildStudentMarksByExerciseId(marks: Mark[]): GradebookStudentMarks {
  const result: GradebookStudentMarks = {};
  for (const mark of marks) {
    const { groupmemberId, exerciseId, totalPointsGotten } = mark;
    if (!groupmemberId || !exerciseId) continue;
    if (!result[groupmemberId]) result[groupmemberId] = {};
    result[groupmemberId][exerciseId] = totalPointsGotten?.toString() ?? '0';
  }
  return result;
}

function buildExercises(marks: Mark[], contentItems: CourseContentItem[], courseLoaded: boolean): GradebookExercise[] {
  const marksByExerciseId = new Map<string, { title: string; points: number }>();
  const exerciseOrder: string[] = [];
  for (const mark of marks) {
    const { exerciseId, exerciseTitle, exercisePoints } = mark;
    if (!exerciseId) continue;
    if (!marksByExerciseId.has(exerciseId)) {
      exerciseOrder.push(exerciseId);
      marksByExerciseId.set(exerciseId, {
        title: exerciseTitle ?? '',
        points: exercisePoints ?? 0
      });
    }
  }

  const exerciseItems = contentItems.filter((item) => item.type === ContentType.Exercise);
  // Con el curso cargado manda su contenido, aunque no quede ningún ejercicio
  // habilitado: lo que sigue arma las columnas desde las notas, y ahí vuelven los
  // bloqueados.
  if (courseLoaded) {
    return exerciseItems.map((item) => {
      const fromMarks = marksByExerciseId.get(item.id);
      return {
        id: item.id,
        title: item.title ?? fromMarks?.title ?? '',
        points: fromMarks?.points ?? 0
      };
    });
  }

  return exerciseOrder.map((id) => {
    const fromMarks = marksByExerciseId.get(id)!;
    return {
      id,
      title: fromMarks?.title ?? '',
      points: fromMarks?.points ?? 0
    };
  });
}

/**
 * La libreta según quién la pide.
 *
 * El equipo del curso la ve entera. Un alumno ve su fila y nada más: la ruta
 * sólo exige ser miembro del curso, y devolvía los nombres, correos y notas de
 * todos los compañeros (medido el 2026-11-11; el panel los escondía en pantalla,
 * pero ya habían viajado). Lo que el alumno necesita para ver sus notas —las
 * columnas y su fila— sigue llegando.
 */
export async function getGradebookFor(courseId: string, viewerId: string): Promise<GradebookResponse> {
  const [libreta, esDelEquipo] = await Promise.all([
    getGradebook(courseId),
    isCourseTeamMemberOrOrgAdmin(courseId, viewerId)
  ]);

  return esDelEquipo ? libreta : soloLoPropio(libreta, viewerId);
}

/** La libreta recortada a las filas de una persona. */
export function soloLoPropio(libreta: GradebookResponse, profileId: string): GradebookResponse {
  const students = libreta.students.filter((alumno) => alumno.profileId === profileId);
  const propias = new Set(students.map((alumno) => alumno.id));

  return {
    ...libreta,
    students,
    studentMarksByExerciseId: Object.fromEntries(
      Object.entries(libreta.studentMarksByExerciseId).filter(([miembro]) => propias.has(miembro))
    )
  };
}

/**
 * Returns all data needed to render the marks gradebook: students, exercises in order, and marks per student per exercise.
 * Trae a TODOS los alumnos: para contestarle a una persona, usar `getGradebookFor`.
 */
export async function getGradebook(courseId: string): Promise<GradebookResponse> {
  try {
    const [marks, members, course] = await Promise.all([
      getMarksByCourseId(courseId),
      getCourseMembers(courseId),
      getCourseWithRelations(courseId)
    ]);

    const students = members.filter((m) => Number(m.roleId) === ROLE.STUDENT);

    let contentItems: CourseContentItem[] = [];
    if (course?.contentItems != null) {
      const isGrouping = course.metadata?.isContentGroupingEnabled ?? true;
      const content = buildCourseContent(course.contentItems, isGrouping);
      contentItems = content.grouped ? (content.sections ?? []).flatMap((s) => s.items ?? []) : (content.items ?? []);
    }

    // Lo bloqueado no lo pudo hacer nadie: con su columna en blanco y sus puntos
    // en el promedio, la pantalla le daba a quien terminó todo lo habilitado un
    // 52 % donde el reporte dice 90 % (medido 2026-11-02, con 3 de 6 bloqueados).
    // Misma regla que el reporte de alumnos.
    const unlockedItems = contentItems.filter(
      (item) => item.type !== ContentType.Exercise || item.isUnlocked !== false
    );
    const lockedExercises = contentItems.length - unlockedItems.length;

    const exercises = buildExercises(marks, unlockedItems, course?.contentItems != null);
    const studentMarksByExerciseId = buildStudentMarksByExerciseId(marks);

    return {
      students,
      exercises,
      studentMarksByExerciseId,
      lockedExercises
    };
  } catch (error) {
    console.error('getGradebook error:', error);
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to get gradebook',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

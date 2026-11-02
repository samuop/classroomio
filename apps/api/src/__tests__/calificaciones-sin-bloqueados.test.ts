import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * La pantalla de Calificaciones cuenta lo mismo que el reporte de alumnos.
 *
 * Medido el 2026-11-02, en un curso que se habilita por etapas (3 de 6
 * cuestionarios bloqueados): la pantalla ponía una columna por cada uno, también
 * los bloqueados, y los sumaba al promedio. Quien había terminado todo lo
 * habilitado veía 52 % en pantalla y 90 % en el reporte, en los 34 alumnos con
 * nota. Y el examen final, que va después de los bloqueados, quedaba fuera de la
 * vista: la docente veía dos columnas con notas donde el reporte tiene tres.
 */

const falso = vi.hoisted(() => ({ notas: vi.fn(), curso: vi.fn() }));

vi.mock('@cio/db/queries/mark', () => ({ getMarksByCourseId: falso.notas }));
vi.mock('@cio/db/queries/course/people', () => ({
  getCourseMembers: vi.fn(async () => [{ id: 'gm-1', roleId: 3, profile: { fullname: 'Alumna' } }])
}));
vi.mock('@cio/db/queries/course', () => ({ getCourseWithRelations: falso.curso }));

const { getGradebook } = await import('@api/services/mark/gradebook');

const fila = (id: string, type: ContentType, order: number, isUnlocked: boolean) => ({
  id,
  type,
  title: id,
  order,
  createdAt: null,
  sectionId: null,
  isUnlocked,
  isComplete: null,
  lessonAt: null,
  callUrl: null,
  hasNoteContent: null,
  hasSlideContent: null,
  videosCount: null,
  documentsCount: null,
  questionCount: null,
  dueBy: null
});

/** El curso como está en producción: caja y recepción habilitados, tres bloqueados, el examen final habilitado. */
const CONTENIDO = [
  fila('leccion-1', ContentType.Lesson, 0, true),
  fila('caja', ContentType.Exercise, 1, true),
  fila('recepcion', ContentType.Exercise, 2, true),
  fila('precios', ContentType.Exercise, 3, false),
  fila('temporada', ContentType.Exercise, 4, false),
  fila('seguridad', ContentType.Exercise, 5, false),
  fila('examen-final', ContentType.Exercise, 6, true)
];

const PUNTOS: Record<string, number> = {
  caja: 8,
  recepcion: 11,
  precios: 8,
  temporada: 7,
  seguridad: 8,
  'examen-final': 12
};

/** Una nota de la alumna en cada habilitado, y una fila sin entregas por cada bloqueado. */
const NOTAS = [
  { exerciseId: 'caja', totalPointsGotten: 7, groupmemberId: 'gm-1' },
  { exerciseId: 'recepcion', totalPointsGotten: 6, groupmemberId: 'gm-1' },
  { exerciseId: 'examen-final', totalPointsGotten: 8, groupmemberId: 'gm-1' },
  { exerciseId: 'precios', totalPointsGotten: null, groupmemberId: null },
  { exerciseId: 'temporada', totalPointsGotten: null, groupmemberId: null },
  { exerciseId: 'seguridad', totalPointsGotten: null, groupmemberId: null }
].map((nota) => ({ ...nota, exerciseTitle: nota.exerciseId, exercisePoints: PUNTOS[nota.exerciseId], courseId: 'c' }));

beforeEach(() => {
  falso.notas.mockResolvedValue(NOTAS);
  falso.curso.mockResolvedValue({ contentItems: CONTENIDO, metadata: { isContentGroupingEnabled: false } });
});

describe('con cuestionarios bloqueados', () => {
  it('las columnas son sólo los habilitados, en el orden del curso: las mismas tres del reporte', async () => {
    const libreta = await getGradebook('c');

    expect(libreta.exercises.map((e) => e.id)).toEqual(['caja', 'recepcion', 'examen-final']);
    expect(libreta.lockedExercises).toBe(3);
  });

  it('el promedio de la pantalla da lo mismo que la nota final del reporte', async () => {
    const libreta = await getGradebook('c');

    // La pantalla divide lo ganado por los puntos de sus columnas (calculateStudentAverage).
    const posibles = libreta.exercises.reduce((suma, e) => suma + e.points, 0);
    const ganados = libreta.exercises.reduce(
      (suma, e) => suma + Number(libreta.studentMarksByExerciseId['gm-1'][e.id]),
      0
    );

    expect(posibles).toBe(31);
    expect(Math.round((ganados / posibles) * 100)).toBe(68); // 21 de 31, como el reporte; antes 21 de 54 = 39
  });
});

it('si está todo bloqueado no hay columnas, en vez de armarlas con las notas', async () => {
  falso.curso.mockResolvedValue({
    contentItems: CONTENIDO.map((item) => ({ ...item, isUnlocked: item.type === ContentType.Lesson })),
    metadata: { isContentGroupingEnabled: false }
  });

  const libreta = await getGradebook('c');

  expect(libreta.exercises).toEqual([]);
  expect(libreta.lockedExercises).toBe(6);
});

it('sin el curso cargado sigue armando las columnas con las notas, como antes', async () => {
  falso.curso.mockResolvedValue(null);

  const libreta = await getGradebook('c');

  expect(libreta.exercises.map((e) => e.id)).toEqual([
    'caja',
    'recepcion',
    'examen-final',
    'precios',
    'temporada',
    'seguridad'
  ]);
  expect(libreta.lockedExercises).toBe(0);
});

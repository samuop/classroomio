import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un alumno ve sus notas, no las de sus compañeros.
 *
 * Medido el 2026-11-11: la ruta de la libreta sólo exige ser miembro del curso,
 * y a una alumna le devolvía el nombre, el correo y las notas de todo el curso.
 * El panel escondía la tabla en pantalla, pero los datos ya habían viajado.
 */

const falso = vi.hoisted(() => ({ notas: vi.fn(), esDelEquipo: vi.fn() }));

vi.mock('@cio/db/queries/mark', () => ({ getMarksByCourseId: falso.notas }));
vi.mock('@cio/db/queries/course', () => ({ getCourseWithRelations: vi.fn(async () => null) }));
vi.mock('@cio/db/queries/group', () => ({ isCourseTeamMemberOrOrgAdmin: falso.esDelEquipo }));
vi.mock('@cio/db/queries/course/people', () => ({
  getCourseMembers: vi.fn(async () => [
    { id: 'gm-docente', roleId: 2, profileId: 'docente', profile: { fullname: 'Docente', email: 'docente@local.test' } },
    { id: 'gm-ana', roleId: 3, profileId: 'ana', profile: { fullname: 'Ana', email: 'ana@demo.test' } },
    { id: 'gm-beto', roleId: 3, profileId: 'beto', profile: { fullname: 'Beto', email: 'beto@demo.test' } }
  ])
}));

// La ruta, con quien pide en un encabezado: lo que se mide es que la ruta le
// pase esa persona al servicio, no sólo que el servicio sepa recortar.
vi.mock('@api/middlewares/auth', () => ({
  authMiddleware: async (c: { set: Function; req: { header: Function } }, next: () => Promise<void>) => {
    c.set('user', { id: c.req.header('x-quien') });
    await next();
  }
}));
vi.mock('@api/middlewares/course-member', () => ({
  courseMemberMiddleware: async (_c: unknown, next: () => Promise<void>) => next()
}));
vi.mock('@api/middlewares/course-team-member', () => ({
  courseTeamMemberMiddleware: async (_c: unknown, next: () => Promise<void>) => next()
}));
vi.mock('@api/services/course/course-report', () => ({ generateCourseReport: vi.fn() }));

const { getGradebookFor } = await import('@api/services/mark/gradebook');
const { getMarksFor } = await import('@api/services/mark');
const { Hono } = await import('@api/utils/hono');
const { markRouter } = await import('@api/routes/course/mark');

const pedir = (ruta: string, quien: string) =>
  new Hono().route('/course/:courseId/mark', markRouter).request(`/course/c/mark${ruta}`, { headers: { 'x-quien': quien } });

const nota = (groupmemberId: string | null, exerciseId: string, totalPointsGotten: number | null) => ({
  groupmemberId,
  exerciseId,
  totalPointsGotten,
  exerciseTitle: exerciseId,
  exercisePoints: 10,
  courseId: 'c'
});

const NOTAS = [
  nota('gm-ana', 'caja', 7),
  nota('gm-beto', 'caja', 3),
  nota('gm-beto', 'examen', 9),
  // Un ejercicio que nadie entregó: la fila no es de nadie.
  nota(null, 'recepcion', null)
];

beforeEach(() => {
  falso.notas.mockResolvedValue(NOTAS);
  falso.esDelEquipo.mockImplementation(async (_curso: string, persona: string) => persona === 'docente');
});

describe('la libreta', () => {
  it('a una alumna le llega su fila y ninguna otra', async () => {
    const libreta = await getGradebookFor('c', 'ana');

    expect(libreta.students.map((alumno) => alumno.profileId)).toEqual(['ana']);
    expect(Object.keys(libreta.studentMarksByExerciseId)).toEqual(['gm-ana']);
    expect(JSON.stringify(libreta)).not.toContain('beto');
    // Sus notas y las columnas siguen llegando: la pantalla del alumno no se rompe.
    expect(libreta.studentMarksByExerciseId['gm-ana']).toEqual({ caja: '7' });
    expect(libreta.exercises.map((e) => e.id)).toEqual(['caja', 'examen', 'recepcion']);
  });

  it('a la docente le llega entera', async () => {
    const libreta = await getGradebookFor('c', 'docente');

    expect(libreta.students.map((alumno) => alumno.profileId)).toEqual(['ana', 'beto']);
    expect(Object.keys(libreta.studentMarksByExerciseId).sort()).toEqual(['gm-ana', 'gm-beto']);
  });

  it('quien no es alumno ni del equipo no recibe filas de nadie', async () => {
    const libreta = await getGradebookFor('c', 'otra-persona');

    expect(libreta.students).toEqual([]);
    expect(libreta.studentMarksByExerciseId).toEqual({});
  });
});

describe('las rutas', () => {
  it('GET /gradebook le contesta a la alumna sin los datos de su compañero', async () => {
    const respuesta = await pedir('/gradebook', 'ana');
    const cuerpo = await respuesta.text();

    expect(respuesta.status).toBe(200);
    expect(cuerpo).toContain('ana@demo.test');
    expect(cuerpo).not.toContain('beto');
  });

  it('GET / (las notas) tampoco trae las del compañero', async () => {
    const cuerpo = await (await pedir('', 'ana')).text();

    expect(cuerpo).toContain('gm-ana');
    expect(cuerpo).not.toContain('gm-beto');
  });

  it('a la docente las dos le contestan con todo', async () => {
    expect(await (await pedir('/gradebook', 'docente')).text()).toContain('beto@demo.test');
    expect(await (await pedir('', 'docente')).text()).toContain('gm-beto');
  });
});

describe('la lista de notas', () => {
  it('a una alumna le llegan las suyas y las filas sin alumno', async () => {
    const notas = await getMarksFor('c', 'ana');

    expect(notas.map((n) => [n.groupmemberId, n.exerciseId])).toEqual([
      ['gm-ana', 'caja'],
      [null, 'recepcion']
    ]);
  });

  it('a la docente le llegan todas', async () => {
    expect(await getMarksFor('c', 'docente')).toHaveLength(NOTAS.length);
  });
});

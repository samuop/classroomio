import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lo que el docente bloquea, el alumno no lo lee por ninguna vía.
 *
 * Hasta 2026-11-02 el bloqueo vivía sólo en la pantalla: la API le mandaba al
 * navegador del alumno el texto de la lección o las preguntas del ejercicio, y
 * la página los tapaba con un cartel. Y el tutor de IA buscaba en las lecciones
 * bloqueadas como en cualquier otra. En producción, 14 alumnos llegaron a la
 * página de un cuestionario bloqueado: vieron el cartel, pero el contenido ya
 * estaba en su navegador.
 *
 * Se fija: al alumno lo bloqueado le llega sin contenido (con la misma forma,
 * para que la pantalla muestre su cartel), no lo puede completar ni entregar, lo
 * de otro curso no existe, y el equipo del curso sigue viendo todo. Y que el
 * tutor no lo lee ni lo encuentra.
 */

const falso = vi.hoisted(() => ({
  esDelEquipo: vi.fn(),
  getLesson: vi.fn(),
  getExercise: vi.fn(),
  leccionVinculo: vi.fn(),
  ejercicioVinculo: vi.fn(),
  semantica: vi.fn(),
  wheres: [] as unknown[][]
}));

vi.mock('@cio/db/queries/group', () => ({ isCourseTeamMemberOrOrgAdmin: falso.esDelEquipo }));
vi.mock('@cio/db/queries/agent', () => ({
  getLessonCourseBinding: falso.leccionVinculo,
  getExerciseCourseBinding: falso.ejercicioVinculo
}));
vi.mock('@api/services/lesson/lesson', () => ({ getLesson: falso.getLesson }));
vi.mock('@api/services/exercise/exercise', () => ({ getExercise: falso.getExercise }));

// Para las herramientas del tutor.
vi.mock('@api/utils/tinybird', () => ({ AgentEvent: { TOOL_CALLED: 'a', TOOL_COMPLETED: 'b' }, trackAgentEvent: vi.fn() }));
vi.mock('@api/services/agent/chat-context', () => ({
  verifyLessonBelongsToCourse: vi.fn(async () => {}),
  verifyExerciseBelongsToCourse: vi.fn(async () => {})
}));
vi.mock('@api/services/agent/embeddings', () => ({ semanticSearchCourse: falso.semantica }));
vi.mock('@api/services/course/section', () => ({ listCourseSections: vi.fn(async () => []) }));

/** Una consulta encadenada de drizzle que devuelve `[]` y anota cada `where`. */
function consultaVacia(): unknown {
  const cadena: unknown = new Proxy(() => {}, {
    get(_destino, propiedad) {
      if (propiedad === 'then') return (ok: (v: unknown[]) => unknown) => Promise.resolve([]).then(ok);
      if (propiedad === 'where') {
        return (...args: unknown[]) => {
          falso.wheres.push(args);
          return cadena;
        };
      }
      return () => cadena;
    }
  });
  return cadena;
}
vi.mock('@cio/db', () => ({ db: { select: () => consultaVacia() } }));

const {
  assertExerciseWorkable,
  assertLessonWorkable,
  canReadLesson,
  exerciseForViewer,
  exercisesForViewer,
  lessonForViewer,
  lessonsForViewer
} = await import('@api/services/course/locked-content');
const { buildStudentAgentTools } = await import('@api/services/agent/student-tools');

const CURSO = 'curso-a';
const ALUMNO = 'alumno-1';

const leccion = (isUnlocked: boolean, courseId = CURSO) => ({
  id: 'leccion-1',
  courseId,
  title: 'Exhibir productos por familia',
  isUnlocked,
  order: 4,
  note: '<p>Nota del docente</p>',
  videoUrl: 'https://video.ejemplo.test/1',
  slideUrl: 'https://slides.ejemplo.test/1',
  callUrl: null,
  videos: [{ link: 'https://video.ejemplo.test/2' }],
  documents: [{ name: 'Planilla.pdf', link: 'https://docs.ejemplo.test/1' }],
  lessonLanguages: [{ locale: 'es', content: '<p>El texto de la lección</p>' }]
});

const ejercicio = (isUnlocked: boolean, courseId = CURSO) => ({
  id: 'ejercicio-1',
  courseId,
  title: 'Cuestionario de precios',
  description: 'Consigna del cuestionario',
  isUnlocked,
  isComplete: false,
  questions: [{ id: 1, title: '¿Cada cuánto se controlan los vencimientos?', options: [] }],
  sections: [{ id: 's1', title: 'Parte 1', questions: [] }]
});

beforeEach(() => {
  vi.clearAllMocks();
  falso.wheres.length = 0;
  falso.esDelEquipo.mockResolvedValue(false);
});

describe('una lección bloqueada', () => {
  it('al alumno le llega con su título y su lugar, sin texto, videos, documentos ni presentación', async () => {
    falso.getLesson.mockResolvedValue(leccion(false));

    const vista = await lessonForViewer(CURSO, 'leccion-1', ALUMNO);

    expect(vista).toMatchObject({ id: 'leccion-1', title: 'Exhibir productos por familia', isUnlocked: false, order: 4 });
    expect(vista).toMatchObject({
      note: null,
      videoUrl: null,
      slideUrl: null,
      videos: [],
      documents: [],
      lessonLanguages: []
    });
    expect(JSON.stringify(vista)).not.toContain('El texto de la lección');
  });

  it('el equipo del curso la sigue viendo entera: es quien la arma', async () => {
    falso.getLesson.mockResolvedValue(leccion(false));
    falso.esDelEquipo.mockResolvedValue(true);

    expect(await lessonForViewer(CURSO, 'leccion-1', 'docente-1')).toEqual(leccion(false));
  });

  it('habilitada, le llega entera al alumno sin preguntar si es del equipo', async () => {
    falso.getLesson.mockResolvedValue(leccion(true));

    expect(await lessonForViewer(CURSO, 'leccion-1', ALUMNO)).toEqual(leccion(true));
    expect(falso.esDelEquipo).not.toHaveBeenCalled();
  });

  it('una lección de otro curso no existe, aunque esté habilitada', async () => {
    falso.getLesson.mockResolvedValue(leccion(true, 'curso-b'));

    await expect(lessonForViewer(CURSO, 'leccion-1', ALUMNO)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('en la lista del curso, sólo las bloqueadas pierden el contenido', async () => {
    const lista = await lessonsForViewer(CURSO, [leccion(true), { ...leccion(false), id: 'leccion-2' }], ALUMNO);

    expect(lista[0]).toEqual(leccion(true));
    expect(lista[1]).toMatchObject({ id: 'leccion-2', note: null, videos: [] });
  });

  it('no se puede completar ni leer por idioma, y lo de otro curso es 404', async () => {
    falso.leccionVinculo.mockResolvedValue({ courseId: CURSO, title: 'x', isUnlocked: false });

    expect(await canReadLesson(CURSO, 'leccion-1', ALUMNO)).toBe(false);
    await expect(assertLessonWorkable(CURSO, 'leccion-1', ALUMNO)).rejects.toMatchObject({ statusCode: 403 });

    falso.leccionVinculo.mockResolvedValue({ courseId: 'curso-b', title: 'x', isUnlocked: true });
    await expect(canReadLesson(CURSO, 'leccion-1', ALUMNO)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('un ejercicio bloqueado', () => {
  it('al alumno le llega sin consigna ni preguntas, y la pantalla puede mostrar su cartel', async () => {
    falso.getExercise.mockResolvedValue(ejercicio(false));

    const vista = await exerciseForViewer(CURSO, 'ejercicio-1', ALUMNO);

    expect(vista).toMatchObject({ id: 'ejercicio-1', isUnlocked: false, description: null, questions: [], sections: [] });
    expect(JSON.stringify(vista)).not.toContain('vencimientos');
  });

  it('el equipo lo sigue viendo entero, y uno de otro curso no existe', async () => {
    falso.getExercise.mockResolvedValue(ejercicio(false));
    falso.esDelEquipo.mockResolvedValue(true);
    expect(await exerciseForViewer(CURSO, 'ejercicio-1', 'docente-1')).toEqual(ejercicio(false));

    falso.getExercise.mockResolvedValue(ejercicio(true, 'curso-b'));
    await expect(exerciseForViewer(CURSO, 'ejercicio-1', ALUMNO)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('en la lista, el bloqueado pierde la consigna', async () => {
    const lista = await exercisesForViewer(CURSO, [ejercicio(true), { ...ejercicio(false), id: 'ejercicio-2' }], ALUMNO);

    expect(lista[0]!.description).toBe('Consigna del cuestionario');
    expect(lista[1]!.description).toBeNull();
  });

  it('no se puede entregar; el equipo sí, y uno de otro curso es 404', async () => {
    falso.ejercicioVinculo.mockResolvedValue({ courseId: CURSO, title: 'x', isUnlocked: false });
    await expect(assertExerciseWorkable(CURSO, 'ejercicio-1', ALUMNO)).rejects.toMatchObject({ statusCode: 403 });

    falso.esDelEquipo.mockResolvedValue(true);
    await expect(assertExerciseWorkable(CURSO, 'ejercicio-1', 'docente-1')).resolves.toBeUndefined();

    falso.ejercicioVinculo.mockResolvedValue({ courseId: 'curso-b', title: 'x', isUnlocked: true });
    await expect(assertExerciseWorkable(CURSO, 'ejercicio-1', ALUMNO)).rejects.toMatchObject({ statusCode: 404 });
  });
});

/** Si una condición de drizzle contiene el texto (recorre sus pedazos de SQL). */
function contiene(valor: unknown, texto: string, vistos = new Set<unknown>()): boolean {
  if (typeof valor === 'string') return valor.includes(texto);
  if (!valor || typeof valor !== 'object' || vistos.has(valor)) return false;
  vistos.add(valor);
  return Object.values(valor).some((v) => contiene(v, texto, vistos));
}

describe('el tutor de IA del alumno', () => {
  const herramientas = () => buildStudentAgentTools('org', ALUMNO, CURSO, {} as never, 'es');
  const ejecutar = (nombre: string, args: object) =>
    (herramientas()[nombre] as { execute: (a: object, o: object) => Promise<unknown> }).execute(args, {
      toolCallId: 't',
      messages: []
    });

  it('no lee una lección bloqueada: le avisa al modelo que todavía no está habilitada', async () => {
    falso.getLesson.mockResolvedValue(leccion(false));

    const resultado = await ejecutar('read_lesson', { lessonId: 'leccion-1' });

    expect(resultado).toEqual({ error: expect.stringContaining('locked') });
    expect(JSON.stringify(resultado)).not.toContain('El texto de la lección');
  });

  it('no lee un ejercicio bloqueado', async () => {
    falso.getExercise.mockResolvedValue(ejercicio(false));

    const resultado = await ejecutar('read_exercise', { exerciseId: 'ejercicio-1' });

    expect(resultado).toEqual({ error: expect.stringContaining('locked') });
  });

  it('una lección habilitada la sigue leyendo', async () => {
    falso.getLesson.mockResolvedValue(leccion(true));

    expect(await ejecutar('read_lesson', { lessonId: 'leccion-1' })).toMatchObject({
      content: '<p>El texto de la lección</p>'
    });
  });

  it('al buscar, pide sólo lo habilitado: fragmentos, lecciones y ejercicios', async () => {
    falso.semantica.mockResolvedValue([]);

    await ejecutar('search_course', { query: 'vencimientos', limit: 8 });

    expect(falso.semantica).toHaveBeenCalledWith(expect.objectContaining({ onlyUnlocked: true }));
    // Sin fragmentos indexados cae a la búsqueda literal: ejercicios y lecciones.
    expect(falso.wheres).toHaveLength(2);
    for (const where of falso.wheres) {
      expect(contiene(where, 'IS NOT FALSE')).toBe(true);
    }
  });
});

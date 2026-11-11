import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un borrado grande pasa por la docente antes de ejecutarse.
 *
 * Medido el 2026-11-11: ante «eliminá todo el contenido de todas las secciones
 * excepto la 1», el asistente borró ocho piezas en la misma ronda. No hay
 * papelera. Ver `borrado-en-lote.ts`.
 *
 * Acá se fija la regla sola (el contador y la lista) y la regla puesta en las
 * herramientas, que es donde un descuido la dejaría sin efecto.
 */

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@api/services/lesson/lesson', async (original) => ({
  ...(await original<typeof import('@api/services/lesson/lesson')>()),
  getLesson: vi.fn(async (id: string) => ({ id, title: `Lección ${id}` })),
  deleteLessonService: vi.fn()
}));

vi.mock('@api/services/exercise/exercise', async (original) => ({
  ...(await original<typeof import('@api/services/exercise/exercise')>()),
  getExercise: vi.fn(async (id: string) => ({ id, title: `Cuestionario ${id}`, questions: [] })),
  deleteExerciseForCourseService: vi.fn()
}));

vi.mock('@api/services/course/section', async (original) => ({
  ...(await original<typeof import('@api/services/course/section')>()),
  listCourseSections: vi.fn(async () => [{ id: SECCION, title: 'Sección vacía' }]),
  deleteCourseSectionService: vi.fn()
}));

vi.mock('@cio/db/queries/course/content', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/course/content')>()),
  getCourseContentItems: vi.fn(async () => [
    ...LECCIONES.map((id) => ({ id, type: 'LESSON', title: `Lección ${id}`, sectionId: null })),
    { id: EJERCICIO, type: 'EXERCISE', title: `Cuestionario ${EJERCICIO}`, sectionId: null }
  ])
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  entregasDelEjercicio: vi.fn(async () => ({ cantidad: 0, promedio: null })),
  loQueSeVaConLaLeccion: vi.fn(async () => ({ ejerciciosConEntregas: [], alumnosQueLaCompletaron: 0 }))
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { deleteLessonService } from '@api/services/lesson/lesson';
import { deleteExerciseForCourseService } from '@api/services/exercise/exercise';
import { deleteCourseSectionService } from '@api/services/course/section';
import { loQueSeVaConLaLeccion } from '@cio/db/queries/agent';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { crearBorradoEnLote, MAX_BORRADOS_SIN_LISTA, type AlmacenDeListas } from '@api/services/agent/borrado-en-lote';

const CURSO = '00000000-0000-4000-8000-00000000c008';
const SECCION = '5ecc1000-0000-4000-8000-000000000001';
const EJERCICIO = 'e1e1e1e1-0000-4000-8000-000000000001';
const LECCIONES = [1, 2, 3, 4, 5, 6].map((n) => `1ecc1000-0000-4000-8000-00000000000${n}`);
const OPCIONES = { toolCallId: 'llamada', messages: [] };

/** Un Redis de mentira: lo que una ronda guarda, la siguiente lo lee. */
function almacenEnMemoria(): AlmacenDeListas & { datos: Map<string, string> } {
  const datos = new Map<string, string>();

  return {
    datos,
    get: async (clave) => datos.get(clave) ?? null,
    set: async (clave, valor) => void datos.set(clave, valor)
  };
}

/** Las herramientas de UNA ronda: cada llamada a esta función es una ronda nueva. */
function ronda(almacen: AlmacenDeListas | null) {
  return buildAgentTools('org', 'docente', CURSO, [], {
    conversationId: 'conversacion',
    locale: 'es',
    ...(almacen ? { redis: almacen as never } : {})
  }) as Record<string, { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }>;
}

const borrarLeccion = (herramientas: ReturnType<typeof ronda>, id: string) =>
  herramientas.delete_lesson.execute({ lessonId: id, confirmTitle: `Lección ${id}` }, OPCIONES);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('la regla', () => {
  it(`deja pasar ${MAX_BORRADOS_SIN_LISTA} borrados sin lista y niega el siguiente`, async () => {
    const borrado = crearBorradoEnLote({});
    const permisos = [];

    for (const id of ['a', 'b', 'c', 'd']) permisos.push(await borrado.pedirPermiso(id));

    expect(permisos.map((p) => p.ok)).toEqual([true, true, true, false]);
    expect(permisos[3]).toMatchObject({ motivo: expect.stringContaining('request_bulk_delete') });
  });

  it('borrados mandados a la vez no cuentan todos como «el tercero»', async () => {
    const borrado = crearBorradoEnLote({ almacen: almacenEnMemoria(), conversationId: 'c' });
    const permisos = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => borrado.pedirPermiso(id)));

    expect(permisos.filter((p) => p.ok)).toHaveLength(MAX_BORRADOS_SIN_LISTA);
  });

  it('lo declarado no se borra en la misma ronda: ni eso ni «tres de yapa»', async () => {
    const borrado = crearBorradoEnLote({ almacen: almacenEnMemoria(), conversationId: 'c' });

    await borrado.declarar(['a', 'b', 'c', 'd', 'e']);

    expect(await borrado.pedirPermiso('a')).toMatchObject({ ok: false, motivo: expect.stringContaining('THIS round') });
    expect(await borrado.pedirPermiso('otra')).toMatchObject({ ok: false });
  });

  it('en la ronda siguiente se borra todo lo declarado, y lo que no estaba en la lista sigue con el tope', async () => {
    const almacen = almacenEnMemoria();

    await crearBorradoEnLote({ almacen, conversationId: 'c' }).declarar(['a', 'b', 'c', 'd', 'e']);

    const despues = crearBorradoEnLote({ almacen, conversationId: 'c' });
    const declarados = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => despues.pedirPermiso(id)));
    const fuera = [];

    for (const id of ['w', 'x', 'y', 'z']) fuera.push(await despues.pedirPermiso(id));

    expect(declarados.every((p) => p.ok)).toBe(true);
    expect(fuera.map((p) => p.ok)).toEqual([true, true, true, false]);
  });

  it('la lista es de su conversación: otra no la hereda', async () => {
    const almacen = almacenEnMemoria();

    await crearBorradoEnLote({ almacen, conversationId: 'una' }).declarar(['a', 'b', 'c', 'd']);

    const otra = crearBorradoEnLote({ almacen, conversationId: 'otra' });
    const permisos = [];

    for (const id of ['a', 'b', 'c', 'd']) permisos.push(await otra.pedirPermiso(id));

    expect(permisos.map((p) => p.ok)).toEqual([true, true, true, false]);
  });

  it('si el almacén falla, queda el tope: falla hacia no borrar', async () => {
    const roto: AlmacenDeListas = {
      get: async () => {
        throw new Error('redis caído');
      },
      set: async () => undefined
    };
    const borrado = crearBorradoEnLote({ almacen: roto, conversationId: 'c' });
    const permisos = [];

    for (const id of ['a', 'b', 'c', 'd']) permisos.push(await borrado.pedirPermiso(id));

    expect(permisos.map((p) => p.ok)).toEqual([true, true, true, false]);
  });
});

describe('en las herramientas', () => {
  it('una ronda borra tres lecciones y la cuarta se niega sin tocar la base', async () => {
    const herramientas = ronda(almacenEnMemoria());
    const resultados = [];

    for (const id of LECCIONES.slice(0, 4)) resultados.push(await borrarLeccion(herramientas, id));

    expect(resultados.slice(0, 3).every((r) => r.deleted === true)).toBe(true);
    expect(resultados[3]).toMatchObject({ ok: false, error: expect.stringContaining('request_bulk_delete') });
    expect(deleteLessonService).toHaveBeenCalledTimes(3);
  });

  it('el tope es de la ronda entera: lecciones, ejercicios y secciones cuentan juntos', async () => {
    const herramientas = ronda(almacenEnMemoria());

    await borrarLeccion(herramientas, LECCIONES[0]);
    await borrarLeccion(herramientas, LECCIONES[1]);
    await herramientas.delete_exercise.execute(
      { exerciseId: EJERCICIO, confirmTitle: `Cuestionario ${EJERCICIO}` },
      OPCIONES
    );

    const seccion = await herramientas.delete_section.execute(
      { sectionId: SECCION, confirmTitle: 'Sección vacía' },
      OPCIONES
    );

    expect(deleteExerciseForCourseService).toHaveBeenCalledTimes(1);
    expect(seccion).toMatchObject({ ok: false });
    expect(deleteCourseSectionService).not.toHaveBeenCalled();
  });

  it('request_bulk_delete no borra nada, devuelve la lista con lo que se llevaría, y frena la ronda', async () => {
    vi.mocked(loQueSeVaConLaLeccion).mockResolvedValueOnce({ ejerciciosConEntregas: [], alumnosQueLaCompletaron: 7 });

    const herramientas = ronda(almacenEnMemoria());
    const declarado = await herramientas.request_bulk_delete.execute(
      { items: [...LECCIONES.map((id) => ({ kind: 'lesson', id })), { kind: 'section', id: SECCION }] },
      OPCIONES
    );

    expect(declarado).toMatchObject({ status: 'needs_teacher_confirmation', nothingWasDeleted: true, count: 7 });
    expect((declarado.items as Array<Record<string, unknown>>)[0]).toMatchObject({
      title: `Lección ${LECCIONES[0]}`,
      learnersWhoCompletedIt: 7
    });
    expect(deleteLessonService).not.toHaveBeenCalled();

    // En la misma ronda no se borra ni una.
    expect(await borrarLeccion(herramientas, LECCIONES[0])).toMatchObject({
      ok: false,
      error: expect.stringContaining('THIS round')
    });
    expect(deleteLessonService).not.toHaveBeenCalled();
  });

  it('en la ronda siguiente, lo declarado se borra entero', async () => {
    const almacen = almacenEnMemoria();

    await ronda(almacen).request_bulk_delete.execute(
      { items: LECCIONES.map((id) => ({ kind: 'lesson', id })) },
      OPCIONES
    );

    const siguiente = ronda(almacen);
    const resultados = [];

    for (const id of LECCIONES) resultados.push(await borrarLeccion(siguiente, id));

    expect(resultados.every((r) => r.deleted === true)).toBe(true);
    expect(deleteLessonService).toHaveBeenCalledTimes(LECCIONES.length);
  });

  it('una pieza que no es del curso no entra en la lista, y la lista no se guarda', async () => {
    const almacen = almacenEnMemoria();
    const resultado = await ronda(almacen).request_bulk_delete.execute(
      { items: [{ kind: 'lesson', id: 'ffffffff-0000-4000-8000-000000000000' }] },
      OPCIONES
    );

    expect(resultado).toMatchObject({ ok: false });
    expect(almacen.datos.size).toBe(0);
  });
});

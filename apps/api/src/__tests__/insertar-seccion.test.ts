import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Una sección nueva se INSERTA: nunca quedan dos en la misma posición.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22, «agregá una sección» sobre un curso ya construido. El modelo pidió
 * `order: 2`, que era el del examen final, y el servidor la creó igual: el curso
 * terminó con dos secciones en la posición 2.
 *
 * No es un problema estético. Las manijas son POSICIONALES (`S1`, `S2`, `S3`),
 * así que con dos secciones empatadas la manija de una de ellas depende del
 * desempate, y el paso siguiente del agente puede escribir en la otra sin que
 * nada falle. Un error que no avisa es el que se descubre con el curso ya
 * publicado.
 *
 * Y no se puede dejar del lado del modelo: él no siempre sabe qué hay en cada
 * posición, y pedirle que lea la estructura antes de cada alta es un paso más
 * para un dato que el servidor tiene delante.
 *
 * Curso inventado, de una distribuidora que no existe.
 */

// El entorno de tests de la API es `node` y no puede cargar jsdom. Ningún
// camino de acá sanea HTML de verdad.
vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@api/services/course/section', () => ({
  listCourseSections: vi.fn(),
  createCourseSection: vi.fn(),
  updateCourseSectionService: vi.fn(),
  deleteCourseSectionService: vi.fn()
}));

vi.mock('@cio/db/queries/course/content', () => ({
  getCourseContentItems: vi.fn()
}));

vi.mock('@api/services/lesson/lesson', () => ({
  createLesson: vi.fn(),
  getLesson: vi.fn(),
  updateLessonService: vi.fn(),
  deleteLessonService: vi.fn()
}));

vi.mock('@api/services/exercise/exercise', () => ({
  createExercise: vi.fn(),
  getExercise: vi.fn(),
  createExerciseSectionService: vi.fn(),
  updateExerciseService: vi.fn(),
  updateExerciseSectionMetadataService: vi.fn(),
  deleteExerciseForCourseService: vi.fn()
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn().mockResolvedValue([])
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  resolvePlanBinding: vi.fn().mockResolvedValue(null)
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { listCourseSections, createCourseSection, updateCourseSectionService } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID = {
  mesaDeAyuda: '11111111-1111-4111-8111-111111111111',
  seguridad: '22222222-2222-4222-8222-222222222222',
  examenFinal: '33333333-3333-4333-8333-333333333333',
  devoluciones: '44444444-4444-4444-8444-444444444444'
};

const SECCIONES = [
  { id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-01T00:00:00Z' },
  { id: ID.seguridad, title: 'Seguridad e Higiene', order: 1, createdAt: '2026-01-02T00:00:00Z' },
  { id: ID.examenFinal, title: 'Examen final', order: 2, createdAt: '2026-01-03T00:00:00Z' }
];

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

let secciones: typeof SECCIONES;

function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es'
  }) as Record<string, Herramienta>;
}

beforeEach(() => {
  vi.clearAllMocks();
  secciones = SECCIONES.map((seccion) => ({ ...seccion }));
  vi.mocked(listCourseSections).mockImplementation(async () => secciones as never);
  vi.mocked(getCourseContentItems).mockResolvedValue([] as never);
  vi.mocked(updateCourseSectionService).mockImplementation(async (id: string, cambios: { order?: number }) => {
    const seccion = secciones.find((s) => s.id === id);

    if (seccion && typeof cambios.order === 'number') seccion.order = cambios.order;

    return seccion as never;
  });
  vi.mocked(createCourseSection).mockImplementation(async (_curso: string, datos: { title: string; order: number }) => {
    const nueva = {
      id: ID.devoluciones,
      title: datos.title,
      order: datos.order,
      createdAt: '2026-01-04T00:00:00Z'
    };
    secciones = [...secciones, nueva];

    return nueva as never;
  });
});

describe('crear una sección en una posición ocupada', () => {
  it('corre a las que venían después y lo dice', async () => {
    const resultado = await herramientas().create_section.execute(
      { title: 'Devoluciones', order: 2, planKey: 's3' },
      OPCIONES
    );

    expect(updateCourseSectionService).toHaveBeenCalledWith(ID.examenFinal, { order: 3 });
    expect(resultado).toMatchObject({
      id: ID.devoluciones,
      order: 2,
      note: 'Inserted at position 2; later sections were shifted.'
    });

    // Lo único que importa del estado final: ninguna posición repetida.
    const ordenes = secciones.map((s) => s.order);

    expect(new Set(ordenes).size).toBe(ordenes.length);
  });

  /**
   * De mayor a menor, y no al revés: corriendo primero la de arriba, la que
   * viene detrás encuentra su lugar libre. Al revés, cada paso deja un choque
   * nuevo — en una base con índice único, directamente falla.
   */
  it('con varias detrás, empieza por la última', async () => {
    await herramientas().create_section.execute({ title: 'Devoluciones', order: 1 }, OPCIONES);

    expect(vi.mocked(updateCourseSectionService).mock.calls.map(([id, cambios]) => [id, cambios])).toEqual([
      [ID.examenFinal, { order: 3 }],
      [ID.seguridad, { order: 2 }]
    ]);

    const ordenes = secciones.map((s) => s.order).sort();

    expect(ordenes).toEqual([0, 1, 2, 3]);
  });

  it('agregar al final no corre a nadie ni avisa nada', async () => {
    const resultado = await herramientas().create_section.execute({ title: 'Devoluciones', order: 3 }, OPCIONES);

    expect(updateCourseSectionService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: ID.devoluciones, order: 3 });
    expect(resultado.note).toBeUndefined();
  });

  /** La sección que ya existe se reusa: correr posiciones ahí sería mover el curso por nada. */
  it('una sección que ya existe con ese título no crea ni corre nada', async () => {
    const resultado = await herramientas().create_section.execute(
      { title: 'Seguridad e Higiene', order: 2 },
      OPCIONES
    );

    expect(createCourseSection).not.toHaveBeenCalled();
    expect(updateCourseSectionService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: ID.seguridad, reused: true });
  });

  it('la manija de la sección nueva es la de su posición real', async () => {
    const resultado = await herramientas().create_section.execute({ title: 'Devoluciones', order: 2 }, OPCIONES);

    // Tercera del curso: S3. Y el examen final, corrido, pasa a ser S4.
    expect(resultado).toMatchObject({ handle: 'S3' });
  });
});

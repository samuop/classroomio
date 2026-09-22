import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Las herramientas del agente, nombradas por manija — y con el idioma del
 * servidor.
 *
 * ── Qué se cuida acá ─────────────────────────────────────────────────────────
 *
 * 1. Que `S2.L1` llegue a la fila correcta en TODA herramienta, y que una manija
 *    de tipo equivocado no escriba nada: se contesta el error y se sigue.
 * 2. Que lo recién creado vuelva con su manija, para que el modelo la use en el
 *    paso siguiente sin tener que releer la estructura.
 * 3. Que el idioma lo ponga la ronda y no el modelo. Medido: dos lecciones de un
 *    curso en español se escribieron en inglés porque el parámetro `locale`
 *    tenía `default('en')` y lo elegía él. Contenido en un locale que el editor
 *    no muestra es contenido perdido.
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

vi.mock('@api/services/lesson-language', () => ({
  upsertLessonLanguageService: vi.fn()
}));

vi.mock('@api/services/course/content', () => ({
  reorderCourseContent: vi.fn().mockResolvedValue({ courseId: 'curso', updatedSections: 1, updatedLessons: 1 })
}));

vi.mock('@cio/db/queries/lesson', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/lesson')>()),
  updateLesson: vi.fn()
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

import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections, createCourseSection } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { createLesson, getLesson, deleteLessonService } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID = {
  recepcion: '11111111-1111-4111-8111-111111111111',
  mesaDeAyuda: '22222222-2222-4222-8222-222222222222',
  seguridad: '44444444-4444-4444-8444-444444444444',
  leccionRecepcion: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leccionReclamos: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leccionCierre: 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leccionNueva: 'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  autoevaluacion: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const SECCIONES = [
  { id: ID.recepcion, title: 'Recepción de pedidos', order: 0, createdAt: '2026-01-01T00:00:00Z' },
  { id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 1, createdAt: '2026-01-02T00:00:00Z' }
];

/** Filas como las devuelve `getCourseContentItems`: el tipo en MAYÚSCULAS. */
const ITEMS = [
  {
    id: ID.leccionRecepcion,
    type: ContentType.Lesson,
    title: 'Qué se recibe y qué no',
    sectionId: ID.recepcion,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  },
  {
    id: ID.autoevaluacion,
    type: ContentType.Exercise,
    title: 'Autoevaluación de recepción',
    sectionId: ID.recepcion,
    order: 1,
    hasNoteContent: null,
    questionCount: 6
  },
  {
    id: ID.leccionReclamos,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.mesaDeAyuda,
    order: 2,
    hasNoteContent: true,
    questionCount: null
  },
  {
    id: ID.leccionCierre,
    type: ContentType.Lesson,
    title: 'Cómo se cierra un reclamo',
    sectionId: ID.mesaDeAyuda,
    order: 3,
    hasNoteContent: true,
    questionCount: null
  }
];

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

/** La ronda es de un curso en ESPAÑOL: es el locale contra el que se afirma. */
function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es'
  }) as Record<string, Herramienta>;
}

let secciones: typeof SECCIONES;
let items: Array<(typeof ITEMS)[number]>;

beforeEach(() => {
  vi.clearAllMocks();
  secciones = [...SECCIONES];
  items = [...ITEMS];
  vi.mocked(listCourseSections).mockImplementation(async () => secciones as never);
  vi.mocked(getCourseContentItems).mockImplementation(async () => items as never);
  // El informe de la lección se guarda con `.catch(...)`: sin promesa, el
  // guardado del cuerpo se caería por el informe, que es justo lo que no puede
  // pasar.
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
});

describe('la estructura que ve el modelo', () => {
  it('trae la manija de cada pieza, con su id al lado', async () => {
    const resultado = await herramientas().get_course_structure.execute({}, OPCIONES);

    expect(resultado).toMatchObject({
      sections: [
        {
          handle: 'S1',
          id: ID.recepcion,
          lessons: [{ handle: 'S1.L1', id: ID.leccionRecepcion }],
          exercises: [{ handle: 'S1.E1', id: ID.autoevaluacion }]
        },
        {
          handle: 'S2',
          id: ID.mesaDeAyuda,
          lessons: [
            { handle: 'S2.L1', id: ID.leccionReclamos },
            { handle: 'S2.L2', id: ID.leccionCierre }
          ]
        }
      ]
    });
  });
});

describe('nombrar una pieza por su manija', () => {
  it('get_lesson_content abre la lección que la manija señala', async () => {
    vi.mocked(getLesson).mockResolvedValue({
      id: ID.leccionCierre,
      title: 'Cómo se cierra un reclamo',
      lessonLanguages: [
        { locale: 'es', content: '<p>El reclamo se cierra con la conformidad del cliente.</p>' },
        { locale: 'en', content: '<p>Leftover English copy.</p>' }
      ]
    } as never);

    const resultado = await herramientas().get_lesson_content.execute(
      // Con el locale que el modelo solía elegir: ya no es un argumento.
      { lessonId: 'S2.L2', locale: 'en' },
      OPCIONES
    );

    expect(getLesson).toHaveBeenCalledWith(ID.leccionCierre);
    // El idioma lo pone la ronda: se devuelve el español, no el inglés viejo.
    expect(resultado).toMatchObject({
      locale: 'es',
      content: '<p>El reclamo se cierra con la conformidad del cliente.</p>'
    });
  });

  /** Las manijas también valen dentro de una lista, que es como se leen varias de una. */
  it('read_lessons acepta manijas, lee en el idioma de la ronda y anota la que no existe', async () => {
    vi.mocked(getLesson).mockImplementation(
      async (id: string) =>
        ({
          id,
          lessonLanguages: [
            { locale: 'es', content: '<p>Se revisa el remito contra el pedido.</p>' },
            { locale: 'en', content: '<p>Leftover English copy.</p>' }
          ]
        }) as never
    );

    const resultado = await herramientas().read_lessons.execute(
      { lessonIds: ['S1.L1', 'S9.L4'], locale: 'en' },
      OPCIONES
    );

    expect(resultado).toMatchObject({
      count: 1,
      lessons: [{ id: ID.leccionRecepcion, text: 'Se revisa el remito contra el pedido.' }],
      notFound: ['S9.L4']
    });
  });

  it('create_lesson acepta la sección por manija y devuelve la de la lección nueva', async () => {
    vi.mocked(createLesson).mockImplementation(async () => {
      const nueva = {
        id: ID.leccionNueva,
        type: ContentType.Lesson,
        title: 'Faltantes y roturas',
        sectionId: ID.recepcion,
        order: 2,
        hasNoteContent: false,
        questionCount: null
      };
      items = [...items, nueva];

      return { id: nueva.id, title: nueva.title, order: nueva.order } as never;
    });

    const resultado = await herramientas().create_lesson.execute(
      { sectionId: 'S1', title: 'Faltantes y roturas', order: 2, planKey: 's1.3' },
      OPCIONES
    );

    expect(createLesson).toHaveBeenCalledWith('curso', expect.objectContaining({ sectionId: ID.recepcion }));
    expect(resultado).toMatchObject({ id: ID.leccionNueva, handle: 'S1.L2' });
  });

  /**
   * La ronda arranca leyendo la estructura, así que el mapa ya está cargado
   * cuando se crea la sección: si el create no lo tirara, contestaría con el
   * mapa de antes y la sección nueva volvería sin manija.
   */
  it('create_section devuelve la manija de la sección nueva, que antes no existía', async () => {
    vi.mocked(createCourseSection).mockImplementation(async () => {
      const nueva = { id: ID.seguridad, title: 'Seguridad e Higiene', order: 2, createdAt: '2026-01-03T00:00:00Z' };
      secciones = [...secciones, nueva];

      return nueva as never;
    });

    const herramienta = herramientas();

    await herramienta.get_course_structure.execute({}, OPCIONES);

    const resultado = await herramienta.create_section.execute(
      { title: 'Seguridad e Higiene', order: 2, planKey: 's3' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ id: ID.seguridad, handle: 'S3' });
  });

  /**
   * Borrar CORRE a las que venían detrás: `S2.L2` pasa a ser otra lección. Si el
   * mapa no se tirara, la llamada siguiente editaría la pieza equivocada — y sin
   * ningún error, que es el peor de los casos.
   */
  it('después de borrar, la manija siguiente ya señala a la que quedó en ese lugar', async () => {
    vi.mocked(getLesson).mockImplementation(
      async (id: string) =>
        ({
          id,
          title: items.find((item) => item.id === id)?.title ?? '',
          lessonLanguages: [{ locale: 'es', content: '<p>Contenido.</p>' }]
        }) as never
    );
    vi.mocked(deleteLessonService).mockImplementation(async (id: string) => {
      items = items.filter((item) => item.id !== id);

      return undefined as never;
    });

    const herramienta = herramientas();

    await herramienta.delete_lesson.execute(
      { lessonId: 'S2.L1', confirmTitle: 'Quién atiende cada reclamo' },
      OPCIONES
    );

    expect(deleteLessonService).toHaveBeenCalledWith(ID.leccionReclamos);

    await herramienta.get_lesson_content.execute({ lessonId: 'S2.L1' }, OPCIONES);

    expect(getLesson).toHaveBeenLastCalledWith(ID.leccionCierre);
  });

  it('reorder_content resuelve las manijas y avisa que ya no valen', async () => {
    const resultado = await herramientas().reorder_content.execute(
      { sections: [{ id: 'S2', order: 0 }], items: [{ id: 'S1.L1', type: 'LESSON', order: 1 }] },
      OPCIONES
    );

    expect(resultado).toMatchObject({ note: expect.stringContaining('Handles changed') });
  });
});

describe('una manija que no señala nada no escribe nada', () => {
  it('pedir una lección con la manija de un ejercicio se rechaza, y lista las que hay', async () => {
    const resultado = await herramientas().delete_lesson.execute(
      { lessonId: 'S1.E1', confirmTitle: 'Autoevaluación de recepción' },
      OPCIONES
    );

    expect(deleteLessonService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('S2.L1 "Quién atiende cada reclamo"');
  });

  it('y una sección que no existe tampoco crea la lección', async () => {
    const resultado = await herramientas().create_lesson.execute(
      { sectionId: 'S9', title: 'Faltantes y roturas', order: 2 },
      OPCIONES
    );

    expect(createLesson).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('Unknown section "S9"');
  });
});

describe('el idioma lo pone la ronda, no el modelo', () => {
  it('update_lesson_content guarda en el locale del curso aunque los argumentos digan otro', async () => {
    vi.mocked(getLesson).mockResolvedValue({
      id: ID.leccionCierre,
      title: 'Cómo se cierra un reclamo',
      lessonLanguages: []
    } as never);

    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S2.L2', locale: 'en', content: '<p>El reclamo se cierra con la conformidad del cliente.</p>' },
      OPCIONES
    );

    expect(upsertLessonLanguageService).toHaveBeenCalledWith(
      ID.leccionCierre,
      expect.objectContaining({ locale: 'es' })
    );
    expect(resultado).toMatchObject({ lessonId: ID.leccionCierre, locale: 'es' });
  });
});

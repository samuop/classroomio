import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Las frases que la docente señaló, desde que se ubican hasta el plan.
 *
 * Medido el 2026-11-13: «corregí eso» sobre cinco frases dejó una sin corregir
 * en dos corridas de tres, y el cierre decía «implementé los ajustes». Acá se
 * prueba el camino entero por las herramientas de verdad: ubicar las frases, y
 * que el plan de cambios no pueda callar la lección de ninguna.
 *
 * Curso inventado, de un depósito que no existe.
 */

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

vi.mock('@cio/db/queries/lesson/language', () => ({
  getCourseLessonContents: vi.fn()
}));

vi.mock('@cio/db/queries/exercise', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/exercise')>()),
  getQuestionsByExerciseIds: vi.fn().mockResolvedValue([]),
  getOptionsByQuestionIds: vi.fn().mockResolvedValue([])
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn().mockResolvedValue([])
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  resolvePlanBinding: vi.fn().mockResolvedValue(null),
  leerAnalisisDeFuente: vi.fn().mockResolvedValue([]),
  readPlanRegistry: vi.fn().mockResolvedValue([])
}));

/**
 * Un incrustador de juguete (cuenta palabras): alcanza para que el párrafo que
 * comparte las palabras de la frase salga primero, sin llamar a nadie.
 */
const incrustar = vi.fn();
const PALABRAS_VACIAS = new Set(['la', 'el', 'de', 'del', 'en', 'se', 'que', 'una', 'un', 'al', 'los', 'las', 'por', 'es', 'y', 'a', 'con', 'su']);
const deJuguete = async (textos: string[]) =>
  textos.map((texto) => {
    const vector = new Array<number>(64).fill(0);

    for (const palabra of texto.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
      if (palabra.length < 2 || PALABRAS_VACIAS.has(palabra)) continue;

      let hash = 0;

      for (const letra of palabra) hash = (hash * 31 + letra.charCodeAt(0)) % 64;

      vector[hash] += 1;
    }

    return vector;
  });

vi.mock('@api/services/agent/embeddings', async (original) => ({
  ...(await original<typeof import('@api/services/agent/embeddings')>()),
  incrustarTextos: (textos: string[]) => incrustar(textos)
}));

import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID = {
  seccion: '22222222-2222-4222-8222-222222222222',
  retiro: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cambioDeGuardia: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  categorias: 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const ITEMS = [
  { id: ID.retiro, type: ContentType.Lesson, title: 'El retiro semanal de pedidos', sectionId: ID.seccion, order: 0, hasNoteContent: true },
  { id: ID.cambioDeGuardia, type: ContentType.Lesson, title: 'El cambio de guardia', sectionId: ID.seccion, order: 1, hasNoteContent: true },
  { id: ID.categorias, type: ContentType.Lesson, title: 'Las categorías críticas', sectionId: ID.seccion, order: 2, hasNoteContent: true }
];

const CONTENIDOS = [
  {
    id: ID.retiro,
    title: 'El retiro semanal de pedidos',
    content: '<p data-block-id="r1">Un pedido puede quedar sin registrar cuando el proveedor lo entrega ese día por la mañana.</p>'
  },
  {
    id: ID.cambioDeGuardia,
    title: 'El cambio de guardia',
    content:
      '<p data-block-id="t1">En el cambio de guardia se revisa la limpieza del depósito y el orden de todas las estanterías del sector.</p>' +
      '<p data-block-id="t2">El único pedido que puede quedar sin registrar es el recibido en esa misma guardia, cuando la descarga coincide con el cambio de guardia.</p>'
  },
  {
    id: ID.categorias,
    title: 'Las categorías críticas',
    content: '<p data-block-id="k1">Los repuestos importados son artículos críticos y no pueden faltar en la estantería.</p>'
  }
];

const FRASE_DE_LA_GUARDIA = 'Sólo puede quedar sin registrar un pedido recibido en esa misma guardia, a la hora del cambio de guardia';
const FRASE_DE_REPUESTOS = 'Los repuestos importados son artículos críticos';
const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

const herramientas = () =>
  buildAgentTools('org', 'usuario', 'curso', [], { conversationId: 'conversacion', locale: 'es' }) as Record<string, Herramienta>;

const item = (titulo: string, target: string, extra: Record<string, unknown> = {}) => ({
  type: 'lesson',
  title: titulo,
  description: 'Alinear con el documento.',
  order: 0,
  hasExercise: false,
  action: 'edit',
  target,
  changes: 'Se corrige según el documento.',
  ...extra
});

const plan = (items: unknown[]) => ({
  plan: {
    title: 'Corrección según el documento',
    teacherRules: [],
    scope: 'changes',
    sections: [{ title: 'Operación', order: 0, sectionId: 'S1', items }]
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  incrustar.mockImplementation(deJuguete);
  vi.mocked(listCourseSections).mockResolvedValue([{ id: ID.seccion, title: 'Operación', order: 0, createdAt: '2026-01-02T00:00:00Z' }] as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getCourseLessonContents).mockResolvedValue(CONTENIDOS as never);
});

describe('ubicar en el curso las frases que señaló la docente', () => {
  it('devuelve, por frase, el párrafo que la dice con la manija de la lección y el bloque', async () => {
    const resultado = await herramientas().find_statements_in_course.execute({ statements: [FRASE_DE_LA_GUARDIA, FRASE_DE_REPUESTOS] }, OPCIONES);
    const frases = resultado.statements as Array<{ statement: string; passages: Array<Record<string, unknown>> }>;

    expect(frases.map((frase) => frase.statement)).toEqual([FRASE_DE_LA_GUARDIA, FRASE_DE_REPUESTOS]);
    expect(frases[0].passages[0]).toMatchObject({ lesson: 'S1.L2', lessonId: ID.cambioDeGuardia, blockId: 't2' });
    expect(String(frases[0].passages[0].text)).toContain('recibido en esa misma guardia');
    expect(frases[1].passages[0]).toMatchObject({ lesson: 'S1.L3', blockId: 'k1' });
  });

  it('si no se puede buscar por significado lo dice, y no devuelve una lista vacía', async () => {
    incrustar.mockResolvedValue(null);

    const resultado = await herramientas().find_statements_in_course.execute({ statements: [FRASE_DE_LA_GUARDIA] }, OPCIONES);

    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toMatch(/NOTHING was located/);
    expect(resultado.statements).toBeUndefined();
  });
});

describe('el plan de cambios después de ubicar las frases', () => {
  async function conLasFrasesUbicadas() {
    const lasHerramientas = herramientas();

    await lasHerramientas.find_statements_in_course.execute({ statements: [FRASE_DE_LA_GUARDIA, FRASE_DE_REPUESTOS] }, OPCIONES);

    return lasHerramientas;
  }

  it('el plan que falló en la medición —corrige otra lección del mismo tema— se niega y nombra la que falta', async () => {
    const lasHerramientas = await conLasFrasesUbicadas();
    const resultado = await lasHerramientas.generate_course_plan.execute(
      plan([item('El retiro semanal de pedidos', 'S1.L1'), item('Las categorías críticas', 'S1.L3')]),
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.sections).toBeUndefined();
    expect(resultado.statementsLeftOut).toEqual([
      expect.objectContaining({ statement: FRASE_DE_LA_GUARDIA, lesson: 'S1.L2', title: 'El cambio de guardia', blockId: 't2' })
    ]);
    expect(String(resultado.note)).toMatch(/NOT shown to the teacher/);
  });

  it('con un ítem para la lección de cada frase, el plan sale', async () => {
    const lasHerramientas = await conLasFrasesUbicadas();
    const resultado = await lasHerramientas.generate_course_plan.execute(
      plan([item('El cambio de guardia', 'S1.L2'), item('Las categorías críticas', 'S1.L3')]),
      OPCIONES
    );

    expect(resultado.ok).toBeUndefined();
    expect(resultado.statementsLeftOut).toBeUndefined();
    expect(resultado.sections).toHaveLength(1);
  });

  it('dejarla como está también vale, con el motivo a la vista de la docente', async () => {
    const lasHerramientas = await conLasFrasesUbicadas();
    const resultado = await lasHerramientas.generate_course_plan.execute(
      plan([
        item('El cambio de guardia', 'S1.L2', { skip: true, changes: 'El párrafo más parecido no dice esa frase.' }),
        item('Las categorías críticas', 'S1.L3')
      ]),
      OPCIONES
    );

    expect(resultado.statementsLeftOut).toBeUndefined();
    expect(JSON.stringify(resultado.sections)).toContain('El párrafo más parecido no dice esa frase.');
  });

  it('sin haber ubicado nada en la ronda, el mismo plan sale: un cambio pedido a mano no se traba', async () => {
    const resultado = await herramientas().generate_course_plan.execute(plan([item('El retiro semanal de pedidos', 'S1.L1')]), OPCIONES);

    expect(resultado.ok).toBeUndefined();
    expect(resultado.sections).toHaveLength(1);
  });
});

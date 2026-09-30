import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * El informe de la lección se pone al día después de cada edición por bloque.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * El informe («Datos que no figuran en las fuentes») sólo se escribía al
 * guardar la lección entera. Tres lecciones seguían listando datos que un
 * retoque posterior ya había sacado —una tecla, un «24 horas»—, así que la
 * docente iba a ver como dudoso algo que ya no estaba.
 *
 * El recálculo es determinista: vuelve a buscar los datos con el MISMO alcance
 * con que se escribió el informe (sus `sources`), sin salir a la red.
 *
 * Curso y fuentes inventados.
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

vi.mock('@cio/db/queries/lesson', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/lesson')>()),
  updateLesson: vi.fn()
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn()
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

import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getLesson } from '@api/services/lesson/lesson';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** La fuente con que se escribió la lección. No nombra ninguna tecla. */
const FUENTE_DE_LA_LECCION = {
  id: 'fuente-1',
  fileName: 'guia-de-filas.pdf',
  text: 'La hoja se organiza en filas y columnas. Para moverse se usan las flechas del teclado.'
};

/** Otra fuente del curso, que la lección NO tuvo asignada. */
const OTRA_FUENTE = {
  id: 'fuente-2',
  fileName: 'guia-de-teclas.pdf',
  text: 'La tecla Tab pasa a la columna de la derecha.'
};

const CONTENIDO =
  '<h3 data-block-id="aaaa1111">Moverse por la hoja</h3>' +
  '<p data-block-id="bbbb2222">Para moverse se usan las flechas del teclado.</p>' +
  '<p data-block-id="cccc3333">La tecla Enter confirma el dato y la distribuidora Arlux entrega los lunes.</p>';

/** El informe tal como lo dejó `write_lesson`: con los dos datos listados. */
const INFORME = {
  builtAt: '2026-09-29T18:55:24.000Z',
  sources: [FUENTE_DE_LA_LECCION.fileName],
  checkedAgainst: 'lesson',
  groundingWarnings: [],
  groundingStatus: 'ok',
  diagramWarnings: [],
  tokenWarnings: [
    { tipo: 'nombre', valor: 'Enter', contexto: 'La tecla Enter confirma', enDiagrama: false },
    { tipo: 'nombre', valor: 'Arlux', contexto: 'la distribuidora Arlux entrega', enDiagrama: false }
  ],
  unsupportedPassages: [],
  examples: [],
  writerNote: 'Falta el manual de la caja.'
};

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es'
  }) as Record<string, Herramienta>;
}

function leccionGuardada(informe: unknown) {
  return {
    id: ID_LECCION,
    title: 'Moverse por la hoja',
    order: 0,
    buildReport: informe,
    lessonLanguages: [{ locale: 'es', content: CONTENIDO }]
  };
}

function informeGuardado(): Record<string, unknown> {
  const llamada = vi.mocked(updateLessonQuery).mock.calls.at(-1);

  return (llamada?.[1] as { buildReport: Record<string, unknown> }).buildReport;
}

const valores = (informe: Record<string, unknown>) =>
  (informe.tokenWarnings as Array<{ valor: string }>).map((dato) => dato.valor);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue([
    { id: ID_SECCION, title: 'Primeros pasos', order: 0, createdAt: '2026-01-01T00:00:00Z' }
  ] as never);
  vi.mocked(getCourseContentItems).mockResolvedValue([
    {
      id: ID_LECCION,
      type: ContentType.Lesson,
      title: 'Moverse por la hoja',
      sectionId: ID_SECCION,
      order: 0,
      hasNoteContent: true,
      questionCount: null
    }
  ] as never);
  vi.mocked(listCourseSources).mockResolvedValue([FUENTE_DE_LA_LECCION, OTRA_FUENTE] as never);
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
  vi.mocked(getLesson).mockResolvedValue(leccionGuardada(INFORME) as never);
});

describe('replace_lesson_block pone el informe al día', () => {
  it('un dato que el retoque sacó deja de figurar, y el resto del informe queda igual', async () => {
    await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: 'cccc3333',
        html: '<p>La distribuidora Arlux entrega los lunes.</p>'
      },
      OPCIONES
    );

    const informe = informeGuardado();

    expect(valores(informe)).toEqual(['Arlux']);
    // Lo que el recálculo no mira queda como estaba: el juez, la nota, la fecha.
    expect(informe).toMatchObject({
      builtAt: INFORME.builtAt,
      sources: INFORME.sources,
      groundingStatus: 'ok',
      writerNote: 'Falta el manual de la caja.'
    });
  });

  it('con el alcance del informe, y con el rótulo de lo que figura en otra fuente del curso', async () => {
    await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: 'cccc3333',
        html: '<p>La tecla Tab pasa de columna y la distribuidora Arlux entrega los lunes.</p>'
      },
      OPCIONES
    );

    const datos = informeGuardado().tokenWarnings as Array<Record<string, unknown>>;

    // «Tab» no está en la fuente de la LECCIÓN (el alcance del informe) pero sí
    // en otra del curso: queda, rotulado. «Arlux» no está en ningún lado.
    expect(datos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valor: 'Tab', respaldo: 'curso', rotulo: 'figura en otra fuente del curso' }),
        expect.objectContaining({ valor: 'Arlux', blockId: 'cccc3333' })
      ])
    );
  });

  it('una marca nueva también llega al informe', async () => {
    await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: 'cccc3333',
        html: '<p data-ejemplo="un proveedor inventado">La distribuidora Arlux entrega los lunes.</p>'
      },
      OPCIONES
    );

    const informe = informeGuardado();

    expect(valores(informe)).toEqual([]);
    expect(JSON.stringify(informe.examples)).toContain('un proveedor inventado');
  });
});

describe('lo que ya estaba decidido', () => {
  it('un dato que el escritor dio por conocimiento general sigue así, con su motivo, después de un retoque', async () => {
    vi.mocked(getLesson).mockResolvedValue(
      leccionGuardada({
        ...INFORME,
        tokenWarnings: [
          {
            tipo: 'nombre',
            valor: 'Enter',
            contexto: 'La tecla Enter confirma',
            enDiagrama: false,
            decision: 'mantener',
            rotulo: 'quien la escribió lo da por conocimiento general del tema',
            motivo: 'Enter es la tecla estándar para confirmar'
          },
          INFORME.tokenWarnings[1]
        ]
      }) as never
    );

    await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>Para moverse se usan las flechas.</p>' },
      OPCIONES
    );

    const datos = informeGuardado().tokenWarnings as Array<Record<string, unknown>>;

    expect(datos.find((dato) => dato.valor === 'Enter')).toMatchObject({
      decision: 'mantener',
      motivo: 'Enter es la tecla estándar para confirmar'
    });
    expect(datos.find((dato) => dato.valor === 'Arlux')?.decision).toBeUndefined();
  });

  it('si las fuentes del informe ya no están, conserva lo que tenía en vez de quedar «limpio»', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([OTRA_FUENTE] as never);

    await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>Para moverse se usan las flechas.</p>' },
      OPCIONES
    );

    expect(valores(informeGuardado())).toEqual(['Enter', 'Arlux']);
  });
});

describe('edit_lesson_content hace lo mismo', () => {
  it('saca del informe lo que la edición sacó de la lección', async () => {
    await herramientas().edit_lesson_content.execute(
      { lessonId: 'S1.L1', oldString: 'La tecla Enter confirma el dato y la', newString: 'La' },
      OPCIONES
    );

    expect(valores(informeGuardado())).toEqual(['Arlux']);
  });
});

describe('una lección sin informe no gana uno por un retoque', () => {
  it('si la escribió la docente, no hay nada que actualizar', async () => {
    vi.mocked(getLesson).mockResolvedValue(leccionGuardada(null) as never);

    await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'cccc3333', html: '<p>La distribuidora entrega los lunes.</p>' },
      OPCIONES
    );

    expect(updateLessonQuery).not.toHaveBeenCalled();
  });
});

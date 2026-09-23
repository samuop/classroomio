import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Editar por bloques, y volver a mirar la lección entera.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Cambiar UN dato reescribiendo la lección entera es lo que se medía en
 * producción: 153 segundos y todo el texto rehecho por tres datos, con cada
 * reescritura dando una oportunidad nueva de inventar («preferentemente» volvió
 * obligatorio en una de ellas). La jugada correcta es empalmar el bloque que
 * lleva el dato.
 *
 * Pero un bloque empalmado es texto NUEVO que nadie miró, y los dos tools que
 * editan sin reescribir no pasan por `writeLessonBody`, así que los chequeos de
 * lección entera no corren solos ahí. Entonces se rechequea en dos casos:
 *
 *  - la lección quedó MARCADA en esta ronda (el caso de `revision-tras-editar`:
 *    arreglar la frase citada no es arreglar la afirmación, que seguía en otros
 *    cinco lugares);
 *  - la lección está en la ORDEN DE TRABAJO de la ronda — el plan mandó
 *    cambiarla— y entonces UNA vez, no una por coma.
 *
 * Curso inventado.
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
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import type { Verificador } from '@api/services/agent/grounding';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SECCIONES = [{ id: ID_SECCION, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-01T00:00:00Z' }];

const ITEMS = [
  {
    id: ID_LECCION,
    type: ContentType.Lesson,
    title: 'Cómo se atiende un reclamo',
    sectionId: ID_SECCION,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  }
];

const FUENTE = {
  id: 'fuente-1',
  fileName: 'circular-mesa-de-ayuda.docx',
  text: 'La Mesa de Ayuda de Distribuidora Andina atiende de 8 a 18. El reclamo se cierra con la conformidad del cliente.'
};

/** La lección guardada, ya con ids de bloque. El dato viejo está en dos lugares. */
const CONTENIDO =
  '<h3 data-block-id="aaaa1111">Atender un reclamo</h3>' +
  '<p data-block-id="bbbb2222">La Mesa de Ayuda atiende de 8 a 18.</p>' +
  '<p data-block-id="cccc3333">Fuera de ese horario el reclamo queda registrado y se atiende al día siguiente.</p>';

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas(opciones: {
  verificarFundamento?: Verificador;
  leccionesBajoOrdenDeTrabajo?: ReadonlySet<string>;
}) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    ...opciones
  }) as Record<string, Herramienta>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(listCourseSources).mockResolvedValue([FUENTE] as never);
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
  vi.mocked(getLesson).mockResolvedValue({
    id: ID_LECCION,
    title: 'Cómo se atiende un reclamo',
    order: 0,
    lessonLanguages: [{ locale: 'es', content: CONTENIDO }]
  } as never);
});

describe('una lección bajo orden de trabajo', () => {
  it('se rechequea ENTERA después de empalmar un bloque', async () => {
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });

    await herramientas({
      verificarFundamento,
      leccionesBajoOrdenDeTrabajo: new Set([ID_LECCION])
    }).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );

    expect(verificarFundamento).toHaveBeenCalledTimes(1);

    const chequeado = verificarFundamento.mock.calls[0][0];
    // La lección ENTERA: el párrafo que la edición NO tocó tiene que estar. Ese
    // recorte al fragmento es justamente el defecto que esto tapa — la
    // afirmación sobrevivía en lo que la edición no miró.
    expect(chequeado.contenido).toContain('se atiende al día siguiente');
    expect(chequeado.contenido).toContain('de 8 a 20');
    // Sin fuentes propias: la lección ya existía y no se sabe con qué se
    // escribió, así que se contrasta contra el paquete del curso.
    expect(chequeado.soloFuentes).toBeUndefined();
  });

  it('se rechequea una sola vez por ronda, no una por bloque editado', async () => {
    // Editar una lección larga son diez o quince empalmes. Salir a la red en
    // cada uno sería verificar quince veces casi el mismo texto.
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });
    const tools = herramientas({ verificarFundamento, leccionesBajoOrdenDeTrabajo: new Set([ID_LECCION]) });

    await tools.replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );
    await tools.replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'cccc3333', html: '<p>Fuera de ese horario queda registrado.</p>' },
      OPCIONES
    );

    expect(verificarFundamento).toHaveBeenCalledTimes(1);
  });

  it('un dato que el bloque nuevo trajo y ninguna fuente dice vuelve como aviso', async () => {
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });

    const resultado = await herramientas({
      verificarFundamento,
      leccionesBajoOrdenDeTrabajo: new Set([ID_LECCION])
    }).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>Fuera de horario, llamar al 4471 9900.</p>' },
      OPCIONES
    );

    expect(resultado.unsupportedTokens).toEqual(expect.arrayContaining([expect.stringContaining('4471')]));
    expect(String(resultado.note)).toContain('data-ejemplo');
  });

  it('el aviso del fundamento vuelve al modelo', async () => {
    const aviso = 'This lesson states things the course sources do not support: "atiende las 24 horas".';
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [aviso], estado: 'ok' });

    const resultado = await herramientas({
      verificarFundamento,
      leccionesBajoOrdenDeTrabajo: new Set([ID_LECCION])
    }).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );

    expect(resultado.groundingWarnings).toEqual([aviso]);
  });

  /**
   * Si el rechequeo se cae, se dice — y NO se manda a reescribir.
   *
   * El aviso decía «retry write_lesson later» igual que tras una escritura
   * entera. Bajo una orden de EDICIÓN eso choca con `negarReescrituraBajoOrden`
   * («A full rewrite is not allowed here»): una instrucción que la herramienta
   * de al lado contradice.
   */
  it('un rechequeo caído lo dice sin mandar a write_lesson', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const verificarFundamento = vi.fn().mockRejectedValue(new Error('503 del proveedor'));

    const resultado = await herramientas({
      verificarFundamento,
      leccionesBajoOrdenDeTrabajo: new Set([ID_LECCION])
    }).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true, groundingStatus: 'failed', groundingReason: '503 del proveedor' });

    const nota = String(resultado.note);

    expect(nota).toContain('did NOT run');
    expect(nota).toContain('503 del proveedor');
    expect(nota).toContain('edit is saved');
    expect(nota).not.toContain('write_lesson');
  });

  it('edit_lesson_content hace lo mismo', async () => {
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });

    await herramientas({
      verificarFundamento,
      leccionesBajoOrdenDeTrabajo: new Set([ID_LECCION])
    }).edit_lesson_content.execute(
      { lessonId: 'S1.L1', oldString: 'de 8 a 18', newString: 'de 8 a 20' },
      OPCIONES
    );

    expect(verificarFundamento).toHaveBeenCalledTimes(1);
    expect(verificarFundamento.mock.calls[0][0].contenido).toContain('se atiende al día siguiente');
  });
});

describe('una lección que nadie marcó y que el plan no manda tocar', () => {
  it('no sale a la red por un retoque', async () => {
    // Devuelve algo válido a propósito: si devolviera `undefined`, una regresión
    // que lo llamara reventaría adentro y el fallo se leería como otra cosa.
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });

    const resultado = await herramientas({ verificarFundamento }).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );

    expect(verificarFundamento).not.toHaveBeenCalled();
    expect(resultado.updated).toBe(true);
    expect(resultado.unsupportedTokens).toBeUndefined();
  });

  it('y tampoco por una orden de trabajo que es de OTRA lección', async () => {
    const verificarFundamento = vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });

    await herramientas({
      verificarFundamento,
      leccionesBajoOrdenDeTrabajo: new Set(['otra-leccion'])
    }).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );

    expect(verificarFundamento).not.toHaveBeenCalled();
  });
});

describe('el bloque nuevo también queda direccionable', () => {
  it('un bloque pegado sin id recibe uno antes de guardar', async () => {
    // Sin esto, el primer bloque que la edición agrega nace sin nombre y no se
    // puede volver a editar por bloque: la próxima corrección sería otra vez una
    // reescritura entera.
    await herramientas({}).edit_lesson_content.execute(
      {
        lessonId: 'S1.L1',
        oldString: '<p data-block-id="cccc3333">Fuera de ese horario el reclamo queda registrado y se atiende al día siguiente.</p>',
        newString:
          '<p data-block-id="cccc3333">Fuera de ese horario queda registrado.</p><p>Y se atiende al día siguiente.</p>'
      },
      OPCIONES
    );

    const guardado = (vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string }).content;

    expect(guardado).toContain('data-block-id="cccc3333"');
    expect((guardado.match(/data-block-id=/g) ?? []).length).toBe(4);
  });

  it('el empalme conserva los ids que ya estaban', async () => {
    await herramientas({}).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'bbbb2222', html: '<p>La Mesa de Ayuda atiende de 8 a 20.</p>' },
      OPCIONES
    );

    const guardado = (vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string }).content;

    expect(guardado).toContain('data-block-id="aaaa1111"');
    expect(guardado).toContain('data-block-id="bbbb2222"');
    expect(guardado).toContain('data-block-id="cccc3333"');
  });
});

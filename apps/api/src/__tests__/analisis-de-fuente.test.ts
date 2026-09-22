import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Comparar una fuente nueva con el curso, y proponer el cambio.
 *
 * ── Qué se cuida acá ─────────────────────────────────────────────────────────
 *
 * 1. Que el modelo diga QUÉ cambió y el servidor diga DÓNDE está. Un valor que
 *    el analista propone y que el curso no dice en ninguna parte se descarta
 *    antes de llegar al plan: si no, la orden de edición mandaría a cambiar
 *    algo que nunca se escribió, y el ancla la reclamaría para siempre.
 * 2. Que el plan de cambios resuelva sus targets ANTES de que el docente lo
 *    vea. Un target que no apunta a nada no falla al aprobar ni al construir:
 *    falla en silencio.
 *
 * Curso inventado, de una distribuidora que no existe. El teléfono también.
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
  getQuestionsByExerciseIds: vi.fn(),
  getOptionsByQuestionIds: vi.fn()
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn()
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  resolvePlanBinding: vi.fn().mockResolvedValue(null),
  guardarAnalisisDeFuente: vi.fn().mockResolvedValue(undefined)
}));

import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { getOptionsByQuestionIds, getQuestionsByExerciseIds } from '@cio/db/queries/exercise';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { guardarAnalisisDeFuente } from '@cio/db/queries/agent';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID = {
  mesaDeAyuda: '22222222-2222-4222-8222-222222222222',
  quienAtiende: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  comoSeCierra: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  autoevaluacion: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  circular: 'ccccccc1-cccc-4ccc-8ccc-cccccccccccc'
};

const SECCIONES = [{ id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.quienAtiende,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.mesaDeAyuda,
    order: 0,
    hasNoteContent: true
  },
  {
    id: ID.comoSeCierra,
    type: ContentType.Lesson,
    title: 'Cómo se cierra un reclamo',
    sectionId: ID.mesaDeAyuda,
    order: 1,
    hasNoteContent: true
  },
  {
    id: ID.autoevaluacion,
    type: ContentType.Exercise,
    title: 'Autoevaluación de la mesa',
    sectionId: ID.mesaDeAyuda,
    order: 2,
    questionCount: 1
  }
];

const CONTENIDOS = [
  {
    id: ID.quienAtiende,
    title: 'Quién atiende cada reclamo',
    content: '<p data-block-id="b7">El reclamo se toma por el interno 4400.</p>'
  },
  {
    id: ID.comoSeCierra,
    title: 'Cómo se cierra un reclamo',
    content: '<p data-block-id="b3">El reclamo se cierra con la conformidad del cliente.</p>'
  }
];

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

const analista = vi.fn();

function herramientas(conAnalista = true) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    locale: 'es',
    ...(conAnalista ? { analizarCambios: analista } : {})
  }) as Record<string, Herramienta>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getCourseLessonContents).mockResolvedValue(CONTENIDOS as never);
  vi.mocked(getQuestionsByExerciseIds).mockResolvedValue([
    {
      id: 521,
      exerciseId: ID.autoevaluacion,
      title: '¿A qué interno se llama para abrir un reclamo?',
      settings: {}
    }
  ] as never);
  vi.mocked(getOptionsByQuestionIds).mockResolvedValue([
    { id: 1, questionId: 521, label: 'Al interno 4400', isCorrect: true }
  ] as never);
  vi.mocked(listCourseSources).mockResolvedValue([
    { id: ID.circular, fileName: 'Circular de atención.pdf', text: 'El contacto pasa a WhatsApp 11 5555-0101.' }
  ] as never);
});

describe('comparar una fuente nueva con el curso', () => {
  it('devuelve cada dato que cambia con el lugar exacto donde todavía está', async () => {
    analista.mockResolvedValue({
      cambios: [
        {
          valorViejo: 'interno 4400',
          valorNuevo: 'WhatsApp 11 5555-0101',
          motivo: 'La circular reemplaza el interno por WhatsApp.'
        }
      ]
    });

    const resultado = await herramientas().analyze_source_changes.execute({ sourceId: 'Circular de atención' }, OPCIONES);

    // El analista vio el documento y TODAS las lecciones escritas, por manija.
    expect(analista).toHaveBeenCalledWith({
      fuenteNueva: { fileName: 'Circular de atención.pdf', text: 'El contacto pasa a WhatsApp 11 5555-0101.' },
      lecciones: [
        { handle: 'S1.L1', title: 'Quién atiende cada reclamo', text: 'El reclamo se toma por el interno 4400.' },
        {
          handle: 'S1.L2',
          title: 'Cómo se cierra un reclamo',
          text: 'El reclamo se cierra con la conformidad del cliente.'
        }
      ]
    });

    expect(resultado).toMatchObject({
      source: 'Circular de atención.pdf',
      changes: [
        {
          old: 'interno 4400',
          new: 'WhatsApp 11 5555-0101',
          occurrences: [
            { handle: 'S1.L1', blockId: 'b7' },
            { handle: 'S1.E1', questionId: 521 }
          ]
        }
      ]
    });
    expect(String(resultado.note)).toContain('scope "changes"');
  });

  /**
   * La mitad determinista. El analista es un modelo y puede proponer un cambio
   * sobre algo que el curso nunca dijo; una orden así no se puede cumplir, así
   * que el ancla la reclamaría en cada ronda para siempre.
   */
  it('descarta el valor que no está en ninguna parte del curso', async () => {
    analista.mockResolvedValue({
      cambios: [
        { valorViejo: 'formulario F-12', valorNuevo: 'formulario F-20', motivo: 'Cambió el formulario.' },
        { valorViejo: 'interno 4400', valorNuevo: 'WhatsApp 11 5555-0101', motivo: 'Cambió el contacto.' }
      ]
    });

    const resultado = await herramientas().analyze_source_changes.execute({ sourceId: ID.circular }, OPCIONES);

    expect((resultado.changes as unknown[]).map((c) => (c as { old: string }).old)).toEqual(['interno 4400']);
    expect(resultado).toMatchObject({ discarded: 1 });

    // Y lo que se guarda para el plan es lo que sobrevivió al barrido.
    expect(guardarAnalisisDeFuente).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: ID.circular,
        cambios: [expect.objectContaining({ valorViejo: 'interno 4400' })]
      })
    );
  });

  it('una fuente que el curso no tiene se contesta con el error, sin llamar al analista', async () => {
    const resultado = await herramientas().analyze_source_changes.execute({ sourceId: 'Manual de higiene' }, OPCIONES);

    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('Manual de higiene');
    expect(analista).not.toHaveBeenCalled();
  });

  /**
   * El defecto medido el 2026-09-22: el analista devuelve el valor viejo como
   * lo escribe la LECCIÓN («Teléfono interno 4400») y la pregunta lo dice de
   * otra forma («Al interno 4400»). Sin la clave, el barrido encontraba la
   * lección y ninguna pregunta, el plan no las listaba, y el curso quedaba
   * enseñando el dato nuevo y evaluando el viejo.
   */
  it('la clave encuentra la pregunta que dice el mismo dato con otras palabras', async () => {
    analista.mockResolvedValue({
      cambios: [
        {
          valorViejo: 'se toma por el interno 4400',
          valorNuevo: 'se toma por WhatsApp 11 5555-0101',
          motivo: 'La circular reemplaza el interno por WhatsApp.',
          clave: '4400'
        }
      ]
    });

    const resultado = await herramientas().analyze_source_changes.execute({ sourceId: ID.circular }, OPCIONES);
    const [cambio] = resultado.changes as Array<{ occurrences: Array<Record<string, unknown>> }>;

    expect(cambio.occurrences).toEqual([
      expect.objectContaining({ handle: 'S1.L1', blockId: 'b7' }),
      expect.objectContaining({ handle: 'S1.E1', questionId: 521 })
    ]);
    // Y la nota le pide un ítem para el ejercicio, no sólo para la lección.
    expect(String(resultado.note)).toContain('one per exercise');

    // La clave viaja al análisis guardado: el plan mide con lo mismo que se buscó.
    expect(guardarAnalisisDeFuente).toHaveBeenCalledWith(
      expect.objectContaining({ cambios: [expect.objectContaining({ clave: '4400' })] })
    );
  });

  it('cuando el documento no cambia nada, lo dice y no propone un plan', async () => {
    analista.mockResolvedValue({ cambios: [] });

    const resultado = await herramientas().analyze_source_changes.execute({ sourceId: ID.circular }, OPCIONES);

    expect(resultado.changes).toEqual([]);
    expect(String(resultado.note)).toContain('changes nothing');
  });
});

describe('proponer un plan de cambios', () => {
  const planDeCambios = (target: string, sectionId = 'S1') => ({
    plan: {
      title: 'Actualización de la circular',
      scope: 'changes',
      sections: [
        {
          title: 'Mesa de Ayuda',
          order: 0,
          sectionId,
          items: [
            {
              type: 'lesson',
              title: 'Quién atiende cada reclamo',
              description: 'Actualizar el canal de contacto.',
              order: 0,
              hasExercise: false,
              action: 'edit',
              target,
              changes: 'El interno 4400 pasa a WhatsApp.'
            }
          ]
        }
      ]
    }
  });

  it('resuelve cada manija contra el curso y devuelve a qué apunta', async () => {
    const resultado = await herramientas().generate_course_plan.execute(planDeCambios('S1.L1'), OPCIONES);

    expect(resultado).toMatchObject({
      scope: 'changes',
      resolved: [
        { title: 'Mesa de Ayuda', handle: 'S1', id: ID.mesaDeAyuda },
        { title: 'Quién atiende cada reclamo', handle: 'S1.L1', id: ID.quienAtiende }
      ]
    });
    expect(resultado.unresolved).toBeUndefined();
  });

  it('un target que no existe vuelve marcado, para arreglarlo antes de que el docente lo vea', async () => {
    const resultado = await herramientas().generate_course_plan.execute(planDeCambios('S9.L4'), OPCIONES);

    expect(resultado).toMatchObject({ unresolved: [{ title: 'Quién atiende cada reclamo', target: 'S9.L4' }] });
    expect(String(resultado.note)).toContain('BEFORE the teacher sees it');
  });

  /** Un UUID con forma válida pero de otro curso es un id inventado, y se contesta igual. */
  it('un id que no es de este curso no cuenta como resuelto', async () => {
    const resultado = await herramientas().generate_course_plan.execute(
      planDeCambios('99999999-9999-4999-8999-999999999999'),
      OPCIONES
    );

    expect(resultado).toMatchObject({
      unresolved: [{ target: '99999999-9999-4999-8999-999999999999' }]
    });
  });

  /**
   * El plan más chico posible tiene que poder existir. El esquema exigía examen
   * final siempre, así que «agregá una sección» devolvía el curso entero.
   */
  it('un plan de cambios no necesita examen final', async () => {
    const resultado = await herramientas().generate_course_plan.execute(planDeCambios('S1.L1'), OPCIONES);

    expect(resultado.ok).not.toBe(false);
    expect(resultado.sections).toHaveLength(1);
  });
});

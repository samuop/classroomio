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
  guardarAnalisisDeFuente: vi.fn().mockResolvedValue(undefined),
  leerAnalisisDeFuente: vi.fn().mockResolvedValue([]),
  readPlanRegistry: vi.fn().mockResolvedValue([])
}));

import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { getOptionsByQuestionIds, getQuestionsByExerciseIds } from '@cio/db/queries/exercise';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { guardarAnalisisDeFuente, leerAnalisisDeFuente, readPlanRegistry } from '@cio/db/queries/agent';
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
  // Sin análisis guardado: el caso normal de un plan de cambios pedido a mano.
  vi.mocked(leerAnalisisDeFuente).mockResolvedValue([]);
  // Sin plan anterior en la conversación.
  vi.mocked(readPlanRegistry).mockResolvedValue([]);
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
    // Y se dice CUÁL se descartó y por qué: un número suelto no le sirve al
    // modelo para saber qué cambio no usar.
    expect(resultado).toMatchObject({
      discarded: [
        {
          old: 'formulario F-12',
          new: 'formulario F-20',
          reason: expect.stringContaining('nowhere in this course')
        }
      ]
    });

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
          // Tal cual lo escribe la circular: el analista real descarta un `new`
          // que no está en el documento, y «se toma por WhatsApp…» no está.
          valorNuevo: 'WhatsApp 11 5555-0101',
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

  /**
   * Era un AVISO y ahora es una negativa: el aviso se ignoró.
   *
   * Medido el 2026-09-22: el plan salió igual hacia el docente con un target
   * que no apuntaba a nada, y la orden quedó sin poder ejecutarse. Dibujar un
   * plan incumplible sólo sirve para que lo apruebe alguien que no tiene cómo
   * saberlo.
   */
  it('un target que no existe NIEGA el plan, en vez de avisar al costado', async () => {
    const resultado = await herramientas().generate_course_plan.execute(planDeCambios('S9.L4'), OPCIONES);

    expect(resultado).toMatchObject({
      ok: false,
      unresolved: [{ title: 'Quién atiende cada reclamo', target: 'S9.L4' }]
    });
    // Y el plan NO se dibuja: sin secciones no hay tarjeta que aprobar.
    expect(resultado.sections).toBeUndefined();
    expect(String(resultado.note)).toContain('NOT shown to the teacher');
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

/**
 * Lo que el análisis encontró, el plan no lo puede CALLAR.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22. `analyze_source_changes` listó, además de la sección que el
 * docente nombró, otra lección y dos preguntas con el valor viejo, con la nota
 * «un ítem edit por cada lección Y por cada ejercicio listado acá». El modelo
 * armó el plan con la sección nombrada y nada más. Se aprobó, se construyó 4/4,
 * y el curso quedó enseñando el valor nuevo en un lado y el viejo en otro. En
 * la prueba anterior el MISMO modelo sí los había incluido: una nota no es un
 * riel.
 */
describe('un plan de cambios que deja piezas afuera', () => {
  /** Lo que quedó guardado del análisis: el interno 4400 pasa a WhatsApp. */
  const ANALISIS = [
    {
      sourceId: ID.circular,
      fileName: 'Circular de atención.pdf',
      cambios: [
        {
          valorViejo: 'se toma por el interno 4400',
          valorNuevo: 'WhatsApp 11 5555-0101',
          motivo: 'La circular reemplaza el interno por WhatsApp.',
          clave: '4400'
        }
      ]
    }
  ];

  const item = (extra: Record<string, unknown>) => ({
    type: 'lesson',
    title: 'Quién atiende cada reclamo',
    description: 'Actualizar el canal de contacto.',
    order: 0,
    hasExercise: false,
    ...extra
  });

  const plan = (items: Array<Record<string, unknown>>) => ({
    plan: {
      title: 'Actualización de la circular',
      scope: 'changes',
      sections: [{ title: 'Mesa de Ayuda', order: 0, sectionId: 'S1', items }]
    }
  });

  const LA_LECCION = item({
    action: 'edit',
    target: 'S1.L1',
    changes: 'El interno 4400 pasa a WhatsApp.'
  });

  const EL_EJERCICIO = item({
    type: 'exercise',
    title: 'Autoevaluación de la mesa',
    description: 'Actualizar la opción correcta.',
    order: 1,
    action: 'edit',
    target: 'S1.E1',
    changes: 'La opción «Al interno 4400» pasa a WhatsApp.'
  });

  beforeEach(() => {
    vi.mocked(leerAnalisisDeFuente).mockResolvedValue(ANALISIS as never);
  });

  it('se niega, y nombra la pieza con su manija y su pregunta', async () => {
    const resultado = await herramientas().generate_course_plan.execute(plan([LA_LECCION]), OPCIONES);

    expect(resultado).toMatchObject({
      ok: false,
      uncovered: [
        {
          handle: 'S1.E1',
          title: 'Autoevaluación de la mesa',
          questionIds: [521],
          values: ['«4400» → «WhatsApp 11 5555-0101»']
        }
      ]
    });
    // El plan no se dibuja: el docente no puede aprobar algo incompleto.
    expect(resultado.sections).toBeUndefined();
    expect(String(resultado.note)).toContain('skip: true');
  });

  it('con el ítem del ejercicio, el plan sale', async () => {
    const resultado = await herramientas().generate_course_plan.execute(
      plan([LA_LECCION, EL_EJERCICIO]),
      OPCIONES
    );

    expect(resultado.ok).not.toBe(false);
    expect(resultado.uncovered).toBeUndefined();
    expect(resultado.sections).toHaveLength(1);
  });

  /** La salida declarada: dejarla afuera DICIÉNDOLO, para que el docente lo vea. */
  it('con skip y su motivo también sale, y el motivo viaja al plan', async () => {
    const resultado = await herramientas().generate_course_plan.execute(
      plan([
        LA_LECCION,
        item({
          type: 'exercise',
          title: 'Autoevaluación de la mesa',
          description: 'Se deja como está.',
          order: 1,
          action: 'edit',
          target: 'S1.E1',
          skip: true,
          changes: 'La docente pidió no tocar la autoevaluación hasta después del cierre del mes.'
        })
      ]),
      OPCIONES
    );

    expect(resultado.ok).not.toBe(false);

    const [seccion] = resultado.sections as Array<{ items: Array<Record<string, unknown>> }>;

    expect(seccion.items[1]).toMatchObject({ skip: true, changes: expect.stringContaining('no tocar') });
  });

  it('un skip sin motivo se rechaza: el docente no puede ver lo que nadie escribió', async () => {
    const resultado = await herramientas().generate_course_plan.execute(
      plan([
        LA_LECCION,
        item({
          type: 'exercise',
          title: 'Autoevaluación de la mesa',
          description: 'Se deja como está.',
          order: 1,
          action: 'edit',
          target: 'S1.E1',
          skip: true
        })
      ]),
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('changes');
  });

  it('y sin análisis en la conversación, nada de esto corre', async () => {
    vi.mocked(leerAnalisisDeFuente).mockResolvedValue([]);

    const resultado = await herramientas().generate_course_plan.execute(plan([LA_LECCION]), OPCIONES);

    expect(resultado.ok).not.toBe(false);
    expect(resultado.uncovered).toBeUndefined();
  });

  /**
   * Una pieza que un plan ANTERIOR ya cerró no se vuelve a reclamar.
   *
   * El análisis vive en la conversación entera. Sin mirar el registro, el
   * segundo plan de cambios de la misma charla («agregá una sección sobre
   * feriados») se negaba por una ocurrencia que el modelo ya había confirmado
   * como legítima, y la única salida era un ítem `skip` sobre una pieza que
   * nadie mencionó.
   */
  it('una pieza confirmada en el plan anterior no traba el plan nuevo', async () => {
    vi.mocked(readPlanRegistry).mockResolvedValue([
      {
        key: 's1-e1',
        kind: 'exercise',
        title: 'Autoevaluación de la mesa',
        position: 1,
        entityId: ID.autoevaluacion,
        action: 'edit',
        confirmed: { reason: 'La opción que queda es la del reclamo comercial, que no cambió.', at: '2026-09-22T10:00:00Z' }
      }
    ] as never);

    const resultado = await herramientas().generate_course_plan.execute(plan([LA_LECCION]), OPCIONES);

    expect(resultado.ok).not.toBe(false);
    expect(resultado.uncovered).toBeUndefined();
  });

  it('y una que el plan anterior dejó como está, tampoco', async () => {
    vi.mocked(readPlanRegistry).mockResolvedValue([
      {
        key: 's1-e1',
        kind: 'exercise',
        title: 'Autoevaluación de la mesa',
        position: 1,
        entityId: ID.autoevaluacion,
        action: 'edit',
        skip: true
      }
    ] as never);

    const resultado = await herramientas().generate_course_plan.execute(plan([LA_LECCION]), OPCIONES);

    expect(resultado.uncovered).toBeUndefined();
  });

  it('pero una pieza del registro que sólo se ATÓ, sin confirmar ni dejar, sigue contando', async () => {
    vi.mocked(readPlanRegistry).mockResolvedValue([
      {
        key: 's1-e1',
        kind: 'exercise',
        title: 'Autoevaluación de la mesa',
        position: 1,
        entityId: ID.autoevaluacion,
        action: 'edit'
      }
    ] as never);

    const resultado = await herramientas().generate_course_plan.execute(plan([LA_LECCION]), OPCIONES);

    expect(resultado).toMatchObject({ ok: false, uncovered: [{ handle: 'S1.E1' }] });
  });

  /**
   * Si el análisis no se puede leer, el plan no sale como si no hubiera
   * análisis: esa lista vacía es exactamente lo que se lee como «todo bien».
   */
  it('si el análisis no se puede leer, el plan se niega y lo dice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(leerAnalisisDeFuente).mockRejectedValue(new Error('conexión cerrada'));

    const resultado = await herramientas().generate_course_plan.execute(plan([LA_LECCION]), OPCIONES);

    expect(resultado.ok).toBe(false);
    expect(resultado.sections).toBeUndefined();
    expect(String(resultado.error)).toContain('source analysis');
    expect(String(resultado.error)).toContain('conexión cerrada');
  });
});

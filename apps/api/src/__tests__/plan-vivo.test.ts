import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * El plan aprobado es un acuerdo vivo mientras se construye, e historia después.
 *
 * ── Qué pasó (producción, 2026-11-07) ────────────────────────────────────────
 *
 * Un plan del 15/10 pedía un examen final de cinco bloques y se construyó entero.
 * El 30/10, en otra conversación, la docente pidió dos veces que el final fuera
 * sólo de los módulos 1 y 2, y quedó así; cincuenta alumnos lo rindieron. El 7/11
 * escribió «revisar la pregunta sugerida» en la conversación del plan. La ronda,
 * en modo construir porque alguna vez hubo un plan, recibió el JSON del 15/10
 * como «aprobado en el último mensaje, para ejecutar ya, la fuente canónica», y
 * el modelo «alineó» el examen: doce preguntas más sobre cincuenta entregas.
 *
 * Esta suite fija las tres piezas del arreglo: el plan terminado se cierra; lo
 * que la docente quitó no se reconstruye; y sus decisiones a mitad de camino
 * enmiendan el plan, con sus palabras comprobadas.
 *
 * Curso inventado, de un almacén que no existe.
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

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn().mockResolvedValue([])
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  resolvePlanBinding: vi.fn().mockResolvedValue(null),
  readPlanRegistry: vi.fn(),
  enmendarItemDelPlan: vi.fn().mockResolvedValue(true)
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { enmendarItemDelPlan, readPlanRegistry, type PlanRegistryEntry } from '@cio/db/queries/agent';
import { buildTeacherContextMessage } from '@cio/ai-assistant/prompt';
import { AgentRole } from '@cio/ai-assistant';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { buildPlanProgressAnchor } from '@api/services/agent/chat-context';
import { lineasDelRegistro, registroVacio } from '@api/services/agent/round-ledger';
import {
  estadoDelPlanAlEmpezar,
  huellaDelPlan,
  lasEscribioLaDocente,
  planConEnmiendas,
  textosDeLaDocente
} from '@api/services/agent/plan-vivo';

const ID = {
  caja: '11111111-1111-4111-8111-111111111111',
  final: '22222222-2222-4222-8222-222222222222',
  abrir: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cuestionario: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  examen: 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const PLAN = {
  title: 'Caja del Almacén Demo',
  teacherRules: ['No mencionar promociones vencidas.'],
  sections: [
    {
      title: 'Cobrar en la caja',
      order: 0,
      items: [
        { type: 'lesson' as const, title: 'Abrir la caja', description: 'Abrir al empezar el turno.', order: 0, sources: [] },
        { type: 'exercise' as const, title: 'Cuestionario de caja', description: 'Cuatro preguntas.', order: 1 }
      ]
    },
    {
      title: 'Evaluación final',
      order: 1,
      items: [
        {
          type: 'exercise' as const,
          title: 'Examen final integrador',
          description: 'Cinco bloques de preguntas, uno por cada sección del curso.',
          order: 0
        }
      ]
    }
  ]
};

const SECCIONES = [
  { id: ID.caja, title: 'Cobrar en la caja', order: 0 },
  { id: ID.final, title: 'Evaluación final', order: 1 }
];

const ITEMS = [
  { id: ID.abrir, type: ContentType.Lesson, title: 'Abrir la caja', sectionId: ID.caja, order: 0, hasNoteContent: true },
  { id: ID.cuestionario, type: ContentType.Exercise, title: 'Cuestionario de caja', sectionId: ID.caja, order: 1, questionCount: 4 },
  { id: ID.examen, type: ContentType.Exercise, title: 'Examen final integrador', sectionId: ID.final, order: 0, questionCount: 10 }
];

function registro(cambios: Partial<Record<string, Partial<PlanRegistryEntry>>> = {}): PlanRegistryEntry[] {
  const base: PlanRegistryEntry[] = [
    { key: 's1', kind: 'section', title: 'Cobrar en la caja', sectionKey: null, position: 0, entityId: ID.caja },
    { key: 's1.1', kind: 'lesson', title: 'Abrir la caja', sectionKey: 's1', position: 1, entityId: ID.abrir },
    { key: 's1.2', kind: 'exercise', title: 'Cuestionario de caja', sectionKey: 's1', position: 2, entityId: ID.cuestionario },
    { key: 's2', kind: 'section', title: 'Evaluación final', sectionKey: null, position: 3, entityId: ID.final },
    { key: 's2.1', kind: 'exercise', title: 'Examen final integrador', sectionKey: 's2', position: 4, entityId: ID.examen }
  ];

  return base.map((entrada) => ({ ...entrada, ...(cambios[entrada.key] ?? {}) }));
}

const PALABRAS = 'En la evaluación final solo dejar preguntas de la sección 1';
const ENMIENDA_SACAR = { accion: 'sacar' as const, palabras: PALABRAS, at: '2026-11-07T20:00:00Z' };

describe('el plan terminado se cierra: estadoDelPlanAlEmpezar', () => {
  const alcance = { orgId: 'org', courseId: 'curso', conversationId: 'conversacion', userId: 'docente' };

  function base(cierre: { huella: string; at: string } | null | Error = null) {
    return {
      leerCierre: vi.fn(async () => {
        if (cierre instanceof Error) throw cierre;
        return cierre;
      }),
      cerrar: vi.fn(async () => {}),
      abrir: vi.fn(async () => {})
    };
  }

  const medirCon = (secciones = SECCIONES, items = ITEMS, reg = registro()) =>
    vi.fn(async () => ({ progreso: buildPlanProgressAnchor(PLAN, secciones, items, reg), registro: reg }));

  it('en la ronda de aprobación está abierto, y reabre aunque sea el mismo plan', async () => {
    const db = base({ huella: huellaDelPlan(PLAN), at: '2026-10-15T00:00:00Z' });
    const medir = medirCon();

    const estado = await estadoDelPlanAlEmpezar({ alcance, plan: PLAN, esRondaDeAprobacion: true, medir, base: db });

    expect(estado.terminado).toBe(false);
    expect(db.abrir).toHaveBeenCalledWith(alcance);
    expect(medir).not.toHaveBeenCalled();
  });

  it('con el cierre de ESTE plan guardado, está terminado sin medir nada', async () => {
    const db = base({ huella: huellaDelPlan(PLAN), at: '2026-10-15T00:00:00Z' });
    const medir = medirCon();

    const estado = await estadoDelPlanAlEmpezar({ alcance, plan: PLAN, esRondaDeAprobacion: false, medir, base: db });

    expect(estado.terminado).toBe(true);
    expect(medir).not.toHaveBeenCalled();
  });

  it('el cierre de OTRO plan no cuenta: se mide, y completo se cierra con la huella de éste', async () => {
    const db = base({ huella: 'huella-de-un-plan-anterior', at: '2026-10-01T00:00:00Z' });

    const estado = await estadoDelPlanAlEmpezar({
      alcance,
      plan: PLAN,
      esRondaDeAprobacion: false,
      medir: medirCon(),
      base: db
    });

    expect(estado.terminado).toBe(true);
    expect(db.cerrar).toHaveBeenCalledWith({ ...alcance, huella: huellaDelPlan(PLAN) });
  });

  it('medido incompleto, sigue abierto y no se cierra', async () => {
    const db = base();
    const sinExamen = ITEMS.filter((item) => item.id !== ID.examen);

    const estado = await estadoDelPlanAlEmpezar({
      alcance,
      plan: PLAN,
      esRondaDeAprobacion: false,
      medir: medirCon(SECCIONES, sinExamen, registro({ 's2.1': { entityId: null } })),
      base: db
    });

    expect(estado.terminado).toBe(false);
    expect(db.cerrar).not.toHaveBeenCalled();
  });

  it('el caso del examen: lo que la docente borró después no reabre el plan', async () => {
    // El bloque «Evaluación final» se construyó entero y ella borró el examen:
    // eso no es un faltante, así que el plan está completo y se cierra.
    const db = base();
    const sinExamen = ITEMS.filter((item) => item.id !== ID.examen);

    const estado = await estadoDelPlanAlEmpezar({
      alcance,
      plan: PLAN,
      esRondaDeAprobacion: false,
      medir: medirCon(SECCIONES, sinExamen, registro()),
      base: db
    });

    expect(estado.terminado).toBe(true);
    expect(db.cerrar).toHaveBeenCalled();
  });

  it('si la base falla, el plan se trata como abierto, que es como andaba todo antes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const estado = await estadoDelPlanAlEmpezar({
      alcance,
      plan: PLAN,
      esRondaDeAprobacion: false,
      medir: medirCon(),
      base: base(new Error('la base no contesta'))
    });

    expect(estado.terminado).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('huellaDelPlan', () => {
  it('es la misma para el mismo plan y cambia si cambia lo que hay que construir', () => {
    const otraDescripcion = structuredClone(PLAN);
    otraDescripcion.sections[1].items[0].description = 'Sólo la sección 1.';

    expect(huellaDelPlan(structuredClone(PLAN))).toBe(huellaDelPlan(PLAN));
    expect(huellaDelPlan(otraDescripcion)).not.toBe(huellaDelPlan(PLAN));
  });

  it('editar las reglas de la docente no hace otro plan', () => {
    expect(huellaDelPlan({ ...PLAN, teacherRules: ['Otra regla.'] })).toBe(huellaDelPlan(PLAN));
  });
});

describe('el ancla respeta lo que la docente decidió', () => {
  it('un ítem que ella sacó del plan no se construye ni cuenta como pendiente', () => {
    const progreso = buildPlanProgressAnchor(
      PLAN,
      SECCIONES,
      ITEMS.filter((item) => item.id !== ID.cuestionario),
      registro({ 's1.2': { entityId: null, enmienda: ENMIENDA_SACAR } })
    );

    expect(progreso?.items.find((item) => item.key === 's1.2')).toMatchObject({
      status: 'removed',
      removed: { by: 'teacher', words: PALABRAS }
    });
    expect(progreso?.pendingCount).toBe(0);
    // Fuera de la cuenta: 4 de 4, no 4 de 5.
    expect(progreso).toMatchObject({ total: 4, completed: 4 });
    // Nada que construir ⇒ ninguna orden en el prompt.
    expect(progreso?.anchorText).toBe('');
  });

  it('mientras queda algo, el renglón dice que ella lo sacó y que no se construye', () => {
    const progreso = buildPlanProgressAnchor(
      PLAN,
      SECCIONES,
      ITEMS.filter((item) => item.id !== ID.cuestionario && item.id !== ID.abrir),
      registro({ 's1.1': { entityId: null }, 's1.2': { entityId: null, enmienda: ENMIENDA_SACAR } })
    );

    expect(progreso?.anchorText).toContain(
      `exercise "Cuestionario de caja" ➖ taken out of the plan by the teacher («${PALABRAS}») — do NOT build it`
    );
    expect(progreso?.anchorText).not.toMatch(/Cuestionario de caja" ⬜/);
    expect(progreso?.pendingCount).toBe(1);
  });

  it('una sección que ella sacó se lleva sus ítems, aunque nunca se haya creado', () => {
    const progreso = buildPlanProgressAnchor(
      PLAN,
      [SECCIONES[0]],
      ITEMS.filter((item) => item.sectionId === ID.caja),
      registro({ s2: { entityId: null, enmienda: ENMIENDA_SACAR }, 's2.1': { entityId: null } })
    );

    expect(progreso?.items.filter((item) => item.status === 'removed').map((item) => item.key)).toEqual(['s2', 's2.1']);
    expect(progreso?.pendingCount).toBe(0);
    expect(progreso?.anchorText).toBe('');
  });

  it('una sección construida y después borrada sale del plan con sus ítems', () => {
    const progreso = buildPlanProgressAnchor(
      PLAN,
      [SECCIONES[0]],
      ITEMS.filter((item) => item.sectionId === ID.caja),
      registro()
    );

    expect(progreso?.items.find((item) => item.key === 's2')).toMatchObject({ status: 'removed', removed: { by: 'deleted' } });
    expect(progreso?.items.find((item) => item.key === 's2.1')?.status).toBe('removed');
    expect(progreso?.pendingCount).toBe(0);
  });

  it('lo que ella cambió viaja en el renglón de lo que falta construir', () => {
    const progreso = buildPlanProgressAnchor(
      PLAN,
      SECCIONES,
      ITEMS.filter((item) => item.id !== ID.examen),
      registro({
        's2.1': {
          entityId: null,
          enmienda: { accion: 'cambiar', descripcion: 'Un solo bloque, de la sección 1.', palabras: PALABRAS, at: '2026-11-07T20:00:00Z' }
        }
      })
    );

    expect(progreso?.anchorText).toContain(
      'exercise "Examen final integrador" ⬜ missing — create it — the teacher changed what to build: «Un solo bloque, de la sección 1.»'
    );
  });
});

describe('planConEnmiendas: el JSON que lee el modelo', () => {
  it('sin enmiendas es el mismo plan', () => {
    expect(planConEnmiendas(PLAN, registro())).toBe(PLAN);
  });

  it('saca lo que ella sacó y cambia lo que ella cambió, sin tocar el plan guardado', () => {
    const enmendado = planConEnmiendas(
      PLAN,
      registro({
        's1.2': { enmienda: ENMIENDA_SACAR },
        's2.1': {
          enmienda: { accion: 'cambiar', descripcion: 'Un solo bloque, de la sección 1.', palabras: PALABRAS, at: 'x' }
        }
      })
    );

    expect(enmendado.sections[0].items.map((item) => item.title)).toEqual(['Abrir la caja']);
    expect(enmendado.sections[1].items[0].description).toBe('Un solo bloque, de la sección 1.');
    expect(PLAN.sections[0].items).toHaveLength(2);
    expect(PLAN.sections[1].items[0].description).toContain('Cinco bloques');
  });

  it('una sección sacada no viaja', () => {
    const enmendado = planConEnmiendas(PLAN, registro({ s2: { enmienda: ENMIENDA_SACAR } }));

    expect(enmendado.sections.map((seccion) => seccion.title)).toEqual(['Cobrar en la caja']);
  });
});

describe('las palabras tienen que ser de la docente', () => {
  const MENSAJES = [
    { role: 'user', parts: [{ type: 'text', text: 'Armá el curso de caja.' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'El examen final queda con un solo bloque.' }] },
    { role: 'user', parts: [{ type: 'text', text: 'EN LA EVALUACION FINAL SOLO DEJAR PREGUNTAS DE LA SECCION 1!' }] }
  ];

  it('textosDeLaDocente toma sólo lo que ella escribió', () => {
    expect(textosDeLaDocente(MENSAJES)).toEqual([
      'Armá el curso de caja.',
      'EN LA EVALUACION FINAL SOLO DEJAR PREGUNTAS DE LA SECCION 1!'
    ]);
  });

  it('se reconocen aunque cambien tildes, mayúsculas y puntuación', () => {
    expect(lasEscribioLaDocente('En la evaluación final solo dejar preguntas de la sección 1', textosDeLaDocente(MENSAJES))).toBe(true);
  });

  it('una paráfrasis, lo que dijo el asistente o un «sí» no alcanzan', () => {
    const textos = textosDeLaDocente(MENSAJES);

    expect(lasEscribioLaDocente('El examen final tiene que cubrir sólo la sección 1', textos)).toBe(false);
    expect(lasEscribioLaDocente('El examen final queda con un solo bloque', textos)).toBe(false);
    expect(lasEscribioLaDocente('sí', ['sí'])).toBe(false);
  });
});

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };
const OPCIONES = { toolCallId: 'llamada', messages: [] };

describe('update_plan', () => {
  const TEXTOS = ['Armá el curso de caja.', `${PALABRAS}, gracias.`];

  function herramientas(opciones: { planEnConstruccion?: boolean; registro?: ReturnType<typeof registroVacio> } = {}) {
    return buildAgentTools('org', 'docente', 'curso', [], {
      conversationId: 'conversacion',
      isBuilding: true,
      locale: 'es',
      planEnConstruccion: opciones.planEnConstruccion ?? true,
      textosDeLaDocente: TEXTOS,
      registro: opciones.registro
    }) as Record<string, Herramienta>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPlanRegistry).mockResolvedValue(registro() as never);
    vi.mocked(enmendarItemDelPlan).mockResolvedValue(true);
  });

  it('sin un plan en construcción se niega: un plan terminado no se enmienda', async () => {
    const resultado = await herramientas({ planEnConstruccion: false }).update_plan.execute(
      { changes: [{ planKey: 's2.1', action: 'remove' }], teacherWords: PALABRAS },
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('no plan being built');
    expect(enmendarItemDelPlan).not.toHaveBeenCalled();
  });

  it('con palabras que ella no escribió se niega y no guarda nada', async () => {
    const resultado = await herramientas().update_plan.execute(
      { changes: [{ planKey: 's2.1', action: 'remove' }], teacherWords: 'Sacá el examen final porque ya no hace falta' },
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('not in any of the teacher');
    expect(enmendarItemDelPlan).not.toHaveBeenCalled();
  });

  it('una clave inventada frena TODO el pedido, aunque las otras existan', async () => {
    const resultado = await herramientas().update_plan.execute(
      {
        changes: [
          { planKey: 's1.2', action: 'remove' },
          { planKey: 's9.9', action: 'remove' }
        ],
        teacherWords: PALABRAS
      },
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('"s9.9"');
    expect(enmendarItemDelPlan).not.toHaveBeenCalled();
  });

  it('«change» sin descripción, o sobre una sección, se niega', async () => {
    const sinDescripcion = await herramientas().update_plan.execute(
      { changes: [{ planKey: 's2.1', action: 'change' }], teacherWords: PALABRAS },
      OPCIONES
    );
    const sobreSeccion = await herramientas().update_plan.execute(
      { changes: [{ planKey: 's2', action: 'change', description: 'Otra cosa.' }], teacherWords: PALABRAS },
      OPCIONES
    );

    expect(sinDescripcion.ok).toBe(false);
    expect(sobreSeccion.ok).toBe(false);
    expect(enmendarItemDelPlan).not.toHaveBeenCalled();
  });

  it('guarda cada decisión con sus palabras, y el resumen de la ronda lo dice', async () => {
    const libro = registroVacio();

    const resultado = await herramientas({ registro: libro }).update_plan.execute(
      {
        changes: [
          { planKey: 's1.2', action: 'remove' },
          { planKey: 's2.1', action: 'change', description: 'Un solo bloque, de la sección 1.' }
        ],
        teacherWords: PALABRAS
      },
      OPCIONES
    );

    expect(resultado.ok).not.toBe(false);
    expect(enmendarItemDelPlan).toHaveBeenCalledWith(
      expect.objectContaining({ planKey: 's1.2', enmienda: expect.objectContaining({ accion: 'sacar', palabras: PALABRAS }) })
    );
    expect(enmendarItemDelPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planKey: 's2.1',
        enmienda: expect.objectContaining({ accion: 'cambiar', descripcion: 'Un solo bloque, de la sección 1.' })
      })
    );
    expect(lineasDelRegistro(libro)).toEqual([
      'Sacó del plan «Cuestionario de caja»',
      'Cambió en el plan «Examen final integrador»'
    ]);
  });
});

describe('el contexto: el plan viejo no se presenta como una orden nueva', () => {
  const CONTEXTO = {
    orgId: 'org',
    courseId: 'curso',
    courseTitle: 'Caja del Almacén Demo',
    userId: 'docente',
    role: AgentRole.TEACHER,
    locale: 'es'
  } as Parameters<typeof buildTeacherContextMessage>[0];

  it('«el último mensaje aprobó» sólo en la ronda de aprobación', () => {
    const aprobacion = buildTeacherContextMessage(CONTEXTO, { approvedPlan: PLAN, esRondaDeAprobacion: true });
    const despues = buildTeacherContextMessage(CONTEXTO, { approvedPlan: PLAN, esRondaDeAprobacion: false });

    expect(aprobacion).toContain('The latest user message approved a final course plan for immediate execution');
    expect(despues).not.toContain('The latest user message approved');
    expect(despues).toContain('## Approved Plan (being built)');
    expect(despues).toContain('never add to, remove from or rewrite them to make them match this JSON');
  });

  it('con el plan terminado no viaja el JSON, pero las reglas de la docente siguen', () => {
    const texto = buildTeacherContextMessage(CONTEXTO, { teacherRules: PLAN.teacherRules });

    expect(texto).not.toContain('## Approved Plan');
    expect(texto).toContain("## The teacher's rules for this course");
    expect(texto).toContain('No mencionar promociones vencidas.');
  });
});

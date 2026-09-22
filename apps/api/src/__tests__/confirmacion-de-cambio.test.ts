import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * La salida declarada para un «todavía está» que el servidor no puede resolver.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22. El análisis pedía cambiar «2 horas» con el contexto `["P2",
 * "primera respuesta"]`. La lección de escalamiento dice, legítimamente,
 * «Incidente P1 (Crítica) … Sin resolver a las 2 horas … Incidente P2 (Alta)»:
 * un diagrama entero en un bloque, sin puntos. El `P2` queda a menos de 160
 * caracteres de la «2 horas» que es del P1, así que el barrido dice «todavía
 * está» y el ítem no se puede dar por hecho NUNCA. Costó dos rondas extra
 * (260 s), dos `replace_lesson_block` que no cambiaron nada, y el modelo terminó
 * escribiendo «2 h» en vez de «2 horas» para callar el riel: deformó una frase
 * correcta para salir del bucle.
 *
 * Probadas sobre ese texto, ni la heurística de distancia ni la de oración
 * distinguen las dos «2 horas»: en el diagrama el P2 está MÁS cerca que el P1.
 * Sólo el modelo puede decirlo. Esto es cómo lo dice, y qué comprueba el
 * servidor antes de creerle.
 *
 * Curso inventado, de una mesa de ayuda que no existe.
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
  confirmarItemDelPlan: vi.fn().mockResolvedValue(true)
}));

vi.mock('@api/services/agent/plan-de-cambios', async (original) => ({
  ...(await original<typeof import('@api/services/agent/plan-de-cambios')>()),
  estadoDelContenido: vi.fn()
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { confirmarItemDelPlan, readPlanRegistry, type PlanRegistryEntry } from '@cio/db/queries/agent';
import { estadoDelContenido } from '@api/services/agent/plan-de-cambios';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { buildPlanProgressAnchor } from '@api/services/agent/chat-context';
import { estadoDeCursoDePrueba } from './ayuda/estado-del-curso';

const ID = {
  mesaDeAyuda: '22222222-2222-4222-8222-222222222222',
  escalamiento: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const SECCIONES = [{ id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.escalamiento,
    type: ContentType.Lesson,
    title: 'Cómo se escala un incidente',
    sectionId: ID.mesaDeAyuda,
    order: 0,
    hasNoteContent: true
  }
];

/** El diagrama real: las dos «2 horas» de dos reglas distintas, en un solo bloque. */
const CON_LAS_DOS =
  '<div data-block-id="b3">[diagram: Incidente P1 (Crítica) — Primera respuesta: 30 minutos — ' +
  'Sin resolver a las 2 horas, se escala a la gerencia. Incidente P2 (Alta) — Primera respuesta: 4 horas]</div>';

const HASH_INICIAL = `hash:${CON_LAS_DOS.length}`;

const plan = () => ({
  title: 'Actualización de la circular',
  scope: 'changes' as const,
  sections: [
    {
      title: 'Mesa de Ayuda',
      order: 0,
      sectionId: 'S1',
      items: [
        {
          type: 'lesson' as const,
          title: 'Cómo se escala un incidente',
          description: 'd',
          order: 0,
          hasExercise: false,
          action: 'edit' as const,
          target: 'S1.L1',
          changes: 'La primera respuesta del P2 pasa de 2 horas a 4 horas.'
        }
      ]
    }
  ]
});

const registro = (entrada: Partial<PlanRegistryEntry>): PlanRegistryEntry[] => [
  { key: 's1', kind: 'section', title: 'Mesa de Ayuda', sectionKey: null, position: 0, entityId: ID.mesaDeAyuda },
  {
    key: 's1.1',
    kind: 'lesson',
    title: 'Cómo se escala un incidente',
    sectionKey: 's1',
    position: 1,
    entityId: ID.escalamiento,
    action: 'edit',
    replacements: [{ old: '2 horas', new: '4 horas', key: '2 horas', context: ['P2'] }],
    ...entrada
  }
];

const anclaCon = (entrada: Partial<PlanRegistryEntry>, hash = HASH_INICIAL) =>
  buildPlanProgressAnchor(
    plan(),
    SECCIONES,
    ITEMS,
    registro(entrada),
    estadoDeCursoDePrueba({
      lecciones: { [ID.escalamiento]: CON_LAS_DOS },
      hashes: { [ID.escalamiento]: hash }
    })
  );

describe('el ancla ofrece la salida sólo cuando corresponde', () => {
  it('sin haber editado nada, NO la ofrece: primero hay que hacer el cambio', () => {
    const progreso = anclaCon({ baseline: { contentHash: HASH_INICIAL } });

    expect(progreso?.pendingCount).toBe(1);
    expect(progreso?.anchorText).toContain('✏️ TO EDIT');
    expect(progreso?.anchorText).not.toContain('confirm_change_applied');
  });

  it('con el contenido ya cambiado, la ofrece con la clave del ítem', () => {
    const progreso = anclaCon({ baseline: { contentHash: 'hash-del-lunes' } });

    expect(progreso?.pendingCount).toBe(1);
    expect(progreso?.anchorText).toContain('confirm_change_applied');
    expect(progreso?.anchorText).toContain('planKey s1.1');
    // Y no le enseña a esquivar el riel deformando el texto.
    expect(progreso?.anchorText).toContain('Never rewrite a correct sentence');
  });

  it('un ítem confirmado se da por hecho, con el motivo a la vista', () => {
    const progreso = anclaCon({
      baseline: { contentHash: 'hash-del-lunes' },
      confirmed: { reason: 'La «2 horas» que queda es el plazo del P1, que la circular no cambia.', at: '2026-09-22T10:00:00Z' }
    });

    expect(progreso?.items.find((item) => item.key === 's1.1')).toMatchObject({
      status: 'done',
      confirmed: 'La «2 horas» que queda es el plazo del P1, que la circular no cambia.'
    });
    expect(progreso?.pendingCount).toBe(0);
  });

  /**
   * Con el plan completo el ancla se calla entera, así que el «✅ (confirmed…)»
   * hay que mirarlo en una vuelta donde quede algo pendiente.
   */
  it('el ✅ del ítem confirmado dice que fue una declaración', () => {
    const progreso = buildPlanProgressAnchor(
      {
        ...plan(),
        sections: [
          {
            ...plan().sections[0],
            items: [
              plan().sections[0].items[0],
              {
                type: 'lesson' as const,
                title: 'Una lección que todavía no existe',
                description: 'd',
                order: 1,
                hasExercise: false
              }
            ]
          }
        ]
      },
      SECCIONES,
      ITEMS,
      registro({
        baseline: { contentHash: 'hash-del-lunes' },
        confirmed: { reason: 'La 2 horas que queda es la del P1.', at: '2026-09-22T10:00:00Z' }
      }),
      estadoDeCursoDePrueba({
        lecciones: { [ID.escalamiento]: CON_LAS_DOS },
        hashes: { [ID.escalamiento]: HASH_INICIAL }
      })
    );

    expect(progreso?.anchorText).toContain('✅ (confirmed by the assistant: La 2 horas que queda es la del P1.)');
  });
});

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es'
  }) as Record<string, Herramienta>;
}

const MOTIVO = 'La «2 horas» que queda es el plazo del P1, que la circular no cambia.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(confirmarItemDelPlan).mockResolvedValue(true);
  vi.mocked(readPlanRegistry).mockResolvedValue(registro({ baseline: { contentHash: HASH_INICIAL } }) as never);
  vi.mocked(estadoDelContenido).mockResolvedValue(
    estadoDeCursoDePrueba({
      lecciones: { [ID.escalamiento]: CON_LAS_DOS },
      hashes: { [ID.escalamiento]: HASH_INICIAL }
    }) as never
  );
});

describe('confirm_change_applied', () => {
  it('sin haber cambiado el contenido, se niega y no guarda nada', async () => {
    const resultado = await herramientas().confirm_change_applied.execute(
      { planKey: 's1.1', reason: MOTIVO },
      OPCIONES
    );

    expect(confirmarItemDelPlan).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('byte-for-byte');
  });

  it('con el contenido ya cambiado, la guarda con su motivo', async () => {
    vi.mocked(readPlanRegistry).mockResolvedValue(registro({ baseline: { contentHash: 'hash-del-lunes' } }) as never);

    const resultado = await herramientas().confirm_change_applied.execute(
      { planKey: 's1.1', reason: MOTIVO },
      OPCIONES
    );

    expect(resultado).toMatchObject({ ok: true, planKey: 's1.1' });
    expect(confirmarItemDelPlan).toHaveBeenCalledWith(expect.objectContaining({ planKey: 's1.1', reason: MOTIVO }));
  });

  it('una clave que no está en el registro se niega con el listado del error', async () => {
    const resultado = await herramientas().confirm_change_applied.execute(
      { planKey: 's9.9', reason: MOTIVO },
      OPCIONES
    );

    expect(confirmarItemDelPlan).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('s9.9');
  });

  it('sobre un ítem de construcción no hay nada que confirmar', async () => {
    vi.mocked(readPlanRegistry).mockResolvedValue([
      { key: 's1.1', kind: 'lesson', title: 'Lección nueva', sectionKey: 's1', position: 1, entityId: null }
    ] as never);

    const resultado = await herramientas().confirm_change_applied.execute(
      { planKey: 's1.1', reason: MOTIVO },
      OPCIONES
    );

    expect(confirmarItemDelPlan).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('not a change order');
  });
});

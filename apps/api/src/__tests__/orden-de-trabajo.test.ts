import { describe, expect, it } from 'vitest';
import { ContentType } from '@cio/utils/constants';
import { buildPlanProgressAnchor } from '@api/services/agent/chat-context';
import { estadoDeCursoDePrueba } from './ayuda/estado-del-curso';
import type { PlanRegistryEntry } from '@cio/db/queries/agent';

/**
 * El ancla como ORDEN DE TRABAJO.
 *
 * ── Qué se cuida acá ─────────────────────────────────────────────────────────
 *
 * Un plan de construcción se mide por existencia: la lección está o no está. Un
 * plan de cambios no se puede medir así, porque la lección SIEMPRE está. Si un
 * ítem que manda reescribir cayera en el camino de la existencia, aparecería ✅
 * apenas la fila existe —que es siempre— y la única orden que había se perdería
 * en silencio.
 *
 * Las dos medidas que se prueban acá:
 *
 * - Con reemplazos, hecho es que el valor viejo YA NO APAREZCA. Mientras esté,
 *   el ancla dice en qué bloque, que es lo que convierte la edición siguiente en
 *   quirúrgica en vez de una reescritura entera.
 * - Sin reemplazos, hecho es que el contenido difiera de la línea de base.
 *
 * Curso inventado, de una distribuidora que no existe.
 */

const ID = {
  mesaDeAyuda: '22222222-2222-4222-8222-222222222222',
  quienAtiende: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  comoSeCierra: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  autoevaluacion: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
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
    questionCount: 4
  }
];

const CON_EL_INTERNO =
  '<p data-block-id="b7">El reclamo se toma por el interno 4400.</p>' +
  '<p data-block-id="b12">Si nadie atiende el interno 4400, se deja nota.</p>';

const YA_CORREGIDA =
  '<p data-block-id="b7">El reclamo se toma por WhatsApp 11 5555-0101.</p>' +
  '<p data-block-id="b12">Si nadie contesta, se registra en el sistema.</p>';

/** El interno se arregló en un bloque y quedó en el otro: la orden sigue abierta. */
const A_MEDIAS =
  '<p data-block-id="b7">El reclamo se toma por WhatsApp 11 5555-0101.</p>' +
  '<p data-block-id="b12">Si nadie atiende el interno 4400, se registra en el sistema.</p>';

const PREGUNTA_VIEJA = [
  {
    id: 521,
    exerciseId: ID.autoevaluacion,
    title: '¿A qué interno se llama para abrir un reclamo?',
    options: [{ id: 1, label: 'Al interno 4400', isCorrect: true }],
    settings: null
  }
];

/** El plan: una sección existente con una orden de cambio adentro. */
const plan = (item: Record<string, unknown>) => ({
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
          title: 'Quién atiende cada reclamo',
          description: 'd',
          order: 0,
          hasExercise: false,
          ...item
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
    title: 'Quién atiende cada reclamo',
    sectionKey: 's1',
    position: 1,
    entityId: ID.quienAtiende,
    ...entrada
  }
];

const REEMPLAZOS = [
  { old: 'interno 4400', new: 'WhatsApp 11 5555-0101' },
  { old: 'se deja nota', new: 'se registra en el sistema' }
];

describe('una orden de edición con valores concretos', () => {
  it('queda pendiente mientras el valor viejo siga en la lección, y dice en qué bloques', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'edit', target: 'S1.L1', changes: 'El interno pasa a WhatsApp.' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'edit', replacements: REEMPLAZOS }),
      estadoDeCursoDePrueba({ lecciones: { [ID.quienAtiende]: CON_EL_INTERNO } })
    );

    expect(progreso?.items.find((i) => i.key === 's1.1')?.status).toBe('missing');
    expect(progreso?.pendingCount).toBe(1);
    expect(progreso?.anchorText).toContain('✏️ TO EDIT');
    expect(progreso?.anchorText).toContain('replace «interno 4400» → «WhatsApp 11 5555-0101»');
    expect(progreso?.anchorText).toContain('blocks b7, b12');
    expect(progreso?.anchorText).toContain('use replace_lesson_block');
    // La manija, no el UUID: es lo único que el modelo puede copiar bien.
    expect(progreso?.anchorText).toContain('(S1.L1)');
    expect(progreso?.anchorText).not.toContain(ID.quienAtiende);
  });

  it('se da por hecha recién cuando NINGÚN valor viejo aparece', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'edit', target: 'S1.L1', changes: 'El interno pasa a WhatsApp.' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'edit', replacements: REEMPLAZOS }),
      estadoDeCursoDePrueba({ lecciones: { [ID.quienAtiende]: YA_CORREGIDA } })
    );

    expect(progreso?.items.find((i) => i.key === 's1.1')?.status).toBe('done');
    expect(progreso?.pendingCount).toBe(0);
    expect(progreso?.anchorText).toBe('');
  });

  /**
   * El caso que el arreglo persigue: el modelo cambió UNA de las dos
   * apariciones. El dato sigue en el curso, así que la orden sigue abierta — y
   * el ancla ya no nombra el bloque que se arregló.
   */
  it('una sola aparición arreglada no cierra la orden', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'edit', target: 'S1.L1', changes: 'El interno pasa a WhatsApp.' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'edit', replacements: REEMPLAZOS }),
      estadoDeCursoDePrueba({ lecciones: { [ID.quienAtiende]: A_MEDIAS } })
    );

    expect(progreso?.pendingCount).toBe(1);
    // Sólo queda la aparición del bloque que nadie tocó, y el valor ya
    // reemplazado desapareció de la orden.
    expect(progreso?.anchorText).toContain('block b12');
    expect(progreso?.anchorText).not.toContain('b7');
    expect(progreso?.anchorText).not.toContain('se deja nota');
  });

  it('sobre un ejercicio nombra la pregunta que todavía lo dice', () => {
    const progreso = buildPlanProgressAnchor(
      {
        title: 'Actualización de la circular',
        scope: 'changes',
        sections: [
          {
            title: 'Mesa de Ayuda',
            order: 0,
            sectionId: 'S1',
            items: [
              {
                type: 'exercise',
                title: 'Autoevaluación de la mesa',
                description: 'd',
                order: 0,
                hasExercise: false,
                action: 'edit',
                target: 'S1.E1',
                changes: 'La pregunta del interno.'
              }
            ]
          }
        ]
      },
      SECCIONES,
      ITEMS,
      [
        { key: 's1', kind: 'section', title: 'Mesa de Ayuda', sectionKey: null, position: 0, entityId: ID.mesaDeAyuda },
        {
          key: 's1.1',
          kind: 'exercise',
          title: 'Autoevaluación de la mesa',
          sectionKey: 's1',
          position: 1,
          entityId: ID.autoevaluacion,
          action: 'edit',
          replacements: [{ old: 'interno 4400', new: 'WhatsApp 11 5555-0101' }]
        }
      ],
      estadoDeCursoDePrueba({ preguntas: { [ID.autoevaluacion]: PREGUNTA_VIEJA } })
    );

    expect(progreso?.pendingCount).toBe(1);
    expect(progreso?.anchorText).toContain('question 521 still says «interno 4400»');
    expect(progreso?.anchorText).toContain('update_questions');
  });
});

describe('una orden de reescritura, sin valores concretos', () => {
  const baseline = { contentHash: 'hash-de-cuando-se-aprobo' };

  it('queda pendiente mientras el contenido sea el de la línea de base', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'rewrite', target: 'S1.L1', changes: 'Se reescribe con la circular nueva.' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'rewrite', baseline }),
      estadoDeCursoDePrueba({
        lecciones: { [ID.quienAtiende]: CON_EL_INTERNO },
        hashes: { [ID.quienAtiende]: baseline.contentHash }
      })
    );

    expect(progreso?.pendingCount).toBe(1);
    expect(progreso?.anchorText).toContain('♻️ TO REWRITE');
    expect(progreso?.anchorText).toContain('write_lesson with lessonId S1.L1');
    expect(progreso?.anchorText).toContain('Se reescribe con la circular nueva.');
  });

  it('se da por hecha cuando el contenido dejó de ser el de la línea de base', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'rewrite', target: 'S1.L1', changes: 'Se reescribe con la circular nueva.' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'rewrite', baseline }),
      estadoDeCursoDePrueba({
        lecciones: { [ID.quienAtiende]: YA_CORREGIDA },
        hashes: { [ID.quienAtiende]: 'otro-hash' }
      })
    );

    expect(progreso?.items.find((i) => i.key === 's1.1')?.status).toBe('done');
    expect(progreso?.pendingCount).toBe(0);
  });

  /**
   * Sin nada con qué comparar, PENDIENTE. Los dos errores no son simétricos:
   * reclamar de más cuesta una vuelta, y dar por hecho de menos deja el dato
   * viejo en el curso sin que nadie avise.
   */
  it('sin estado del curso no se da nada por hecho', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'rewrite', target: 'S1.L1', changes: 'c' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'rewrite', baseline })
    );

    expect(progreso?.pendingCount).toBe(1);
  });
});

describe('lo que una orden de cambio NO es', () => {
  /**
   * La línea que separa las dos clases de ancla. Sin ella, la lección
   * aparecería ✅ por existir y la orden se perdería.
   */
  it('una lección que existe y tiene contenido no cuenta como hecha por existir', () => {
    const conOrden = buildPlanProgressAnchor(
      plan({ action: 'edit', target: 'S1.L1', changes: 'c' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'edit', replacements: REEMPLAZOS }),
      estadoDeCursoDePrueba({ lecciones: { [ID.quienAtiende]: CON_EL_INTERNO } })
    );
    const sinOrden = buildPlanProgressAnchor(plan({}), SECCIONES, ITEMS, registro({}));

    expect(conOrden?.items.find((i) => i.key === 's1.1')?.status).toBe('missing');
    // El mismo curso, la misma lección, sin orden de cambio: hecha.
    expect(sinOrden?.items.find((i) => i.key === 's1.1')?.status).toBe('done');
  });

  it('el pie del ancla dice que lo marcado ya existe y no hay que crearlo', () => {
    const progreso = buildPlanProgressAnchor(
      plan({ action: 'edit', target: 'S1.L1', changes: 'c' }),
      SECCIONES,
      ITEMS,
      registro({ action: 'edit', replacements: REEMPLAZOS }),
      estadoDeCursoDePrueba({ lecciones: { [ID.quienAtiende]: CON_EL_INTERNO } })
    );

    expect(progreso?.anchorText).toContain('ALREADY EXIST — never create them');
  });
});

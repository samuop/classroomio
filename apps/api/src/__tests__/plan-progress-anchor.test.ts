import { describe, expect, it } from 'vitest';
import { buildPlanProgressAnchor } from '../services/agent/chat-context';
import type { PlanRegistryEntry } from '@cio/db/queries/agent';

/**
 * Regression suite for the duplication bug.
 *
 * The anchor used to reconcile the approved plan against the live course by
 * comparing normalized titles. The model routinely improves a title while
 * building — "1.1 Introducción" for a plan item called "Introducción" — so a
 * lesson that existed was reported ⬜ missing, and the anchor then told the model,
 * in the strongest wording of the entire prompt, to create it again. The duplicate
 * sections and lessons teachers reported were the server ordering the duplication.
 *
 * The fix is the plan registry: each item records the id of the row built from it,
 * so reconciliation asks "does row <uuid> still exist?" instead.
 */

const plan = {
  title: 'Estadística aplicada',
  sections: [
    {
      title: 'Fundamentos',
      order: 0,
      items: [
        { type: 'lesson' as const, title: 'Introducción', description: 'd', order: 0, hasExercise: false },
        { type: 'exercise' as const, title: 'Autoevaluación', description: 'd', order: 1, hasExercise: false }
      ]
    }
  ]
};

const sections = [{ id: 'sec-uuid', title: 'Fundamentos' }];

function registry(overrides: Partial<PlanRegistryEntry>[] = []): PlanRegistryEntry[] {
  const base: PlanRegistryEntry[] = [
    { key: 's1', kind: 'section', title: 'Fundamentos', sectionKey: null, position: 0, entityId: 'sec-uuid' },
    { key: 's1.1', kind: 'lesson', title: 'Introducción', sectionKey: 's1', position: 1, entityId: null },
    { key: 's1.2', kind: 'exercise', title: 'Autoevaluación', sectionKey: 's1', position: 2, entityId: null }
  ];

  return base.map((entry) => ({ ...entry, ...(overrides.find((o) => o.key === entry.key) ?? {}) }));
}

describe('buildPlanProgressAnchor — resolution by registry binding', () => {
  it('treats a bound lesson as built even when the model renamed it', () => {
    const items = [
      // Title deliberately differs from the plan's — this is the exact case that
      // used to produce a duplicate.
      {
        id: 'lesson-uuid',
        type: 'lesson',
        title: '1.1 Introducción al muestreo',
        sectionId: 'sec-uuid',
        hasNoteContent: true
      }
    ];

    const progress = buildPlanProgressAnchor(
      plan,
      sections,
      items,
      registry([{ key: 's1.1', entityId: 'lesson-uuid' }])
    );

    const lesson = progress?.items.find((entry) => entry.key === 's1.1');
    expect(lesson?.status).toBe('done');
    expect(progress?.anchorText).not.toContain('"Introducción" ⬜ missing');
  });

  it('still reports a genuinely absent item as missing', () => {
    const progress = buildPlanProgressAnchor(plan, sections, [], registry());

    expect(progress?.items.find((entry) => entry.key === 's1.1')?.status).toBe('missing');
    expect(progress?.pendingCount).toBe(2);
  });

  it('reports a bound but empty lesson as empty, and says not to recreate it', () => {
    const items = [
      { id: 'lesson-uuid', type: 'lesson', title: 'Introducción', sectionId: 'sec-uuid', hasNoteContent: false }
    ];

    const progress = buildPlanProgressAnchor(
      plan,
      sections,
      items,
      registry([{ key: 's1.1', entityId: 'lesson-uuid' }])
    );

    expect(progress?.items.find((entry) => entry.key === 's1.1')?.status).toBe('empty');
    expect(progress?.emptyCount).toBe(1);
    expect(progress?.anchorText).toContain('do NOT create it again');
  });

  it('reports a bound exercise with no questions as empty', () => {
    const items = [
      { id: 'ex-uuid', type: 'exercise', title: 'Autoevaluación', sectionId: 'sec-uuid', questionCount: 0 }
    ];

    const progress = buildPlanProgressAnchor(plan, sections, items, registry([{ key: 's1.2', entityId: 'ex-uuid' }]));

    expect(progress?.items.find((entry) => entry.key === 's1.2')?.status).toBe('empty');
  });

  it('ignores a binding whose row no longer exists (teacher deleted it)', () => {
    const progress = buildPlanProgressAnchor(plan, sections, [], registry([{ key: 's1.1', entityId: 'deleted-uuid' }]));

    expect(progress?.items.find((entry) => entry.key === 's1.1')?.status).toBe('missing');
  });

  it('exposes each planKey in the anchor so the model can echo it back', () => {
    const progress = buildPlanProgressAnchor(plan, sections, [], registry());

    expect(progress?.anchorText).toContain('[s1]');
    expect(progress?.anchorText).toContain('[s1.1]');
    expect(progress?.anchorText).toContain('planKey');
  });

  it('falls back to title matching for plans that predate the registry', () => {
    const items = [
      { id: 'lesson-uuid', type: 'lesson', title: 'Introducción', sectionId: 'sec-uuid', hasNoteContent: true },
      { id: 'ex-uuid', type: 'exercise', title: 'Autoevaluación', sectionId: 'sec-uuid', questionCount: 4 }
    ];

    const progress = buildPlanProgressAnchor(plan, sections, items);

    expect(progress?.pendingCount).toBe(0);
    expect(progress?.emptyCount).toBe(0);
    // Completeness is read from the counts now; a finished plan injects no text.
    expect(progress?.anchorText).toBe('');
  });

  it('counts sections in the totals so the UI percentage covers the whole plan', () => {
    const items = [
      { id: 'lesson-uuid', type: 'lesson', title: 'Introducción', sectionId: 'sec-uuid', hasNoteContent: true },
      { id: 'ex-uuid', type: 'exercise', title: 'Autoevaluación', sectionId: 'sec-uuid', questionCount: 4 }
    ];

    const progress = buildPlanProgressAnchor(
      plan,
      sections,
      items,
      registry([
        { key: 's1.1', entityId: 'lesson-uuid' },
        { key: 's1.2', entityId: 'ex-uuid' }
      ])
    );

    // 1 section + 2 items.
    expect(progress?.total).toBe(3);
    expect(progress?.completed).toBe(3);
  });

  it('returns undefined when there is no plan to anchor against', () => {
    expect(buildPlanProgressAnchor(undefined, sections, [], [])).toBeUndefined();
  });
});

/**
 * Section ORDER.
 *
 * A teacher asked for the final exam to close the course. The agent replied with
 * the corrected list, ticked it, and called no tool at all — the log for that turn
 * reads `toolCalls=[NONE]`. Nothing contradicted it, because the anchor only ever
 * checked that items EXIST and have content. These lock the order check that does.
 */
describe('buildPlanProgressAnchor — section order', () => {
  const orderedPlan = {
    title: 'Estadística aplicada',
    sections: [
      { title: 'Teoría de la Decisión', order: 0, items: [] },
      { title: 'Examen Final', order: 1, items: [] }
    ]
  };

  const orderRegistry: PlanRegistryEntry[] = [
    { key: 's1', kind: 'section', title: 'Teoría de la Decisión', sectionKey: null, position: 0, entityId: 'dec-uuid' },
    { key: 's2', kind: 'section', title: 'Examen Final', sectionKey: null, position: 1, entityId: 'exam-uuid' }
  ];

  it('flags sections that sit in a different position than the plan', () => {
    const progress = buildPlanProgressAnchor(
      orderedPlan,
      [
        { id: 'exam-uuid', title: 'Examen Final', order: 6 },
        { id: 'dec-uuid', title: 'Teoría de la Decisión', order: 7 }
      ],
      [],
      orderRegistry
    );

    expect(progress?.misorderedCount).toBe(1);
    expect(progress?.anchorText).toContain('Section order does NOT match the plan');
    expect(progress?.anchorText).toContain('reorder_content');
  });

  it('is silent when the course already matches plan order', () => {
    const progress = buildPlanProgressAnchor(
      orderedPlan,
      [
        { id: 'dec-uuid', title: 'Teoría de la Decisión', order: 6 },
        { id: 'exam-uuid', title: 'Examen Final', order: 7 }
      ],
      [],
      orderRegistry
    );

    expect(progress?.misorderedCount).toBe(0);
    expect(progress?.anchorText).not.toContain('Section order does NOT match');
  });

  it('reads the order column rather than trusting row arrival order', () => {
    // getCourseSectionsByCourseId has no ORDER BY, so the rows can arrive in any
    // order. Correct sections listed "backwards" must NOT be reported as wrong.
    const progress = buildPlanProgressAnchor(
      orderedPlan,
      [
        { id: 'exam-uuid', title: 'Examen Final', order: 7 },
        { id: 'dec-uuid', title: 'Teoría de la Decisión', order: 6 }
      ],
      [],
      orderRegistry
    );

    expect(progress?.misorderedCount).toBe(0);
  });

  it('tolerates gaps in the order numbering', () => {
    // Deleting a section leaves a hole; only the relative sequence matters.
    const progress = buildPlanProgressAnchor(
      orderedPlan,
      [
        { id: 'dec-uuid', title: 'Teoría de la Decisión', order: 2 },
        { id: 'exam-uuid', title: 'Examen Final', order: 40 }
      ],
      [],
      orderRegistry
    );

    expect(progress?.misorderedCount).toBe(0);
  });

  it('does not drive the continue button, which stays on missing/empty work', () => {
    const progress = buildPlanProgressAnchor(
      orderedPlan,
      [
        { id: 'exam-uuid', title: 'Examen Final', order: 6 },
        { id: 'dec-uuid', title: 'Teoría de la Decisión', order: 7 }
      ],
      [],
      orderRegistry
    );

    // A wrong order the model cannot fix would otherwise spin rounds forever.
    expect(progress?.pendingCount).toBe(0);
    expect(progress?.emptyCount).toBe(0);
  });
});

/**
 * A finished build must stop talking.
 *
 * The anchor is gated only on "has a plan ever been approved in this
 * conversation", so it rides along on every later turn. While work remains that
 * is the point. Once everything is built it used to keep announcing, under a
 * heading reading "source of truth", that the course matched the plan and there
 * was nothing to do — and that outranked whatever the teacher had just asked.
 * Observed: a request for an illustration answered with build status, twice, and
 * then the answer to the model's own follow-up question answered with build
 * status again.
 */
describe('buildPlanProgressAnchor — completed plan', () => {
  const builtItems = [
    { id: 'lesson-uuid', type: 'lesson', title: 'Introducción', sectionId: 'sec-uuid', hasNoteContent: true },
    { id: 'ex-uuid', type: 'exercise', title: 'Autoevaluación', sectionId: 'sec-uuid', questionCount: 4 }
  ];

  const builtRegistry = registry([
    { key: 's1.1', entityId: 'lesson-uuid' },
    { key: 's1.2', entityId: 'ex-uuid' }
  ]);

  it('injects nothing once every item is built', () => {
    const progress = buildPlanProgressAnchor(plan, sections, builtItems, builtRegistry);

    // Empty, not merely reworded: the caller skips injection on a falsy string.
    expect(progress?.anchorText).toBe('');
  });

  it('still reports progress, so the UI checklist keeps working', () => {
    const progress = buildPlanProgressAnchor(plan, sections, builtItems, builtRegistry);

    expect(progress?.pendingCount).toBe(0);
    expect(progress?.emptyCount).toBe(0);
    expect(progress?.completed).toBe(progress?.total);
  });

  it('keeps speaking while anything is still missing', () => {
    const progress = buildPlanProgressAnchor(plan, sections, [], registry());

    expect(progress?.anchorText).toContain('YOU ARE NOT DONE');
  });
});

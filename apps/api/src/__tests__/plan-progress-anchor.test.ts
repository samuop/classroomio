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
    const progress = buildPlanProgressAnchor(
      plan,
      sections,
      [],
      registry([{ key: 's1.1', entityId: 'deleted-uuid' }])
    );

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
    expect(progress?.anchorText).toContain('Every item in the approved plan is present');
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

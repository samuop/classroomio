/**
 * When the build checklist is worth drawing.
 *
 * Reported from production: a finished 49/49 course kept repeating all 49 rows
 * under every later answer, including ordinary edit chat, because the progress
 * anchor is measured on every round for as long as an approved plan exists.
 */
import { describe, expect, it } from 'vitest';

import { isChecklistWorthShowing } from '@api/services/agent/chat-context';
import type { PlanProgress } from '@api/services/agent/chat-context';

function progress(overrides: Partial<PlanProgress> = {}): PlanProgress {
  return {
    anchorText: '',
    items: [],
    total: 49,
    completed: 49,
    pendingCount: 0,
    emptyCount: 0,
    misorderedCount: 0,
    ...overrides
  } as PlanProgress;
}

describe('isChecklistWorthShowing', () => {
  it('stays quiet on a later message once the plan is complete', () => {
    expect(isChecklistWorthShowing(progress(), 49)).toBe(false);
  });

  it('still announces the round that reaches 100%', () => {
    expect(isChecklistWorthShowing(progress({ completed: 49 }), 48)).toBe(true);
  });

  it('shows while items are still missing', () => {
    expect(isChecklistWorthShowing(progress({ completed: 30, pendingCount: 19 }), 30)).toBe(true);
  });

  it('shows while items exist but are empty shells', () => {
    expect(isChecklistWorthShowing(progress({ completed: 40, emptyCount: 9 }), 40)).toBe(true);
  });

  it('treats a round with nothing to compare against as news', () => {
    expect(isChecklistWorthShowing(progress(), undefined)).toBe(true);
  });

  it('shows a count that went BACKWARDS — a deletion is news too', () => {
    expect(isChecklistWorthShowing(progress({ completed: 47, total: 47 }), 49)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { getWorkspaceAllowance, resolveWorkspaceAllowance } from '@cio/utils/plans';

import { PLAN } from '@cio/utils/plans';

/**
 * A consultancy opens one workspace per client company, so the Enterprise
 * allowance is uncapped and spelled `null`. That makes the table hold two
 * different kinds of absence, and the daily over-allowance sweep reads the same
 * table to decide whose workspaces get locked read-only — so confusing them is
 * not a display bug, it is every client of every consultancy going read-only.
 */
describe('workspace allowance', () => {
  it('reports Enterprise as uncapped', () => {
    expect(getWorkspaceAllowance(PLAN.ENTERPRISE)).toBeNull();
  });

  it('caps the plans that are meant to be capped', () => {
    expect(getWorkspaceAllowance(PLAN.BASIC)).toBe(1);
    expect(getWorkspaceAllowance(PLAN.EARLY_ADOPTER)).toBe(1);
  });

  it('treats an unknown plan as the minimum rather than as uncapped', () => {
    expect(getWorkspaceAllowance('SOMETHING_ELSE')).toBe(1);
    expect(getWorkspaceAllowance(null)).toBe(1);
    expect(getWorkspaceAllowance(undefined)).toBe(1);
  });

  it('keeps "uncapped" and "unknown plan" apart', () => {
    const table = { UNCAPPED: null, CAPPED: 3 };

    expect(resolveWorkspaceAllowance(table, 'UNCAPPED')).toBeNull();
    expect(resolveWorkspaceAllowance(table, 'CAPPED')).toBe(3);
    expect(resolveWorkspaceAllowance(table, 'NEVER_HEARD_OF_IT')).toBe(1);
  });

  it('never counts an uncapped account as over its allowance', () => {
    // The predicate the sweep applies, with the shape it applies it to.
    const isOffender = (planName: string, workspaces: number) => {
      const allowance = getWorkspaceAllowance(planName);
      return allowance !== null && workspaces > allowance;
    };

    expect(isOffender(PLAN.ENTERPRISE, 2)).toBe(false);
    expect(isOffender(PLAN.ENTERPRISE, 500)).toBe(false);
    expect(isOffender(PLAN.BASIC, 1)).toBe(false);
    expect(isOffender(PLAN.BASIC, 2)).toBe(true);
  });
});

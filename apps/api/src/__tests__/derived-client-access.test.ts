import { describe, expect, it } from 'vitest';

import { ROLE } from '@cio/utils/constants';
import { orgIdsAdministeredBy } from '@cio/db/queries/organization';

/**
 * A consultancy's client companies hang off it as child organizations, and
 * access flows down: administering the consultancy means administering its
 * clients. That grant is derived from the role map rather than written as
 * membership rows, so it disappears the moment someone stops being an admin
 * instead of outliving them.
 *
 * `orgIdsAdministeredBy` is the gate the whole derivation hangs off. Everything
 * a consultancy's clients hold — their learners, their results, their people —
 * is reachable to whoever this function names, so the interesting cases are the
 * ones it must refuse.
 */
describe('derived access to client companies', () => {
  it('names the organizations the person administers', () => {
    const roles = { egea: ROLE.ADMIN, otra: ROLE.ADMIN };

    expect(orgIdsAdministeredBy(roles).sort()).toEqual(['egea', 'otra']);
  });

  it('refuses a tutor: teaching for a consultancy is not administering its clients', () => {
    const roles = { egea: ROLE.TUTOR };

    expect(orgIdsAdministeredBy(roles)).toEqual([]);
  });

  it('refuses a student', () => {
    const roles = { egea: ROLE.STUDENT };

    expect(orgIdsAdministeredBy(roles)).toEqual([]);
  });

  it('picks out only the administered ones from a mixed map', () => {
    const roles = {
      egea: ROLE.ADMIN,
      'donde-soy-tutor': ROLE.TUTOR,
      'donde-estudio': ROLE.STUDENT
    };

    expect(orgIdsAdministeredBy(roles)).toEqual(['egea']);
  });

  it('names nothing for someone who belongs nowhere', () => {
    expect(orgIdsAdministeredBy({})).toEqual([]);
  });

  it('does not treat an unknown role number as administrative', () => {
    // Guards the shape of the check: `!== STUDENT` or a truthiness test would
    // hand a future role the keys to every client company.
    const roles = { egea: 99 };

    expect(orgIdsAdministeredBy(roles)).toEqual([]);
  });
});

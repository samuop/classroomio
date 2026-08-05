import { describe, expect, it } from 'vitest';

import { ROLE } from '@cio/utils/constants';
import { assertCourseDeliveryAllowed } from '@api/services/course/delivery-auth';

/**
 * Copying a course names two organizations that the membership middleware never
 * sees: the one the course lives in and the one the copy lands in, both taken
 * from the payload. The middleware only proves the caller belongs to whatever
 * organization the request declares in its header, so without this check a
 * member of any organization could copy a course they cannot see into a company
 * they have nothing to do with — between a consultancy's client companies, one
 * client's material appearing inside another's.
 */
describe('authorizing a course delivery', () => {
  const EGEA = 'egea';
  const ONE = 'one';
  const OTHER_CONSULTANCY = 'otra';

  it('allows an admin to deliver their own course into a client company', () => {
    const roles = { [EGEA]: ROLE.ADMIN, [ONE]: ROLE.ADMIN };

    expect(() => assertCourseDeliveryAllowed(roles, EGEA, ONE)).not.toThrow();
  });

  it('allows copying a course beside itself', () => {
    const roles = { [EGEA]: ROLE.ADMIN };

    expect(() => assertCourseDeliveryAllowed(roles, EGEA, EGEA)).not.toThrow();
  });

  it('refuses a course from an organization the caller does not belong to', () => {
    const roles = { [EGEA]: ROLE.ADMIN };

    expect(() => assertCourseDeliveryAllowed(roles, OTHER_CONSULTANCY, EGEA)).toThrow(/not found/i);
  });

  it('says "not found" rather than "forbidden" about a course that is not theirs', () => {
    // Whether a course exists is not something a stranger to its organization
    // should be able to learn from the difference between two errors.
    const roles = { [EGEA]: ROLE.ADMIN };

    expect(() => assertCourseDeliveryAllowed(roles, OTHER_CONSULTANCY, EGEA)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('refuses a destination the caller has nothing to do with', () => {
    const roles = { [EGEA]: ROLE.ADMIN };

    expect(() => assertCourseDeliveryAllowed(roles, EGEA, 'empresa-ajena')).toThrow(/admin of the destination/i);
  });

  it('refuses a tutor of the destination: delivering is administrative there', () => {
    const roles = { [EGEA]: ROLE.ADMIN, [ONE]: ROLE.TUTOR };

    expect(() => assertCourseDeliveryAllowed(roles, EGEA, ONE)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('refuses a student of the destination', () => {
    const roles = { [EGEA]: ROLE.ADMIN, [ONE]: ROLE.STUDENT };

    expect(() => assertCourseDeliveryAllowed(roles, EGEA, ONE)).toThrow(/admin of the destination/i);
  });

  it('lets a tutor of the source deliver where they are admin', () => {
    // Reading the source is enough to copy from it; the restriction that
    // matters is on where the copy lands.
    const roles = { [EGEA]: ROLE.TUTOR, [ONE]: ROLE.ADMIN };

    expect(() => assertCourseDeliveryAllowed(roles, EGEA, ONE)).not.toThrow();
  });

  it('refuses a course whose organization cannot be resolved', () => {
    expect(() => assertCourseDeliveryAllowed({ [EGEA]: ROLE.ADMIN }, null, EGEA)).toThrow(/not found/i);
  });
});

/**
 * The issue date printed on the certificate.
 *
 * It was pinned to `en-US`, so every certificate this deployment issues — all
 * of them in Spanish — carried "March 15, 2026" in the middle of Spanish text.
 * The date is generated server-side both for the editor's download and for real
 * issuance, and issuance has no browser to ask for a locale, so this is an
 * operator setting rather than a per-request one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formatCertificateDate } from '@api/services/course/certificate';

const date = new Date('2026-03-15T12:00:00Z');

afterEach(() => {
  delete process.env.CERTIFICATE_DATE_LOCALE;
});

describe('formatCertificateDate', () => {
  it('writes the date in Spanish by default', () => {
    const formatted = formatCertificateDate(date);

    expect(formatted).toContain('marzo');
    expect(formatted).toContain('2026');
    expect(formatted).not.toContain('March');
  });

  it('honours an operator override', () => {
    process.env.CERTIFICATE_DATE_LOCALE = 'en-US';

    expect(formatCertificateDate(date)).toContain('March');
  });

  it('falls back rather than failing issuance on a bad locale', () => {
    // A typo in the environment must not stop certificates going out.
    process.env.CERTIFICATE_DATE_LOCALE = 'not a locale';

    expect(formatCertificateDate(date)).toContain('marzo');
  });

  it('does not pad the day, which reads as a serial number in Spanish', () => {
    // "05 de marzo" is how a reference number is written, not a date.
    expect(formatCertificateDate(new Date('2026-03-05T12:00:00Z'))).not.toMatch(/\b05\b/);
  });
});

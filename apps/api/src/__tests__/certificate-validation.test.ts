/**
 * What survives the trip from the editor to the database.
 *
 * Zod strips unknown keys without complaining, so a design field missing from
 * `ZCertificateDesign` is accepted by the API, dropped before the write, and
 * reported back to the teacher as saved. That is precisely how the editable
 * wording shipped broken end to end: the editor sent `labels`, the success
 * toast appeared, and the column never held it.
 *
 * These tests exist so the next field added to the certificate design cannot
 * repeat it silently.
 */
import { describe, expect, it } from 'vitest';
import { ZCertificateDesign, ZCourseUpdate } from '@cio/utils/validation/course';

const baseDesign = {
  templateId: 'classique' as const,
  accentColor: '#7a1f1f',
  signatories: [
    { name: 'Responsable del curso', role: 'Facilitador' },
    { name: 'Dirección', role: 'Director' }
  ] as [{ name: string; role: string }, { name: string; role: string }]
};

describe('ZCertificateDesign', () => {
  it('keeps the custom wording instead of stripping it', () => {
    const parsed = ZCertificateDesign.parse({
      ...baseDesign,
      labels: { presented: 'dejamos constancia de que', seal: 'Certificado' }
    });

    expect(parsed.labels).toEqual({ presented: 'dejamos constancia de que', seal: 'Certificado' });
  });

  it('keeps a deliberately cleared label', () => {
    // Empty means "print nothing here" — omitting the key is what falls back to
    // the default. Collapsing the two would make the field impossible to clear.
    const parsed = ZCertificateDesign.parse({ ...baseDesign, labels: { seal: '' } });

    expect(parsed.labels?.seal).toBe('');
  });

  it('rejects a label longer than the layout can hold', () => {
    const result = ZCertificateDesign.safeParse({
      ...baseDesign,
      labels: { presented: 'a'.repeat(121) }
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-string label rather than passing it to a template', () => {
    const result = ZCertificateDesign.safeParse({ ...baseDesign, labels: { presented: 42 } });

    expect(result.success).toBe(false);
  });

  it('still accepts a design with no labels at all', () => {
    expect(ZCertificateDesign.parse(baseDesign).labels).toBeUndefined();
  });
});

describe('ZCourseUpdate', () => {
  it('carries the wording through the whole update body, not just the leaf schema', () => {
    // The leaf schema accepting `labels` is not enough: the field travels nested
    // inside `certificate.design`, and every wrapper strips unknown keys too.
    const parsed = ZCourseUpdate.parse({
      certificate: {
        isDownloadable: true,
        design: { ...baseDesign, labels: { awardedTo: 'Se otorga a' } }
      }
    });

    expect(parsed.certificate?.design?.labels?.awardedTo).toBe('Se otorga a');
  });
});

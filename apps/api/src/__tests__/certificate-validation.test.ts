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

describe('ZCertificateDesign — canvas document', () => {
  const textElement = {
    kind: 'text' as const,
    id: 'title',
    x: 100,
    y: 100,
    w: 600,
    h: 80,
    content: '{{recipientName}}',
    fit: 'shrink' as const,
    style: {
      fontFamily: 'Space Grotesk',
      fontSize: 40,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      color: '#111111',
      align: 'center' as const,
      verticalAlign: 'middle' as const
    }
  };

  const withDocument = (elements: unknown[]) => ({
    ...baseDesign,
    document: { version: 2, canvas: { color: '#ffffff' }, elements }
  });

  it('accepts a canvas layout and keeps it', () => {
    const parsed = ZCertificateDesign.parse(withDocument([textElement]));

    expect(parsed.document?.elements).toHaveLength(1);
  });

  it('keeps the client brand — the second mark on the certificate', () => {
    const parsed = ZCertificateDesign.parse({
      ...baseDesign,
      clientBrand: { name: 'Industrias del Sur', logoUrl: 'https://learn-files.tensor.com.ar/c.png' }
    });

    expect(parsed.clientBrand?.name).toBe('Industrias del Sur');
  });

  /**
   * Zod strips what it does not declare, without complaining. A design field
   * missing from this schema is accepted by the API, dropped before the write,
   * and reported back to the teacher as saved — which is how `labels` was
   * broken end to end for as long as it existed.
   */
  it('keeps every field the editor writes, rather than quietly dropping one', () => {
    const parsed = ZCertificateDesign.parse({
      ...baseDesign,
      titleOverride: 'Inducción SSMA 2026',
      orgBrand: { name: 'Consultora', logoUrl: 'https://learn-files.tensor.com.ar/consultora.svg' },
      clientBrand: { name: 'Kisoco One', logoUrl: 'https://learn-files.tensor.com.ar/kisoco.svg' },
      brandLogoHeight: 56,
      labels: { deliveredBy: 'Dictado por', deliveredFor: 'Para' }
    });

    expect(parsed.titleOverride).toBe('Inducción SSMA 2026');
    expect(parsed.orgBrand?.logoUrl).toBe('https://learn-files.tensor.com.ar/consultora.svg');
    expect(parsed.clientBrand?.logoUrl).toBe('https://learn-files.tensor.com.ar/kisoco.svg');
    expect(parsed.brandLogoHeight).toBe(56);
    expect(parsed.labels?.deliveredBy).toBe('Dictado por');
    expect(parsed.labels?.deliveredFor).toBe('Para');
  });

  it('rejects a logo height that would erase the certificate under it', () => {
    expect(ZCertificateDesign.safeParse({ ...baseDesign, brandLogoHeight: 4000 }).success).toBe(false);
  });

  it('rejects a javascript: url on the org mark, not just the client one', () => {
    const result = ZCertificateDesign.safeParse({
      ...baseDesign,
      orgBrand: { logoUrl: 'javascript:alert(1)' }
    });

    expect(result.success).toBe(false);
  });

  it('rejects a javascript: image url', () => {
    // These URLs are written into HTML that a real browser renders on the
    // platform's behalf, so anything but http(s) is a script-injection vector.
    const result = ZCertificateDesign.safeParse(
      withDocument([
        {
          kind: 'image',
          id: 'i',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          fit: 'contain',
          source: { kind: 'upload', url: 'javascript:alert(1)' }
        }
      ])
    );

    expect(result.success).toBe(false);
  });

  it('rejects a data: url too', () => {
    const result = ZCertificateDesign.safeParse({
      ...baseDesign,
      clientBrand: { logoUrl: 'data:text/html,<script>alert(1)</script>' }
    });

    expect(result.success).toBe(false);
  });

  it('rejects a colour that is not a hex value', () => {
    const result = ZCertificateDesign.safeParse({
      ...baseDesign,
      document: { version: 2, canvas: { color: 'url(javascript:alert(1))' }, elements: [] }
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown element kind rather than storing it for the renderer to meet later', () => {
    const result = ZCertificateDesign.safeParse(withDocument([{ ...textElement, kind: 'iframe' }]));

    expect(result.success).toBe(false);
  });

  it('caps the element count, so one row cannot produce a render that never ends', () => {
    const result = ZCertificateDesign.safeParse(
      withDocument(Array.from({ length: 201 }, (_, i) => ({ ...textElement, id: `t${i}` })))
    );

    expect(result.success).toBe(false);
  });

  it('rejects a document claiming a version this renderer does not know', () => {
    const result = ZCertificateDesign.safeParse({
      ...baseDesign,
      document: { version: 3, canvas: { color: '#ffffff' }, elements: [] }
    });

    expect(result.success).toBe(false);
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

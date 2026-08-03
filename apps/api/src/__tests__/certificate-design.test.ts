/**
 * Turning the stored certificate JSONB back into a renderable design.
 *
 * This is the only path between what a teacher saved and the file a student
 * receives, and it silently dropped `labels`: the editor preview renders from
 * its own in-memory store, so the custom wording looked right on screen and
 * then came out of the PDF as the factory defaults.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CERTIFICATE_DESIGN } from '@cio/certificates';
import { resolveCertificateDesign } from '@api/utils/certificate';

describe('resolveCertificateDesign', () => {
  it('carries the custom wording through to the renderer', () => {
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', labels: { presented: 'dejamos constancia de que' } }
    });

    expect(design.labels?.presented).toBe('dejamos constancia de que');
  });

  it('keeps a cleared label, which means "print nothing" rather than "use the default"', () => {
    const design = resolveCertificateDesign({ design: { templateId: 'noir', labels: { seal: '' } } });

    expect(design.labels?.seal).toBe('');
  });

  it('leaves labels undefined when the course never customised any', () => {
    const design = resolveCertificateDesign({ design: { templateId: 'minimal' } });

    expect(design.labels).toBeUndefined();
  });

  it('discards junk from the JSONB column instead of handing it to a template', () => {
    // The column is untrusted input: a non-string value reaching a template
    // would be interpolated into HTML as "[object Object]".
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', labels: { presented: { evil: true }, issued: 42, unknownKey: 'x' } }
    });

    expect(design.labels).toBeUndefined();
  });

  it('caps a label at a length the layout can actually hold', () => {
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', labels: { presented: 'a'.repeat(500) } }
    });

    expect(design.labels?.presented).toHaveLength(120);
  });

  it('still falls back to the defaults for a course with no stored design', () => {
    const design = resolveCertificateDesign(undefined);

    expect(design.templateId).toBe(DEFAULT_CERTIFICATE_DESIGN.templateId);
    expect(design.labels).toBeUndefined();
  });

  it('maps a legacy theme id onto its replacement template', () => {
    expect(resolveCertificateDesign({ theme: 'purpleBadgePattern' }).templateId).toBe('poster');
  });

  it('rejects an accent colour that is not a hex triplet', () => {
    const design = resolveCertificateDesign({ design: { accentColor: 'javascript:alert(1)' } });

    expect(design.accentColor).toBe(DEFAULT_CERTIFICATE_DESIGN.accentColor);
  });

  it('carries the canvas layout through to the renderer', () => {
    const document = { version: 2, canvas: { color: '#ffffff' }, elements: [] };
    const design = resolveCertificateDesign({ design: { templateId: 'classique', document } });

    expect(design.document).toEqual(document);
  });

  it('carries the client brand — the second mark on the certificate', () => {
    const design = resolveCertificateDesign({
      design: {
        templateId: 'classique',
        clientBrand: { name: 'Industrias del Sur', logoUrl: 'https://learn-files.tensor.com.ar/c.png' }
      }
    });

    expect(design.clientBrand).toEqual({
      name: 'Industrias del Sur',
      logoUrl: 'https://learn-files.tensor.com.ar/c.png'
    });
  });

  it('drops a client logo url that is not http(s)', () => {
    // Last gate before the URL becomes an <img src> that a real browser
    // resolves. Rows predate the schema that now rejects these on write.
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', clientBrand: { name: 'X', logoUrl: 'javascript:alert(1)' } }
    });

    expect(design.clientBrand?.logoUrl).toBeUndefined();
    expect(design.clientBrand?.name).toBe('X');
  });

  it('leaves the client brand undefined when nothing usable is stored', () => {
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', clientBrand: { logoUrl: 'ftp://nope' } }
    });

    expect(design.clientBrand).toBeUndefined();
  });

  /**
   * This function rebuilds the design field by field, so anything it does not
   * name is dropped between the database and the renderer — silently, and after
   * a success toast. That is exactly how `labels` shipped broken. Every field
   * the editor can write gets a line here.
   */
  it('carries every design field the editor can write', () => {
    const design = resolveCertificateDesign({
      design: {
        templateId: 'classique',
        titleOverride: 'Inducción SSMA 2026',
        orgBrand: { name: 'Egea', logoUrl: 'https://learn-files.tensor.com.ar/egea.svg' },
        clientBrand: { name: 'Kisoco One', logoUrl: 'https://learn-files.tensor.com.ar/kisoco.svg' },
        brandLogoHeight: 56,
        labels: { deliveredBy: 'Dictado por', deliveredFor: 'Para' }
      }
    });

    expect(design.titleOverride).toBe('Inducción SSMA 2026');
    expect(design.orgBrand).toEqual({ name: 'Egea', logoUrl: 'https://learn-files.tensor.com.ar/egea.svg' });
    expect(design.clientBrand?.name).toBe('Kisoco One');
    expect(design.brandLogoHeight).toBe(56);
    expect(design.labels?.deliveredBy).toBe('Dictado por');
    expect(design.labels?.deliveredFor).toBe('Para');
  });

  it('drops an org logo url that is not http(s), same as the client one', () => {
    const design = resolveCertificateDesign({
      design: { templateId: 'classique', orgBrand: { name: 'Egea', logoUrl: 'javascript:alert(1)' } }
    });

    expect(design.orgBrand?.logoUrl).toBeUndefined();
    expect(design.orgBrand?.name).toBe('Egea');
  });
});

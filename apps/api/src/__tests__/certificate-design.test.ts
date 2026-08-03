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
});

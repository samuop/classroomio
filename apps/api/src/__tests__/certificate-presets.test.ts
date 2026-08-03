/**
 * The canvas a teacher lands on when they switch a course to free layout.
 *
 * A blank rectangle would be a terrible starting point, so the preset recreates
 * the template the course was already using and carries the teacher's own
 * content into it. These tests check the two things that would make that
 * promise hollow: that the seeded document is actually renderable, and that it
 * survives the validator on its way to the database.
 */
import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_TEMPLATE_IDS,
  DEFAULT_CERTIFICATE_DESIGN,
  buildPresetDocument,
  renderDocument,
  type CertificateDesign,
  type CertificateRenderData
} from '@cio/certificates';
import { ZCertificateDocument } from '@cio/utils/validation/course';

const data: CertificateRenderData = {
  recipientName: 'Ana Ruiz',
  courseName: 'Probabilidad y Estadística',
  courseDescription: 'Curso introductorio de probabilidad.',
  orgName: 'Tensor Tech',
  orgLogoUrl: 'https://learn-files.tensor.com.ar/media/tensor.png',
  date: '15 de septiembre de 2026',
  certificateId: 'N° 0148'
};

const designFor = (templateId: CertificateDesign['templateId']): CertificateDesign => ({
  ...DEFAULT_CERTIFICATE_DESIGN,
  templateId,
  signatories: [
    { name: 'Laura Gómez', role: 'Facilitadora' },
    { name: 'Martín Díaz', role: 'Director' }
  ]
});

describe('buildPresetDocument', () => {
  it.each(CERTIFICATE_TEMPLATE_IDS)('produces a valid document for %s', (templateId) => {
    // Straight through the schema that guards the write: a preset the API would
    // reject is a preset no teacher could ever save.
    const result = ZCertificateDocument.safeParse(buildPresetDocument(designFor(templateId)));

    expect(result.success).toBe(true);
  });

  it.each(CERTIFICATE_TEMPLATE_IDS)('renders %s without any element overflowing at normal data', (templateId) => {
    const { overflowingElementIds } = renderDocument({
      document: buildPresetDocument(designFor(templateId)),
      data
    });

    expect(overflowingElementIds).toEqual([]);
  });

  it.each(CERTIFICATE_TEMPLATE_IDS)('gives %s both brand slots, ready for a client logo', (templateId) => {
    // The consultancy case is the reason this work exists: switching to the
    // canvas should not mean building the second mark by hand.
    const document = buildPresetDocument(designFor(templateId));
    const sources = document.elements
      .filter((element) => element.kind === 'image')
      .map((element) => (element.kind === 'image' ? element.source.kind : ''));

    expect(sources).toContain('orgLogo');
    expect(sources).toContain('clientLogo');
  });

  it('draws the client logo once a course sets one', () => {
    const { body } = renderDocument({
      document: buildPresetDocument(designFor('classique')),
      data,
      clientBrand: { name: 'Industrias del Sur', logoUrl: 'https://learn-files.tensor.com.ar/media/cliente.png' }
    });

    expect(body).toContain('tensor.png');
    expect(body).toContain('cliente.png');
  });

  it('carries the teacher’s signatories into the canvas', () => {
    const { body } = renderDocument({ document: buildPresetDocument(designFor('classique')), data });

    expect(body).toContain('Laura Gómez');
    expect(body).toContain('Martín Díaz');
  });

  it('carries the accent colour', () => {
    const { styles } = renderDocument({
      document: buildPresetDocument({ ...designFor('noir'), accentColor: '#065f46' }),
      data
    });

    expect(styles).toContain('#065f46');
  });

  it('carries custom wording rather than the factory default', () => {
    const { body } = renderDocument({
      document: buildPresetDocument({
        ...designFor('classique'),
        labels: { presented: 'dejamos constancia de que' }
      }),
      data
    });

    expect(body).toContain('dejamos constancia de que');
  });

  it('falls back to a known preset for an unrecognised template id', () => {
    const document = buildPresetDocument({ ...designFor('classique'), templateId: 'nope' as never });

    expect(document.elements.length).toBeGreaterThan(0);
  });

  it.each(CERTIFICATE_TEMPLATE_IDS)('keeps %s inside the canvas under worst-case data', (templateId) => {
    // The whole point of the fit contract: the layout must survive the longest
    // name and title a real course could produce, not just the sample data.
    const { overflowingElementIds } = renderDocument({
      document: buildPresetDocument(designFor(templateId)),
      data: {
        ...data,
        recipientName: 'María de los Ángeles Fernández Etchegaray',
        courseName: 'Fundamentos de Probabilidad y Estadística Aplicada a la Gestión de Procesos Industriales'
      }
    });

    expect(overflowingElementIds).toEqual([]);
  });
});

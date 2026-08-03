/**
 * Rendering a canvas document, and not breaking the five layouts that already
 * issued real certificates.
 *
 * The load-bearing test in this file is the last one: a course that never opens
 * the new editor must keep producing exactly the document it produced before.
 * That is why `renderCertificate` branches on the presence of `document`
 * instead of migrating everything to the new model.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CERTIFICATE_DESIGN,
  renderCertificate,
  renderDocument,
  type CertificateDocument,
  type CertificateRenderData,
  type TextElement
} from '@cio/certificates';

const data: CertificateRenderData = {
  recipientName: 'Ana Ruiz',
  courseName: 'Probabilidad y Estadística',
  courseDescription: 'Curso introductorio.',
  orgName: 'Tensor Tech',
  orgLogoUrl: 'https://learn-files.tensor.com.ar/media/tensor.png',
  date: '15 de septiembre de 2026',
  certificateId: 'N° 0148'
};

const text = (overrides: Partial<TextElement> = {}): TextElement => ({
  kind: 'text',
  id: 'title',
  x: 100,
  y: 100,
  w: 600,
  h: 80,
  content: '{{recipientName}}',
  fit: 'shrink',
  style: {
    fontFamily: 'Space Grotesk',
    fontSize: 40,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#111111',
    align: 'center',
    verticalAlign: 'middle'
  },
  ...overrides
});

const doc = (elements: CertificateDocument['elements']): CertificateDocument => ({
  version: 2,
  canvas: { color: '#ffffff' },
  elements
});

describe('renderDocument — text', () => {
  it('substitutes the binding into the output', () => {
    const { body } = renderDocument({ document: doc([text()]), data });

    expect(body).toContain('Ana Ruiz');
    expect(body).not.toContain('{{recipientName}}');
  });

  it('escapes recipient data, so a name cannot become markup', () => {
    // Substitution runs on the raw template and escaping happens here, once.
    // Get that order wrong and every certificate the course issues carries
    // whatever the student typed into their profile.
    const { body } = renderDocument({
      document: doc([text()]),
      data: { ...data, recipientName: '<img src=x onerror=alert(1)>' }
    });

    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img src=x');
  });

  it('does not escape the design’s own text twice', () => {
    const { body } = renderDocument({ document: doc([text({ content: 'Ana & Luis' })]), data });

    expect(body).toContain('Ana &amp; Luis');
    expect(body).not.toContain('&amp;amp;');
  });

  it('renders at a smaller size when the text does not fit', () => {
    const { styles } = renderDocument({
      document: doc([text({ w: 300, h: 50, content: 'María de los Ángeles Fernández Etchegaray' })]),
      data
    });

    const size = Number(/font-size: (\d+)px/.exec(styles)?.[1]);
    expect(size).toBeLessThan(40);
  });

  it('clamps lines instead of shrinking when asked to', () => {
    const { styles } = renderDocument({
      document: doc([
        text({ fit: 'clamp', maxLines: 2, h: 120, content: '{{courseDescription}}' })
      ]),
      data: { ...data, courseDescription: 'Un programa largo '.repeat(20) }
    });

    expect(styles).toContain('-webkit-line-clamp: 2');
    expect(styles).toContain('font-size: 40px');
  });

  it('reports which elements overflowed, so the editor can warn', () => {
    const result = renderDocument({
      document: doc([text({ id: 'too-small', w: 40, h: 20, minFontSize: 20, content: 'un texto muy largo para esto' })]),
      data
    });

    expect(result.overflowingElementIds).toEqual(['too-small']);
  });

  it('builds selectors from the element index, never from stored ids', () => {
    // An id comes out of a JSONB column; using it in a selector would make the
    // stylesheet an injection site.
    const { styles } = renderDocument({
      document: doc([text({ id: 'x { } .cert { display: none } .y' })]),
      data
    });

    expect(styles).toContain('.el-0');
    expect(styles).not.toContain('display: none');
  });
});

describe('renderDocument — images and the two brands', () => {
  const logo = (id: string, kind: 'orgLogo' | 'clientLogo') =>
    ({ kind: 'image' as const, id, x: 0, y: 0, w: 120, h: 60, source: { kind }, fit: 'contain' as const });

  it('draws both marks when both are available', () => {
    const { body } = renderDocument({
      document: doc([logo('org', 'orgLogo'), logo('client', 'clientLogo')]),
      data,
      clientBrand: { name: 'Industrias del Sur', logoUrl: 'https://learn-files.tensor.com.ar/media/cliente.png' }
    });

    expect(body).toContain('tensor.png');
    expect(body).toContain('cliente.png');
  });

  it('omits a logo with no source instead of printing a broken image', () => {
    const { body } = renderDocument({ document: doc([logo('client', 'clientLogo')]), data });

    expect(body).not.toContain('<img');
  });

  it('resolves the org logo from the render data, so changing it updates old designs', () => {
    const { body } = renderDocument({
      document: doc([logo('org', 'orgLogo')]),
      data: { ...data, orgLogoUrl: 'https://learn-files.tensor.com.ar/media/nuevo.png' }
    });

    expect(body).toContain('nuevo.png');
  });

  it('escapes an image url', () => {
    const { body } = renderDocument({
      document: doc([
        { kind: 'image', id: 'i', x: 0, y: 0, w: 10, h: 10, fit: 'contain', source: { kind: 'upload', url: 'a.png" onerror="alert(1)' } }
      ]),
      data
    });

    expect(body).not.toContain('onerror="alert(1)"');
  });
});

describe('renderDocument — canvas', () => {
  it('paints the background colour', () => {
    const { styles } = renderDocument({
      document: { version: 2, canvas: { color: '#0a0a0a' }, elements: [] },
      data
    });

    expect(styles).toContain('background-color: #0a0a0a');
  });

  it('only adds the border overlay when a border is configured', () => {
    const plain = renderDocument({ document: doc([]), data });
    const bordered = renderDocument({
      document: { version: 2, canvas: { color: '#fff', borderColor: '#d4af37', borderWidth: 3, borderInset: 24 }, elements: [] },
      data
    });

    expect(plain.body).not.toContain('doc-border');
    expect(bordered.body).toContain('doc-border');
    expect(bordered.styles).toContain('inset: 24px');
  });

  it('paints elements in array order, so the last one is on top', () => {
    const { body } = renderDocument({
      document: doc([text({ id: 'under', content: 'ABAJO' }), text({ id: 'over', content: 'ARRIBA' })]),
      data
    });

    expect(body.indexOf('ABAJO')).toBeLessThan(body.indexOf('ARRIBA'));
  });
});

describe('renderCertificate — branching', () => {
  it('uses the canvas renderer when the design carries a document', () => {
    const { html } = renderCertificate(
      { ...DEFAULT_CERTIFICATE_DESIGN, document: doc([text({ content: 'Ana Ruiz' })]) },
      data
    );

    expect(html).toContain('cert doc');
    expect(html).toContain('Ana Ruiz');
  });

  it('leaves a design with no document on the original path, untouched', () => {
    // The guarantee that matters: courses that never open the new editor keep
    // producing the same file, so nothing already issued is invalidated.
    const { html, styles } = renderCertificate(DEFAULT_CERTIFICATE_DESIGN, data);

    expect(html).toContain('t-classique');
    expect(html).not.toContain('cert doc');
    expect(styles).toContain('.t-classique');
  });

  it('renders every legacy template exactly as before', () => {
    for (const templateId of ['classique', 'brutalist', 'noir', 'poster', 'minimal'] as const) {
      const { html } = renderCertificate({ ...DEFAULT_CERTIFICATE_DESIGN, templateId }, data);

      expect(html).toContain(`t-${templateId}`);
      expect(html).not.toContain('cert doc');
    }
  });
});

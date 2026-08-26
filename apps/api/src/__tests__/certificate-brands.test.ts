/**
 * Two marks on one certificate, across all five templates.
 *
 * A consultancy issues the same document under its own name and its client's,
 * and until now no template drew a logo at all: `orgLogoUrl` was carried the
 * whole way to the renderer and never used.
 *
 * The test that matters most here is the first one. Every template had its
 * organisation line replaced by the brand row, and a course with no logos and no
 * client must come out of that unchanged — otherwise the four layouts nobody
 * asked to change would all shift the day this shipped.
 */
import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_TEMPLATE_IDS,
  DEFAULT_BRAND_LOGO_HEIGHT,
  DEFAULT_CERTIFICATE_DESIGN,
  MAX_BRAND_LOGO_HEIGHT,
  renderCertificate,
  type CertificateDesign,
  type CertificateRenderData
} from '@cio/certificates';

const data: CertificateRenderData = {
  recipientName: 'Ana Ruiz',
  courseName: 'Probabilidad y Estadística',
  courseDescription: 'Curso introductorio.',
  orgName: 'Consultora Ejemplo',
  orgLogoUrl: 'https://learn-files.tensor.com.ar/media/consultora.png',
  date: '15 de septiembre de 2026',
  certificateId: 'N° 0148'
};

/** The org avatar is not a design decision, so most cases start without one. */
const plainData: CertificateRenderData = { ...data, orgLogoUrl: undefined };

const design = (overrides: Partial<CertificateDesign> = {}): CertificateDesign => ({
  ...DEFAULT_CERTIFICATE_DESIGN,
  ...overrides
});

const CLIENT = { name: 'Kisoco One', logoUrl: 'https://learn-files.tensor.com.ar/media/kisoco.svg' };

describe('brand row — the unchanged case', () => {
  for (const templateId of CERTIFICATE_TEMPLATE_IDS) {
    it(`${templateId}: prints the organisation as text and draws no image`, () => {
      const { html } = renderCertificate(design({ templateId }), plainData);

      expect(html).toContain('Consultora Ejemplo');
      expect(html).not.toContain('<img');
      // Nothing to separate, so no rule is drawn between one mark and nothing.
      expect(html).not.toContain('brand-divider');
    });
  }
});

describe('brand row — two marks', () => {
  for (const templateId of CERTIFICATE_TEMPLATE_IDS) {
    it(`${templateId}: draws both logos with a rule between them`, () => {
      const { html } = renderCertificate(design({ templateId, clientBrand: CLIENT }), data);

      expect(html).toContain('src="https://learn-files.tensor.com.ar/media/consultora.png"');
      expect(html).toContain('src="https://learn-files.tensor.com.ar/media/kisoco.svg"');
      expect(html).toContain('brand-divider');
    });
  }

  it('falls back to the name when a mark has no logo', () => {
    const { html } = renderCertificate(design({ clientBrand: { name: 'Kisoco One' } }), plainData);

    expect(html).toContain('Kisoco One');
    expect(html).not.toContain('<img');
  });

  it('prints the logo INSTEAD of the name, never both', () => {
    const { html } = renderCertificate(design({ clientBrand: CLIENT }), plainData);

    expect(html).toContain('src="https://learn-files.tensor.com.ar/media/kisoco.svg"');
    // Only as the image's alt text, which is the fallback when it fails to load.
    expect(html).not.toContain('<span class="brand-name">Kisoco One</span>');
    expect(html).toContain('alt="Kisoco One"');
  });

  it('drops the coloured pill on Poster once there is a logo to draw', () => {
    // A transparent logo on a solid accent lozenge is the exact thing the
    // upload was meant to avoid.
    const withLogo = renderCertificate(design({ templateId: 'poster' }), data).html;
    const textOnly = renderCertificate(design({ templateId: 'poster' }), plainData).html;

    expect(textOnly).toContain('class="pill"');
    expect(withLogo).not.toContain('class="pill"');
  });
});

describe('brand captions', () => {
  it('stay off until there are two marks to tell apart', () => {
    const { html } = renderCertificate(design({ labels: { deliveredBy: 'Dictado por' } }), data);

    expect(html).not.toContain('Dictado por');
  });

  it('print once the client is set', () => {
    const { html } = renderCertificate(
      design({ clientBrand: CLIENT, labels: { deliveredBy: 'Dictado por', deliveredFor: 'Para' } }),
      data
    );

    expect(html).toContain('Dictado por');
    expect(html).toContain('Para');
  });

  it('are empty by default, so nothing appears unasked', () => {
    const { html } = renderCertificate(design({ clientBrand: CLIENT }), data);

    expect(html).toContain('brand-divider');
    expect(html).not.toContain('brand-caption');
  });
});

describe('logo height', () => {
  it('defaults without the design saying anything', () => {
    const { html } = renderCertificate(design({ clientBrand: CLIENT }), data);

    expect(html).toContain(`--brand-logo-height:${DEFAULT_BRAND_LOGO_HEIGHT}px`);
  });

  it('clamps a value the schema would never allow through', () => {
    // The design is a JSONB blob; rows predate schemas, and a 4000px logo would
    // simply erase the certificate under it.
    const { html } = renderCertificate(design({ clientBrand: CLIENT, brandLogoHeight: 4000 }), data);

    expect(html).toContain(`--brand-logo-height:${MAX_BRAND_LOGO_HEIGHT}px`);
  });
});

describe('overrides', () => {
  it('replaces the course title everywhere the template prints it', () => {
    // Brutalist prints the course name in its metadata row as well as its
    // title block: an override applied per-slot would leave one certificate
    // saying two different things.
    const { html } = renderCertificate(
      design({ templateId: 'brutalist', titleOverride: 'Inducción SSMA 2026' }),
      plainData
    );

    expect(html).toContain('Inducción SSMA 2026');
    expect(html).not.toContain('Probabilidad y Estadística');
  });

  it('replaces the organisation name and logo', () => {
    const { html } = renderCertificate(
      design({ orgBrand: { name: 'Consultora', logoUrl: 'https://learn-files.tensor.com.ar/media/consultora.svg' } }),
      data
    );

    expect(html).toContain('src="https://learn-files.tensor.com.ar/media/consultora.svg"');
    expect(html).toContain('alt="Consultora"');
    // The workspace avatar loses to the course's own lock-up.
    expect(html).not.toContain('consultora.png');
  });

  it('keeps the workspace values when the override is blank', () => {
    const { html } = renderCertificate(design({ orgBrand: { name: '   ' } }), plainData);

    expect(html).toContain('Consultora Ejemplo');
  });
});

describe('escaping', () => {
  it('escapes a name that would otherwise close the tag it sits in', () => {
    const { html } = renderCertificate(design({ clientBrand: { name: '"><script>alert(1)</script>' } }), plainData);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a logo URL that tries to break out of the src attribute', () => {
    const { html } = renderCertificate(
      design({ clientBrand: { logoUrl: 'https://x.test/a.svg" onerror="alert(1)' } }),
      plainData
    );

    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&quot;');
  });
});

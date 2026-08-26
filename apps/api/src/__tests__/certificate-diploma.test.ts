/**
 * The diploma template.
 *
 * Its reason to exist is an inverted hierarchy — the recipient printed larger
 * than the course — so that is what these tests pin. A change that quietly made
 * the course the hero again would leave a template identical in purpose to
 * `classique`, and nothing else in the suite would notice.
 *
 * The rest is the failure mode every fixed-canvas layout has: text that fits
 * while you are designing it and overflows once a real name arrives.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CERTIFICATE_DESIGN,
  DEFAULT_CERTIFICATE_LABELS,
  renderCertificate,
  type CertificateDesign,
  type CertificateRenderData
} from '@cio/certificates';
import { ZCertificateDesign } from '@cio/utils/validation/course';

const data: CertificateRenderData = {
  recipientName: 'Ana Ruiz',
  courseName: 'Seguridad e Higiene en Planta',
  courseDescription: '40 horas, evaluación final aprobada.',
  orgName: 'Consultora Ejemplo',
  orgLogoUrl: undefined,
  date: '13 de agosto de 2026',
  certificateId: 'N° 0148'
};

const design = (overrides: Partial<CertificateDesign> = {}): CertificateDesign => ({
  ...DEFAULT_CERTIFICATE_DESIGN,
  templateId: 'diploma',
  ...overrides
});

/** `clamp(min, preferred, max)` — the ceiling is what the two sizes are compared on. */
function clampCeiling(styles: string, selector: string): number {
  const rule = styles.split(selector)[1] ?? '';
  const match = rule.match(/font-size:\s*clamp\([^)]*,\s*([\d.]+)px\)/);

  if (!match) throw new Error(`no clamped font-size found for ${selector}`);

  return Number(match[1]);
}

describe('diploma — the person leads', () => {
  it('prints the recipient larger than the course title', () => {
    const { styles } = renderCertificate(design(), data);

    expect(clampCeiling(styles, '.t-diploma .recipient')).toBeGreaterThan(clampCeiling(styles, '.t-diploma .title'));
  });

  it('prints the recipient, the course and the connecting wording', () => {
    const { html } = renderCertificate(design(), data);

    expect(html).toContain('Ana Ruiz');
    expect(html).toContain('Seguridad e Higiene en Planta');
    expect(html).toContain(DEFAULT_CERTIFICATE_LABELS.presented);
    expect(html).toContain(DEFAULT_CERTIFICATE_LABELS.completed);
  });

  it('carries the issue date and the reference at the foot, not in a seal', () => {
    const { html } = renderCertificate(design(), data);

    expect(html).toContain('13 de agosto de 2026');
    expect(html).toContain('N° 0148');
    expect(html).toContain('class="meta"');
    expect(html).not.toContain('class="seal"');
  });
});

describe('diploma — text that does not fit', () => {
  /**
   * Every variable-length field is bounded by a line clamp rather than left to
   * overflow a canvas that cannot grow. A clamp cuts at a line boundary; a flex
   * child that shrinks cuts through the middle of one.
   */
  it.each([
    ['.t-diploma .recipient', 2],
    ['.t-diploma .title', 2],
    ['.t-diploma .description', 2]
  ])('%s is clamped to %i lines', (selector, lines) => {
    const { styles } = renderCertificate(design(), data);
    const rule = styles.split(selector)[1] ?? '';

    expect(rule).toMatch(new RegExp(`-webkit-line-clamp:\\s*${lines}`));
  });

  it('survives a long name, a long course and a long description', () => {
    const { html } = renderCertificate(design(), {
      ...data,
      recipientName: 'María de los Ángeles Fernández Etchegaray de la Serna',
      courseName: 'Programa Integral de Seguridad, Higiene y Cuidado del Medio Ambiente en Plantas Industriales',
      courseDescription:
        'Un párrafo largo que describe el curso con mucho más detalle del que entra en el papel. '.repeat(4)
    });

    // Not truncated in the markup: the cut is a rendering decision, so the
    // document keeps the full name and the browser decides what it can show.
    expect(html).toContain('María de los Ángeles Fernández Etchegaray de la Serna');
    expect(html).not.toContain('…');
  });
});

describe('diploma — reaches the database', () => {
  it('passes the validator that guards the write', () => {
    const result = ZCertificateDesign.safeParse(
      design({ labels: { presented: 'se deja constancia de que', completed: 'aprobó el curso' } })
    );

    expect(result.success).toBe(true);
    // The trap this codebase already fell into once: zod strips unknown keys in
    // silence, so a label the schema does not declare is saved as nothing.
    expect(result.success && result.data.labels?.completed).toBe('aprobó el curso');
  });
});

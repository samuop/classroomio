import {
  DEFAULT_CERTIFICATE_DESIGN,
  DEFAULT_CERTIFICATE_LABELS,
  renderCertificate,
  resolveTemplateId,
  type CertificateDesign,
  type CertificateLabelKey,
  type CertificateLabels,
  type CertificateRenderData
} from '@cio/certificates';

import { getCloudflarePdfBuffer, getCloudflarePngBuffer } from '@api/utils/cloudflare';

export interface CertificateRenderInput {
  design: CertificateDesign;
  data: CertificateRenderData;
}

/**
 * Coerces a stored `course.certificate` JSONB blob (legacy or current) into a
 * complete `CertificateDesign` suitable for `renderCertificate`.
 */
export function resolveCertificateDesign(stored: unknown): CertificateDesign {
  const blob = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const legacyTheme = typeof blob.theme === 'string' ? (blob.theme as string) : undefined;
  const storedDesign =
    blob.design && typeof blob.design === 'object' ? (blob.design as Partial<CertificateDesign>) : undefined;

  const templateId = resolveTemplateId(storedDesign?.templateId ?? legacyTheme);

  const accentColor =
    storedDesign?.accentColor && /^#[0-9a-fA-F]{6}$/.test(storedDesign.accentColor)
      ? storedDesign.accentColor
      : DEFAULT_CERTIFICATE_DESIGN.accentColor;

  const storedSignatories = Array.isArray(storedDesign?.signatories) ? storedDesign?.signatories : undefined;

  const signatories: CertificateDesign['signatories'] = [
    {
      name: storedSignatories?.[0]?.name ?? DEFAULT_CERTIFICATE_DESIGN.signatories[0].name,
      role: storedSignatories?.[0]?.role ?? DEFAULT_CERTIFICATE_DESIGN.signatories[0].role
    },
    {
      name: storedSignatories?.[1]?.name ?? DEFAULT_CERTIFICATE_DESIGN.signatories[1].name,
      role: storedSignatories?.[1]?.role ?? DEFAULT_CERTIFICATE_DESIGN.signatories[1].role
    }
  ];

  return {
    templateId,
    accentColor,
    subtitle: storedDesign?.subtitle ?? DEFAULT_CERTIFICATE_DESIGN.subtitle,
    descriptionOverride: storedDesign?.descriptionOverride,
    signatories,
    idFormat: storedDesign?.idFormat ?? DEFAULT_CERTIFICATE_DESIGN.idFormat,
    labels: sanitizeLabels(storedDesign?.labels)
  };
}

/**
 * The editor's custom wording, on its way to the real document.
 *
 * This function is the ONLY path a stored design takes to the PDF/PNG renderer,
 * and it used to drop `labels` on the floor. The editor preview renders from its
 * own store, so a teacher saw the wording they typed, hit download, and got a
 * file with the defaults back — and so did every student, since the issued
 * certificate goes through here too.
 *
 * Values come out of a JSONB column, so they are untrusted: anything that is not
 * a known key with a string value is discarded rather than passed to the
 * template. Length is capped because these are short lines of chrome, and an
 * unbounded string would simply break the layout it sits in.
 */
const MAX_LABEL_LENGTH = 120;

function sanitizeLabels(stored: unknown): CertificateLabels | undefined {
  if (!stored || typeof stored !== 'object') return undefined;

  const labels: CertificateLabels = {};

  for (const key of Object.keys(DEFAULT_CERTIFICATE_LABELS) as CertificateLabelKey[]) {
    const value = (stored as Record<string, unknown>)[key];

    // An empty string is kept deliberately: `resolveLabels` reads it as "print
    // nothing here", which is not the same as falling back to the default.
    if (typeof value === 'string') labels[key] = value.slice(0, MAX_LABEL_LENGTH);
  }

  return Object.keys(labels).length > 0 ? labels : undefined;
}

export async function generateCertificatePdf(input: CertificateRenderInput) {
  const { html, styles } = renderCertificate(input.design, input.data);

  return getCloudflarePdfBuffer(html, styles);
}

export async function generateCertificatePng(input: CertificateRenderInput) {
  const { html, styles } = renderCertificate(input.design, input.data);

  return getCloudflarePngBuffer(html, styles);
}

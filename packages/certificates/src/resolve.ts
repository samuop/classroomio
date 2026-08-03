/**
 * Turn a stored `course.certificate` blob into a complete design.
 *
 * ── Why this is one function and not four ────────────────────────────────────
 *
 * A design is read out of a JSONB column by rebuilding it field by field, and
 * every place that did its own rebuild forgot a field. The API forgot `labels`,
 * so every teacher who customised the wording got a success toast and a PDF
 * with the defaults. The dashboard's summary card forgot `labels`,
 * `clientBrand`, `orgBrand` and `titleOverride`, so a certificate designed with
 * two marks was shown back to its author with one. Nothing errors, nothing
 * logs; the field is simply not there.
 *
 * A rebuild is unavoidable — the column is untrusted, and a URL out of it ends
 * up in an `<img src>` that Cloudflare's browser resolves on the platform's
 * behalf. What is avoidable is having more than one. Adding a design field
 * means editing THIS function, `ZCertificateDesign`, and the column's
 * `$type<>`, and nothing else.
 */
import { DEFAULT_CERTIFICATE_DESIGN, DEFAULT_CERTIFICATE_LABELS } from './constants';
import { resolveTemplateId } from './render';
import type { CertificateBrand, CertificateDesign, CertificateLabelKey, CertificateLabels } from './types';

/** These are short lines of chrome; an unbounded one just breaks its layout. */
const MAX_LABEL_LENGTH = 120;
const MAX_NAME_LENGTH = 120;
const MAX_TITLE_LENGTH = 160;
const MAX_URL_LENGTH = 2048;

export function resolveCertificateDesign(stored: unknown): CertificateDesign {
  const blob = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const legacyTheme = typeof blob.theme === 'string' ? blob.theme : undefined;
  const design =
    blob.design && typeof blob.design === 'object' ? (blob.design as Partial<CertificateDesign>) : undefined;

  const accentColor =
    design?.accentColor && /^#[0-9a-fA-F]{6}$/.test(design.accentColor)
      ? design.accentColor
      : DEFAULT_CERTIFICATE_DESIGN.accentColor;

  const storedSignatories = Array.isArray(design?.signatories) ? design?.signatories : undefined;

  return {
    templateId: resolveTemplateId(design?.templateId ?? legacyTheme),
    accentColor,
    subtitle: design?.subtitle ?? DEFAULT_CERTIFICATE_DESIGN.subtitle,
    descriptionOverride: design?.descriptionOverride,
    signatories: [
      {
        name: storedSignatories?.[0]?.name ?? DEFAULT_CERTIFICATE_DESIGN.signatories[0].name,
        role: storedSignatories?.[0]?.role ?? DEFAULT_CERTIFICATE_DESIGN.signatories[0].role
      },
      {
        name: storedSignatories?.[1]?.name ?? DEFAULT_CERTIFICATE_DESIGN.signatories[1].name,
        role: storedSignatories?.[1]?.role ?? DEFAULT_CERTIFICATE_DESIGN.signatories[1].role
      }
    ],
    idFormat: design?.idFormat ?? DEFAULT_CERTIFICATE_DESIGN.idFormat,
    labels: sanitizeLabels(design?.labels),
    ...(typeof design?.titleOverride === 'string'
      ? { titleOverride: design.titleOverride.slice(0, MAX_TITLE_LENGTH) }
      : {}),
    ...(design?.orgBrand ? { orgBrand: sanitizeBrand(design.orgBrand) } : {}),
    ...(design?.clientBrand ? { clientBrand: sanitizeBrand(design.clientBrand) } : {}),
    ...(typeof design?.brandLogoHeight === 'number' && Number.isFinite(design.brandLogoHeight)
      ? { brandLogoHeight: design.brandLogoHeight }
      : {}),
    ...(design?.document ? { document: design.document } : {})
  };
}

/**
 * A brand mark, on its way into HTML a browser will fetch.
 *
 * The logo URL is written straight into an `<img src>`, so a stored
 * `javascript:` or `data:` value would be a script running inside a document
 * the platform issues on a teacher's behalf. The write path already rejects
 * those; this is the last gate before rendering, and rows predate any schema.
 */
export function sanitizeBrand(stored: unknown): CertificateBrand | undefined {
  if (!stored || typeof stored !== 'object') return undefined;

  const raw = stored as { name?: unknown; logoUrl?: unknown };
  const name = typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : undefined;
  const logoUrl =
    typeof raw.logoUrl === 'string' && /^https?:\/\//i.test(raw.logoUrl)
      ? raw.logoUrl.slice(0, MAX_URL_LENGTH)
      : undefined;

  if (!name && !logoUrl) return undefined;

  return { ...(name ? { name } : {}), ...(logoUrl ? { logoUrl } : {}) };
}

/**
 * The editor's custom wording, on its way to the real document.
 *
 * Anything that is not a known key with a string value is discarded rather than
 * handed to a template. An empty string is kept deliberately: `resolveLabels`
 * reads it as "print nothing here", which is not the same as falling back to
 * the default.
 */
export function sanitizeLabels(stored: unknown): CertificateLabels | undefined {
  if (!stored || typeof stored !== 'object') return undefined;

  const labels: CertificateLabels = {};

  for (const key of Object.keys(DEFAULT_CERTIFICATE_LABELS) as CertificateLabelKey[]) {
    const value = (stored as Record<string, unknown>)[key];

    if (typeof value === 'string') labels[key] = value.slice(0, MAX_LABEL_LENGTH);
  }

  return Object.keys(labels).length > 0 ? labels : undefined;
}

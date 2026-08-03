import type { CertificateDocument } from './document/types';

export const CERTIFICATE_TEMPLATE_IDS = ['classique', 'brutalist', 'noir', 'poster', 'minimal'] as const;
export type CertificateTemplateId = (typeof CERTIFICATE_TEMPLATE_IDS)[number];

export interface CertificateSignatory {
  name: string;
  role: string;
}

/**
 * The fixed wording each template prints around the variable data.
 *
 * These used to be literals inside the templates, which made them both
 * uneditable and untranslatable: a Spanish certificate still read "— this is to
 * certify that —" over the recipient's name, and nothing in the editor could
 * change it. Every field is optional; a template falls back to
 * `DEFAULT_CERTIFICATE_LABELS` for anything not set.
 */
export interface CertificateLabels {
  /** Line above the recipient's name: "— se certifica que —". */
  presented?: string;
  /** Heading over the recipient in grid layouts: "Otorgado a". */
  awardedTo?: string;
  /** Key for the issue date. */
  issued?: string;
  /** Key for the certificate number. */
  reference?: string;
  /** Key for the award/course name in the metadata row. */
  award?: string;
  /** Key for the distinction level. */
  distinction?: string;
  /** Word stamped on the seal or medal. */
  seal?: string;
}

export type CertificateLabelKey = keyof CertificateLabels;

/**
 * The company the training is delivered FOR, alongside the organisation
 * delivering it. A consultancy issues the same certificate under two marks —
 * its own and its client's — and before this there was room for neither: no
 * template drew a logo at all, `orgLogoUrl` was carried all the way to the
 * renderer and never used.
 *
 * Lives on the course's design because the same course run for two clients is
 * two courses with two marks.
 */
export interface CertificateClientBrand {
  name?: string;
  /**
   * Must be a PUBLIC, stable URL: the page is fetched by Cloudflare's browser,
   * not ours, and a presigned URL would expire and silently strip the logo off
   * every certificate issued afterwards.
   */
  logoUrl?: string;
}

export interface CertificateDesign {
  templateId: CertificateTemplateId;
  accentColor: string;
  subtitle?: string;
  descriptionOverride?: string;
  signatories: [CertificateSignatory, CertificateSignatory];
  idFormat?: string;
  labels?: CertificateLabels;
  /**
   * A free canvas layout. When present it REPLACES the template: `templateId`
   * stays on the design as the preset it started from, but nothing reads it for
   * rendering. Absent means this course still uses one of the five fixed
   * layouts, which is what every existing course does.
   */
  document?: CertificateDocument;
  clientBrand?: CertificateClientBrand;
}

export interface CertificateRenderData {
  recipientName: string;
  courseName: string;
  courseDescription: string;
  orgName: string;
  orgLogoUrl?: string;
  date: string;
  certificateId: string;
}

export interface CertificateRenderResult {
  html: string;
  styles: string;
}

export interface CertificateTemplateMeta {
  id: CertificateTemplateId;
  label: string;
  description: string;
  /**
   * Which labels this template actually prints. The editor shows only these, so
   * a teacher is never asked to fill in wording that will not appear.
   */
  labels: CertificateLabelKey[];
}

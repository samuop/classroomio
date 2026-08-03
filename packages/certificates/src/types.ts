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
  /**
   * Caption over the issuing organisation's mark ("Dictado por").
   *
   * Empty by default, unlike every other label: two logos side by side is how
   * certificates normally carry a consultancy and its client, and a caption is
   * an addition a teacher opts into rather than wording they have to clear.
   */
  deliveredBy?: string;
  /** Caption over the client company's mark ("Para"). Empty by default. */
  deliveredFor?: string;
}

export type CertificateLabelKey = keyof CertificateLabels;

/**
 * One of the marks a certificate is issued under.
 *
 * A consultancy issues the same certificate under two of them — its own and the
 * client company it trained — and before this there was room for neither: no
 * template drew a logo at all, `orgLogoUrl` was carried all the way to the
 * renderer and never used, and the organisation was a line of plain text.
 *
 * Both live on the course's design, because the same course run for two clients
 * is two courses with two marks.
 */
export interface CertificateBrand {
  name?: string;
  /**
   * Must be a PUBLIC, stable URL: the page is fetched by Cloudflare's browser,
   * not ours, and a presigned URL would expire and silently strip the logo off
   * every certificate issued afterwards.
   *
   * An SVG is the right thing to upload here — it has no background to clash
   * with the certificate and stays sharp at export resolution.
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
   * What the certificate calls the achievement, replacing the course title.
   *
   * A course is named for the people taking it ("Inducción SSMA 2026"); the
   * certificate is a document its holder shows to someone else, and often has
   * to read differently. Applied once, centrally, in `renderCertificate`, so
   * every template picks it up.
   */
  titleOverride?: string;
  /**
   * The issuing organisation's mark, overriding the workspace name and avatar.
   *
   * Separate from the org's own profile on purpose: the avatar is a square
   * bitmap sized for a nav bar, and a certificate wants the full lock-up —
   * usually a transparent SVG.
   */
  orgBrand?: CertificateBrand;
  /** The company the training was delivered for. Absent for most courses. */
  clientBrand?: CertificateBrand;
  /** Printed height of each logo in canvas pixels; templates cap it further. */
  brandLogoHeight?: number;
  /**
   * A free canvas layout. When present it REPLACES the template: `templateId`
   * stays on the design as the preset it started from, but nothing reads it for
   * rendering. Absent means this course still uses one of the five fixed
   * layouts, which is what every existing course does.
   *
   * Only read while {@link CANVAS_EDITOR_ENABLED} is on.
   */
  document?: CertificateDocument;
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

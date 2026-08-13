import * as z from 'zod';

import { ALLOWED_CONTENT_TYPES, ALLOWED_DOCUMENT_TYPES } from '../constants';
import { ZCourseCalloutInput } from './callout';

export const ZCourseClone = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  slug: z.string().min(1),
  /**
   * Where the copy lands. A consultancy delivers a master course into a client
   * company by naming it here. The server authorizes it — being able to read a
   * course says nothing about being allowed to write into some other company.
   */
  organizationId: z.string().min(1),
  /**
   * Keep the copy tied to the course it came from, so its author can push a
   * correction into it later. Off means a copy that goes its own way.
   */
  linkToMaster: z.boolean().optional()
});
export type TCourseClone = z.infer<typeof ZCourseClone>;

export const ZCourseCloneParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseCloneParam = z.infer<typeof ZCourseCloneParam>;

export const ZCourseGetParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseGetParam = z.infer<typeof ZCourseGetParam>;

export const ZCourseGetQuery = z.object({
  slug: z.string().optional()
});
export type TCourseGetQuery = z.infer<typeof ZCourseGetQuery>;

export const ZCourseGetBySlugParam = z.object({
  slug: z.string().min(1)
});
export type TCourseGetBySlugParam = z.infer<typeof ZCourseGetBySlugParam>;

export const ZCourseEnrollParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseEnrollParam = z.infer<typeof ZCourseEnrollParam>;

export const ZCourseEnrollBody = z.object({
  inviteToken: z.string().min(1).optional()
});
export type TCourseEnrollBody = z.infer<typeof ZCourseEnrollBody>;

export const ZCourseDownloadParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseDownloadParam = z.infer<typeof ZCourseDownloadParam>;

/**
 * Per-course certificate design. Stored on `course.certificate.design`.
 * The 5 supported template ids match `@cio/certificates`.
 */
export const ZCertificateSignatory = z.object({
  name: z.string().max(80).default(''),
  role: z.string().max(80).default('')
});
export type TCertificateSignatory = z.infer<typeof ZCertificateSignatory>;

export const ZCertificateTemplateId = z.enum(['classique', 'diploma', 'brutalist', 'noir', 'poster', 'minimal']);
export type TCertificateTemplateId = z.infer<typeof ZCertificateTemplateId>;

/**
 * The fixed wording a template prints around the variable data ("se certifica
 * que", "Otorgado a"…). Keys mirror `CertificateLabels` in `@cio/certificates`.
 *
 * An empty string is allowed and meaningful: `resolveLabels` reads it as "print
 * nothing here", which is not the same as omitting the key and falling back to
 * the default. 120 chars is what the layouts can hold — these are short lines of
 * chrome, not content.
 */
export const ZCertificateLabels = z.object({
  presented: z.string().max(120).optional(),
  completed: z.string().max(120).optional(),
  awardedTo: z.string().max(120).optional(),
  issued: z.string().max(120).optional(),
  reference: z.string().max(120).optional(),
  award: z.string().max(120).optional(),
  distinction: z.string().max(120).optional(),
  seal: z.string().max(120).optional(),
  /** Captions over the two brand marks; both default to empty, not to wording. */
  deliveredBy: z.string().max(120).optional(),
  deliveredFor: z.string().max(120).optional()
});
export type TCertificateLabels = z.infer<typeof ZCertificateLabels>;

/** Hex colour, with or without alpha. */
const ZHexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
  message: 'Colour must be a hex value'
});

/**
 * Only http(s). These URLs are written straight into the certificate's HTML and
 * fetched by a real browser, so allowing arbitrary schemes would put
 * `javascript:` and `data:` payloads into a document the platform issues on the
 * teacher's behalf.
 */
const ZAssetUrl = z
  .string()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), { message: 'URL must be http(s)' });

/** Canvas units. Negative values are legal — an element may bleed off the edge. */
const ZCanvasCoordinate = z.number().min(-4000).max(8000);
const ZCanvasSize = z.number().min(0).max(8000);

const ZElementBase = {
  id: z.string().min(1).max(64),
  x: ZCanvasCoordinate,
  y: ZCanvasCoordinate,
  w: ZCanvasSize,
  h: ZCanvasSize,
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional()
};

const ZTextStyle = z.object({
  fontFamily: z.string().min(1).max(60),
  fontSize: z.number().min(1).max(400),
  fontWeight: z.number().int().min(100).max(900),
  lineHeight: z.number().min(0.5).max(4),
  letterSpacing: z.number().min(-20).max(60),
  color: ZHexColor,
  italic: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom'])
});

const ZTextElement = z.object({
  ...ZElementBase,
  kind: z.literal('text'),
  content: z.string().max(2000),
  style: ZTextStyle,
  fit: z.enum(['shrink', 'clamp', 'overflow']),
  minFontSize: z.number().min(1).max(400).optional(),
  maxLines: z.number().int().min(1).max(50).optional()
});

const ZImageElement = z.object({
  ...ZElementBase,
  kind: z.literal('image'),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('orgLogo') }),
    z.object({ kind: z.literal('clientLogo') }),
    z.object({ kind: z.literal('upload'), url: ZAssetUrl })
  ]),
  fit: z.enum(['contain', 'cover']),
  radius: z.number().min(0).max(999).optional(),
  hideWhenEmpty: z.boolean().optional()
});

const ZShapeElement = z.object({
  ...ZElementBase,
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'line', 'ellipse']),
  fill: ZHexColor.optional(),
  strokeColor: ZHexColor.optional(),
  strokeWidth: z.number().min(0).max(200).optional(),
  radius: z.number().min(0).max(999).optional()
});

/**
 * A free canvas layout. Bounded at 200 elements — well past any real
 * certificate, and low enough that a malformed payload cannot turn one course
 * row into a render that never finishes.
 */
export const ZCertificateDocument = z.object({
  version: z.literal(2),
  canvas: z.object({
    color: ZHexColor,
    imageUrl: ZAssetUrl.optional(),
    borderColor: ZHexColor.optional(),
    borderWidth: z.number().min(0).max(200).optional(),
    borderInset: z.number().min(0).max(400).optional()
  }),
  elements: z.array(z.discriminatedUnion('kind', [ZTextElement, ZImageElement, ZShapeElement])).max(200)
});
export type TCertificateDocument = z.infer<typeof ZCertificateDocument>;

/**
 * One of the two marks a certificate is issued under: the organisation
 * delivering the training, and the client company it was delivered for.
 *
 * `logoUrl` goes straight into an `<img src>` that Cloudflare's browser
 * resolves, which is why it is an `ZAssetUrl` and not a bare string.
 */
export const ZCertificateBrand = z.object({
  name: z.string().max(120).optional(),
  logoUrl: ZAssetUrl.optional()
});
export type TCertificateBrand = z.infer<typeof ZCertificateBrand>;

/**
 * NOTE FOR ANY NEW DESIGN FIELD: it must be declared here as well as on the
 * `certificate` column's `$type<>` in `packages/db/src/schema.ts`. Zod strips
 * unknown keys silently, so a field missing from this schema is accepted by the
 * API, dropped before it reaches the database, and reported back as saved. That
 * is exactly how `labels` shipped broken end to end: the editor wrote the custom
 * wording, the teacher saw a success toast, and nothing was ever persisted.
 */
export const ZCertificateDesign = z.object({
  templateId: ZCertificateTemplateId,
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Accent must be a 6-digit hex color' }),
  subtitle: z.string().max(120).optional(),
  descriptionOverride: z.string().max(500).optional(),
  signatories: z.tuple([ZCertificateSignatory, ZCertificateSignatory]),
  idFormat: z.string().max(40).optional(),
  labels: ZCertificateLabels.optional(),
  /** What the certificate calls the achievement, in place of the course title. */
  titleOverride: z.string().max(160).optional(),
  orgBrand: ZCertificateBrand.optional(),
  clientBrand: ZCertificateBrand.optional(),
  brandLogoHeight: z.number().min(16).max(96).optional(),
  /** Print each mark's name under its logo as well as the logo itself. */
  brandShowNames: z.boolean().optional(),
  document: ZCertificateDocument.optional()
});
export type TCertificateDesign = z.infer<typeof ZCertificateDesign>;

/**
 * Body for `POST /:courseId/download/certificate(/png)`.
 * The server reads design + course + org from the DB; the client only sends
 * the per-recipient fields it cannot infer.
 */
export const ZCertificateDownloadRequest = z.object({
  studentName: z.string().min(1).max(120),
  studentId: z.string().min(1).max(64).optional(),
  issuedAt: z.string().datetime().optional(),
  /** When true, skips the eligibility check (course owner previewing their own design). */
  previewMode: z.boolean().optional()
});
export type TCertificateDownloadRequest = z.infer<typeof ZCertificateDownloadRequest>;

export const ZCourseDownloadContent = z.object({
  courseTitle: z.string().min(1),
  orgName: z.string().min(1),
  orgTheme: z.string().min(1),
  lessons: z.array(
    z.object({
      lessonTitle: z.string().min(1),
      lessonNumber: z.string().min(1),
      lessonNote: z.string(),
      slideUrl: z.string().url().optional(),
      video: z.array(z.string().url()).optional()
    })
  )
});
export type TCourseDownloadContent = z.infer<typeof ZCourseDownloadContent>;

export const ZLessonDownloadContent = z.object({
  title: z.string().min(1),
  number: z.string().min(1),
  orgName: z.string().min(1),
  note: z.string(),
  slideUrl: z.string().url().optional(),
  video: z.array(z.string().url()).optional(),
  courseTitle: z.string().min(1)
});
export type TLessonDownloadContent = z.infer<typeof ZLessonDownloadContent>;

export const ZCoursePresignUrlUpload = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(ALLOWED_CONTENT_TYPES)
});
export type TCoursePresignUrlUpload = z.infer<typeof ZCoursePresignUrlUpload>;

export const ZCourseDocumentPresignUrlUpload = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(ALLOWED_DOCUMENT_TYPES)
});
export type TCourseDocumentPresignUrlUpload = z.infer<typeof ZCourseDocumentPresignUrlUpload>;

export const ZCourseDownloadPresignedUrl = z.object({
  keys: z.array(z.string().min(1)).min(1)
});
export type TCourseDownloadPresignedUrl = z.infer<typeof ZCourseDownloadPresignedUrl>;

export const ZCourseContentUpdateItem = z.object({
  id: z.string().min(1),
  type: z.enum(['LESSON', 'EXERCISE']),
  isUnlocked: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  sectionId: z.string().nullable().optional()
});
export type TCourseContentUpdateItem = z.infer<typeof ZCourseContentUpdateItem>;

export const ZCourseContentUpdate = z.object({
  items: z.array(ZCourseContentUpdateItem).min(1)
});
export type TCourseContentUpdate = z.infer<typeof ZCourseContentUpdate>;

/** Body for the bulk lock/unlock-all-content course action. */
export const ZCourseContentLockAll = z.object({
  isUnlocked: z.boolean()
});
export type TCourseContentLockAll = z.infer<typeof ZCourseContentLockAll>;

export const ZCourseContentReorderSection = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0)
});
export type TCourseContentReorderSection = z.infer<typeof ZCourseContentReorderSection>;

export const ZCourseContentReorderItem = ZCourseContentUpdateItem.omit({
  isUnlocked: true
});
export type TCourseContentReorderItem = z.infer<typeof ZCourseContentReorderItem>;

export const ZCourseContentReorderBase = z.object({
  sections: z.array(ZCourseContentReorderSection).min(1).optional(),
  items: z.array(ZCourseContentReorderItem).min(1).optional()
});
export type TCourseContentReorderBase = z.infer<typeof ZCourseContentReorderBase>;

export const ZCourseContentReorder = ZCourseContentReorderBase.superRefine((data, ctx) => {
  if (!data.sections?.length && !data.items?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: 'Provide sections or items to reorder'
    });
  }

  const sectionIds = new Set<string>();
  data.sections?.forEach((section, index) => {
    if (sectionIds.has(section.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index, 'id'],
        message: 'Section IDs must be unique'
      });
    }

    sectionIds.add(section.id);
  });

  const itemKeys = new Set<string>();
  data.items?.forEach((item, index) => {
    if (item.order === undefined && item.sectionId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index],
        message: 'Each item must provide order or sectionId'
      });
    }

    const itemKey = `${item.type}:${item.id}`;
    if (itemKeys.has(itemKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'id'],
        message: 'Item IDs must be unique per content type'
      });
    }

    itemKeys.add(itemKey);
  });
});
export type TCourseContentReorder = z.infer<typeof ZCourseContentReorder>;

export const ZCourseContentDeleteItem = z.object({
  id: z.string().min(1),
  type: z.enum(['LESSON', 'EXERCISE'])
});
export type TCourseContentDeleteItem = z.infer<typeof ZCourseContentDeleteItem>;

export const ZCourseContentDelete = z
  .object({
    sectionId: z.string().min(1).optional(),
    items: z.array(ZCourseContentDeleteItem).min(1).optional()
  })
  .superRefine((data, ctx) => {
    if (Boolean(data.sectionId) === Boolean(data.items)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectionId'],
        message: 'Provide either sectionId or items'
      });
    }

    const itemKeys = new Set<string>();
    data.items?.forEach((item, index) => {
      const itemKey = `${item.type}:${item.id}`;
      if (itemKeys.has(itemKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'id'],
          message: 'Item IDs must be unique per content type'
        });
      }

      itemKeys.add(itemKey);
    });
  });
export type TCourseContentDelete = z.infer<typeof ZCourseContentDelete>;

export const ZComplianceSettings = z.object({
  retakeIntervalMonths: z.number().int().min(1).max(120),
  gracePeriodDays: z.number().int().min(0).max(365).optional().default(0),
  reminderDaysBefore: z.array(z.number().int().min(1).max(365)).max(10).optional().default([30, 7, 1]),
  isMandatory: z.boolean().optional().default(true),
  framework: z.enum(['HIPAA', 'OSHA', 'SOX', 'GDPR', 'PCI_DSS', 'FERPA', 'ISO', 'CUSTOM']).nullable().optional(),
  maxRetakeAttempts: z.number().int().min(1).nullable().optional(),
  passingScore: z.number().int().min(0).max(100).optional().default(80)
});
export type TComplianceSettings = z.infer<typeof ZComplianceSettings>;

export const ZCourseCreateBase = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['LIVE_CLASS', 'SELF_PACED', 'COMPLIANCE', 'PUBLIC']),
  organizationId: z.string().min(1),
  compliance: ZComplianceSettings.optional()
});

export const ZCourseCreate = ZCourseCreateBase.refine(
  (data) => data.type !== 'COMPLIANCE' || data.compliance !== undefined,
  {
    message: 'Compliance settings are required for COMPLIANCE courses',
    path: ['compliance']
  }
);
export type TCourseCreate = z.infer<typeof ZCourseCreate>;

export const ZCourseReward = z.object({
  show: z.boolean(),
  description: z.string()
});

export const ZCourseInstructor = z.object({
  name: z.string(),
  role: z.string(),
  coursesNo: z.number(),
  description: z.string(),
  imgUrl: z.string()
});

export const ZCourseCertificate = z.object({
  templateUrl: z.string()
});

export const ZCourseReview = z.object({
  id: z.number(),
  hide: z.boolean(),
  name: z.string(),
  avatar_url: z.string(),
  rating: z.number(),
  created_at: z.number(),
  description: z.string()
});

export const ZCourseLessonTabsOrder = z.array(
  z.object({
    id: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    name: z.string()
  })
);

// Course metadata schema matching the database structure
export const ZCourseMetadata = z.object({
  requirements: z.string().optional(),
  description: z.string().optional(),
  goals: z.string().optional(),
  videoUrl: z.string().optional(),
  showDiscount: z.boolean().optional(),
  discount: z.number().optional(),
  paymentLink: z.string().optional(),
  reward: ZCourseReward.optional(),
  instructor: ZCourseInstructor.optional(),
  certificate: ZCourseCertificate.optional(),
  reviews: z.array(ZCourseReview).optional(),
  lessonTabsOrder: ZCourseLessonTabsOrder.optional(),
  grading: z.boolean().optional(),
  lessonDownload: z.boolean().optional(),
  allowNewStudent: z.boolean(),
  sectionDisplay: z.record(z.string(), z.boolean()).optional(),
  isContentGroupingEnabled: z.boolean().optional()
});
export type TCourseMetadata = z.infer<typeof ZCourseMetadata>;

export const ZCourseLandingPageMetadataUpdate = z.object({
  requirements: z.string().optional(),
  description: z.string().optional(),
  goals: z.string().optional(),
  videoUrl: z.string().optional(),
  showDiscount: z.boolean().optional(),
  discount: z.number().optional(),
  paymentLink: z.string().optional(),
  reward: ZCourseReward.partial().optional(),
  instructor: ZCourseInstructor.partial().optional(),
  certificate: ZCourseCertificate.partial().optional(),
  reviews: z.array(ZCourseReview).optional(),
  lessonTabsOrder: ZCourseLessonTabsOrder.optional(),
  grading: z.boolean().optional(),
  lessonDownload: z.boolean().optional(),
  allowNewStudent: z.boolean().optional(),
  sectionDisplay: z.record(z.string(), z.boolean()).optional(),
  isContentGroupingEnabled: z.boolean().optional()
});
export type TCourseLandingPageMetadataUpdate = z.infer<typeof ZCourseLandingPageMetadataUpdate>;

export const ZCertificationSettings = z.object({
  isDownloadable: z.boolean().optional(),
  /** Legacy theme id (one of the 6 original themes). Kept for read compatibility; new courses use `design.templateId`. */
  theme: z.string().optional(),
  /** Atelier-era certificate design (template, accent, signatories, subtitle, etc.). */
  design: ZCertificateDesign.optional(),
  /** ISO 8601 datetime string or null to clear */
  deadline: z.union([z.string().min(1), z.null()]).optional(),
  threshold: z.number().int().min(0).max(100).optional(),
  requiredExerciseId: z.union([z.string().uuid(), z.null()]).optional(),
  exerciseMinScorePercent: z.number().int().min(0).max(100).nullable().optional(),
  emailMessage: z.string().max(5000).nullable().optional()
});
export type TCertificationSettings = z.infer<typeof ZCertificationSettings>;

export const ZCourseUpdateBase = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: z.enum(['LIVE_CLASS', 'SELF_PACED', 'COMPLIANCE', 'PUBLIC']).optional(),
  logo: z.string().optional(),
  slug: z.string().optional(),
  isPublished: z.boolean().optional(),
  overview: z.string().optional(),
  metadata: ZCourseMetadata.optional(),
  cost: z.number().int().min(0).optional(),
  currency: z.enum(['NGN', 'USD']).optional(),
  certificate: ZCertificationSettings.optional(),
  tagIds: z.array(z.uuid()).max(100).optional(),
  compliance: ZComplianceSettings.optional(),
  callout: ZCourseCalloutInput.optional()
});

export const ZCourseUpdate = ZCourseUpdateBase.refine(
  (data) => data.type !== 'COMPLIANCE' || data.compliance !== undefined,
  {
    message: 'Compliance settings are required when changing a course to COMPLIANCE',
    path: ['compliance']
  }
);
export type TCourseUpdate = z.infer<typeof ZCourseUpdate>;

export const ZCourseUpdateParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseUpdateParam = z.infer<typeof ZCourseUpdateParam>;

export const ZCourseLandingPageUpdate = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  overview: z.string().optional(),
  cost: z.number().int().min(0).optional(),
  currency: z.enum(['NGN', 'USD']).optional(),
  imageUrl: z.url().optional(),
  generateImage: z.boolean().optional(),
  imageQuery: z.string().min(1).max(120).optional(),
  metadata: ZCourseLandingPageMetadataUpdate.optional()
});
export type TCourseLandingPageUpdate = z.infer<typeof ZCourseLandingPageUpdate>;

export const ZCourseDeleteParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseDeleteParam = z.infer<typeof ZCourseDeleteParam>;

export const ZCourseProgressParam = z.object({
  courseId: z.string().min(1)
});
export type TCourseProgressParam = z.infer<typeof ZCourseProgressParam>;

export const ZCourseProgressQuery = z.object({
  profileId: z.string().uuid()
});
export type TCourseProgressQuery = z.infer<typeof ZCourseProgressQuery>;

export const ZCourseUserAnalyticsParam = z.object({
  courseId: z.string().min(1),
  userId: z.string().uuid()
});
export type TCourseUserAnalyticsParam = z.infer<typeof ZCourseUserAnalyticsParam>;

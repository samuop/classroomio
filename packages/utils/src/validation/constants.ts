import { QUESTION_TYPE_IDS } from '@cio/question-types';

/**
 * Validation Constants
 *
 * Shared constants used across validation schemas.
 * These should match the constants in the API.
 */

export const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword' // .doc
] as const;

/**
 * SVG is on this list, and the API sanitises every one of them before it
 * reaches storage — an SVG is a document, and an unsanitised one is a script
 * the platform hosts on a teacher's behalf. See `uploadImage` in
 * `apps/api/src/services/media.ts` for what that means in practice.
 *
 * It is here because a certificate needs it: a logo with no background to clash
 * with the paper, that stays sharp when the PDF is rendered at export
 * resolution. The avatar cropper never produces one — it rasterises to PNG —
 * and `validateImageUpload` still refuses SVG for that path.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
] as const;

/**
 * Question Type Constants
 * These match canonical question type ids.
 */
export const QUESTION_TYPE = QUESTION_TYPE_IDS;

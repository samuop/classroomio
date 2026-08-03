import DOMPurify from 'isomorphic-dompurify';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { MAX_IMAGE_SIZE } from '@api/constants/upload';

import { ALLOWED_IMAGE_TYPES } from '@cio/utils/validation';
import { getStorageConfig } from '@api/config/storage';
import { generateFileKey } from '@api/utils/upload';
import { uploadToS3 } from '@api/utils/s3';

const SVG_MIME = 'image/svg+xml';

/**
 * An SVG is a document, not a picture.
 *
 * It can carry `<script>`, `on*` handlers, `<foreignObject>` with arbitrary
 * HTML, and external references — so storing one as uploaded would mean the
 * platform hosting a script on the uploader's behalf. Anyone who could then be
 * persuaded to open the file directly runs it.
 *
 * Two independent measures, because either one alone leaves something:
 *
 * 1. Sanitised here, so what is stored has no executable content at all. This
 *    is the one that matters, since it is the bytes themselves.
 * 2. Stored with `Content-Disposition: attachment`, so navigating to the URL
 *    downloads the file instead of rendering it in a browsing context. This does
 *    NOT affect `<img src>` — browsers ignore the header for subresource loads —
 *    so certificates, avatars and previews are unaffected, while the "open the
 *    link and run it" path stops existing.
 *
 * Returns null when nothing survives sanitising, which is the caller's cue to
 * reject the upload rather than store an empty file.
 */
export function sanitizeSvg(source: string): string | null {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // A logo has no reason to reach outside itself, and these are how an SVG
    // pulls in or hands off to something the sanitiser cannot see.
    FORBID_TAGS: ['script', 'foreignObject', 'use', 'image'],
    FORBID_ATTR: ['href', 'xlink:href']
  }).trim();

  return clean.includes('<svg') ? clean : null;
}

/**
 * Uploads an image file to object storage and returns the public URL
 * @param file - The image file to upload
 * @returns Object containing the public URL and file key
 */
export async function uploadImage(file: File) {
  const config = getStorageConfig();
  if (!config.mediaPublicBaseUrl) {
    throw new AppError(
      new Error(
        'Media public URL not configured. Set OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL or CLOUDFLARE_IMAGE_BUCKET_DOMAIN.'
      ),
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }

  // Validate file type
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
    throw new AppError(
      new Error(`Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`),
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  // Validate file size
  if (file.size > MAX_IMAGE_SIZE) {
    throw new AppError(
      new Error(`File size exceeds maximum of ${MAX_IMAGE_SIZE / 1024 / 1024}MB`),
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  // Generate unique file key
  const fileKey = generateFileKey(file.name);

  const isSvg = file.type === SVG_MIME;
  let buffer: Buffer;

  if (isSvg) {
    const clean = sanitizeSvg(await file.text());

    if (!clean) {
      throw new AppError(
        new Error('The SVG could not be read as an image. Export it again from your design tool.'),
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    buffer = Buffer.from(clean, 'utf8');
  } else {
    buffer = Buffer.from(await file.arrayBuffer());
  }

  // Upload to object storage
  const uploadResult = await uploadToS3({
    Bucket: config.bucketMedia,
    Key: fileKey,
    Body: buffer,
    ContentType: file.type,
    CacheControl: 'public, max-age=31536000', // Cache for 1 year
    // See `sanitizeSvg`: belt and braces, and invisible to `<img>`.
    ...(isSvg ? { ContentDisposition: 'attachment' } : {})
  });

  if (!uploadResult.success) {
    throw new AppError(new Error(uploadResult.error || 'Failed to upload image'), ErrorCodes.INTERNAL_ERROR, 500);
  }

  // Construct public URL
  const baseUrl = config.mediaPublicBaseUrl.replace(/\/$/, '');
  const publicUrl = `${baseUrl}/${fileKey}`;

  return {
    url: publicUrl,
    fileKey
  };
}

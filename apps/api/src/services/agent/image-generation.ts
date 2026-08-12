/**
 * Generates a lesson illustration and stores it where a lesson can point at it.
 *
 * The counterpart to `diagram.ts`, and deliberately NOT a replacement for it: an
 * SVG stays the right answer for a chart, a flow or a labelled structure — it is
 * crisp at any size, the teacher can have it redrawn, and it costs nothing. This
 * covers what an SVG does badly: a scene, an object, an illustration, anything
 * that wants texture rather than geometry.
 *
 * The storage choice is the load-bearing one. The URL is written into lesson
 * HTML that outlives every session, so it must be PUBLIC and PERMANENT — a
 * presigned URL would expire and leave older lessons with broken images. The
 * `media` bucket already serves exactly that (`OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL`,
 * the same host the CSP already allows for avatars and logos).
 */
import { generateImage } from 'ai';
import { nanoid } from 'nanoid';

import { getImageModel, IMAGE_SIZE } from '@cio/ai-assistant';

import { getStorageConfig } from '@api/config/storage';
import { uploadToS3 } from '@api/utils/s3';
import { AppError } from '@api/utils/errors';

/**
 * Images one round may generate.
 *
 * A build round can chain 40 steps, so an unbounded tool is an unbounded bill:
 * at US$0.067 each, a runaway loop is the difference between cents and tens of
 * dollars. Eight covers a lesson that genuinely wants several illustrations and
 * stops a loop from running away.
 */
export const MAX_IMAGES_PER_ROUND = 8;

/** What the model may ask for. Anything wider is a diagram's job, not a photo's. */
const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4'] as const;
export type ImageAspectRatio = (typeof ASPECT_RATIOS)[number];

export interface GeneratedLessonImage {
  url: string;
  aspectRatio: ImageAspectRatio;
  bytes: number;
  styledFromReference: boolean;
}

/** Extension for what the model actually returned — it answers JPEG, not PNG. */
function extensionFor(mediaType: string | undefined): string {
  if (!mediaType) return 'jpg';
  if (mediaType.includes('png')) return 'png';
  if (mediaType.includes('webp')) return 'webp';

  return 'jpg';
}

/**
 * The house style, in one place, applied to every generated image.
 *
 * Deterministic text is the cheap half of visual consistency: the same words
 * every time already keeps the set recognisably related. A seed would be the
 * other obvious lever and is NOT available — @ai-sdk/google answers
 * "This model does not support the `seed` option through this provider" for
 * image models. What replaces it is `AGENT_IMAGE_STYLE_REFERENCE_URL` below.
 */
const HOUSE_STYLE =
  'Style: a clean, modern educational illustration for an online course. Uncluttered composition, ' +
  'consistent lighting, no border, no watermark, no logo.';

/**
 * Loads the style anchor: one image every generation is shown as a reference, so
 * a course's pictures look like a set rather than a collection.
 *
 * Nano Banana takes up to 14 reference images and this tier is the one Google
 * documents as strong at style consistency. One anchor is enough — it fixes the
 * palette, the line weight and the level of realism without constraining the
 * subject.
 *
 * Fetched rather than passed by URL so a broken or private anchor fails here,
 * loudly and before anything is billed, instead of being silently ignored by the
 * provider. Never fatal: an image in the house style beats no image at all.
 */
async function loadStyleReference(url: string | undefined): Promise<Uint8Array | null> {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.warn(
      `[image-generation] style reference could not be loaded from ${url}; generating without it:`,
      error instanceof Error ? error.message : error
    );

    return null;
  }
}

/**
 * A prompt good enough to be worth paying for.
 *
 * Nano Banana renders text inside images, and it renders it *badly enough to
 * matter* in a teaching context — a mislabelled axis is worse than no axis. So
 * the instruction to keep wording out of the picture is appended here rather
 * than left to the caller: it is a property of using images for lessons, not of
 * any one call.
 */
function buildImagePrompt(subject: string, locale: string, hasReference: boolean): string {
  return [
    subject.trim(),
    '',
    hasReference
      ? 'Match the visual style of the reference image exactly — its palette, line weight, level of ' +
        'detail and lighting. Take ONLY the style from it; the subject is the one described above.'
      : HOUSE_STYLE,
    'Do NOT render any text, labels, numbers, captions or lettering inside the image — the lesson ' +
      'supplies its own wording around it, and any writing in the picture will be wrong or unreadable.' +
      (locale ? ` (The lesson is written in "${locale}", so baked-in wording would also be in the wrong place.)` : '')
  ].join('\n');
}

export async function generateLessonImage(params: {
  subject: string;
  courseId: string;
  lessonId?: string;
  locale?: string;
  aspectRatio?: ImageAspectRatio;
  /** Overrides the deployment-wide anchor; see `loadStyleReference`. */
  styleReferenceUrl?: string;
}): Promise<GeneratedLessonImage> {
  const model = getImageModel();

  if (!model) {
    throw new AppError(
      'Image generation is not configured on this server (GOOGLE_API_KEY is missing).',
      'IMAGE_MODEL_UNAVAILABLE',
      503
    );
  }

  const config = getStorageConfig();

  // Checked BEFORE spending anything: without a public base URL the image would
  // be generated, paid for, stored, and then unreachable from a lesson.
  if (!config.mediaPublicBaseUrl) {
    throw new AppError(
      'Image generation needs a public media URL (OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL is unset); ' +
        'without one the generated image could not be displayed in a lesson.',
      'MEDIA_PUBLIC_URL_UNSET',
      503
    );
  }

  const aspectRatio = params.aspectRatio ?? '16:9';
  const reference = await loadStyleReference(
    params.styleReferenceUrl ?? process.env.AGENT_IMAGE_STYLE_REFERENCE_URL
  );
  const text = buildImagePrompt(params.subject, params.locale ?? '', reference !== null);

  const { image } = await generateImage({
    model,
    prompt: reference ? { text, images: [reference] } : text,
    aspectRatio,
    providerOptions: { google: { imageSize: IMAGE_SIZE } },
    maxRetries: 1
  });

  const body = Buffer.from(image.uint8Array);
  // Grouped by course so a deleted course's images can be swept in one prefix,
  // and named randomly so regenerating never overwrites a live lesson's picture.
  // The extension follows the response: this model answers JPEG even though the
  // request says nothing about format, and a `.png` holding a JPEG is the kind of
  // mismatch that works until something downstream trusts the name.
  const key = `courses/${params.courseId}/generated/${params.lessonId ?? 'course'}-${nanoid(10)}.${extensionFor(image.mediaType)}`;

  const upload = await uploadToS3({
    Bucket: config.bucketMedia,
    Key: key,
    Body: body,
    ContentType: image.mediaType || 'image/png',
    // Written once, never edited, and the filename already carries a random id,
    // so it can be cached hard.
    CacheControl: 'public, max-age=31536000, immutable'
  });

  if (!upload.success) {
    throw new AppError(
      `The image was generated but could not be stored: ${upload.error ?? 'unknown error'}`,
      'IMAGE_UPLOAD_FAILED',
      502
    );
  }

  return {
    url: `${config.mediaPublicBaseUrl.replace(/\/+$/, '')}/${key}`,
    aspectRatio,
    bytes: body.byteLength,
    styledFromReference: reference !== null
  };
}

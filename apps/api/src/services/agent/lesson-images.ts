/**
 * Replacing one illustration inside a lesson, in place.
 *
 * The counterpart of `diagram.ts`, and it splices by position for the same
 * reason: the alternative is asking a model to reproduce the surrounding markup
 * byte for byte, which is exactly the failure mode the diagram control was built
 * to avoid.
 *
 * The subject a picture was generated from is not stored anywhere. Its `alt`
 * text is — written by the model to describe what the picture shows, for screen
 * readers — so it doubles as the record of the subject, and a regeneration works
 * from it plus whatever the teacher asks for.
 */
import { AppError } from '@api/utils/errors';

import { generateLessonImage, type ImageAspectRatio } from '@api/services/agent/image-generation';
import { getOrgAiImageSettingsService } from '@api/services/organization/ai-images';

const IMAGE_PATTERN = /<img\b[^>]*>/gi;

export interface LessonImage {
  index: number;
  tag: string;
  src: string;
  alt: string;
  start: number;
  end: number;
}

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? '';
}

/**
 * Every illustration in a lesson, in document order.
 *
 * MUST enumerate the same elements as `pushHtmlWithImages` in @cio/ui, because
 * the index the viewer sends is the index this resolves — the two counts are one
 * contract in two places.
 */
export function listLessonImages(content: string): LessonImage[] {
  if (!content) return [];

  const found: LessonImage[] = [];
  const pattern = new RegExp(IMAGE_PATTERN.source, IMAGE_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const src = attr(match[0], 'src');
    if (!src || !/^(https?:|\/|data:image\/)/i.test(src.trim())) continue;

    found.push({
      index: found.length,
      tag: match[0],
      src,
      alt: attr(match[0], 'alt'),
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return found;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function imageTag(src: string, alt: string): string {
  return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" />`;
}

function requireImage(content: string, index: number): LessonImage {
  const images = listLessonImages(content);
  const target = images[index];

  if (!target) {
    throw new AppError(
      `This lesson has ${images.length} image(s); there is none at position ${index}. Reload the lesson and try again.`,
      'LESSON_IMAGE_NOT_FOUND',
      404
    );
  }

  return target;
}

/**
 * Redraws the illustration at `index`.
 *
 * Without an instruction this is a straight re-roll of the same subject — the
 * model is not deterministic, so the same words give a different picture, which
 * is what "regenerate" means here. With one, the instruction is what changes the
 * subject; it is appended rather than replacing the alt text so "make it at
 * night" does not throw away what the picture was of.
 */
export async function regenerateLessonImage(params: {
  content: string;
  index: number;
  orgId: string;
  courseId: string;
  lessonId: string;
  locale: string;
  instruction?: string;
}): Promise<{ content: string; url: string; alt: string }> {
  const target = requireImage(params.content, params.index);
  const instruction = params.instruction?.trim();

  const subject = instruction
    ? `${target.alt || 'An illustration for this lesson.'}\n\nThe teacher asks for this change: ${instruction}`
    : target.alt;

  if (!subject) {
    throw new AppError(
      'This image has no description to regenerate from. Say what it should show instead.',
      'LESSON_IMAGE_NO_SUBJECT',
      400
    );
  }

  const style = await getOrgAiImageSettingsService(params.orgId).catch(() => null);

  const image = await generateLessonImage({
    subject,
    courseId: params.courseId,
    lessonId: params.lessonId,
    locale: params.locale,
    styleReferenceUrl: style?.styleReferenceUrl,
    styleNote: style?.styleNote
  });

  // The alt text follows the instruction, so a second regeneration starts from
  // what the picture shows NOW rather than from the original subject.
  const alt = instruction ? `${target.alt} (${instruction})`.trim() : target.alt;

  return {
    content: params.content.slice(0, target.start) + imageTag(image.url, alt) + params.content.slice(target.end),
    url: image.url,
    alt
  };
}

/**
 * Turns the diagram at `index` into a generated illustration.
 *
 * The teacher's escape hatch when a subject was never a diagram's job: a scene
 * an SVG can only gesture at. The diagram is replaced outright rather than
 * having a picture added beside it — two visuals of the same idea is worse than
 * either alone.
 */
export async function replaceDiagramWithImage(params: {
  content: string;
  diagramStart: number;
  diagramEnd: number;
  subject: string;
  orgId: string;
  courseId: string;
  lessonId: string;
  locale: string;
}): Promise<{ content: string; url: string; alt: string }> {
  const style = await getOrgAiImageSettingsService(params.orgId).catch(() => null);

  const image = await generateLessonImage({
    subject: params.subject,
    courseId: params.courseId,
    lessonId: params.lessonId,
    locale: params.locale,
    styleReferenceUrl: style?.styleReferenceUrl,
    styleNote: style?.styleNote,
    aspectRatio: '16:9' as ImageAspectRatio
  });

  return {
    content:
      params.content.slice(0, params.diagramStart) +
      imageTag(image.url, params.subject) +
      params.content.slice(params.diagramEnd),
    url: image.url,
    alt: params.subject
  };
}

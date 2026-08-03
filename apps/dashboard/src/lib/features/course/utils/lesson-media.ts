import { listLessonMediaRefs, type LessonMediaKind } from '@cio/ui/tools/sanitize';
import type { Lesson } from './types';

/**
 * The one slide a lesson can have lives in `slideUrl`, a scalar — there is no
 * array and so no placement id to generate. It still needs an identifier to be
 * referenceable from a note, so it gets a fixed one.
 */
export const SLIDE_MEDIA_ID = 'slide';

export interface LessonMediaItem {
  kind: LessonMediaKind;
  /** Placement id — see `videos[].id` in the schema. */
  mediaId: string;
  label: string;
}

type LessonVideos = NonNullable<Lesson['videos']>;
type LessonDocuments = NonNullable<Lesson['documents']>;

function videoLabel(video: LessonVideos[number], position: number): string {
  return video.fileName || video.metadata?.title || video.link || `Video ${position + 1}`;
}

/**
 * Everything in this lesson that a teacher can drop into the note, in the order
 * the material tabs show it.
 *
 * Entries with no placement id are skipped: a marker can only point at something
 * addressable, and offering an unaddressable item would write a reference that
 * silently resolves to nothing. Saving the lesson once stamps the missing ids
 * (see `withMediaIds` in @cio/db) and the item appears.
 */
export function listLessonMedia(lesson: Lesson | null | undefined): LessonMediaItem[] {
  if (!lesson) return [];

  const items: LessonMediaItem[] = [];

  (lesson.videos ?? []).forEach((video, index) => {
    if (!video?.id) return;
    items.push({ kind: 'video', mediaId: video.id, label: videoLabel(video, index) });
  });

  if (lesson.slideUrl) {
    items.push({ kind: 'slide', mediaId: SLIDE_MEDIA_ID, label: lesson.slideUrl });
  }

  (lesson.documents ?? []).forEach((document, index) => {
    if (!document?.id) return;
    items.push({ kind: 'document', mediaId: document.id, label: document.name || `Documento ${index + 1}` });
  });

  return items;
}

/**
 * The media this note already places inline, so the material lists below it can
 * leave those out instead of showing them twice.
 *
 * Migration rule, and the reason this is a subtraction rather than a rewrite:
 * media with no marker keeps rendering exactly where it does today. Nothing to
 * migrate, and a lesson nobody has touched looks unchanged.
 */
export function listPlacedLessonMediaIds(noteHtml: string | null | undefined): Set<string> {
  if (!noteHtml) return new Set();

  return new Set(listLessonMediaRefs(noteHtml).map((ref) => ref.mediaId));
}

export function findLessonVideo(lesson: Lesson | null | undefined, mediaId: string): LessonVideos[number] | undefined {
  return (lesson?.videos ?? []).find((video) => video?.id === mediaId);
}

export function findLessonDocument(
  lesson: Lesson | null | undefined,
  mediaId: string
): LessonDocuments[number] | undefined {
  return (lesson?.documents ?? []).find((document) => document?.id === mediaId);
}

/**
 * Names a marker for the card the editor shows in its place. Returning undefined
 * is meaningful: it renders as "not found", which is what a teacher needs to see
 * when the media a marker points at has been deleted.
 */
export function resolveLessonMediaLabel(
  lesson: Lesson | null | undefined,
  kind: LessonMediaKind,
  mediaId: string
): string | undefined {
  if (kind === 'slide') return lesson?.slideUrl || undefined;

  return listLessonMedia(lesson).find((item) => item.kind === kind && item.mediaId === mediaId)?.label;
}

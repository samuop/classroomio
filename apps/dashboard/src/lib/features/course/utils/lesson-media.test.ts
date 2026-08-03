// Imported from the module, not the `tools` barrel: the barrel also pulls in
// render-math, which imports KaTeX's stylesheet and blows up under Jest.
import { LESSON_MEDIA_ATTR } from '@cio/ui/tools/sanitize';

import { listLessonMedia, listPlacedLessonMediaIds, resolveLessonMediaLabel, SLIDE_MEDIA_ID } from './lesson-media';
import type { Lesson } from './types';

/**
 * The bridge between a note's markers and the lesson's actual media.
 *
 * Two rules carry the weight. Media the teacher placed inline must be left out
 * of the lists below the note, or the student sees it twice — and media WITHOUT
 * a marker must keep rendering where it does today, which is what makes this a
 * change with nothing to migrate.
 */

const marker = (kind: string, id: string) =>
  `<div ${LESSON_MEDIA_ATTR.kind}="${kind}" ${LESSON_MEDIA_ATTR.id}="${id}"></div>`;

const lesson = {
  id: 'lesson-1',
  slideUrl: 'https://www.canva.com/deck',
  videos: [
    { id: 'vid-1', type: 'youtube', link: 'https://youtu.be/a', fileName: 'Intro' },
    { id: 'vid-2', type: 'youtube', link: 'https://youtu.be/b' }
  ],
  documents: [{ id: 'doc-1', type: 'pdf', name: 'Apuntes.pdf', link: 'https://x/y', key: 'k' }]
} as unknown as Lesson;

describe('listLessonMedia', () => {
  it('offers every placeable item, in tab order', () => {
    expect(listLessonMedia(lesson)).toEqual([
      { kind: 'video', mediaId: 'vid-1', label: 'Intro' },
      { kind: 'video', mediaId: 'vid-2', label: 'https://youtu.be/b' },
      { kind: 'slide', mediaId: SLIDE_MEDIA_ID, label: 'https://www.canva.com/deck' },
      { kind: 'document', mediaId: 'doc-1', label: 'Apuntes.pdf' }
    ]);
  });

  it('skips entries with no placement id', () => {
    // Offering one would write a marker that resolves to nothing. Saving the
    // lesson stamps the id and the item reappears.
    const legacy = { videos: [{ type: 'youtube', link: 'https://youtu.be/c' }] } as unknown as Lesson;

    expect(listLessonMedia(legacy)).toEqual([]);
  });

  it('omits the slide when the lesson has none', () => {
    const noSlide = { ...lesson, slideUrl: null } as unknown as Lesson;

    expect(listLessonMedia(noSlide).some((item) => item.kind === 'slide')).toBe(false);
  });

  it('returns nothing for a missing lesson', () => {
    expect(listLessonMedia(null)).toEqual([]);
  });
});

describe('listPlacedLessonMediaIds', () => {
  it('collects what the note places inline', () => {
    const note = `<p>Antes</p>${marker('video', 'vid-1')}<p>Después</p>${marker('document', 'doc-1')}`;

    expect(listPlacedLessonMediaIds(note)).toEqual(new Set(['vid-1', 'doc-1']));
  });

  it('is empty for a note with no markers, so nothing is hidden from an untouched lesson', () => {
    expect(listPlacedLessonMediaIds('<p>Just prose.</p>')).toEqual(new Set());
    expect(listPlacedLessonMediaIds('')).toEqual(new Set());
    expect(listPlacedLessonMediaIds(null)).toEqual(new Set());
  });
});

describe('resolveLessonMediaLabel', () => {
  it('names the media a marker points at', () => {
    expect(resolveLessonMediaLabel(lesson, 'video', 'vid-1')).toBe('Intro');
    expect(resolveLessonMediaLabel(lesson, 'document', 'doc-1')).toBe('Apuntes.pdf');
    expect(resolveLessonMediaLabel(lesson, 'slide', SLIDE_MEDIA_ID)).toBe('https://www.canva.com/deck');
  });

  it('returns undefined when the media was deleted, so the card can say "not found"', () => {
    expect(resolveLessonMediaLabel(lesson, 'video', 'gone')).toBeUndefined();
  });

  it('does not resolve a video id as a document', () => {
    expect(resolveLessonMediaLabel(lesson, 'document', 'vid-1')).toBeUndefined();
  });
});

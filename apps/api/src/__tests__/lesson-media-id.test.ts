/**
 * Placement identity for lesson media.
 *
 * `videos[]` and `documents[]` are positional JSONB arrays, so "the second
 * video" is the only way to point at one — and that reference breaks the moment
 * anything earlier is removed. These tests pin the two properties that make a
 * note able to reference a specific video instead: ids are stamped on write, and
 * they are never reassigned afterwards.
 */
import { describe, expect, it } from 'vitest';

import { createLessonMediaId, findLessonMediaIndex, withLessonMediaIds } from '@cio/utils/functions/lesson-media-id';
import { ZLessonUpdate } from '@cio/utils/validation/lesson';

describe('createLessonMediaId', () => {
  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createLessonMediaId()));

    expect(ids.size).toBe(500);
  });
});

describe('withLessonMediaIds', () => {
  it('stamps entries that have no id', () => {
    const stamped = withLessonMediaIds([{ type: 'youtube', link: 'https://youtu.be/a' }]);

    expect(stamped[0].id).toEqual(expect.any(String));
    expect(stamped[0].id).not.toBe('');
  });

  it('leaves existing ids alone, so a saved note keeps pointing at the same video', () => {
    const entries = [{ id: 'video-1', link: 'a' }];
    const stamped = withLessonMediaIds(entries);

    expect(stamped[0].id).toBe('video-1');
    // Returned by reference: re-saving must not churn identity or allocate.
    expect(stamped[0]).toBe(entries[0]);
  });

  it('is idempotent across repeated writes', () => {
    const once = withLessonMediaIds([{ link: 'a' }, { link: 'b' }]);
    const twice = withLessonMediaIds(once);

    expect(twice.map((entry) => entry.id)).toEqual(once.map((entry) => entry.id));
  });

  it('gives distinct ids to entries that are otherwise identical', () => {
    // The same asset placed twice in one lesson is legitimate — it is the case
    // assetId cannot distinguish.
    const stamped = withLessonMediaIds([
      { assetId: 'asset-1', link: 'a' },
      { assetId: 'asset-1', link: 'a' }
    ]);

    expect(stamped[0].id).not.toBe(stamped[1].id);
  });

  it('passes non-objects through instead of repairing them', () => {
    const stamped = withLessonMediaIds([null, 'oops', { link: 'a' }] as unknown[]);

    expect(stamped[0]).toBeNull();
    expect(stamped[1]).toBe('oops');
    expect((stamped[2] as { id?: string }).id).toEqual(expect.any(String));
  });

  it('treats an empty-string id as missing', () => {
    const stamped = withLessonMediaIds([{ id: '', link: 'a' }]);

    expect(stamped[0].id).not.toBe('');
  });
});

/**
 * Stamping ids is worthless if they cannot travel. `ZLessonUpdate` guards the
 * only route a lesson takes from the editor to the database — the dashboard
 * parses with it before sending AND the route re-parses on arrival — and a zod
 * object drops unknown keys without saying so. When `id` was missing from the
 * schema, every save arrived id-less, `withMediaIds` minted fresh ones, and each
 * note marker was left pointing at a video that no longer answered to that name:
 * the video fell out of the note and back to the top of the lesson.
 */
describe('ZLessonUpdate carries placement ids', () => {
  it('keeps videos[].id and documents[].id', () => {
    const parsed = ZLessonUpdate.parse({
      videos: [{ id: 'video-1', type: 'youtube', link: 'https://youtu.be/a' }],
      documents: [{ id: 'doc-1', type: 'pdf', name: 'n', link: 'l', key: 'k' }]
    });

    expect(parsed.videos?.[0].id).toBe('video-1');
    expect(parsed.documents?.[0].id).toBe('doc-1');
  });

  it('accepts the non-UUID fallback id used on plain-http dashboards', () => {
    const parsed = ZLessonUpdate.parse({
      videos: [{ id: 'lm-abc123-xyz', type: 'upload', link: 'https://files/a.mp4' }]
    });

    expect(parsed.videos?.[0].id).toBe('lm-abc123-xyz');
  });

  it('still accepts media written before ids existed', () => {
    const parsed = ZLessonUpdate.parse({
      videos: [{ type: 'youtube', link: 'https://youtu.be/a' }]
    });

    expect(parsed.videos?.[0].id).toBeUndefined();
  });
});

describe('findLessonMediaIndex', () => {
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('resolves by id, ignoring a stale position', () => {
    // This is the whole point: the caller captured index 2 before something was
    // removed, and the id still lands on the right entry.
    expect(findLessonMediaIndex(entries, { id: 'b', index: 2 })).toBe(1);
  });

  it('falls back to the position for entries written before ids existed', () => {
    expect(findLessonMediaIndex([{}, {}, {}], { index: 1 })).toBe(1);
  });

  it('falls back to the position when the id is not in the array', () => {
    // Mixed arrays are real: one video added today, one from before the backfill.
    expect(findLessonMediaIndex(entries, { id: 'gone', index: 0 })).toBe(0);
  });

  it('returns -1 rather than an out-of-range position', () => {
    expect(findLessonMediaIndex(entries, { index: 7 })).toBe(-1);
    expect(findLessonMediaIndex(entries, { index: -1 })).toBe(-1);
    expect(findLessonMediaIndex([], { id: 'a', index: 0 })).toBe(-1);
  });
});

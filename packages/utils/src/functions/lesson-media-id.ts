/**
 * Stable identity for one PLACEMENT of media inside a lesson.
 *
 * Distinct from `assetId`, which identifies the uploaded FILE: a lesson may use
 * the same asset twice, and an external link (YouTube, Drive) has no asset at
 * all. Without this, `videos[]` and `documents[]` can only be addressed by
 * position — so deleting the first video silently renumbers every reference to
 * the rest, which is what stops a note from pointing at a specific video.
 */
export function createLessonMediaId(): string {
  // Available in Node 19+ and in browsers on any secure context (localhost
  // included). The fallback covers plain-http self-hosted dashboards, where
  // `crypto.randomUUID` is undefined; collisions only need to be avoided within
  // a single lesson, so Math.random is sufficient there.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stamps a placement id on any entry that lacks one.
 *
 * Idempotent by design, because it runs on every write: entries that already
 * carry an id are returned by reference, so re-saving a lesson never reshuffles
 * identities that notes already point at. Non-objects are passed through rather
 * than repaired — corrupt data should stay visible, not be papered over.
 */
export function withLessonMediaIds<T>(entries: readonly T[]): T[] {
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;

    const media = entry as T & { id?: unknown };
    if (typeof media.id === 'string' && media.id.length > 0) return entry;

    return { ...media, id: createLessonMediaId() };
  });
}

/**
 * How the UI points at one entry of `videos[]` / `documents[]`.
 *
 * `id` is the real answer. `index` is carried alongside it only because rows
 * written before placement ids existed have nothing else to match on; it is
 * correct right up until something earlier in the array is removed, which is
 * exactly the bug ids exist to close.
 */
export interface LessonMediaRef {
  id?: string | null;
  index: number;
}

export function findLessonMediaIndex(entries: readonly ({ id?: string } | undefined)[], ref: LessonMediaRef): number {
  if (ref.id) {
    const byId = entries.findIndex((entry) => entry?.id === ref.id);
    if (byId !== -1) return byId;
  }

  return ref.index >= 0 && ref.index < entries.length ? ref.index : -1;
}

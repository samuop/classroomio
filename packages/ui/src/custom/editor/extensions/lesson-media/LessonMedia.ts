import { Node, mergeAttributes } from '@tiptap/core';

import { LESSON_MEDIA_ATTR, type LessonMediaKind } from '../../../../tools/sanitize';

/**
 * Lesson-media node — lets a teacher place one of the lesson's own videos,
 * slides or documents at a chosen point in the note.
 *
 * The note stores an inert MARKER, never a player. `iframe` is in FORBID_TAGS
 * and `ALLOW_DATA_ATTR` is false, so an embedded YouTube player written into a
 * note is stripped on render — the protection that stops an AI-written note from
 * embedding third-party content, and not worth weakening. The viewer reads the
 * marker and mounts the real Svelte player itself; see `SafeHtmlContent`.
 *
 * `mediaId` is the placement id from `videos[]` / `documents[]`, not the asset
 * id: a lesson can use one asset twice, and a YouTube link has no asset at all.
 */

export interface LessonMediaOptions {
  HTMLAttributes: Record<string, unknown>;
  /**
   * Resolves a marker to something readable in the editor. Supplied per-consumer
   * because this package has no access to the lesson; without it the card falls
   * back to the kind alone.
   */
  resolveLabel: ((kind: LessonMediaKind, mediaId: string) => string | undefined) | null;
}

export interface LessonMediaAttributes {
  kind: LessonMediaKind;
  mediaId: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lessonMedia: {
      /** Place one of the lesson's media items at the cursor. */
      setLessonMedia: (options: LessonMediaAttributes) => ReturnType;
    };
  }
}

const KIND_ICON: Record<LessonMediaKind, string> = {
  video: '▶',
  slide: '▤',
  document: '▣'
};

export const LessonMedia = Node.create<LessonMediaOptions>({
  name: 'lessonMedia',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: { class: 'lesson-media' },
      resolveLabel: null
    };
  },

  addAttributes() {
    return {
      kind: {
        default: 'video',
        parseHTML: (element) => element.getAttribute(LESSON_MEDIA_ATTR.kind),
        renderHTML: (attrs) => ({ [LESSON_MEDIA_ATTR.kind]: attrs.kind })
      },
      mediaId: {
        default: '',
        parseHTML: (element) => element.getAttribute(LESSON_MEDIA_ATTR.id),
        renderHTML: (attrs) => ({ [LESSON_MEDIA_ATTR.id]: attrs.mediaId })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[${LESSON_MEDIA_ATTR.kind}]`,
        // Above the generic block handlers, or a plain `div` rule claims the
        // element first and the marker attributes are lost on reload.
        priority: 60
      }
    ];
  },

  /**
   * Serialized form persisted to the DB. Must stay in lockstep with
   * `LESSON_MEDIA_REGEX` in tools/sanitize — that regex is what the viewer uses
   * to find these again, and it requires BOTH attributes on the element.
   */
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  /**
   * In-editor presentation: a card naming the media, not the media itself.
   *
   * Playing a video while writing around it is a distraction, and more
   * practically the players need lesson state this package cannot reach. The
   * teacher is placing a reference; the card shows where it will land.
   */
  addNodeView() {
    return ({ node }) => {
      const kind = (node.attrs.kind ?? 'video') as LessonMediaKind;
      const mediaId = String(node.attrs.mediaId ?? '');
      const label = this.options.resolveLabel?.(kind, mediaId);

      const dom = document.createElement('div');
      dom.classList.add('lesson-media-card');
      dom.setAttribute('contenteditable', 'false');
      dom.setAttribute('data-kind', kind);

      const icon = document.createElement('span');
      icon.classList.add('lesson-media-card__icon');
      icon.textContent = KIND_ICON[kind] ?? KIND_ICON.video;

      const text = document.createElement('span');
      text.classList.add('lesson-media-card__label');
      // A marker whose media was deleted must say so. A blank card reads as a
      // rendering bug and sends the teacher looking in the wrong place.
      text.textContent = label ?? `${kind} (not found)`;
      if (!label) dom.classList.add('lesson-media-card--missing');

      dom.append(icon, text);

      return { dom };
    };
  },

  addCommands() {
    return {
      setLessonMedia:
        (options: LessonMediaAttributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options })
    };
  }
});

export default LessonMedia;

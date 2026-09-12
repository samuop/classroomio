import { Extension } from '@tiptap/core';

/**
 * Keeps the writer's `data-sin-fuente` marks alive through the editor.
 *
 * The mark says "this passage is mine, not the source's", and it is the only
 * difference between a paragraph that came out of a document and one the model
 * supplied itself. TipTap drops any attribute no extension declares, silently,
 * so without this the first time a teacher opens the lesson and saves it EVERY
 * mark on the page disappears — including on passages they never looked at.
 * That failure is invisible and unrecoverable, which is the exact shape of the
 * bug this whole mechanism exists to prevent.
 *
 * There is deliberately no UI here yet. Whether the writer uses the mark at all
 * is being measured first; the control for a teacher to clear a mark they have
 * resolved comes after that measurement, not before it.
 */

export const SIN_FUENTE_ATTRIBUTE = 'data-sin-fuente';

/**
 * Node types that can carry a mark.
 *
 * Wider than `BlockId`'s list on purpose: the writer is told to mark the
 * SMALLEST element that covers the passage, and that is often a single `<li>`
 * inside a list whose other items are perfectly grounded.
 *
 * `svgBlock` is absent for the same reason it is absent there — it renders by
 * handing ProseMirror the raw `<svg>`, bypassing attribute serialisation, so a
 * mark stamped on it could never reach storage.
 */
const DEFAULT_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock'
];

export interface SinFuenteOptions {
  types: string[];
}

export const SinFuente = Extension.create<SinFuenteOptions>({
  name: 'sinFuente',

  addOptions() {
    return { types: DEFAULT_TYPES };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          sinFuente: {
            default: null,
            /**
             * `keepOnSplit: true`, unlike the block id next door, and the
             * asymmetry is the point.
             *
             * Splitting a marked paragraph in two leaves both halves made of
             * the text that was marked. Keeping the mark can produce a spurious
             * one, which the teacher reads and removes; dropping it unmarks
             * invented content silently. The first costs a second of attention,
             * the second is the failure we are paying for all of this to avoid,
             * so this fails TOWARDS marked.
             */
            keepOnSplit: true,
            parseHTML: (element) => element.getAttribute(SIN_FUENTE_ATTRIBUTE),
            renderHTML: (attrs) => (attrs.sinFuente ? { [SIN_FUENTE_ATTRIBUTE]: attrs.sinFuente } : {})
          }
        }
      }
    ];
  }
});

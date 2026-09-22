import { Extension } from '@tiptap/core';

/**
 * Keeps the writer's `data-ejemplo` marks alive through the editor.
 *
 * The mark says "I made this example up": the name, the number, the error code
 * in it come from nowhere and nobody should go looking for them in the source
 * material. That is not the same thing as `data-sin-fuente` next door, which
 * says "the material does not back this claim about the organisation" — one is
 * a deliberate teaching device, the other is a gap for the teacher to close.
 *
 * TipTap drops any attribute no extension declares, silently, so without this
 * the first time a teacher opens the lesson and saves it every mark on the page
 * disappears — including on passages they never looked at. The server then
 * checks the unmarked names and numbers against the sources and hands them back
 * as a gate, so the lost mark does not fail quietly: it turns a declared example
 * into an unexplained invention on the next check.
 *
 * There is deliberately no UI here yet, for the same reason as `SinFuente`:
 * whether the writer uses the mark at all is being measured first.
 */

export const EJEMPLO_ATTRIBUTE = 'data-ejemplo';

/**
 * Node types that can carry a mark.
 *
 * The same list as `SinFuente`: the writer is told to mark the SMALLEST element
 * that covers the example, which is often a single `<li>` of a list whose other
 * items are grounded, or the whole `<ul>` when the list IS the example.
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

export interface EjemploOptions {
  types: string[];
}

export const Ejemplo = Extension.create<EjemploOptions>({
  name: 'ejemplo',

  addOptions() {
    return { types: DEFAULT_TYPES };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          ejemplo: {
            default: null,
            /**
             * `keepOnSplit: true`, like `SinFuente` and for the same reason.
             *
             * Splitting a marked paragraph in two leaves both halves made of the
             * text that was marked. Keeping the mark can produce a spurious one,
             * which costs a glance; dropping it un-declares an invented example
             * silently, and the next check reports its numbers as unsupported.
             * This fails TOWARDS marked.
             */
            keepOnSplit: true,
            parseHTML: (element) => element.getAttribute(EJEMPLO_ATTRIBUTE),
            renderHTML: (attrs) => (attrs.ejemplo ? { [EJEMPLO_ATTRIBUTE]: attrs.ejemplo } : {})
          }
        }
      }
    ];
  }
});

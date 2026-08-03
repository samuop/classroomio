import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Gives every top-level block a stable `data-block-id`.
 *
 * The point is not the editor — it is the agent. `edit_lesson_content` replaces
 * content by exact string match, so the model has to reproduce the fragment it
 * wants to change character for character, and getting one entity or one space
 * wrong fails the edit. That is the most common failure we see. With a block id
 * the server splices by id and the model only writes the replacement, the same
 * shape of fix the diagram regenerator already uses.
 *
 * Ids are assigned on the way in, never reassigned: an id that changed between
 * the read and the write would be worse than no id at all.
 */

export const BLOCK_ID_ATTRIBUTE = 'data-block-id';

/** Node types that get an id. Inline nodes and table internals are not addressable units. */
const DEFAULT_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'table',
  'image',
  'svgBlock',
  'lessonMedia',
  'horizontalRule'
];

export interface BlockIdOptions {
  types: string[];
  generateId: () => string;
}

function defaultGenerateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }

  return Math.random().toString(36).slice(2, 10);
}

export const BlockId = Extension.create<BlockIdOptions>({
  name: 'blockId',

  addOptions() {
    return {
      types: DEFAULT_TYPES,
      generateId: defaultGenerateId
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          blockId: {
            default: null,
            // `keepOnSplit: false`: pressing Enter makes a NEW block, and it must
            // not inherit the id of the one it was split from — two blocks with
            // one id makes a splice ambiguous.
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute(BLOCK_ID_ATTRIBUTE),
            renderHTML: (attrs) => (attrs.blockId ? { [BLOCK_ID_ATTRIBUTE]: attrs.blockId } : {})
          }
        }
      }
    ];
  },

  addProseMirrorPlugins() {
    const { types, generateId } = this.options;

    return [
      new Plugin({
        key: new PluginKey('blockId'),

        /**
         * Stamps blocks that arrived without an id — pasted content, AI output,
         * a note written before this existed — and any duplicate produced by
         * copy/paste, which would otherwise make an id ambiguous.
         */
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;

          const seen = new Set<string>();
          const patches: Array<{ pos: number; id: string }> = [];

          newState.doc.descendants((node, pos, parent) => {
            // Top level only: nesting ids inside list items or table cells would
            // multiply them without making anything more addressable.
            if (parent !== newState.doc) return false;
            if (!types.includes(node.type.name)) return;

            const current = node.attrs.blockId as string | null;
            if (!current || seen.has(current)) {
              patches.push({ pos, id: generateId() });
              return;
            }

            seen.add(current);
          });

          if (patches.length === 0) return null;

          const tr = newState.tr;
          patches.forEach(({ pos, id }) => {
            tr.setNodeAttribute(pos, 'blockId', id);
            seen.add(id);
          });

          // Not added to the undo stack: undoing a typed word should not also
          // strip the identity of the block it was typed into.
          return tr.setMeta('addToHistory', false);
        }
      })
    ];
  }
});

export default BlockId;

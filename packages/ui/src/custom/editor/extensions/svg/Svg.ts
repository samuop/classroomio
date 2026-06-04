import { Node, mergeAttributes } from '@tiptap/core';

/**
 * SVG node — preserves inline `<svg>` diagrams inside the editor.
 *
 * Why this exists: TipTap/ProseMirror only keeps nodes it has a schema for.
 * An inline `<svg>` (e.g. an AI-generated diagram in lesson content) has no
 * matching node, so on `setContent()` ProseMirror silently drops it — and the
 * next `getHTML()` re-saves the lesson without the diagram. This atom node
 * captures the full SVG markup as an attribute on parse and renders it back
 * verbatim, so the diagram survives loading, editing, and re-saving.
 *
 * The stored markup is shown read-only inside a sandboxed iframe in the editor
 * (mirroring SafeHtmlContent in the student view), so editor and learner render
 * the same way and the SVG can't run scripts against the editor DOM.
 */

export interface SvgOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    svgBlock: {
      /** Insert an SVG diagram from its raw `<svg>…</svg>` markup. */
      setSvg: (options: { markup: string }) => ReturnType;
    };
  }
}

function readSvgDimensions(markup: string): { width: string; height: string } {
  const widthMatch = markup.match(/\bwidth\s*=\s*["'](\d+)/i);
  const heightMatch = markup.match(/\bheight\s*=\s*["'](\d+)/i);
  return {
    width: widthMatch ? `${widthMatch[1]}px` : '100%',
    height: heightMatch ? `${heightMatch[1]}px` : '200px'
  };
}

function svgSrcdoc(rawSvg: string): string {
  return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center}svg{max-width:100%;height:auto}</style></head><body>${rawSvg}</body></html>`;
}

export const Svg = Node.create<SvgOptions>({
  name: 'svgBlock',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'svg-block'
      }
    };
  },

  addAttributes() {
    return {
      // The full `<svg …>…</svg>` markup, stored verbatim.
      markup: {
        default: '',
        // Capture the element's own outerHTML so nested children are preserved.
        parseHTML: (element) => element.outerHTML,
        // Keep markup out of the rendered DOM attributes (it goes in the iframe).
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'svg',
        // Only top-level svgs become nodes; svgs nested in other handled nodes
        // are left to their own parsing.
        priority: 60
      }
    ];
  },

  // Serialized form persisted to the DB: the raw SVG markup, so the student
  // view (SafeHtmlContent) renders it exactly as before. We bypass TipTap's
  // attribute-based rendering and inject the stored markup directly.
  renderHTML({ node }) {
    const markup = String(node.attrs.markup ?? '').trim();
    if (markup && typeof document !== 'undefined') {
      // ProseMirror's DOMSerializer accepts a parsed DOM node. Parse via an
      // HTML container (not image/svg+xml) so the <svg> lives in the same
      // document/namespace the editor serializes from — this avoids stray
      // xmlns rewrites and keeps getHTML() output byte-faithful to the source.
      const container = document.createElement('div');
      container.innerHTML = markup;
      const svgEl = container.querySelector('svg');
      if (svgEl) return svgEl as unknown as HTMLElement;
    }
    // SSR / parse-failure fallback: an empty placeholder div (never reaches the
    // student view, which renders from the persisted HTML string, not this).
    return ['div', mergeAttributes(this.options.HTMLAttributes)];
  },

  // In-editor presentation: a sandboxed iframe so the diagram is visible but
  // inert, matching the learner view.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.classList.add('svg-block');
      dom.setAttribute('contenteditable', 'false');

      const markup = String(node.attrs.markup ?? '').trim();
      const { width, height } = readSvgDimensions(markup);

      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', '');
      iframe.setAttribute('title', 'Embedded diagram');
      iframe.srcdoc = svgSrcdoc(markup);
      iframe.style.border = 'none';
      iframe.style.overflow = 'hidden';
      iframe.style.width = width;
      iframe.style.height = height;
      iframe.style.maxWidth = '100%';

      dom.appendChild(iframe);

      return { dom };
    };
  },

  addCommands() {
    return {
      setSvg:
        (options: { markup: string }) =>
        ({ tr, dispatch }) => {
          const node = this.type.create({ markup: options.markup });
          if (dispatch) {
            const { selection } = tr;
            tr.replaceRangeWith(selection.from, selection.to, node);
          }
          return true;
        }
    };
  }
});

export default Svg;

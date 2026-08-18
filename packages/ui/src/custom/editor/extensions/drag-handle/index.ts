import { Fragment, Node, Slice } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

import { EditorView } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { serializeForClipboard } from './ClipboardSerializer';

export interface GlobalDragHandleOptions {
  /**
   * The width of the drag handle
   */
  dragHandleWidth: number;

  /**
   * The treshold for scrolling
   */
  scrollTreshold: number;

  /*
   * The css selector to query for the drag handle. (eg: '.custom-handle').
   * If handle element is found, that element will be used as drag handle. If not, a default handle will be created
   */
  dragHandleSelector?: string;

  /**
   * Tags to be excluded for drag handle
   */
  excludedTags: string[];

  /**
   * Custom nodes to be included for drag handle
   */
  customNodes: string[];

  /**
   * onNodeChange callback for drag handle
   * @param data
   * @returns
   */
  onMouseMove?: (data: { node: Node; pos: number }) => void;
}
function absoluteRect(node: Element) {
  const data = node.getBoundingClientRect();
  const modal = node.closest('[role="dialog"]');

  if (modal) {
    const modalRect = modal.getBoundingClientRect();

    return {
      top: data.top - modalRect.top,
      left: data.left - modalRect.left,
      width: data.width
    };
  }
  return {
    top: data.top,
    left: data.left,
    width: data.width
  };
}

function nodeDOMAtCoords(coords: { x: number; y: number }, options: GlobalDragHandleOptions) {
  const selectors = [
    'li',
    'p:not(:first-child)',
    'pre',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    ...options.customNodes.map((node) => `[data-type=${node}]`)
  ].join(', ');
  return document
    .elementsFromPoint(coords.x, coords.y)
    .find((elem: Element) => elem.parentElement?.matches?.('.ProseMirror') || elem.matches(selectors));
}
function nodePosAtDOM(node: Element, view: EditorView, options: GlobalDragHandleOptions) {
  const boundingRect = node.getBoundingClientRect();

  return view.posAtCoords({
    left: boundingRect.left + 50 + options.dragHandleWidth,
    top: boundingRect.top + 1
  })?.inside;
}

function calcNodePos(pos: number, view: EditorView) {
  const $pos = view.state.doc.resolve(pos);
  if ($pos.depth > 1) return $pos.before($pos.depth);
  return pos;
}

/**
 * The element that actually scrolls behind the editor.
 *
 * Not assumed to be the window: this editor is embedded in an app shell capped
 * at `max-h-svh`, so `window.scrollTo` can be a no-op while a panel two levels
 * up is the thing with a scrollbar. Walking up from the editor and asking each
 * ancestor whether it both overflows AND is allowed to scroll finds the right
 * one wherever the consumer puts us; the document is the fallback.
 */
function findScrollParent(node: HTMLElement | null): HTMLElement {
  let current: HTMLElement | null = node;

  while (current && current !== document.body) {
    const { overflowY } = getComputedStyle(current);
    const scrolls = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';

    if (scrolls && current.scrollHeight > current.clientHeight) return current;

    current = current.parentElement;
  }

  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/** Pixels per frame at the very edge. Ramped by how deep into the zone the pointer is. */
const MAX_AUTO_SCROLL_STEP = 18;

/**
 * Scrolls the page while a block is dragged towards the top or bottom edge, so
 * a block can be moved somewhere that is not already on screen.
 *
 * Driven by requestAnimationFrame rather than by the drag events themselves.
 * `drag` only fires while the pointer MOVES, so the obvious implementation
 * stops scrolling exactly when the user does what feels natural — holds still
 * at the edge and waits for the page to come to them. The loop keeps going
 * until the pointer leaves the zone or the drag ends.
 *
 * Speed ramps with depth into the zone: a nudge past the threshold creeps, the
 * last few pixels move fast. A single fixed step is either too slow to cross a
 * long lesson or too fast to stop where you meant to.
 */
function attachDragAutoScroll(view: EditorView, threshold: number): () => void {
  let pointerY: number | null = null;
  let frame: number | null = null;

  const stop = () => {
    pointerY = null;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const step = () => {
    frame = null;
    if (pointerY === null) return;

    const scroller = findScrollParent(view.dom as HTMLElement);
    // The document scrolls against the viewport; an element against its own box.
    const isDocument = scroller === document.scrollingElement || scroller === document.documentElement;
    const top = isDocument ? 0 : scroller.getBoundingClientRect().top;
    const bottom = isDocument ? window.innerHeight : scroller.getBoundingClientRect().bottom;

    const fromTop = pointerY - top;
    const fromBottom = bottom - pointerY;
    let delta = 0;

    if (fromTop < threshold) {
      delta = -MAX_AUTO_SCROLL_STEP * Math.min(1, (threshold - fromTop) / threshold);
    } else if (fromBottom < threshold) {
      delta = MAX_AUTO_SCROLL_STEP * Math.min(1, (threshold - fromBottom) / threshold);
    }

    // `behavior: 'smooth'` is deliberately not used. Each call would restart an
    // animation towards a new target every frame, which fights itself and
    // crawls; frame-by-frame integer steps ARE the smooth scroll here.
    if (delta !== 0) scroller.scrollBy(0, delta);

    frame = requestAnimationFrame(step);
  };

  const onDragOver = (event: DragEvent) => {
    pointerY = event.clientY;
    if (frame === null) frame = requestAnimationFrame(step);
  };

  // Listened for on the document, not on the handle: once the pointer leaves the
  // editor the source element stops hearing about the drag, and the edge of the
  // screen is precisely where it has left.
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragend', stop);
  document.addEventListener('drop', stop);

  return () => {
    stop();
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('dragend', stop);
    document.removeEventListener('drop', stop);
  };
}

export function DragHandlePlugin(options: GlobalDragHandleOptions & { pluginKey: string }) {
  let listType = '';
  function handleDragStart(event: DragEvent, view: EditorView) {
    view.focus();

    if (!event.dataTransfer) return;

    const node = nodeDOMAtCoords(
      {
        x: event.clientX + 50 + options.dragHandleWidth,
        y: event.clientY
      },
      options
    );

    if (!(node instanceof Element)) return;

    let draggedNodePos = nodePosAtDOM(node, view, options);
    if (draggedNodePos == null || draggedNodePos < 0) return;
    draggedNodePos = calcNodePos(draggedNodePos, view);

    const { from, to } = view.state.selection;
    const diff = from - to;

    const fromSelectionPos = calcNodePos(from, view);
    let differentNodeSelected = false;

    const nodePos = view.state.doc.resolve(fromSelectionPos);

    // Check if nodePos points to the top level node
    if (nodePos.node().type.name === 'doc') differentNodeSelected = true;
    else {
      const nodeSelection = NodeSelection.create(view.state.doc, nodePos.before());

      // Check if the node where the drag event started is part of the current selection
      differentNodeSelected = !(
        draggedNodePos + 1 >= nodeSelection.$from.pos && draggedNodePos <= nodeSelection.$to.pos
      );
    }
    let selection = view.state.selection;
    if (!differentNodeSelected && diff !== 0 && !(view.state.selection instanceof NodeSelection)) {
      const endSelection = NodeSelection.create(view.state.doc, to - 1);
      selection = TextSelection.create(view.state.doc, draggedNodePos, endSelection.$to.pos);
    } else {
      selection = NodeSelection.create(view.state.doc, draggedNodePos);

      // if inline node is selected, e.g mention -> go to the parent node to select the whole node
      // if table row is selected, go to the parent node to select the whole node
      if (
        (selection as NodeSelection).node.type.isInline ||
        (selection as NodeSelection).node.type.name === 'tableRow'
      ) {
        const $pos = view.state.doc.resolve(selection.from);
        selection = NodeSelection.create(view.state.doc, $pos.before());
      }
    }
    view.dispatch(view.state.tr.setSelection(selection));

    // If the selected node is a list item, we need to save the type of the wrapping list e.g. OL or UL
    if (view.state.selection instanceof NodeSelection && view.state.selection.node.type.name === 'listItem') {
      listType = node.parentElement!.tagName;
    }

    const slice = view.state.selection.content();
    const { dom, text } = serializeForClipboard(view, slice);

    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/html', dom.innerHTML);
    event.dataTransfer.setData('text/plain', text);
    event.dataTransfer.effectAllowed = 'copyMove';

    event.dataTransfer.setDragImage(node, 0, 0);

    view.dragging = { slice, move: event.ctrlKey };
  }

  let dragHandleElement: HTMLElement | null = null;

  function hideDragHandle() {
    if (dragHandleElement) {
      dragHandleElement.classList.add('hide');
    }
  }

  function showDragHandle() {
    if (dragHandleElement) {
      dragHandleElement.classList.remove('hide');
    }
  }

  function hideHandleOnEditorOut(event: MouseEvent) {
    if (event.target instanceof Element) {
      // Keep handle visible while cursor moves into editor descendants or handle children.
      const relatedTarget = event.relatedTarget as HTMLElement;
      const isInsideEditor = !!relatedTarget?.closest('.tiptap, .drag-handle');

      if (isInsideEditor) return;
    }
    hideDragHandle();
  }

  return new Plugin({
    key: new PluginKey(options.pluginKey),
    view: (view) => {
      const handleBySelector = options.dragHandleSelector
        ? document.querySelector<HTMLElement>(options.dragHandleSelector)
        : null;
      dragHandleElement = handleBySelector ?? document.createElement('div');
      dragHandleElement.draggable = true;
      dragHandleElement.dataset.dragHandle = '';
      dragHandleElement.classList.add('drag-handle');

      function onDragHandleDragStart(e: DragEvent) {
        handleDragStart(e, view);
      }

      dragHandleElement.addEventListener('dragstart', onDragHandleDragStart);

      function onDragHandleDrag() {
        hideDragHandle();
      }

      dragHandleElement.addEventListener('drag', onDragHandleDrag);

      const detachAutoScroll = attachDragAutoScroll(view, options.scrollTreshold);

      hideDragHandle();

      if (!handleBySelector) {
        view?.dom?.parentElement?.appendChild(dragHandleElement);
      }
      view?.dom?.parentElement?.addEventListener('mouseout', hideHandleOnEditorOut);

      return {
        destroy: () => {
          if (!handleBySelector) {
            dragHandleElement?.remove?.();
          }
          dragHandleElement?.removeEventListener('drag', onDragHandleDrag);
          dragHandleElement?.removeEventListener('dragstart', onDragHandleDragStart);
          dragHandleElement = null;
          detachAutoScroll();
          view?.dom?.parentElement?.removeEventListener('mouseout', hideHandleOnEditorOut);
        }
      };
    },
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!view.editable) {
            return;
          }

          const node = nodeDOMAtCoords(
            {
              x: event.clientX + 50 + options.dragHandleWidth,
              y: event.clientY
            },
            options
          );

          const notDragging = node?.closest('.not-draggable');
          const excludedTagList = options.excludedTags.concat(['ol', 'ul']).join(', ');

          if (!(node instanceof Element) || node.matches(excludedTagList) || notDragging) {
            hideDragHandle();
            return;
          }

          const nodePos = nodePosAtDOM(node, view, options);
          if (nodePos !== undefined) {
            const currentNode = view.state.doc.nodeAt(nodePos);
            if (currentNode !== null) {
              options.onMouseMove?.({ node: currentNode, pos: nodePos });
            }
          }

          const compStyle = window.getComputedStyle(node);
          const parsedLineHeight = parseInt(compStyle.lineHeight, 10);
          const lineHeight = isNaN(parsedLineHeight) ? parseInt(compStyle.fontSize) * 1.2 : parsedLineHeight;
          const paddingTop = parseInt(compStyle.paddingTop, 10);

          const rect = absoluteRect(node);

          rect.top += (lineHeight - 24) / 2;
          rect.top += paddingTop;
          // Li markers
          if (node.matches('ul:not([data-type=taskList]) li, ol li')) {
            rect.left -= options.dragHandleWidth;
          }
          rect.width = options.dragHandleWidth;

          if (!dragHandleElement) return;

          dragHandleElement.style.left = `${rect.left - rect.width}px`;
          dragHandleElement.style.top = `${rect.top}px`;
          showDragHandle();
        },
        keydown: () => {
          hideDragHandle();
        },
        mousewheel: () => {
          hideDragHandle();
        },
        // dragging class is used for CSS
        dragstart: (view) => {
          view.dom.classList.add('dragging');
        },
        drop: (view, event) => {
          view.dom.classList.remove('dragging');
          hideDragHandle();
          let droppedNode: Node | null = null;
          const dropPos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY
          });

          if (!dropPos) return;

          if (view.state.selection instanceof NodeSelection) {
            droppedNode = view.state.selection.node;
          }
          if (!droppedNode) return;

          const resolvedPos = view.state.doc.resolve(dropPos.pos);

          const isDroppedInsideList = resolvedPos.parent.type.name === 'listItem';

          // If the selected node is a list item and is not dropped inside a list, we need to wrap it inside <ol> tag otherwise ol list items will be transformed into ul list item when dropped
          if (
            view.state.selection instanceof NodeSelection &&
            view.state.selection.node.type.name === 'listItem' &&
            !isDroppedInsideList &&
            listType == 'OL'
          ) {
            const newList = view.state.schema.nodes.orderedList?.createAndFill(null, droppedNode);
            const slice = new Slice(Fragment.from(newList), 0, 0);
            view.dragging = { slice, move: event.ctrlKey };
          }
        },
        dragend: (view) => {
          view.dom.classList.remove('dragging');
        }
      }
    }
  });
}

const GlobalDragHandle = Extension.create({
  name: 'globalDragHandle',

  addOptions() {
    return {
      dragHandleWidth: 20,
      scrollTreshold: 100,
      excludedTags: [],
      customNodes: []
    };
  },

  addProseMirrorPlugins() {
    return [
      DragHandlePlugin({
        pluginKey: 'globalDragHandle',
        dragHandleWidth: this.options.dragHandleWidth,
        scrollTreshold: this.options.scrollTreshold,
        dragHandleSelector: this.options.dragHandleSelector,
        excludedTags: this.options.excludedTags,
        customNodes: this.options.customNodes,
        onMouseMove: this.options.onMouseMove
      })
    ];
  }
});

export default GlobalDragHandle;

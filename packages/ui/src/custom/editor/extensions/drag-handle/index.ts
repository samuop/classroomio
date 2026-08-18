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
 * The nearest ancestor that can actually scroll the way we need to go.
 *
 * Asked fresh for each direction rather than picked once, because "has
 * overflow-y: auto and is taller than its box" is not the same question as "can
 * this thing move right now". A panel already scrolled to its bottom answers yes
 * to the first and no to the second, and the page behind it is what should move.
 *
 * The walk starts at the element under the POINTER, not at the editor: by the
 * time you are at the edge of the screen the pointer is usually outside the
 * editor entirely, and the thing under it is what the user expects to scroll.
 */
function findScrollableAncestor(from: Element | null, direction: -1 | 1): HTMLElement | null {
  let current: HTMLElement | null = from instanceof HTMLElement ? from : null;

  while (current && current !== document.body && current !== document.documentElement) {
    const { overflowY } = getComputedStyle(current);
    const canOverflow = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';

    if (canOverflow) {
      const remaining =
        direction < 0 ? current.scrollTop : current.scrollHeight - current.clientHeight - current.scrollTop;

      // A one-pixel gap is rounding, not somewhere to scroll to.
      if (remaining > 1) return current;
    }

    current = current.parentElement;
  }

  return null;
}

/** Pixels per frame at the very edge. Ramped by how deep into the zone the pointer is. */
const MAX_AUTO_SCROLL_STEP = 18;

/** Never let the edge zones eat more than this much of the viewport, top and bottom each. */
const MAX_ZONE_FRACTION = 0.15;

/** Below this the zone is too small to aim at on a short window. */
const MIN_ZONE_PX = 48;

/**
 * How close to the top or bottom edge counts as "asking to scroll".
 *
 * The caller's number is treated as a wish, not an instruction. One consumer
 * passes 1000, and the whole point of a threshold is the part of the screen it
 * does NOT cover: a zone taller than the window makes every pixel an edge, so
 * the page scrolled upward wherever the pointer went and never scrolled down at
 * all. Clamping to a fraction of the viewport guarantees a dead middle to aim
 * at, which is where a block actually gets dropped.
 */
function edgeZone(requested: number, viewportHeight: number): number {
  const cap = Math.max(MIN_ZONE_PX, viewportHeight * MAX_ZONE_FRACTION);
  return Math.min(Math.max(requested, 0) || cap, cap);
}

/**
 * Scrolls while a block is dragged towards the top or bottom of the WINDOW, so a
 * block can be moved somewhere that is not already on screen.
 *
 * The edges are the window's, not some container's, because that is the edge the
 * person is looking at. Which element then does the scrolling is a separate
 * question, answered per frame by walking up from under the pointer — this
 * editor is nested inside a lesson page inside a course shell, and which of
 * those owns the scrollbar is not something the editor should have to know.
 *
 * Driven by requestAnimationFrame rather than by the drag events. `dragover`
 * fires on movement, so an event-driven version stops scrolling exactly when the
 * user does the natural thing and holds still at the edge waiting for the page
 * to come to them.
 *
 * Speed ramps with depth into the zone: a nudge past the line creeps, the last
 * few pixels move fast. One fixed step is either too slow to cross a long lesson
 * or too fast to stop where you meant to.
 */
function attachDragAutoScroll(view: EditorView, threshold: number): () => void {
  let pointerY: number | null = null;
  let pointerX = 0;
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

    const viewportHeight = window.innerHeight;
    const zone = edgeZone(threshold, viewportHeight);

    const fromTop = pointerY;
    const fromBottom = viewportHeight - pointerY;

    let delta = 0;
    if (fromTop < zone) {
      delta = -MAX_AUTO_SCROLL_STEP * Math.min(1, (zone - fromTop) / zone);
    } else if (fromBottom < zone) {
      delta = MAX_AUTO_SCROLL_STEP * Math.min(1, (zone - fromBottom) / zone);
    }

    if (delta !== 0) {
      const direction: -1 | 1 = delta < 0 ? -1 : 1;
      const under = document.elementFromPoint(pointerX, Math.min(Math.max(pointerY, 0), viewportHeight - 1));
      const scroller = findScrollableAncestor(under ?? (view.dom as HTMLElement), direction);

      // `behavior: 'smooth'` is deliberately not used. Each call would restart an
      // animation towards a new target every frame, which fights itself and
      // crawls; frame-by-frame integer steps ARE the smooth scroll here.
      //
      // And if the element we picked did not actually move, the window gets the
      // scroll instead. An `overflow-x: hidden` wrapper computes to
      // `overflow-y: auto` whether its author meant it or not, and a couple of
      // pixels of sub-pixel rounding is enough to make one look scrollable — a
      // decoy that would otherwise swallow every frame while the page sat still.
      if (scroller) {
        const before = scroller.scrollTop;
        scroller.scrollBy(0, delta);
        if (scroller.scrollTop === before) window.scrollBy(0, delta);
      } else {
        window.scrollBy(0, delta);
      }
    }

    frame = requestAnimationFrame(step);
  };

  const onDragOver = (event: DragEvent) => {
    pointerY = event.clientY;
    pointerX = event.clientX;
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

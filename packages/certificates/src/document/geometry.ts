/**
 * Moving and resizing elements on the canvas.
 *
 * This lives with the document model rather than in the editor component
 * because it is arithmetic on a document, not on the DOM: it takes rectangles
 * and returns rectangles, knows nothing about pointers, and can therefore be
 * tested directly instead of through a browser.
 *
 * All coordinates are canvas units. The editor converts screen pixels to canvas
 * units by dividing by its zoom scale BEFORE calling in here, so nothing below
 * has to know how far the stage is zoomed.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The eight resize handles, named by the corner or edge they sit on. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** A line the editor draws while an element is snapped to something. */
export interface SnapGuide {
  axis: 'x' | 'y';
  /** Canvas coordinate of the line. */
  position: number;
}

export interface SnapResult extends Rect {
  guides: SnapGuide[];
}

/** How close, in canvas units, an edge has to be before it snaps. */
export const DEFAULT_SNAP_THRESHOLD = 6;

/**
 * Smallest an element may be resized to.
 *
 * Not zero: an element dragged to nothing is invisible, unselectable and
 * effectively lost — the teacher has no way to get it back short of undo, and
 * would not necessarily realise it happened.
 */
export const MIN_ELEMENT_SIZE = 8;

export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** The three x positions of a rect that can snap: left edge, centre, right edge. */
function xAnchors(rect: Rect): number[] {
  return [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
}

function yAnchors(rect: Rect): number[] {
  return [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
}

/**
 * Nudge a rect so its edges or centre line up with the canvas or its neighbours.
 *
 * Each axis is resolved independently and takes only the single closest target,
 * so an element cannot be pulled toward two different guides at once. The
 * canvas centre lines come first in the candidate list because centring is the
 * alignment a certificate needs most.
 */
export function snapRect(
  rect: Rect,
  others: Rect[],
  threshold: number = DEFAULT_SNAP_THRESHOLD
): SnapResult {
  const xTargets = [0, CANVAS_WIDTH / 2, CANVAS_WIDTH, ...others.flatMap(xAnchors)];
  const yTargets = [0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT, ...others.flatMap(yAnchors)];

  const guides: SnapGuide[] = [];
  let { x, y } = rect;

  let bestX: { delta: number; target: number } | null = null;
  for (const anchor of xAnchors(rect)) {
    for (const target of xTargets) {
      const delta = target - anchor;
      if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
        bestX = { delta, target };
      }
    }
  }

  let bestY: { delta: number; target: number } | null = null;
  for (const anchor of yAnchors(rect)) {
    for (const target of yTargets) {
      const delta = target - anchor;
      if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
        bestY = { delta, target };
      }
    }
  }

  if (bestX) {
    x += bestX.delta;
    guides.push({ axis: 'x', position: bestX.target });
  }

  if (bestY) {
    y += bestY.delta;
    guides.push({ axis: 'y', position: bestY.target });
  }

  return { ...rect, x, y, guides };
}

export interface ResizeOptions {
  /** Shift held: keep the original proportions. */
  preserveAspect?: boolean;
  minSize?: number;
}

/**
 * Resize from a handle.
 *
 * The rule that matters is the anchor: dragging the north-west handle must hold
 * the south-east corner still. Naively adding the delta to width and height
 * makes the element crawl across the canvas as it shrinks, which feels broken
 * even though every individual frame is "correct".
 *
 * A drag past the opposite edge stops at the minimum rather than inverting the
 * rectangle — flipping mid-drag loses the teacher's grip on which handle they
 * are holding.
 */
export function resizeRect(rect: Rect, handle: ResizeHandle, dx: number, dy: number, options: ResizeOptions = {}): Rect {
  const min = options.minSize ?? MIN_ELEMENT_SIZE;

  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;

  let { x, y, w, h } = rect;

  if (handle.includes('w')) {
    const nextX = Math.min(rect.x + dx, right - min);
    w = right - nextX;
    x = nextX;
  }

  if (handle.includes('e')) {
    w = Math.max(min, rect.w + dx);
  }

  if (handle.includes('n')) {
    const nextY = Math.min(rect.y + dy, bottom - min);
    h = bottom - nextY;
    y = nextY;
  }

  if (handle.includes('s')) {
    h = Math.max(min, rect.h + dy);
  }

  if (options.preserveAspect && rect.w > 0 && rect.h > 0) {
    const ratio = rect.w / rect.h;
    // Corner handles drive both axes, so the larger change wins and the other
    // follows; edge handles only have one axis to go on.
    const drivenByWidth = handle === 'e' || handle === 'w' || Math.abs(w - rect.w) >= Math.abs(h - rect.h);

    if (drivenByWidth) {
      const nextH = Math.max(min, w / ratio);
      if (handle.includes('n')) y = bottom - nextH;
      h = nextH;
    } else {
      const nextW = Math.max(min, h * ratio);
      if (handle.includes('w')) x = right - nextW;
      w = nextW;
    }
  }

  return { x, y, w, h };
}

/**
 * Bring a rect back within reach when it has been dragged off the canvas.
 *
 * Elements are allowed to bleed off the edge on purpose — a background band or
 * a decorative blob usually should. What is not allowed is losing one
 * completely: at least `visible` units stay on canvas so it can still be
 * grabbed.
 */
export function keepReachable(rect: Rect, visible = 24): Rect {
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, -rect.w + visible), CANVAS_WIDTH - visible),
    y: Math.min(Math.max(rect.y, -rect.h + visible), CANVAS_HEIGHT - visible)
  };
}

/** Topmost element whose box contains the point; locked elements are skipped. */
export function hitTest(
  elements: Array<Rect & { id: string; locked?: boolean }>,
  point: { x: number; y: number }
): string | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];

    if (element.locked) continue;

    if (
      point.x >= element.x &&
      point.x <= element.x + element.w &&
      point.y >= element.y &&
      point.y <= element.y + element.h
    ) {
      return element.id;
    }
  }

  return null;
}

/**
 * The arithmetic behind dragging and resizing.
 *
 * Kept out of the Svelte component so it can be tested as what it is —
 * rectangles in, rectangles out — rather than through simulated pointer events.
 * The cases below are the ones that feel broken to a user even when each
 * individual frame is defensible: an element that crawls while it shrinks, one
 * that inverts mid-drag, one that snaps to two guides at once, one that gets
 * dragged off the canvas and cannot be grabbed again.
 */
import { describe, expect, it } from 'vitest';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MIN_ELEMENT_SIZE,
  hitTest,
  keepReachable,
  moveRect,
  resizeRect,
  snapRect,
  type Rect
} from '@cio/certificates';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('moveRect', () => {
  it('translates without changing the size', () => {
    expect(moveRect(rect(10, 20, 100, 50), 5, -5)).toEqual({ x: 15, y: 15, w: 100, h: 50 });
  });
});

describe('snapRect', () => {
  it('snaps a left edge to the canvas edge', () => {
    const result = snapRect(rect(3, 300, 200, 40), []);

    expect(result.x).toBe(0);
    expect(result.guides).toContainEqual({ axis: 'x', position: 0 });
  });

  it('centres an element on the canvas when it is close', () => {
    // Centring is the alignment a certificate needs most, so it has to be easy
    // to land on rather than something you nudge at pixel by pixel.
    const width = 400;
    const nearlyCentred = CANVAS_WIDTH / 2 - width / 2 + 4;
    const result = snapRect(rect(nearlyCentred, 100, width, 40), []);

    expect(result.x + result.w / 2).toBe(CANVAS_WIDTH / 2);
  });

  it('aligns with a neighbour’s edge', () => {
    const neighbour = rect(200, 500, 100, 30);
    const result = snapRect(rect(204, 300, 80, 20), [neighbour]);

    expect(result.x).toBe(200);
  });

  it('leaves an element alone when nothing is within reach', () => {
    const result = snapRect(rect(137, 291, 80, 20), [rect(600, 600, 40, 40)]);

    expect(result.x).toBe(137);
    expect(result.y).toBe(291);
    expect(result.guides).toEqual([]);
  });

  it('takes only the closest target on each axis', () => {
    // Two candidates in range on the same axis must not both apply, or the
    // element lands between them, aligned with neither.
    const result = snapRect(rect(198, 100, 80, 20), [rect(200, 400, 50, 10), rect(203, 450, 50, 10)]);

    expect(result.x).toBe(200);
    expect(result.guides.filter((guide) => guide.axis === 'x')).toHaveLength(1);
  });

  it('snaps both axes independently', () => {
    const result = snapRect(rect(2, 3, 100, 40), []);

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.guides).toHaveLength(2);
  });

  it('respects a custom threshold', () => {
    expect(snapRect(rect(20, 300, 100, 40), [], 2).x).toBe(20);
    expect(snapRect(rect(20, 300, 100, 40), [], 40).x).toBe(0);
  });
});

describe('resizeRect', () => {
  it('holds the opposite corner still when dragging north-west', () => {
    // The bug this prevents: adding the delta to width and height instead, so
    // the element crawls across the canvas as it shrinks.
    const result = resizeRect(rect(100, 100, 200, 100), 'nw', 20, 10);

    expect(result.x + result.w).toBe(300);
    expect(result.y + result.h).toBe(200);
    expect(result.w).toBe(180);
    expect(result.h).toBe(90);
  });

  it('grows to the right without moving the left edge', () => {
    const result = resizeRect(rect(100, 100, 200, 100), 'e', 50, 0);

    expect(result.x).toBe(100);
    expect(result.w).toBe(250);
  });

  it('only touches one axis for an edge handle', () => {
    const result = resizeRect(rect(100, 100, 200, 100), 's', 999, 40);

    expect(result.w).toBe(200);
    expect(result.h).toBe(140);
  });

  it('stops at the minimum instead of inverting the rectangle', () => {
    // Flipping mid-drag loses the teacher's sense of which handle they hold.
    const result = resizeRect(rect(100, 100, 200, 100), 'w', 500, 0);

    expect(result.w).toBe(MIN_ELEMENT_SIZE);
    expect(result.x + result.w).toBe(300);
  });

  it('never returns a negative size', () => {
    const result = resizeRect(rect(100, 100, 200, 100), 'se', -999, -999);

    expect(result.w).toBeGreaterThanOrEqual(MIN_ELEMENT_SIZE);
    expect(result.h).toBeGreaterThanOrEqual(MIN_ELEMENT_SIZE);
  });

  it('keeps the proportions when asked, so a logo does not distort', () => {
    const result = resizeRect(rect(0, 0, 200, 100), 'se', 100, 0, { preserveAspect: true });

    expect(result.w / result.h).toBeCloseTo(2, 5);
  });

  it('keeps the anchored corner still while preserving proportions', () => {
    const result = resizeRect(rect(100, 100, 200, 100), 'nw', 40, 0, { preserveAspect: true });

    expect(result.x + result.w).toBe(300);
    expect(result.y + result.h).toBeCloseTo(200, 5);
  });
});

describe('keepReachable', () => {
  it('leaves an element that bleeds off the edge on purpose', () => {
    // A background band or a decorative blob is supposed to hang off the canvas.
    const result = keepReachable(rect(-90, -110, 380, 380));

    expect(result.x).toBe(-90);
    expect(result.y).toBe(-110);
  });

  it('pulls back an element dragged out of reach', () => {
    const result = keepReachable(rect(-500, 300, 100, 40));

    expect(result.x + result.w).toBeGreaterThanOrEqual(24);
  });

  it('pulls back one dragged past the far edge', () => {
    const result = keepReachable(rect(CANVAS_WIDTH + 400, CANVAS_HEIGHT + 400, 100, 40));

    expect(result.x).toBeLessThanOrEqual(CANVAS_WIDTH - 24);
    expect(result.y).toBeLessThanOrEqual(CANVAS_HEIGHT - 24);
  });
});

describe('hitTest', () => {
  const elements = [
    { id: 'under', ...rect(0, 0, 500, 500) },
    { id: 'over', ...rect(100, 100, 100, 100) }
  ];

  it('picks the topmost element under the point', () => {
    expect(hitTest(elements, { x: 150, y: 150 })).toBe('over');
  });

  it('falls through to what is beneath outside the top element', () => {
    expect(hitTest(elements, { x: 400, y: 400 })).toBe('under');
  });

  it('returns nothing on empty canvas', () => {
    expect(hitTest(elements, { x: 900, y: 900 })).toBeNull();
  });

  it('skips locked elements, so a background can be clicked through', () => {
    const locked = [{ id: 'bg', ...rect(0, 0, 1100, 780), locked: true }, elements[1]];

    expect(hitTest(locked, { x: 800, y: 700 })).toBeNull();
    expect(hitTest(locked, { x: 150, y: 150 })).toBe('over');
  });
});

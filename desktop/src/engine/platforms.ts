// Turns other apps' window rectangles into one-way platforms (their visible top edges)
// and keeps a standing character attached to a window as it moves.

import { clampToBounds, type Body, type Bounds, type Platform, type Wall } from "./physics";

/** An eligible window in overlay CSS pixels, as sent by Rust. Lists are front-to-back. */
export interface WindowRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Segments narrower than this (CSS px) are ignored as platforms. */
export const MIN_SEGMENT_WIDTH = 24;

type Interval = [number, number];

function subtract(intervals: Interval[], [a, b]: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [l, r] of intervals) {
    if (b <= l || a >= r) {
      out.push([l, r]);
      continue;
    }
    if (a > l) out.push([l, a]);
    if (b < r) out.push([b, r]);
  }
  return out;
}

/**
 * Visible top-edge segments of each window. A window's top edge is hidden wherever a
 * window in front of it covers that line, so the character can't land on edges you
 * can't see. Segments are clipped to the overlay and must lie strictly between the
 * ceiling and the floor.
 */
export function visibleTops(
  windows: readonly WindowRect[],
  bounds: Bounds,
  minWidth = MIN_SEGMENT_WIDTH,
): Platform[] {
  const result: Platform[] = [];
  windows.forEach((win, i) => {
    const top = win.y;
    if (top <= 0 || top >= bounds.height) return;
    let segments: Interval[] = [[Math.max(win.x, 0), Math.min(win.x + win.w, bounds.width)]];
    for (let j = 0; j < i && segments.length > 0; j++) {
      const front = windows[j];
      if (front.y <= top && top <= front.y + front.h) {
        segments = subtract(segments, [front.x, front.x + front.w]);
      }
    }
    for (const [left, right] of segments) {
      if (right - left >= minWidth) result.push({ id: win.id, left, right, top });
    }
  });
  return result;
}

/** Walls shorter than this (px) are ignored. */
export const MIN_WALL_HEIGHT = 3;

/**
 * Vertical boundaries where a taller window in front covers part of another window's top edge:
 * the front window's side, from its top down to the covered edge. Walking along the lower top
 * stops at that corner instead of dropping through behind the front window.
 */
export function junctionWalls(windows: readonly WindowRect[], bounds: Bounds): Wall[] {
  const walls: Wall[] = [];
  windows.forEach((win, i) => {
    const top = win.y;
    if (top <= 0 || top >= bounds.height) return;
    for (let j = 0; j < i; j++) {
      const front = windows[j];
      if (!(front.y <= top && top <= front.y + front.h)) continue;
      const wallTop = Math.max(0, front.y);
      if (top - wallTop < MIN_WALL_HEIGHT) continue;
      for (const x of [front.x, front.x + front.w]) {
        // Only where the side actually meets this window's top edge (and is on screen).
        if (x > win.x && x < win.x + win.w && x > 0 && x < bounds.width) walls.push({ id: front.id, x, top: wallTop, bottom: top });
      }
    }
  });
  return walls;
}

/**
 * Move a character standing on a window along with that window between two snapshots.
 * A pure move carries it horizontally and vertically; a resize only follows the top edge
 * so dragging a window's left edge doesn't drag the character with it. If the window
 * vanished (closed, minimised, hidden), the body is unchanged and the next physics step
 * finds no support and lets it fall.
 */
export function carry(
  body: Body,
  prev: readonly WindowRect[],
  next: readonly WindowRect[],
  bounds: Bounds,
): Body {
  if (!body.grounded || body.platformId === null) return body;
  const before = prev.find((w) => w.id === body.platformId);
  const after = next.find((w) => w.id === body.platformId);
  if (!before || !after) return body;
  const dx = after.w === before.w ? after.x - before.x : 0;
  const dy = after.y - before.y;
  if (dx === 0 && dy === 0) return body;
  return clampToBounds({ ...body, x: body.x + dx, y: body.y + dy }, bounds);
}

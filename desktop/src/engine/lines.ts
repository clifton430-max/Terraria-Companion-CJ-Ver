// Invisible platforms: straight lines (flat or sloped) drawn by the user that the character can
// land on, stand and walk on, and jump or drop through. Stored as fractions of the usable screen so
// they survive resolution changes. Pure geometry and editing rules; the editor is in
// overlay/lineLayer.ts.

import { MAX_WALK_SLOPE, type Platform } from "./physics";

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Matches `MAX_LINES` in `src-tauri/src/prefs.rs`. */
export const MAX_LINES = 100;
/** Shortest line that becomes a platform (CSS px). */
export const MIN_LINE_PX = 24;
/** A single line spans at most this share of the screen width, so it always has an edge to leave by. */
export const MAX_SPAN = 0.7;
/** Platform ids for lines: at or below this (blocks use small negative ids, windows positive ones). */
export const LINE_ID_BASE = -10_000_000;

export const isLineId = (id: number | null) => id !== null && id <= LINE_ID_BASE;

type Bounds = { width: number; height: number };
export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export const toPx = (l: Line, b: Bounds): Seg => ({ ax: l.x1 * b.width, ay: l.y1 * b.height, bx: l.x2 * b.width, by: l.y2 * b.height });
export const toFrac = (s: Seg, b: Bounds): Line => ({ x1: s.ax / b.width, y1: s.ay / b.height, x2: s.bx / b.width, y2: s.by / b.height });

export const segLength = (s: Seg) => Math.hypot(s.bx - s.ax, s.by - s.ay);

/** Can the character walk on this segment? Long enough and no steeper than the walkable slope. */
export function walkable(s: Seg): boolean {
  const dx = Math.abs(s.bx - s.ax);
  return segLength(s) >= MIN_LINE_PX && dx > 0 && Math.abs(s.by - s.ay) / dx <= MAX_WALK_SLOPE;
}

/** Valid saved lines (finite, on screen, not degenerate), capped. */
export function sanitizeLines(raw: readonly unknown[] | null | undefined): Line[] {
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  const out: Line[] = [];
  for (const r of raw ?? []) {
    if (out.length >= MAX_LINES) break;
    if (!r || typeof r !== "object") continue;
    const l = r as Partial<Line>;
    if (ok(l.x1) && ok(l.y1) && ok(l.x2) && ok(l.y2) && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) >= 0.005) out.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 });
  }
  return out;
}

/** One sloped one-way platform per walkable line (left end first). */
export function linePlatforms(lines: readonly Line[], b: Bounds): Platform[] {
  const out: Platform[] = [];
  lines.forEach((l, i) => {
    const s = toPx(l, b);
    if (!walkable(s)) return;
    const [left, right] = s.ax <= s.bx ? [{ x: s.ax, y: s.ay }, { x: s.bx, y: s.by }] : [{ x: s.bx, y: s.by }, { x: s.ax, y: s.ay }];
    out.push({ id: LINE_ID_BASE - i, left: left.x, right: right.x, top: left.y, topRight: right.y === left.y ? undefined : right.y });
  });
  return out;
}

/** Keep a segment on screen and within the span limit (the end being dragged gives way). */
export function constrain(s: Seg, b: Bounds, moving: "a" | "b" = "b"): Seg {
  const clampX = (x: number) => Math.min(Math.max(x, 0), b.width);
  const clampY = (y: number) => Math.min(Math.max(y, 0), b.height);
  let out = { ax: clampX(s.ax), ay: clampY(s.ay), bx: clampX(s.bx), by: clampY(s.by) };
  const maxDx = b.width * MAX_SPAN;
  const dx = out.bx - out.ax;
  if (Math.abs(dx) > maxDx) {
    const k = maxDx / Math.abs(dx);
    if (moving === "b") out = { ...out, bx: out.ax + dx * k, by: out.ay + (out.by - out.ay) * k };
    else out = { ...out, ax: out.bx - dx * k, ay: out.by - (out.by - out.ay) * k };
  }
  return out;
}

/**
 * Snap the moving end's angle: within 4° of flat snaps flat (so "horizontal" is easy); with
 * `steps`, to multiples of 15°.
 */
export function snapAngle(fixed: { x: number; y: number }, moving: { x: number; y: number }, steps: boolean): { x: number; y: number } {
  const dx = moving.x - fixed.x;
  const dy = moving.y - fixed.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return moving;
  let a = Math.atan2(dy, dx);
  const step = steps ? Math.PI / 12 : 0;
  if (step) a = Math.round(a / step) * step;
  else {
    const flat = Math.round(a / Math.PI) * Math.PI;
    if (Math.abs(a - flat) < (4 * Math.PI) / 180) a = flat;
    else return moving;
  }
  return { x: fixed.x + Math.cos(a) * len, y: fixed.y + Math.sin(a) * len };
}

/** Distance from a point to a segment. */
export function distToSeg(px: number, py: number, s: Seg): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (s.ax + dx * t), py - (s.ay + dy * t));
}

export type Pick = { index: number; part: "a" | "b" | "body" } | null;

/** What's under the pointer: an end handle (preferring the selected line), else a line body. */
export function pick(lines: readonly Line[], b: Bounds, x: number, y: number, selected: number | null, handle = 10, body = 8): Pick {
  const order = selected !== null && selected < lines.length ? [selected, ...lines.keys()] : [...lines.keys()];
  for (const i of order) {
    const s = toPx(lines[i], b);
    if (Math.hypot(x - s.ax, y - s.ay) <= handle) return { index: i, part: "a" };
    if (Math.hypot(x - s.bx, y - s.by) <= handle) return { index: i, part: "b" };
  }
  let best: Pick = null;
  let bestD = body;
  lines.forEach((l, i) => {
    const d = distToSeg(x, y, toPx(l, b));
    if (d <= bestD) {
      best = { index: i, part: "body" };
      bestD = d;
    }
  });
  return best;
}

/** Move a whole segment by (dx, dy), stopping at the screen edges. */
export function moveSeg(s: Seg, dx: number, dy: number, b: Bounds): Seg {
  const minX = Math.min(s.ax, s.bx);
  const maxX = Math.max(s.ax, s.bx);
  const minY = Math.min(s.ay, s.by);
  const maxY = Math.max(s.ay, s.by);
  const cx = Math.min(Math.max(dx, -minX), b.width - maxX);
  const cy = Math.min(Math.max(dy, -minY), b.height - maxY);
  return { ax: s.ax + cx, ay: s.ay + cy, bx: s.bx + cx, by: s.by + cy };
}

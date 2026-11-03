// The chess map's own miniatures: weathered stone chess pieces made for the graveyard, not the
// board game's sprites. Each is turned from a profile (radius by height, the way real pieces are
// carved on a lathe), the knight from its own outline, then shaded like old marble or obsidian lit
// from the upper left, and aged: grime pooled at the base, lichen, hairline cracks, chipped edges,
// and optionally snapped off at an angle. Small pixel images (12–26 px tall), scaled up with no
// smoothing.

import type { Color, PieceType } from "../chess/rules";

export type Army = Color;

/** Repeatable randomness. */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Stone tones, darkest to lightest (index 0 is the outline). */
const STONE: Record<Army, string[]> = {
  w: ["#2a2622", "#6d675c", "#958e80", "#b9b2a2", "#d6cfbe", "#ece6d6"],
  b: ["#120e18", "#2b2535", "#3d3549", "#544a63", "#6f6584", "#958ab0"],
};
const LICHEN = ["#7f8a70", "#9aa483"];

/**
 * Half-width (in pixels) of a turned piece at height `t` (0 = foot, 1 = top), or 0 for empty.
 * `w` is the widest half-width (the foot).
 */
export function profile(type: PieceType, t: number, w: number): number {
  const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.min(1, Math.max(0, u));
  const ball = (cy: number, r: number) => (Math.abs(t - cy) <= r ? Math.sqrt(r * r - (t - cy) ** 2) / r : 0);
  // A wide foot with a lip, common to all.
  if (t < 0.08) return w;
  if (t < 0.12) return w * 0.86;
  if (t < 0.16) return w * 0.92;
  switch (type) {
    case "p":
      if (t < 0.5) return w * lerp(0.62, 0.36, (t - 0.16) / 0.34);
      if (t < 0.56) return w * 0.62; // collar
      if (t < 0.6) return w * 0.3;
      return w * 0.52 * ball(0.79, 0.21);
    case "r":
      if (t < 0.7) return w * lerp(0.66, 0.56, (t - 0.16) / 0.54);
      if (t < 0.76) return w * 0.74;
      return w * 0.8;
    case "b":
      if (t < 0.5) return w * lerp(0.6, 0.32, (t - 0.16) / 0.34);
      if (t < 0.55) return w * 0.6;
      if (t < 0.58) return w * 0.3;
      if (t < 0.92) {
        const u = (t - 0.58) / 0.34; // the mitre: an egg, pointed at the top
        return w * 0.5 * Math.sqrt(Math.max(0, 1 - (2 * u - 0.75) ** 2 / 1.6)) * (u > 0.75 ? lerp(1, 0.2, (u - 0.75) / 0.25) : 1);
      }
      return w * 0.16 * ball(0.95, 0.04);
    case "q":
      if (t < 0.58) return w * lerp(0.6, 0.3, (t - 0.16) / 0.42);
      if (t < 0.62) return w * 0.58;
      if (t < 0.65) return w * 0.32;
      if (t < 0.84) return w * lerp(0.36, 0.66, (t - 0.65) / 0.19); // the cup flaring out
      if (t < 0.9) return w * 0.62; // the coronet (points cut in later)
      return w * 0.18 * ball(0.94, 0.05);
    case "k":
      if (t < 0.6) return w * lerp(0.62, 0.32, (t - 0.16) / 0.44);
      if (t < 0.64) return w * 0.6;
      if (t < 0.67) return w * 0.32;
      if (t < 0.82) return w * lerp(0.36, 0.6, (t - 0.67) / 0.15);
      if (t < 0.86) return w * 0.38;
      return w * 0.12; // the cross's upright (its arms added later)
    default:
      return 0;
  }
}

/** Relative heights (the king tallest, the pawn shortest), like a real set. */
export const HEIGHT: Record<PieceType, number> = { p: 0.62, r: 0.68, n: 0.78, b: 0.84, q: 0.94, k: 1 };

export interface Damage {
  /** Snap it at this height (0..1 of its height) along a slant, keeping the part below (or above). */
  snap?: { at: number; slant: number; keep: "base" | "top" };
  cracks: number;
  chips: number;
  lichen: number;
  /** Grime and weathering, 0..1. */
  age: number;
}

/** A pixel grid of palette indices (−1 transparent; 100+ lichen). */
type Grid = number[][];

function blank(w: number, h: number): Grid {
  return Array.from({ length: h }, () => new Array<number>(w).fill(-1));
}

/** The knight: its own outline (a horse's head on a turned base), as rows of half-open spans. */
function knightSpans(t: number, w: number): [number, number] | null {
  // x from -w..w; returns [left, right] of the solid span at height t.
  const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.min(1, Math.max(0, u));
  if (t < 0.08) return [-w, w];
  if (t < 0.12) return [-w * 0.86, w * 0.86];
  if (t < 0.16) return [-w * 0.92, w * 0.92];
  if (t < 0.3) return [-w * 0.62, w * 0.62];
  if (t < 0.55) return [lerp(-0.6, -0.5, (t - 0.3) / 0.25) * w, lerp(0.55, 0.62, (t - 0.3) / 0.25) * w]; // chest
  if (t < 0.7) return [lerp(-0.5, -0.78, (t - 0.55) / 0.15) * w, 0.6 * w]; // muzzle reaching forward (left)
  if (t < 0.78) return [-0.78 * w, 0.58 * w];
  if (t < 0.9) return [lerp(-0.5, -0.1, (t - 0.78) / 0.12) * w, lerp(0.58, 0.4, (t - 0.78) / 0.12) * w]; // forehead
  if (t < 0.97) return [0.05 * w, 0.32 * w]; // ears
  return null;
}

/** Turn and age one piece into a palette grid. */
export function carve(type: PieceType, height: number, seed: number, d: Damage): Grid {
  const r = rng(seed);
  const H = Math.max(8, Math.round(height));
  const w = Math.max(3, Math.round(H * 0.24)); // foot half-width
  const W = w * 2 + 3;
  const g = blank(W, H);
  const cx = w + 1;
  for (let y = 0; y < H; y++) {
    const t = 1 - (y + 0.5) / H;
    let span: [number, number] | null;
    if (type === "n") span = knightSpans(t, w);
    else {
      const hw = profile(type, t, w);
      span = hw > 0.35 ? [-hw, hw] : null;
    }
    if (!span) continue;
    const [a, b] = span;
    for (let x = Math.round(cx + a); x <= Math.round(cx + b); x++) if (x >= 0 && x < W) g[y][x] = 3;
  }
  // Details cut into the turned shape.
  const row = (t: number) => Math.min(H - 1, Math.max(0, Math.round((1 - t) * H)));
  if (type === "r") {
    // Crenellations: notches along the top.
    for (let x = 0; x < W; x++) if (((x - cx) % 3 + 3) % 3 === 0 && Math.abs(x - cx) < w * 0.8) for (let y = 0; y < Math.max(1, Math.round(H * 0.08)); y++) g[y][x] = -1;
  }
  if (type === "q") {
    // Coronet points.
    const y0 = row(0.9);
    for (let x = 0; x < W; x++) if (g[y0]?.[x] === 3 && (x - cx) % 2 !== 0) for (let y = y0 - 1; y >= y0 - Math.max(1, Math.round(H * 0.05)); y--) if (y >= 0) g[y][x] = 3;
  }
  if (type === "k") {
    // The cross's arms.
    const y = row(0.94);
    for (let x = cx - Math.max(1, Math.round(w * 0.35)); x <= cx + Math.max(1, Math.round(w * 0.35)); x++) if (g[y]) g[y][x] = 3;
  }
  if (type === "b") {
    // The mitre's slit.
    const y0 = row(0.82);
    for (let k = 0; k < Math.max(2, Math.round(H * 0.1)); k++) if (g[y0 + k]) g[y0 + k][cx + 1 - k] = 1;
  }
  // Shade: lit from the upper left, as a turned (round) surface.
  for (let y = 0; y < H; y++) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < W; x++)
      if (g[y][x] >= 0) {
        if (a < 0) a = x;
        b = x;
      }
    if (a < 0) continue;
    for (let x = a; x <= b; x++) {
      if (g[y][x] < 0) continue;
      const u = b === a ? 0 : ((x - a) / (b - a)) * 2 - 1; // -1 left .. 1 right
      const lit = 0.55 - u * 0.42 + Math.sqrt(Math.max(0, 1 - u * u)) * 0.25;
      g[y][x] = g[y][x] === 1 ? 1 : Math.max(1, Math.min(5, Math.round(1 + lit * 4.2)));
    }
  }
  // Age: grime pools low down, speckled weathering everywhere.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y][x] < 1) continue;
      const low = y / H;
      if (r() < d.age * (0.12 + low * 0.35)) g[y][x] = Math.max(1, g[y][x] - 1);
      if (r() < d.age * 0.05) g[y][x] = Math.max(1, g[y][x] - 2);
    }
  // Lichen in a few soft patches.
  for (let i = 0; i < d.lichen; i++) {
    const px = Math.floor(r() * W);
    const py = Math.floor(H * (0.4 + r() * 0.6));
    for (let k = 0; k < 5; k++) {
      const x = px + Math.floor(r() * 3) - 1;
      const y = py + Math.floor(r() * 3) - 1;
      if (g[y]?.[x] !== undefined && g[y][x] >= 1) g[y][x] = 100 + (r() < 0.5 ? 0 : 1);
    }
  }
  // Hairline cracks: short wandering dark lines.
  for (let i = 0; i < d.cracks; i++) {
    let x = Math.floor(r() * W);
    let y = Math.floor(r() * H);
    for (let k = 0; k < H * 0.5; k++) {
      if (g[y]?.[x] !== undefined && g[y][x] >= 1) g[y][x] = 1;
      y += 1;
      x += r() < 0.33 ? -1 : r() < 0.5 ? 1 : 0;
    }
  }
  // Snapped: cut along a slanted line, with a jagged, lighter break face.
  if (d.snap) {
    const { at, slant, keep } = d.snap;
    for (let x = 0; x < W; x++) {
      const cut = Math.round((1 - at) * H + (x - cx) * slant + (r() < 0.4 ? (r() < 0.5 ? -1 : 1) : 0));
      for (let y = 0; y < H; y++) {
        const above = y < cut;
        if ((keep === "base" && above) || (keep === "top" && !above)) g[y][x] = -1;
        else if (g[y][x] >= 1 && (y === cut || y === cut - 1)) g[y][x] = 4; // fresh stone at the break
      }
    }
  }
  // Chips knocked out of the edges.
  for (let i = 0; i < d.chips; i++) {
    const y = Math.floor(r() * H);
    const fromLeft = r() < 0.5;
    const xs = g[y].map((v, x) => (v >= 0 ? x : -1)).filter((x) => x >= 0);
    if (!xs.length) continue;
    const x = fromLeft ? xs[0] : xs[xs.length - 1];
    for (let k = 0; k < 2; k++) if (g[y + k]?.[x] !== undefined) g[y + k][x] = -1;
  }
  // Outline every solid pixel next to an empty one in the darkest tone, except along the lit
  // upper-left edge, which catches a rim of light (so dark stone still reads on dark wallpaper).
  const out = g.map((rowv) => rowv.slice());
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y][x] < 0) continue;
      const empty = (xx: number, yy: number) => (g[yy]?.[xx] ?? -1) < 0;
      if (empty(x - 1, y) || empty(x, y - 1)) out[y][x] = g[y][x] >= 100 ? g[y][x] : 5;
      else if (empty(x + 1, y) || empty(x, y + 1)) out[y][x] = 0;
    }
  return out;
}

/** The grid as a canvas in an army's stone. */
export function paint(g: Grid, army: Army): HTMLCanvasElement {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = g[y][x];
      if (v < 0) continue;
      ctx.fillStyle = v >= 100 ? LICHEN[v - 100] : STONE[army][v];
      ctx.fillRect(x, y, 1, 1);
    }
  return c;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A weathered miniature (cached by its look). */
export function miniature(army: Army, type: PieceType, height: number, seed: number, d: Damage): HTMLCanvasElement {
  const key = `${army}${type}${Math.round(height)}|${seed}|${d.snap ? `${d.snap.at.toFixed(2)},${d.snap.slant.toFixed(2)},${d.snap.keep}` : "-"}|${d.cracks},${d.chips},${d.lichen},${d.age.toFixed(2)}`;
  let c = sprites.get(key);
  if (!c) {
    c = paint(carve(type, height, seed, d), army);
    sprites.set(key, c);
  }
  return c;
}

/** Lowest solid row of a grid (where it meets the ground when upright). */
export function footRow(g: Grid): number {
  for (let y = g.length - 1; y >= 0; y--) if (g[y].some((v) => v >= 0)) return y;
  return -1;
}

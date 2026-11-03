// Placed blocks (Build mode): a Terraria-style tile grid anchored to the bottom-left of the
// screen, one 16-px tile per cell at the character's art scale. Pure logic: placement rules, the
// tile framing (which piece of the tile sheet each block shows, from its neighbours) and the
// physics surfaces the blocks make (tops to stand on, solid sides, undersides). Blocks exist only
// in the companion's overlay; nothing on the real desktop changes.

import type { Ceiling, Platform, Wall } from "./physics";

export type BlockKind = "dirt" | "stone" | "wood";
export const BLOCK_KINDS: readonly BlockKind[] = ["dirt", "stone", "wood"];

/** Matches `MAX_BLOCKS` in `src-tauri/src/prefs.rs`. */
export const MAX_BLOCKS = 400;
export const MAX_COL = 1000;
export const MAX_ROW = 500;
/** Terraria tile size in art pixels (sheets use an 18-px stride: 16 + 2 px gap). */
export const TILE = 16;

export interface Block {
  c: number;
  r: number;
  k: BlockKind;
}

/** Real item icon and tile sheet for each kind (from the local install; drawn with fallbacks). */
export const BLOCK_ART: Record<BlockKind, { item: string; tiles: string; color: string; edge: string; name: string }> = {
  dirt: { item: "Images/Item_2", tiles: "Images/Tiles_0", color: "#976b4b", edge: "#5e3f2a", name: "Dirt Block" },
  stone: { item: "Images/Item_3", tiles: "Images/Tiles_1", color: "#808080", edge: "#4d4d4d", name: "Stone Block" },
  wood: { item: "Images/Item_9", tiles: "Images/Tiles_30", color: "#a97d5d", edge: "#6b4a33", name: "Wood" },
};

export interface Grid {
  /** CSS px per cell. */
  cell: number;
  /** y of the floor (the bottom of row 0). */
  floor: number;
  /** Screen width (cells beyond it can't be placed). */
  width: number;
}

const key = (c: number, r: number) => `${c},${r}`;

export const isBlockKind = (k: unknown): k is BlockKind => typeof k === "string" && (BLOCK_KINDS as readonly string[]).includes(k);

/** Valid, de-duplicated, capped blocks from saved data. */
export function sanitizeBlocks(raw: readonly unknown[] | null | undefined): Block[] {
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const b of raw ?? []) {
    if (out.length >= MAX_BLOCKS) break;
    if (!b || typeof b !== "object") continue;
    const x = b as Partial<Block>;
    if (!isBlockKind(x.k) || !Number.isInteger(x.c) || !Number.isInteger(x.r)) continue;
    const c = x.c as number;
    const r = x.r as number;
    if (c < 0 || c > MAX_COL || r < 0 || r > MAX_ROW || seen.has(key(c, r))) continue;
    seen.add(key(c, r));
    out.push({ c, r, k: x.k });
  }
  return out;
}

/** The cell under a point. */
export function cellAt(g: Grid, x: number, y: number): { c: number; r: number } {
  return { c: Math.floor(x / g.cell), r: Math.floor((g.floor - y) / g.cell) };
}

/** Screen rectangle of a cell. */
export function cellRect(g: Grid, c: number, r: number): { x: number; y: number; w: number; h: number } {
  return { x: c * g.cell, y: g.floor - (r + 1) * g.cell, w: g.cell, h: g.cell };
}

export type PlaceCheck = { ok: true } | { ok: false; reason: "occupied" | "limit" | "outside" | "body" };

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Can a block go here? Not on another block, not over the limit, not off screen, and never
 * inside the character (it would trap them).
 */
export function canPlace(blocks: readonly Block[], g: Grid, c: number, r: number, body?: { x: number; y: number; w: number; h: number }): PlaceCheck {
  if (c < 0 || r < 0 || c > MAX_COL || r > MAX_ROW || (c + 1) * g.cell > g.width + 0.5 || g.floor - (r + 1) * g.cell < 0) return { ok: false, reason: "outside" };
  if (blocks.some((b) => b.c === c && b.r === r)) return { ok: false, reason: "occupied" };
  if (blocks.length >= MAX_BLOCKS) return { ok: false, reason: "limit" };
  if (body) {
    // A little slack so a block can sit snugly beside or under the character.
    const inner = { x: body.x + body.w * 0.2, y: body.y + 2, w: body.w * 0.6, h: body.h - 4 };
    if (overlaps(cellRect(g, c, r), inner)) return { ok: false, reason: "body" };
  }
  return { ok: true };
}

export function place(blocks: readonly Block[], g: Grid, c: number, r: number, k: BlockKind, body?: { x: number; y: number; w: number; h: number }): Block[] | null {
  return canPlace(blocks, g, c, r, body).ok ? [...blocks, { c, r, k }] : null;
}

export function remove(blocks: readonly Block[], c: number, r: number): Block[] | null {
  const i = blocks.findIndex((b) => b.c === c && b.r === r);
  return i < 0 ? null : [...blocks.slice(0, i), ...blocks.slice(i + 1)];
}

export function occupancy(blocks: readonly Block[]): Set<string> {
  return new Set(blocks.map((b) => key(b.c, b.r)));
}

/**
 * Tile-sheet frame (art px) for a block from which neighbours are present, Terraria-style:
 * exposed edges get grassless rims and corners. `variant` (0–2) picks among the sheet's
 * alternative frames for the same shape so large areas don't look tiled.
 * Neighbours are blocks of any kind (mixed kinds merge like same-kind tiles, a simplification).
 */
export function tileFrame(up: boolean, down: boolean, left: boolean, right: boolean, variant: number): { x: number; y: number } {
  const v = ((variant % 3) + 3) % 3;
  const s = 18;
  const k = (u: boolean, d: boolean, l: boolean, r: boolean) => `${+u}${+d}${+l}${+r}`;
  switch (k(up, down, left, right)) {
    case "1111": return { x: s + v * s, y: s };
    case "0111": return { x: s + v * s, y: 0 };
    case "1011": return { x: s + v * s, y: 2 * s };
    case "1101": return { x: 0, y: v * s };
    case "1110": return { x: 4 * s, y: v * s };
    case "0101": return { x: v * 2 * s, y: 3 * s };
    case "0110": return { x: s + v * 2 * s, y: 3 * s };
    case "1001": return { x: v * 2 * s, y: 4 * s };
    case "1010": return { x: s + v * 2 * s, y: 4 * s };
    case "1100": return { x: 5 * s, y: v * s };
    case "0011": return { x: 6 * s + v * s, y: 4 * s };
    case "0100": return { x: 6 * s + v * s, y: 0 };
    case "1000": return { x: 6 * s + v * s, y: 3 * s };
    case "0001": return { x: 9 * s, y: v * s };
    case "0010": return { x: 12 * s, y: v * s };
    default: return { x: 9 * s + v * s, y: 3 * s }; // "0000": a lone block
  }
}

/** Stable per-cell variant so redraws don't flicker. */
export const tileVariant = (c: number, r: number) => (((c * 7 + r * 13) % 3) + 3) % 3;

/** Platform ids for blocks are small negative numbers (windows are positive, lines ≤ −10 000 000). */
export const isBlockId = (id: number) => id < 0 && id > -10_000_000;

/** Platform ids for blocks are negative (window ids are positive). */
export const blockTopId = (c: number, r: number) => -(1 + r * (MAX_COL + 1) + c);

export interface BlockSurfaces {
  platforms: Platform[];
  walls: Wall[];
  ceilings: Ceiling[];
}

/**
 * Physics surfaces for the blocks: each run of exposed tops in a row is a platform (solid: no
 * dropping through), each exposed side a solid wall (walking up one block is automatic), and
 * each exposed underside a ceiling.
 */
export function blockSurfaces(blocks: readonly Block[], g: Grid): BlockSurfaces {
  const occ = occupancy(blocks);
  const has = (c: number, r: number) => occ.has(key(c, r));
  const platforms: Platform[] = [];
  const walls: Wall[] = [];
  const ceilings: Ceiling[] = [];
  const sorted = [...blocks].sort((a, b) => a.r - b.r || a.c - b.c);
  // Which top-run platform covers each exposed top cell.
  const topRun = new Map<string, number>();
  for (const b of sorted) {
    if (has(b.c, b.r + 1) || topRun.has(key(b.c, b.r))) continue;
    let end = b.c;
    while (has(end + 1, b.r) && !has(end + 1, b.r + 1)) end++;
    const id = blockTopId(b.c, b.r);
    for (let c = b.c; c <= end; c++) topRun.set(key(c, b.r), id);
    platforms.push({ id, left: b.c * g.cell, right: (end + 1) * g.cell, top: g.floor - (b.r + 1) * g.cell });
  }
  // Undersides (row 0 rests on the floor).
  const seenCeil = new Set<string>();
  for (const b of sorted) {
    if (b.r === 0 || has(b.c, b.r - 1) || seenCeil.has(key(b.c, b.r))) continue;
    let end = b.c;
    while (has(end + 1, b.r) && !has(end + 1, b.r - 1) && end + 1 - b.c < MAX_COL) end++;
    for (let c = b.c; c <= end; c++) seenCeil.add(key(c, b.r));
    ceilings.push({ left: b.c * g.cell, right: (end + 1) * g.cell, y: g.floor - b.r * g.cell });
  }
  // Sides: vertical runs of exposed left / right faces.
  for (const side of [-1, 1] as const) {
    const done = new Set<string>();
    for (const b of [...sorted].sort((a, c) => a.c - c.c || a.r - c.r)) {
      if (has(b.c + side, b.r) || done.has(key(b.c, b.r))) continue;
      let top = b.r;
      while (has(b.c, top + 1) && !has(b.c + side, top + 1)) top++;
      for (let r = b.r; r <= top; r++) done.add(key(b.c, r));
      const liftTo = topRun.get(key(b.c, top));
      walls.push({
        id: blockTopId(b.c, top) - 2_000_000 * (side > 0 ? 1 : 2),
        x: (side < 0 ? b.c : b.c + 1) * g.cell,
        top: g.floor - (top + 1) * g.cell,
        bottom: g.floor - b.r * g.cell,
        solid: true,
        step: g.cell,
        liftTo,
      });
    }
  }
  return { platforms, walls, ceilings };
}

// The blueprint toolkit every build uses: an ordered task list where each tile attaches to
// something already built (like Terraria), with one task per spot and no furniture overlapping;
// doorsteps that ramp to the ground around; and finding flat ground to build on.

import { T, type WorldMap, type Zone } from "../gen";
import { OBJECTS, type ObjectType } from "./furniture";
import type { Project, ProjectKind, ProjectParams, Task } from "./house";

/**
 * A doorstep outside a door at column x (facing `dir`): level at floor height for three tiles,
 * then a gentle ramp (dug out or built up, one row per column) to the ground around, so the house
 * never cuts the way through.
 */
export function doorstep(b: Bp, map: WorldMap, x: number, g: number, dir: -1 | 1) {
  b.first(() => step(b, map, x, g, dir));
}

function step(b: Bp, map: WorldMap, x: number, g: number, dir: -1 | 1) {
  const RAMP = 18;
  for (let k = 1; k <= RAMP; k++) {
    const cx = x + dir * k;
    const ground = groundAt(map, cx);
    // Level for three tiles, then step toward the natural ground by up to a row per column.
    const level = k <= 3 ? g : ground > g ? Math.min(ground, g + (k - 3)) : Math.max(ground, g - (k - 3));
    if (k > 3 && level === ground) break;
    for (let y = level - 4; y < level; y++) b.clear(cx, y);
    // Solid underfoot a few rows down even where the ground is higher (so a hole dug there later
    // gets filled back in rather than leaving a pocket under the step); over a dip or a chasm
    // only a few rows (a bridge across it — builders sent to the bottom of a chasm stay there).
    for (let y = Math.max(Math.min(ground, level + 5), level + 3); y >= level; y--) b.tile(cx, y, T.Dirt);
  }
}

/**
 * The lowest row a foundation (or level ground) is filled down to at a column whose real ground
 * is at `ground`, for a floor at row g: all the way down over an ordinary dip, but only a few rows
 * over a deep pit, a cave or a mine shaft (the floor bridges it) — a column filled from the bottom
 * of a deep hole has builders climbing down into the hole, where they get stuck.
 */
export function fillFrom(ground: number, g: number): number {
  return ground + 1 - g <= 8 ? ground + 1 : g + 3;
}

export class Bp {
  tasks: Task[] = [];
  planned = new Map<number, number>();
  floors: Project["floors"] = [];
  rooms: Project["rooms"] = [];
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  private seenObj = new Set<number>();
  private head = 0;
  /** Tasks added by `fn` go to the front of the build order (doorsteps: the way in comes first, or
   * builders outside can't reach the work inside). */
  first(fn: () => void) {
    const rest = this.tasks;
    this.tasks = [];
    fn();
    const added = this.tasks;
    this.tasks = [...rest.slice(0, this.head), ...added, ...rest.slice(this.head)];
    this.head += added.length;
  }
  grow(x: number, y: number) {
    this.x0 = Math.min(this.x0, x);
    this.x1 = Math.max(this.x1, x);
    this.y0 = Math.min(this.y0, y);
    this.y1 = Math.max(this.y1, y);
  }
  tile(x: number, y: number, tile: number) {
    this.tasks.push({ kind: "tile", x, y, tile });
    this.planned.set(y * 65536 + x, tile);
    this.grow(x, y);
  }
  wall(x: number, y: number, wall: number) {
    this.tasks.push({ kind: "wall", x, y, wall });
    this.walls.add(y * 65536 + x);
    this.grow(x, y);
  }
  /** Where the build has walls (anything else cleared in its footprint loses its wall too). */
  walls = new Set<number>();
  obj(x: number, y: number, obj: ObjectType, style = 0) {
    const k = y * 65536 + x;
    if (this.seenObj.has(k)) return;
    this.seenObj.add(k);
    // Pieces can't overlap (one of them would never go in, and the house would never be finished):
    // something hung on the wall or the ceiling moves aside a little to a clear spot, else it's left out.
    const d = OBJECTS[obj];
    const shifts = d.support === "wall" || d.support === "ceiling" ? [0, -1, 1, -2, 2, -3, 3] : [0];
    const dx = shifts.find((s) => this.clearFor(x + s, y, d.w, d.h, s !== 0));
    if (dx === undefined) return;
    for (let i = 0; i < d.w; i++) for (let j = 0; j < d.h; j++) this.objCells.add((y + j) * 65536 + x + dx + i);
    this.tasks.push({ kind: "object", x: x + dx, y, obj, ...(style ? { style } : {}) });
  }
  private objCells = new Set<number>();
  private clearFor(x: number, y: number, w: number, h: number, moved: boolean): boolean {
    for (let i = 0; i < w; i++)
      for (let j = 0; j < h; j++) {
        const k = (y + j) * 65536 + x + i;
        if (this.objCells.has(k) || (moved && this.planned.has(k))) return false;
      }
    return true;
  }
  clear(x: number, y: number) {
    this.tasks.push({ kind: "clear", x, y });
  }
  chop(x: number) {
    this.tasks.push({ kind: "chop", x });
  }
  project(id: string, kind: ProjectKind, name: string, biome: Zone, door: { x: number; y: number }, params: ProjectParams): Project {
    return { id, kind, name, biome, x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1, tasks: oneEach(this.tasks), planned: this.planned, walls: this.walls, floors: this.floors, rooms: this.rooms, door, params };
  }
}

/**
 * One task per kind and spot: where two parts of a plan both put a block or a wall in the same
 * place (a tower against the main block, say), the later one wins, as it does in `planned`.
 * Otherwise the builders place one, which undoes the other, forever.
 */
export function oneEach(tasks: Task[]): Task[] {
  const key = (t: Task) => (t.kind === "tile" || t.kind === "wall" ? `${t.kind}:${t.x},${t.y}` : null);
  const last = new Map<string, Task>();
  for (const t of tasks) {
    const k = key(t);
    if (k) last.set(k, t);
  }
  return tasks.filter((t) => {
    const k = key(t);
    return !k || last.get(k) === t;
  });
}

/** The real ground in a column: the first standable tile from above (dug-out ground counts as gone). */
export function groundAt(map: WorldMap, x: number): number {
  const s = map.surface(x);
  for (let y = Math.max(1, s - 30); y < s + 60; y++) if (map.standable(x, y)) return y;
  return s;
}

/** A flat-ish spot near `nearX` for a footprint of width w (lowest height variation). */
export function chooseFlat(map: WorldMap, from: number, to: number, w: number, avoid: { x0: number; x1: number }[] = []): { x0: number; g: number } {
  let best = { x0: from, score: Infinity };
  const step = from <= to ? 1 : -1;
  for (let x0 = from; step > 0 ? x0 <= to : x0 >= to; x0 += step * 2) {
    if (avoid.some((a) => x0 <= a.x1 + 4 && x0 + w >= a.x0 - 4)) continue;
    const hs: number[] = [];
    for (let x = x0 - 1; x <= x0 + w; x++) hs.push(groundAt(map, x));
    const mean = hs.reduce((a, c) => a + c, 0) / hs.length;
    let score = hs.reduce((a, h) => a + Math.abs(h - mean), 0);
    // Not into water, and not over caves (hollow ground under the floor).
    for (let x = x0; x <= x0 + w; x += 3) if (map.liquid(x, map.surface(x) - 1)) score += 100;
    for (let i = 0; i < hs.length; i += 2) for (let y = hs[i] + 1; y <= hs[i] + 6; y++) if (!map.solid(x0 - 1 + i, y)) score += 3;
    // (Wide sites: deep dips and chasms under them are much worse than a bumpy top; so is a
    // chasm where the doorsteps ramp down either side.)
    if (w > 70) for (const h of hs) if (Math.abs(h - mean) > 8) score += 25;
    for (const x of [x0 - 12, x0 - 6, x0 + w + 6, x0 + w + 12]) if (groundAt(map, x) - mean > 10) score += 60;
    if (score < best.score) best = { x0, score };
  }
  const hs: number[] = [];
  for (let x = best.x0; x < best.x0 + w; x++) hs.push(groundAt(map, x));
  return { x0: best.x0, g: Math.round(hs.reduce((a, c) => a + c, 0) / hs.length) };
}

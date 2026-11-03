// Structures generated with the world, all from the seed: the Dungeon (Old Man at the door,
// Skeletron inside), underground cabins with loot chests, floating sky islands with a skyware
// house, corruption chasms with shadow orbs, bee hives with Queen Bee's larva, ruined houses in
// the underworld, and small settlements where a town NPC is waiting to be invited.
//
// Each structure is a list of rectangle operations (fill with a tile, carve air, set a wall),
// applied in order, so a tile lookup is a short scan; plus the furniture and chests to place
// the first time the world is opened, and where its NPC stands.

import { BEACH_W, CORRUPTION_AT, DESERT_AT, hash, HELL_TOP, jungleSideX, noise1, snowSideX, surfaceAt, T, W, WORLD, type Biome, type WorldSize } from "./terrain";
import { biomeAt } from "./terrain";

export type StructureKind = "dungeon" | "cabin" | "island" | "chasm" | "hive" | "ruin" | "settlement";

export interface GenObject {
  t: string;
  x: number;
  y: number;
  /** Furniture style / chest kind (see objects.ts). */
  style?: number;
  /** Loot table for chests and pots. */
  loot?: string;
}

interface Op {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tile?: number;
  wall?: number;
  /** Only replace solid ground (don't fill caves / air) — for linings. */
  overSolid?: boolean;
}

export interface Structure {
  kind: StructureKind;
  name: string;
  biome: Biome | "underworld" | "sky";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ops: Op[];
  objects: GenObject[];
  /** Town NPCs waiting here (settlements; the Old Man and the bound Mechanic in the dungeon). */
  npcs: { id: string; x: number; y: number; bound?: boolean }[];
}

class Builder {
  ops: Op[] = [];
  objects: GenObject[] = [];
  fill(x0: number, y0: number, x1: number, y1: number, tile: number, wall?: number) {
    this.ops.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), tile, wall });
  }
  carve(x0: number, y0: number, x1: number, y1: number, wall?: number) {
    this.fill(x0, y0, x1, y1, T.Air, wall);
  }
  wall(x0: number, y0: number, x1: number, y1: number, wall: number) {
    this.ops.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), wall });
  }
  lining(x0: number, y0: number, x1: number, y1: number, tile: number) {
    this.ops.push({ x0, y0, x1, y1, tile, overSolid: true });
  }
  /** A hollow room: walls of `tile` around air with a background wall. */
  room(x0: number, y0: number, x1: number, y1: number, tile: number, wall: number) {
    this.fill(x0, y0, x1, y1, tile);
    this.carve(x0 + 1, y0 + 1, x1 - 1, y1 - 1, wall);
  }
  obj(o: GenObject) {
    this.objects.push(o);
  }
  done(kind: StructureKind, name: string, biome: Structure["biome"], npcs: Structure["npcs"] = []): Structure {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const o of this.ops) {
      x0 = Math.min(x0, o.x0);
      y0 = Math.min(y0, o.y0);
      x1 = Math.max(x1, o.x1);
      y1 = Math.max(y1, o.y1);
    }
    return { kind, name, biome, x0, y0, x1, y1, ops: this.ops, objects: this.objects, npcs };
  }
}

/** Floor row for a building centred at cx (the surface there, flattened). */
const floorAt = (seed: number, cx: number, size: WorldSize) => surfaceAt(seed, cx, size);

/** A little house on the surface with a foundation down to the ground. */
function surfaceHouse(b: Builder, seed: number, cx: number, w: number, h: number, frame: number, wall: number, size: WorldSize) {
  const floor = floorAt(seed, cx, size);
  const x0 = cx - Math.floor(w / 2);
  const x1 = x0 + w - 1;
  // Clear the hill above and fill the dip below, so it stands level.
  b.carve(x0 - 2, floor - h - 6, x1 + 2, floor - 1);
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    const ground = surfaceAt(seed, x, size);
    if (ground > floor) b.fill(x, floor, x, ground + 1, T.Dirt);
  }
  b.fill(x0, floor, x1, floor, frame);
  b.room(x0, floor - h, x1, floor, frame, wall);
  // Doorways on both sides.
  b.carve(x0, floor - 3, x0, floor - 1, wall);
  b.carve(x1, floor - 3, x1, floor - 1, wall);
  return { x0, x1, floor, top: floor - h };
}

const DUNGEON_S = 185;

function dungeon(seed: number, size: WorldSize): Structure {
  const b = new Builder();
  const cx = snowSideX(seed, DUNGEON_S, size);
  const dir = cx < size.width / 2 ? 1 : -1; // halls run inland
  const floor = floorAt(seed, cx, size);
  // The entrance hall above ground.
  const ex0 = cx - 14;
  const ex1 = cx + 14;
  b.carve(ex0 - 3, floor - 26, ex1 + 3, floor - 1);
  for (let x = ex0 - 2; x <= ex1 + 2; x++) {
    const ground = surfaceAt(seed, x, size);
    if (ground > floor) b.fill(x, floor, x, ground + 2, T.BlueBrick);
  }
  b.room(ex0, floor - 18, ex1, floor + 2, T.BlueBrick, W.BlueBrick);
  b.fill(ex0 + 4, floor - 24, ex1 - 4, floor - 18, T.BlueBrick); // the tower
  b.carve(ex0 + 6, floor - 22, ex1 - 6, floor - 19, W.BlueBrick);
  b.carve(ex0, floor - 4, ex0, floor - 1, W.BlueBrick); // doors
  b.carve(ex1, floor - 4, ex1, floor - 1, W.BlueBrick);
  // The shaft and halls going down.
  const shaftX = cx - 3;
  let y = floor + 2;
  let hx = shaftX;
  const rooms: { x: number; y: number }[] = [];
  for (let level = 0; level < 4; level++) {
    const depth = 26 + Math.floor(hash(seed, 300, level) * 8);
    // shaft
    b.fill(hx - 2, y - 1, hx + 8, y + depth + 2, T.BlueBrick);
    b.carve(hx, y - 1, hx + 6, y + depth, W.BlueBrick);
    for (let py = y + 6; py < y + depth - 2; py += 7) b.fill(hx, py, hx + 6, py, T.Platform);
    y += depth;
    // hall
    const len = 46 + Math.floor(hash(seed, 301, level) * 20);
    const hx1 = hx + dir * len;
    b.fill(Math.min(hx, hx1) - 2, y - 7, Math.max(hx, hx1) + 8, y + 2, T.BlueBrick);
    b.carve(Math.min(hx, hx1), y - 6, Math.max(hx, hx1) + 6, y, W.BlueBrick);
    rooms.push({ x: Math.round((hx + hx1) / 2) + 3, y });
    hx = hx1;
  }
  // A chest in each hall, and the bound Mechanic in the deepest one.
  for (const r of rooms) b.obj({ t: "chest", x: r.x, y: r.y - 1, style: 2, loot: "dungeon" });
  for (const r of rooms) b.obj({ t: "torch", x: r.x - 6, y: r.y - 3 });
  const deep = rooms[rooms.length - 1];
  b.obj({ t: "chest", x: cx + 6, y: floor - 1, style: 0, loot: "surface" });
  return b.done("dungeon", "The Dungeon", "snow", [
    { id: "oldman", x: dir > 0 ? ex1 + 4 : ex0 - 4, y: floor },
    { id: "mechanic", x: deep.x + 8 * dir, y: deep.y, bound: true },
  ]);
}

function cabins(seed: number, size: WorldSize): Structure[] {
  const out: Structure[] = [];
  for (let k = 0; k < 11; k++) {
    const x = 330 + k * 340 + Math.floor(hash(seed, 310, k) * 120);
    if (x > size.width - 330) break;
    const biome = biomeAt(seed, x, size);
    const top = surfaceAt(seed, x, size);
    const y = top + 55 + Math.floor(hash(seed, 311, k) * 80);
    const [frame, wall] = biome === "snow" ? [T.BorealWood, W.Boreal] : biome === "jungle" ? [T.RichMahogany, W.RichMahogany] : biome === "desert" ? [T.SandstoneBrick, W.SandstoneBrick] : biome === "corruption" ? [T.EbonstoneBrick, W.EbonstoneBrick] : hash(seed, 312, k) < 0.5 ? [T.Wood, W.Wood] : [T.GrayBrick, W.GrayBrick];
    const b = new Builder();
    const w = 14 + Math.floor(hash(seed, 313, k) * 6);
    b.room(x, y - 7, x + w - 1, y, frame, wall);
    b.carve(x, y - 3, x, y - 1, wall);
    b.carve(x + w - 1, y - 3, x + w - 1, y - 1, wall);
    b.obj({ t: "chest", x: x + 2, y: y - 2, style: 0, loot: "cabin" });
    b.obj({ t: "torch", x: x + Math.floor(w / 2), y: y - 5 });
    if (hash(seed, 314, k) < 0.6) b.obj({ t: "table", x: x + w - 6, y: y - 2, style: 0 });
    out.push(b.done("cabin", `${biome === "snow" ? "Frozen" : biome === "jungle" ? "Overgrown" : biome === "desert" ? "Buried" : "Old"} Cabin`, biome));
  }
  return out;
}

function islands(seed: number, size: WorldSize): Structure[] {
  const out: Structure[] = [];
  const xs = [snowSideX(seed, 820, size), Math.round(size.width / 2 + (hash(seed, 320) < 0.5 ? -1 : 1) * 520), jungleSideX(seed, 760, size)];
  xs.forEach((cx, k) => {
    const b = new Builder();
    const y = 72 + Math.floor(hash(seed, 321, k) * 18);
    const rx = 22 + Math.floor(hash(seed, 322, k) * 8);
    // A lens of earth on a bed of cloud.
    for (let x = cx - rx; x <= cx + rx; x++) {
      const t = 1 - ((x - cx) / rx) ** 2;
      const depth = Math.max(1, Math.round(t * 9));
      b.fill(x, y + 1, x, y + depth, T.Dirt);
      b.fill(x, y, x, y, T.Grass);
      b.fill(x, y + depth + 1, x, y + depth + 2 + Math.round(t * 2), T.Cloud);
    }
    // The skyware house.
    const hx0 = cx - 7;
    const hx1 = cx + 7;
    b.room(hx0, y - 9, hx1, y, T.Sunplate, W.Disc);
    b.fill(hx0 + 3, y - 6, hx0 + 4, y - 4, T.Glass);
    b.fill(hx1 - 4, y - 6, hx1 - 3, y - 4, T.Glass);
    b.carve(hx0, y - 3, hx0, y - 1, W.Disc);
    b.carve(hx1, y - 3, hx1, y - 1, W.Disc);
    b.obj({ t: "chest", x: cx - 1, y: y - 2, style: 13, loot: "sky" });
    out.push(b.done("island", ["Cirrus Isle", "Nimbus Isle", "Stratus Isle"][k], "sky"));
  });
  return out;
}

function chasms(seed: number, size: WorldSize): Structure[] {
  const out: Structure[] = [];
  for (let k = 0; k < 3; k++) {
    const s = CORRUPTION_AT - 110 + k * 110 + Math.floor((hash(seed, 330, k) - 0.5) * 30);
    const cx = snowSideX(seed, s, size);
    const top = surfaceAt(seed, cx, size);
    const depth = 60 + Math.floor(hash(seed, 331, k) * 25);
    const b = new Builder();
    let lastX = cx;
    for (let y = top - 1; y < top + depth; y++) {
      const wob = Math.round((noise1(seed + 332 + k, y * 0.06) - 0.5) * 10);
      const x = cx + wob;
      const half = 2 + (y % 9 < 3 ? 1 : 0);
      b.lining(x - half - 2, y, x + half + 2, y, T.Ebonstone);
      b.carve(x - half, y, x + half, y, W.Ebonstone);
      lastX = x;
    }
    // Side pockets with shadow orbs (and a demon altar at the bottom).
    for (let p = 0; p < 3; p++) {
      const py = top + 20 + p * Math.floor(depth / 3.5);
      const side = (p + k) % 2 === 0 ? 1 : -1;
      const px = cx + side * 9;
      b.lining(px - 5, py - 5, px + 5, py + 2, T.Ebonstone);
      b.carve(Math.min(cx, px) - 2, py - 3, Math.max(cx, px) + 2, py, W.Ebonstone);
      b.obj({ t: "orb", x: px - 1, y: py - 1 });
    }
    const by = top + depth;
    b.lining(lastX - 8, by - 4, lastX + 8, by + 3, T.Ebonstone);
    b.carve(lastX - 6, by - 3, lastX + 6, by, W.Ebonstone);
    b.obj({ t: "altar", x: lastX - 1, y: by - 1 });
    out.push(b.done("chasm", ["Gloom Chasm", "Vile Rift", "Shadow Pit"][k], "corruption"));
  }
  return out;
}

function hives(seed: number, size: WorldSize): Structure[] {
  const out: Structure[] = [];
  for (let k = 0; k < 2; k++) {
    const cx = jungleSideX(seed, 480 + k * 340 + Math.floor(hash(seed, 340, k) * 80), size);
    const cy = surfaceAt(seed, cx, size) + 70 + Math.floor(hash(seed, 341, k) * 40);
    const rx = 18;
    const ry = 11;
    const b = new Builder();
    b.fill(cx - rx, cy - ry, cx + rx, cy + ry, T.Hive, W.Hive);
    // Carve the inside as an ellipse, row by row (rectangles per row).
    for (let y = cy - ry + 3; y <= cy + ry - 3; y++) {
      const t = 1 - ((y - cy) / (ry - 2.5)) ** 2;
      if (t <= 0) continue;
      const half = Math.floor((rx - 3) * Math.sqrt(t));
      b.carve(cx - half, y, cx + half, y, W.Hive);
    }
    // Round the outside off too.
    for (let y = cy - ry; y <= cy + ry; y++) {
      const t = 1 - ((y - cy) / (ry + 0.5)) ** 2;
      const half = Math.floor(rx * Math.sqrt(Math.max(0, t)));
      if (half < rx) {
        b.ops.push({ x0: cx - rx, y0: y, x1: cx - half - 1, y1: y });
        b.ops.push({ x0: cx + half + 1, y0: y, x1: cx + rx, y1: y });
      }
    }
    b.fill(cx - 3, cy + ry - 4, cx + 3, cy + ry - 3, T.Hive);
    b.obj({ t: "larva", x: cx - 1, y: cy + ry - 7 });
    out.push(b.done("hive", k === 0 ? "Buzzing Hive" : "Honeycomb Hollow", "jungle"));
  }
  return out;
}

function ruins(seed: number, size: WorldSize): Structure[] {
  const out: Structure[] = [];
  for (let k = 0; k < 4; k++) {
    const cx = 500 + k * 1050 + Math.floor(hash(seed, 350, k) * 300);
    if (cx > size.width - 300) break;
    const floor = HELL_TOP + 50;
    const b = new Builder();
    const w = 18 + Math.floor(hash(seed, 351, k) * 8);
    const frame = k % 2 === 0 ? T.ObsidianBrick : T.HellstoneBrick;
    const wall = k % 2 === 0 ? W.ObsidianBrick : W.HellstoneBrick;
    b.fill(cx - 4, floor + 1, cx + w + 4, floor + 3, T.ObsidianBrick);
    b.room(cx, floor - 10, cx + w, floor, frame, wall);
    // Broken roof and windows: ruins.
    b.carve(cx + 3, floor - 10, cx + 6, floor - 10, wall);
    b.carve(cx + w - 7, floor - 10, cx + w - 5, floor - 9, wall);
    b.carve(cx, floor - 4, cx, floor - 1, wall);
    b.carve(cx + w, floor - 4, cx + w, floor - 1, wall);
    b.obj({ t: "hellforge", x: cx + 3, y: floor - 2 });
    b.obj({ t: "chest", x: cx + w - 4, y: floor - 2, style: 3, loot: "shadow" });
    out.push(b.done("ruin", ["Ashen Ruin", "Molten Hall", "Cinder Keep", "Obsidian Spire"][k], "underworld"));
  }
  return out;
}

/** Small settlements: a house where a town NPC is waiting to be invited. */
function settlements(seed: number, size: WorldSize): Structure[] {
  const out: Structure[] = [];
  const spots: { x: number; npc: string; name: string; frame: number; wall: number; biome: Biome }[] = [
    { x: jungleSideX(seed, BEACH_W - 60, size), npc: "angler", name: "Driftwood Hut", frame: T.PalmWood, wall: W.Palm, biome: "ocean" },
    { x: jungleSideX(seed, 760, size), npc: "witchdoctor", name: "Vinewood Lodge", frame: T.RichMahogany, wall: W.RichMahogany, biome: "jungle" },
    { x: jungleSideX(seed, DESERT_AT + 40, size), npc: "dyetrader", name: "Oasis Camp", frame: T.SandstoneBrick, wall: W.SandstoneBrick, biome: "desert" },
    { x: snowSideX(seed, 640, size), npc: "stylist", name: "Frostpine Lodge", frame: T.BorealWood, wall: W.Boreal, biome: "snow" },
    { x: snowSideX(seed, 1180, size), npc: "dryad", name: "Mossy Grove", frame: T.LivingWood, wall: W.Leaf, biome: "forest" },
  ];
  for (const s of spots) {
    const b = new Builder();
    const h = surfaceHouse(b, seed, s.x, 12, 7, s.frame, s.wall, size);
    b.obj({ t: "table", x: h.x0 + 3, y: h.floor - 2, style: 0 });
    b.obj({ t: "chair", x: h.x0 + 6, y: h.floor - 2, style: 0 });
    b.obj({ t: "torch", x: h.x0 + 2, y: h.floor - 5 });
    out.push(b.done("settlement", s.name, s.biome, [{ id: s.npc, x: h.x0 + 8, y: h.floor }]));
  }
  return out;
}

const cache = new Map<string, Structure[]>();

/** Every generated structure in a world (memoised per seed and size). */
let last: { seed: number; size: WorldSize; list: Structure[] } | null = null;

export function structuresFor(seed: number, size: WorldSize = WORLD): Structure[] {
  if (last && last.seed === seed && last.size === size) return last.list;
  const key = `${seed}:${size.width}x${size.height}`;
  let s = cache.get(key);
  if (!s) {
    s = [dungeon(seed, size), ...cabins(seed, size), ...islands(seed, size), ...chasms(seed, size), ...hives(seed, size), ...ruins(seed, size), ...settlements(seed, size)];
    // Small worlds (tests) keep only what fits.
    s = s.filter((t) => t.x0 >= 0 && t.x1 < size.width && t.y1 < size.height + 4);
    cache.set(key, s);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
  }
  last = { seed, size, list: s };
  return s;
}

/** The structure tile at (x, y), if a structure decides it (`base` is the generated tile there). */
export function structureTile(list: readonly Structure[], x: number, y: number, base: number): number | undefined {
  for (const s of list) {
    if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
    for (let i = s.ops.length - 1; i >= 0; i--) {
      const o = s.ops[i];
      if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) continue;
      if (o.tile === undefined && o.wall === undefined) return T.Air; // rounding cut-outs
      if (o.tile === undefined) continue;
      if (o.overSolid && (base === T.Air || base === T.Water || base === T.Lava)) continue;
      return o.tile;
    }
  }
  return undefined;
}

/** The structure wall at (x, y), if any. */
export function structureWall(list: readonly Structure[], x: number, y: number): number {
  for (const s of list) {
    if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
    for (let i = s.ops.length - 1; i >= 0; i--) {
      const o = s.ops[i];
      if (o.wall !== undefined && x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) return o.wall;
    }
  }
  return 0;
}

/** The structure containing a tile (for zone labels). */
export function structureAt(list: readonly Structure[], x: number, y: number): Structure | undefined {
  return list.find((s) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
}

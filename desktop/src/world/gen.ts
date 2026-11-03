// A terrain-only Terraria-style world, generated deterministically from a seed: rolling surface
// hills of grass and dirt, clay pockets, sandy dips, stone below, ore veins, winding tunnels,
// big caverns deeper down, the odd surface cave entrance, and trees. No creatures, items or
// gameplay. Every tile is a pure function of (seed, x, y), so nothing has to be stored except
// the seed and the player's edits; chunks are generated on demand and cached (bounded).

// A Terraria-style world, generated deterministically from a seed: rolling surface hills, biomes
// (forest, snow, desert, jungle, corruption, oceans), caves and caverns with ores, underground
// mushroom fields, bee hives, the underworld, and structures (see structures.ts). Every tile is
// a pure function of (seed, x, y), so nothing has to be stored except the seed and the edits;
// chunks are generated on demand and cached (bounded).

import { structuresFor, structureTile, structureWall, structureAt, type Structure } from "./structures";
import {
  biomeAt,
  dirtDepth,
  entrance,
  fbm2,
  gemAt,
  hash,
  HELL_TOP,
  inMushroom,
  mushroomOpen,
  noise1,
  noise2,
  OCEAN_W,
  sandy,
  SEA_LEVEL,
  SOLID,
  STANDABLE,
  stoneCave,
  surfaceAt,
  T,
  TILE_COUNT,
  WALL_COUNT,
  WORLD,
  zoneAt,
  type Biome,
  type WorldSize,
  type Zone,
} from "./terrain";

export * from "./terrain";
export type { Structure } from "./structures";

/** Tile ids the user can place while editing. */
export const PLACEABLE: readonly { id: number; name: string }[] = [
  { id: T.Dirt, name: "Dirt" },
  { id: T.Stone, name: "Stone" },
  { id: T.Grass, name: "Grass" },
  { id: T.Wood, name: "Wood" },
  { id: T.Clay, name: "Clay" },
  { id: T.Sand, name: "Sand" },
  { id: T.GrayBrick, name: "Gray Brick" },
  { id: T.Glass, name: "Glass" },
];

/** Pure world generation for one tile (before edits). */
export function generatedTile(seed: number, x: number, y: number, size: WorldSize = WORLD): number {
  if (x < 0 || x >= size.width || y < 0) return T.Air;
  if (y >= size.height) return T.Stone;
  const base = naturalTile(seed, x, y, size);
  const s = structureTile(structuresFor(seed, size), x, y, base);
  return s ?? base;
}

/** The ground before structures. */
function naturalTile(seed: number, x: number, y: number, size: WorldSize): number {
  const top = surfaceAt(seed, x, size);
  if (y < top) {
    // The ocean's water, from the sea level down to the sea floor.
    const e = Math.min(x, size.width - 1 - x);
    return e < OCEAN_W && y >= SEA_LEVEL ? T.Water : T.Air;
  }
  if (y >= HELL_TOP - 8) return underworldTile(seed, x, y, size);
  if (inMushroom(seed, x, y, size)) {
    if (mushroomOpen(seed, x, y)) return T.Air;
    return mushroomOpen(seed, x, y - 1) ? T.MushroomGrass : T.Mud;
  }
  const t = forestTile(seed, x, y, top);
  if (t === T.Air) return t;
  const biome = biomeAt(seed, x, size);
  const depth = y - top;
  const dd = dirtDepth(seed, x);
  switch (biome) {
    case "ocean":
      return depth < dd + 4 ? T.Sand : t;
    case "desert":
      // Deep sand over hardened sand and sandstone.
      if (depth < dd + 12) return T.Sand;
      if (depth < dd + 40 && (t === T.Stone || t === T.Dirt)) return noise2(seed + 17, x * 0.05, y * 0.05) > 0.5 ? T.Sandstone : T.HardenedSand;
      return t;
    case "snow":
      if (depth < dd) return T.Snow;
      if (t === T.Stone && noise2(seed + 15, x * 0.07, y * 0.07) > 0.5) return T.Ice;
      return t;
    case "jungle":
      if (depth === 0) return T.JungleGrass;
      if (depth < dd + 6) return T.Mud;
      if (t === T.Dirt || (t === T.Stone && noise2(seed + 16, x * 0.06, y * 0.06) > 0.55)) return T.Mud;
      return t;
    case "corruption":
      if (t === T.Grass) return T.CorruptGrass;
      if (t === T.Stone) return T.Ebonstone;
      // Demonite instead of the usual ores (deeper than the topsoil).
      if ((t === T.Copper || t === T.Iron || t === T.Silver || t === T.Gold) && depth > 20) return T.Demonite;
      return t;
    case "crimson":
      if (t === T.Grass) return T.CrimsonGrass;
      if (t === T.Stone) return T.Crimstone;
      if ((t === T.Copper || t === T.Iron || t === T.Silver || t === T.Gold) && depth > 20) return T.Crimtane;
      return t;
    case "hallow":
      if (t === T.Grass) return T.HallowedGrass;
      if (t === T.Sand) return T.Pearlsand;
      if (t === T.Stone) return T.Pearlstone;
      return t;
    case "mushroom":
      // A glowing-mushroom grove on the surface: mushroom grass on mud.
      if (depth === 0 && t === T.Grass) return T.MushroomGrass;
      if (t === T.Dirt || t === T.Grass || t === T.Clay) return T.Mud;
      return t;
    default:
      return t;
  }
}

function forestTile(seed: number, x: number, y: number, top: number): number {
  const depth = y - top;
  // Caves: winding tunnels (ridged noise) below the topsoil, big caverns deeper down.
  const tunnel = Math.abs(fbm2(seed + 10, x * 0.035, y * 0.05, 2) - 0.5);
  const openTop = entrance(seed, x) ? 1 : 7;
  if (depth >= openTop && tunnel < 0.035 + Math.min(0.025, depth * 0.0004)) return T.Air;
  if (depth > 45 && fbm2(seed + 11, x * 0.015, y * 0.025, 3) > 0.64) return T.Air;
  const dd = dirtDepth(seed, x);
  if (depth < dd) {
    if (sandy(seed, x) && depth < 6) return T.Sand;
    if (depth === 0) return T.Grass;
    if (depth > 2 && noise2(seed + 12, x * 0.12, y * 0.12) > 0.78) return T.Clay;
    return T.Dirt;
  }
  // Rock layer: marble and granite caves, pockets of dirt and mud, gems, ore veins (richer and
  // rarer metals deeper).
  if (depth > 60) {
    const cave = stoneCave(seed, x, y);
    if (cave) return cave === "marble" ? T.Marble : T.Granite;
  }
  if (noise2(seed + 13, x * 0.08, y * 0.08) > 0.8) return depth < 80 ? T.Dirt : T.Mud;
  const gem = gemAt(seed, x, y, depth);
  if (gem) return gem;
  const ore = noise2(seed + 14, x * 0.25, y * 0.25);
  if (ore > 0.85) {
    // Each vein's metal: mostly copper and iron near the top, iron, silver and gold further down
    // (veins share a metal over an 8x8 patch).
    const metal = Math.max(0, Math.min(3, Math.floor(depth / 60 + hash(seed + 15, (x >> 3) * 977 + (y >> 3)) * 2 - 0.5)));
    return [T.Copper, T.Iron, T.Silver, T.Gold][metal];
  }
  return T.Stone;
}

/** Ash, hellstone and lava at the bottom of the world, with a wide open cavern to cross. */
function underworldTile(seed: number, x: number, y: number, size: WorldSize): number {
  const ceiling = HELL_TOP + 8 + Math.round((noise1(seed + 80, x * 0.03) - 0.5) * 10);
  const floor = HELL_TOP + 52 + Math.round((noise1(seed + 81, x * 0.02) - 0.5) * 12);
  if (y < HELL_TOP) {
    // The transition: rock turning to ash.
    return noise2(seed + 82, x * 0.1, y * 0.1) > 0.5 ? T.Ash : T.Stone;
  }
  if (y > ceiling && y < floor) {
    // Pillars of ash here and there; otherwise open.
    if (fbm2(seed + 83, x * 0.04, y * 0.06, 2) > 0.7) return T.Ash;
    return T.Air;
  }
  if (y >= floor && y <= floor + 3 && noise1(seed + 84, x * 0.04) > 0.58) return T.Lava;
  // Obsidian where lava met water long ago: a crust beside the pools, pockets in the ceiling.
  if (y === floor - 1 && noise1(seed + 84, x * 0.04) > 0.55) return T.Obsidian;
  if (y >= HELL_TOP && y <= ceiling && noise2(seed + 86, x * 0.15, y * 0.15) > 0.8) return T.Obsidian;
  if (y >= size.height - 6) return T.Lava;
  return noise2(seed + 85, x * 0.18, y * 0.18) > 0.78 ? T.Hellstone : T.Ash;
}

/** Background wall generated with the world (structures only; caves get their natural walls when drawn). */
export function generatedWall(seed: number, x: number, y: number, size: WorldSize = WORLD): number {
  return structureWall(structuresFor(seed, size), x, y);
}

/** Trees grow on flat grass (snow, jungle, corruption and beach palms too), spaced apart; trunk height (0 = no tree). */
export function treeAt(seed: number, x: number, size: WorldSize = WORLD): number {
  if (x < 3 || x >= size.width - 3) return 0;
  const p = hash(seed + 20, x);
  if (p > 0.11) return 0;
  // Keep trees apart: only the lowest roll among neighbours grows.
  for (let d = -3; d <= 3; d++) if (d !== 0 && hash(seed + 20, x + d) < p) return 0;
  const top = surfaceAt(seed, x, size);
  if (Math.abs(surfaceAt(seed, x - 1, size) - top) > 1 || Math.abs(surfaceAt(seed, x + 1, size) - top) > 1) return 0;
  const ground = generatedTile(seed, x, top, size);
  if (!TREE_GROUND.has(ground)) return 0;
  // Palms only on the beach (not under the water).
  if (ground === T.Sand && (biomeAt(seed, x, size) !== "ocean" || generatedTile(seed, x, top - 1, size) !== T.Air)) return 0;
  if (structureAt(structuresFor(seed, size), x, top - 1)) return 0;
  return 7 + Math.floor(hash(seed + 21, x) * 10);
}

const TREE_GROUND = new Set<number>([T.Grass, T.Snow, T.JungleGrass, T.CorruptGrass, T.Sand, T.HallowedGrass, T.CrimsonGrass, T.MushroomGrass]);

/** What kind of tree grows in a column (decides its look and its wood). */
export type TreeKind = "forest" | "boreal" | "mahogany" | "ebonwood" | "palm" | "pearlwood" | "shadewood" | "mushroom";
export function treeKind(biome: Biome): TreeKind {
  switch (biome) {
    case "snow":
      return "boreal";
    case "jungle":
      return "mahogany";
    case "corruption":
      return "ebonwood";
    case "crimson":
      return "shadewood";
    case "hallow":
      return "pearlwood";
    case "mushroom":
      return "mushroom";
    case "ocean":
      return "palm";
    default:
      return "forest";
  }
}

/** Desert cacti (height in tiles, 0 = none). */
export function cactusAt(seed: number, x: number, size: WorldSize = WORLD): number {
  if (biomeAt(seed, x, size) !== "desert") return 0;
  const p = hash(seed + 25, x);
  if (p > 0.07) return 0;
  for (let d = -4; d <= 4; d++) if (d !== 0 && hash(seed + 25, x + d) < p) return 0;
  return 2 + Math.floor(hash(seed + 26, x) * 4);
}

// ── The map: generation + edits, chunked ────────────────────────────────────────────────────

export const CHUNK = 32;
export const MAX_EDITS = 200_000;

export type Edits = Map<number, number>;
export const editKey = (x: number, y: number) => y * 65536 + x;

export class WorldMap {
  private chunks = new Map<number, Uint8Array>();
  /** Cached chunks are dropped beyond this (least recently used first). */
  maxChunks = 256;

  /** Placed (or removed) background walls, by tile key; 0 = removed. */
  readonly walls: Edits = new Map();
  /** Structures generated with this world. */
  readonly structures: Structure[];

  constructor(
    readonly seed: number,
    readonly edits: Edits = new Map(),
    readonly size: WorldSize = WORLD,
  ) {
    this.structures = structuresFor(seed, size);
  }

  private chunk(cx: number, cy: number): Uint8Array {
    const key = cy * 4096 + cx;
    let c = this.chunks.get(key);
    if (c) {
      // Refresh its place in the LRU order.
      this.chunks.delete(key);
      this.chunks.set(key, c);
      return c;
    }
    c = new Uint8Array(CHUNK * CHUNK);
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) c[y * CHUNK + x] = generatedTile(this.seed, cx * CHUNK + x, cy * CHUNK + y, this.size);
    this.chunks.set(key, c);
    while (this.chunks.size > this.maxChunks) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  /** The tile at (x, y), edits included. */
  tile(x: number, y: number): number {
    if (x < 0 || x >= this.size.width || y < 0) return T.Air;
    if (y >= this.size.height) return T.Stone;
    const e = this.edits.get(editKey(x, y));
    if (e !== undefined) return e;
    return this.chunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))[(y % CHUNK) * CHUNK + (x % CHUNK)];
  }

  /** Blocks movement (platforms don't: they are one-way; liquids neither). */
  solid(x: number, y: number) {
    return SOLID(this.tile(x, y));
  }

  /** Something to stand on (solid or a platform). */
  standable(x: number, y: number) {
    return STANDABLE(this.tile(x, y));
  }

  liquid(x: number, y: number): number {
    const t = this.tile(x, y);
    return t === T.Water || t === T.Lava ? t : 0;
  }

  /** The background wall at (x, y): placed, else generated (0 = none). */
  wall(x: number, y: number): number {
    const e = this.walls.get(editKey(x, y));
    if (e !== undefined) return e;
    return generatedWall(this.seed, x, y, this.size);
  }

  /** Place or remove (0) a wall; false if nothing changed or the edit limit is reached. */
  setWall(x: number, y: number, w: number): boolean {
    if (x < 0 || x >= this.size.width || y < 0 || y >= this.size.height || w < 0 || w >= WALL_COUNT) return false;
    if (this.wall(x, y) === w) return false;
    const k = editKey(x, y);
    if (generatedWall(this.seed, x, y, this.size) === w) this.walls.delete(k);
    else {
      if (!this.walls.has(k) && this.walls.size >= MAX_EDITS) return false;
      this.walls.set(k, w);
    }
    return true;
  }

  /** Trees (by column) and cacti that were chopped down. */
  readonly cut = new Set<number>();

  /** Change a tile (returns false if nothing changed or the edit limit is reached). */
  set(x: number, y: number, t: number): boolean {
    if (x < 0 || x >= this.size.width || y < 0 || y >= this.size.height) return false;
    if (this.tile(x, y) === t) return false;
    const k = editKey(x, y);
    if (generatedTile(this.seed, x, y, this.size) === t) this.edits.delete(k);
    else {
      if (!this.edits.has(k) && this.edits.size >= MAX_EDITS) return false;
      this.edits.set(k, t);
    }
    return true;
  }

  surface(x: number) {
    return surfaceAt(this.seed, x, this.size);
  }

  tree(x: number) {
    // A tree only stands if the ground under it is still there and the space above is clear.
    if (this.cut.has(x)) return 0;
    const h = treeAt(this.seed, x, this.size);
    if (!h) return 0;
    const top = this.surface(x);
    if (this.tile(x, top) !== generatedTile(this.seed, x, top, this.size) || this.solid(x, top - 1)) return 0;
    return h;
  }

  treeKind(x: number): TreeKind {
    return treeKind(this.biome(x));
  }

  cactus(x: number) {
    if (this.cut.has(x)) return 0;
    const h = cactusAt(this.seed, x, this.size);
    if (!h) return 0;
    const top = this.surface(x);
    if (this.tile(x, top) !== T.Sand || this.solid(x, top - 1)) return 0;
    return h;
  }

  biome(x: number): Biome {
    return biomeAt(this.seed, Math.max(0, Math.min(this.size.width - 1, Math.floor(x))), this.size);
  }

  /** The zone at a tile: a structure (dungeon, hive) or the biome / depth layer. */
  zone(x: number, y: number): Zone {
    const s = structureAt(this.structures, x, y);
    if (s?.kind === "dungeon" && y > this.surface(x) - 30) return "dungeon";
    if (s?.kind === "hive") return "hive";
    return zoneAt(this.seed, x, y, this.size);
  }

  /** How many chunks are cached (for tests / diagnostics). */
  get cached() {
    return this.chunks.size;
  }
}

// ── Saved edits ─────────────────────────────────────────────────────────────────────────────

export interface SavedWorld {
  version: 1 | 2;
  seed: number;
  /** [x, y, tile] triples. */
  edits: [number, number, number][];
  /** Columns whose tree / cactus was chopped down. */
  cut?: number[];
  /** Placed furniture and the like (see game/objects.ts), kept as given. */
  objects?: unknown[];
  /** Generated things that were taken (life crystals), by key. */
  taken?: number[];
  /** [x, y, wall] triples (0 = a generated wall removed). */
  walls?: [number, number, number][];
  /** Structure furniture and chests have been placed into `objects` (done once per world). */
  furnished?: boolean;
}

/** The extra saved state beside the edits (lenient; wrong seed → nothing). */
export function parseExtras(raw: string | null | undefined, seed: number): { cut: number[]; objects: unknown[]; taken: number[]; walls: [number, number, number][]; furnished: boolean } {
  const none = { cut: [], objects: [], taken: [], walls: [], furnished: false };
  if (!raw) return none;
  try {
    const v = JSON.parse(raw) as Partial<SavedWorld>;
    if (!v || v.seed !== seed) return none;
    const ints = (a: unknown) => (Array.isArray(a) ? a.filter((n): n is number => Number.isInteger(n)).slice(0, MAX_EDITS) : []);
    const walls = Array.isArray(v.walls)
      ? v.walls.filter((e): e is [number, number, number] => Array.isArray(e) && e.length === 3 && e.every((n) => Number.isInteger(n)) && e[2] >= 0 && e[2] < WALL_COUNT).slice(0, MAX_EDITS)
      : [];
    return { cut: ints(v.cut), objects: Array.isArray(v.objects) ? v.objects.slice(0, 8000) : [], taken: ints(v.taken), walls, furnished: v.furnished === true };
  } catch {
    return none;
  }
}

/** Parse saved edits leniently: wrong seed or bad data → no edits (never throws). */
export function parseSaved(raw: string | null | undefined, seed: number, size: WorldSize = WORLD): Edits {
  const out: Edits = new Map();
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Partial<SavedWorld>;
    if (!v || v.seed !== seed || !Array.isArray(v.edits)) return out;
    for (const e of v.edits.slice(0, MAX_EDITS)) {
      if (!Array.isArray(e) || e.length !== 3) continue;
      const [x, y, t] = e;
      if (![x, y, t].every((n) => Number.isInteger(n))) continue;
      if (x < 0 || x >= size.width || y < 0 || y >= size.height || t < 0 || t >= TILE_COUNT) continue;
      out.set(editKey(x, y), t);
    }
  } catch {
    // Invalid file: start clean.
  }
  return out;
}

export function serializeEdits(seed: number, edits: Edits, extras: { cut?: Iterable<number>; objects?: unknown[]; taken?: Iterable<number>; walls?: Edits; furnished?: boolean } = {}): string {
  const list: [number, number, number][] = [];
  for (const [k, t] of edits) list.push([k % 65536, Math.floor(k / 65536), t]);
  const out: SavedWorld = { version: 2, seed, edits: list };
  if (extras.cut) out.cut = [...extras.cut];
  if (extras.objects) out.objects = extras.objects;
  if (extras.taken) out.taken = [...extras.taken];
  if (extras.walls && extras.walls.size) out.walls = [...extras.walls].map(([k, w]) => [k % 65536, Math.floor(k / 65536), w]);
  if (extras.furnished) out.furnished = true;
  return JSON.stringify(out);
}

/** A fresh random seed (positive 31-bit). */
export const randomSeed = () => 1 + Math.floor(Math.random() * 2_147_483_646);

/** Seeds may be typed as text: numbers are used as-is, words are hashed. */
export function seedFrom(text: string): number {
  const t = text.trim();
  if (/^\d{1,10}$/.test(t)) return Math.max(1, Number(t) % 2_147_483_647);
  let h = 2166136261;
  for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return Math.max(1, h % 2_147_483_647);
}

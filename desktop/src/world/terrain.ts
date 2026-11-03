// The ground rules of the world: tile and wall ids, seeded noise, the biome layout and the
// surface line. Everything here is a pure function of (seed, x, y). Structures (dungeon,
// cabins, islands…) live in structures.ts; the map with edits in gen.ts.
//
// Layout of a world (mirrored by the seed): ocean │ beach + dungeon │ snow │ mushroom grove │
// corruption │ crimson │ spawn (forest) │ forest │ desert │ hallow │ jungle │ beach │ ocean, with
// caves, ores, gems, marble and granite caves, underground mushroom fields and bee hives below,
// and the underworld at the bottom.

export const T = {
  Air: 0,
  Dirt: 1,
  Grass: 2,
  Stone: 3,
  Clay: 4,
  Sand: 5,
  Copper: 6,
  Iron: 7,
  Gold: 8,
  Wood: 9,
  Mud: 10,
  Snow: 11,
  Ice: 12,
  JungleGrass: 13,
  /** One-way: stand on it, jump up through it, drop down with S. */
  Platform: 14,
  Silver: 15,
  Demonite: 16,
  CorruptGrass: 17,
  Ebonstone: 18,
  Meteorite: 19,
  Ash: 20,
  Hellstone: 21,
  Obsidian: 22,
  MushroomGrass: 23,
  Hive: 24,
  Cloud: 25,
  Sunplate: 26,
  BlueBrick: 27,
  GreenBrick: 28,
  PinkBrick: 29,
  GrayBrick: 30,
  RedBrick: 31,
  GoldBrick: 32,
  Glass: 33,
  SandstoneBrick: 34,
  SnowBrick: 35,
  BorealWood: 36,
  PalmWood: 37,
  RichMahogany: 38,
  Ebonwood: 39,
  ObsidianBrick: 40,
  HellstoneBrick: 41,
  LivingWood: 42,
  Leaf: 43,
  IceBrick: 44,
  /** Liquids: not solid, not standable; you swim in water and burn in lava. */
  Water: 45,
  Lava: 46,
  EbonstoneBrick: 47,
  MudstoneBrick: 48,
  CopperBrick: 49,
  SilverBrick: 50,
  GlowMushroomBlock: 51,
  BoneBlock: 52,
  Sandstone: 53,
  HardenedSand: 54,
  // The hallow, the crimson, marble and granite caves, gems, and building materials.
  HallowedGrass: 55,
  Pearlstone: 56,
  Pearlsand: 57,
  PearlstoneBrick: 58,
  Pearlwood: 59,
  CrimsonGrass: 60,
  Crimstone: 61,
  Crimtane: 62,
  Shadewood: 63,
  Marble: 64,
  MarbleBlock: 65,
  Granite: 66,
  GraniteBlock: 67,
  StoneSlab: 68,
  SandstoneSlab: 69,
  CrystalBlock: 70,
  DynastyWood: 71,
  RedShingles: 72,
  BlueShingles: 73,
  Coralstone: 74,
  LivingMahogany: 75,
  MahoganyLeaves: 76,
  Amethyst: 77,
  Topaz: 78,
  Sapphire: 79,
  Emerald: 80,
  Ruby: 81,
  Diamond: 82,
  /** A wooden beam: drawn like a block, but you walk straight past it (pillars, timber framing). */
  WoodBeam: 83,
  Hay: 84,
  CopperPlating: 85,
} as const;

export const TILE_COUNT = 86;

/** Tiles you walk through though they're there (beams). */
export const PASSABLE = (t: number) => t === T.WoodBeam;
export const LIQUID = (t: number) => t === T.Water || t === T.Lava;
export const SOLID = (t: number) => t !== T.Air && t !== T.Platform && t !== T.Water && t !== T.Lava && t !== T.WoodBeam;
/** Something you can stand on (solid or a platform). */
export const STANDABLE = (t: number) => t !== T.Air && t !== T.Water && t !== T.Lava && t !== T.WoodBeam;

/** Background walls (0 = none). Placed walls, structure walls; natural cave walls are drawn by depth. */
export const W = {
  None: 0,
  Stone: 1,
  Dirt: 2,
  Wood: 3,
  GrayBrick: 4,
  RedBrick: 5,
  BlueBrick: 6,
  GreenBrick: 7,
  PinkBrick: 8,
  GoldBrick: 9,
  Glass: 10,
  Planked: 11,
  SnowBrick: 12,
  SandstoneBrick: 13,
  EbonstoneBrick: 14,
  Ebonwood: 15,
  RichMahogany: 16,
  Leaf: 17,
  Cloud: 18,
  Disc: 19,
  Mushroom: 20,
  Hive: 21,
  HellstoneBrick: 22,
  ObsidianBrick: 23,
  Boreal: 24,
  Palm: 25,
  Ebonstone: 26,
  Mud: 27,
  SilverBrick: 28,
  CopperBrick: 29,
  PearlstoneBrick: 30,
  Pearlwood: 31,
  RedStucco: 32,
  YellowStucco: 33,
  GreenStucco: 34,
  GrayStucco: 35,
  LivingWood: 36,
  PurpleGlass: 37,
  YellowGlass: 38,
  BlueGlass: 39,
  GreenGlass: 40,
  RedGlass: 41,
  RainbowGlass: 42,
  WoodFence: 43,
  MetalFence: 44,
  CopperPlating: 45,
  Lattice: 46,
  Marble: 47,
  Granite: 48,
  Plaster: 49,
  Sandstone: 50,
  /** Natural walls behind the new biomes' caves. */
  Pearlstone: 51,
  Crimstone: 52,
  Ice: 53,
  Shadewood: 54,
  Crystal: 55,
} as const;

export const WALL_COUNT = 56;

/** Wall sheets from the local install (`Images/Wall_<n>`), by wall id. */
export const WALL_SHEET: Record<number, number> = {
  [W.Stone]: 1,
  [W.Dirt]: 2,
  [W.Wood]: 4,
  [W.GrayBrick]: 5,
  [W.RedBrick]: 6,
  [W.BlueBrick]: 7,
  [W.GreenBrick]: 8,
  [W.PinkBrick]: 9,
  [W.GoldBrick]: 10,
  [W.Glass]: 21,
  [W.Planked]: 27,
  [W.SnowBrick]: 31,
  [W.SandstoneBrick]: 34,
  [W.EbonstoneBrick]: 35,
  [W.Ebonwood]: 41,
  [W.RichMahogany]: 42,
  [W.Leaf]: 60,
  [W.Cloud]: 73,
  [W.Disc]: 82,
  [W.Mushroom]: 80,
  [W.Hive]: 86,
  [W.HellstoneBrick]: 13,
  [W.ObsidianBrick]: 20,
  [W.Boreal]: 149,
  [W.Palm]: 151,
  [W.Ebonstone]: 3,
  [W.Mud]: 15,
  [W.SilverBrick]: 11,
  [W.CopperBrick]: 12,
  [W.PearlstoneBrick]: 22,
  [W.Pearlwood]: 43,
  [W.RedStucco]: 36,
  [W.YellowStucco]: 37,
  [W.GreenStucco]: 38,
  [W.GrayStucco]: 39,
  [W.LivingWood]: 78,
  [W.PurpleGlass]: 88,
  [W.YellowGlass]: 89,
  [W.BlueGlass]: 90,
  [W.GreenGlass]: 91,
  [W.RedGlass]: 92,
  [W.RainbowGlass]: 93,
  [W.WoodFence]: 106,
  [W.MetalFence]: 107,
  [W.CopperPlating]: 113,
  [W.Lattice]: 134,
  [W.Marble]: 178,
  [W.Granite]: 180,
  [W.Plaster]: 155,
  [W.Sandstone]: 187,
  [W.Pearlstone]: 28,
  [W.Crimstone]: 193,
  [W.Ice]: 71,
  [W.Shadewood]: 41,
  [W.Crystal]: 200,
};

export interface WorldSize {
  width: number;
  height: number;
}

/** About a Terraria "small" world wide; deep enough for caverns and the underworld. */
export const WORLD: WorldSize = { width: 4200, height: 600 };
export const SURFACE_BASE = 200;
/** The ocean's water line. */
export const SEA_LEVEL = SURFACE_BASE + 12;
/** Where the underworld begins (rows below are ash, hellstone and lava). */
export const HELL_TOP = 525;

// ── Seeded noise ────────────────────────────────────────────────────────────────────────────

/** 32-bit integer hash of (seed, a, b) → [0, 1). */
export function hash(seed: number, a: number, b = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13) ^ (b | 0) * 0x27d4eb2d, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth 1-D value noise in [0, 1). */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  return hash(seed, i) + (hash(seed, i + 1) - hash(seed, i)) * smooth(f);
}

/** Smooth 2-D value noise in [0, 1). */
export function noise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash(seed, xi, yi);
  const b = hash(seed, xi + 1, yi);
  const c = hash(seed, xi, yi + 1);
  const d = hash(seed, xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm2(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(seed + o * 101, x, y) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / norm;
}

// ── Biomes ──────────────────────────────────────────────────────────────────────────────────

export type Biome = "forest" | "snow" | "desert" | "jungle" | "corruption" | "crimson" | "hallow" | "mushroom" | "ocean";

/** Underground and sky zones layered on the surface biomes (for spawns, music, labels). */
export type Zone = Biome | "underground" | "caverns" | "mushroom" | "hive" | "dungeon" | "underworld" | "sky";

export const BIOME_NAMES: Record<Zone, string> = {
  forest: "Forest",
  snow: "Snow",
  desert: "Desert",
  jungle: "Jungle",
  corruption: "Corruption",
  crimson: "Crimson",
  hallow: "Hallow",
  ocean: "Ocean",
  underground: "Underground",
  caverns: "Caverns",
  mushroom: "Glowing Mushroom",
  hive: "Bee Hive",
  dungeon: "Dungeon",
  underworld: "Underworld",
  sky: "Sky Islands",
};

/** Which edge the snow (and dungeon) is on. */
export const snowLeft = (seed: number) => hash(seed, 77) < 0.5;

/** Distance (columns) from the snow-side edge, and from the jungle-side edge. */
export function sides(seed: number, x: number, size: WorldSize = WORLD) {
  const s = snowLeft(seed) ? x : size.width - 1 - x;
  return { s, j: size.width - 1 - s };
}

/** Column on the snow side at distance `s` from its edge (and the same for the jungle side). */
export const snowSideX = (seed: number, s: number, size: WorldSize = WORLD) => (snowLeft(seed) ? s : size.width - 1 - s);
export const jungleSideX = (seed: number, j: number, size: WorldSize = WORLD) => (snowLeft(seed) ? size.width - 1 - j : j);

export const OCEAN_W = 130;
export const BEACH_W = 250;
export const CORRUPTION_AT = 1420;
export const CORRUPTION_HALF = 150;
export const DESERT_AT = 1450;
export const DESERT_HALF = 230;
/** The smaller biomes in the forest strips: a glowing-mushroom grove between the snow and the
 * corruption, the hallow between the jungle and the desert, and a crimson patch on the far side
 * of the corruption (the spawn's own forest is left alone). */
export const MUSHROOM_AT = 1185;
export const MUSHROOM_HALF = 55;
export const HALLOW_AT = 1160;
export const HALLOW_HALF = 50;
export const CRIMSON_AT = 1730;
export const CRIMSON_HALF = 75;

export function biomeAt(seed: number, x: number, size: WorldSize = WORLD): Biome {
  const jitter = (noise1(seed + 70, x * 0.01) - 0.5) * 80;
  const { s, j } = sides(seed, x + jitter, size);
  if (Math.min(s, j) < BEACH_W) return "ocean";
  if (s < 1100) return "snow";
  if (j < 1100) return "jungle";
  if (Math.abs(s - CORRUPTION_AT) < CORRUPTION_HALF) return "corruption";
  if (Math.abs(j - DESERT_AT) < DESERT_HALF) return "desert";
  // (The small biomes' edges don't wander: they sit between their neighbours.)
  const { s: s0, j: j0 } = sides(seed, x, size);
  if (Math.abs(s0 - MUSHROOM_AT) < MUSHROOM_HALF) return "mushroom";
  if (Math.abs(j0 - HALLOW_AT) < HALLOW_HALF) return "hallow";
  if (Math.abs(s0 - CRIMSON_AT) < CRIMSON_HALF) return "crimson";
  return "forest";
}

// ── Terrain ─────────────────────────────────────────────────────────────────────────────────

/** Surface row (first solid tile) of column x: big rolling hills with smaller bumps; beaches slope into the ocean. */
export function surfaceAt(seed: number, x: number, size: WorldSize = WORLD): number {
  const hills = (noise1(seed + 1, x * 0.006) - 0.5) * 70;
  const mid = (noise1(seed + 2, x * 0.03) - 0.5) * 16;
  const small = (noise1(seed + 3, x * 0.12) - 0.5) * 3;
  const land = SURFACE_BASE + hills + mid + small;
  const e = Math.min(x, size.width - 1 - x);
  if (e >= BEACH_W) return Math.round(land);
  if (e >= OCEAN_W) {
    // The beach: level out to just above the water line.
    const t = smooth((BEACH_W - e) / (BEACH_W - OCEAN_W));
    return Math.round(land + (SEA_LEVEL - 1 - land) * t);
  }
  // The sea floor, deepening toward the world's edge.
  return Math.round(SEA_LEVEL + (OCEAN_W - e) * 0.32 + (noise1(seed + 8, x * 0.08) - 0.5) * 3);
}

/** How deep the dirt goes before stone takes over. */
export const dirtDepth = (seed: number, x: number) => 10 + Math.round(noise1(seed + 4, x * 0.05) * 10);

/** Sandy dips: low-lying stretches get a sand top. */
export const sandy = (seed: number, x: number) => noise1(seed + 5, x * 0.004) > 0.78;

/** A cave entrance opens to the surface here (rare). */
export const entrance = (seed: number, x: number) => noise1(seed + 6, x * 0.02) > 0.86;

/** Underground glowing-mushroom fields: two, in the forests between the spawn and the side biomes. */
export function mushroomFields(seed: number, size: WorldSize = WORLD) {
  return [
    { x: snowSideX(seed, 1760 + Math.round(hash(seed, 61) * 120), size), y: SURFACE_BASE + 95 + Math.round(hash(seed, 62) * 30), rx: 48, ry: 22 },
    { x: jungleSideX(seed, 1780 + Math.round(hash(seed, 63) * 120), size), y: SURFACE_BASE + 110 + Math.round(hash(seed, 64) * 30), rx: 44, ry: 20 },
  ];
}

export function inMushroom(seed: number, x: number, y: number, size: WorldSize = WORLD): boolean {
  for (const f of mushroomFields(seed, size)) {
    const dx = (x - f.x) / f.rx;
    const dy = (y - f.y) / f.ry;
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
}

/** Open space inside a mushroom field (big caves with mushroom-grass floors). */
export const mushroomOpen = (seed: number, x: number, y: number) => fbm2(seed + 60, x * 0.05, y * 0.09, 2) > 0.47;

/** Which zone a tile is in (biome by column, then depth / height). */
export function zoneAt(seed: number, x: number, y: number, size: WorldSize = WORLD): Zone {
  if (y >= HELL_TOP - 5) return "underworld";
  if (y < SURFACE_BASE - 80) return "sky";
  const top = surfaceAt(seed, x, size);
  if (inMushroom(seed, x, y, size)) return "mushroom";
  if (y > top + 160) return "caverns";
  if (y > top + 25) {
    const b = biomeAt(seed, x, size);
    return b === "jungle" || b === "snow" || b === "desert" || b === "corruption" || b === "crimson" || b === "hallow" || b === "mushroom" ? b : "underground";
  }
  return biomeAt(seed, x, size);
}

/** Marble caves (white, in the upper caverns) and granite caves (dark, deeper): pockets of stone. */
export function stoneCave(seed: number, x: number, y: number): "marble" | "granite" | null {
  const n = fbm2(seed + 90, x * 0.02, y * 0.03, 2);
  if (n < 0.68) return null;
  return hash(seed + 91, Math.floor(x / 90), Math.floor(y / 60)) < 0.5 ? "marble" : "granite";
}

/** A gem in the rock (deeper means rarer gems). */
export function gemAt(seed: number, x: number, y: number, depth: number): number | null {
  if (hash(seed + 92, x, y) > 0.004 || depth < 30) return null;
  const order = [T.Amethyst, T.Topaz, T.Sapphire, T.Emerald, T.Ruby, T.Diamond];
  const k = Math.min(order.length - 1, Math.floor(hash(seed + 93, x, y) * Math.min(order.length, 1 + depth / 40)));
  return order[k];
}

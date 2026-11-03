// The furniture and world objects: footprints, which install sheet and frame they're drawn from
// (styles were matched by eye against the local install's sheets), what they do (crafting
// stations, light, storage, housing roles) and how they're supported. Plus the furniture themes
// the waifus decorate with, one per biome.

import type { Station } from "./inventory";

export type ObjectType =
  | "workbench"
  | "furnace"
  | "anvil"
  | "chest"
  | "torch"
  | "crystal"
  | "table"
  | "chair"
  | "door"
  | "bed"
  | "bookcase"
  | "piano"
  | "sofa"
  | "lamp"
  | "chandelier"
  | "candle"
  | "dresser"
  | "bathtub"
  | "clock"
  | "sink"
  | "banner"
  | "painting"
  | "statue"
  | "plant"
  | "keg"
  | "cookingpot"
  | "sawmill"
  | "loom"
  | "hellforge"
  | "tinkerer"
  | "safe"
  | "piggybank"
  | "bottle"
  | "lantern"
  | "pot"
  | "orb"
  | "altar"
  | "larva"
  | "herb"
  | "glowshroom"
  | "mushroom"
  // Estate pieces (added at the end: item ids follow this order).
  | "fountain"
  | "fireplace"
  | "chimney"
  | "lamppost"
  | "candelabra"
  | "paperlantern"
  | "campfire"
  | "planter"
  | "sunflower"
  | "throne"
  | "weaponrack"
  | "crystalball"
  | "sundial"
  | "gardentree"
  | "vineflowers"
  | "coral";

/** How an object is held in place. */
export type Support = "floor" | "ceiling" | "wall" | "door" | "any";

/** What an object counts as for a town NPC's room. */
export type HousingRole = "door" | "chair" | "table" | "light" | "bed";

export interface ObjectDef {
  w: number;
  h: number;
  sheet: string;
  /** Frame of a style in the sheet (px, on the 18 px grid). */
  frame: (style: number) => { sx: number; sy: number };
  support: Support;
  station?: Station;
  light?: number;
  /** The colour of its light (warm firelight when not given). */
  glow?: readonly [number, number, number];
  /** Item dropped when picked up (by style; null = nothing, e.g. a smashed pot). */
  drop: (style: number) => number | null;
  roles?: HousingRole[];
  /** Chests and safes hold items. */
  storage?: boolean;
  /** Broken (smashed) rather than picked up: pots, orbs, larva. */
  breakable?: boolean;
  /** Small enough to stand on a table top (a candelabra, a crystal ball). */
  tabletop?: boolean;
  /** Animation: frames down the sheet, `stride` px apart (the first `skip` are the idle frame). */
  anim?: { frames: number; stride: number; fps: number; skip?: number };
  name: string;
}

const H = (stride: number) => (style: number) => ({ sx: style * stride, sy: 0 });
const V = (stride: number) => (style: number) => ({ sx: 0, sy: style * stride });
const ONE = () => ({ sx: 0, sy: 0 });

/** Synthetic item ids for themed furniture (no matching item art needed: the icon is the sprite). */
export const FURNITURE_ITEM_BASE = 130000;

/** Item id for a themed piece: base + type index × 64 + style. */
export const furnitureItem = (t: ObjectType, style: number) => FURNITURE_ITEM_BASE + FURNITURE_TYPES.indexOf(t) * 64 + style;
export function furnitureFromItem(id: number): { t: ObjectType; style: number } | null {
  if (id < FURNITURE_ITEM_BASE || id >= FURNITURE_ITEM_BASE + 64 * 64) return null;
  const n = id - FURNITURE_ITEM_BASE;
  const t = FURNITURE_TYPES[Math.floor(n / 64)];
  return t ? { t, style: n % 64 } : null;
}

/** Real item ids for the plain (style 0) pieces that have them. */
const PLAIN: Partial<Record<ObjectType, number>> = {
  workbench: 36,
  furnace: 33,
  anvil: 35,
  chest: 48,
  torch: 8,
  table: 32,
  chair: 34,
  door: 25,
  bed: 224,
  bookcase: 354,
  piano: 333,
  sofa: 335,
  dresser: 334,
  bathtub: 336,
  clock: 359,
  candle: 105,
  keg: 352,
  cookingpot: 345,
  sawmill: 363,
  loom: 332,
  hellforge: 221,
  tinkerer: 398,
  safe: 346,
  piggybank: 87,
  bottle: 31,
  plant: 222,
  lamp: 341,
  lantern: 344,
};

const piece = (t: ObjectType) => (style: number) => (style === 0 && PLAIN[t] ? PLAIN[t]! : furnitureItem(t, style));

export const OBJECTS: Record<ObjectType, ObjectDef> = {
  workbench: { name: "Work Bench", w: 2, h: 1, sheet: "Images/Tiles_18", frame: H(36), support: "floor", station: "workbench", drop: piece("workbench"), roles: ["table"] },
  furnace: { name: "Furnace", w: 3, h: 2, sheet: "Images/Tiles_17", frame: ONE, support: "floor", station: "furnace", drop: () => 33, light: 0.55 },
  anvil: { name: "Iron Anvil", w: 2, h: 1, sheet: "Images/Tiles_16", frame: ONE, support: "floor", station: "anvil", drop: () => 35 },
  chest: {
    name: "Chest",
    w: 2,
    h: 2,
    sheet: "Images/Tiles_21",
    frame: H(36),
    support: "floor",
    storage: true,
    drop: (s) => (s === 0 ? 48 : s === 1 ? 306 : s === 3 ? 328 : furnitureItem("chest", s)),
  },
  torch: { name: "Torch", w: 1, h: 1, sheet: "Images/Tiles_4", frame: ONE, support: "wall", drop: () => 8, light: 1, roles: ["light"] },
  crystal: { name: "Life Crystal", w: 2, h: 2, sheet: "Images/Tiles_12", frame: ONE, support: "floor", drop: () => 29, light: 0.35, glow: [255, 90, 140] },
  table: { name: "Table", w: 3, h: 2, sheet: "Images/Tiles_14", frame: H(54), support: "floor", drop: piece("table"), roles: ["table"] },
  chair: { name: "Chair", w: 1, h: 2, sheet: "Images/Tiles_15", frame: V(40), support: "floor", drop: piece("chair"), roles: ["chair"] },
  door: { name: "Door", w: 1, h: 3, sheet: "Images/Tiles_10", frame: V(54), support: "door", drop: piece("door"), roles: ["door"] },
  bed: { name: "Bed", w: 4, h: 2, sheet: "Images/Tiles_79", frame: V(36), support: "floor", drop: piece("bed"), roles: ["chair", "bed"] },
  bookcase: { name: "Bookcase", w: 3, h: 4, sheet: "Images/Tiles_101", frame: H(54), support: "floor", drop: piece("bookcase"), station: "bookcase", roles: ["table"] },
  piano: { name: "Piano", w: 3, h: 2, sheet: "Images/Tiles_87", frame: H(54), support: "floor", drop: piece("piano"), roles: ["table"] },
  sofa: { name: "Sofa", w: 3, h: 2, sheet: "Images/Tiles_89", frame: H(54), support: "floor", drop: piece("sofa"), roles: ["chair"] },
  lamp: { name: "Lamp", w: 1, h: 3, sheet: "Images/Tiles_93", frame: V(54), support: "floor", drop: piece("lamp"), light: 0.9, roles: ["light"] },
  chandelier: { name: "Chandelier", w: 3, h: 3, sheet: "Images/Tiles_34", frame: V(54), support: "ceiling", drop: (s) => (s === 0 ? 106 : s === 1 ? 107 : s === 2 ? 108 : furnitureItem("chandelier", s)), light: 1, roles: ["light"] },
  candle: { name: "Candle", w: 1, h: 1, sheet: "Images/Tiles_33", frame: V(22), support: "floor", drop: piece("candle"), light: 0.6, roles: ["light"] },
  dresser: { name: "Dresser", w: 3, h: 2, sheet: "Images/Tiles_88", frame: H(54), support: "floor", storage: true, drop: piece("dresser"), roles: ["table"] },
  bathtub: { name: "Bathtub", w: 4, h: 2, sheet: "Images/Tiles_90", frame: V(36), support: "floor", drop: piece("bathtub"), roles: ["chair"] },
  clock: { name: "Grandfather Clock", w: 2, h: 5, sheet: "Images/Tiles_104", frame: H(36), support: "floor", drop: piece("clock") },
  sink: { name: "Sink", w: 2, h: 2, sheet: "Images/Tiles_172", frame: V(38), support: "floor", drop: piece("sink") },
  banner: { name: "Banner", w: 1, h: 3, sheet: "Images/Tiles_91", frame: H(18), support: "ceiling", drop: (s) => (s < 4 ? 337 + s : furnitureItem("banner", s)) },
  painting: { name: "Painting", w: 3, h: 3, sheet: "Images/Tiles_240", frame: H(54), support: "wall", drop: piece("painting") },
  statue: { name: "Statue", w: 2, h: 3, sheet: "Images/Tiles_105", frame: H(36), support: "floor", drop: piece("statue") },
  plant: { name: "Potted Plant", w: 1, h: 1, sheet: "Images/Tiles_78", frame: ONE, support: "floor", drop: () => 222 },
  keg: { name: "Keg", w: 2, h: 2, sheet: "Images/Tiles_94", frame: ONE, support: "floor", station: "keg", drop: () => 352 },
  cookingpot: { name: "Cooking Pot", w: 2, h: 2, sheet: "Images/Tiles_96", frame: ONE, support: "floor", station: "cookingpot", drop: () => 345 },
  sawmill: { name: "Sawmill", w: 3, h: 3, sheet: "Images/Tiles_106", frame: ONE, support: "floor", station: "sawmill", drop: () => 363 },
  loom: { name: "Loom", w: 3, h: 2, sheet: "Images/Tiles_86", frame: ONE, support: "floor", station: "loom", drop: () => 332 },
  hellforge: { name: "Hellforge", w: 3, h: 2, sheet: "Images/Tiles_77", frame: ONE, support: "floor", station: "hellforge", drop: () => 221, light: 0.7 },
  tinkerer: { name: "Tinkerer's Workshop", w: 3, h: 2, sheet: "Images/Tiles_114", frame: ONE, support: "floor", station: "tinkerer", drop: () => 398 },
  safe: { name: "Safe", w: 2, h: 2, sheet: "Images/Tiles_97", frame: ONE, support: "floor", storage: true, drop: () => 346 },
  piggybank: { name: "Piggy Bank", w: 2, h: 1, sheet: "Images/Tiles_29", frame: ONE, support: "floor", storage: true, drop: () => 87 },
  bottle: { name: "Placed Bottle", w: 1, h: 1, sheet: "Images/Tiles_13", frame: H(18), support: "floor", station: "bottle", drop: () => 31 },
  lantern: { name: "Lantern", w: 1, h: 2, sheet: "Images/Tiles_42", frame: V(36), support: "ceiling", drop: piece("lantern"), light: 0.8, roles: ["light"] },
  pot: { name: "Pot", w: 2, h: 2, sheet: "Images/Tiles_28", frame: (s) => ({ sx: (s % 3) * 36, sy: Math.floor(s / 3) * 36 }), support: "floor", breakable: true, drop: () => null },
  orb: { name: "Shadow Orb", w: 2, h: 2, sheet: "Images/Tiles_31", frame: ONE, support: "any", breakable: true, drop: () => null, light: 0.3, glow: [170, 90, 255] },
  altar: { name: "Demon Altar", w: 3, h: 2, sheet: "Images/Tiles_26", frame: ONE, support: "floor", station: "altar", drop: () => null },
  larva: { name: "Larva", w: 3, h: 3, sheet: "Images/Tiles_231", frame: ONE, support: "any", breakable: true, drop: () => null, light: 0.2 },
  herb: { name: "Herb", w: 1, h: 1, sheet: "Images/Tiles_84", frame: H(18), support: "floor", drop: (s) => 313 + Math.min(5, s) },
  mushroom: { name: "Mushroom", w: 1, h: 1, sheet: "Images/Tiles_3", frame: () => ({ sx: 8 * 18, sy: 0 }), support: "floor", drop: () => 5 },
  glowshroom: { name: "Glowing Mushroom", w: 1, h: 1, sheet: "Images/Tiles_71", frame: H(18), support: "floor", drop: () => 183, light: 0.3, glow: [70, 120, 255] },
  // Styles follow the sheet: pure, desert, jungle, icy, corrupt, crimson, hallowed, blood, cavern, oasis, ocean.
  fountain: { name: "Water Fountain", w: 2, h: 4, sheet: "Images/Tiles_207", frame: H(36), support: "floor", drop: piece("fountain"), anim: { frames: 6, stride: 72, fps: 8, skip: 1 } },
  fireplace: { name: "Fireplace", w: 3, h: 2, sheet: "Images/Tiles_405", frame: ONE, support: "floor", drop: piece("fireplace"), light: 1, glow: [255, 140, 60], roles: ["light"], anim: { frames: 8, stride: 38, fps: 9 } },
  chimney: { name: "Chimney", w: 3, h: 3, sheet: "Images/Tiles_406", frame: ONE, support: "floor", drop: piece("chimney"), anim: { frames: 6, stride: 56, fps: 6 } },
  lamppost: { name: "Lamp Post", w: 1, h: 6, sheet: "Images/Tiles_92", frame: ONE, support: "floor", drop: piece("lamppost"), light: 1, roles: ["light"] },
  candelabra: { name: "Candelabra", w: 2, h: 2, sheet: "Images/Tiles_100", frame: V(36), support: "floor", tabletop: true, drop: piece("candelabra"), light: 0.85, roles: ["light"] },
  paperlantern: { name: "Chinese Lantern", w: 2, h: 2, sheet: "Images/Tiles_95", frame: ONE, support: "ceiling", drop: piece("paperlantern"), light: 0.85, glow: [255, 150, 90], roles: ["light"] },
  campfire: { name: "Campfire", w: 3, h: 2, sheet: "Images/Tiles_215", frame: H(54), support: "floor", drop: piece("campfire"), light: 1, glow: [255, 140, 60], anim: { frames: 8, stride: 36, fps: 9 } },
  // Planter boxes: style = herb row × 4 + piece (left end, middle, middle, single).
  planter: { name: "Planter Box", w: 1, h: 1, sheet: "Images/Tiles_380", frame: (s) => ({ sx: (s % 4) * 18, sy: Math.floor(s / 4) * 18 }), support: "floor", drop: piece("planter") },
  sunflower: { name: "Sunflower", w: 2, h: 4, sheet: "Images/Tiles_27", frame: H(36), support: "floor", drop: piece("sunflower") },
  throne: { name: "Throne", w: 3, h: 4, sheet: "Images/Tiles_102", frame: ONE, support: "floor", drop: piece("throne"), roles: ["chair"] },
  weaponrack: { name: "Weapon Rack", w: 3, h: 3, sheet: "Images/Tiles_334", frame: H(54), support: "wall", drop: piece("weaponrack") },
  crystalball: { name: "Crystal Ball", w: 2, h: 2, sheet: "Images/Tiles_125", frame: ONE, support: "floor", tabletop: true, drop: piece("crystalball"), light: 0.4, glow: [170, 120, 255] },
  sundial: { name: "Sundial", w: 2, h: 3, sheet: "Images/Tiles_356", frame: ONE, support: "floor", drop: piece("sundial") },
  // A tree grown from an acorn in a garden (style: which kind; drawn like the world's trees).
  gardentree: { name: "Garden Tree", w: 1, h: 6, sheet: "Images/Tiles_5", frame: ONE, support: "floor", drop: () => 27 },
  vineflowers: { name: "Flowering Vines", w: 1, h: 3, sheet: "Images/Tiles_382", frame: H(18), support: "ceiling", drop: piece("vineflowers") },
  coral: { name: "Coral", w: 1, h: 1, sheet: "Images/Tiles_81", frame: (s) => ({ sx: s * 26, sy: 0 }), support: "floor", drop: piece("coral") },
};

export const FURNITURE_TYPES = Object.keys(OBJECTS) as ObjectType[];

// ── Themes ──────────────────────────────────────────────────────────────────────────────────

export type ThemeId = "wood" | "living" | "boreal" | "frozen" | "mahogany" | "ebonwood" | "cactus" | "palm" | "mushroom" | "skyware" | "obsidian" | "pearlwood" | "shadewood";

export type ThemedPiece = "door" | "chair" | "table" | "bed" | "bookcase" | "piano" | "sofa" | "lamp" | "chandelier" | "chest";

/** Style index of each piece in each theme (matched against the install's furniture sheets). */
export const THEMES: Record<ThemeId, { name: string; styles: Record<ThemedPiece, number> }> = {
  wood: { name: "Wooden", styles: { door: 0, chair: 0, table: 0, bed: 0, bookcase: 0, piano: 0, sofa: 1, lamp: 0, chandelier: 2, chest: 0 } },
  living: { name: "Living Wood", styles: { door: 7, chair: 5, table: 6, bed: 19, bookcase: 18, piano: 5, sofa: 22, lamp: 13, chandelier: 18, chest: 12 } },
  boreal: { name: "Boreal", styles: { door: 30, chair: 30, table: 28, bed: 24, bookcase: 25, piano: 23, sofa: 5, lamp: 20, chandelier: 25, chest: 33 } },
  frozen: { name: "Frozen", styles: { door: 27, chair: 28, table: 24, bed: 15, bookcase: 17, piano: 7, sofa: 27, lamp: 5, chandelier: 11, chest: 11 } },
  mahogany: { name: "Rich Mahogany", styles: { door: 2, chair: 3, table: 2, bed: 2, bookcase: 12, piano: 2, sofa: 3, lamp: 6, chandelier: 12, chest: 8 } },
  ebonwood: { name: "Ebonwood", styles: { door: 1, chair: 2, table: 1, bed: 1, bookcase: 7, piano: 1, sofa: 2, lamp: 2, chandelier: 8, chest: 7 } },
  cactus: { name: "Cactus", styles: { door: 4, chair: 6, table: 30, bed: 22, bookcase: 6, piano: 17, sofa: 12, lamp: 1, chandelier: 7, chest: 0 } },
  palm: { name: "Palm Wood", styles: { door: 29, chair: 29, table: 26, bed: 21, bookcase: 23, piano: 21, sofa: 21, lamp: 18, chandelier: 23, chest: 31 } },
  mushroom: { name: "Mushroom", styles: { door: 6, chair: 9, table: 27, bed: 23, bookcase: 24, piano: 22, sofa: 17, lamp: 19, chandelier: 24, chest: 32 } },
  skyware: { name: "Skyware", styles: { door: 9, chair: 10, table: 7, bed: 17, bookcase: 15, piano: 19, sofa: 14, lamp: 9, chandelier: 15, chest: 13 } },
  obsidian: { name: "Obsidian", styles: { door: 19, chair: 16, table: 13, bed: 8, bookcase: 4, piano: 15, sofa: 10, lamp: 23, chandelier: 32, chest: 43 } },
  pearlwood: { name: "Pearlwood", styles: { door: 3, chair: 4, table: 3, bed: 3, bookcase: 13, piano: 3, sofa: 4, lamp: 3, chandelier: 13, chest: 9 } },
  shadewood: { name: "Shadewood", styles: { door: 10, chair: 11, table: 8, bed: 1, bookcase: 7, piano: 1, sofa: 6, lamp: 2, chandelier: 19, chest: 14 } },
};

const PIECE_NAMES: Partial<Record<ObjectType, string>> = { chest: "Chest", door: "Door", chair: "Chair", table: "Table", bed: "Bed", bookcase: "Bookcase", piano: "Piano", sofa: "Sofa", lamp: "Lamp", chandelier: "Chandelier" };

/** Names of the pieces whose styles are kinds rather than themes. */
const STYLE_NAMES: Partial<Record<ObjectType, string[]>> = {
  fountain: ["Pure Water Fountain", "Desert Water Fountain", "Jungle Water Fountain", "Icy Water Fountain", "Corrupt Water Fountain", "Crimson Water Fountain", "Hallowed Water Fountain", "Blood Water Fountain", "Cavern Water Fountain", "Oasis Water Fountain", "Ocean Water Fountain"],
  gardentree: ["Oak Sapling", "Willow Sapling", "Bonsai Sapling", "Boreal Sapling", "Snow Pine Sapling", "Palm Sapling", "Mahogany Sapling", "Pearlwood Sapling", "Shadewood Sapling", "Giant Mushroom Spore", "Ebonwood Sapling"],
};

/** Display name of a furniture item (themed pieces are named after their theme). */
export function furnitureName(t: ObjectType, style: number): string {
  const named = STYLE_NAMES[t]?.[style];
  if (named) return named;
  for (const th of Object.values(THEMES)) {
    const styles = th.styles as Partial<Record<ObjectType, number>>;
    if (styles[t] === style && style !== 0) return `${th.name} ${PIECE_NAMES[t] ?? OBJECTS[t].name}`;
  }
  return style === 0 ? OBJECTS[t].name : `${OBJECTS[t].name} (${style})`;
}

/** The theme whose wood (or material) a themed piece is crafted from (item id, and how many per piece). */
export const THEME_MATERIAL: Record<ThemeId, number> = {
  wood: 9,
  living: 9,
  boreal: 2503,
  frozen: 664,
  mahogany: 620,
  ebonwood: 619,
  cactus: 276,
  palm: 2504,
  mushroom: 183,
  skyware: 824,
  obsidian: 173,
  pearlwood: 621,
  shadewood: 911,
};

/** Material count per piece (roughly Terraria's). */
export const PIECE_COST: Record<ThemedPiece, number> = { door: 6, chair: 4, table: 8, bed: 15, bookcase: 20, piano: 15, sofa: 5, lamp: 3, chandelier: 4, chest: 8 };

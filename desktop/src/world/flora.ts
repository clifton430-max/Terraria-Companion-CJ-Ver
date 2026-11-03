// The world's small living details, decided from the seed and the tiles around (nothing stored):
// grass plants and tall flowers on each biome's grass, vines hanging under grassy overhangs,
// sunflowers in the forest, seashells on the beach and coral under the sea, and underground
// stalactites, stalagmites, rubble and hallowed crystals. Each is a frame of a sheet from the
// local install; the renderer draws them into its cached chunks.

import { hash, T, type WorldMap } from "./gen";

/** One sprite to draw at a tile (frame in the sheet; dy shifts it up, e.g. tall plants). */
export interface Deco {
  sheet: string;
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Offset from the tile's top-left, px. */
  dx: number;
  dy: number;
}

/** Each grass's plants: short plants (frames in a 22 px tall strip) and tall plants (34 px). */
const GRASS_PLANTS: Partial<Record<number, { short: string; shortN: number; tall?: string; tallN?: number }>> = {
  [T.Grass]: { short: "Images/Tiles_3", shortN: 44, tall: "Images/Tiles_73", tallN: 44 },
  [T.CorruptGrass]: { short: "Images/Tiles_24", shortN: 22 },
  [T.JungleGrass]: { short: "Images/Tiles_61", shortN: 22, tall: "Images/Tiles_74", tallN: 16 },
  [T.HallowedGrass]: { short: "Images/Tiles_110", shortN: 22, tall: "Images/Tiles_113", tallN: 8 },
  [T.CrimsonGrass]: { short: "Images/Tiles_201", shortN: 22 },
  [T.MushroomGrass]: { short: "Images/Tiles_71", shortN: 5 },
};

/** Vines under each grass. */
const VINES: Partial<Record<number, string>> = {
  [T.Grass]: "Images/Tiles_52",
  [T.JungleGrass]: "Images/Tiles_62",
  [T.HallowedGrass]: "Images/Tiles_115",
  [T.CrimsonGrass]: "Images/Tiles_205",
};

/** Stalactite columns (Tiles_165) by the stone they hang from. */
const DRIPSTONE: Partial<Record<number, number>> = {
  [T.Stone]: 3,
  [T.Ice]: 0,
  [T.Ebonstone]: 12,
  [T.Crimstone]: 18,
  [T.Sandstone]: 21,
  [T.HardenedSand]: 21,
  [T.Granite]: 24,
  [T.Marble]: 27,
  [T.Pearlstone]: 30,
};

const MAX_VINE = 7;

/** How long a vine hanging from this grass tile is (0 = none). */
function vineLength(seed: number, x: number, y: number): number {
  const h = hash(seed + 300, x, y);
  return h < 0.45 ? 2 + Math.floor(hash(seed + 301, x, y) * (MAX_VINE - 1)) : 0;
}

/** The details at an open tile (x, y), in drawing order (empty: none). */
export function decoAt(map: WorldMap, x: number, y: number): Deco[] {
  const out: Deco[] = [];
  const seed = map.seed;
  const below = map.tile(x, y + 1);
  const above = map.tile(x, y - 1);
  const surface = map.surface(x);
  const outside = y < surface + 3;
  const r = hash(seed + 310, x, y);

  // Plants on grass (only out in the open: not in front of a wall someone built).
  const plants = GRASS_PLANTS[below];
  if (plants && map.wall(x, y) === 0) {
    const tall = plants.tall && hash(seed + 311, x, y) < 0.22 && map.tile(x, y - 1) === T.Air;
    if (tall) {
      const f = Math.floor(hash(seed + 312, x, y) * plants.tallN!);
      out.push({ sheet: plants.tall!, sx: f * 18, sy: 0, w: 16, h: 32, dx: 0, dy: -16 });
    } else if (r < 0.62) {
      const f = Math.floor(hash(seed + 313, x, y) * plants.shortN);
      out.push({ sheet: plants.short, sx: f * 18, sy: 0, w: 16, h: 20, dx: 0, dy: -4 });
    }
  }

  // Vines hanging from a grassy overhang above.
  for (let k = 1; k <= MAX_VINE; k++) {
    const t = map.tile(x, y - k);
    if (t === T.Air) continue;
    const sheet = VINES[t];
    if (!sheet) break;
    const len = vineLength(seed, x, y - k);
    if (k <= len && map.wall(x, y) === 0) {
      const tip = k === len || map.tile(x, y + 1) !== T.Air;
      const col = Math.floor(hash(seed + 302, x, y) * 12);
      out.push({ sheet, sx: col * 18, sy: tip ? 72 : (k % 3) * 18, w: 16, h: 16, dx: 0, dy: 0 });
    }
    break;
  }

  // On the beach: shells and starfish on the sand; coral under the water.
  if (below === T.Sand && map.biome(x) === "ocean" && outside) {
    if (r < 0.07) {
      const f = Math.floor(hash(seed + 320, x, y) * 15);
      out.push({ sheet: "Images/Tiles_324", sx: (f % 3) * 22, sy: Math.floor(f / 3) * 22, w: 20, h: 20, dx: -2, dy: -4 });
    }
  }

  // Underground: stalactites from the ceiling, stalagmites and rubble on the floor, hallowed crystals.
  if (y > surface + 6) {
    const col = DRIPSTONE[above];
    if (col !== undefined && r < 0.09 && map.tile(x, y + 1) === T.Air) {
      const v = Math.floor(hash(seed + 330, x, y) * 3);
      out.push({ sheet: "Images/Tiles_165", sx: (col + v) * 18, sy: 0, w: 16, h: 34, dx: 0, dy: 0 });
    } else if (col !== undefined && r < 0.16) {
      const v = Math.floor(hash(seed + 331, x, y) * 3);
      out.push({ sheet: "Images/Tiles_165", sx: (col + v) * 18, sy: 72, w: 16, h: 16, dx: 0, dy: 0 });
    }
    const floor = DRIPSTONE[below];
    if (floor !== undefined) {
      if (r > 0.93 && map.tile(x, y - 1) === T.Air) {
        const v = Math.floor(hash(seed + 332, x, y) * 3);
        out.push({ sheet: "Images/Tiles_165", sx: (floor + v) * 18, sy: 36, w: 16, h: 34, dx: 0, dy: -18 });
      } else if (r > 0.86) {
        const v = Math.floor(hash(seed + 333, x, y) * 3);
        out.push({ sheet: "Images/Tiles_165", sx: (floor + v) * 18, sy: 90, w: 16, h: 16, dx: 0, dy: 0 });
      } else if (r > 0.8 && (below === T.Stone || below === T.Granite || below === T.Marble)) {
        const v = Math.floor(hash(seed + 334, x, y) * 6);
        out.push({ sheet: "Images/Tiles_185", sx: v * 18, sy: 0, w: 16, h: 16, dx: 0, dy: 0 });
      }
    }
    if ((below === T.Pearlstone || above === T.Pearlstone) && r > 0.7) {
      const f = Math.floor(hash(seed + 335, x, y) * 18);
      out.push({ sheet: "Images/Tiles_129", sx: f * 18, sy: below === T.Pearlstone ? 0 : 18, w: 16, h: 16, dx: 0, dy: 0 });
    }
  }
  return out;
}

/** A sunflower (2 wide, 4 tall) stands with its left column at x, on flat forest grass. */
export function sunflowerAt(map: WorldMap, x: number): boolean {
  if (hash(map.seed + 340, x) > 0.025 || map.biome(x) !== "forest") return false;
  const g = map.surface(x);
  return map.tile(x, g) === T.Grass && map.tile(x + 1, g) === T.Grass && map.surface(x + 1) === g && !map.tree(x) && !map.tree(x + 1) && map.tile(x, g - 1) === T.Air && map.tile(x + 1, g - 1) === T.Air && map.wall(x, g - 1) === 0;
}

/** Every sheet the details use (to load with the rest of the art). */
export const FLORA_SHEETS = [
  ...new Set([
    ...Object.values(GRASS_PLANTS).flatMap((p) => [p!.short, ...(p!.tall ? [p!.tall] : [])]),
    ...Object.values(VINES).map((v) => v!),
    "Images/Tiles_165",
    "Images/Tiles_185",
    "Images/Tiles_129",
    "Images/Tiles_324",
    "Images/Tiles_27",
  ]),
];

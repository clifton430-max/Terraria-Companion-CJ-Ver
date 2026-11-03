// The saved-locations gallery: every biome, structure, settlement, town, boss arena and house the
// waifus find or build, with a name, a biome label and its progress. Locations become
// "discovered" when a waifu comes near; built ones appear when the build starts.

import { BEACH_W, BIOME_NAMES, hash, HELL_TOP, jungleSideX, OCEAN_W, snowSideX, type WorldMap, type Zone } from "../gen";

const BEACH_MID = Math.round((OCEAN_W + BEACH_W) / 2);

export type LocationKind = "biome" | "structure" | "settlement" | "town" | "arena" | "house";

export interface Location {
  id: string;
  kind: LocationKind;
  name: string;
  biome: Zone;
  /** Tile the camera centres on. */
  x: number;
  y: number;
  /** Discovery radius (tiles). */
  r: number;
  discovered: boolean;
  /** Game day it was found. */
  day?: number;
  /** 0..1 where it makes sense (houses, the town), and a status line. */
  progress?: number;
  status: string;
}

const BIOME_LOCATION_NAMES: Record<string, string[]> = {
  forest: ["Whispering Woods", "Sunleaf Meadow", "Emerald Glade"],
  snow: ["Frostfang Tundra", "Glacier Reach", "Snowveil Wastes"],
  desert: ["Scorching Dunes", "Amber Sands", "Sunspire Desert"],
  jungle: ["Verdant Wilds", "Emerald Jungle", "Mosswood Thicket"],
  corruption: ["The Withering", "Ebon Blight", "Duskrot Vale"],
  ocean: ["Coral Coast", "Sapphire Shore", "Tidewater Beach"],
  mushroom: ["Glowcap Grotto", "Bluelight Caverns", "Sporelight Hollow"],
  underworld: ["The Underworld", "Ashen Depths", "Molten Abyss"],
  sky: ["The Sky Islands", "Cloud Kingdom", "Heaven's Reach"],
};

const pick = (list: string[], seed: number, k: number) => list[Math.floor(hash(seed + 1200, k) * list.length)];

/** All the places a world has to find (built places are added as they're started). */
export function worldLocations(map: WorldMap): Location[] {
  const seed = map.seed;
  const W = map.size.width;
  const out: Location[] = [];
  const biome = (id: string, b: Zone, x: number, y?: number) =>
    out.push({ id, kind: "biome", name: pick(BIOME_LOCATION_NAMES[b] ?? [BIOME_NAMES[b]], seed, out.length), biome: b, x, y: y ?? map.surface(x) - 4, r: 60, discovered: false, status: "Unexplored" });
  const center = Math.floor(W / 2);
  biome("forest", "forest", center + 40);
  biome("snow", "snow", snowSideX(seed, 680));
  biome("jungle", "jungle", jungleSideX(seed, 680));
  biome("desert", "desert", jungleSideX(seed, 1450));
  biome("corruption", "corruption", snowSideX(seed, 1420));
  // The beaches: the middle of the dry sand (not out in the sea), seen from anywhere along it —
  // the snow side's is mostly behind the dungeon, so reaching its door counts.
  biome("ocean-east", "ocean", jungleSideX(seed, BEACH_MID));
  biome("ocean-west", "ocean", snowSideX(seed, BEACH_MID));
  // The underworld below the spawn.
  biome("underworld", "underworld", center, HELL_TOP + 30);
  for (const s of map.structures) {
    const kind: LocationKind = s.kind === "settlement" ? "settlement" : "structure";
    out.push({
      id: `s-${s.kind}-${s.x0}`,
      kind,
      name: s.name,
      biome: s.biome === "underworld" ? "underworld" : s.biome === "sky" ? "sky" : s.kind === "hive" ? "hive" : s.kind === "dungeon" ? "dungeon" : (s.biome as Zone),
      x: Math.floor((s.x0 + s.x1) / 2),
      y: Math.floor((s.y0 + s.y1) / 2),
      r: Math.max(30, (s.x1 - s.x0) / 2 + 12),
      discovered: false,
      status: "Unexplored",
    });
  }
  // Mushroom fields (found by digging into them).
  for (const [k, x] of [snowSideX(seed, 1760 + Math.round(hash(seed, 61) * 120)), jungleSideX(seed, 1780 + Math.round(hash(seed, 63) * 120))].entries()) {
    out.push({ id: `mushroom-${k}`, kind: "biome", name: pick(BIOME_LOCATION_NAMES.mushroom, seed, 40 + k), biome: "mushroom", x, y: map.surface(x) + 100, r: 45, discovered: false, status: "Unexplored" });
  }
  return out;
}

/** Merge saved discovery state into a freshly built list. */
export function restoreLocations(list: Location[], saved: unknown): void {
  if (!Array.isArray(saved)) return;
  const byId = new Map(list.map((l) => [l.id, l]));
  for (const s of saved) {
    if (!s || typeof s !== "object") continue;
    const v = s as Partial<Location>;
    if (typeof v.id !== "string") continue;
    const l = byId.get(v.id);
    if (l) {
      l.discovered = v.discovered === true;
      if (typeof v.day === "number") l.day = v.day;
    } else if (v.kind && typeof v.name === "string" && typeof v.x === "number" && typeof v.y === "number") {
      // A built place (house, town, arena): kept as saved until the director refreshes it.
      list.push({ id: v.id, kind: v.kind, name: v.name.slice(0, 60), biome: (v.biome ?? "forest") as Zone, x: v.x, y: v.y, r: 30, discovered: true, day: v.day, progress: v.progress, status: typeof v.status === "string" ? v.status.slice(0, 80) : "" });
    }
  }
}

export function saveLocations(list: Location[]) {
  return list.filter((l) => l.discovered).map((l) => ({ id: l.id, kind: l.kind, name: l.name, biome: l.biome, x: l.x, y: l.y, discovered: true, day: l.day, progress: l.progress, status: l.status }));
}

// Blueprints for everything the waifus build, as ordered task lists (each tile attaches to
// something already built, like Terraria): the starter house, small town houses for NPCs, a big
// luxury house for each biome (themed materials and furniture; multiple floors with rooms, an
// attic and towers; a different layout per biome and world), a boss arena, the hellevator shaft
// down to the underworld and the ladder up to a sky island.

import { T, W, type WorldMap, type Zone } from "../gen";
import { doorstep, Bp, fillFrom, groundAt } from "./blueprint";
import { luxuryHouse } from "./estate";
import { THEMES, type ObjectType, type ThemeId } from "./furniture";

export { chooseFlat, groundAt, oneEach } from "./blueprint";
export { luxuryHouse } from "./estate";

export type Task =
  | { kind: "clear"; x: number; y: number }
  | { kind: "chop"; x: number }
  | { kind: "tile"; x: number; y: number; tile: number }
  | { kind: "wall"; x: number; y: number; wall: number }
  | { kind: "object"; x: number; y: number; obj: ObjectType; style?: number };

export type ProjectKind = "starter" | "luxury" | "npcHouse" | "arena" | "shaft" | "ladder";

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  biome: Zone;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tasks: Task[];
  /** Tiles the finished build has (so clearing never undoes it). */
  planned: Map<number, number>;
  /** Where it has background walls (clearing takes down any other placed wall in its way). */
  walls?: Set<number>;
  /** Floors builders stand on (rows, with their interior span). A walkway (a bridge) is built
   * standing on its own finished part, so work in its row and just under it goes from there;
   * `entry` says where to climb up onto it (inside the towers at its ends). */
  floors: { y: number; x0: number; x1: number; walk?: boolean; entry?: { x0: number; x1: number }[] }[];
  /** A tile inside each room meant as a home (for town NPCs). */
  rooms: { x: number; y: number }[];
  /** Where to stand at home / the front door. */
  door: { x: number; y: number };
  /** How to regenerate it from a save. */
  params: ProjectParams;
}

export type ProjectParams =
  | { kind: "starter"; x0: number; g: number }
  /** (`span`: the site's width; missing on saves from before estates had wings and grounds.) */
  | { kind: "luxury"; biome: string; x0: number; g: number; seed: number; span?: number }
  | { kind: "npcHouse"; x0: number; g: number; theme: ThemeId; n: number }
  | { kind: "arena"; x0: number; g: number; w: number; name: string }
  | { kind: "shaft"; x: number; top: number; bottom: number }
  | { kind: "ladder"; x: number; bottom: number; top: number; name: string };

// ── The starter house ───────────────────────────────────────────────────────────────────────

export const HOUSE_W = 14;

/** The first house: wooden floor, walls with a doorway, a loft, a ceiling and a stepped stone roof, furnished. */
export function starterHouse(map: WorldMap, x0: number, g: number): Project {
  const b = new Bp();
  const x1 = x0 + HOUSE_W - 1;
  for (let x = x0 - 6; x <= x1 + 3; x++) if (map.tree(x)) b.chop(x);
  for (let y = g - 12; y < g; y++) for (let x = x0 - 1; x <= x1 + 1; x++) b.clear(x, y);
  // A level doorstep (the ground just outside the door no higher than the floor).
  for (let y = g - 4; y < g; y++) for (let x = x0 - 4; x <= x0 - 2; x++) b.clear(x, y);
  for (let y = g - 4; y < g; y++) for (let x = x1 + 2; x <= x1 + 4; x++) b.clear(x, y);
  for (let x = x0; x <= x1; x++) for (let y = g + 3; y > g; y--) b.tile(x, y, T.Dirt);
  for (let x = x0; x <= x1; x++) b.tile(x, g, T.Wood);
  // Wood walls behind everything first (blocks attach to them), then the frame: the side walls
  // hang over a doorway on each side (so nobody's cut off), under the ceiling.
  for (let y = g - 1; y >= g - 7; y--) for (let x = x0; x <= x1; x++) b.wall(x, y, W.Wood);
  for (let y = g - 4; y >= g - 6; y--) {
    b.tile(x0, y, T.Wood);
    b.tile(x1, y, T.Wood);
  }
  for (let x = x1; x >= x0; x--) b.tile(x, g - 7, T.Wood);
  for (let x = x1 - 1; x > x0; x--) b.tile(x, g - 3, T.Platform);
  const roof: [number, number, number][] = [
    [g - 8, x0, x1],
    [g - 9, x0 + 1, x1 - 1],
    [g - 10, x0 + 3, x1 - 3],
    [g - 11, x0 + 5, x1 - 5],
  ];
  for (const [y, a, c] of roof) for (let x = a; x <= c; x++) b.tile(x, y, T.Stone);
  b.tile(x0 - 1, g - 8, T.Stone);
  b.tile(x1 + 1, g - 8, T.Stone);
  b.obj(x0 + 1, g - 5, "torch");
  b.obj(x1 - 1, g - 2, "torch");
  b.obj(x0 + 4, g - 4, "torch");
  b.obj(x0 + 3, g - 1, "workbench");
  b.obj(x1 - 5, g - 5, "furnace");
  b.floors.push({ y: g, x0: x0 + 1, x1: x1 - 1 }, { y: g - 3, x0: x0 + 1, x1: x1 - 1 });
  return b.project("starter", "starter", "First House", map.biome(x0), { x: x0 - 2, y: g }, { kind: "starter", x0, g });
}

// ── Town houses ─────────────────────────────────────────────────────────────────────────────

/** A small house for one town NPC: walls, a wall behind, a door each side, a table, a chair, a light, a bed. */
export function npcHouse(map: WorldMap, x0: number, g: number, theme: ThemeId, n: number): Project {
  const b = new Bp();
  const w = 11;
  const h = 7;
  const x1 = x0 + w - 1;
  const mats = THEME_MATS[theme] ?? THEME_MATS.wood;
  const st = THEMES[theme].styles;
  for (let x = x0 - 3; x <= x1 + 3; x++) if (map.tree(x)) b.chop(x);
  for (let y = g - h - 2; y < g; y++) for (let x = x0 - 1; x <= x1 + 1; x++) b.clear(x, y);
  for (let x = x0; x <= x1; x++) {
    const ground = groundAt(map, x);
    for (let y = fillFrom(ground, g); y > g; y--) b.tile(x, y, T.Dirt);
  }
  for (let x = x0; x <= x1; x++) b.tile(x, g, mats.found);
  // Walls behind everything, frame included (the side walls hang over the doorways from them).
  for (let y = g - 1; y >= g - h; y--) for (let x = x0; x <= x1; x++) b.wall(x, y, mats.wall);
  for (let y = g - 4; y > g - h; y--) {
    b.tile(x0, y, mats.frame);
    b.tile(x1, y, mats.frame);
  }
  for (let x = x0; x <= x1; x++) b.tile(x, g - h, mats.frame);
  for (let x = x0 + 1; x < x1; x++) b.tile(x, g - h - 1, mats.roof);
  b.obj(x0, g - 3, "door", st.door);
  b.obj(x1, g - 3, "door", st.door);
  doorstep(b, map, x0, g, -1);
  doorstep(b, map, x1, g, 1);
  b.obj(x0 + 2, g - 2, "table", st.table);
  b.obj(x0 + 5, g - 2, "chair", st.chair);
  b.obj(x0 + 6, g - 2, "bed", st.bed);
  b.obj(x0 + 1, g - 5, "torch");
  b.obj(x1 - 1, g - 5, "torch");
  b.floors.push({ y: g, x0: x0 + 1, x1: x1 - 1 });
  b.rooms.push({ x: x0 + 4, y: g - 3 });
  return b.project(`town-${n}`, "npcHouse", `Town House ${n + 1}`, map.biome(x0), { x: x0 - 1, y: g }, { kind: "npcHouse", x0, g, theme, n });
}

// ── Materials for town houses ───────────────────────────────────────────────────────────

export interface Mats {
  frame: number;
  roof: number;
  found: number;
  wall: number;
  alt: number;
  hall: number;
  accent: number;
}

export const THEME_MATS: Record<ThemeId, Mats> = {
  wood: { frame: T.Wood, roof: T.GrayBrick, found: T.GrayBrick, wall: W.Wood, alt: W.Planked, hall: W.GrayBrick, accent: T.Glass },
  living: { frame: T.GrayBrick, roof: T.RedBrick, found: T.GrayBrick, wall: W.Planked, alt: W.Leaf, hall: W.Wood, accent: T.LivingWood },
  boreal: { frame: T.SnowBrick, roof: T.BorealWood, found: T.IceBrick, wall: W.Boreal, alt: W.SnowBrick, hall: W.Planked, accent: T.Glass },
  frozen: { frame: T.IceBrick, roof: T.SnowBrick, found: T.IceBrick, wall: W.SnowBrick, alt: W.Boreal, hall: W.Glass, accent: T.Glass },
  mahogany: { frame: T.MudstoneBrick, roof: T.RichMahogany, found: T.MudstoneBrick, wall: W.RichMahogany, alt: W.Leaf, hall: W.Planked, accent: T.LivingWood },
  ebonwood: { frame: T.EbonstoneBrick, roof: T.Ebonwood, found: T.EbonstoneBrick, wall: W.Ebonwood, alt: W.EbonstoneBrick, hall: W.Planked, accent: T.Glass },
  cactus: { frame: T.SandstoneBrick, roof: T.SandstoneBrick, found: T.SandstoneBrick, wall: W.SandstoneBrick, alt: W.Planked, hall: W.GoldBrick, accent: T.GoldBrick },
  palm: { frame: T.SandstoneBrick, roof: T.PalmWood, found: T.SandstoneBrick, wall: W.Palm, alt: W.Planked, hall: W.SandstoneBrick, accent: T.Glass },
  mushroom: { frame: T.MudstoneBrick, roof: T.GlowMushroomBlock, found: T.MudstoneBrick, wall: W.Mud, alt: W.Mushroom, hall: W.Mud, accent: T.Glass },
  skyware: { frame: T.GoldBrick, roof: T.Cloud, found: T.Cloud, wall: W.Disc, alt: W.Cloud, hall: W.GoldBrick, accent: T.Glass },
  obsidian: { frame: T.ObsidianBrick, roof: T.HellstoneBrick, found: T.ObsidianBrick, wall: W.ObsidianBrick, alt: W.HellstoneBrick, hall: W.ObsidianBrick, accent: T.HellstoneBrick },
  pearlwood: { frame: T.PearlstoneBrick, roof: T.Pearlwood, found: T.PearlstoneBrick, wall: W.Pearlwood, alt: W.PearlstoneBrick, hall: W.Planked, accent: T.Glass },
  shadewood: { frame: T.RedBrick, roof: T.Shadewood, found: T.RedBrick, wall: W.Shadewood, alt: W.RedBrick, hall: W.Planked, accent: T.Glass },
};

// ── Utility builds ──────────────────────────────────────────────────────────────────────────

/** A boss arena: long platform rows held up by wooden posts, with torches, on flat ground. */
export function arena(map: WorldMap, x0: number, g: number, w: number, name: string): Project {
  const b = new Bp();
  for (let x = x0 - 2; x <= x0 + w + 2; x++) if (map.tree(x)) b.chop(x);
  // A level dirt floor to fight on (filling dips and old mine shafts, shaving bumps).
  for (let x = x0; x <= x0 + w; x++) {
    for (let y = g - 4; y < g; y++) b.clear(x, y);
    const ground = groundAt(map, x);
    for (let y = fillFrom(ground, g); y >= g; y--) b.tile(x, y, T.Dirt);
  }
  // Ramps down (or up) to the ground at both ends, so the floor never becomes a cliff.
  doorstep(b, map, x0, g, -1);
  doorstep(b, map, x0 + w, g, 1);
  // Tier by tier (each one is the scaffold for the next): posts are background walls (nobody
  // bumps into them), and a row of platforms hangs on them every five rows.
  b.floors.push({ y: g, x0, x1: x0 + w });
  const TIER = 5;
  for (let k = 1; k <= 3; k++) {
    const row = g - k * TIER;
    for (const post of [x0, x0 + Math.floor(w / 2), x0 + w]) for (let y = row + TIER - 1; y >= row; y--) b.wall(post, y, W.Wood);
    for (let x = x0; x <= x0 + w; x++) b.tile(x, row, T.Platform);
    for (let x = x0 + 4; x < x0 + w; x += 10) b.obj(x, row - 1, "torch");
    b.floors.push({ y: row, x0, x1: x0 + w });
  }
  return b.project(`arena-${name}`, "arena", name, map.biome(x0), { x: x0 + 2, y: g }, { kind: "arena", x0, g, w, name });
}

/** The hellevator: a 3-wide shaft to the underworld with a platform every 18 rows to break the fall. */
export function shaft(map: WorldMap, x: number, top: number, bottom: number): Project {
  const b = new Bp();
  if (map.tree(x) || map.tree(x + 1) || map.tree(x + 2)) for (let c = x - 1; c <= x + 3; c++) if (map.tree(c)) b.chop(c);
  for (let y = top; y <= bottom; y++) {
    for (let c = x; c <= x + 2; c++) {
      if ((y - top) % 18 === 17) b.tile(c, y, T.Platform);
      else b.clear(c, y);
    }
    // Shaft walls where a cave opened them up (so the platforms have something to hold on to).
    if ((y - top) % 18 === 17) {
      b.tile(x - 1, y, T.GrayBrick);
      b.tile(x + 3, y, T.GrayBrick);
    }
  }
  b.floors.push({ y: bottom + 1, x0: x, x1: x + 2 });
  return b.project("shaft", "shaft", "The Hellevator", "underground", { x: x + 1, y: top }, { kind: "shaft", x, top, bottom });
}

/** A ladder of platforms up a wooden pole, from the ground to a sky island's edge. */
export function ladder(_map: WorldMap, x: number, bottom: number, top: number, name: string): Project {
  const b = new Bp();
  for (let y = bottom - 1; y >= top; y--) {
    // The pole is a background wall (nothing to bump into); the platforms hang on it.
    b.wall(x, y, W.Wood);
    b.wall(x + 1, y, W.Wood);
    b.wall(x + 2, y, W.Wood);
    if ((bottom - y) % 5 === 0) {
      b.tile(x + 1, y, T.Platform);
      b.tile(x + 2, y, T.Platform);
      b.floors.push({ y, x0: x + 1, x1: x + 2 });
    }
  }
  b.floors.push({ y: bottom, x0: x + 1, x1: x + 2 });
  return b.project(`ladder-${name}`, "ladder", `Ladder to ${name}`, "sky", { x: x + 1, y: bottom }, { kind: "ladder", x, bottom, top, name });
}

/** Rebuild a project from its saved parameters. */
export function fromParams(map: WorldMap, p: ProjectParams): Project {
  switch (p.kind) {
    case "starter":
      return starterHouse(map, p.x0, p.g);
    case "luxury":
      return luxuryHouse(map, p.biome, p.x0, p.g, p.seed, p.span);
    case "npcHouse":
      return npcHouse(map, p.x0, p.g, p.theme, p.n);
    case "arena":
      return arena(map, p.x0, p.g, p.w, p.name);
    case "shaft":
      return shaft(map, p.x, p.top, p.bottom);
    case "ladder":
      return ladder(map, p.x, p.bottom, p.top, p.name);
  }
}


// The luxury estates: one per biome, each in that biome's own architecture. Left to right:
//
//   garden │ tower │ wing │ main house │ wing │ tower │ courtyard
//
// The main house has 3–4 storeys of rooms behind a themed facade (wainscoting, pilasters,
// arched stained-glass windows, fireplaces, chandeliers) under a roof in the biome's style, with
// a chimney. Two-storey wings flank it, their roofs railed terraces you step out onto from the
// main house. Towers stand at the ends, a storey taller than everything, each crowned with an
// open lookout under a spire, and a skybridge runs between the two lookouts high over the roof.
// A garden (trees grown from acorns, flower beds, a fountain, lamp posts, an arch for a gate) and
// a paved courtyard (a fountain, benches, lamps) spread out on either side. Smaller sites (and
// old saves) get as much of this as fits: the main house and its towers first.
//
// Everything is built the usual way (blueprint.ts): every block attaches to something already
// there, nothing overlaps, every storey is reachable, and every material can be made or found.

import { hash, T, W, type WorldMap, type Zone } from "../gen";
import { Bp, chooseFlat, doorstep, fillFrom, groundAt } from "./blueprint";
import { THEMES, type ObjectType, type ThemeId } from "./furniture";
import type { Project, Task } from "./house";

type RoofStyle = "pitched" | "stepped" | "flat" | "dome";

/** How a biome builds. */
interface Look {
  theme: ThemeId;
  /** Outer walls and partitions. */
  frame: number;
  /** String courses, cornices, lintels, eaves. */
  trim: number;
  roof: number;
  /** Foundation and plinth. */
  found: number;
  /** Paving (courtyard, garden paths, front steps). */
  path: number;
  /** The garden's ground. */
  soil: number;
  /** Background walls: rooms, alternate rooms, halls, the lower band of each room. */
  wall: number;
  alt: number;
  hall: number;
  wainscot: number;
  /** Window glass and pilasters (walls). */
  glass: number;
  pillar: number;
  /** Railings (walls). */
  fence: number;
  /** Tower windows and spire tips (a tile). */
  accent: number;
  roofs: RoofStyle[];
  fountain: number;
  /** Garden trees (styles of the garden tree piece). */
  trees: number[];
  lantern: "lantern" | "paperlantern";
  /** Planter rows (herbs) in the flower beds. */
  flowers: number[];
  extra: "sunflowers" | "coral" | "glowshrooms" | "vines" | null;
  chimney: boolean;
}

const LOOKS: Record<string, Look> = {
  // Elegant woodland estate: stone and timber, red shingles, a flower garden with oaks and willows.
  forest: { theme: "living", frame: T.GrayBrick, trim: T.LivingWood, roof: T.RedShingles, found: T.GrayBrick, path: T.StoneSlab, soil: T.Grass, wall: W.Planked, alt: W.LivingWood, hall: W.GrayStucco, wainscot: W.Wood, glass: W.YellowGlass, pillar: W.GrayBrick, fence: W.WoodFence, accent: T.Glass, roofs: ["pitched", "stepped"], fountain: 0, trees: [0, 1, 2], lantern: "lantern", flowers: [0, 1, 6], extra: "sunflowers", chimney: true },
  // Grand winter mansion: snow brick and boreal timber, steep blue roofs, hearths everywhere.
  snow: { theme: "boreal", frame: T.SnowBrick, trim: T.BorealWood, roof: T.BlueShingles, found: T.StoneSlab, path: T.SnowBrick, soil: T.Snow, wall: W.Boreal, alt: W.SnowBrick, hall: W.Planked, wainscot: W.Boreal, glass: W.BlueGlass, pillar: W.SnowBrick, fence: W.WoodFence, accent: T.Glass, roofs: ["pitched"], fountain: 3, trees: [3, 4], lantern: "lantern", flowers: [7], extra: null, chimney: true },
  // Sandstone palace: domes, gold trim, lattice and stucco, an oasis courtyard with palms.
  desert: { theme: "cactus", frame: T.SandstoneBrick, trim: T.GoldBrick, roof: T.SandstoneSlab, found: T.SandstoneSlab, path: T.SandstoneSlab, soil: T.Sand, wall: W.Sandstone, alt: W.YellowStucco, hall: W.SandstoneBrick, wainscot: W.SandstoneBrick, glass: W.YellowGlass, pillar: W.Lattice, fence: W.Lattice, accent: T.GoldBrick, roofs: ["dome", "flat"], fountain: 9, trees: [5], lantern: "paperlantern", flowers: [5], extra: null, chimney: false },
  // Overgrown tropical estate: living mahogany, leafy roofs, flowering vines over everything.
  jungle: { theme: "mahogany", frame: T.LivingMahogany, trim: T.RichMahogany, roof: T.MahoganyLeaves, found: T.MudstoneBrick, path: T.MudstoneBrick, soil: T.JungleGrass, wall: W.RichMahogany, alt: W.Leaf, hall: W.GreenStucco, wainscot: W.RichMahogany, glass: W.GreenGlass, pillar: W.LivingWood, fence: W.WoodFence, accent: T.LivingWood, roofs: ["stepped", "dome"], fountain: 2, trees: [6], lantern: "paperlantern", flowers: [2, 3], extra: "vines", chimney: false },
  // Gothic manor in the corruption: ebonstone and ebonwood, spires.
  corruption: { theme: "ebonwood", frame: T.EbonstoneBrick, trim: T.Ebonwood, roof: T.Ebonwood, found: T.EbonstoneBrick, path: T.EbonstoneBrick, soil: T.CorruptGrass, wall: W.Ebonwood, alt: W.EbonstoneBrick, hall: W.Planked, wainscot: W.Ebonwood, glass: W.PurpleGlass, pillar: W.EbonstoneBrick, fence: W.MetalFence, accent: T.Glass, roofs: ["stepped", "pitched"], fountain: 4, trees: [10], lantern: "lantern", flowers: [4], extra: null, chimney: true },
  // Crimson keep: red brick and shadewood, crimstone footing, red glass.
  crimson: { theme: "shadewood", frame: T.RedBrick, trim: T.Shadewood, roof: T.Shadewood, found: T.Crimstone, path: T.RedBrick, soil: T.CrimsonGrass, wall: W.Shadewood, alt: W.RedBrick, hall: W.RedStucco, wainscot: W.Shadewood, glass: W.RedGlass, pillar: W.RedBrick, fence: W.MetalFence, accent: T.Glass, roofs: ["stepped", "pitched"], fountain: 5, trees: [8], lantern: "lantern", flowers: [3], extra: null, chimney: true },
  // Magical, luminous: pearlstone and pearlwood, crystal accents, rainbow glass, glowing trees.
  hallow: { theme: "pearlwood", frame: T.PearlstoneBrick, trim: T.Pearlwood, roof: T.CrystalBlock, found: T.PearlstoneBrick, path: T.PearlstoneBrick, soil: T.HallowedGrass, wall: W.Plaster, alt: W.PearlstoneBrick, hall: W.Plaster, wainscot: W.Pearlwood, glass: W.RainbowGlass, pillar: W.PearlstoneBrick, fence: W.MetalFence, accent: T.CrystalBlock, roofs: ["dome", "pitched"], fountain: 6, trees: [7], lantern: "lantern", flowers: [6, 0], extra: null, chimney: false },
  // Whimsical glowing mushroom house: mushroom-cap domes over mud brick.
  mushroom: { theme: "mushroom", frame: T.MudstoneBrick, trim: T.GlowMushroomBlock, roof: T.GlowMushroomBlock, found: T.MudstoneBrick, path: T.MudstoneBrick, soil: T.MushroomGrass, wall: W.Mud, alt: W.Mushroom, hall: W.Mud, wainscot: W.Mushroom, glass: W.BlueGlass, pillar: W.Mushroom, fence: W.WoodFence, accent: T.GlowMushroomBlock, roofs: ["dome"], fountain: 8, trees: [9], lantern: "lantern", flowers: [2], extra: "glowshrooms", chimney: false },
  // Coastal mansion: palm wood, coralstone, white plaster, blue roofs, palms and coral by the sea.
  // (Palm wood only for the furniture: the beach's palms are few, and mostly on the site itself.)
  ocean: { theme: "palm", frame: T.Coralstone, trim: T.SandstoneSlab, roof: T.BlueShingles, found: T.SandstoneSlab, path: T.SandstoneSlab, soil: T.Sand, wall: W.Plaster, alt: W.Sandstone, hall: W.Plaster, wainscot: W.Wood, glass: W.BlueGlass, pillar: W.Plaster, fence: W.WoodFence, accent: T.Glass, roofs: ["flat", "pitched"], fountain: 10, trees: [5], lantern: "lantern", flowers: [5], extra: "coral", chimney: false },
  // Palace in the clouds.
  sky: { theme: "skyware", frame: T.GoldBrick, trim: T.Sunplate, roof: T.Cloud, found: T.Cloud, path: T.Sunplate, soil: T.Cloud, wall: W.Disc, alt: W.Cloud, hall: W.GoldBrick, wainscot: W.Disc, glass: W.YellowGlass, pillar: W.GoldBrick, fence: W.MetalFence, accent: T.Glass, roofs: ["dome"], fountain: 0, trees: [0], lantern: "lantern", flowers: [0], extra: null, chimney: false },
  // Citadel in the underworld.
  underworld: { theme: "obsidian", frame: T.ObsidianBrick, trim: T.HellstoneBrick, roof: T.HellstoneBrick, found: T.ObsidianBrick, path: T.ObsidianBrick, soil: T.Ash, wall: W.ObsidianBrick, alt: W.HellstoneBrick, hall: W.ObsidianBrick, wainscot: W.ObsidianBrick, glass: W.RedGlass, pillar: W.HellstoneBrick, fence: W.MetalFence, accent: T.HellstoneBrick, roofs: ["flat", "stepped"], fountain: 7, trees: [0], lantern: "lantern", flowers: [4], extra: null, chimney: false },
};

export const LUXURY_NAMES: Record<string, string[]> = {
  forest: ["Willowmere Manor", "Oakheart Hall", "Greenleaf Estate"],
  snow: ["Frostspire Chalet", "Snowdrift Lodge", "Aurora Keep"],
  desert: ["Sunstone Palace", "Mirage Villa", "Dune Crown Hall"],
  jungle: ["Canopy Mansion", "Verdant Temple House", "Orchid Manor"],
  corruption: ["Duskthorn Manor", "Nightshade Hall", "Gloomspire House"],
  crimson: ["Crimson Keep", "Bloodrose Hall", "Scarlet Spire"],
  hallow: ["Prism Palace", "Pearlglow Manor", "Starlight Sanctum"],
  ocean: ["Seashell Villa", "Tidebreak Mansion", "Coral Cove House"],
  mushroom: ["Glowcap Cottage", "Sporelight Manor", "Bluebell Burrow"],
  sky: ["Cloudhaven Palace", "Starlight Pavilion", "Skyward Manor"],
  underworld: ["Obsidian Citadel", "Emberforge Keep", "Cinder Palace"],
};

/** The look a biome's estate is built in (the forest's for anything else). */
export const lookFor = (biome: string): Look => LOOKS[biome] ?? LOOKS.forest;

type RoomKind = "hall" | "workshop" | "kitchen" | "storage" | "library" | "bedroom" | "bath" | "gallery" | "lounge";

const FLOOR_H = 6;
const ROOM_W = 12;
const TOWER_W = 7;
const GARDEN_W = 16;
const COURT_W = 18;
/** An old save's site (before estates had wings and grounds). */
export const COMPACT_SPAN = 64;
/** A full estate's site. */
export const ESTATE_SPAN = 124;

/** What fits on a site `span` columns wide (most important first). */
export function estatePlan(span: number, rooms: number) {
  let left = span;
  const main = rooms * ROOM_W + 1;
  left -= main;
  const towers = left >= TOWER_W * 2;
  if (towers) left -= TOWER_W * 2;
  const wings = towers && left >= ROOM_W * 2;
  if (wings) left -= ROOM_W * 2;
  const court = wings && left >= COURT_W;
  if (court) left -= COURT_W;
  const garden = court && left >= GARDEN_W;
  return { towers, wings, court, garden };
}

/** One block of storeys: walls at x0 and x1 (shared with the neighbours), `floors` storeys high. */
interface Block {
  x0: number;
  x1: number;
  floors: number;
  kind: "main" | "wing" | "tower";
  rooms: RoomKind[][];
}

/**
 * A luxury estate for a biome on a site starting at x0, with its ground floor at row g.
 * `span` is how wide the site is (old saves: the old 64).
 */
export function luxuryHouse(map: WorldMap, biome: string, x0: number, g: number, seed: number, span = COMPACT_SPAN): Project {
  const b = new Bp();
  const look = lookFor(biome);
  const st = THEMES[look.theme].styles;
  const r = (k: number) => hash(seed + 900, x0, k);
  const full = span > COMPACT_SPAN;
  // Old sites keep the old main house size (3–4 rooms); new sites choose by width.
  let nRooms = 3 + Math.floor(r(1) * 2);
  let plan = estatePlan(span, nRooms);
  if (nRooms === 4 && full && !plan.garden) {
    nRooms = 3;
    plan = estatePlan(span, nRooms);
  }
  const floors = 3 + (r(2) < 0.45 ? 1 : 0);
  const roofStyle = look.roofs[Math.floor(r(5) * look.roofs.length)];
  const roofH = roofStyle === "flat" ? 2 : 7;
  const top = g - FLOOR_H * floors;
  const towerFloors = floors + 2;
  const towerTop = g - FLOOR_H * towerFloors;

  // Lay the parts out left to right (an old site's house keeps its place, towers either side of x0).
  let x = full ? x0 : x0 - (plan.towers ? TOWER_W : 0);
  const gardenX = plan.garden ? x : null;
  if (plan.garden) x += GARDEN_W;
  const blocks: Block[] = [];
  if (plan.towers) {
    blocks.push({ x0: x, x1: x + TOWER_W, floors: towerFloors, kind: "tower", rooms: [] });
    x += TOWER_W;
  }
  if (plan.wings) {
    blocks.push({ x0: x, x1: x + ROOM_W, floors: 2, kind: "wing", rooms: [["workshop"], ["library"]] });
    x += ROOM_W;
  }
  const mainX0 = x;
  blocks.push({ x0: x, x1: x + nRooms * ROOM_W, floors, kind: "main", rooms: mainRooms(floors, nRooms, r(6), plan.wings) });
  x += nRooms * ROOM_W;
  const mainX1 = x;
  if (plan.wings) {
    blocks.push({ x0: x, x1: x + ROOM_W, floors: 2, kind: "wing", rooms: [["kitchen"], ["bath"]] });
    x += ROOM_W;
  }
  if (plan.towers) {
    blocks.push({ x0: x, x1: x + TOWER_W, floors: towerFloors, kind: "tower", rooms: [] });
    x += TOWER_W;
  }
  const courtX = plan.court ? x : null;
  if (plan.court) x += COURT_W;
  const ex0 = blocks[0].x0;
  const ex1 = blocks[blocks.length - 1].x1;
  const sx0 = gardenX ?? ex0;
  const sx1 = courtX !== null ? courtX + COURT_W - 1 : ex1;

  // 1. Trees out of the way.
  for (let c = sx0 - 4; c <= sx1 + 4; c++) if (map.tree(c)) b.chop(c);
  // 2. A level foundation under the buildings, with a plinth step either side.
  for (let c = ex0 - 1; c <= ex1 + 1; c++) {
    const ground = groundAt(map, c);
    for (let y = fillFrom(ground, g); y > g; y--) b.tile(c, y, look.found);
    b.tile(c, g, look.found);
  }

  // 3. The buildings, block by block.
  // (Small sites have balconies off the main house's ends, where nothing stands beside it.)
  const balconies = plan.wings ? [] : [blocks[0].kind === "main" ? blocks[0].x0 : null, blocks[blocks.length - 1].kind === "main" ? blocks[blocks.length - 1].x1 : null].filter((c): c is number => c !== null);
  const balconyF = Math.min(2, floors - 1);
  for (let i = 0; i < blocks.length; i++) buildBlock(b, look, st, blocks, i, g, r, full, (c, f) => f === balconyF && balconies.includes(c));
  // The main house's roof (the eaves overhang anything lower beside it), its attic, a chimney.
  const leftLow = blocks.find((k) => k.x1 === mainX0);
  const rightLow = blocks.find((k) => k.x0 === mainX1);
  b.floors.push({ y: top, x0: mainX0 + 1, x1: mainX1 - 1 });
  roof(b, roofStyle, leftLow?.kind === "tower" ? mainX0 + 1 : mainX0 - 1, rightLow?.kind === "tower" ? mainX1 - 1 : mainX1 + 1, top, roofH, look);
  if (roofStyle !== "flat") {
    // The roof's underside, filled (it reads as a solid roof, and the attic has a wall).
    for (let y = top - 1; y > top - roofH; y--) {
      const row: number[] = [];
      for (let c = mainX0 - 1; c <= mainX1 + 1; c++) if (b.planned.has(y * 65536 + c)) row.push(c);
      if (row.length < 2) continue;
      for (let c = Math.min(...row) + 1; c < Math.max(...row); c++) if (!b.planned.has(y * 65536 + c)) b.wall(c, y, look.alt);
    }
    b.obj(Math.floor((mainX0 + mainX1) / 2) - 1, top - 2, "chest", st.chest);
  }
  if (look.chimney && roofStyle !== "flat") chimney(b, look, mainX1, top, roofH);
  // Wing roofs: railed terraces.
  for (const k of blocks) if (k.kind === "wing") terrace(b, look, k, g);
  // Towers: lookouts under spires, and the skybridge between them.
  const towers = blocks.filter((k) => k.kind === "tower");
  for (const t of towers) lookout(b, look, t, towerTop);
  if (towers.length === 2) bridge(b, look, towers[0], towers[1], towerTop);
  // Balconies off the main house where nothing stands beside it (small sites).
  for (const c of balconies) balcony(b, look, c, c === mainX0 ? -1 : 1, g - balconyF * FLOOR_H);

  // 4. The grounds: a garden on the left, a courtyard on the right (or the plain doorsteps).
  const lowest = Math.min(towerTop - 10, top - roofH - 3);
  if (gardenX !== null) garden(b, map, look, gardenX, g, r);
  else doorstep(b, map, ex0, g, -1);
  if (courtX !== null) courtyard(b, map, look, st, courtX, g);
  else doorstep(b, map, ex1, g, 1);

  // 5. Clear what's in the way (everything in the footprint that isn't part of the build).
  const clears: Task[] = [];
  for (let y = lowest; y < g; y++) for (let c = sx0 - 2; c <= sx1 + 2; c++) if (!b.planned.has(y * 65536 + c)) clears.push({ kind: "clear", x: c, y });
  const chops = b.tasks.filter((t) => t.kind === "chop");
  const rest = b.tasks.filter((t) => t.kind !== "chop");
  b.tasks = [...chops, ...clears, ...rest];
  for (const c of clears) b.grow(c.x, (c as { y: number }).y);
  const names = LUXURY_NAMES[biome] ?? LUXURY_NAMES.forest;
  const name = names[Math.floor(r(50) * names.length)];
  const door = gardenX !== null ? { x: gardenX + 2, y: g } : { x: ex0 - 2, y: g };
  return b.project(`lux-${biome}`, "luxury", name, biome as Zone, door, { kind: "luxury", biome, x0, g, seed, ...(full ? { span } : {}) });
}

/** The main house's rooms, storey by storey (the hall on the ground floor, bedrooms up top). */
function mainRooms(floors: number, n: number, roll: number, wings: boolean): RoomKind[][] {
  const ground: RoomKind[] = wings ? ["lounge", "hall", "gallery", "storage"] : ["workshop", "hall", "kitchen", "storage"];
  const second: RoomKind[] = wings ? ["bedroom", "gallery", "bedroom", "library"] : ["library", "bedroom", "gallery", "bedroom"];
  const third: RoomKind[] = wings ? ["bedroom", "lounge", "bedroom", "bedroom"] : ["bedroom", "bath", "bedroom", "library"];
  const fourth: RoomKind[] = ["bedroom", "gallery", "bedroom", "bedroom"];
  const rows = [ground, second, third, fourth].slice(0, floors).map((row) => row.slice(0, n));
  if (roll < 0.5) rows.forEach((row) => row.reverse());
  return rows;
}

/** Does the wall at column c have a doorway on storey f? (Shared walls between storeys on both
 * sides; onto a wing's terrace from the storey above it; the front doors at the ends.) */
function doorwayAt(blocks: Block[], c: number, f: number): boolean {
  const left = blocks.find((k) => k.x1 === c);
  const right = blocks.find((k) => k.x0 === c);
  const has = (k: Block | undefined) => !!k && f < k.floors;
  const terraceOf = (k: Block | undefined) => !!k && k.kind === "wing" && f === k.floors;
  if (has(left) && has(right)) return true;
  if ((has(left) && terraceOf(right)) || (has(right) && terraceOf(left))) return true;
  // The outer ends: a front door on the ground floor.
  if (!left || !right) return f === 0;
  return false;
}

function buildBlock(b: Bp, look: Look, st: Record<string, number>, blocks: Block[], i: number, g: number, r: (k: number) => number, full: boolean, balconyAt: (c: number, f: number) => boolean) {
  const k = blocks[i];
  const tower = k.kind === "tower";
  for (let f = 0; f < k.floors; f++) {
    const fy = g - f * FLOOR_H;
    const cy = fy - FLOOR_H;
    // Back walls: each room its own, with a wainscot band, pilasters at its edges and an arched
    // stained-glass window in the middle; the wall columns get the hall wall (blocks hold on to it).
    const rooms = tower ? 1 : Math.round((k.x1 - k.x0) / ROOM_W);
    const rw = tower ? k.x1 - k.x0 : ROOM_W;
    for (let n = 0; n < rooms; n++) {
      const rx0 = k.x0 + n * rw + 1;
      const rx1 = rx0 + rw - 2;
      const kind = k.rooms[f]?.[n];
      const main = kind === "hall" || kind === "lounge" ? look.hall : (n + f) % 2 === 0 ? look.wall : look.alt;
      const mid = Math.floor((rx0 + rx1) / 2);
      for (let y = fy - 1; y > cy; y--)
        for (let c = rx0; c <= rx1; c++) {
          const band = y >= fy - 1;
          const pilaster = !tower && (c === rx0 || c === rx1);
          const arch = !tower && kind !== "storage" && kind !== "workshop" && inArch(c - mid, fy - 1 - y);
          b.wall(c, y, arch ? look.glass : pilaster ? look.pillar : band ? look.wainscot : main);
        }
    }
    for (let y = cy; y <= fy - 1; y++) {
      for (let n = 0; n <= rooms; n++) b.wall(k.x0 + n * rw, y, look.hall);
    }
    // The frame: outer walls (doorways where they lead somewhere), partitions with doorways.
    for (const c of [k.x0, k.x1]) {
      const open = doorwayAt(blocks, c, f) || balconyAt(c, f);
      for (let y = fy - 1; y > cy; y--) {
        const doorRow = y >= fy - 3;
        if (doorRow && open) continue;
        const window = tower && f > 0 && y >= fy - 4 && y <= fy - 3 && !blocks.some((o) => o !== k && (o.x0 === c || o.x1 === c));
        b.tile(c, y, window ? look.accent : look.frame);
      }
      if (open) b.obj(c, fy - 3, "door", st.door);
    }
    for (let n = 1; n < rooms; n++) {
      const px = k.x0 + n * rw;
      for (let y = cy + 1; y <= fy - 4; y++) b.tile(px, y, look.frame);
      b.obj(px, fy - 3, "door", st.door);
    }
    // The floor above: platforms (jump up through them), trim at the walls.
    for (let c = k.x0; c <= k.x1; c++) {
      const wallCol = c === k.x0 || c === k.x1 || (!tower && (c - k.x0) % rw === 0);
      b.tile(c, cy, wallCol ? look.trim : T.Platform);
    }
    b.floors.push({ y: fy, x0: k.x0 + 1, x1: k.x1 - 1 });
    // Furniture.
    if (tower) {
      b.obj(k.x0 + 2, fy - 4, "torch");
      b.obj(k.x1 - 2, fy - 4, "torch");
      if (f > 0) b.obj(k.x0 + 3, fy - 3, "lamp", st.lamp);
      if (f === 0) b.obj(k.x0 + 2, fy - 2, "chest", st.chest);
      if (f > 1 && f < k.floors - 1) b.obj(k.x0 + 2, fy - 3, "statue", Math.floor(r(40 + f) * 6));
    } else for (let n = 0; n < rooms; n++) furnish(b, look, k.rooms[f]?.[n] ?? "bedroom", k.x0 + n * rw + 1, fy, r(10 + f * 10 + n + k.x0), full);
  }
}

/** An arched window, centred: 3 wide, 4 tall, the top row just the keystone. */
function inArch(dx: number, up: number): boolean {
  if (up < 1 || up > 4) return false;
  if (up === 4) return dx === 0;
  return Math.abs(dx) <= 1;
}

/** Furniture for one room (left edge rx0, floor row fy; rooms are 11 wide and 5 high inside). */
function furnish(b: Bp, look: Look, kind: RoomKind, rx0: number, fy: number, roll: number, full: boolean) {
  const st = THEMES[look.theme].styles;
  // (Pieces spaced out in some rooms; the workshop's stations stand close to fit them all.)
  const gap = kind !== "workshop" && roll > 0.5 ? 1 : 0;
  let x = rx0 + 1;
  const put = (obj: ObjectType, w: number, h: number, style = 0) => {
    if (x + w - 1 > rx0 + 9) return null;
    const at = x;
    b.obj(x, fy - h, obj, style);
    x += w + gap;
    return at;
  };
  // A table with something on it (a candelabra, a crystal ball…).
  const table = (on: ObjectType | null, style = 0) => {
    const at = put("table", 3, 2, st.table);
    if (at !== null && on) b.obj(at, fy - 4, on, style);
  };
  // Every room has a light on the wall.
  b.obj(rx0 + 1, fy - 4, "torch");
  switch (kind) {
    case "hall":
      put("fireplace", 3, 2);
      put("sofa", 3, 2, st.sofa);
      put("clock", 2, 5);
      put("plant", 1, 1);
      b.obj(rx0 + 4, fy - 5, "chandelier", st.chandelier);
      b.obj(rx0 + 8, fy - 5, "painting", Math.floor(roll * 12));
      break;
    case "lounge":
      put("fireplace", 3, 2);
      put("throne", 3, 4);
      table("candelabra", 0);
      b.obj(rx0 + 5, fy - 5, "chandelier", st.chandelier);
      break;
    case "workshop":
      put("workbench", 2, 1);
      put("anvil", 2, 1);
      put("furnace", 3, 2);
      put("sawmill", 3, 3);
      b.obj(rx0 + 1, fy - 2, "bottle");
      break;
    case "kitchen":
      table("candelabra");
      put("chair", 1, 2, st.chair);
      put("cookingpot", 2, 2);
      put("keg", 2, 2);
      b.obj(rx0 + 5, fy - 5, look.lantern);
      break;
    case "storage":
      put("chest", 2, 2, st.chest);
      put("chest", 2, 2, st.chest);
      put("chest", 2, 2, st.chest);
      put("safe", 2, 2);
      put("piggybank", 2, 1);
      break;
    case "library":
      put("bookcase", 3, 4, st.bookcase);
      table("crystalball");
      put("chair", 1, 2, st.chair);
      put("loom", 3, 2);
      break;
    case "bedroom":
      put("bed", 4, 2, st.bed);
      put("chair", 1, 2, st.chair);
      table(full ? "candelabra" : null);
      put("lamp", 1, 3, st.lamp);
      b.rooms.push({ x: rx0 + 5, y: fy - 3 });
      b.obj(rx0 + 7, fy - 5, "painting", Math.floor(roll * 12));
      break;
    case "bath":
      put("bathtub", 4, 2);
      put("sink", 2, 2);
      put("dresser", 3, 2);
      put("plant", 1, 1);
      break;
    case "gallery":
      put("piano", 3, 2, st.piano);
      put("statue", 2, 3, Math.floor(roll * 5) + 1);
      put("weaponrack", 3, 3);
      put("plant", 1, 1);
      b.obj(rx0 + 2, fy - 5, "painting", Math.floor(roll * 11) + 1);
      b.obj(rx0 + 6, fy - 5, "banner", Math.floor(roll * 4));
      break;
  }
  if (look.extra === "vines") b.obj(rx0 + 9, fy - 5, "vineflowers", Math.floor(roll * 13));
}

/** A roof over row `top` between eaves ea..eb (inclusive), with a trim course along its foot. */
function roof(b: Bp, style: RoofStyle, ea: number, eb: number, top: number, h: number, look: Look) {
  // (Every roof block has a wall behind it, so each holds on however the curve runs.)
  const put = (x: number, y: number, t: number) => {
    b.wall(x, y, look.alt);
    b.tile(x, y, t);
  };
  if (style === "flat") {
    // Battlements (each merlon stands on the ceiling row below).
    for (let x = ea + 1; x <= eb - 1; x++) if ((x - ea) % 2 === 1) put(x, top - 1, look.trim);
    return;
  }
  const x0 = ea + 1;
  const x1 = eb - 1;
  const span = x1 - x0;
  // How far in each row starts (never out past the eaves: a dome's first rows bulge otherwise).
  const insetAt = (k: number) =>
    k <= 0 ? 0 : Math.max(0, style === "dome" ? Math.round(span / 2 - Math.sqrt(Math.max(0, 1 - (k / h) ** 2)) * (span / 2 + 1)) : style === "stepped" ? k * 2 : Math.round((k * (span / 2)) / h));
  for (let k = 1; k <= h - 1; k++) {
    const a = x0 - 1 + insetAt(k);
    const c = x1 + 1 - insetAt(k);
    if (a > c) break;
    const pa = x0 - 1 + insetAt(k - 1);
    const pc = x1 + 1 - insetAt(k - 1);
    // The outline: the step from the row below to this one, on both sides; the top row full.
    const mat = k === 1 ? look.trim : look.roof;
    for (let x = pa; x <= a; x++) put(x, top - k, mat);
    for (let x = c; x <= pc; x++) put(x, top - k, mat);
    if (k === h - 1 || c - a <= 3) {
      for (let x = a; x <= c; x++) put(x, top - k, look.roof);
      // A finial on the very top.
      if (c - a <= 3) put(Math.floor((a + c) / 2), top - k - 1, look.accent);
      break;
    }
  }
}

/** A chimney low on the roof's right slope (within reach from the attic): a brick stack built up
 * from the roof to a level top, the smoking chimney on it. */
function chimney(b: Bp, look: Look, x1: number, top: number, h: number) {
  const cols = [x1 - 6, x1 - 5, x1 - 4];
  const roofTop = cols.map((x) => {
    for (let y = top - h - 1; y <= top - 1; y++) if (b.planned.has(y * 65536 + x)) return y;
    return null;
  });
  if (roofTop.some((y) => y === null)) return;
  const base = Math.min(...(roofTop as number[])) - 1;
  cols.forEach((x, i) => {
    for (let y = base; y < roofTop[i]!; y++) b.tile(x, y, look.frame);
  });
  b.obj(cols[0], base - 3, "chimney");
}

/** A wing's roof as a terrace: railings along it, planters and lamps, reached from the main house. */
function terrace(b: Bp, look: Look, k: Block, g: number) {
  const y = g - k.floors * FLOOR_H;
  for (let x = k.x0; x <= k.x1; x++) for (let d = 1; d <= 2; d++) b.wall(x, y - d, look.fence);
  b.floors.push({ y, x0: k.x0 + 1, x1: k.x1 - 1 });
  b.obj(k.x0 + 2, y - 3, "lamp", THEMES[look.theme].styles.lamp);
  b.obj(k.x1 - 2, y - 3, "lamp", THEMES[look.theme].styles.lamp);
  const flower = look.flowers[0] * 4;
  for (let x = k.x0 + 4; x <= k.x1 - 4; x++) b.obj(x, y - 1, "planter", flower + (x === k.x0 + 4 ? 0 : x === k.x1 - 4 ? 2 : 1));
  if (look.extra === "vines") for (let x = k.x0 + 2; x <= k.x1 - 2; x += 3) b.obj(x, y + 1, "vineflowers", (x * 7) % 13);
}

/** A tower's crown: an open lookout (beams at the corners, railings on the outside, a lantern)
 * under a cornice and a spire. */
function lookout(b: Bp, look: Look, t: Block, towerTop: number) {
  const cornice = towerTop - 4;
  b.floors.push({ y: towerTop, x0: t.x0 + 1, x1: t.x1 - 1 });
  for (let y = towerTop - 1; y > cornice; y--) {
    b.tile(t.x0, y, T.WoodBeam);
    b.tile(t.x1, y, T.WoodBeam);
  }
  // Railings all round (they're behind you: the way onto the bridge stays open).
  for (let x = t.x0; x <= t.x1; x++) for (let d = 1; d <= 2; d++) b.wall(x, towerTop - d, look.fence);
  // The cornice: platforms in the middle (climb up through to work on the spire), trim at the ends.
  for (let x = t.x0 - 1; x <= t.x1 + 1; x++) {
    b.wall(x, cornice, look.alt);
    b.tile(x, cornice, x <= t.x0 || x >= t.x1 ? look.trim : T.Platform);
  }
  b.floors.push({ y: cornice, x0: t.x0 + 1, x1: t.x1 - 1 });
  b.obj(Math.floor((t.x0 + t.x1) / 2), towerTop - 3, "lantern");
  // The spire, on a back wall (its sloped sides only touch diagonally: a block needs something to attach to).
  for (let k = 1; k <= 4; k++)
    for (let x = t.x0 + k - 1; x <= t.x1 - k + 1; x++) {
      b.wall(x, cornice - k, look.alt);
      if (x === t.x0 + k - 1 || x === t.x1 - k + 1 || k === 4) b.tile(x, cornice - k, look.roof);
    }
  b.wall(Math.floor((t.x0 + t.x1) / 2), cornice - 5, look.alt);
  b.tile(Math.floor((t.x0 + t.x1) / 2), cornice - 5, look.accent);
}

/** The skybridge between the two lookouts: a railed walkway with lanterns hung beneath, built
 * out from both towers at once (each builder standing on what's done of it). */
function bridge(b: Bp, look: Look, left: Block, right: Block, y: number) {
  const xa = left.x1;
  const xb = right.x0;
  for (let i = 0; xa + i <= xb - i; i++)
    for (const x of xa + i === xb - i ? [xa + i] : [xa + i, xb - i]) {
      b.tile(x, y, T.Platform);
      for (let d = 1; d <= 2; d++) b.wall(x, y - d, look.fence);
    }
  b.floors.push({ y, x0: xa, x1: xb, walk: true, entry: [{ x0: left.x0 + 1, x1: left.x1 - 1 }, { x0: right.x0 + 1, x1: right.x1 - 1 }] });
  for (let x = xa + 6; x <= xb - 6; x += 8) b.obj(x, y + 1, look.lantern);
}

/** A balcony off an upper storey (its floor row fy): a railed ledge of platforms outside the door. */
function balcony(b: Bp, look: Look, wallX: number, side: -1 | 1, fy: number) {
  for (let k = 1; k <= 3; k++) {
    const x = wallX + side * k;
    b.tile(x, fy, T.Platform);
    for (let d = 1; d <= 2; d++) b.wall(x, fy - d, look.fence);
  }
  b.floors.push({ y: fy, x0: Math.min(wallX + side, wallX + side * 3), x1: Math.max(wallX + side, wallX + side * 3) });
  b.obj(wallX + side * 2, fy - 3, "lamp", THEMES[look.theme].styles.lamp);
}

/** The garden: soil and a path through a gate arch, a fountain, trees grown from acorns among
 * flower beds, lamp posts (and sunflowers, coral or glowing mushrooms by the biome). */
function garden(b: Bp, map: WorldMap, look: Look, x0: number, g: number, r: (k: number) => number) {
  const x1 = x0 + GARDEN_W - 1;
  ground(b, map, look, x0, x1, g, (x) => (x <= x0 + 5 ? look.path : look.soil));
  doorstep(b, map, x0, g, -1);
  arch(b, look, x0 + 1, x0 + 5, g);
  if (look.extra === "sunflowers") b.obj(x0 + 6, g - 4, "sunflower", Math.floor(r(74) * 3));
  if (look.extra === "coral") for (const x of [x0 + 6, x0 + 7]) b.obj(x, g - 1, "coral", Math.floor(r(75 + x) * 6));
  if (look.extra === "glowshrooms") for (const x of [x0 + 6, x0 + 7]) b.obj(x, g - 1, "glowshroom", x % 5);
  b.obj(x0 + 8, g - 6, "lamppost");
  b.obj(x0 + 9, g - 4, "fountain", look.fountain);
  const tree = (i: number) => look.trees[Math.floor(r(70 + i) * look.trees.length)];
  b.obj(x0 + 12, g - 6, "gardentree", tree(0));
  b.obj(x0 + 14, g - 6, "gardentree", tree(1));
  for (const x of [x0 + 11, x0 + 13]) b.obj(x, g - 1, "planter", look.flowers[x % look.flowers.length] * 4 + 3);
  b.obj(x0 + 15, g - 6, "lamppost");
}

/** The courtyard: paving, a fountain between two benches, lamps, flower beds, a gate arch. */
function courtyard(b: Bp, map: WorldMap, look: Look, st: Record<string, number>, x0: number, g: number) {
  const x1 = x0 + COURT_W - 1;
  ground(b, map, look, x0, x1, g, () => look.path);
  doorstep(b, map, x1, g, 1);
  b.obj(x0 + 1, g - 6, "lamppost");
  b.obj(x0 + 2, g - 2, "sofa", st.sofa);
  b.obj(x0 + 5, g - 1, "planter", look.flowers[0] * 4 + 3);
  b.obj(x0 + 7, g - 4, "fountain", look.fountain);
  b.obj(x0 + 9, g - 1, "planter", look.flowers[look.flowers.length - 1] * 4 + 3);
  b.obj(x0 + 10, g - 2, "sofa", st.sofa);
  b.obj(x0 + 13, g - 6, "lamppost");
  arch(b, look, x1 - 3, x1, g);
}

/** Level ground for the grounds: filled up from the real ground, `top(x)` as the surface. */
function ground(b: Bp, map: WorldMap, look: Look, x0: number, x1: number, g: number, top: (x: number) => number) {
  for (let x = x0; x <= x1; x++) {
    const real = groundAt(map, x);
    const fill = look.soil === T.JungleGrass || look.soil === T.MushroomGrass ? T.Mud : look.soil === T.Sand || look.soil === T.Snow || look.soil === T.Cloud || look.soil === T.Ash ? look.soil : T.Dirt;
    for (let y = fillFrom(real, g); y > g; y--) b.tile(x, y, fill);
    b.tile(x, g, top(x));
  }
}

/** A gate arch over the path: beam posts at xa and xb, a trim lintel on a lattice back, a lantern. */
function arch(b: Bp, look: Look, xa: number, xb: number, g: number) {
  for (let y = g - 1; y >= g - 5; y--) {
    b.tile(xa, y, T.WoodBeam);
    b.tile(xb, y, T.WoodBeam);
  }
  for (let x = xa; x <= xb; x++) {
    b.wall(x, g - 6, look.fence);
    b.tile(x, g - 6, look.trim);
  }
  b.tile(Math.floor((xa + xb) / 2), g - 7, look.accent);
  b.wall(Math.floor((xa + xb) / 2), g - 7, look.fence);
  b.obj(Math.floor((xa + xb) / 2), g - 5, "lantern");
}

/**
 * Where a biome's estate goes, near column `near`: inside the biome's dry ground (not the sea),
 * as wide as fits up to a full estate, on the flattest stretch with solid ground under it.
 */
export function estateSite(map: WorldMap, biome: string, near: number, avoid: { x0: number; x1: number }[] = []): { x0: number; g: number; span: number } {
  const dry = (x: number) => x >= 0 && x < map.size.width && map.biome(x) === biome && map.liquid(x, map.surface(x) - 1) === 0;
  let a = Math.max(0, Math.min(map.size.width - 1, near));
  // (Start from the nearest dry column of the biome.)
  for (let d = 0; d < 600 && !dry(a); d++) a = dry(near + d) ? near + d : dry(near - d) ? near - d : a;
  let c = a;
  while (a > 0 && dry(a - 1)) a--;
  while (c < map.size.width - 1 && dry(c + 1)) c++;
  // The widest estate whose ground is fairly level: no deep fills (builders get stuck in the
  // pits between tall columns) — on rough ground the garden and courtyard are left out.
  const widest = Math.max(COMPACT_SPAN, Math.min(ESTATE_SPAN, c - a - 8));
  let pick: { x0: number; g: number; span: number } | null = null;
  // (Not on top of the world's own buildings: a beach shack, a cabin, the dungeon.)
  const keep = [...avoid, ...map.structures.filter((s) => s.y0 < map.surface(s.x0) + 20 && s.kind !== "island").map((s) => ({ x0: s.x0, x1: s.x1 }))];
  for (const span of [widest, 108, 90, COMPACT_SPAN]) {
    if (span > widest) continue;
    const site = chooseFlat(map, a + 4, Math.max(a + 4, c - 4 - span), span, keep);
    pick = { ...site, span };
    if (roughness(map, site.x0, span, site.g) <= MAX_ROUGH) break;
  }
  return pick!;
}

/** How far the ground strays from the floor row over a site (the deepest fill or cut). */
export function roughness(map: WorldMap, x0: number, span: number, g: number): number {
  let worst = 0;
  for (let x = x0; x < x0 + span; x++) worst = Math.max(worst, Math.abs(groundAt(map, x) - g));
  return worst;
}
const MAX_ROUGH = 6;

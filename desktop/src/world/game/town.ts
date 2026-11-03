// Town NPCs for the waifus' playthrough: who they are (real NPC sprites from the local install),
// when they're willing to move in (Terraria-style conditions, or being met at their settlement),
// what they sell, and the housing check that decides whether a room is a home: enclosed, a
// background wall behind every tile, a light, somewhere to sit, a table and a door.

import { HELL_TOP, type WorldMap } from "../gen";
import type { BossId, Game } from "./game";
import { OBJECTS, type HousingRole } from "./furniture";
import { countOf } from "./inventory";
import type { ObjectLayer } from "./objects";
import { moveBox, TILE, type Box } from "./physics";

export type TownId = "guide" | "merchant" | "demolitionist" | "dryad" | "armsdealer" | "painter" | "dyetrader" | "angler" | "witchdoctor" | "clothier" | "mechanic" | "stylist" | "oldman";

export interface TownDef {
  name: string;
  tex: string;
  fw: number;
  /** Frame height (frames are stacked vertically; the count follows from the sheet height). */
  fh: number;
  /** What they sell: item id → price (copper). */
  shop: [number, number][];
  quotes: string[];
  /** Why they'd move in (shown in the HUD). */
  why: string;
  /** Lives in town (the Old Man stays at the dungeon). */
  resident: boolean;
  /** Needs to be met at their settlement first. */
  meet?: boolean;
  /** Extra condition. */
  needs?: (g: Game, residents: number) => boolean;
}

const boss = (b: BossId) => (g: Game) => g.bosses[b];

export const TOWN: Record<TownId, TownDef> = {
  guide: { name: "Guide", tex: "Images/NPC_22", fw: 40, fh: 56, shop: [], quotes: ["You'll want a house with a door, a light, a chair and a table.", "Life crystals are hidden deep underground.", "The Eye of Cthulhu only comes at night."], why: "always comes first", resident: true },
  merchant: {
    name: "Merchant",
    tex: "Images/NPC_17",
    fw: 40,
    fh: 56,
    shop: [
      [8, 50],
      [28, 300],
      [40, 5],
      [31, 20],
      [88, 40_000],
      [87, 10_000],
      [3509, 200],
      [3506, 100],
    ],
    quotes: ["Torches, potions, arrows! Best prices in the world.", "You look like you could use a Piggy Bank."],
    why: "arrives once the team has 50 silver",
    resident: true,
    needs: (g) => g.coins >= 5_000,
  },
  demolitionist: {
    name: "Demolitionist",
    tex: "Images/NPC_38",
    fw: 52,
    fh: 56,
    shop: [
      [168, 75],
      [166, 300],
      [167, 2_000],
    ],
    quotes: ["Boom! Ha ha!", "Explosives are da' bomb these days."],
    why: "arrives when the team has explosives",
    resident: true,
    needs: (g) => countOf(g.inventory, 166) + countOf(g.inventory, 167) + countOf(g.inventory, 168) > 0,
  },
  dryad: {
    name: "Dryad",
    tex: "Images/NPC_20",
    fw: 40,
    fh: 56,
    shop: [
      [66, 75],
      [313, 100],
      [314, 100],
      [315, 100],
      [317, 100],
    ],
    quotes: ["The corruption spreads... we must keep the world pure.", "These herbs make fine potions."],
    why: "met at the Mossy Grove",
    resident: true,
    meet: true,
  },
  armsdealer: {
    name: "Arms Dealer",
    tex: "Images/NPC_19",
    fw: 40,
    fh: 56,
    shop: [
      [97, 7],
      [95, 100_000],
      [98, 350_000],
    ],
    quotes: ["Guns and ammo, that's what I sell.", "Keep your powder dry!"],
    why: "arrives when the team has a gun or bullets",
    resident: true,
    needs: (g) => g.inventory.some((s) => s && (s.id === 95 || s.id === 96 || s.id === 97 || s.id === 164 || s.id === 98)),
  },
  painter: {
    name: "Painter",
    tex: "Images/NPC_227",
    fw: 46,
    fh: 56,
    shop: Array.from({ length: 12 }, (_, s) => [OBJECTS.painting.drop(s)!, 10_000] as [number, number]),
    quotes: ["A room without art is just a box.", "That wall is begging for a painting."],
    why: "arrives once four others live in town",
    resident: true,
    needs: (_g, residents) => residents >= 4,
  },
  dyetrader: {
    name: "Dye Trader",
    tex: "Images/NPC_207",
    fw: 40,
    fh: 64,
    shop: [[225, 100]],
    quotes: ["Colour is everything.", "I found the finest silk at the oasis."],
    why: "met at the Oasis Camp",
    resident: true,
    meet: true,
  },
  angler: {
    name: "Angler",
    tex: "Images/NPC_369",
    fw: 40,
    fh: 58,
    shop: [[295, 2_000]],
    quotes: ["Fish! I need fish! ...fine, I'll move in.", "The ocean has the best stuff."],
    why: "met at the Driftwood Hut",
    resident: true,
    meet: true,
  },
  witchdoctor: {
    name: "Witch Doctor",
    tex: "Images/NPC_228",
    fw: 50,
    fh: 56,
    shop: [
      [289, 5_000],
      [210, 1_000],
    ],
    quotes: ["The jungle has many secrets.", "The bees answer to their queen... no longer."],
    why: "met at the Vinewood Lodge, after the Queen Bee",
    resident: true,
    meet: true,
    needs: boss("queenBee"),
  },
  clothier: {
    name: "Clothier",
    tex: "Images/NPC_54",
    fw: 48,
    fh: 58,
    shop: [
      [225, 100],
      [332, 5_000],
    ],
    quotes: ["Thank you for freeing me from that curse!", "Fine thread makes fine homes."],
    why: "freed when Skeletron falls",
    resident: true,
    needs: boss("skeletron"),
  },
  mechanic: {
    name: "Mechanic",
    tex: "Images/NPC_124",
    fw: 40,
    fh: 58,
    shop: [[398, 100_000]],
    quotes: ["You rescued me! I owe you one.", "Every good house needs a workshop."],
    why: "rescued deep in the Dungeon",
    resident: true,
    meet: true,
    needs: boss("skeletron"),
  },
  stylist: {
    name: "Stylist",
    tex: "Images/NPC_353",
    fw: 40,
    fh: 56,
    shop: [[2325, 5_000]],
    quotes: ["Oh, you girls have such lovely hair.", "It was so cold up at that lodge!"],
    why: "met at the Frostpine Lodge",
    resident: true,
    meet: true,
  },
  oldman: { name: "Old Man", tex: "Images/NPC_37", fw: 40, fh: 56, shop: [], quotes: ["You cannot enter the dungeon... not while the curse holds.", "Come back at night, if you dare."], why: "", resident: false },
};

export const TOWN_IDS = Object.keys(TOWN) as TownId[];

// ── Housing ─────────────────────────────────────────────────────────────────────────────────

export interface Room {
  /** Smallest cell key inside: a stable id for the room. */
  key: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A floor spot to stand on (tile x, feet row). */
  stand: { x: number; y: number };
  size: number;
}

const MAX_ROOM = 750;

/** The room containing tile (x, y), if it's a valid home (Terraria's rules, simplified). */
export function roomAt(map: WorldMap, objects: ObjectLayer, x: number, y: number): Room | null {
  const solidish = (tx: number, ty: number) => map.solid(tx, ty) || map.tile(tx, ty) === 14 /* platform */ || objects.doorAt(tx, ty);
  if (solidish(x, y)) return null;
  const seen = new Set<number>();
  const stack = [y * 65536 + x];
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;
  let hasDoor = false;
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k)) continue;
    const cx = k % 65536;
    const cy = Math.floor(k / 65536);
    if (solidish(cx, cy)) {
      if (objects.doorAt(cx, cy) || map.tile(cx, cy) === 14) hasDoor = true;
      continue;
    }
    seen.add(k);
    // Open to the outside (no wall behind) or too big: not a room.
    if (seen.size > MAX_ROOM || !map.wall(cx, cy) || cy < 2 || cy >= HELL_TOP + 70) return null;
    x0 = Math.min(x0, cx);
    x1 = Math.max(x1, cx);
    y0 = Math.min(y0, cy);
    y1 = Math.max(y1, cy);
    stack.push(k + 1, k - 1, k + 65536, k - 65536);
  }
  if (seen.size < 36 || !hasDoor) return null;
  // Furniture: a light, a seat, a table.
  const roles = new Set<HousingRole>();
  for (const o of objects.inRect(x0 - 1, y0 - 1, x1 + 1, y1 + 1)) {
    const d = OBJECTS[o.t];
    let inside = false;
    for (let dx = 0; dx < d.w && !inside; dx++) for (let dy = 0; dy < d.h && !inside; dy++) inside = seen.has((o.y + dy) * 65536 + o.x + dx);
    if (inside) for (const r of d.roles ?? []) roles.add(r);
  }
  if (!roles.has("light") || !roles.has("chair") || !roles.has("table")) return null;
  // A spot on the floor.
  let stand = { x, y };
  for (const k of seen) {
    const cx = k % 65536;
    const cy = Math.floor(k / 65536);
    if (map.standable(cx, cy + 1) && !seen.has((cy + 1) * 65536 + cx)) {
      stand = { x: cx, y: cy + 1 };
      break;
    }
  }
  return { key: Math.min(...seen), x0, y0, x1, y1, stand, size: seen.size };
}

// ── NPCs in the world ───────────────────────────────────────────────────────────────────────

export interface TownNpc extends Box {
  id: TownId;
  dir: -1 | 1;
  t: number;
  walk: number;
  /** Their room (by key), and where they stand at home. */
  room: number | null;
  home: { x: number; y: number };
  say: { text: string; until: number } | null;
  /** Waiting at a settlement / the dungeon (not yet moved in). */
  waiting: boolean;
  wander: number;
}

export function makeTownNpc(id: TownId, x: number, y: number, waiting: boolean): TownNpc {
  return { id, x: x - 10, y: y - 42, w: 20, h: 42, vx: 0, vy: 0, onGround: false, dir: 1, t: 0, walk: 0, room: null, home: { x, y }, say: null, waiting, wander: 0 };
}

/** One step for a town NPC: wander near home by day, stay home at night. */
export function stepTownNpc(n: TownNpc, map: WorldMap, night: boolean, rnd: () => number, dt: number, clock: number) {
  n.t += dt;
  const range = n.waiting ? 4 * TILE : night ? TILE : 12 * TILE;
  if (n.t > n.wander) {
    n.t = 0;
    n.wander = 2 + rnd() * 4;
    n.dir = rnd() < 0.5 ? -1 : 1;
  }
  const off = n.x + n.w / 2 - n.home.x;
  let move = 0;
  if (Math.abs(off) > range) move = off > 0 ? -1 : 1;
  else if (n.t < n.wander * 0.5 && !night) move = n.dir;
  if (move) n.dir = move as -1 | 1;
  n.vx += (move * 60 - n.vx) * Math.min(1, dt * 6);
  const r = moveBox(map, n, dt, { gravity: 1440, maxFall: 600, stepUp: true });
  if (r.hitX && n.onGround) n.vy = -300;
  if (n.onGround) n.walk += Math.abs(n.vx) * dt;
  // Fell far away (or stuck): back home.
  if (Math.abs(off) > 60 * TILE || n.y > map.size.height * TILE) {
    n.x = n.home.x - n.w / 2;
    n.y = n.home.y - n.h - 1;
    n.vx = 0;
    n.vy = 0;
  }
  if (n.say && clock > n.say.until) n.say = null;
}

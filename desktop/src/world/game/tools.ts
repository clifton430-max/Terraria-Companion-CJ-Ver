// What a builder needs to break something, and how to get it when she doesn't have it: the
// right tool from the shared inventory, or a plan to craft one (gather → smelt → place the
// station → craft), choosing the cheapest tool that can actually be made. Chains that loop back
// on themselves (a pickaxe to mine the ore for a pickaxe) and materials that can't be gathered
// peacefully (gel) make an option impossible rather than an endless errand.

import { T, type TreeKind, type WorldMap } from "../gen";
import type { ObjectType } from "./furniture";
import type { NpcKind } from "./npcData";
import { countOf, recipeFor, type Slot, type Station } from "./inventory";
import { BLOCK_ITEM_BASE, ITEMS, type ItemDef } from "./items";
import type { ObjectLayer } from "./objects";

export type ToolKind = "pickaxe" | "axe";

/**
 * Pickaxe power a block needs, Terraria-style: meteorite 50, demonite and obsidian 55,
 * hellstone and dungeon bricks 65. Everything else breaks with any pickaxe.
 */
export const TILE_MIN_POWER: Partial<Record<number, number>> = {
  [T.Meteorite]: 50,
  [T.Demonite]: 55,
  [T.Crimtane]: 55,
  [T.Obsidian]: 55,
  [T.Hellstone]: 65,
  [T.BlueBrick]: 65,
  [T.GreenBrick]: 65,
  [T.PinkBrick]: 65,
};
export const minPower = (tile: number) => TILE_MIN_POWER[tile] ?? 0;

/** What it takes to break the thing at a tile. */
export type Requirement =
  | { kind: "none" } // nothing there
  | { kind: "tool"; tool: ToolKind; power: number; chopCol?: number }
  | { kind: "blocked"; reason: "chest" };

export function requirement(map: WorldMap, objects: ObjectLayer, x: number, y: number): Requirement {
  const o = objects.at(x, y);
  if (o) {
    // A chest with things in it can't be picked up (and we never empty Master's chests).
    if (o.t === "chest" && o.items?.some(Boolean)) return { kind: "blocked", reason: "chest" };
    return { kind: "tool", tool: "pickaxe", power: 0 };
  }
  const t = map.tile(x, y);
  if (t === T.Air) return { kind: "none" };
  // The block a tree (or cactus) stands on: the tree has to come down first, with an axe.
  if (y === map.surface(x) && (map.tree(x) || map.cactus(x))) return { kind: "tool", tool: "axe", power: 0, chopCol: x };
  return { kind: "tool", tool: "pickaxe", power: minPower(t) };
}

/** The strongest tool of a kind in the inventory that's strong enough, or null. */
export function bestTool(inv: readonly Slot[], kind: ToolKind, power = 0): ItemDef | null {
  let best: ItemDef | null = null;
  for (const s of inv) {
    const d = s ? ITEMS[s.id] : undefined;
    if (d && d.kind === kind && (d.power ?? 0) >= power && (!best || (d.power ?? 0) > (best.power ?? 0))) best = d;
  }
  return best;
}

/** How a raw material is had: chopping a kind of tree, mining a tile, defeating a creature,
 * harvesting a plant, buying it, or catching fallen stars at night. */
export type Source =
  | { from: "tree"; kinds: TreeKind[]; cost: number }
  | { from: "cactus"; cost: number }
  | { from: "mine"; tiles: number[]; cost: number }
  | { from: "kill"; npcs: NpcKind[]; cost: number }
  | { from: "harvest"; objects: { t: ObjectType; style?: number }[]; cost: number }
  | { from: "stars"; cost: number };

const tree = (kinds: TreeKind[], cost = 1): Source => ({ from: "tree", kinds, cost });
const mine = (tiles: number[], cost = 1): Source => ({ from: "mine", tiles, cost });
const kill = (npcs: NpcKind[], cost = 6): Source => ({ from: "kill", npcs, cost });
const herb = (style: number): Source => ({ from: "harvest", objects: [{ t: "herb", style }], cost: 4 });

export const SOURCES: Partial<Record<number, Source>> = {
  9: tree(["forest"]),
  2503: tree(["boreal"], 2),
  620: tree(["mahogany"], 2),
  619: tree(["ebonwood"], 3),
  2504: tree(["palm"], 2),
  276: { from: "cactus", cost: 2 },
  3: mine([T.Stone]),
  2: mine([T.Dirt, T.Grass]),
  169: mine([T.Sand], 1),
  133: mine([T.Clay], 2),
  176: mine([T.Mud, T.JungleGrass, T.MushroomGrass], 1),
  593: mine([T.Snow], 1),
  664: mine([T.Ice], 2),
  61: mine([T.Ebonstone], 2),
  172: mine([T.Ash], 3),
  173: mine([T.Obsidian], 6),
  174: mine([T.Hellstone], 8),
  751: mine([T.Cloud], 6),
  824: mine([T.Sunplate], 8),
  1124: mine([T.Hive], 4),
  12: mine([T.Copper], 4),
  11: mine([T.Iron], 6),
  14: mine([T.Silver], 7),
  13: mine([T.Gold], 8),
  56: mine([T.Demonite], 8),
  116: mine([T.Meteorite], 6),
  23: kill(["greenSlime", "blueSlime", "iceSlime", "jungleSlime", "sandSlime"], 3),
  38: kill(["demonEye"], 8),
  68: kill(["eaterOfSouls"], 8),
  69: kill(["devourerHead"], 10),
  209: kill(["hornet"], 10),
  210: kill(["manEater", "snatcher"], 10),
  331: kill(["manEater", "snatcher", "jungleSlime"], 10),
  154: kill(["skeleton", "angryBones"], 8),
  320: kill(["harpy", "vulture"], 8),
  5: { from: "harvest", objects: [{ t: "mushroom" }], cost: 3 },
  267: kill(["voodooDemon"], 30),
  183: { from: "harvest", objects: [{ t: "glowshroom" }], cost: 4 },
  313: herb(0),
  314: herb(1),
  315: herb(0),
  316: herb(3),
  317: herb(4),
  318: herb(5),
  75: { from: "stars", cost: 12 },
  29: { from: "harvest", objects: [{ t: "crystal" }], cost: 30 },
  621: tree(["pearlwood"], 2),
  911: tree(["shadewood"], 2),
  27: tree(["forest", "boreal", "mahogany", "ebonwood", "palm", "pearlwood", "shadewood"], 3),
  409: mine([T.Pearlstone], 2),
  836: mine([T.Crimstone], 2),
  880: mine([T.Crimtane], 8),
  3081: mine([T.Marble], 4),
  [BLOCK_ITEM_BASE + T.Granite]: mine([T.Granite], 4),
  [BLOCK_ITEM_BASE + T.Pearlsand]: mine([T.Pearlsand], 1),
  181: mine([T.Amethyst], 10),
  180: mine([T.Topaz], 10),
  177: mine([T.Sapphire], 12),
  179: mine([T.Emerald], 12),
  178: mine([T.Ruby], 14),
  182: mine([T.Diamond], 16),
};

/** The item for each placeable station (0: found in the world, not crafted — demon altars). */
export const STATION_ITEM: Record<Station, number> = { workbench: 36, furnace: 33, anvil: 35, sawmill: 363, loom: 332, hellforge: 221, tinkerer: 398, bottle: 31, keg: 352, cookingpot: 345, altar: 0, bookcase: 354 };

/** The next thing to do toward an item. */
export type Step =
  | { do: "craft"; id: number }
  | { do: "place"; station: Station }
  /** Go to a demon altar to craft there. */
  | { do: "altar"; id: number }
  | { do: "buy"; id: number; count: number; price: number; npc: string }
  | { do: "gather"; id: number; count: number; source: Source };

export interface PlanContext {
  inv: readonly Slot[];
  /** Stations within crafting range of home. */
  stations: ReadonlySet<Station>;
  /** Sources found not to exist nearby (e.g. no cactus in range): plan around them. */
  unavailable?: ReadonlySet<number>;
  /** Shops of the town NPCs who've moved in: price (copper) and seller, if sold. */
  shop?: (id: number) => { price: number; npc: string } | null;
  coins?: number;
}

interface Plan {
  cost: number;
  /** null: already have it. */
  step: Step | null;
}

const MAX_DEPTH = 9;

/** Plan getting `count` of an item (null = impossible). */
export function planItem(id: number, count: number, ctx: PlanContext, seeking: ReadonlySet<ToolKind> = new Set(), depth = 0): Plan | null {
  const have = countOf(ctx.inv, id);
  if (have >= count) return { cost: 0, step: null };
  if (depth > MAX_DEPTH) return null;
  const missing = count - have;
  let best: Plan | null = null;
  const consider = (p: Plan | null) => {
    if (p && (!best || p.cost < best.cost)) best = p;
  };
  // Buy it, if a town NPC sells it and the purse allows.
  const offer = ctx.shop?.(id);
  // (Pocket change for a well-off team is the easy way; a big spend only when nothing's cheaper.)
  const purse = ctx.coins ?? 0;
  if (offer && purse >= offer.price * missing) consider({ cost: offer.price * missing * 10 <= purse ? 1.5 : 1 + missing * 0.2, step: { do: "buy", id, count: missing, price: offer.price, npc: offer.npc } });
  const src = SOURCES[id];
  if (src && !ctx.unavailable?.has(id)) {
    const gather: Step = { do: "gather", id, count, source: src };
    const cost = missing * src.cost;
    const tool: ToolKind | null = src.from === "tree" || src.from === "cactus" ? "axe" : src.from === "mine" ? "pickaxe" : null;
    const power = src.from === "mine" ? Math.min(...src.tiles.map(minPower)) : 0;
    if (!tool || bestTool(ctx.inv, tool, power)) consider({ cost, step: gather });
    else if (!seeking.has(tool)) {
      // Gathering needs a tool we don't have (or one strong enough): get that first.
      const t = planTool(tool, power, ctx, seeking, depth + 1);
      if (t) consider({ cost: cost + t.cost, step: t.step ?? gather });
    }
  }
  const r = recipeFor(id);
  if (r) {
    const crafts = Math.ceil(missing / r.count);
    let cost = 0;
    let first: Step | null = null;
    let ok = true;
    for (const [ing, n] of r.ingredients) {
      const p = planItem(ing, n * crafts, ctx, seeking, depth + 1);
      if (!p) {
        ok = false;
        break;
      }
      cost += p.cost;
      first ??= p.step;
    }
    if (ok && r.station && !ctx.stations.has(r.station)) {
      if (r.station === "altar") {
        first ??= { do: "altar", id };
        cost += 20;
      } else {
        const sitem = STATION_ITEM[r.station];
        if (countOf(ctx.inv, sitem) > 0) {
          first ??= { do: "place", station: r.station };
          cost += 1;
        } else {
          const p = planItem(sitem, 1, ctx, seeking, depth + 1);
          if (!p) ok = false;
          else {
            cost += p.cost + 1;
            first ??= p.step;
          }
        }
      }
    }
    if (ok) consider({ cost: cost + crafts, step: first ?? { do: "craft", id } });
  }
  return best;
}

/** Plan getting a tool of a kind (the cheapest one that can be made), or null if none can. */
export function planTool(kind: ToolKind, power: number, ctx: PlanContext, seeking: ReadonlySet<ToolKind> = new Set(), depth = 0): (Plan & { item: number }) | null {
  const owned = bestTool(ctx.inv, kind, power);
  if (owned) return { cost: 0, step: null, item: owned.id };
  const inner = new Set(seeking).add(kind);
  let best: (Plan & { item: number }) | null = null;
  for (const d of Object.values(ITEMS)) {
    if (d.kind !== kind || (d.power ?? 0) < power) continue;
    const p = planItem(d.id, 1, ctx, inner, depth);
    if (p && (!best || p.cost < best.cost)) best = { ...p, item: d.id };
  }
  return best;
}

export const TOOL_NAME: Record<ToolKind, string> = { pickaxe: "pickaxe", axe: "axe" };

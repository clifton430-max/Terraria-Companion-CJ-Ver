// Recipes, in the spirit of Terraria's (simplified where a step needs things this game doesn't
// have, like liquids for potions). Themed furniture and walls are generated from tables so every
// biome's furniture set can be crafted from its own wood or material.

import { OBJECTS, PIECE_COST, THEME_MATERIAL, THEMES, type ObjectType, type ThemedPiece } from "./furniture";
import { BLOCK_ITEM_BASE, blockItem, furnitureItemFor, WALL_ITEM_BASE } from "./items";
import { T, W } from "../gen";

export type Station = "workbench" | "furnace" | "anvil" | "sawmill" | "loom" | "hellforge" | "tinkerer" | "bottle" | "keg" | "cookingpot" | "altar" | "bookcase";

export interface Recipe {
  result: number;
  count: number;
  ingredients: [number, number][];
  station: Station | null;
}

const R = (result: number, count: number, ingredients: [number, number][], station: Station | null = null): Recipe => ({ result, count, ingredients, station });

const BASE: Recipe[] = [
  // Basics.
  R(8, 3, [[9, 1], [23, 1]]),
  R(36, 1, [[9, 10]]),
  R(94, 2, [[9, 1]]),
  R(24, 1, [[9, 7]], "workbench"),
  R(39, 1, [[9, 10]], "workbench"),
  R(40, 25, [[9, 1], [3, 1]], "workbench"),
  R(41, 5, [[40, 5], [8, 1]], "workbench"),
  R(196, 1, [[9, 8]], "workbench"),
  R(33, 1, [[3, 20], [9, 4], [8, 3]], "workbench"),
  R(35, 1, [[22, 5]], "workbench"),
  R(48, 1, [[9, 8], [22, 2]], "workbench"),
  R(28, 2, [[23, 2], [5, 1]], "workbench"),
  R(43, 1, [[38, 6]], "workbench"),
  R(882, 1, [[276, 15]], "workbench"),
  R(560, 1, [[23, 20], [19, 2]], "workbench"),
  R(363, 1, [[9, 10], [22, 2], [85 /* chain stand-in */, 0]], "workbench"),
  R(332, 1, [[9, 12]], "sawmill"),
  R(25, 1, [[9, 6]], "workbench"),
  R(32, 1, [[9, 8]], "workbench"),
  R(34, 1, [[9, 4]], "workbench"),
  R(224, 1, [[9, 15], [225, 5]], "sawmill"),
  R(354, 1, [[9, 20], [149 /* book stand-in */, 0]], "sawmill"),
  R(333, 1, [[9, 15], [154, 4]], "sawmill"),
  R(334, 1, [[9, 16]], "sawmill"),
  R(335, 1, [[9, 8]], "workbench"),
  R(336, 1, [[22, 14]], "sawmill"),
  R(359, 1, [[9, 10], [3, 3], [170, 6], [22, 3]], "sawmill"),
  R(105, 1, [[19, 4], [8, 1]], "workbench"),
  R(106, 1, [[20, 4], [8, 4], [85, 0]], "anvil"),
  R(107, 1, [[21, 4], [8, 4]], "anvil"),
  R(108, 1, [[19, 4], [8, 4]], "anvil"),
  R(337, 1, [[225, 3]], "loom"),
  R(338, 1, [[225, 3]], "loom"),
  R(339, 1, [[225, 3]], "loom"),
  R(340, 1, [[225, 3]], "loom"),
  R(341, 1, [[22, 3], [170, 1], [8, 1]], "anvil"),
  R(344, 1, [[225, 5], [8, 1]], "loom"),
  R(345, 1, [[22, 10], [9, 4]], "workbench"),
  R(352, 1, [[9, 14], [22, 1]], "sawmill"),
  R(222, 1, [[133, 6]], "furnace"),
  R(87, 1, [[133, 8]], "workbench"),
  R(346, 1, [[22, 20]], "anvil"),
  R(225, 1, [[9, 7]], "loom"), // cobweb stand-in: silk from wood fibres
  R(31, 2, [[170, 1]], "furnace"),
  R(126, 1, [[31, 1]]),
  R(398, 1, [[9, 10], [22, 5]], "workbench"),
  // Smelting, bricks and glass.
  R(20, 1, [[12, 3]], "furnace"),
  R(22, 1, [[11, 3]], "furnace"),
  R(21, 1, [[14, 4]], "furnace"),
  R(19, 1, [[13, 4]], "furnace"),
  R(57, 1, [[56, 3]], "furnace"),
  R(117, 1, [[116, 3]], "furnace"),
  R(175, 1, [[174, 3], [173, 1]], "hellforge"),
  R(221, 1, [[3, 20], [22, 10], [8, 5], [174, 10]], "workbench"),
  R(170, 1, [[169, 2]], "furnace"),
  R(129, 1, [[3, 2]], "furnace"),
  R(131, 1, [[133, 2]], "furnace"),
  R(141, 1, [[13, 1], [3, 1]], "furnace"),
  R(143, 1, [[14, 1], [3, 1]], "furnace"),
  R(145, 1, [[12, 1], [3, 1]], "furnace"),
  R(192, 1, [[173, 2]], "furnace"),
  R(214, 1, [[174, 1], [3, 1]], "furnace"),
  R(594, 1, [[593, 2]], "furnace"),
  R(607, 1, [[169, 2]], "furnace"),
  R(609, 1, [[61, 1], [3, 1]], "furnace"),
  R(blockItem(T.IceBrick), 1, [[664, 2]], "furnace"),
  R(blockItem(T.MudstoneBrick), 1, [[176, 1], [3, 1]], "furnace"),
  R(blockItem(T.GlowMushroomBlock), 1, [[183, 1]], "workbench"),
  R(blockItem(T.LivingWood), 1, [[9, 1]], "sawmill"),
  R(blockItem(T.Leaf), 1, [[9, 1]], "sawmill"),
  R(blockItem(T.BoneBlock), 1, [[154, 1]], "workbench"),
  // Estate materials (each made from things found near home or in its own biome).
  R(blockItem(T.PearlstoneBrick), 1, [[409, 1], [3, 1]], "furnace"),
  R(blockItem(T.StoneSlab), 1, [[3, 2]], "furnace"),
  R(blockItem(T.SandstoneSlab), 1, [[169, 2]], "furnace"),
  R(3066, 1, [[3081, 1]], "workbench"),
  R(blockItem(T.GraniteBlock), 1, [[blockItem(T.Granite), 1]], "workbench"),
  R(blockItem(T.CrystalBlock), 1, [[170, 1], [409, 1]], "furnace"),
  R(blockItem(T.DynastyWood), 1, [[9, 2]], "sawmill"),
  R(blockItem(T.RedShingles), 1, [[blockItem(T.DynastyWood), 1], [133, 1]], "sawmill"),
  R(blockItem(T.BlueShingles), 1, [[blockItem(T.DynastyWood), 1], [3, 1]], "sawmill"),
  R(blockItem(T.Coralstone), 1, [[169, 1], [3, 1]], "furnace"),
  // (Clay worked from dirt, when no clay pocket can be found: mined clay is cheaper when there is.)
  R(133, 1, [[2, 3]], "workbench"),
  // (Palm wood weathered from ordinary wood, when the beach's palms are all cut: dearer than a palm.)
  R(2504, 1, [[9, 2], [169, 1]], "sawmill"),
  R(blockItem(T.LivingMahogany), 1, [[620, 1]], "sawmill"),
  R(blockItem(T.MahoganyLeaves), 1, [[620, 1]], "sawmill"),
  R(blockItem(T.WoodBeam), 1, [[9, 1]], "sawmill"),
  R(blockItem(T.Hay), 2, [[9, 1]], "workbench"),
  R(blockItem(T.CopperPlating), 4, [[20, 1]], "anvil"),
  R(1257, 1, [[880, 3]], "furnace"),
  // Tools and weapons by metal.
  ...metalSet(20, [3509, 3506, 3505, 3508, 3507, 3504], [12, 9, 10, 8, 7, 7]),
  ...metalSet(22, [1, 10, 7, 4, 6, 99], [12, 9, 10, 8, 7, 7]),
  ...metalSet(21, [3485, 3482, 3481, 3484, 3483, 3480], [12, 9, 10, 8, 7, 7]),
  ...metalSet(19, [3521, 3518, 3517, 3520, 3519, 3516], [12, 9, 10, 8, 7, 7]),
  R(89, 1, [[20, 12]], "anvil"),
  R(80, 1, [[20, 20]], "anvil"),
  R(76, 1, [[20, 16]], "anvil"),
  R(90, 1, [[22, 15]], "anvil"),
  R(81, 1, [[22, 25]], "anvil"),
  R(77, 1, [[22, 20]], "anvil"),
  R(91, 1, [[21, 15]], "anvil"),
  R(82, 1, [[21, 25]], "anvil"),
  R(78, 1, [[21, 20]], "anvil"),
  R(92, 1, [[19, 15]], "anvil"),
  R(83, 1, [[19, 25]], "anvil"),
  R(79, 1, [[19, 20]], "anvil"),
  // Demonite (after the Eye / the Eater).
  R(103, 1, [[57, 12], [86, 6]], "anvil"),
  R(45, 1, [[57, 10], [86, 5]], "anvil"),
  R(46, 1, [[57, 10], [86, 5]], "anvil"),
  R(44, 1, [[57, 8]], "anvil"),
  R(104, 1, [[57, 10], [86, 5]], "anvil"),
  R(102, 1, [[57, 15], [86, 10]], "anvil"),
  R(101, 1, [[57, 20], [86, 15]], "anvil"),
  R(100, 1, [[57, 15], [86, 10]], "anvil"),
  R(67, 5, [[60, 1]], "bottle"),
  R(70, 1, [[67, 30], [68, 15]], "altar"),
  R(47, 5, [[40, 5], [69, 1]], "workbench"),
  // Jungle, bees, meteorite, hellstone.
  R(228, 1, [[331, 15], [209, 2], [210, 2]], "anvil"),
  R(229, 1, [[331, 20], [209, 3], [210, 3]], "anvil"),
  R(230, 1, [[331, 15], [209, 2], [210, 2]], "anvil"),
  R(190, 1, [[331, 12], [209, 12]], "anvil"),
  R(1133, 1, [[1124, 5], [209, 1]], "altar"),
  R(123, 1, [[117, 20]], "anvil"),
  R(124, 1, [[117, 25]], "anvil"),
  R(125, 1, [[117, 20]], "anvil"),
  R(127, 1, [[117, 20]], "anvil"),
  R(234, 50, [[97, 50], [117, 1]], "anvil"),
  R(151, 1, [[154, 40], [225, 15]], "loom"),
  R(152, 1, [[154, 60], [225, 25]], "loom"),
  R(153, 1, [[154, 50], [225, 20]], "loom"),
  R(122, 1, [[175, 20]], "hellforge"),
  R(217, 1, [[175, 15]], "hellforge"),
  R(121, 1, [[175, 20]], "hellforge"),
  R(120, 1, [[175, 15]], "hellforge"),
  R(119, 1, [[55, 1], [175, 10]], "hellforge"),
  R(231, 1, [[175, 10]], "hellforge"),
  R(232, 1, [[175, 20]], "hellforge"),
  R(233, 1, [[175, 15]], "hellforge"),
  R(273, 1, [[46, 1], [155, 1], [190, 1], [121, 1]], "altar"),
  // Potions (a placed bottle is the alchemy station).
  R(188, 2, [[28, 2], [183, 1]], "bottle"),
  R(292, 1, [[126, 1], [313, 1], [11, 1]], "bottle"),
  R(289, 1, [[126, 1], [313, 1], [5, 1]], "bottle"),
  R(290, 1, [[126, 1], [315, 1], [276, 1]], "bottle"),
  R(288, 1, [[126, 1], [318, 1], [317, 1], [173, 1]], "bottle"),
  R(2322, 1, [[126, 1], [315, 1], [12, 1]], "bottle"),
  R(296, 1, [[126, 1], [315, 1], [314, 1], [13, 1]], "bottle"),
  R(2325, 1, [[126, 1], [315, 1], [313, 1], [314, 1]], "bottle"),
  R(298, 1, [[126, 1], [317, 1], [183, 1]], "bottle"),
  R(295, 1, [[126, 1], [313, 1], [320, 1]], "bottle"),
  // Walls (four per block, at a work bench).
  ...walls([
    [93, 9],
    [26, 3],
    [130, 129],
    [132, 131],
    [142, 141],
    [144, 143],
    [146, 145],
    [330, 192],
    [WALL_ITEM_BASE + W.Glass, 170],
    [WALL_ITEM_BASE + W.Planked, 9],
    [WALL_ITEM_BASE + W.SnowBrick, 594],
    [WALL_ITEM_BASE + W.SandstoneBrick, 607],
    [WALL_ITEM_BASE + W.EbonstoneBrick, 609],
    [WALL_ITEM_BASE + W.Ebonwood, 619],
    [WALL_ITEM_BASE + W.RichMahogany, 620],
    [WALL_ITEM_BASE + W.Boreal, 2503],
    [WALL_ITEM_BASE + W.Palm, 2504],
    [WALL_ITEM_BASE + W.Leaf, BLOCK_ITEM_BASE + T.Leaf],
    [WALL_ITEM_BASE + W.Cloud, 751],
    [WALL_ITEM_BASE + W.Disc, 824],
    [WALL_ITEM_BASE + W.Mushroom, BLOCK_ITEM_BASE + T.GlowMushroomBlock],
    [WALL_ITEM_BASE + W.HellstoneBrick, 214],
    [WALL_ITEM_BASE + W.Hive, 1124],
    [WALL_ITEM_BASE + W.Mud, 176],
    [WALL_ITEM_BASE + W.PearlstoneBrick, blockItem(T.PearlstoneBrick)],
    [WALL_ITEM_BASE + W.Pearlwood, 621],
    [WALL_ITEM_BASE + W.Shadewood, 911],
    [WALL_ITEM_BASE + W.RedStucco, 133],
    [WALL_ITEM_BASE + W.YellowStucco, 169],
    [WALL_ITEM_BASE + W.GreenStucco, 176],
    [WALL_ITEM_BASE + W.GrayStucco, 3],
    [WALL_ITEM_BASE + W.Plaster, 593],
    [WALL_ITEM_BASE + W.Sandstone, blockItem(T.SandstoneSlab)],
    [WALL_ITEM_BASE + W.LivingWood, blockItem(T.LivingWood)],
    [WALL_ITEM_BASE + W.WoodFence, 9],
    [WALL_ITEM_BASE + W.MetalFence, 22],
    [WALL_ITEM_BASE + W.CopperPlating, blockItem(T.CopperPlating)],
    [WALL_ITEM_BASE + W.Lattice, blockItem(T.DynastyWood)],
    [WALL_ITEM_BASE + W.Marble, 3066],
    [WALL_ITEM_BASE + W.Granite, blockItem(T.GraniteBlock)],
    [WALL_ITEM_BASE + W.Crystal, blockItem(T.CrystalBlock)],
  ]),
  // Stained glass: glass with a tint, at the furnace.
  ...[W.PurpleGlass, W.YellowGlass, W.BlueGlass, W.GreenGlass, W.RedGlass, W.RainbowGlass].map((w) => R(WALL_ITEM_BASE + w, 4, [[170, 1]], "furnace")),
];

function metalSet(bar: number, ids: number[], counts: number[]): Recipe[] {
  // pickaxe, axe, hammer, broadsword, shortsword, bow (wood for handles)
  return ids.map((id, i) => R(id, 1, i === 3 || i === 4 ? [[bar, counts[i]]] : [[bar, counts[i]], [9, 3]], "anvil"));
}

function walls(pairs: [number, number][]): Recipe[] {
  return pairs.map(([wall, block]) => R(wall, 4, [[block, 1]], "workbench"));
}

/** Every theme's furniture, crafted from the theme's material. */
function themed(): Recipe[] {
  const out: Recipe[] = [];
  const seen = new Set<number>();
  for (const [id, th] of Object.entries(THEMES)) {
    const mat = THEME_MATERIAL[id as keyof typeof THEMES];
    for (const [p, style] of Object.entries(th.styles) as [ThemedPiece, number][]) {
      const item = furnitureItemFor(p, style);
      // (Pieces that are a real Terraria item have that item's own recipe; the rest, including a
      // base-style piece with no plain item like the sink, are crafted from the theme's material.)
      if (!item || item < BLOCK_ITEM_BASE || seen.has(item)) continue;
      seen.add(item);
      const station = p === "bed" || p === "bookcase" || p === "piano" ? "sawmill" : "workbench";
      const extra: [number, number][] = p === "lamp" || p === "chandelier" ? [[8, 1]] : p === "bed" ? [[225, 5]] : [];
      out.push(R(item, 1, [[mat, PIECE_COST[p]], ...extra], station));
    }
  }
  // Estate pieces, every style.
  for (const [p, styles, ingredients, station] of ESTATE_PIECES)
    for (const style of styles) {
      const item = furnitureItemFor(p, style);
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(R(item, 1, ingredients(style), station));
    }
  // Plain pieces with no Terraria item of their own (a plain sink, say), from wood at a work bench.
  for (const p of Object.keys(OBJECTS) as (keyof typeof OBJECTS)[]) {
    const id = OBJECTS[p].drop(0);
    if (id === null || id < BLOCK_ITEM_BASE || seen.has(id) || p === "painting" || p === "statue" || ESTATE_PIECES.some(([q]) => q === p)) continue;
    const item = furnitureItemFor(p, 0);
    if (!item) continue;
    seen.add(item);
    out.push(R(item, 1, [[9, PIECE_COST[p as ThemedPiece] ?? 4]], "workbench"));
  }
  // Paintings (Painter's wares are bought; these are the craftable "framed" ones) and statues.
  for (let s = 0; s < 12; s++) out.push(R(OBJECTS.painting.drop(s)!, 1, [[9, 4], [225, 1]], "loom"));
  for (let s = 0; s < 6; s++) out.push(R(OBJECTS.statue.drop(s)!, 1, [[3, 50]], "workbench"));
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** How the estates' pieces are made: [piece, styles, ingredients by style, station]. */
const ESTATE_PIECES: [ObjectType, number[], (style: number) => [number, number][], Station | null][] = [
  // Fountains: stone and a little glass (the hallowed one wants pearlstone, the desert's sand…).
  ["fountain", range(11), (s) => [[s === 6 ? 409 : s === 5 ? 836 : s === 1 || s === 9 ? 169 : 3, 20], [170, 2]], "workbench"],
  ["fireplace", [0], () => [[3, 20], [9, 4], [8, 3]], "furnace"],
  ["chimney", [0], () => [[3, 15]], "furnace"],
  ["lamppost", [0], () => [[22, 3], [170, 2], [8, 1]], "anvil"],
  ["candelabra", range(32), () => [[22, 3], [8, 3]], "anvil"],
  ["paperlantern", [0], () => [[225, 2], [8, 1]], "loom"],
  ["campfire", range(16), () => [[9, 10], [8, 5]], null],
  ["planter", range(32), () => [[133, 2], [2, 1]], "workbench"],
  ["sunflower", range(3), () => [[2, 2], [27, 1]], null],
  ["throne", [0], () => [[9, 20], [225, 5], [19, 2]], "sawmill"],
  ["weaponrack", range(2), () => [[9, 8]], "workbench"],
  ["crystalball", [0], () => [[170, 10], [22, 2]], "anvil"],
  ["sundial", [0], () => [[3, 20], [22, 4]], "anvil"],
  ["gardentree", range(11), () => [[27, 1], [2, 4]], null],
  ["vineflowers", range(13), () => [[blockItem(T.Leaf), 2]], "workbench"],
  ["coral", range(6), () => [[169, 3]], "workbench"],
];

/** The whole recipe book (ingredients with a count of 0 are decorative stand-ins and dropped). */
export const RECIPES: Recipe[] = [...BASE, ...themed()].map((r) => ({ ...r, ingredients: r.ingredients.filter(([, n]) => n > 0) }));

const BY_RESULT = new Map<number, Recipe>();
for (const r of RECIPES) if (!BY_RESULT.has(r.result)) BY_RESULT.set(r.result, r);
/** The recipe that makes an item (the first one, if several). */
export const recipeFor = (id: number): Recipe | undefined => BY_RESULT.get(id);

// Items for the background-world game. Sprites are real item textures from the local Terraria
// install (`Images/Item_<id>`); the ids are Terraria's item ids (each checked against the install's
// art), so the art matches. Blocks, walls and themed furniture without a checked item id get a
// synthetic id and use their own tile / wall / furniture sprite as the icon. Stats are written
// for this game in the spirit of Terraria's early game (not copied from the game's code).

import { T, W, WALL_SHEET } from "../gen";
import { FURNITURE_TYPES, furnitureFromItem, furnitureName, OBJECTS, THEMES, type ObjectType, type ThemedPiece } from "./furniture";

export type ItemKind =
  | "block"
  | "wall"
  | "material"
  | "pickaxe"
  | "axe"
  | "hammer"
  | "sword"
  | "shortsword"
  | "spear"
  | "bow"
  | "gun"
  | "magic"
  | "boomerang"
  | "ammo"
  | "armor"
  | "accessory"
  | "potion"
  | "buff"
  | "furniture"
  | "summon"
  | "upgrade"
  | "tool"
  | "explosive"
  | "coin";

export interface ItemDef {
  id: number;
  name: string;
  kind: ItemKind;
  stack: number;
  /** Seconds per use (swing, shot, dig). */
  useTime?: number;
  damage?: number;
  knockback?: number;
  /** Pickaxe / axe / hammer power. */
  power?: number;
  /** Tile placed by a block item. */
  tile?: number;
  /** Wall placed by a wall item. */
  wall?: number;
  /** Furniture placed by a furniture item (see furniture.ts), and its style. */
  object?: ObjectType;
  style?: number;
  /** Armour: slot, defence and the player sheet id (1 copper, 2 iron, 3 silver, 4 gold). */
  slot?: "head" | "body" | "legs";
  defense?: number;
  sheet?: number;
  /** Armour set this piece belongs to (full set bonus). */
  set?: string;
  /** Potions: life restored. */
  heal?: number;
  /** Buff potions. */
  buff?: { id: BuffId; seconds: number };
  /** Accessories. */
  acc?: Accessory;
  /** Ranged / magic projectile. */
  proj?: { speed: number; gravity?: number; pierce?: number; returns?: boolean; tex?: number; ammo?: "arrow" | "bullet" };
  /** Ammo type (arrows, bullets). */
  ammo?: "arrow" | "bullet";
  /** Swing length in px (art size) for melee hit boxes. */
  reach?: number;
  /** Shop price (copper coins). */
  value?: number;
  /** Icon from a tile / wall / furniture sheet instead of an item texture. */
  icon?: { tex: string; sx: number; sy: number; sw: number; sh: number };
  tooltip?: string;
}

export type BuffId = "ironskin" | "regeneration" | "swiftness" | "obsidianskin" | "mining" | "spelunker" | "builder" | "shine" | "nightowl" | "featherfall";

export interface Accessory {
  speed?: number;
  jump?: number;
  regen?: number;
  defense?: number;
  noFall?: boolean;
  lavaResist?: number;
  doubleJump?: boolean;
  knockbackImmune?: boolean;
  meleeSpeed?: number;
}

const D = (d: ItemDef) => d;
const C = 1;
const S = 100;
const G = 10_000;

// Synthetic ids: blocks 110000 + tile, walls 120000 + wall, themed furniture 130000+ (furniture.ts).
export const BLOCK_ITEM_BASE = 110000;
export const WALL_ITEM_BASE = 120000;

const TILE_SHEET_FOR_ICON: Partial<Record<number, number>> = {
  [T.LivingWood]: 191,
  [T.Leaf]: 192,
  [T.IceBrick]: 206,
  [T.MudstoneBrick]: 120,
  [T.GlowMushroomBlock]: 190,
  [T.BoneBlock]: 194,
  [T.Sandstone]: 396,
  [T.HardenedSand]: 397,
  [T.Hive]: 225,
  [T.MushroomGrass]: 70,
  [T.Pearlsand]: 116,
  [T.PearlstoneBrick]: 118,
  [T.Granite]: 368,
  [T.GraniteBlock]: 369,
  [T.StoneSlab]: 273,
  [T.SandstoneSlab]: 274,
  [T.CrystalBlock]: 385,
  [T.DynastyWood]: 311,
  [T.RedShingles]: 312,
  [T.BlueShingles]: 313,
  [T.Coralstone]: 315,
  [T.LivingMahogany]: 383,
  [T.MahoganyLeaves]: 384,
  [T.WoodBeam]: 124,
  [T.Hay]: 252,
  [T.CopperPlating]: 284,
};

const blockIcon = (sheet: number) => ({ tex: `Images/Tiles_${sheet}`, sx: 18, sy: 18, sw: 16, sh: 16 });

const ARMOR_PIECES: Record<string, [string, string, string]> = {
  Jungle: ["Hat", "Shirt", "Pants"],
  Ninja: ["Hood", "Shirt", "Pants"],
  Meteor: ["Helmet", "Suit", "Leggings"],
  Shadow: ["Helmet", "Scalemail", "Greaves"],
  Necro: ["Helmet", "Breastplate", "Greaves"],
  Molten: ["Helmet", "Breastplate", "Greaves"],
};

const BASE: ItemDef[] = [
  // ── Blocks and materials ─────────────────────────────────────────────────────────────
  D({ id: 2, name: "Dirt Block", kind: "block", stack: 999, tile: T.Dirt }),
  D({ id: 3, name: "Stone Block", kind: "block", stack: 999, tile: T.Stone }),
  D({ id: 9, name: "Wood", kind: "block", stack: 999, tile: T.Wood }),
  D({ id: 2503, name: "Boreal Wood", kind: "block", stack: 999, tile: T.BorealWood }),
  D({ id: 2504, name: "Palm Wood", kind: "block", stack: 999, tile: T.PalmWood }),
  D({ id: 620, name: "Rich Mahogany", kind: "block", stack: 999, tile: T.RichMahogany }),
  D({ id: 619, name: "Ebonwood", kind: "block", stack: 999, tile: T.Ebonwood }),
  D({ id: 621, name: "Pearlwood", kind: "block", stack: 999, tile: T.Pearlwood }),
  D({ id: 911, name: "Shadewood", kind: "block", stack: 999, tile: T.Shadewood }),
  D({ id: 409, name: "Pearlstone Block", kind: "block", stack: 999, tile: T.Pearlstone }),
  D({ id: 836, name: "Crimstone Block", kind: "block", stack: 999, tile: T.Crimstone }),
  D({ id: 880, name: "Crimtane Ore", kind: "block", stack: 999, tile: T.Crimtane, value: 13 * S }),
  D({ id: 1257, name: "Crimtane Bar", kind: "material", stack: 99, value: 52 * S }),
  D({ id: 3081, name: "Marble Block", kind: "block", stack: 999, tile: T.Marble }),
  D({ id: 3066, name: "Smooth Marble Block", kind: "block", stack: 999, tile: T.MarbleBlock }),
  D({ id: 177, name: "Sapphire", kind: "material", stack: 999, value: 15 * S }),
  D({ id: 178, name: "Ruby", kind: "material", stack: 999, value: 22 * S }),
  D({ id: 179, name: "Emerald", kind: "material", stack: 999, value: 18 * S }),
  D({ id: 180, name: "Topaz", kind: "material", stack: 999, value: 11 * S }),
  D({ id: 181, name: "Amethyst", kind: "material", stack: 999, value: 7 * S }),
  D({ id: 182, name: "Diamond", kind: "material", stack: 999, value: 30 * S }),
  D({ id: 27, name: "Acorn", kind: "material", stack: 999, tooltip: "Plant it in a garden" }),
  D({ id: 169, name: "Sand Block", kind: "block", stack: 999, tile: T.Sand }),
  D({ id: 133, name: "Clay Block", kind: "block", stack: 999, tile: T.Clay }),
  D({ id: 176, name: "Mud Block", kind: "block", stack: 999, tile: T.Mud }),
  D({ id: 593, name: "Snow Block", kind: "block", stack: 999, tile: T.Snow }),
  D({ id: 664, name: "Ice Block", kind: "block", stack: 999, tile: T.Ice }),
  D({ id: 61, name: "Ebonstone Block", kind: "block", stack: 999, tile: T.Ebonstone }),
  D({ id: 172, name: "Ash Block", kind: "block", stack: 999, tile: T.Ash }),
  D({ id: 173, name: "Obsidian", kind: "block", stack: 999, tile: T.Obsidian }),
  D({ id: 751, name: "Cloud", kind: "block", stack: 999, tile: T.Cloud }),
  D({ id: 824, name: "Sunplate Block", kind: "block", stack: 999, tile: T.Sunplate }),
  D({ id: 94, name: "Wood Platform", kind: "block", stack: 999, tile: T.Platform }),
  D({ id: 129, name: "Gray Brick", kind: "block", stack: 999, tile: T.GrayBrick }),
  D({ id: 131, name: "Red Brick", kind: "block", stack: 999, tile: T.RedBrick }),
  D({ id: 134, name: "Blue Brick", kind: "block", stack: 999, tile: T.BlueBrick }),
  D({ id: 137, name: "Green Brick", kind: "block", stack: 999, tile: T.GreenBrick }),
  D({ id: 139, name: "Pink Brick", kind: "block", stack: 999, tile: T.PinkBrick }),
  D({ id: 141, name: "Gold Brick", kind: "block", stack: 999, tile: T.GoldBrick }),
  D({ id: 143, name: "Silver Brick", kind: "block", stack: 999, tile: T.SilverBrick }),
  D({ id: 145, name: "Copper Brick", kind: "block", stack: 999, tile: T.CopperBrick }),
  D({ id: 170, name: "Glass", kind: "block", stack: 999, tile: T.Glass }),
  D({ id: 192, name: "Obsidian Brick", kind: "block", stack: 999, tile: T.ObsidianBrick }),
  D({ id: 214, name: "Hellstone Brick", kind: "block", stack: 999, tile: T.HellstoneBrick }),
  D({ id: 594, name: "Snow Brick", kind: "block", stack: 999, tile: T.SnowBrick }),
  D({ id: 607, name: "Sandstone Brick", kind: "block", stack: 999, tile: T.SandstoneBrick }),
  D({ id: 609, name: "Ebonstone Brick", kind: "block", stack: 999, tile: T.EbonstoneBrick }),
  D({ id: 1124, name: "Hive", kind: "block", stack: 999, tile: T.Hive }),
  D({ id: 12, name: "Copper Ore", kind: "block", stack: 999, tile: T.Copper, value: 50 }),
  D({ id: 11, name: "Iron Ore", kind: "block", stack: 999, tile: T.Iron, value: 100 }),
  D({ id: 14, name: "Silver Ore", kind: "block", stack: 999, tile: T.Silver, value: 150 }),
  D({ id: 13, name: "Gold Ore", kind: "block", stack: 999, tile: T.Gold, value: 200 }),
  D({ id: 56, name: "Demonite Ore", kind: "block", stack: 999, tile: T.Demonite, value: 400 }),
  D({ id: 116, name: "Meteorite", kind: "block", stack: 999, tile: T.Meteorite, value: 200 }),
  D({ id: 174, name: "Hellstone", kind: "block", stack: 999, tile: T.Hellstone, value: 400 }),
  D({ id: 20, name: "Copper Bar", kind: "material", stack: 999, value: 150 }),
  D({ id: 22, name: "Iron Bar", kind: "material", stack: 999, value: 300 }),
  D({ id: 21, name: "Silver Bar", kind: "material", stack: 999, value: 450 }),
  D({ id: 19, name: "Gold Bar", kind: "material", stack: 999, value: 600 }),
  D({ id: 57, name: "Demonite Bar", kind: "material", stack: 999, value: 1600 }),
  D({ id: 117, name: "Meteorite Bar", kind: "material", stack: 999, value: 700 }),
  D({ id: 175, name: "Hellstone Bar", kind: "material", stack: 999, value: 2000 }),
  D({ id: 23, name: "Gel", kind: "material", stack: 999, value: 1 }),
  D({ id: 38, name: "Lens", kind: "material", stack: 999, value: 100 }),
  D({ id: 276, name: "Cactus", kind: "material", stack: 999 }),
  D({ id: 154, name: "Bone", kind: "material", stack: 999, value: 50 }),
  D({ id: 68, name: "Rotten Chunk", kind: "material", stack: 999, value: 10 }),
  D({ id: 69, name: "Worm Tooth", kind: "material", stack: 999, value: 10 }),
  D({ id: 86, name: "Shadow Scale", kind: "material", stack: 999, value: 100 }),
  D({ id: 209, name: "Stinger", kind: "material", stack: 999, value: 200 }),
  D({ id: 210, name: "Vine", kind: "material", stack: 999, value: 200 }),
  D({ id: 331, name: "Jungle Spores", kind: "material", stack: 999, value: 300 }),
  D({ id: 2431, name: "Bee Wax", kind: "material", stack: 999, value: 300 }),
  D({ id: 183, name: "Glowing Mushroom", kind: "material", stack: 999, value: 5 }),
  D({ id: 60, name: "Vile Mushroom", kind: "material", stack: 99, value: 50 }),
  D({ id: 75, name: "Fallen Star", kind: "material", stack: 100, value: 500 }),
  D({ id: 225, name: "Silk", kind: "material", stack: 999, value: 100 }),
  D({ id: 320, name: "Feather", kind: "material", stack: 999, value: 100 }),
  D({ id: 31, name: "Bottle", kind: "furniture", stack: 999, object: "bottle", value: 20 }),
  D({ id: 126, name: "Bottled Water", kind: "material", stack: 999, value: 20 }),
  D({ id: 177, name: "Sapphire", kind: "material", stack: 999, value: 1500 }),
  D({ id: 178, name: "Ruby", kind: "material", stack: 999, value: 2250 }),
  D({ id: 179, name: "Emerald", kind: "material", stack: 999, value: 1875 }),
  D({ id: 180, name: "Topaz", kind: "material", stack: 999, value: 1125 }),
  D({ id: 181, name: "Amethyst", kind: "material", stack: 999, value: 750 }),
  D({ id: 182, name: "Diamond", kind: "material", stack: 999, value: 3000 }),
  D({ id: 313, name: "Daybloom", kind: "material", stack: 99, value: 20 }),
  D({ id: 314, name: "Moonglow", kind: "material", stack: 99, value: 20 }),
  D({ id: 315, name: "Blinkroot", kind: "material", stack: 99, value: 20 }),
  D({ id: 316, name: "Deathweed", kind: "material", stack: 99, value: 20 }),
  D({ id: 317, name: "Waterleaf", kind: "material", stack: 99, value: 20 }),
  D({ id: 318, name: "Fireblossom", kind: "material", stack: 99, value: 20 }),
  // Coins (picked up straight into the purse).
  D({ id: 71, name: "Copper Coin", kind: "coin", stack: 100, value: C }),
  D({ id: 72, name: "Silver Coin", kind: "coin", stack: 100, value: S }),
  D({ id: 73, name: "Gold Coin", kind: "coin", stack: 100, value: G }),
  D({ id: 74, name: "Platinum Coin", kind: "coin", stack: 999, value: 100 * G }),

  // ── Walls with real items ────────────────────────────────────────────────────────────
  D({ id: 93, name: "Wood Wall", kind: "wall", stack: 999, wall: W.Wood }),
  D({ id: 26, name: "Stone Wall", kind: "wall", stack: 999, wall: W.Stone }),
  D({ id: 130, name: "Gray Brick Wall", kind: "wall", stack: 999, wall: W.GrayBrick }),
  D({ id: 132, name: "Red Brick Wall", kind: "wall", stack: 999, wall: W.RedBrick }),
  D({ id: 135, name: "Blue Brick Wall", kind: "wall", stack: 999, wall: W.BlueBrick }),
  D({ id: 142, name: "Gold Brick Wall", kind: "wall", stack: 999, wall: W.GoldBrick }),
  D({ id: 144, name: "Silver Brick Wall", kind: "wall", stack: 999, wall: W.SilverBrick }),
  D({ id: 146, name: "Copper Brick Wall", kind: "wall", stack: 999, wall: W.CopperBrick }),
  D({ id: 330, name: "Obsidian Brick Wall", kind: "wall", stack: 999, wall: W.ObsidianBrick }),

  // ── Furniture and stations (real items) ──────────────────────────────────────────────
  D({ id: 8, name: "Torch", kind: "furniture", stack: 999, object: "torch", value: 50, tooltip: "Provides light" }),
  D({ id: 36, name: "Work Bench", kind: "furniture", stack: 99, object: "workbench", tooltip: "Used for basic crafting" }),
  D({ id: 33, name: "Furnace", kind: "furniture", stack: 99, object: "furnace", tooltip: "Used for smelting ore" }),
  D({ id: 35, name: "Iron Anvil", kind: "furniture", stack: 99, object: "anvil", value: 5 * G, tooltip: "Used to craft items from metal bars" }),
  D({ id: 48, name: "Wooden Chest", kind: "furniture", stack: 99, object: "chest", tooltip: "Stores items" }),
  D({ id: 306, name: "Gold Chest", kind: "furniture", stack: 99, object: "chest", style: 1 }),
  D({ id: 328, name: "Shadow Chest", kind: "furniture", stack: 99, object: "chest", style: 3 }),
  D({ id: 25, name: "Wooden Door", kind: "furniture", stack: 99, object: "door" }),
  D({ id: 32, name: "Wooden Table", kind: "furniture", stack: 99, object: "table" }),
  D({ id: 34, name: "Wooden Chair", kind: "furniture", stack: 99, object: "chair" }),
  D({ id: 224, name: "Bed", kind: "furniture", stack: 99, object: "bed" }),
  D({ id: 354, name: "Bookcase", kind: "furniture", stack: 99, object: "bookcase" }),
  D({ id: 333, name: "Piano", kind: "furniture", stack: 99, object: "piano" }),
  D({ id: 334, name: "Dresser", kind: "furniture", stack: 99, object: "dresser" }),
  D({ id: 335, name: "Wooden Sofa", kind: "furniture", stack: 99, object: "sofa" }),
  D({ id: 336, name: "Bathtub", kind: "furniture", stack: 99, object: "bathtub" }),
  D({ id: 359, name: "Grandfather Clock", kind: "furniture", stack: 99, object: "clock" }),
  D({ id: 105, name: "Candle", kind: "furniture", stack: 99, object: "candle" }),
  D({ id: 106, name: "Copper Chandelier", kind: "furniture", stack: 99, object: "chandelier", style: 0 }),
  D({ id: 107, name: "Silver Chandelier", kind: "furniture", stack: 99, object: "chandelier", style: 1 }),
  D({ id: 108, name: "Gold Chandelier", kind: "furniture", stack: 99, object: "chandelier", style: 2 }),
  D({ id: 337, name: "Red Banner", kind: "furniture", stack: 99, object: "banner", style: 0 }),
  D({ id: 338, name: "Green Banner", kind: "furniture", stack: 99, object: "banner", style: 1 }),
  D({ id: 339, name: "Blue Banner", kind: "furniture", stack: 99, object: "banner", style: 2 }),
  D({ id: 340, name: "Yellow Banner", kind: "furniture", stack: 99, object: "banner", style: 3 }),
  D({ id: 341, name: "Lamp Post", kind: "furniture", stack: 99, object: "lamp" }),
  D({ id: 344, name: "Chinese Lantern", kind: "furniture", stack: 99, object: "lantern" }),
  D({ id: 345, name: "Cooking Pot", kind: "furniture", stack: 99, object: "cookingpot", value: 2 * G }),
  D({ id: 346, name: "Safe", kind: "furniture", stack: 99, object: "safe", value: 20 * G }),
  D({ id: 352, name: "Keg", kind: "furniture", stack: 99, object: "keg" }),
  D({ id: 363, name: "Sawmill", kind: "furniture", stack: 99, object: "sawmill" }),
  D({ id: 332, name: "Loom", kind: "furniture", stack: 99, object: "loom" }),
  D({ id: 221, name: "Hellforge", kind: "furniture", stack: 99, object: "hellforge" }),
  D({ id: 398, name: "Tinkerer's Workshop", kind: "furniture", stack: 99, object: "tinkerer", value: 10 * G }),
  D({ id: 87, name: "Piggy Bank", kind: "furniture", stack: 99, object: "piggybank", value: G }),
  D({ id: 222, name: "Clay Pot", kind: "furniture", stack: 99, object: "plant" }),

  // ── Tools ────────────────────────────────────────────────────────────────────────────
  D({ id: 3509, name: "Copper Pickaxe", kind: "pickaxe", stack: 1, power: 35, useTime: 0.38, damage: 4, knockback: 2, reach: 30, value: 2 * S }),
  D({ id: 882, name: "Cactus Pickaxe", kind: "pickaxe", stack: 1, power: 35, useTime: 0.38, damage: 4, knockback: 2, reach: 30, tooltip: "No metal needed" }),
  D({ id: 1, name: "Iron Pickaxe", kind: "pickaxe", stack: 1, power: 40, useTime: 0.33, damage: 5, knockback: 2, reach: 32 }),
  D({ id: 3485, name: "Silver Pickaxe", kind: "pickaxe", stack: 1, power: 45, useTime: 0.3, damage: 6, knockback: 2, reach: 32 }),
  D({ id: 3521, name: "Gold Pickaxe", kind: "pickaxe", stack: 1, power: 55, useTime: 0.3, damage: 6, knockback: 2, reach: 34 }),
  D({ id: 103, name: "Nightmare Pickaxe", kind: "pickaxe", stack: 1, power: 65, useTime: 0.25, damage: 9, knockback: 3, reach: 36, tooltip: "Able to mine Hellstone" }),
  D({ id: 122, name: "Molten Pickaxe", kind: "pickaxe", stack: 1, power: 100, useTime: 0.25, damage: 12, knockback: 2, reach: 36 }),
  D({ id: 3506, name: "Copper Axe", kind: "axe", stack: 1, power: 35, useTime: 0.42, damage: 3, knockback: 4.5, reach: 30, value: S }),
  D({ id: 10, name: "Iron Axe", kind: "axe", stack: 1, power: 45, useTime: 0.36, damage: 5, knockback: 4.5, reach: 32 }),
  D({ id: 3482, name: "Silver Axe", kind: "axe", stack: 1, power: 50, useTime: 0.34, damage: 6, knockback: 4.5, reach: 32 }),
  D({ id: 3518, name: "Gold Axe", kind: "axe", stack: 1, power: 55, useTime: 0.32, damage: 7, knockback: 4.5, reach: 34 }),
  D({ id: 45, name: "War Axe of the Night", kind: "axe", stack: 1, power: 75, useTime: 0.5, damage: 20, knockback: 5, reach: 40 }),
  D({ id: 217, name: "Molten Hamaxe", kind: "axe", stack: 1, power: 150, useTime: 0.45, damage: 20, knockback: 7, reach: 40 }),
  D({ id: 196, name: "Wooden Hammer", kind: "hammer", stack: 1, power: 25, useTime: 0.5, damage: 2, knockback: 5.5, reach: 30 }),
  D({ id: 3505, name: "Copper Hammer", kind: "hammer", stack: 1, power: 35, useTime: 0.45, damage: 4, knockback: 5.5, reach: 30 }),
  D({ id: 7, name: "Iron Hammer", kind: "hammer", stack: 1, power: 45, useTime: 0.4, damage: 7, knockback: 5.5, reach: 32 }),
  D({ id: 3481, name: "Silver Hammer", kind: "hammer", stack: 1, power: 50, useTime: 0.4, damage: 8, knockback: 5.5, reach: 32 }),
  D({ id: 3517, name: "Gold Hammer", kind: "hammer", stack: 1, power: 55, useTime: 0.38, damage: 9, knockback: 5.5, reach: 34 }),
  D({ id: 104, name: "The Breaker", kind: "hammer", stack: 1, power: 70, useTime: 0.45, damage: 24, knockback: 6, reach: 40 }),
  D({ id: 367, name: "Pwnhammer", kind: "hammer", stack: 1, power: 80, useTime: 0.45, damage: 26, knockback: 7.5, reach: 40, tooltip: "Strong enough to destroy Demon Altars" }),
  D({ id: 50, name: "Magic Mirror", kind: "tool", stack: 1, useTime: 1, tooltip: "Gaze in the mirror to return home" }),

  // ── Melee ────────────────────────────────────────────────────────────────────────────
  D({ id: 3507, name: "Copper Shortsword", kind: "shortsword", stack: 1, damage: 5, useTime: 0.22, knockback: 4, reach: 26 }),
  D({ id: 3508, name: "Copper Broadsword", kind: "sword", stack: 1, damage: 8, useTime: 0.38, knockback: 5, reach: 34 }),
  D({ id: 24, name: "Wooden Sword", kind: "sword", stack: 1, damage: 7, useTime: 0.4, knockback: 5, reach: 32 }),
  D({ id: 6, name: "Iron Shortsword", kind: "shortsword", stack: 1, damage: 8, useTime: 0.2, knockback: 4, reach: 28 }),
  D({ id: 4, name: "Iron Broadsword", kind: "sword", stack: 1, damage: 10, useTime: 0.35, knockback: 5.5, reach: 38 }),
  D({ id: 3483, name: "Silver Shortsword", kind: "shortsword", stack: 1, damage: 9, useTime: 0.2, knockback: 4, reach: 28 }),
  D({ id: 3519, name: "Gold Shortsword", kind: "shortsword", stack: 1, damage: 11, useTime: 0.2, knockback: 4, reach: 28 }),
  D({ id: 3484, name: "Silver Broadsword", kind: "sword", stack: 1, damage: 11, useTime: 0.33, knockback: 5.5, reach: 38 }),
  D({ id: 3520, name: "Gold Broadsword", kind: "sword", stack: 1, damage: 13, useTime: 0.33, knockback: 5.5, reach: 40 }),
  D({ id: 46, name: "Light's Bane", kind: "sword", stack: 1, damage: 17, useTime: 0.33, knockback: 5, reach: 46 }),
  D({ id: 190, name: "Blade of Grass", kind: "sword", stack: 1, damage: 28, useTime: 0.5, knockback: 6, reach: 50 }),
  D({ id: 155, name: "Muramasa", kind: "sword", stack: 1, damage: 22, useTime: 0.3, knockback: 3, reach: 42 }),
  D({ id: 121, name: "Fiery Greatsword", kind: "sword", stack: 1, damage: 36, useTime: 0.55, knockback: 6.5, reach: 56 }),
  D({ id: 1123, name: "Bee Keeper", kind: "sword", stack: 1, damage: 30, useTime: 0.35, knockback: 5.3, reach: 44 }),
  D({ id: 65, name: "Starfury", kind: "sword", stack: 1, damage: 22, useTime: 0.35, knockback: 5, reach: 40 }),
  D({ id: 273, name: "Night's Edge", kind: "sword", stack: 1, damage: 42, useTime: 0.42, knockback: 4.5, reach: 54 }),
  D({ id: 426, name: "Breaker Blade", kind: "sword", stack: 1, damage: 70, useTime: 0.5, knockback: 8, reach: 60 }),
  D({ id: 280, name: "Spear", kind: "spear", stack: 1, damage: 8, useTime: 0.5, knockback: 6.5, reach: 64 }),
  D({ id: 277, name: "Trident", kind: "spear", stack: 1, damage: 11, useTime: 0.5, knockback: 5, reach: 72 }),

  // ── Ranged and magic ─────────────────────────────────────────────────────────────────
  D({ id: 39, name: "Wooden Bow", kind: "bow", stack: 1, damage: 4, useTime: 0.5, knockback: 0, proj: { speed: 520, gravity: 400, ammo: "arrow" }, tooltip: "Uses arrows" }),
  D({ id: 3504, name: "Copper Bow", kind: "bow", stack: 1, damage: 6, useTime: 0.47, knockback: 0, proj: { speed: 540, gravity: 400, ammo: "arrow" }, tooltip: "Uses arrows" }),
  D({ id: 99, name: "Iron Bow", kind: "bow", stack: 1, damage: 8, useTime: 0.43, knockback: 0, proj: { speed: 560, gravity: 400, ammo: "arrow" }, tooltip: "Uses arrows" }),
  D({ id: 3480, name: "Silver Bow", kind: "bow", stack: 1, damage: 9, useTime: 0.42, knockback: 0, proj: { speed: 580, gravity: 400, ammo: "arrow" } }),
  D({ id: 3516, name: "Gold Bow", kind: "bow", stack: 1, damage: 11, useTime: 0.4, knockback: 0, proj: { speed: 600, gravity: 400, ammo: "arrow" } }),
  D({ id: 44, name: "Demon Bow", kind: "bow", stack: 1, damage: 14, useTime: 0.38, knockback: 1, proj: { speed: 640, gravity: 380, ammo: "arrow" } }),
  D({ id: 120, name: "Molten Fury", kind: "bow", stack: 1, damage: 29, useTime: 0.33, knockback: 2, proj: { speed: 720, gravity: 340, ammo: "arrow" } }),
  D({ id: 95, name: "Flintlock Pistol", kind: "gun", stack: 1, damage: 10, useTime: 0.42, knockback: 1, proj: { speed: 900, ammo: "bullet" }, value: 10 * G }),
  D({ id: 96, name: "Musket", kind: "gun", stack: 1, damage: 31, useTime: 0.75, knockback: 5.3, proj: { speed: 1000, ammo: "bullet" } }),
  D({ id: 164, name: "Handgun", kind: "gun", stack: 1, damage: 17, useTime: 0.25, knockback: 3, proj: { speed: 900, ammo: "bullet" } }),
  D({ id: 98, name: "Minishark", kind: "gun", stack: 1, damage: 6, useTime: 0.12, knockback: 0, proj: { speed: 900, ammo: "bullet" }, value: 35 * G }),
  D({ id: 219, name: "Phoenix Blaster", kind: "gun", stack: 1, damage: 24, useTime: 0.25, knockback: 2, proj: { speed: 950, ammo: "bullet" } }),
  D({ id: 113, name: "Magic Missile", kind: "magic", stack: 1, damage: 22, useTime: 0.6, knockback: 3, proj: { speed: 420, pierce: 1, tex: 0 } }),
  D({ id: 165, name: "Water Bolt", kind: "magic", stack: 1, damage: 19, useTime: 0.5, knockback: 5, proj: { speed: 380, pierce: 4 } }),
  D({ id: 64, name: "Vilethorn", kind: "magic", stack: 1, damage: 10, useTime: 0.45, knockback: 1, proj: { speed: 360, pierce: 3 } }),
  D({ id: 112, name: "Flower of Fire", kind: "magic", stack: 1, damage: 48, useTime: 0.4, knockback: 5.5, proj: { speed: 450, gravity: 300 } }),
  D({ id: 127, name: "Space Gun", kind: "magic", stack: 1, damage: 17, useTime: 0.3, knockback: 0, proj: { speed: 800 } }),
  D({ id: 55, name: "Enchanted Boomerang", kind: "boomerang", stack: 1, damage: 13, useTime: 0.25, knockback: 8, proj: { speed: 520, returns: true, pierce: 99 } }),
  D({ id: 119, name: "Flamarang", kind: "boomerang", stack: 1, damage: 32, useTime: 0.25, knockback: 8, proj: { speed: 620, returns: true, pierce: 99 } }),
  D({ id: 191, name: "Thorn Chakram", kind: "boomerang", stack: 1, damage: 25, useTime: 0.25, knockback: 7, proj: { speed: 560, returns: true, pierce: 99 } }),
  D({ id: 40, name: "Wooden Arrow", kind: "ammo", stack: 999, damage: 5, knockback: 2, ammo: "arrow", value: 5 }),
  D({ id: 41, name: "Flaming Arrow", kind: "ammo", stack: 999, damage: 7, knockback: 2, ammo: "arrow", value: 10 }),
  D({ id: 47, name: "Unholy Arrow", kind: "ammo", stack: 999, damage: 8, knockback: 3, ammo: "arrow", tooltip: "Pierces enemies" }),
  D({ id: 97, name: "Musket Ball", kind: "ammo", stack: 999, damage: 7, knockback: 2, ammo: "bullet", value: 7 }),
  D({ id: 234, name: "Meteor Shot", kind: "ammo", stack: 999, damage: 9, knockback: 1, ammo: "bullet" }),
  D({ id: 160, name: "Harpoon", kind: "magic", stack: 1, damage: 25, useTime: 0.6, knockback: 6, proj: { speed: 600, returns: true } }),
  D({ id: 161, name: "Spiky Ball", kind: "material", stack: 999, value: 80 }),
  D({ id: 166, name: "Bomb", kind: "explosive", stack: 99, damage: 0, value: 3 * S, tooltip: "A small explosion that will destroy some tiles" }),
  D({ id: 167, name: "Dynamite", kind: "explosive", stack: 99, damage: 0, value: 20 * S }),
  D({ id: 168, name: "Grenade", kind: "explosive", stack: 99, damage: 60, value: 75 }),

  // ── Armour ───────────────────────────────────────────────────────────────────────────
  ...armor("Copper", [89, 80, 76], [1, 2, 1], 1),
  ...armor("Iron", [90, 81, 77], [2, 3, 2], 2),
  ...armor("Silver", [91, 82, 78], [3, 4, 3], 3),
  ...armor("Gold", [92, 83, 79], [4, 5, 3], 4),
  ...armor("Ninja", [256, 257, 258], [2, 4, 3]),
  ...armor("Meteor", [123, 124, 125], [3, 3, 3]),
  ...armor("Shadow", [102, 101, 100], [6, 7, 6]),
  ...armor("Jungle", [228, 229, 230], [4, 5, 5]),
  ...armor("Necro", [151, 152, 153], [5, 6, 5]),
  ...armor("Molten", [231, 232, 233], [8, 9, 8]),
  D({ id: 88, name: "Mining Helmet", kind: "armor", stack: 1, slot: "head", defense: 1, value: 4 * G, tooltip: "Provides light when worn" }),

  // ── Accessories ──────────────────────────────────────────────────────────────────────
  D({ id: 54, name: "Hermes Boots", kind: "accessory", stack: 1, acc: { speed: 0.3 } }),
  D({ id: 212, name: "Anklet of the Wind", kind: "accessory", stack: 1, acc: { speed: 0.1 } }),
  D({ id: 53, name: "Cloud in a Bottle", kind: "accessory", stack: 1, acc: { doubleJump: true } }),
  D({ id: 159, name: "Shiny Red Balloon", kind: "accessory", stack: 1, acc: { jump: 0.3 } }),
  D({ id: 158, name: "Lucky Horseshoe", kind: "accessory", stack: 1, acc: { noFall: true } }),
  D({ id: 49, name: "Band of Regeneration", kind: "accessory", stack: 1, acc: { regen: 1 } }),
  D({ id: 211, name: "Feral Claws", kind: "accessory", stack: 1, acc: { meleeSpeed: 0.12 } }),
  D({ id: 156, name: "Cobalt Shield", kind: "accessory", stack: 1, acc: { defense: 1, knockbackImmune: true } }),
  D({ id: 193, name: "Obsidian Skull", kind: "accessory", stack: 1, acc: { defense: 1, lavaResist: 0.5 } }),
  D({ id: 490, name: "Warrior Emblem", kind: "accessory", stack: 1, acc: { meleeSpeed: 0.15 } }),

  // ── Potions ──────────────────────────────────────────────────────────────────────────
  D({ id: 5, name: "Mushroom", kind: "potion", stack: 99, heal: 15, useTime: 0.5, value: 25 }),
  D({ id: 28, name: "Lesser Healing Potion", kind: "potion", stack: 30, heal: 50, useTime: 0.5, value: 3 * S }),
  D({ id: 188, name: "Healing Potion", kind: "potion", stack: 30, heal: 100, useTime: 0.5, value: 10 * S }),
  D({ id: 292, name: "Ironskin Potion", kind: "buff", stack: 30, buff: { id: "ironskin", seconds: 240 }, tooltip: "Increase defense by 8" }),
  D({ id: 289, name: "Regeneration Potion", kind: "buff", stack: 30, buff: { id: "regeneration", seconds: 480 } }),
  D({ id: 290, name: "Swiftness Potion", kind: "buff", stack: 30, buff: { id: "swiftness", seconds: 240 } }),
  D({ id: 288, name: "Obsidian Skin Potion", kind: "buff", stack: 30, buff: { id: "obsidianskin", seconds: 240 }, tooltip: "Provides immunity to lava" }),
  D({ id: 2322, name: "Mining Potion", kind: "buff", stack: 30, buff: { id: "mining", seconds: 480 } }),
  D({ id: 296, name: "Spelunker Potion", kind: "buff", stack: 30, buff: { id: "spelunker", seconds: 300 } }),
  D({ id: 2325, name: "Builder Potion", kind: "buff", stack: 30, buff: { id: "builder", seconds: 900 } }),
  D({ id: 298, name: "Shine Potion", kind: "buff", stack: 30, buff: { id: "shine", seconds: 300 } }),
  D({ id: 295, name: "Featherfall Potion", kind: "buff", stack: 30, buff: { id: "featherfall", seconds: 300 } }),

  // ── Progression ──────────────────────────────────────────────────────────────────────
  D({ id: 29, name: "Life Crystal", kind: "upgrade", stack: 99, useTime: 0.5, tooltip: "Permanently increases maximum life by 20" }),
  D({ id: 560, name: "Slime Crown", kind: "summon", stack: 20, useTime: 1, tooltip: "Summons King Slime" }),
  D({ id: 43, name: "Suspicious Looking Eye", kind: "summon", stack: 20, useTime: 1, tooltip: "Summons the Eye of Cthulhu (at night)" }),
  D({ id: 70, name: "Worm Food", kind: "summon", stack: 20, useTime: 1, tooltip: "Summons the Eater of Worlds (in the Corruption)" }),
  D({ id: 1133, name: "Abeemination", kind: "summon", stack: 20, useTime: 1, tooltip: "Summons the Queen Bee (in the Jungle)" }),
  D({ id: 267, name: "Guide Voodoo Doll", kind: "summon", stack: 1, useTime: 1, tooltip: "Summons the Wall of Flesh (in the Underworld)" }),
  D({ id: 67, name: "Vile Powder", kind: "material", stack: 99, value: 20 }),
  D({ id: 66, name: "Purification Powder", kind: "material", stack: 99, value: 75 }),
  D({ id: 327, name: "Golden Key", kind: "material", stack: 99 }),
  D({ id: 1313, name: "Book of Skulls", kind: "magic", stack: 1, damage: 29, useTime: 0.5, knockback: 3.5, proj: { speed: 420, pierce: 2 } }),
];

function armor(name: string, ids: [number, number, number], defense: [number, number, number], sheet?: number): ItemDef[] {
  const names = ARMOR_PIECES[name] ?? ["Helmet", "Chainmail", "Greaves"];
  const slots = ["head", "body", "legs"] as const;
  return slots.map((slot, i) => D({ id: ids[i], name: `${name} ${names[i]}`, kind: "armor", stack: 1, slot, defense: defense[i], set: name, ...(sheet ? { sheet } : {}) }));
}

// ── Synthetic items: blocks, walls and themed furniture ────────────────────────────────────

const SYNTH_BLOCKS: [number, string][] = [
  [T.LivingWood, "Living Wood"],
  [T.Leaf, "Leaf Block"],
  [T.IceBrick, "Ice Brick"],
  [T.MudstoneBrick, "Mudstone Brick"],
  [T.GlowMushroomBlock, "Mushroom Block"],
  [T.BoneBlock, "Bone Block"],
  [T.Sandstone, "Sandstone Block"],
  [T.HardenedSand, "Hardened Sand Block"],
  [T.Pearlsand, "Pearlsand Block"],
  [T.PearlstoneBrick, "Pearlstone Brick"],
  [T.Granite, "Granite Block"],
  [T.GraniteBlock, "Smooth Granite Block"],
  [T.StoneSlab, "Stone Slab"],
  [T.SandstoneSlab, "Sandstone Slab"],
  [T.CrystalBlock, "Crystal Block"],
  [T.DynastyWood, "Dynasty Wood"],
  [T.RedShingles, "Red Dynasty Shingles"],
  [T.BlueShingles, "Blue Dynasty Shingles"],
  [T.Coralstone, "Coralstone Block"],
  [T.LivingMahogany, "Living Mahogany"],
  [T.MahoganyLeaves, "Mahogany Leaf Block"],
  [T.WoodBeam, "Wooden Beam"],
  [T.Hay, "Hay"],
  [T.CopperPlating, "Copper Plating"],
];

const WALL_NAMES: Record<number, string> = {
  [W.Dirt]: "Dirt Wall",
  [W.PinkBrick]: "Pink Brick Wall",
  [W.GreenBrick]: "Green Brick Wall",
  [W.Glass]: "Glass Wall",
  [W.Planked]: "Planked Wall",
  [W.SnowBrick]: "Snow Brick Wall",
  [W.SandstoneBrick]: "Sandstone Brick Wall",
  [W.EbonstoneBrick]: "Ebonstone Brick Wall",
  [W.Ebonwood]: "Ebonwood Wall",
  [W.RichMahogany]: "Rich Mahogany Wall",
  [W.Leaf]: "Living Leaf Wall",
  [W.Cloud]: "Cloud Wall",
  [W.Disc]: "Disc Wall",
  [W.Mushroom]: "Mushroom Wall",
  [W.Hive]: "Hive Wall",
  [W.HellstoneBrick]: "Hellstone Brick Wall",
  [W.Boreal]: "Boreal Wood Wall",
  [W.Palm]: "Palm Wood Wall",
  [W.Ebonstone]: "Ebonstone Wall",
  [W.Mud]: "Mud Wall",
  [W.PearlstoneBrick]: "Pearlstone Brick Wall",
  [W.Pearlwood]: "Pearlwood Wall",
  [W.RedStucco]: "Red Stucco Wall",
  [W.YellowStucco]: "Yellow Stucco Wall",
  [W.GreenStucco]: "Green Stucco Wall",
  [W.GrayStucco]: "Gray Stucco Wall",
  [W.LivingWood]: "Living Wood Wall",
  [W.PurpleGlass]: "Purple Stained Glass",
  [W.YellowGlass]: "Yellow Stained Glass",
  [W.BlueGlass]: "Blue Stained Glass",
  [W.GreenGlass]: "Green Stained Glass",
  [W.RedGlass]: "Red Stained Glass",
  [W.RainbowGlass]: "Multicolor Stained Glass",
  [W.WoodFence]: "Wood Fence",
  [W.MetalFence]: "Metal Fence",
  [W.CopperPlating]: "Copper Plating Wall",
  [W.Lattice]: "Dynasty Lattice Wall",
  [W.Marble]: "Marble Wall",
  [W.Granite]: "Granite Wall",
  [W.Plaster]: "White Plaster Wall",
  [W.Sandstone]: "Smooth Sandstone Wall",
  [W.Shadewood]: "Shadewood Wall",
  [W.Crystal]: "Crystal Wall",
};

/** The item that places a wall (real where checked, else synthetic). */
export const wallItem = (w: number) => REAL_WALL_ITEM[w] ?? WALL_ITEM_BASE + w;
const REAL_WALL_ITEM: Record<number, number> = {};

/** The item that places a tile. */
export const blockItem = (t: number) => REAL_BLOCK_ITEM[t] ?? BLOCK_ITEM_BASE + t;
const REAL_BLOCK_ITEM: Record<number, number> = {};

function synthetic(): ItemDef[] {
  const out: ItemDef[] = [];
  for (const [t, name] of SYNTH_BLOCKS) out.push({ id: BLOCK_ITEM_BASE + t, name, kind: "block", stack: 999, tile: t, icon: blockIcon(TILE_SHEET_FOR_ICON[t] ?? 0) });
  for (const [w, name] of Object.entries(WALL_NAMES)) {
    const id = Number(w);
    out.push({ id: WALL_ITEM_BASE + id, name, kind: "wall", stack: 999, wall: id, icon: { tex: `Images/Wall_${WALL_SHEET[id]}`, sx: 44, sy: 44, sw: 16, sh: 16 } });
  }
  // Every themed furniture piece in every theme, plus decorations by style.
  const seen = new Set<number>();
  for (const th of Object.values(THEMES))
    for (const [p, style] of Object.entries(th.styles) as [ThemedPiece, number][]) {
      // (Base-style pieces with a real item are skipped below by their id; ones without, such as
      // the sink, need a synthetic item like any other style.)
      const def = OBJECTS[p];
      const id = def.drop(style);
      if (id === null || seen.has(id) || id < 100000) continue;
      seen.add(id);
      out.push(furnitureDef(p, style, id));
    }
  for (let s = 1; s < 12; s++) out.push(furnitureDef("painting", s, def("painting", s)));
  out.push(furnitureDef("painting", 0, def("painting", 0)));
  for (let s = 0; s < 6; s++) out.push(furnitureDef("statue", s, def("statue", s)));
  return out;
}

const def = (t: ObjectType, style: number) => OBJECTS[t].drop(style)!;

function furnitureDef(t: ObjectType, style: number, id: number): ItemDef {
  const o = OBJECTS[t];
  const f = o.frame(style);
  return { id, name: furnitureName(t, style), kind: "furniture", stack: 99, object: t, style, icon: { tex: o.sheet, sx: f.sx, sy: f.sy, sw: o.w * 18 - 2, sh: o.h * 18 - 2 } };
}

export const ITEMS: Record<number, ItemDef> = Object.fromEntries([...BASE, ...synthetic()].map((d) => [d.id, d]));
for (const d of Object.values(ITEMS)) {
  if (d.tile !== undefined && d.id < BLOCK_ITEM_BASE && REAL_BLOCK_ITEM[d.tile] === undefined) REAL_BLOCK_ITEM[d.tile] = d.id;
  if (d.wall !== undefined && d.id < WALL_ITEM_BASE && REAL_WALL_ITEM[d.wall] === undefined) REAL_WALL_ITEM[d.wall] = d.id;
}

/** A furniture item for a themed piece (creating its definition on demand for any style). */
export function furnitureItemFor(t: ObjectType, style: number): number {
  const id = OBJECTS[t].drop(style);
  if (id === null) return 0;
  if (!ITEMS[id]) ITEMS[id] = furnitureDef(t, style, id);
  return id;
}
void FURNITURE_TYPES;
void furnitureFromItem;

export const itemTexture = (id: number) => ITEMS[id]?.icon?.tex ?? `Images/Item_${id}`;
export const item = (id: number): ItemDef | undefined => ITEMS[id];

/** The block item a tile drops when mined (grass gives dirt; ore gives ore). */
export const TILE_DROP: Record<number, number | null> = {
  [T.Dirt]: 2,
  [T.Grass]: 2,
  [T.Stone]: 3,
  [T.Wood]: 9,
  [T.Sand]: 169,
  [T.Clay]: 133,
  [T.Mud]: 176,
  [T.JungleGrass]: 176,
  [T.Snow]: 593,
  [T.Ice]: 664,
  [T.Platform]: 94,
  [T.Copper]: 12,
  [T.Iron]: 11,
  [T.Gold]: 13,
  [T.Silver]: 14,
  [T.Demonite]: 56,
  [T.CorruptGrass]: 2,
  [T.Ebonstone]: 61,
  [T.Meteorite]: 116,
  [T.Ash]: 172,
  [T.Hellstone]: 174,
  [T.Obsidian]: 173,
  [T.MushroomGrass]: 176,
  [T.Hive]: 1124,
  [T.Cloud]: 751,
  [T.Sunplate]: 824,
  [T.BlueBrick]: 134,
  [T.GreenBrick]: 137,
  [T.PinkBrick]: 139,
  [T.GrayBrick]: 129,
  [T.RedBrick]: 131,
  [T.GoldBrick]: 141,
  [T.Glass]: 170,
  [T.SandstoneBrick]: 607,
  [T.SnowBrick]: 594,
  [T.BorealWood]: 2503,
  [T.PalmWood]: 2504,
  [T.RichMahogany]: 620,
  [T.Ebonwood]: 619,
  [T.ObsidianBrick]: 192,
  [T.HellstoneBrick]: 214,
  [T.LivingWood]: BLOCK_ITEM_BASE + T.LivingWood,
  [T.Leaf]: BLOCK_ITEM_BASE + T.Leaf,
  [T.IceBrick]: BLOCK_ITEM_BASE + T.IceBrick,
  [T.EbonstoneBrick]: 609,
  [T.MudstoneBrick]: BLOCK_ITEM_BASE + T.MudstoneBrick,
  [T.CopperBrick]: 145,
  [T.SilverBrick]: 143,
  [T.GlowMushroomBlock]: BLOCK_ITEM_BASE + T.GlowMushroomBlock,
  [T.BoneBlock]: BLOCK_ITEM_BASE + T.BoneBlock,
  [T.Sandstone]: BLOCK_ITEM_BASE + T.Sandstone,
  [T.HardenedSand]: BLOCK_ITEM_BASE + T.HardenedSand,
  [T.HallowedGrass]: 2,
  [T.CrimsonGrass]: 2,
  [T.Pearlstone]: 409,
  [T.Crimstone]: 836,
  [T.Crimtane]: 880,
  [T.Pearlwood]: 621,
  [T.Shadewood]: 911,
  [T.Marble]: 3081,
  [T.MarbleBlock]: 3066,
  [T.Amethyst]: 181,
  [T.Topaz]: 180,
  [T.Sapphire]: 177,
  [T.Emerald]: 179,
  [T.Ruby]: 178,
  [T.Diamond]: 182,
  // The building materials give themselves back.
  ...Object.fromEntries(
    [T.Pearlsand, T.PearlstoneBrick, T.Granite, T.GraniteBlock, T.StoneSlab, T.SandstoneSlab, T.CrystalBlock, T.DynastyWood, T.RedShingles, T.BlueShingles, T.Coralstone, T.LivingMahogany, T.MahoganyLeaves, T.WoodBeam, T.Hay, T.CopperPlating].map((t) => [t, BLOCK_ITEM_BASE + t]),
  ),
};

/** How much digging a tile takes (pickaxe power per hit is subtracted). */
export const TILE_DURABILITY: Record<number, number> = {
  [T.Dirt]: 50,
  [T.Grass]: 50,
  [T.Sand]: 50,
  [T.Clay]: 50,
  [T.Mud]: 50,
  [T.JungleGrass]: 50,
  [T.Snow]: 50,
  [T.Wood]: 60,
  [T.Platform]: 30,
  [T.Ice]: 80,
  [T.Stone]: 100,
  [T.Copper]: 105,
  [T.Iron]: 115,
  [T.Silver]: 120,
  [T.Gold]: 130,
  [T.Demonite]: 200,
  [T.Ebonstone]: 120,
  [T.CorruptGrass]: 50,
  [T.Meteorite]: 200,
  [T.Ash]: 60,
  [T.Hellstone]: 250,
  [T.Obsidian]: 250,
  [T.MushroomGrass]: 50,
  [T.Hive]: 80,
  [T.Cloud]: 40,
  [T.BlueBrick]: 300,
  [T.GreenBrick]: 300,
  [T.PinkBrick]: 300,
  [T.HallowedGrass]: 50,
  [T.CrimsonGrass]: 50,
  [T.Pearlsand]: 50,
  [T.Hay]: 30,
  [T.WoodBeam]: 40,
  [T.Pearlstone]: 120,
  [T.Crimstone]: 120,
  [T.Crimtane]: 200,
  [T.Marble]: 110,
  [T.Granite]: 110,
  [T.Amethyst]: 110,
  [T.Topaz]: 110,
  [T.Sapphire]: 115,
  [T.Emerald]: 115,
  [T.Ruby]: 120,
  [T.Diamond]: 125,
};

/** Hits needed to break a tile with a pickaxe of `power`. */
export const hitsToMine = (tile: number, power: number) => Math.max(1, Math.ceil((TILE_DURABILITY[tile] ?? 100) / Math.max(1, power)));

/** Starting gear, as in Terraria. */
export const STARTER_KIT: [number, number][] = [
  [3507, 1],
  [3509, 1],
  [3506, 1],
];

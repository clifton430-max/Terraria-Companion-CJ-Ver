// Typed, data-driven weapon definitions. Five archetypes — sword, bow, gun, magic staff and
// summon — with original starter weapons plus six end-game Terraria weapons whose item and
// projectile art is loaded from the user's local install (with the original art as fallback).
// Distances are in sprite pixels (multiplied by the character's pixel scale); speeds are CSS px/s.

import type { ShapeId, WeaponPalette } from "./weaponArt";

export type WeaponKind = "sword" | "bow" | "gun" | "staff" | "summon";
export type Category = "melee" | "ranged" | "magic" | "summon";

export const CATEGORY_OF: Record<WeaponKind, Category> = {
  sword: "melee",
  bow: "ranged",
  gun: "ranged",
  staff: "magic",
  summon: "summon",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  melee: "Melee",
  ranged: "Ranged",
  magic: "Magic",
  summon: "Summon",
};

/**
 * Real Terraria item art for a weapon, read at runtime from the local install. Sizes/grip/tip are
 * in texture pixels (measured from the installed textures).
 */
export interface WeaponArt {
  texture: string;
  size: [number, number];
  /** Where the hand holds it. */
  grip: [number, number];
  /** Blade tip / muzzle / emitter. */
  tip: [number, number];
}

/** A sprite-drawn projectile (texture from the local install; procedural fallback otherwise). */
export interface ProjectileArt {
  texture: string;
  /** Radians added to the velocity angle so the sprite points along its motion. */
  rotation: number;
  /** Frames stacked vertically (animated projectiles). */
  frames?: number;
}

interface WeaponCommon {
  /** The Silksong Needle or Thread (special handling in Silksong Controls). */
  silk?: "needle" | "thread";
  /** Real item art (overrides `shape` when the texture loads). */
  art?: WeaponArt;
  /** Short note on where this desktop version differs from the game. */
  approximation?: string;
  id: string;
  name: string;
  /** Base damage per hit (per pellet for guns, per minion hit for summons). */
  damage: number;
  /** Seconds per use: the attack animation length and the cooldown between uses. */
  useTime: number;
  knockback: number;
  /** Critical-hit chance, 0..1. Crits deal double damage. */
  crit: number;
  /** Name colour in tooltips. */
  rarity: string;
  description: string;
  shape: ShapeId;
  palette: WeaponPalette;
}

export interface SwordDef extends WeaponCommon {
  kind: "sword";
  /** Blade reach from the hand, in sprite pixels. */
  reach: number;
  /** Swing arc in degrees, measured for a right-facing swing (0° = forward, −90° = up). */
  arcFrom: number;
  arcTo: number;
  /** Fraction of the swing during which the blade deals damage. */
  activeFrom: number;
  activeTo: number;
  /** Projectile fired at the start of the active swing (e.g. Terra Blade's beam). */
  beam?: { speed: number; pierce: number; ttl: number; damageMul: number; art: ProjectileArt; color: string };
  /** Large slash sprite drawn over the swing (e.g. Night's Edge), `frames` stacked vertically. */
  slash?: { texture: string; frames: number; color: string };
  /**
   * A mining tool rather than a weapon: its swing cooldown comes from settings and a swing aimed
   * at the pointer shows the glyph-cracking effect there (visual only).
   */
  pickaxe?: boolean;
  /** Pickaxe strength: faster swings, longer reach and a bigger smash area (1 = Copper). */
  power?: number;
  /** Swing timing: "out" (default, a fast start like a sword) or "linear" (Terraria tools). */
  swingEase?: "out" | "linear";
  /** Drawn as a chain flail/spear from the hand to the tip (Solar Eruption). */
  chain?: { color: string; link: string };
  /** Flying swords instead of a blade hitbox (Zenith). */
  fractal?: { textures: string[]; duration: number; reach: number; amplitude: number };
}

export interface BowDef extends WeaponCommon {
  kind: "bow";
  /** Seconds spent drawing before the arrow is released. */
  drawTime: number;
  arrowSpeed: number;
  arrowGravity: number;
  /** Extra dummies an arrow can pass through. */
  pierce: number;
  /** Arrows rain from above the target instead of leaving the bow (Daedalus Stormbow). */
  skyfall?: { count: number; extraRandom: number; spread: number; height: number };
  projectileArt?: ProjectileArt;
}

export interface GunDef extends WeaponCommon {
  kind: "gun";
  bulletSpeed: number;
  pellets: number;
  /** Total spread angle in radians across all pellets. */
  spread: number;
  projectileArt?: ProjectileArt;
  /** Rockets that burst on impact, damaging everything within `radius` px (Celebration Mk2). */
  explosive?: { radius: number; damageMul: number; colors: string[] };
}

export interface StaffDef extends WeaponCommon {
  kind: "staff";
  manaCost: number;
  /** Seconds of casting before the bolt appears. */
  castTime: number;
  boltSpeed: number;
  /** Maximum turn rate towards the nearest dummy (rad/s); 0 = straight. */
  homing: number;
  pierce: number;
  boltColor: string;
  /** The Silksong Thread: a silk spin hitting everything within `radius` sprite px of the caster. */
  silkSpin?: { radius: number };
  /**
   * Channelled beam instead of a bolt (Last Prism): lasts `duration` s while mana lasts, damage
   * ticks every `tick` s, ramping up while `beams` coloured lasers converge over `convergeTime`.
   */
  channel?: {
    duration: number;
    manaPerSecond: number;
    tick: number;
    beams: number;
    convergeTime: number;
    width: number;
    length: number;
    laserTexture: string;
    holdoutTexture: string;
  };
}

export interface MinionSpec {
  /** Sprite from the local install (drawn rotated toward its motion), instead of the pixel minion. */
  art?: { texture: string; rotation: number; frames?: number; rainbow?: boolean; scale?: number };
  speed: number;
  /** Seconds before the same minion can hit the same dummy again. */
  hitCooldown: number;
  /** How far from the character (CSS px) the minion will look for targets. */
  range: number;
  palette: WeaponPalette;
}

export interface SummonDef extends WeaponCommon {
  kind: "summon";
  manaCost: number;
  castTime: number;
  /** Mana reserved from the maximum while each minion is active. */
  upkeep: number;
  minion: MinionSpec;
}

export type WeaponDef = SwordDef | BowDef | GunDef | StaffDef | SummonDef;

/** Maximum simultaneous minions; summoning beyond this replaces the oldest. */
export const MINION_CAPACITY = 2;

const EMBER: WeaponPalette = { a: "#ffa04a", A: "#c2501f", w: "#ffe39a", c: "#8f2c1a" };
const FROST: WeaponPalette = { c: "#7fd6ff", w: "#e8fbff", b: "#d9e6f2", B: "#8aa5bf" };

/** Rotation offsets for projectile sprites drawn pointing up (arrows, bullets) or up-right (swords). */
const POINT_UP = Math.PI / 2;
const POINT_UP_RIGHT = Math.PI / 4;

/**
 * The base Needle from Silksong. An inventory item: in Terraria Controls it swings like a quick
 * sword; in Silksong Controls it uses the directional strikes in silk/needle.ts.
 */
export const NEEDLE_DEF: WeaponDef = {
  id: "needle",
  name: "Needle",
  kind: "sword",
  damage: 13,
  useTime: 0.24,
  knockback: 4,
  crit: 0.04,
  rarity: "#ffffff",
  description: "A thin, quick blade on a red thread.",
  shape: "sword",
  palette: { a: "#e8eef6", A: "#9aa6b8", w: "#ffffff", c: "#c8262e" },
  reach: 26,
  arcFrom: -60,
  arcTo: 50,
  activeFrom: 0.2,
  activeTo: 0.6,
  silk: "needle",
};

/** The Silksong Thread: a silk spin around the character (silk in Silksong Controls, mana otherwise). */
export const THREAD_DEF: WeaponDef = {
  id: "silk-thread",
  name: "Thread",
  kind: "staff",
  damage: 9,
  useTime: 0.6,
  knockback: 2,
  crit: 0.04,
  rarity: "#ffd6e4",
  description: "Spin a whirl of silk that strikes everything around you.",
  shape: "staff",
  palette: { c: "#ffe4ee", w: "#ffffff", b: "#d02a3a", B: "#7a1a26" },
  manaCost: 15,
  castTime: 0.12,
  boltSpeed: 0,
  homing: 0,
  pierce: 0,
  boltColor: "#ffe4ee",
  silkSpin: { radius: 36 },
  silk: "thread",
};



export const WEAPONS: readonly WeaponDef[] = [
  NEEDLE_DEF,
  THREAD_DEF,
  {
    id: "rustic-sword",
    name: "Rustic Sword",
    kind: "sword",
    damage: 12,
    useTime: 0.42,
    knockback: 5,
    crit: 0.04,
    rarity: "#ffffff",
    description: "A dependable blade. Swings in a wide arc in front of you.",
    shape: "sword",
    palette: {},
    reach: 20,
    arcFrom: -115,
    arcTo: 65,
    activeFrom: 0.15,
    activeTo: 0.8,
  },
  {
    id: "ember-blade",
    name: "Ember Blade",
    kind: "sword",
    damage: 22,
    useTime: 0.55,
    knockback: 6.5,
    crit: 0.1,
    rarity: "#ff9d3c",
    description: "Still warm from the forge. Slower, longer and harder-hitting.",
    shape: "sword",
    palette: EMBER,
    reach: 24,
    arcFrom: -125,
    arcTo: 70,
    activeFrom: 0.2,
    activeTo: 0.8,
  },
  {
    id: "pine-bow",
    name: "Pine Bow",
    kind: "bow",
    damage: 10,
    useTime: 0.6,
    knockback: 2,
    crit: 0.04,
    rarity: "#ffffff",
    description: "Draw, then loose. Arrows arc under gravity.",
    shape: "bow",
    palette: {},
    drawTime: 0.3,
    arrowSpeed: 720,
    arrowGravity: 900,
    pierce: 0,
  },
  {
    id: "recurve-bow",
    name: "Recurve Bow",
    kind: "bow",
    damage: 17,
    useTime: 0.7,
    knockback: 3,
    crit: 0.08,
    rarity: "#8fe36b",
    description: "A heavier draw for flatter, faster arrows that pierce one target.",
    shape: "bow",
    palette: { b: "#6b3f8f", B: "#41245a", c: "#d9c27a" },
    drawTime: 0.4,
    arrowSpeed: 980,
    arrowGravity: 650,
    pierce: 1,
  },
  {
    id: "pocket-pistol",
    name: "Pocket Pistol",
    kind: "gun",
    damage: 9,
    useTime: 0.28,
    knockback: 1.5,
    crit: 0.06,
    rarity: "#ffffff",
    description: "Small, quick and precise. Fires a fast round.",
    shape: "gun",
    palette: {},
    bulletSpeed: 1800,
    pellets: 1,
    spread: 0.02,
  },
  {
    id: "scattergun",
    name: "Scattergun",
    kind: "gun",
    damage: 6,
    useTime: 0.8,
    knockback: 4,
    crit: 0.04,
    rarity: "#6bb8ff",
    description: "Fires four pellets in a spread. Devastating up close.",
    shape: "gun",
    palette: { a: "#9aa3ad", A: "#5d6670", b: "#4a2f1b", B: "#2e1c10" },
    bulletSpeed: 1500,
    pellets: 4,
    spread: 0.26,
  },
  {
    id: "spark-wand",
    name: "Spark Wand",
    kind: "staff",
    damage: 14,
    useTime: 0.35,
    knockback: 2,
    crit: 0.06,
    rarity: "#ffffff",
    description: "Casts a spark that gently seeks the nearest target.",
    shape: "staff",
    palette: { c: "#ffd34a", w: "#fff6c4" },
    manaCost: 6,
    castTime: 0.15,
    boltSpeed: 650,
    homing: 2.5,
    pierce: 0,
    boltColor: "#ffd34a",
  },
  {
    id: "frost-staff",
    name: "Frost Staff",
    kind: "staff",
    damage: 24,
    useTime: 0.6,
    knockback: 3,
    crit: 0.08,
    rarity: "#6bb8ff",
    description: "A slow, strongly seeking shard of ice that pierces two targets.",
    shape: "staff",
    palette: FROST,
    manaCost: 12,
    castTime: 0.25,
    boltSpeed: 520,
    homing: 4,
    pierce: 2,
    boltColor: "#7fd6ff",
  },
  {
    id: "wisp-lantern",
    name: "Wisp Lantern",
    kind: "summon",
    damage: 8,
    useTime: 0.6,
    knockback: 1,
    crit: 0,
    rarity: "#ffffff",
    description: "Summons a wisp that follows you and darts at nearby dummies.",
    shape: "lantern",
    palette: { a: "#6b7f99", c: "#9fe6ff", w: "#ffffff" },
    manaCost: 10,
    castTime: 0.3,
    upkeep: 20,
    minion: { speed: 420, hitCooldown: 0.45, range: 420, palette: { c: "#9fe6ff", w: "#ffffff" } },
  },
  {
    id: "firefly-jar",
    name: "Firefly Jar",
    kind: "summon",
    damage: 13,
    useTime: 0.7,
    knockback: 1.5,
    crit: 0,
    rarity: "#ff9d3c",
    description: "Summons a fierce firefly. Faster, hits harder, costs more upkeep.",
    shape: "lantern",
    palette: { a: "#8a6a3a", c: "#ffcf4a", w: "#fff3b0" },
    manaCost: 14,
    castTime: 0.3,
    upkeep: 25,
    minion: { speed: 520, hitCooldown: 0.6, range: 460, palette: { c: "#ffcf4a", w: "#fff3b0" } },
  },

  // ── Tools ─────────────────────────────────────────────────────────────────────────────
  {
    id: "copper-pickaxe",
    name: "Copper Pickaxe",
    kind: "sword",
    damage: 5,
    useTime: 0.45,
    knockback: 2,
    crit: 0.04,
    rarity: "#ffffff",
    description: "Swing at a spot near the pointer to crack some (pretend) letters. Purely visual.",
    approximation: "Doesn't mine anything: the cracking letters are drawn on the companion's own overlay.",
    shape: "pickaxe",
    palette: { a: "#e08a55", A: "#9a5530", w: "#ffd6b8", b: "#8a5a34" },
    art: { texture: "Images/Item_1", size: [32, 32], grip: [4, 27], tip: [23, 8] },
    // Terraria-style held swing (see pickaxeAnim.ts): linear, ~200° from behind the head to
    // forward-down; the reach matches the drawn pick head at native pixel scale.
    reach: 18,
    arcFrom: -160,
    arcTo: 40,
    activeFrom: 0.6,
    activeTo: 0.97,
    swingEase: "linear",
    pickaxe: true,
    power: 1,
  },
  {
    id: "picksaw",
    name: "Picksaw",
    kind: "sword",
    damage: 34,
    useTime: 0.3,
    knockback: 5.5,
    crit: 0.04,
    rarity: "#ffff0a",
    description: "A Lihzahrd pickaxe: swings twice as fast, reaches farther and smashes a much bigger area.",
    approximation: "Like the Copper Pickaxe, it doesn't mine anything; its strikes smash letters via the Letter Destroyer bookmarklet.",
    shape: "pickaxe",
    palette: { a: "#c8862a", A: "#7a4a1a", w: "#ffd27a", b: "#5a3418" },
    art: { texture: "Images/Item_1294", size: [42, 42], grip: [4, 38], tip: [29, 12] },
    // Same Terraria-style swing as the Copper Pickaxe; reach matches the larger drawn head.
    reach: 24,
    arcFrom: -160,
    arcTo: 40,
    activeFrom: 0.6,
    activeTo: 0.97,
    swingEase: "linear",
    pickaxe: true,
    power: 2,
  },

  // ── End-game Terraria weapons (item/projectile art from the local install) ──────────────
  {
    id: "terra-blade",
    name: "Terra Blade",
    kind: "sword",
    damage: 85,
    useTime: 0.3,
    knockback: 6.5,
    crit: 0.04,
    rarity: "#ffff0a",
    description: "Swings fire a piercing green Terra Beam.",
    approximation: "Beam always fires (in game it depends on health), at a fixed desktop speed.",
    shape: "sword",
    palette: { a: "#9cff6a", A: "#3c9c2a", w: "#eaffd0", c: "#e3c94a" },
    art: { texture: "Images/Item_757", size: [46, 54], grip: [6, 48], tip: [42, 4] },
    reach: 24,
    arcFrom: -120,
    arcTo: 70,
    activeFrom: 0.15,
    activeTo: 0.8,
    beam: {
      speed: 950,
      pierce: 2,
      ttl: 1.3,
      damageMul: 1,
      art: { texture: "Images/Projectile_132", rotation: POINT_UP_RIGHT },
      color: "#9cff6a",
    },
  },
  {
    id: "nights-edge",
    name: "Night's Edge",
    kind: "sword",
    damage: 42,
    useTime: 0.42,
    knockback: 4.5,
    crit: 0.04,
    rarity: "#ff9632",
    description: "A dark blade with a sweeping shadow slash.",
    approximation: "The slash is visual; damage comes from the blade arc only.",
    shape: "sword",
    palette: { a: "#9a6bff", A: "#4a2a9a", w: "#d8c8ff", c: "#6b2a8f" },
    art: { texture: "Images/Item_273", size: [50, 54], grip: [6, 48], tip: [46, 4] },
    reach: 28,
    arcFrom: -135,
    arcTo: 80,
    activeFrom: 0.12,
    activeTo: 0.85,
    slash: { texture: "Images/Projectile_972", frames: 4, color: "#a066ff" },
  },
  {
    id: "megashark",
    name: "Megashark",
    kind: "gun",
    damage: 25,
    useTime: 0.12,
    knockback: 1,
    crit: 0.07,
    rarity: "#ff96ff",
    description: "Rapid-fire machine gun.",
    approximation: "No ammo: fires generic musket balls; the 50% ammo saving has nothing to save.",
    shape: "gun",
    palette: { a: "#b8a6c8", A: "#7a6a8a", b: "#5a3a5a", B: "#3a2a3a" },
    art: { texture: "Images/Item_533", size: [70, 28], grip: [20, 20], tip: [69, 9] },
    bulletSpeed: 2000,
    pellets: 1,
    spread: 0.06,
    projectileArt: { texture: "Images/Projectile_14", rotation: POINT_UP },
  },
  {
    id: "daedalus-stormbow",
    name: "Daedalus Stormbow",
    kind: "bow",
    damage: 42,
    useTime: 0.38,
    knockback: 2,
    crit: 0.04,
    rarity: "#ff96ff",
    description: "Calls a volley of arrows down from the sky onto the target.",
    approximation: "Fires Holy Arrow sprites without their falling-star bonus.",
    shape: "bow",
    palette: { b: "#c8d8f0", B: "#7a8aa8", c: "#e05a9a" },
    art: { texture: "Images/Item_3029", size: [30, 62], grip: [20, 31], tip: [6, 31] },
    drawTime: 0.05,
    arrowSpeed: 1100,
    arrowGravity: 300,
    pierce: 0,
    skyfall: { count: 3, extraRandom: 2, spread: 110, height: 520 },
    projectileArt: { texture: "Images/Projectile_91", rotation: POINT_UP },
  },
  {
    id: "last-prism",
    name: "Last Prism",
    kind: "staff",
    damage: 100,
    useTime: 3,
    knockback: 0,
    crit: 0.04,
    rarity: "#ff2864",
    description: "Hold to channel rainbow lasers that converge into one devastating beam.",
    approximation: "Fixed 3 s channel per use; beam ignores tiles and pierces every target.",
    shape: "staff",
    palette: { c: "#ffffff", w: "#ffd6f0" },
    art: { texture: "Images/Item_3541", size: [26, 30], grip: [13, 26], tip: [13, 4] },
    manaCost: 12,
    castTime: 0.05,
    boltSpeed: 0,
    homing: 0,
    pierce: 0,
    boltColor: "#ffffff",
    channel: {
      duration: 3,
      manaPerSecond: 16,
      tick: 0.15,
      beams: 6,
      convergeTime: 1.2,
      width: 12,
      length: 1600,
      laserTexture: "Images/Projectile_632",
      holdoutTexture: "Images/Projectile_633",
    },
  },
  {
    id: "zenith",
    name: "Zenith",
    kind: "sword",
    damage: 190,
    useTime: 0.3,
    knockback: 6.5,
    crit: 0.1,
    rarity: "#ff2864",
    description: "Summons spectral swords that carve through everything in their path.",
    approximation: "Swords fly straight out-and-back arcs to the target; no blade hitbox.",
    shape: "sword",
    palette: { a: "#e8f4ff", A: "#8aa8d8", w: "#ffffff", c: "#7a4ad8" },
    art: { texture: "Images/Item_4956", size: [56, 56], grip: [6, 50], tip: [52, 4] },
    reach: 24,
    arcFrom: -100,
    arcTo: 40,
    // The swing animates, but the sim skips blade hits for weapons with `fractal` swords.
    activeFrom: 0.1,
    activeTo: 0.9,
    fractal: {
      textures: [
        "Images/Item_3507",
        "Images/Item_989",
        "Images/Item_65",
        "Images/Item_1123",
        "Images/Item_1826",
        "Images/Item_2880",
        "Images/Item_3065",
        "Images/Item_3063",
        "Images/Item_757",
        "Images/Item_4956",
      ],
      duration: 0.6,
      reach: 620,
      amplitude: 70,
    },
  },

  // ── Roster characters' signature weapons (art from the installed add-on packs) ──────────
  {
    id: "royal-scepter",
    name: "Royal Scepter",
    kind: "staff",
    damage: 48,
    useTime: 0.42,
    knockback: 3,
    crit: 0.06,
    rarity: "#ff8ad8",
    description: "The Princess's scepter: homing sparkles of royal affection.",
    shape: "staff",
    palette: { a: "#ffd6f0", A: "#c94fa0", b: "#ffe066", B: "#b8860b", c: "#ff8ad8", w: "#ffffff" },
    manaCost: 6,
    castTime: 0.15,
    boltSpeed: 620,
    homing: 3.5,
    pierce: 1,
    boltColor: "#ff8ad8",
  },
  {
    id: "confetti-cannon",
    name: "Confetti Cannon",
    kind: "gun",
    damage: 34,
    useTime: 0.38,
    knockback: 3,
    crit: 0.05,
    rarity: "#ffd24a",
    description: "The Party Girl's cannon. Every shot is a celebration (with splash damage).",
    approximation: "Shots burst into confetti that damages everything nearby.",
    shape: "gun",
    palette: { a: "#ff6fb0", A: "#b03070", b: "#ffd24a", B: "#b08a1a" },
    bulletSpeed: 820,
    pellets: 1,
    spread: 0.05,
    explosive: { radius: 55, damageMul: 0.7, colors: ["#ff6fb0", "#ffd24a", "#6fe3ff", "#9fff6f", "#c08aff"] },
  },
  {
    id: "syringe-toss",
    name: "Syringe Toss",
    kind: "bow",
    damage: 30,
    useTime: 0.36,
    knockback: 2,
    crit: 0.12,
    rarity: "#ff6f6f",
    description: "The Nurse's syringes. Doctor's orders: stay still.",
    shape: "bow",
    palette: { a: "#ffffff", A: "#c8d4e0", b: "#ff4a4a", B: "#a01a1a" },
    drawTime: 0.1,
    arrowSpeed: 820,
    arrowGravity: 700,
    pierce: 0,
  },
  {
    id: "fox-claws",
    name: "Fox Claws",
    kind: "sword",
    damage: 44,
    useTime: 0.2,
    knockback: 3,
    crit: 0.1,
    rarity: "#ff9a4a",
    description: "Quinn's claws. Quick, precise swipes.",
    shape: "sword",
    palette: { a: "#fff4e6", A: "#c8a080", w: "#ffffff", c: "#ff9a4a" },
    reach: 18,
    arcFrom: -80,
    arcTo: 60,
    activeFrom: 0.1,
    activeTo: 0.7,
  },
  {
    id: "spiky-balls",
    name: "Tinkerer's Spiky Balls",
    kind: "bow",
    damage: 40,
    useTime: 0.45,
    knockback: 3,
    crit: 0.06,
    rarity: "#7ad0a8",
    description: "The Goblin Tinkerer's favourite: lob a spiky ball in an arc. Engineering!",
    approximation: "Thrown balls fly in an arc and pierce once; they don't stick to the ground like the game's.",
    shape: "bow",
    palette: { a: "#8a8a92", A: "#4a4a52" },
    art: { texture: "Images/Item_161", size: [16, 16], grip: [8, 8], tip: [8, 8] },
    drawTime: 0.15,
    arrowSpeed: 680,
    arrowGravity: 1100,
    pierce: 1,
    projectileArt: { texture: "Images/Projectile_24", rotation: 0 },
  },
  // ── More endgame Terraria weapons (art from the local install) ─────────────────────────
  {
    id: "meowmere",
    name: "Meowmere",
    kind: "sword",
    damage: 200,
    useTime: 0.28,
    knockback: 6.5,
    crit: 0.04,
    rarity: "#ff2864",
    description: "Swings launch bouncy rainbow cats that pierce through enemies.",
    approximation: "Cats fly straight and pierce instead of bouncing off tiles.",
    shape: "sword",
    palette: { a: "#ffb6e6", A: "#c86aa8", w: "#ffffff", c: "#7affff" },
    art: { texture: "Images/Item_3063", size: [50, 58], grip: [6, 52], tip: [46, 4] },
    reach: 26,
    arcFrom: -120,
    arcTo: 70,
    activeFrom: 0.15,
    activeTo: 0.8,
    beam: { speed: 820, pierce: 3, ttl: 1.6, damageMul: 0.75, art: { texture: "Images/Projectile_502", rotation: 0 }, color: "#ff9ad8" },
  },
  {
    id: "sdmg",
    name: "S.D.M.G.",
    kind: "gun",
    damage: 77,
    useTime: 0.07,
    knockback: 2.5,
    crit: 0.1,
    rarity: "#ff2864",
    description: "Space Dolphin Machine Gun: a blistering stream of luminite bullets.",
    approximation: "No ammo; fires luminite-style bullet streaks.",
    shape: "gun",
    palette: { a: "#9fd8ff", A: "#4a7aa8", b: "#2a3a5a", B: "#1a2236" },
    art: { texture: "Images/Item_1553", size: [66, 32], grip: [22, 22], tip: [65, 12] },
    bulletSpeed: 2200,
    pellets: 1,
    spread: 0.05,
    projectileArt: { texture: "Images/Projectile_638", rotation: Math.PI / 2 },
  },
  {
    id: "celebration-mk2",
    name: "Celebration Mk2",
    kind: "gun",
    damage: 60,
    useTime: 0.3,
    knockback: 4,
    crit: 0.04,
    rarity: "#ff2864",
    description: "Fires firework rockets that burst in colourful explosions.",
    approximation: "Rockets fly straight and burst on contact with a splash of damage.",
    shape: "gun",
    palette: { a: "#b48aff", A: "#6a3ab4", b: "#3a2a5a", B: "#22183a" },
    art: { texture: "Images/Item_3930", size: [80, 32], grip: [28, 22], tip: [79, 10] },
    bulletSpeed: 900,
    pellets: 1,
    spread: 0.04,
    explosive: { radius: 70, damageMul: 0.8, colors: ["#ff5a7a", "#ffd24a", "#5affc8", "#7ab4ff", "#ff8aff"] },
  },
  {
    id: "solar-eruption",
    name: "Solar Eruption",
    kind: "sword",
    damage: 105,
    useTime: 0.34,
    knockback: 4.5,
    crit: 0.1,
    rarity: "#ff2864",
    description: "A blazing flail-spear that lashes out far in front of you.",
    approximation: "Lashes along a fixed arc; drawn as a fiery chain to the head.",
    shape: "sword",
    palette: { a: "#ffb84a", A: "#e0501a", w: "#fff0a0", c: "#c02a1a" },
    art: { texture: "Images/Item_3473", size: [34, 34], grip: [17, 17], tip: [17, 17] },
    reach: 70,
    arcFrom: -35,
    arcTo: 25,
    activeFrom: 0.2,
    activeTo: 0.75,
    chain: { color: "#ff8a2a", link: "#ffe06a" },
  },
  {
    id: "stardust-dragon-staff",
    name: "Stardust Dragon Staff",
    kind: "summon",
    damage: 40,
    useTime: 0.5,
    knockback: 2,
    crit: 0,
    rarity: "#ff2864",
    description: "Summons a stardust dragon that coils around you and bites enemies.",
    approximation: "The dragon is a single head that darts at targets.",
    shape: "lantern",
    palette: { a: "#5a9aff", c: "#9fe6ff", w: "#ffffff" },
    art: { texture: "Images/Item_3531", size: [42, 42], grip: [8, 36], tip: [34, 8] },
    manaCost: 10,
    castTime: 0.3,
    upkeep: 20,
    minion: { speed: 620, hitCooldown: 0.3, range: 560, palette: { c: "#7ad8ff", w: "#ffffff" }, art: { texture: "Images/Projectile_625", rotation: Math.PI / 2, frames: 2 } },
  },
  {
    id: "terraprisma",
    name: "Terraprisma",
    kind: "summon",
    damage: 55,
    useTime: 0.4,
    knockback: 3,
    crit: 0,
    rarity: "#ff2864",
    description: "Summons a prismatic blade that slices through enemies.",
    approximation: "Blades fly at targets rather than in the game's formations.",
    shape: "lantern",
    palette: { a: "#ffffff", c: "#ff9aff", w: "#ffffff" },
    art: { texture: "Images/Item_5005", size: [52, 52], grip: [8, 46], tip: [46, 6] },
    manaCost: 10,
    castTime: 0.25,
    upkeep: 20,
    minion: { speed: 760, hitCooldown: 0.22, range: 620, palette: { c: "#ffd6ff", w: "#ffffff" }, art: { texture: "Images/Projectile_946", rotation: Math.PI, rainbow: true, scale: 0.6 } },
  },
  {
    id: "vortex-beater",
    name: "Vortex Beater",
    kind: "gun",
    damage: 50,
    useTime: 0.1,
    knockback: 2,
    crit: 0.04,
    rarity: "#ff2864",
    description: "A vortex-powered gun with a rapid stream of energy bullets.",
    approximation: "No rockets; fires rapid energy bullets.",
    shape: "gun",
    palette: { a: "#5affd2", A: "#2a9a7a", b: "#2a3a4a", B: "#1a222e" },
    art: { texture: "Images/Item_3475", size: [66, 28], grip: [22, 20], tip: [65, 10] },
    bulletSpeed: 1900,
    pellets: 1,
    spread: 0.07,
    projectileArt: { texture: "Images/Projectile_616", rotation: Math.PI / 2 },
  },
];

/** Ids of the end-game Terraria weapons (for UI grouping). */
export const TERRARIA_WEAPON_IDS = ["terra-blade", "nights-edge", "megashark", "daedalus-stormbow", "last-prism", "zenith"];

/** The newer endgame weapons (for UI grouping and tests). */
export const ENDGAME_WEAPON_IDS = ["meowmere", "sdmg", "celebration-mk2", "solar-eruption", "stardust-dragon-staff", "terraprisma", "vortex-beater"];

/** The pickaxe tool's id. */
export const PICKAXE_ID = "copper-pickaxe";

export const isPickaxe = (def: WeaponDef | undefined): boolean => def?.kind === "sword" && def.pickaxe === true;

/** A pickaxe's power (1 for weapons and the Copper Pickaxe). */
export const pickaxePower = (def: WeaponDef | undefined): number => (def?.kind === "sword" && def.pickaxe ? Math.max(1, def.power ?? 1) : 1);

/** Seconds per swing: the cooldown setting, divided by the pickaxe's power (never below 0.12 s). */
export function pickaxeUseTime(cooldown: number, power: number): number {
  return Math.max(0.12, cooldown / Math.max(1, power));
}

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

export function getWeapon(id: string | null | undefined): WeaponDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function categoryOf(def: WeaponDef): Category {
  return CATEGORY_OF[def.kind];
}

/** Mana spent per use (0 for weapons that don't use mana). */
export function manaCost(def: WeaponDef): number {
  return def.kind === "staff" || def.kind === "summon" ? def.manaCost : 0;
}

export function useSpeedLabel(useTime: number): string {
  if (useTime < 0.3) return "Very fast";
  if (useTime < 0.45) return "Fast";
  if (useTime < 0.65) return "Average";
  return "Slow";
}

export interface StatLine {
  label: string;
  value: string;
}

/** Tooltip stat lines for a weapon. */
export function weaponStats(def: WeaponDef): StatLine[] {
  const lines: StatLine[] = [
    { label: "Damage", value: def.kind === "gun" && def.pellets > 1 ? `${def.damage} × ${def.pellets}` : `${def.damage}` },
    { label: "Speed", value: `${useSpeedLabel(def.useTime)} (${def.useTime.toFixed(2)}s)` },
    { label: "Knockback", value: def.knockback.toFixed(1) },
  ];
  if (def.crit > 0) lines.push({ label: "Critical", value: `${Math.round(def.crit * 100)}%` });
  switch (def.kind) {
    case "sword":
      lines.push({ label: "Reach", value: `${def.reach} px` });
      break;
    case "bow":
      lines.push({ label: "Draw", value: `${def.drawTime.toFixed(2)}s` });
      if (def.pierce > 0) lines.push({ label: "Pierce", value: `${def.pierce}` });
      break;
    case "gun":
      lines.push({ label: "Velocity", value: `${def.bulletSpeed} px/s` });
      break;
    case "staff":
      lines.push({ label: "Mana", value: `${def.manaCost}` });
      if (def.pierce > 0) lines.push({ label: "Pierce", value: `${def.pierce}` });
      break;
    case "summon":
      lines.push({ label: "Mana", value: `${def.manaCost}` });
      lines.push({ label: "Upkeep", value: `${def.upkeep} max mana / minion` });
      break;
  }
  return lines;
}

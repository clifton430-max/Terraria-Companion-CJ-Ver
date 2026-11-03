// Every creature in the game: critters, enemies by biome, event invaders and bosses. Sprites are
// the real NPC textures from the local install (frames stacked vertically; ids and frame counts
// checked against the install's sheets). Stats are written for this game in the spirit of
// Terraria's pre-Hardmode (not copied from the game's code).

export type AiType =
  | "slime"
  | "fighter"
  | "flyer"
  | "bat"
  | "caster"
  | "worm"
  | "wormBody"
  | "plant"
  | "swimmer"
  | "antlion"
  | "critter"
  | "critterFly"
  | "critterSwim"
  | "boss";

export type ShotKind = "stinger" | "feather" | "sand" | "bolt" | "chaos" | "fireball" | "scythe" | "laser" | "skull" | "spit";

export interface Drop {
  id: number;
  min: number;
  max: number;
  chance: number;
}

export interface NpcDef {
  name: string;
  tex: string;
  frames: number;
  /** Frame size in the sheet (px). */
  fw: number;
  fh: number;
  w: number;
  h: number;
  life: number;
  damage: number;
  defense: number;
  /** 0 = full knockback, 1 = immune. */
  kbResist: number;
  ai: AiType;
  /** Tint for grey sheets (slimes). */
  tint?: string;
  boss?: boolean;
  drops: Drop[];
  /** Coins dropped (copper). */
  coins?: number;
  speed?: number;
  /** Shoots at its target every `every` seconds. */
  shoot?: { kind: ShotKind; every: number; speed: number; damage: number };
  /** Leaves at dawn / at night. */
  night?: boolean;
  day?: boolean;
  /** Worms: body and tail kinds and length. */
  worm?: { body: string; tail: string; length: number };
  /** Critters can be caught (with a bug net in Terraria; here the waifus just befriend them). */
  critter?: boolean;
  /** Sprites face right in the sheet (most Terraria NPCs face left). */
  facesRight?: boolean;
}

const D = (d: NpcDef) => d;
const coin = (copper: number) => copper;

export const NPC_DATA = {
  // ── Critters ───────────────────────────────────────────────────────────────────────────
  bunny: D({ name: "Bunny", tex: "Images/NPC_46", frames: 7, fw: 48, fh: 40, w: 18, h: 20, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 70 }),
  bird: D({ name: "Bird", tex: "Images/NPC_74", frames: 5, fw: 30, fh: 24, w: 14, h: 14, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critterFly", drops: [], critter: true, speed: 90 }),
  squirrel: D({ name: "Squirrel", tex: "Images/NPC_299", frames: 6, fw: 50, fh: 32, w: 18, h: 18, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 80 }),
  butterfly: D({ name: "Butterfly", tex: "Images/NPC_356", frames: 3, fw: 24, fh: 24, w: 12, h: 12, life: 3, damage: 0, defense: 0, kbResist: 0, ai: "critterFly", drops: [], critter: true, speed: 40, day: true }),
  firefly: D({ name: "Firefly", tex: "Images/NPC_355", frames: 4, fw: 10, fh: 16, w: 8, h: 8, life: 3, damage: 0, defense: 0, kbResist: 0, ai: "critterFly", drops: [], critter: true, speed: 30, night: true }),
  worm: D({ name: "Worm", tex: "Images/NPC_357", frames: 1, fw: 14, fh: 16, w: 12, h: 8, life: 3, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 15 }),
  penguin: D({ name: "Penguin", tex: "Images/NPC_148", frames: 14, fw: 28, fh: 36, w: 18, h: 26, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 40 }),
  frog: D({ name: "Frog", tex: "Images/NPC_361", frames: 11, fw: 26, fh: 26, w: 14, h: 12, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 60 }),
  duck: D({ name: "Duck", tex: "Images/NPC_362", frames: 15, fw: 52, fh: 40, w: 20, h: 20, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 40 }),
  snail: D({ name: "Snail", tex: "Images/NPC_359", frames: 8, fw: 30, fh: 15, w: 14, h: 10, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 10 }),
  scorpion: D({ name: "Scorpion", tex: "Images/NPC_367", frames: 4, fw: 34, fh: 26, w: 18, h: 14, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 50 }),
  grasshopper: D({ name: "Grasshopper", tex: "Images/NPC_377", frames: 2, fw: 18, fh: 12, w: 12, h: 8, life: 3, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 70 }),
  mouse: D({ name: "Mouse", tex: "Images/NPC_300", frames: 6, fw: 20, fh: 16, w: 14, h: 10, life: 3, damage: 0, defense: 0, kbResist: 0, ai: "critter", drops: [], critter: true, speed: 80 }),
  goldfish: D({ name: "Goldfish", tex: "Images/NPC_55", frames: 6, fw: 38, fh: 28, w: 20, h: 14, life: 5, damage: 0, defense: 0, kbResist: 0, ai: "critterSwim", drops: [], critter: true, speed: 60 }),

  // ── Slimes ─────────────────────────────────────────────────────────────────────────────
  greenSlime: D({ name: "Green Slime", tex: "Images/NPC_1", frames: 2, fw: 32, fh: 26, w: 26, h: 18, life: 14, damage: 6, defense: 0, kbResist: 0, ai: "slime", tint: "#5ad15a", drops: [{ id: 23, min: 1, max: 2, chance: 1 }], coins: coin(25) }),
  blueSlime: D({ name: "Blue Slime", tex: "Images/NPC_1", frames: 2, fw: 32, fh: 26, w: 26, h: 18, life: 25, damage: 7, defense: 2, kbResist: 0, ai: "slime", tint: "#4f8dff", drops: [{ id: 23, min: 1, max: 3, chance: 1 }], coins: coin(25) }),
  purpleSlime: D({ name: "Purple Slime", tex: "Images/NPC_1", frames: 2, fw: 32, fh: 26, w: 28, h: 20, life: 40, damage: 12, defense: 6, kbResist: 0, ai: "slime", tint: "#b65ae6", drops: [{ id: 23, min: 2, max: 4, chance: 1 }], coins: coin(100) }),
  jungleSlime: D({ name: "Jungle Slime", tex: "Images/NPC_1", frames: 2, fw: 32, fh: 26, w: 28, h: 20, life: 60, damage: 18, defense: 6, kbResist: 0, ai: "slime", tint: "#2f8f2f", drops: [{ id: 23, min: 2, max: 5, chance: 1 }], coins: coin(100) }),
  iceSlime: D({ name: "Ice Slime", tex: "Images/NPC_147", frames: 2, fw: 32, fh: 26, w: 26, h: 18, life: 40, damage: 14, defense: 4, kbResist: 0, ai: "slime", drops: [{ id: 23, min: 1, max: 3, chance: 1 }], coins: coin(50) }),
  sandSlime: D({ name: "Sand Slime", tex: "Images/NPC_537", frames: 3, fw: 38, fh: 28, w: 28, h: 20, life: 50, damage: 15, defense: 4, kbResist: 0, ai: "slime", drops: [{ id: 23, min: 1, max: 3, chance: 1 }, { id: 169, min: 3, max: 8, chance: 0.5 }], coins: coin(80) }),
  spikedJungleSlime: D({ name: "Spiked Jungle Slime", tex: "Images/NPC_204", frames: 2, fw: 40, fh: 32, w: 30, h: 22, life: 60, damage: 22, defense: 10, kbResist: 0, ai: "slime", drops: [{ id: 23, min: 2, max: 5, chance: 1 }, { id: 209, min: 1, max: 1, chance: 0.2 }], coins: coin(150), shoot: { kind: "spit", every: 2.5, speed: 300, damage: 14 } }),
  lavaSlime: D({ name: "Lava Slime", tex: "Images/NPC_59", frames: 2, fw: 32, fh: 26, w: 28, h: 20, life: 50, damage: 15, defense: 10, kbResist: 0, ai: "slime", drops: [{ id: 23, min: 2, max: 4, chance: 1 }], coins: coin(200) }),
  motherSlime: D({ name: "Mother Slime", tex: "Images/NPC_16", frames: 2, fw: 44, fh: 34, w: 36, h: 26, life: 90, damage: 20, defense: 7, kbResist: 0, ai: "slime", drops: [{ id: 23, min: 3, max: 6, chance: 1 }], coins: coin(300) }),

  // ── Walkers ────────────────────────────────────────────────────────────────────────────
  zombie: D({ name: "Zombie", tex: "Images/NPC_3", frames: 3, fw: 38, fh: 48, w: 18, h: 40, life: 45, damage: 14, defense: 6, kbResist: 0.5, ai: "fighter", speed: 60, night: true, drops: [{ id: 5, min: 1, max: 1, chance: 0.15 }], coins: coin(60) }),
  skeleton: D({ name: "Skeleton", tex: "Images/NPC_21", frames: 15, fw: 40, fh: 56, w: 18, h: 40, life: 60, damage: 20, defense: 8, kbResist: 0.5, ai: "fighter", speed: 80, drops: [{ id: 154, min: 1, max: 2, chance: 0.6 }], coins: coin(130) }),
  undeadMiner: D({ name: "Undead Miner", tex: "Images/NPC_44", frames: 15, fw: 40, fh: 56, w: 18, h: 40, life: 70, damage: 22, defense: 9, kbResist: 0.5, ai: "fighter", speed: 70, drops: [{ id: 8, min: 3, max: 8, chance: 0.6 }, { id: 88, min: 1, max: 1, chance: 0.05 }], coins: coin(250) }),
  angryBones: D({ name: "Angry Bones", tex: "Images/NPC_31", frames: 15, fw: 40, fh: 56, w: 18, h: 40, life: 80, damage: 30, defense: 10, kbResist: 0.4, ai: "fighter", speed: 100, drops: [{ id: 154, min: 1, max: 3, chance: 0.8 }, { id: 327, min: 1, max: 1, chance: 0.06 }], coins: coin(400) }),
  goblinPeon: D({ name: "Goblin Peon", tex: "Images/NPC_26", frames: 16, fw: 40, fh: 56, w: 18, h: 40, life: 45, damage: 12, defense: 4, kbResist: 0.2, ai: "fighter", speed: 110, drops: [{ id: 161, min: 2, max: 8, chance: 0.4 }], coins: coin(100) }),
  goblinThief: D({ name: "Goblin Thief", tex: "Images/NPC_27", frames: 16, fw: 40, fh: 56, w: 18, h: 40, life: 80, damage: 20, defense: 6, kbResist: 0.3, ai: "fighter", speed: 130, drops: [{ id: 160, min: 1, max: 1, chance: 0.05 }], coins: coin(200) }),
  goblinWarrior: D({ name: "Goblin Warrior", tex: "Images/NPC_28", frames: 16, fw: 40, fh: 56, w: 18, h: 40, life: 110, damage: 25, defense: 8, kbResist: 0.5, ai: "fighter", speed: 90, drops: [{ id: 161, min: 2, max: 8, chance: 0.4 }], coins: coin(250) }),
  zombieEskimo: D({ name: "Zombie Eskimo", tex: "Images/NPC_161", frames: 3, fw: 34, fh: 48, w: 18, h: 40, life: 50, damage: 16, defense: 8, kbResist: 0.5, ai: "fighter", speed: 60, night: true, drops: [], coins: coin(80) }),
  undeadViking: D({ name: "Undead Viking", tex: "Images/NPC_167", frames: 15, fw: 40, fh: 62, w: 18, h: 42, life: 70, damage: 28, defense: 12, kbResist: 0.5, ai: "fighter", speed: 90, drops: [], coins: coin(300) }),
  bloodZombie: D({ name: "Blood Zombie", tex: "Images/NPC_489", frames: 9, fw: 40, fh: 46, w: 18, h: 40, life: 90, damage: 26, defense: 10, kbResist: 0.5, ai: "fighter", speed: 85, night: true, drops: [], coins: coin(300) }),
  sporeZombie: D({ name: "Spore Zombie", tex: "Images/NPC_254", frames: 3, fw: 42, fh: 46, w: 18, h: 40, life: 70, damage: 24, defense: 10, kbResist: 0.5, ai: "fighter", speed: 70, drops: [{ id: 183, min: 2, max: 5, chance: 0.8 }], coins: coin(200) }),
  crab: D({ name: "Crab", tex: "Images/NPC_67", frames: 8, fw: 44, fh: 34, w: 24, h: 18, life: 40, damage: 20, defense: 10, kbResist: 0.3, ai: "fighter", speed: 50, drops: [], coins: coin(100) }),

  // ── Flyers ─────────────────────────────────────────────────────────────────────────────
  demonEye: D({ name: "Demon Eye", tex: "Images/NPC_2", frames: 2, fw: 38, fh: 24, w: 30, h: 18, life: 60, damage: 18, defense: 2, kbResist: 0.2, ai: "flyer", speed: 230, night: true, facesRight: true, drops: [{ id: 38, min: 1, max: 1, chance: 0.5 }], coins: coin(75) }),
  servant: D({ name: "Servant of Cthulhu", tex: "Images/NPC_5", frames: 2, fw: 20, fh: 32, w: 18, h: 18, life: 8, damage: 12, defense: 0, kbResist: 0, ai: "flyer", speed: 180, facesRight: true, drops: [] }),
  eaterOfSouls: D({ name: "Eater of Souls", tex: "Images/NPC_6", frames: 2, fw: 42, fh: 80, w: 30, h: 30, life: 70, damage: 22, defense: 8, kbResist: 0.2, ai: "flyer", speed: 200, drops: [{ id: 68, min: 1, max: 1, chance: 0.4 }], coins: coin(100) }),
  vulture: D({ name: "Vulture", tex: "Images/NPC_61", frames: 6, fw: 78, fh: 60, w: 30, h: 30, life: 40, damage: 15, defense: 4, kbResist: 0.2, ai: "flyer", speed: 180, day: true, drops: [{ id: 320, min: 1, max: 1, chance: 0.4 }], coins: coin(60) }),
  harpy: D({ name: "Harpy", tex: "Images/NPC_48", frames: 6, fw: 100, fh: 86, w: 30, h: 36, life: 100, damage: 25, defense: 8, kbResist: 0.3, ai: "flyer", speed: 200, drops: [{ id: 320, min: 1, max: 2, chance: 0.6 }], coins: coin(250), shoot: { kind: "feather", every: 2.2, speed: 380, damage: 16 } }),
  hornet: D({ name: "Hornet", tex: "Images/NPC_42", frames: 3, fw: 48, fh: 40, w: 30, h: 28, life: 90, damage: 26, defense: 12, kbResist: 0.2, ai: "flyer", speed: 160, drops: [{ id: 209, min: 1, max: 1, chance: 0.5 }], coins: coin(200), shoot: { kind: "stinger", every: 2, speed: 380, damage: 20 } }),
  demon: D({ name: "Demon", tex: "Images/NPC_62", frames: 5, fw: 86, fh: 62, w: 36, h: 36, life: 120, damage: 32, defense: 8, kbResist: 0.3, ai: "flyer", speed: 150, drops: [], coins: coin(300), shoot: { kind: "scythe", every: 2.8, speed: 220, damage: 30 } }),
  voodooDemon: D({ name: "Voodoo Demon", tex: "Images/NPC_66", frames: 5, fw: 86, fh: 88, w: 36, h: 36, life: 140, damage: 32, defense: 8, kbResist: 0.3, ai: "flyer", speed: 150, drops: [{ id: 267, min: 1, max: 1, chance: 1 }], coins: coin(500), shoot: { kind: "scythe", every: 3, speed: 220, damage: 30 } }),
  cursedSkull: D({ name: "Cursed Skull", tex: "Images/NPC_34", frames: 3, fw: 28, fh: 30, w: 24, h: 24, life: 60, damage: 35, defense: 6, kbResist: 0.4, ai: "flyer", speed: 150, drops: [], coins: coin(300) }),
  drippler: D({ name: "Drippler", tex: "Images/NPC_490", frames: 8, fw: 34, fh: 44, w: 26, h: 30, life: 80, damage: 30, defense: 6, kbResist: 0.4, ai: "flyer", speed: 90, night: true, drops: [], coins: coin(300) }),
  caveBat: D({ name: "Cave Bat", tex: "Images/NPC_49", frames: 4, fw: 44, fh: 40, w: 22, h: 18, life: 16, damage: 13, defense: 2, kbResist: 0.2, ai: "bat", speed: 220, drops: [], coins: coin(90) }),
  jungleBat: D({ name: "Jungle Bat", tex: "Images/NPC_51", frames: 4, fw: 44, fh: 40, w: 22, h: 18, life: 34, damage: 20, defense: 4, kbResist: 0.2, ai: "bat", speed: 240, drops: [], coins: coin(130) }),
  iceBat: D({ name: "Ice Bat", tex: "Images/NPC_150", frames: 4, fw: 52, fh: 48, w: 22, h: 18, life: 40, damage: 18, defense: 6, kbResist: 0.2, ai: "bat", speed: 230, drops: [], coins: coin(130) }),
  hellbat: D({ name: "Hellbat", tex: "Images/NPC_60", frames: 4, fw: 44, fh: 40, w: 22, h: 18, life: 35, damage: 35, defense: 8, kbResist: 0.2, ai: "bat", speed: 260, drops: [], coins: coin(200) }),
  bee: D({ name: "Bee", tex: "Images/NPC_210", frames: 4, fw: 16, fh: 18, w: 12, h: 12, life: 5, damage: 18, defense: 0, kbResist: 0, ai: "bat", speed: 280, drops: [] }),

  // ── Casters ────────────────────────────────────────────────────────────────────────────
  darkCaster: D({ name: "Dark Caster", tex: "Images/NPC_32", frames: 6, fw: 40, fh: 56, w: 18, h: 40, life: 80, damage: 20, defense: 4, kbResist: 0.6, ai: "caster", drops: [{ id: 165, min: 1, max: 1, chance: 0.03 }], coins: coin(300), shoot: { kind: "bolt", every: 2.5, speed: 260, damage: 26 } }),
  goblinSorcerer: D({ name: "Goblin Sorcerer", tex: "Images/NPC_29", frames: 3, fw: 40, fh: 56, w: 18, h: 40, life: 60, damage: 20, defense: 2, kbResist: 0.6, ai: "caster", drops: [], coins: coin(200), shoot: { kind: "chaos", every: 2.5, speed: 240, damage: 24 } }),
  fireImp: D({ name: "Fire Imp", tex: "Images/NPC_24", frames: 10, fw: 54, fh: 56, w: 18, h: 40, life: 70, damage: 30, defense: 16, kbResist: 0.5, ai: "caster", drops: [{ id: 193, min: 1, max: 1, chance: 0.03 }], coins: coin(300), shoot: { kind: "fireball", every: 2.4, speed: 260, damage: 30 } }),

  // ── Worms ──────────────────────────────────────────────────────────────────────────────
  devourerHead: D({ name: "Devourer", tex: "Images/NPC_7", frames: 1, fw: 30, fh: 48, w: 22, h: 22, life: 100, damage: 31, defense: 2, kbResist: 1, ai: "worm", speed: 300, worm: { body: "devourerBody", tail: "devourerTail", length: 8 }, drops: [{ id: 69, min: 1, max: 1, chance: 0.6 }], coins: coin(300) }),
  devourerBody: D({ name: "Devourer", tex: "Images/NPC_8", frames: 1, fw: 30, fh: 48, w: 22, h: 22, life: 100, damage: 18, defense: 6, kbResist: 1, ai: "wormBody", drops: [] }),
  devourerTail: D({ name: "Devourer", tex: "Images/NPC_9", frames: 1, fw: 30, fh: 48, w: 22, h: 22, life: 100, damage: 13, defense: 10, kbResist: 1, ai: "wormBody", drops: [] }),
  giantWormHead: D({ name: "Giant Worm", tex: "Images/NPC_10", frames: 1, fw: 18, fh: 30, w: 14, h: 14, life: 30, damage: 8, defense: 0, kbResist: 1, ai: "worm", speed: 220, worm: { body: "giantWormBody", tail: "giantWormTail", length: 6 }, drops: [], coins: coin(150) }),
  giantWormBody: D({ name: "Giant Worm", tex: "Images/NPC_11", frames: 1, fw: 18, fh: 30, w: 14, h: 14, life: 30, damage: 4, defense: 4, kbResist: 1, ai: "wormBody", drops: [] }),
  giantWormTail: D({ name: "Giant Worm", tex: "Images/NPC_12", frames: 1, fw: 18, fh: 30, w: 14, h: 14, life: 30, damage: 2, defense: 6, kbResist: 1, ai: "wormBody", drops: [] }),
  boneSerpentHead: D({ name: "Bone Serpent", tex: "Images/NPC_39", frames: 1, fw: 42, fh: 90, w: 30, h: 30, life: 200, damage: 30, defense: 10, kbResist: 1, ai: "worm", speed: 320, worm: { body: "boneSerpentBody", tail: "boneSerpentTail", length: 12 }, drops: [], coins: coin(500) }),
  boneSerpentBody: D({ name: "Bone Serpent", tex: "Images/NPC_40", frames: 1, fw: 42, fh: 90, w: 26, h: 26, life: 200, damage: 15, defense: 12, kbResist: 1, ai: "wormBody", drops: [] }),
  boneSerpentTail: D({ name: "Bone Serpent", tex: "Images/NPC_41", frames: 1, fw: 42, fh: 90, w: 26, h: 26, life: 200, damage: 10, defense: 18, kbResist: 1, ai: "wormBody", drops: [] }),

  // ── Plants, swimmers, ambushers ────────────────────────────────────────────────────────
  manEater: D({ name: "Man Eater", tex: "Images/NPC_43", frames: 2, fw: 52, fh: 54, w: 30, h: 30, life: 130, damage: 34, defense: 14, kbResist: 1, ai: "plant", drops: [{ id: 210, min: 1, max: 1, chance: 0.6 }], coins: coin(250) }),
  snatcher: D({ name: "Snatcher", tex: "Images/NPC_56", frames: 2, fw: 52, fh: 54, w: 30, h: 30, life: 60, damage: 25, defense: 10, kbResist: 1, ai: "plant", drops: [{ id: 210, min: 1, max: 1, chance: 0.4 }], coins: coin(150) }),
  shark: D({ name: "Shark", tex: "Images/NPC_65", frames: 4, fw: 120, fh: 48, w: 60, h: 24, life: 300, damage: 40, defense: 2, kbResist: 0.4, ai: "swimmer", speed: 220, drops: [], coins: coin(400) }),
  piranha: D({ name: "Piranha", tex: "Images/NPC_58", frames: 6, fw: 38, fh: 28, w: 22, h: 14, life: 30, damage: 25, defense: 2, kbResist: 0.4, ai: "swimmer", speed: 260, drops: [], coins: coin(50) }),
  pinkJellyfish: D({ name: "Pink Jellyfish", tex: "Images/NPC_64", frames: 7, fw: 56, fh: 46, w: 24, h: 24, life: 34, damage: 25, defense: 4, kbResist: 0.4, ai: "swimmer", speed: 90, drops: [], coins: coin(100) }),
  antlion: D({ name: "Antlion", tex: "Images/NPC_69", frames: 5, fw: 36, fh: 40, w: 24, h: 24, life: 45, damage: 10, defense: 6, kbResist: 1, ai: "antlion", drops: [{ id: 169, min: 3, max: 6, chance: 0.6 }], coins: coin(150), shoot: { kind: "sand", every: 2.2, speed: 380, damage: 14 } }),

  // ── Bosses ─────────────────────────────────────────────────────────────────────────────
  kingSlime: D({
    name: "King Slime",
    tex: "Images/NPC_50",
    frames: 6,
    fw: 174,
    fh: 120,
    w: 98,
    h: 92,
    life: 2000,
    damage: 40,
    defense: 10,
    kbResist: 1,
    ai: "boss",
    boss: true,
    drops: [
      { id: 23, min: 30, max: 50, chance: 1 },
      { id: 28, min: 2, max: 4, chance: 1 },
      { id: 29, min: 1, max: 1, chance: 1 },
      { id: 256, min: 1, max: 1, chance: 0.33 },
      { id: 257, min: 1, max: 1, chance: 0.33 },
      { id: 258, min: 1, max: 1, chance: 0.33 },
    ],
    coins: coin(10_000),
  }),
  eye: D({
    name: "Eye of Cthulhu",
    tex: "Images/NPC_4",
    frames: 6,
    fw: 110,
    fh: 166,
    w: 100,
    h: 100,
    life: 2800,
    damage: 15,
    defense: 12,
    kbResist: 1,
    ai: "boss",
    boss: true,
    facesRight: true,
    drops: [
      { id: 56, min: 30, max: 60, chance: 1 },
      { id: 47, min: 20, max: 50, chance: 1 },
      { id: 28, min: 3, max: 5, chance: 1 },
    ],
    coins: coin(30_000),
  }),
  eaterHead: D({ name: "Eater of Worlds", tex: "Images/NPC_13", frames: 1, fw: 46, fh: 90, w: 32, h: 32, life: 4000, damage: 22, defense: 2, kbResist: 1, ai: "boss", boss: true, worm: { body: "eaterBody", tail: "eaterTail", length: 22 }, drops: [{ id: 56, min: 40, max: 80, chance: 1 }, { id: 86, min: 20, max: 40, chance: 1 }, { id: 188, min: 3, max: 6, chance: 1 }], coins: coin(20_000) }),
  eaterBody: D({ name: "Eater of Worlds", tex: "Images/NPC_14", frames: 1, fw: 46, fh: 90, w: 30, h: 30, life: 4000, damage: 13, defense: 4, kbResist: 1, ai: "wormBody", drops: [] }),
  eaterTail: D({ name: "Eater of Worlds", tex: "Images/NPC_15", frames: 1, fw: 46, fh: 90, w: 30, h: 30, life: 4000, damage: 11, defense: 8, kbResist: 1, ai: "wormBody", drops: [] }),
  queenBee: D({
    name: "Queen Bee",
    tex: "Images/NPC_222",
    frames: 12,
    fw: 172,
    fh: 152,
    w: 100,
    h: 90,
    life: 3400,
    damage: 30,
    defense: 8,
    kbResist: 1,
    ai: "boss",
    boss: true,
    drops: [
      { id: 1123, min: 1, max: 1, chance: 0.5 },
      { id: 2431, min: 16, max: 26, chance: 1 },
      { id: 1124, min: 20, max: 40, chance: 1 },
      { id: 209, min: 5, max: 10, chance: 1 },
      { id: 188, min: 5, max: 15, chance: 1 },
    ],
    coins: coin(50_000),
  }),
  skeletron: D({ name: "Skeletron", tex: "Images/NPC_35", frames: 2, fw: 114, fh: 132, w: 80, h: 80, life: 4400, damage: 32, defense: 10, kbResist: 1, ai: "boss", boss: true, drops: [{ id: 1313, min: 1, max: 1, chance: 0.15 }, { id: 188, min: 5, max: 15, chance: 1 }, { id: 327, min: 1, max: 1, chance: 1 }], coins: coin(50_000) }),
  skeletronHand: D({ name: "Skeletron Hand", tex: "Images/NPC_36", frames: 2, fw: 58, fh: 78, w: 40, h: 40, life: 600, damage: 20, defense: 14, kbResist: 1, ai: "boss", drops: [] }),
  wallOfFlesh: D({
    name: "Wall of Flesh",
    tex: "Images/NPC_113",
    frames: 2,
    fw: 142,
    fh: 106,
    w: 120,
    h: 100,
    life: 8000,
    damage: 50,
    defense: 12,
    kbResist: 1,
    ai: "boss",
    boss: true,
    drops: [
      { id: 367, min: 1, max: 1, chance: 1 },
      { id: 426, min: 1, max: 1, chance: 0.33 },
      { id: 490, min: 1, max: 1, chance: 0.33 },
      { id: 188, min: 5, max: 15, chance: 1 },
    ],
    coins: coin(80_000),
  }),
  wallEye: D({ name: "Wall of Flesh", tex: "Images/NPC_114", frames: 2, fw: 130, fh: 106, w: 100, h: 90, life: 8000, damage: 50, defense: 0, kbResist: 1, ai: "boss", drops: [] }),
  hungry: D({ name: "The Hungry", tex: "Images/NPC_115", frames: 3, fw: 44, fh: 38, w: 30, h: 30, life: 240, damage: 30, defense: 10, kbResist: 0.5, ai: "boss", drops: [] }),
} satisfies Record<string, NpcDef>;

export type NpcKind = keyof typeof NPC_DATA;
export const NPCS: Record<NpcKind, NpcDef> = NPC_DATA;

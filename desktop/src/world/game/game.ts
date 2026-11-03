// The background-world game: the player, mining / chopping / building, furniture and chests,
// inventory and crafting, combat (swords, shortswords, bows), enemies spawning by biome, depth
// and time of day, two bosses, life crystals, day and night, death and respawn, and saving.
// Pure logic: the renderer and HUD read this state; input arrives through `input`.

import { T, WorldMap, type TreeKind, type Zone } from "../gen";
import { addItem, consumeAt, countOf, emptySlots, HOTBAR, INVENTORY_SIZE, removeItem, sanitizeSlots, type Slot } from "./inventory";
import { hitsToMine, item, STARTER_KIT, TILE_DROP, wallItem, type BuffId, type ItemDef } from "./items";
import { daylightAt, isNight } from "./lighting";
import { contactDamage, damageTo, defenseOf, isCritter, makeNpc, NPCS, ownerOf, stepNpc, type AiWorld, type Npc, type NpcKind, type ShotKind } from "./npcs";
import { ORB_LOOT } from "./loot";
import { rollChest, rollPot } from "./loot";
import { OBJECTS, ObjectLayer, type ObjectType, type WorldObject } from "./objects";
import { liquidAt, moveBox, overlaps, solidIn, TILE, type Box } from "./physics";

// Player movement (per second, Terraria-like: 3 px/tick run, 5.01 px/tick jump held 15 ticks).
export const PLAYER_W = 20;
export const PLAYER_H = 42;
const RUN = 180;
const ACCEL = 300;
const DECEL = 720;
const AIR_CONTROL = 0.6;
const JUMP_V = 300;
const JUMP_HOLD = 0.25;
const GRAVITY = 1440;
const MAX_FALL = 600;
const REACH_X = 6;
const REACH_Y = 5;
const IFRAMES = 0.67;
const MAX_LIFE = 400;
const POTION_SICKNESS = 45;
const SAVE_VERSION = 1;

/** "1g 20s 5c"-style coin text. */
export function coinText(copper: number): string {
  const parts: string[] = [];
  const p = Math.floor(copper / 1_000_000);
  const g = Math.floor((copper % 1_000_000) / 10_000);
  const s = Math.floor((copper % 10_000) / 100);
  const c = copper % 100;
  if (p) parts.push(`${p}p`);
  if (g) parts.push(`${g}g`);
  if (s) parts.push(`${s}s`);
  if (c || !parts.length) parts.push(`${c}c`);
  return parts.join(" ");
}

/** The wood each kind of tree gives. */
export const WOOD: Record<TreeKind, number> = { forest: 9, boreal: 2503, mahogany: 620, ebonwood: 619, palm: 2504, pearlwood: 621, shadewood: 911, mushroom: 183 };

export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
  /** Mouse in world pixels, and its buttons. */
  mouse: { x: number; y: number; left: boolean; right: boolean };
}

export const noInput = (): Input => ({ left: false, right: false, jump: false, down: false, mouse: { x: 0, y: 0, left: false, right: false } });

export interface Player extends Box {
  dir: -1 | 1;
  life: number;
  maxLife: number;
  iframes: number;
  sinceHurt: number;
  jumpT: number;
  /** Highest point of the current fall (px), for fall damage. */
  fallFrom: number | null;
  dead: number;
  /** The item being used, and how far through its use (0..1), and which swing it is. */
  use: { id: number; t: number; dur: number; swing: number; aim: number } | null;
  sickness: number;
  walk: number;
  spawn: { x: number; y: number };
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  knockback: number;
  pierce: number;
  age: number;
  /** Item drawn (arrows, bullets, the boomerang itself); magic bolts glow instead. */
  item: number;
  hit: Set<Npc>;
  gravity: number;
  /** Boomerangs fly back to whoever threw them. */
  returns?: boolean;
  magic?: boolean;
  owner: Fighter | null;
}

export interface Dropped extends Box {
  id: number;
  count: number;
  age: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

export type BossId = "kingSlime" | "eye" | "eater" | "queenBee" | "skeletron" | "wall";
export const BOSS_IDS: BossId[] = ["kingSlime", "eye", "eater", "queenBee", "skeletron", "wall"];
export const BOSS_NAMES: Record<BossId, string> = { kingSlime: "King Slime", eye: "Eye of Cthulhu", eater: "Eater of Worlds", queenBee: "Queen Bee", skeletron: "Skeletron", wall: "Wall of Flesh" };
const BOSS_OF: Partial<Record<NpcKind, BossId>> = { kingSlime: "kingSlime", eye: "eye", eaterHead: "eater", queenBee: "queenBee", skeletron: "skeletron", wallOfFlesh: "wall" };

export type EventKind = "bloodMoon" | "goblins" | "slimeRain";
export const EVENT_NAMES: Record<EventKind, string> = { bloodMoon: "Blood Moon", goblins: "Goblin Army", slimeRain: "Slime Rain" };

/** Anyone enemies fight: you, or the waifus playing on their own. */
export interface Fighter extends Box {
  life: number;
  maxLife: number;
  iframes: number;
  /** Seconds until respawn (0 = alive). */
  dead: number;
  /** Armour defence (agents; the player's comes from worn armour). */
  def?: number;
  name?: string;
}

/** An enemy's projectile. */
export interface Hostile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  kind: ShotKind;
  age: number;
  gravity: number;
}

export type BuffMap = Partial<Record<BuffId, number>>;

export interface Saved {
  version: number;
  seed: number;
  player: { x: number; y: number; life: number; maxLife: number; spawn: { x: number; y: number } };
  inventory: Slot[];
  armor: Slot[];
  hour: number;
  bosses: Partial<Record<BossId, boolean>>;
  house?: { x0: number; g: number } | null;
  coins?: number;
  hardmode?: boolean;
  orbs?: number;
  day?: number;
  meteor?: boolean;
  /** The waifus' adventure (adventure.ts), kept as given. */
  adventure?: unknown;
}

export class Game {
  player: Player;
  inventory: Slot[] = emptySlots(INVENTORY_SIZE);
  armor: Slot[] = emptySlots(3);
  cursor: Slot = null;
  selected = 0;
  npcs: Npc[] = [];
  projectiles: Projectile[] = [];
  drops: Dropped[] = [];
  texts: FloatText[] = [];
  messages: { text: string; age: number }[] = [];
  /** Hours (0–24); 1 real second = 1 game minute. */
  hour = 8;
  bosses: Record<BossId, boolean> = { kingSlime: false, eye: false, eater: false, queenBee: false, skeletron: false, wall: false };
  /** The purse (copper coins). */
  coins = 0;
  /** After the Wall of Flesh. */
  hardmode = false;
  /** Shadow orbs smashed (every third wakes the Eater of Worlds). */
  orbs = 0;
  /** Days passed (counted at dawn). */
  day = 0;
  /** When each felled tree came down (game day), for regrowth. */
  cutDay = new Map<number, number>();
  /** A meteorite has fallen (after the first orb). */
  meteor = false;
  pendingMeteor = false;
  /** The current invasion / event. */
  event: { kind: EventKind; left: number; total: number } | null = null;
  /** No monsters spawn (critters still do). */
  peaceful = false;
  hostile: Hostile[] = [];
  /** The player's potion buffs (seconds left). */
  buffs: BuffMap = {};
  /** The waifus' saved adventure state (adventure.ts reads and writes it). */
  adventureSave: unknown = null;
  /** Open chest (UI shows its slots). */
  chest: WorldObject | null = null;
  inventoryOpen = false;
  /** Digging progress per tile key, and when it was last hit. */
  digging = new Map<number, { dmg: number; t: number }>();
  /** Trees / cacti being chopped (column → damage). */
  chopping = new Map<number, number>();
  /** Bumped when tiles, objects or the inventory change (for saving / redraws). */
  version = 0;
  worldVersion = 0;
  /** "player": you play; "auto": the companions build on their own (peaceful, no player). */
  mode: "player" | "auto" = "player";
  /** The builders in auto mode (they collect drops instead of the player). */
  agents: Fighter[] = [];
  /** The house site the builders chose (saved so they keep building the same house). */
  house: { x0: number; g: number } | null = null;
  /** A shadow orb, larva or the like was smashed (beyond the built-in reactions). */
  onSmash: ((o: WorldObject) => void) | null = null;
  /** Columns where a felled tree must not grow back (inside the waifus' buildings). */
  keepCut: ((col: number) => boolean) | null = null;
  /** A waifu went down (the adventure respawns her at home). */
  onFighterDown: ((f: Fighter) => void) | null = null;
  /** A boss was defeated / an NPC killed by someone (for the adventure's progress). */
  onKill: ((kind: NpcKind, by: Fighter | null) => void) | null = null;
  /** Tiles changed since the renderer last looked (drained by the world layer). */
  changed: { x: number; y: number }[] = [];
  private spawnT = 0;
  private swingSeq = 0;
  private clock = 0;
  readonly rnd: () => number;

  constructor(
    readonly map: WorldMap,
    readonly objects: ObjectLayer,
    rnd: () => number = Math.random,
  ) {
    this.rnd = rnd;
    const spawn = this.spawnPoint();
    this.player = this.newPlayer(spawn);
    for (const [id, n] of STARTER_KIT) addItem(this.inventory, id, n);
  }

  // ── Setup & saving ───────────────────────────────────────────────────────────────────────

  spawnPoint(): { x: number; y: number } {
    const x = Math.floor(this.map.size.width / 2);
    let y = this.map.surface(x);
    while (y > 1 && this.map.standable(x, y - 1)) y--;
    return { x: x * TILE + TILE / 2, y: y * TILE };
  }

  private newPlayer(at: { x: number; y: number }): Player {
    return {
      x: at.x - PLAYER_W / 2,
      y: at.y - PLAYER_H - 1,
      w: PLAYER_W,
      h: PLAYER_H,
      vx: 0,
      vy: 0,
      onGround: false,
      dir: 1,
      life: 100,
      maxLife: 100,
      iframes: 0,
      sinceHurt: 99,
      jumpT: 0,
      fallFrom: null,
      dead: 0,
      use: null,
      sickness: 0,
      walk: 0,
      spawn: at,
    };
  }

  save(): Saved {
    const p = this.player;
    return {
      version: SAVE_VERSION,
      seed: this.map.seed,
      player: { x: p.x, y: p.y, life: Math.max(1, Math.round(p.life)), maxLife: p.maxLife, spawn: p.spawn },
      inventory: this.inventory,
      armor: this.armor,
      hour: this.hour,
      bosses: this.bosses,
      house: this.house,
      coins: this.coins,
      hardmode: this.hardmode,
      orbs: this.orbs,
      day: this.day,
      meteor: this.meteor,
      adventure: this.adventureSave,
    };
  }

  /** Restore saved progress (lenient: anything invalid is replaced by a fresh start). */
  load(raw: string | null | undefined) {
    if (!raw) return;
    let v: Partial<Saved>;
    try {
      v = JSON.parse(raw);
    } catch {
      return;
    }
    if (!v || v.seed !== this.map.seed) return; // another world: start fresh here
    const num = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? n : d);
    this.inventory = sanitizeSlots(v.inventory, INVENTORY_SIZE);
    this.armor = sanitizeSlots(v.armor, 3);
    this.hour = ((num(v.hour, 8) % 24) + 24) % 24;
    for (const b of BOSS_IDS) this.bosses[b] = !!v.bosses?.[b];
    this.coins = Math.max(0, Math.min(1e10, Math.floor(num(v.coins, 0))));
    this.hardmode = v.hardmode === true;
    this.orbs = Math.max(0, Math.min(999, Math.floor(num(v.orbs, 0))));
    this.day = Math.max(0, Math.floor(num(v.day, 0)));
    this.meteor = v.meteor === true;
    this.adventureSave = v.adventure ?? null;
    const h = v.house;
    this.house = h && Number.isInteger(h.x0) && Number.isInteger(h.g) && h.x0 > 0 && h.x0 < this.map.size.width - 20 ? { x0: h.x0, g: h.g } : null;
    const p = this.player;
    p.maxLife = Math.max(100, Math.min(MAX_LIFE, Math.round(num(v.player?.maxLife, 100) / 20) * 20));
    p.life = Math.max(1, Math.min(p.maxLife, num(v.player?.life, p.maxLife)));
    const sp = v.player?.spawn;
    if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.y)) p.spawn = { x: sp.x, y: sp.y };
    const x = num(v.player?.x, p.x);
    const y = num(v.player?.y, p.y);
    if (x > 0 && x < this.map.size.width * TILE && y > 0 && y < this.map.size.height * TILE && !solidIn(this.map, x, y, p.w, p.h)) {
      p.x = x;
      p.y = y;
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────────────────────

  get night() {
    return isNight(this.hour);
  }

  get daylight() {
    return daylightAt(this.hour);
  }

  get defense() {
    return this.armor.reduce((d, s) => d + (s ? (item(s.id)?.defense ?? 0) : 0), 0) + ((this.buffs.ironskin ?? 0) > 0 ? 8 : 0);
  }

  get held(): ItemDef | undefined {
    const s = this.inventory[this.selected];
    return s ? item(s.id) : undefined;
  }

  get playerCenter() {
    const p = this.player;
    return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  }

  /** Tile under the mouse, and whether it's within reach. */
  target(input: Input) {
    const tx = Math.floor(input.mouse.x / TILE);
    const ty = Math.floor(input.mouse.y / TILE);
    const c = this.playerCenter;
    const inReach = Math.abs(tx + 0.5 - c.x / TILE) <= REACH_X && Math.abs(ty + 0.5 - c.y / TILE) <= REACH_Y;
    return { tx, ty, inReach };
  }

  get bossAlive(): Npc | undefined {
    return this.npcs.find((n) => NPCS[n.kind].boss);
  }

  message(text: string) {
    this.messages.push({ text, age: 0 });
    if (this.messages.length > 5) this.messages.shift();
  }

  private float(x: number, y: number, text: string, color: string) {
    this.texts.push({ x, y, text, color, age: 0 });
    if (this.texts.length > 40) this.texts.shift();
  }

  // ── Update ───────────────────────────────────────────────────────────────────────────────

  update(dt: number, input: Input, view: { w: number; h: number }) {
    dt = Math.min(dt, 1 / 30);
    this.clock += dt;
    this.hour = (this.hour + dt / 60) % 24;
    const p = this.player;
    if (this.mode === "auto") {
      // The companions play; the player isn't in the world.
    } else if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) this.respawn();
    } else {
      this.updatePlayer(dt, input);
    }
    for (const k of Object.keys(this.buffs) as BuffId[]) {
      this.buffs[k] = (this.buffs[k] ?? 0) - dt;
      if ((this.buffs[k] ?? 0) <= 0) delete this.buffs[k];
    }
    this.updateEvents();
    this.updateNpcs(dt, view);
    this.updateProjectiles(dt);
    this.updateHostile(dt);
    this.updateDrops(dt);
    for (const t of this.texts) {
      t.age += dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.age < 1.2);
    for (const m of this.messages) m.age += dt;
    this.messages = this.messages.filter((m) => m.age < 6);
    // Old dig progress heals (like Terraria's cracks fading).
    for (const [k, d] of this.digging) if (this.clock - d.t > 3) this.digging.delete(k);
  }

  private updatePlayer(dt: number, input: Input) {
    const p = this.player;
    p.iframes = Math.max(0, p.iframes - dt);
    p.sinceHurt += dt;
    p.sickness = Math.max(0, p.sickness - dt);
    // Natural regeneration after a while without being hit.
    if (p.sinceHurt > 5 && p.life < p.maxLife) p.life = Math.min(p.maxLife, p.life + (p.sinceHurt > 15 ? 4 : 2) * dt);
    const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const control = p.onGround ? 1 : AIR_CONTROL;
    if (move !== 0) {
      p.vx += move * ACCEL * control * dt * (Math.sign(p.vx) === -move ? 2.5 : 1);
      p.vx = Math.max(-RUN, Math.min(RUN, p.vx));
      if (!p.use) p.dir = move as -1 | 1;
    } else if (p.onGround) {
      const s = Math.sign(p.vx);
      p.vx -= s * DECEL * dt;
      if (Math.sign(p.vx) !== s) p.vx = 0;
    }
    // Jump: hold for a higher jump.
    if (input.jump && p.onGround && p.jumpT <= 0) {
      p.vy = -JUMP_V;
      p.jumpT = JUMP_HOLD;
    }
    if (p.jumpT > 0) {
      if (input.jump && !solidIn(this.map, p.x, p.y - 2, p.w, 2)) {
        p.vy = -JUMP_V;
        p.jumpT -= dt;
      } else p.jumpT = 0;
    }
    // Swimming: jump strokes upward in water and lava.
    if (input.jump && !p.onGround && p.jumpT <= 0 && liquidAt(this.map, p)) p.vy = Math.max(-170, p.vy - 900 * dt);
    const wasGround = p.onGround;
    const r = moveBox(this.map, p, dt, { gravity: p.jumpT > 0 ? 0 : GRAVITY, maxFall: MAX_FALL, stepUp: true, dropThrough: input.down });
    if (r.liquid) p.fallFrom = null; // water breaks a fall
    // Lava burns.
    if (r.liquid === T.Lava && !this.buffs.obsidianskin) this.hurtPlayer(50, 0, "tried to swim in lava");
    if (p.onGround) p.walk += Math.abs(p.vx) * dt;
    // Fall damage past 25 tiles (10 per extra tile).
    if (!p.onGround && wasGround) p.fallFrom = p.y;
    if (!p.onGround && p.fallFrom !== null && p.vy < 0) p.fallFrom = Math.min(p.fallFrom, p.y);
    if (r.landed !== null && p.fallFrom !== null) {
      const tiles = (p.y - p.fallFrom) / TILE;
      if (tiles > 25) this.hurtPlayer(Math.round((tiles - 25) * 10), 0, "fell");
      p.fallFrom = null;
    }
    if (p.onGround) p.fallFrom = null;
    // Keep inside the world.
    p.x = Math.max(0, Math.min(this.map.size.width * TILE - p.w, p.x));
    if (p.y > this.map.size.height * TILE) this.hurtPlayer(9999, 0, "fell out of the world");
    // Using the held item.
    this.updateUse(dt, input);
    this.touchEnemies();
  }

  private updateUse(dt: number, input: Input) {
    const p = this.player;
    const c = this.playerCenter;
    if (p.use) {
      p.use.t += dt / p.use.dur;
      // A melee swing hits whatever the blade passes through, once per swing.
      const def = item(p.use.id);
      if (def && (def.kind === "sword" || def.kind === "shortsword" || def.kind === "pickaxe" || def.kind === "axe")) this.meleeHits(def);
      if (p.use.t >= 1) p.use = null;
    }
    if (input.mouse.right && !this.inventoryOpen) this.interact(input);
    if (!input.mouse.left || p.use || this.inventoryOpen || this.cursor) return;
    const s = this.inventory[this.selected];
    const def = s ? item(s.id) : undefined;
    if (!def) return;
    const aim = Math.atan2(input.mouse.y - c.y, input.mouse.x - c.x);
    p.dir = input.mouse.x < c.x ? -1 : 1;
    const begin = (dur: number) => (p.use = { id: def.id, t: 0, dur, swing: ++this.swingSeq, aim });
    const { tx, ty, inReach } = this.target(input);
    switch (def.kind) {
      case "pickaxe": {
        begin(def.useTime ?? 0.4);
        if (inReach) this.dig(tx, ty, def.power ?? 35);
        this.meleeHits(def);
        break;
      }
      case "axe": {
        begin(def.useTime ?? 0.4);
        if (inReach) this.chop(tx, ty, def.power ?? 35);
        this.meleeHits(def);
        break;
      }
      case "sword":
      case "shortsword":
      case "spear":
        begin(def.useTime ?? 0.4);
        this.meleeHits(def);
        break;
      case "hammer": {
        // Hammers knock out background walls.
        begin(def.useTime ?? 0.45);
        if (inReach && this.map.wall(tx, ty) && !this.map.standable(tx, ty)) this.hammerWall(tx, ty);
        this.meleeHits(def);
        break;
      }
      case "bow":
      case "gun":
      case "magic":
      case "boomerang": {
        if (!this.fire(def, c, aim, null)) {
          if (this.clock % 1 < dt) this.message(def.proj?.ammo === "bullet" ? "You need bullets." : "You need arrows.");
          return;
        }
        begin(def.useTime ?? 0.5);
        this.version++;
        break;
      }
      case "wall": {
        if (!inReach || def.wall === undefined) return;
        if (!this.map.standable(tx, ty) && this.map.setWall(tx, ty, def.wall)) {
          begin(0.12);
          consumeAt(this.inventory, this.selected);
          this.changed.push({ x: tx, y: ty });
          this.worldVersion++;
          this.version++;
        }
        break;
      }
      case "buff":
        begin(0.4);
        if (def.buff) {
          this.buffs[def.buff.id] = def.buff.seconds;
          consumeAt(this.inventory, this.selected);
          this.message(`${def.name.replace(" Potion", "")}!`);
          this.version++;
        }
        break;
      case "tool":
        if (def.id === 50) {
          begin(1);
          const sp = p.spawn;
          p.x = sp.x - p.w / 2;
          p.y = sp.y - p.h - 1;
          p.vx = 0;
          p.vy = 0;
        }
        break;
      case "block": {
        if (!inReach || def.tile === undefined) return;
        if (this.placeTile(tx, ty, def.tile)) {
          begin(0.15);
          consumeAt(this.inventory, this.selected);
          this.version++;
        }
        break;
      }
      case "furniture": {
        if (!inReach || !def.object) return;
        const o = OBJECTS[def.object as ObjectType];
        const x = tx;
        const y = ty - o.h + 1;
        if (this.boxBlocked(x, y, o.w, o.h)) return;
        if (this.objects.place(def.object as ObjectType, x, y, def.style ?? 0)) {
          begin(0.2);
          consumeAt(this.inventory, this.selected);
          this.worldVersion++;
          this.version++;
        }
        break;
      }
      case "potion":
        begin(0.4);
        this.drink(this.selected);
        break;
      case "upgrade":
        if (p.maxLife >= MAX_LIFE) {
          this.message("Your maximum life is as high as it goes.");
          begin(0.4);
          return;
        }
        begin(0.5);
        consumeAt(this.inventory, this.selected);
        p.maxLife += 20;
        p.life += 20;
        this.float(c.x, p.y, "+20 max life", "#ff6f8f");
        this.version++;
        break;
      case "summon":
        begin(1);
        if (this.summon(def.id, c)) consumeAt(this.inventory, this.selected);
        this.version++;
        break;
      default:
        break;
    }
  }

  /** Quick heal (H): the best potion that helps. */
  quickHeal() {
    const p = this.player;
    if (p.dead > 0 || p.life >= p.maxLife) return;
    let best = -1;
    let heal = 0;
    this.inventory.forEach((s, i) => {
      const h = s ? (item(s.id)?.heal ?? 0) : 0;
      if (h > heal) {
        heal = h;
        best = i;
      }
    });
    if (best >= 0) this.drink(best);
  }

  private drink(i: number) {
    const p = this.player;
    const s = this.inventory[i];
    const def = s ? item(s.id) : undefined;
    if (!def?.heal) return;
    if (p.sickness > 0) {
      this.message(`Potion sickness: ${Math.ceil(p.sickness)}s`);
      return;
    }
    consumeAt(this.inventory, i);
    p.life = Math.min(p.maxLife, p.life + def.heal);
    p.sickness = POTION_SICKNESS;
    this.float(p.x + p.w / 2, p.y, `+${def.heal}`, "#5cff7a");
    this.version++;
  }

  /** The boss a summoning item calls, and where it's allowed. */
  static readonly SUMMONS: Record<number, { kind: NpcKind; where?: Zone[]; night?: boolean; why: string }> = {
    560: { kind: "kingSlime", why: "" },
    43: { kind: "eye", night: true, why: "the Eye only comes at night" },
    70: { kind: "eaterHead", where: ["corruption"], why: "use it in the Corruption" },
    1133: { kind: "queenBee", where: ["jungle", "hive"], why: "use it in the Jungle" },
    267: { kind: "wallOfFlesh", where: ["underworld"], why: "throw it in the Underworld" },
  };

  /** Use a summoning item near a point (the player, or a waifu). True if the boss came. */
  summon(id: number, at: { x: number; y: number }): boolean {
    const s = Game.SUMMONS[id];
    if (!s) return false;
    if (this.bossAlive) {
      this.message("A boss is already here!");
      return false;
    }
    const zone = this.map.zone(Math.floor(at.x / TILE), Math.floor(at.y / TILE));
    if ((s.night && !this.night) || (s.where && !s.where.includes(zone))) {
      this.message(`Nothing happens... (${s.why})`);
      return false;
    }
    this.spawnBoss(s.kind, at);
    return true;
  }

  /** Bring a boss in near a point (summons, the third orb, the larva, the Old Man). */
  spawnBoss(kind: NpcKind, at: { x: number; y: number }) {
    const side = this.rnd() < 0.5 ? -1 : 1;
    const pos =
      kind === "wallOfFlesh"
        ? { x: at.x - (at.x < (this.map.size.width * TILE) / 2 ? 1 : -1) * 50 * TILE, y: at.y + 60 }
        : kind === "eaterHead"
          ? { x: at.x + side * 300, y: at.y + 500 }
          : kind === "kingSlime"
            ? { x: at.x + side * 400, y: at.y - 400 }
            : { x: at.x + side * 600, y: at.y - 300 };
    this.npcs.push(makeNpc(kind, pos.x, pos.y));
    this.message(`${NPCS[kind].name} has awoken!`);
  }

  /** Right-click: open / close a chest within reach. */
  private interact(input: Input) {
    const { tx, ty, inReach } = this.target(input);
    if (!inReach) return;
    const o = this.objects.at(tx, ty);
    if (o?.t === "chest") {
      this.chest = this.chest === o ? null : o;
      this.inventoryOpen = !!this.chest;
      input.mouse.right = false; // one toggle per click
    }
  }

  private boxBlocked(x: number, y: number, w: number, h: number) {
    const r = { x: x * TILE, y: y * TILE, w: w * TILE, h: h * TILE };
    return overlaps(this.player, r) || this.npcs.some((n) => overlaps(n, r));
  }

  /** Place a block where there's room and something to attach to. */
  placeTile(x: number, y: number, tile: number, byAgent = false): boolean {
    const m = this.map;
    if (m.standable(x, y) || this.objects.at(x, y)) return false;
    if (tile !== T.Platform && tile !== T.WoodBeam && !byAgent && this.boxBlocked(x, y, 1, 1)) return false;
    // Blocks attach to a neighbouring block, to a background wall, or anywhere underground.
    // (Beams count: a post goes up beam on beam.)
    const anchor = (ax: number, ay: number) => m.standable(ax, ay) || m.tile(ax, ay) === T.WoodBeam;
    const attach = anchor(x - 1, y) || anchor(x + 1, y) || anchor(x, y - 1) || anchor(x, y + 1) || m.wall(x, y) > 0 || y > m.surface(x) + 1;
    if (!attach) return false;
    if (!m.set(x, y, tile)) return false;
    this.changed.push({ x, y });
    this.worldVersion++;
    return true;
  }

  /** One pickaxe hit on a tile (or an object there). */
  dig(x: number, y: number, power: number): boolean {
    const m = this.map;
    const o = this.objects.at(x, y);
    if (o) return this.takeObject(o);
    const t = m.tile(x, y);
    if (t === T.Air) return false;
    // Can't dig the tile a tree stands on (chop the tree first), like Terraria.
    if (y === m.surface(x) && (m.tree(x) || m.cactus(x))) {
      this.message("Chop the tree down first.");
      return false;
    }
    const k = y * 65536 + x;
    const cur = this.digging.get(k) ?? { dmg: 0, t: 0 };
    cur.dmg += 1;
    cur.t = this.clock;
    const need = hitsToMine(t, power);
    if (cur.dmg < need) {
      this.digging.set(k, cur);
      return false;
    }
    this.digging.delete(k);
    m.set(x, y, T.Air);
    this.changed.push({ x, y });
    const drop = TILE_DROP[t];
    if (drop) this.dropItem(drop, 1, x * TILE + 8, y * TILE + 8);
    this.worldVersion++;
    // Furniture whose floor was dug away falls.
    for (const u of this.objects.unsupported({ x, y })) {
      if (OBJECTS[u.t].breakable) {
        this.takeObject(u);
        continue;
      }
      this.objects.remove(u);
      const d = OBJECTS[u.t];
      const id = d.drop(u.style ?? 0);
      if (id) this.dropItem(id, 1, (u.x + d.w / 2) * TILE, (u.y + d.h / 2) * TILE);
    }
    return true;
  }

  /** Roll a generated chest's loot the first time it's opened. */
  openChest(o: WorldObject) {
    if (o.loot && o.items) {
      o.items = rollChest(o.loot, this.map.seed, o.x, o.y, o.items.length);
      delete o.loot;
      this.worldVersion++;
    }
  }

  /** Pick up furniture, or smash a pot / shadow orb / larva (with what that brings). */
  takeObject(o: WorldObject): boolean {
    const d = OBJECTS[o.t];
    if (d.storage) this.openChest(o);
    if (!this.objects.remove(o)) {
      this.message("Empty the chest first.");
      return false;
    }
    const cx = (o.x + d.w / 2) * TILE;
    const cy = (o.y + d.h / 2) * TILE;
    if (o.t === "pot") for (const l of rollPot(this.map.seed, o.x, o.y, o.y > this.map.surface(o.x) + 60)) this.dropItem(l.id, l.count, cx, cy);
    else if (d.breakable) this.smashed(o);
    else {
      const id = d.drop(o.style ?? 0);
      if (id) this.dropItem(id, o.t === "glowshroom" ? 3 : 1, cx, cy);
    }
    this.worldVersion++;
    return true;
  }

  /** Dig progress (0..1) of a tile, for the crack overlay. */
  digProgress(x: number, y: number): number {
    const d = this.digging.get(y * 65536 + x);
    if (!d) return 0;
    return Math.min(1, d.dmg / hitsToMine(this.map.tile(x, y), this.held?.power ?? 35));
  }

  /** One axe hit on a tree or cactus at tile (x, y). */
  chop(x: number, y: number, power: number): boolean {
    const m = this.map;
    for (const col of [x, x - 1, x + 1]) {
      const tree = m.tree(col);
      const cactus = m.cactus(col);
      const h = tree || cactus;
      if (!h) continue;
      const ground = m.surface(col);
      // The click must be on the trunk (or the canopy near the top).
      if (!(y < ground && y >= ground - h - (tree ? 3 : 0)) || (col !== x && !tree)) continue;
      const dmg = (this.chopping.get(col) ?? 0) + power;
      if (dmg < 100) {
        this.chopping.set(col, dmg);
        return false;
      }
      this.chopping.delete(col);
      m.cut.add(col);
      this.cutDay.set(col, this.day);
      this.dropItem(tree ? WOOD[m.treeKind(col)] : 276, tree ? h + 2 + Math.floor(this.rnd() * 3) : h, col * TILE + 8, (ground - 2) * TILE);
      // (Trees drop an acorn now and then, for planting in a garden; giant mushrooms don't.)
      if (tree && m.treeKind(col) !== "mushroom" && this.rnd() < 0.6) this.dropItem(27, 1, col * TILE + 8, (ground - 2) * TILE);
      this.worldVersion++;
      return true;
    }
    return false;
  }

  // ── Combat ───────────────────────────────────────────────────────────────────────────────

  /** The area a melee swing covers right now (world px), for anyone swinging. */
  swingBox(def: ItemDef, who: Box = this.player, dir: number = this.player.dir, aim?: number) {
    const c = { x: who.x + who.w / 2, y: who.y + who.h / 2 };
    const reach = (def.reach ?? 32) * (def.kind === "shortsword" ? 1.1 : def.kind === "spear" ? 1 : 1.25);
    if (def.kind === "shortsword" || def.kind === "spear") {
      const a = aim ?? (dir > 0 ? 0 : Math.PI);
      const hx = c.x + Math.cos(a) * reach * 0.7;
      const hy = c.y + Math.sin(a) * reach * 0.7;
      return { x: hx - 14, y: hy - 10, w: 28, h: 20 };
    }
    return { x: dir > 0 ? c.x : c.x - reach, y: c.y - reach * 0.9, w: reach, h: reach * 1.6 };
  }

  private meleeHits(def: ItemDef) {
    if (!def.damage) return;
    const box = this.swingBox(def, this.player, this.player.dir, this.player.use?.aim);
    for (const n of this.npcs) if (n.alpha > 0.3 && !isCritter(n) && overlaps(box, n)) this.hitNpc(n, def.damage, def.knockback ?? 3, this.player.dir, this.swingSeq, null);
  }

  /** A waifu's melee swing (one hit per enemy per swing). Returns how many it hit. */
  agentMelee(a: Fighter, def: ItemDef, dir: -1 | 1, aim?: number): number {
    const box = this.swingBox(def, a, dir, aim);
    const swing = ++this.swingSeq;
    let hits = 0;
    for (const n of this.npcs)
      if (n.alpha > 0.3 && !isCritter(n) && overlaps(box, n)) {
        this.hitNpc(n, def.damage ?? 5, def.knockback ?? 3, dir, swing, a);
        hits++;
      }
    return hits;
  }

  /** Fire a ranged / magic weapon (taking ammo from the shared inventory). False if out of ammo. */
  fire(def: ItemDef, from: { x: number; y: number }, aim: number, by: Fighter | null): boolean {
    const pr = def.proj;
    if (!pr) return false;
    let dmg = def.damage ?? 5;
    let kb = def.knockback ?? 2;
    let tex = def.id;
    let pierce = pr.pierce ?? 1;
    if (pr.ammo) {
      const at = this.inventory.findIndex((s) => s && item(s.id)?.ammo === pr.ammo);
      if (at < 0) return false;
      const ammo = item(this.inventory[at]!.id)!;
      consumeAt(this.inventory, at);
      dmg += ammo.damage ?? 0;
      kb = Math.max(kb, ammo.knockback ?? 0);
      tex = ammo.id;
      if (ammo.id === 47) pierce = 3;
    }
    this.projectiles.push({ x: from.x, y: from.y - 6, vx: Math.cos(aim) * pr.speed, vy: Math.sin(aim) * pr.speed, damage: dmg, knockback: kb, pierce, age: 0, item: tex, hit: new Set(), gravity: pr.gravity ?? 0, returns: pr.returns, magic: def.kind === "magic", owner: by });
    return true;
  }

  /** Knock out a background wall (hammer), dropping its item. */
  hammerWall(x: number, y: number): boolean {
    const w = this.map.wall(x, y);
    if (!w || !this.map.setWall(x, y, 0)) return false;
    this.dropItem(wallItem(w), 1, x * TILE + 8, y * TILE + 8);
    this.changed.push({ x, y });
    this.worldVersion++;
    return true;
  }

  hitNpc(n: Npc, raw: number, kb: number, dir: -1 | 1, swing: number, by: Fighter | null = null) {
    if (n.lastSwing === swing && swing >= 0) return;
    n.lastSwing = swing;
    if (defenseOf(n) >= 999) return;
    const owner = ownerOf(n);
    const crit = this.rnd() < 0.04;
    const dmg = damageTo(raw, defenseOf(n), this.rnd, crit);
    owner.life -= dmg;
    n.hurt = 0.15;
    owner.hurt = 0.15;
    const resist = NPCS[n.kind].kbResist;
    if (resist < 1) {
      n.vx = dir * kb * 30 * (1 - resist);
      n.vy = Math.min(n.vy, -100 * (1 - resist));
    }
    this.float(n.x + n.w / 2, n.y, String(dmg), crit ? "#ff8a2a" : "#ffe14d");
    if (owner.life <= 0) this.kill(owner, by);
  }

  private kill(n: Npc, by: Fighter | null) {
    const d = NPCS[n.kind];
    // A worm or a boss goes with all its parts.
    this.npcs = this.npcs.filter((x) => x !== n && x.head !== n);
    for (const dr of d.drops) {
      if (this.rnd() > dr.chance) continue;
      const count = dr.min + Math.floor(this.rnd() * (dr.max - dr.min + 1));
      this.dropItem(dr.id, count, n.x + n.w / 2, n.y + n.h / 2);
    }
    if (d.coins) this.dropCoins(Math.round(d.coins * (0.8 + this.rnd() * 0.4)), n.x + n.w / 2, n.y + n.h / 2);
    const boss = BOSS_OF[n.kind];
    if (boss) {
      const first = !this.bosses[boss];
      this.bosses[boss] = true;
      this.message(`${BOSS_NAMES[boss]} has been defeated!`);
      if (n.kind === "eye") this.npcs = this.npcs.filter((x) => x.kind !== "servant");
      if (n.kind === "queenBee") this.npcs = this.npcs.filter((x) => x.kind !== "bee");
      if (n.kind === "wallOfFlesh" && first) {
        this.hardmode = true;
        this.message("The ancient spirits of light and dark have been released.");
      }
    }
    if (this.event && this.eventKind(n.kind) === this.event.kind) {
      this.event.left--;
      if (this.event.left <= 0) this.endEvent(true);
    }
    this.onKill?.(n.kind, by);
    this.version++;
  }

  /** Coins as the fewest coin items (they go straight to the purse when picked up). */
  dropCoins(copper: number, x: number, y: number) {
    const parts: [number, number][] = [
      [74, 1_000_000],
      [73, 10_000],
      [72, 100],
      [71, 1],
    ];
    for (const [id, v] of parts) {
      const n = Math.floor(copper / v);
      if (n > 0) this.dropItem(id, Math.min(999, n), x, y);
      copper -= n * v;
    }
  }

  hurtPlayer(raw: number, dir: number, cause = "") {
    const p = this.player;
    if (p.dead > 0 || p.iframes > 0) return;
    const dmg = Math.max(1, Math.round(raw - this.defense / 2));
    p.life -= dmg;
    p.iframes = IFRAMES;
    p.sinceHurt = 0;
    if (dir) {
      p.vx = dir * 180;
      p.vy = -200;
    }
    this.float(p.x + p.w / 2, p.y, String(dmg), "#ff4d4d");
    if (p.life <= 0) {
      p.life = 0;
      p.dead = 5;
      p.use = null;
      this.message(cause ? `You ${cause}...` : "You were slain...");
      // Bosses leave when you die.
      this.npcs = this.npcs.filter((n) => !NPCS[n.kind].boss && !n.head?.kind.match(/eaterHead|skeletron|wallOfFlesh/) && n.kind !== "servant");
    }
  }

  /** Hurt the player or a waifu. */
  hurtFighter(f: Fighter, raw: number, dir: number, cause = "") {
    if (f === (this.player as unknown as Fighter)) return this.hurtPlayer(raw, dir, cause);
    if (f.dead > 0 || f.iframes > 0) return;
    const dmg = Math.max(1, Math.round(raw - (f.def ?? 0) / 2));
    f.life -= dmg;
    f.iframes = IFRAMES;
    if (dir) {
      f.vx = dir * 180;
      f.vy = -200;
    }
    this.float(f.x + f.w / 2, f.y, String(dmg), "#ff7a9a");
    if (f.life <= 0) {
      f.life = 0;
      f.dead = 6;
      this.message(`${f.name ?? "A companion"} ${cause ? cause : "was knocked out"}... she'll be back home soon.`);
      this.onFighterDown?.(f);
    }
  }

  private respawn() {
    const p = this.player;
    const fresh = this.newPlayer(p.spawn);
    fresh.maxLife = p.maxLife;
    fresh.life = p.maxLife;
    this.player = fresh;
  }

  /** Who the enemies go after: you, or (when they play) the waifus who are up. */
  fighters(): Fighter[] {
    if (this.mode === "auto") return this.agents.filter((a) => a.dead <= 0);
    return this.player.dead > 0 ? [] : [this.player as unknown as Fighter];
  }

  private touchEnemies() {
    for (const f of this.fighters()) {
      if (f.iframes > 0) continue;
      for (const n of this.npcs) {
        if (n.alpha < 0.5 || !overlaps(f, n)) continue;
        const dmg = contactDamage(n);
        if (dmg <= 0) continue;
        this.hurtFighter(f, dmg, f.x + f.w / 2 < n.x + n.w / 2 ? -1 : 1);
        break;
      }
    }
  }

  // ── NPCs ─────────────────────────────────────────────────────────────────────────────────

  private aiWorld(): AiWorld {
    return {
      map: this.map,
      target: null,
      night: this.night,
      rnd: this.rnd,
      spawn: (kind, x, y) => {
        const n = makeNpc(kind, x, y);
        this.npcs.push(n);
        return n;
      },
      alive: (kind) => this.npcs.filter((n) => n.kind === kind).length,
      message: (t) => this.message(t),
      shoot: (from, kind, angle, speed, damage) => {
        const grav = kind === "sand" || kind === "spit" ? 600 : 0;
        this.hostile.push({ x: from.x + from.w / 2, y: from.y + from.h / 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage, kind, age: 0, gravity: grav });
      },
      worldWidth: this.map.size.width,
    };
  }

  private updateNpcs(dt: number, view: { w: number; h: number }) {
    const w = this.aiWorld();
    const fighters = this.fighters();
    const centers = fighters.map((f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 }));
    const nearest = (n: Npc) => {
      let best: { x: number; y: number } | null = null;
      let bd = Infinity;
      for (const c of centers) {
        const d = Math.abs(c.x - n.x) + Math.abs(c.y - n.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return { best, bd };
    };
    const list = [...this.npcs];
    const gone = new Set<Npc>();
    for (const n of list) {
      if (gone.has(n)) continue;
      const { best, bd } = nearest(n);
      w.target = best;
      const keep = stepNpc(n, w, dt);
      // Despawn far from everyone (bosses and their parts never; they leave on their own).
      const far = bd > 140 * TILE;
      const bossy = NPCS[n.kind].boss || (n.head && n.head !== n && NPCS[n.head.kind].boss);
      if (!keep || (!bossy && far && !(n.head && n.head !== n))) {
        gone.add(n);
        // A worm head leaving takes its body.
        for (const s of n.segs ?? []) gone.add(s);
      }
    }
    if (gone.size) this.npcs = this.npcs.filter((n) => !gone.has(n));
    // King Slime sheds slimes as he's hurt.
    for (const n of this.npcs) {
      if (n.kind !== "kingSlime") continue;
      const tenth = Math.floor((1 - n.life / NPCS.kingSlime.life) * 10);
      if (tenth > (n.shed ?? 0) && this.npcs.length < 30) {
        n.shed = tenth;
        for (let i = 0; i < 2; i++) this.npcs.push(makeNpc("blueSlime", n.x + n.w / 2 + (this.rnd() - 0.5) * 60, n.y + n.h));
      }
    }
    // The Wall of Flesh drags in anyone it passes.
    const wall = this.npcs.find((n) => n.kind === "wallOfFlesh");
    if (wall)
      for (const f of fighters) {
        const behind = wall.dir > 0 ? f.x + f.w < wall.x + wall.w / 2 : f.x > wall.x + wall.w / 2;
        if (behind) {
          this.hurtFighter(f, 60, wall.dir, "was consumed by the Wall of Flesh");
          f.x = wall.dir > 0 ? wall.x + wall.w + 4 : wall.x - f.w - 4;
        }
      }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && centers.length) {
      this.spawnT = this.event ? 0.35 : 0.7;
      const focus = fighters[Math.floor(this.rnd() * fighters.length)];
      this.trySpawn({ x: focus.x + focus.w / 2, y: focus.y + focus.h / 2 }, view);
    }
  }

  /** What may spawn around a point (zone, depth, time, events). Critters included. */
  spawnTable(at: { x: number; y: number } = this.playerCenter): NpcKind[] {
    const tx = Math.floor(at.x / TILE);
    const ty = Math.floor(at.y / TILE);
    const zone = this.map.zone(tx, ty);
    const night = this.night;
    const ev = this.event?.kind;
    if (ev === "goblins" && (zone === "forest" || zone === "snow" || zone === "desert" || zone === "jungle" || zone === "corruption" || zone === "ocean"))
      return ["goblinPeon", "goblinPeon", "goblinThief", "goblinWarrior", "goblinSorcerer"];
    if (ev === "slimeRain" && !night && ty < this.map.surface(tx) + 5) return ["greenSlime", "blueSlime", "purpleSlime", "blueSlime"];
    if (ev === "bloodMoon" && night && ty < this.map.surface(tx) + 5) return ["bloodZombie", "drippler", "zombie", "bloodZombie", "demonEye"];
    const inWater = this.map.liquid(tx, ty) === T.Water;
    switch (zone) {
      case "underworld":
        return ["fireImp", "hellbat", "hellbat", "lavaSlime", "demon", "voodooDemon", "boneSerpentHead"];
      case "dungeon":
        return this.bosses.skeletron ? ["angryBones", "angryBones", "darkCaster", "cursedSkull"] : [];
      case "hive":
        return ["hornet", "bee", "jungleBat", "spikedJungleSlime"];
      case "mushroom":
        return ["sporeZombie", "sporeZombie", "snail"];
      case "sky":
        return ["harpy", "harpy", "bird"];
      case "caverns":
        return ["skeleton", "undeadMiner", "caveBat", "motherSlime", "giantWormHead", "snail"];
      case "underground":
        return ["blueSlime", "caveBat", "giantWormHead", "worm", "skeleton", "snail"];
      case "snow":
        if (ty > this.map.surface(tx) + 25) return ["iceBat", "iceSlime", "undeadViking", "iceBat"];
        return night ? ["zombieEskimo", "zombieEskimo", "demonEye", "firefly"] : ["iceSlime", "iceSlime", "penguin", "penguin", "bunny"];
      case "desert":
        if (ty > this.map.surface(tx) + 25) return ["antlion", "sandSlime", "caveBat"];
        return night ? ["zombie", "demonEye", "scorpion"] : ["vulture", "sandSlime", "antlion", "scorpion", "scorpion"];
      case "jungle":
        if (ty > this.map.surface(tx) + 25) return ["hornet", "manEater", "jungleBat", "jungleSlime", "spikedJungleSlime"];
        return night ? ["zombie", "demonEye", "jungleSlime", "firefly", "frog"] : ["jungleSlime", "jungleSlime", "snatcher", "frog", "frog", "bird"];
      case "corruption":
        if (ty > this.map.surface(tx) + 25) return ["eaterOfSouls", "devourerHead", "caveBat"];
        return night ? ["eaterOfSouls", "zombie", "demonEye", "devourerHead"] : ["eaterOfSouls", "eaterOfSouls", "devourerHead"];
      case "ocean":
        if (inWater) return ["shark", "pinkJellyfish", "goldfish", "goldfish", "piranha"];
        return night ? ["zombie", "demonEye", "crab"] : ["crab", "crab", "duck", "bird", "greenSlime"];
      default:
        return night ? ["zombie", "zombie", "demonEye", "firefly", "bunny"] : ["greenSlime", "greenSlime", "blueSlime", "bunny", "bird", "squirrel", "butterfly", "grasshopper"];
    }
  }

  private eventKind(kind: NpcKind): EventKind | null {
    if (kind.startsWith("goblin")) return "goblins";
    if (kind === "bloodZombie" || kind === "drippler") return "bloodMoon";
    if (kind.endsWith("Slime") && this.event?.kind === "slimeRain") return "slimeRain";
    return null;
  }

  private trySpawn(at: { x: number; y: number }, view: { w: number; h: number }) {
    if (this.bossAlive && this.npcs.length > 12) return;
    const tx = Math.floor(at.x / TILE);
    const depth = at.y / TILE - this.map.surface(tx);
    const near = this.npcs.filter((n) => !NPCS[n.kind].boss && !n.head && Math.abs(n.x - at.x) < 70 * TILE && Math.abs(n.y - at.y) < 50 * TILE);
    const critters = near.filter((n) => isCritter(n)).length;
    const hostile = near.length - critters;
    // The waifus share one cap (four of them shouldn't mean four times the monsters).
    const solo = this.mode !== "auto";
    const cap = this.event ? 12 : solo ? (depth > 30 ? 6 : this.night ? 7 : 4) : depth > 30 ? 3 : this.night ? 4 : 2;
    if (!solo && this.npcs.filter((n) => !NPCS[n.kind].critter && !n.head).length >= (this.event ? 14 : 8)) return;
    const table = this.spawnTable(at).filter((k) => !this.peaceful || NPCS[k].critter);
    if (!table.length) return;
    const kind = table[Math.floor(this.rnd() * table.length)];
    const critter = !!NPCS[kind].critter;
    if (critter ? critters >= 4 : hostile >= cap) return;
    if (this.rnd() > (this.event ? 0.9 : this.night || depth > 30 ? 0.6 : 0.35)) return;
    const d = NPCS[kind];
    const flyer = d.ai === "flyer" || d.ai === "bat" || d.ai === "critterFly" || d.ai === "worm" || d.ai === "plant";
    const swimmer = d.ai === "swimmer" || d.ai === "critterSwim";
    const half = view.w / 2 / TILE + 6;
    const side = this.rnd() < 0.5 ? -1 : 1;
    const sx = Math.floor(at.x / TILE + side * (half + this.rnd() * 14));
    const sy0 = Math.floor(at.y / TILE);
    // Slime rain falls from the sky.
    if (this.event?.kind === "slimeRain" && kind.endsWith("Slime")) {
      this.npcs.push(makeNpc(kind, sx * TILE + 8, (this.map.surface(sx) - 30) * TILE));
      return;
    }
    for (let k = 0; k < 60; k++) {
      // Search outward from the target's height: 0, -1, +1, -2, +2, …
      const y = sy0 + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
      if (swimmer) {
        if (this.map.liquid(sx, y) === T.Water && this.map.liquid(sx, y - 1) === T.Water) {
          this.npcs.push(makeNpc(kind, sx * TILE + 8, (y + 1) * TILE));
          return;
        }
        continue;
      }
      const air = !this.map.standable(sx, y) && !this.map.standable(sx, y - 1) && !this.map.standable(sx, y - 2) && !this.map.liquid(sx, y);
      if (!air) continue;
      if (!flyer && !this.map.standable(sx, y + 1)) continue;
      // Surface creatures stay near the surface; cave ones in caves.
      if (depth <= 30 && y > this.map.surface(sx) + 6) continue;
      this.npcs.push(makeNpc(kind, sx * TILE + 8, (y + 1) * TILE));
      return;
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────────────────────

  private lastHour = 8;

  /** Dawn and dusk: blood moons, goblin invasions, slime rain, meteorites. */
  private updateEvents() {
    const h = this.hour;
    const crossed = (at: number) => this.lastHour < at && h >= at;
    if (crossed(4.5)) {
      this.day++;
      // Trees grow back (from the acorns they drop, so to speak) at the next dawn after felling.
      let regrew = false;
      for (const col of [...this.map.cut]) {
        // (Not inside something the waifus built: a tree there would undo the build.)
        if (this.keepCut?.(col)) continue;
        if ((this.cutDay.get(col) ?? -99) <= this.day - 1 && !this.map.solid(col, this.map.surface(col) - 1)) {
          this.map.cut.delete(col);
          this.cutDay.delete(col);
          regrew = true;
        }
      }
      if (regrew) this.worldVersion++;
      if (this.event?.kind === "bloodMoon") this.endEvent(true);
      // An invasion after the world has woken up a little (an orb broken or a boss down).
      if (!this.event && !this.peaceful && (this.orbs > 0 || this.bosses.eye) && this.rnd() < 0.2) this.startEvent("goblins", 40);
    }
    if (crossed(8) && !this.event && !this.peaceful && this.rnd() < 0.06) this.startEvent("slimeRain", 40);
    if (crossed(19.5)) {
      if (this.event?.kind === "slimeRain") this.endEvent(false);
      if (!this.event && !this.peaceful && this.day > 1 && this.rnd() < 1 / 9) this.startEvent("bloodMoon", 9999);
      if (this.pendingMeteor && !this.meteor) this.dropMeteor();
    }
    this.lastHour = h;
  }

  startEvent(kind: EventKind, total: number) {
    this.event = { kind, left: total, total };
    this.message(kind === "goblins" ? "A goblin army is approaching from the west!" : kind === "bloodMoon" ? "The Blood Moon is rising..." : "Slime is falling from the sky!");
  }

  private endEvent(won: boolean) {
    const ev = this.event;
    if (!ev) return;
    this.event = null;
    if (ev.kind === "goblins" && won) this.message("The goblin army has been defeated!");
    if (ev.kind === "slimeRain" && won && !this.bosses.kingSlime && !this.bossAlive) {
      const f = this.fighters()[0];
      if (f) this.spawnBoss("kingSlime", { x: f.x, y: f.y });
    }
  }

  /** A meteorite crashes somewhere in the forest (after the first shadow orb). */
  private dropMeteor() {
    this.pendingMeteor = false;
    this.meteor = true;
    const w = this.map.size.width;
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(w * (0.3 + this.rnd() * 0.4));
      if (this.map.biome(x) !== "forest") continue;
      if (Math.abs(x - w / 2) < 60) continue;
      const top = this.map.surface(x);
      for (let dx = -8; dx <= 8; dx++)
        for (let dy = -3; dy <= 6; dy++) {
          if (dx * dx + dy * dy * 2.5 > 70) continue;
          const tx = x + dx;
          const ty = top + dy;
          if (dy < 0) {
            if (this.map.set(tx, ty, T.Air)) this.changed.push({ x: tx, y: ty });
          } else if (this.map.set(tx, ty, T.Meteorite)) this.changed.push({ x: tx, y: ty });
        }
      this.worldVersion++;
      this.message("A meteorite has landed!");
      this.meteorAt = { x, y: top };
      return;
    }
  }

  meteorAt: { x: number; y: number } | null = null;

  /** Smashing a shadow orb, Queen Bee's larva… */
  private smashed(o: WorldObject) {
    const c = { x: (o.x + 1) * TILE, y: (o.y + 1) * TILE };
    if (o.t === "orb") {
      this.orbs++;
      this.dropItem(ORB_LOOT[(this.orbs - 1) % ORB_LOOT.length], 1, c.x, c.y);
      if (ORB_LOOT[(this.orbs - 1) % ORB_LOOT.length] === 96) this.dropItem(97, 100, c.x, c.y);
      this.message(this.orbs % 3 === 0 ? "" : "A horrible chill goes down your spine...");
      if (!this.meteor) this.pendingMeteor = true;
      if (this.orbs % 3 === 0 && !this.bossAlive) this.spawnBoss("eaterHead", c);
    } else if (o.t === "larva" && !this.bossAlive) this.spawnBoss("queenBee", c);
    this.onSmash?.(o);
  }

  // ── Projectiles ──────────────────────────────────────────────────────────────────────────

  private updateProjectiles(dt: number) {
    this.projectiles = this.projectiles.filter((pr) => {
      pr.age += dt;
      if (pr.returns) {
        // Boomerangs: out for a while, then home in on the thrower.
        const o = pr.owner ?? (this.player as unknown as Fighter);
        if (pr.age > 0.45) {
          const dx = o.x + o.w / 2 - pr.x;
          const dy = o.y + o.h / 2 - pr.y;
          const dist = Math.hypot(dx, dy) || 1;
          const sp = Math.max(400, Math.hypot(pr.vx, pr.vy));
          pr.vx = (dx / dist) * sp;
          pr.vy = (dy / dist) * sp;
          if (dist < 20) return false;
        }
      } else if (pr.age > 0.25) pr.vy += pr.gravity * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if ((!pr.returns && this.map.solid(Math.floor(pr.x / TILE), Math.floor(pr.y / TILE))) || pr.age > 4) return false;
      for (const n of this.npcs) {
        if (pr.hit.has(n) || n.alpha < 0.3 || isCritter(n)) continue;
        // A small hit box (not a single point), so near misses by a pixel still hit.
        const r = 6;
        if (pr.x + r > n.x && pr.x - r < n.x + n.w && pr.y + r > n.y && pr.y - r < n.y + n.h) {
          pr.hit.add(n);
          this.hitNpc(n, pr.damage, pr.knockback, pr.vx < 0 ? -1 : 1, -1, pr.owner);
          if (--pr.pierce <= 0) return false;
        }
      }
      return true;
    });
  }

  private updateHostile(dt: number) {
    const fighters = this.fighters();
    this.hostile = this.hostile.filter((h) => {
      h.age += dt;
      h.vy += h.gravity * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.age > 5 || (h.kind !== "laser" && h.kind !== "scythe" && this.map.solid(Math.floor(h.x / TILE), Math.floor(h.y / TILE)))) return false;
      for (const f of fighters) {
        if (h.x > f.x - 4 && h.x < f.x + f.w + 4 && h.y > f.y - 4 && h.y < f.y + f.h + 4) {
          this.hurtFighter(f, h.damage, h.vx < 0 ? -1 : 1);
          return false;
        }
      }
      return true;
    });
  }

  dropItem(id: number, count: number, x: number, y: number) {
    if (count <= 0) return;
    this.drops.push({ id, count, x: x - 6, y: y - 6, w: 12, h: 12, vx: (this.rnd() - 0.5) * 120, vy: -150, onGround: false, age: 0 });
  }

  private updateDrops(dt: number) {
    const p = this.player;
    // Who picks things up: you, or (building mode) the nearest companion. Items go to the shared
    // inventory either way.
    const collectors = this.mode === "auto" ? this.agents.map((a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 })) : p.dead <= 0 ? [this.playerCenter] : [];
    this.drops = this.drops.filter((d) => {
      d.age += dt;
      let c = collectors[0];
      let best = Infinity;
      for (const k of collectors) {
        const dd = Math.hypot(k.x - (d.x + 6), k.y - (d.y + 6));
        if (dd < best) {
          best = dd;
          c = k;
        }
      }
      const dx = c ? c.x - (d.x + 6) : 0;
      const dy = c ? c.y - (d.y + 6) : 0;
      const dist = c ? Math.hypot(dx, dy) : Infinity;
      if (c && dist < 5 * TILE && d.age > 0.4) {
        // Pulled toward the player.
        d.vx += (dx / dist) * 900 * dt;
        d.vy += (dy / dist) * 900 * dt;
        d.vx *= 0.92;
        d.vy *= 0.92;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (dist < 18) {
          const coin = item(d.id);
          if (coin?.kind === "coin") {
            this.coins += (coin.value ?? 0) * d.count;
            this.float(c.x, c.y - 24, coinText((coin.value ?? 0) * d.count), "#ffe27a");
            this.version++;
            return false;
          }
          const left = addItem(this.inventory, d.id, d.count);
          if (left < d.count) {
            this.float(c.x, c.y - 24, `${item(d.id)?.name ?? "Item"}${d.count - left > 1 ? ` (${d.count - left})` : ""}`, "#ffffff");
            this.version++;
          }
          d.count = left;
          return left > 0;
        }
      } else {
        moveBox(this.map, d, dt, { gravity: 900, maxFall: 400 });
        if (d.onGround) d.vx *= 0.8;
      }
      return d.age < 300;
    });
  }

  /** Move a whole stack from the inventory to the open chest or back (shift-click). */
  quickMove(fromChest: boolean, i: number) {
    const c = this.chest;
    if (!c?.items) return;
    const src = fromChest ? c.items : this.inventory;
    const dst = fromChest ? this.inventory : c.items;
    const s = src[i];
    if (!s) return;
    const left = addItem(dst, s.id, s.count);
    src[i] = left > 0 ? { id: s.id, count: left } : null;
    this.version++;
    this.worldVersion++;
  }

  /** Equip armour from the cursor or an inventory slot (swapping with what's worn). */
  equipFromCursor(slotIndex: number) {
    const want = (["head", "body", "legs"] as const)[slotIndex];
    if (this.cursor && item(this.cursor.id)?.slot !== want) return;
    const worn = this.armor[slotIndex];
    this.armor[slotIndex] = this.cursor;
    this.cursor = worn;
    this.version++;
  }

  get armorSheets(): [number | null, number | null, number | null] {
    return [0, 1, 2].map((i) => {
      const s = this.armor[i];
      return s ? (item(s.id)?.sheet ?? null) : null;
    }) as [number | null, number | null, number | null];
  }

  /** Total of an item in the inventory (HUD counters, recipes). */
  count(id: number) {
    return countOf(this.inventory, id);
  }

  /** Throw the cursor item out into the world (click outside the inventory). */
  dropCursor() {
    if (!this.cursor) return;
    const c = this.playerCenter;
    this.dropItem(this.cursor.id, this.cursor.count, c.x + this.player.dir * 24, c.y);
    this.drops[this.drops.length - 1].age = -1; // don't snap straight back
    this.cursor = null;
    this.version++;
  }

  removeFromInventory(id: number, n: number) {
    removeItem(this.inventory, id, n);
    this.version++;
  }

  hotbarStep(delta: number) {
    this.selected = (this.selected + delta + HOTBAR) % HOTBAR;
  }
}

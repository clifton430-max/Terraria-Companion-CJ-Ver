// Deterministic combat sandbox: training dummies, attacks, projectiles, minions, mana,
// damage numbers and effects. Pure data + functions; the same seed and inputs always
// produce the same result. It never moves the character — physics.ts does that.

import { SWING_RAISE_FRACTION } from "../engine/animation";
import type { Bounds, Dir } from "../engine/physics";
import { nextRandom, rollDamage } from "./damage";
import {
  center,
  handPosition,
  playerCenter,
  segmentHitsRect,
  type HandPose,
  type PlayerInfo,
  type Rect,
  type Vec,
} from "./geometry";
import {
  bossContactDamage,
  bossDefense,
  bossRect,
  circleHitsRect,
  isBossActive,
  servantCircle,
  bossCircle,
  spawnBoss,
  spawnServant,
  stepBoss,
  stepServant,
  SERVANT_LIFETIME,
  SERVANT_RADIUS,
  type Boss,
  type BossDifficulty,
  type Servant,
} from "./boss";
import { MOON_PARTS, partRect, spawnMoonLord, stepMoonLord, vulnerable, type MoonLord, type MoonPart } from "./moonlord";
import { BEE_LIFETIME, BEE_RADIUS, beeRect, isFighting as queenFighting, spawnQueenBee, stepBeeling, stepQueenBee, type Beeling, type QueenBee } from "./queenbee";
import { swordHits } from "./melee";
import { stepMinion, type Minion } from "./minions";
import { ballisticAngle, fractalPoint, moveProjectile, type Projectile, type ProjectileKind } from "./projectiles";
import { SHAPES } from "./weaponArt";
import { MINION_CAPACITY, getWeapon, manaCost, type WeaponDef, type WeaponKind } from "./weapons";

export const BASE_MANA = 100;
/** Mana per second once regeneration starts. */
export const MANA_REGEN = 14;
/** Seconds after spending mana before it regenerates. */
export const MANA_REGEN_DELAY = 0.9;
export const DUMMY_HP = 300;
export const DUMMY_DEFENSE = 0;
/** Seconds a defeated dummy stays down before standing back up at full health. */
export const DUMMY_RESPAWN = 2.5;
/** Dummy size in sprite pixels (scaled like the character). */
export const DUMMY_W = 16;
export const DUMMY_H = 24;
/** Dummy placement relative to the character, in sprite pixels. */
const DUMMY_OFFSETS = [90, 155, -110];

/** What a hittable target is: a training dummy, the Eye of Cthulhu, or one of its Servants. */
export type TargetKind = "dummy" | "boss" | "servant" | "moon" | "queen" | "bee";

export interface Dummy {
  id: number;
  /** Defaults to "dummy". Boss and Servant entries are driven by the boss AI and never respawn. */
  kind?: TargetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  defense: number;
  /** Seconds of hit flash remaining. */
  flash: number;
  /** Visual sway angle (radians) and its velocity, driven by knockback. */
  wobble: number;
  wobbleV: number;
  /** Seconds until it respawns; 0 while standing. */
  respawn: number;
}

/** Short-lived visuals. The sword slash trail is drawn from the attack itself. */
export type EffectKind = "muzzle" | "spark" | "puff" | "cast";

export interface Effect {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  t: number;
  duration: number;
  angle: number;
  color: string;
  size: number;
}

export interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  crit: boolean;
  t: number;
  duration: number;
}

export interface Attack {
  weaponId: string;
  kind: WeaponKind;
  /** Seconds since the attack started. */
  t: number;
  duration: number;
  dir: Dir;
  /** Aim in screen radians (0 = right, positive = down). */
  aim: number;
  /** When the projectile/minion is released (seconds into the attack). */
  releaseAt: number;
  fired: boolean;
  /** Dummies already struck by this sword swing. */
  hits: number[];
  /** Swing progress at the previous step, for swept melee hits. */
  prevProgress: number;
  /** Point being aimed at (target centre or cursor); channelled beams and skyfall use it. */
  aimPoint?: Vec;
  /** Seconds until the next channelled-beam damage tick. */
  tickTimer?: number;
}

/** The companion's own health during boss fights. */
export interface PlayerHealth {
  hp: number;
  maxHp: number;
  /** Invincibility seconds after being hit. */
  iframes: number;
  /** Seconds before natural regeneration resumes. */
  regenDelay: number;
  dead: boolean;
  /** Seconds until respawning after death. */
  respawn: number;
}

/** Things the overlay should react to (consumed and cleared by the companion each frame). */
export type CombatEvent =
  | { type: "playerHit"; amount: number; fromX: number }
  | { type: "playerSlain" }
  | { type: "playerRespawned" }
  | { type: "bossSummoned" }
  | { type: "bossDefeated" }
  | { type: "bossGone" }
  | { type: "message"; text: string; color: string };

export const PLAYER_MAX_HP = 500;
/** The companion's defence (an end-game-ish value for a character wielding these weapons). */
export const PLAYER_DEFENSE = 30;
/** Terraria's documented player defence factor per difficulty (damage − defence × factor). */
const DEFENSE_FACTOR: Record<BossDifficulty, number> = { easy: 0.5, normal: 0.5, expert: 0.75, master: 1 };

/** Damage the companion takes from a hit after defence (minimum 1). */
export function playerDamageTaken(raw: number, difficulty: BossDifficulty): number {
  return Math.max(1, Math.round(raw - PLAYER_DEFENSE * DEFENSE_FACTOR[difficulty]));
}
export const PLAYER_IFRAMES = 0.67;
export const PLAYER_REGEN = 6;
export const PLAYER_REGEN_DELAY = 4;
export const PLAYER_RESPAWN = 4;
/** Terraria's boss-announcement purple. */
export const BOSS_MESSAGE_COLOR = "#af4bff";

export interface CombatState {
  time: number;
  /** RNG state (mulberry32). */
  seed: number;
  nextId: number;
  mana: number;
  manaRegenDelay: number;
  /** Seconds until the next attack may start. */
  cooldown: number;
  attack: Attack | null;
  projectiles: Projectile[];
  effects: Effect[];
  texts: FloatText[];
  dummies: Dummy[];
  minions: Minion[];
  training: boolean;
  totalDamage: number;
  hitCount: number;
  /** The Eye of Cthulhu, if summoned; its hittable entry lives in `dummies` (kind "boss"). */
  boss: Boss | null;
  bossDummyId: number | null;
  /** Dismissed bosses flee even while the companion is alive. */
  bossDismissed: boolean;
  servants: { id: number; s: Servant }[];
  /** The Moon Lord, if summoned; each eye and the core is a hittable entry (kind "moon"). */
  moonLord: MoonLord | null;
  moonIds: Record<MoonPart, number> | null;
  moonDismissed: boolean;
  /** Queen Bee and her summoned bees (hittable entries of kind "queen" / "bee"). */
  queenBee: QueenBee | null;
  queenId: number | null;
  bees: { id: number; b: Beeling }[];
  queenDismissed: boolean;
  player: PlayerHealth;
  events: CombatEvent[];
}

export type AttackResult = { ok: true } | { ok: false; reason: "busy" | "cooldown" | "mana" };

export function createCombat(seed: number): CombatState {
  return {
    time: 0,
    seed: seed >>> 0,
    nextId: 1,
    mana: BASE_MANA,
    manaRegenDelay: 0,
    cooldown: 0,
    attack: null,
    projectiles: [],
    effects: [],
    texts: [],
    dummies: [],
    minions: [],
    training: false,
    totalDamage: 0,
    hitCount: 0,
    boss: null,
    bossDummyId: null,
    bossDismissed: false,
    servants: [],
    moonLord: null,
    moonIds: null,
    moonDismissed: false,
    queenBee: null,
    queenId: null,
    bees: [],
    queenDismissed: false,
    player: freshPlayer(),
    events: [],
  };
}

const freshPlayer = (): PlayerHealth => ({
  hp: PLAYER_MAX_HP,
  maxHp: PLAYER_MAX_HP,
  iframes: 0,
  regenDelay: 0,
  dead: false,
  respawn: 0,
});

const kindOf = (d: Dummy): TargetKind => d.kind ?? "dummy";
const trainingDummies = (state: CombatState) => state.dummies.filter((d) => kindOf(d) === "dummy");
const nonTrainingTargets = (state: CombatState) => state.dummies.filter((d) => kindOf(d) !== "dummy");

function random(state: CombatState): number {
  const [value, next] = nextRandom(state.seed);
  state.seed = next;
  return value;
}

const newId = (state: CombatState) => state.nextId++;

/** Maximum mana after reserving each active minion's upkeep. */
export function maxMana(state: CombatState): number {
  let reserved = 0;
  for (const m of state.minions) {
    const def = getWeapon(m.weaponId);
    if (def?.kind === "summon") reserved += def.upkeep;
  }
  return Math.max(0, BASE_MANA - reserved);
}

/** Everything that can currently be hit: standing dummies, the boss and its Servants. */
export const aliveDummies = (state: CombatState) => state.dummies.filter((d) => d.respawn <= 0 && d.hp > 0);

export const rectOf = (d: Dummy): Rect => ({ x: d.x, y: d.y, w: d.w, h: d.h });

/** Lay out training dummies on the floor near the character, inside the screen. */
export function placeDummies(state: CombatState, bounds: Bounds, ownerCenterX: number, scale: number): Dummy[] {
  const w = DUMMY_W * scale;
  const h = DUMMY_H * scale;
  const minX = 8;
  const maxX = Math.max(minX, bounds.width - w - 8);
  const placed: Dummy[] = [];
  for (const offset of DUMMY_OFFSETS) {
    const candidates = [offset, -offset].map((o) => ownerCenterX + o * scale - w / 2);
    let x = Math.min(Math.max(candidates[0], minX), maxX);
    const clashes = (cx: number) => placed.some((d) => Math.abs(d.x - cx) < w * 1.5);
    if (clashes(x)) x = Math.min(Math.max(candidates[1], minX), maxX);
    placed.push({
      id: newId(state),
      x,
      y: bounds.height - h,
      w,
      h,
      hp: DUMMY_HP,
      maxHp: DUMMY_HP,
      defense: DUMMY_DEFENSE,
      flash: 0,
      wobble: 0,
      wobbleV: 0,
      respawn: 0,
    });
  }
  return placed;
}

/** Restore the scenario: fresh dummies (if training), no projectiles/minions, full mana. */
export function resetTraining(state: CombatState, bounds: Bounds, ownerCenterX: number, scale: number) {
  state.projectiles = [];
  state.effects = [];
  state.texts = [];
  state.minions = [];
  state.attack = null;
  state.cooldown = 0;
  state.mana = BASE_MANA;
  state.manaRegenDelay = 0;
  state.totalDamage = 0;
  state.hitCount = 0;
  state.dummies = [...nonTrainingTargets(state), ...(state.training ? placeDummies(state, bounds, ownerCenterX, scale) : [])];
}

export function setTraining(
  state: CombatState,
  on: boolean,
  bounds: Bounds,
  ownerCenterX: number,
  scale: number,
) {
  if (state.training === on) return;
  state.training = on;
  state.dummies = [...nonTrainingTargets(state), ...(on ? placeDummies(state, bounds, ownerCenterX, scale) : [])];
  if (!on && !state.boss) state.projectiles = [];
}

export function dismissMinions(state: CombatState) {
  for (const m of state.minions) spawnEffect(state, "puff", m.x, m.y, 0, "#cfe9ff", 10, 0.35);
  state.minions = [];
}

/** Keep dummies on the floor and inside the screen after a resize or scale change. */
export function fitDummies(state: CombatState, bounds: Bounds, scale: number) {
  for (const d of trainingDummies(state)) {
    const cx = d.x + d.w / 2;
    d.w = DUMMY_W * scale;
    d.h = DUMMY_H * scale;
    d.x = Math.min(Math.max(cx - d.w / 2, 0), Math.max(0, bounds.width - d.w));
    d.y = bounds.height - d.h;
  }
}

/** Whether `def` could be used right now (ignoring range/aim). */
export function canAttack(state: CombatState, def: WeaponDef): AttackResult {
  if (state.attack) return { ok: false, reason: "busy" };
  if (state.cooldown > 0) return { ok: false, reason: "cooldown" };
  if (manaCost(def) > state.mana) return { ok: false, reason: "mana" };
  return { ok: true };
}

function releaseTime(def: WeaponDef): number {
  switch (def.kind) {
    case "bow":
      return def.drawTime;
    case "staff":
    case "summon":
      return def.castTime;
    default:
      return 0;
  }
}

/** Arm pose for an attack kind; also selects the character's attack animation. */
export function attackPose(kind: WeaponKind, progress = 0): HandPose {
  if (kind === "staff" || kind === "summon") return "raise";
  if (kind === "sword") return progress < SWING_RAISE_FRACTION ? "raise" : "point";
  return "point";
}

/**
 * Start an attack with `def`. `aim` defaults to straight ahead. Spends mana up front;
 * the projectile, minion or blade damage happens in `stepCombat`.
 */
export function tryAttack(
  state: CombatState,
  def: WeaponDef,
  player: PlayerInfo,
  dir: Dir = player.facing,
  aim?: number,
  aimPoint?: Vec,
): AttackResult {
  const check = canAttack(state, def);
  if (!check.ok) {
    if (check.reason === "mana" && !state.texts.some((t) => t.text === "Low mana")) {
      const c = playerCenter(player);
      spawnText(state, c.x, player.y - 6, "Low mana", "#6bb8ff", false);
    }
    return check;
  }
  const cost = manaCost(def);
  if (cost > 0) {
    state.mana -= cost;
    state.manaRegenDelay = MANA_REGEN_DELAY;
  }
  state.attack = {
    weaponId: def.id,
    kind: def.kind,
    t: 0,
    duration: def.kind === "staff" && def.channel ? def.channel.duration : def.useTime,
    dir,
    aim: aim ?? (dir > 0 ? 0 : Math.PI),
    releaseAt: releaseTime(def),
    fired: false,
    hits: [],
    prevProgress: 0,
    aimPoint,
    tickTimer: 0,
  };
  state.cooldown = def.useTime;
  return { ok: true };
}

/**
 * A melee strike from outside the weapon system (the Silksong Needle): damage every standing target
 * overlapping `rect` that isn't in `exclude`. Returns the ids hit (each gets the usual numbers,
 * flash and sparks, and the boss fight sees the damage).
 */
export function meleeStrike(state: CombatState, def: WeaponDef, rect: Rect, dir: Dir, exclude: readonly number[] = []): number[] {
  const hit: number[] = [];
  for (const d of aliveDummies(state)) {
    if (exclude.includes(d.id)) continue;
    const r = rectOf(d);
    if (r.x > rect.x + rect.w || r.x + r.w < rect.x || r.y > rect.y + rect.h || r.y + r.h < rect.y) continue;
    hitDummy(state, d, def, dir, center(r));
    hit.push(d.id);
  }
  return hit;
}

/**
 * An autonomous companion's attack (the other characters on screen): hits the same targets
 * through the same projectiles and damage rules, but doesn't use the player's attack slot. The
 * caller keeps its own cooldown (the weapon's use time). Returns the ids hit by a melee strike.
 */
export function assistAttack(state: CombatState, def: WeaponDef, from: Vec, dir: Dir, aim: number, scale: number): number[] {
  switch (def.kind) {
    case "sword": {
      const reach = Math.max(18, def.fractal ? 60 : def.reach) * scale;
      const rect = { x: dir > 0 ? from.x : from.x - reach, y: from.y - reach * 0.6, w: reach, h: reach * 1.2 };
      const ids = meleeStrike(state, def, rect, dir);
      spawnEffect(state, "spark", from.x + dir * reach * 0.6, from.y, 0, "#ffffff", 5, 0.15);
      if (def.beam) {
        spawnProjectile(state, { ...def, damage: Math.round(def.damage * def.beam.damageMul) }, "beam", from, aim, def.beam.speed, {
          pierce: def.beam.pierce,
          ttl: def.beam.ttl,
          radius: 8,
          color: def.beam.color,
          art: def.beam.art,
        });
      }
      return ids;
    }
    case "bow":
      spawnProjectile(state, def, "arrow", from, aim, def.arrowSpeed, { gravity: def.arrowGravity, pierce: def.pierce, ttl: 2.5, radius: 3, color: "#c9a46a", art: def.projectileArt });
      return [];
    case "gun":
      for (let i = 0; i < def.pellets; i++) {
        const offset = (random(state) - 0.5) * def.spread * 2;
        spawnProjectile(state, def, "bullet", from, aim + offset, def.bulletSpeed, { ttl: 1.2, radius: 2, color: "#ffe9a0", art: def.projectileArt });
      }
      return [];
    case "staff":
    case "summon": {
      const color = def.kind === "staff" ? def.boltColor : (def.minion.palette.c ?? "#9fe6ff");
      const speed = def.kind === "staff" && def.boltSpeed > 0 ? def.boltSpeed : 700;
      spawnProjectile(state, def, "bolt", from, aim, speed, { homing: def.kind === "staff" ? Math.max(def.homing, 1.5) : 3, pierce: 1, ttl: 2, radius: 4, color });
      return [];
    }
  }
}

/** Stop the current attack at once (e.g. the character was grabbed); the cooldown still runs. */
export function cancelAttack(state: CombatState) {
  state.attack = null;
}

function spawnEffect(
  state: CombatState,
  kind: EffectKind,
  x: number,
  y: number,
  angle: number,
  color: string,
  size: number,
  duration: number,
) {
  state.effects.push({ id: newId(state), kind, x, y, t: 0, duration, angle, color, size });
}

function spawnText(state: CombatState, x: number, y: number, text: string, color: string, crit: boolean) {
  state.texts.push({ id: newId(state), x, y, text, color, crit, t: 0, duration: crit ? 1.1 : 0.9 });
}

/** Apply one hit to a target: roll damage, flash, sway, float a number, maybe defeat it. */
function hitDummy(state: CombatState, dummy: Dummy, def: WeaponDef, dir: number, at: Vec) {
  const roll = rollDamage(def.damage, dummy.defense, def.crit, random(state), random(state));
  dummy.hp = Math.max(0, dummy.hp - roll.amount);
  dummy.flash = 0.12;
  if (kindOf(dummy) === "dummy") dummy.wobbleV += dir * def.knockback * 0.9;
  state.totalDamage += roll.amount;
  state.hitCount++;
  const jitter = (random(state) - 0.5) * dummy.w * 0.5;
  spawnText(
    state,
    dummy.x + dummy.w / 2 + jitter,
    dummy.y - 4,
    `${roll.amount}`,
    roll.crit ? "#ff5a4a" : "#ffb347",
    roll.crit,
  );
  spawnEffect(state, "spark", at.x, at.y, 0, "#fff3c4", 6, 0.2);
  if (dummy.hp <= 0) {
    const kind = kindOf(dummy);
    // Training dummies stand back up; Servants and the boss are handled by the boss fight.
    if (kind === "dummy") dummy.respawn = DUMMY_RESPAWN;
    const puff = kind === "dummy" ? "#d8c39a" : "#b02a2a";
    spawnEffect(state, "puff", dummy.x + dummy.w / 2, dummy.y + dummy.h / 2, 0, puff, dummy.w * 0.7, 0.5);
  }
}

function nearestDummy(state: CombatState, from: Vec, maxDist: number, exclude: readonly number[] = []): Dummy | null {
  let best: Dummy | null = null;
  let bestD = maxDist;
  for (const d of aliveDummies(state)) {
    if (exclude.includes(d.id)) continue;
    const c = center(rectOf(d));
    const dist = Math.hypot(c.x - from.x, c.y - from.y);
    if (dist < bestD) {
      best = d;
      bestD = dist;
    }
  }
  return best;
}

/**
 * Weapon tip (muzzle, gem) in CSS px when the art is drawn at the hand rotated by
 * `rotation` in right-facing space and mirrored for `dir` — the same transform render.ts uses.
 */
export function weaponTip(def: WeaponDef, hand: Vec, rotation: number, dir: Dir, scale: number): Vec {
  const shape = SHAPES[def.shape];
  const grip = def.art ? { x: def.art.grip[0], y: def.art.grip[1] } : shape.grip;
  const tip = def.art ? { x: def.art.tip[0], y: def.art.tip[1] } : shape.tip;
  const ox = (tip.x - grip.x) * scale;
  const oy = (tip.y - grip.y) * scale;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { x: hand.x + dir * (ox * c - oy * s), y: hand.y + ox * s + oy * c };
}

/**
 * CSS px per weapon-art pixel. Real Terraria item textures are drawn at the character's art scale
 * (they share Terraria's pixel size); the original 16×16 shapes use the companion scale.
 */
export function weaponScale(def: WeaponDef, player: PlayerInfo): number {
  if (!def.art) return player.scale;
  return player.rig?.scale ?? Math.max(1, Math.round((player.scale * 2) / 3));
}

/** Aim angle in right-facing space (mirrors left-facing aims). */
const localAim = (aim: number, dir: Dir) => (dir > 0 ? aim : Math.PI - aim);

function spawnProjectile(
  state: CombatState,
  def: WeaponDef,
  kind: ProjectileKind,
  from: Vec,
  angle: number,
  speed: number,
  extra: Partial<Projectile>,
) {
  state.projectiles.push({
    id: newId(state),
    kind,
    weaponId: def.id,
    x: from.x,
    y: from.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    gravity: 0,
    damage: def.damage,
    knockback: def.knockback,
    crit: def.crit,
    pierce: 0,
    hits: [],
    ttl: 3,
    radius: 3,
    homing: 0,
    color: "#ffffff",
    ...extra,
  });
}

/** Release the attack's payload: arrow, bullets, bolt or minion. */
function release(state: CombatState, def: WeaponDef, attack: Attack, player: PlayerInfo) {
  const hand = handPosition(player, attackPose(def.kind, 1), attack.dir);
  switch (def.kind) {
    case "bow": {
      if (def.skyfall) {
        // Arrows rain onto the target from high above (Daedalus Stormbow).
        const tp = attack.aimPoint ?? { x: hand.x + Math.cos(attack.aim) * 320, y: hand.y + Math.sin(attack.aim) * 320 };
        const n = def.skyfall.count + Math.floor(random(state) * (def.skyfall.extraRandom + 1));
        for (let i = 0; i < n; i++) {
          const sx = tp.x + (random(state) - 0.5) * 2 * def.skyfall.spread;
          const sy = Math.max(-200, tp.y - def.skyfall.height - random(state) * 80);
          const angle = Math.atan2(tp.y + (random(state) - 0.5) * 30 - sy, tp.x - sx);
          spawnProjectile(state, def, "arrow", { x: sx, y: sy }, angle, def.arrowSpeed, {
            gravity: def.arrowGravity,
            pierce: def.pierce,
            ttl: 2.5,
            radius: 3,
            color: "#ff9ad8",
            art: def.projectileArt,
          });
        }
        spawnEffect(state, "cast", hand.x, hand.y, 0, "#ff9ad8", 4 * player.scale, 0.2);
        break;
      }
      spawnProjectile(state, def, "arrow", hand, attack.aim, def.arrowSpeed, {
        gravity: def.arrowGravity,
        pierce: def.pierce,
        ttl: 4,
        radius: 3,
        color: "#e8d9b0",
        art: def.projectileArt,
      });
      break;
    }
    case "gun": {
      const muzzle = weaponTip(def, hand, localAim(attack.aim, attack.dir), attack.dir, weaponScale(def, player));
      for (let i = 0; i < def.pellets; i++) {
        const offset =
          def.pellets > 1 ? def.spread * (i / (def.pellets - 1) - 0.5) : def.spread * (random(state) - 0.5);
        const ex = def.explosive;
        const color = ex ? ex.colors[Math.floor(random(state) * ex.colors.length) % ex.colors.length] : "#ffe9a0";
        spawnProjectile(state, def, "bullet", muzzle, attack.aim + offset, def.bulletSpeed, {
          ttl: ex ? 1.6 : 1.2,
          radius: ex ? 4 : 2,
          color,
          art: def.projectileArt,
          explosive: ex ? { radius: ex.radius, damage: Math.round(def.damage * ex.damageMul), color } : undefined,
        });
      }
      spawnEffect(state, "muzzle", muzzle.x, muzzle.y, attack.aim, "#fff1a8", 6 * player.scale, 0.07);
      break;
    }
    case "staff": {
      const tip = weaponTip(def, hand, 0, attack.dir, weaponScale(def, player));
      if (def.silkSpin) {
        // The Thread: a whirl of silk hitting everything around the caster.
        const c = playerCenter(player);
        const r = def.silkSpin.radius * weaponScale(def, player);
        for (const d of aliveDummies(state)) {
          const dc = center(rectOf(d));
          if (Math.hypot(dc.x - c.x, dc.y - c.y) <= r + Math.max(d.w, d.h) / 2) hitDummy(state, d, def, dc.x >= c.x ? 1 : -1, dc);
        }
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          spawnEffect(state, "spark", c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, a, k % 2 ? "#d02a3a" : "#ffe4ee", 5, 0.35);
        }
        spawnEffect(state, "cast", c.x, c.y, 0, "#ffe4ee", r, 0.35);
        break;
      }
      if (def.channel) {
        // Channelled beam: damage is applied every tick in stepAttack.
        spawnEffect(state, "cast", tip.x, tip.y, 0, "#ffffff", 5 * player.scale, 0.25);
        break;
      }
      spawnProjectile(state, def, "bolt", tip, attack.aim, def.boltSpeed, {
        homing: def.homing,
        pierce: def.pierce,
        ttl: 3,
        radius: 5,
        color: def.boltColor,
      });
      spawnEffect(state, "cast", tip.x, tip.y, 0, def.boltColor, 5 * player.scale, 0.25);
      break;
    }
    case "summon": {
      if (state.minions.length >= MINION_CAPACITY) state.minions.shift();
      state.minions.push({
        id: newId(state),
        weaponId: def.id,
        x: hand.x,
        y: hand.y,
        vx: 0,
        vy: -120,
        targetId: null,
        hitCooldowns: {},
        age: 0,
      });
      state.mana = Math.min(state.mana, maxMana(state));
      spawnEffect(state, "cast", hand.x, hand.y, 0, def.minion.palette.c ?? "#9fe6ff", 6 * player.scale, 0.35);
      break;
    }
    case "sword":
      break;
  }
}

function stepAttack(state: CombatState, dt: number, player: PlayerInfo) {
  const attack = state.attack;
  if (!attack) return;
  const def = getWeapon(attack.weaponId);
  if (!def) {
    state.attack = null;
    return;
  }
  attack.t += dt;
  const progress = Math.min(attack.t / attack.duration, 1);

  if (def.kind === "sword" && def.fractal) {
    // Zenith: one spectral sword per use flies out to the target and back; no blade hitbox.
    if (!attack.fired) {
      attack.fired = true;
      const hand = handPosition(player, "point", attack.dir);
      const f = def.fractal;
      let tp = attack.aimPoint ?? { x: hand.x + attack.dir * f.reach * 0.6, y: hand.y };
      const dist = Math.hypot(tp.x - hand.x, tp.y - hand.y);
      if (dist > f.reach) tp = { x: hand.x + ((tp.x - hand.x) / dist) * f.reach, y: hand.y + ((tp.y - hand.y) / dist) * f.reach };
      const texture = f.textures[Math.floor(random(state) * f.textures.length) % f.textures.length];
      const path = { sx: hand.x, sy: hand.y, tx: tp.x, ty: tp.y, t: 0, duration: f.duration, side: (random(state) < 0.5 ? 1 : -1) as 1 | -1, amplitude: f.amplitude };
      const start = fractalPoint(path, 0);
      spawnProjectile(state, def, "fractal", start, 0, 0, {
        path,
        pierce: 99,
        ttl: f.duration,
        radius: 14 * weaponScale(def, player),
        color: "#c8e0ff",
        art: { texture, rotation: Math.PI / 4 },
      });
    }
  } else if (def.kind === "sword") {
    const hand = handPosition(player, "point", attack.dir);
    const reach = def.reach * player.scale;
    const targets = aliveDummies(state).map((d) => ({ id: d.id, rect: rectOf(d) }));
    for (const id of swordHits(def, hand, attack.dir, reach, attack.prevProgress, progress, targets, attack.hits)) {
      const dummy = state.dummies.find((d) => d.id === id)!;
      attack.hits.push(id);
      hitDummy(state, dummy, def, attack.dir, center(rectOf(dummy)));
    }
    // Terra Blade: a beam leaves the blade as the active swing starts.
    if (def.beam && attack.prevProgress < def.activeFrom && progress >= def.activeFrom) {
      spawnProjectile(state, def, "beam", hand, attack.aim, def.beam.speed, {
        pierce: def.beam.pierce,
        ttl: def.beam.ttl,
        radius: 10,
        damage: Math.round(def.damage * def.beam.damageMul),
        color: def.beam.color,
        art: def.beam.art,
      });
    }
  } else if (!attack.fired && attack.t >= attack.releaseAt) {
    attack.fired = true;
    release(state, def, attack, player);
  }

  // Last Prism: drain mana, track the aim point, and damage everything along the beam each tick.
  if (def.kind === "staff" && def.channel && attack.fired) {
    const ch = def.channel;
    state.mana -= ch.manaPerSecond * dt;
    state.manaRegenDelay = MANA_REGEN_DELAY;
    if (state.mana <= 0) {
      state.mana = 0;
      state.attack = null;
      return;
    }
    const hand = handPosition(player, attackPose(def.kind, 1), attack.dir);
    const origin = weaponTip(def, hand, 0, attack.dir, weaponScale(def, player));
    if (attack.aimPoint) {
      const wanted = Math.atan2(attack.aimPoint.y - origin.y, attack.aimPoint.x - origin.x);
      let d = wanted - attack.aim;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      attack.aim += Math.max(-3 * dt, Math.min(3 * dt, d));
    }
    attack.tickTimer = (attack.tickTimer ?? 0) - dt;
    if (attack.tickTimer <= 0) {
      attack.tickTimer += ch.tick;
      const ramp = prismRamp(def, attack.t);
      const end = { x: origin.x + Math.cos(attack.aim) * ch.length, y: origin.y + Math.sin(attack.aim) * ch.length };
      const width = (ch.width * weaponScale(def, player)) / 2;
      for (const d of aliveDummies(state)) {
        const t = segmentHitsRect(origin.x, origin.y, end.x, end.y, rectOf(d), width);
        if (t === null) continue;
        hitDummy(state, d, { ...def, damage: Math.round(def.damage * ramp) }, Math.sign(Math.cos(attack.aim)) || 1, {
          x: origin.x + (end.x - origin.x) * t,
          y: origin.y + (end.y - origin.y) * t,
        });
      }
    }
  }

  attack.prevProgress = progress;
  if (attack.t >= attack.duration) state.attack = null;
}

/** Last Prism damage multiplier: ramps from 35% to 100% while the lasers converge. */
export function prismRamp(def: WeaponDef, t: number): number {
  if (def.kind !== "staff" || !def.channel) return 1;
  return 0.35 + 0.65 * Math.min(1, t / def.channel.convergeTime);
}

function stepProjectiles(state: CombatState, dt: number, bounds: Bounds) {
  const survivors: Projectile[] = [];
  for (const p of state.projectiles) {
    // Seek the nearest dummy this projectile hasn't already hit (so piercing bolts move on).
    const target = p.homing > 0 ? nearestDummy(state, p, 700, p.hits) : null;
    const prev = moveProjectile(p, dt, target ? center(rectOf(target)) : null);
    let alive = true;

    // Swept collision with dummies, nearest first; piercing projectiles continue.
    const hits = aliveDummies(state)
      .filter((d) => !p.hits.includes(d.id))
      .map((d) => ({ d, t: segmentHitsRect(prev.x, prev.y, p.x, p.y, rectOf(d), p.radius) }))
      .filter((h): h is { d: Dummy; t: number } => h.t !== null)
      .sort((a, b) => a.t - b.t);
    for (const { d, t } of hits) {
      const at = { x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t };
      const def = getWeapon(p.weaponId);
      if (def) hitDummy(state, d, { ...def, damage: p.damage, knockback: p.knockback, crit: p.crit }, Math.sign(p.vx) || 1, at);
      p.hits.push(d.id);
      if (p.pierce <= 0) {
        alive = false;
        p.x = at.x;
        p.y = at.y;
        break;
      }
      p.pierce--;
    }

    if (alive && !p.path && p.y + p.radius >= bounds.height) {
      alive = false;
      if (!p.explosive) spawnEffect(state, "puff", p.x, bounds.height - 2, 0, "#cbbd9a", 5, 0.25);
    }
    if (alive && (p.ttl <= 0 || (!p.path && (p.x < -60 || p.x > bounds.width + 60 || p.y < -600)))) alive = false;
    if (alive) survivors.push(p);
    else if (p.explosive) explode(state, p);
  }
  state.projectiles = survivors;
}

/** Firework burst: splash damage to every target within the radius (except ones already hit). */
function explode(state: CombatState, p: Projectile) {
  const ex = p.explosive!;
  const def = getWeapon(p.weaponId);
  for (const d of aliveDummies(state)) {
    if (p.hits.includes(d.id)) continue;
    const c = center(rectOf(d));
    if (Math.hypot(c.x - p.x, c.y - p.y) > ex.radius + Math.max(d.w, d.h) / 2) continue;
    if (def) hitDummy(state, d, { ...def, damage: ex.damage }, c.x >= p.x ? 1 : -1, c);
  }
  spawnEffect(state, "puff", p.x, p.y, 0, ex.color, ex.radius * 0.6, 0.45);
  for (let k = 0; k < 10; k++) spawnEffect(state, "spark", p.x, p.y, (k / 10) * Math.PI * 2, ex.color, ex.radius * 0.25, 0.5);
}

function stepMinions(state: CombatState, dt: number, player: PlayerInfo) {
  const owner = playerCenter(player);
  const targets = aliveDummies(state).map((d) => ({ id: d.id, rect: rectOf(d) }));
  state.minions.forEach((m, slot) => {
    const def = getWeapon(m.weaponId);
    if (def?.kind !== "summon") return;
    const bob = Math.sin((state.time + slot) * 3) * 4;
    const anchor = {
      x: owner.x - player.facing * (player.w * 0.6 + slot * 14 * player.scale / 3),
      y: player.y - 4 * player.scale + bob,
    };
    const struck = stepMinion(m, def.minion, dt, { anchor, owner, targets });
    if (struck !== null) {
      const dummy = state.dummies.find((d) => d.id === struck)!;
      hitDummy(state, dummy, def, Math.sign(m.vx) || player.facing, { x: m.x, y: m.y });
    }
  });
}

// ── Boss fight ─────────────────────────────────────────────────────────────────────────────

/** Summon the Eye of Cthulhu near `nearX`. Returns false if one is already fighting. */
export function summonBoss(state: CombatState, difficulty: BossDifficulty, bounds: Bounds, scale: number, nearX: number): boolean {
  if (state.boss && state.boss.phase !== "gone") return false;
  clearBoss(state);
  clearMoon(state); // one boss at a time
  clearQueen(state);
  const boss = spawnBoss(difficulty, bounds, scale, nearX);
  const id = newId(state);
  const r = bossRect(boss);
  state.boss = boss;
  state.bossDummyId = id;
  state.bossDismissed = false;
  state.player = freshPlayer();
  state.dummies.push({
    id,
    kind: "boss",
    ...r,
    hp: boss.tuning.maxHp,
    maxHp: boss.tuning.maxHp,
    defense: bossDefense(boss),
    flash: 0,
    wobble: 0,
    wobbleV: 0,
    respawn: 0,
  });
  state.events.push({ type: "bossSummoned" }, { type: "message", text: "Eye of Cthulhu has awoken!", color: BOSS_MESSAGE_COLOR });
  return true;
}

/** Send the boss away (it flies off the top of the screen). */
export function dismissBoss(state: CombatState) {
  if (state.boss) state.bossDismissed = true;
}

/** Restart the fight: full health for both sides. */
export function retryBoss(state: CombatState, difficulty: BossDifficulty, bounds: Bounds, scale: number, nearX: number) {
  clearBoss(state);
  state.projectiles = [];
  state.player = freshPlayer();
  summonBoss(state, difficulty, bounds, scale, nearX);
}

function clearBoss(state: CombatState) {
  state.dummies = state.dummies.filter((d) => kindOf(d) !== "boss" && kindOf(d) !== "servant");
  state.boss = null;
  state.bossDummyId = null;
  state.servants = [];
}

/** Boss health for the HUD, or null when no boss is present. The Moon Lord's is all its parts together. */
export function bossHealth(state: CombatState): { hp: number; maxHp: number; name?: string } | null {
  if (state.queenBee && state.queenId !== null) {
    const q = state.dummies.find((d) => d.id === state.queenId);
    return q ? { hp: q.hp, maxHp: q.maxHp, name: "Queen Bee" } : null;
  }
  if (state.moonLord && state.moonIds) {
    const ids = Object.values(state.moonIds);
    const parts = state.dummies.filter((d) => ids.includes(d.id));
    if (!parts.length) return null;
    return { hp: parts.reduce((a, d) => a + d.hp, 0), maxHp: parts.reduce((a, d) => a + d.maxHp, 0), name: "Moon Lord" };
  }
  const entry = state.dummies.find((d) => d.id === state.bossDummyId);
  return state.boss && entry ? { hp: entry.hp, maxHp: entry.maxHp } : null;
}

function damagePlayer(state: CombatState, raw: number, fromX: number, player: PlayerInfo) {
  const p = state.player;
  if (p.dead || p.iframes > 0) return;
  const amount = playerDamageTaken(raw, state.boss?.difficulty ?? state.moonLord?.difficulty ?? state.queenBee?.difficulty ?? "normal");
  p.hp = Math.max(0, p.hp - amount);
  p.iframes = PLAYER_IFRAMES;
  p.regenDelay = PLAYER_REGEN_DELAY;
  spawnText(state, player.x + player.w / 2, player.y - 4, `${amount}`, "#ff3c3c", false);
  state.events.push({ type: "playerHit", amount, fromX });
  if (p.hp <= 0) {
    p.dead = true;
    p.respawn = PLAYER_RESPAWN;
    state.events.push({ type: "playerSlain" }, { type: "message", text: "Your companion was slain...", color: "#e64b4b" });
  }
}

function stepPlayerHealth(state: CombatState, dt: number) {
  const p = state.player;
  p.iframes = Math.max(0, p.iframes - dt);
  p.regenDelay = Math.max(0, p.regenDelay - dt);
  if (p.dead) {
    p.respawn -= dt;
    if (p.respawn <= 0) {
      Object.assign(p, freshPlayer());
      state.events.push({ type: "playerRespawned" });
    }
  } else if (p.regenDelay <= 0 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + PLAYER_REGEN * dt);
  }
}

function stepBossFight(state: CombatState, dt: number, player: PlayerInfo, bounds: Bounds) {
  const boss = state.boss;
  if (!boss) return;
  const entry = state.dummies.find((d) => d.id === state.bossDummyId);
  const target = !state.player.dead && !state.bossDismissed ? playerCenter(player) : null;
  const ev = stepBoss(boss, dt, { target, hp: entry?.hp ?? 0, aliveServants: state.servants.length, bounds });
  if (entry) {
    Object.assign(entry, bossRect(boss));
    entry.defense = bossDefense(boss);
  }
  for (const text of ev.messages) state.events.push({ type: "message", text, color: BOSS_MESSAGE_COLOR });
  if (ev.transformed) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      spawnEffect(state, "puff", boss.x + Math.cos(a) * 40, boss.y + Math.sin(a) * 40, 0, "#c02a2a", 18, 0.6);
    }
  }
  for (const at of ev.spawnServants) {
    const sv = spawnServant(at);
    const id = newId(state);
    const r = SERVANT_RADIUS * boss.scale;
    state.servants.push({ id, s: sv });
    state.dummies.push({
      id,
      kind: "servant",
      x: at.x - r,
      y: at.y - r,
      w: r * 2,
      h: r * 2,
      hp: boss.tuning.servantHp,
      maxHp: boss.tuning.servantHp,
      defense: 0,
      flash: 0,
      wobble: 0,
      wobbleV: 0,
      respawn: 0,
    });
  }
  if (ev.defeated) state.events.push({ type: "bossDefeated" });

  // Servants: home in, sync hitboxes, and drop the dead, the expired and the orphaned.
  const bossFighting = isBossActive(boss);
  const keep = new Set<number>();
  for (const { id, s: sv } of state.servants) {
    const e = state.dummies.find((d) => d.id === id);
    if (!e || e.hp <= 0 || sv.age > SERVANT_LIFETIME || !bossFighting) {
      if (e && e.hp > 0) spawnEffect(state, "puff", sv.x, sv.y, 0, "#b02a2a", 8, 0.3);
      continue;
    }
    stepServant(sv, dt, target, boss.scale, boss.tuning.speed);
    const r = SERVANT_RADIUS * boss.scale;
    Object.assign(e, { x: sv.x - r, y: sv.y - r });
    keep.add(id);
  }
  state.servants = state.servants.filter((x) => keep.has(x.id));
  state.dummies = state.dummies.filter((d) => kindOf(d) !== "servant" || keep.has(d.id));

  // Contact damage to the companion.
  if (!state.player.dead && state.player.iframes <= 0) {
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    if (bossFighting && circleHitsRect(bossCircle(boss), body)) {
      damagePlayer(state, bossContactDamage(boss), boss.x, player);
    } else {
      for (const { s: sv } of state.servants) {
        if (circleHitsRect(servantCircle(sv, boss.scale), body)) {
          damagePlayer(state, boss.tuning.servantDamage, sv.x, player);
          break;
        }
      }
    }
  }

  if (ev.gone) {
    clearBoss(state);
    state.events.push({ type: "bossGone" });
  }
}

// ── Moon Lord ──────────────────────────────────────────────────────────────────────────────

/** Is a boss fight (Eye of Cthulhu or Moon Lord) on? */
export const anyBoss = (state: CombatState) => state.boss !== null || state.moonLord !== null || state.queenBee !== null;

// ── Queen Bee ──────────────────────────────────────────────────────────────────────────────

export function summonQueenBee(state: CombatState, difficulty: BossDifficulty, bounds: Bounds, nearX: number): boolean {
  if (state.queenBee && state.queenBee.phase !== "gone") return false;
  clearBoss(state);
  clearMoon(state);
  clearQueen(state);
  const q = spawnQueenBee(difficulty, bounds, nearX);
  const id = newId(state);
  state.dummies.push({ id, kind: "queen", ...beeRect(q), hp: q.tuning.hp, maxHp: q.tuning.hp, defense: 8, flash: 0, wobble: 0, wobbleV: 0, respawn: 1 });
  state.queenBee = q;
  state.queenId = id;
  state.queenDismissed = false;
  state.player = freshPlayer();
  state.events.push({ type: "bossSummoned" }, { type: "message", text: "Queen Bee has awoken!", color: BOSS_MESSAGE_COLOR });
  return true;
}

export function dismissQueenBee(state: CombatState) {
  if (state.queenBee) state.queenDismissed = true;
}

export function retryQueenBee(state: CombatState, difficulty: BossDifficulty, bounds: Bounds, nearX: number) {
  clearQueen(state);
  state.player = freshPlayer();
  summonQueenBee(state, difficulty, bounds, nearX);
}

function clearQueen(state: CombatState) {
  state.dummies = state.dummies.filter((d) => kindOf(d) !== "queen" && kindOf(d) !== "bee");
  state.queenBee = null;
  state.queenId = null;
  state.bees = [];
  state.queenDismissed = false;
}

function stepQueenFight(state: CombatState, dt: number, player: PlayerInfo, bounds: Bounds) {
  const q = state.queenBee;
  if (!q || state.queenId === null) return;
  const entry = state.dummies.find((d) => d.id === state.queenId);
  const body = { x: player.x, y: player.y, w: player.w, h: player.h };
  const target = state.player.dead ? null : body;
  const ev = stepQueenBee(q, dt, { target, hp: entry?.hp ?? 0, bounds, random: () => random(state), dismissed: state.queenDismissed });
  if (entry) {
    Object.assign(entry, beeRect(q));
    entry.respawn = queenFighting(q) ? 0 : 1;
  }
  for (const b of q.spawn) {
    const id = newId(state);
    const r = BEE_RADIUS * q.scale;
    state.bees.push({ id, b });
    state.dummies.push({ id, kind: "bee", x: b.x - r, y: b.y - r, w: r * 2, h: r * 2, hp: q.tuning.beeHp, maxHp: q.tuning.beeHp, defense: 0, flash: 0, wobble: 0, wobbleV: 0, respawn: 0 });
  }
  // Bees: chase, sting on contact, and vanish when killed, old, or the queen is gone.
  const keep = new Set<number>();
  const fighting = queenFighting(q);
  const tc = target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : null;
  for (const { id, b } of state.bees) {
    const e = state.dummies.find((d) => d.id === id);
    if (!e || e.hp <= 0 || b.age > BEE_LIFETIME || !fighting) {
      if (e && e.hp > 0) spawnEffect(state, "puff", b.x, b.y, 0, "#ffd24a", 6, 0.3);
      continue;
    }
    stepBeeling(b, dt, tc, q.tuning.speed);
    const r = BEE_RADIUS * q.scale;
    Object.assign(e, { x: b.x - r, y: b.y - r });
    keep.add(id);
    if (target && circleHitsRect({ x: b.x, y: b.y, r }, body)) damagePlayer(state, q.tuning.bee, b.x, player);
  }
  state.bees = state.bees.filter((x) => keep.has(x.id));
  state.dummies = state.dummies.filter((d) => kindOf(d) !== "bee" || keep.has(d.id));
  for (const text of ev.messages) state.events.push({ type: "message", text, color: BOSS_MESSAGE_COLOR });
  for (const b of ev.bursts) spawnEffect(state, "puff", b.x, b.y, 0, b.color, b.size, 0.5);
  for (const h of ev.hits) damagePlayer(state, h.amount, h.fromX, player);
  if (ev.defeated) state.events.push({ type: "bossDefeated" });
  if (ev.gone) {
    clearQueen(state);
    state.events.push({ type: "bossGone" });
  }
}

/** Summon the Moon Lord (it rises from below). Ends an Eye of Cthulhu fight. */
export function summonMoonLord(state: CombatState, difficulty: BossDifficulty, bounds: Bounds, nearX: number, model: "girl" | "classic" = "classic"): boolean {
  if (state.moonLord && state.moonLord.phase !== "gone") return false;
  clearBoss(state);
  clearMoon(state);
  clearQueen(state);
  const m = spawnMoonLord(difficulty, bounds, nearX, model);
  const ids = {} as Record<MoonPart, number>;
  for (const part of MOON_PARTS) {
    const id = newId(state);
    ids[part] = id;
    const hp = m.tuning.hp[part];
    // `respawn` > 0 marks a part as not hittable right now (rising, or the core before it opens).
    state.dummies.push({ id, kind: "moon", ...partRect(m, part), hp, maxHp: hp, defense: part === "core" ? 50 : 30, flash: 0, wobble: 0, wobbleV: 0, respawn: 1 });
  }
  state.moonLord = m;
  state.moonIds = ids;
  state.moonDismissed = false;
  state.player = freshPlayer();
  state.events.push({ type: "bossSummoned" }, { type: "message", text: "Moon Lord has awoken!", color: BOSS_MESSAGE_COLOR });
  return true;
}

export function dismissMoonLord(state: CombatState) {
  if (state.moonLord) state.moonDismissed = true;
}

export function retryMoonLord(state: CombatState, difficulty: BossDifficulty, bounds: Bounds, nearX: number, model: "girl" | "classic" = "classic") {
  clearMoon(state);
  state.player = freshPlayer();
  summonMoonLord(state, difficulty, bounds, nearX, model);
}

function clearMoon(state: CombatState) {
  state.dummies = state.dummies.filter((d) => kindOf(d) !== "moon");
  state.moonLord = null;
  state.moonIds = null;
  state.moonDismissed = false;
}

/** Which Moon Lord part a target entry is (for drawing its health bar), if any. */
export function moonPartOf(state: CombatState, id: number): MoonPart | null {
  if (!state.moonIds) return null;
  return MOON_PARTS.find((p) => state.moonIds![p] === id) ?? null;
}

function stepMoonFight(state: CombatState, dt: number, player: PlayerInfo, bounds: Bounds) {
  const m = state.moonLord;
  const ids = state.moonIds;
  if (!m || !ids) return;
  const entry = (p: MoonPart) => state.dummies.find((d) => d.id === ids[p]);
  const hp = {} as Record<MoonPart, number>;
  for (const p of MOON_PARTS) hp[p] = entry(p)?.hp ?? 0;
  const body = { x: player.x, y: player.y, w: player.w, h: player.h };
  const ev = stepMoonLord(m, dt, {
    target: state.player.dead ? null : body,
    hp,
    bounds,
    random: () => random(state),
    dismissed: state.moonDismissed,
  });
  for (const p of MOON_PARTS) {
    const e = entry(p);
    if (!e) continue;
    Object.assign(e, partRect(m, p));
    e.respawn = vulnerable(m, p) ? 0 : 1;
  }
  for (const text of ev.messages) state.events.push({ type: "message", text, color: BOSS_MESSAGE_COLOR });
  for (const b of ev.bursts) spawnEffect(state, "puff", b.x, b.y, 0, b.color, b.size, 0.6);
  for (const h of ev.hits) damagePlayer(state, h.amount, h.fromX, player);
  if (ev.defeated) state.events.push({ type: "bossDefeated" });
  if (ev.gone) {
    clearMoon(state);
    state.events.push({ type: "bossGone" });
  }
}

function stepDummies(state: CombatState, dt: number) {
  for (const d of state.dummies) {
    d.flash = Math.max(0, d.flash - dt);
    // Damped spring back to upright.
    d.wobbleV += (-40 * d.wobble - 6 * d.wobbleV) * dt;
    d.wobble = Math.max(-0.5, Math.min(0.5, d.wobble + d.wobbleV * dt));
    if (Math.abs(d.wobble) < 1e-3 && Math.abs(d.wobbleV) < 1e-3) d.wobble = d.wobbleV = 0;
    if (d.respawn > 0 && kindOf(d) === "dummy") {
      d.respawn = Math.max(0, d.respawn - dt);
      if (d.respawn === 0) d.hp = d.maxHp;
    }
  }
}

/**
 * Advance the sandbox by `dt` seconds. Returns true if anything visible changed, so the
 * renderer can skip frames when the scene is static.
 */
export function stepCombat(state: CombatState, dt: number, player: PlayerInfo, bounds: Bounds): boolean {
  if (dt <= 0) return false;
  state.time += dt;

  const cap = maxMana(state);
  const manaBefore = state.mana;
  if (state.manaRegenDelay > 0) state.manaRegenDelay = Math.max(0, state.manaRegenDelay - dt);
  else state.mana = Math.min(cap, state.mana + MANA_REGEN * dt);
  state.mana = Math.min(state.mana, cap);
  state.cooldown = Math.max(0, state.cooldown - dt);

  stepAttack(state, dt, player);
  stepProjectiles(state, dt, bounds);
  stepMinions(state, dt, player);
  stepBossFight(state, dt, player, bounds);
  stepMoonFight(state, dt, player, bounds);
  stepQueenFight(state, dt, player, bounds);
  stepPlayerHealth(state, dt);
  stepDummies(state, dt);

  for (const e of state.effects) e.t += dt;
  state.effects = state.effects.filter((e) => e.t < e.duration);
  for (const t of state.texts) t.t += dt;
  state.texts = state.texts.filter((t) => t.t < t.duration);

  return (
    state.attack !== null ||
    state.projectiles.length > 0 ||
    state.effects.length > 0 ||
    state.texts.length > 0 ||
    state.minions.length > 0 ||
    state.mana !== manaBefore ||
    state.mana < maxMana(state) ||
    state.boss !== null ||
    state.moonLord !== null ||
    state.queenBee !== null ||
    state.player.hp < state.player.maxHp ||
    state.dummies.some((d) => d.flash > 0 || d.wobble !== 0 || d.respawn > 0)
  );
}

/**
 * Attack distance the AI should close to before using `def` (CSS px between the
 * character's centre and the target's centre).
 */
export function preferredRange(def: WeaponDef, scale: number): number {
  switch (def.kind) {
    case "sword":
      if (def.fractal) return 420;
      if (def.beam) return 280;
      return (def.reach + 4) * scale;
    case "bow":
      return def.skyfall ? 480 : 340;
    case "gun":
      return def.pellets > 1 ? 220 : 400;
    case "staff":
      return def.channel ? 560 : 360;
    case "summon":
      return 320;
  }
}

/** Aim from the character at a dummy, compensating for arrow gravity. */
export function aimAt(def: WeaponDef, player: PlayerInfo, dir: Dir, target: Rect): number {
  const hand = handPosition(player, attackPose(def.kind, 1), dir);
  const c = center(target);
  if (def.kind === "bow") {
    const angle = ballisticAngle(c.x - hand.x, c.y - hand.y, def.arrowSpeed, def.arrowGravity);
    if (angle !== null) return angle;
  }
  return Math.atan2(c.y - hand.y, c.x - hand.x);
}


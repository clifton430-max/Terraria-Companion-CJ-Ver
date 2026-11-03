// Eye of Cthulhu — a self-contained desktop simulation. Pure and deterministic.
//
// This is an ORIGINAL implementation written from the boss's publicly documented behaviour
// (Terraria Wiki): hover above the player while summoning Servants of Cthulhu, then charge three
// times; at half health spin and transform into its mouth form; faster charges without Servants;
// rapid consecutive charges at low health on Expert/Master. It does not reproduce the game's AI
// code; timings and speeds are tuned for a desktop overlay. Art (NPC_4 / NPC_5) comes from the
// user's local install at render time.

import type { Bounds } from "../engine/physics";
import type { Rect, Vec } from "./geometry";

export type BossDifficulty = "easy" | "normal" | "expert" | "master";
export type BossPhase = "phase1" | "transform" | "phase2" | "dying" | "fleeing" | "gone";
export type BossAction = "hover" | "dash" | "recover";

/** Art geometry of `Images/NPC_4`: 6 frames of 110×166; eyeball centre and radius (measured). */
export const BOSS_FRAME_W = 110;
export const BOSS_FRAME_H = 166;
export const BOSS_PIVOT = { x: 55, y: 110 };
export const BOSS_RADIUS = 55;
/** `Images/NPC_5`: 2 frames of 20×32. */
export const SERVANT_FRAME_W = 20;
export const SERVANT_FRAME_H = 32;
export const SERVANT_RADIUS = 10;

/** Terraria's Normal-mode Eye of Cthulhu health. */
export const BASE_HP = 2800;
/**
 * Desktop health multiplier. The companion's best weapons are end-game Terraria weapons, so the
 * Eye gets more health to stay a fight rather than a one-shot (tuned by the balance test).
 */
export const DESKTOP_HP_MULTIPLIER = 2.5;

export interface BossTuning {
  maxHp: number;
  contactPhase1: number;
  contactPhase2: number;
  defensePhase1: number;
  defensePhase2: number;
  speed: number;
  /** Rapid consecutive charges below `frenzyBelow` health in phase 2. */
  frenzy: boolean;
  servantHp: number;
  servantDamage: number;
  maxServants: number;
}

const DIFFICULTY: Record<BossDifficulty, { hp: number; damage: number; speed: number; frenzy: boolean }> = {
  easy: { hp: 0.5, damage: 0.6, speed: 0.85, frenzy: false },
  normal: { hp: 1, damage: 1, speed: 1, frenzy: false },
  expert: { hp: 1.3, damage: 2, speed: 1.15, frenzy: true },
  master: { hp: 1.56, damage: 3, speed: 1.25, frenzy: true },
};

export function tuningFor(d: BossDifficulty): BossTuning {
  const k = DIFFICULTY[d];
  return {
    maxHp: Math.round(BASE_HP * DESKTOP_HP_MULTIPLIER * k.hp),
    contactPhase1: Math.round(15 * k.damage),
    contactPhase2: Math.round(23 * k.damage),
    defensePhase1: 12,
    defensePhase2: 0,
    speed: k.speed,
    frenzy: k.frenzy,
    servantHp: Math.round(8 * DESKTOP_HP_MULTIPLIER * k.hp),
    servantDamage: Math.round(12 * k.damage),
    maxServants: d === "easy" ? 2 : 4,
  };
}

/** Health fraction at which the Eye transforms, and below which Expert/Master frenzy. */
export const TRANSFORM_AT = 0.5;
export const FRENZY_BELOW = 0.2;

// Timings (seconds) and speeds (art px/s; multiplied by the art scale and difficulty speed).
const HOVER_TIME_1 = 2.6;
const HOVER_TIME_2 = 1.4;
const HOVER_HEIGHT = 150;
const HOVER_SPEED = 260;
const DASH_TIME = 0.75;
const DASH_SPEED = 430;
const PHASE2_DASH_BOOST = 1.3;
const FRENZY_DASH_TIME = 0.45;
const RECOVER_TIME = 0.3;
const FRENZY_RECOVER_TIME = 0.12;
const SUMMON_INTERVAL = 0.9;
const TRANSFORM_TIME = 2;
const DYING_TIME = 1.4;
const FLEE_SPEED = 900;

export interface Boss {
  difficulty: BossDifficulty;
  tuning: BossTuning;
  /** Eyeball centre, CSS px. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians; 0 means the pupil points straight down (the art's orientation). */
  rotation: number;
  phase: BossPhase;
  action: BossAction;
  timer: number;
  dashesLeft: number;
  summonTimer: number;
  /** True once the mouth form is showing (frames 3–5). */
  transformed: boolean;
  frameTime: number;
  alpha: number;
  /** CSS px per art pixel. */
  scale: number;
}

export interface BossEvents {
  spawnServants: Vec[];
  messages: string[];
  transformed: boolean;
  defeated: boolean;
  gone: boolean;
}

export interface BossContext {
  /** Point to chase (the companion's centre), or null when it should leave. */
  target: Vec | null;
  hp: number;
  aliveServants: number;
  bounds: Bounds;
}

export function spawnBoss(difficulty: BossDifficulty, bounds: Bounds, scale: number, nearX: number): Boss {
  const r = BOSS_RADIUS * scale;
  return {
    difficulty,
    tuning: tuningFor(difficulty),
    x: Math.min(Math.max(nearX, r), Math.max(r, bounds.width - r)),
    y: -r * 2,
    vx: 0,
    vy: 0,
    rotation: 0,
    phase: "phase1",
    action: "hover",
    timer: HOVER_TIME_1,
    dashesLeft: 0,
    summonTimer: SUMMON_INTERVAL,
    transformed: false,
    frameTime: 0,
    alpha: 1,
    scale,
  };
}

export const bossCircle = (b: Boss) => ({ x: b.x, y: b.y, r: BOSS_RADIUS * b.scale });

/** Square inscribed in the eyeball, used for weapon hit tests. */
export function bossRect(b: Boss): Rect {
  const half = BOSS_RADIUS * b.scale * 0.8;
  return { x: b.x - half, y: b.y - half, w: half * 2, h: half * 2 };
}

/** Animation frame index into NPC_4 (0–2 first form, 3–5 mouth form) at 8 fps. */
export function bossFrame(b: Boss): number {
  return (b.transformed ? 3 : 0) + (Math.floor(b.frameTime * 8) % 3);
}

export const bossContactDamage = (b: Boss) => (b.transformed ? b.tuning.contactPhase2 : b.tuning.contactPhase1);
export const bossDefense = (b: Boss) => (b.transformed ? b.tuning.defensePhase2 : b.tuning.defensePhase1);
export const isBossActive = (b: Boss | null): b is Boss =>
  !!b && (b.phase === "phase1" || b.phase === "transform" || b.phase === "phase2");

const angleTo = (b: Boss, p: Vec) => Math.atan2(p.y - b.y, p.x - b.x);
/** Rotation that points the pupil (art's +y axis) along `angle`. */
const faceAngle = (angle: number) => angle - Math.PI / 2;

function turnToward(current: number, wanted: number, maxStep: number): number {
  let d = wanted - current;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

function startDash(b: Boss, target: Vec, frenzy: boolean) {
  const a = angleTo(b, target);
  const speed = DASH_SPEED * b.scale * b.tuning.speed * (b.phase === "phase2" ? PHASE2_DASH_BOOST : 1) * (frenzy ? 1.25 : 1);
  b.vx = Math.cos(a) * speed;
  b.vy = Math.sin(a) * speed;
  b.rotation = faceAngle(a);
  b.action = "dash";
  b.timer = frenzy ? FRENZY_DASH_TIME : DASH_TIME;
}

/** Advance the Eye by `dt` seconds. Mutates `b`; returns what happened. */
export function stepBoss(b: Boss, dt: number, ctx: BossContext): BossEvents {
  const ev: BossEvents = { spawnServants: [], messages: [], transformed: false, defeated: false, gone: false };
  if (b.phase === "gone" || dt <= 0) return ev;
  b.frameTime += dt;
  const s = b.scale;
  const fraction = ctx.hp / b.tuning.maxHp;

  // Phase changes driven by health and the target.
  if ((b.phase === "phase1" || b.phase === "transform" || b.phase === "phase2") && ctx.hp <= 0) {
    b.phase = "dying";
    b.timer = DYING_TIME;
    ev.defeated = true;
    ev.messages.push("Eye of Cthulhu has been defeated!");
  } else if (ctx.target === null && b.phase !== "dying" && b.phase !== "fleeing") {
    b.phase = "fleeing";
    ev.messages.push("Eye of Cthulhu has left.");
  } else if (b.phase === "phase1" && fraction <= TRANSFORM_AT) {
    b.phase = "transform";
    b.timer = TRANSFORM_TIME;
  }

  const target = ctx.target;
  switch (b.phase) {
    case "dying": {
      b.timer -= dt;
      b.vx *= Math.exp(-1.5 * dt);
      b.vy = b.vy * Math.exp(-1.5 * dt) + 120 * s * dt;
      b.rotation += 6 * dt;
      b.alpha = Math.max(0, b.timer / DYING_TIME);
      if (b.timer <= 0) {
        b.phase = "gone";
        ev.gone = true;
      }
      break;
    }
    case "fleeing": {
      b.vx *= Math.exp(-2 * dt);
      b.vy = Math.max(b.vy - 1500 * s * dt, -FLEE_SPEED * s);
      b.rotation = turnToward(b.rotation, faceAngle(-Math.PI / 2), 6 * dt);
      if (b.y < -BOSS_RADIUS * s * 3) {
        b.phase = "gone";
        ev.gone = true;
      }
      break;
    }
    case "transform": {
      b.timer -= dt;
      const progress = 1 - b.timer / TRANSFORM_TIME;
      b.vx *= Math.exp(-2.5 * dt);
      b.vy *= Math.exp(-2.5 * dt);
      b.rotation += 24 * Math.sin(Math.PI * Math.min(1, progress)) * dt;
      if (!b.transformed && progress >= 0.5) {
        b.transformed = true;
        ev.transformed = true;
      }
      if (b.timer <= 0) {
        b.phase = "phase2";
        b.action = "hover";
        b.timer = HOVER_TIME_2 * 0.6;
      }
      break;
    }
    case "phase1":
    case "phase2": {
      if (!target) break;
      const frenzy = b.phase === "phase2" && b.tuning.frenzy && fraction <= FRENZY_BELOW;
      b.timer -= dt;
      if (b.action === "hover") {
        const p = { x: target.x, y: Math.max(BOSS_RADIUS * s, target.y - HOVER_HEIGHT * s) };
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const dist = Math.hypot(dx, dy);
        const speed = Math.min(HOVER_SPEED * s * b.tuning.speed, dist * 3);
        const k = Math.min(1, 4 * dt);
        b.vx += ((dist > 1e-6 ? (dx / dist) * speed : 0) - b.vx) * k;
        b.vy += ((dist > 1e-6 ? (dy / dist) * speed : 0) - b.vy) * k;
        b.rotation = turnToward(b.rotation, faceAngle(angleTo(b, target)), 8 * dt);
        if (b.phase === "phase1") {
          b.summonTimer -= dt;
          if (b.summonTimer <= 0) {
            b.summonTimer = SUMMON_INTERVAL / b.tuning.speed;
            if (ctx.aliveServants + ev.spawnServants.length < b.tuning.maxServants) {
              const a = angleTo(b, target);
              const r = BOSS_RADIUS * s;
              ev.spawnServants.push({ x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r });
            }
          }
        }
        if (b.timer <= 0) {
          b.dashesLeft = frenzy ? 5 : 3;
          startDash(b, target, frenzy);
        }
      } else if (b.action === "dash") {
        const total = frenzy ? FRENZY_DASH_TIME : DASH_TIME;
        if (b.timer < total * 0.4) {
          b.vx *= Math.exp(-4 * dt);
          b.vy *= Math.exp(-4 * dt);
        }
        if (b.timer <= 0) {
          b.dashesLeft--;
          if (b.dashesLeft > 0) {
            b.action = "recover";
            b.timer = frenzy ? FRENZY_RECOVER_TIME : RECOVER_TIME;
          } else {
            b.action = "hover";
            b.timer = b.phase === "phase1" ? HOVER_TIME_1 : HOVER_TIME_2;
          }
        }
      } else {
        b.vx *= Math.exp(-8 * dt);
        b.vy *= Math.exp(-8 * dt);
        b.rotation = turnToward(b.rotation, faceAngle(angleTo(b, target)), 12 * dt);
        if (b.timer <= 0) startDash(b, target, frenzy);
      }
      break;
    }
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  // Keep it roughly on screen during the fight (charges may overshoot a little).
  if (b.phase !== "fleeing" && b.phase !== "dying") {
    const margin = BOSS_RADIUS * s;
    b.x = Math.min(Math.max(b.x, -margin), ctx.bounds.width + margin);
    b.y = Math.min(b.y, ctx.bounds.height + margin);
  }
  return ev;
}

export interface Servant {
  x: number;
  y: number;
  vx: number;
  vy: number;
  frameTime: number;
  age: number;
}

const SERVANT_SPEED = 170;
/** Servants give up and fade after this long. */
export const SERVANT_LIFETIME = 25;

export function spawnServant(at: Vec): Servant {
  return { x: at.x, y: at.y, vx: 0, vy: 0, frameTime: 0, age: 0 };
}

/** Home in on the target with inertia (no orbiting tricks). */
export function stepServant(sv: Servant, dt: number, target: Vec | null, scale: number, speed: number) {
  sv.age += dt;
  sv.frameTime += dt;
  const goal = target ?? { x: sv.x, y: -1000 };
  const dx = goal.x - sv.x;
  const dy = goal.y - sv.y;
  const d = Math.hypot(dx, dy) || 1;
  const v = SERVANT_SPEED * scale * speed;
  const k = Math.min(1, 1.6 * dt);
  sv.vx += ((dx / d) * v - sv.vx) * k;
  sv.vy += ((dy / d) * v - sv.vy) * k;
  sv.x += sv.vx * dt;
  sv.y += sv.vy * dt;
}

export const servantCircle = (sv: Servant, scale: number) => ({ x: sv.x, y: sv.y, r: SERVANT_RADIUS * scale });
export const servantFrame = (sv: Servant) => Math.floor(sv.frameTime * 8) % 2;

export function circleHitsRect(c: { x: number; y: number; r: number }, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 <= c.r * c.r;
}

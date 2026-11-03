// The Moon Lord for the combat sandbox: a desktop-sized take on Terraria's final boss. Three eyes
// (the head's and one in each palm) must be destroyed before the chest core opens; the core then
// takes the killing blows. Attacks: Phantasmal Bolts (hands), Phantasmal Spheres (hands), the
// Phantasmal Deathray (head, telegraphed by a warning line) and homing Phantasmal Eyes (core).
// Pure logic; the sim applies damage and keeps the hittable parts in sync, render.ts draws it with
// the head / hand / core sheets from the local install (procedural torso, arms and eyes).

import type { Rect, Vec } from "./geometry";
import type { BossDifficulty } from "./boss";

type Bounds = { width: number; height: number };

export type MoonPart = "head" | "left" | "right" | "core";
export const MOON_PARTS: readonly MoonPart[] = ["head", "left", "right", "core"];
export type MoonPhase = "rising" | "eyes" | "core" | "dying" | "leaving" | "gone";

/** Art sizes (px) of the sheets: head 3×3 grid (8 frames), hand 4 frames, core 5 frames. */
export const HEAD_FRAME = { w: 191, h: 268, frames: 8, cols: 3 };
export const HAND_FRAME = { w: 246, h: 272, frames: 4 };
export const CORE_FRAME = { w: 60, h: 82, frames: 5 };

export interface MoonTuning {
  hp: Record<MoonPart, number>;
  bolt: number;
  sphere: number;
  ray: number;
  eye: number;
  /** Attack-rate multiplier (higher = more often). */
  pace: number;
}

const DIFFICULTY: Record<BossDifficulty, { hp: number; damage: number; pace: number }> = {
  easy: { hp: 0.7, damage: 0.7, pace: 0.8 },
  normal: { hp: 1, damage: 1, pace: 1 },
  expert: { hp: 1.35, damage: 1.3, pace: 1.15 },
  master: { hp: 1.7, damage: 1.6, pace: 1.3 },
};

export function moonTuning(d: BossDifficulty): MoonTuning {
  const k = DIFFICULTY[d];
  const hp = (n: number) => Math.round(n * k.hp);
  const dmg = (n: number) => Math.round(n * k.damage);
  return { hp: { head: hp(8000), left: hp(6000), right: hp(6000), core: hp(10000) }, bolt: dmg(45), sphere: dmg(55), ray: dmg(80), eye: dmg(50), pace: k.pace };
}

export type ShotKind = "bolt" | "sphere" | "eye";
export interface MoonShot {
  id: number;
  kind: ShotKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  ttl: number;
  age: number;
  /** Spheres hang in place briefly, then rush the point they were aimed at. */
  delay?: number;
}

export interface Deathray {
  /** Seconds of warning (a thin flickering line) left before it fires. */
  warn: number;
  /** Seconds of firing left. */
  fire: number;
  angle: number;
}

interface Attacker {
  timer: number;
  /** Seconds of eye glow before an attack (telegraph). */
  charge: number;
  next: "bolts" | "spheres" | "ray" | "eyes";
}

/**
 * Body layout (art px, relative to the torso centre). "girl" follows the installed Moon Lord girl
 * add-on (torso, big head with a forehead-eye socket, floating peace-sign hands with palm eyes;
 * the add-on hides the arms); "classic" is the game's look, used when the add-on is missing.
 */
export type MoonModel = "girl" | "classic";
export const LAYOUT = {
  classic: { head: { x: 0, y: -170 }, headEye: { x: 0, y: -89 }, hand: { x: 300, y: 30 }, handEye: { x: -3, y: 44 }, core: { x: 0, y: 20 }, extent: { half: 430, up: 310, down: 190 }, eye: [34, 44], palm: [46, 80] },
  girl: { head: { x: 1, y: -302 }, headEye: { x: -1, y: -133 }, hand: { x: 360, y: -40 }, handEye: { x: 0, y: 75 }, core: { x: 0, y: 150 }, extent: { half: 490, up: 580, down: 345 }, eye: [34, 50], palm: [36, 60] },
} as const;

export interface MoonLord {
  model: MoonModel;
  difficulty: BossDifficulty;
  tuning: MoonTuning;
  /** Torso centre (CSS px). */
  x: number;
  y: number;
  /** CSS px per art pixel. */
  scale: number;
  phase: MoonPhase;
  t: number;
  phaseT: number;
  alive: Record<MoonPart, boolean>;
  attackers: Record<"head" | "left" | "right" | "core", Attacker>;
  ray: Deathray | null;
  shots: MoonShot[];
  nextShot: number;
  alpha: number;
}

export interface MoonContext {
  /** The companion's body (null while slain or when it should leave). */
  target: Rect | null;
  hp: Record<MoonPart, number>;
  bounds: Bounds;
  random: () => number;
  dismissed: boolean;
}

export interface MoonEvents {
  messages: string[];
  hits: { amount: number; fromX: number }[];
  bursts: { x: number; y: number; color: string; size: number }[];
  coreExposed: boolean;
  defeated: boolean;
  gone: boolean;
}

const RISE_TIME = 2.2;
const DYING_TIME = 3.2;
const LEAVE_TIME = 1.4;
const RAY_WARN = 1.1;
const RAY_FIRE = 1.6;
const RAY_TURN = 0.55; // rad/s while firing (so it can be outrun)
const RAY_WIDTH = 26;
const FOLLOW_SPEED = 70;


/** Scale that fits the whole Moon Lord on screen (capped at the art's own size, 1:1). */
export function moonScale(bounds: Bounds, model: MoonModel = "classic"): number {
  const e = LAYOUT[model].extent;
  return Math.max(0.35, Math.min(1, (bounds.width * 0.9) / (e.half * 2), (bounds.height * 0.72) / (e.up + e.down)));
}

export function spawnMoonLord(difficulty: BossDifficulty, bounds: Bounds, nearX: number, model: MoonModel = "classic"): MoonLord {
  const scale = moonScale(bounds, model);
  const x = clampX(nearX, bounds, scale, model);
  const at = (timer: number, next: Attacker["next"]): Attacker => ({ timer, charge: 0, next });
  return {
    difficulty,
    tuning: moonTuning(difficulty),
    model,
    x,
    y: restY(bounds, scale, model) + bounds.height * 0.6, // rises from below the screen
    scale,
    phase: "rising",
    t: 0,
    phaseT: 0,
    alive: { head: true, left: true, right: true, core: true },
    attackers: { head: at(3.5, "ray"), left: at(1.2, "bolts"), right: at(2.4, "spheres"), core: at(2, "eyes") },
    ray: null,
    shots: [],
    nextShot: 1,
    alpha: 1,
  };
}

const clampX = (x: number, b: Bounds, s: number, m: MoonModel) => {
  const half = LAYOUT[m].extent.half * s;
  return Math.min(Math.max(x, half), Math.max(half, b.width - half));
};
const restY = (b: Bounds, s: number, m: MoonModel) => Math.min(LAYOUT[m].extent.up * s + 16, b.height - LAYOUT[m].extent.down * s - 140);

/** Where things are, in CSS px. */
export function headCenter(m: MoonLord): Vec {
  const L = LAYOUT[m.model ?? "classic"];
  const bob = Math.sin(m.t * 1.3) * 4 * m.scale;
  return { x: m.x + L.head.x * m.scale, y: m.y + L.head.y * m.scale + bob };
}

export function handCenter(m: MoonLord, side: "left" | "right"): Vec {
  const L = LAYOUT[m.model ?? "classic"];
  const dir = side === "left" ? -1 : 1;
  const sway = Math.sin(m.t * 1.1 + (dir > 0 ? 1.7 : 0)) * 14 * m.scale;
  // Hands drift in toward the target while attacking (eyeCharge), giving a reach-out gesture.
  const reach = eyeCharge(m, side) * 24 * m.scale;
  return { x: m.x + dir * (L.hand.x * m.scale - reach), y: m.y + L.hand.y * m.scale + sway };
}

export function coreCenter(m: MoonLord): Vec {
  const L = LAYOUT[m.model ?? "classic"];
  return { x: m.x + L.core.x * m.scale, y: m.y + L.core.y * m.scale };
}

/** Each eye (or the core) as a centre point. */
export function partCenter(m: MoonLord, part: MoonPart): Vec {
  switch (part) {
    case "head": {
      const h = headCenter(m);
      const e = LAYOUT[m.model ?? "classic"].headEye;
      return { x: h.x + e.x * m.scale, y: h.y + e.y * m.scale };
    }
    case "left":
    case "right": {
      const h = handCenter(m, part);
      const e = LAYOUT[m.model ?? "classic"].handEye;
      return { x: h.x + (part === "left" ? -e.x : e.x) * m.scale, y: h.y + e.y * m.scale };
    }
    case "core":
      return coreCenter(m);
  }
}

const PART_SIZE: Record<MoonPart, [number, number]> = { head: [34, 44], left: [46, 80], right: [46, 80], core: [60, 82] };

/** Hittable rectangle of a part. */
export function partRect(m: MoonLord, part: MoonPart): Rect {
  const c = partCenter(m, part);
  const L = LAYOUT[m.model ?? "classic"];
  const [w, h] = part === "head" ? L.eye : part === "core" ? PART_SIZE.core : L.palm;
  return { x: c.x - (w * m.scale) / 2, y: c.y - (h * m.scale) / 2, w: w * m.scale, h: h * m.scale };
}

/** Is the part hittable right now? Eyes while alive; the core only once all three eyes are gone. */
export function vulnerable(m: MoonLord, part: MoonPart): boolean {
  if (m.phase !== "eyes" && m.phase !== "core") return false;
  if (part === "core") return m.phase === "core" && m.alive.core;
  return m.alive[part];
}

/** Deathray segment (from the head eye to the screen's far edge). */
export function rayLine(m: MoonLord, bounds: Bounds): { from: Vec; to: Vec; width: number } | null {
  if (!m.ray) return null;
  const from = partCenter(m, "head");
  const len = Math.hypot(bounds.width, bounds.height) * 1.2;
  return { from, to: { x: from.x + Math.cos(m.ray.angle) * len, y: from.y + Math.sin(m.ray.angle) * len }, width: RAY_WIDTH * m.scale };
}

function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

const circleHitsRect = (x: number, y: number, r: number, b: Rect) => {
  const cx = Math.max(b.x, Math.min(x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(y, b.y + b.h));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const angleTo = (from: Vec, to: Vec) => Math.atan2(to.y - from.y, to.x - from.x);
const centerOf = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function turnToward(a: number, want: number, max: number): number {
  let d = want - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-max, Math.min(max, d));
}

/** Seconds of glowing before an attack. */
const CHARGE: Record<Attacker["next"], number> = { bolts: 0.45, spheres: 0.7, ray: 0, eyes: 0.5 };

function shoot(m: MoonLord, kind: ShotKind, at: Vec, angle: number, speed: number, extra: Partial<MoonShot> = {}) {
  const s = m.scale;
  const r = kind === "sphere" ? 12 : kind === "eye" ? 10 : 6;
  const damage = kind === "sphere" ? m.tuning.sphere : kind === "eye" ? m.tuning.eye : m.tuning.bolt;
  m.shots.push({ id: m.nextShot++, kind, x: at.x, y: at.y, vx: Math.cos(angle) * speed * s, vy: Math.sin(angle) * speed * s, r: r * s, damage, ttl: kind === "bolt" ? 3 : 6, age: 0, ...extra });
}

function attack(m: MoonLord, who: keyof MoonLord["attackers"], target: Vec, rnd: () => number) {
  const a = m.attackers[who];
  const from = partCenter(m, who);
  const aim = angleTo(from, target);
  switch (a.next) {
    case "bolts":
      // A tight fan of fast bolts.
      for (let i = -1; i <= 1; i++) shoot(m, "bolt", from, aim + i * 0.12 + (rnd() - 0.5) * 0.05, 520);
      a.next = "spheres";
      a.timer = 2.6 / m.tuning.pace;
      break;
    case "spheres":
      // A ring of spheres that hangs, then rushes where the character was.
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const at = { x: from.x + Math.cos(ang) * 46 * m.scale, y: from.y + Math.sin(ang) * 46 * m.scale };
        shoot(m, "sphere", at, angleTo(at, target), 330, { delay: 0.6 + i * 0.12 });
      }
      a.next = "bolts";
      a.timer = 3.4 / m.tuning.pace;
      break;
    case "ray":
      m.ray = { warn: RAY_WARN, fire: RAY_FIRE, angle: aim };
      a.timer = (7.5 + rnd() * 2) / m.tuning.pace;
      break;
    case "eyes":
      // Phantasmal Eyes: a burst that homes in.
      for (let i = 0; i < 4; i++) shoot(m, "eye", from, -Math.PI / 2 + (i - 1.5) * 0.7, 260);
      for (let i = -2; i <= 2; i++) shoot(m, "bolt", from, aim + i * 0.18, 480);
      a.timer = 2.6 / m.tuning.pace;
      break;
  }
}

export function stepMoonLord(m: MoonLord, dt: number, ctx: MoonContext): MoonEvents {
  const ev: MoonEvents = { messages: [], hits: [], bursts: [], coreExposed: false, defeated: false, gone: false };
  m.t += dt;
  m.phaseT += dt;
  const s = m.scale;
  const fighting = m.phase === "eyes" || m.phase === "core";

  // Deaths of parts.
  for (const p of MOON_PARTS) {
    if (m.alive[p] && ctx.hp[p] <= 0 && fighting && (p !== "core" || m.phase === "core")) {
      m.alive[p] = false;
      const c = partCenter(m, p);
      ev.bursts.push({ x: c.x, y: c.y, color: "#7fffe0", size: 40 * s });
      if (p !== "core") ev.messages.push(p === "head" ? "The Moon Lord's head eye has been destroyed!" : "A Moon Lord hand eye has been destroyed!");
    }
  }
  if (m.phase === "eyes" && !m.alive.head && !m.alive.left && !m.alive.right) {
    m.phase = "core";
    m.phaseT = 0;
    m.ray = null;
    ev.coreExposed = true;
    ev.messages.push("The Moon Lord's core is exposed!");
  }
  if (m.phase === "core" && !m.alive.core) {
    m.phase = "dying";
    m.phaseT = 0;
    m.ray = null;
    m.shots = [];
  }
  if (ctx.dismissed && m.phase !== "dying" && m.phase !== "leaving" && m.phase !== "gone") {
    m.phase = "leaving";
    m.phaseT = 0;
    m.ray = null;
  }

  // Movement: rise into view, then drift to stay above the character.
  const rest = restY(ctx.bounds, s, m.model ?? "classic");
  if (m.phase === "rising") {
    m.y += (rest - m.y) * Math.min(1, dt * 2.2);
    if (m.phaseT >= RISE_TIME) {
      m.phase = "eyes";
      m.phaseT = 0;
      m.y = rest;
    }
  } else if (fighting) {
    m.y += (rest - m.y) * Math.min(1, dt * 2);
    if (ctx.target) {
      const want = clampX(centerOf(ctx.target).x, ctx.bounds, s, m.model ?? "classic");
      const step = FOLLOW_SPEED * dt;
      m.x += Math.max(-step, Math.min(step, want - m.x));
    }
  } else if (m.phase === "dying") {
    if (Math.floor(m.phaseT * 8) !== Math.floor((m.phaseT - dt) * 8)) {
      ev.bursts.push({
        x: m.x + (ctx.random() - 0.5) * 600 * s,
        y: m.y + (ctx.random() - 0.65) * 420 * s,
        color: ctx.random() < 0.5 ? "#7fffe0" : "#ffffff",
        size: (20 + ctx.random() * 40) * s,
      });
    }
    m.alpha = Math.max(0, 1 - Math.max(0, m.phaseT - DYING_TIME * 0.6) / (DYING_TIME * 0.4));
    if (m.phaseT >= DYING_TIME) {
      m.phase = "gone";
      ev.defeated = true;
      ev.gone = true;
      ev.messages.push("Moon Lord has been defeated!");
    }
  } else if (m.phase === "leaving") {
    m.alpha = Math.max(0, 1 - m.phaseT / LEAVE_TIME);
    m.y -= 260 * dt;
    m.shots = m.shots.filter((x) => x.age < 0.2);
    if (m.phaseT >= LEAVE_TIME) {
      m.phase = "gone";
      ev.gone = true;
    }
  }

  // Attacks (paused while the character is down, so a respawn isn't punished).
  const target = ctx.target ? centerOf(ctx.target) : null;
  if (fighting && target) {
    const who: (keyof MoonLord["attackers"])[] = m.phase === "eyes" ? ["head", "left", "right"] : ["core"];
    for (const k of who) {
      if (!m.alive[k]) continue;
      const a = m.attackers[k];
      if (k === "head" && m.ray) continue;
      if (a.charge > 0) {
        a.charge -= dt;
        if (a.charge <= 0) {
          a.charge = 0;
          attack(m, k, target, ctx.random);
        }
        continue;
      }
      a.timer -= dt;
      if (a.timer <= 0) {
        a.charge = CHARGE[a.next];
        if (a.charge === 0) attack(m, k, target, ctx.random);
      }
    }
  }

  // Deathray: warn, then fire while slowly tracking.
  if (m.ray) {
    if (!m.alive.head || !fighting) m.ray = null;
    else if (m.ray.warn > 0) {
      m.ray.warn -= dt;
      if (target) m.ray.angle = turnToward(m.ray.angle, angleTo(partCenter(m, "head"), target), 2.5 * dt);
    } else {
      m.ray.fire -= dt;
      if (target) m.ray.angle = turnToward(m.ray.angle, angleTo(partCenter(m, "head"), target), RAY_TURN * dt);
      const line = rayLine(m, ctx.bounds)!;
      if (ctx.target) {
        const c = centerOf(ctx.target);
        if (segmentDistance(c, line.from, line.to) <= line.width / 2 + Math.min(ctx.target.w, ctx.target.h) / 2) ev.hits.push({ amount: m.tuning.ray, fromX: line.from.x });
      }
      if (m.ray.fire <= 0) m.ray = null;
    }
  }

  // Shots.
  const keep: MoonShot[] = [];
  for (const shot of m.shots) {
    shot.age += dt;
    shot.ttl -= dt;
    if (shot.delay !== undefined && shot.delay > 0) {
      shot.delay -= dt;
      // Hang in place, drifting slightly.
      shot.x += shot.vx * 0.05 * dt;
      shot.y += shot.vy * 0.05 * dt;
    } else {
      if (shot.kind === "eye" && target) {
        const want = angleTo(shot, target);
        const speed = Math.hypot(shot.vx, shot.vy);
        const ang = turnToward(Math.atan2(shot.vy, shot.vx), want, 2.2 * dt);
        const sp = Math.min(speed + 120 * s * dt, 420 * s);
        shot.vx = Math.cos(ang) * sp;
        shot.vy = Math.sin(ang) * sp;
      }
      if (shot.kind === "sphere") {
        const sp = Math.hypot(shot.vx, shot.vy);
        const k = Math.min(1.6, 1 + dt * 0.8);
        if (sp < 700 * s) {
          shot.vx *= k;
          shot.vy *= k;
        }
      }
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
    }
    if (ctx.target && circleHitsRect(shot.x, shot.y, shot.r, ctx.target)) {
      ev.hits.push({ amount: shot.damage, fromX: shot.x });
      ev.bursts.push({ x: shot.x, y: shot.y, color: "#7fffe0", size: shot.r * 2 });
      continue;
    }
    const out = shot.x < -100 || shot.x > ctx.bounds.width + 100 || shot.y < -200 || shot.y > ctx.bounds.height + 100;
    if (shot.ttl > 0 && !out) keep.push(shot);
  }
  m.shots = keep;
  return ev;
}

/** 0..1 glow of an eye that's about to attack (telegraph). */
export function eyeCharge(m: MoonLord, part: MoonPart): number {
  if (part === "head") return m.ray && m.ray.warn > 0 ? 1 - m.ray.warn / RAY_WARN : m.ray ? 1 : 0;
  const a = m.attackers[part];
  const total = CHARGE[a.next] || 1;
  return a.charge > 0 ? 1 - a.charge / total : 0;
}

/** Head frame (tentacles writhing) and core frame (covered, then a beating exposed heart). */
export const headFrame = (m: MoonLord) => Math.floor(m.t * 8) % HEAD_FRAME.frames;
export const coreFrame = (m: MoonLord) => (m.phase === "core" || m.phase === "dying" ? 1 + (Math.floor(m.t * 6) % 4) : 0);
/** Open palm while the eye lives; a fist once it's destroyed. */
export const handFrame = (m: MoonLord, side: "left" | "right") => (m.alive[side] ? 0 : 3);

// Queen Bee for the combat sandbox, inspired by Terraria's: she hovers above you firing volleys of
// stingers, charges across the screen several times (each telegraphed by a warning line), and
// summons small bees. Below half health she enrages (faster, more stingers, more bees). Pure logic;
// the sim applies damage and keeps her and her bees hittable, render.ts draws her with the
// installed Queen Bee waifu add-on (or the game's sprite).

import type { Rect } from "./geometry";
import type { BossDifficulty } from "./boss";

type Bounds = { width: number; height: number };

export type BeePhase = "entering" | "hover" | "charge" | "summon" | "dying" | "leaving" | "gone";

/** Sheet layout (both the game's and the add-on's): 12 frames, 0–3 charging, 4–11 hovering. */
export const QB_FRAMES = 12;
export const QB_CHARGE_FRAMES = [0, 1, 2, 3];
export const QB_HOVER_FRAMES = [4, 5, 6, 7, 8, 9, 10, 11];
/** Art size of one frame (px) and the hit radius around its centre. */
export const QB_FRAME = { w: 172, h: 152 };
export const QB_RADIUS = 52;

export interface BeeTuning {
  hp: number;
  beeHp: number;
  contact: number;
  stinger: number;
  bee: number;
  speed: number;
}

const DIFF: Record<BossDifficulty, { hp: number; dmg: number; speed: number }> = {
  easy: { hp: 0.7, dmg: 0.7, speed: 0.85 },
  normal: { hp: 1, dmg: 1, speed: 1 },
  expert: { hp: 1.35, dmg: 1.3, speed: 1.12 },
  master: { hp: 1.7, dmg: 1.6, speed: 1.25 },
};

export function beeTuning(d: BossDifficulty): BeeTuning {
  const k = DIFF[d];
  return { hp: Math.round(7000 * k.hp), beeHp: Math.round(60 * k.hp), contact: Math.round(60 * k.dmg), stinger: Math.round(35 * k.dmg), bee: Math.round(25 * k.dmg), speed: k.speed };
}

export interface Stinger {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ttl: number;
}

export interface Beeling {
  key: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export interface QueenBee {
  difficulty: BossDifficulty;
  tuning: BeeTuning;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  phase: BeePhase;
  phaseT: number;
  t: number;
  /** 1 = facing right (the sheet faces left). */
  facing: 1 | -1;
  /** Charges left in this charge phase, and the current charge (telegraph, then dash). */
  charges: number;
  charge: { y: number; dir: 1 | -1; warn: number } | null;
  volleyT: number;
  enraged: boolean;
  stingers: Stinger[];
  /** Bees to spawn this step (the sim turns them into hittable targets). */
  spawn: Beeling[];
  nextBee: number;
  alpha: number;
}

export interface BeeContext {
  target: Rect | null;
  hp: number;
  bounds: Bounds;
  random: () => number;
  dismissed: boolean;
}

export interface BeeEvents {
  messages: string[];
  hits: { amount: number; fromX: number }[];
  bursts: { x: number; y: number; color: string; size: number }[];
  defeated: boolean;
  gone: boolean;
}

const ENTER_TIME = 1.6;
const HOVER_TIME = 3.2;
const SUMMON_TIME = 1.6;
const CHARGE_WARN = 0.55;
const CHARGE_SPEED = 950;
const DYING_TIME = 1.6;

export const beeScale = (b: Bounds) => Math.max(0.55, Math.min(1, b.width / 1600));

export function spawnQueenBee(difficulty: BossDifficulty, bounds: Bounds, nearX: number): QueenBee {
  const scale = beeScale(bounds);
  return {
    difficulty,
    tuning: beeTuning(difficulty),
    x: Math.min(Math.max(nearX, 120), bounds.width - 120),
    y: -QB_FRAME.h * scale,
    vx: 0,
    vy: 0,
    scale,
    phase: "entering",
    phaseT: 0,
    t: 0,
    facing: 1,
    charges: 0,
    charge: null,
    volleyT: 1,
    enraged: false,
    stingers: [],
    spawn: [],
    nextBee: 1,
    alpha: 1,
  };
}

export const beeCircle = (q: QueenBee) => ({ x: q.x, y: q.y, r: QB_RADIUS * q.scale });
export function beeRect(q: QueenBee): Rect {
  const r = QB_RADIUS * q.scale;
  return { x: q.x - r, y: q.y - r, w: r * 2, h: r * 2 };
}
export const isFighting = (q: QueenBee) => q.phase === "hover" || q.phase === "charge" || q.phase === "summon";

/** Current sheet frame: wing flaps while hovering, the horizontal pose while charging. */
export function beeFrame(q: QueenBee): number {
  const charging = q.phase === "charge" && q.charge !== null && q.charge.warn <= 0;
  const set = charging ? QB_CHARGE_FRAMES : QB_HOVER_FRAMES;
  return set[Math.floor(q.t * (charging ? 18 : 14)) % set.length];
}

const circleHitsRect = (x: number, y: number, r: number, b: Rect) => {
  const cx = Math.max(b.x, Math.min(x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(y, b.y + b.h));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function setPhase(q: QueenBee, p: BeePhase) {
  q.phase = p;
  q.phaseT = 0;
}

export function stepQueenBee(q: QueenBee, dt: number, ctx: BeeContext): BeeEvents {
  const ev: BeeEvents = { messages: [], hits: [], bursts: [], defeated: false, gone: false };
  q.t += dt;
  q.phaseT += dt;
  q.spawn = [];
  const s = q.scale;
  const sp = q.tuning.speed * (q.enraged ? 1.25 : 1);
  const target = ctx.target;
  const tc = target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : { x: ctx.bounds.width / 2, y: ctx.bounds.height - 80 };

  if (isFighting(q) && ctx.hp <= 0) {
    setPhase(q, "dying");
    q.stingers = [];
    q.charge = null;
  }
  if (ctx.dismissed && q.phase !== "dying" && q.phase !== "leaving" && q.phase !== "gone") setPhase(q, "leaving");
  if (isFighting(q) && !q.enraged && ctx.hp <= q.tuning.hp * 0.5) {
    q.enraged = true;
    ev.messages.push("Queen Bee is enraged!");
    ev.bursts.push({ x: q.x, y: q.y, color: "#ffd24a", size: 50 * s });
  }

  const hoverPoint = { x: Math.min(Math.max(tc.x + Math.sin(q.t * 0.9) * 140 * s, 100), ctx.bounds.width - 100), y: Math.max(QB_FRAME.h * s * 0.6, Math.min(tc.y - 230 * s, ctx.bounds.height * 0.45)) };
  const glide = (to: { x: number; y: number }, rate: number) => {
    q.vx = (to.x - q.x) * rate;
    q.vy = (to.y - q.y) * rate;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
  };

  switch (q.phase) {
    case "entering":
      glide(hoverPoint, 2.2);
      if (q.phaseT >= ENTER_TIME) setPhase(q, "hover");
      break;
    case "hover": {
      glide(hoverPoint, 2.5 * sp);
      q.facing = tc.x >= q.x ? 1 : -1;
      q.volleyT -= dt;
      if (target && q.volleyT <= 0) {
        q.volleyT = (q.enraged ? 0.65 : 0.9) / sp;
        const n = q.enraged ? 5 : 3;
        const aim = Math.atan2(tc.y - q.y, tc.x - q.x);
        for (let i = 0; i < n; i++) {
          const a = aim + (i - (n - 1) / 2) * 0.16;
          q.stingers.push({ x: q.x, y: q.y + 30 * s, vx: Math.cos(a) * 480 * s * sp, vy: Math.sin(a) * 480 * s * sp, r: 6 * s, ttl: 3 });
        }
      }
      if (q.phaseT >= HOVER_TIME / sp) {
        setPhase(q, "charge");
        q.charges = q.enraged ? 4 : 3;
        q.charge = null;
      }
      break;
    }
    case "charge": {
      if (!q.charge) {
        if (q.charges <= 0) {
          setPhase(q, "summon");
          break;
        }
        // Line up beside the screen at the target's height, then telegraph.
        const dir: 1 | -1 = q.x < ctx.bounds.width / 2 ? 1 : -1;
        const y = Math.min(Math.max(tc.y, QB_FRAME.h * s * 0.5), ctx.bounds.height - QB_RADIUS * s);
        q.charge = { y, dir, warn: CHARGE_WARN / sp };
        q.charges--;
      }
      const c = q.charge;
      if (c.warn > 0) {
        // Slide to the start point while the warning shows.
        const startX = c.dir > 0 ? QB_RADIUS * s : ctx.bounds.width - QB_RADIUS * s;
        glide({ x: startX, y: c.y }, 6);
        q.facing = c.dir;
        c.warn -= dt;
      } else {
        q.vx = c.dir * CHARGE_SPEED * s * sp;
        q.vy = (c.y - q.y) * 4;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if ((c.dir > 0 && q.x > ctx.bounds.width - QB_RADIUS * s) || (c.dir < 0 && q.x < QB_RADIUS * s)) q.charge = null;
        if (target && circleHitsRect(q.x, q.y, QB_RADIUS * s * 0.8, target)) ev.hits.push({ amount: q.tuning.contact, fromX: q.x });
      }
      break;
    }
    case "summon":
      glide(hoverPoint, 2);
      if (q.phaseT < dt * 1.5) {
        const n = q.enraged ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.5;
          q.spawn.push({ key: q.nextBee++, x: q.x, y: q.y + 20 * s, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, age: 0 });
        }
      }
      if (q.phaseT >= SUMMON_TIME) setPhase(q, "hover");
      break;
    case "dying": {
      q.vy += 900 * dt;
      q.y += q.vy * dt;
      q.alpha = Math.max(0, 1 - q.phaseT / DYING_TIME);
      if (Math.floor(q.phaseT * 6) !== Math.floor((q.phaseT - dt) * 6)) ev.bursts.push({ x: q.x + (ctx.random() - 0.5) * 80 * s, y: q.y + (ctx.random() - 0.5) * 60 * s, color: "#ffd24a", size: 30 * s });
      if (q.phaseT >= DYING_TIME) {
        setPhase(q, "gone");
        ev.defeated = true;
        ev.gone = true;
        ev.messages.push("Queen Bee has been defeated!");
      }
      break;
    }
    case "leaving":
      q.y -= 500 * dt;
      q.alpha = Math.max(0, 1 - q.phaseT / 1.2);
      q.stingers = [];
      if (q.phaseT >= 1.2) {
        setPhase(q, "gone");
        ev.gone = true;
      }
      break;
    case "gone":
      break;
  }

  // Stingers.
  const keep: Stinger[] = [];
  for (const st of q.stingers) {
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    st.ttl -= dt;
    if (target && circleHitsRect(st.x, st.y, st.r, target)) {
      ev.hits.push({ amount: q.tuning.stinger, fromX: st.x });
      continue;
    }
    if (st.ttl > 0 && st.x > -40 && st.x < ctx.bounds.width + 40 && st.y < ctx.bounds.height + 40) keep.push(st);
  }
  q.stingers = keep;
  return ev;
}

/** A summoned bee chases the target, wobbling. */
export function stepBeeling(b: Beeling, dt: number, target: { x: number; y: number } | null, speed: number) {
  b.age += dt;
  if (target) {
    const a = Math.atan2(target.y - b.y, target.x - b.x) + Math.sin(b.age * 7 + b.key) * 0.6;
    const v = 210 * speed;
    b.vx += (Math.cos(a) * v - b.vx) * Math.min(1, dt * 3);
    b.vy += (Math.sin(a) * v - b.vy) * Math.min(1, dt * 3);
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

export const BEE_RADIUS = 9;
export const BEE_LIFETIME = 14;

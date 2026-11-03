// The base Needle and Thread for Silksong Controls: directional strikes (side / up / down-pogo), a
// charge-and-release Needle Strike, and a silk Spin paid for with the silk meter (filled by
// landing hits). Pure logic; damage is applied by the combat sim, visuals by silk/render.ts.

import type { Rect } from "../combat/geometry";
import type { Body, Dir } from "../engine/physics";

export type NeedleKind = "side" | "up" | "down" | "diag" | "dive" | "slam" | "charged" | "spin";

/** Seconds per attack, its active (hitting) window as fractions, and damage. */
export const NEEDLE: Record<NeedleKind, { duration: number; activeFrom: number; activeTo: number; damage: number }> = {
  side: { duration: 0.24, activeFrom: 0.2, activeTo: 0.6, damage: 13 },
  up: { duration: 0.24, activeFrom: 0.2, activeTo: 0.6, damage: 13 },
  down: { duration: 0.26, activeFrom: 0.15, activeTo: 0.7, damage: 13 },
  // Diagonal pogo: strike down-and-forward in the air.
  diag: { duration: 0.26, activeFrom: 0.12, activeTo: 0.72, damage: 13 },
  // Dive: a fast 45° plunge, live the whole way down (ends on landing or a hit).
  dive: { duration: 1.4, activeFrom: 0.03, activeTo: 1, damage: 18 },
  // Landing slam after a dive (shockwave at the feet), then a short recovery.
  slam: { duration: 0.28, activeFrom: 0, activeTo: 0.35, damage: 15 },
  charged: { duration: 0.34, activeFrom: 0.15, activeTo: 0.75, damage: 39 },
  spin: { duration: 0.6, activeFrom: 0.05, activeTo: 0.95, damage: 9 },
};
export const NEEDLE_COOLDOWN = 0.3;
/** Hold attack this long, then release, for a charged Needle Strike. */
export const CHARGE_TIME = 0.55;
export const MAX_SILK = 9;
export const SPIN_COST = 3;
/** Bounce speed after a down-strike hits something. */
export const POGO_VELOCITY = 620;
/** The charged strike lunges forward this fast while active. */
export const LUNGE_SPEED = 520;
/** Dive velocity components (px/s): fast, 45° down-forward. */
export const DIVE_SPEED = 860;
/** Forward carry after a diagonal pogo / dive bounce. */
export const POGO_CARRY = 200;
/** Minimum time between pogo bounces (so one hit can't chain bounces every frame). */
export const POGO_COOLDOWN = 0.12;

export interface NeedleAttack {
  kind: NeedleKind;
  t: number;
  dir: Dir;
  /** Each attack hits a given target once (spin ticks every 0.15 s). */
  hitIds: number[];
  tick: number;
  struckPointer: boolean;
  /** A pogo strike bounces at most once. */
  bounced?: boolean;
}

export interface NeedleState {
  attack: NeedleAttack | null;
  cd: number;
  holdT: number;
  holding: boolean;
  silk: number;
}

export const initialNeedle = (): NeedleState => ({ attack: null, cd: 0, holdT: 0, holding: false, silk: 3 });

export interface NeedleInput {
  attackHeld: boolean;
  attackPressed: boolean;
  threadPressed: boolean;
  /** Dive pressed (its own key, or dash while holding down in the air). */
  divePressed?: boolean;
  up: boolean;
  down: boolean;
  /** Left or right is held (down + a direction in the air is the diagonal pogo). */
  sideways?: boolean;
  grounded: boolean;
  facing: Dir;
}

/**
 * Which strike a press makes: up if holding up; in the air, down + left/right is the diagonal
 * pogo and plain down the straight pogo; otherwise a side strike.
 */
export function strikeKind(inp: Pick<NeedleInput, "up" | "down" | "grounded" | "sideways">): NeedleKind {
  if (inp.up) return "up";
  if (inp.down && !inp.grounded) return inp.sideways ? "diag" : "down";
  return "side";
}

/** Strikes that bounce the character when they connect. */
export const isPogo = (kind: NeedleKind) => kind === "down" || kind === "diag" || kind === "dive";

/** Start a strike directly (a Terraria sword's pogo strike in Silksong Controls). */
export function startStrike(s: NeedleState, kind: NeedleKind, dir: Dir): NeedleState {
  return start(s, kind, dir);
}

/**
 * The top of a surface a pogo strike's hitbox touches below the character, or null. Only counts
 * surfaces the character is above and not already standing on (so landing never double-bounces).
 */
export function pogoSurface(rect: Rect, body: Pick<Body, "x" | "y" | "w" | "h" | "grounded">, platforms: readonly { left: number; right: number; top: number }[]): number | null {
  if (body.grounded) return null;
  const feet = body.y + body.h;
  for (const p of platforms) {
    if (p.right < rect.x || p.left > rect.x + rect.w) continue;
    if (p.top < feet + 4 || p.top > rect.y + rect.h) continue;
    return p.top;
  }
  return null;
}

function start(s: NeedleState, kind: NeedleKind, dir: Dir): NeedleState {
  return { ...s, attack: { kind, t: 0, dir, hitIds: [], tick: 0, struckPointer: false }, cd: NEEDLE_COOLDOWN };
}

/** Advance the Needle; returns the new state and the attack started this step (if any). */
export function needleStep(s0: NeedleState, inp: NeedleInput, dt: number): { state: NeedleState; started: NeedleKind | null } {
  let s: NeedleState = { ...s0, cd: Math.max(0, s0.cd - dt) };
  if (s.attack) {
    const a = { ...s.attack, t: s.attack.t + dt };
    s.attack = a.t >= NEEDLE[a.kind].duration ? null : a;
  }
  let started: NeedleKind | null = null;
  const free = !s.attack;
  // Thread: the silk Spin.
  if (inp.divePressed && free && !inp.grounded) {
    s = start(s, "dive", inp.facing);
    started = "dive";
  } else if (inp.threadPressed && free && s.silk >= SPIN_COST) {
    s = { ...start(s, "spin", inp.facing), silk: s.silk - SPIN_COST };
    started = "spin";
  } else if (inp.attackPressed && free && s.cd <= 0) {
    const kind = strikeKind(inp);
    s = start(s, kind, inp.facing);
    started = kind;
  }
  // Charge: holding attack builds it up; releasing after CHARGE_TIME unleashes the Needle Strike.
  if (inp.attackPressed) s = { ...s, holding: true, holdT: 0 };
  if (s.holding && inp.attackHeld) s = { ...s, holdT: s.holdT + dt };
  if (s.holding && !inp.attackHeld) {
    const charged = s.holdT >= CHARGE_TIME;
    s = { ...s, holding: false, holdT: 0 };
    if (charged && !s.attack) {
      s = start(s, "charged", inp.facing);
      started = "charged";
    }
  }
  return { state: s, started };
}

/** End a dive in its landing slam (the shockwave at the feet, then recovery). */
export function landDive(s: NeedleState): NeedleState {
  if (s.attack?.kind !== "dive") return s;
  return start(s, "slam", s.attack.dir);
}

/** 0..1 charge level while holding (for the glow). */
export const chargeLevel = (s: NeedleState) => (s.holding ? Math.min(1, s.holdT / CHARGE_TIME) : 0);

/** True while the attack's hitbox is live. */
export function isActive(a: NeedleAttack): boolean {
  const spec = NEEDLE[a.kind];
  const p = a.t / spec.duration;
  return p >= spec.activeFrom && p <= spec.activeTo;
}

/** Hitbox (CSS px) for an attack from `body`. `scale` is the character's pixel scale. */
export function needleHitbox(a: Pick<NeedleAttack, "kind" | "dir">, body: Pick<Body, "x" | "y" | "w" | "h">, scale: number, reachMul = 1): Rect {
  const cx = body.x + body.w / 2;
  const cy = body.y + body.h * 0.45;
  const reach = 26 * scale * reachMul;
  const thick = 14 * scale;
  switch (a.kind) {
    case "side":
      return { x: a.dir > 0 ? body.x + body.w : body.x - reach, y: cy - thick / 2, w: reach, h: thick };
    case "up":
      return { x: cx - thick / 2 - 4 * scale, y: body.y - reach, w: thick + 8 * scale, h: reach };
    case "down":
      return { x: cx - thick / 2 - 4 * scale, y: body.y + body.h, w: thick + 8 * scale, h: reach };
    case "diag": {
      // Down-and-forward square from the hips past the toes.
      const r = reach * 0.85;
      return { x: a.dir > 0 ? cx : cx - r, y: body.y + body.h * 0.7, w: r, h: r };
    }
    case "dive": {
      // The leading corner of the plunge (the needle points down-forward).
      const r = 18 * scale;
      return { x: a.dir > 0 ? cx : cx - r * 1.6, y: body.y + body.h * 0.55, w: r * 1.6, h: body.h * 0.45 + r };
    }
    case "slam": {
      // Shockwave along the ground on both sides.
      const half = 30 * scale;
      return { x: cx - half, y: body.y + body.h - 10 * scale, w: half * 2, h: 12 * scale };
    }
    case "charged": {
      const long = reach * 2.2;
      return { x: a.dir > 0 ? body.x + body.w : body.x - long, y: cy - thick * 0.6, w: long, h: thick * 1.2 };
    }
    case "spin": {
      const r = 34 * scale;
      return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    }
  }
}

/** Land a hit: fills silk (capped). */
export function gainSilk(s: NeedleState, hits: number): NeedleState {
  return hits > 0 ? { ...s, silk: Math.min(MAX_SILK, s.silk + hits) } : s;
}

/** Strike power for the Letter Destroyer (bigger smash for stronger moves). */
export function destroyerPower(kind: NeedleKind): number {
  return kind === "spin" ? 3 : kind === "charged" || kind === "dive" || kind === "slam" ? 2 : 1;
}

export const rectContains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

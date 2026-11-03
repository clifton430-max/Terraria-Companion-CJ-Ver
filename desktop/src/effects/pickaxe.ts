// The pickaxe strike: an impact burst where the swing lands. When the pointer is within reach, the
// strike is also sent to the Letter Destroyer bookmarklet, which knocks the real letters under the
// pointer off the webpage (the page does that itself; the companion never reads the screen).

import type { Vec } from "../combat/geometry";
import { IMPACT_PROGRESS } from "../combat/pickaxeAnim";

/** Pointer distance (CSS px) from the swinging hand that counts as "within reach". */
export const PICKAXE_REACH = 340;
/** Impact ring lifetime (seconds). */
export const IMPACT_DURATION = 0.35;
/** Dust from a strike stays a little longer (it falls). */
export const DUST_DURATION = 0.7;
/** An impact is kept until both its ring and its dust are done. */
export const IMPACT_LIFETIME = Math.max(IMPACT_DURATION, DUST_DURATION);
const DUST_GRAVITY = 1100;
const DUST_COLORS = ["#fff3b0", "#d8b48a", "#a87a4a", "#ffffff"];
export const MAX_IMPACTS = 8;

/** Swing progress (0..1) at which the head connects (the Terraria-style strike point). */
export const IMPACT_AT = IMPACT_PROGRESS;

/** True on the step where the swing passes the impact point. */
export function crossedImpact(prevProgress: number, progress: number): boolean {
  return prevProgress < IMPACT_AT && progress >= IMPACT_AT;
}

export interface ImpactTarget {
  point: Vec;
  /** The pointer is within reach: the strike goes to the Letter Destroyer. Otherwise only the burst shows. */
  eligible: boolean;
}

/** Where the swing lands: the pointer if it's within reach of the hand, else the pickaxe head. */
export function impactTarget(hand: Vec, head: Vec, pointer: Vec | null, reach = PICKAXE_REACH): ImpactTarget {
  if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y) && Math.hypot(pointer.x - hand.x, pointer.y - hand.y) <= reach) {
    return { point: { ...pointer }, eligible: true };
  }
  return { point: { ...head }, eligible: false };
}

export interface Impact {
  x: number;
  y: number;
  t: number;
  eligible: boolean;
  /** Pickaxe power (bigger burst for stronger pickaxes). */
  power: number;
}

/** Pointer reach for a pickaxe of `power` (stronger pickaxes reach farther). */
export function reachFor(power: number): number {
  return PICKAXE_REACH * (1 + 0.25 * (Math.max(1, power) - 1));
}

/**
 * How far from the hand a swing may strike the pointer. Swings the user triggers (a click or hold
 * in Control mode, F, the dock, Silksong attacks) strike wherever the pointer is, like Terraria's
 * cursor mining with unlimited range; automatic swings (roam, training) keep the pickaxe's reach.
 */
export function strikeReach(manual: boolean, power: number): number {
  return manual ? Infinity : reachFor(power);
}

/** Short-lived impact bursts; always cleaned up, capped in number. */
export class ImpactBursts {
  private list: Impact[] = [];

  get impacts(): readonly Impact[] {
    return this.list;
  }

  add(target: ImpactTarget, power = 1) {
    this.list.push({ x: target.point.x, y: target.point.y, t: 0, eligible: target.eligible, power: Math.max(1, power) });
    if (this.list.length > MAX_IMPACTS) this.list.shift();
  }

  step(dt: number) {
    for (const i of this.list) i.t += dt;
    this.list = this.list.filter((i) => i.t < IMPACT_LIFETIME);
  }

  stop() {
    this.list = [];
  }
}

export interface DustBit {
  x: number;
  y: number;
  size: number;
  alpha: number;
  color: string;
}

/**
 * Terraria-style square dust thrown up by a strike, at the impact's current age. Deterministic
 * (seeded by the impact position) so it doesn't flicker between frames. More, faster dust for
 * stronger pickaxes and for strikes that hit the pointer target.
 */
export function strikeDust(i: Impact): DustBit[] {
  if (i.t >= DUST_DURATION) return [];
  let seed = (Math.floor(i.x * 73856093) ^ Math.floor(i.y * 19349663)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = (i.eligible ? 8 : 4) * Math.max(1, i.power);
  const speed = 160 * Math.sqrt(Math.max(1, i.power));
  const alpha = 1 - i.t / DUST_DURATION;
  const out: DustBit[] = [];
  for (let k = 0; k < count; k++) {
    // Upper half-circle, biased upward, like debris knocked off a block.
    const a = -Math.PI * (0.1 + 0.8 * rand());
    const v = speed * (0.55 + 0.9 * rand());
    out.push({
      x: i.x + Math.cos(a) * v * i.t,
      y: i.y + Math.sin(a) * v * i.t + 0.5 * DUST_GRAVITY * i.t * i.t,
      size: 3 + Math.floor(rand() * 3),
      alpha,
      color: DUST_COLORS[Math.floor(rand() * DUST_COLORS.length) % DUST_COLORS.length],
    });
  }
  return out;
}

/** Afterimages behind a swinging pickaxe: earlier swing positions, fading out. */
export function swingGhosts(progress: number): { progress: number; alpha: number }[] {
  if (!(progress > 0) || progress >= 1) return [];
  return [
    { progress: progress - 0.05, alpha: 0.35 },
    { progress: progress - 0.1, alpha: 0.2 },
    { progress: progress - 0.15, alpha: 0.1 },
  ].filter((g) => g.progress >= 0);
}

// Plans a jump from the current position onto another platform, using the same
// gravity and air drag as the physics engine so the arc actually lands there.

import {
  DEFAULT_PHYSICS,
  step,
  type Body,
  type Bounds,
  type PhysicsConfig,
  type Platform,
  isWalkable,
} from "./physics";
import type { Rng } from "./behavior";

export interface JumpPlan {
  targetId: number;
  /** Upward launch speed (px/s, positive). */
  vy: number;
  /** Horizontal launch speed (px/s). */
  vx: number;
}

/** Extra height above the target edge so the feet clear it before descending. */
export const JUMP_CLEARANCE = 32;
/** Furthest horizontal distance (CSS px) the companion will try to jump. */
export const MAX_JUMP_DISTANCE = 480;
/** Deepest drop (CSS px) the companion will deliberately jump down to. */
export const MAX_JUMP_DROP = 420;
/** Apex increase (px) per attempt when a low arc would need too much horizontal speed. */
const APEX_STEP = 40;
/** Keep the landing point this far inside a segment's ends. */
const EDGE_MARGIN = 10;

/**
 * Launch velocities for reaching `target`, or null if it is out of range or the arc
 * would hit the ceiling. Exported for testing; most callers want `planJump`.
 */
export function solveJump(
  body: Body,
  target: Platform,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
): JumpPlan | null {
  const bottom = body.y + body.h;
  const rise = bottom - target.top; // > 0 when the target is higher
  if (rise < -MAX_JUMP_DROP) return null;

  // Aim the body centre at a point on the segment, preferring the nearest safe spot.
  const footWidth = body.w * (1 - 2 * cfg.footInset);
  const lo = target.left + footWidth / 2 + EDGE_MARGIN;
  const hi = target.right - footWidth / 2 - EDGE_MARGIN;
  const center = body.x + body.w / 2;
  const aim = lo <= hi ? Math.min(Math.max(center, lo), hi) : (target.left + target.right) / 2;
  const dx = aim - center;
  if (Math.abs(dx) > MAX_JUMP_DISTANCE) return null;
  // A platform directly below is reached by walking off, not jumping.
  if (rise <= 0 && Math.abs(dx) < footWidth) return null;

  // Start with the lowest arc that clears the edge; if that needs too much horizontal
  // speed, loft it higher for more flight time.
  const g = cfg.gravity;
  const k = cfg.airDrag;
  for (let apex = Math.max(rise, 0) + JUMP_CLEARANCE; ; apex += APEX_STEP) {
    if (body.y - apex < 0) return null; // would bonk the ceiling
    const vy = Math.sqrt(2 * g * apex);
    if (vy > cfg.maxJumpVelocity) return null;
    // Time until the descending arc reaches the target top: rise = vy·t − g·t²/2.
    const time = (vy + Math.sqrt(vy * vy - 2 * g * rise)) / g;
    // Horizontal motion with exponential drag k: x(t) = vx·(1 − e^(−k·t)) / k.
    const vx = k > 0 ? (dx * k) / (1 - Math.exp(-k * time)) : dx / time;
    if (Math.abs(vx) <= cfg.maxJumpVx) return { targetId: target.id, vy, vx };
  }
}

/** Simulation settings used to check a planned arc before committing to it. */
const VERIFY_DT = 1 / 60;
const VERIFY_SECONDS = 3;

/**
 * Fly a planned jump through the real physics against every platform and report which
 * platform (window id) it lands on, or null for the floor. This catches arcs that would
 * clip the starting window or land on a window in between.
 */
export function simulateJump(
  body: Body,
  plan: JumpPlan,
  platforms: readonly Platform[],
  bounds: Bounds,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
): number | null {
  let b = body;
  let intent = { move: 0 as const, jump: true, jumpVelocity: plan.vy, jumpVx: plan.vx };
  for (let t = 0; t < VERIFY_SECONDS; t += VERIFY_DT) {
    const r = step(b, intent, VERIFY_DT, bounds, cfg, platforms);
    b = r.body;
    if (r.landed) return b.platformId;
    intent = { move: 0, jump: false, jumpVelocity: plan.vy, jumpVx: plan.vx };
  }
  return null;
}

export interface JumpChoice {
  /** Surfaces to avoid if there's any alternative (where the others are standing, for "spread"). */
  avoid?: ReadonlySet<number>;
  /** Only jump down ("stay grounded"). */
  downOnly?: boolean;
}

/** Every platform reachable from here with a verified jump. */
function reachable(body: Body, platforms: readonly Platform[], bounds: Bounds, cfg: PhysicsConfig, keep: (p: Platform) => boolean = () => true): { plan: JumpPlan; p: Platform }[] {
  const out: { plan: JumpPlan; p: Platform }[] = [];
  for (const p of platforms) {
    if (p.id === body.platformId || !isWalkable(p) || !keep(p)) continue;
    if (p.top - body.h < 0 || p.top >= bounds.height) continue;
    const plan = solveJump(body, p, cfg);
    if (plan && simulateJump(body, plan, platforms, bounds, cfg) === p.id) out.push({ plan, p });
  }
  return out;
}

/** Pick a reachable platform (other than the one stood on) and plan a verified jump to it. */
export function planJump(
  body: Body,
  platforms: readonly Platform[],
  bounds: Bounds,
  rng: Rng,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
  recent: readonly number[] = [],
  choice: JumpChoice = {},
): JumpPlan | null {
  if (!body.grounded) return null;
  const feet = body.y + body.h;
  let options = reachable(body, platforms, bounds, cfg, (p) => !choice.downOnly || p.top > feet + 4).map((o) => o.plan);
  if (options.length === 0) return null;
  if (choice.avoid?.size) {
    const free = options.filter((o) => !choice.avoid!.has(o.targetId));
    if (free.length) options = free;
  }
  // Curiosity: prefer surfaces not visited recently, when there's a choice.
  const fresh = options.filter((o) => !recent.includes(o.targetId));
  const pool = fresh.length > 0 ? fresh : options;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * A jump that makes progress toward `target` (the hangout): straight onto it when reachable,
 * otherwise onto the reachable surface closest to it, if that is closer than where we stand.
 */
export function planJumpToward(body: Body, target: Platform, platforms: readonly Platform[], bounds: Bounds, cfg: PhysicsConfig = DEFAULT_PHYSICS): JumpPlan | null {
  if (!body.grounded || body.platformId === target.id) return null;
  const options = reachable(body, platforms, bounds, cfg);
  const direct = options.find((o) => o.p.id === target.id);
  if (direct) return direct.plan;
  const tx = (target.left + target.right) / 2;
  const gap = (top: number, x: number) => Math.abs(top - target.top) + 0.5 * Math.abs(x - tx);
  const here = gap(body.y + body.h, body.x + body.w / 2);
  let best: { plan: JumpPlan; d: number } | null = null;
  for (const o of options) {
    const d = gap(o.p.top, Math.min(Math.max(tx, o.p.left), o.p.right));
    if (d < here - 20 && (!best || d < best.d)) best = { plan: o.plan, d };
  }
  return best?.plan ?? null;
}

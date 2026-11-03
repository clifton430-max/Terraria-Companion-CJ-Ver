// Summoned minions: follow the character and dart at training dummies within range.

import type { Rect, Vec } from "./geometry";
import type { MinionSpec } from "./weapons";

export interface Minion {
  id: number;
  weaponId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetId: number | null;
  /** Seconds until this minion may hit each dummy again, keyed by dummy id. */
  hitCooldowns: Record<number, number>;
  age: number;
}

export interface MinionTarget {
  id: number;
  rect: Rect;
}

export interface MinionContext {
  /** Where the minion idles (beside the character's head). */
  anchor: Vec;
  /** Character centre; targets are chosen within `spec.range` of it. */
  owner: Vec;
  targets: readonly MinionTarget[];
}

/** Steering responsiveness (1/s). */
const ACCEL = 8;
/** Distance (px) beyond which a minion teleports back to its anchor. */
const LEASH = 1000;
/** Extra px around a dummy that counts as contact. */
const CONTACT_PAD = 6;

const centerOf = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function chooseTarget(m: Minion, spec: MinionSpec, ctx: MinionContext): MinionTarget | null {
  const current = ctx.targets.find((t) => t.id === m.targetId);
  if (current && dist(centerOf(current.rect), ctx.owner) <= spec.range * 1.25) return current;
  let best: MinionTarget | null = null;
  let bestDist = spec.range;
  for (const t of ctx.targets) {
    const d = dist(centerOf(t.rect), ctx.owner);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Advance a minion by `dt`. Returns the id of a dummy it struck this step, or null.
 * Deterministic: depends only on its inputs.
 */
export function stepMinion(m: Minion, spec: MinionSpec, dt: number, ctx: MinionContext): number | null {
  m.age += dt;
  for (const key of Object.keys(m.hitCooldowns)) {
    const id = Number(key);
    m.hitCooldowns[id] = Math.max(0, m.hitCooldowns[id] - dt);
  }

  if (dist(m, ctx.anchor) > LEASH) {
    m.x = ctx.anchor.x;
    m.y = ctx.anchor.y;
    m.vx = m.vy = 0;
  }

  const target = chooseTarget(m, spec, ctx);
  m.targetId = target ? target.id : null;
  const goal = target ? centerOf(target.rect) : ctx.anchor;

  // Arrive behaviour: full speed when far, slowing near the goal.
  const dx = goal.x - m.x;
  const dy = goal.y - m.y;
  const d = Math.hypot(dx, dy);
  const speed = target ? spec.speed : Math.min(spec.speed, d * 6);
  const wantX = d > 1e-6 ? (dx / d) * speed : 0;
  const wantY = d > 1e-6 ? (dy / d) * speed : 0;
  const k = Math.min(1, ACCEL * dt);
  m.vx += (wantX - m.vx) * k;
  m.vy += (wantY - m.vy) * k;
  m.x += m.vx * dt;
  m.y += m.vy * dt;

  if (!target) return null;
  const r = target.rect;
  const touching =
    m.x >= r.x - CONTACT_PAD &&
    m.x <= r.x + r.w + CONTACT_PAD &&
    m.y >= r.y - CONTACT_PAD &&
    m.y <= r.y + r.h + CONTACT_PAD;
  if (!touching || (m.hitCooldowns[target.id] ?? 0) > 0) return null;

  m.hitCooldowns[target.id] = spec.hitCooldown;
  // Bounce away so the next strike is a fresh dash.
  const away = d > 1e-6 ? -1 / d : 0;
  m.vx = dx * away * spec.speed * 0.6;
  m.vy = dy * away * spec.speed * 0.6 - spec.speed * 0.3;
  return target.id;
}

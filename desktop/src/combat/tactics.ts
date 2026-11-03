// Companion combat AI for the boss simulator (pure). Reads the threats the sim actually knows
// about (boss bodies and dashes, Moon Lord shots and Deathray, Queen Bee charges, stingers and
// bees), predicts where they'll be, and decides where each companion should be: dodging when
// something is about to hit, keeping its weapon's range, backing off right after striking, and
// spreading companions out into separate slots so they don't stack up. This only knows the sim's
// state; there is no connection to a real Terraria game.

import { bossCircle, isBossActive } from "./boss";
import { rayLine } from "./moonlord";
import { BEE_RADIUS, QB_RADIUS } from "./queenbee";
import { SERVANT_RADIUS, servantCircle } from "./boss";
import type { CombatState } from "./sim";

type Bounds = { width: number; height: number };
type Dir = 1 | -1;

export type Threat =
  | { kind: "orb"; x: number; y: number; r: number; vx: number; vy: number }
  | { kind: "ray"; ax: number; ay: number; bx: number; by: number; width: number; warn: boolean }
  | { kind: "lane"; y: number; half: number; warn: boolean };

/** Everything currently dangerous in the sim. */
export function threatsOf(state: CombatState, bounds: Bounds): Threat[] {
  const out: Threat[] = [];
  const b = state.boss;
  if (b && isBossActive(b)) {
    const c = bossCircle(b);
    out.push({ kind: "orb", x: c.x, y: c.y, r: c.r, vx: b.vx, vy: b.vy });
    for (const { s } of state.servants) {
      const sc = servantCircle(s, b.scale);
      out.push({ kind: "orb", x: sc.x, y: sc.y, r: sc.r || SERVANT_RADIUS, vx: s.vx, vy: s.vy });
    }
  }
  const m = state.moonLord;
  if (m) {
    for (const sh of m.shots) out.push({ kind: "orb", x: sh.x, y: sh.y, r: sh.r, vx: sh.delay && sh.delay > 0 ? 0 : sh.vx, vy: sh.delay && sh.delay > 0 ? 0 : sh.vy });
    const ray = rayLine(m, bounds);
    if (ray && m.ray) out.push({ kind: "ray", ax: ray.from.x, ay: ray.from.y, bx: ray.to.x, by: ray.to.y, width: ray.width, warn: m.ray.warn > 0 });
  }
  const q = state.queenBee;
  if (q) {
    out.push({ kind: "orb", x: q.x, y: q.y, r: QB_RADIUS * q.scale, vx: q.vx, vy: q.vy });
    if (q.charge) out.push({ kind: "lane", y: q.charge.y, half: QB_RADIUS * q.scale, warn: q.charge.warn > 0 });
    for (const st of q.stingers) out.push({ kind: "orb", x: st.x, y: st.y, r: st.r, vx: st.vx, vy: st.vy });
    for (const { b: bee } of state.bees) out.push({ kind: "orb", x: bee.x, y: bee.y, r: BEE_RADIUS * q.scale, vx: bee.vx, vy: bee.vy });
  }
  return out;
}

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

export interface Danger {
  /** 0 = safe … 1 = about to be hit. */
  level: number;
  /** Which way to go to get clear (unit vector). */
  escape: { x: number; y: number };
}

/** How soon something will hit a body at (x, y) with radius r, and which way to dodge. */
export function danger(x: number, y: number, r: number, threats: readonly Threat[], horizon = 0.8): Danger {
  let level = 0;
  let ex = 0;
  let ey = 0;
  for (const t of threats) {
    if (t.kind === "orb") {
      for (let s = 0; s <= horizon; s += 0.1) {
        const px = t.x + t.vx * s;
        const py = t.y + t.vy * s;
        const d = Math.hypot(px - x, py - y);
        if (d < t.r + r + 14) {
          const l = 1 - s / (horizon + 0.1);
          if (l > level) level = l;
          // Sidestep across the threat's path (or straight away if it's not moving).
          const sp = Math.hypot(t.vx, t.vy);
          if (sp > 30) {
            const nx = -t.vy / sp;
            const ny = t.vx / sp;
            const side = (x - px) * nx + (y - py) * ny >= 0 ? 1 : -1;
            ex += nx * side * l;
            ey += ny * side * l;
          } else {
            ex += ((x - px) / (d || 1)) * l;
            ey += ((y - py) / (d || 1)) * l;
          }
          break;
        }
      }
    } else if (t.kind === "ray") {
      const d = segDist(x, y, t.ax, t.ay, t.bx, t.by);
      if (d < t.width / 2 + r + 30) {
        const l = t.warn ? 0.7 : 1;
        level = Math.max(level, l);
        // Away from the beam line, perpendicular to it.
        const dx = t.bx - t.ax;
        const dy = t.by - t.ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const side = (x - t.ax) * nx + (y - t.ay) * ny >= 0 ? 1 : -1;
        ex += nx * side * l;
        ey += ny * side * l;
      }
    } else if (Math.abs(y - t.y) < t.half + r + 10) {
      // A charge lane: get above or below it.
      const l = t.warn ? 0.75 : 1;
      level = Math.max(level, l);
      ey += (y < t.y ? -1 : 1) * l;
    }
  }
  const len = Math.hypot(ex, ey);
  return { level, escape: len > 0 ? { x: ex / len, y: ey / len } : { x: 0, y: 0 } };
}

export interface TacticInput {
  /** Companion body centre and radius. */
  x: number;
  y: number;
  r: number;
  grounded: boolean;
  /** Target centre (boss / nearest enemy), or null. */
  target: { x: number; y: number } | null;
  threats: readonly Threat[];
  /** Preferred attack distance for the weapon (px). */
  range: number;
  melee: boolean;
  /** This companion's slot and how many companions are fighting. */
  slot: number;
  slots: number;
  canFly: boolean;
  bounds: Bounds;
  /** Seconds since this companion last struck. */
  sinceStrike: number;
}

export interface TacticOutput {
  mode: "idle" | "dodge" | "approach" | "attack" | "reposition";
  /** Where to go. */
  goal: { x: number; y: number };
  fly: boolean;
  jump: boolean;
  attack: boolean;
  face: Dir;
}

/** Slot offset around the target: alternate sides, further out for each extra companion. */
export function slotOffset(slot: number, slots: number, range: number, melee: boolean): { dx: number; dy: number } {
  const side = slot % 2 === 0 ? -1 : 1;
  const ring = Math.floor(slot / 2);
  const spread = slots > 1 ? 1 + ring * 0.45 : 1;
  return { dx: side * range * (melee ? 0.75 : 0.95) * spread, dy: melee ? 0 : -60 - ring * 45 };
}

export function tactic(i: TacticInput): TacticOutput {
  const face: Dir = i.target && i.target.x < i.x ? -1 : 1;
  if (!i.target) return { mode: "idle", goal: { x: i.x, y: i.y }, fly: false, jump: false, attack: false, face };
  const d = danger(i.x, i.y, i.r, i.threats);
  const fly = i.canFly;
  const clampGoal = (g: { x: number; y: number }) => ({
    x: Math.min(Math.max(g.x, i.r), i.bounds.width - i.r),
    y: Math.min(Math.max(g.y, i.r + 20), i.bounds.height - i.r),
  });
  if (d.level > 0.35) {
    const away = 140 + 120 * d.level;
    const goal = clampGoal({ x: i.x + d.escape.x * away, y: i.y + (fly ? d.escape.y * away : 0) });
    // On the ground, jump over low threats coming in sideways.
    const jump = !fly && i.grounded && (Math.abs(d.escape.y) > 0.5 || d.level > 0.75);
    return { mode: "dodge", goal, fly, jump, attack: d.level < 0.6, face };
  }
  const dist = Math.hypot(i.target.x - i.x, i.target.y - i.y);
  // Right after a strike, melee fighters hop back out of reach.
  if (i.melee && i.sinceStrike < 0.35) {
    const goal = clampGoal({ x: i.x - face * 110, y: fly ? i.y - 40 : i.y });
    return { mode: "reposition", goal, fly, jump: false, attack: false, face };
  }
  const off = slotOffset(i.slot, i.slots, i.range, i.melee);
  const goal = clampGoal({ x: i.target.x + off.dx, y: fly ? i.target.y + off.dy : i.y });
  const inRange = dist <= i.range * 1.15;
  const jump = !fly && i.grounded && i.target.y < i.y - 120 && Math.abs(i.target.x - i.x) < 160;
  return { mode: inRange ? "attack" : "approach", goal, fly, jump, attack: inRange, face };
}

/** Free flight toward a goal (no gravity), capped in speed; returns the new position and velocity. */
export function flyToward(x: number, y: number, vx: number, vy: number, goal: { x: number; y: number }, dt: number, maxSpeed = 420) {
  const tx = (goal.x - x) * 4;
  const ty = (goal.y - y) * 4;
  const k = Math.min(1, dt * 6);
  let nvx = vx + (tx - vx) * k;
  let nvy = vy + (ty - vy) * k;
  const sp = Math.hypot(nvx, nvy);
  if (sp > maxSpeed) {
    nvx = (nvx / sp) * maxSpeed;
    nvy = (nvy / sp) * maxSpeed;
  }
  return { x: x + nvx * dt, y: y + nvy * dt, vx: nvx, vy: nvy };
}

/** The current boss target point (the Moon Lord's vulnerable part, the queen, the Eye), or null. */
export function bossTarget(state: CombatState): { x: number; y: number } | null {
  const vulnerable = state.dummies.filter((d) => d.kind !== undefined && d.kind !== "dummy" && d.respawn <= 0 && d.hp > 0);
  if (!vulnerable.length) return null;
  // Prefer the boss body over minions.
  const main = vulnerable.find((d) => d.kind === "boss" || d.kind === "queen" || d.kind === "moon") ?? vulnerable[0];
  return { x: main.x + main.w / 2, y: main.y + main.h / 2 };
}

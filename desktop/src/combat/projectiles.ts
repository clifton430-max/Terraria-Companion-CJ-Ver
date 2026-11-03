// Projectile movement, homing and aiming. Collision against dummies is resolved in sim.ts
// with the swept test from geometry.ts so fast bullets can't skip over a target.

import type { Vec } from "./geometry";
import type { ProjectileArt } from "./weapons";

export type ProjectileKind = "arrow" | "bullet" | "bolt" | "beam" | "fractal";

/**
 * Out-and-back flight from (sx, sy) to (tx, ty) and back, bowing sideways by `amplitude` —
 * used for Zenith's spectral swords.
 */
export interface FractalPath {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  duration: number;
  side: 1 | -1;
  amplitude: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  weaponId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  damage: number;
  knockback: number;
  crit: number;
  /** Remaining extra targets this projectile may pass through. */
  pierce: number;
  /** Dummy ids already hit (a projectile hits each dummy at most once). */
  hits: number[];
  /** Seconds left before it expires. */
  ttl: number;
  radius: number;
  /** Max turn rate towards `target` in rad/s. */
  homing: number;
  color: string;
  /** Real sprite from the local install, when the weapon defines one. */
  art?: ProjectileArt;
  /** Path-following flight (Zenith swords) instead of free motion. */
  path?: FractalPath;
  /** Bursts when it hits or expires, damaging everything within `radius` px (fireworks). */
  explosive?: { radius: number; damage: number; color: string };
}

/** Position along a fractal path at fraction `f` (0..1): out to the target and back. */
export function fractalPoint(path: FractalPath, f: number): Vec {
  const u = Math.sin(Math.PI * Math.min(Math.max(f, 0), 1));
  const dx = path.tx - path.sx;
  const dy = path.ty - path.sy;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.sin(2 * Math.PI * f) * path.amplitude * path.side;
  return { x: path.sx + dx * u + (-dy / len) * off, y: path.sy + dy * u + (dx / len) * off };
}

/**
 * Advance one projectile by `dt`, turning toward `target` (if homing) and applying gravity.
 * Mutates the projectile and returns its previous position for swept collision.
 */
export function moveProjectile(p: Projectile, dt: number, target: Vec | null): Vec {
  const prev = { x: p.x, y: p.y };
  if (p.path) {
    p.path.t += dt;
    const next = fractalPoint(p.path, p.path.t / p.path.duration);
    p.vx = (next.x - p.x) / Math.max(dt, 1e-6);
    p.vy = (next.y - p.y) / Math.max(dt, 1e-6);
    p.x = next.x;
    p.y = next.y;
    p.ttl -= dt;
    return prev;
  }
  if (p.homing > 0 && target) {
    const speed = Math.hypot(p.vx, p.vy);
    const current = Math.atan2(p.vy, p.vx);
    const wanted = Math.atan2(target.y - p.y, target.x - p.x);
    let delta = wanted - current;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const maxTurn = p.homing * dt;
    const angle = current + Math.min(Math.max(delta, -maxTurn), maxTurn);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
  }
  p.vy += p.gravity * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.ttl -= dt;
  return prev;
}

/**
 * Launch angle (screen radians: 0 = right, positive = downward) that hits a point offset by
 * (dx, dy) at `speed` under downward `gravity`, choosing the flatter of the two arcs.
 * Returns null when the target is out of range.
 */
export function ballisticAngle(dx: number, dy: number, speed: number, gravity: number): number | null {
  if (gravity <= 0) return Math.atan2(dy, dx);
  const x = Math.abs(dx);
  const up = -dy;
  const v2 = speed * speed;
  const disc = v2 * v2 - gravity * (gravity * x * x + 2 * up * v2);
  if (disc < 0 || x < 1e-6) return x < 1e-6 && disc >= 0 ? (up > 0 ? -Math.PI / 2 : Math.PI / 2) : null;
  const theta = Math.atan((v2 - Math.sqrt(disc)) / (gravity * x)); // elevation, up-positive
  return dx >= 0 ? -theta : Math.PI + theta;
}

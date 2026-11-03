// Shared geometry for combat: rectangles, swept segment tests and the character's hand.

import type { Dir } from "../engine/physics";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Vec {
  x: number;
  y: number;
}

export const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Where along the segment (x0,y0)→(x1,y1) it first enters `r` grown by `pad`, as t in [0, 1],
 * or null if it misses. Slab method; a segment starting inside returns 0.
 */
export function segmentHitsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: Rect,
  pad = 0,
): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: [number, number, number, number][] = [
    [x0, x1 - x0, r.x - pad, r.x + r.w + pad],
    [y0, y1 - y0, r.y - pad, r.y + r.h + pad],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let t1 = (lo - p) / d;
    let t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** Arm poses used by attacks; must line up with the attack frames in `engine/sprites.ts`. */
export type HandPose = "point" | "raise";

/** Hand position in sprite pixels for a right-facing 16×24 character. */
const HAND: Record<HandPose, Vec> = {
  point: { x: 14.5, y: 10.5 },
  raise: { x: 14.5, y: 5.5 },
};

/**
 * Geometry of the Terraria-art character (when loaded): hands are measured per pose in atlas cell
 * pixels; the body box starts at (originX, originY) inside a `cellW`-wide cell.
 */
export interface RigGeometry {
  scale: number;
  cellW: number;
  originX: number;
  originY: number;
  hands: Partial<Record<HandPose, Vec>>;
}

export interface PlayerInfo {
  /** Top-left of the character's body box, CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Dir;
  /** CSS px per sprite pixel (weapon art, reach and dummies scale with this). */
  scale: number;
  /** Present when the real Terraria character is drawn; overrides the built-in hand table. */
  rig?: RigGeometry;
}

/** Hand position in CSS px, mirrored when facing left. */
export function handPosition(player: PlayerInfo, pose: HandPose, dir: Dir = player.facing): Vec {
  const rigHand = player.rig?.hands[pose];
  if (player.rig && rigHand) {
    const { scale, cellW, originX, originY } = player.rig;
    const hx = dir > 0 ? rigHand.x : cellW - rigHand.x;
    return { x: player.x + (hx - originX) * scale, y: player.y + (rigHand.y - originY) * scale };
  }
  const hand = HAND[pose];
  const hx = dir > 0 ? hand.x : 16 - hand.x;
  return { x: player.x + hx * player.scale, y: player.y + hand.y * player.scale };
}

export const playerCenter = (p: PlayerInfo): Vec => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });

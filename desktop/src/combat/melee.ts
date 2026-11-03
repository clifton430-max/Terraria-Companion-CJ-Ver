// Sword swing geometry and hit detection.

import type { Dir } from "../engine/physics";
import { segmentHitsRect, type Rect, type Vec } from "./geometry";
import type { SwordDef } from "./weapons";

/** Blade angle (degrees, right-facing convention) at swing progress 0..1, eased out. */
export function swingAngle(def: SwordDef, progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  const eased = def.swingEase === "linear" ? p : 1 - (1 - p) * (1 - p);
  return def.arcFrom + (def.arcTo - def.arcFrom) * eased;
}

/** Blade as a segment from the hand to the tip, mirrored horizontally when facing left. */
export function bladeSegment(hand: Vec, angleDeg: number, dir: Dir, reachPx: number): [Vec, Vec] {
  const a = (angleDeg * Math.PI) / 180;
  const tip = { x: hand.x + Math.cos(a) * reachPx * dir, y: hand.y + Math.sin(a) * reachPx };
  return [hand, tip];
}

export interface MeleeTarget {
  id: number;
  rect: Rect;
}

/** Angular sampling step when sweeping the blade between two frames. */
const SWEEP_STEP_DEG = 5;

/**
 * Targets struck by the blade while it sweeps from progress `p0` to `p1`, limited to the
 * weapon's active window. Each target is reported at most once per swing via `alreadyHit`.
 */
export function swordHits(
  def: SwordDef,
  hand: Vec,
  dir: Dir,
  reachPx: number,
  p0: number,
  p1: number,
  targets: readonly MeleeTarget[],
  alreadyHit: readonly number[],
): number[] {
  const from = Math.max(p0, def.activeFrom);
  const to = Math.min(p1, def.activeTo);
  if (to < from) return [];
  const a0 = swingAngle(def, from);
  const a1 = swingAngle(def, to);
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / SWEEP_STEP_DEG));
  const hit: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const [h, tip] = bladeSegment(hand, a0 + ((a1 - a0) * i) / steps, dir, reachPx);
    for (const t of targets) {
      if (alreadyHit.includes(t.id) || hit.includes(t.id)) continue;
      if (segmentHitsRect(h.x, h.y, tip.x, tip.y, t.rect) !== null) hit.push(t.id);
    }
  }
  return hit;
}

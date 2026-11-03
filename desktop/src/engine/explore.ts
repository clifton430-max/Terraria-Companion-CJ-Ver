// Surface awareness for roaming: how far the character can keep walking along the connected
// surface it's on before reaching a ledge. Follows adjoining segments the same way the physics
// does (small steps up/down between neighbouring segments), so it never "sees" a ledge where the
// character would actually carry on walking.

import { DEFAULT_PHYSICS, STEP_DOWN, STEP_UP, feet, isWalkable, surfaceY, type Body, type Dir, type PhysicsConfig, type Platform } from "./physics";

/** Neighbouring segments whose ends are this close horizontally count as connected. */
const JOIN_GAP = 2;
const MAX_HOPS = 24;

/**
 * Distance (px) from the leading foot to the end of the walkable surface in direction `dir`.
 * Infinity on the floor (the screen edges are handled separately) or when not grounded.
 */
export function ledgeDistance(body: Body, dir: Dir, platforms: readonly Platform[], cfg: PhysicsConfig = DEFAULT_PHYSICS): number {
  if (!body.grounded || body.platformId === null) return Infinity;
  const [fl, fr] = feet(body, cfg);
  const front = dir > 0 ? fr : fl;
  // The segment currently under the leading foot (or the feet) on this window.
  let seg =
    platforms.find((p) => p.id === body.platformId && isWalkable(p) && front >= p.left && front <= p.right) ??
    platforms.find((p) => p.id === body.platformId && isWalkable(p) && fr > p.left && fl < p.right);
  if (!seg) return 0;
  let end = dir > 0 ? seg.right : seg.left;
  let endY = surfaceY(seg, end);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = platforms.find((p) => {
      if (p === seg || !isWalkable(p)) return false;
      const near = dir > 0 ? p.left : p.right;
      const far = dir > 0 ? p.right : p.left;
      if (Math.abs(near - end) > JOIN_GAP || (dir > 0 ? far <= end : far >= end)) return false;
      const y = surfaceY(p, near);
      return y >= endY - STEP_UP && y <= endY + STEP_DOWN;
    });
    if (!next) break;
    seg = next;
    end = dir > 0 ? next.right : next.left;
    endY = surfaceY(next, end);
  }
  return Math.max(0, dir > 0 ? end - front : front - end);
}

/** Window ids landed on recently, newest last (for preferring new places). */
export function rememberVisit(recent: readonly number[], id: number | null, keep = 4): number[] {
  if (id === null) return [...recent];
  return [...recent.filter((r) => r !== id), id].slice(-keep);
}

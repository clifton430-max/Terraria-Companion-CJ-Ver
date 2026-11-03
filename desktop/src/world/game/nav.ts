// Local pathfinding for a Terraria-sized walker (20 px wide, so two columns; 3 rows tall): walking, stepping up
// a block, jumping up to five, falling, and dropping through platforms. A* over standing spots in a
// window around the start, so the waifus find their way out of houses, over hills and out of
// tunnels instead of bumping into walls.

import type { WorldMap } from "../gen";

/** A standing spot: the body fills columns x and x + 1, feet in row y (standing on row y + 1). */
export interface NavNode {
  x: number;
  y: number;
}

const JUMP = 5;
const FALL = 12;

/** Room for a body here (two columns, three rows of air or platform), with something under the feet. */
export function canStand(m: WorldMap, x: number, y: number): boolean {
  return clear(m, x, y) && (m.standable(x, y + 1) || m.standable(x + 1, y + 1)) && m.liquid(x, y) !== 46 && m.liquid(x + 1, y) !== 46;
}

const col = (m: WorldMap, x: number, y: number) => !m.solid(x, y) && !m.solid(x, y - 1) && !m.solid(x, y - 2);
const clear = (m: WorldMap, x: number, y: number) => col(m, x, y) && col(m, x + 1, y);
const solid2 = (m: WorldMap, x: number, y: number) => m.solid(x, y) || m.solid(x + 1, y);

/** Where you land falling down column x from row y (feet row), or null. */
function landing(m: WorldMap, x: number, y: number, drop = false): number | null {
  for (let k = drop ? 1 : 0; k <= FALL; k++) {
    const yy = y + k;
    if (solid2(m, x, yy)) return null;
    if (canStand(m, x, yy) && (k > 0 || !drop)) return yy;
  }
  return null;
}

/**
 * A path from `from` to any spot in column `toX` (and near row `toY` if given), or null.
 * `ok` can forbid spots (e.g. inside builds).
 */
export function findPath(m: WorldMap, from: NavNode, toX: number, toY: number | null, maxNodes = 5000, window = 90): NavNode[] | null {
  const key = (x: number, y: number) => y * 65536 + x;
  const goal = (n: NavNode) => Math.abs(n.x - toX) <= 0 && (toY === null || Math.abs(n.y - toY) <= 3);
  const h = (n: NavNode) => Math.abs(n.x - toX) + (toY === null ? 0 : Math.abs(n.y - toY) * 0.5);
  // She may straddle columns: start from whichever nearby spot really fits her.
  let start = from;
  outer: for (const dy of [0, -1, 1]) for (const dx of [0, -1, 1]) if (canStand(m, from.x + dx, from.y + dy)) {
    start = { x: from.x + dx, y: from.y + dy };
    break outer;
  }
  const open: { n: NavNode; f: number; g: number }[] = [{ n: start, f: h(start), g: 0 }];
  const came = new Map<number, number>();
  const cost = new Map<number, number>([[key(start.x, start.y), 0]]);
  let expanded = 0;
  let best = { n: start, h: h(start) };
  while (open.length && expanded < maxNodes) {
    // Pop the lowest f (small lists: a linear scan is fine).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    expanded++;
    if (goal(cur.n)) return rebuild(came, key, cur.n);
    const hn = h(cur.n);
    if (hn < best.h) best = { n: cur.n, h: hn };
    for (const [nx, ny, c] of neighbours(m, cur.n)) {
      if (Math.abs(nx - from.x) > window || Math.abs(ny - from.y) > window) continue;
      const k = key(nx, ny);
      const g = cur.g + c;
      if (g >= (cost.get(k) ?? Infinity)) continue;
      cost.set(k, g);
      came.set(k, key(cur.n.x, cur.n.y));
      open.push({ n: { x: nx, y: ny }, f: g + h({ x: nx, y: ny }), g });
    }
  }
  // No full path: the closest reachable spot is still progress (if it's actually closer).
  return best.n !== start && best.h < h(start) - 2 ? rebuild(came, key, best.n) : null;
}

function rebuild(came: Map<number, number>, key: (x: number, y: number) => number, end: NavNode): NavNode[] {
  const out: NavNode[] = [end];
  let k = key(end.x, end.y);
  while (came.has(k)) {
    k = came.get(k)!;
    out.push({ x: k % 65536, y: Math.floor(k / 65536) });
  }
  return out.reverse();
}

/** Moves from a standing spot: [x, y, cost]. */
function neighbours(m: WorldMap, n: NavNode): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const dx of [-1, 1]) {
    const x = n.x + dx;
    // Walk (level), step up one, or walk off and fall.
    if (canStand(m, x, n.y)) out.push([x, n.y, 1]);
    else if (canStand(m, x, n.y - 1) && !solid2(m, n.x, n.y - 3)) out.push([x, n.y - 1, 1.5]);
    else if (clear(m, x, n.y)) {
      const y = landing(m, x, n.y);
      if (y !== null) out.push([x, y, 1 + (y - n.y) * 0.3]);
    }
    // Jump up and over (needs headroom above).
    for (let up = 2; up <= JUMP; up++) {
      // Every row the head passes through must be open (not just the top of the arc).
      if (solid2(m, n.x, n.y - 1 - up) || solid2(m, n.x, n.y - 2 - up)) break;
      if (canStand(m, x, n.y - up)) {
        out.push([x, n.y - up, 2 + up]);
        break;
      }
    }
  }
  // Straight up onto a platform (jumping through it).
  for (let up = 2; up <= JUMP; up++) {
    if (solid2(m, n.x, n.y - up - 1) || solid2(m, n.x, n.y - up - 2)) break;
    if ((m.tile(n.x, n.y - up + 1) === 14 || m.tile(n.x + 1, n.y - up + 1) === 14) && canStand(m, n.x, n.y - up)) {
      out.push([n.x, n.y - up, 2 + up]);
      break;
    }
  }
  // Drop through the platform underfoot.
  if ((m.tile(n.x, n.y + 1) === 14 || !m.standable(n.x, n.y + 1)) && (m.tile(n.x + 1, n.y + 1) === 14 || !m.standable(n.x + 1, n.y + 1)) && (m.tile(n.x, n.y + 1) === 14 || m.tile(n.x + 1, n.y + 1) === 14)) {
    const y = landing(m, n.x, n.y + 1, true);
    if (y !== null) out.push([n.x, y, 2]);
  }
  return out;
}

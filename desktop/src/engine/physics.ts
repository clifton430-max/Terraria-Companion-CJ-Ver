// Pure, framework-free movement and collision for the desktop companion.
// Coordinates are overlay CSS pixels; (0, 0) is the top-left of the usable screen
// area and the floor is at y = bounds.height. Other apps' windows contribute one-way
// platforms: horizontal top-edge segments that can be landed on from above only.

export type Dir = -1 | 1;

export interface Bounds {
  width: number;
  height: number;
}

export interface Body {
  /** Top-left corner. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  grounded: boolean;
  facing: Dir;
  /** Window id of the platform being stood on; null when on the floor or airborne. */
  platformId: number | null;
}

/**
 * A one-way walkable segment: by default the visible part of a window's top edge (horizontal).
 * `topRight` makes it a sloped line from (left, top) to (right, topRight). Segments steeper than
 * MAX_WALK_SLOPE can't be stood on.
 */
export interface Platform {
  /** Window id; one window may contribute several segments. */
  id: number;
  left: number;
  right: number;
  /** Surface height at `left` (and everywhere, when `topRight` is absent). */
  top: number;
  /** Surface height at `right` for sloped segments. */
  topRight?: number;
}

/**
 * A vertical boundary from `top` to `bottom` at `x`. It blocks sideways movement for bodies that
 * overlap it vertically; it's never stood on.
 */
export interface Wall {
  id: number;
  x: number;
  top: number;
  bottom: number;
  /**
   * Solid (a placed block's side): blocks in the air too, not just while walking. A grounded body
   * whose feet are within `step` px below its top is lifted onto platform `liftTo` instead
   * (Terraria's one-block auto step).
   */
  solid?: boolean;
  step?: number;
  liftTo?: number;
}

/** Underside of something solid (placed blocks): bodies moving up stop below it. */
export interface Ceiling {
  left: number;
  right: number;
  y: number;
}

/** Steepest walkable slope (rise / run): about 50°. */
export const MAX_WALK_SLOPE = 1.2;
/** Largest step up / down (px) followed while walking, e.g. between adjoining segments. */
export const STEP_UP = 6;
export const STEP_DOWN = 14;

/** Surface height of a segment at `x` (clamped to the segment's ends). */
export function surfaceY(p: Platform, x: number): number {
  if (p.topRight === undefined || p.right <= p.left) return p.top;
  const t = Math.min(1, Math.max(0, (x - p.left) / (p.right - p.left)));
  return p.top + (p.topRight - p.top) * t;
}

/** Rise over run of a segment (0 for horizontal). */
export function slopeOf(p: Platform): number {
  if (p.topRight === undefined || p.right <= p.left) return 0;
  return (p.topRight - p.top) / (p.right - p.left);
}

export const isWalkable = (p: Platform) => Number.isFinite(p.top) && p.right > p.left && Math.abs(slopeOf(p)) <= MAX_WALK_SLOPE;

export interface PhysicsConfig {
  gravity: number;
  maxFallSpeed: number;
  walkSpeed: number;
  jumpVelocity: number;
  /** Horizontal acceleration toward the walk target while grounded (px/s²). */
  groundAccel: number;
  /** Exponential horizontal drag while airborne (1/s). */
  airDrag: number;
  /** Fraction of horizontal speed kept when bouncing off a wall in the air. */
  wallBounce: number;
  maxThrowSpeed: number;
  /** Longest allowed simulation step; larger frame gaps are clamped to avoid tunnelling. */
  maxStep: number;
  /** Fraction of the sprite width trimmed from each side to get the feet span. */
  footInset: number;
  /** Caps for AI-planned jumps (px/s). 1600 px/s reaches ~600 px up, enough for most window tops. */
  maxJumpVelocity: number;
  maxJumpVx: number;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  gravity: 2000,
  maxFallSpeed: 1600,
  walkSpeed: 70,
  jumpVelocity: 560,
  groundAccel: 1400,
  airDrag: 0.5,
  wallBounce: 0.35,
  maxThrowSpeed: 2200,
  maxStep: 1 / 30,
  footInset: 0.3,
  maxJumpVelocity: 1600,
  maxJumpVx: 650,
};

export interface Intent {
  move: -1 | 0 | 1;
  jump: boolean;
  /** Optional launch speed overrides for a planned jump (capped by the config). */
  jumpVelocity?: number;
  jumpVx?: number;
  /** Turn to face this way without moving (e.g. toward a combat target). */
  face?: Dir;
}

export interface StepResult {
  body: Body;
  /** True on the step the body touched the floor after being airborne. */
  landed: boolean;
  /** Downward speed at the moment of landing (0 if not landed). */
  impactSpeed: number;
  /** -1 / 1 when the body was blocked by the left / right edge this step. */
  hitWall: -1 | 0 | 1;
}

const approach = (value: number, target: number, delta: number) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

const clampAbs = (value: number, max: number) => Math.min(Math.max(value, -max), max);

/** Horizontal extent of the feet, which decides whether a platform supports the body. */
export function feet(body: Body, cfg: PhysicsConfig = DEFAULT_PHYSICS): [number, number] {
  return [body.x + body.w * cfg.footInset, body.x + body.w * (1 - cfg.footInset)];
}

const overlapsFeet = (p: Platform, [l, r]: [number, number]) => r > p.left && l < p.right;

/** Tolerance (px) when testing whether the feet started above a platform top. */
const LAND_EPSILON = 0.5;

export function makeBody(x: number, bounds: Bounds, w: number, h: number): Body {
  const body: Body = {
    x,
    y: bounds.height - h,
    vx: 0,
    vy: 0,
    w,
    h,
    grounded: true,
    facing: 1,
    platformId: null,
  };
  return clampToBounds(body, bounds);
}

/** Keep a body inside the bounds without changing its velocity. */
export function clampToBounds(body: Body, bounds: Bounds): Body {
  const maxX = Math.max(0, bounds.width - body.w);
  const maxY = Math.max(0, bounds.height - body.h);
  const x = Math.min(Math.max(body.x, 0), maxX);
  const y = Math.min(Math.max(body.y, 0), maxY);
  const grounded = body.grounded && (body.platformId !== null || y >= maxY);
  return { ...body, x, y, grounded };
}

/**
 * Advance the simulation by `dt` seconds. Returns a new body; the input is not mutated.
 * `platforms` are one-way window tops; omit them for plain floor-and-walls behaviour.
 */
/** Centre of the feet, where slope height is sampled. */
export const footCenter = (body: Body) => body.x + body.w / 2;

/**
 * The segment supporting a grounded body after it moved: the one under its feet whose surface is
 * within a small step of the feet (its own window first, then the nearest height).
 * This is what lets it follow slopes and walk across adjoining segments without falling.
 */
export function findSupport(body: Body, platforms: readonly Platform[], cfg: PhysicsConfig = DEFAULT_PHYSICS): Platform | null {
  const span = feet(body, cfg);
  const footY = body.y + body.h;
  const cx = footCenter(body);
  // Its own window's top is followed at any height (the window may have moved between polls).
  const own = platforms.filter((p) => p.id === body.platformId && isWalkable(p) && overlapsFeet(p, span));
  if (own.length) return own.reduce((a, p) => (Math.abs(surfaceY(p, cx) - footY) < Math.abs(surfaceY(a, cx) - footY) ? p : a));
  let best: Platform | null = null;
  let bestScore = Infinity;
  for (const p of platforms) {
    if (!isWalkable(p) || !overlapsFeet(p, span)) continue;
    const sy = surfaceY(p, cx);
    if (sy < footY - STEP_UP || sy > footY + STEP_DOWN) continue;
    const score = Math.abs(sy - footY);
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export function step(
  input: Body,
  intent: Intent,
  dt: number,
  bounds: Bounds,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
  platforms: readonly Platform[] = [],
  walls: readonly Wall[] = [],
  ceilings: readonly Ceiling[] = [],
): StepResult {
  const t = Math.min(Math.max(dt, 0), cfg.maxStep);
  const b: Body = { ...input };
  const wasGrounded = b.grounded;

  // Horizontal control and jumping.
  if (b.grounded) {
    b.vx = approach(b.vx, intent.move * cfg.walkSpeed, cfg.groundAccel * t);
    if (intent.jump) {
      b.vy = -Math.min(intent.jumpVelocity ?? cfg.jumpVelocity, cfg.maxJumpVelocity);
      if (intent.jumpVx !== undefined) b.vx = clampAbs(intent.jumpVx, cfg.maxJumpVx);
      b.grounded = false;
      b.platformId = null;
    }
  } else {
    b.vx *= Math.exp(-cfg.airDrag * t);
  }
  if (intent.move !== 0) b.facing = intent.move;
  else if (intent.jump && intent.jumpVx) b.facing = intent.jumpVx < 0 ? -1 : 1;
  else if (intent.face) b.facing = intent.face;

  const prevX = b.x;
  b.x += b.vx * t;

  // Side walls.
  let hitWall: -1 | 0 | 1 = 0;
  // Vertical boundaries (e.g. the side of a taller window standing on this top): crossing one
  // while overlapping it vertically is blocked.
  // Walls only stop walking: the body must be grounded with its feet at or above the wall's base
  // (so someone on the floor in front of a window, or mid-jump, isn't blocked by it).
  for (const w of walls) {
    if (!w.solid && !wasGrounded) continue;
    if (!(b.y < w.bottom - 1 && b.y + b.h > w.top + 1)) continue;
    if (!w.solid && b.y + b.h > w.bottom + 2) continue;
    // Solid step one block high: the body may overlap it until the feet cross onto it, then it
    // is lifted on top (Terraria's auto step).
    const rise = b.y + b.h - w.top;
    if (w.solid && wasGrounded && w.liftTo !== undefined && w.step !== undefined && rise <= w.step + 0.5) {
      const inset = b.w * cfg.footInset;
      const feetRight = prevX + b.w - inset <= w.x + 0.5 && b.x + b.w - inset > w.x;
      const feetLeft = prevX + inset >= w.x - 0.5 && b.x + inset < w.x;
      if (feetRight || feetLeft) {
        b.y = w.top - b.h;
        b.vy = 0;
        b.platformId = w.liftTo;
      }
      continue;
    }
    const intoRight = prevX + b.w <= w.x + 0.5 && b.x + b.w > w.x;
    const intoLeft = prevX >= w.x - 0.5 && b.x < w.x;
    if (!intoRight && !intoLeft) continue;
    if (intoRight) {
      b.x = w.x - b.w;
      hitWall = 1;
    } else {
      b.x = w.x;
      hitWall = -1;
    }
  }
  const maxX = Math.max(0, bounds.width - b.w);
  if (b.x < 0) {
    b.x = 0;
    hitWall = -1;
  } else if (b.x > maxX) {
    b.x = maxX;
    hitWall = 1;
  }
  if (hitWall !== 0 && Math.sign(b.vx) === hitWall) {
    b.vx = b.grounded ? 0 : -b.vx * cfg.wallBounce;
  }

  // Standing on a window: follow its top edge, or step off when the feet leave it
  // (walked past the edge, window closed/minimised, or edge now covered by another window).
  if (b.grounded && b.platformId !== null) {
    const support = findSupport(b, platforms, cfg);
    const sy = support ? surfaceY(support, footCenter(b)) : NaN;
    if (support && sy - b.h >= 0) {
      b.y = sy - b.h;
      b.vy = 0;
      b.platformId = support.id;
    } else {
      b.grounded = false;
      b.platformId = null;
    }
  }

  // Gravity.
  const prevBottom = b.y + b.h;
  const prevTop = b.y;
  if (!b.grounded) {
    b.vy = Math.min(b.vy + cfg.gravity * t, cfg.maxFallSpeed);
    b.y += b.vy * t;
  }

  // Solid undersides: rising heads stop below them (no jumping up through placed blocks).
  if (b.vy < 0 && ceilings.length > 0) {
    const l = b.x + b.w * cfg.footInset;
    const r = b.x + b.w * (1 - cfg.footInset);
    for (const c of ceilings) {
      if (c.right <= l || c.left >= r) continue;
      if (prevTop >= c.y - 0.5 && b.y < c.y) {
        b.y = c.y;
        b.vy = 0;
      }
    }
  }

  // Ceiling (top of the usable area).
  if (b.y < 0) {
    b.y = 0;
    if (b.vy < 0) b.vy = -b.vy * 0.2;
  }

  let landed = false;
  let impactSpeed = 0;

  // One-way platforms: land only when the feet cross a top edge while moving down,
  // taking the highest edge crossed so fast falls can't tunnel through.
  if (!b.grounded && b.vy >= 0 && platforms.length > 0) {
    const bottom = b.y + b.h;
    const span = feet(b, cfg);
    const cx = footCenter(b);
    let hit: Platform | undefined;
    let hitY = Infinity;
    for (const p of platforms) {
      if (!isWalkable(p) || !overlapsFeet(p, span)) continue;
      const sy = surfaceY(p, cx);
      if (sy < prevBottom - LAND_EPSILON || sy > bottom) continue;
      if (sy < hitY) {
        hit = p;
        hitY = sy;
      }
    }
    if (hit) {
      landed = !wasGrounded;
      impactSpeed = landed ? b.vy : 0;
      b.y = hitY - b.h;
      b.vy = 0;
      b.grounded = true;
      b.platformId = hit.id;
    }
  }

  // Floor.
  if (b.platformId === null) {
    const floorY = Math.max(0, bounds.height - b.h);
    if (b.y >= floorY) {
      if (!wasGrounded || b.vy > 0) {
        landed = !wasGrounded;
        impactSpeed = landed ? Math.max(b.vy, 0) : 0;
      }
      b.y = floorY;
      b.vy = 0;
      b.grounded = true;
    } else {
      b.grounded = false;
    }
  }

  return { body: b, landed, impactSpeed, hitWall };
}

/** Move a held body to follow the pointer, clamped to the screen. */
export function dragTo(body: Body, x: number, y: number, bounds: Bounds): Body {
  const facing: Dir = x > body.x ? 1 : x < body.x ? -1 : body.facing;
  return clampToBounds(
    { ...body, x, y, vx: 0, vy: 0, grounded: false, facing, platformId: null },
    bounds,
  );
}

/** Let go of a held body with a throw velocity, capped at `maxThrowSpeed`. */
export function release(
  body: Body,
  vx: number,
  vy: number,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
): Body {
  const speed = Math.hypot(vx, vy);
  const k = speed > cfg.maxThrowSpeed ? cfg.maxThrowSpeed / speed : 1;
  return { ...body, vx: vx * k, vy: vy * k, grounded: false, platformId: null };
}

export interface PointerSample {
  x: number;
  y: number;
  /** Milliseconds. */
  t: number;
}

/** Estimate release velocity (px/s) from recent pointer samples. */
export function throwVelocity(
  samples: readonly PointerSample[],
  now: number,
  windowMs = 100,
): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const seconds = (last.t - first.t) / 1000;
  if (seconds <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / seconds, vy: (last.y - first.y) / seconds };
}

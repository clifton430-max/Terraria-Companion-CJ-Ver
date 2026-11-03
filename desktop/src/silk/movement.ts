// Silksong-inspired movement for Control mode ("Silksong Controls"): run and sprint, buffered and
// coyote-time jumps, double jump, glide, dash, wall cling / wall jump and a Clawline-style grapple.
// Built on the existing physics step (gravity, window platforms, walls, screen bounds) so surface
// walking, carrying and landing all keep working. Pure and deterministic; tuned by feel, not taken
// from the game's files.

import type { Vec } from "../combat/geometry";
import { DEFAULT_PHYSICS, step, surfaceY, type Body, type Bounds, type Dir, type PhysicsConfig, type Platform, type Wall, type Ceiling } from "../engine/physics";

export const RUN_SPEED = 260;
export const SPRINT_SPEED = 420;
const GROUND_ACCEL = 3000;
const GROUND_DECEL = 3600;
const AIR_ACCEL = 2200;
export const JUMP_VELOCITY = 760;
export const DOUBLE_JUMP_VELOCITY = 640;
/** Upward speed kept when jump is released early (variable height). */
const JUMP_CUT = 0.45;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;
export const DASH_SPEED = 760;
export const DASH_TIME = 0.17;
export const DASH_COOLDOWN = 0.4;
export const WALL_SLIDE_SPEED = 110;
export const WALL_JUMP = { vx: 420, vy: 700, lock: 0.16 };
export const GLIDE_FALL_SPEED = 110;
export const GRAPPLE_RANGE = 380;
export const GRAPPLE_SPEED = 1100;
export const GRAPPLE_MAX_TIME = 0.55;
export const GRAPPLE_COOLDOWN = 0.35;
/** Anchors must lie within this angle (radians) of the aim. */
export const GRAPPLE_CONE = 0.62;
const LANDING_TIME = 0.12;

export type SilkAnim = "idle" | "run" | "sprint" | "jump" | "doubleJump" | "fall" | "land" | "dash" | "wallCling" | "wallJump" | "glide" | "grapple";

export interface SilkInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  grapplePressed: boolean;
  /** Where to aim the grapple (the cursor), if known. */
  aim: Vec | null;
  /** Forced velocity (the dive attack): no steering, jumps, dash or glide while set. */
  force?: { vx: number; vy: number } | null;
}

export const noSilkInput = (): SilkInput => ({ left: false, right: false, up: false, down: false, jumpHeld: false, jumpPressed: false, dashPressed: false, grapplePressed: false, aim: null });

export interface SilkState {
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  doubleJumps: number;
  airDashes: number;
  dashT: number;
  dashDir: Dir;
  dashCd: number;
  sprint: boolean;
  /** -1 / 1 while clinging to a wall on that side, else 0. */
  wallDir: -1 | 0 | 1;
  wallLock: number;
  glide: boolean;
  grapple: { x: number; y: number; t: number } | null;
  grappleCd: number;
  landT: number;
  airTime: number;
  /** Last movement animation (for the renderer and event edges). */
  anim: SilkAnim;
}

export const initialSilk = (): SilkState => ({
  coyote: 0,
  buffer: 0,
  jumpHeld: false,
  doubleJumps: 1,
  airDashes: 1,
  dashT: 0,
  dashDir: 1,
  dashCd: 0,
  sprint: false,
  wallDir: 0,
  wallLock: 0,
  glide: false,
  grapple: null,
  grappleCd: 0,
  landT: 0,
  airTime: 0,
  anim: "idle",
});

export type SilkEvent =
  | { type: "jump" }
  | { type: "doubleJump" }
  | { type: "wallJump" }
  | { type: "dash" }
  | { type: "land"; impact: number }
  | { type: "grapple"; anchor: Vec }
  | { type: "grappleMiss"; toward: Vec };

export interface SilkWorld {
  bounds: Bounds;
  platforms: readonly Platform[];
  walls: readonly Wall[];
  /** Undersides of placed blocks. */
  ceilings?: readonly Ceiling[];
  cfg?: PhysicsConfig;
}

export interface SilkResult {
  state: SilkState;
  body: Body;
  events: SilkEvent[];
}

const approach = (v: number, target: number, d: number) => (v < target ? Math.min(v + d, target) : Math.max(v - d, target));
const center = (b: Body): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h * 0.3 });

/** Unit aim vector: toward the cursor if known, else up and forward. */
export function aimVector(b: Body, aim: Vec | null): Vec {
  if (aim) {
    const c = center(b);
    const dx = aim.x - c.x;
    const dy = aim.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) return { x: dx / d, y: dy / d };
  }
  return { x: b.facing * 0.6, y: -0.8 };
}

/**
 * The best safe grapple anchor: points along walkable window edges (and their corners) within range
 * and inside the aim cone, preferring ones close to the aim line. Null if none (a safe miss).
 */
export function findAnchor(b: Body, aim: Vec, platforms: readonly Platform[], range = GRAPPLE_RANGE): Vec | null {
  const c = center(b);
  let best: Vec | null = null;
  let bestScore = Infinity;
  for (const p of platforms) {
    if (!(p.right > p.left) || !Number.isFinite(p.top)) continue;
    const n = Math.max(1, Math.ceil((p.right - p.left) / 40));
    for (let i = 0; i <= n; i++) {
      const x = p.left + ((p.right - p.left) * i) / n;
      const pt = { x, y: surfaceY(p, x) };
      const dx = pt.x - c.x;
      const dy = pt.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 30 || d > range) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * aim.x + dy * aim.y) / d)));
      if (ang > GRAPPLE_CONE) continue;
      const score = ang * 220 + d * 0.35;
      if (score < bestScore) {
        best = pt;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Touching a vertical boundary on side `dir` (screen edge or a wall segment) while overlapping it. */
export function touchingWall(b: Body, dir: -1 | 1, walls: readonly Wall[], bounds: Bounds): boolean {
  if (dir < 0 && b.x <= 0.5) return true;
  if (dir > 0 && b.x + b.w >= bounds.width - 0.5) return true;
  const side = dir > 0 ? b.x + b.w : b.x;
  return walls.some((w) => Math.abs(w.x - side) <= 1.5 && b.y < w.bottom && b.y + b.h > w.top);
}

export function silkStep(s0: SilkState, b0: Body, inp: SilkInput, dt: number, world: SilkWorld): SilkResult {
  const cfg0 = world.cfg ?? DEFAULT_PHYSICS;
  const s: SilkState = { ...s0 };
  let b: Body = { ...b0 };
  const events: SilkEvent[] = [];
  const dir = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) as -1 | 0 | 1;

  s.dashCd = Math.max(0, s.dashCd - dt);
  s.wallLock = Math.max(0, s.wallLock - dt);
  s.grappleCd = Math.max(0, s.grappleCd - dt);
  s.landT = Math.max(0, s.landT - dt);
  s.coyote = b.grounded ? COYOTE_TIME : Math.max(0, s.coyote - dt);
  s.buffer = inp.jumpPressed ? JUMP_BUFFER : Math.max(0, s.buffer - dt);
  const releasedJump = s.jumpHeld && !inp.jumpHeld;
  s.jumpHeld = inp.jumpHeld;

  // Grapple: fire toward the aim; pull straight to the anchor (or miss safely).
  if (inp.grapplePressed && s.grappleCd <= 0 && !s.grapple) {
    s.grappleCd = GRAPPLE_COOLDOWN;
    const aim = aimVector(b, inp.aim);
    const anchor = findAnchor(b, aim, world.platforms);
    if (anchor) {
      s.grapple = { x: anchor.x, y: anchor.y, t: 0 };
      s.dashT = 0;
      events.push({ type: "grapple", anchor });
    } else {
      const c = center(b);
      events.push({ type: "grappleMiss", toward: { x: c.x + aim.x * GRAPPLE_RANGE, y: c.y + aim.y * GRAPPLE_RANGE } });
    }
  }
  if (s.grapple) {
    const g = s.grapple;
    g.t += dt;
    // Pull the feet up to the anchor.
    const fx = b.x + b.w / 2;
    const fy = b.y + b.h;
    const dx = g.x - fx;
    const dy = g.y - fy;
    const d = Math.hypot(dx, dy);
    if (d < 24 || g.t > GRAPPLE_MAX_TIME || s.buffer > 0) {
      const launch = s.buffer > 0;
      s.grapple = null;
      s.buffer = 0;
      b = { ...b, vx: b.vx * 0.5, vy: launch ? -JUMP_VELOCITY * 0.85 : -260, grounded: false, platformId: null };
      s.doubleJumps = 1;
      s.airDashes = 1;
      if (launch) events.push({ type: "jump" });
    } else {
      const v = Math.min(GRAPPLE_SPEED, d / dt);
      b = { ...b, vx: (dx / d) * v, vy: (dy / d) * v, grounded: false, platformId: null, facing: dx < 0 ? -1 : 1 };
      b.x = Math.min(Math.max(b.x + b.vx * dt, 0), Math.max(0, world.bounds.width - b.w));
      b.y = Math.min(Math.max(b.y + b.vy * dt, 0), Math.max(0, world.bounds.height - b.h));
      s.anim = "grapple";
      s.airTime = 0;
      return { state: s, body: b, events };
    }
  }

  // Dive: fly at the forced velocity through the shared physics (it still lands on surfaces and
  // stops at walls and the screen edges); the controller ends it on landing or a hit.
  if (inp.force) {
    s.dashT = 0;
    s.glide = false;
    s.wallDir = 0;
    b = { ...b, vx: inp.force.vx, vy: inp.force.vy, facing: inp.force.vx < 0 ? -1 : inp.force.vx > 0 ? 1 : b.facing };
    const r = step(b, { move: 0, jump: false }, dt, world.bounds, cfg0, world.platforms, world.walls, world.ceilings);
    b = r.body.grounded ? r.body : { ...r.body, vx: inp.force.vx, vy: inp.force.vy };
    if (r.landed) {
      s.landT = LANDING_TIME;
      s.doubleJumps = 1;
      s.airDashes = 1;
      events.push({ type: "land", impact: r.impactSpeed });
    }
    s.airTime = b.grounded ? 0 : s.airTime + dt;
    s.anim = b.grounded ? "land" : "fall";
    return { state: s, body: b, events };
  }

  // Dash: a quick horizontal burst (no gravity), once per airtime.
  if (inp.dashPressed && s.dashCd <= 0 && s.dashT <= 0 && (b.grounded || s.airDashes > 0)) {
    s.dashT = DASH_TIME;
    s.dashDir = dir !== 0 ? dir : b.facing;
    s.dashCd = DASH_COOLDOWN;
    if (!b.grounded) s.airDashes--;
    s.wallDir = 0;
    events.push({ type: "dash" });
  }
  const dashing = s.dashT > 0;

  // Jumps: ground / coyote, wall jump, then double jump.
  let jump = false;
  if (s.buffer > 0 && !dashing) {
    if (b.grounded || s.coyote > 0) {
      jump = true;
      s.buffer = 0;
      s.coyote = 0;
      events.push({ type: "jump" });
    } else if (s.wallDir !== 0) {
      b = { ...b, vx: -s.wallDir * WALL_JUMP.vx, vy: -WALL_JUMP.vy, facing: s.wallDir > 0 ? -1 : 1 };
      s.wallLock = WALL_JUMP.lock;
      s.wallDir = 0;
      s.buffer = 0;
      events.push({ type: "wallJump" });
    } else if (s.doubleJumps > 0) {
      b = { ...b, vy: -DOUBLE_JUMP_VELOCITY };
      s.doubleJumps--;
      s.buffer = 0;
      events.push({ type: "doubleJump" });
    }
  }

  // Horizontal control through the shared physics step.
  const speed = s.sprint ? SPRINT_SPEED : RUN_SPEED;
  const moveDir = dashing ? s.dashDir : s.wallLock > 0 ? 0 : dir;
  const cfg: PhysicsConfig = {
    ...cfg0,
    walkSpeed: dashing ? DASH_SPEED : speed,
    groundAccel: dashing ? 1e6 : dir !== 0 ? GROUND_ACCEL : GROUND_DECEL,
    jumpVelocity: JUMP_VELOCITY,
    maxJumpVelocity: Math.max(cfg0.maxJumpVelocity, JUMP_VELOCITY),
  };
  if (dashing) b.vx = s.dashDir * DASH_SPEED;
  const r = step(b, { move: moveDir as -1 | 0 | 1, jump }, dt, world.bounds, cfg, world.platforms, world.walls, world.ceilings);
  b = r.body;

  if (dashing) {
    b = { ...b, vy: 0, facing: s.dashDir };
    s.dashT = Math.max(0, s.dashT - dt);
    // Holding the dash direction as the dash ends turns into a sprint.
    if (s.dashT === 0) s.sprint = b.grounded && dir === s.dashDir;
  } else {
    if (!b.grounded && s.wallLock <= 0) b = { ...b, vx: approach(b.vx, dir * speed * 0.95, AIR_ACCEL * dt) };
    if (dir === 0 || (dir !== b.facing && b.grounded)) s.sprint = false;
    // Variable jump height.
    if (releasedJump && b.vy < 0 && s.wallLock <= 0) b = { ...b, vy: b.vy * JUMP_CUT };
  }

  // Wall cling: pressing into a wall while airborne slows the fall; refreshes air moves.
  const clingDir = dir !== 0 && !b.grounded && !dashing && b.vy > -60 && touchingWall(b, dir, world.walls, world.bounds) ? dir : 0;
  s.wallDir = clingDir as -1 | 0 | 1;
  if (s.wallDir !== 0) {
    b = { ...b, vy: Math.min(b.vy, WALL_SLIDE_SPEED), facing: s.wallDir as Dir };
    s.doubleJumps = 1;
    s.airDashes = 1;
  }

  // Glide: hold jump while falling once the double jump is spent (or after a moment airborne).
  s.glide = !b.grounded && !dashing && s.wallDir === 0 && inp.jumpHeld && b.vy > GLIDE_FALL_SPEED && (s.doubleJumps === 0 || s.airTime > 0.35);
  if (s.glide) b = { ...b, vy: GLIDE_FALL_SPEED };

  if (r.landed) {
    s.landT = LANDING_TIME;
    s.doubleJumps = 1;
    s.airDashes = 1;
    events.push({ type: "land", impact: r.impactSpeed });
  }
  s.airTime = b.grounded ? 0 : s.airTime + dt;
  s.anim = selectSilkAnim(s, b, events);
  return { state: s, body: b, events };
}

/** Movement animation for the current state. */
export function selectSilkAnim(s: SilkState, b: Body, events: readonly SilkEvent[]): SilkAnim {
  if (s.grapple) return "grapple";
  if (s.dashT > 0) return "dash";
  if (s.wallDir !== 0) return "wallCling";
  if (events.some((e) => e.type === "wallJump") || (s.wallLock > 0 && !b.grounded)) return "wallJump";
  if (events.some((e) => e.type === "doubleJump")) return "doubleJump";
  if (!b.grounded) return s.glide ? "glide" : b.vy < 0 ? (s.anim === "doubleJump" && b.vy < -200 ? "doubleJump" : "jump") : "fall";
  if (s.landT > 0) return "land";
  if (Math.abs(b.vx) > 8) return s.sprint ? "sprint" : "run";
  return "idle";
}

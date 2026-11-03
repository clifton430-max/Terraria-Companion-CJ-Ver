// Simple autonomous behaviour: idle and wander. Jumps happen only when there's a reason: onto
// another reachable surface (planned by jump.ts), with a cooldown so they never chain endlessly.

import type { Dir, Intent } from "./physics";
import type { JumpPlan } from "./jump";

export type Rng = () => number;

/** Deterministic seeded PRNG (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AiState {
  mode: "idle" | "walk";
  /** Seconds until the next decision. */
  timer: number;
  dir: Dir;
  wantJump: boolean;
  /** Launch parameters for a jump aimed at another platform. */
  plannedJump?: JumpPlan | null;
  /** Decision for the ledge currently ahead: turn back, or go over it. Cleared once away from it. */
  ledge?: "turn" | "go" | null;
  /** Seconds before another platform jump may be planned. */
  jumpCooldown?: number;
  /** Platform jumps in a row (a streak limit stops endless hopping in "jumpy" mode). */
  jumpStreak?: number;
}

export interface AiContext {
  grounded: boolean;
  /** True while the landing animation plays; the character stands still. */
  landing: boolean;
  hitWall: -1 | 0 | 1;
  x: number;
  w: number;
  boundsWidth: number;
  /** Distance (px) to the end of the surface being walked on in the walking direction (Infinity on the floor). */
  ledgeAhead?: number;
  /** Optional planner for jumping onto another platform (e.g. a window top). */
  planJump?: () => JumpPlan | null;
  /** True while an attack animation plays: stand still. */
  busy?: boolean;
  /** Training-mode goal: approach a target and attack it with the equipped weapon. */
  combat?: CombatGoal | null;
  /** Jump/ledge tuning for the movement modes (default: the constants below). */
  tuning?: { chance: number; cooldown: number; ledgeTurn: number; maxStreak: number; rest: number };
}

export interface CombatGoal {
  /** Horizontal centre of the target (CSS px). */
  targetX: number;
  /** Distance from the target's centre at which to stop and attack. */
  range: number;
  /** Whether the equipped weapon can be used right now. */
  ready: boolean;
  /**
   * True (Euclidean) distance to the target. Flying targets straight overhead are close
   * horizontally but far away; ranged weapons only back off when this is small.
   */
  distance?: number;
}

export interface Decision {
  ai: AiState;
  intent: Intent;
  /** Direction to attack in this step, if the AI wants to attack. */
  attack?: Dir;
}

/** Ranged weapons back away when a target is closer than this fraction of their range. */
const BACK_OFF_FRACTION = 0.4;
/** Only weapons with at least this range (px) back away. */
const BACK_OFF_MIN_RANGE = 150;

/** Approach the target, keep a comfortable distance, face it and attack when ready. */
function decideCombat(ai: AiState, ctx: AiContext, goal: CombatGoal): Decision {
  const dx = goal.targetX - (ctx.x + ctx.w / 2);
  const toward: Dir = dx < 0 ? -1 : 1;
  const dist = Math.abs(dx);
  // Short timer so normal wandering resumes promptly once combat ends.
  const next: AiState = { ...ai, timer: Math.min(ai.timer, 0.5), wantJump: false, plannedJump: null };
  if (dist > goal.range) {
    next.mode = "walk";
    next.dir = toward;
    // Ranged weapons keep firing on the move once the target is roughly in range.
    const ranged = goal.range >= BACK_OFF_MIN_RANGE;
    const inReach = (goal.distance ?? dist) <= goal.range * 1.5;
    return {
      ai: next,
      intent: { move: toward, jump: false },
      attack: ranged && inReach && goal.ready ? toward : undefined,
    };
  }
  const tooClose = goal.range >= BACK_OFF_MIN_RANGE && (goal.distance ?? dist) < goal.range * BACK_OFF_FRACTION;
  if (tooClose && ctx.hitWall !== -toward) {
    next.mode = "walk";
    next.dir = -toward as Dir;
    return { ai: next, intent: { move: next.dir, jump: false } };
  }
  next.mode = "idle";
  return {
    ai: next,
    intent: { move: 0, jump: false, face: toward },
    attack: goal.ready ? toward : undefined,
  };
}

export const initialAi = (): AiState => ({ mode: "idle", timer: 1.5, dir: 1, wantJump: false });

/** At this distance from a ledge the character decides whether to turn back or go over. */
export const LEDGE_LOOK = 10;
/** Chance of stopping, peeking and turning back at a ledge (otherwise it drops off). */
export const LEDGE_TURN_CHANCE = 0.65;

/** Seconds between platform jumps (randomised up to double), so jumps never chain. */
export const PLATFORM_JUMP_COOLDOWN = 6;
/** Chance, at each decision, of trying to jump to another platform when a planner is given. */
export const PLATFORM_JUMP_CHANCE = 0.35;

function pickDir(ctx: AiContext, rng: Rng): Dir {
  const margin = ctx.w * 2;
  if (ctx.x < margin) return 1;
  if (ctx.x + ctx.w > ctx.boundsWidth - margin) return -1;
  return rng() < 0.5 ? -1 : 1;
}

export function decide(
  prev: AiState,
  ctx: AiContext,
  dt: number,
  rng: Rng,
): Decision {
  const ai: AiState = { ...prev };
  if (ctx.busy) return { ai, intent: { move: 0, jump: false } };
  if (ctx.combat && !ctx.landing) return decideCombat(ai, ctx, ctx.combat);

  if (ai.mode === "walk" && ctx.hitWall === ai.dir) ai.dir = -ai.dir as Dir;

  // Ledges: decide once per ledge whether to peek and turn back, or carry on and drop off.
  const ahead = ctx.ledgeAhead ?? Infinity;
  if (ahead > LEDGE_LOOK * 3) ai.ledge = null;
  if (ai.mode === "walk" && ctx.grounded && !ctx.landing && ahead <= LEDGE_LOOK && !ai.ledge) {
    ai.ledge = rng() < (ctx.tuning?.ledgeTurn ?? LEDGE_TURN_CHANCE) ? "turn" : "go";
    if (ai.ledge === "turn") {
      ai.dir = -ai.dir as Dir;
      ai.mode = "idle"; // pause at the edge for a moment
      ai.timer = 0.6 + rng() * 0.9;
    }
  }

  ai.jumpCooldown = Math.max(0, (ai.jumpCooldown ?? 0) - dt);
  if (ctx.grounded && !ctx.landing) {
    ai.timer -= dt;
    const tune = ctx.tuning;
    const tryPlatform =
      ai.timer <= 0 && ai.jumpCooldown <= 0 && ctx.planJump !== undefined && rng() < (tune?.chance ?? PLATFORM_JUMP_CHANCE);
    const plan = tryPlatform ? ctx.planJump!() : null;
    if (plan) {
      ai.mode = "idle";
      ai.plannedJump = plan;
      ai.wantJump = true;
      if (tune) {
        // Movement modes: shorter or longer gaps, and a proper rest after a streak of jumps.
        ai.timer = 0.6 + rng() * 1.2;
        ai.jumpStreak = (ai.jumpStreak ?? 0) + 1;
        if (ai.jumpStreak >= tune.maxStreak) {
          ai.jumpStreak = 0;
          ai.jumpCooldown = tune.rest * (1 + rng() * 0.5);
        } else ai.jumpCooldown = tune.cooldown * (1 + rng() * 0.6);
      } else {
        ai.timer = 1 + rng() * 2;
        ai.jumpCooldown = PLATFORM_JUMP_COOLDOWN * (1 + rng());
      }
    } else if (ai.timer <= 0) {
      if (tryPlatform) ai.jumpStreak = 0; // nowhere to go: the streak is over
      // Wander or rest; no spontaneous hops.
      if (rng() < 0.6) {
        ai.mode = "walk";
        ai.dir = pickDir(ctx, rng);
        ai.timer = 1.5 + rng() * 3;
      } else {
        ai.mode = "idle";
        ai.timer = 2 + rng() * 4;
      }
    }
  }

  const jump = ai.wantJump && ctx.grounded && !ctx.landing;
  const planned = jump ? ai.plannedJump : null;
  if (jump) {
    ai.wantJump = false;
    ai.plannedJump = null;
  }

  const move = ai.mode === "walk" && !ctx.landing ? ai.dir : 0;
  const intent: Intent = planned
    ? { move: 0, jump, jumpVelocity: planned.vy, jumpVx: planned.vx }
    : { move, jump };
  return { ai, intent };
}

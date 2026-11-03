// Maps physical state to an animation and frame index.

export type AttackAnim = "swing" | "shoot" | "cast";
export type Anim = "idle" | "walk" | "jump" | "fall" | "land" | AttackAnim;

export interface AnimInput {
  grounded: boolean;
  vx: number;
  vy: number;
  /** Seconds of landing animation remaining. */
  landTimer: number;
  dragging: boolean;
  /** Attack animation in progress, if any; it overrides movement poses. */
  attack?: AttackAnim | null;
}

/** Horizontal speed (px/s) below which a grounded character counts as standing. */
export const WALK_THRESHOLD = 5;

export function selectAnim(s: AnimInput): Anim {
  if (s.dragging) return "fall";
  if (s.attack) return s.attack;
  if (!s.grounded) return s.vy < 0 ? "jump" : "fall";
  if (s.landTimer > 0) return "land";
  if (Math.abs(s.vx) > WALK_THRESHOLD) return "walk";
  return "idle";
}

/** Seconds each frame is held, per animation. */
const FRAME_DURATION: Record<Anim, number> = {
  idle: 0.55,
  walk: 0.13,
  jump: 1,
  fall: 1,
  land: 1,
  swing: 1,
  shoot: 1,
  cast: 1,
};

/** Fraction of a sword swing spent in the raised wind-up pose before striking forward. */
export const SWING_RAISE_FRACTION = 0.3;

/** Which attack animation a weapon archetype uses. */
export function attackAnimFor(kind: "sword" | "bow" | "gun" | "staff" | "summon"): AttackAnim {
  if (kind === "sword") return "swing";
  if (kind === "bow" || kind === "gun") return "shoot";
  return "cast";
}

/** Attack frames follow the attack's progress (0..1) rather than elapsed time. */
export function attackFrameIndex(anim: AttackAnim, progress: number): number {
  return anim === "swing" && progress >= SWING_RAISE_FRACTION ? 1 : 0;
}

export function frameIndex(anim: Anim, elapsed: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  return Math.floor(Math.max(elapsed, 0) / FRAME_DURATION[anim]) % frameCount;
}

/** How long to hold the landing pose for a given impact speed; 0 means skip it. */
export function landDuration(impactSpeed: number): number {
  if (impactSpeed < 250) return 0;
  return Math.min(0.32, 0.1 + impactSpeed / 7000);
}

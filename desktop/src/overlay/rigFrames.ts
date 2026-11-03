// Pure mapping from the companion's animation state to a frame of the Terraria player atlas.

import type { Anim } from "../engine/animation";

export const WALK_FRAMES = 14;
/**
 * Art pixels travelled per walk frame. Terraria advances the walk cycle with distance moved rather
 * than time; this rate was tuned to keep feet from sliding at the companion's walk speeds.
 */
export const WALK_PX_PER_FRAME = 6;

/**
 * Integer scale for the 40×56 Terraria art that keeps the character close to its previous size:
 * the built-in 16×24 sprite at 3× was 72 px tall; the Terraria body (42 px) at 2× is 84 px.
 */
export function rigScaleFor(legacyScale: number): number {
  return Math.max(1, Math.round((legacyScale * 2) / 3));
}

export interface RigFrameInput {
  anim: Anim;
  /** Attack progress 0..1 (used for the four-stage swing). */
  attackProgress: number;
  /** Total horizontal distance walked while grounded, CSS px. */
  walkDistance: number;
  rigScale: number;
}

export function walkStep(walkDistance: number, rigScale: number): number {
  const perFrame = WALK_PX_PER_FRAME * Math.max(1, rigScale);
  return Math.floor(Math.max(0, walkDistance) / perFrame) % WALK_FRAMES;
}

export function selectRigFrame(input: RigFrameInput): string {
  switch (input.anim) {
    case "swing": {
      const stage = Math.min(3, Math.max(0, Math.floor(input.attackProgress * 4)));
      return `use${stage + 1}`;
    }
    case "shoot":
      return "shoot";
    case "cast":
      return "cast";
    case "walk":
      return `walk${walkStep(input.walkDistance, input.rigScale)}`;
    case "jump":
      return "jump";
    case "fall":
      return "fall";
    case "land":
    case "idle":
      return "idle";
  }
}

/**
 * Frame to draw from an atlas: the requested one, or the closest pose it does have (a skin or an
 * older atlas may lack some poses). Never returns a name that isn't in `frames` unless empty.
 */
export function resolveFrame(frames: readonly string[], name: string): string {
  if (frames.includes(name)) return name;
  const chain: string[] = [];
  if (name === "sit" || name === "ride") chain.push("jump", "fall");
  else if (name === "dash" || name === "lunge") chain.push("shoot", "walk0");
  else if (name === "cling" || name === "glide") chain.push("jump", "fall");
  else if (name === "pogo") chain.push("use4", "fall");
  else if (name === "diag" || name === "dive") chain.push("pogo", "use4", "fall");
  else if (name === "slam") chain.push("sit", "use4");
  else if (name.startsWith("wave") || name === "hug") chain.push("cast", "shoot");
  else if (name.startsWith("walk")) chain.push("walk0");
  else if (name.startsWith("use")) chain.push("use1", "shoot");
  chain.push("idle");
  return chain.find((f) => frames.includes(f)) ?? frames[0] ?? name;
}

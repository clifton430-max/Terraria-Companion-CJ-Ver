// Terraria-style held pickaxe. Terraria has no separate held-pickaxe frames: the game draws the
// item sprite itself, pivoting at the hand, while the player's arm steps through its use frames.
// The swing is linear in time and sweeps about 200° from behind/over the head to forward/down.
// (An approximation from observed gameplay, not taken from game code.)

import type { Dir } from "../engine/physics";
import type { Vec } from "./geometry";

/** Pointing direction of the pick in degrees, right-facing (0 = forward, -90 = straight up). */
export const PICKAXE_ARC = { from: -160, to: 40 } as const;
/** The sprite points up-right (45°) when unrotated, like Terraria item art. */
const ART_POINTING = -45;
/** The head strikes when the pick points just below forward. */
export const STRIKE_ANGLE = 15;
export const IMPACT_PROGRESS = (STRIKE_ANGLE - PICKAXE_ARC.from) / (PICKAXE_ARC.to - PICKAXE_ARC.from);

const clamp01 = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);

/** Pointing angle (degrees) at swing progress 0..1 — linear, like Terraria's swing. */
export function pickaxeAngle(progress: number): number {
  return PICKAXE_ARC.from + (PICKAXE_ARC.to - PICKAXE_ARC.from) * clamp01(progress);
}

/** Sprite rotation (radians, right-facing; the renderer mirrors it for left-facing swings). */
export function pickaxeRotation(progress: number): number {
  return ((pickaxeAngle(progress) - ART_POINTING) * Math.PI) / 180;
}

/** Arm frame for the swing: raised, high, forward, low. */
export function pickaxeArmFrame(progress: number): "use1" | "use2" | "use3" | "use4" {
  const stage = Math.min(3, Math.floor(clamp01(progress) * 4));
  return (["use1", "use2", "use3", "use4"] as const)[stage];
}

/** Where the pick head is: `reach` px from the hand along the pointing angle, mirrored for `dir`. */
export function pickaxeHead(hand: Vec, progress: number, dir: Dir, reach: number): Vec {
  const a = (pickaxeAngle(progress) * Math.PI) / 180;
  return { x: hand.x + dir * Math.cos(a) * reach, y: hand.y + Math.sin(a) * reach };
}

/** True on the step where the swing passes the strike point (fires once per swing). */
export function crossedStrike(prevProgress: number, progress: number): boolean {
  return prevProgress < IMPACT_PROGRESS && progress >= IMPACT_PROGRESS;
}

export type SwingPhase = "idle" | "swing" | "recover";

/** Phase of the pickaxe given the current attack (if any) and remaining cooldown. */
export function swingPhase(attack: { weaponId: string; t: number; duration: number } | null, pickaxeId: string, cooldown: number): SwingPhase {
  if (attack && attack.weaponId === pickaxeId && attack.t < attack.duration) return "swing";
  return cooldown > 0 ? "recover" : "idle";
}

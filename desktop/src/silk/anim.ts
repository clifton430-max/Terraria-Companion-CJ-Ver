// Which character frame to show in Silksong Controls, from the movement state and the Needle.
// Frames come from the character's own atlas (including the dash / cling / glide / pogo / lunge
// poses composed for this mode), so the buddy keeps its look.

import { walkStep } from "../overlay/rigFrames";
import type { SilkAnim } from "./movement";
import { NEEDLE, type NeedleAttack, type NeedleKind } from "./needle";

export interface SilkFrame {
  frame: string;
  /** Mirror relative to facing (the spin flips back and forth). */
  flip: boolean;
}

export function silkFrame(anim: SilkAnim, attack: NeedleAttack | null, charge: number, walkDistance: number, rigScale: number): SilkFrame {
  if (attack) {
    const p = Math.min(1, attack.t / NEEDLE[attack.kind].duration);
    switch (attack.kind) {
      case "side":
        // Windup, swing, swing, follow-through.
        return { frame: `use${Math.min(4, 1 + Math.floor(p * 4))}`, flip: false };
      case "up":
        return { frame: p < 0.2 ? "use1" : "cast", flip: false };
      case "down":
        return { frame: "pogo", flip: false };
      case "diag":
        return { frame: p < 0.12 ? "use2" : "diag", flip: false };
      case "dive":
        return { frame: "dive", flip: false };
      case "slam":
        // Impact crouch, then rising back up (recovery).
        return { frame: p < 0.6 ? "slam" : "sit", flip: false };
      case "charged":
        return { frame: p < 0.15 ? "use1" : "lunge", flip: false };
      case "spin":
        // Whirl: alternate facing quickly with arms out.
        return { frame: Math.floor(attack.t / 0.05) % 2 === 0 ? "use3" : "cast", flip: Math.floor(attack.t / 0.1) % 2 === 1 };
    }
  }
  if (charge > 0.25) return { frame: "use1", flip: false }; // anticipation while charging
  switch (anim) {
    case "run":
    case "sprint":
      return { frame: `walk${walkStep(walkDistance, rigScale)}`, flip: false };
    case "jump":
    case "doubleJump":
    case "wallJump":
      return { frame: "jump", flip: false };
    case "fall":
      return { frame: "fall", flip: false };
    case "land":
      return { frame: "sit", flip: false }; // a quick landing squash
    case "dash":
      return { frame: "dash", flip: false };
    case "wallCling":
      return { frame: "cling", flip: false };
    case "glide":
      return { frame: "glide", flip: false };
    case "grapple":
      return { frame: "shoot", flip: false };
    default:
      return { frame: "idle", flip: false };
  }
}

// ── Visual geometry (pure, tested) ─────────────────────────────────────────────────────────

/** Slash crescent sweep (radians, screen space) for an attack at progress p. */
export function slashArc(kind: "side" | "up" | "down" | "diag", p: number, dir: 1 | -1): { from: number; to: number } {
  const base =
    kind === "up" ? -Math.PI / 2 : kind === "down" ? Math.PI / 2 : kind === "diag" ? (dir > 0 ? Math.PI / 4 : (3 * Math.PI) / 4) : dir > 0 ? 0 : Math.PI;
  const span = 1.9; // ~110°
  const sweep = Math.min(1, Math.max(0, p));
  // Sweeps across the facing side: top→bottom for side strikes, back→front for up/down.
  const sign = kind === "side" || kind === "diag" ? dir : dir > 0 ? 1 : -1;
  const from = base - (sign * span) / 2;
  return { from, to: from + sign * span * sweep };
}

/** Needle angle (radians) in the hand during an attack. */
export function needleAngle(kind: NeedleKind, p: number, dir: 1 | -1, t = 0): number {
  switch (kind) {
    case "diag": {
      // Sweeps through the down-forward diagonal.
      const a = Math.PI / 4 - 0.6 + 1.2 * Math.min(1, p * 1.4);
      return dir > 0 ? a : Math.PI - a;
    }
    case "dive":
    case "slam":
      return dir > 0 ? Math.PI / 4 : (3 * Math.PI) / 4;
    case "up":
      return -Math.PI / 2 + dir * (0.6 - 1.2 * p);
    case "down":
      return Math.PI / 2 - dir * (0.6 - 1.2 * p);
    case "charged":
      return dir > 0 ? 0 : Math.PI;
    case "spin":
      return t * 28;
    default: {
      const a = -0.9 + 1.9 * Math.min(1, p * 1.4);
      return dir > 0 ? a : Math.PI - a;
    }
  }
}

/** Keep a short trail of recent points (newest last). */
export function pushTrail(trail: readonly { x: number; y: number }[], pt: { x: number; y: number }, max = 14): { x: number; y: number }[] {
  const next = [...trail, pt];
  return next.length > max ? next.slice(next.length - max) : next;
}

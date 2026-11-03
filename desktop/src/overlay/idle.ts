// Idle poses while staying put: which atlas frame to show for a pose at time t, and an automatic
// rotation between poses (or a fixed pose), with pause/resume. Pure; no physics involved, so pose
// changes never move the character.

import type { IdlePose } from "../bridge";

export const IDLE_POSES: readonly IdlePose[] = ["stand", "lookAround", "sit", "swingLegs", "wave", "nap"];
export const IDLE_LABEL: Record<IdlePose, string> = {
  stand: "Stand",
  lookAround: "Look around",
  sit: "Sit",
  swingLegs: "Sit & swing legs",
  wave: "Wave",
  nap: "Nap",
};
export const MIN_INTERVAL = 10;
export const MAX_INTERVAL = 600;

export interface IdleFrame {
  frame: string;
  /** Mirror the character (looking the other way). */
  flip: boolean;
}

/** Frame for a pose `t` seconds into it. */
export function idleFrame(pose: IdlePose, t: number): IdleFrame {
  switch (pose) {
    case "sit":
      return { frame: "sit", flip: false };
    case "swingLegs":
      return { frame: Math.floor(t / 0.45) % 2 === 0 ? "sit" : "sit2", flip: false };
    case "nap":
      return { frame: "nap", flip: false };
    case "wave": {
      // Wave for 2.1 s, then rest for 3.9 s.
      const c = t % 6;
      return { frame: c < 2.1 ? (Math.floor(c / 0.35) % 2 === 0 ? "wave1" : "wave2") : "idle", flip: false };
    }
    case "lookAround": {
      // Glance one way, then the other, with pauses.
      const c = t % 6.4;
      return { frame: "idle", flip: c >= 1.6 && c < 3.2 };
    }
    default:
      return { frame: "idle", flip: false };
  }
}

export interface IdleSettings {
  mode: "rotate" | "fixed";
  fixed: IdlePose;
  interval: number;
  paused: boolean;
}

export function clampInterval(s: number): number {
  return Number.isFinite(s) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, s)) : 45;
}

/** Tracks the current idle pose and its animation clock. */
export class IdleRotation {
  private pose: IdlePose = "stand";
  private since = 0;
  /** Animation clock within the pose (frozen while paused). */
  private t = 0;
  private last: number | null = null;

  constructor(private readonly rng: () => number) {}

  get current(): IdlePose {
    return this.pose;
  }

  update(now: number, s: IdleSettings): IdleFrame {
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    if (s.mode === "fixed") {
      if (this.pose !== s.fixed) this.switchTo(s.fixed, now);
    } else if (!s.paused && now - this.since >= clampInterval(s.interval)) {
      const choices = IDLE_POSES.filter((p) => p !== this.pose);
      this.switchTo(choices[Math.floor(this.rng() * choices.length) % choices.length], now);
    }
    if (s.paused) this.since += dt; // pausing also holds the rotation timer
    else this.t += dt;
    return idleFrame(this.pose, this.t);
  }

  /** Restart at a pose (e.g. entering Stay-Put). */
  switchTo(pose: IdlePose, now: number) {
    this.pose = pose;
    this.since = now;
    this.t = 0;
  }
}

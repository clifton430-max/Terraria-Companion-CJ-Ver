// How the desktop buddy reacts to Letter Destroyer pings (pure, rate-limited).

import type { DestroyerEvent } from "../bridge";

export const CHEER_GAP = 6; // seconds between smash cheers

const ON = ["Letter Destroyer ready. Click letters to knock them loose.", "Letter Destroyer is on."];
const SMASH = ["Nice hit.", "Good shot.", "Well aimed.", "Plenty of letters left."];
const BIG = ["Big combo. Well done.", "Impressive combo."];
const OFF = ["Page restored.", "Everything is back where it was."];

export interface BuddyReaction {
  text: string;
  pose: "wave" | "jump" | null;
}

export class DestroyerBuddy {
  private lastCheer = -Infinity;
  private pick = (list: string[]) => list[Math.floor(this.rng() * list.length) % list.length];

  constructor(private readonly rng: () => number) {}

  react(ev: DestroyerEvent, now: number): BuddyReaction | null {
    switch (ev.event) {
      case "on":
        this.lastCheer = now;
        return { text: this.pick(ON), pose: "wave" };
      case "off":
        return { text: this.pick(OFF), pose: "wave" };
      case "smash":
        if (ev.count <= 0 || now - this.lastCheer < CHEER_GAP) return null;
        this.lastCheer = now;
        return ev.count >= 12 ? { text: this.pick(BIG), pose: "jump" } : { text: this.pick(SMASH), pose: "jump" };
    }
  }
}

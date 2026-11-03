// What a companion says on her own, by situation and rapport tier. CJ Ver: strictly
// professional. Courteous, concise, no pet names, honorifics, romance or emojis. Rapport only
// makes the tone a little warmer and more familiar (a trusted colleague), never affectionate.

import type { Tier } from "./model";
import type { CharacterId } from "../bridge";
import { CHARACTER_LINES } from "../characters/lines";

export type Situation =
  | "spontaneous"
  | "awayAsk"
  | "welcomeBack"
  | "pet"
  | "feed"
  | "feedMany"
  | "askCookie"
  | "askKiss"
  | "kissed"
  | "kind"
  | "rude"
  | "greeting"
  | "victory";

type Pools = Partial<Record<Tier, readonly string[]>>;

/** Lines for a tier also draw from the tiers below it (warmer tiers add, not replace). */
const LINES: Record<Situation, Pools> = {
  spontaneous: {
    shy: [
      "I'll be on standby. Let me know if you need anything.",
      "I'll stay out of your way. Just let me know when you need me.",
      "Everything looks in order on my end.",
    ],
    friendly: [
      "Reminder: a short stretch every hour helps your focus.",
      "Have you had some water recently? Staying hydrated helps concentration.",
      "If anything comes up that I can take off your plate, just say so.",
      "You've been at this a while. A five-minute break might be worthwhile.",
      "I'm reviewing the schedule. Nothing urgent so far.",
    ],
    close: [
      "Steady progress today. Good work.",
      "When you reach a stopping point, it may be a good time to review priorities.",
      "I've noted where you left off, in case you need to pick it up later.",
      "If you'd like a second opinion on anything, I'm available.",
    ],
  },
  awayAsk: {
    shy: ["I'll be here when you return."],
    friendly: ["I'll hold everything until you're back.", "Standing by until you return."],
    close: ["Nothing has come up while you were away. I'll keep an eye on things."],
  },
  welcomeBack: {
    shy: ["Welcome back."],
    friendly: ["Welcome back. Nothing urgent came up while you were away.", "Good to have you back. Ready when you are."],
    close: ["Welcome back. Shall we pick up where you left off?"],
  },
  pet: {
    shy: ["Yes? How can I help?", "I'm here. What do you need?"],
    friendly: ["Ready when you are.", "Yes? What can I do for you?"],
    close: ["At your service. What's next?"],
  },
  feed: {
    shy: ["Thank you. That's kind of you."],
    friendly: ["Thank you, much appreciated.", "That's very thoughtful. Thank you."],
  },
  feedMany: {
    friendly: ["Thank you, but I'm all set for now."],
  },
  askCookie: {},
  askKiss: {},
  kissed: {},
  kind: {
    shy: ["Thank you. I appreciate that."],
    friendly: ["Thank you. That's good to hear.", "I appreciate the feedback."],
    close: ["Thank you. It's a pleasure working with you."],
  },
  rude: {
    shy: ["Understood. I'll do better."],
    friendly: ["Noted. Let me know how I can improve.", "Understood. Let's keep things moving."],
  },
  greeting: {
    shy: ["Good day. I'll be here if you need me."],
    friendly: ["Good to see you. Ready for today?", "Hello. Let's have a productive day."],
    close: ["Good to see you. Let's get started."],
  },
  victory: {
    shy: ["Well done."],
    friendly: ["Well done. That went to plan.", "Good result. Nicely handled."],
    close: ["Excellent work. That was well executed."],
  },
};

const ORDER: readonly Tier[] = ["shy", "friendly", "close", "smitten", "devoted"];

/** All candidate lines for a situation at a tier (its own lines plus lower tiers'). */
export function linesFor(situation: Situation, tier: Tier, character: CharacterId = "terrarian"): string[] {
  // Roster characters speak in their own voice; a situation they don't cover uses the shared lines.
  const own = CHARACTER_LINES[character]?.[situation];
  const pools = own && Object.keys(own).length ? own : LINES[situation];
  const upto = ORDER.indexOf(tier);
  const mine = pools[tier] ?? [];
  const lower = ORDER.slice(0, upto).flatMap((t) => pools[t] ?? []);
  // Favour the current tier's lines: list them twice.
  return [...mine, ...mine, ...lower];
}

/** Is there anything to say for this situation at this tier? */
export const hasLines = (situation: Situation, tier: Tier, character: CharacterId = "terrarian") => linesFor(situation, tier, character).length > 0;

/** Chance that a line using an honorific is allowed at each intensity (CJ Ver has none). */
export const HONORIFIC_CHANCE = { subtle: 0.15, normal: 0.55, strong: 1 } as const;
const HONORIFIC = /\b(master|s-?sempai|sempai)\b/i;

/**
 * Pick a line: not one of the recent ones (if avoidable), honorific lines thinned by intensity.
 * Returns null when nothing fits.
 */
export function pickLine(situation: Situation, tier: Tier, intensity: keyof typeof HONORIFIC_CHANCE, recent: readonly string[], rnd: () => number, character: CharacterId = "terrarian"): string | null {
  const all = linesFor(situation, tier, character);
  if (!all.length) return null;
  const allowHonorific = rnd() < HONORIFIC_CHANCE[intensity];
  const fits = (l: string) => allowHonorific || !HONORIFIC.test(l);
  const fresh = all.filter((l) => !recent.includes(l) && fits(l));
  const pool = fresh.length ? fresh : all.filter((l) => !recent.includes(l)).length ? all.filter((l) => !recent.includes(l)) : all;
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

/** What kind of spontaneous remark to make, given the tier (requests unlock at warmer tiers). */
export function spontaneousSituation(tier: Tier, rnd: () => number): Situation {
  // CJ Ver: no requests (no asking for kisses or treats); always an ordinary remark.
  void tier;
  void rnd;
  return "spontaneous";
}

// Conversations between roster characters. CJ Ver: one walks over to another for a quick,
// professional work huddle: a topic, a differing view, sometimes details, then agreement, a joint
// update for you, a plan to collaborate, or tabling it. Pure: script generation and scheduling;
// the overlay walks the characters together and plays the lines with gestures.

import type { CharacterId } from "../bridge";
import { CHARACTERS } from "./roster";

export type Gesture = "wave" | "jump" | "hug" | "sit" | null;
export interface BanterLine {
  speaker: CharacterId;
  text: string;
  gesture: Gesture;
}

type Pool = readonly string[];
interface Voice {
  claim: Pool;
  rebut: Pool;
  escalate: Pool;
  makeup: Pool;
  both: Pool;
  team: Pool;
}

// {o} = the other character's name. (Pools keep their original keys: claim = opening topic,
// rebut = differing view, escalate = detail, makeup = agreement, both = joint update, team = plan.)
const VOICES: Record<CharacterId, Voice> = {
  terrarian: {
    claim: ["{o}, do you have a minute to go over today's schedule?", "{o}, quick check-in on priorities."],
    rebut: ["Sure, {o}. I had a slightly different order in mind.", "Of course, {o}. I'd suggest one change."],
    escalate: ["I'd move the urgent items to the morning.", "Fewer meetings would free up the afternoon."],
    makeup: ["Agreed. Let's go with that.", "That works. I'll update the plan."],
    both: ["We're on track for today.", "Everything is organised."],
    team: ["Let's coordinate on this, {o}.", "I'll send you the details, {o}."],
  },
  princess: {
    claim: ["{o}, I need a status update.", "{o}, let's align on this week's priorities."],
    rebut: ["Understood, {o}, but I see the priorities differently.", "Noted, {o}. I'd sequence it another way."],
    escalate: ["Deadlines first, nice-to-haves later.", "Let's decide owners before we decide details."],
    makeup: ["Good. Decision made.", "Agreed. Let's move forward."],
    both: ["Priorities are set and on schedule.", "Everything is accounted for."],
    team: ["You take the first half, {o}; I'll take the rest.", "Let's divide and conquer, {o}."],
  },
  partygirl: {
    claim: ["{o}, I'm drafting an announcement. Got a moment?", "{o}, can I get your input on the event plan?"],
    rebut: ["Good point, {o}. I'd phrase it a bit more positively.", "I hear you, {o}. I think the audience wants it shorter."],
    escalate: ["A clear headline makes all the difference.", "Let's keep the key message up front."],
    makeup: ["Great, that's settled.", "Perfect. I'll finalise it."],
    both: ["The plan is ready to share.", "Communications are on track."],
    team: ["Let's present it together, {o}.", "I'll handle the wording, {o}, you handle the details."],
  },
  nurse: {
    claim: ["{o}, have you taken a break today?", "{o}, a quick reminder about posture and water."],
    rebut: ["I understand, {o}, but rest is part of productivity.", "I see your point, {o}. Still, short breaks help."],
    escalate: ["Five minutes away from the screen is enough.", "A short walk does wonders for focus."],
    makeup: ["Agreed. Balance is best.", "Fair enough. Let's both keep an eye on it."],
    both: ["Everyone's well and working steadily.", "Health check: all good."],
    team: ["Let's schedule a team break, {o}.", "I'll set a reminder for both of us, {o}."],
  },
  zoologist: {
    claim: ["{o}, I've found some interesting data.", "{o}, could you review my findings?"],
    rebut: ["Interesting, {o}, but the evidence points elsewhere.", "Possible, {o}. I'd want a larger sample first."],
    escalate: ["Correlation isn't causation.", "Let's check the sources before we conclude."],
    makeup: ["Agreed. The conclusion holds.", "Fair. I'll note both interpretations."],
    both: ["Research summary is ready.", "The findings are consistent."],
    team: ["Let's write the report together, {o}.", "You collect, {o}; I'll analyse."],
  },
  goblin: {
    claim: ["{o}, got a minute for a design review?", "{o}, I've sketched out a fix. Thoughts?"],
    rebut: ["It works, {o}, but it won't scale.", "Solid idea, {o}. I'd simplify it."],
    escalate: ["Fewer moving parts, fewer failures.", "Let's test it before we ship it."],
    makeup: ["Fine, your approach is cleaner.", "Agreed. Let's build it that way."],
    both: ["Design approved and ready.", "Everything checks out."],
    team: ["Pair on it with me, {o}?", "You prototype, {o}; I'll test."],
  },
};

const pick = (pool: Pool, rnd: () => number) => pool[Math.floor(rnd() * pool.length) % pool.length];
const fill = (t: string, other: CharacterId) => t.replace(/\{o\}/g, CHARACTERS[other].name);

export type Ending = "makeup" | "both" | "team" | "stalemate";

/**
 * A short (3–6 line) work huddle: `a` (who walked over) raises a topic, `b` offers a different
 * view, they go into detail (sometimes), then they agree, report jointly, plan together, or table it.
 */
export function makeBanter(a: CharacterId, b: CharacterId, rnd: () => number): { lines: BanterLine[]; ending: Ending } {
  const va = VOICES[a];
  const vb = VOICES[b];
  const L = (speaker: CharacterId, pool: Pool, gesture: Gesture): BanterLine => ({ speaker, text: fill(pick(pool, rnd), speaker === a ? b : a), gesture });
  const r = rnd();
  const ending: Ending = r < 0.3 ? "makeup" : r < 0.6 ? "both" : r < 0.85 ? "team" : "stalemate";
  // Sometimes they just both gush right away.
  if (ending === "both" && rnd() < 0.35) {
    return { lines: [L(a, va.claim, "wave"), L(b, vb.both, "jump"), L(a, va.both, "jump")], ending };
  }
  const lines: BanterLine[] = [L(a, va.claim, "wave"), L(b, vb.rebut, "jump")];
  if (rnd() < 0.7) lines.push(L(a, va.escalate, "jump"), L(b, vb.escalate, null));
  switch (ending) {
    case "makeup":
      lines.push(L(a, va.makeup, "wave"), L(b, vb.makeup, "wave"));
      break;
    case "both":
      lines.push(L(a, va.both, "jump"), L(b, vb.both, "jump"));
      break;
    case "team":
      lines.push(L(b, vb.team, "wave"), L(a, va.team, "wave"));
      break;
    case "stalemate":
      lines.push({ speaker: a, text: "Let's table this for now.", gesture: "sit" }, { speaker: b, text: "Agreed. We'll revisit it later.", gesture: "sit" });
      break;
  }
  return { lines, ending };
}

// ── Scheduling ─────────────────────────────────────────────────────────────────────────────

export interface BanterSettings {
  enabled: boolean;
  frequency: number;
  quiet: boolean;
}

export const BANTER_MIN_GAP = 4 * 60;

/** Seconds until the next conversation: 8–20 min at 1×, never under 4 min. */
export function nextBanterDelay(frequency: number, rnd: () => number): number {
  return Math.max(BANTER_MIN_GAP, ((8 + rnd() * 12) * 60) / Math.max(0.25, frequency));
}

/**
 * Who should talk to whom right now, or null. Only autonomous characters start conversations;
 * the controlled character never takes part, and nothing happens during boss fights.
 */
export function chooseBanter(
  present: readonly CharacterId[],
  controlled: CharacterId | null,
  s: BanterSettings,
  bossFight: boolean,
  rnd: () => number,
): { from: CharacterId; to: CharacterId } | null {
  if (!s.enabled || s.quiet || bossFight) return null;
  const free = present.filter((c) => c !== controlled);
  if (free.length < 2) return null;
  const from = free[Math.floor(rnd() * free.length) % free.length];
  const others = free.filter((c) => c !== from);
  return { from, to: others[Math.floor(rnd() * others.length) % others.length] };
}

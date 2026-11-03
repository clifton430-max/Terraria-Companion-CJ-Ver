// Persistent movement modes for the companions, set by voice ("spread out a bit", "be more
// jumpy", "stay grounded", "go watch from platform 2") or in settings, and saved in prefs:
//
// * spread: when another companion is on the same surface, prefer jumping to a free one (window
//   tops, blocks, invisible lines). No fixed spacing; conversations, chess and cuddles regroup.
// * jump: "jumpy" plans purposeful platform jumps more often (verified landings, cooldowns and a
//   streak limit so it never loops) and turns back at ledges instead of dropping to the ground;
//   "grounded" makes optional jumps rare (only downward) and walks off ledges to get lower.
//   Necessary movement (conversations, chess, being thrown) is unaffected.
// * watch: one invisible platform is the hangout. Companions make their way there and take
//   turns sitting side by side and cuddling. With no such platform nothing is invented.
//
// Spread and watch combine (spread is ignored on the hangout itself); grounded and jumpy only
// change jumping. Everything here is pure; the overlay applies it.

import type { BehaviorPrefs, JumpStyle } from "../bridge";
import { LINE_ID_BASE, type Line } from "./lines";

export const DEFAULT_BEHAVIOR: BehaviorPrefs = { spread: false, jump: "normal", watch: null };

export function normalizeBehavior(b?: Partial<BehaviorPrefs> | null): BehaviorPrefs {
  const jump: JumpStyle = b?.jump === "jumpy" || b?.jump === "grounded" ? b.jump : "normal";
  return { spread: !!b?.spread, jump, watch: b?.watch ?? null };
}

export const isDefaultBehavior = (b: BehaviorPrefs) => !b.spread && b.jump === "normal" && !b.watch;

export interface JumpTuning {
  /** Chance of trying a platform jump at each decision. */
  chance: number;
  /** Seconds between platform jumps (randomised up to 1.6×). */
  cooldown: number;
  /** Chance of turning back at a ledge (instead of dropping off). */
  ledgeTurn: number;
  /** Platform jumps allowed in a row before a longer rest. */
  maxStreak: number;
  /** The longer rest (s). */
  rest: number;
  /** Only jump to surfaces lower than the current one. */
  downOnly: boolean;
}

/** "normal" matches the AI's long-standing constants exactly. */
export const JUMP_TUNING: Record<JumpStyle, JumpTuning> = {
  normal: { chance: 0.35, cooldown: 6, ledgeTurn: 0.65, maxStreak: Infinity, rest: 0, downOnly: false },
  jumpy: { chance: 0.85, cooldown: 2.4, ledgeTurn: 0.92, maxStreak: 4, rest: 9, downOnly: false },
  grounded: { chance: 0.05, cooldown: 30, ledgeTurn: 0.15, maxStreak: 1, rest: 30, downOnly: true },
};

/** With spread on and company on the same surface, try to move on this eagerly. */
export const CROWDED_JUMP_CHANCE = 0.9;

export function tuningFor(b: BehaviorPrefs, crowded: boolean): JumpTuning {
  const t = JUMP_TUNING[b.jump];
  return b.spread && crowded ? { ...t, chance: Math.max(t.chance, CROWDED_JUMP_CHANCE), downOnly: false } : t;
}

/** Platform id of line `i` (as in `linePlatforms`). */
export const lineIdOf = (i: number) => LINE_ID_BASE - i;

const close = (a: number, b: number) => Math.abs(a - b) < 0.004;

/** Index of the saved hangout among the current lines (by endpoints, either way round), or -1. */
export function watchIndex(lines: readonly Line[], watch: Line | null | undefined): number {
  if (!watch) return -1;
  return lines.findIndex(
    (l) =>
      (close(l.x1, watch.x1) && close(l.y1, watch.y1) && close(l.x2, watch.x2) && close(l.y2, watch.y2)) ||
      (close(l.x1, watch.x2) && close(l.y1, watch.y2) && close(l.x2, watch.x1) && close(l.y2, watch.y1)),
  );
}

const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/**
 * Which line a spoken request means: "platform 2", "the second platform", "the left one", "the
 * highest platform". "pick" when it's ambiguous (the user chooses on screen); null when the label
 * doesn't exist (e.g. "platform 7" with three platforms) or there are no platforms.
 */
export function hangoutFromSpeech(text: string, lines: readonly Line[]): number | "pick" | null {
  if (!lines.length) return null;
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  const num = t.match(/ (?:platform|line|ledge|number|no) ?(\d{1,3}) /) ?? t.match(/ (\d{1,3}) /);
  let n: number | null = num ? Number(num[1]) : null;
  if (n === null) {
    const w = WORDS.findIndex((x) => t.includes(` platform ${x} `) || t.includes(` number ${x} `));
    const o = ORDINALS.findIndex((x) => t.includes(` ${x} `));
    if (w >= 0) n = w + 1;
    else if (o >= 0) n = o + 1;
  }
  if (n !== null) return n >= 1 && n <= lines.length ? n - 1 : null;
  const mid = (l: Line) => ({ x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 });
  const by = (score: (l: Line) => number) => lines.reduce((best, l, i) => (score(l) < score(lines[best]) ? i : best), 0);
  if (/ (leftmost|left) /.test(t)) return by((l) => mid(l).x);
  if (/ (rightmost|right) /.test(t)) return by((l) => -mid(l).x);
  if (/ (top|highest|upper|up high|tallest) /.test(t)) return by((l) => mid(l).y);
  if (/ (bottom|lowest|lower) /.test(t)) return by((l) => -mid(l).y);
  if (/ (middle|center|centre) /.test(t)) return by((l) => Math.abs(mid(l).x - 0.5));
  return lines.length === 1 ? 0 : "pick";
}

// ── The hangout ─────────────────────────────────────────────────────────────────────────────

export type HangoutPose = "side" | "cuddle";
/** Seconds of each pose before switching. */
export const SIDE_SECONDS = 10;
export const CUDDLE_SECONDS = 6;

/** Which pose the group is in at time `t` (seconds), alternating side-by-side and cuddles. */
export function hangoutPose(t: number): HangoutPose {
  const cycle = SIDE_SECONDS + CUDDLE_SECONDS;
  return ((t % cycle) + cycle) % cycle < SIDE_SECONDS ? "side" : "cuddle";
}

export interface HangoutSlot {
  /** Feet-centre x to stand at. */
  x: number;
  /** Who to face (x), or null to face the room. */
  face: number | null;
}

/**
 * Standing spots on the hangout for `n` companions of width `w` on a surface from `left` to
 * `right`: side by side (shoulder to shoulder) or cuddling in pairs (close, facing each other).
 */
export function hangoutSlots(n: number, left: number, right: number, w: number, pose: HangoutPose): HangoutSlot[] {
  if (n <= 0) return [];
  const mid = (left + right) / 2;
  const xs: number[] = [];
  if (pose === "side" || n === 1) {
    const gap = w * 1.05;
    for (let i = 0; i < n; i++) xs.push(mid + (i - (n - 1) / 2) * gap);
  } else {
    // Pairs close together; an odd one out stands beside the last pair.
    const pairGap = w * 1.9;
    const inner = w * 0.55;
    const groups = Math.ceil(n / 2);
    for (let g = 0; g < groups; g++) {
      const c = mid + (g - (groups - 1) / 2) * pairGap;
      if (g * 2 + 1 < n) xs.push(c - inner / 2, c + inner / 2);
      else xs.push(c);
    }
  }
  // Keep everyone on the surface (squeeze in if it's short).
  const lo = left + w / 2;
  const hi = right - w / 2;
  const span = xs[xs.length - 1] - xs[0];
  const room = Math.max(0, hi - lo);
  const k = span > room && span > 0 ? room / span : 1;
  const c0 = (xs[0] + xs[xs.length - 1]) / 2;
  const placed = xs.map((x) => c0 + (x - c0) * k);
  const shift = Math.min(0, hi - placed[placed.length - 1]) + Math.max(0, lo - placed[0]);
  const final = placed.map((x) => x + shift);
  return final.map((x, i) => {
    if (pose === "cuddle" && n > 1) {
      const partner = i % 2 === 0 ? i + 1 : i - 1;
      return { x, face: partner < n ? final[partner] : null };
    }
    return { x, face: null };
  });
}

// ── Getting to the hangout ──────────────────────────────────────────────────────────────────

export interface WatchNav {
  /** Seconds until the next jump plan is tried. */
  cooldown: number;
  /** Seconds walking without getting anywhere. */
  stuck: number;
  /** A detour x to try another approach from, when stuck below the hangout. */
  detour: number | null;
  /** Seconds trying without a single jump toward it. */
  noProgress: number;
  /** Seconds left of giving up (she roams normally, then tries again). */
  rest: number;
}

export const newWatchNav = (): WatchNav => ({ cooldown: 0, stuck: 0, detour: null, noProgress: 0, rest: 0 });

/** Give up on an unreachable hangout after this long without progress, for REST_SECONDS. */
export const GIVE_UP_SECONDS = 20;
export const REST_SECONDS = 60;

/**
 * One step of making her way to the hangout: jump toward it when a verified jump makes progress,
 * otherwise walk toward it (dropping off ledges on the way down), trying a detour to either side
 * when nothing works from below. `plan` is `planJumpToward` bound to her body and the surfaces.
 */
export function watchStep(
  nav: WatchNav,
  body: { x: number; w: number; grounded: boolean },
  target: { left: number; right: number },
  plan: () => { vy: number; vx: number } | null,
  dt: number,
  rng: () => number,
): { nav: WatchNav; move: -1 | 0 | 1; jump: { vy: number; vx: number } | null; resting: boolean } {
  const next = { ...nav, cooldown: Math.max(0, nav.cooldown - dt) };
  // Gave up for now: the caller lets her roam normally until the rest is over.
  if (next.rest > 0) {
    next.rest = Math.max(0, next.rest - dt);
    return { nav: next, move: 0, jump: null, resting: true };
  }
  if (!body.grounded) return { nav: next, move: 0, jump: null, resting: false };
  next.noProgress += dt;
  if (next.noProgress > GIVE_UP_SECONDS) {
    // No way up found: don't stand in a corner forever.
    return { nav: { ...next, noProgress: 0, rest: REST_SECONDS, detour: null, stuck: 0 }, move: 0, jump: null, resting: true };
  }
  if (next.cooldown <= 0) {
    const p = plan();
    next.cooldown = p ? 1.4 : 0.7;
    if (p) {
      next.stuck = 0;
      next.detour = null;
      next.noProgress = 0;
      return { nav: next, move: 0, jump: p, resting: false };
    }
  }
  const cx = body.x + body.w / 2;
  const mid = (target.left + target.right) / 2;
  const goal = next.detour ?? Math.min(Math.max(cx, target.left + body.w), target.right - body.w);
  const dx = goal - cx;
  if (Math.abs(dx) < 8) {
    // Under it with no way up from here: look for a stepping stone to one side.
    next.stuck += dt;
    if (next.detour !== null) next.detour = null;
    if (next.stuck > 3) {
      next.stuck = 0;
      next.detour = mid + (rng() < 0.5 ? -1 : 1) * (180 + rng() * 220);
    }
    return { nav: next, move: 0, jump: null, resting: false };
  }
  return { nav: next, move: dx < 0 ? -1 : 1, jump: null, resting: false };
}

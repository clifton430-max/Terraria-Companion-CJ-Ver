// The hidden affection meter (pure): tiers, gains from interactions (capped per hour so nothing is
// grindable), gentle decay while you're actively using the computer (and only a little while
// you're away), and the scheduler for spontaneous dialogue: cooldowns, randomness, quiet hours,
// "where did you go?" while you're away, and a welcome back.

export type Tier = "shy" | "friendly" | "close" | "smitten" | "devoted";
export const TIERS: readonly { tier: Tier; min: number }[] = [
  { tier: "shy", min: 0 },
  { tier: "friendly", min: 20 },
  { tier: "close", min: 45 },
  { tier: "smitten", min: 70 },
  { tier: "devoted", min: 90 },
];

export function tierOf(value: number): Tier {
  let t: Tier = "shy";
  for (const x of TIERS) if (value >= x.min) t = x.tier;
  return t;
}

export const tierIndex = (t: Tier) => TIERS.findIndex((x) => x.tier === t);

export type AffectionEvent = "chat" | "kind" | "rude" | "pet" | "feed" | "voice" | "victory" | "return" | "kiss";

/** Base change per event, and the most that kind of event can add per hour. */
export const GAINS: Record<AffectionEvent, { delta: number; hourlyCap: number }> = {
  chat: { delta: 0.4, hourlyCap: 4 },
  voice: { delta: 0.5, hourlyCap: 4 },
  kind: { delta: 2, hourlyCap: 6 },
  rude: { delta: -3, hourlyCap: -12 },
  pet: { delta: 0.3, hourlyCap: 3 },
  feed: { delta: 8, hourlyCap: 18 },
  victory: { delta: 3, hourlyCap: 6 },
  return: { delta: 1, hourlyCap: 3 },
  kiss: { delta: 3, hourlyCap: 6 },
};

/** Decay never takes affection below this on its own (only rude remarks go lower). */
export const DECAY_FLOOR = 10;
/** While away, decay runs at this fraction of the rate, at most AWAY_CAP points per absence. */
export const AWAY_FACTOR = 0.1;
export const AWAY_CAP = 3;
/** Seconds without input after which you count as away. */
export const AWAY_AFTER = 4 * 60;

export interface Meter {
  value: number;
  /** This hour's running total per event kind (resets each hour). */
  hour: { start: number; totals: Partial<Record<AffectionEvent, number>> };
  /** Cookies fed in the last little while (diminishing returns). */
  recentFeeds: number[];
}

export const newMeter = (value: number): Meter => ({ value: clamp(value), hour: { start: 0, totals: {} }, recentFeeds: [] });

const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 30));

/** Apply an interaction; returns the new meter and how much it actually changed. */
export function applyEvent(m: Meter, ev: AffectionEvent, nowMs: number): { meter: Meter; delta: number } {
  const g = GAINS[ev];
  const hour = nowMs - m.hour.start >= 3_600_000 ? { start: nowMs, totals: {} } : { start: m.hour.start, totals: { ...m.hour.totals } };
  let delta = g.delta;
  let recentFeeds = m.recentFeeds;
  if (ev === "feed") {
    // Each cookie within 10 minutes counts for less: 8, 4, 2, 1...
    recentFeeds = [...m.recentFeeds.filter((t) => nowMs - t < 600_000), nowMs];
    delta = g.delta / 2 ** (recentFeeds.length - 1);
  }
  const used = hour.totals[ev] ?? 0;
  if (g.hourlyCap > 0) delta = Math.max(0, Math.min(delta, g.hourlyCap - used));
  else delta = Math.min(0, Math.max(delta, g.hourlyCap - used));
  hour.totals[ev] = used + delta;
  const value = clamp(m.value + delta);
  return { meter: { value, hour, recentFeeds }, delta: value - m.value };
}

/**
 * Decay over a span: `activeSec` of use at the full rate, `awaySec` (idle, asleep or app closed)
 * at AWAY_FACTOR of it and capped at AWAY_CAP. Never below DECAY_FLOOR (unless already lower).
 */
export function decay(value: number, perHour: number, activeSec: number, awaySec: number): number {
  if (perHour <= 0) return value;
  const loss = (perHour * Math.max(0, activeSec)) / 3600 + Math.min(AWAY_CAP, (perHour * AWAY_FACTOR * Math.max(0, awaySec)) / 3600);
  if (value <= DECAY_FLOOR) return value;
  return Math.max(DECAY_FLOOR, value - loss);
}

/** Kind or rude wording in something the user said (simple and conservative). */
export function sentiment(text: string): "kind" | "rude" | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z' ]/g, " ")} `;
  const rude = [" stupid ", " hate you ", " shut up ", " useless ", " dumb ", " idiot ", " annoying ", " go away "];
  const kind = [
    " thank", " thanks ", " love you ", " cute ", " good girl ", " amazing ", " awesome ", " great job ", " you're the best ",
    " youre the best ", " appreciate ", " well done ", " adorable ", " sweet ", " i missed you ", " good job ",
  ];
  if (rude.some((w) => t.includes(w))) return "rude";
  if (kind.some((w) => t.includes(w))) return "kind";
  return null;
}

// ── Spontaneous dialogue scheduling ────────────────────────────────────────────────────────

export interface ChatterSettings {
  spontaneous: boolean;
  /** Frequency multiplier (0.25–3). */
  frequency: number;
  attention: boolean;
  quiet: boolean;
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
}

export interface ChatterState {
  /** Next normal spontaneous remark (s, monotonic clock). */
  nextAt: number;
  /** When the current absence began (s), or null if the user is here. */
  awaySince: number | null;
  /** Attention requests made during this absence, and when the next is due. */
  awayAsks: number;
  nextAwayAt: number;
}

export const MIN_GAP = 150; // s between spontaneous remarks, whatever the frequency
export const MAX_AWAY_ASKS = 3;

export const newChatter = (now: number, s: ChatterSettings, rnd: () => number): ChatterState => ({
  nextAt: now + nextDelay(s.frequency, rnd),
  awaySince: null,
  awayAsks: 0,
  nextAwayAt: Infinity,
});

/** Seconds until the next spontaneous remark: 6–14 min at 1×, scaled by frequency, ≥ MIN_GAP. */
export function nextDelay(frequency: number, rnd: () => number): number {
  return Math.max(MIN_GAP, ((6 + rnd() * 8) * 60) / Math.max(0.25, frequency));
}

export function inQuietHours(hour: number, s: Pick<ChatterSettings, "quietHours" | "quietStart" | "quietEnd">): boolean {
  if (!s.quietHours || s.quietStart === s.quietEnd) return false;
  return s.quietStart < s.quietEnd ? hour >= s.quietStart && hour < s.quietEnd : hour >= s.quietStart || hour < s.quietEnd;
}

export type ChatterKind = "spontaneous" | "awayAsk" | "welcomeBack";

/**
 * Advance the scheduler. `idleSec` is time since the user's last input; `busy` means the companion
 * shouldn't interrupt (a menu, voice card or editing mode is open). Returns what to say, if anything.
 */
export function stepChatter(st: ChatterState, now: number, idleSec: number, hour: number, busy: boolean, s: ChatterSettings, rnd: () => number): { state: ChatterState; say: ChatterKind | null } {
  const silent = s.quiet || inQuietHours(hour, s);
  let next = { ...st };
  // Absence tracking.
  if (idleSec >= AWAY_AFTER) {
    if (next.awaySince === null) {
      next.awaySince = now - idleSec;
      next.awayAsks = 0;
      next.nextAwayAt = now + 30 + rnd() * 150; // first nudge 0.5–3 min after becoming "away"
    }
    if (!silent && s.attention && s.spontaneous && !busy && next.awayAsks < MAX_AWAY_ASKS && now >= next.nextAwayAt) {
      next.awayAsks++;
      next.nextAwayAt = now + (6 + rnd() * 6) * 60;
      return { state: next, say: "awayAsk" };
    }
    return { state: next, say: null };
  }
  if (next.awaySince !== null) {
    const wasAway = now - next.awaySince;
    next = { ...next, awaySince: null, awayAsks: 0, nextAwayAt: Infinity, nextAt: Math.max(next.nextAt, now + MIN_GAP) };
    if (!silent && s.spontaneous && wasAway >= AWAY_AFTER && !busy) return { state: next, say: "welcomeBack" };
    return { state: next, say: null };
  }
  if (!s.spontaneous || silent) return { state: { ...next, nextAt: Math.max(next.nextAt, now + 60) }, say: null };
  if (now < next.nextAt) return { state: next, say: null };
  if (busy) return { state: { ...next, nextAt: now + 30 }, say: null };
  return { state: { ...next, nextAt: now + nextDelay(s.frequency, rnd) }, say: "spontaneous" };
}

// End-of-speech detection for voice input (pure). Learns the background noise level, needs a
// moment of real speech before it arms, and fires once the user has been quiet for the timeout;
// speaking again resets the timer. Reports "no speech" if nothing above the noise ever arrives.

export interface SilenceConfig {
  /** Seconds of quiet after speech that end the recording. */
  timeout: number;
  /** Give up if no speech is heard for this long after starting (s). */
  noSpeechAfter: number;
  /** Speech must last at least this long (s, cumulative) before silence can end the recording. */
  minSpeech: number;
}

export const DEFAULT_SILENCE: SilenceConfig = { timeout: 2, noSpeechAfter: 8, minSpeech: 0.25 };

export interface SilenceState {
  /** Running estimate of the background level (0–1 meter units). */
  floor: number;
  speech: number;
  lastSpeech: number | null;
  started: number | null;
  /** Is the user speaking right now (for the UI)? */
  speaking: boolean;
}

export const newSilence = (): SilenceState => ({ floor: 0.02, speech: 0, lastSpeech: null, started: null, speaking: false });

/** Level above which a block counts as speech: well over the noise floor, never absurdly low. */
export const threshold = (floor: number) => Math.max(0.06, floor * 2.2 + 0.03);

export type SilenceVerdict = "done" | "noSpeech" | null;

/**
 * Feed one block's level at time `t` (s) lasting `dt` s. Returns "done" when the user has gone quiet
 * after speaking, "noSpeech" if nothing was said in time.
 */
export function feedLevel(s: SilenceState, level: number, t: number, dt: number, c: SilenceConfig = DEFAULT_SILENCE): { state: SilenceState; verdict: SilenceVerdict } {
  const started = s.started ?? t;
  const loud = level > threshold(s.floor);
  // Track the noise floor from quiet blocks only (slowly, so a pause doesn't raise it).
  const floor = loud ? s.floor : s.floor + (level - s.floor) * (level > s.floor ? 0.05 : 0.2);
  const next: SilenceState = {
    floor: Math.min(0.3, Math.max(0.005, floor)),
    speech: s.speech + (loud ? dt : 0),
    lastSpeech: loud ? t : s.lastSpeech,
    started,
    speaking: loud,
  };
  if (next.speech >= c.minSpeech && next.lastSpeech !== null && t - next.lastSpeech >= c.timeout) return { state: next, verdict: "done" };
  if (next.speech < c.minSpeech && t - started >= c.noSpeechAfter) return { state: next, verdict: "noSpeech" };
  return { state: next, verdict: null };
}

/** Seconds of quiet so far after speech (for the "sending in…" countdown), or null. */
export function quietFor(s: SilenceState, t: number, c: SilenceConfig = DEFAULT_SILENCE): number | null {
  return s.speech >= c.minSpeech && s.lastSpeech !== null && !s.speaking ? t - s.lastSpeech : null;
}

import { describe, expect, it } from "vitest";
import { DEFAULT_SILENCE, feedLevel, newSilence, quietFor, type SilenceState } from "./silence";

const DT = 0.085; // one 4096-sample block at 48 kHz

/** Feed a level pattern (segments of [level, seconds]); returns when it fired. */
function play(pattern: [number, number][], timeout = 2, noise = 0) {
  let s: SilenceState = newSilence();
  let t = 0;
  let k = 0;
  for (const [level, secs] of pattern) {
    for (let e = 0; e < secs; e += DT) {
      const jitter = noise ? noise * (0.5 + 0.5 * Math.sin(k++ * 1.7)) : 0;
      const r = feedLevel(s, level + jitter, t, DT, { ...DEFAULT_SILENCE, timeout });
      s = r.state;
      t += DT;
      if (r.verdict) return { verdict: r.verdict, at: t, state: s };
    }
  }
  return { verdict: null, at: t, state: s };
}

describe("silence detection (auto-submit)", () => {
  it("submits after 2 seconds of silence once you've spoken", () => {
    const r = play([[0.01, 0.5], [0.5, 1.5], [0.01, 5]]);
    expect(r.verdict).toBe("done");
    // Speech ended at 2.0 s; fires about 2 s later.
    expect(r.at).toBeGreaterThan(3.9);
    expect(r.at).toBeLessThan(4.3);
  });

  it("speaking again resets the timer (pauses mid-sentence don't submit)", () => {
    const r = play([[0.5, 1], [0.01, 1.5], [0.5, 1], [0.01, 5]]);
    expect(r.verdict).toBe("done");
    expect(r.at).toBeGreaterThan(5.4); // 1 + 1.5 + 1 = 3.5 s of input, then 2 s
  });

  it("uses the configured timeout", () => {
    const r = play([[0.5, 1], [0.01, 10]], 4);
    expect(r.at).toBeGreaterThan(4.9);
  });

  it("ignores steady background noise and reports when nothing was said", () => {
    const r = play([[0.05, 12]], 2, 0.02);
    expect(r.verdict).toBe("noSpeech");
    expect(r.at).toBeGreaterThan(7.9);
  });

  it("still detects speech over moderate background noise", () => {
    const r = play([[0.05, 1], [0.6, 1.2], [0.05, 4]], 2, 0.02);
    expect(r.verdict).toBe("done");
  });

  it("a click or cough doesn't count as speech", () => {
    const r = play([[0.01, 1], [0.7, 0.1], [0.01, 9]]);
    expect(r.verdict).toBe("noSpeech");
  });

  it("reports the quiet time for the countdown", () => {
    const r = play([[0.5, 1], [0.01, 1]]);
    expect(quietFor(r.state, r.at)).toBeGreaterThan(0.8);
  });
});

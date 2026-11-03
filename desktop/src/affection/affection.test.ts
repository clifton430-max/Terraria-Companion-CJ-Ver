import { describe, expect, it } from "vitest";
import { HONORIFIC_CHANCE, linesFor, pickLine, spontaneousSituation } from "./dialogue";
import {
  AWAY_AFTER,
  AWAY_CAP,
  DECAY_FLOOR,
  MAX_AWAY_ASKS,
  MIN_GAP,
  applyEvent,
  decay,
  inQuietHours,
  newChatter,
  newMeter,
  nextDelay,
  sentiment,
  stepChatter,
  tierOf,
  type ChatterSettings,
} from "./model";

function rng(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const S: ChatterSettings = { spontaneous: true, frequency: 1, attention: true, quiet: false, quietHours: false, quietStart: 22, quietEnd: 8 };

describe("affection meter", () => {
  it("tiers unlock at thresholds", () => {
    expect([0, 19.9, 20, 44, 45, 70, 89.9, 90, 100].map(tierOf)).toEqual(["shy", "shy", "friendly", "friendly", "close", "smitten", "smitten", "devoted", "devoted"]);
  });

  it("interactions raise it, with hourly caps so nothing is grindable", () => {
    let m = newMeter(30);
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const r = applyEvent(m, "chat", 1000 + i);
      m = r.meter;
      total += r.delta;
    }
    expect(total).toBeCloseTo(4); // chat cap per hour
    // A new hour resets the cap.
    expect(applyEvent(m, "chat", 1000 + 3_600_001).delta).toBeCloseTo(0.4);
  });

  it("cookies give diminishing returns in quick succession", () => {
    let m = newMeter(30);
    const deltas = [0, 1, 2, 3].map((i) => {
      const r = applyEvent(m, "feed", 10_000 + i * 1000);
      m = r.meter;
      return r.delta;
    });
    expect(deltas).toEqual([8, 4, 2, 1]);
    // Ten minutes later, full value again (within the hourly cap).
    expect(applyEvent(m, "feed", 10_000 + 3 * 1000 + 600_001).delta).toBeCloseTo(Math.min(8, 18 - 15));
  });

  it("rude remarks lower it; it stays within 0–100", () => {
    expect(applyEvent(newMeter(30), "rude", 1).delta).toBe(-3);
    expect(applyEvent(newMeter(99), "feed", 1).meter.value).toBe(100);
    expect(applyEvent(newMeter(1), "rude", 1).meter.value).toBe(0);
  });

  it("decays while active at the configured rate, barely while away, never below the floor", () => {
    expect(decay(60, 2, 3600, 0)).toBeCloseTo(58);
    expect(decay(60, 0, 3600 * 100, 0)).toBe(60); // decay off
    // A week away costs at most AWAY_CAP.
    expect(decay(60, 2, 0, 7 * 24 * 3600)).toBeCloseTo(60 - AWAY_CAP);
    expect(decay(15, 10, 3600 * 10, 0)).toBe(DECAY_FLOOR);
    expect(decay(5, 10, 3600, 0)).toBe(5);
  });

  it("recognises kind and rude wording", () => {
    expect(sentiment("thank you so much!")).toBe("kind");
    expect(sentiment("you're so cute")).toBe("kind");
    expect(sentiment("shut up")).toBe("rude");
    expect(sentiment("what's the weather")).toBeNull();
    expect(sentiment("explain this error")).toBeNull();
  });
});

describe("dialogue", () => {
  it("warmer tiers unlock more (and keep the earlier) lines", () => {
    expect(linesFor("spontaneous", "devoted").length).toBeGreaterThan(linesFor("spontaneous", "shy").length);
    // CJ Ver: no requests for kisses or treats at any tier.
    for (const t of ["shy", "friendly", "close", "smitten", "devoted"] as const) {
      expect(linesFor("askKiss", t)).toHaveLength(0);
      expect(linesFor("kissed", t)).toHaveLength(0);
      expect(linesFor("askCookie", t)).toHaveLength(0);
    }
  });

  it("never uses emojis", () => {
    const situations = ["spontaneous", "awayAsk", "welcomeBack", "pet", "feed", "feedMany", "askCookie", "askKiss", "kissed", "kind", "rude", "greeting", "victory"] as const;
    for (const s of situations) for (const l of linesFor(s, "devoted")) expect(/\p{Extended_Pictographic}/u.test(l), l).toBe(false);
  });

  it("avoids repeating recent lines", () => {
    const r = rng(3);
    const recent: string[] = [];
    for (let i = 0; i < 6; i++) {
      const l = pickLine("spontaneous", "close", "strong", recent, r)!;
      expect(recent).not.toContain(l);
      recent.push(l);
    }
  });

  it("never uses honorifics, pet names or romance (CJ Ver)", () => {
    const situations = ["spontaneous", "awayAsk", "welcomeBack", "pet", "feed", "feedMany", "kind", "rude", "greeting", "victory"] as const;
    const banned = /\b(master|sempai|senpai|darling|love|kiss|hug|cute|ehehe|kyaa)\b|~/i;
    for (const c of ["terrarian", "princess", "partygirl", "nurse", "zoologist", "goblin"] as const)
      for (const s of situations) for (const l of linesFor(s, "devoted", c)) expect(banned.test(l), `${c}/${s}: ${l}`).toBe(false);
    expect(HONORIFIC_CHANCE.subtle).toBeLessThan(HONORIFIC_CHANCE.strong);
  });

  it("never asks for kisses or cookies, at any tier (CJ Ver)", () => {
    const r = rng(5);
    for (const t of ["shy", "devoted"] as const) {
      const seen = new Set(Array.from({ length: 300 }, () => spontaneousSituation(t, r)));
      expect([...seen]).toEqual(["spontaneous"]);
    }
  });
});

describe("spontaneous dialogue scheduling", () => {
  it("waits for its cooldown, then speaks, with randomness and a minimum gap", () => {
    const r = rng(2);
    let st = newChatter(0, S, r);
    expect(st.nextAt).toBeGreaterThanOrEqual(MIN_GAP);
    expect(stepChatter(st, 10, 0, 12, false, S, r).say).toBeNull();
    const at = st.nextAt;
    const res = stepChatter(st, at, 0, 12, false, S, r);
    expect(res.say).toBe("spontaneous");
    expect(res.state.nextAt - at).toBeGreaterThanOrEqual(MIN_GAP);
    const delays = new Set(Array.from({ length: 10 }, () => Math.round(nextDelay(1, r))));
    expect(delays.size).toBeGreaterThan(5);
    expect(nextDelay(3, () => 0)).toBe(MIN_GAP);
    st = res.state;
  });

  it("respects the off switch, quiet mode and quiet hours (including across midnight)", () => {
    const r = rng(4);
    const st = { ...newChatter(0, S, r), nextAt: 0 };
    expect(stepChatter(st, 100, 0, 12, false, { ...S, spontaneous: false }, r).say).toBeNull();
    expect(stepChatter(st, 100, 0, 12, false, { ...S, quiet: true }, r).say).toBeNull();
    const qh = { ...S, quietHours: true, quietStart: 22, quietEnd: 8 };
    expect(inQuietHours(23, qh) && inQuietHours(3, qh)).toBe(true);
    expect(inQuietHours(12, qh)).toBe(false);
    expect(stepChatter(st, 100, 0, 23, false, qh, r).say).toBeNull();
    expect(stepChatter(st, 100, 0, 12, false, qh, r).say).toBe("spontaneous");
  });

  it("doesn't interrupt when busy (tries again shortly)", () => {
    const r = rng(6);
    const st = { ...newChatter(0, S, r), nextAt: 0 };
    const res = stepChatter(st, 100, 0, 12, true, S, r);
    expect(res.say).toBeNull();
    expect(res.state.nextAt).toBe(130);
  });

  it("asks for attention a few times while you're away, then welcomes you back", () => {
    const r = rng(8);
    let st = newChatter(0, S, r);
    const says: string[] = [];
    for (let t = 0; t < 4 * 3600; t += 10) {
      const res = stepChatter(st, t + 1000, AWAY_AFTER + t, 12, false, S, r);
      st = res.state;
      if (res.say) says.push(res.say);
    }
    expect(says.filter((s) => s === "awayAsk")).toHaveLength(MAX_AWAY_ASKS);
    const back = stepChatter(st, 20000, 1, 12, false, S, r);
    expect(back.say).toBe("welcomeBack");
    expect(back.state.awaySince).toBeNull();
    // With attention requests off: no nudges while away.
    let quiet = newChatter(0, S, r);
    for (let t = 0; t < 3600; t += 10) {
      const res = stepChatter(quiet, t, AWAY_AFTER + t, 12, false, { ...S, attention: false }, r);
      quiet = res.state;
      expect(res.say).toBeNull();
    }
  });
});

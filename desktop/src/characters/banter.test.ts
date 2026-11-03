import { describe, expect, it } from "vitest";
import { BANTER_MIN_GAP, chooseBanter, makeBanter, nextBanterDelay } from "./banter";

function rng(seed = 3) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("character conversations", () => {
  it("alternate speakers, mention the other girl, and end in varied ways", () => {
    const r = rng(7);
    const endings = new Set<string>();
    const texts = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const { lines, ending } = makeBanter("princess", "nurse", r);
      endings.add(ending);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(6);
      expect(lines[0].speaker).toBe("princess");
      expect(lines[1].speaker).toBe("nurse");
      for (const l of lines) {
        expect(l.text).not.toContain("{o}");
        expect(/\p{Extended_Pictographic}/u.test(l.text)).toBe(false);
        texts.add(l.text);
      }
    }
    expect(endings.size).toBeGreaterThanOrEqual(3);
    expect(texts.size).toBeGreaterThan(15);
  });

  it("each character sounds different", () => {
    const r = rng(9);
    const opener = (c: "princess" | "partygirl" | "nurse" | "zoologist" | "goblin") => makeBanter(c, "terrarian", r).lines[0].text;
    expect(new Set([opener("princess"), opener("partygirl"), opener("nurse"), opener("zoologist"), opener("goblin")]).size).toBe(5);
  });

  it("never involves the controlled character, needs two free characters, and respects settings", () => {
    const r = rng(1);
    const s = { enabled: true, frequency: 1, quiet: false };
    for (let i = 0; i < 50; i++) {
      const c = chooseBanter(["terrarian", "partygirl", "goblin"], "partygirl", s, false, r)!;
      expect(c.from).not.toBe("partygirl");
      expect(c.to).not.toBe("partygirl");
      expect(c.from).not.toBe(c.to);
    }
    expect(chooseBanter(["terrarian", "partygirl"], "partygirl", s, false, r)).toBeNull();
    expect(chooseBanter(["terrarian", "partygirl", "goblin"], null, { ...s, enabled: false }, false, r)).toBeNull();
    expect(chooseBanter(["terrarian", "partygirl", "goblin"], null, { ...s, quiet: true }, false, r)).toBeNull();
    expect(chooseBanter(["terrarian", "partygirl", "goblin"], null, s, true, r)).toBeNull(); // boss fight
  });

  it("has a cooldown of at least a few minutes, scaled by frequency", () => {
    const r = rng(2);
    expect(nextBanterDelay(3, () => 0)).toBe(BANTER_MIN_GAP);
    const d = nextBanterDelay(1, r);
    expect(d).toBeGreaterThanOrEqual(8 * 60);
    expect(d).toBeLessThanOrEqual(20 * 60);
  });
});

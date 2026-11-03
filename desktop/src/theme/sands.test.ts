import { describe, expect, it } from "vitest";
import { crests, dune, duneShape, shade } from "./sands";

const tones = { face: "#202020", lit: "#404040", lee: "#101010", crest: "#808080" };

describe("dark sand dunes", () => {
  it("are wind-built: a long slope up to the crest, a short steep drop after it", () => {
    expect(duneShape(0)).toBeCloseTo(0, 5);
    expect(duneShape(0.72)).toBeCloseTo(1, 5);
    // Climbing takes most of the period; the slip face is short.
    expect(duneShape(0.36)).toBeGreaterThan(0.5);
    expect(duneShape(0.95)).toBeLessThan(0.1);
  });

  it("stay above the ground line, with crests kept apart", () => {
    const d = dune(5, 40, 30, tones);
    for (let x = 0; x < 2000; x += 7) expect(d.h(x)).toBeGreaterThanOrEqual(2);
    const tops = crests(d, 2000, 260);
    expect(tops.length).toBeGreaterThan(1);
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) expect(Math.abs(tops[i] - tops[j])).toBeGreaterThanOrEqual(260);
  });

  it("shade smoothly from the lee side to the lit side", () => {
    expect(shade(dune(1, 10, 5, tones), 0)).toBe("rgb(32,32,32)");
    expect(shade(dune(1, 10, 5, tones), 5)).toBe("rgb(64,64,64)");
    expect(shade(dune(1, 10, 5, tones), -5)).toBe("rgb(16,16,16)");
    expect(shade(dune(1, 10, 5, tones), 0.7)).toBe("rgb(48,48,48)");
  });
});

import { describe, expect, it } from "vitest";
import { carve, footRow, HEIGHT, profile } from "./graveyard";

describe("the graveyard's miniatures", () => {
  it("are turned from a profile: a wide foot, narrower above", () => {
    for (const t of ["p", "r", "b", "q", "k"] as const) {
      expect(profile(t, 0.02, 6)).toBe(6);
      expect(profile(t, 0.4, 6)).toBeLessThan(6);
    }
    expect(HEIGHT.k).toBeGreaterThan(HEIGHT.q);
    expect(HEIGHT.q).toBeGreaterThan(HEIGHT.p);
  });

  it("carve every piece, outlined, standing on its foot", () => {
    for (const t of ["p", "r", "n", "b", "q", "k"] as const) {
      const g = carve(t, 20, 3, { cracks: 1, chips: 1, lichen: 1, age: 0.5 });
      expect(g.length).toBe(20);
      expect(footRow(g)).toBe(19);
      expect(g.flat().some((v) => v === 0)).toBe(true); // an outline
      expect(g.flat().filter((v) => v >= 0).length).toBeGreaterThan(30);
    }
  });

  it("snap into a base and a top that don't overlap", () => {
    const d = { cracks: 0, chips: 0, lichen: 0, age: 0 };
    const whole = carve("q", 24, 5, d);
    const base = carve("q", 24, 5, { ...d, snap: { at: 0.5, slant: 0.2, keep: "base" } });
    const top = carve("q", 24, 5, { ...d, snap: { at: 0.5, slant: 0.2, keep: "top" } });
    let solidWhole = 0;
    let solidParts = 0;
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < whole[0].length; x++) {
        if (whole[y][x] >= 0) solidWhole++;
        if (base[y][x] >= 0 && top[y][x] >= 0) throw new Error("overlap");
        if (base[y][x] >= 0 || top[y][x] >= 0) solidParts++;
      }
    expect(solidParts).toBeGreaterThan(solidWhole * 0.85); // (the break's jag can differ by a pixel)
    expect(footRow(base)).toBe(23);
    expect(footRow(top)).toBeLessThan(16);
  });

  it("weather differently from seed to seed (no two alike)", () => {
    const d = { cracks: 2, chips: 3, lichen: 2, age: 0.8 };
    expect(JSON.stringify(carve("p", 16, 1, d))).not.toBe(JSON.stringify(carve("p", 16, 2, d)));
  });
});

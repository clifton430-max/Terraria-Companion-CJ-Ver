import { describe, expect, it } from "vitest";
import { ChessAtmosphere, MAX_MOTES, seeded, swirl, type Pointer } from "./chessMap";
import { DEFAULT_PETALS } from "./petals";

describe("the chess map", () => {
  it("lays the scenery out the same way every time", () => {
    const a = seeded(11);
    const b = seeded(11);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("fills the screen with dust that drifts instead of falling, capped, and keeps lanterns overhead", () => {
    const atmos = new ChessAtmosphere(seeded(3));
    const s = { ...DEFAULT_PETALS, density: 1 };
    atmos.step(1 / 30, 0, s, 1440, 900, 830, null);
    const first = atmos.counts;
    expect(first.motes).toBeGreaterThan(20);
    expect(first.motes).toBeLessThanOrEqual(MAX_MOTES);
    expect(first.lanterns).toBeGreaterThan(3);
    expect(first.kinds).toBeGreaterThan(2); // several kinds of lantern
    expect(first.souls).toBeGreaterThan(2);
    for (let t = 0; t < 30; t += 1 / 30) atmos.step(1 / 30, t, s, 1440, 900, 830, null);
    // Still a full screen of dust after half a minute (drifting, not raining away).
    expect(atmos.counts.motes).toBeGreaterThan(first.motes * 0.8);
  });

  it("no dust when the density is zero or particles are off, but the lanterns stay", () => {
    const atmos = new ChessAtmosphere(seeded(5));
    atmos.step(1 / 30, 0, null, 1440, 900, 830, null);
    expect(atmos.counts.motes).toBe(0);
    expect(atmos.counts.lanterns).toBeGreaterThan(0);
  });

  it("dust near a moving pointer swirls around it; a still or far pointer leaves it alone", () => {
    const ptr: Pointer = { x: 100, y: 100, vx: 1200, vy: 0, at: 1 };
    const near = { x: 100, y: 130, vx: 0, vy: 0 };
    swirl(near, ptr, 1.05, 1 / 30);
    expect(Math.hypot(near.vx, near.vy)).toBeGreaterThan(1);
    const far = { x: 400, y: 400, vx: 0, vy: 0 };
    swirl(far, ptr, 1.05, 1 / 30);
    expect(far).toEqual({ x: 400, y: 400, vx: 0, vy: 0 });
    const stale = { x: 100, y: 130, vx: 0, vy: 0 };
    swirl(stale, ptr, 3, 1 / 30); // the pointer stopped a while ago
    expect(stale.vx).toBe(0);
  });
});

describe("menu-bar lanterns", () => {
  it("swing like pendulums: longer chains slower, broken ones crooked and nearly still", async () => {
    const { lanternSwing } = await import("./chessMap");
    // Zero crossings over 20 s for a short and a long chain.
    const crossings = (len: number) => {
      let n = 0;
      let prev = lanternSwing(0, 0, len, false).chain;
      for (let t = 0.02; t < 20; t += 0.02) {
        const v = lanternSwing(t, 0, len, false).chain;
        if (Math.sign(v) !== Math.sign(prev)) n++;
        prev = v;
      }
      return n;
    };
    expect(crossings(20)).toBeGreaterThan(crossings(60));
    for (let t = 0; t < 10; t += 0.5) {
      expect(Math.abs(lanternSwing(t, 1, 40, false).chain)).toBeLessThanOrEqual(0.11);
      const b = lanternSwing(t, 1, 40, true).chain;
      expect(b).toBeGreaterThan(0.18);
      expect(b).toBeLessThan(0.26);
    }
  });
});

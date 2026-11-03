import { describe, expect, it } from "vitest";
import { DEFAULT_PETALS, MAX_PETALS, spawnPetal, stepPetal, stepPetals, targetCount, windAt, type PetalSettings } from "./petals";

function rng(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const W = 1440;
const H = 900;
function run(s: PetalSettings, seconds: number, seed = 1) {
  const r = rng(seed);
  let list = stepPetals([], 1 / 30, 0, s, W, H, r);
  let t = 0;
  for (let i = 0; i < seconds * 30; i++) {
    t += 1 / 30;
    list = stepPetals(list, 1 / 30, t, s, W, H, r);
  }
  return list;
}

describe("cherry blossom petals", () => {
  it("count follows density, capped, and zero density means none", () => {
    expect(targetCount(0, W, H)).toBe(0);
    expect(targetCount(0.35, W, H)).toBeGreaterThan(10);
    expect(targetCount(1, 6000, 4000)).toBe(MAX_PETALS);
    expect(run({ ...DEFAULT_PETALS, density: 0 }, 2)).toHaveLength(0);
    const n = run(DEFAULT_PETALS, 5).length;
    expect(n).toBe(targetCount(DEFAULT_PETALS.density, W, H));
  });

  it("fills the screen at once on start (not a wall falling from the top)", () => {
    const list = stepPetals([], 1 / 30, 0, DEFAULT_PETALS, W, H, rng(3));
    expect(list.length).toBe(targetCount(DEFAULT_PETALS.density, W, H));
    expect(list.some((p) => p.y > H / 2)).toBe(true);
  });

  it("speed scales the fall; wind pushes sideways", () => {
    const p = { ...spawnPetal(W, H, rng(2), DEFAULT_PETALS, true), x: 500, y: 100, cx: 500 };
    const slow = stepPetal(p, 1, 0, { ...DEFAULT_PETALS, speed: 0.5, sway: 0 });
    const fast = stepPetal(p, 1, 0, { ...DEFAULT_PETALS, speed: 2, sway: 0 });
    expect(fast.y - p.y).toBeGreaterThan((slow.y - p.y) * 3);
    const left = stepPetal(p, 1, 0, { ...DEFAULT_PETALS, wind: -1, sway: 0 });
    const right = stepPetal(p, 1, 0, { ...DEFAULT_PETALS, wind: 1, sway: 0 });
    expect(left.x).toBeLessThan(p.x);
    expect(right.x).toBeGreaterThan(p.x);
  });

  it("every style moves petals downward and keeps them near the screen", () => {
    for (const style of ["drift", "flutter", "spiral", "gusts"] as const) {
      const list = run({ ...DEFAULT_PETALS, style, density: 0.6 }, 20, 5);
      expect(list.length, style).toBeGreaterThan(0);
      for (const p of list) {
        expect(p.y, style).toBeLessThan(H + 21);
        expect(Number.isFinite(p.x) && Number.isFinite(p.rot), style).toBe(true);
      }
    }
  });

  it("gusts vary the wind over time; other styles keep it steady", () => {
    const g = { ...DEFAULT_PETALS, style: "gusts" as const, wind: 0.5 };
    const values = Array.from({ length: 50 }, (_, i) => windAt(g, i * 2));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.3);
    expect(windAt({ ...DEFAULT_PETALS, wind: 0.5 }, 10)).toBe(0.5);
  });

  it("no tumble when spin is 0", () => {
    const p = spawnPetal(W, H, rng(4), DEFAULT_PETALS, true);
    expect(stepPetal(p, 1, 0, { ...DEFAULT_PETALS, spin: 0 }).rot).toBe(p.rot);
  });
});

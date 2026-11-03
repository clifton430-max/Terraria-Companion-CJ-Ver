import { describe, expect, it } from "vitest";
import { LEDGE_LOOK, LEDGE_TURN_CHANCE, decide, initialAi, type AiContext, type AiState } from "./behavior";
import { ledgeDistance, rememberVisit } from "./explore";
import { planJump } from "./jump";
import { DEFAULT_PHYSICS, STEP_DOWN, feet, step, type Body, type Platform } from "./physics";

const cfg = DEFAULT_PHYSICS;
const bounds = { width: 1600, height: 900 };
const W = 40;
const H = 84;
const on = (cx: number, top: number, id: number | null): Body => ({ x: cx - W / 2, y: top - H, vx: 0, vy: 0, w: W, h: H, grounded: true, facing: 1, platformId: id });

describe("ledge distance along connected surfaces", () => {
  const top: Platform = { id: 1, left: 100, right: 500, top: 400 };

  it("measures from the leading foot to the end of the segment, either way", () => {
    const b = on(300, 400, 1);
    const [fl, fr] = feet(b, cfg);
    expect(ledgeDistance(b, 1, [top])).toBeCloseTo(500 - fr, 6);
    expect(ledgeDistance(b, -1, [top])).toBeCloseTo(fl - 100, 6);
  });

  it("follows adjoining segments (including small steps and slopes) like the physics does", () => {
    const segs: Platform[] = [
      top,
      { id: 2, left: 500, right: 700, top: 400 + STEP_DOWN - 2 },
      { id: 3, left: 700, right: 900, top: 400 + STEP_DOWN - 2, topRight: 380 },
    ];
    const b = on(300, 400, 1);
    const [, fr] = feet(b, cfg);
    expect(ledgeDistance(b, 1, segs)).toBeCloseTo(900 - fr, 6);
  });

  it("stops at gaps and big drops", () => {
    const b = on(300, 400, 1);
    const [, fr] = feet(b, cfg);
    expect(ledgeDistance(b, 1, [top, { id: 2, left: 540, right: 800, top: 400 }])).toBeCloseTo(500 - fr, 6);
    expect(ledgeDistance(b, 1, [top, { id: 2, left: 500, right: 800, top: 400 + STEP_DOWN + 30 }])).toBeCloseTo(500 - fr, 6);
  });

  it("is unlimited on the floor or in the air, and zero for stale geometry", () => {
    expect(ledgeDistance(on(300, 900, null), 1, [top])).toBe(Infinity);
    expect(ledgeDistance({ ...on(300, 400, 1), grounded: false }, 1, [top])).toBe(Infinity);
    expect(ledgeDistance(on(300, 400, 42), 1, [top])).toBe(0);
  });
});

describe("roaming at ledges", () => {
  const ctx = (ledgeAhead: number): AiContext => ({ grounded: true, landing: false, hitWall: 0, x: 300, w: W, boundsWidth: 1600, ledgeAhead });
  const walking = { ...initialAi(), mode: "walk" as const, dir: 1 as const, timer: 5 };

  it("usually stops, peeks and turns back at a ledge", () => {
    const d = decide(walking, ctx(LEDGE_LOOK - 1), 1 / 60, () => LEDGE_TURN_CHANCE - 0.01);
    expect(d.ai.ledge).toBe("turn");
    expect(d.ai.mode).toBe("idle");
    expect(d.ai.dir).toBe(-1);
    expect(d.intent.move).toBe(0);
  });

  it("sometimes goes over on purpose, and decides only once per ledge", () => {
    let d = decide(walking, ctx(LEDGE_LOOK - 1), 1 / 60, () => 0.99);
    expect(d.ai.ledge).toBe("go");
    expect(d.intent.move).toBe(1);
    // Next frame, closer: no new decision (no flip-flopping).
    d = decide(d.ai, ctx(2), 1 / 60, () => 0);
    expect(d.ai.ledge).toBe("go");
    expect(d.intent.move).toBe(1);
    // Far from any ledge again: ready to decide next time.
    d = decide(d.ai, ctx(500), 1 / 60, () => 0.5);
    expect(d.ai.ledge).toBeNull();
  });

  it("walking on the floor is unaffected", () => {
    const d = decide(walking, ctx(Infinity), 1 / 60, () => 0);
    expect(d.ai.ledge).toBeNull();
    expect(d.intent.move).toBe(1);
  });

  it("end to end: roaming on a window top turns at the edge instead of always falling", () => {
    const tops: Platform[] = [{ id: 1, left: 200, right: 700, top: 400 }];
    let b = on(450, 400, 1);
    let ai: AiState = { ...walking };
    let fell = false;
    let turned = false;
    for (let t = 0; t < 8; t += 1 / 60) {
      const d = decide(ai, { ...ctx(ledgeDistance(b, ai.dir, tops)), x: b.x }, 1 / 60, () => 0.3);
      if (d.ai.ledge === "turn") turned = true;
      ai = { ...d.ai, timer: Math.max(d.ai.timer, 0.5) }; // keep it walking for the test
      if (ai.mode === "idle") ai = { ...ai, mode: "walk" };
      b = step(b, d.intent, 1 / 60, bounds, cfg, tops).body;
      if (!b.grounded || b.platformId === null) fell = true;
    }
    expect(turned).toBe(true);
    expect(fell).toBe(false);
  });
});

describe("curious exploring", () => {
  it("remembers recent surfaces, newest last, without duplicates", () => {
    expect(rememberVisit([1, 2, 3], 2)).toEqual([1, 3, 2]);
    expect(rememberVisit([1, 2, 3, 4], 5)).toEqual([2, 3, 4, 5]);
    expect(rememberVisit([1], null)).toEqual([1]);
  });

  it("prefers jumping to a surface it hasn't visited recently", () => {
    const tops: Platform[] = [
      { id: 7, left: 350, right: 650, top: 700 },
      { id: 8, left: 950, right: 1250, top: 700 },
    ];
    const b = on(800, 900, null);
    const counts = { 7: 0, 8: 0 } as Record<number, number>;
    for (const r of [0.05, 0.3, 0.6, 0.95]) {
      const plan = planJump(b, tops, bounds, () => r, cfg, [7]);
      if (plan) counts[plan.targetId]++;
    }
    expect(counts[8]).toBeGreaterThan(0);
    expect(counts[7]).toBe(0); // 8 is new, so 7 is skipped while 8 is reachable
  });
});

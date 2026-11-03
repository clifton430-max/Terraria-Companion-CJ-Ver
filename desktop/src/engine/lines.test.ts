import { describe, expect, it } from "vitest";
import { dropThrough } from "../overlay/controls";
import { LINE_ID_BASE, MAX_SPAN, constrain, isLineId, linePlatforms, moveSeg, pick, sanitizeLines, snapAngle, toFrac, toPx, walkable, type Line } from "./lines";
import { DEFAULT_PHYSICS, makeBody, step, type Body } from "./physics";

const bounds = { width: 1600, height: 900 };
const dt = 1 / 60;
const frac = (ax: number, ay: number, bx: number, by: number): Line => toFrac({ ax, ay, bx, by }, bounds);

function sim(b: Body, lines: Line[], n: number, move: -1 | 0 | 1 = 0, jump = false) {
  const platforms = linePlatforms(lines, bounds);
  let body = b;
  for (let i = 0; i < n; i++) body = step(body, { move, jump: jump && i === 0 }, dt, bounds, DEFAULT_PHYSICS, platforms).body;
  return body;
}
const dropFrom = (x: number, y: number): Body => ({ ...makeBody(x, bounds, 40, 84), y, grounded: false, platformId: null });

describe("invisible platforms", () => {
  it("become one-way platforms (sloped when angled) with line ids", () => {
    const p = linePlatforms([frac(200, 500, 600, 500), frac(900, 400, 700, 460)], bounds);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ left: 200, right: 600, top: 500 });
    expect(p[0].topRight).toBeUndefined();
    expect(p[1].left).toBeCloseTo(700);
    expect(p[1].right).toBeCloseTo(900);
    expect(p[1].top).toBeCloseTo(460);
    expect(p[1].topRight).toBeCloseTo(400);
    expect(p.every((x) => isLineId(x.id))).toBe(true);
    expect(isLineId(-5)).toBe(false);
  });

  it("ignores lines that are too short or too steep to walk on", () => {
    expect(walkable(toPx(frac(100, 100, 110, 100), bounds))).toBe(false);
    expect(walkable(toPx(frac(100, 100, 110, 300), bounds))).toBe(false);
    expect(linePlatforms([frac(100, 100, 110, 300)], bounds)).toHaveLength(0);
  });

  it("the character lands, stands, walks along a slope, and falls off the end", () => {
    const line = frac(200, 600, 700, 500);
    const landed = sim(dropFrom(300, 300), [line], 90);
    expect(landed.grounded).toBe(true);
    expect(isLineId(landed.platformId)).toBe(true);
    const walked = sim(landed, [line], 60, 1);
    expect(walked.grounded).toBe(true);
    expect(walked.y + walked.h).toBeLessThan(landed.y + landed.h); // uphill
    const off = sim(walked, [line], 400, 1);
    expect(off.y + off.h).toBeCloseTo(bounds.height); // walked off the end onto the floor
  });

  it("can be jumped up through and dropped down through (never traps)", () => {
    const line = frac(100, 850, 800, 850); // within a default jump (~78 px)
    const below = makeBody(300, bounds, 40, 84);
    const up = sim(below, [line], 40, 0, true);
    // Passed up through and landed on top.
    const settled = sim(up, [line], 60);
    expect(settled.y + settled.h).toBeCloseTo(850);
    const dropped = sim(dropThrough(settled), [line], 60);
    expect(dropped.y + dropped.h).toBeCloseTo(bounds.height);
  });

  it("falls when the line is deleted", () => {
    const line = frac(100, 600, 800, 600);
    const stand = sim(dropFrom(300, 300), [line], 90);
    expect(stand.y + stand.h).toBeCloseTo(600);
    expect(sim(stand, [], 60).y + stand.h).toBeCloseTo(bounds.height);
  });

  it("carries the character when the line is moved", () => {
    const stand = sim(dropFrom(300, 300), [frac(100, 600, 800, 600)], 90);
    const moved = sim(stand, [frac(100, 550, 800, 550)], 2);
    expect(moved.y + moved.h).toBeCloseTo(550);
  });

  it("editing keeps lines on screen and under the span limit", () => {
    const s = constrain({ ax: -50, ay: 100, bx: 1700, by: 100 }, bounds);
    expect(s.ax).toBe(0);
    expect(s.bx - s.ax).toBeCloseTo(bounds.width * MAX_SPAN);
    const m = moveSeg({ ax: 100, ay: 100, bx: 300, by: 120 }, -500, 2000, bounds);
    expect(m).toEqual({ ax: 0, ay: 880, bx: 200, by: 900 });
  });

  it("snaps nearly-flat lines flat, and to 15° steps with Shift", () => {
    expect(snapAngle({ x: 0, y: 0 }, { x: 100, y: 3 }, false).y).toBeCloseTo(0);
    expect(snapAngle({ x: 0, y: 0 }, { x: 100, y: 30 }, false)).toEqual({ x: 100, y: 30 });
    const s = snapAngle({ x: 0, y: 0 }, { x: 100, y: 30 }, true);
    expect(Math.atan2(s.y, s.x)).toBeCloseTo(Math.PI / 12);
  });

  it("picks end handles before line bodies", () => {
    const lines = [frac(100, 100, 400, 100)];
    expect(pick(lines, bounds, 102, 98, null)).toEqual({ index: 0, part: "a" });
    expect(pick(lines, bounds, 250, 105, null)).toEqual({ index: 0, part: "body" });
    expect(pick(lines, bounds, 250, 140, null)).toBeNull();
  });

  it("sanitizes saved data", () => {
    expect(sanitizeLines([{ x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5 }, { x1: 2, y1: 0, x2: 0, y2: 0 }, null, { x1: 0.1, y1: 0.1, x2: 0.1, y2: 0.1 }])).toHaveLength(1);
    expect(LINE_ID_BASE).toBeLessThan(-5_000_000);
  });
});

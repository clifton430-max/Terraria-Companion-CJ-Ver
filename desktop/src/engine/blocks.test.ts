import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, blockSurfaces, canPlace, cellAt, cellRect, place, remove, sanitizeBlocks, tileFrame, type Block } from "./blocks";
import { DEFAULT_PHYSICS, makeBody, step, type Body } from "./physics";
import { dropThrough } from "../overlay/controls";

const bounds = { width: 1600, height: 900 };
const g = { cell: 32, floor: bounds.height, width: bounds.width };
const dt = 1 / 60;

function sim(b: Body, blocks: Block[], n: number, move: -1 | 0 | 1 = 0, jump = false) {
  const s = blockSurfaces(blocks, g);
  let body = b;
  for (let i = 0; i < n; i++) body = step(body, { move, jump: jump && i === 0 }, dt, bounds, DEFAULT_PHYSICS, s.platforms, s.walls, s.ceilings).body;
  return body;
}

const row = (c0: number, c1: number, r: number, k: Block["k"] = "dirt"): Block[] => Array.from({ length: c1 - c0 + 1 }, (_, i) => ({ c: c0 + i, r, k }));

describe("block grid", () => {
  it("maps points to cells from the floor up", () => {
    expect(cellAt(g, 5, bounds.height - 1)).toEqual({ c: 0, r: 0 });
    expect(cellAt(g, 70, bounds.height - 40)).toEqual({ c: 2, r: 1 });
    expect(cellRect(g, 2, 1)).toEqual({ x: 64, y: bounds.height - 64, w: 32, h: 32 });
  });

  it("places predictably and refuses occupied, off-screen, over-limit and body cells", () => {
    const b1 = place([], g, 3, 0, "dirt")!;
    expect(b1).toEqual([{ c: 3, r: 0, k: "dirt" }]);
    expect(place(b1, g, 3, 0, "stone")).toBeNull();
    expect(canPlace([], g, -1, 0)).toEqual({ ok: false, reason: "outside" });
    expect(canPlace([], g, 60, 0).ok).toBe(false); // 60 * 32 > 1600
    const full = Array.from({ length: MAX_BLOCKS }, (_, i) => ({ c: i % 40, r: Math.floor(i / 40), k: "dirt" as const }));
    expect(canPlace(full, g, 45, 0)).toEqual({ ok: false, reason: "limit" });
    const body = makeBody(100, bounds, 40, 84);
    expect(canPlace([], g, Math.floor((body.x + 20) / 32), 0, body)).toEqual({ ok: false, reason: "body" });
  });

  it("removes blocks and keeps saved data valid", () => {
    expect(remove([{ c: 1, r: 0, k: "wood" }], 1, 0)).toEqual([]);
    expect(remove([], 1, 0)).toBeNull();
    const clean = sanitizeBlocks([{ c: 1, r: 0, k: "dirt" }, { c: 1, r: 0, k: "wood" }, { c: -2, r: 0, k: "dirt" }, { c: 2, r: 0, k: "lava" }, null, { c: 1.5, r: 0, k: "dirt" }]);
    expect(clean).toEqual([{ c: 1, r: 0, k: "dirt" }]);
  });

  it("frames tiles from their neighbours (Terraria sheet layout)", () => {
    expect(tileFrame(true, true, true, true, 0)).toEqual({ x: 18, y: 18 });
    expect(tileFrame(false, true, true, true, 2)).toEqual({ x: 54, y: 0 });
    expect(tileFrame(false, false, false, false, 0)).toEqual({ x: 162, y: 54 });
    expect(tileFrame(false, false, true, false, 1)).toEqual({ x: 216, y: 18 });
  });
});

describe("blocks as surfaces", () => {
  it("merges exposed tops into platforms, sides into solid walls, undersides into ceilings", () => {
    const s = blockSurfaces([...row(2, 5, 3)], g);
    expect(s.platforms).toHaveLength(1);
    expect(s.platforms[0]).toMatchObject({ left: 64, right: 192, top: bounds.height - 128 });
    expect(s.platforms[0].id).toBeLessThan(0);
    expect(s.walls).toHaveLength(2);
    expect(s.walls.every((w) => w.solid)).toBe(true);
    expect(s.ceilings).toEqual([{ left: 64, right: 192, y: bounds.height - 96 }]);
  });

  it("the character lands on and walks along a block platform", () => {
    const blocks = row(2, 12, 4);
    const top = bounds.height - 5 * 32;
    const start: Body = { ...makeBody(200, bounds, 40, 84), y: top - 200, grounded: false, platformId: null };
    const landed = sim(start, blocks, 60);
    expect(landed.grounded).toBe(true);
    expect(landed.y + landed.h).toBeCloseTo(top);
    const walked = sim(landed, blocks, 30, 1);
    expect(walked.grounded).toBe(true);
    expect(walked.y + walked.h).toBeCloseTo(top);
  });

  it("falls when the block it stands on is removed", () => {
    const blocks = row(4, 8, 3);
    const top = bounds.height - 4 * 32;
    const stand = sim({ ...makeBody(170, bounds, 40, 84), y: top - 100, grounded: false, platformId: null }, blocks, 60);
    expect(stand.y + stand.h).toBeCloseTo(top);
    const after = sim(stand, [], 60);
    expect(after.y + after.h).toBeCloseTo(bounds.height);
  });

  it("walls stop walking and airborne movement at block sides", () => {
    const tower = [0, 1, 2, 3].map((r) => ({ c: 20, r, k: "stone" as const }));
    const b = sim(makeBody(500, bounds, 40, 84), tower, 120, 1);
    expect(b.x + b.w).toBeLessThanOrEqual(20 * 32 + 0.5);
    const air: Body = { ...makeBody(560, bounds, 40, 84), y: bounds.height - 84 - 40, vx: 400, vy: -100, grounded: false, platformId: null };
    const a = sim(air, tower, 20);
    expect(a.x + a.w).toBeLessThanOrEqual(20 * 32 + 0.5);
  });

  it("steps up a single block like Terraria, but not two", () => {
    const one = [{ c: 20, r: 0, k: "dirt" as const }, { c: 21, r: 0, k: "dirt" as const }];
    const up = sim(makeBody(560, bounds, 40, 84), one, 90, 1);
    expect(up.y + up.h).toBeCloseTo(bounds.height - 32);
    const two = [...one, { c: 20, r: 1, k: "dirt" as const }, { c: 21, r: 1, k: "dirt" as const }];
    const blocked = sim(makeBody(560, bounds, 40, 84), two, 90, 1);
    expect(blocked.y + blocked.h).toBeCloseTo(bounds.height);
    expect(blocked.x + blocked.w).toBeLessThanOrEqual(20 * 32 + 0.5);
  });

  it("heads bump block undersides instead of passing through", () => {
    const roof = row(2, 10, 5);
    const b = makeBody(150, bounds, 40, 84);
    const jumped = step(b, { move: 0, jump: true, jumpVelocity: 1200 }, dt, bounds, DEFAULT_PHYSICS, ...Object.values(blockSurfaces(roof, g)) as [never, never, never]).body;
    let body = jumped;
    const s = blockSurfaces(roof, g);
    let minY = Infinity;
    for (let i = 0; i < 40; i++) {
      body = step(body, { move: 0, jump: false }, dt, bounds, DEFAULT_PHYSICS, s.platforms, s.walls, s.ceilings).body;
      minY = Math.min(minY, body.y);
    }
    expect(minY).toBeGreaterThanOrEqual(bounds.height - 6 * 32 - 0.5);
  });

  it("can't drop through placed blocks (but can through windows)", () => {
    const blocks = row(4, 8, 3);
    const stand = sim({ ...makeBody(170, bounds, 40, 84), y: 500, grounded: false, platformId: null }, blocks, 90);
    expect(stand.platformId).toBeLessThan(0);
    expect(dropThrough(stand)).toBe(stand);
    const win = { ...stand, platformId: 42 };
    expect(dropThrough(win).grounded).toBe(false);
  });
});

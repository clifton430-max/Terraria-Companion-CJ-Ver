import { describe, expect, it } from "vitest";
import { carry, junctionWalls, visibleTops } from "./platforms";
import {
  DEFAULT_PHYSICS,
  MAX_WALK_SLOPE,
  STEP_DOWN,
  STEP_UP,
  findSupport,
  isWalkable,
  slopeOf,
  step,
  surfaceY,
  type Body,
  type Platform,
  type Wall,
} from "./physics";

const cfg = DEFAULT_PHYSICS;
const bounds = { width: 1600, height: 900 };
const W = 40;
const H = 84;
const dt = 1 / 60;

/** A body standing with its feet centre at x on surface height y. */
const standingAt = (cx: number, y: number, platformId: number | null): Body => ({
  x: cx - W / 2,
  y: y - H,
  vx: 0,
  vy: 0,
  w: W,
  h: H,
  grounded: true,
  facing: 1,
  platformId,
});

/** Walk in `dir` for `seconds`, checking stable foot contact every step. */
function walk(b: Body, dir: -1 | 1, seconds: number, platforms: Platform[], walls: Wall[] = [], onStep?: (b: Body) => void) {
  for (let t = 0; t < seconds; t += dt) {
    b = step(b, { move: dir, jump: false }, dt, bounds, cfg, platforms, walls).body;
    onStep?.(b);
  }
  return b;
}

const feetY = (b: Body) => b.y + b.h;
const cx = (b: Body) => b.x + b.w / 2;

describe("segment geometry", () => {
  it("computes surface height along horizontal and sloped segments, clamped at the ends", () => {
    const flat: Platform = { id: 1, left: 100, right: 300, top: 500 };
    const ramp: Platform = { id: 2, left: 100, right: 300, top: 500, topRight: 400 };
    expect(surfaceY(flat, 250)).toBe(500);
    expect(surfaceY(ramp, 200)).toBe(450);
    expect(surfaceY(ramp, 0)).toBe(500);
    expect(surfaceY(ramp, 999)).toBe(400);
    expect(slopeOf(ramp)).toBe(-0.5);
  });

  it("treats steep or degenerate segments as non-walkable", () => {
    expect(isWalkable({ id: 1, left: 0, right: 100, top: 500, topRight: 500 - 100 * (MAX_WALK_SLOPE + 0.1) })).toBe(false);
    expect(isWalkable({ id: 1, left: 0, right: 100, top: 500, topRight: 450 })).toBe(true);
    expect(isWalkable({ id: 1, left: 100, right: 100, top: 500 })).toBe(false);
    expect(isWalkable({ id: 1, left: 0, right: 100, top: NaN })).toBe(false);
  });
});

describe("walking on segments", () => {
  it("horizontal: keeps the feet exactly on the surface while walking", () => {
    const flat: Platform[] = [{ id: 1, left: 100, right: 900, top: 500 }];
    walk(standingAt(300, 500, 1), 1, 2, flat, [], (b) => {
      expect(b.grounded).toBe(true);
      expect(feetY(b)).toBe(500);
    });
  });

  it("sloped: walks up and down a ramp with the feet following the line", () => {
    const ramp: Platform[] = [{ id: 1, left: 100, right: 900, top: 600, topRight: 400 }];
    let up = walk(standingAt(200, surfaceY(ramp[0], 200), 1), 1, 3, ramp, [], (b) => {
      expect(b.grounded).toBe(true);
      expect(feetY(b)).toBeCloseTo(surfaceY(ramp[0], cx(b)), 6);
    });
    expect(feetY(up)).toBeLessThan(600 - 30); // climbed
    up = walk(up, -1, 3, ramp, [], (b) => expect(feetY(b)).toBeCloseTo(surfaceY(ramp[0], cx(b)), 6));
    expect(up.grounded).toBe(true);
  });

  it("lands on a slope from above at the right height, but falls past a too-steep one", () => {
    const ramp: Platform = { id: 3, left: 100, right: 900, top: 700, topRight: 500 };
    let b: Body = { ...standingAt(500, 200, null), grounded: false };
    for (let t = 0; t < 2 && !b.grounded; t += dt) b = step(b, { move: 0, jump: false }, dt, bounds, cfg, [ramp]).body;
    expect(b.platformId).toBe(3);
    expect(feetY(b)).toBeCloseTo(surfaceY(ramp, 500), 6);
    const cliff: Platform = { id: 4, left: 480, right: 520, top: 700, topRight: 300 };
    b = { ...standingAt(500, 200, null), grounded: false };
    for (let t = 0; t < 2; t += dt) b = step(b, { move: 0, jump: false }, dt, bounds, cfg, [cliff]).body;
    expect(b.platformId).toBeNull(); // landed on the floor instead
  });

  it("connected: crosses adjoining segments of different windows, small steps included, without falling", () => {
    const segs: Platform[] = [
      { id: 1, left: 100, right: 400, top: 500 },
      { id: 2, left: 400, right: 700, top: 500 + STEP_DOWN - 2 }, // small drop
      { id: 3, left: 700, right: 1000, top: 500 + STEP_DOWN - 2 - (STEP_UP - 1) }, // small rise
    ];
    const ids = new Set<number | null>();
    const end = walk(standingAt(200, 500, 1), 1, 10, segs, [], (b) => {
      expect(b.grounded).toBe(true);
      ids.add(b.platformId);
    });
    expect([...ids]).toEqual([1, 2, 3]);
    expect(end.platformId).toBe(3);
  });

  it("corner: a slope meeting a flat segment transitions smoothly (no bounce or snap)", () => {
    const segs: Platform[] = [
      { id: 1, left: 100, right: 500, top: 600, topRight: 500 },
      { id: 2, left: 500, right: 900, top: 500 },
    ];
    let prev = 600;
    walk(standingAt(200, surfaceY(segs[0], 200), 1), 1, 10, segs, [], (b) => {
      expect(b.grounded).toBe(true);
      expect(feetY(b)).toBeLessThanOrEqual(prev + 1e-9); // only ever rises, then levels off
      prev = feetY(b);
    });
  });

  it("disconnected: a gap or a big drop is fallen through rather than snapped across", () => {
    const gap: Platform[] = [
      { id: 1, left: 100, right: 400, top: 500 },
      { id: 2, left: 480, right: 900, top: 500 },
    ];
    const b = walk(standingAt(300, 500, 1), 1, 3, gap);
    expect(b.platformId).not.toBe(2); // fell in the gap (to the floor)
    const drop: Platform[] = [
      { id: 1, left: 100, right: 400, top: 500 },
      { id: 2, left: 400, right: 900, top: 500 + STEP_DOWN + 40 },
    ];
    let fell = false;
    walk(standingAt(300, 500, 1), 1, 3, drop, [], (s) => (fell ||= !s.grounded));
    expect(fell).toBe(true); // a real drop is a fall (and a landing), not a teleport
  });

  it("endpoint: walking off the end of an isolated segment falls", () => {
    const b = walk(standingAt(300, 500, 1), 1, 6, [{ id: 1, left: 100, right: 400, top: 500 }]);
    expect(b.platformId).toBeNull();
    expect(feetY(b)).toBe(bounds.height);
  });

  it("does not snap to an unrelated segment that's far above or below the feet", () => {
    const b = standingAt(300, 500, 1);
    const other: Platform[] = [{ id: 9, left: 100, right: 900, top: 500 - STEP_UP - 20 }];
    expect(findSupport({ ...b, platformId: null }, other)).toBeNull();
  });
});

describe("vertical boundaries", () => {
  const top: Platform[] = [{ id: 1, left: 100, right: 900, top: 500 }];
  const wall: Wall = { id: 2, x: 600, top: 200, bottom: 500 };

  it("stop walking along the top at the wall, from either side", () => {
    const right = walk(standingAt(400, 500, 1), 1, 6, top, [wall]);
    expect(right.x + right.w).toBe(600);
    expect(right.grounded).toBe(true);
    const left = walk(standingAt(800, 500, 1), -1, 6, top, [wall]);
    expect(left.x).toBe(600);
  });

  it("never block someone on the floor below, or a body in the air", () => {
    const floor = walk(standingAt(400, bounds.height, null), 1, 6, [], [{ id: 2, x: 600, top: 200, bottom: 820 }]);
    expect(floor.x + floor.w).toBeGreaterThan(600);
    let air: Body = { ...standingAt(400, 450, null), grounded: false, vx: 600, vy: -400 };
    for (let t = 0; t < 0.6; t += dt) air = step(air, { move: 0, jump: false }, dt, bounds, cfg, [], [wall]).body;
    expect(air.x + air.w).toBeGreaterThan(600);
  });

  it("are generated where a taller front window covers part of another window's top", () => {
    const windows = [
      { id: 10, x: 500, y: 200, w: 300, h: 500 }, // front, taller
      { id: 11, x: 100, y: 400, w: 1000, h: 300 }, // behind
    ];
    const walls = junctionWalls(windows, bounds);
    expect(walls).toEqual([
      { id: 10, x: 500, top: 200, bottom: 400 },
      { id: 10, x: 800, top: 200, bottom: 400 },
    ]);
    // The back window's top is split around the front window, which is where the walls sit.
    expect(visibleTops(windows, bounds).filter((p) => p.id === 11).map((p) => [p.left, p.right])).toEqual([
      [100, 500],
      [800, 1100],
    ]);
    // A front window that doesn't rise above the edge makes no wall; nor do windows side by side.
    expect(junctionWalls([{ id: 1, x: 500, y: 400, w: 100, h: 100 }, { id: 2, x: 100, y: 400, w: 1000, h: 300 }], bounds)).toEqual([]);
    expect(junctionWalls([{ id: 1, x: 0, y: 100, w: 400, h: 600 }, { id: 2, x: 400, y: 300, w: 400, h: 300 }], bounds)).toEqual([]);
  });
});

describe("moving and stale geometry", () => {
  it("moving platform: carried with its window and stays in contact", () => {
    const before = [{ id: 1, x: 100, y: 500, w: 800, h: 200 }];
    const after = [{ id: 1, x: 160, y: 460, w: 800, h: 200 }];
    let b = standingAt(400, 500, 1);
    b = carry(b, before, after, bounds);
    expect(cx(b)).toBe(460);
    b = step(b, { move: 0, jump: false }, dt, bounds, cfg, visibleTops(after, bounds)).body;
    expect(b.grounded && b.platformId === 1 && feetY(b) === 460).toBe(true);
  });

  it("missing geometry: a vanished window or stale id makes it fall, never hover", () => {
    let b = standingAt(400, 500, 42);
    b = step(b, { move: 0, jump: false }, dt, bounds, cfg, [{ id: 1, left: 0, right: 100, top: 300 }]).body;
    expect(b.grounded).toBe(false);
    expect(b.platformId).toBeNull();
    const nan = step(standingAt(400, 500, 1), { move: 0, jump: false }, dt, bounds, cfg, [{ id: 1, left: 100, right: 900, top: NaN }]).body;
    expect(nan.platformId).toBeNull();
  });

  it("recomputes from fresh snapshots: resized windows change the segments", () => {
    expect(visibleTops([{ id: 1, x: 100, y: 500, w: 800, h: 200 }], bounds)[0]).toMatchObject({ left: 100, right: 900 });
    expect(visibleTops([{ id: 1, x: 100, y: 500, w: 300, h: 200 }], bounds)[0]).toMatchObject({ left: 100, right: 400 });
    expect(visibleTops([], bounds)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_CELL, FOLLOW_RATE, LEGACY_CELL, SEAT_Y, cursorAnchor, effectiveMode, followStep, homeToPosition, legacyAnimFor, positionToHome, releaseFromCursor, stayFrame, stayMove } from "./modes";

describe("cursor modes", () => {
  const cursor = { x: 400, y: 300 };

  it("Ride seats the character's hips on the pointer", () => {
    const a = cursorAnchor("ride", cursor, 2, 1440);
    expect(a.frame).toBe("ride");
    // Hips (cell y SEAT_Y) land on the cursor; body box starts at cell y 12.
    expect(a.y + (SEAT_Y - DEFAULT_CELL.originY) * 2).toBe(cursor.y);
    expect(a.x + 10 * 2).toBe(cursor.x); // centred (cell centre x 20 → body x + 10)
  });

  it("Hug puts the hand on the pointer from the side facing the screen centre", () => {
    const right = cursorAnchor("hug", { x: 1000, y: 300 }, 2, 1440);
    expect(right.facing).toBe(1);
    expect(right.x + (DEFAULT_CELL.hand.x - 10) * 2).toBeCloseTo(1000);
    const left = cursorAnchor("hug", { x: 200, y: 300 }, 2, 1440);
    expect(left.facing).toBe(-1);
    expect(left.x + (40 - DEFAULT_CELL.hand.x - 10) * 2).toBeCloseTo(200); // mirrored hand
  });

  it("Become puts the pointing hand exactly on the hotspot at scale 1", () => {
    const a = cursorAnchor("become", cursor, 1, 1440);
    expect(a.x + (DEFAULT_CELL.hand.x - 10)).toBe(cursor.x);
    expect(a.y + (DEFAULT_CELL.hand.y - 12)).toBe(cursor.y);
  });

  it("follow smoothing converges, is frame-rate independent, and Become is exact", () => {
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 60; i++) p = followStep(p, { x: 100, y: 50 }, 1 / 60, FOLLOW_RATE.ride);
    expect(p.x).toBeCloseTo(100, 0);
    const fine = [0, 0, 0, 0].reduce((q) => followStep(q, { x: 100, y: 0 }, 1 / 240, 14), { x: 0, y: 0 });
    const coarse = followStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 1 / 60, 14);
    expect(fine.x).toBeCloseTo(coarse.x, 6);
    expect(followStep({ x: 0, y: 0 }, { x: 7, y: 9 }, 0.001, FOLLOW_RATE.become)).toEqual({ x: 7, y: 9 });
  });
});

describe("Stay-Put mode", () => {
  const bounds = { width: 1440, height: 800 };

  it("home positions round-trip through screen fractions and stay on screen", () => {
    const pos = { x: 700, y: 300 };
    const home = positionToHome(pos, bounds, 40, 84);
    expect(homeToPosition(home, bounds, 40, 84)).toEqual(pos);
    expect(positionToHome({ x: -50, y: 5000 }, bounds, 40, 84)).toEqual({ x: 0, y: 1 });
    // A different screen size keeps the same relative spot.
    const wide = homeToPosition(home, { width: 2880, height: 1600 }, 40, 84);
    expect(wide.x / (2880 - 40)).toBeCloseTo(home.x);
  });

  it("poses map to atlas frames, waving alternates, and fallbacks exist", () => {
    expect(stayFrame("stand", 3)).toBe("idle");
    expect(stayFrame("sit", 3)).toBe("sit");
    expect([0, 0.4, 0.8].map((t) => stayFrame("wave", t))).toEqual(["wave1", "wave2", "wave1"]);
    expect(legacyAnimFor("sit")).toBe("land");
    expect(legacyAnimFor("wave2")).toBe("cast");
    expect(legacyAnimFor("hug")).toBe("shoot");
  });
});

describe("mode transitions", () => {
  it("control beats cursor modes, which beat Stay, which beats roaming", () => {
    expect(effectiveMode({ control: true, cursorMode: "ride", companionMode: "stay" })).toBe("control");
    expect(effectiveMode({ control: false, cursorMode: "hug", companionMode: "stay" })).toBe("cursor");
    expect(effectiveMode({ control: false, cursorMode: "off", companionMode: "stay" })).toBe("stay");
    expect(effectiveMode({ control: false, cursorMode: "off", companionMode: "roam" })).toBe("roam");
  });

  it("Stay walks back home after a knockback and rests inside the dead zone", () => {
    expect(stayMove(100, 300)).toBe(1);
    expect(stayMove(500, 300)).toBe(-1);
    expect(stayMove(303, 300)).toBe(0);
  });

  it("leaving a cursor mode drops the character, on screen, back under physics", () => {
    const body = { x: 1500, y: -40, w: 40, h: 84, vx: 300, vy: -20, grounded: true, platformId: 7 as number | null, facing: 1 };
    const out = releaseFromCursor(body, { width: 1440, height: 800 });
    expect(out).toMatchObject({ x: 1400, y: 0, vx: 0, vy: 0, grounded: false, platformId: null, facing: 1 });
  });

  it("the built-in sprite has its own seat and hand geometry", () => {
    const a = cursorAnchor("ride", { x: 100, y: 100 }, 3, 1440, LEGACY_CELL);
    expect(a.y + LEGACY_CELL.seatY * 3).toBe(100);
  });
});

describe("favorite spot recovery", () => {
  it("survives resolution changes, a removed display (smaller area) and corrupt values", () => {
    const fav = positionToHome({ x: 2000, y: 900 }, { width: 2560, height: 1400 }, 40, 84);
    for (const b of [{ width: 2560, height: 1400 }, { width: 1440, height: 800 }, { width: 1024, height: 640 }]) {
      const p = homeToPosition(fav, b, 40, 84);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + 40).toBeLessThanOrEqual(b.width);
      expect(p.y + 84).toBeLessThanOrEqual(b.height);
    }
    expect(homeToPosition({ x: 7, y: -3 }, { width: 1000, height: 600 }, 40, 84)).toEqual({ x: 960, y: 0 });
    expect(homeToPosition({ x: NaN, y: 0.5 }, { width: 1040, height: 684 }, 40, 84)).toEqual({ x: 500, y: 300 });
  });

  it("switching Stay-Put on and off is one mode change", () => {
    expect(effectiveMode({ control: false, cursorMode: "off", companionMode: "stay" })).toBe("stay");
    expect(effectiveMode({ control: false, cursorMode: "off", companionMode: "roam" })).toBe("roam");
    expect(stayMove(500, 500)).toBe(0); // at the spot: no wandering
  });
});

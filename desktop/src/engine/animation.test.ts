import { describe, expect, it } from "vitest";
import {
  SWING_RAISE_FRACTION,
  attackAnimFor,
  attackFrameIndex,
  frameIndex,
  landDuration,
  selectAnim,
  type AnimInput,
} from "./animation";
import { FRAMES, PALETTE, SPRITE_H, SPRITE_W } from "./sprites";

const base: AnimInput = { grounded: true, vx: 0, vy: 0, landTimer: 0, dragging: false };

describe("selectAnim", () => {
  it("covers every state", () => {
    expect(selectAnim(base)).toBe("idle");
    expect(selectAnim({ ...base, vx: 70 })).toBe("walk");
    expect(selectAnim({ ...base, grounded: false, vy: -100 })).toBe("jump");
    expect(selectAnim({ ...base, grounded: false, vy: 100 })).toBe("fall");
    expect(selectAnim({ ...base, landTimer: 0.1, vx: 70 })).toBe("land");
    expect(selectAnim({ ...base, dragging: true })).toBe("fall");
  });
});

describe("frameIndex", () => {
  it("cycles through frames and wraps", () => {
    expect(frameIndex("walk", 0, 4)).toBe(0);
    expect(frameIndex("walk", 0.14, 4)).toBe(1);
    expect(frameIndex("walk", 0.53, 4)).toBe(0);
    expect(frameIndex("jump", 5, 1)).toBe(0);
  });
});

describe("landDuration", () => {
  it("skips tiny drops and caps hard landings", () => {
    expect(landDuration(0)).toBe(0);
    expect(landDuration(100)).toBe(0);
    expect(landDuration(600)).toBeGreaterThan(0);
    expect(landDuration(100000)).toBe(0.32);
  });
});

describe("sprite frames", () => {
  it("every animation has frames of the right size using known palette keys", () => {
    for (const [anim, frames] of Object.entries(FRAMES)) {
      expect(frames.length, anim).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.length, anim).toBe(SPRITE_H);
        for (const row of frame) {
          expect(row.length, `${anim}: "${row}"`).toBe(SPRITE_W);
          for (const ch of row) expect(ch in PALETTE, `${anim}: '${ch}'`).toBe(true);
        }
      }
    }
  });

  it("grounded poses touch the bottom row", () => {
    for (const anim of ["idle", "walk", "land"] as const) {
      for (const frame of FRAMES[anim]) expect(frame[SPRITE_H - 1]).toMatch(/k/);
    }
  });
});

describe("attack animation transitions", () => {
  it("attacks override walking, jumping, falling and landing", () => {
    expect(selectAnim({ ...base, vx: 70, attack: "swing" })).toBe("swing");
    expect(selectAnim({ ...base, grounded: false, vy: -300, attack: "shoot" })).toBe("shoot");
    expect(selectAnim({ ...base, grounded: false, vy: 300, attack: "cast" })).toBe("cast");
    expect(selectAnim({ ...base, landTimer: 0.2, attack: "cast" })).toBe("cast");
  });

  it("being dragged overrides an attack, and the pose returns to movement afterwards", () => {
    expect(selectAnim({ ...base, dragging: true, attack: "swing" })).toBe("fall");
    expect(selectAnim({ ...base, vx: 70, attack: null })).toBe("walk");
    expect(selectAnim({ ...base, attack: null })).toBe("idle");
  });

  it("maps weapon archetypes to attack animations", () => {
    expect(attackAnimFor("sword")).toBe("swing");
    expect(attackAnimFor("bow")).toBe("shoot");
    expect(attackAnimFor("gun")).toBe("shoot");
    expect(attackAnimFor("staff")).toBe("cast");
    expect(attackAnimFor("summon")).toBe("cast");
  });

  it("sword swings go from the raised wind-up to the forward strike", () => {
    expect(attackFrameIndex("swing", 0)).toBe(0);
    expect(attackFrameIndex("swing", SWING_RAISE_FRACTION - 0.01)).toBe(0);
    expect(attackFrameIndex("swing", SWING_RAISE_FRACTION)).toBe(1);
    expect(attackFrameIndex("swing", 1)).toBe(1);
    expect(attackFrameIndex("shoot", 0.9)).toBe(0);
    expect(FRAMES.swing).toHaveLength(2);
  });
});

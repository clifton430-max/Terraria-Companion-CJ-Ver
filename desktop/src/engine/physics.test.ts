import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHYSICS as cfg,
  clampToBounds,
  dragTo,
  makeBody,
  release,
  step,
  throwVelocity,
  type Body,
  type Intent,
} from "./physics";

const bounds = { width: 800, height: 600 };
const idle: Intent = { move: 0, jump: false };
const dt = 1 / 60;

function run(body: Body, intent: Intent, seconds: number) {
  let b = body;
  let landed = false;
  let impact = 0;
  const walls = new Set<number>();
  for (let t = 0; t < seconds; t += dt) {
    const r = step(b, intent, dt, bounds, cfg);
    b = r.body;
    if (r.landed) {
      landed = true;
      impact = r.impactSpeed;
    }
    if (r.hitWall) walls.add(r.hitWall);
  }
  return { body: b, landed, impact, walls };
}

describe("gravity and landing", () => {
  it("a body released in the air falls and lands exactly on the floor", () => {
    const start: Body = { ...makeBody(100, bounds, 48, 72), y: 100, grounded: false };
    const { body, landed, impact } = run(start, idle, 2);
    expect(landed).toBe(true);
    expect(impact).toBeGreaterThan(0);
    expect(body.grounded).toBe(true);
    expect(body.y).toBe(bounds.height - body.h);
    expect(body.vy).toBe(0);
  });

  it("fall speed is capped at maxFallSpeed", () => {
    const tall = { width: 800, height: 100000 };
    let b: Body = { ...makeBody(0, tall, 48, 72), y: 0, grounded: false };
    for (let i = 0; i < 300; i++) b = step(b, idle, dt, tall, cfg).body;
    expect(b.vy).toBe(cfg.maxFallSpeed);
  });

  it("a grounded idle body stays put and never reports landing", () => {
    const start = makeBody(200, bounds, 48, 72);
    const r = step(start, idle, dt, bounds, cfg);
    expect(r.landed).toBe(false);
    expect(r.body).toEqual(start);
  });

  it("huge frame gaps are clamped so the body cannot tunnel through the floor", () => {
    const start: Body = { ...makeBody(100, bounds, 48, 72), y: 400, grounded: false, vy: 1000 };
    const r = step(start, idle, 5, bounds, cfg);
    expect(r.body.y).toBeLessThanOrEqual(bounds.height - r.body.h);
  });
});

describe("walking and walls", () => {
  it("walking accelerates to walkSpeed and turns to face the direction", () => {
    const { body } = run(makeBody(300, bounds, 48, 72), { move: -1, jump: false }, 0.5);
    expect(body.vx).toBe(-cfg.walkSpeed);
    expect(body.facing).toBe(-1);
    expect(body.x).toBeLessThan(300);
  });

  it("walking into the right edge stops at the boundary and reports the wall", () => {
    const { body, walls } = run(makeBody(740, bounds, 48, 72), { move: 1, jump: false }, 2);
    expect(body.x).toBe(bounds.width - body.w);
    expect(walls.has(1)).toBe(true);
    expect(body.vx).toBe(0);
  });

  it("walking into the left edge stops at x = 0", () => {
    const { body, walls } = run(makeBody(10, bounds, 48, 72), { move: -1, jump: false }, 2);
    expect(body.x).toBe(0);
    expect(walls.has(-1)).toBe(true);
  });

  it("airborne bodies bounce off walls with reduced speed", () => {
    const start: Body = { ...makeBody(0, bounds, 48, 72), x: 750, y: 100, vx: 1000, grounded: false };
    const r = step(start, idle, dt, bounds, cfg);
    expect(r.hitWall).toBe(1);
    expect(r.body.vx).toBeLessThan(0);
    expect(Math.abs(r.body.vx)).toBeLessThan(1000);
  });

  it("ground friction brings a sliding body to rest", () => {
    const start: Body = { ...makeBody(300, bounds, 48, 72), vx: 400 };
    const { body } = run(start, idle, 1);
    expect(body.vx).toBe(0);
  });
});

describe("jumping", () => {
  it("jumps only from the ground, rises, then lands", () => {
    const start = makeBody(300, bounds, 48, 72);
    const first = step(start, { move: 0, jump: true }, dt, bounds, cfg);
    expect(first.body.grounded).toBe(false);
    expect(first.body.vy).toBeLessThan(0);
    expect(first.body.y).toBeLessThan(start.y);

    // A second jump request mid-air must not add more upward velocity.
    const second = step(first.body, { move: 0, jump: true }, dt, bounds, cfg);
    expect(second.body.vy).toBeGreaterThan(first.body.vy);

    const { body, landed } = run(second.body, idle, 2);
    expect(landed).toBe(true);
    expect(body.grounded).toBe(true);
  });

  it("jump height matches v²/2g within one step of error", () => {
    let b = step(makeBody(300, bounds, 48, 72), { move: 0, jump: true }, dt, bounds, cfg).body;
    let minY = b.y;
    for (let i = 0; i < 120; i++) {
      b = step(b, idle, dt, bounds, cfg).body;
      minY = Math.min(minY, b.y);
    }
    const height = bounds.height - 72 - minY;
    const expected = cfg.jumpVelocity ** 2 / (2 * cfg.gravity);
    expect(Math.abs(height - expected)).toBeLessThan(cfg.jumpVelocity * dt);
  });

  it("hitting the ceiling stops upward motion", () => {
    const start: Body = { ...makeBody(300, bounds, 48, 72), y: 5, vy: -800, grounded: false };
    const r = step(start, idle, dt, bounds, cfg);
    expect(r.body.y).toBe(0);
    expect(r.body.vy).toBeGreaterThanOrEqual(0);
  });
});

describe("dragging and throwing", () => {
  it("dragTo clamps the body inside the screen and freezes velocity", () => {
    const b = dragTo(makeBody(300, bounds, 48, 72), -50, 9999, bounds);
    expect(b.x).toBe(0);
    expect(b.y).toBe(bounds.height - 72);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
    expect(b.facing).toBe(-1);
  });

  it("release caps throw speed", () => {
    const b = release(makeBody(300, bounds, 48, 72), 30000, 40000, cfg);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(cfg.maxThrowSpeed);
    expect(b.grounded).toBe(false);
  });

  it("throwVelocity uses only recent samples", () => {
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 100, y: 0, t: 900 },
      { x: 150, y: -25, t: 950 },
      { x: 200, y: -50, t: 1000 },
    ];
    // The t=0 sample is outside the window; t=900..1000 spans 100px right, 50px up in 0.1s.
    const v = throwVelocity(samples, 1000, 100);
    expect(v.vx).toBeCloseTo(1000);
    expect(v.vy).toBeCloseTo(-500);
  });

  it("throwVelocity returns zero for a stationary hold", () => {
    expect(throwVelocity([{ x: 5, y: 5, t: 0 }], 2000)).toEqual({ vx: 0, vy: 0 });
    expect(throwVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
  });
});

describe("bounds", () => {
  it("clampToBounds handles a screen smaller than the body", () => {
    const b = clampToBounds(makeBody(0, bounds, 48, 72), { width: 10, height: 10 });
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
  });

  it("makeBody places the character on the floor inside the screen", () => {
    const b = makeBody(5000, bounds, 48, 72);
    expect(b.x).toBe(bounds.width - 48);
    expect(b.y).toBe(bounds.height - 72);
    expect(b.grounded).toBe(true);
  });
});

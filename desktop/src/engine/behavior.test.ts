import { describe, expect, it } from "vitest";
import { decide, initialAi, mulberry32, type AiContext, type AiState } from "./behavior";
import { DEFAULT_PHYSICS, makeBody, step, type Body } from "./physics";

const ctx = (over: Partial<AiContext> = {}): AiContext => ({
  grounded: true,
  landing: false,
  hitWall: 0,
  x: 400,
  w: 48,
  boundsWidth: 1000,
  ...over,
});

/** RNG that replays a fixed sequence. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("behavior", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("starts walking when the idle timer expires and the roll picks walk", () => {
    const ai: AiState = { ...initialAi(), timer: 0.01 };
    const { ai: next, intent } = decide(ai, ctx(), 0.02, seq(0.1, 0.9, 0.5));
    expect(next.mode).toBe("walk");
    expect(next.dir).toBe(1);
    expect(intent.move).toBe(1);
  });

  it("walks away from a nearby edge", () => {
    const ai: AiState = { ...initialAi(), timer: 0 };
    const near = decide(ai, ctx({ x: 10 }), 0.02, seq(0.1, 0.0, 0.5));
    expect(near.ai.dir).toBe(1);
    const far = decide(ai, ctx({ x: 1000 - 48 - 10 }), 0.02, seq(0.1, 0.9, 0.5));
    expect(far.ai.dir).toBe(-1);
  });

  it("reverses direction after hitting a wall", () => {
    const ai: AiState = { mode: "walk", timer: 5, dir: 1, wantJump: false };
    const { ai: next, intent } = decide(ai, ctx({ hitWall: 1 }), 0.016, seq(0.99));
    expect(next.dir).toBe(-1);
    expect(intent.move).toBe(-1);
  });

  it("only jumps when grounded and not landing", () => {
    const ai: AiState = { mode: "idle", timer: 5, dir: 1, wantJump: true };
    expect(decide(ai, ctx({ grounded: false }), 0.016, seq(0.99)).intent.jump).toBe(false);
    expect(decide(ai, ctx({ landing: true }), 0.016, seq(0.99)).intent.jump).toBe(false);
    const ok = decide(ai, ctx(), 0.016, seq(0.99));
    expect(ok.intent.jump).toBe(true);
    expect(ok.ai.wantJump).toBe(false);
  });

  it("stands still during the landing pose", () => {
    const ai: AiState = { mode: "walk", timer: 5, dir: 1, wantJump: false };
    expect(decide(ai, ctx({ landing: true }), 0.016, seq(0.99)).intent.move).toBe(0);
  });

  it("a long simulated wander never leaves the screen", () => {
    const bounds = { width: 600, height: 400 };
    const rng = mulberry32(7);
    let body: Body = makeBody(300, bounds, 48, 72);
    let ai = initialAi();
    let hitWall: -1 | 0 | 1 = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const d = decide(
        ai,
        { grounded: body.grounded, landing: false, hitWall, x: body.x, w: body.w, boundsWidth: bounds.width },
        1 / 60,
        rng,
      );
      ai = d.ai;
      const r = step(body, d.intent, 1 / 60, bounds, DEFAULT_PHYSICS);
      body = r.body;
      hitWall = r.hitWall;
      expect(body.x).toBeGreaterThanOrEqual(0);
      expect(body.x).toBeLessThanOrEqual(bounds.width - body.w);
      expect(body.y).toBeGreaterThanOrEqual(0);
      expect(body.y).toBeLessThanOrEqual(bounds.height - body.h);
    }
  });
});

describe("combat goals (training mode)", () => {
  const goal = (targetX: number, range: number, ready = true) => ({ targetX, range, ready });
  const at = (x: number, over: Partial<AiContext> = {}) => ctx({ x: x - 24, ...over }); // centre at x

  it("walks toward a target that is out of range", () => {
    const d = decide(initialAi(), at(400, { combat: goal(800, 60) }), 0.016, seq(0.5));
    expect(d.intent.move).toBe(1);
    expect(d.attack).toBeUndefined();
    const left = decide(initialAi(), at(400, { combat: goal(100, 60) }), 0.016, seq(0.5));
    expect(left.intent.move).toBe(-1);
  });

  it("stops, faces the target and attacks when in range and ready", () => {
    const d = decide(initialAi(), at(400, { combat: goal(350, 60) }), 0.016, seq(0.5));
    expect(d.intent).toMatchObject({ move: 0, face: -1 });
    expect(d.attack).toBe(-1);
  });

  it("waits without attacking while the weapon is cooling down", () => {
    const d = decide(initialAi(), at(400, { combat: goal(450, 60, false) }), 0.016, seq(0.5));
    expect(d.intent.move).toBe(0);
    expect(d.attack).toBeUndefined();
  });

  it("ranged weapons back away from a target that is too close, unless against a wall", () => {
    const d = decide(initialAi(), at(400, { combat: goal(420, 360) }), 0.016, seq(0.5));
    expect(d.intent.move).toBe(-1);
    const cornered = decide(initialAi(), at(400, { combat: goal(420, 360), hitWall: -1 }), 0.016, seq(0.5));
    expect(cornered.intent.move).toBe(0);
    expect(cornered.attack).toBe(1);
  });

  it("doesn't back away from a flying target overhead that is horizontally close but far away", () => {
    const overhead = decide(initialAi(), at(400, { combat: { targetX: 410, range: 360, ready: true, distance: 300 } }), 0.016, seq(0.5));
    expect(overhead.intent.move).toBe(0);
    expect(overhead.attack).toBe(1);
  });

  it("ranged weapons fire while approaching a target that is nearly in range; melee doesn't", () => {
    const ranged = decide(initialAi(), at(400, { combat: { targetX: 900, range: 400, ready: true, distance: 520 } }), 0.016, seq(0.5));
    expect(ranged.intent.move).toBe(1);
    expect(ranged.attack).toBe(1);
    const tooFar = decide(initialAi(), at(400, { combat: { targetX: 1100, range: 400, ready: true, distance: 700 } }), 0.016, seq(0.5));
    expect(tooFar.attack).toBeUndefined();
    const melee = decide(initialAi(), at(400, { combat: { targetX: 480, range: 60, ready: true, distance: 80 } }), 0.016, seq(0.5));
    expect(melee.intent.move).toBe(1);
    expect(melee.attack).toBeUndefined();
  });

  it("stands still while an attack animation plays", () => {
    const ai: AiState = { mode: "walk", timer: 5, dir: 1, wantJump: true };
    const d = decide(ai, ctx({ busy: true }), 0.016, seq(0.5));
    expect(d.intent).toEqual({ move: 0, jump: false });
  });

  it("face intent turns the body without moving it", () => {
    const bounds = { width: 600, height: 400 };
    const r = step(makeBody(300, bounds, 48, 72), { move: 0, jump: false, face: -1 }, 1 / 60, bounds);
    expect(r.body.facing).toBe(-1);
    expect(r.body.x).toBe(300);
  });
});

describe("no excessive jumping", () => {
  it("never hops on its own while roaming (10 minutes of decisions)", async () => {
    const { decide, initialAi, mulberry32 } = await import("./behavior");
    const rng = mulberry32(42);
    let ai = initialAi();
    let jumps = 0;
    for (let t = 0; t < 600; t += 1 / 60) {
      const d = decide(ai, ctx(), 1 / 60, rng);
      ai = d.ai;
      if (d.intent.jump) jumps++;
    }
    expect(jumps).toBe(0);
  });

  it("jumps to other surfaces only now and then, never back-to-back", async () => {
    const { decide, initialAi, mulberry32, PLATFORM_JUMP_COOLDOWN } = await import("./behavior");
    const rng = mulberry32(7);
    let ai = initialAi();
    const times: number[] = [];
    const plan = () => ({ vy: 600, vx: 100, target: 1 }) as never;
    for (let t = 0; t < 120; t += 1 / 60) {
      const d = decide(ai, ctx({ planJump: plan }), 1 / 60, rng);
      ai = d.ai;
      if (d.intent.jump) times.push(t);
    }
    expect(times.length).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(PLATFORM_JUMP_COOLDOWN - 0.01);
  });
});

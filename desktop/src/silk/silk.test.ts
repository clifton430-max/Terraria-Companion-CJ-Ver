import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, makeBody, type Body, type Platform } from "../engine/physics";
import {
  DASH_COOLDOWN,
  DASH_SPEED,
  DASH_TIME,
  GLIDE_FALL_SPEED,
  JUMP_BUFFER,
  RUN_SPEED,
  SPRINT_SPEED,
  WALL_SLIDE_SPEED,
  aimVector,
  findAnchor,
  initialSilk,
  noSilkInput,
  silkStep,
  type SilkInput,
  type SilkState,
} from "./movement";
import {
  CHARGE_TIME,
  MAX_SILK,
  NEEDLE,
  NEEDLE_COOLDOWN,
  SPIN_COST,
  destroyerPower,
  gainSilk,
  initialNeedle,
  isActive,
  needleHitbox,
  needleStep,
  rectContains,
  strikeKind,
  type NeedleInput,
} from "./needle";

const bounds = { width: 1600, height: 900 };
const dt = 1 / 60;
const world = (platforms: Platform[] = []) => ({ bounds, platforms, walls: [], cfg: DEFAULT_PHYSICS });
const ground = (x = 600): Body => makeBody(x, bounds, 40, 84);

function run(s: SilkState, b: Body, inp: Partial<SilkInput> | ((i: number) => Partial<SilkInput>), steps: number, platforms: Platform[] = []) {
  const events: string[] = [];
  for (let i = 0; i < steps; i++) {
    const input = { ...noSilkInput(), ...(typeof inp === "function" ? inp(i) : inp) };
    const r = silkStep(s, b, input, dt, world(platforms));
    s = r.state;
    b = r.body;
    events.push(...r.events.map((e) => e.type));
  }
  return { s, b, events };
}

describe("Silksong movement", () => {
  it("runs up to speed quickly and stops crisply", () => {
    let { s, b } = run(initialSilk(), ground(), { right: true }, 12);
    expect(b.vx).toBeCloseTo(RUN_SPEED, 0);
    expect(s.anim).toBe("run");
    ({ s, b } = run(s, b, {}, 10));
    expect(b.vx).toBe(0);
    expect(s.anim).toBe("idle");
  });

  it("dash: a fixed burst with no gravity, a cooldown, and only one dash in the air", () => {
    let { s, b, events } = run(initialSilk(), ground(), (i) => ({ right: true, dashPressed: i === 0 }), 3);
    expect(events).toContain("dash");
    expect(b.vx).toBeCloseTo(DASH_SPEED, 0);
    expect(s.anim).toBe("dash");
    ({ s, b, events } = run(s, b, { dashPressed: true }, 1));
    expect(events).not.toContain("dash"); // still dashing / cooling down
    ({ s, b } = run(s, b, {}, Math.ceil((DASH_COOLDOWN + DASH_TIME) / dt)));
    expect(s.dashCd).toBe(0);
    // In the air: one dash, which holds height.
    let air: Body = { ...ground(), y: 300, grounded: false };
    let st = initialSilk();
    ({ s: st, b: air, events } = run(st, air, (i) => ({ dashPressed: i === 0 }), 4));
    expect(events.filter((e) => e === "dash")).toHaveLength(1);
    expect(air.vy).toBe(0);
    ({ events } = run(st, air, (i) => ({ dashPressed: i === 30 }), 40));
    expect(events).not.toContain("dash");
  });

  it("holding the direction out of a dash turns into a sprint", () => {
    const { s, b } = run(initialSilk(), ground(), (i) => ({ right: true, dashPressed: i === 0 }), 30);
    expect(s.sprint).toBe(true);
    expect(b.vx).toBeCloseTo(SPRINT_SPEED, 0);
    expect(s.anim).toBe("sprint");
  });

  it("buffered jump, coyote time and variable height", () => {
    // Pressed just before landing (double jump already spent): the jump is buffered and fires on landing.
    const air: Body = { ...ground(), y: bounds.height - 84 - 6, vy: 300, grounded: false };
    const r = run({ ...initialSilk(), doubleJumps: 0 }, air, (i) => ({ jumpPressed: i === 0, jumpHeld: true }), Math.ceil(JUMP_BUFFER / dt));
    expect(r.events).toContain("land");
    expect(r.events).toContain("jump");
    // Short tap vs held: held goes higher.
    const tap = run(initialSilk(), ground(), (i) => ({ jumpPressed: i === 0, jumpHeld: i < 3 }), 25);
    const held = run(initialSilk(), ground(), (i) => ({ jumpPressed: i === 0, jumpHeld: true }), 25);
    expect(held.b.y).toBeLessThan(tap.b.y);
    // Coyote time: walk off a window edge, then jump a few frames later — a real jump, not the double jump.
    const top: Platform[] = [{ id: 1, left: 400, right: 640, top: 500 }];
    let b: Body = { ...ground(), x: 590, y: 500 - 84, platformId: 1, grounded: true };
    let s = initialSilk();
    let frames = 0;
    while (b.grounded && frames < 60) {
      ({ s, b } = run(s, b, { right: true }, 1, top));
      frames++;
    }
    expect(b.grounded).toBe(false);
    const late = run(s, b, (i) => ({ right: true, jumpPressed: i === 2, jumpHeld: true }), 3, top);
    expect(late.events).toContain("jump");
    expect(late.s.doubleJumps).toBe(1); // double jump still available
  });

  it("double jump once per airtime, refreshed on landing; glide caps the fall after it", () => {
    let { s, b, events } = run(initialSilk(), ground(), (i) => ({ jumpPressed: i === 0 || i === 20 || i === 30, jumpHeld: true }), 32);
    expect(events.filter((e) => e === "jump")).toHaveLength(1);
    expect(events.filter((e) => e === "doubleJump")).toHaveLength(1);
    ({ s, b } = run(s, b, { jumpHeld: true }, 60));
    expect(s.glide || b.grounded).toBe(true);
    if (!b.grounded) {
      expect(b.vy).toBe(GLIDE_FALL_SPEED);
      expect(s.anim).toBe("glide");
    }
    ({ s, b } = run(s, b, {}, 200));
    expect(b.grounded).toBe(true);
    expect(s.doubleJumps).toBe(1);
  });

  it("wall cling slows the fall at a screen edge; wall jump pushes away", () => {
    let b: Body = { ...ground(), x: 0, y: 200, vy: 400, grounded: false };
    let s = initialSilk();
    let events: string[];
    ({ s, b } = run(s, b, { left: true }, 5));
    expect(s.wallDir).toBe(-1);
    expect(b.vy).toBeLessThanOrEqual(WALL_SLIDE_SPEED);
    expect(s.anim).toBe("wallCling");
    ({ s, b, events } = run(s, b, (i) => ({ left: true, jumpPressed: i === 0, jumpHeld: true }), 2));
    expect(events).toContain("wallJump");
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vy).toBeLessThan(0);
  });

  it("grapple pulls to a window edge in the aim cone, and misses safely otherwise", () => {
    const top: Platform[] = [{ id: 5, left: 700, right: 900, top: 600 }];
    const b = ground(560);
    const aim = { x: 800, y: 600 };
    expect(findAnchor(b, aimVector(b, aim), top)).not.toBeNull();
    expect(findAnchor(b, aimVector(b, { x: 100, y: 900 }), top)).toBeNull(); // wrong way
    expect(findAnchor(b, aimVector(b, aim), [{ id: 6, left: 1500, right: 1590, top: 100 }])).toBeNull(); // out of range
    const r = run(initialSilk(), b, (i) => ({ grapplePressed: i === 0, aim }), 40, top);
    expect(r.events[0]).toBe("grapple");
    expect(r.b.y + r.b.h).toBeLessThanOrEqual(610); // pulled up to the edge
    const miss = run(initialSilk(), b, { grapplePressed: true, aim: { x: 600, y: 900 } }, 1, top);
    expect(miss.events).toEqual(["grappleMiss"]);
    expect(miss.s.grapple).toBeNull();
  });
});

describe("Needle and Thread", () => {
  const base: NeedleInput = { attackHeld: false, attackPressed: false, threadPressed: false, up: false, down: false, grounded: true, facing: 1 };
  const press = (over: Partial<NeedleInput> = {}) => ({ ...base, attackPressed: true, attackHeld: true, ...over });

  it("chooses side, up or down (pogo, airborne only) strikes", () => {
    expect(strikeKind({ up: false, down: false, grounded: true })).toBe("side");
    expect(strikeKind({ up: true, down: false, grounded: true })).toBe("up");
    expect(strikeKind({ up: false, down: true, grounded: false })).toBe("down");
    expect(strikeKind({ up: false, down: true, grounded: true })).toBe("side");
  });

  it("strikes on press, with an active window and a cooldown", () => {
    let { state, started } = needleStep(initialNeedle(), press(), dt);
    expect(started).toBe("side");
    expect(isActive(state.attack!)).toBe(false); // windup
    for (let i = 0; i < 6; i++) state = needleStep(state, { ...base, attackHeld: false }, dt).state;
    expect(isActive(state.attack!)).toBe(true);
    for (let i = 0; i < 20; i++) state = needleStep(state, base, dt).state;
    expect(state.attack).toBeNull();
    expect(NEEDLE.side.duration).toBeLessThan(NEEDLE_COOLDOWN + 0.01);
  });

  it("hold then release for a charged Needle Strike", () => {
    let s = needleStep(initialNeedle(), press(), dt).state;
    for (let t = 0; t < CHARGE_TIME + 0.05; t += dt) s = needleStep(s, { ...base, attackHeld: true }, dt).state;
    const r = needleStep(s, { ...base, attackHeld: false }, dt);
    expect(r.started).toBe("charged");
    expect(destroyerPower("charged")).toBe(2);
  });

  it("the Thread spin costs silk; hits refill it up to the cap", () => {
    let s = { ...initialNeedle(), silk: SPIN_COST - 1 };
    expect(needleStep(s, { ...base, threadPressed: true }, dt).started).toBeNull();
    s = gainSilk(s, 1);
    const r = needleStep(s, { ...base, threadPressed: true }, dt);
    expect(r.started).toBe("spin");
    expect(r.state.silk).toBe(0);
    expect(gainSilk({ ...s, silk: MAX_SILK - 1 }, 5).silk).toBe(MAX_SILK);
  });

  it("hitboxes point where the strike goes, mirrored by facing", () => {
    const body = { x: 500, y: 400, w: 40, h: 84 };
    const right = needleHitbox({ kind: "side", dir: 1 }, body, 2);
    const left = needleHitbox({ kind: "side", dir: -1 }, body, 2);
    expect(right.x).toBe(540);
    expect(left.x + left.w).toBe(500);
    expect(needleHitbox({ kind: "up", dir: 1 }, body, 2).y + needleHitbox({ kind: "up", dir: 1 }, body, 2).h).toBe(400);
    expect(needleHitbox({ kind: "down", dir: 1 }, body, 2).y).toBe(484);
    expect(needleHitbox({ kind: "charged", dir: 1 }, body, 2).w).toBeGreaterThan(right.w * 2);
    const spin = needleHitbox({ kind: "spin", dir: 1 }, body, 2);
    expect(rectContains(spin, 520, 430)).toBe(true);
  });
});

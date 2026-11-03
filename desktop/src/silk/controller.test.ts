import { describe, expect, it } from "vitest";
import { createCombat, setTraining } from "../combat/sim";
import { DEFAULT_PHYSICS, makeBody, type Body } from "../engine/physics";
import { SilkController } from "./controller";
import { DEFAULT_SILK_KEYS } from "./keys";
import { SPIN_COST } from "./needle";

const bounds = { width: 1600, height: 900 };
const world = { bounds, platforms: [], walls: [], cfg: DEFAULT_PHYSICS };
const dt = 1 / 60;
const hand = (b: Body, dir: 1 | -1) => ({ x: b.x + b.w / 2 + dir * 12, y: b.y + b.h * 0.45 });

function frames(c: SilkController, b: Body, n: number, combat = createCombat(1), cursor: { x: number; y: number } | null = null) {
  const out = { b, strikes: [] as { x: number; y: number; power: number }[], sfx: [] as string[], frames: [] as string[] };
  for (let i = 0; i < n; i++) {
    const r = c.step(dt, out.b, world, combat, 2, 2, cursor, hand);
    out.b = r.body;
    out.strikes.push(...r.strikes);
    out.sfx.push(...r.sfx);
    out.frames.push(r.frame.frame);
  }
  return out;
}

describe("Silksong controller", () => {
  it("routes bound keys (and arrows) and ignores others", () => {
    const c = new SilkController();
    expect(c.keyDown("KeyD")).toBe(true);
    expect(c.keyDown("ArrowLeft")).toBe(true);
    expect(c.keyDown("KeyZ")).toBe(false);
    c.setKeys({ ...DEFAULT_SILK_KEYS, attack: "KeyX" });
    expect(c.keyDown("KeyX")).toBe(true);
  });

  it("runs with the keys and stops when released", () => {
    const c = new SilkController();
    c.keyDown("KeyD");
    let { b } = frames(c, makeBody(600, bounds, 40, 84), 20);
    expect(b.x).toBeGreaterThan(620);
    c.keyUp("KeyD");
    ({ b } = frames(c, b, 20));
    expect(b.vx).toBe(0);
  });

  it("the Needle damages training dummies, fills silk and plays the swing frames", () => {
    const combat = createCombat(3);
    const b = makeBody(600, bounds, 40, 84);
    setTraining(combat, true, bounds, b.x + b.w / 2, 3);
    const target = combat.dummies.reduce((best, d) => (Math.abs(d.x - b.x) < Math.abs(best.x - b.x) ? d : best));
    const body: Body = { ...b, x: target.x - 50, facing: 1 };
    const c = new SilkController();
    const before = c.needle.silk;
    c.keyDown("KeyJ");
    const out = frames(c, body, 16, combat);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(c.needle.silk).toBeGreaterThan(before);
    expect(out.frames).toContain("use2");
    expect(out.sfx).toContain("swing");
  });

  it("a down-strike that hits bounces you up (pogo)", () => {
    const combat = createCombat(4);
    const b = makeBody(600, bounds, 40, 84);
    setTraining(combat, true, bounds, b.x + b.w / 2, 3);
    const d = combat.dummies[0];
    const body: Body = { ...b, x: d.x + d.w / 2 - 20, y: d.y - 84 - 6, vy: 200, grounded: false };
    const c = new SilkController();
    c.keyDown("KeyS");
    c.keyDown("KeyJ");
    const out = frames(c, body, 6, combat);
    expect(out.b.vy).toBeLessThan(0);
    expect(out.frames).toContain("pogo");
  });

  it("strikes the Letter Destroyer once per attack when the pointer is in reach", () => {
    const c = new SilkController();
    const b = makeBody(600, bounds, 40, 84);
    c.keyDown("KeyJ");
    const out = frames(c, b, 16, createCombat(1), { x: b.x + b.w + 20, y: b.y + 38 });
    expect(out.strikes).toHaveLength(1);
    expect(out.strikes[0].power).toBe(1);
    const far = new SilkController();
    far.keyDown("KeyJ");
    expect(frames(far, b, 16, createCombat(1), { x: 50, y: 50 }).strikes).toHaveLength(0);
  });

  it("Thread spin spends silk and whirls; reset clears input but keeps silk", () => {
    const c = new SilkController();
    c.needle = { ...c.needle, silk: SPIN_COST };
    c.keyDown("KeyL");
    const out = frames(c, makeBody(600, bounds, 40, 84), 10);
    expect(c.needle.silk).toBe(0);
    expect(out.frames.some((f) => f === "use3" || f === "cast")).toBe(true);
    c.needle = { ...c.needle, silk: 5 };
    c.reset();
    expect(c.needle.silk).toBe(5);
    expect(c.move.dashT).toBe(0);
  });

  it("mouse button attacks too", () => {
    const c = new SilkController();
    c.mouse(true);
    const out = frames(c, makeBody(600, bounds, 40, 84), 3);
    expect(out.sfx).toContain("swing");
  });
});

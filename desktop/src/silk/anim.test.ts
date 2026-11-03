import { describe, expect, it } from "vitest";
import { resolveFrame } from "../overlay/rigFrames";
import { needleAngle, pushTrail, silkFrame, slashArc } from "./anim";
import type { SilkAnim } from "./movement";
import { NEEDLE, type NeedleAttack } from "./needle";

const atk = (kind: NeedleAttack["kind"], p: number): NeedleAttack => ({ kind, t: p * NEEDLE[kind].duration, dir: 1, hitIds: [], tick: 0, struckPointer: false });

describe("Silksong animation frames", () => {
  it("maps every movement state to a frame the atlas has", () => {
    const atlas = ["idle", "walk0", "walk3", "jump", "fall", "sit", "dash", "cling", "glide", "shoot", "use1", "use2", "use3", "use4", "cast", "pogo", "lunge"];
    const anims: SilkAnim[] = ["idle", "run", "sprint", "jump", "doubleJump", "fall", "land", "dash", "wallCling", "wallJump", "glide", "grapple"];
    for (const a of anims) expect(atlas).toContain(resolveFrame(atlas, silkFrame(a, null, 0, 0, 2).frame));
  });

  it("side strikes go windup → swing → follow-through", () => {
    expect([0, 0.3, 0.6, 0.95].map((p) => silkFrame("idle", atk("side", p), 0, 0, 2).frame)).toEqual(["use1", "use2", "use3", "use4"]);
  });

  it("up, down, charged and spin attacks have their own poses; the spin whirls", () => {
    expect(silkFrame("jump", atk("up", 0.5), 0, 0, 2).frame).toBe("cast");
    expect(silkFrame("fall", atk("down", 0.5), 0, 0, 2).frame).toBe("pogo");
    expect(silkFrame("idle", atk("charged", 0.5), 0, 0, 2).frame).toBe("lunge");
    const flips = [0.02, 0.12, 0.22, 0.32].map((p) => silkFrame("idle", { ...atk("spin", 0), t: p }, 0, 0, 2).flip);
    expect(new Set(flips).size).toBe(2);
  });

  it("charging shows the anticipation pose; attacks override movement", () => {
    expect(silkFrame("run", null, 0.6, 0, 2).frame).toBe("use1");
    expect(silkFrame("dash", atk("side", 0.5), 0, 0, 2).frame).not.toBe("dash");
  });

  it("new poses fall back sensibly on atlases without them", () => {
    const minimal = ["idle", "jump", "fall", "shoot", "use4", "walk0"];
    expect(resolveFrame(minimal, "dash")).toBe("shoot");
    expect(resolveFrame(minimal, "cling")).toBe("jump");
    expect(resolveFrame(minimal, "pogo")).toBe("use4");
  });
});

describe("Needle and Thread visuals", () => {
  it("slash crescents sweep on the facing side and mirror with facing", () => {
    const r = slashArc("side", 1, 1);
    const l = slashArc("side", 1, -1);
    expect(Math.abs(r.to - r.from)).toBeCloseTo(1.9, 6);
    expect(Math.cos((r.from + r.to) / 2)).toBeGreaterThan(0.9); // centred on the right
    expect(Math.cos((l.from + l.to) / 2)).toBeLessThan(-0.9); // centred on the left
    expect(Math.sin((slashArc("up", 1, 1).from + slashArc("up", 1, 1).to) / 2)).toBeLessThan(-0.9);
    expect(slashArc("side", 0, 1).to).toBe(slashArc("side", 0, 1).from); // nothing drawn before the swing
  });

  it("the needle points the way it strikes", () => {
    expect(Math.cos(needleAngle("charged", 0.5, 1))).toBe(1);
    expect(Math.cos(needleAngle("charged", 0.5, -1))).toBe(-1);
    expect(Math.sin(needleAngle("up", 0.5, 1))).toBeLessThan(-0.9);
    expect(Math.sin(needleAngle("down", 0.5, 1))).toBeGreaterThan(0.9);
  });

  it("silk trails keep only the most recent points", () => {
    let t: { x: number; y: number }[] = [];
    for (let i = 0; i < 30; i++) t = pushTrail(t, { x: i, y: 0 });
    expect(t).toHaveLength(14);
    expect(t[13].x).toBe(29);
  });
});

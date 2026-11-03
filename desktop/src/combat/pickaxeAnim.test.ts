import { describe, expect, it } from "vitest";
import { getWeapon, PICKAXE_ID } from "./weapons";
import { swingAngle } from "./melee";
import { cancelAttack, canAttack, createCombat, stepCombat, tryAttack } from "./sim";
import {
  IMPACT_PROGRESS,
  PICKAXE_ARC,
  crossedStrike,
  pickaxeAngle,
  pickaxeArmFrame,
  pickaxeHead,
  pickaxeRotation,
  swingPhase,
} from "./pickaxeAnim";
import type { SwordDef } from "./weapons";

const pick = getWeapon(PICKAXE_ID) as SwordDef;
const player = { x: 500, y: 400, w: 40, h: 84, facing: 1 as const, scale: 3 };

describe("Terraria-style pickaxe swing", () => {
  it("sweeps linearly ~200° from behind the head to forward-down", () => {
    expect(pickaxeAngle(0)).toBe(PICKAXE_ARC.from);
    expect(pickaxeAngle(1)).toBe(PICKAXE_ARC.to);
    expect(pickaxeAngle(0.5)).toBe((PICKAXE_ARC.from + PICKAXE_ARC.to) / 2);
    expect(PICKAXE_ARC.to - PICKAXE_ARC.from).toBe(200);
    expect(pickaxeAngle(-1)).toBe(PICKAXE_ARC.from);
    expect(pickaxeAngle(NaN)).toBe(PICKAXE_ARC.from);
  });

  it("rotates the up-right sprite by the swing angle (unrotated art points at -45°)", () => {
    expect(pickaxeRotation(0)).toBeCloseTo(((PICKAXE_ARC.from + 45) * Math.PI) / 180, 9);
    // At the strike the head points just below forward.
    expect(pickaxeAngle(IMPACT_PROGRESS)).toBeCloseTo(15, 9);
  });

  it("steps the arm through the four use frames in order", () => {
    const frames = [0, 0.2, 0.3, 0.55, 0.8, 1].map(pickaxeArmFrame);
    expect(frames).toEqual(["use1", "use1", "use2", "use3", "use4", "use4"]);
  });

  it("the head mirrors with facing and the strike fires exactly once", () => {
    const hand = { x: 100, y: 100 };
    const right = pickaxeHead(hand, IMPACT_PROGRESS, 1, 50);
    const left = pickaxeHead(hand, IMPACT_PROGRESS, -1, 50);
    expect(right.x).toBeGreaterThan(hand.x);
    expect(left.x).toBeLessThan(hand.x);
    expect(right.y).toBeCloseTo(left.y, 9);
    expect(right.y).toBeGreaterThan(hand.y); // slightly below the hand
    let fired = 0;
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      if (crossedStrike(prev, p)) fired++;
      prev = p;
    }
    expect(fired).toBe(1);
  });

  it("the weapon definition uses the same linear arc, so the hitbox matches the drawing", () => {
    expect(pick.pickaxe).toBe(true);
    expect([pick.arcFrom, pick.arcTo]).toEqual([PICKAXE_ARC.from, PICKAXE_ARC.to]);
    for (const p of [0, 0.25, 0.5, 0.9]) expect(swingAngle(pick, p)).toBeCloseTo(pickaxeAngle(p), 9);
    expect(pick.activeFrom).toBeLessThan(IMPACT_PROGRESS);
    expect(pick.activeTo).toBeGreaterThan(IMPACT_PROGRESS);
  });
});

describe("pickaxe swing states, cooldown and cancellation", () => {
  it("idle → swing → recover → idle, honouring the cooldown", () => {
    const state = createCombat(1);
    const def = { ...pick, useTime: 0.5 };
    expect(swingPhase(state.attack, PICKAXE_ID, state.cooldown)).toBe("idle");
    expect(tryAttack(state, def, player).ok).toBe(true);
    expect(swingPhase(state.attack, PICKAXE_ID, state.cooldown)).toBe("swing");
    expect(tryAttack(state, def, player).ok).toBe(false); // busy
    for (let t = 0; t < 0.52; t += 1 / 60) stepCombat(state, 1 / 60, player, { width: 1440, height: 800 });
    expect(state.attack).toBeNull();
    expect(swingPhase(state.attack, PICKAXE_ID, state.cooldown)).toBe("idle");
    expect(canAttack(state, def).ok).toBe(true);
  });

  it("cancelling mid-swing stops it immediately but keeps the cooldown", () => {
    const state = createCombat(1);
    const def = { ...pick, useTime: 1 };
    tryAttack(state, def, player);
    stepCombat(state, 0.2, player, { width: 1440, height: 800 });
    cancelAttack(state);
    expect(state.attack).toBeNull();
    expect(swingPhase(state.attack, PICKAXE_ID, state.cooldown)).toBe("recover");
    expect(canAttack(state, def)).toEqual({ ok: false, reason: "cooldown" });
  });

  it("faces the requested direction", () => {
    const state = createCombat(1);
    tryAttack(state, pick, { ...player, facing: -1 }, -1);
    expect(state.attack?.dir).toBe(-1);
  });
});

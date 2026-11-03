import { describe, expect, it } from "vitest";
import { decide, initialAi, LEDGE_TURN_CHANCE, mulberry32, PLATFORM_JUMP_CHANCE, PLATFORM_JUMP_COOLDOWN, type AiContext } from "./behavior";
import {
  DEFAULT_BEHAVIOR,
  hangoutFromSpeech,
  hangoutPose,
  hangoutSlots,
  JUMP_TUNING,
  newWatchNav,
  normalizeBehavior,
  tuningFor,
  watchIndex,
  watchStep,
} from "./behaviorModes";
import { planJump, planJumpToward } from "./jump";
import { makeBody, type Platform } from "./physics";
import type { Line } from "./lines";

const L = (x1: number, y1: number, x2: number, y2: number): Line => ({ x1, y1, x2, y2 });
const lines = [L(0.1, 0.6, 0.3, 0.6), L(0.4, 0.3, 0.6, 0.3), L(0.7, 0.7, 0.9, 0.7)];

describe("prefs", () => {
  it("normalizes missing or bad values to the defaults", () => {
    expect(normalizeBehavior(undefined)).toEqual(DEFAULT_BEHAVIOR);
    expect(normalizeBehavior({ jump: "moonwalk" as never, spread: 1 as never })).toEqual({ spread: true, jump: "normal", watch: null });
  });
  it("normal tuning is exactly the long-standing AI constants", () => {
    expect(JUMP_TUNING.normal.chance).toBe(PLATFORM_JUMP_CHANCE);
    expect(JUMP_TUNING.normal.cooldown).toBe(PLATFORM_JUMP_COOLDOWN);
    expect(JUMP_TUNING.normal.ledgeTurn).toBe(LEDGE_TURN_CHANCE);
  });
  it("spread makes a crowded companion eager to move, even when grounded", () => {
    const t = tuningFor({ spread: true, jump: "grounded", watch: null }, true);
    expect(t.chance).toBeGreaterThan(0.8);
    expect(t.downOnly).toBe(false);
    expect(tuningFor({ spread: true, jump: "grounded", watch: null }, false).downOnly).toBe(true);
  });
});

describe("choosing the hangout", () => {
  it("by number, ordinal, word or place", () => {
    expect(hangoutFromSpeech("go watch from platform 2", lines)).toBe(1);
    expect(hangoutFromSpeech("the third platform", lines)).toBe(2);
    expect(hangoutFromSpeech("platform one please", lines)).toBe(0);
    expect(hangoutFromSpeech("the left one", lines)).toBe(0);
    expect(hangoutFromSpeech("the rightmost platform", lines)).toBe(2);
    expect(hangoutFromSpeech("the highest platform", lines)).toBe(1);
    expect(hangoutFromSpeech("the bottom platform", lines)).toBe(2);
    expect(hangoutFromSpeech("the middle one", lines)).toBe(1);
  });
  it("asks when unclear, refuses labels that don't exist, and needs platforms", () => {
    expect(hangoutFromSpeech("hang out on a platform", lines)).toBe("pick");
    expect(hangoutFromSpeech("hang out on a platform", [lines[0]])).toBe(0);
    expect(hangoutFromSpeech("platform 9", lines)).toBeNull();
    expect(hangoutFromSpeech("platform 1", [])).toBeNull();
  });
  it("finds the saved hangout among edited lines by its endpoints", () => {
    expect(watchIndex(lines, L(0.4, 0.3, 0.6, 0.3))).toBe(1);
    expect(watchIndex(lines, L(0.6, 0.3, 0.4, 0.3))).toBe(1); // drawn the other way
    expect(watchIndex(lines, L(0.5, 0.5, 0.6, 0.5))).toBe(-1);
    expect(watchIndex(lines, null)).toBe(-1);
  });
});

describe("the hangout", () => {
  it("alternates side-by-side and cuddles", () => {
    expect(hangoutPose(1)).toBe("side");
    expect(hangoutPose(12)).toBe("cuddle");
    expect(hangoutPose(17)).toBe("side");
  });
  it("lines everyone up shoulder to shoulder on the platform", () => {
    const s = hangoutSlots(3, 100, 500, 40, "side");
    expect(s.map((x) => x.x)).toEqual([258, 300, 342]);
    expect(s.every((x) => x.face === null)).toBe(true);
  });
  it("pairs them up facing each other for cuddles", () => {
    const s = hangoutSlots(4, 100, 600, 40, "cuddle");
    expect(s[0].face).toBe(s[1].x);
    expect(s[1].face).toBe(s[0].x);
    expect(s[1].x - s[0].x).toBeLessThan(40);
    const odd = hangoutSlots(3, 100, 600, 40, "cuddle");
    expect(odd[2].face).toBeNull();
  });
  it("squeezes onto a short platform without leaving it", () => {
    const s = hangoutSlots(4, 100, 200, 40, "side");
    for (const x of s) {
      expect(x.x).toBeGreaterThanOrEqual(120 - 1e-9);
      expect(x.x).toBeLessThanOrEqual(180 + 1e-9);
    }
  });
});

describe("jumping by mode", () => {
  const ctx = (over: Partial<AiContext> = {}): AiContext => ({ grounded: true, landing: false, hitWall: 0, x: 400, w: 40, boundsWidth: 1200, planJump: () => ({ targetId: 1, vy: 600, vx: 50 }), ...over });
  const countJumps = (tuning: AiContext["tuning"], seconds = 120) => {
    const rng = mulberry32(7);
    let ai = initialAi();
    let jumps = 0;
    let longestStreakGap = 0;
    let lastJump = -Infinity;
    for (let t = 0; t < seconds; t += 1 / 30) {
      const d = decide(ai, ctx({ tuning }), 1 / 30, rng);
      ai = d.ai;
      if (d.intent.jump) {
        jumps++;
        longestStreakGap = Math.max(longestStreakGap, t - lastJump === Infinity ? 0 : t - lastJump);
        lastJump = t;
      }
    }
    return { jumps, longestStreakGap };
  };
  it("jumpy jumps clearly more than normal, grounded far less", () => {
    const normal = countJumps(undefined).jumps;
    const jumpy = countJumps(JUMP_TUNING.jumpy).jumps;
    const grounded = countJumps(JUMP_TUNING.grounded).jumps;
    expect(jumpy).toBeGreaterThan(normal * 1.5);
    expect(grounded).toBeLessThan(normal / 2);
  });
  it("jumpy rests after a streak, so it never loops endlessly", () => {
    const rng = mulberry32(3);
    let ai = initialAi();
    const times: number[] = [];
    for (let t = 0; t < 200; t += 1 / 30) {
      const d = decide(ai, ctx({ tuning: JUMP_TUNING.jumpy }), 1 / 30, rng);
      ai = d.ai;
      if (d.intent.jump) times.push(t);
    }
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // Some gaps are the long rest after a streak.
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(JUMP_TUNING.jumpy.rest);
    // Never back-to-back.
    expect(Math.min(...gaps)).toBeGreaterThan(1);
  });
});

describe("planning jumps", () => {
  const bounds = { width: 1200, height: 800 };
  const plat = (id: number, left: number, top: number, w = 220): Platform => ({ id, left, right: left + w, top });
  const body = { ...makeBody(500, bounds, 40, 56), grounded: true, platformId: null };
  const platforms = [plat(1, 380, 640), plat(2, 640, 620), plat(3, 520, 500)];

  it("spread avoids surfaces others are on when there's a choice", () => {
    const avoid = new Set([1, 3]);
    for (let i = 0; i < 20; i++) expect(planJump(body, platforms, bounds, mulberry32(i), undefined, [], { avoid })?.targetId).toBe(2);
  });
  it("grounded only ever jumps down", () => {
    const high = { ...body, y: 500 - 56, platformId: 3 };
    for (let i = 0; i < 10; i++) {
      const p = planJump(high, platforms, bounds, mulberry32(i), undefined, [], { downOnly: true });
      if (p) expect([1, 2]).toContain(p.targetId);
    }
    expect(planJump(body, platforms, bounds, mulberry32(1), undefined, [], { downOnly: true })).toBeNull();
  });
  it("heads for the hangout directly, or via a closer stepping stone", () => {
    expect(planJumpToward(body, platforms[2], platforms, bounds)?.targetId).toBe(3);
    const far: Platform = plat(9, 520, 100); // out of single-jump range (apex ≤ 640 px)
    const steps = [...platforms, far];
    const p = planJumpToward(body, far, steps, bounds);
    expect(p).not.toBeNull();
    expect(p!.targetId).not.toBe(9);
  });
  it("gives up on a hangout it can't reach instead of waiting in a corner, then tries again", () => {
    const target = { left: 1200, right: 1400 };
    let nav = newWatchNav();
    let x = 1100;
    let rested = -1;
    for (let t = 0; t < 120; t += 1 / 30) {
      const r = watchStep(nav, { x, w: 40, grounded: true }, target, () => null, 1 / 30, mulberry32(4));
      nav = r.nav;
      x += r.move * 4;
      if (r.resting && rested < 0) rested = t;
      if (rested >= 0 && t < rested + 50) expect(r.resting).toBe(true);
    }
    expect(rested).toBeGreaterThan(15);
    expect(rested).toBeLessThan(25);
    // After the rest it tries again.
    expect(nav.rest).toBeLessThan(60);
  });
  it("watchStep walks toward the hangout and jumps when a plan exists", () => {
    const target = { left: 800, right: 1000 };
    let r = watchStep(newWatchNav(), { x: 100, w: 40, grounded: true }, target, () => null, 1 / 30, mulberry32(1));
    expect(r.move).toBe(1);
    r = watchStep(newWatchNav(), { x: 100, w: 40, grounded: true }, target, () => ({ vy: 500, vx: 100 }), 1 / 30, mulberry32(1));
    expect(r.jump).toEqual({ vy: 500, vx: 100 });
    // Stuck under it with no way up: it tries a detour to one side.
    let nav = newWatchNav();
    let detoured = false;
    for (let t = 0; t < 6; t += 1 / 30) {
      const s = watchStep(nav, { x: 880, w: 40, grounded: true }, target, () => null, 1 / 30, mulberry32(2));
      nav = s.nav;
      if (s.nav.detour !== null) detoured = true;
    }
    expect(detoured).toBe(true);
  });
});

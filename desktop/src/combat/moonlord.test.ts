import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "./geometry";
import { MOON_PARTS, moonScale, moonTuning, partRect, rayLine, spawnMoonLord, stepMoonLord, type MoonContext } from "./moonlord";
import { bossHealth, createCombat, dismissMoonLord, meleeStrike, stepCombat, summonBoss, summonMoonLord, type CombatState } from "./sim";
import { getWeapon } from "./weapons";

const bounds = { width: 1440, height: 900 };
const dt = 1 / 60;
const player: PlayerInfo = { x: 700, y: bounds.height - 84, w: 40, h: 84, facing: 1, scale: 3 };

function run(state: CombatState, seconds: number, p: PlayerInfo = player) {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepCombat(state, dt, p, bounds);
}

const part = (state: CombatState, name: (typeof MOON_PARTS)[number]) => state.dummies.find((d) => d.id === state.moonIds![name])!;
const kill = (state: CombatState, name: (typeof MOON_PARTS)[number]) => {
  part(state, name).hp = 0;
  run(state, 0.05);
};

describe("Moon Lord", () => {
  it("fits on screen and scales with difficulty", () => {
    const m = spawnMoonLord("normal", bounds, 100);
    expect(moonScale(bounds)).toBeLessThanOrEqual(1);
    expect(m.x - 430 * m.scale).toBeGreaterThanOrEqual(0);
    expect(moonTuning("master").hp.core).toBeGreaterThan(moonTuning("easy").hp.core);
    expect(moonTuning("expert").ray).toBeGreaterThan(moonTuning("normal").ray);
    const small = { width: 800, height: 600 };
    const s = moonScale(small);
    expect(860 * s).toBeLessThanOrEqual(small.width);
  });

  it("rises (untouchable), then its eyes can be hit but the core can't until they're gone", () => {
    const state = createCombat(1);
    expect(summonMoonLord(state, "normal", bounds, 700)).toBe(true);
    expect(state.events.some((e) => e.type === "message" && e.text.includes("Moon Lord has awoken"))).toBe(true);
    expect(part(state, "head").respawn).toBeGreaterThan(0);
    run(state, 2.5);
    for (const p of ["head", "left", "right"] as const) expect(part(state, p).respawn).toBe(0);
    expect(part(state, "core").respawn).toBeGreaterThan(0);
    // Every part stays on screen.
    for (const p of MOON_PARTS) {
      const r = partRect(state.moonLord!, p);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(bounds.width);
      expect(r.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("Terraria weapons damage its eyes", () => {
    const state = createCombat(2);
    summonMoonLord(state, "normal", bounds, 700);
    run(state, 2.5);
    const eye = part(state, "left");
    const ids = meleeStrike(state, getWeapon("zenith")!, { x: eye.x, y: eye.y, w: eye.w, h: eye.h }, 1);
    expect(ids).toContain(eye.id);
    expect(eye.hp).toBeLessThan(eye.maxHp);
  });

  it("destroying the three eyes exposes the core; destroying the core wins", () => {
    const state = createCombat(3);
    summonMoonLord(state, "easy", bounds, 700);
    run(state, 2.5);
    kill(state, "head");
    kill(state, "left");
    kill(state, "right");
    expect(state.moonLord!.phase).toBe("core");
    expect(state.events.some((e) => e.type === "message" && e.text.includes("core is exposed"))).toBe(true);
    expect(part(state, "core").respawn).toBe(0);
    kill(state, "core");
    expect(state.moonLord!.phase).toBe("dying");
    state.events = [];
    run(state, 3.5);
    expect(state.moonLord).toBeNull();
    expect(state.events.some((e) => e.type === "bossDefeated")).toBe(true);
    expect(state.events.some((e) => e.type === "message" && e.text.includes("defeated"))).toBe(true);
    expect(state.dummies.some((d) => d.kind === "moon")).toBe(false);
  });

  it("the health bar adds up every part", () => {
    const state = createCombat(4);
    summonMoonLord(state, "normal", bounds, 700);
    const t = moonTuning("normal").hp;
    expect(bossHealth(state)).toEqual({ hp: t.head + t.left + t.right + t.core, maxHp: t.head + t.left + t.right + t.core, name: "Moon Lord" });
  });

  it("the deathray warns first, then hurts only along its line", () => {
    const m = spawnMoonLord("normal", bounds, 700);
    const ctx = (target: MoonContext["target"]): MoonContext => ({ target, hp: { head: 1, left: 1, right: 1, core: 1 }, bounds, random: () => 0.5, dismissed: false });
    const body = { x: 700, y: bounds.height - 84, w: 40, h: 84 };
    for (let i = 0; i < 150; i++) stepMoonLord(m, dt, ctx(null)); // rise
    m.attackers.left.timer = m.attackers.right.timer = 99;
    m.attackers.head.timer = 0;
    const hitsDuringWarn: number[] = [];
    let fired = false;
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const ev = stepMoonLord(m, dt, ctx(body));
      if (m.ray && m.ray.warn > 0) hitsDuringWarn.push(ev.hits.length);
      if (m.ray && m.ray.warn <= 0) fired = true;
      hits += ev.hits.length;
    }
    expect(hitsDuringWarn.length).toBeGreaterThan(30);
    expect(hitsDuringWarn.every((n) => n === 0)).toBe(true);
    expect(fired).toBe(true);
    expect(hits).toBeGreaterThan(0);
    // Far off the line: never hit.
    const m2 = spawnMoonLord("normal", bounds, 700);
    for (let i = 0; i < 150; i++) stepMoonLord(m2, dt, ctx(null));
    m2.attackers.left.timer = m2.attackers.right.timer = 99;
    m2.ray = { warn: 0, fire: 1, angle: -Math.PI / 2 }; // straight up
    const line = rayLine(m2, bounds)!;
    expect(line.to.y).toBeLessThan(line.from.y);
    const ev = stepMoonLord(m2, dt, ctx(body));
    expect(ev.hits).toHaveLength(0);
  });

  it("its attacks hurt the companion, which can be slain", () => {
    const state = createCombat(5);
    summonMoonLord(state, "master", bounds, 700);
    run(state, 25);
    expect(state.events.some((e) => e.type === "playerHit") || state.player.hp < state.player.maxHp || state.player.dead).toBe(true);
  });

  it("can be dismissed, and only one boss fights at a time", () => {
    const state = createCombat(6);
    summonMoonLord(state, "normal", bounds, 700);
    run(state, 1);
    dismissMoonLord(state);
    run(state, 2);
    expect(state.moonLord).toBeNull();
    summonMoonLord(state, "normal", bounds, 700);
    expect(summonBoss(state, "normal", bounds, 3, 700)).toBe(true);
    expect(state.moonLord).toBeNull();
    expect(summonMoonLord(state, "normal", bounds, 700)).toBe(true);
    expect(state.boss).toBeNull();
  });
});

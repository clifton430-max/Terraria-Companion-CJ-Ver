import { describe, expect, it } from "vitest";
import {
  BOSS_RADIUS,
  FRENZY_BELOW,
  TRANSFORM_AT,
  bossContactDamage,
  bossDefense,
  bossFrame,
  circleHitsRect,
  spawnBoss,
  spawnServant,
  stepBoss,
  stepServant,
  tuningFor,
  type Boss,
  type BossContext,
} from "./boss";

const bounds = { width: 1440, height: 800 };
const S = 2;
const dt = 1 / 60;
const target = { x: 700, y: 700 };

function run(b: Boss, seconds: number, ctx: Partial<BossContext> = {}) {
  const all = { spawned: 0, messages: [] as string[], transformed: 0, defeated: 0, gone: 0 };
  for (let t = 0; t < seconds; t += dt) {
    const ev = stepBoss(b, dt, { target, hp: b.tuning.maxHp, aliveServants: 0, bounds, ...ctx });
    all.spawned += ev.spawnServants.length;
    all.messages.push(...ev.messages);
    all.transformed += ev.transformed ? 1 : 0;
    all.defeated += ev.defeated ? 1 : 0;
    all.gone += ev.gone ? 1 : 0;
  }
  return all;
}

describe("Eye of Cthulhu", () => {
  it("spawns above the screen and descends to hover above its target", () => {
    const b = spawnBoss("normal", bounds, S, 300);
    expect(b.y).toBeLessThan(0);
    run(b, 2);
    expect(b.action).toBe("hover");
    expect(Math.abs(b.x - target.x)).toBeLessThan(120);
    expect(b.y).toBeLessThan(target.y - 150); // well above the companion
    expect(b.y).toBeGreaterThan(0);
  });

  it("charges three times at the target after hovering, then hovers again", () => {
    const b = spawnBoss("normal", bounds, S, 700);
    let dashes = 0;
    let prev = b.action;
    let aimedAtTarget = false;
    for (let t = 0; t < 6; t += dt) {
      stepBoss(b, dt, { target, hp: b.tuning.maxHp, aliveServants: 0, bounds });
      if (b.action === "dash" && prev !== "dash") {
        dashes++;
        const toTarget = Math.atan2(target.y - b.y, target.x - b.x);
        const moving = Math.atan2(b.vy, b.vx);
        if (Math.abs(toTarget - moving) < 0.15) aimedAtTarget = true;
      }
      prev = b.action;
    }
    expect(dashes).toBeGreaterThanOrEqual(3);
    expect(aimedAtTarget).toBe(true);
  });

  it("summons Servants while hovering in its first form, up to the cap", () => {
    const b = spawnBoss("normal", bounds, S, 700);
    expect(run(b, 2.5).spawned).toBeGreaterThan(0);
    const capped = spawnBoss("normal", bounds, S, 700);
    expect(run(capped, 2.5, { aliveServants: capped.tuning.maxServants }).spawned).toBe(0);
  });

  it("transforms at half health: spins, switches to mouth frames, loses defence and hits harder", () => {
    const b = spawnBoss("normal", bounds, S, 700);
    run(b, 1);
    expect(bossFrame(b)).toBeLessThan(3);
    const phase1 = { dmg: bossContactDamage(b), def: bossDefense(b) };
    const half = b.tuning.maxHp * TRANSFORM_AT;
    const ev = run(b, 2.2, { hp: half });
    expect(ev.transformed).toBe(1);
    expect(b.phase).toBe("phase2");
    expect(bossFrame(b)).toBeGreaterThanOrEqual(3);
    expect(bossContactDamage(b)).toBeGreaterThan(phase1.dmg);
    expect(bossDefense(b)).toBeLessThan(phase1.def);
    // No more Servants in the mouth form.
    expect(run(b, 3, { hp: half }).spawned).toBe(0);
  });

  it("is defeated at zero health: one defeat event, then fades out and is gone", () => {
    const b = spawnBoss("normal", bounds, S, 700);
    run(b, 1);
    const ev = run(b, 2, { hp: 0 });
    expect(ev.defeated).toBe(1);
    expect(ev.gone).toBe(1);
    expect(b.phase).toBe("gone");
    expect(ev.messages).toContain("Eye of Cthulhu has been defeated!");
    expect(b.alpha).toBe(0);
  });

  it("flees off the top of the screen when its target is gone", () => {
    const b = spawnBoss("normal", bounds, S, 700);
    run(b, 2);
    const ev = run(b, 3, { target: null });
    expect(ev.gone).toBe(1);
    expect(b.y).toBeLessThan(-BOSS_RADIUS * S * 3 + 1);
  });

  it("scales health, damage and speed with difficulty; frenzy only on Expert/Master at low health", () => {
    const easy = tuningFor("easy");
    const normal = tuningFor("normal");
    const expert = tuningFor("expert");
    const master = tuningFor("master");
    expect(easy.maxHp).toBeLessThan(normal.maxHp);
    expect(expert.maxHp).toBeGreaterThan(normal.maxHp);
    expect(master.contactPhase1).toBe(normal.contactPhase1 * 3);
    expect([easy.frenzy, normal.frenzy, expert.frenzy, master.frenzy]).toEqual([false, false, true, true]);

    const countDashes = (d: "normal" | "expert") => {
      const b = spawnBoss(d, bounds, S, 700);
      b.phase = "phase2";
      b.transformed = true;
      let dashes = 0;
      let prev = b.action;
      for (let t = 0; t < 4; t += dt) {
        stepBoss(b, dt, { target, hp: b.tuning.maxHp * FRENZY_BELOW * 0.5, aliveServants: 0, bounds });
        if (b.action === "dash" && prev !== "dash") dashes++;
        prev = b.action;
      }
      return dashes;
    };
    expect(countDashes("expert")).toBeGreaterThan(countDashes("normal"));
  });

  it("is deterministic", () => {
    const a = spawnBoss("expert", bounds, S, 500);
    const b = spawnBoss("expert", bounds, S, 500);
    run(a, 5, { hp: 1000 });
    run(b, 5, { hp: 1000 });
    expect(a).toEqual(b);
  });

  it("Servants home in on the target and circle-rect contact works", () => {
    const sv = spawnServant({ x: 100, y: 100 });
    for (let t = 0; t < 4; t += dt) stepServant(sv, dt, target, S, 1);
    expect(Math.hypot(sv.x - target.x, sv.y - target.y)).toBeLessThan(120);
    expect(circleHitsRect({ x: 10, y: 10, r: 5 }, { x: 14, y: 0, w: 10, h: 20 })).toBe(true);
    expect(circleHitsRect({ x: 0, y: 0, r: 5 }, { x: 10, y: 10, w: 10, h: 10 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createCombat, stepCombat, summonMoonLord, summonQueenBee } from "./sim";
import { bossTarget, danger, flyToward, slotOffset, tactic, threatsOf, type TacticInput } from "./tactics";

const bounds = { width: 1440, height: 900 };
const base: TacticInput = { x: 700, y: 800, r: 30, grounded: true, target: { x: 900, y: 500 }, threats: [], range: 300, melee: false, slot: 0, slots: 1, canFly: true, bounds, sinceStrike: 9 };

describe("companion combat tactics", () => {
  it("dodges a projectile heading straight at it", () => {
    const threats = [{ kind: "orb" as const, x: 400, y: 800, r: 8, vx: 600, vy: 0 }];
    const d = danger(700, 800, 30, threats);
    expect(d.level).toBeGreaterThan(0.3);
    const t = tactic({ ...base, threats });
    expect(t.mode).toBe("dodge");
    expect(Math.abs(t.goal.y - 800)).toBeGreaterThan(50); // flies out of the shot's path
    const ground = tactic({ ...base, threats, canFly: false });
    expect(ground.jump).toBe(true);
  });

  it("ignores threats that will miss", () => {
    expect(danger(700, 800, 30, [{ kind: "orb", x: 400, y: 200, r: 8, vx: 600, vy: 0 }]).level).toBe(0);
  });

  it("gets out of a Deathray's line during its warning", () => {
    const ray = { kind: "ray" as const, ax: 700, ay: 0, bx: 700, by: 900, width: 26, warn: true };
    const t = tactic({ ...base, threats: [ray] });
    expect(t.mode).toBe("dodge");
    expect(Math.abs(t.goal.x - 700)).toBeGreaterThan(100);
  });

  it("leaves a Queen Bee charge lane", () => {
    const t = tactic({ ...base, y: 500, threats: [{ kind: "lane", y: 510, half: 50, warn: true }] });
    expect(t.mode).toBe("dodge");
    expect(Math.abs(t.goal.y - 510)).toBeGreaterThan(80);
  });

  it("closes to weapon range and attacks; melee fighters back off after striking", () => {
    const far = tactic({ ...base, target: { x: 1300, y: 500 } });
    expect(far.mode).toBe("approach");
    const near = tactic({ ...base, target: { x: 900, y: 700 } });
    expect(near.attack).toBe(true);
    const after = tactic({ ...base, melee: true, range: 90, target: { x: 760, y: 790 }, sinceStrike: 0.1 });
    expect(after.mode).toBe("reposition");
    expect(after.goal.x).toBeLessThan(700);
  });

  it("spreads companions into different slots around the target", () => {
    const offs = [0, 1, 2, 3].map((s) => slotOffset(s, 4, 300, false));
    const keys = new Set(offs.map((o) => `${Math.round(o.dx)},${Math.round(o.dy)}`));
    expect(keys.size).toBe(4);
    expect(Math.sign(offs[0].dx)).not.toBe(Math.sign(offs[1].dx));
  });

  it("flies smoothly toward its goal at a capped speed", () => {
    let p = { x: 0, y: 0, vx: 0, vy: 0 };
    let maxSp = 0;
    for (let i = 0; i < 120; i++) {
      p = flyToward(p.x, p.y, p.vx, p.vy, { x: 500, y: 300 }, 1 / 60);
      maxSp = Math.max(maxSp, Math.hypot(p.vx, p.vy));
    }
    expect(maxSp).toBeLessThanOrEqual(420.01);
    expect(Math.hypot(p.x - 500, p.y - 300)).toBeLessThan(60);
  });

  it("reads real threats and targets from the sim's bosses", () => {
    const s = createCombat(1);
    expect(threatsOf(s, bounds)).toHaveLength(0);
    expect(bossTarget(s)).toBeNull();
    summonQueenBee(s, "normal", bounds, 700);
    for (let t = 0; t < 6; t += 1 / 60) stepCombat(s, 1 / 60, { x: 700, y: 816, w: 40, h: 84, facing: 1, scale: 3 }, bounds);
    expect(threatsOf(s, bounds).length).toBeGreaterThan(0);
    expect(bossTarget(s)).not.toBeNull();
    const m = createCombat(2);
    summonMoonLord(m, "normal", bounds, 700);
    m.moonLord!.ray = { warn: 1, fire: 1, angle: Math.PI / 2 };
    expect(threatsOf(m, bounds).some((t) => t.kind === "ray")).toBe(true);
  });
});

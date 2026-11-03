import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "./geometry";
import { beeFrame, beeTuning, spawnQueenBee, stepQueenBee, QB_CHARGE_FRAMES, QB_HOVER_FRAMES } from "./queenbee";
import { assistAttack, bossHealth, createCombat, dismissQueenBee, stepCombat, summonMoonLord, summonQueenBee, tryAttack, type CombatState } from "./sim";
import { getWeapon } from "./weapons";

const bounds = { width: 1440, height: 900 };
const dt = 1 / 60;
const player: PlayerInfo = { x: 700, y: bounds.height - 84, w: 40, h: 84, facing: 1, scale: 3 };
const run = (s: CombatState, secs: number) => {
  for (let t = 0; t < secs; t += dt) stepCombat(s, dt, player, bounds);
};
const queen = (s: CombatState) => s.dummies.find((d) => d.id === s.queenId)!;

describe("Queen Bee", () => {
  it("enters, then can be hit; the boss bar shows her name", () => {
    const s = createCombat(1);
    expect(summonQueenBee(s, "normal", bounds, 700)).toBe(true);
    expect(queen(s).respawn).toBeGreaterThan(0);
    run(s, 2);
    expect(queen(s).respawn).toBe(0);
    expect(bossHealth(s)?.name).toBe("Queen Bee");
    expect(s.events.some((e) => e.type === "message" && e.text.includes("Queen Bee has awoken"))).toBe(true);
  });

  it("cycles through stinger volleys, telegraphed charges and summoned bees", () => {
    const s = createCombat(2);
    summonQueenBee(s, "normal", bounds, 700);
    const phases = new Set<string>();
    let stingers = 0;
    let warned = false;
    let bees = 0;
    for (let t = 0; t < 20; t += dt) {
      stepCombat(s, dt, player, bounds);
      const q = s.queenBee!;
      phases.add(q.phase);
      stingers = Math.max(stingers, q.stingers.length);
      if (q.charge && q.charge.warn > 0) warned = true;
      bees = Math.max(bees, s.bees.length);
    }
    expect(phases).toEqual(new Set(["entering", "hover", "charge", "summon"]));
    expect(stingers).toBeGreaterThan(0);
    expect(warned).toBe(true);
    expect(bees).toBeGreaterThan(0);
  });

  it("uses the charging frames when dashing and the hover frames otherwise", () => {
    const q = spawnQueenBee("normal", bounds, 700);
    q.phase = "hover";
    expect(QB_HOVER_FRAMES).toContain(beeFrame(q));
    q.phase = "charge";
    q.charge = { y: 400, dir: 1, warn: 0 };
    expect(QB_CHARGE_FRAMES).toContain(beeFrame(q));
  });

  it("enrages at half health and is defeated at zero", () => {
    const s = createCombat(3);
    summonQueenBee(s, "easy", bounds, 700);
    run(s, 2);
    queen(s).hp = queen(s).maxHp * 0.4;
    run(s, 0.1);
    expect(s.queenBee!.enraged).toBe(true);
    queen(s).hp = 0;
    s.events = [];
    run(s, 2);
    expect(s.queenBee).toBeNull();
    expect(s.events.some((e) => e.type === "bossDefeated")).toBe(true);
  });

  it("damages the companion and takes damage from Terraria weapons and companions", () => {
    const s = createCombat(4);
    summonQueenBee(s, "master", bounds, 700);
    run(s, 2);
    const q = queen(s);
    const before = q.hp;
    assistAttack(s, getWeapon("fox-claws")!, { x: q.x - 10, y: q.y + q.h / 2 }, 1, 0, 3);
    expect(q.hp).toBeLessThan(before);
    tryAttack(s, getWeapon("megashark")!, { ...player, x: q.x - 200, y: q.y }, 1, 0);
    run(s, 25);
    expect(s.player.hp < s.player.maxHp || s.player.dead || s.events.some((e) => e.type === "playerHit")).toBe(true);
  });

  it("one boss at a time; can be dismissed", () => {
    const s = createCombat(5);
    summonQueenBee(s, "normal", bounds, 700);
    summonMoonLord(s, "normal", bounds, 700);
    expect(s.queenBee).toBeNull();
    summonQueenBee(s, "normal", bounds, 700);
    expect(s.moonLord).toBeNull();
    dismissQueenBee(s);
    run(s, 2);
    expect(s.queenBee).toBeNull();
    expect(beeTuning("master").hp).toBeGreaterThan(beeTuning("easy").hp);
    void stepQueenBee;
  });
});

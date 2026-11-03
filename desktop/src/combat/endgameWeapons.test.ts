import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "./geometry";
import { defaultInventory, fromSaved } from "./inventory";
import { createCombat, stepCombat, tryAttack, type CombatState, type Dummy } from "./sim";
import { ENDGAME_WEAPON_IDS, NEEDLE_DEF, THREAD_DEF, WEAPONS, getWeapon } from "./weapons";

const bounds = { width: 1440, height: 800 };
const dt = 1 / 60;
const player: PlayerInfo = { x: 400, y: bounds.height - 84, w: 40, h: 84, facing: 1, scale: 3 };
const weapon = (id: string) => getWeapon(id)!;

function addTarget(state: CombatState, x: number, y = bounds.height - 72, hp = 100000): Dummy {
  const d: Dummy = { id: state.nextId++, x, y, w: 48, h: 72, hp, maxHp: hp, defense: 0, flash: 0, wobble: 0, wobbleV: 0, respawn: 0 };
  state.dummies.push(d);
  return d;
}

function run(state: CombatState, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepCombat(state, dt, player, bounds);
}

describe("endgame weapons", () => {
  it("all seven exist with real item art and an approximation note", () => {
    expect(ENDGAME_WEAPON_IDS).toHaveLength(7);
    for (const id of ENDGAME_WEAPON_IDS) {
      const def = weapon(id);
      expect(def.art?.texture, id).toMatch(/^Images\/Item_\d+$/);
      expect(def.approximation, id).toBeTruthy();
    }
  });

  it("weapon ids are unique", () => {
    const ids = WEAPONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Meowmere launches piercing cats", () => {
    const state = createCombat(1);
    const far = addTarget(state, 900);
    tryAttack(state, weapon("meowmere"), player, 1, 0);
    run(state, 0.1);
    expect(state.projectiles.find((p) => p.kind === "beam")?.art?.texture).toBe("Images/Projectile_502");
    run(state, 1.2);
    expect(far.hp).toBeLessThan(far.maxHp);
  });

  it("S.D.M.G. and Vortex Beater fire fast bullets with their art", () => {
    for (const [id, art] of [["sdmg", "Images/Projectile_638"], ["vortex-beater", "Images/Projectile_616"]]) {
      const state = createCombat(1);
      const target = addTarget(state, 700);
      tryAttack(state, weapon(id), player, 1, 0);
      run(state, 0.05);
      expect(state.projectiles[0]?.art?.texture, id).toBe(art);
      run(state, 0.5);
      expect(target.hp, id).toBeLessThan(target.maxHp);
    }
  });

  it("Celebration Mk2 rockets burst and splash nearby targets", () => {
    const state = createCombat(1);
    const front = addTarget(state, 700);
    const behind = addTarget(state, 760); // shielded by the first target, inside the blast radius
    tryAttack(state, weapon("celebration-mk2"), player, 1, 0);
    run(state, 0.05);
    expect(state.projectiles[0]?.explosive).toBeTruthy();
    run(state, 1);
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(behind.hp).toBeLessThan(behind.maxHp);
  });

  it("Solar Eruption reaches far in front of the character", () => {
    const state = createCombat(1);
    const reachDef = weapon("solar-eruption");
    expect(reachDef.kind === "sword" && reachDef.reach).toBeGreaterThan(60);
    const target = addTarget(state, player.x + player.w + 120);
    tryAttack(state, reachDef, player, 1, 0);
    run(state, reachDef.useTime);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("Stardust Dragon and Terraprisma summon sprite minions that attack", () => {
    for (const id of ["stardust-dragon-staff", "terraprisma"]) {
      const state = createCombat(1);
      const target = addTarget(state, 800);
      const def = weapon(id);
      expect(def.kind === "summon" && def.minion.art?.texture, id).toMatch(/^Images\/Projectile_\d+$/);
      tryAttack(state, def, player, 1, 0);
      run(state, 3);
      expect(state.minions.length, id).toBe(1);
      expect(target.hp, id).toBeLessThan(target.maxHp);
    }
  });
});

describe("Needle and Thread items", () => {
  it("are on the default hotbar and selectable", () => {
    const inv = defaultInventory();
    expect(inv.slots.slice(0, 10)).toContain(NEEDLE_DEF.id);
    expect(inv.slots.slice(0, 10)).toContain(THREAD_DEF.id);
  });

  it("are added to older saved inventories", () => {
    const inv = fromSaved(["rustic-sword"], 0);
    expect(inv.slots).toContain(NEEDLE_DEF.id);
    expect(inv.slots).toContain("terraprisma");
  });

  it("the Needle swings like a quick sword under Terraria Controls", () => {
    const state = createCombat(1);
    const target = addTarget(state, player.x + player.w + 4);
    tryAttack(state, NEEDLE_DEF, player, 1, 0);
    run(state, NEEDLE_DEF.useTime);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("the Thread spins silk that hits targets on both sides", () => {
    const state = createCombat(1);
    const right = addTarget(state, player.x + player.w + 10);
    const left = addTarget(state, player.x - 58);
    const far = addTarget(state, 1100);
    tryAttack(state, THREAD_DEF, player, 1, 0);
    run(state, THREAD_DEF.useTime);
    expect(right.hp).toBeLessThan(right.maxHp);
    expect(left.hp).toBeLessThan(left.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });
});

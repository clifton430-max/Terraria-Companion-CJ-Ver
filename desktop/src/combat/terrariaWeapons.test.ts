import { describe, expect, it } from "vitest";
import { decide, initialAi, mulberry32, type AiState } from "../engine/behavior";
import { DEFAULT_PHYSICS as cfg, makeBody, step, type Body } from "../engine/physics";
import { BOSS_RADIUS, tuningFor, TRANSFORM_AT, type BossDifficulty } from "./boss";
import { handPosition, type PlayerInfo } from "./geometry";
import {
  PLAYER_IFRAMES,
  PLAYER_MAX_HP,
  aimAt,
  aliveDummies,
  bossHealth,
  canAttack,
  createCombat,
  dismissBoss,
  preferredRange,
  prismRamp,
  rectOf,
  resetTraining,
  retryBoss,
  setTraining,
  stepCombat,
  summonBoss,
  tryAttack,
  type CombatEvent,
  type CombatState,
  type Dummy,
} from "./sim";
import { TERRARIA_WEAPON_IDS, getWeapon, type WeaponDef } from "./weapons";

const bounds = { width: 1440, height: 800 };
const dt = 1 / 60;
const S = 3;
const player: PlayerInfo = { x: 400, y: bounds.height - 84, w: 40, h: 84, facing: 1, scale: S };

const weapon = (id: string) => getWeapon(id)!;

function addTarget(state: CombatState, x: number, y = bounds.height - 72, hp = 100000): Dummy {
  const d: Dummy = { id: state.nextId++, x, y, w: 48, h: 72, hp, maxHp: hp, defense: 0, flash: 0, wobble: 0, wobbleV: 0, respawn: 0 };
  state.dummies.push(d);
  return d;
}

function run(state: CombatState, seconds: number, p: PlayerInfo = player) {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepCombat(state, dt, p, bounds);
}

const centerOf = (d: Dummy) => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 });

describe("Terraria weapon definitions", () => {
  it("all six exist with real item art and an approximation note", () => {
    for (const id of TERRARIA_WEAPON_IDS) {
      const def = weapon(id);
      expect(def.art?.texture, id).toMatch(/^Images\/Item_\d+$/);
      expect(def.approximation, id).toBeTruthy();
    }
  });
});

describe("Terra Blade", () => {
  it("fires a piercing Terra Beam that hits targets far beyond the blade's reach", () => {
    const state = createCombat(1);
    const far = addTarget(state, 900);
    const def = weapon("terra-blade");
    tryAttack(state, def, player, 1, 0);
    run(state, 0.1);
    const beam = state.projectiles.find((p) => p.kind === "beam");
    expect(beam?.art?.texture).toBe("Images/Projectile_132");
    run(state, 1);
    expect(far.hp).toBeLessThan(far.maxHp);
  });

  it("respects its use time as the cooldown", () => {
    const state = createCombat(1);
    const def = weapon("terra-blade");
    expect(tryAttack(state, def, player).ok).toBe(true);
    run(state, def.useTime - 0.05);
    expect(canAttack(state, def).ok).toBe(false);
    run(state, 0.1);
    expect(canAttack(state, def).ok).toBe(true);
  });
});

describe("Night's Edge", () => {
  it("hits with its wide blade arc and has a slash sprite", () => {
    const state = createCombat(2);
    const def = weapon("nights-edge");
    const hand = handPosition(player, "point", 1);
    const d = addTarget(state, hand.x + 20);
    tryAttack(state, def, player, 1);
    run(state, def.useTime + dt);
    expect(d.hp).toBeLessThan(d.maxHp);
    expect(def.kind === "sword" && def.slash?.texture).toBe("Images/Projectile_972");
  });
});

describe("Megashark", () => {
  it("fires roughly every 0.12 s while held, each round dealing 25 ± 15%", () => {
    const state = createCombat(3);
    const def = weapon("megashark");
    const d = addTarget(state, 900);
    const aim = aimAt(def, player, 1, rectOf(d));
    let shots = 0;
    for (let t = 0; t < 1.2; t += dt) {
      if (tryAttack(state, def, player, 1, aim).ok) shots++;
      stepCombat(state, dt, player, bounds);
    }
    expect(shots).toBeGreaterThanOrEqual(9);
    expect(shots).toBeLessThanOrEqual(11);
    run(state, 1);
    const dealt = d.maxHp - d.hp;
    expect(dealt).toBeGreaterThan(shots * 25 * 0.8);
    expect(dealt).toBeLessThan(shots * 25 * 2.3); // allows crits
  });
});

describe("Daedalus Stormbow", () => {
  it("rains arrows from far above the target onto it", () => {
    const state = createCombat(4);
    const def = weapon("daedalus-stormbow");
    const d = addTarget(state, 900);
    const c = centerOf(d);
    tryAttack(state, def, player, 1, 0, c);
    run(state, 0.06);
    const arrows = state.projectiles.filter((p) => p.kind === "arrow");
    expect(arrows.length).toBeGreaterThanOrEqual(3);
    for (const a of arrows) {
      expect(a.y).toBeLessThan(c.y - 300);
      expect(a.vy).toBeGreaterThan(0); // falling toward the target
      expect(a.art?.texture).toBe("Images/Projectile_91");
    }
    run(state, 1.5);
    expect(d.hp).toBeLessThan(d.maxHp);
  });
});

describe("Last Prism", () => {
  it("channels for its duration, drains mana and hits along the beam repeatedly with ramping damage", () => {
    const state = createCombat(5);
    const def = weapon("last-prism");
    const d = addTarget(state, 900);
    tryAttack(state, def, player, 1, 0, centerOf(d));
    run(state, 1);
    const early = state.hitCount;
    expect(early).toBeGreaterThan(2);
    expect(state.mana).toBeLessThan(100 - 12);
    run(state, 1.9);
    expect(state.attack).not.toBeNull();
    expect(state.hitCount).toBeGreaterThan(early + 5);
    run(state, 0.2);
    expect(state.attack).toBeNull();
    expect(prismRamp(def, 0)).toBeCloseTo(0.35);
    expect(prismRamp(def, 5)).toBe(1);
  });

  it("stops early when mana runs out", () => {
    const state = createCombat(5);
    const def = weapon("last-prism");
    state.mana = 20;
    tryAttack(state, def, player, 1, 0);
    run(state, 1.5);
    expect(state.attack).toBeNull();
    expect(state.mana).toBeLessThan(5);
  });
});

describe("Zenith", () => {
  it("sends a spectral sword out to the target and back, hitting what it passes", () => {
    const state = createCombat(6);
    const def = weapon("zenith");
    const d = addTarget(state, 800, 400);
    tryAttack(state, def, player, 1, 0, centerOf(d));
    run(state, dt);
    const sword = state.projectiles.find((p) => p.kind === "fractal")!;
    expect(sword.art?.texture).toMatch(/^Images\/Item_/);
    let maxDist = 0;
    const hand = handPosition(player, "point", 1);
    for (let t = 0; t < 0.7; t += dt) {
      stepCombat(state, dt, player, bounds);
      const live = state.projectiles.find((p) => p.id === sword.id);
      if (live) maxDist = Math.max(maxDist, Math.hypot(live.x - hand.x, live.y - hand.y));
    }
    expect(maxDist).toBeGreaterThan(300);
    expect(state.projectiles.find((p) => p.id === sword.id)).toBeUndefined(); // came back and expired
    expect(d.hp).toBeLessThan(d.maxHp);
  });

  it("has no blade hitbox: the swing itself never registers melee hits", () => {
    const state = createCombat(6);
    const def = weapon("zenith");
    const hand = handPosition(player, "point", 1);
    addTarget(state, hand.x + 10, bounds.height - 72); // squarely inside a normal blade's reach
    tryAttack(state, def, player, 1, 0, { x: hand.x, y: 0 });
    const bladeHits: number[] = [];
    for (let t = 0; t < def.useTime; t += dt) {
      stepCombat(state, dt, player, bounds);
      if (state.attack) bladeHits.push(...state.attack.hits);
    }
    expect(bladeHits).toEqual([]);
  });
});

describe("Eye of Cthulhu in the combat sandbox", () => {
  const summon = (state: CombatState, d: BossDifficulty = "normal") => summonBoss(state, d, bounds, 2, 700);

  it("summons once, announces itself, and is hittable through its dummy entry with defence", () => {
    const state = createCombat(7);
    expect(summon(state)).toBe(true);
    expect(summon(state)).toBe(false);
    expect(state.events.some((e) => e.type === "message" && e.text.includes("awoken"))).toBe(true);
    const hp = bossHealth(state)!;
    expect(hp.hp).toBe(tuningFor("normal").maxHp);
    const entry = state.dummies.find((d) => d.kind === "boss")!;
    expect(entry.defense).toBe(12);
    expect(aliveDummies(state)).toContain(entry);
  });

  it("transforms at half health, is defeated at zero, then leaves the sandbox", () => {
    const state = createCombat(8);
    summon(state);
    run(state, 1);
    const entry = state.dummies.find((d) => d.kind === "boss")!;
    entry.hp = entry.maxHp * TRANSFORM_AT;
    run(state, 2.5);
    expect(state.boss?.phase).toBe("phase2");
    expect(entry.defense).toBe(0);
    entry.hp = 0;
    const events: CombatEvent[] = [];
    for (let t = 0; t < 2; t += dt) {
      stepCombat(state, dt, player, bounds);
      events.push(...state.events);
      state.events = [];
    }
    expect(events.some((e) => e.type === "bossDefeated")).toBe(true);
    expect(events.some((e) => e.type === "bossGone")).toBe(true);
    expect(state.boss).toBeNull();
    expect(state.dummies.some((d) => d.kind === "boss")).toBe(false);
  });

  it("damages the companion on contact with invincibility frames, and the companion can be slain", () => {
    const state = createCombat(9);
    summon(state, "master");
    const boss = state.boss!;
    const touching: PlayerInfo = { ...player, x: boss.x - 20, y: boss.y - 40 };
    run(state, dt, touching);
    const afterFirst = state.player.hp;
    expect(afterFirst).toBeLessThan(PLAYER_MAX_HP);
    run(state, PLAYER_IFRAMES * 0.5, touching);
    expect(state.player.hp).toBe(afterFirst); // invincible right after a hit
    for (let t = 0; t < 30 && !state.player.dead; t += dt) {
      state.boss!.x = touching.x + 20;
      state.boss!.y = touching.y + 40;
      stepCombat(state, dt, touching, bounds);
    }
    expect(state.player.dead).toBe(true);
    // A slain companion makes the boss leave; the companion respawns at full health.
    run(state, 6);
    expect(state.boss).toBeNull();
    expect(state.player.dead).toBe(false);
    expect(state.player.hp).toBe(PLAYER_MAX_HP);
  });

  it("dismiss sends it away; retry restarts with full health; training resets keep the boss", () => {
    const state = createCombat(10);
    summon(state);
    run(state, 1);
    setTraining(state, true, bounds, 400, 3);
    resetTraining(state, bounds, 400, 3);
    expect(state.dummies.some((d) => d.kind === "boss")).toBe(true);
    state.dummies.find((d) => d.kind === "boss")!.hp = 100;
    retryBoss(state, "normal", bounds, 2, 700);
    expect(bossHealth(state)!.hp).toBe(tuningFor("normal").maxHp);
    dismissBoss(state);
    run(state, 4);
    expect(state.boss).toBeNull();
  });

  it("summons Servants that can be killed and are removed", () => {
    const state = createCombat(11);
    summon(state);
    run(state, 3);
    const servants = state.dummies.filter((d) => d.kind === "servant");
    expect(servants.length).toBeGreaterThan(0);
    servants[0].hp = 0;
    run(state, dt);
    expect(state.dummies.find((d) => d.id === servants[0].id)).toBeUndefined();
  });
});

/** AI-driven fight (same loop shape as the overlay) — used to check the boss stays a fight. */
function fight(def: WeaponDef, difficulty: BossDifficulty, maxSeconds: number) {
  const rng = mulberry32(3);
  const combat = createCombat(3);
  let body: Body = makeBody(500, bounds, 40, 84);
  let ai: AiState = initialAi();
  let hitWall: -1 | 0 | 1 = 0;
  const info = (): PlayerInfo => ({ x: body.x, y: body.y, w: body.w, h: body.h, facing: body.facing, scale: S });
  summonBoss(combat, difficulty, bounds, 2, 600);
  let t = 0;
  let deaths = 0;
  let defeated = false;
  for (; t < maxSeconds && !defeated; t += dt) {
    // Same targeting as the overlay: the nearest live enemy (Servants included).
    const cx = body.x + body.w / 2;
    const target = aliveDummies(combat).sort(
      (a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx),
    )[0];
    const d = decide(
      ai,
      {
        grounded: body.grounded,
        landing: false,
        hitWall,
        x: body.x,
        w: body.w,
        boundsWidth: bounds.width,
        busy: combat.attack !== null,
        combat: target && !combat.player.dead
          ? {
              targetX: target.x + target.w / 2,
              range: preferredRange(def, S),
              ready: canAttack(combat, def).ok,
              distance: Math.hypot(target.x + target.w / 2 - (body.x + body.w / 2), target.y + target.h / 2 - (body.y + body.h / 2)),
            }
          : null,
      },
      dt,
      rng,
    );
    ai = d.ai;
    const r = step(body, d.intent, dt, bounds, cfg);
    body = r.body;
    hitWall = r.hitWall;
    if (d.attack !== undefined && target) {
      const rect = rectOf(target);
      tryAttack(combat, def, info(), d.attack, aimAt(def, info(), d.attack, rect), { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    }
    if (combat.attack && target) combat.attack.aimPoint = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    stepCombat(combat, dt, info(), bounds);
    for (const e of combat.events) {
      if (e.type === "playerSlain") deaths++;
      if (e.type === "bossDefeated") defeated = true;
    }
    combat.events = [];
    if (!combat.boss && !defeated) summonBoss(combat, difficulty, bounds, 2, body.x); // keep trying after a loss
  }
  return { seconds: t, defeated, deaths };
}

describe("boss balance (AI fights the Eye on Normal)", () => {
  for (const id of TERRARIA_WEAPON_IDS) {
    it(`${id} wins, but not instantly`, () => {
      const result = fight(weapon(id), "normal", 300);
      console.log(`[balance] ${id}: ${result.defeated ? "won" : "lost"} in ${result.seconds.toFixed(1)}s, ${result.deaths} deaths`);
      expect(result.defeated).toBe(true);
      expect(result.seconds).toBeGreaterThan(15); // still a fight
    });
  }

  it("harder difficulties take longer or cost more deaths (Zenith and Megashark)", () => {
    for (const id of ["zenith", "megashark"]) {
      const normal = fight(weapon(id), "normal", 400);
      const master = fight(weapon(id), "master", 400);
      console.log(`[balance] ${id}: normal ${normal.seconds.toFixed(1)}s/${normal.deaths}d, master ${master.seconds.toFixed(1)}s/${master.deaths}d (${master.defeated ? "won" : "lost"})`);
      expect(master.seconds + master.deaths * 30).toBeGreaterThan(normal.seconds + normal.deaths * 30);
    }
  });

  it("the boss is big enough to read on screen", () => {
    expect(BOSS_RADIUS * 2).toBeGreaterThan(80);
  });
});

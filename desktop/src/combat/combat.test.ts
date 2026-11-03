import { describe, expect, it } from "vitest";
import { nextRandom, rollDamage } from "./damage";
import { handPosition, segmentHitsRect, type PlayerInfo } from "./geometry";
import { bladeSegment, swingAngle, swordHits } from "./melee";
import { stepMinion, type Minion } from "./minions";
import { ballisticAngle, moveProjectile, type Projectile } from "./projectiles";
import {
  BASE_MANA,
  DUMMY_HP,
  DUMMY_RESPAWN,
  MANA_REGEN,
  MANA_REGEN_DELAY,
  aimAt,
  aliveDummies,
  canAttack,
  createCombat,
  dismissMinions,
  maxMana,
  placeDummies,
  rectOf,
  resetTraining,
  setTraining,
  stepCombat,
  tryAttack,
  weaponTip,
  type CombatState,
  type Dummy,
} from "./sim";
import { MINION_CAPACITY, getWeapon, type SwordDef, type WeaponDef } from "./weapons";

const bounds = { width: 1440, height: 800 };
const S = 3;
const dt = 1 / 60;
const player: PlayerInfo = { x: 400, y: bounds.height - 72, w: 48, h: 72, facing: 1, scale: S };

const weapon = <K extends WeaponDef["kind"]>(id: string, kind: K) => {
  const def = getWeapon(id)!;
  expect(def.kind).toBe(kind);
  return def as Extract<WeaponDef, { kind: K }>;
};
const sword = weapon("rustic-sword", "sword");
const bow = weapon("pine-bow", "bow");
const pistol = weapon("pocket-pistol", "gun");
const scattergun = weapon("scattergun", "gun");
const wand = weapon("spark-wand", "staff");
const frost = weapon("frost-staff", "staff");
const wisp = weapon("wisp-lantern", "summon");

/** A standing dummy at `x` (left edge), feet on the floor unless `y` is given. */
function addDummy(state: CombatState, x: number, y = bounds.height - 72, hp = DUMMY_HP): Dummy {
  const d: Dummy = {
    id: state.nextId++,
    x,
    y,
    w: 48,
    h: 72,
    hp,
    maxHp: DUMMY_HP,
    defense: 0,
    flash: 0,
    wobble: 0,
    wobbleV: 0,
    respawn: 0,
  };
  state.dummies.push(d);
  return d;
}

function run(state: CombatState, seconds: number, p: PlayerInfo = player) {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepCombat(state, dt, p, bounds);
}

describe("damage", () => {
  it("applies ±15% variance, doubles on crit and subtracts half defence", () => {
    expect(rollDamage(20, 0, 0, 0, 0.5)).toEqual({ amount: 17, crit: false }); // 0.85×
    expect(rollDamage(20, 0, 0, 0.999, 0.5)).toEqual({ amount: 23, crit: false }); // ~1.15×
    expect(rollDamage(20, 0, 0.1, 0.5, 0.05)).toEqual({ amount: 40, crit: true });
    expect(rollDamage(20, 10, 0, 0.5, 0.5).amount).toBe(15);
    expect(rollDamage(1, 100, 0, 0, 0.9).amount).toBe(1); // never below 1
  });

  it("the serialisable RNG is deterministic and in [0, 1)", () => {
    let a = 42;
    let b = 42;
    for (let i = 0; i < 50; i++) {
      const [va, na] = nextRandom(a);
      const [vb, nb] = nextRandom(b);
      expect(va).toBe(vb);
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
      a = na;
      b = nb;
    }
  });
});

describe("cooldowns", () => {
  it("blocks a second attack until the use time has elapsed", () => {
    const state = createCombat(1);
    expect(tryAttack(state, pistol, player)).toEqual({ ok: true });
    expect(tryAttack(state, pistol, player)).toEqual({ ok: false, reason: "busy" });
    run(state, pistol.useTime / 2);
    expect(canAttack(state, pistol).ok).toBe(false);
    run(state, pistol.useTime / 2 + dt);
    expect(state.attack).toBeNull();
    expect(canAttack(state, pistol)).toEqual({ ok: true });
  });

  it("each weapon has its own cooldown length", () => {
    const fast = createCombat(1);
    const slow = createCombat(1);
    tryAttack(fast, pistol, player);
    tryAttack(slow, scattergun, player);
    run(fast, 0.35);
    run(slow, 0.35);
    expect(canAttack(fast, pistol).ok).toBe(true);
    expect(canAttack(slow, scattergun).ok).toBe(false);
  });
});

describe("mana", () => {
  it("spends mana up front, waits, then regenerates up to the cap", () => {
    const state = createCombat(1);
    tryAttack(state, wand, player);
    expect(state.mana).toBe(BASE_MANA - wand.manaCost);
    run(state, MANA_REGEN_DELAY - 0.1);
    expect(state.mana).toBe(BASE_MANA - wand.manaCost);
    run(state, 0.1 + 0.2);
    expect(state.mana).toBeCloseTo(BASE_MANA - wand.manaCost + MANA_REGEN * 0.2, 0);
    run(state, 2);
    expect(state.mana).toBe(BASE_MANA);
  });

  it("refuses to cast without enough mana and says so", () => {
    const state = createCombat(1);
    state.mana = wand.manaCost - 1;
    expect(tryAttack(state, wand, player)).toEqual({ ok: false, reason: "mana" });
    expect(state.mana).toBe(wand.manaCost - 1);
    expect(state.attack).toBeNull();
    expect(state.texts.map((t) => t.text)).toContain("Low mana");
  });

  it("weapons without a mana cost never spend mana", () => {
    const state = createCombat(1);
    tryAttack(state, sword, player);
    run(state, 1);
    expect(state.mana).toBe(BASE_MANA);
  });
});

describe("sword (melee)", () => {
  const hand = handPosition(player, "point", 1);

  it("hits a dummy in front within reach, once per swing", () => {
    const state = createCombat(7);
    const d = addDummy(state, hand.x + 10);
    tryAttack(state, sword, player);
    run(state, sword.useTime + dt);
    expect(state.hitCount).toBe(1);
    expect(d.hp).toBeLessThan(DUMMY_HP);
    expect(state.texts.some((t) => /^\d+$/.test(t.text))).toBe(true);
  });

  it("does not hit a dummy behind the character or beyond reach", () => {
    const state = createCombat(7);
    addDummy(state, player.x - 100); // behind
    addDummy(state, hand.x + sword.reach * S + 20); // too far
    tryAttack(state, sword, player);
    run(state, sword.useTime + dt);
    expect(state.hitCount).toBe(0);
  });

  it("swings the other way when facing left", () => {
    const state = createCombat(7);
    const left = handPosition(player, "point", -1);
    addDummy(state, left.x - 10 - 48);
    tryAttack(state, sword, player, -1);
    run(state, sword.useTime + dt);
    expect(state.hitCount).toBe(1);
  });

  it("only damages during the active part of the swing", () => {
    // High and in front: the blade passes through it near the start of the arc.
    const target = { id: 1, rect: { x: hand.x + 15, y: hand.y - 58, w: 20, h: 18 } };
    expect(swordHits(sword, hand, 1, sword.reach * S, 0, sword.activeFrom - 0.01, [target], [])).toEqual([]);
    expect(swordHits(sword, hand, 1, sword.reach * S, 0, 1, [target], [])).toEqual([1]);
    expect(swordHits(sword, hand, 1, sword.reach * S, 0, 1, [target], [1])).toEqual([]);
  });

  it("blade geometry mirrors for left-facing swings", () => {
    const [, right] = bladeSegment({ x: 0, y: 0 }, 0, 1, 10);
    const [, left] = bladeSegment({ x: 0, y: 0 }, 0, -1, 10);
    expect(right.x).toBeCloseTo(10);
    expect(left.x).toBeCloseTo(-10);
    expect(swingAngle(sword as SwordDef, 0)).toBe(sword.arcFrom);
    expect(swingAngle(sword as SwordDef, 1)).toBe(sword.arcTo);
  });
});

describe("projectiles", () => {
  it("swept collision catches a thin target crossed within one step", () => {
    expect(segmentHitsRect(0, 5, 100, 5, { x: 50, y: 0, w: 2, h: 10 })).toBeCloseTo(0.5);
    expect(segmentHitsRect(0, 50, 100, 50, { x: 50, y: 0, w: 2, h: 10 })).toBeNull();
    expect(segmentHitsRect(0, 50, 100, 50, { x: 50, y: 0, w: 2, h: 10 }, 45)).not.toBeNull(); // padded
  });

  it("gravity bends an arrow downward while homing steers a bolt", () => {
    const base: Projectile = {
      id: 1, kind: "arrow", weaponId: "pine-bow", x: 0, y: 0, vx: 500, vy: 0, gravity: 900,
      damage: 1, knockback: 0, crit: 0, pierce: 0, hits: [], ttl: 5, radius: 3, homing: 0, color: "#fff",
    };
    const arrow = { ...base };
    for (let i = 0; i < 30; i++) moveProjectile(arrow, dt, null);
    expect(arrow.vy).toBeCloseTo(450);
    expect(arrow.y).toBeGreaterThan(0);

    const bolt = { ...base, kind: "bolt" as const, gravity: 0, homing: 3 };
    for (let i = 0; i < 30; i++) moveProjectile(bolt, dt, { x: 500, y: -500 });
    expect(bolt.vy).toBeLessThan(0); // turned toward the target above
    expect(Math.hypot(bolt.vx, bolt.vy)).toBeCloseTo(500); // speed preserved
  });

  it("ballisticAngle solves a reachable target and rejects an unreachable one", () => {
    const angle = ballisticAngle(300, 0, 720, 900)!;
    expect(angle).toBeLessThan(0); // aims slightly upward
    const p = { x: 0, y: 0, vx: Math.cos(angle) * 720, vy: Math.sin(angle) * 720 };
    let t = 0;
    while (p.x < 300 && t < 5) {
      p.vy += 900 * 0.001;
      p.x += p.vx * 0.001;
      p.y += p.vy * 0.001;
      t += 0.001;
    }
    expect(Math.abs(p.y)).toBeLessThan(3);
    expect(ballisticAngle(100000, 0, 100, 900)).toBeNull();
    expect(ballisticAngle(-300, 0, 720, 900)!).toBeGreaterThan(Math.PI / 2); // leftward
  });
});

describe("bow", () => {
  it("draws, releases an arrow at drawTime, and the aimed arrow hits the dummy", () => {
    const state = createCombat(3);
    const d = addDummy(state, 760);
    tryAttack(state, bow, player, 1, aimAt(bow, player, 1, rectOf(d)));
    run(state, bow.drawTime - 2 * dt);
    expect(state.projectiles).toHaveLength(0);
    run(state, 3 * dt);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].gravity).toBe(bow.arrowGravity);
    run(state, 1.5);
    expect(state.hitCount).toBe(1);
    expect(state.projectiles).toHaveLength(0);
  });

  it("an arrow fired with nothing in the way lands on the floor and is removed", () => {
    const state = createCombat(3);
    tryAttack(state, bow, player);
    run(state, 3);
    expect(state.projectiles).toHaveLength(0);
    expect(state.hitCount).toBe(0);
  });
});

describe("gun", () => {
  it("fires immediately from the muzzle with a flash", () => {
    const state = createCombat(5);
    tryAttack(state, pistol, player);
    run(state, dt);
    expect(state.projectiles).toHaveLength(1);
    const muzzle = weaponTip(pistol, handPosition(player, "point", 1), 0, 1, S);
    expect(state.projectiles[0].x).toBeGreaterThan(muzzle.x); // moved one step past it
    expect(state.effects.some((e) => e.kind === "muzzle")).toBe(true);
    expect(Math.abs(state.projectiles[0].vx)).toBeGreaterThan(1500);
  });

  it("fast bullets still hit with a coarse 0.1s step", () => {
    const state = createCombat(5);
    addDummy(state, 900);
    tryAttack(state, pistol, player);
    for (let i = 0; i < 10; i++) stepCombat(state, 0.1, player, bounds);
    expect(state.hitCount).toBe(1);
  });

  it("the scattergun fires several pellets in a spread", () => {
    const state = createCombat(5);
    tryAttack(state, scattergun, player);
    run(state, dt);
    expect(state.projectiles).toHaveLength(scattergun.pellets);
    const angles = state.projectiles.map((p) => Math.atan2(p.vy, p.vx));
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo(scattergun.spread, 2);
  });
});

describe("magic staff", () => {
  it("costs mana, casts after castTime and its homing bolt finds an off-axis dummy", () => {
    const state = createCombat(9);
    addDummy(state, 800, 400); // well above the straight-line path
    tryAttack(state, wand, player, 1, 0);
    expect(state.mana).toBe(BASE_MANA - wand.manaCost);
    run(state, wand.castTime + dt);
    expect(state.projectiles).toHaveLength(1);
    expect(state.effects.some((e) => e.kind === "cast")).toBe(true);
    run(state, 2);
    expect(state.hitCount).toBe(1);

    const straight = createCombat(9);
    addDummy(straight, 800, 400);
    tryAttack(straight, wand, player, 1, 0);
    run(straight, wand.castTime + dt);
    straight.projectiles[0].homing = 0; // same shot without seeking
    run(straight, 2.5);
    expect(straight.hitCount).toBe(0);
  });

  it("a piercing bolt passes through several dummies in a line", () => {
    const state = createCombat(9);
    const hand = handPosition(player, "raise", 1);
    const tip = weaponTip(frost, hand, 0, 1, S);
    addDummy(state, 650, tip.y - 36);
    addDummy(state, 800, tip.y - 36);
    addDummy(state, 950, tip.y - 36);
    tryAttack(state, frost, player, 1, 0);
    run(state, 3);
    expect(state.hitCount).toBe(3); // pierce 2 → three targets
  });
});

describe("training dummies", () => {
  it("are placed on the floor inside the screen and never overlap", () => {
    const state = createCombat(1);
    const dummies = placeDummies(state, bounds, 60, S); // character near the left edge
    for (const d of dummies) {
      expect(d.y + d.h).toBe(bounds.height);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.w).toBeLessThanOrEqual(bounds.width);
    }
    const xs = dummies.map((d) => d.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(48);
  });

  it("are defeated at 0 health and respawn at full health", () => {
    const state = createCombat(2);
    const d = addDummy(state, player.x + 60, undefined, 1);
    tryAttack(state, sword, player);
    run(state, sword.useTime);
    expect(d.hp).toBe(0);
    expect(d.respawn).toBeGreaterThan(0);
    expect(aliveDummies(state)).toHaveLength(0);
    run(state, DUMMY_RESPAWN + 0.1);
    expect(d.hp).toBe(DUMMY_HP);
    expect(aliveDummies(state)).toHaveLength(1);
  });

  it("training mode toggles dummies and reset restores the scenario", () => {
    const state = createCombat(2);
    setTraining(state, true, bounds, 700, S);
    expect(state.dummies).toHaveLength(3);
    state.dummies[0].hp = 10;
    state.mana = 5;
    tryAttack(state, pistol, player);
    run(state, 0.05);
    resetTraining(state, bounds, 700, S);
    expect(state.dummies.every((d) => d.hp === DUMMY_HP)).toBe(true);
    expect(state.projectiles).toEqual([]);
    expect(state.minions).toEqual([]);
    expect(state.mana).toBe(BASE_MANA);
    expect(state.totalDamage).toBe(0);
    setTraining(state, false, bounds, 700, S);
    expect(state.dummies).toEqual([]);
  });
});

describe("summon", () => {
  it("creates a minion after the cast, reserving upkeep from max mana", () => {
    const state = createCombat(4);
    tryAttack(state, wisp, player);
    expect(state.mana).toBe(BASE_MANA - wisp.manaCost);
    run(state, wisp.castTime + dt);
    expect(state.minions).toHaveLength(1);
    expect(maxMana(state)).toBe(BASE_MANA - wisp.upkeep);
    run(state, 5);
    expect(state.mana).toBe(BASE_MANA - wisp.upkeep); // regen stops at the reduced cap
  });

  it("follows the character when there are no targets", () => {
    const state = createCombat(4);
    tryAttack(state, wisp, player);
    run(state, 2);
    const moved: PlayerInfo = { ...player, x: 900 };
    run(state, 2, moved);
    const m = state.minions[0];
    expect(Math.abs(m.x - (moved.x + moved.w / 2))).toBeLessThan(80);
    expect(m.y).toBeLessThan(moved.y + moved.h);
  });

  it("attacks a dummy within range, respecting its hit cooldown", () => {
    const state = createCombat(4);
    const d = addDummy(state, 650);
    tryAttack(state, wisp, player);
    run(state, 3);
    expect(state.hitCount).toBeGreaterThan(1);
    expect(state.hitCount).toBeLessThanOrEqual(Math.ceil(3 / wisp.minion.hitCooldown));
    expect(d.hp).toBeLessThan(DUMMY_HP);
  });

  it("ignores dummies outside its range", () => {
    const state = createCombat(4);
    addDummy(state, player.x + wisp.minion.range + 200);
    tryAttack(state, wisp, player);
    run(state, 3);
    expect(state.hitCount).toBe(0);
  });

  it("replaces the oldest minion beyond capacity; dismiss frees the upkeep", () => {
    const state = createCombat(4);
    const ids: number[] = [];
    for (let i = 0; i < MINION_CAPACITY + 1; i++) {
      state.mana = BASE_MANA;
      expect(tryAttack(state, wisp, player).ok).toBe(true);
      run(state, wisp.useTime + dt);
      ids.push(state.minions[state.minions.length - 1].id);
    }
    expect(state.minions).toHaveLength(MINION_CAPACITY);
    expect(state.minions.map((m) => m.id)).toEqual(ids.slice(1));
    dismissMinions(state);
    expect(state.minions).toHaveLength(0);
    expect(maxMana(state)).toBe(BASE_MANA);
  });

  it("stepMinion bounces off after a hit and teleports back when left far behind", () => {
    const spec = wisp.minion;
    const m: Minion = { id: 1, weaponId: wisp.id, x: 100, y: 100, vx: 0, vy: 0, targetId: null, hitCooldowns: {}, age: 0 };
    const target = { id: 9, rect: { x: 95, y: 95, w: 20, h: 20 } };
    expect(stepMinion(m, spec, dt, { anchor: { x: 0, y: 0 }, owner: { x: 100, y: 100 }, targets: [target] })).toBe(9);
    expect(stepMinion(m, spec, dt, { anchor: { x: 0, y: 0 }, owner: { x: 100, y: 100 }, targets: [target] })).toBeNull();
    const far: Minion = { ...m, x: 5000, y: 5000, hitCooldowns: {} };
    stepMinion(far, spec, dt, { anchor: { x: 10, y: 10 }, owner: { x: 10, y: 10 }, targets: [] });
    expect(Math.hypot(far.x - 10, far.y - 10)).toBeLessThan(5);
  });
});

describe("determinism", () => {
  function script(seed: number) {
    const state = createCombat(seed);
    setTraining(state, true, bounds, player.x + 24, S);
    const plan: [WeaponDef, number][] = [[sword, 0.5], [pistol, 0.3], [bow, 0.7], [wand, 0.4], [wisp, 2]];
    for (const [def, wait] of plan) {
      const target = aliveDummies(state)[0];
      tryAttack(state, def, player, 1, aimAt(def, player, 1, rectOf(target)));
      run(state, wait);
    }
    return state;
  }

  it("the same seed and inputs give identical results", () => {
    expect(JSON.stringify(script(123))).toBe(JSON.stringify(script(123)));
  });

  it("a different seed changes the damage rolls", () => {
    const a = script(1);
    const b = script(2);
    expect(a.hitCount).toBe(b.hitCount);
    expect(a.totalDamage).not.toBe(b.totalDamage);
  });
});

describe("rig-aware hand positions (Terraria art)", () => {
  // Body box at (100, 200) with Terraria geometry: 40-wide cells, body origin (10, 12), scale 2.
  const rigPlayer: PlayerInfo = {
    x: 100, y: 200, w: 40, h: 84, facing: 1, scale: 3,
    rig: { scale: 2, cellW: 40, originX: 10, originY: 12, hands: { point: { x: 27.5, y: 35 }, raise: { x: 25.5, y: 20.5 } } },
  };

  it("places hands from measured cell coordinates relative to the body box", () => {
    expect(handPosition(rigPlayer, "point", 1)).toEqual({ x: 100 + (27.5 - 10) * 2, y: 200 + (35 - 12) * 2 });
  });

  it("mirrors about the cell centre when facing left", () => {
    // Mirrored x = 40 - 27.5 = 12.5 → 2.5 px right of the body box's left edge, at scale 2.
    expect(handPosition(rigPlayer, "point", -1)).toEqual({ x: 100 + (12.5 - 10) * 2, y: 246 });
    const right = handPosition(rigPlayer, "raise", 1).x - 120;
    const left = 120 - handPosition(rigPlayer, "raise", -1).x;
    expect(right).toBeCloseTo(left); // symmetric about the body centre (x = 120)
  });

  it("falls back to the built-in hand table without a rig", () => {
    const { rig: _rig, ...plain } = rigPlayer;
    expect(handPosition(plain, "point", 1)).toEqual({ x: 100 + 14.5 * 3, y: 200 + 10.5 * 3 });
  });
});

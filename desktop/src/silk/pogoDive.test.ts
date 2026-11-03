import { describe, expect, it } from "vitest";
import { createCombat, type CombatState, type Dummy } from "../combat/sim";
import { NEEDLE_DEF, THREAD_DEF, getWeapon } from "../combat/weapons";
import { DEFAULT_PHYSICS, makeBody, type Body, type Platform } from "../engine/physics";
import { SilkController, attackMode, heldAim, type SilkWeapon } from "./controller";
import { normalizeKeys, DEFAULT_SILK_KEYS } from "./keys";
import { POGO_VELOCITY, needleHitbox, pogoSurface, strikeKind } from "./needle";

const bounds = { width: 1600, height: 900 };
const dt = 1 / 60;
const hand = (b: Body, dir: 1 | -1) => ({ x: b.x + b.w / 2 + dir * 12, y: b.y + b.h * 0.45 });

function addTarget(state: CombatState, x: number, y: number, hp = 100000): Dummy {
  const d: Dummy = { id: state.nextId++, x, y, w: 48, h: 72, hp, maxHp: hp, defense: 0, flash: 0, wobble: 0, wobbleV: 0, respawn: 0 };
  state.dummies.push(d);
  return d;
}

/** Airborne body at (x, y), falling gently. */
const air = (x: number, y: number, facing: 1 | -1 = 1): Body => ({ ...makeBody(x, bounds, 40, 84), y, vy: 50, grounded: false, platformId: null, facing });

function run(c: SilkController, b: Body, n: number, opts: { combat?: CombatState; platforms?: Platform[]; weapon?: SilkWeapon; cursor?: { x: number; y: number } | null } = {}) {
  const combat = opts.combat ?? createCombat(1);
  const world = { bounds, platforms: opts.platforms ?? [], walls: [], cfg: DEFAULT_PHYSICS };
  const out = { b, frames: [] as string[], sfx: [] as string[], strikes: [] as { x: number; y: number; power: number }[], minVy: Infinity, maxVy: -Infinity, trace: [] as Body[] };
  for (let i = 0; i < n; i++) {
    const r = c.step(dt, out.b, world, combat, 2, 2, opts.cursor ?? null, hand, opts.weapon);
    out.b = r.body;
    out.frames.push(r.frame.frame);
    out.sfx.push(...r.sfx);
    out.strikes.push(...r.strikes);
    out.minVy = Math.min(out.minVy, r.body.vy);
    out.maxVy = Math.max(out.maxVy, r.body.vy);
    out.trace.push(r.body);
  }
  return out;
}

describe("diagonal pogo", () => {
  it("down + a direction + attack in the air is the diagonal strike", () => {
    expect(strikeKind({ up: false, down: true, grounded: false, sideways: true })).toBe("diag");
    expect(strikeKind({ up: false, down: true, grounded: false, sideways: false })).toBe("down");
    expect(strikeKind({ up: false, down: true, grounded: true, sideways: true })).toBe("side");
  });

  it("its hitbox sits below and in front of the character", () => {
    const b = air(600, 300, 1);
    const r = needleHitbox({ kind: "diag", dir: 1 }, b, 2);
    expect(r.x).toBeGreaterThanOrEqual(b.x + b.w / 2);
    expect(r.y + r.h).toBeGreaterThan(b.y + b.h);
    const l = needleHitbox({ kind: "diag", dir: -1 }, b, 2);
    expect(l.x + l.w).toBeLessThanOrEqual(b.x + b.w / 2 + 0.01);
  });

  it("bounces off an enemy it hits, once per strike, and plays the diagonal frame", () => {
    const combat = createCombat(1);
    const b = air(600, 300, 1);
    const target = addTarget(combat, b.x + b.w / 2 + 4, b.y + b.h + 6);
    const c = new SilkController();
    c.keyDown("KeyS");
    c.keyDown("KeyD");
    c.keyDown("KeyJ");
    const out = run(c, b, 14, { combat });
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(out.minVy).toBeLessThanOrEqual(-POGO_VELOCITY + 40);
    expect(out.frames).toContain("diag");
    // Only one bounce from this strike: velocity after the bounce only increases (gravity).
    const bounceAt = out.trace.findIndex((t) => t.vy < -POGO_VELOCITY + 40);
    for (let i = bounceAt + 1; i < out.trace.length; i++) expect(out.trace[i].vy).toBeGreaterThanOrEqual(out.trace[i - 1].vy - 1);
  });

  it("bounces off a surface below (window top / block) but not off the floor it stands on", () => {
    const platform: Platform = { id: 7, left: 500, right: 900, top: 420 };
    const b = air(600, 420 - 84 - 12, 1);
    const r = needleHitbox({ kind: "diag", dir: 1 }, b, 2);
    expect(pogoSurface(r, b, [platform])).toBe(420);
    expect(pogoSurface(r, { ...b, grounded: true }, [platform])).toBeNull();
    const c = new SilkController();
    c.keyDown("KeyS");
    c.keyDown("KeyD");
    c.keyDown("KeyJ");
    const out = run(c, b, 10, { platforms: [platform] });
    expect(out.minVy).toBeLessThan(-400);
    // Standing on the floor: no bounce at all.
    const g = new SilkController();
    g.keyDown("KeyS");
    g.keyDown("KeyD");
    g.keyDown("KeyJ");
    const ground = run(g, makeBody(600, bounds, 40, 84), 10);
    expect(ground.minVy).toBeGreaterThan(-100);
  });

  it("a Terraria sword makes the pogo strike with its own damage", () => {
    const combat = createCombat(1);
    const b = air(600, 300, 1);
    const target = addTarget(combat, b.x + b.w / 2 + 4, b.y + b.h + 6);
    const zenith = getWeapon("terra-blade")!;
    let used = 0;
    const c = new SilkController();
    c.keyDown("KeyS");
    c.keyDown("KeyD");
    c.keyDown("KeyJ");
    run(c, b, 14, { combat, weapon: { def: zenith, use: () => (used++, true) } });
    expect(used).toBe(0); // the pogo strike replaced the normal swing
    expect(target.maxHp - target.hp).toBeGreaterThanOrEqual(zenith.damage * 0.5);
  });
});

describe("dive attack", () => {
  it("plunges diagonally, then slams on landing", () => {
    const c = new SilkController();
    const b = air(400, 300, 1);
    c.keyDown("KeyO");
    const out = run(c, b, 90);
    const mid = out.trace[5];
    expect(mid.vx).toBeGreaterThan(400);
    expect(mid.vy).toBeGreaterThan(400);
    expect(out.frames).toContain("dive");
    expect(out.frames).toContain("slam");
    expect(out.b.grounded).toBe(true);
  });

  it("Dash while holding down in the air also dives (not a dash)", () => {
    const c = new SilkController();
    c.keyDown("KeyS");
    c.keyDown("KeyK");
    const out = run(c, air(400, 300, 1), 6);
    expect(out.frames).toContain("dive");
    expect(out.trace[3].vy).toBeGreaterThan(300);
  });

  it("only once per airtime and never on the ground", () => {
    const g = new SilkController();
    g.keyDown("KeyO");
    expect(run(g, makeBody(400, bounds, 40, 84), 6).frames).not.toContain("dive");
    const c = new SilkController();
    c.move = { ...c.move, airDashes: 0 };
    c.keyDown("KeyO");
    expect(run(c, air(400, 300), 6).frames).not.toContain("dive");
  });

  it("bounces off an enemy it hits and ends", () => {
    const combat = createCombat(1);
    const b = air(400, 200, 1);
    const target = addTarget(combat, 470, 300);
    const c = new SilkController();
    c.keyDown("KeyO");
    const out = run(c, b, 30, { combat });
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(out.minVy).toBeLessThan(-400);
  });

  it("the slam damages targets beside the landing spot", () => {
    const combat = createCombat(1);
    const b = air(400, bounds.height - 84 - 60, 1);
    const target = addTarget(combat, 520, bounds.height - 72);
    const c = new SilkController();
    c.keyDown("KeyO");
    run(c, b, 40, { combat });
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("stays inside the screen when diving into the edge", () => {
    const c = new SilkController();
    c.keyDown("KeyO");
    const out = run(c, air(bounds.width - 60, 300, 1), 90);
    for (const t of out.trace) expect(t.x + t.w).toBeLessThanOrEqual(bounds.width + 0.5);
    expect(out.b.grounded).toBe(true);
  });
});

describe("combined schemes: the equipped item drives the attack button", () => {
  it("classifies items", () => {
    expect(attackMode(undefined)).toBe("needle");
    expect(attackMode(NEEDLE_DEF)).toBe("needle");
    expect(attackMode(THREAD_DEF)).toBe("thread");
    expect(attackMode(getWeapon("terra-blade"))).toBe("melee");
    expect(attackMode(getWeapon("sdmg"))).toBe("ranged");
    expect(attackMode(getWeapon("zenith"))).toBe("ranged");
  });

  it("held directions aim Terraria weapons", () => {
    expect(heldAim(true, false, false, true, 1)).toBeCloseTo(-Math.PI / 2);
    expect(heldAim(false, true, true, false, 1)).toBeCloseTo(Math.PI / 4);
    expect(heldAim(false, true, true, false, -1)).toBeCloseTo((3 * Math.PI) / 4);
    expect(heldAim(false, false, false, true, 1)).toBeNull();
  });

  it("a gun fires through the sim toward the cursor when the mouse attacks", () => {
    const c = new SilkController();
    const calls: { dir: number; aim: number; point: unknown }[] = [];
    const weapon: SilkWeapon = { def: getWeapon("sdmg"), use: (dir, aim, point) => (calls.push({ dir, aim, point }), true) };
    const b = makeBody(600, bounds, 40, 84);
    c.mouse(true);
    run(c, b, 2, { weapon, cursor: { x: 200, y: b.y } });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].dir).toBe(-1);
    expect(Math.abs(calls[0].aim)).toBeGreaterThan(2.5);
  });

  it("the Thread equipped spins silk with the attack button", () => {
    const c = new SilkController();
    c.needle = { ...c.needle, silk: 6 };
    c.keyDown("KeyJ");
    const out = run(c, makeBody(600, bounds, 40, 84), 3, { weapon: { def: THREAD_DEF, use: () => true } });
    expect(c.needle.attack?.kind ?? "spin").toBe("spin");
    expect(out.sfx).toContain("swing");
    expect(c.needle.silk).toBe(3);
  });

  it("the dive key is bindable and persists through normalisation", () => {
    expect(DEFAULT_SILK_KEYS.dive).toBe("KeyO");
    expect(normalizeKeys({ ...DEFAULT_SILK_KEYS, dive: "KeyF" }).dive).toBe("KeyF");
  });
});

describe("dropping through one-way platforms in Silksong Controls", () => {
  it("Down + Jump drops through an invisible line or window top, but not a placed block", async () => {
    const { LINE_ID_BASE } = await import("../engine/lines");
    const line: Platform = { id: LINE_ID_BASE, left: 400, right: 900, top: 600 };
    const standing: Body = { ...makeBody(600, bounds, 40, 84), y: 600 - 84, vy: 0, grounded: true, platformId: LINE_ID_BASE };
    const c = new SilkController();
    c.keyDown("KeyS");
    c.keyDown("Space");
    const out = run(c, standing, 30, { platforms: [line] });
    expect(out.b.y + out.b.h).toBeGreaterThan(650);
    const block: Platform = { id: -5, left: 400, right: 900, top: 600 };
    const onBlock: Body = { ...standing, platformId: -5 };
    const b = new SilkController();
    b.keyDown("KeyS");
    b.keyDown("Space");
    const stay = run(b, onBlock, 2, { platforms: [block] });
    expect(stay.b.y + stay.b.h).toBeLessThanOrEqual(600.5); // jumped instead (or stayed), never fell through
  });
});

// Headless integration: the overlay's per-frame loop (AI → physics → combat) driven with
// each weapon archetype, using the same modules the app uses and no DOM.

import { describe, expect, it } from "vitest";
import { decide, initialAi, mulberry32, type AiState } from "../engine/behavior";
import { DEFAULT_PHYSICS as cfg, makeBody, step, type Body } from "../engine/physics";
import type { PlayerInfo } from "./geometry";
import {
  aimAt,
  aliveDummies,
  canAttack,
  createCombat,
  preferredRange,
  rectOf,
  setTraining,
  stepCombat,
  tryAttack,
} from "./sim";
import { MINION_CAPACITY, getWeapon } from "./weapons";

const bounds = { width: 1440, height: 800 };
const S = 3;
const dt = 1 / 60;

function train(weaponId: string, seconds: number, startX = 200) {
  const def = getWeapon(weaponId)!;
  const rng = mulberry32(5);
  const combat = createCombat(5);
  let body: Body = makeBody(startX, bounds, 16 * S, 24 * S);
  let ai: AiState = initialAi();
  let hitWall: -1 | 0 | 1 = 0;
  const player = (): PlayerInfo => ({ x: body.x, y: body.y, w: body.w, h: body.h, facing: body.facing, scale: S });
  setTraining(combat, true, bounds, body.x + body.w / 2, S);
  let attacks = 0;

  for (let t = 0; t < seconds; t += dt) {
    const cx = body.x + body.w / 2;
    const target = aliveDummies(combat).sort(
      (a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx),
    )[0];
    const summonFull = def.kind === "summon" && combat.minions.length >= MINION_CAPACITY;
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
        combat: target
          ? { targetX: target.x + target.w / 2, range: preferredRange(def, S), ready: canAttack(combat, def).ok && !summonFull }
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
      const res = tryAttack(combat, def, player(), d.attack, aimAt(def, player(), d.attack, rectOf(target)));
      if (res.ok) attacks++;
    }
    stepCombat(combat, dt, player(), bounds);
    expect(body.x).toBeGreaterThanOrEqual(0);
    expect(body.x + body.w).toBeLessThanOrEqual(bounds.width);
  }
  return { combat, attacks, body };
}

describe("training mode end-to-end", () => {
  for (const id of ["rustic-sword", "pine-bow", "pocket-pistol", "spark-wand", "wisp-lantern"]) {
    it(`the companion walks up to dummies and damages them with ${id}`, () => {
      const { combat, attacks } = train(id, 12);
      expect(attacks).toBeGreaterThan(0);
      expect(combat.hitCount).toBeGreaterThan(2);
      expect(combat.totalDamage).toBeGreaterThan(0);
    });
  }

  it("the summoner stops casting once the minion slots are full", () => {
    const { combat, attacks } = train("wisp-lantern", 12);
    expect(combat.minions).toHaveLength(MINION_CAPACITY);
    expect(attacks).toBe(MINION_CAPACITY);
  });
});

import { describe, expect, it } from "vitest";
import { getWeapon, isPickaxe } from "../combat/weapons";
import { DUST_DURATION, IMPACT_AT, IMPACT_LIFETIME, ImpactBursts, MAX_IMPACTS, PICKAXE_REACH, crossedImpact, impactTarget, strikeDust, swingGhosts } from "./pickaxe";

describe("pickaxe", () => {
  it("is a selectable tool, distinct from weapons", () => {
    const def = getWeapon("copper-pickaxe");
    expect(def?.name).toBe("Copper Pickaxe");
    expect(isPickaxe(def)).toBe(true);
    expect(isPickaxe(getWeapon("terra-blade"))).toBe(false);
    expect(def?.art?.texture).toBe("Images/Item_1");
  });

  it("connects once per swing, at the impact point", () => {
    expect(crossedImpact(IMPACT_AT - 0.05, IMPACT_AT + 0.01)).toBe(true);
    expect(crossedImpact(IMPACT_AT + 0.01, 1)).toBe(false);
    expect(crossedImpact(0.1, 0.3)).toBe(false);
  });

  it("targets the pointer only when it's within reach, else the pickaxe head", () => {
    const hand = { x: 500, y: 500 };
    const head = { x: 530, y: 470 };
    expect(impactTarget(hand, head, { x: 600, y: 450 })).toEqual({ point: { x: 600, y: 450 }, eligible: true });
    expect(impactTarget(hand, head, { x: 500 + PICKAXE_REACH + 1, y: 500 })).toEqual({ point: head, eligible: false });
    expect(impactTarget(hand, head, null).eligible).toBe(false);
    expect(impactTarget(hand, head, { x: NaN, y: 1 }).eligible).toBe(false);
  });

  it("impact bursts expire, are capped and can be stopped", () => {
    const b = new ImpactBursts();
    for (let i = 0; i < 20; i++) b.add({ point: { x: i, y: 0 }, eligible: i % 2 === 0 });
    expect(b.impacts).toHaveLength(MAX_IMPACTS);
    b.step(IMPACT_LIFETIME / 2);
    expect(b.impacts).toHaveLength(MAX_IMPACTS);
    b.step(IMPACT_LIFETIME);
    expect(b.impacts).toHaveLength(0);
    b.add({ point: { x: 0, y: 0 }, eligible: true });
    b.stop();
    expect(b.impacts).toHaveLength(0);
  });

});

describe("Picksaw (stronger pickaxe)", () => {
  it("uses the Terraria Picksaw art and the same Terraria-style swing", async () => {
    const { getWeapon: get, pickaxePower } = await import("../combat/weapons");
    const { swingAngle } = await import("../combat/melee");
    const { pickaxeAngle } = await import("../combat/pickaxeAnim");
    const saw = get("picksaw");
    const copper = get("copper-pickaxe");
    expect(saw?.name).toBe("Picksaw");
    expect(saw?.art?.texture).toBe("Images/Item_1294");
    expect(isPickaxe(saw)).toBe(true);
    expect(pickaxePower(saw)).toBe(2);
    expect(pickaxePower(copper)).toBe(1);
    expect(pickaxePower(get("terra-blade"))).toBe(1);
    if (saw?.kind !== "sword") throw new Error("not a swing item");
    for (const p of [0, 0.5, 1]) expect(swingAngle(saw, p)).toBeCloseTo(pickaxeAngle(p), 9);
  });

  it("is stronger: faster swings, more damage, longer reach and a bigger burst", async () => {
    const { getWeapon: get, pickaxeUseTime } = await import("../combat/weapons");
    const { reachFor } = await import("./pickaxe");
    const saw = get("picksaw")!;
    const copper = get("copper-pickaxe")!;
    expect(saw.damage).toBeGreaterThan(copper.damage);
    expect(pickaxeUseTime(0.45, 2)).toBeCloseTo(0.225, 9);
    expect(pickaxeUseTime(0.15, 3)).toBe(0.12); // floor
    expect(reachFor(2)).toBeGreaterThan(reachFor(1));
    expect(reachFor(1)).toBe(PICKAXE_REACH);
    const b = new ImpactBursts();
    b.add({ point: { x: 0, y: 0 }, eligible: true }, 2);
    expect(b.impacts[0].power).toBe(2);
  });

  it("is in the default hotbar and the dock", async () => {
    const { defaultInventory } = await import("../combat/inventory");
    const { DOCK_WEAPONS } = await import("../dock/model");
    expect(defaultInventory().slots[6]).toBe("picksaw");
    expect(DOCK_WEAPONS).toContain("picksaw");
  });
});

describe("strike dust and swing afterimages", () => {
  const impact = (over = {}) => ({ x: 400, y: 300, t: 0.2, eligible: true, power: 1, ...over });

  it("throws more dust for stronger pickaxes and for hits on the target", () => {
    expect(strikeDust(impact()).length).toBe(8);
    expect(strikeDust(impact({ power: 2 })).length).toBe(16);
    expect(strikeDust(impact({ eligible: false })).length).toBe(4);
  });

  it("dust flies up first, then falls, fades and is gone after its lifetime", () => {
    const early = strikeDust(impact({ t: 0.05 }));
    const late = strikeDust(impact({ t: 0.6 }));
    const avgY = (d: { y: number }[]) => d.reduce((a, b) => a + b.y, 0) / d.length;
    expect(avgY(early)).toBeLessThan(300); // knocked upward
    expect(avgY(late)).toBeGreaterThan(avgY(early)); // gravity wins
    expect(late[0].alpha).toBeLessThan(early[0].alpha);
    expect(strikeDust(impact({ t: DUST_DURATION }))).toEqual([]);
  });

  it("is deterministic per impact (no flicker between frames)", () => {
    expect(strikeDust(impact())).toEqual(strikeDust(impact()));
  });

  it("afterimages trail behind the swing and only while swinging", () => {
    const g = swingGhosts(0.5);
    expect(g.map((x) => x.progress)).toEqual([0.45, 0.4, 0.35]);
    expect(g[0].alpha).toBeGreaterThan(g[2].alpha);
    expect(swingGhosts(0.07).length).toBe(1); // none before the swing starts
    expect(swingGhosts(0)).toEqual([]);
    expect(swingGhosts(1)).toEqual([]);
  });
});

describe("manual vs automatic pickaxe swings", () => {
  it("manual swings strike the pointer at any distance; automatic ones need it in reach", async () => {
    const { strikeReach, impactTarget, reachFor } = await import("./pickaxe");
    const hand = { x: 100, y: 100 };
    const head = { x: 120, y: 90 };
    const far = { x: 1400, y: 700 };
    expect(impactTarget(hand, head, far, strikeReach(true, 1))).toEqual({ point: far, eligible: true });
    expect(impactTarget(hand, head, far, strikeReach(false, 1)).eligible).toBe(false);
    expect(strikeReach(false, 2)).toBe(reachFor(2));
    // No pointer known: always the pick head, never a strike.
    expect(impactTarget(hand, head, null, strikeReach(true, 1)).eligible).toBe(false);
  });
});

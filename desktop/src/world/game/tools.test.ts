import { describe, expect, it } from "vitest";
import { T, WorldMap } from "../gen";
import { addItem, emptySlots, type Slot, type Station } from "./inventory";
import { ObjectLayer } from "./objects";
import { bestTool, planTool, requirement, TILE_MIN_POWER } from "./tools";

const inv = (...items: [number, number][]): Slot[] => {
  const s = emptySlots(50);
  for (const [id, n] of items) addItem(s, id, n);
  return s;
};
const ctx = (slots: Slot[], stations: Station[] = [], unavailable: number[] = []) => ({ inv: slots, stations: new Set(stations), unavailable: new Set(unavailable) });

describe("what it takes to break things", () => {
  it("knows trees need an axe, blocks a pickaxe, and full chests aren't to be broken", () => {
    const map = new WorldMap(42);
    const objects = new ObjectLayer(map);
    let tx = 10;
    while (!map.tree(tx)) tx++;
    expect(requirement(map, objects, tx, map.surface(tx))).toEqual({ kind: "tool", tool: "axe", power: 0, chopCol: tx });
    let sy = map.surface(tx + 40) + 1;
    while (!map.solid(tx + 40, sy)) sy++;
    expect(requirement(map, objects, tx + 40, sy)).toMatchObject({ kind: "tool", tool: "pickaxe", power: 0 });
    expect(requirement(map, objects, tx, 5)).toEqual({ kind: "none" });
    let cx = tx + 3;
    while (map.tree(cx) || map.tree(cx + 1) || !objects.canPlace("chest", cx, map.surface(cx) - 2)) cx++;
    const chest = objects.place("chest", cx, map.surface(cx) - 2)!;
    expect(requirement(map, objects, cx, chest.y)).toMatchObject({ kind: "tool", tool: "pickaxe" }); // empty: fine
    chest.items![0] = { id: 9, count: 5 };
    expect(requirement(map, objects, cx, chest.y)).toEqual({ kind: "blocked", reason: "chest" });
  });

  it("picks the strongest tool that's strong enough", () => {
    const slots = inv([3509, 1], [1, 1], [3506, 1]);
    expect(bestTool(slots, "pickaxe")?.id).toBe(1); // iron beats copper
    expect(bestTool(slots, "pickaxe", 50)).toBeNull();
    // A tougher block (Terraria's meteorite-style power requirement) needs a stronger pickaxe.
    const map = new WorldMap(42);
    const x = 2100;
    let y = map.surface(x) + 10;
    while (map.tile(x, y) !== T.Stone) y++;
    TILE_MIN_POWER[T.Stone] = 38;
    try {
      const req = requirement(map, new ObjectLayer(map), x, y);
      expect(req).toEqual({ kind: "tool", tool: "pickaxe", power: 38 });
      expect(bestTool(inv([3509, 1]), "pickaxe", 38)).toBeNull(); // copper (35) can't
      expect(bestTool(slots, "pickaxe", 38)?.id).toBe(1); // iron (40) can
      expect(planTool("pickaxe", 38, ctx(inv([3509, 1], [3506, 1], [22, 12], [9, 3]), ["anvil"]))).toMatchObject({ item: 1, step: { do: "craft", id: 1 } });
    } finally {
      delete TILE_MIN_POWER[T.Stone];
    }
  });
});

describe("planning a missing tool", () => {
  it("needs nothing when the tool is already there", () => {
    expect(planTool("pickaxe", 0, ctx(inv([3509, 1])))).toMatchObject({ step: null, item: 3509 });
  });

  it("walks the whole chain for a lost pickaxe: cactus, then wood for a work bench, place it, craft", () => {
    // Without a pickaxe, ore can't be mined, so only the Cactus Pickaxe can be made.
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1])))).toMatchObject({ item: 882, step: { do: "gather", id: 276 } });
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1], [276, 15])))).toMatchObject({ step: { do: "gather", id: 9 } });
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1], [276, 15], [9, 10])))).toMatchObject({ step: { do: "craft", id: 36 } });
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1], [276, 15], [36, 1])))).toMatchObject({ step: { do: "place", station: "workbench" } });
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1], [276, 15]), ["workbench"]))).toMatchObject({ step: { do: "craft", id: 882 } });
  });

  it("prefers a metal pickaxe when the bars and anvil are already there", () => {
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1], [20, 12], [9, 3]), ["anvil", "workbench"]))).toMatchObject({ item: 3509, step: { do: "craft", id: 3509 } });
  });

  it("gives up on chains that loop or need what can't be gathered", () => {
    // No axe and no wood: an axe needs wood, and wood needs an axe.
    expect(planTool("axe", 0, ctx(inv([3509, 1])))).toBeNull();
    // No cactus around and no pickaxe: nothing to make one from.
    expect(planTool("pickaxe", 0, ctx(inv([3506, 1]), [], [276]))).toBeNull();
    // With some wood, a copper axe works out (ore → bars at a furnace → anvil).
    expect(planTool("axe", 0, ctx(inv([3509, 1], [9, 3], [20, 9]), ["anvil"]))).toMatchObject({ item: 3506, step: { do: "craft", id: 3506 } });
    // Nothing beats a requirement no tool meets.
    expect(planTool("pickaxe", 999, ctx(inv([3509, 1])))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { OBJECTS, THEMES } from "./furniture";
import { ITEMS } from "./items";
import { RECIPES } from "./recipes";
import { taskItem } from "./builder";

describe("themed furniture", () => {
  it("every piece any theme uses has an item, and a recipe unless it's a real Terraria item", () => {
    const missing: string[] = [];
    for (const [id, th] of Object.entries(THEMES))
      for (const [p, style] of Object.entries(th.styles) as [keyof typeof OBJECTS, number][]) {
        const item = OBJECTS[p].drop(style);
        if (item === null) continue;
        if (!ITEMS[item]) missing.push(`${id} ${p} style ${style}: no item`);
        else if (item >= 100000 && !RECIPES.some((r) => r.result === item)) missing.push(`${id} ${p} style ${style}: no recipe`);
      }
    expect(missing).toEqual([]);
  });

  it("a plain piece with no Terraria item of its own (the sink) can still be made and placed", () => {
    const id = taskItem({ kind: "object", x: 0, y: 0, obj: "sink" });
    expect(id).not.toBeNull();
    expect(ITEMS[id!]).toBeTruthy();
    expect(RECIPES.some((r) => r.result === id)).toBe(true);
  });
});

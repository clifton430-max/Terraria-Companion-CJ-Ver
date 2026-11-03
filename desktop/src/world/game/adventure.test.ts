import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/behavior";
import { WorldMap } from "../gen";
import { Adventure, BAG_SLOTS } from "./adventure";
import { projectProgress } from "./builder";
import { Game, noInput } from "./game";
import { addItem, countOf, INVENTORY_SIZE } from "./inventory";
import { ObjectLayer } from "./objects";

function world(seed = 42) {
  const map = new WorldMap(seed);
  const objects = new ObjectLayer(map);
  objects.furnish();
  const g = new Game(map, objects, mulberry32(seed));
  addItem(g.inventory, 23, 10);
  return g;
}

function run(adv: Adventure, minutes: number) {
  const dt = 1 / 30;
  for (let t = 0; t < minutes * 60; t += dt) {
    adv.game.update(dt, noInput(), { w: 120, h: 70 });
    adv.step(dt);
  }
}

describe("the waifus' adventure", () => {
  it("builds a home and a town, takes in NPCs and explores within the first hour", () => {
    const g = world();
    const adv = new Adventure(g, ["princess", "nurse", "zoologist", "partygirl"]);
    run(adv, 60);
    const starter = adv.crew.projects.get("starter")!;
    expect(projectProgress(g, starter)).toBe(1);
    // At least one town house finished and someone besides the Guide living in town.
    const towns = [...adv.crew.projects.values()].filter((p) => p.kind === "npcHouse");
    expect(towns.some((p) => projectProgress(g, p) === 1)).toBe(true);
    expect(adv.residents.size).toBeGreaterThanOrEqual(2);
    // Crafted up the gear ladder (an iron pickaxe or better) and found places for the gallery.
    expect(countOf(g.inventory, 1) + countOf(g.inventory, 3521) + countOf(g.inventory, 103)).toBeGreaterThan(0);
    expect(adv.locations.filter((l) => l.discovered).length).toBeGreaterThanOrEqual(8);
    expect(adv.crew.agents.every((a) => a.dead <= 0 || a.maxLife >= 100)).toBe(true);
  }, 120_000);

  it("saves and restores, with the team's extra bags kept apart from the shared inventory", () => {
    const g = world(7);
    const adv = new Adventure(g, ["princess", "nurse"]);
    expect(g.inventory.length).toBe(INVENTORY_SIZE + BAG_SLOTS);
    run(adv, 6);
    addItem(g.inventory, 3, 999 * 60); // more than the shared inventory holds
    const inBags = g.inventory.slice(INVENTORY_SIZE).filter(Boolean).length;
    expect(inBags).toBeGreaterThan(0);
    adv.detach();
    expect(g.inventory.length).toBe(INVENTORY_SIZE);
    const saved = JSON.parse(JSON.stringify(g.save()));
    const g2 = new Game(g.map, g.objects, mulberry32(1));
    g2.load(JSON.stringify(saved));
    const adv2 = new Adventure(g2, ["princess", "nurse"]);
    expect(g2.inventory.slice(INVENTORY_SIZE).filter(Boolean).length).toBe(inBags);
    expect([...adv2.crew.projects.keys()]).toContain("starter");
    // Everything found before is still found (and nothing is lost on the way).
    const before = adv.locations.filter((l) => l.discovered).map((l) => l.id);
    const after = new Set(adv2.locations.filter((l) => l.discovered).map((l) => l.id));
    expect(before.every((id) => after.has(id))).toBe(true);
  }, 60_000);
});

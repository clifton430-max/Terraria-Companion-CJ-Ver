// The waifus building whole estates, biome by biome, on a fresh world (materials handed over as
// each piece goes in, so this tests the building itself: every block reachable and attachable,
// every floor climbable, nothing in the way). Slow (minutes per biome), so it only runs when
// asked: ESTATE_SIM=forest,snow npx vitest run src/world/game/estate.sim.test.ts

import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/behavior";
import { WorldMap } from "../gen";
import { Crew, makeAgent, taskDone, taskItem, type Task } from "./builder";
import { estateSite, luxuryHouse } from "./estate";
import { Game, noInput } from "./game";
import { addItem, countOf } from "./inventory";
import { ITEMS } from "./items";
import { ObjectLayer } from "./objects";
import { TILE } from "./physics";

// @ts-expect-error node
const wanted: string = globalThis.process?.env?.ESTATE_SIM ?? "";
const biomes = wanted.split(",").filter(Boolean);

describe("building the estates", () => {
  if (!biomes.length) it.skip("finishes each biome's estate (set ESTATE_SIM to run)", () => {});
  for (const biome of biomes)
    it(`finishes the ${biome} estate`, () => {
      const seed = 42;
      const map = new WorldMap(seed);
      const g = new Game(map, new ObjectLayer(map), mulberry32(seed));
      g.mode = "auto";
      g.peaceful = true;
      let near = 2300;
      if (biome !== "forest") for (let x = 0; x < map.size.width; x++) if (map.biome(x) === biome) { near = x + 60; break; }
      const site = estateSite(map, biome, near);
      const p = luxuryHouse(map, biome, site.x0, site.g, seed, site.span);
      const agents = (["goblin", "princess", "partygirl", "nurse"] as const).map((id, i) => makeAgent(id, (p.door.x + i) * TILE, (site.g - 3) * TILE));
      g.agents = agents;
      for (const a of agents) a.home = { x: p.door.x * TILE, y: site.g * TILE };
      const crew = new Crew(g, agents) as unknown as Crew & { haveFor(t: Task): boolean; act(a: unknown, p: unknown, t: Task): void; goals: unknown[] };
      crew.addProject(p);
      crew.goals = [{ id: "estate", kind: "build", project: p.id, crew: 99 }];
      crew.haveFor = () => true;
      const act = crew.act.bind(crew);
      crew.act = (a, pr, t) => {
        const id = taskItem(t);
        if (id && countOf(g.inventory, id) === 0) addItem(g.inventory, id, 1);
        act(a, pr, t);
      };
      const dt = 1 / 30;
      for (let t = 0; t < 150 * 60 && !crew.isDone(p); t += dt) {
        g.update(dt, noInput(), { w: 120, h: 70 });
        crew.step(dt);
        // (Materials gathered meanwhile pile up: keep the bag to tools, as a player would.)
        if (Math.abs(t % 30) < dt) g.inventory.forEach((sl, i) => {
          const k = sl && ITEMS[sl.id]?.kind;
          if (sl && k !== "pickaxe" && k !== "axe" && k !== "hammer" && k !== "sword" && k !== "bow") g.inventory[i] = null;
        });
      }
      const open = p.tasks.filter((t) => !taskDone(g, p, t));
      expect(open.slice(0, 10)).toEqual([]);
    }, 3_600_000);
});

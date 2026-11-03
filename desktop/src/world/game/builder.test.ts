import { describe, expect, it } from "vitest";
import type { CharacterId } from "../../bridge";
import { mulberry32 } from "../../engine/behavior";
import { T, W, WorldMap } from "../gen";
import { Game, noInput } from "./game";
import { addItem, countOf, removeItem } from "./inventory";
import { NPCS } from "./npcs";
import { ObjectLayer } from "./objects";
import { TILE } from "./physics";
import { blueprint, Builders, chooseSite, HOUSE_W, makeAgent, taskDone } from "./builder";

function setup(seed: number, ids: CharacterId[], lose: number[] = []) {
  const map = new WorldMap(seed);
  const g = new Game(map, new ObjectLayer(map), mulberry32(seed));
  g.mode = "auto";
  g.peaceful = true;
  addItem(g.inventory, 23, 10);
  for (const id of lose) removeItem(g.inventory, id, 1);
  const sp = g.spawnPoint();
  const agents = ids.map((id, i) => makeAgent(id, sp.x + i * 24, sp.y));
  g.agents = agents;
  const plan = chooseSite(map, Math.floor(sp.x / TILE));
  return { g, map, plan, b: new Builders(g, plan, agents) };
}

/** Run until the house is done (or time runs out); returns sim seconds and what was said. */
function run(g: Game, b: Builders, minutes: number) {
  const said = new Set<string>();
  let t = 0;
  for (; t < minutes * 60 && !b.done; t += 1 / 30) {
    g.update(1 / 30, noInput(), { w: 90, h: 56 });
    b.step(1 / 30);
    for (const a of b.agents) if (a.say) said.add(a.say.text);
  }
  return { t, said: [...said] };
}

function simulate(seed: number, ids: CharacterId[], minutes = 12) {
  const map = new WorldMap(seed);
  const g = new Game(map, new ObjectLayer(map), mulberry32(seed));
  g.mode = "auto";
  g.peaceful = true;
  addItem(g.inventory, 23, 10);
  const sp = g.spawnPoint();
  const agents = ids.map((id, i) => makeAgent(id, sp.x + i * 24, sp.y));
  g.agents = agents;
  const plan = chooseSite(map, Math.floor(sp.x / TILE));
  const b = new Builders(g, plan, agents);
  const dt = 1 / 30;
  let t = 0;
  for (; t < minutes * 60 && !b.done; t += dt) {
    g.update(dt, noInput(), { w: 90, h: 56 });
    b.step(dt);
  }
  return { g, b, plan, map, t };
}

describe("waifus building a house", () => {
  for (const [seed, ids] of [
    [42, ["princess", "nurse"]],
    [7, ["goblin"]],
    [1234, ["partygirl", "zoologist", "terrarian", "princess"]],
    [99, ["nurse", "goblin"]],
  ] as [number, CharacterId[]][]) {
    it(`seed ${seed} with ${ids.length} companion(s): gathers, builds and furnishes the house`, () => {
      const { g, b, plan, map, t } = simulate(seed, ids);
      expect(b.done, `progress ${Math.round(b.progress * 100)}% after ${Math.round(t)}s`).toBe(true);
      const { x0, g: floor } = plan;
      const x1 = x0 + HOUSE_W - 1;
      // Floor, walls with a doorway, ceiling, loft and roof.
      for (let x = x0; x <= x1; x++) expect(map.tile(x, floor)).toBe(T.Wood);
      for (let y = floor - 6; y <= floor - 4; y++) expect(map.tile(x1, y)).toBe(T.Wood);
      for (let y = floor - 3; y <= floor - 1; y++) expect(map.solid(x0, y) || map.solid(x1, y)).toBe(false); // the doorways
      expect(map.wall(x0 + 5, floor - 2)).toBe(W.Wood); // wood walls behind
      for (let x = x0; x <= x1; x++) expect(map.tile(x, floor - 7)).toBe(T.Wood);
      expect(map.tile(x0 + 6, floor - 3)).toBe(T.Platform);
      expect(map.tile(x0 + 7, floor - 11)).toBe(T.Stone);
      // Furnished and lit.
      // The house's own furniture (a spare station may stand outside, crafted before the house had one).
      const kinds = g.objects.placed.filter((o) => o.x >= x0 && o.x <= x1 && o.y >= floor - 8 && o.y < floor).map((o) => o.t).sort();
      expect(kinds).toEqual(["furnace", "torch", "torch", "torch", "workbench"]);
      // Everyone ends up resting at home.
      b.step(1);
      for (const a of b.agents) expect(a.job?.kind).toBe("rest");
    }, 120_000);
  }

  it("resumes a half-built house from the world (no separate progress to lose)", () => {
    const first = simulate(42, ["princess"], 1.5);
    expect(first.b.done).toBe(false);
    const again = new Builders(first.g, first.plan, first.b.agents);
    const doneBefore = again.tasks.filter((t) => taskDone(first.g, again.project, t)).length;
    expect(doneBefore).toBeGreaterThan(0);
    expect(blueprint(first.map, first.plan).length).toBe(again.tasks.length);
  });

  it("is peaceful: no monsters spawn while they build", () => {
    const { g } = simulate(7, ["goblin"], 3);
    expect(g.npcs.filter((n) => !NPCS[n.kind].critter)).toHaveLength(0); // critters may wander by

  });
});

describe("when a tool is missing", () => {
  it("lost pickaxe: they work out a Cactus Pickaxe, gather for it, craft it and finish the house", () => {
    const { g, b } = setup(42, ["princess", "nurse"], [3509]);
    const { t, said } = run(g, b, 15);
    expect(b.done, `progress ${Math.round(b.progress * 100)}% after ${Math.round(t)}s`).toBe(true);
    expect(b.stats.crafted).toEqual(expect.arrayContaining([36, 882])); // work bench, then the pickaxe
    expect(countOf(g.inventory, 882)).toBe(1);
    expect(said.some((s) => s.includes("Cactus Pickaxe"))).toBe(true);
    expect(b.stats.asked).toBe(0);
  }, 120_000);

  it("a tool nobody can make: she asks Master (less and less often) and waits instead of swinging, then resumes", () => {
    // No axe and no wood: an axe can't be crafted (it needs wood, which needs an axe).
    const { g, b } = setup(99, ["nurse", "goblin"], [3506]);
    const chops: number[] = [];
    const chop = g.chop.bind(g);
    g.chop = (x, y, p) => (chops.push(x), chop(x, y, p));
    const first = run(g, b, 10);
    expect(b.done).toBe(false);
    expect(chops.length).toBe(0); // never swung an axe it doesn't have
    expect(b.stats.asked).toBeGreaterThan(0);
    expect(b.stats.asked).toBeLessThanOrEqual(8); // ten minutes: 45 s, 90 s, 3 min, then every 5 min (per tool)
    expect(first.said.some((s) => /could you put one in the inventory/i.test(s))).toBe(true);
    // You hand over an axe: they pick it up from there and finish.
    addItem(g.inventory, 3506, 1);
    const second = run(g, b, 15);
    expect(b.done, `progress ${Math.round(b.progress * 100)}% after ${Math.round(second.t)}s more`).toBe(true);
  }, 120_000);

  it("never swings forever at something that won't break: it's set aside and they work around it", () => {
    const { g, b } = setup(7, ["goblin"]);
    // A world where digging silently fails (as if every block were too tough).
    g.dig = () => false;
    run(g, b, 4);
    expect(b.stats.setAside).toBeGreaterThan(0);
    // Each target gets a bounded number of swings, then waits a minute before anyone tries again.
    expect(b.stats.swings).toBeLessThan((b.stats.setAside + 2) * 12);
  }, 120_000);
});

describe("the build order", () => {
  it("goes back to a block that was knocked out after it had been built", () => {
    const map = new WorldMap(42);
    const g = new Game(map, new ObjectLayer(map), mulberry32(42));
    const x = 2100;
    const y = map.surface(x) - 5;
    const tasks = [0, 1, 2].map((i) => ({ kind: "tile" as const, x: x + i, y, tile: T.GrayBrick }));
    const p = { id: "p", kind: "luxury" as const, name: "P", biome: "forest" as const, x0: x, y0: y, x1: x + 2, y1: y, tasks, planned: new Map(tasks.map((t) => [t.y * 65536 + t.x, t.tile])), floors: [], rooms: [], door: { x, y }, params: { kind: "starter" as const, x0: x, g: y } };
    const crew = new Builders(g, chooseSite(map, x), []) as unknown as { addProject(p: unknown): void; openTask(p: unknown, ok: ((t: unknown) => boolean) | null): unknown; deferred: Map<unknown, number>; clock: number };
    crew.addProject(p);
    map.set(x, y, T.GrayBrick);
    map.set(x + 1, y, T.GrayBrick);
    // The first two are built (the scan moves past them); the last is put off for now.
    crew.deferred.set(tasks[2], crew.clock + 100);
    expect(crew.openTask(p, (t) => (crew.deferred.get(t) ?? -1) <= crew.clock)).toBe(null);
    // The first is knocked out again: it's found.
    map.set(x, y, T.Air);
    expect(crew.openTask(p, (t) => (crew.deferred.get(t) ?? -1) <= crew.clock)).toBe(tasks[0]);
  });
});

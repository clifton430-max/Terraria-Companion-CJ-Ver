import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/behavior";
import { T, WorldMap } from "../gen";
import { Crew, makeAgent } from "./builder";
import { Game, noInput } from "./game";
import { addItem } from "./inventory";
import { ObjectLayer } from "./objects";
import { TILE } from "./physics";

/** A flat stretch of the forest with a wall of dungeon brick across it (too hard to dig). */
function setup() {
  const map = new WorldMap(42);
  const g = new Game(map, new ObjectLayer(map), mulberry32(42));
  g.mode = "auto";
  g.peaceful = true;
  let x0 = 2300;
  for (let x = 2200; x < 2600; x++) {
    let flat = true;
    for (let d = -20; d <= 20; d++) if (map.surface(x + d) !== map.surface(x) || map.tree(x + d)) flat = false;
    if (flat) {
      x0 = x;
      break;
    }
  }
  const ground = map.surface(x0);
  for (let y = ground - 12; y < ground; y++) for (let x = x0; x < x0 + 3; x++) map.set(x, y, T.BlueBrick);
  const a = makeAgent("goblin", (x0 - 12) * TILE, (ground - 3) * TILE);
  g.agents = [a];
  a.home = { x: (x0 - 12) * TILE, y: ground * TILE };
  addItem(g.inventory, 2, 60);
  const crew = new Crew(g, [a]);
  return { g, map, a, crew, x0, ground };
}

function run(g: Game, crew: Crew, seconds: number, until: () => boolean = () => false) {
  for (let t = 0; t < seconds && !until(); t += 1 / 30) {
    g.update(1 / 30, noInput(), { w: 120, h: 70 });
    crew.step(1 / 30);
  }
}

describe("climbing over what can't be dug", () => {
  it("stacks blocks to get over a wall of dungeon brick, and takes them down after the trip", () => {
    const { g, map, a, crew, x0 } = setup();
    let arrived = false;
    crew.goals = [
      { id: "trip", kind: "go", x: x0 + 15, why: "exploring", crew: 1, arrive: () => (arrived = true) },
      { id: "rest", kind: "rest", crew: 1 },
    ];
    run(g, crew, 120, () => arrived);
    expect(arrived).toBe(true);
    expect(crew.scaffold.size).toBeGreaterThan(5);
    // The trip's over: nothing to do but rest, and tidying up comes first.
    crew.goals = [{ id: "rest", kind: "rest", crew: 1 }];
    run(g, crew, 240, () => crew.scaffold.size === 0);
    expect(crew.scaffold.size).toBe(0);
    for (let y = map.surface(x0) - 20; y < map.surface(x0); y++) for (const x of [x0 - 1, x0 + 3]) expect(map.tile(x, y), `${x},${y}`).not.toBe(T.Dirt);
    void a;
  });

  it("goes there and back over the wall, and leaves nothing behind", () => {
    const { g, map, crew, x0 } = setup();
    let there = false;
    let back = false;
    crew.goals = [{ id: "there", kind: "go", x: x0 + 15, why: "exploring", crew: 1, arrive: () => (there = true) }];
    run(g, crew, 120, () => there);
    crew.goals = [{ id: "back", kind: "go", x: x0 - 15, why: "heading home", crew: 1, arrive: () => (back = true) }];
    run(g, crew, 120, () => back);
    expect(there && back).toBe(true);
    crew.goals = [{ id: "rest", kind: "rest", crew: 1 }];
    run(g, crew, 300, () => crew.scaffold.size === 0);
    expect(crew.scaffold.size).toBe(0);
    for (let y = map.surface(x0) - 20; y < map.surface(x0); y++) for (let x = x0 - 6; x <= x0 + 8; x++) expect(map.tile(x, y), `${x},${y}`).not.toBe(T.Dirt);
  });

  it("doesn't climb over a wall it can dig through (it tunnels, as before)", () => {
    const { g, map, crew, x0, ground } = setup();
    for (let y = ground - 12; y < ground; y++) for (let x = x0; x < x0 + 3; x++) map.set(x, y, T.Dirt);
    let arrived = false;
    crew.goals = [{ id: "trip", kind: "go", x: x0 + 15, why: "exploring", crew: 1, arrive: () => (arrived = true) }];
    run(g, crew, 120, () => arrived);
    expect(arrived).toBe(true);
    expect(crew.scaffold.size).toBe(0);
  });
});

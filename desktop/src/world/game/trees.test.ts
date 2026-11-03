import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/behavior";
import { T, WorldMap } from "../gen";
import { Game, noInput } from "./game";
import { countOf } from "./inventory";
import { ObjectLayer } from "./objects";
import { TILE } from "./physics";
import { Builders, chooseSite, makeAgent, type Agent, type Job } from "./builder";

// The crew's protected internals, for driving one job at a time.
type Internals = {
  doWood(a: Agent, job: Extract<Job, { kind: "wood" }>): unknown;
  markTree(a: Agent, x: number, why: string): void;
  gatherJob(a: Agent, id: number, count: number, src: { from: "tree"; kinds: string[]; cost: number }): Job | null;
  keepIntact(a: Agent, x: number, y: number): boolean;
};

function setup(seed = 42) {
  const map = new WorldMap(seed);
  const g = new Game(map, new ObjectLayer(map), mulberry32(seed));
  g.mode = "auto";
  g.peaceful = true;
  const sp = g.spawnPoint();
  const a = makeAgent("terrarian", sp.x, sp.y);
  g.agents = [a];
  const b = new Builders(g, chooseSite(map, Math.floor(sp.x / TILE)), [a]);
  return { g, map, a, b, crew: b as unknown as Internals };
}

/** The nearest forest tree to a column, at least `min` columns away. */
function treeNear(map: WorldMap, x0: number, min = 0): number {
  for (let d = min; d < 400; d++) for (const x of [x0 + d, x0 - d]) if (map.tree(x) && map.treeKind(x) === "forest") return x;
  throw new Error("no tree");
}

function step(g: Game, b: Builders, seconds: number, until: () => boolean = () => false) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    g.update(1 / 30, noInput(), { w: 90, h: 56 });
    b.step(1 / 30);
    if (until()) return t;
  }
  return Infinity;
}

const WOOD = { from: "tree" as const, kinds: ["forest"], cost: 1 };

describe("gathering wood", () => {
  it("climbs down from a ledge beside a tree to chop its trunk, instead of waiting up there", () => {
    const { g, map, a, b } = setup();
    const x = treeNear(map, Math.floor((a.x + a.w / 2) / TILE), 12);
    const ground = map.surface(x);
    // A tall pillar right beside the trunk, with her standing on top of it.
    for (const px of [x + 1, x + 2]) for (let y = ground - 12; y < ground; y++) map.set(px, y, T.Stone);
    a.x = (x + 1) * TILE + TILE - a.w / 2;
    a.y = (ground - 12) * TILE - a.h - 1;
    a.job = { kind: "wood", tree: x };
    const t = step(g, b, 30, () => map.cut.has(x));
    expect(t, "felled the tree").toBeLessThan(9); // before the 10 s idle catch-all would send her home
  });

  it("never goes for a tree with no room to stand at its base, and picks another one", () => {
    const { map, a, crew } = setup();
    const x = treeNear(map, Math.floor((a.x + a.w / 2) / TILE), 4);
    const ground = map.surface(x);
    // Walled in on both sides, right up against the trunk.
    for (const px of [x - 3, x - 2, x - 1, x + 1, x + 2, x + 3]) for (let y = ground - 9; y < ground; y++) map.set(px, y, T.Stone);
    const job = crew.gatherJob(a, 9, 10, WOOD);
    expect(job?.kind).toBe("wood");
    expect(job?.kind === "wood" && job.tree).not.toBe(x);
  });

  it("gives up on a tree she can't get any closer to, and the whole team leaves it alone", () => {
    const { g, map, a, b, crew } = setup();
    const x = treeNear(map, Math.floor((a.x + a.w / 2) / TILE), 20);
    const job: Extract<Job, { kind: "wood" }> = { kind: "wood", tree: x };
    a.job = job;
    // 16 s of walking without getting a tile closer.
    for (let t = 0; t < 16 && a.job; t += 0.5) {
      crew.doWood(a, job);
      b.clock += 0.5;
    }
    expect(a.job).toBeNull();
    expect(b.treeMarked(x)).toBe(true);
    // The next search skips it.
    const next = crew.gatherJob(a, 9, 10, WOOD);
    expect(next?.kind === "wood" && next.tree).not.toBe(x);
    void g;
    void map;
  });

  it("leaves a failed tree alone for longer each time: 1 min, 5 min, then until dawn", () => {
    const { g, a, b, crew } = setup();
    const x = 1234;
    crew.markTree(a, x, "");
    expect(b.treeMarked(x)).toBe(true);
    b.clock += 61;
    expect(b.treeMarked(x)).toBe(false);
    crew.markTree(a, x, "");
    b.clock += 299;
    expect(b.treeMarked(x)).toBe(true);
    b.clock += 2;
    expect(b.treeMarked(x)).toBe(false);
    crew.markTree(a, x, "");
    b.clock += 100_000;
    expect(b.treeMarked(x), "still marked the same day").toBe(true);
    g.day++;
    expect(b.treeMarked(x), "dawn").toBe(false);
  });

  it("keeps the marks across a save", () => {
    const { a, b, crew } = setup();
    crew.markTree(a, 100, "");
    crew.markTree(a, 200, "");
    crew.markTree(a, 200, "");
    crew.markTree(a, 200, "");
    const saved = JSON.parse(JSON.stringify(b.saveTreeMarks()));
    const other = setup().b;
    other.loadTreeMarks(saved);
    expect(other.treeMarked(100)).toBe(true);
    expect(other.treeMarked(200)).toBe(true);
    other.clock += 61;
    expect(other.treeMarked(100)).toBe(false);
    expect(other.treeMarked(200), "until dawn").toBe(true);
    other.loadTreeMarks([["x", 1, 5], [5, -1, 5], null, "junk"]);
    expect(other.treeMarks.size).toBe(2);
  });

  it("with no good tree nearby: takes wood from the team's chest first, then heads further out", () => {
    const { g, map, a, b, crew } = setup();
    const ax = Math.floor((a.x + a.w / 2) / TILE);
    const first = treeNear(map, ax);
    // Every tree within the margin of the nearest one has failed (three times: left alone until dawn).
    for (let x = ax - 260 - Math.abs(first - ax); x <= ax + 260 + Math.abs(first - ax); x++) if (map.tree(x)) for (let k = 0; k < 3; k++) crew.markTree(a, x, "");
    // A chest of wood in the starter house's footprint.
    const p = [...b.projects.values()][0];
    const cx = p.x0 + 2;
    const cy = map.surface(cx) - 2;
    expect(cy >= p.y0 && cy <= p.y1).toBe(true);
    const chest = g.objects.place("chest", cx, cy)!;
    expect(chest).toBeTruthy();
    chest.items![0] = { id: 9, count: 30 };
    const fetch = crew.gatherJob(a, 9, 20, WOOD);
    expect(fetch).toMatchObject({ kind: "fetch", x: cx, y: cy, item: 9 });
    a.job = fetch;
    const before = countOf(g.inventory, 9);
    step(g, b, 60, () => (chest.items![0]?.count ?? 0) < 30);
    const took = 30 - (chest.items![0]?.count ?? 0);
    expect(took).toBe(20 - before);
    expect(a.job?.kind).not.toBe("fetch");
    // Chest empty: a tree further out (asked from where she started).
    chest.items![0] = null;
    a.x = ax * TILE - a.w / 2;
    const far = crew.gatherJob(a, 9, 20, WOOD);
    expect(far).toMatchObject({ kind: "wood", far: true });
  });

  it("never takes from a chest that isn't the team's or an opened world chest (Master's)", () => {
    const { g, map, a, b, crew } = setup();
    const ax = Math.floor((a.x + a.w / 2) / TILE);
    for (let x = ax - 1300; x <= ax + 1300; x++) if (map.tree(x)) crew.markTree(a, x, "");
    const items = Array.from({ length: 40 }, () => null) as ({ id: number; count: number } | null)[];
    items[0] = { id: 9, count: 30 };
    const mine = g.objects.place("chest", ax + 30, map.surface(ax + 30) - 2)!;
    expect(mine).toBeTruthy();
    mine.items = items;
    expect(crew.gatherJob(a, 9, 20, WOOD)).toBeNull();
    void b;
  });

  it("won't dig through a world structure on the way to a tree", () => {
    const { map, a, crew } = setup();
    const s = map.structures.find((st) => st.kind === "cabin")!;
    const x = s.x0 + 1;
    const y = s.y0 + 1;
    a.job = { kind: "wood", tree: 5 };
    expect(crew.keepIntact(a, x, y)).toBe(true);
    a.job = { kind: "rest" };
    expect(crew.keepIntact(a, x, y)).toBe(false);
  });
});

describe("building around trees", () => {
  it("chops a tree from wherever its trunk is nearest (a house floor above its roots)", () => {
    const { map, a, b } = setup();
    const x = treeNear(map, Math.floor((a.x + a.w / 2) / TILE), 4);
    const ground = map.surface(x);
    const h = map.tree(x);
    // Standing level with the top of the trunk: aim there, not down at the roots.
    a.y = (ground - h) * TILE - a.h / 2;
    expect(b.trunkRow(a, x)).toBe(ground - h);
    // Standing at the roots: aim just above them.
    a.y = (ground + 2) * TILE - a.h / 2;
    expect(b.trunkRow(a, x)).toBe(ground - 1);
  });

  it("felled trees don't grow back inside what the waifus built (or it'd never be finished)", () => {
    const { g, map, a } = setup();
    const x = treeNear(map, Math.floor((a.x + a.w / 2) / TILE), 4);
    const y = treeNear(map, x, 20);
    map.cut.add(x);
    map.cut.add(y);
    g.cutDay.set(x, g.day - 2);
    g.cutDay.set(y, g.day - 2);
    g.keepCut = (col) => col === x; // x is inside a building
    // Through a dawn (4:30), from just before it.
    g.hour = 4.3;
    for (let t = 0; t < 30; t += 1 / 30) g.update(1 / 30, noInput(), { w: 90, h: 56 });
    expect(map.cut.has(x)).toBe(true);
    expect(map.cut.has(y)).toBe(false);
  });
});

describe("not getting stuck (play-through bugs)", () => {
  it("won't tunnel into blocks her best pickaxe can't break (dungeon brick)", () => {
    const { g, map, a, b } = setup();
    const crew = b as unknown as { canDig(x: number, y: number): boolean };
    const x = Math.floor((a.x + a.w / 2) / TILE) + 3;
    const y = map.surface(x) + 2;
    map.set(x, y, T.Stone);
    expect(crew.canDig(x, y)).toBe(true);
    map.set(x, y, T.BlueBrick);
    expect(crew.canDig(x, y)).toBe(false);
    void g;
  });

  it("leaves things inside the dungeon alone until Skeletron is beaten", () => {
    const { g, map, b } = setup();
    const crew = b as unknown as { sealed(x: number, y: number): boolean };
    const d = map.structures.find((s) => s.kind === "dungeon")!;
    const mx = Math.floor((d.x0 + d.x1) / 2);
    const my = Math.floor((d.y0 + d.y1) / 2);
    expect(crew.sealed(mx, my)).toBe(true);
    expect(crew.sealed(d.x1 + 50, my)).toBe(false);
    g.bosses.skeletron = true;
    expect(crew.sealed(mx, my)).toBe(false);
  });

  it("furniture waits for the floor it stands on", () => {
    const { map, a, b } = setup();
    const crew = b as unknown as { supported(t: Job | object): boolean };
    const x = Math.floor((a.x + a.w / 2) / TILE) + 6;
    const floor = map.surface(x) - 8;
    expect(crew.supported({ kind: "object", x, y: floor - 2, obj: "sink" })).toBe(false); // mid-air
    map.set(x, floor, T.Wood);
    map.set(x + 1, floor, T.Wood);
    expect(crew.supported({ kind: "object", x, y: floor - 2, obj: "sink" })).toBe(true);
  });
});

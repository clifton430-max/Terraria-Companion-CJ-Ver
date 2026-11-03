import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/behavior";
import { T, WorldMap } from "../gen";
import { Builders, chooseSite, makeAgent, type Project } from "./builder";
import { OBJECTS } from "./furniture";
import { Game } from "./game";
import { luxuryHouse, oneEach } from "./house";
import { ObjectLayer } from "./objects";
import { TILE } from "./physics";

const BIOMES = ["forest", "snow", "desert", "jungle", "ocean", "underworld"];

/** Luxury plans across a spread of worlds and biomes. */
function plans(): (Project & { map: WorldMap })[] {
  const out: (Project & { map: WorldMap })[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const map = new WorldMap(seed * 7919);
    const x0 = Math.floor(map.size.width / 2);
    for (const biome of BIOMES) out.push({ ...luxuryHouse(map, biome, x0, map.surface(x0), seed * 31 + biome.length), map });
  }
  return out;
}

describe("the manor's plan can always be finished", () => {
  const all = plans();

  it("has one block and one wall task per spot (two that disagree undo each other forever)", () => {
    for (const p of all) {
      const seen = new Set<string>();
      for (const t of p.tasks) {
        if (t.kind !== "tile" && t.kind !== "wall") continue;
        const k = `${t.kind}:${t.x},${t.y}`;
        expect(seen.has(k), `${p.name}: ${k} twice`).toBe(false);
        seen.add(k);
      }
    }
  });

  it("never plans two pieces of furniture on top of each other", () => {
    for (const p of all) {
      const cells = new Map<number, string>();
      for (const t of p.tasks) {
        if (t.kind !== "object") continue;
        const d = OBJECTS[t.obj];
        for (let i = 0; i < d.w; i++)
          for (let j = 0; j < d.h; j++) {
            const k = (t.y + j) * 65536 + t.x + i;
            expect(cells.get(k), `${p.name}: ${t.obj} at ${t.x},${t.y} overlaps`).toBeUndefined();
            cells.set(k, t.obj);
          }
      }
    }
  });

  it("gives every block above ground something to attach to (a block beside it or a wall behind)", () => {
    for (const p of all) {
      const walls = new Set(p.tasks.flatMap((t) => (t.kind === "wall" ? [t.y * 65536 + t.x] : [])));
      for (const t of p.tasks) {
        if (t.kind !== "tile" || t.tile === T.Platform) continue;
        const ok = [p.planned.get(t.y * 65536 + t.x - 1), p.planned.get(t.y * 65536 + t.x + 1), p.planned.get((t.y - 1) * 65536 + t.x), p.planned.get((t.y + 1) * 65536 + t.x)].some((n) => n !== undefined && n !== T.Air) || walls.has(t.y * 65536 + t.x) || t.y > p.map.surface(t.x) + 1; // (underground, anything holds)
        expect(ok, `${p.name}: block at ${t.x},${t.y} floats`).toBe(true);
      }
    }
  });

  it("stands floor furniture on the floor (not a row into it)", () => {
    for (const p of all) {
      const tiles = new Set(p.tasks.flatMap((t) => (t.kind === "tile" ? [t.y * 65536 + t.x] : [])));
      for (const t of p.tasks) {
        if (t.kind !== "object" || OBJECTS[t.obj].support !== "floor") continue;
        const d = OBJECTS[t.obj];
        for (let i = 0; i < d.w; i++) for (let j = 0; j < d.h; j++) expect(tiles.has((t.y + j) * 65536 + t.x + i), `${p.name}: ${t.obj} at ${t.x},${t.y} is in a block`).toBe(false);
      }
    }
  });
});

describe("oneEach", () => {
  it("keeps the later of two block or wall tasks at a spot, and everything else as it was", () => {
    const tasks = oneEach([
      { kind: "wall", x: 1, y: 1, wall: 3 },
      { kind: "clear", x: 1, y: 1 },
      { kind: "tile", x: 2, y: 1, tile: 4 },
      { kind: "wall", x: 1, y: 1, wall: 17 },
    ]);
    expect(tasks).toEqual([
      { kind: "clear", x: 1, y: 1 },
      { kind: "tile", x: 2, y: 1, tile: 4 },
      { kind: "wall", x: 1, y: 1, wall: 17 },
    ]);
  });
});

describe("small pieces on a table", () => {
  it("a bottle can stand on a work bench", () => {
    const map = new WorldMap(42);
    const objects = new ObjectLayer(map);
    const x = Math.floor(map.size.width / 2);
    const y = map.surface(x);
    expect(objects.place("workbench", x, y - 1)).not.toBeNull();
    expect(objects.canPlace("bottle", x, y - 2)).toBe(true);
    expect(objects.canPlace("lamp", x, y - 4)).toBe(false); // (bigger pieces need the floor)
  });
});

describe("which floor to work from", () => {
  it("picks the floor the work is over when a tower's floor is level with the house's", () => {
    const map = new WorldMap(42);
    const g = new Game(map, new ObjectLayer(map), mulberry32(42));
    const sp = g.spawnPoint();
    const a = makeAgent("terrarian", sp.x, sp.y);
    const b = new Builders(g, chooseSite(map, Math.floor(sp.x / TILE)), [a]) as unknown as { floorFor(p: unknown, x: number, y: number): { x0: number } | null };
    const p = {
      floors: [
        { y: 100, x0: 0, x1: 46 }, // the ground floor
        { y: 94, x0: 0, x1: 46 }, // the house
        { y: 94, x0: 48, x1: 53 }, // the tower beside it
      ],
    };
    expect(b.floorFor(p, 52, 88)?.x0).toBe(48);
    expect(b.floorFor(p, 44, 88)?.x0).toBe(0);
  });
});

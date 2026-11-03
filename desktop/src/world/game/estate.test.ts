import { describe, expect, it } from "vitest";
import { T, WorldMap } from "../gen";
import { recipeFor } from "./inventory";
import { OBJECTS } from "./furniture";
import { taskItem } from "./builder";
import { COMPACT_SPAN, ESTATE_SPAN, estatePlan, luxuryHouse } from "./estate";
import type { Project } from "./house";
import { SOURCES } from "./tools";

const BIOMES = ["forest", "snow", "desert", "jungle", "corruption", "crimson", "hallow", "mushroom", "ocean", "sky", "underworld"];

/** Estates across worlds, biomes and site sizes. */
function plans(): (Project & { map: WorldMap; label: string })[] {
  const out: (Project & { map: WorldMap; label: string })[] = [];
  for (let seed = 1; seed <= 4; seed++) {
    const map = new WorldMap(seed * 7919);
    const x0 = Math.floor(map.size.width / 2);
    for (const biome of BIOMES)
      for (const span of [COMPACT_SPAN, 100, ESTATE_SPAN]) out.push({ ...luxuryHouse(map, biome, x0, map.surface(x0), seed * 31 + biome.length, span), map, label: `${biome}/${span}/${seed}` });
  }
  return out;
}

describe("estates", { timeout: 60_000 }, () => {
  const all = plans();

  it("fit their sites: a full site gets wings, grounds and towers; an old one keeps its footprint", () => {
    expect(estatePlan(ESTATE_SPAN, 3)).toEqual({ towers: true, wings: true, court: true, garden: true });
    expect(estatePlan(COMPACT_SPAN, 3)).toEqual({ towers: true, wings: false, court: false, garden: false });
    for (const p of all) {
      const span = Number(p.label.split("/")[1]);
      const x0 = p.params.kind === "luxury" ? p.params.x0 : 0;
      const built = p.tasks.filter((t) => t.kind === "tile" || t.kind === "wall" || t.kind === "object").map((t) => (t as { x: number }).x);
      // (Doorstep ramps reach out past the ends; the buildings and grounds stay on the site.)
      if (span > COMPACT_SPAN) {
        expect(Math.min(...built.filter((x) => x >= x0 - 1)), p.label).toBeGreaterThanOrEqual(x0 - 1);
      }
    }
  });

  it("have one block and one wall task per spot", () => {
    for (const p of all) {
      const seen = new Set<number>();
      for (const t of p.tasks) {
        if (t.kind !== "tile" && t.kind !== "wall") continue;
        const k = (t.y * 65536 + t.x) * 2 + (t.kind === "tile" ? 1 : 0);
        if (seen.has(k)) expect.fail(`${p.label}: ${t.kind} at ${t.x},${t.y} twice`);
        seen.add(k);
      }
    }
  });

  it("never put two pieces of furniture in the same place", () => {
    for (const p of all) {
      const cells = new Map<number, string>();
      for (const t of p.tasks) {
        if (t.kind !== "object") continue;
        const d = OBJECTS[t.obj];
        for (let i = 0; i < d.w; i++)
          for (let j = 0; j < d.h; j++) {
            const k = (t.y + j) * 65536 + t.x + i;
            expect(cells.get(k), `${p.label}: ${t.obj} at ${t.x},${t.y} overlaps ${cells.get(k)}`).toBeUndefined();
            cells.set(k, t.obj);
          }
      }
    }
  });

  it("give every block something to hold on to, built up from the ground or a wall", () => {
    for (const p of all) {
      const walls = new Set(p.tasks.flatMap((t) => (t.kind === "wall" ? [t.y * 65536 + t.x] : [])));
      // Anchored: a wall behind, underground, or on the ground (a solid tile under it that the
      // build doesn't clear); then anything touching an anchored block, and so on.
      const cleared = new Set(p.tasks.flatMap((t) => (t.kind === "clear" ? [t.y * 65536 + t.x] : [])));
      const tiles = [...p.planned.keys()];
      const ok = new Set<number>();
      const queue: number[] = [];
      for (const k of tiles) {
        const x = k % 65536;
        const y = Math.floor(k / 65536);
        const ground = (gx: number, gy: number) => p.map.solid(gx, gy) && !cleared.has(gy * 65536 + gx) && !p.planned.has(gy * 65536 + gx);
        if (walls.has(k) || y > p.map.surface(x) + 1 || ground(x - 1, y) || ground(x + 1, y) || ground(x, y - 1) || ground(x, y + 1)) {
          ok.add(k);
          queue.push(k);
        }
      }
      while (queue.length) {
        const k = queue.pop()!;
        for (const n of [k - 1, k + 1, k - 65536, k + 65536])
          if (p.planned.has(n) && !ok.has(n)) {
            ok.add(n);
            queue.push(n);
          }
      }
      for (const k of tiles) if (!ok.has(k)) expect.fail(`${p.label}: block at ${k % 65536},${Math.floor(k / 65536)} floats`);
    }
  });

  it("keep furniture out of blocks, and stand floor pieces on something", () => {
    for (const p of all) {
      const tiles = new Map(p.tasks.flatMap((t) => (t.kind === "tile" ? [[t.y * 65536 + t.x, t.tile] as const] : [])));
      const tables = new Set<number>();
      for (const t of p.tasks) if (t.kind === "object" && OBJECTS[t.obj].roles?.includes("table")) for (let i = 0; i < OBJECTS[t.obj].w; i++) tables.add(t.y * 65536 + t.x + i);
      for (const t of p.tasks) {
        if (t.kind !== "object") continue;
        const d = OBJECTS[t.obj];
        for (let i = 0; i < d.w; i++)
          for (let j = 0; j < d.h; j++) {
            const under = tiles.get((t.y + j) * 65536 + t.x + i);
            expect(under === undefined || under === T.WoodBeam, `${p.label}: ${t.obj} at ${t.x},${t.y} is in a block`).toBe(true);
          }
        if (d.support === "floor")
          for (let i = 0; i < d.w; i++) {
            const k = (t.y + d.h) * 65536 + t.x + i;
            const below = tiles.get(k);
            const ok = (below !== undefined && below !== T.WoodBeam) || (tables.has(k) && (d.tabletop || (d.w === 1 && d.h === 1))) || t.y + d.h > p.map.surface(t.x + i);
            expect(ok, `${p.label}: ${t.obj} at ${t.x},${t.y} stands on nothing`).toBe(true);
          }
      }
    }
  });

  it("use only things that can be made or found", () => {
    const missing = new Set<string>();
    for (const p of all)
      for (const t of p.tasks) {
        const id = taskItem(t);
        if (id === null) continue;
        if (!recipeFor(id) && !SOURCES[id]) missing.add(`${JSON.stringify(t).slice(0, 60)} → ${id}`);
      }
    expect([...missing]).toEqual([]);
  });
});

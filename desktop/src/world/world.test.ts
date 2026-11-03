import { structuresFor } from "./structures";
import { describe, expect, it } from "vitest";
import { biomeAt, cactusAt, CHUNK, editKey, generatedTile, parseExtras, parseSaved, serializeEdits, seedFrom, surfaceAt, T, treeAt, WORLD, WorldMap } from "./gen";
import { clampCamera, defaultCamera, isTerrainId, liftOut, nearestZoom, screenToTile, terrainSurfaces, tilePx, tileToScreen } from "./view";
import { DEFAULT_PHYSICS, makeBody, step } from "../engine/physics";

describe("world generation", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = new WorldMap(1234);
    const b = new WorldMap(1234);
    const c = new WorldMap(99);
    let same = 0;
    let diff = 0;
    for (let x = 0; x < WORLD.width; x += 37)
      for (let y = 150; y < 400; y += 7) {
        expect(a.tile(x, y)).toBe(b.tile(x, y));
        if (a.tile(x, y) === c.tile(x, y)) same++;
        else diff++;
      }
    expect(diff).toBeGreaterThan(same * 0.1);
  });

  it("has a continuous grassy surface with dirt then stone below, and sky above", () => {
    const seed = 42;
    const built = structuresFor(seed);
    let grass = 0;
    for (let x = 1; x < WORLD.width - 1; x++) {
      const s = surfaceAt(seed, x);
      expect(Math.abs(s - surfaceAt(seed, x + 1))).toBeLessThanOrEqual(3); // no cliffs taller than 3 tiles
      // Sky or the ocean above (buildings and their foundations aside).
      if (!built.some((b) => x >= b.x0 - 3 && x <= b.x1 + 3)) expect([T.Air, T.Water]).toContain(generatedTile(seed, x, s - 1));
      if ([T.Grass, T.Snow, T.JungleGrass, T.Sand, T.CorruptGrass].includes(generatedTile(seed, x, s) as never)) grass++;
      // Deep down it's mostly rock.
    }
    expect(grass).toBeGreaterThan(WORLD.width * 0.7); // a covered surface (grass, snow, jungle or sand)
    let stone = 0;
    let total = 0;
    for (let x = 0; x < WORLD.width; x += 13)
      for (let y = surfaceAt(seed, x) + 40; y < WORLD.height; y += 11) {
        total++;
        if ([T.Stone, T.Copper, T.Iron, T.Silver, T.Gold, T.Ice, T.Mud, T.Sand, T.Ebonstone, T.Demonite, T.Sandstone, T.HardenedSand, T.Ash, T.Hellstone, T.Hive, T.MushroomGrass].includes(generatedTile(seed, x, y) as never)) stone++;
      }
    expect(stone / total).toBeGreaterThan(0.5);
  });

  it("has caves underground but keeps the topsoil mostly intact", () => {
    const seed = 7;
    let caveAir = 0;
    let surfaceHoles = 0;
    for (let x = 0; x < WORLD.width; x += 3) {
      const s = surfaceAt(seed, x);
      for (let y = s + 10; y < s + 200; y += 3) if (generatedTile(seed, x, y) === T.Air) caveAir++;
      if (generatedTile(seed, x, s) === T.Air) surfaceHoles++;
    }
    expect(caveAir).toBeGreaterThan(500);
    expect(surfaceHoles).toBeLessThan(WORLD.width / 3 / 10); // the odd cave entrance only
  });

  it("grows trees on flat grass, spaced apart", () => {
    const seed = 5;
    const trees: number[] = [];
    for (let x = 0; x < WORLD.width; x++) if (treeAt(seed, x)) trees.push(x);
    expect(trees.length).toBeGreaterThan(60);
    for (let i = 1; i < trees.length; i++) expect(trees[i] - trees[i - 1]).toBeGreaterThan(3);
    for (const x of trees.slice(0, 50)) {
      expect([T.Grass, T.Snow, T.JungleGrass, T.CorruptGrass, T.Sand]).toContain(generatedTile(seed, x, surfaceAt(seed, x)));
      const h = treeAt(seed, x);
      expect(h).toBeGreaterThanOrEqual(7);
      expect(h).toBeLessThanOrEqual(16);
    }
  });
});

describe("biomes", () => {
  it("has snow and jungle on opposite sides, a desert, and forest in the middle", () => {
    for (const seed of [1, 2, 3, 4]) {
      const at = (x: number) => biomeAt(seed, x);
      expect(at(2100)).toBe("forest");
      const left = at(700);
      const right = at(3500);
      expect(new Set([left, right])).toEqual(new Set(["snow", "jungle"]));
      let desert = 0;
      for (let x = 0; x < WORLD.width; x += 10) if (at(x) === "desert") desert++;
      expect(desert).toBeGreaterThan(20);
      // Biome surfaces.
      const snowX = left === "snow" ? 700 : 3500;
      expect(generatedTile(seed, snowX, surfaceAt(seed, snowX))).toBe(T.Snow);
      const jungleX = left === "jungle" ? 700 : 3500;
      const jt = generatedTile(seed, jungleX, surfaceAt(seed, jungleX));
      expect([T.JungleGrass, T.Air]).toContain(jt);
    }
  });
  it("puts cacti only in the desert and platforms are one-way", () => {
    const seed = 3;
    let n = 0;
    for (let x = 0; x < WORLD.width; x++) if (cactusAt(seed, x)) {
      n++;
      expect(biomeAt(seed, x)).toBe("desert");
    }
    expect(n).toBeGreaterThan(3);
    const m = new WorldMap(seed);
    const s = m.surface(2100);
    m.set(2100, s - 4, T.Platform);
    expect(m.solid(2100, s - 4)).toBe(false);
    expect(m.standable(2100, s - 4)).toBe(true);
  });
});

describe("editing and saving", () => {
  it("edits override generation, revert cleanly, and round-trip through the save file", () => {
    const m = new WorldMap(3);
    const X = 2000;
    const s = m.surface(X);
    expect(m.set(X, s - 1, T.Stone)).toBe(true);
    expect(m.tile(X, s - 1)).toBe(T.Stone);
    expect(m.set(X, s - 1, T.Stone)).toBe(false); // no change
    expect(m.set(X, s, T.Air)).toBe(true);
    const saved = serializeEdits(3, m.edits);
    const back = new WorldMap(3, parseSaved(saved, 3));
    expect(back.tile(X, s - 1)).toBe(T.Stone);
    expect(back.tile(X, s)).toBe(T.Air);
    // Putting the original back removes the edit rather than storing it.
    expect(m.set(X, s - 1, T.Air)).toBe(true);
    expect(m.edits.has(editKey(X, s - 1))).toBe(false);
    // A tree whose ground was dug away disappears.
    let treeX = -1;
    for (let x = 10; x < 4000 && treeX < 0; x++) if (m.tree(x)) treeX = x;
    m.set(treeX, m.surface(treeX), T.Air);
    expect(m.tree(treeX)).toBe(0);
  });
  it("keeps chopped trees and other saved extras", () => {
    const saved = serializeEdits(5, new Map(), { cut: [10, 20], objects: [{ t: "workbench", x: 1, y: 2 }], taken: [99] });
    const ex = parseExtras(saved, 5);
    expect(ex.cut).toEqual([10, 20]);
    expect(ex.objects).toHaveLength(1);
    expect(ex.taken).toEqual([99]);
    expect(parseExtras(saved, 6).cut).toEqual([]);
    expect(parseExtras("garbage", 5).objects).toEqual([]);
  });
  it("ignores invalid or mismatched save data", () => {
    expect(parseSaved("not json", 1).size).toBe(0);
    expect(parseSaved(JSON.stringify({ version: 1, seed: 2, edits: [[1, 1, 1]] }), 1).size).toBe(0);
    const p = parseSaved(JSON.stringify({ version: 1, seed: 1, edits: [[1, 1, 1], [-5, 1, 1], [1, 1, 99], ["x", 1, 1], [2, 2]] }), 1);
    expect(p.size).toBe(1);
    expect(parseSaved(null, 1).size).toBe(0);
  });
  it("turns typed seeds into numbers consistently", () => {
    expect(seedFrom("12345")).toBe(12345);
    expect(seedFrom("my world")).toBe(seedFrom("my world"));
    expect(seedFrom("my world")).not.toBe(seedFrom("other world"));
    expect(seedFrom("0")).toBeGreaterThan(0);
  });
  it("keeps memory bounded while scrolling across the whole world", () => {
    const m = new WorldMap(9);
    m.maxChunks = 64;
    for (let x = 0; x < WORLD.width; x += 8) for (let y = 150; y < 300; y += 8) m.tile(x, y);
    expect(m.cached).toBeLessThanOrEqual(64);
    expect(CHUNK).toBe(32);
  });
});

describe("camera", () => {
  it("only uses zoom steps with whole-pixel tiles and snaps the camera to the pixel grid", () => {
    for (const z of [0.3, 1.2, 1.6, 2.2, 3.4, 9]) expect(Number.isInteger(tilePx(nearestZoom(z)))).toBe(true);
    const m = new WorldMap(1);
    for (const dpr of [1, 2]) {
      const c = clampCamera(m, { x: 123.4567, y: 150.123 }, 1440, 900, 2.5, dpr);
      const tp = tilePx(2.5);
      // Every tile edge lands on a whole device pixel.
      expect(Math.abs(c.x * tp * dpr - Math.round(c.x * tp * dpr))).toBeLessThan(1e-6);
      const s = tileToScreen(c, 2.5, 200, 180);
      expect(Math.abs(s.x * dpr - Math.round(s.x * dpr))).toBeLessThan(1e-6);
      expect(screenToTile(c, 2.5, s.x + 1, s.y + 1)).toEqual({ x: 200, y: 180 });
    }
  });
  it("starts centred with the surface low on screen, and stays inside the world", () => {
    const m = new WorldMap(1);
    const c = defaultCamera(m, 1440, 900, 2);
    const cx = Math.floor(c.x + 1440 / 32 / 2);
    const sy = tileToScreen(c, 2, cx, m.surface(cx)).y;
    expect(sy / 900).toBeGreaterThan(0.65);
    expect(sy / 900).toBeLessThan(0.85);
    expect(clampCamera(m, { x: -50, y: -50 }, 1440, 900, 2)).toEqual({ x: 0, y: 0 });
    const far = clampCamera(m, { x: 1e9, y: 1e9 }, 1440, 900, 2);
    expect(far.x).toBeCloseTo(WORLD.width - 1440 / 32);
  });
});

describe("companions on the terrain", () => {
  const m = new WorldMap(11);
  const zoom = 2;
  const W = 1440;
  const H = 870;
  const off = { x: 0, y: 25 };
  const cam = defaultCamera(m, W, H + off.y, zoom);

  it("turns visible terrain into platforms, walls and ceilings", () => {
    const s = terrainSurfaces(m, cam, zoom, off, { width: W, height: H });
    expect(s.platforms.length).toBeGreaterThan(5);
    expect(s.walls.length).toBeGreaterThan(5);
    expect(s.platforms.every((p) => isTerrainId(p.id))).toBe(true);
    expect(s.walls.every((w) => w.solid && w.id > -10_000_000)).toBe(true);
    // Platforms sit exactly on tile edges.
    const tp = tilePx(zoom);
    for (const p of s.platforms.slice(0, 20)) expect(Math.abs((p.top + off.y) / tp + cam.y - Math.round((p.top + off.y) / tp + cam.y))).toBeLessThan(1e-6);
  });

  it("a character dropped on the hills lands on the surface and walks without falling through", () => {
    const s = terrainSurfaces(m, cam, zoom, off, { width: W, height: H });
    let body = { ...makeBody(700, { width: W, height: H }, 40, 56), y: 0, grounded: false };
    for (let i = 0; i < 240; i++) body = step(body, { move: 0, jump: false }, 1 / 60, { width: W, height: H }, DEFAULT_PHYSICS, s.platforms, s.walls, s.ceilings).body;
    expect(body.grounded).toBe(true);
    expect(isTerrainId(body.platformId)).toBe(true);
    const tp = tilePx(zoom);
    const col = Math.floor(cam.x + (body.x + body.w / 2) / tp);
    const feetRow = (body.y + body.h + off.y) / tp + cam.y;
    expect(Math.abs(feetRow - Math.round(feetRow))).toBeLessThan(0.05);
    expect(m.solid(col, Math.round(feetRow))).toBe(true);
    expect(m.solid(col, Math.round(feetRow) - 1)).toBe(false);
    // Walk for a few seconds: never ends up inside rock.
    for (let i = 0; i < 300; i++) {
      body = step(body, { move: 1, jump: false }, 1 / 60, { width: W, height: H }, DEFAULT_PHYSICS, s.platforms, s.walls, s.ceilings).body;
      expect(liftOut(m, cam, zoom, off, body)).toBeNull();
    }
  });

  it("lifts a character out when terrain appears around her", () => {
    const tp = tilePx(zoom);
    const col = Math.floor(cam.x + 700 / tp);
    const deep = (m.surface(col) + 3 - cam.y) * tp - off.y;
    const y = liftOut(m, cam, zoom, off, { x: 700 - 20, y: deep, w: 40, h: 56 });
    expect(y).not.toBeNull();
    expect(y!).toBeLessThan(deep);
  });
});

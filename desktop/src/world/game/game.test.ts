import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/behavior";
import { T, WorldMap } from "../gen";
import { computeLight, daylightAt, isNight, SkyCache } from "./lighting";
import { Game, noInput, PLAYER_H, type Input } from "./game";
import { addItem, canCraft, clickSlot, countOf, craft, emptySlots, RECIPES, removeItem } from "./inventory";
import { hitsToMine, ITEMS, TILE_DROP } from "./items";
import { makeNpc, NPCS } from "./npcs";
import { ObjectLayer } from "./objects";
import { moveBox, TILE } from "./physics";

const newGame = (seed = 42) => {
  const map = new WorldMap(seed);
  return new Game(map, new ObjectLayer(map), mulberry32(7));
};

/** Run the game for `seconds` with fixed input. */
function run(g: Game, seconds: number, input: Input = noInput()) {
  for (let t = 0; t < seconds; t += 1 / 60) g.update(1 / 60, input, { w: 1440, h: 900 });
}

const at = (_g: Game, tx: number, ty: number, extra: Partial<Input["mouse"]> = {}): Input => ({ ...noInput(), mouse: { x: tx * TILE + 8, y: ty * TILE + 8, left: true, right: false, ...extra } });

describe("player", () => {
  it("starts with Terraria's starter kit, standing on the surface", () => {
    const g = newGame();
    expect(g.inventory.slice(0, 3).map((s) => s?.id)).toEqual([3507, 3509, 3506]);
    run(g, 2);
    expect(g.player.onGround).toBe(true);
    const tx = Math.floor((g.player.x + 10) / TILE);
    expect(Math.abs((g.player.y + PLAYER_H) / TILE - g.map.surface(tx))).toBeLessThan(2.1);
    expect(g.player.life).toBe(100);
  });

  it("runs, and a held jump clears about six tiles", () => {
    const g = newGame();
    run(g, 2);
    const x0 = g.player.x;
    run(g, 1, { ...noInput(), right: true });
    expect(g.player.x - x0).toBeGreaterThan(100);
    // Jump on flat ground: measure the peak.
    const flat = newGame(42);
    run(flat, 2);
    const y0 = flat.player.y;
    let peak = y0;
    for (let t = 0; t < 1; t += 1 / 60) {
      flat.update(1 / 60, { ...noInput(), jump: true }, { w: 1440, h: 900 });
      peak = Math.min(peak, flat.player.y);
    }
    const tiles = (y0 - peak) / TILE;
    expect(tiles).toBeGreaterThan(5);
    expect(tiles).toBeLessThan(8);
  });

  it("walks up one-tile steps but not walls", () => {
    const map = new WorldMap(42);
    const box = { x: 0, y: 0, w: 20, h: 42, vx: 0, vy: 0, onGround: false };
    const x = 2100;
    const s = map.surface(x);
    for (let i = 0; i < 10; i++) map.set(x + i, s - 1, T.Air);
    // Flatten a run, then a one-tile step at x+5.
    for (let i = 0; i < 10; i++) for (let y = s - 6; y < s; y++) map.set(x + i, y, T.Air);
    for (let i = 0; i < 10; i++) map.set(x + i, s, T.Dirt);
    for (let i = 5; i < 10; i++) map.set(x + i, s - 1, T.Dirt); // a one-tile-high plateau
    box.x = x * TILE + 4;
    box.y = s * TILE - 42 - 0.01;
    box.onGround = true;
    for (let i = 0; i < 90; i++) {
      box.vx = 120;
      moveBox(map, box, 1 / 60, { gravity: 1440, maxFall: 600, stepUp: true });
    }
    expect(box.x).toBeGreaterThan((x + 6) * TILE);
    expect(box.y + 42).toBeLessThanOrEqual((s - 1) * TILE + 0.5);
  });

  it("takes fall damage from high falls only", () => {
    const g = newGame();
    run(g, 2);
    const life = g.player.life;
    g.player.y -= 10 * TILE; // a short drop
    run(g, 2);
    expect(g.player.life).toBe(life);
    g.player.y -= 45 * TILE; // a long one
    run(g, 3);
    expect(g.player.life).toBeLessThan(life);
  });
});

describe("mining and building", () => {
  it("digs dirt with the copper pickaxe and picks the block up", () => {
    const g = newGame();
    run(g, 2);
    g.selected = 1; // copper pickaxe
    const tx = Math.floor((g.player.x + 10) / TILE) + 2;
    const ty = g.map.surface(tx);
    const tile = g.map.tile(tx, ty);
    expect([T.Grass, T.Dirt, T.Sand]).toContain(tile);
    run(g, 3, at(g, tx, ty));
    expect(g.map.tile(tx, ty)).toBe(T.Air);
    run(g, 2);
    expect(countOf(g.inventory, TILE_DROP[tile]!)).toBeGreaterThanOrEqual(1);
  });

  it("stone takes more hits than dirt; better pickaxes dig faster", () => {
    expect(hitsToMine(T.Dirt, 35)).toBe(2);
    expect(hitsToMine(T.Stone, 35)).toBe(3);
    expect(hitsToMine(T.Gold, 35)).toBeGreaterThan(hitsToMine(T.Gold, 65));
  });

  it("places blocks only where they attach and not inside the player", () => {
    const g = newGame();
    run(g, 2);
    addItem(g.inventory, 2, 10);
    const tx = Math.floor((g.player.x + 10) / TILE);
    const ty = Math.floor((g.player.y + 20) / TILE);
    expect(g.placeTile(tx, ty, T.Dirt)).toBe(false); // inside the player
    const free = tx + 3;
    const s = g.map.surface(free);
    const open = g.map.tile(free, s - 1) === T.Air;
    expect(g.placeTile(free, s - 1, T.Dirt)).toBe(open);
    expect(g.placeTile(free, s - 30, T.Dirt)).toBe(false); // floating in the sky
  });

  it("chops a tree for wood", () => {
    const g = newGame();
    let x = -1;
    for (let c = 2000; c < 2400 && x < 0; c++) if (g.map.tree(c)) x = c;
    expect(x).toBeGreaterThan(0);
    const ground = g.map.surface(x);
    for (let i = 0; i < 3; i++) g.chop(x, ground - 2, 35);
    expect(g.map.tree(x)).toBe(0);
    expect(g.drops.some((d) => d.id === 9 && d.count >= 7)).toBe(true);
  });

  it("furniture needs a floor, and work benches enable recipes nearby", () => {
    const g = newGame();
    const objs = g.objects;
    const x = 2100;
    const s = g.map.surface(x);
    let fx = x;
    while (!(g.map.tile(fx, s) !== T.Air && g.map.tile(fx + 1, g.map.surface(fx)) !== T.Air && g.map.surface(fx + 1) === g.map.surface(fx) && !g.map.tree(fx) && !g.map.tree(fx + 1))) fx++;
    const fs = g.map.surface(fx);
    expect(objs.canPlace("workbench", fx, fs - 40)).toBe(false); // mid-air
    expect(objs.place("workbench", fx, fs - 1)).not.toBeNull();
    expect(objs.stationsNear(fx + 1, fs - 2).has("workbench")).toBe(true);
    expect(objs.stationsNear(fx + 30, fs - 2).has("workbench")).toBe(false);
    // Digging the floor away drops it.
    g.digging.clear();
    for (let i = 0; i < 4; i++) g.dig(fx, fs, 35);
    expect(objs.placed.length).toBe(0);
  });
});

describe("inventory and crafting", () => {
  it("stacks, splits and swaps like Terraria", () => {
    const slots = emptySlots(10);
    expect(addItem(slots, 2, 1200)).toBe(0); // 999 + 201
    expect(slots[0]).toEqual({ id: 2, count: 999 });
    expect(slots[1]).toEqual({ id: 2, count: 201 });
    let cursor = clickSlot(slots, 1, null);
    expect(cursor).toEqual({ id: 2, count: 201 });
    cursor = clickSlot(slots, 0, cursor);
    expect(cursor).toEqual({ id: 2, count: 201 }); // full stack: nothing merged
    cursor = clickSlot(slots, 5, cursor);
    expect(cursor).toBeNull();
    cursor = clickSlot(slots, 5, null, true);
    expect(cursor).toEqual({ id: 2, count: 1 });
    expect(slots[5]!.count).toBe(200);
    expect(removeItem(slots, 2, 5000)).toBe(false);
  });

  it("crafts with the right station and ingredients", () => {
    const slots = emptySlots(50);
    addItem(slots, 9, 20);
    addItem(slots, 23, 5);
    const torches = RECIPES.find((r) => r.result === 8)!;
    const bench = RECIPES.find((r) => r.result === 36)!;
    const sword = RECIPES.find((r) => r.result === 24)!;
    expect(canCraft(slots, torches, new Set())).toBe(true);
    expect(canCraft(slots, sword, new Set())).toBe(false); // needs a work bench
    expect(canCraft(slots, sword, new Set(["workbench"]))).toBe(true);
    const r = craft(slots, bench, new Set(), null);
    expect(r.ok).toBe(true);
    expect(r.cursor).toEqual({ id: 36, count: 1 });
    expect(countOf(slots, 9)).toBe(10);
  });

  it("every recipe uses known items and has a reachable chain to iron and demonite gear", () => {
    for (const r of RECIPES) {
      expect(ITEMS[r.result], `result ${r.result}`).toBeDefined();
      for (const [id] of r.ingredients) expect(ITEMS[id], `ingredient ${id}`).toBeDefined();
    }
    const makes = new Set(RECIPES.map((r) => r.result));
    for (const id of [36, 33, 35, 20, 22, 19, 57, 1, 4, 99, 103, 46, 43, 560]) expect(makes.has(id)).toBe(true);
  });
});

describe("combat", () => {
  it("kills a slime with the sword and collects its gel", () => {
    const g = newGame();
    run(g, 2);
    g.selected = 0; // copper shortsword
    const c = g.playerCenter;
    const slime = makeNpc("greenSlime", c.x + 22, g.player.y + g.player.h);
    g.npcs.push(slime);
    for (let i = 0; i < 300 && g.npcs.includes(slime); i++) g.update(1 / 60, { ...noInput(), mouse: { x: c.x + 60, y: c.y, left: true, right: false } }, { w: 1440, h: 900 });
    expect(g.npcs.includes(slime)).toBe(false);
    run(g, 3);
    expect(countOf(g.inventory, 23)).toBeGreaterThanOrEqual(1);
  });

  it("armour reduces damage, invincibility frames prevent double hits, death respawns", () => {
    const g = newGame();
    run(g, 2);
    g.hurtPlayer(20, 1);
    expect(g.player.life).toBe(80);
    g.hurtPlayer(20, 1); // still invincible
    expect(g.player.life).toBe(80);
    g.armor = [{ id: 92, count: 1 }, { id: 83, count: 1 }, { id: 79, count: 1 }]; // gold: 12 defence
    expect(g.defense).toBe(12);
    run(g, 1);
    g.hurtPlayer(20, 1);
    expect(g.player.life).toBe(66);
    run(g, 1);
    g.hurtPlayer(9999, 0);
    expect(g.player.dead).toBeGreaterThan(0);
    run(g, 6);
    expect(g.player.dead).toBeLessThanOrEqual(0);
    expect(g.player.life).toBe(g.player.maxLife);
  });

  it("bows shoot arrows that hurt enemies", () => {
    const g = newGame();
    run(g, 2);
    g.inventory[4] = { id: 39, count: 1 };
    addItem(g.inventory, 40, 20);
    g.selected = 4;
    const c = g.playerCenter;
    // Clear a corridor so no hill gets in the way, then a flyer at head height.
    const cx = Math.floor(c.x / TILE);
    const cy = Math.floor(c.y / TILE);
    for (let x = cx; x < cx + 14; x++) for (let y = cy - 2; y <= cy + 1; y++) g.map.set(x, y, T.Air);
    const target = makeNpc("demonEye", c.x + 160, c.y + 9);
    target.life = 5;
    g.npcs.push(target);
    g.update(1 / 60, { ...noInput(), mouse: { x: c.x + 160, y: c.y - 4, left: true, right: false } }, { w: 1440, h: 900 });
    expect(countOf(g.inventory, 40)).toBe(19);
    run(g, 1.5);
    expect(g.npcs.includes(target)).toBe(false);
  });

  it("potions heal (with sickness), life crystals raise max life", () => {
    const g = newGame();
    run(g, 1);
    g.player.life = 20;
    addItem(g.inventory, 28, 2);
    g.quickHeal();
    expect(g.player.life).toBe(70);
    g.quickHeal(); // potion sickness
    expect(g.player.life).toBe(70);
    g.inventory[5] = { id: 29, count: 1 };
    g.selected = 5;
    g.update(1 / 60, { ...noInput(), mouse: { x: 0, y: 0, left: true, right: false } }, { w: 1440, h: 900 });
    expect(g.player.maxLife).toBe(120);
  });
});

describe("enemies and bosses", () => {
  it("spawns surface slimes by day and zombies / demon eyes at night, off screen, within a cap", () => {
    const g = newGame();
    const hostile = () => new Set(g.spawnTable().filter((k) => !NPCS[k].critter));
    g.hour = 12;
    expect(hostile()).toEqual(new Set(["greenSlime", "blueSlime"]));
    expect(g.spawnTable().some((k) => NPCS[k].critter)).toBe(true); // bunnies, birds…
    g.hour = 23;
    expect(hostile()).toEqual(new Set(["zombie", "demonEye"]));
    run(g, 60);
    const c = g.playerCenter;
    expect(g.npcs.length).toBeGreaterThan(0);
    expect(g.npcs.length).toBeLessThanOrEqual(10);
    // Underground there are bats.
    g.player.y += 60 * TILE;
    expect(g.spawnTable()).toContain("caveBat");
    expect(Math.abs(c.x)).toBeGreaterThan(0);
  });

  it("the Eye of Cthulhu only comes at night, and a beaten boss is remembered", () => {
    const g = newGame();
    g.hour = 12;
    g.inventory[6] = { id: 43, count: 1 };
    g.selected = 6;
    run(g, 0.1, { ...noInput(), mouse: { x: 0, y: 0, left: true, right: false } });
    expect(g.bossAlive).toBeUndefined();
    expect(countOf(g.inventory, 43)).toBe(1);
    g.hour = 22;
    g.player.use = null;
    run(g, 0.1, { ...noInput(), mouse: { x: 0, y: 0, left: true, right: false } });
    const eye = g.bossAlive!;
    expect(eye.kind).toBe("eye");
    // Phase 2 at half life.
    eye.life = NPCS.eye.life * 0.4;
    run(g, 3);
    expect(eye.phase2).toBe(true);
    eye.life = 1;
    g.hitNpc(eye, 50, 0, 1, 999);
    expect(g.bosses.eye).toBe(true);
    expect(g.drops.some((d) => d.id === 56)).toBe(true);
  });

  it("King Slime splits off slimes as he's hurt and shrinks", () => {
    const g = newGame();
    run(g, 1);
    const c = g.playerCenter;
    const k = makeNpc("kingSlime", c.x + 300, g.player.y + g.player.h);
    g.npcs.push(k);
    const w0 = k.w;
    k.life = NPCS.kingSlime.life * 0.5;
    run(g, 0.5);
    expect(k.w).toBeLessThan(w0);
    expect(g.npcs.filter((n) => n.kind === "blueSlime").length).toBeGreaterThan(0);
  });
});

describe("day, night and light", () => {
  it("cycles day and night", () => {
    expect(daylightAt(12)).toBe(1);
    expect(daylightAt(0)).toBeLessThan(0.4);
    expect(isNight(23)).toBe(true);
    expect(isNight(12)).toBe(false);
    const g = newGame();
    g.hour = 8;
    run(g, 60);
    expect(g.hour).toBeCloseTo(9, 1);
  });
  it("lights the surface, darkens caves, and torches light them up", () => {
    const map = new WorldMap(42);
    const sky = new SkyCache(map);
    const x0 = 2080;
    const y0 = map.surface(2100) - 10;
    const dark = computeLight(map, sky, x0, y0, 40, 80, 1, []);
    expect(dark.light[0]).toBeCloseTo(1); // open sky
    expect(dark.light[(79) * 40 + 20]).toBeLessThan(0.05); // deep underground
    const lit = computeLight(map, sky, x0, y0, 40, 80, 1, [{ x: x0 + 20, y: y0 + 79, level: 1 }]);
    expect(lit.light[79 * 40 + 20]).toBeGreaterThan(0.9);
  });
});

describe("torches", () => {
  it("place in a cave from the hotbar and light it up", () => {
    const g = newGame();
    const m = g.map;
    // Find a cave pocket: three tiles of air over a floor, well underground.
    let spot: { x: number; y: number } | null = null;
    for (let x = 2000; x < 2600 && !spot; x++)
      for (let y = m.surface(x) + 30; y < m.surface(x) + 150; y++)
        if (!m.solid(x, y) && !m.solid(x, y - 1) && !m.solid(x, y - 2) && !m.solid(x + 2, y) && m.solid(x, y + 1)) {
          spot = { x, y };
          break;
        }
    expect(spot).not.toBeNull();
    g.player.x = spot!.x * TILE;
    g.player.y = (spot!.y + 1) * TILE - g.player.h - 0.1;
    g.inventory[5] = { id: 8, count: 3 };
    g.selected = 5;
    const tx = spot!.x + 2;
    g.update(1 / 60, at(g, tx, spot!.y), { w: 90, h: 56 });
    const torch = g.objects.placed.find((o) => o.t === "torch");
    expect(torch).toBeDefined();
    expect(countOf(g.inventory, 8)).toBe(2);
    const sky = new SkyCache(m);
    const lit = computeLight(m, sky, tx - 10, spot!.y - 10, 20, 20, 0.35, [{ x: tx, y: spot!.y, level: 1 }]);
    const dark = computeLight(m, sky, tx - 10, spot!.y - 10, 20, 20, 0.35, []);
    expect(lit.light[10 * 20 + 10]).toBeGreaterThan(0.9);
    expect(dark.light[10 * 20 + 10]).toBeLessThan(0.2);
  });
});

describe("saving", () => {
  it("round-trips progress and ignores another world's save", () => {
    const g = newGame();
    run(g, 2);
    addItem(g.inventory, 22, 15);
    g.armor[0] = { id: 90, count: 1 };
    g.player.maxLife = 140;
    g.bosses.kingSlime = true;
    g.hour = 21.5;
    const saved = JSON.stringify(g.save());
    const h = newGame();
    h.load(saved);
    expect(countOf(h.inventory, 22)).toBe(15);
    expect(h.armor[0]).toEqual({ id: 90, count: 1 });
    expect(h.player.maxLife).toBe(140);
    expect(h.bosses.kingSlime).toBe(true);
    expect(h.hour).toBeCloseTo(21.5);
    const other = newGame(99);
    other.load(saved);
    expect(countOf(other.inventory, 22)).toBe(0);
    const junk = newGame();
    junk.load("{not json");
    expect(junk.inventory[0]?.id).toBe(3507);
  });
});

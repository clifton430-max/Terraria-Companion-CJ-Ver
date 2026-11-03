// Things in the world that aren't plain tiles: furniture and crafting stations (placed by you or
// the waifus, or generated with structures), chests with their loot, breakable pots, shadow
// orbs, demon altars, Queen Bee's larva, herbs, glowing mushrooms and life crystals. Everything is
// saved with the world; generated life crystals are a function of the seed minus those taken,
// and the rest of the generated objects are placed into the save the first time a world opens.

import { hash, HELL_TOP, T, WorldMap } from "../gen";
import { FURNITURE_TYPES, OBJECTS, type ObjectType } from "./furniture";
import { emptySlots, sanitizeSlots, type Slot, CHEST_SIZE, type Station } from "./inventory";

export { OBJECTS, type ObjectType } from "./furniture";

export interface WorldObject {
  t: ObjectType;
  /** Top-left tile. */
  x: number;
  y: number;
  /** Furniture style (theme), chest kind, pot biome, herb kind. */
  style?: number;
  /** Chest contents. */
  items?: Slot[];
  /** A loot table still to roll (generated chests, rolled when first opened). */
  loot?: string;
}

const CRYSTAL_BAND = 70;
const INDEX_BAND = 32;

export class ObjectLayer {
  placed: WorldObject[] = [];
  /** Generated crystals already taken (by band). */
  taken = new Set<number>();
  /** Structure furniture, pots and herbs have been placed (once per world). */
  furnished = false;
  private crystalCache = new Map<number, WorldObject | null>();
  private index = new Map<number, WorldObject[]>();
  private indexDirty = true;

  constructor(private readonly map: WorldMap) {}

  load(raw: readonly unknown[], taken: readonly number[], furnished = false) {
    this.placed = [];
    for (const o of raw) {
      if (!o || typeof o !== "object") continue;
      const v = o as Partial<WorldObject>;
      if (!v.t || !(FURNITURE_TYPES as string[]).includes(v.t) || v.t === "crystal" || !Number.isInteger(v.x) || !Number.isInteger(v.y)) continue;
      const style = Number.isInteger(v.style) && v.style! >= 0 && v.style! < 64 ? v.style : undefined;
      const storage = OBJECTS[v.t].storage;
      this.placed.push({
        t: v.t,
        x: v.x!,
        y: v.y!,
        ...(style ? { style } : {}),
        ...(storage ? { items: sanitizeSlots(v.items, CHEST_SIZE) } : {}),
        ...(typeof v.loot === "string" && v.loot.length < 20 ? { loot: v.loot } : {}),
      });
    }
    this.taken = new Set(taken);
    this.furnished = furnished;
    this.crystalCache.clear();
    this.indexDirty = true;
  }

  serialize(): unknown[] {
    return this.placed.map((o) => {
      const out: Record<string, unknown> = { t: o.t, x: o.x, y: o.y };
      if (o.style) out.style = o.style;
      if (o.items && o.items.some(Boolean)) out.items = o.items;
      if (o.loot) out.loot = o.loot;
      return out;
    });
  }

  private reindex() {
    this.index.clear();
    for (const o of this.placed) {
      const d = OBJECTS[o.t];
      for (let b = Math.floor(o.x / INDEX_BAND); b <= Math.floor((o.x + d.w - 1) / INDEX_BAND); b++) {
        let list = this.index.get(b);
        if (!list) this.index.set(b, (list = []));
        list.push(o);
      }
    }
    this.indexDirty = false;
  }

  /** Call after changing `placed` directly. */
  touch() {
    this.indexDirty = true;
  }

  /**
   * One life crystal per 70-column band, on a cave floor well below the surface (if the band has
   * one). Deterministic from the seed.
   */
  crystalInBand(band: number): WorldObject | null {
    if (this.taken.has(band)) return null;
    if (this.crystalCache.has(band)) return this.crystalCache.get(band)!;
    const m = this.map;
    let found: WorldObject | null = null;
    const x = band * CRYSTAL_BAND + 5 + Math.floor(hash(m.seed + 50, band) * (CRYSTAL_BAND - 10));
    if (x > 2 && x < m.size.width - 3 && hash(m.seed + 51, band) < 0.75) {
      const start = m.surface(x) + 35;
      for (let y = start; y < Math.min(HELL_TOP - 10, start + 260); y++) {
        // A 2×2 pocket of air resting on two solid tiles.
        if (!m.standable(x, y) && !m.standable(x + 1, y) && !m.standable(x, y - 1) && !m.standable(x + 1, y - 1) && m.solid(x, y + 1) && m.solid(x + 1, y + 1)) {
          found = { t: "crystal", x, y: y - 1 };
          break;
        }
      }
    }
    this.crystalCache.set(band, found);
    return found;
  }

  /** Everything overlapping tiles x0..x1, y0..y1 (placed + generated crystals). */
  inRect(x0: number, y0: number, x1: number, y1: number): WorldObject[] {
    if (this.indexDirty) this.reindex();
    const out: WorldObject[] = [];
    const seen = new Set<WorldObject>();
    for (let b = Math.floor((x0 - 3) / INDEX_BAND); b <= Math.floor(x1 / INDEX_BAND); b++) {
      for (const o of this.index.get(b) ?? []) {
        if (seen.has(o)) continue;
        seen.add(o);
        const d = OBJECTS[o.t];
        if (o.x <= x1 && o.x + d.w - 1 >= x0 && o.y <= y1 && o.y + d.h - 1 >= y0) out.push(o);
      }
    }
    for (let b = Math.floor((x0 - 2) / CRYSTAL_BAND); b <= Math.floor(x1 / CRYSTAL_BAND); b++) {
      const c = this.crystalInBand(b);
      if (c && c.x <= x1 && c.x + 1 >= x0 && c.y <= y1 && c.y + 1 >= y0) out.push(c);
    }
    return out;
  }

  at(x: number, y: number): WorldObject | undefined {
    return this.inRect(x, y, x, y)[0];
  }

  /** Is (x, y) occupied by a door (doors close off rooms for housing)? */
  doorAt(x: number, y: number): boolean {
    return this.inRect(x, y, x, y).some((o) => o.t === "door");
  }

  /** Can `t` go with its top-left at (x, y)? Needs room and the right support. */
  canPlace(t: ObjectType, x: number, y: number): boolean {
    const d = OBJECTS[t];
    const m = this.map;
    for (let dx = 0; dx < d.w; dx++) for (let dy = 0; dy < d.h; dy++) if (m.standable(x + dx, y + dy) || m.liquid(x + dx, y + dy)) return false;
    if (this.inRect(x, y, x + d.w - 1, y + d.h - 1).length) return false;
    return this.supported(t, x, y);
  }

  /** Can `t` stand on (x, y)? Any floor will do, and a small piece (a bottle, a candle) can go on a table top. */
  standsOn(t: ObjectType, x: number, y: number): boolean {
    if (this.map.standable(x, y)) return true;
    const d = OBJECTS[t];
    if ((d.w > 1 || d.h > 1) && !d.tabletop) return false;
    return this.inRect(x, y, x, y).some((o) => o.y === y && !!OBJECTS[o.t].roles?.includes("table"));
  }

  private supported(t: ObjectType, x: number, y: number): boolean {
    const d = OBJECTS[t];
    const m = this.map;
    switch (d.support) {
      case "floor":
        for (let dx = 0; dx < d.w; dx++) if (!this.standsOn(t, x + dx, y + d.h)) return false;
        return true;
      case "ceiling":
        // Hung from a block or a platform (like Terraria's chandeliers).
        for (let dx = 0; dx < d.w; dx++) if (!m.standable(x + dx, y - 1)) return false;
        return true;
      case "door":
        return m.solid(x, y - 1) && m.solid(x, y + d.h);
      case "wall":
        if (t === "torch") return m.standable(x, y + 1) || m.solid(x - 1, y) || m.solid(x + 1, y) || m.wall(x, y) > 0 || y > m.surface(x) + 1;
        for (let dx = 0; dx < d.w; dx++) for (let dy = 0; dy < d.h; dy++) if (!m.wall(x + dx, y + dy)) return false;
        return true;
      default:
        return true;
    }
  }

  place(t: ObjectType, x: number, y: number, style = 0): WorldObject | null {
    if (!this.canPlace(t, x, y)) return null;
    const o: WorldObject = { t, x, y, ...(style ? { style } : {}), ...(OBJECTS[t].storage ? { items: emptySlots(CHEST_SIZE) } : {}) };
    this.placed.push(o);
    this.indexDirty = true;
    return o;
  }

  /** Remove an object; returns false if it can't be taken (chests must be empty, like Terraria). */
  remove(o: WorldObject): boolean {
    if (OBJECTS[o.t].storage && o.items?.some(Boolean)) return false;
    if (o.t === "crystal") {
      this.taken.add(Math.floor(o.x / CRYSTAL_BAND));
      this.crystalCache.delete(Math.floor(o.x / CRYSTAL_BAND));
      return true;
    }
    const i = this.placed.indexOf(o);
    if (i < 0) return false;
    this.placed.splice(i, 1);
    this.indexDirty = true;
    return true;
  }

  /** Objects whose support was dug away fall (are removed and dropped). Only those near a changed tile, if given. */
  unsupported(near?: { x: number; y: number }): WorldObject[] {
    const list = near ? this.inRect(near.x - 4, near.y - 6, near.x + 4, near.y + 2).filter((o) => o.t !== "crystal") : this.placed;
    return list.filter((o) => OBJECTS[o.t].support !== "any" && !this.supported(o.t, o.x, o.y));
  }

  /** Crafting stations within reach of a point (tiles). */
  stationsNear(px: number, py: number, rx = 5, ry = 4): Set<Station> {
    const out = new Set<Station>();
    for (const o of this.inRect(Math.floor(px - rx), Math.floor(py - ry), Math.ceil(px + rx), Math.ceil(py + ry))) {
      const s = OBJECTS[o.t].station;
      if (s) out.add(s);
    }
    return out;
  }

  /**
   * Place everything generated with the world that lives in the save from then on: structure
   * furniture and loot chests, pots in caves, herbs, glowing mushrooms. Runs once per world.
   */
  furnish() {
    if (this.furnished) return;
    const m = this.map;
    const add = (o: WorldObject) => {
      const d = OBJECTS[o.t];
      for (let dx = 0; dx < d.w; dx++) for (let dy = 0; dy < d.h; dy++) if (m.standable(o.x + dx, o.y + dy)) return;
      if (this.inRect(o.x, o.y, o.x + d.w - 1, o.y + d.h - 1).length) return;
      this.placed.push(d.storage ? { ...o, items: emptySlots(CHEST_SIZE) } : o);
      this.indexDirty = true;
    };
    for (const s of m.structures) for (const g of s.objects) if ((FURNITURE_TYPES as string[]).includes(g.t)) add({ t: g.t as ObjectType, x: g.x, y: g.y, ...(g.style ? { style: g.style } : {}), ...(g.loot ? { loot: g.loot } : {}) });
    const seed = m.seed;
    // Pots: a few per band on cave floors (styled by where they are), with loot rolled when smashed.
    for (let band = 0; band * 40 < m.size.width; band++) {
      for (let k = 0; k < 3; k++) {
        const x = band * 40 + Math.floor(hash(seed + 90, band, k) * 38);
        if (x < 3 || x > m.size.width - 4) continue;
        const start = m.surface(x) + 15 + Math.floor(hash(seed + 91, band, k) * 140);
        for (let y = start; y < Math.min(m.size.height - 6, start + 120); y++) {
          if (!m.standable(x, y) && !m.standable(x + 1, y) && !m.standable(x, y - 1) && !m.standable(x + 1, y - 1) && m.solid(x, y + 1) && m.solid(x + 1, y + 1) && !m.liquid(x, y)) {
            const zone = m.zone(x, y);
            const row = zone === "snow" ? 1 : zone === "jungle" || zone === "hive" ? 2 : zone === "dungeon" ? 3 : zone === "underworld" ? 4 : zone === "corruption" ? 5 : 0;
            add({ t: "pot", x, y: y - 1, style: row * 3 + Math.floor(hash(seed + 92, band, k) * 3), loot: "pot" });
            break;
          }
        }
      }
    }
    // Herbs on the surface (and fireblossom in the underworld), by biome.
    for (let x = 4; x < m.size.width - 4; x++) {
      if (hash(seed + 93, x) > 0.06) continue;
      const top = m.surface(x);
      const ground = m.tile(x, top);
      const herb = ground === T.Grass ? 0 : ground === T.JungleGrass ? 1 : ground === T.CorruptGrass ? 3 : ground === T.Sand && m.biome(x) === "desert" ? 4 : ground === T.Snow ? 6 : -1;
      if (herb >= 0 && !m.tree(x)) add({ t: "herb", x, y: top - 1, style: herb });
      else if (ground === T.Grass && hash(seed + 97, x) < 0.5 && !m.tree(x)) add({ t: "mushroom", x, y: top - 1 });
      if (hash(seed + 94, x) < 0.25) {
        // A blinkroot underground, a fireblossom on the ash.
        for (let y = HELL_TOP + 10; y < HELL_TOP + 70; y++) {
          if (!m.standable(x, y) && m.tile(x, y + 1) === T.Ash) {
            add({ t: "herb", x, y, style: 5 });
            break;
          }
        }
      }
    }
    // Glowing mushrooms on mushroom grass.
    for (let x = 3; x < m.size.width - 3; x += 1) {
      if (hash(seed + 95, x) > 0.3) continue;
      for (let y = m.surface(x) + 40; y < Math.min(HELL_TOP, m.surface(x) + 200); y++) {
        if (m.tile(x, y + 1) === T.MushroomGrass && !m.standable(x, y)) {
          add({ t: "glowshroom", x, y, style: Math.floor(hash(seed + 96, x) * 5) });
          break;
        }
      }
    }
    this.furnished = true;
  }
}

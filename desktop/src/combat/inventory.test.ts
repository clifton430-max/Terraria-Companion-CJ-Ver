import { describe, expect, it } from "vitest";
import {
  HOTBAR_SIZE,
  SLOT_COUNT,
  cycle,
  defaultInventory,
  equip,
  equippedWeapon,
  fromSaved,
  matchesCategory,
  select,
  swap,
} from "./inventory";
import { DUMMY_PALETTE, DUMMY_ROWS, MINION_ROWS, MINION_SIZE } from "./sandboxArt";
import { shortcutFor } from "./shortcuts";
import { ART_SIZE, BASE_PALETTE, SHAPES, bowString } from "./weaponArt";
import { CATEGORY_OF, WEAPONS, categoryOf, getWeapon, manaCost, weaponStats } from "./weapons";

describe("inventory selection", () => {
  it("defaults to one weapon of each archetype on the hotbar, sword equipped", () => {
    const inv = defaultInventory();
    expect(inv.slots).toHaveLength(SLOT_COUNT);
    const kinds = inv.slots.slice(0, HOTBAR_SIZE).flatMap((id) => (id ? [getWeapon(id)!.kind] : []));
    expect(new Set(kinds)).toEqual(new Set(["sword", "bow", "gun", "staff", "summon"]));
    expect(equippedWeapon(inv)?.kind).toBe("sword");
  });

  it("select clamps to the hotbar", () => {
    const inv = defaultInventory();
    expect(select(inv, 3).selected).toBe(3);
    expect(select(inv, 42).selected).toBe(HOTBAR_SIZE - 1);
    expect(select(inv, -5).selected).toBe(0);
    expect(equippedWeapon(select(inv, 9))).toBeUndefined(); // empty slot
  });

  it("cycle skips empty slots and wraps in both directions", () => {
    const inv = defaultInventory(); // items in slots 0..8 (7 = Needle, 8 = Thread)
    expect(cycle(inv, 1).selected).toBe(1);
    expect(cycle(select(inv, 8), 1).selected).toBe(0);
    expect(cycle(inv, -1).selected).toBe(8);
    const empty = { slots: Array(SLOT_COUNT).fill(null), selected: 2 };
    expect(cycle(empty, 1)).toBe(empty);
  });

  it("swap exchanges two slots and ignores invalid indices", () => {
    const inv = defaultInventory();
    const swapped = swap(inv, 0, 10);
    expect(swapped.slots[0]).toBe("ember-blade");
    expect(swapped.slots[10]).toBe("rustic-sword");
    expect(swap(inv, 0, 99)).toBe(inv);
    expect(swap(inv, 3, 3)).toBe(inv);
  });

  it("equip moves a backpack weapon into the selected hotbar slot", () => {
    const inv = select(defaultInventory(), 2); // pistol equipped
    const next = equip(inv, 12); // scattergun
    expect(equippedWeapon(next)?.id).toBe("scattergun");
    expect(next.slots[12]).toBe("pocket-pistol");
    expect(equip(inv, 4).selected).toBe(4); // equipping a hotbar slot just selects it
  });

  it("fromSaved drops unknown ids and duplicates, and adds missing weapons", () => {
    const saved: (string | null)[] = Array(SLOT_COUNT).fill(null);
    saved[0] = "pine-bow";
    saved[1] = "pine-bow"; // duplicate
    saved[2] = "laser-sword-9000"; // unknown
    const inv = fromSaved(saved, 0);
    expect(inv.slots[0]).toBe("pine-bow");
    expect(inv.slots[1]).toBeNull();
    expect(inv.slots[2]).toBeNull();
    const present = inv.slots.filter(Boolean);
    expect(new Set(present).size).toBe(present.length);
    expect(present).toHaveLength(WEAPONS.length);
  });

  it("fromSaved falls back to the default layout and clamps the selection", () => {
    expect(fromSaved(null, 3)).toEqual({ ...defaultInventory(), selected: 3 });
    expect(fromSaved(undefined, 99).selected).toBe(HOTBAR_SIZE - 1);
  });

  it("category filters match weapon categories", () => {
    expect(matchesCategory("rustic-sword", "melee")).toBe(true);
    expect(matchesCategory("rustic-sword", "ranged")).toBe(false);
    expect(matchesCategory("pocket-pistol", "ranged")).toBe(true);
    expect(matchesCategory(null, "magic")).toBe(false);
    expect(matchesCategory(null, "all")).toBe(true);
  });
});

describe("weapon definitions", () => {
  it("have unique ids and cover all five archetypes", () => {
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    expect(new Set(WEAPONS.map((w) => w.kind))).toEqual(new Set(Object.keys(CATEGORY_OF)));
    for (const w of WEAPONS) expect(w.id).toMatch(/^[a-z0-9-]{1,48}$/); // accepted by prefs.rs
  });

  it("have sane timings and stats", () => {
    for (const w of WEAPONS) {
      expect(w.damage, w.id).toBeGreaterThan(0);
      expect(w.useTime, w.id).toBeGreaterThan(0);
      expect(w.crit, w.id).toBeGreaterThanOrEqual(0);
      expect(w.crit, w.id).toBeLessThan(1);
      if (w.kind === "bow") expect(w.drawTime, w.id).toBeLessThan(w.useTime);
      if (w.kind === "staff" || w.kind === "summon") {
        expect(w.castTime, w.id).toBeLessThan(w.useTime);
        expect(manaCost(w), w.id).toBeGreaterThan(0);
      } else {
        expect(manaCost(w), w.id).toBe(0);
      }
      if (w.kind === "sword") expect(w.activeFrom).toBeLessThan(w.activeTo);
    }
  });

  it("tooltips include damage, speed and archetype-specific lines", () => {
    const labels = (id: string) => weaponStats(getWeapon(id)!).map((l) => l.label);
    expect(labels("rustic-sword")).toEqual(expect.arrayContaining(["Damage", "Speed", "Knockback", "Reach"]));
    expect(labels("spark-wand")).toContain("Mana");
    expect(labels("wisp-lantern")).toContain("Upkeep");
    expect(weaponStats(getWeapon("scattergun")!)[0].value).toBe("6 × 4");
    expect(categoryOf(getWeapon("firefly-jar")!)).toBe("summon");
  });
});

describe("artwork data", () => {
  const known = new Set([...Object.keys(BASE_PALETTE), "a", "A", "w", "b", "B", "c"]);

  it("weapon shapes are 16×16 with grip and tip inside the art", () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      expect(shape.rows, name).toHaveLength(ART_SIZE);
      for (const row of shape.rows) {
        expect(row.length, `${name}: "${row}"`).toBe(ART_SIZE);
        for (const ch of row) expect(known.has(ch), `${name}: '${ch}'`).toBe(true);
      }
      for (const p of [shape.grip, shape.tip]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(ART_SIZE);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(ART_SIZE);
      }
    }
  });

  it("the bow string is pulled back as the draw progresses", () => {
    const rest = bowString(0);
    const drawn = bowString(1);
    expect(rest.every(([x]) => x === 4)).toBe(true);
    expect(Math.min(...drawn.map(([x]) => x))).toBeLessThan(4);
    expect(drawn).toHaveLength(rest.length);
  });

  it("dummy and minion sprites have consistent dimensions and palettes", () => {
    expect(DUMMY_ROWS).toHaveLength(24);
    for (const row of DUMMY_ROWS) {
      expect(row.length, row).toBe(16);
      for (const ch of row) expect(ch in DUMMY_PALETTE, ch).toBe(true);
    }
    expect(MINION_ROWS).toHaveLength(MINION_SIZE);
    for (const row of MINION_ROWS) expect(row.length, row).toBe(MINION_SIZE);
  });
});

describe("keyboard shortcuts", () => {
  it("maps keys to inventory and combat actions", () => {
    expect(shortcutFor({ key: "1" })).toEqual({ type: "select", slot: 0 });
    expect(shortcutFor({ key: "0" })).toEqual({ type: "select", slot: 9 });
    expect(shortcutFor({ key: "q" })).toEqual({ type: "cycle", delta: -1 });
    expect(shortcutFor({ key: "E" })).toEqual({ type: "cycle", delta: 1 });
    expect(shortcutFor({ key: "f" })).toEqual({ type: "attack" });
    expect(shortcutFor({ key: " " })).toEqual({ type: "attack" });
    expect(shortcutFor({ key: "ArrowLeft" })).toEqual({ type: "attack", dir: -1 });
    expect(shortcutFor({ key: "ArrowRight" })).toEqual({ type: "attack", dir: 1 });
    expect(shortcutFor({ key: "t" })).toEqual({ type: "training" });
    expect(shortcutFor({ key: "r" })).toEqual({ type: "reset" });
    expect(shortcutFor({ key: "x" })).toEqual({ type: "dismiss" });
    expect(shortcutFor({ key: "z" })).toBeNull();
    expect(shortcutFor({ key: "b" })).toEqual({ type: "boss" });
    expect(shortcutFor({ key: "L" })).toEqual({ type: "letters" });
  });

  it("leaves modified key presses (⌘Q, ⌃1…) to the system", () => {
    expect(shortcutFor({ key: "q", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "1", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "f", altKey: true })).toBeNull();
  });
});

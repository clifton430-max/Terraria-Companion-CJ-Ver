import { describe, expect, it } from "vitest";
import type { Prefs } from "../bridge";
import { defaultInventory, fromSaved, HOTBAR_SIZE, swap } from "../combat/inventory";
import {
  DOCK_WEAPONS,
  actionEffect,
  actionLabel,
  dockLayout,
  nextCursorMode,
  normalizeDock,
  weaponEffect,
} from "./model";

const dock = normalizeDock(null);
const base = { companionMode: "roam", cursorMode: "off", dock } as Pick<Prefs, "companionMode" | "cursorMode" | "dock">;

describe("dock actions", () => {
  it("boss uses the validated toggle command; the overlay decides summon vs dismiss", () => {
    expect(actionEffect("boss", base)).toEqual({ kind: "combat", action: "toggleBoss" });
    expect(actionLabel("boss", base, false)).toMatch(/Summon/);
    expect(actionLabel("boss", base, true)).toMatch(/Dismiss/);
  });

  it("toggles Stay-Put both ways", () => {
    expect(actionEffect("stay", base)).toEqual({ kind: "prefs", patch: { companionMode: "stay" } });
    expect(actionEffect("stay", { ...base, companionMode: "stay" })).toEqual({ kind: "prefs", patch: { companionMode: "roam" } });
  });

  it("cycles cursor modes off → ride → hug → become → off", () => {
    expect(["off", "ride", "hug", "become"].map((m) => nextCursorMode(m as never))).toEqual(["ride", "hug", "become", "off"]);
    expect(nextCursorMode("bogus" as never)).toBe("off"); // stale value: index -1 → first entry
    expect(actionEffect("cursor", { ...base, cursorMode: "hug" })).toEqual({ kind: "prefs", patch: { cursorMode: "become" } });
  });

  it("opens the inventory, collapses/expands and hides the dock via prefs", () => {
    expect(actionEffect("inventory", base)).toEqual({ kind: "showInventory" });
    expect(actionEffect("chat", base)).toEqual({ kind: "showChat" });
    expect(actionEffect("collapse", base)).toEqual({ kind: "prefs", patch: { dock: { expanded: false } } });
    expect(actionEffect("collapse", { ...base, dock: { ...dock, expanded: false } })).toEqual({ kind: "prefs", patch: { dock: { expanded: true } } });
    expect(actionEffect("close", base)).toEqual({ kind: "prefs", patch: { dock: { visible: false } } });
  });
});

describe("dock weapon slots", () => {
  it("offers the six Terraria weapons and both pickaxes", () => {
    expect(DOCK_WEAPONS).toEqual(["terra-blade", "nights-edge", "megashark", "daedalus-stormbow", "last-prism", "zenith", "copper-pickaxe", "picksaw"]);
  });

  it("equips the pickaxe from the dock like any weapon", () => {
    const effect = weaponEffect({ inventory: null, selectedSlot: 0 }, "copper-pickaxe");
    expect(effect).toEqual({ kind: "prefs", patch: { inventory: defaultInventory().slots, selectedSlot: 5 } });
  });

  it("equips a backpack weapon by swapping it into the selected hotbar slot", () => {
    const inv = defaultInventory();
    const effect = weaponEffect({ inventory: inv.slots, selectedSlot: 2 }, "zenith");
    expect(effect?.kind).toBe("prefs");
    const patch = (effect as { patch: { inventory: (string | null)[]; selectedSlot: number } }).patch;
    expect(patch.selectedSlot).toBe(2);
    expect(patch.inventory[2]).toBe("zenith");
    // Nothing lost: same multiset of items.
    expect([...patch.inventory].sort()).toEqual([...inv.slots].sort());
  });

  it("selects a weapon that's already on the hotbar without moving anything", () => {
    const inv = swap(defaultInventory(), 4, defaultInventory().slots.indexOf("megashark"));
    const effect = weaponEffect({ inventory: inv.slots, selectedSlot: 0 }, "megashark");
    expect(effect).toEqual({ kind: "prefs", patch: { inventory: inv.slots, selectedSlot: 4 } });
  });

  it("a fresh install's default inventory already contains every dock item", () => {
    for (const id of DOCK_WEAPONS) expect(defaultInventory().slots).toContain(id);
  });

  it("works with a never-saved inventory and ignores unknown or non-dock ids", () => {
    const effect = weaponEffect({ inventory: null, selectedSlot: 0 }, "last-prism");
    const inv = fromSaved((effect as { patch: { inventory: (string | null)[] } }).patch.inventory, 0);
    expect(inv.slots[0]).toBe("last-prism");
    expect(weaponEffect({ inventory: null, selectedSlot: 0 }, "not-a-weapon")).toBeNull();
    expect(weaponEffect({ inventory: null, selectedSlot: 0 }, "rustic-sword")).toBeNull();
    expect(HOTBAR_SIZE).toBe(10);
  });
});

describe("dock prefs and layout", () => {
  it("normalizes missing, stale or corrupt dock prefs", () => {
    expect(normalizeDock(undefined)).toEqual({ visible: true, onLaunch: "remember", expanded: true, layout: "full", position: null });
    expect(normalizeDock({ layout: "huge" as never, onLaunch: "x" as never, position: { x: NaN, y: 1 } })).toMatchObject({ layout: "full", onLaunch: "remember", position: null });
    expect(normalizeDock({ visible: false, expanded: false, layout: "compact", position: { x: 5, y: 6 } })).toMatchObject({ visible: false, expanded: false, layout: "compact", position: { x: 5, y: 6 } });
  });

  it("fits everything in one row on a normal screen", () => {
    const l = dockLayout({ availableWidth: 1440, layout: "full", expanded: true, slotCount: 7 });
    expect(l).toMatchObject({ columns: 7, rows: 1, actionsBelow: false, collapsed: false });
    expect(l.width).toBeLessThan(1440);
    const compact = dockLayout({ availableWidth: 1440, layout: "compact", expanded: true, slotCount: 6 });
    expect(compact.width).toBeLessThan(l.width);
    expect(compact.height).toBeLessThan(l.height);
  });

  it("adapts to narrow screens: actions move below, then slots wrap", () => {
    const mid = dockLayout({ availableWidth: 520, layout: "full", expanded: true, slotCount: 6 });
    expect(mid.actionsBelow).toBe(true);
    expect(mid.width).toBeLessThanOrEqual(520 - 32);
    const narrow = dockLayout({ availableWidth: 260, layout: "full", expanded: true, slotCount: 6 });
    expect(narrow.columns).toBeLessThan(6);
    expect(narrow.rows).toBe(Math.ceil(6 / narrow.columns));
    expect(narrow.height).toBeGreaterThan(mid.height);
  });

  it("collapses to a single slot and survives bad input", () => {
    const c = dockLayout({ availableWidth: 1440, layout: "full", expanded: false, slotCount: 6 });
    expect(c).toMatchObject({ collapsed: true, columns: 1, rows: 1 });
    const bad = dockLayout({ availableWidth: NaN, layout: "weird" as never, expanded: true, slotCount: -3 });
    expect(bad.columns).toBe(1);
    expect(Number.isFinite(bad.width) && Number.isFinite(bad.height)).toBe(true);
  });
});

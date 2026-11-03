// Pure inventory state: 50 slots holding weapon ids, the first 10 being the hotbar,
// plus the selected (equipped) hotbar slot. Persisted through Rust preferences.

import { WEAPONS, categoryOf, getWeapon, type Category, type WeaponDef } from "./weapons";

/** Must match `INVENTORY_SLOTS` / `HOTBAR_SLOTS` in `src-tauri/src/prefs.rs`. */
export const SLOT_COUNT = 50;
export const HOTBAR_SIZE = 10;

export interface InventoryState {
  slots: (string | null)[];
  /** Equipped hotbar slot, 0..HOTBAR_SIZE-1. */
  selected: number;
}

/** Hotbar gets one weapon per archetype; the stronger variants start in the backpack. */
const DEFAULT_LAYOUT: Record<number, string> = {
  0: "rustic-sword",
  1: "pine-bow",
  2: "pocket-pistol",
  3: "spark-wand",
  4: "wisp-lantern",
  5: "copper-pickaxe",
  6: "picksaw",
  // The Silksong Needle and Thread (their own attacks under Silksong Controls).
  7: "needle",
  8: "silk-thread",
  10: "ember-blade",
  11: "recurve-bow",
  12: "scattergun",
  13: "frost-staff",
  14: "firefly-jar",
  // End-game Terraria weapons get their own backpack row.
  20: "terra-blade",
  21: "nights-edge",
  22: "megashark",
  23: "daedalus-stormbow",
  24: "last-prism",
  25: "zenith",
  30: "meowmere",
  31: "sdmg",
  32: "celebration-mk2",
  33: "solar-eruption",
  34: "stardust-dragon-staff",
  35: "terraprisma",
  36: "vortex-beater",
  // Roster characters' signature weapons.
  40: "royal-scepter",
  41: "confetti-cannon",
  42: "syringe-toss",
  43: "fox-claws",
  44: "spiky-balls",
};

export function defaultInventory(): InventoryState {
  const slots: (string | null)[] = Array(SLOT_COUNT).fill(null);
  for (const [i, id] of Object.entries(DEFAULT_LAYOUT)) slots[Number(i)] = id;
  return { slots, selected: 0 };
}

const clampSlot = (i: number) => Math.min(Math.max(Math.trunc(i) || 0, 0), HOTBAR_SIZE - 1);

/**
 * Rebuild inventory state from saved preferences. Unknown ids and duplicates are dropped,
 * and any weapon missing from the saved layout (e.g. added in a later version) is placed
 * in the first free backpack slot so it is never lost.
 */
export function fromSaved(layout: readonly (string | null)[] | null | undefined, selected: number): InventoryState {
  if (!layout) return { ...defaultInventory(), selected: clampSlot(selected) };
  const seen = new Set<string>();
  const slots: (string | null)[] = Array(SLOT_COUNT).fill(null);
  layout.slice(0, SLOT_COUNT).forEach((id, i) => {
    if (id && getWeapon(id) && !seen.has(id)) {
      slots[i] = id;
      seen.add(id);
    }
  });
  for (const w of WEAPONS) {
    if (seen.has(w.id)) continue;
    let free = slots.indexOf(null, HOTBAR_SIZE);
    if (free < 0) free = slots.indexOf(null);
    if (free < 0) break;
    slots[free] = w.id;
    seen.add(w.id);
  }
  return { slots, selected: clampSlot(selected) };
}

export function select(state: InventoryState, slot: number): InventoryState {
  return { ...state, selected: clampSlot(slot) };
}

/** Move the selection to the next (delta > 0) or previous non-empty hotbar slot, wrapping. */
export function cycle(state: InventoryState, delta: 1 | -1): InventoryState {
  for (let step = 1; step <= HOTBAR_SIZE; step++) {
    const i = (state.selected + delta * step + HOTBAR_SIZE * 2) % HOTBAR_SIZE;
    if (state.slots[i]) return { ...state, selected: i };
  }
  return state;
}

export function swap(state: InventoryState, a: number, b: number): InventoryState {
  if (a === b || a < 0 || b < 0 || a >= SLOT_COUNT || b >= SLOT_COUNT) return state;
  const slots = [...state.slots];
  [slots[a], slots[b]] = [slots[b], slots[a]];
  return { ...state, slots };
}

/** Put the item in `from` into the equipped hotbar slot (swapping) and keep it selected. */
export function equip(state: InventoryState, from: number): InventoryState {
  if (from < HOTBAR_SIZE) return select(state, from);
  return swap(state, from, state.selected);
}

/**
 * Equip a weapon by id (the dock's slots): select it if it's on the hotbar, otherwise swap it
 * into the selected hotbar slot. Returns null for ids that aren't in the inventory (stale).
 */
export function equipById(state: InventoryState, id: string): InventoryState | null {
  const index = state.slots.indexOf(id);
  if (index < 0 || !getWeapon(id)) return null;
  return equip(state, index);
}

export function equippedWeapon(state: InventoryState): WeaponDef | undefined {
  return getWeapon(state.slots[state.selected]);
}

export function matchesCategory(id: string | null, category: Category | "all"): boolean {
  if (category === "all") return true;
  const def = getWeapon(id);
  return def !== undefined && categoryOf(def) === category;
}

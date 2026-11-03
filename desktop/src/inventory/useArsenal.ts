// The arsenal's state and controls, shared by the menu's Combat section and the notch's compact
// inventory (the pouch): the slots and selection from the prefs, filters, inspecting, drag-to-swap,
// training, and the arsenal's keys.

import { useCallback, useEffect, useMemo, useState } from "react";
import { combatCommand, patchPrefs, type Prefs } from "../bridge";
import { HOTBAR_SIZE, SLOT_COUNT, cycle, defaultInventory, equip, fromSaved, select, swap, type InventoryState } from "../combat/inventory";
import { shortcutFor } from "../combat/shortcuts";
import { getWeapon, type Category } from "../combat/weapons";

export const FILTERS: (Category | "all")[] = ["all", "melee", "ranged", "magic", "summon"];

/** `keys`: the arsenal's shortcuts are live (its section or window is showing). */
export function useArsenal(prefs: Prefs | null, keys: boolean) {
  const [inv, setInv] = useState<InventoryState>(defaultInventory);
  const [training, setTraining] = useState(false);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [inspected, setInspected] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  useEffect(() => {
    if (!prefs) return;
    setInv(fromSaved(prefs.inventory, prefs.selectedSlot));
    setTraining(prefs.training);
  }, [prefs]);

  /** Update locally and persist; Rust echoes the prefs to the overlay. */
  const commit = useCallback((next: InventoryState) => {
    setInv(next);
    patchPrefs({ inventory: next.slots, selectedSlot: next.selected }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      // (Esc belongs to the window: it closes it or goes back.)
      if (e.key === "Escape") return;
      // Typing in the character editor's fields must not trigger shortcuts.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Let Space/Enter activate a focused button normally.
      if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      switch (action.type) {
        case "select":
          commit(select(inv, action.slot));
          break;
        case "cycle":
          commit(cycle(inv, action.delta));
          break;
        case "attack":
          combatCommand("attack", action.dir).catch(() => {});
          break;
        case "training":
          patchPrefs({ training: !training }).catch(() => {});
          break;
        case "reset":
        case "dismiss":
          combatCommand(action.type).catch(() => {});
          break;
        case "boss":
          combatCommand("summonBoss").catch(() => {});
          break;
        case "letters":
          combatCommand("letterSmash").catch(() => {});
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inv, training, commit, keys]);

  const rows = useMemo(() => {
    const out: number[][] = [];
    for (let i = 0; i < SLOT_COUNT; i += HOTBAR_SIZE) {
      out.push(Array.from({ length: HOTBAR_SIZE }, (_, j) => i + j));
    }
    return out;
  }, []);

  const shownIndex = inspected ?? inv.selected;

  return {
    inv,
    training,
    filter,
    setFilter,
    inspected,
    setInspected,
    dragFrom,
    setDragFrom,
    commit,
    rows,
    shownIndex,
    shown: getWeapon(inv.slots[shownIndex]),
    equipped: getWeapon(inv.slots[inv.selected]),
    onSlotClick: (index: number) => {
      setInspected(index);
      if (index < HOTBAR_SIZE) commit(select(inv, index));
    },
    onDrop: (index: number) => {
      if (dragFrom !== null) commit(swap(inv, dragFrom, index));
      setDragFrom(null);
    },
    /** Double-click a backpack slot: onto the hotbar. */
    onSlotDouble: (index: number) => {
      if (index >= HOTBAR_SIZE && getWeapon(inv.slots[index])) commit(equip(inv, index));
    },
    equipShown: () => commit(equip(inv, shownIndex)),
    toggleTraining: () => patchPrefs({ training: !training }).catch(() => {}),
  };
}

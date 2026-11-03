// Inventory, stacks and crafting for the background-world game. Pure functions on plain data,
// so the HUD, the game loop, saving and tests all share them.

import { item, ITEMS } from "./items";

export interface Stack {
  id: number;
  count: number;
}

export type Slot = Stack | null;

export const INVENTORY_SIZE = 50;
export const HOTBAR = 10;
export const CHEST_SIZE = 40;

export const emptySlots = (n: number): Slot[] => Array.from({ length: n }, () => null);
export const maxStack = (id: number) => item(id)?.stack ?? 999;

/** Add items (filling existing stacks first, hotbar order). Returns what didn't fit. */
export function addItem(slots: Slot[], id: number, count: number): number {
  if (!ITEMS[id]) return count;
  const cap = maxStack(id);
  for (let i = 0; i < slots.length && count > 0; i++) {
    const s = slots[i];
    if (s && s.id === id && s.count < cap) {
      const n = Math.min(cap - s.count, count);
      s.count += n;
      count -= n;
    }
  }
  for (let i = 0; i < slots.length && count > 0; i++) {
    if (!slots[i]) {
      const n = Math.min(cap, count);
      slots[i] = { id, count: n };
      count -= n;
    }
  }
  return count;
}

export function countOf(slots: readonly Slot[], id: number): number {
  return slots.reduce((n, s) => (s && s.id === id ? n + s.count : n), 0);
}

/** Remove `count` items (from the end first, so the hotbar is used last). False if not enough. */
export function removeItem(slots: Slot[], id: number, count: number): boolean {
  if (countOf(slots, id) < count) return false;
  for (let i = slots.length - 1; i >= 0 && count > 0; i--) {
    const s = slots[i];
    if (!s || s.id !== id) continue;
    const n = Math.min(s.count, count);
    s.count -= n;
    count -= n;
    if (s.count <= 0) slots[i] = null;
  }
  return true;
}

/** Use one from a slot (potions, ammo, blocks). */
export function consumeAt(slots: Slot[], i: number): boolean {
  const s = slots[i];
  if (!s) return false;
  s.count--;
  if (s.count <= 0) slots[i] = null;
  return true;
}

/**
 * Terraria-style click on a slot with an item on the cursor: pick up, put down, merge stacks or
 * swap. Right-click (`one`) takes or puts a single item. Returns the new cursor.
 */
export function clickSlot(slots: Slot[], i: number, cursor: Slot, one = false): Slot {
  const s = slots[i];
  if (one) {
    if (!s) return cursor;
    if (cursor && cursor.id !== s.id) return cursor;
    if (cursor && cursor.count >= maxStack(cursor.id)) return cursor;
    s.count--;
    const next = cursor ? { ...cursor, count: cursor.count + 1 } : { id: s.id, count: 1 };
    if (s.count <= 0) slots[i] = null;
    return next;
  }
  if (!cursor) {
    slots[i] = null;
    return s;
  }
  if (s && s.id === cursor.id) {
    const room = maxStack(s.id) - s.count;
    const n = Math.min(room, cursor.count);
    s.count += n;
    const left = cursor.count - n;
    return left > 0 ? { id: cursor.id, count: left } : null;
  }
  slots[i] = cursor;
  return s;
}

// ── Crafting ────────────────────────────────────────────────────────────────────────────────

export { RECIPES, recipeFor, type Recipe, type Station } from "./recipes";
import { RECIPES, type Recipe, type Station } from "./recipes";

export const canCraft = (slots: readonly Slot[], r: Recipe, stations: ReadonlySet<Station>) =>
  (!r.station || stations.has(r.station)) && r.ingredients.every(([id, n]) => countOf(slots, id) >= n);

/** Recipes available here (a station nearby) and affordable now. */
export const craftable = (slots: readonly Slot[], stations: ReadonlySet<Station>) => RECIPES.filter((r) => canCraft(slots, r, stations));

/** Craft once: take the ingredients, give the result (or put it on the cursor). */
export function craft(slots: Slot[], r: Recipe, stations: ReadonlySet<Station>, cursor: Slot): { ok: boolean; cursor: Slot } {
  if (!canCraft(slots, r, stations)) return { ok: false, cursor };
  // The result goes onto the cursor like in Terraria (stacking with what's already held).
  if (cursor && (cursor.id !== r.result || cursor.count + r.count > maxStack(r.result))) return { ok: false, cursor };
  for (const [id, n] of r.ingredients) removeItem(slots, id, n);
  return { ok: true, cursor: cursor ? { id: r.result, count: cursor.count + r.count } : { id: r.result, count: r.count } };
}

export function sanitizeSlots(raw: unknown, n: number): Slot[] {
  const out = emptySlots(n);
  if (!Array.isArray(raw)) return out;
  raw.slice(0, n).forEach((s, i) => {
    if (s && typeof s === "object" && Number.isInteger((s as Stack).id) && Number.isInteger((s as Stack).count) && ITEMS[(s as Stack).id] && (s as Stack).count > 0) {
      out[i] = { id: (s as Stack).id, count: Math.min((s as Stack).count, maxStack((s as Stack).id)) };
    }
  });
  return out;
}

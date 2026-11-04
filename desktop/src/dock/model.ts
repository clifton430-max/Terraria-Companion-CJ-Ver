// Pure logic for the quick-action dock: which slots and buttons it shows, how big it is, and
// what each click does. Every effect goes through an existing validated path (patch_prefs,
// combat_command or the inventory window command) — the dock has no special powers.

import type { CombatAction, CursorMode, DockPrefs, Prefs, PrefsPatch } from "../bridge";
import { equipById, fromSaved, type InventoryState } from "../combat/inventory";
import { PICKAXE_ID, TERRARIA_WEAPON_IDS, getWeapon } from "../combat/weapons";

/** The items the dock offers, in hotbar order: the six Terraria weapons plus the two pickaxes. */
export const DOCK_WEAPONS: readonly string[] = [...TERRARIA_WEAPON_IDS, PICKAXE_ID, "picksaw"];

export type DockActionId = "boss" | "stay" | "cursor" | "chat" | "inventory";
export type DockControlId = "collapse" | "close";

export const DOCK_ACTIONS: readonly DockActionId[] = ["boss", "stay", "cursor", "chat", "inventory"];

/** Terraria texture per action button (each has a text fallback in the view). */
export const ACTION_ICONS: Record<DockActionId, string> = {
  boss: "Images/Item_43", // Suspicious Looking Eye
  stay: "Images/Item_224", // Bed
  cursor: "Images/UI/Cursor_0",
  chat: "Images/Item_149", // Book
  inventory: "Images/Item_48", // Chest
};

export type DockEffect =
  | { kind: "combat"; action: CombatAction }
  | { kind: "prefs"; patch: PrefsPatch }
  | { kind: "showInventory" }
  | { kind: "showChat" };

const CURSOR_CYCLE: readonly CursorMode[] = ["off", "ride", "hug", "become"];

export const CURSOR_LABEL: Record<CursorMode, string> = {
  off: "Off",
  ride: "Ride",
  hug: "Hold",
  become: "Become",
};

/** Off → Ride → Hug → Become → Off (unknown/stale values restart at Ride). */
export function nextCursorMode(mode: CursorMode): CursorMode {
  const i = CURSOR_CYCLE.indexOf(mode);
  return CURSOR_CYCLE[(i + 1) % CURSOR_CYCLE.length] ?? "ride";
}

/** What clicking an action or control does, given the current prefs and boss state. */
export function actionEffect(id: DockActionId | DockControlId, prefs: Pick<Prefs, "companionMode" | "cursorMode" | "dock">): DockEffect {
  switch (id) {
    case "boss":
      // The overlay knows whether a boss is fighting, so it decides summon vs dismiss.
      return { kind: "combat", action: "toggleBoss" };
    case "stay":
      return { kind: "prefs", patch: { companionMode: prefs.companionMode === "stay" ? "roam" : "stay" } };
    case "cursor":
      return { kind: "prefs", patch: { cursorMode: nextCursorMode(prefs.cursorMode) } };
    case "inventory":
      return { kind: "showInventory" };
    case "chat":
      return { kind: "showChat" };
    case "collapse":
      return { kind: "prefs", patch: { dock: { expanded: !prefs.dock.expanded } } };
    case "close":
      return { kind: "prefs", patch: { dock: { visible: false } } };
  }
}

/** Short label shown in the dock's name line / tooltip. */
export function actionLabel(id: DockActionId | DockControlId, prefs: Pick<Prefs, "companionMode" | "cursorMode" | "dock">, bossActive: boolean): string {
  switch (id) {
    case "boss":
      return bossActive ? "Dismiss the Eye of Cthulhu" : "Summon the Eye of Cthulhu";
    case "stay":
      return prefs.companionMode === "stay" ? "Stay put: on (click to roam)" : "Stay put: off (click to stay)";
    case "cursor":
      return `Cursor mode: ${CURSOR_LABEL[prefs.cursorMode] ?? "Off"} (click for ${CURSOR_LABEL[nextCursorMode(prefs.cursorMode)]})`;
    case "inventory":
      return "Open inventory & settings";
    case "chat":
      return "Chat with your companion (questions, or ask about your screen)";
    case "collapse":
      return prefs.dock.expanded ? "Collapse dock" : "Expand dock";
    case "close":
      return "Hide dock (tray → Show Dock)";
  }
}

/**
 * Equip a dock weapon through the normal inventory prefs. Returns null when the id isn't a
 * known weapon or isn't in the saved inventory (stale UI), so nothing is sent.
 */
export function weaponEffect(prefs: Pick<Prefs, "inventory" | "selectedSlot">, id: string): DockEffect | null {
  if (!DOCK_WEAPONS.includes(id) || !getWeapon(id)) return null;
  const next = equipById(fromSaved(prefs.inventory, prefs.selectedSlot), id);
  if (!next) return null;
  return { kind: "prefs", patch: { inventory: next.slots, selectedSlot: next.selected } };
}

/** Id of the equipped weapon (any weapon, not only the dock's six). */
export function equippedId(inv: InventoryState): string | null {
  return inv.slots[inv.selected] ?? null;
}

const DEFAULT_DOCK: DockPrefs = { visible: false, onLaunch: "remember", expanded: true, layout: "full", position: null };

/** Defensive copy of possibly missing/old dock prefs (e.g. a stale frontend or old file). */
export function normalizeDock(d: Partial<DockPrefs> | null | undefined): DockPrefs {
  if (!d || typeof d !== "object") return { ...DEFAULT_DOCK };
  return {
    visible: typeof d.visible === "boolean" ? d.visible : DEFAULT_DOCK.visible,
    onLaunch: d.onLaunch === "show" || d.onLaunch === "hide" ? d.onLaunch : "remember",
    expanded: typeof d.expanded === "boolean" ? d.expanded : DEFAULT_DOCK.expanded,
    layout: d.layout === "compact" ? "compact" : "full",
    position:
      d.position && Number.isFinite(d.position.x) && Number.isFinite(d.position.y) ? { x: d.position.x, y: d.position.y } : null,
  };
}

// ── Layout ─────────────────────────────────────────────────────────────────────────────────

export interface LayoutMetrics {
  slot: number;
  action: number;
  gap: number;
  pad: number;
  grip: number;
  /** Width of the collapse/close column. */
  controls: number;
  /** Height of the Terraria-style item-name line above the slots (0 = hidden). */
  nameLine: number;
}

export const METRICS: Record<"full" | "compact", LayoutMetrics> = {
  full: { slot: 44, action: 38, gap: 4, pad: 10, grip: 14, controls: 18, nameLine: 18 },
  compact: { slot: 34, action: 30, gap: 3, pad: 8, grip: 12, controls: 16, nameLine: 0 },
};

export interface DockLayoutResult {
  width: number;
  height: number;
  /** Slots per row and rows of slots. */
  columns: number;
  rows: number;
  /** Action buttons on their own row under the slots (narrow screens). */
  actionsBelow: boolean;
  collapsed: boolean;
  metrics: LayoutMetrics;
}

/** Edge gap kept free on each side of the screen. */
const SCREEN_MARGIN = 16;

/**
 * Size and arrangement for the dock: everything in one row when it fits, otherwise actions move
 * below the slots and then the slots wrap into more rows, down to one column.
 */
export function dockLayout(input: { availableWidth: number; layout: "full" | "compact"; expanded: boolean; slotCount: number }): DockLayoutResult {
  const m = METRICS[input.layout] ?? METRICS.full;
  const count = Math.max(1, Math.floor(input.slotCount) || 1);
  const avail = Number.isFinite(input.availableWidth) && input.availableWidth > 0 ? input.availableWidth : 1440;
  const max = Math.max(120, avail - SCREEN_MARGIN * 2);
  const span = (n: number, size: number) => n * size + Math.max(0, n - 1) * m.gap;
  const frame = m.pad * 2 + m.grip + m.gap + m.gap + m.controls; // grip … controls
  const actionsW = span(DOCK_ACTIONS.length, m.action);

  if (!input.expanded) {
    const width = frame + m.slot;
    const height = m.pad * 2 + Math.max(m.slot, m.controls * 2 + m.gap);
    return { width, height, columns: 1, rows: 1, actionsBelow: false, collapsed: true, metrics: m };
  }

  const oneRow = (cols: number) => frame + span(cols, m.slot) + m.gap * 3 + actionsW;
  const stacked = (cols: number) => frame + Math.max(span(cols, m.slot), actionsW);

  let columns = count;
  let actionsBelow = false;
  if (oneRow(count) > max) {
    actionsBelow = true;
    while (columns > 1 && stacked(columns) > max) columns--;
  }
  const rows = Math.ceil(count / columns);
  const width = actionsBelow ? stacked(columns) : oneRow(columns);
  const body = span(rows, m.slot) + (actionsBelow ? m.gap + m.action : 0);
  const height = m.pad * 2 + m.nameLine + Math.max(body, m.controls * 2 + m.gap);
  return { width, height, columns, rows, actionsBelow, collapsed: false, metrics: m };
}

// Keyboard shortcuts shared by the overlay (when focused) and the inventory window.

import type { Dir } from "../engine/physics";

export type ShortcutAction =
  | { type: "select"; slot: number }
  | { type: "cycle"; delta: 1 | -1 }
  | { type: "attack"; dir?: Dir }
  | { type: "training" }
  | { type: "reset" }
  | { type: "dismiss" }
  | { type: "boss" }
  | { type: "letters" };

export interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/**
 * Map a key press to a combat/inventory action, or null. Presses with ⌘, ⌃ or ⌥ are
 * ignored so system and app shortcuts (⌘Q, ⌘W…) keep working.
 */
export function shortcutFor(e: KeyInput): ShortcutAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (/^[0-9]$/.test(key)) return { type: "select", slot: key === "0" ? 9 : Number(key) - 1 };
  switch (key) {
    case "q":
    case "[":
      return { type: "cycle", delta: -1 };
    case "e":
    case "]":
      return { type: "cycle", delta: 1 };
    case "f":
    case " ":
      return { type: "attack" };
    case "ArrowLeft":
      return { type: "attack", dir: -1 };
    case "ArrowRight":
      return { type: "attack", dir: 1 };
    case "t":
      return { type: "training" };
    case "r":
      return { type: "reset" };
    case "x":
      return { type: "dismiss" };
    case "b":
      return { type: "boss" };
    case "l":
      return { type: "letters" };
    default:
      return null;
  }
}

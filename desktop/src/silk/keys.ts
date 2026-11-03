// Rebindable keys for Silksong Controls (single keys, as KeyboardEvent.code values).
// Mirrors the validation in prefs.rs. Arrow keys always work for movement as well.
// Down + a direction + attack in the air is the diagonal pogo; Dive (or Dash while holding down
// in the air) is the diagonal dive attack.

export type SilkAction = "left" | "right" | "up" | "down" | "jump" | "dash" | "attack" | "thread" | "grapple" | "dive";
export type SilkKeys = Record<SilkAction, string>;

export const SILK_ACTIONS: readonly SilkAction[] = ["left", "right", "up", "down", "jump", "dash", "attack", "thread", "grapple", "dive"];

export const SILK_ACTION_LABEL: Record<SilkAction, string> = {
  left: "Move left",
  right: "Move right",
  up: "Look / strike up",
  down: "Look / strike down",
  jump: "Jump (hold to glide)",
  dash: "Dash",
  attack: "Needle (hold to charge)",
  thread: "Thread spin",
  grapple: "Clawline grapple",
  dive: "Dive attack (in the air)",
};

export const DEFAULT_SILK_KEYS: SilkKeys = {
  left: "KeyA",
  right: "KeyD",
  up: "KeyW",
  down: "KeyS",
  jump: "Space",
  dash: "KeyK",
  attack: "KeyJ",
  thread: "KeyL",
  grapple: "KeyU",
  dive: "KeyO",
};

const ARROWS: Partial<Record<string, SilkAction>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const NAMED = ["Space", "ShiftLeft", "ShiftRight", "Enter", "Semicolon", "Quote", "Comma", "Period", "Slash", "BracketLeft", "BracketRight", "Backslash", "Backquote", "Minus", "Equal", "Tab"];

/** Keys that can be bound (Esc stays reserved for leaving Control mode). */
export function bindable(code: string): boolean {
  return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || NAMED.includes(code) || code in ARROWS;
}

/** Which action a key press triggers (bound keys first, then arrows for movement). */
export function actionFor(code: string, keys: SilkKeys): SilkAction | null {
  const bound = SILK_ACTIONS.find((a) => keys[a] === code);
  return bound ?? ARROWS[code] ?? null;
}

/** Valid, conflict-free bindings; anything broken falls back to the defaults. */
export function normalizeKeys(k: Partial<SilkKeys> | null | undefined): SilkKeys {
  const out = { ...DEFAULT_SILK_KEYS };
  if (!k) return out;
  const used = new Set<string>();
  for (const a of SILK_ACTIONS) {
    const code = k[a];
    if (typeof code === "string" && bindable(code) && !used.has(code)) out[a] = code;
    used.add(out[a]);
  }
  // A fallback default could collide with a user's binding; if so, use the defaults outright.
  return new Set(Object.values(out)).size === SILK_ACTIONS.length ? out : { ...DEFAULT_SILK_KEYS };
}

/** Rebind one action; a key already used elsewhere is swapped with it. */
export function rebind(keys: SilkKeys, action: SilkAction, code: string): SilkKeys {
  if (!bindable(code)) return keys;
  const other = SILK_ACTIONS.find((a) => a !== action && keys[a] === code);
  const next = { ...keys, [action]: code };
  if (other) next[other] = keys[action];
  return next;
}

/** Short display name for a key code. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const names: Record<string, string> = { Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  return names[code] ?? code;
}

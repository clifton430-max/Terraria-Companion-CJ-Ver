// Keyboard-shortcut capture and validation for the voice-input setting. Mirrors the Rust rules
// (`valid_shortcut` in prefs.rs): at least one of Control/Option/Command, plus one key.

export const DEFAULT_SHORTCUT = "Control+Shift+Space";
const MOD_ORDER = ["Control", "Option", "Command", "Shift"] as const;
const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backquote: "Backquote",
  Slash: "Slash",
  Period: "Period",
  Comma: "Comma",
  Semicolon: "Semicolon",
};

/** Well-known macOS system shortcuts the voice key must not take over. */
export const RESERVED = ["Command+Space", "Control+Space", "Command+Tab", "Command+Shift+3", "Command+Shift+4", "Command+Shift+5", "Control+Command+Space", "Option+Command+Space", "Command+Q", "Command+W"];

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** The key part of an event as an accelerator token, or null for modifier-only/unsupported keys. */
export function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|20)$/.test(code)) return code;
  return NAMED[code] ?? null;
}

/** Turn a key press into an accelerator string, or null if it isn't a usable shortcut yet. */
export function shortcutFromEvent(e: KeyLike): string | null {
  const key = keyToken(e.code);
  if (!key) return null;
  const mods = MOD_ORDER.filter((m) => (m === "Control" ? e.ctrlKey : m === "Option" ? e.altKey : m === "Command" ? e.metaKey : e.shiftKey));
  const s = [...mods, key].join("+");
  return isValidShortcut(s) ? s : null;
}

export function isValidShortcut(s: string): boolean {
  const parts = s.split("+");
  if (parts.length < 2 || parts.length > 5) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (new Set(mods).size !== mods.length || !mods.every((m) => (MOD_ORDER as readonly string[]).includes(m))) return false;
  if (!mods.some((m) => m !== "Shift")) return false;
  return /^[A-Z0-9]$/.test(key) || Object.values(NAMED).includes(key) || /^F([1-9]|1[0-9]|20)$/.test(key);
}

/** A reason the shortcut shouldn't be used, or null. */
export function shortcutProblem(s: string): string | null {
  if (!isValidShortcut(s)) return "Use at least one of Control, Option or Command plus a key.";
  if (RESERVED.includes(s)) return "That's a macOS system shortcut; pick another.";
  return null;
}

/** Display form with Mac symbols, e.g. "⌃⇧Space". */
export function prettyShortcut(s: string): string {
  const sym: Record<string, string> = { Control: "⌃", Option: "⌥", Command: "⌘", Shift: "⇧" };
  return s
    .split("+")
    .map((p) => sym[p] ?? p)
    .join("");
}

/** Default for the Control-mode toggle (mirrors DEFAULT_CONTROL_SHORTCUT in prefs.rs). */
export const DEFAULT_CONTROL_SHORTCUT = "Control+Shift+C";

/** A reason `s` can't be used given another active shortcut (`other`), or null. */
export function shortcutConflict(s: string, other: string | null): string | null {
  const basic = shortcutProblem(s);
  if (basic) return basic;
  if (other && other === s) return "That's already used by another companion shortcut.";
  return null;
}

/** Another shortcut the companion uses: its name and where to change it (for conflict messages). */
export interface OtherShortcut {
  name: string;
  value: string;
  where: string;
}

/** Every active companion shortcut except `except` (by name). */
export function appShortcuts(
  p: {
    voiceInput: { enabled: boolean; shortcut: string };
    control: { toggleEnabled: boolean; toggleShortcut: string };
    build: { toggleEnabled: boolean; toggleShortcut: string };
    lines: { toggleEnabled: boolean; toggleShortcut: string };
    persona: { cookieEnabled: boolean; cookieShortcut: string };
  },
  except: string,
): OtherShortcut[] {
  const all: (OtherShortcut & { on: boolean })[] = [
    { name: "Voice input", value: p.voiceInput.shortcut, where: "Awareness → Assistant & voice input", on: p.voiceInput.enabled },
    { name: "Control mode", value: p.control.toggleShortcut, where: "Companion → Control mode", on: p.control.toggleEnabled },
    { name: "Build mode", value: p.build.toggleShortcut, where: "Companion → Build mode", on: p.build.toggleEnabled },
    { name: "Platform editing", value: p.lines.toggleShortcut, where: "Companion → Invisible platforms", on: p.lines.toggleEnabled },
    { name: "Cookie", value: p.persona.cookieShortcut, where: "Companion → Personality & affection", on: p.persona.cookieEnabled },
  ];
  return all.filter((o) => o.on && o.name !== except).map(({ name, value, where }) => ({ name, value, where }));
}

/** Why `s` can't be used, with how to fix it (taken by another companion shortcut or macOS), or null. */
export function shortcutConflictWith(s: string, others: readonly OtherShortcut[]): string | null {
  const basic = shortcutProblem(s);
  if (basic) return basic;
  const clash = others.find((o) => o.value === s);
  if (clash) return `${prettyShortcut(s)} is already the ${clash.name} shortcut. Pick a different combination, or change ${clash.name} first (${clash.where}).`;
  return null;
}

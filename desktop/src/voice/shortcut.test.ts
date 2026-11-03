import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROL_SHORTCUT, DEFAULT_SHORTCUT, isValidShortcut, prettyShortcut, shortcutConflict, shortcutFromEvent, shortcutProblem } from "./shortcut";

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("voice shortcut", () => {
  it("captures key presses as ordered accelerators", () => {
    expect(shortcutFromEvent(ev("Space", { ctrlKey: true, shiftKey: true }))).toBe("Control+Shift+Space");
    expect(shortcutFromEvent(ev("KeyK", { metaKey: true, altKey: true }))).toBe("Option+Command+K");
    expect(shortcutFromEvent(ev("F5", { ctrlKey: true }))).toBe("Control+F5");
    expect(shortcutFromEvent(ev("Digit7", { altKey: true }))).toBe("Option+7");
  });

  it("ignores modifier-only presses, plain keys and Shift-only combos", () => {
    expect(shortcutFromEvent(ev("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(shortcutFromEvent(ev("KeyA"))).toBeNull();
    expect(shortcutFromEvent(ev("KeyA", { shiftKey: true }))).toBeNull();
    expect(shortcutFromEvent(ev("Escape", { ctrlKey: true }))).toBeNull();
  });

  it("validates like the Rust side and flags macOS system shortcuts", () => {
    expect(isValidShortcut(DEFAULT_SHORTCUT)).toBe(true);
    expect(shortcutProblem(DEFAULT_SHORTCUT)).toBeNull();
    expect(shortcutProblem("Command+Space")).toMatch(/system shortcut/);
    expect(shortcutProblem("Shift+Space")).toMatch(/at least one/);
    expect(isValidShortcut("Control+Control+K")).toBe(false);
    expect(isValidShortcut("Hyper+K")).toBe(false);
  });

  it("pretty-prints with Mac symbols", () => {
    expect(prettyShortcut("Control+Shift+Space")).toBe("⌃⇧Space");
  });
});

describe("control-mode toggle shortcut", () => {
  it("defaults to a valid combination that differs from the voice shortcut", () => {
    expect(shortcutProblem(DEFAULT_CONTROL_SHORTCUT)).toBeNull();
    expect(DEFAULT_CONTROL_SHORTCUT).not.toBe(DEFAULT_SHORTCUT);
    expect(prettyShortcut(DEFAULT_CONTROL_SHORTCUT)).toBe("⌃⇧C");
  });

  it("refuses the other companion shortcut, system shortcuts and invalid combos", () => {
    expect(shortcutConflict(DEFAULT_SHORTCUT, DEFAULT_SHORTCUT)).toMatch(/already used/);
    expect(shortcutConflict(DEFAULT_CONTROL_SHORTCUT, DEFAULT_SHORTCUT)).toBeNull();
    expect(shortcutConflict(DEFAULT_CONTROL_SHORTCUT, null)).toBeNull();
    expect(shortcutConflict("Command+Tab", null)).toMatch(/system/);
    expect(shortcutConflict("Shift+C", null)).toMatch(/at least one/);
  });
});

describe("shortcut conflicts across every companion shortcut", () => {
  it("names the clashing shortcut and where to change it", async () => {
    const { appShortcuts, shortcutConflictWith } = await import("./shortcut");
    const prefs = {
      voiceInput: { enabled: true, shortcut: "Control+Shift+Space" },
      control: { toggleEnabled: true, toggleShortcut: "Control+Shift+C" },
      build: { toggleEnabled: true, toggleShortcut: "Control+Shift+B" },
      lines: { toggleEnabled: false, toggleShortcut: "Control+Shift+P" },
      persona: { cookieEnabled: true, cookieShortcut: "Control+Shift+K" },
    };
    const others = appShortcuts(prefs, "Voice input");
    expect(others.map((o) => o.name)).toEqual(["Control mode", "Build mode", "Cookie"]); // disabled ones and itself excluded
    const why = shortcutConflictWith("Control+Shift+B", others)!;
    expect(why).toContain("Build mode");
    expect(why).toContain("Companion → Build mode");
    expect(shortcutConflictWith("Control+Shift+P", others)).toBeNull(); // platform editing is off
    expect(shortcutConflictWith("Command+Space", others)).toMatch(/macOS/);
    expect(shortcutConflictWith("Option+V", others)).toBeNull();
  });
});

describe("tap to talk", () => {
  it("with auto-submit, a quick tap keeps listening; a real hold is push-to-talk", async () => {
    const { voiceStep } = await import("./machine");
    const s = { enabled: true, mode: "hold" as const, review: false, autoSubmit: true };
    const down = voiceStep({ kind: "idle" }, { type: "keyDown", now: 10 }, s);
    expect(voiceStep(down.state, { type: "keyUp", now: 10.2 }, s).state.kind).toBe("listening");
    expect(voiceStep(down.state, { type: "keyUp", now: 12 }, s).effect).toBe("stopAndTranscribe");
    const noAuto = { ...s, autoSubmit: false };
    expect(voiceStep(down.state, { type: "keyUp", now: 10.2 }, noAuto).state.kind).toBe("error");
  });
});

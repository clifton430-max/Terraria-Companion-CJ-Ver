import { describe, expect, it } from "vitest";
import { DEFAULT_SILK_KEYS, SILK_ACTIONS, actionFor, bindable, keyLabel, normalizeKeys, rebind } from "./keys";

describe("Silksong keybinds", () => {
  it("has a complete, conflict-free default set", () => {
    expect(new Set(Object.values(DEFAULT_SILK_KEYS)).size).toBe(SILK_ACTIONS.length);
    for (const a of SILK_ACTIONS) expect(bindable(DEFAULT_SILK_KEYS[a])).toBe(true);
  });

  it("maps keys to actions, with arrows as movement aliases", () => {
    expect(actionFor("KeyJ", DEFAULT_SILK_KEYS)).toBe("attack");
    expect(actionFor("Space", DEFAULT_SILK_KEYS)).toBe("jump");
    expect(actionFor("ArrowLeft", DEFAULT_SILK_KEYS)).toBe("left");
    expect(actionFor("KeyZ", DEFAULT_SILK_KEYS)).toBeNull();
  });

  it("rebinding swaps keys instead of creating conflicts", () => {
    const k = rebind(DEFAULT_SILK_KEYS, "attack", "KeyK"); // K was dash
    expect(k.attack).toBe("KeyK");
    expect(k.dash).toBe("KeyJ");
    expect(rebind(DEFAULT_SILK_KEYS, "attack", "Escape")).toBe(DEFAULT_SILK_KEYS); // Esc stays reserved
  });

  it("repairs broken or stale saved bindings", () => {
    expect(normalizeKeys(null)).toEqual(DEFAULT_SILK_KEYS);
    expect(normalizeKeys({ attack: "Escape", dash: "MetaLeft" })).toEqual(DEFAULT_SILK_KEYS);
    expect(normalizeKeys({ attack: "KeyX" }).attack).toBe("KeyX");
    // Two actions on one key: the later one (in action order: dash before attack) falls back.
    const dup = normalizeKeys({ attack: "KeyX", dash: "KeyX" });
    expect(dup.dash).toBe("KeyX");
    expect(dup.attack).toBe(DEFAULT_SILK_KEYS.attack);
  });

  it("labels keys for display", () => {
    expect(keyLabel("KeyJ")).toBe("J");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("ShiftLeft")).toBe("L-Shift");
  });
});

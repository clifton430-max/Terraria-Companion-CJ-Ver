import { describe, expect, it } from "vitest";
import { plan, type Mods } from "./input";

const none: Mods = { shift: false, alt: false, ctrl: false, meta: false };

describe("forwarded desktop input", () => {
  it("a press, drag and release on the same spot: pointer events on what was pressed, then a click", () => {
    const down = plan({ t: "down", x: 10, y: 20, button: 0, mods: none }, null, true);
    expect(down).toEqual([expect.objectContaining({ on: "at", type: "pointerdown", init: expect.objectContaining({ clientX: 10, clientY: 20, button: 0, buttons: 1 }) })]);
    const move = plan({ t: "move", x: 15, y: 20, button: 0, mods: none }, 0, false);
    expect(move).toEqual([expect.objectContaining({ on: "pressed", type: "pointermove", init: expect.objectContaining({ buttons: 1, button: -1 }) })]);
    const up = plan({ t: "up", x: 15, y: 20, button: 0, mods: none }, 0, true);
    expect(up.map((p) => p.type)).toEqual(["pointerup", "click"]);
    expect(up[0].on).toBe("pressed");
  });

  it("no click when released somewhere else; a right release is a context menu", () => {
    expect(plan({ t: "up", x: 0, y: 0, button: 0, mods: none }, 0, false).map((p) => p.type)).toEqual(["pointerup"]);
    expect(plan({ t: "up", x: 0, y: 0, button: 2, mods: none }, 2, true).map((p) => p.type)).toEqual(["pointerup", "contextmenu"]);
  });

  it("hovering with nothing pressed goes to what's under the pointer", () => {
    const [p] = plan({ t: "move", x: 1, y: 1, button: 0, mods: none }, null, false);
    expect(p.on).toBe("at");
    expect(p.init.buttons).toBe(0);
  });

  it("wheel and keys keep their deltas, codes and modifiers", () => {
    const [w] = plan({ t: "wheel", x: 5, y: 6, dx: 0, dy: -12, mods: { ...none, shift: true } }, null, false);
    expect(w).toMatchObject({ type: "wheel", init: { deltaY: -12, deltaMode: 0, shiftKey: true } });
    const [k] = plan({ t: "keydown", code: "KeyW", key: "w", repeat: false, mods: none }, null, false);
    expect(k).toMatchObject({ on: "window", type: "keydown", init: { code: "KeyW", key: "w" } });
    expect(plan({ t: "blur" }, null, false)).toEqual([{ on: "window", type: "blur", init: {} }]);
  });
});

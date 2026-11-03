import { describe, expect, it } from "vitest";
import { menuItems, menuPosition, unionRect, type MenuState } from "./contextMenu";

const base: MenuState = { stay: false, rotating: true, pose: "stand", screenEnabled: false, voiceAvailable: false };

describe("character context menu", () => {
  it("offers every requested entry in order", () => {
    expect(menuItems(base).map((i) => i.id)).toEqual(["ask", "chat", "screen", "study", "voice", "stay", "pose", "settings", "close"]);
  });

  it("reflects Stay-Put and the current idle pose", () => {
    expect(menuItems(base).find((i) => i.id === "stay")!.label).toBe("Stay put here");
    const staying = menuItems({ ...base, stay: true, rotating: false, pose: "nap" });
    expect(staying.find((i) => i.id === "stay")).toMatchObject({ label: "Stop staying put", checked: true });
    const poses = staying.find((i) => i.id === "pose")!.children!;
    expect(poses.filter((p) => p.checked).map((p) => p.id)).toEqual(["pose-nap"]);
    expect(menuItems(base).find((i) => i.id === "pose")!.children!.find((p) => p.checked)!.id).toBe("pose-rotate");
  });

  it("voice input is disabled until enabled in settings; screen item explains how to enable it", () => {
    const voice = menuItems(base).find((i) => i.id === "voice")!;
    expect(voice.disabled).toBe(true);
    expect(voice.action).toBeNull();
    expect(menuItems(base).find((i) => i.id === "screen")!.hint).toMatch(/Awareness/);
    expect(menuItems({ ...base, voiceAvailable: true }).find((i) => i.id === "voice")!.action).toEqual({ type: "voice" });
  });

  it("anchors beside the character and stays on screen", () => {
    const size = { w: 200, h: 260 };
    const bounds = { width: 1440, height: 800 };
    expect(menuPosition({ x: 100, y: 400, w: 40, h: 84 }, size, bounds)).toEqual({ x: 150, y: 312 });
    const right = menuPosition({ x: 1380, y: 400, w: 40, h: 84 }, size, bounds);
    expect(right.x + size.w).toBeLessThanOrEqual(1380); // flipped to the left side
    const low = menuPosition({ x: 100, y: 760, w: 40, h: 84 }, size, bounds);
    expect(low.y + size.h).toBeLessThanOrEqual(bounds.height);
    const tiny = menuPosition({ x: 0, y: 0, w: 40, h: 84 }, size, { width: 150, height: 100 });
    expect(tiny.x).toBeGreaterThanOrEqual(0);
  });

  it("the interactive region covers both the character and the menu", () => {
    expect(unionRect({ x: 100, y: 400, w: 40, h: 84 }, { x: 150, y: 312, w: 200, h: 260 })).toEqual({ x: 100, y: 312, w: 250, h: 260 });
  });
});

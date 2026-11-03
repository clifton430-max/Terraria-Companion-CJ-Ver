import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, makeBody, step, type Body, type Platform } from "../engine/physics";
import { DROP_NUDGE, GRAB_PAD, JUMP_CUT, aimToward, applyFlight, applyJumpRelease, controlIntent, dropThrough, hitsBody, keyRole, lockFacing, noKeys, pressAction } from "./controls";

const bounds = { width: 800, height: 600 };
const ground = (): Body => makeBody(300, bounds, 40, 84);

describe("Control Character mode", () => {
  it("maps Terraria's default keys and arrows", () => {
    expect(["KeyA", "ArrowLeft"].map((c) => keyRole(c))).toEqual(["left", "left"]);
    expect(["KeyD", "ArrowRight"].map((c) => keyRole(c))).toEqual(["right", "right"]);
    expect(["Space", "KeyW", "ArrowUp"].map((c) => keyRole(c))).toEqual(["jump", "jump", "jump"]);
    expect(["KeyS", "ArrowDown"].map((c) => keyRole(c))).toEqual(["down", "down"]);
    expect(keyRole("KeyF")).toBeNull();
    expect(keyRole("Digit1")).toBeNull(); // hotbar keys stay with the shortcut map
  });

  it("turns held keys into a physics intent; opposite keys cancel; jump only from the ground", () => {
    expect(controlIntent({ ...noKeys(), right: true }, ground())).toEqual({ move: 1, jump: false });
    expect(controlIntent({ ...noKeys(), left: true, right: true }, ground()).move).toBe(0);
    expect(controlIntent({ ...noKeys(), jump: true }, ground()).jump).toBe(true);
    expect(controlIntent({ ...noKeys(), jump: true }, { ...ground(), grounded: false }).jump).toBe(false);
  });

  it("releasing jump early while rising gives a short hop", () => {
    const rising = { ...ground(), grounded: false, vy: -500 };
    expect(applyJumpRelease(rising, true, false).vy).toBeCloseTo(-500 * JUMP_CUT);
    expect(applyJumpRelease(rising, true, true).vy).toBe(-500);
    expect(applyJumpRelease({ ...rising, vy: 200 }, true, false).vy).toBe(200); // already falling
  });

  it("dropping through a window platform falls past it, but the floor is solid", () => {
    const onWindow: Body = { ...ground(), y: 300 - 84, grounded: true, platformId: 7 };
    const dropped = dropThrough(onWindow);
    expect(dropped).toMatchObject({ grounded: false, platformId: null, y: onWindow.y + DROP_NUDGE });
    // The one-way platform no longer catches the feet on the next physics step.
    const platforms = [{ id: 7, left: 0, right: 800, top: 300 }];
    expect(step(dropped, { move: 0, jump: false }, 1 / 60, bounds, undefined, platforms).body.platformId).toBeNull();
    expect(dropThrough(ground())).toEqual(ground()); // on the floor: nothing happens
  });

  it("aims toward the cursor", () => {
    expect(aimToward({ x: 100, y: 100 }, { x: 200, y: 100 })).toEqual({ dir: 1, angle: 0 });
    const left = aimToward({ x: 100, y: 100 }, { x: 0, y: 0 });
    expect(left.dir).toBe(-1);
    expect(left.angle).toBeCloseTo(-3 * Math.PI / 4);
  });
});

describe("Control mode flight (hold Space) and pick-up", () => {
  const cfg = DEFAULT_PHYSICS;
  const dt = 1 / 120;
  const fly = (b: Body, keys: ReturnType<typeof noKeys>, seconds: number, platforms: Platform[] = []) => {
    let flewAny = false;
    let maxY = -Infinity;
    for (let t = 0; t < seconds; t += dt) {
      const f = applyFlight(b, keys, dt, 320, cfg.gravity);
      flewAny ||= f.flying;
      const intent = f.flying ? { move: 0 as const, jump: false } : controlIntent(keys, f.body);
      b = step(f.body, intent, dt, bounds, cfg, platforms).body;
      maxY = Math.max(maxY, b.y);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(bounds.width);
    }
    return { b, flewAny, maxY };
  };

  it("holding Space jumps and then keeps climbing past a normal jump, hovering at the top", () => {
    const held = { ...noKeys(), jump: true };
    const { b, flewAny } = fly(ground(), held, 3);
    expect(flewAny).toBe(true);
    expect(b.y).toBeLessThan(1); // reached the top edge and hovers there
    expect(Math.abs(b.vy)).toBeLessThan(cfg.gravity * dt * 2);
  });

  it("releasing Space returns to normal gravity and lands on the floor", () => {
    let { b } = fly(ground(), { ...noKeys(), jump: true }, 0.6);
    const peak = b.y;
    expect(peak).toBeLessThan(bounds.height - 84 - 100);
    ({ b } = fly(b, noKeys(), 2));
    expect(b.grounded).toBe(true);
    expect(b.y).toBe(bounds.height - 84);
  });

  it("does nothing on the ground without Space, or when Space isn't held", () => {
    const b = ground();
    expect(applyFlight(b, { ...noKeys(), jump: true }, dt, 320, cfg.gravity).flying).toBe(false); // jump starts from the ground first
    expect(applyFlight({ ...b, grounded: false }, noKeys(), dt, 320, cfg.gravity).flying).toBe(false);
  });

  it("steers sideways while flying and stops at the screen edges", () => {
    const { b } = fly(ground(), { ...noKeys(), jump: true, right: true }, 4);
    expect(b.x + b.w).toBeCloseTo(bounds.width, 0);
    expect(b.facing).toBe(1);
  });

  it("flies up through a window top from below, and can land on it after releasing above it", () => {
    const platform: Platform = { id: 7, left: 200, right: 600, top: 300 };
    let { b } = fly(ground(), { ...noKeys(), jump: true }, 1.2, [platform]);
    expect(b.y + b.h).toBeLessThan(300); // passed above the one-way top
    ({ b } = fly(b, noKeys(), 2, [platform]));
    expect(b.grounded).toBe(true);
    expect(b.platformId).toBe(7);
    expect(b.y + b.h).toBe(300);
  });

  it("grabs only when the press is on (or right next to) the character", () => {
    const b = ground();
    expect(hitsBody(b, b.x + 5, b.y + 5)).toBe(true);
    expect(hitsBody(b, b.x - GRAB_PAD + 1, b.y)).toBe(true);
    expect(hitsBody(b, b.x - 40, b.y)).toBe(false);
    expect(hitsBody(b, b.x + 5, b.y + b.h + 30)).toBe(false);
  });
});

describe("press routing across modes", () => {
  it("normal mode: a press on the character picks it up; nothing else reaches the overlay", () => {
    expect(pressAction({ control: false, cursorMode: "off", onBody: true })).toBe("pickup");
    expect(pressAction({ control: false, cursorMode: "off", onBody: false })).toBe("ignore");
  });
  it("control mode: pick up on the character, attack elsewhere", () => {
    expect(pressAction({ control: true, cursorMode: "off", onBody: true })).toBe("pickup");
    expect(pressAction({ control: true, cursorMode: "off", onBody: false })).toBe("attack");
  });
  it("cursor modes never take presses", () => {
    for (const control of [false, true]) {
      expect(pressAction({ control, cursorMode: "ride", onBody: true })).toBe("ignore");
    }
  });
});

describe("moving while attacking (Control mode)", () => {
  const cfg = DEFAULT_PHYSICS;
  const dt = 1 / 60;
  /** One Control-mode step: walk/jump intent, physics, then facing locked to an attack (if any). */
  const stepWhileUsing = (b: Body, keys: ReturnType<typeof noKeys>, useDir: -1 | 1 | null) =>
    lockFacing(step(b, controlIntent(keys, b), dt, bounds, cfg).body, useDir);

  it("keeps walking during a swing, and the swing doesn't flip when walking the other way", () => {
    let b = ground();
    const startX = b.x;
    for (let i = 0; i < 30; i++) b = stepWhileUsing(b, { ...noKeys(), right: true }, -1);
    expect(b.x).toBeGreaterThan(startX + 10); // moved right
    expect(b.facing).toBe(-1); // still facing the attack
  });

  it("can jump while attacking", () => {
    let b = ground();
    b = stepWhileUsing(b, { ...noKeys(), jump: true }, 1);
    expect(b.grounded).toBe(false);
    expect(b.vy).toBeLessThan(0);
  });

  it("facing follows movement again once the attack ends", () => {
    let b = ground();
    for (let i = 0; i < 5; i++) b = stepWhileUsing(b, { ...noKeys(), left: true }, 1);
    expect(b.facing).toBe(1);
    b = stepWhileUsing(b, { ...noKeys(), left: true }, null);
    expect(b.facing).toBe(-1);
  });
});

describe("custom Terraria Controls keys", () => {
  it("use your bindings (and arrows always work)", async () => {
    const { keyRole, normalizeTerrariaKeys, rebindTerraria, DEFAULT_TERRARIA_KEYS } = await import("./controls");
    const keys = normalizeTerrariaKeys({ left: "KeyJ", right: "KeyL", jump: "KeyI", jump2: "KeyK", down: "Semicolon" });
    expect(keyRole("KeyJ", keys)).toBe("left");
    expect(keyRole("KeyA", keys)).toBeNull();
    expect(keyRole("KeyK", keys)).toBe("jump");
    expect(keyRole("ArrowLeft", keys)).toBe("left");
    expect(keyRole("Semicolon", keys)).toBe("down");
    // Rebinding to a key in use swaps the two.
    const swapped = rebindTerraria(DEFAULT_TERRARIA_KEYS, "left", "KeyD");
    expect(swapped.left).toBe("KeyD");
    expect(swapped.right).toBe("KeyA");
    // Duplicates and reserved keys fall back to the defaults.
    expect(normalizeTerrariaKeys({ left: "Escape", right: "KeyD" }).left).toBe("KeyA");
  });
});

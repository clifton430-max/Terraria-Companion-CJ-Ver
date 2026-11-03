// Pure helpers for "Control Character" mode: Terraria-style keyboard and mouse control.

import { isBlockId } from "../engine/blocks";
import type { Body, Dir, Intent } from "../engine/physics";

export interface HeldKeys {
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
}

export const noKeys = (): HeldKeys => ({ left: false, right: false, jump: false, down: false });

/** Rebindable Terraria Controls keys (KeyboardEvent.code values). Mirrors prefs.rs. */
export interface TerrariaKeys {
  left: string;
  right: string;
  jump: string;
  /** A second jump key. */
  jump2: string;
  down: string;
}

export const DEFAULT_TERRARIA_KEYS: TerrariaKeys = { left: "KeyA", right: "KeyD", jump: "Space", jump2: "KeyW", down: "KeyS" };
export const TERRARIA_ACTIONS = ["left", "right", "jump", "jump2", "down"] as const;
export const TERRARIA_ACTION_LABEL: Record<keyof TerrariaKeys, string> = {
  left: "Move left",
  right: "Move right",
  jump: "Jump (hold in the air to fly)",
  jump2: "Jump (second key)",
  down: "Drop through / down",
};

/** Valid, conflict-free bindings (bad or duplicate ones fall back to the defaults). */
export function normalizeTerrariaKeys(k: Partial<TerrariaKeys> | null | undefined): TerrariaKeys {
  const out = { ...DEFAULT_TERRARIA_KEYS };
  if (!k) return out;
  const used = new Set<string>();
  const ok = (c: unknown): c is string => typeof c === "string" && /^(Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight|Enter|Semicolon|Quote|Comma|Period|Slash|BracketLeft|BracketRight|Backslash|Backquote|Minus|Equal|Tab)$/.test(c);
  for (const a of TERRARIA_ACTIONS) {
    const code = k[a];
    if (ok(code) && !used.has(code)) out[a] = code;
    used.add(out[a]);
  }
  return new Set(Object.values(out)).size === TERRARIA_ACTIONS.length ? out : { ...DEFAULT_TERRARIA_KEYS };
}

/** Rebind one action; a key already used by another action is swapped with it. */
export function rebindTerraria(keys: TerrariaKeys, action: keyof TerrariaKeys, code: string): TerrariaKeys {
  const other = TERRARIA_ACTIONS.find((a) => a !== action && keys[a] === code);
  const next = { ...keys, [action]: code };
  if (other) next[other] = keys[action];
  return next;
}

/** Which movement a key controls (your bindings, plus the arrow keys). */
export function keyRole(code: string, keys: TerrariaKeys = DEFAULT_TERRARIA_KEYS): keyof HeldKeys | null {
  if (code === keys.left || code === "ArrowLeft") return "left";
  if (code === keys.right || code === "ArrowRight") return "right";
  if (code === keys.jump || code === keys.jump2 || code === "ArrowUp") return "jump";
  if (code === keys.down || code === "ArrowDown") return "down";
  return null;
}

/** Movement intent for the shared physics step; jumping only starts from the ground. */
export function controlIntent(keys: HeldKeys, body: Body): Intent {
  const move = ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) as -1 | 0 | 1;
  return { move, jump: keys.jump && body.grounded };
}

/** Fraction of upward speed kept when the jump key is released early (short hop). */
export const JUMP_CUT = 0.45;

/** Releasing jump while still rising shortens the jump, like Terraria's variable jump height. */
export function applyJumpRelease(body: Body, wasHeld: boolean, held: boolean): Body {
  if (wasHeld && !held && body.vy < 0) return { ...body, vy: body.vy * JUMP_CUT };
  return body;
}

/** Pixels to sink below a window top so the one-way platform no longer catches the feet. */
export const DROP_NUDGE = 3;

/** Pressing down while standing on a window drops through it (the floor can't be dropped through). */
export function dropThrough(body: Body): Body {
  // Placed blocks are solid: no dropping through them (invisible lines and windows are one-way).
  if (!body.grounded || body.platformId === null || isBlockId(body.platformId)) return body;
  return { ...body, grounded: false, platformId: null, y: body.y + DROP_NUDGE };
}

/** Facing and aim angle (screen radians) from a point toward the cursor. */
export function aimToward(from: { x: number; y: number }, cursor: { x: number; y: number }): { dir: Dir; angle: number } {
  const dx = cursor.x - from.x;
  const dy = cursor.y - from.y;
  return { dir: dx < 0 ? -1 : 1, angle: Math.atan2(dy, dx) };
}

/** How quickly powered flight reaches its target speed (CSS px/s²). */
export const FLIGHT_ACCEL = 2600;
/** Horizontal flight speed as a fraction of the climb speed. */
export const FLIGHT_SIDE_FRACTION = 0.75;

export interface FlightResult {
  body: Body;
  flying: boolean;
}

/**
 * Control mode: holding Space (the jump key) while airborne powers flight. It accelerates
 * upward to `flightSpeed` against gravity, steers left/right, and hovers at the top of the
 * usable area. Releasing hands the body back to normal gravity. Pre-compensates the physics
 * step's gravity so the net vertical change is exactly the flight acceleration.
 */
export function applyFlight(body: Body, keys: HeldKeys, dt: number, flightSpeed: number, gravity: number): FlightResult {
  if (!keys.jump || body.grounded || dt <= 0) return { body, flying: false };
  const approach = (v: number, target: number, step: number) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
  const atTop = body.y <= 0.5;
  const targetVy = atTop ? 0 : -Math.abs(flightSpeed);
  const vy = approach(body.vy, targetVy, FLIGHT_ACCEL * dt) - gravity * dt;
  const move = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const vx = approach(body.vx, move * Math.abs(flightSpeed) * FLIGHT_SIDE_FRACTION, FLIGHT_ACCEL * dt);
  return { body: { ...body, vx, vy, y: Math.max(0, body.y), facing: move !== 0 ? (move as Dir) : body.facing }, flying: true };
}

/** Padding (CSS px) around the body box that still counts as grabbing the character. */
export const GRAB_PAD = 6;

/** Whether a pointer press at (x, y) lands on the character (for pick-up in control mode). */
export function hitsBody(body: { x: number; y: number; w: number; h: number }, x: number, y: number, pad = GRAB_PAD): boolean {
  return x >= body.x - pad && x <= body.x + body.w + pad && y >= body.y - pad && y <= body.y + body.h + pad;
}

export type PressAction = "pickup" | "attack" | "ignore";

/**
 * What a primary-button press on the overlay does. Cursor modes never take presses (the overlay
 * is click-through then). Normal mode only receives presses on the character (pick up / click).
 * Control mode picks up when the press is on the character and attacks toward it otherwise.
 */
export function pressAction(m: { control: boolean; cursorMode: string; onBody: boolean }): PressAction {
  if (m.cursorMode !== "off") return "ignore";
  if (m.onBody) return "pickup";
  return m.control ? "attack" : "ignore";
}

/**
 * While an item is in use, keep facing the way it's being used (as in Terraria): you can walk,
 * jump or fly in any direction, but the swing or shot doesn't flip around mid-use.
 */
export function lockFacing<B extends { facing: Dir }>(body: B, useDir: Dir | null): B {
  return useDir === null || body.facing === useDir ? body : { ...body, facing: useDir };
}

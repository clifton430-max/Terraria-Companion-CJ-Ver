// Pure helpers for the companion's modes: Stay-Put homes and the visual cursor modes.

import type { Vec } from "../combat/geometry";
import type { Dir } from "../engine/physics";

export type CursorMode = "off" | "ride" | "hug" | "become";
import type { IdlePose } from "../bridge";
import { idleFrame } from "./idle";
export type { IdlePose };

/** Body box geometry inside the Terraria cell (see src-tauri/src/terraria/player.rs BODY_BOX). */
export interface CellGeometry {
  cellW: number;
  originX: number;
  originY: number;
  /** Hand position (cell px, right-facing) used by Hug/Become. */
  hand: Vec;
  /** Cell y of the hips in the sit/ride pose. */
  seatY: number;
}

/** Cell y of the hips in the Terraria sit/ride pose (upper body lowered 6 px). */
export const SEAT_Y = 44;
export const DEFAULT_CELL: CellGeometry = { cellW: 40, originX: 10, originY: 12, hand: { x: 27.5, y: 35 }, seatY: SEAT_Y };
/** The built-in 16×24 sprite (used when the Terraria art isn't available). */
export const LEGACY_CELL: CellGeometry = { cellW: 16, originX: 0, originY: 0, hand: { x: 14, y: 13 }, seatY: 17 };

export interface Anchor {
  /** Body box top-left, CSS px. */
  x: number;
  y: number;
  facing: Dir;
  /** Atlas frame to show. */
  frame: string;
}

/**
 * Where the character goes for a cursor mode.
 * Ride: sitting on the pointer. Hug: arms around it from the side facing the screen centre.
 * Become: drawn small with its pointing hand exactly on the hotspot.
 */
export function cursorAnchor(mode: Exclude<CursorMode, "off">, cursor: Vec, scale: number, screenWidth: number, cell: CellGeometry = DEFAULT_CELL): Anchor {
  switch (mode) {
    case "ride":
      return { x: cursor.x - (cell.cellW / 2 - cell.originX) * scale, y: cursor.y - (cell.seatY - cell.originY) * scale, facing: 1, frame: "ride" };
    case "hug": {
      const facing: Dir = cursor.x > screenWidth / 2 ? 1 : -1;
      const hx = facing > 0 ? cell.hand.x : cell.cellW - cell.hand.x;
      return { x: cursor.x - (hx - cell.originX) * scale, y: cursor.y - (cell.hand.y - cell.originY) * scale, facing, frame: "hug" };
    }
    case "become":
      return { x: cursor.x - (cell.hand.x - cell.originX) * scale, y: cursor.y - (cell.hand.y - cell.originY) * scale, facing: 1, frame: "shoot" };
  }
}

/** Frame-rate independent smoothing toward `target` (Become uses rate = Infinity → exact). */
export function followStep(current: Vec, target: Vec, dt: number, rate: number): Vec {
  if (!Number.isFinite(rate)) return { ...target };
  const k = 1 - Math.exp(-rate * dt);
  return { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k };
}

/** Smoothing rate per mode: riding/hugging trails the pointer slightly; Become is exact. */
export const FOLLOW_RATE: Record<Exclude<CursorMode, "off">, number> = { ride: 18, hug: 14, become: Infinity };

/** Body top-left for a saved Stay home (fractions of the usable screen). */
export function homeToPosition(home: { x: number; y: number }, bounds: { width: number; height: number }, w: number, h: number): Vec {
  // Stale or corrupt fractions are clamped, so the spot is always inside the usable area.
  const f = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
  return { x: f(home.x) * Math.max(0, bounds.width - w), y: f(home.y) * Math.max(0, bounds.height - h) };
}

/** Fractions (0..1) for persisting a Stay home. */
export function positionToHome(pos: Vec, bounds: { width: number; height: number }, w: number, h: number): { x: number; y: number } {
  const fx = bounds.width > w ? pos.x / (bounds.width - w) : 0;
  const fy = bounds.height > h ? pos.y / (bounds.height - h) : 0;
  return { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) };
}

/** Atlas frame for a Stay pose (see idle.ts for the full idle-pose logic). */
export function stayFrame(pose: IdlePose, t: number): string {
  return idleFrame(pose, t).frame;
}

/** Built-in-sprite animation to fall back to when the Terraria atlas isn't available. */
export function legacyAnimFor(frame: string): "idle" | "land" | "cast" | "shoot" | "fall" {
  if (frame === "sit" || frame === "sit2" || frame === "ride" || frame === "nap") return "land";
  if (frame.startsWith("wave")) return "cast";
  if (frame === "hug" || frame === "shoot") return "shoot";
  return "idle";
}

export type EffectiveMode = "control" | "cursor" | "stay" | "roam";

/** Which behaviour runs: Control Character beats the cursor modes, which beat Stay, which beats roaming. */
export function effectiveMode(m: { control: boolean; cursorMode: CursorMode; companionMode: "roam" | "stay" }): EffectiveMode {
  if (m.control) return "control";
  if (m.cursorMode !== "off") return "cursor";
  return m.companionMode === "stay" ? "stay" : "roam";
}

/** Stay-Put: walk back toward the home x after being knocked away (dead zone `tolerance`). */
export function stayMove(x: number, homeX: number, tolerance = 6): -1 | 0 | 1 {
  const dx = homeX - x;
  return Math.abs(dx) <= tolerance ? 0 : dx > 0 ? 1 : -1;
}

/** Leaving a cursor mode: release the character where it is so it falls back under physics. */
export function releaseFromCursor<B extends { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean; platformId: string | number | null }>(
  body: B,
  bounds: { width: number; height: number },
): B {
  const x = Math.min(Math.max(body.x, 0), Math.max(0, bounds.width - body.w));
  const y = Math.min(Math.max(body.y, 0), Math.max(0, bounds.height - body.h));
  return { ...body, x, y, vx: 0, vy: 0, grounded: false, platformId: null };
}

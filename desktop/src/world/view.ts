// Camera maths for the background world, and the bridge to the companions' physics: the visible
// terrain becomes the same platforms / walls / ceilings that placed blocks make, so the
// characters walk on the hills, step up ledges and drop into caves.

import type { Ceiling, Platform, Wall } from "../engine/physics";
import { T, WorldMap } from "./gen";

export const TILE_PX = 16;
/** Zoom steps keep a whole number of device pixels per tile (crisp, aligned). */
export const ZOOMS = [1, 1.5, 2, 2.5, 3, 4] as const;
export const DEFAULT_ZOOM = 2;

export const nearestZoom = (z: number) => ZOOMS.reduce((best, s) => (Math.abs(s - z) < Math.abs(best - z) ? s : best), DEFAULT_ZOOM as number);
export const tilePx = (zoom: number) => TILE_PX * nearestZoom(zoom);

export interface Camera {
  /** World tile at the left / top edge of the screen (fractional). */
  x: number;
  y: number;
}

/** Where the surface sits on screen by default (fraction of the height). */
export const SURFACE_ON_SCREEN = 0.74;

/** Centre of the world, with the surface three quarters of the way down the screen. */
export function defaultCamera(map: WorldMap, screenW: number, screenH: number, zoom: number): Camera {
  const tp = tilePx(zoom);
  const cx = Math.floor(map.size.width / 2);
  return clampCamera(map, { x: cx - screenW / tp / 2, y: map.surface(cx) - (screenH * SURFACE_ON_SCREEN) / tp }, screenW, screenH, zoom);
}

/** Keep the view inside the world, snapped so tiles land on whole device pixels. */
export function clampCamera(map: WorldMap, c: Camera, screenW: number, screenH: number, zoom: number, dpr = 1): Camera {
  const tp = tilePx(zoom);
  const maxX = Math.max(0, map.size.width - screenW / tp);
  const maxY = Math.max(0, map.size.height - screenH / tp);
  const snap = (v: number) => Math.round(v * tp * dpr) / (tp * dpr);
  return { x: snap(Math.min(maxX, Math.max(0, c.x))), y: snap(Math.min(maxY, Math.max(0, c.y))) };
}

/** Screen position of tile (x, y)'s top-left corner. */
export const tileToScreen = (c: Camera, zoom: number, x: number, y: number) => {
  const tp = tilePx(zoom);
  return { x: (x - c.x) * tp, y: (y - c.y) * tp };
};

export const screenToTile = (c: Camera, zoom: number, sx: number, sy: number) => {
  const tp = tilePx(zoom);
  return { x: Math.floor(c.x + sx / tp), y: Math.floor(c.y + sy / tp) };
};

/** Platform ids for terrain: tops −5 000 000…, walls −9 000 000… (blocks and lines use other ranges). */
export const TERRAIN_TOP_BASE = -5_000_000;
export const TERRAIN_WALL_BASE = -9_000_000;
/** Platform tiles use the invisible-line range (≤ −10 000 000): one-way, drop-through. */
export const TERRAIN_PLATFORM_BASE = -20_000_000;
export const isTerrainId = (id: number | null) => id !== null && id <= TERRAIN_TOP_BASE && id > -10_000_000;

export interface TerrainSurfaces {
  platforms: Platform[];
  walls: Wall[];
  ceilings: Ceiling[];
}

/**
 * Physics surfaces for the terrain visible in the overlay. `off` is where the overlay sits on
 * the display (its top-left, e.g. below the menu bar); `view` its size.
 */
export function terrainSurfaces(map: WorldMap, cam: Camera, zoom: number, off: { x: number; y: number }, view: { width: number; height: number }): TerrainSurfaces {
  const tp = tilePx(zoom);
  const c0 = Math.floor(cam.x + off.x / tp) - 1;
  const c1 = Math.ceil(cam.x + (off.x + view.width) / tp) + 1;
  const r0 = Math.floor(cam.y + off.y / tp) - 1;
  const r1 = Math.ceil(cam.y + (off.y + view.height) / tp) + 1;
  const sx = (x: number) => (x - cam.x) * tp - off.x;
  const sy = (y: number) => (y - cam.y) * tp - off.y;
  const solid = (x: number, y: number) => map.solid(x, y);
  const platforms: Platform[] = [];
  const walls: Wall[] = [];
  const ceilings: Ceiling[] = [];
  const topId = new Map<number, number>(); // tile key → id of the top run it belongs to
  const k = (x: number, y: number) => y * 65536 + x;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!solid(c, r) || solid(c, r - 1)) continue;
      const start = c;
      while (c + 1 <= c1 && solid(c + 1, r) && !solid(c + 1, r - 1)) c++;
      const id = TERRAIN_TOP_BASE - (r * map.size.width + start);
      for (let x = start; x <= c; x++) topId.set(k(x, r), id);
      platforms.push({ id, left: sx(start), right: sx(c + 1), top: sy(r) });
    }
    // Platform tiles: one-way ledges (ids in the line range, so companions can drop through).
    for (let c = c0; c <= c1; c++) {
      if (map.tile(c, r) !== T.Platform || map.standable(c, r - 1)) continue;
      const start = c;
      while (c + 1 <= c1 && map.tile(c + 1, r) === T.Platform && !map.standable(c + 1, r - 1)) c++;
      platforms.push({ id: TERRAIN_PLATFORM_BASE - (r * map.size.width + start), left: sx(start), right: sx(c + 1), top: sy(r) });
    }
    for (let c = c0; c <= c1; c++) {
      if (!solid(c, r) || solid(c, r + 1)) continue;
      const start = c;
      while (c + 1 <= c1 && solid(c + 1, r) && !solid(c + 1, r + 1)) c++;
      ceilings.push({ left: sx(start), right: sx(c + 1), y: sy(r + 1) });
    }
  }
  let w = 0;
  for (const side of [-1, 1] as const) {
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        if (!solid(c, r) || solid(c + side, r)) continue;
        // A vertical run of faces open on this side; `top` is its highest tile.
        const top = r;
        while (r + 1 <= r1 && solid(c, r + 1) && !solid(c + side, r + 1)) r++;
        walls.push({
          id: TERRAIN_WALL_BASE - w++,
          x: sx(side < 0 ? c : c + 1),
          top: sy(top),
          bottom: sy(r + 1),
          solid: true,
          step: tp,
          liftTo: topId.get(k(c, top)),
        });
      }
    }
  }
  return { platforms, walls, ceilings };
}

/**
 * If terrain now overlaps a body (the world scrolled under it, or was just turned on), the y
 * that puts its feet on the first open ground above; otherwise null.
 */
export function liftOut(map: WorldMap, cam: Camera, zoom: number, off: { x: number; y: number }, body: { x: number; y: number; w: number; h: number }): number | null {
  const tp = tilePx(zoom);
  const cx = Math.floor(cam.x + (body.x + body.w / 2 + off.x) / tp);
  const feetRow = Math.floor(cam.y + (body.y + body.h - 1 + off.y) / tp);
  const headRow = Math.floor(cam.y + (body.y + 1 + off.y) / tp);
  let blocked = false;
  for (let r = headRow; r <= feetRow; r++) if (map.solid(cx, r)) blocked = true;
  if (!blocked) return null;
  // Climb until there's a body's height of air.
  const need = Math.ceil(body.h / tp);
  for (let r = feetRow; r > feetRow - 400; r--) {
    let clear = true;
    for (let i = 1; i <= need; i++) if (map.solid(cx, r - i)) clear = false;
    if (map.solid(cx, r) && clear) return (r - cam.y) * tp - off.y - body.h;
  }
  return null;
}

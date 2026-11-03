// Box-vs-tile physics shared by the player, enemies and dropped items: solid tiles block,
// platforms are one-way (land on them falling; drop through on request), and walkers step up
// one-tile ledges; water slows falling (you swim), lava too (and burns — see game.ts). Units are
// world pixels (16 per tile).

import { STANDABLE, T, WorldMap } from "../gen";

export const TILE = 16;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

export interface MoveOptions {
  gravity: number;
  maxFall: number;
  /** Walk up one-tile steps while on the ground. */
  stepUp?: boolean;
  /** Fall through platforms this step. */
  dropThrough?: boolean;
  /** No gravity (flyers). */
  fly?: boolean;
  /** Pass through solid tiles (bosses that phase). */
  noclip?: boolean;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
  /** Downward speed at the moment of landing (px/s), for fall damage. */
  landed: number | null;
  /** The liquid the box is in (T.Water / T.Lava), or 0. */
  liquid: number;
}

/** The liquid overlapping a box's middle (0 = none). */
export function liquidAt(map: WorldMap, b: { x: number; y: number; w: number; h: number }): number {
  let found = 0;
  for (let ty = tileOf(b.y + b.h * 0.3); ty <= tileOf(b.y + b.h - 1); ty++)
    for (let tx = tileOf(b.x); tx <= tileOf(b.x + b.w - 0.001); tx++) {
      const l = map.liquid(tx, ty);
      if (l === T.Lava) return l;
      if (l) found = l;
    }
  return found;
}

const tileOf = (v: number) => Math.floor(v / TILE);

/** Any solid tile overlapping the rectangle? */
export function solidIn(map: WorldMap, x: number, y: number, w: number, h: number): boolean {
  for (let ty = tileOf(y); ty <= tileOf(y + h - 0.001); ty++) for (let tx = tileOf(x); tx <= tileOf(x + w - 0.001); tx++) if (map.solid(tx, ty)) return true;
  return false;
}

export function moveBox(map: WorldMap, b: Box, dt: number, o: MoveOptions): MoveResult {
  const res: MoveResult = { hitX: false, hitY: false, landed: null, liquid: o.fly || o.noclip ? 0 : liquidAt(map, b) };
  if (res.liquid) {
    // Swimming: sink slowly, and moving through liquid is sluggish.
    if (!o.fly) b.vy = Math.min(o.maxFall * 0.25, b.vy + o.gravity * 0.3 * dt);
    b.vx *= Math.pow(0.5, dt * 4);
  } else if (!o.fly) b.vy = Math.min(o.maxFall, b.vy + o.gravity * dt);
  if (o.noclip) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.onGround = false;
    return res;
  }
  // Horizontal.
  const dx = b.vx * dt;
  if (dx !== 0) {
    const nx = b.x + dx;
    if (solidIn(map, nx, b.y, b.w, b.h)) {
      // A one-tile step: lift onto it if there's headroom.
      // Lift so the feet rest on top of the tile row at foot level (at most one tile).
      const lift = tileOf(b.y + b.h - 0.5) * TILE - (b.y + b.h);
      if (o.stepUp && b.onGround && lift >= -TILE - 0.01 && lift < 0 && !solidIn(map, nx, b.y + lift - 0.01, b.w, b.h)) {
        b.y += lift - 0.01;
        b.x = nx;
      } else {
        b.x = dx > 0 ? tileOf(nx + b.w) * TILE - b.w - 0.001 : (tileOf(nx) + 1) * TILE + 0.001;
        b.vx = 0;
        res.hitX = true;
      }
    } else b.x = nx;
  }
  // Vertical.
  const dy = b.vy * dt;
  const wasGround = b.onGround;
  b.onGround = false;
  if (dy > 0) {
    const bottom = b.y + b.h;
    const ny = b.y + dy;
    const x0 = tileOf(b.x);
    const x1 = tileOf(b.x + b.w - 0.001);
    let land: number | null = null;
    for (let ty = tileOf(bottom - 0.001); ty <= tileOf(ny + b.h - 0.001); ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = map.tile(tx, ty);
        if (!STANDABLE(t)) continue;
        const top = ty * TILE;
        // Platforms only catch you if you were above them.
        if (t === T.Platform && (o.dropThrough || bottom > top + 0.5)) continue;
        if (top >= bottom - 0.5) land = land === null ? top : Math.min(land, top);
      }
      if (land !== null) break;
    }
    if (land !== null && land <= ny + b.h) {
      if (!wasGround) res.landed = b.vy;
      b.y = land - b.h;
      b.vy = 0;
      b.onGround = true;
      res.hitY = true;
    } else b.y = ny;
  } else if (dy < 0) {
    const ny = b.y + dy;
    if (solidIn(map, b.x, ny, b.w, b.h)) {
      b.y = (tileOf(ny) + 1) * TILE + 0.001;
      b.vy = 0;
      res.hitY = true;
    } else b.y = ny;
  } else {
    // Resting: still on the ground?
    const below = b.y + b.h + 0.5;
    for (let tx = tileOf(b.x); tx <= tileOf(b.x + b.w - 0.001); tx++) {
      const t = map.tile(tx, tileOf(below));
      if (STANDABLE(t) && !(t === T.Platform && o.dropThrough)) b.onGround = true;
    }
  }
  return res;
}

export const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

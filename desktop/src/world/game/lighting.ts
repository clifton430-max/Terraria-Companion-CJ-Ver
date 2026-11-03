// Terraria-like lighting for the visible area: sunlight falls down open shafts from the sky,
// torches and furnaces glow, and light fades through air and faster through rock. Computed on a
// small grid (visible tiles plus a margin) only when the view, tiles or time change, then drawn
// as a softly scaled shadow layer.

import { T, type WorldMap } from "../gen";

const AIR_FALLOFF = 0.88;
const SOLID_FALLOFF = 0.78;
const MARGIN = 12;

export interface LightSource {
  x: number;
  y: number;
  level: number;
  /** Its colour (0–255 each), for the glow it casts; uncoloured light only lifts the darkness. */
  color?: readonly [number, number, number];
}

/** Warm firelight, for torches, candles, chandeliers and hearths. */
export const WARM: readonly [number, number, number] = [255, 176, 96];

/** Tiles that give off light of their own: lava, glowing mushrooms, crystal, hellstone. */
const EMISSIVE: Partial<Record<number, { level: number; color: readonly [number, number, number] }>> = {
  [T.Lava]: { level: 0.95, color: [255, 120, 40] },
  [T.MushroomGrass]: { level: 0.45, color: [70, 120, 255] },
  [T.GlowMushroomBlock]: { level: 0.55, color: [70, 120, 255] },
  [T.Hellstone]: { level: 0.4, color: [255, 90, 40] },
  [T.CrystalBlock]: { level: 0.45, color: [220, 120, 255] },
  [T.Meteorite]: { level: 0.25, color: [255, 150, 90] },
};
const GLOW_FALLOFF = 0.8;

export interface LightGrid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** 0 (dark) … 1 (full light), row-major. */
  light: Float32Array;
  /** Coloured glow (r, g, b interleaved, 0…1), or null when nothing coloured is near. */
  glow: Float32Array | null;
}

/** First row in a column that blocks the sky (cached per column; drop entries on edits). */
export class SkyCache {
  private top = new Map<number, number>();
  constructor(private readonly map: WorldMap) {}

  skyTop(x: number): number {
    let v = this.top.get(x);
    if (v !== undefined) return v;
    v = this.map.size.height;
    for (let y = Math.max(0, this.map.surface(x) - 60); y < this.map.size.height; y++) {
      if (this.map.solid(x, y)) {
        v = y;
        break;
      }
    }
    this.top.set(x, v);
    if (this.top.size > 20000) this.top.clear();
    return v;
  }

  invalidate(x: number) {
    this.top.delete(x);
  }
}

/** Light for tiles x0..x0+cols, y0..y0+rows. `daylight` is 0..1 (night ≈ 0.25). */
export function computeLight(map: WorldMap, sky: SkyCache, x0: number, y0: number, cols: number, rows: number, daylight: number, sources: readonly LightSource[]): LightGrid {
  const gx = x0 - MARGIN;
  const gy = y0 - MARGIN;
  const W = cols + MARGIN * 2;
  const H = rows + MARGIN * 2;
  const L = new Float32Array(W * H);
  const solid = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) solid[j * W + i] = map.solid(gx + i, gy + j) ? 1 : 0;
  // Sunlight down every open column.
  for (let i = 0; i < W; i++) {
    const top = sky.skyTop(gx + i);
    for (let j = 0; j < H && gy + j < top; j++) L[j * W + i] = daylight;
  }
  const G = new Float32Array(W * H * 3);
  let glowing = false;
  const seed = (k: number, level: number, c: readonly [number, number, number]) => {
    G[k * 3] = Math.max(G[k * 3], (c[0] / 255) * level);
    G[k * 3 + 1] = Math.max(G[k * 3 + 1], (c[1] / 255) * level);
    G[k * 3 + 2] = Math.max(G[k * 3 + 2], (c[2] / 255) * level);
    glowing = true;
  };
  for (const s of sources) {
    const i = s.x - gx;
    const j = s.y - gy;
    if (i >= 0 && j >= 0 && i < W && j < H) {
      L[j * W + i] = Math.max(L[j * W + i], s.level);
      if (s.color) seed(j * W + i, s.level, s.color);
    }
  }
  // Tiles that glow on their own (only where they face open space, so buried ones stay dark).
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const e = EMISSIVE[map.tile(gx + i, gy + j)];
      if (!e) continue;
      const k = j * W + i;
      if (solid[k] && solid[k - 1] && solid[k + 1] && solid[k - W] && solid[k + W]) continue;
      L[k] = Math.max(L[k], e.level);
      seed(k, e.level * 0.8, e.color);
    }
  // Spread: forward and backward sweeps (twice) approximate a flood fill cheaply.
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const f = solid[k] ? SOLID_FALLOFF : AIR_FALLOFF;
        let v = L[k];
        if (i > 0) v = Math.max(v, L[k - 1] * f);
        if (j > 0) v = Math.max(v, L[k - W] * f);
        L[k] = v;
      }
    for (let j = H - 1; j >= 0; j--)
      for (let i = W - 1; i >= 0; i--) {
        const k = j * W + i;
        const f = solid[k] ? SOLID_FALLOFF : AIR_FALLOFF;
        let v = L[k];
        if (i < W - 1) v = Math.max(v, L[k + 1] * f);
        if (j < H - 1) v = Math.max(v, L[k + W] * f);
        L[k] = v;
      }
  }
  // The glow spreads the same way, but fades sooner (a warm pool around each light).
  if (glowing)
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) spreadGlow(G, solid, W, j * W + i, i > 0 ? j * W + i - 1 : -1, j > 0 ? (j - 1) * W + i : -1);
      for (let j = H - 1; j >= 0; j--)
        for (let i = W - 1; i >= 0; i--) spreadGlow(G, solid, W, j * W + i, i < W - 1 ? j * W + i + 1 : -1, j < H - 1 ? (j + 1) * W + i : -1);
    }
  // Crop to the requested area.
  const out = new Float32Array(cols * rows);
  const glow = glowing ? new Float32Array(cols * rows * 3) : null;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = (j + MARGIN) * W + i + MARGIN;
      out[j * cols + i] = L[k];
      if (glow) for (let c = 0; c < 3; c++) glow[(j * cols + i) * 3 + c] = G[k * 3 + c];
    }
  return { x0, y0, cols, rows, light: out, glow };
}

function spreadGlow(G: Float32Array, solid: Uint8Array, _w: number, k: number, a: number, b: number) {
  const f = solid[k] ? GLOW_FALLOFF * 0.75 : GLOW_FALLOFF;
  for (let c = 0; c < 3; c++) {
    let v = G[k * 3 + c];
    if (a >= 0) v = Math.max(v, G[a * 3 + c] * f);
    if (b >= 0) v = Math.max(v, G[b * 3 + c] * f);
    G[k * 3 + c] = v;
  }
}

/** Daylight for an hour of the day (0–24): bright 6–18, dim at night, smooth dawn and dusk. */
export function daylightAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const night = 0.35;
  if (h >= 6.5 && h <= 18) return 1;
  if (h > 18 && h < 19.5) return 1 - ((h - 18) / 1.5) * (1 - night);
  if (h >= 4.5 && h < 6.5) return night + ((h - 4.5) / 2) * (1 - night);
  return night;
}

export const isNight = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 19.5 || h < 4.5;
};

/** Paint the shadow layer for a light grid onto a small canvas (one pixel per tile). */
export function shadowImage(g: LightGrid, into: HTMLCanvasElement) {
  if (into.width !== g.cols || into.height !== g.rows) {
    into.width = g.cols;
    into.height = g.rows;
  }
  const ctx = into.getContext("2d")!;
  const img = ctx.createImageData(g.cols, g.rows);
  for (let k = 0; k < g.light.length; k++) {
    const dark = 1 - Math.min(1, g.light[k]);
    img.data[k * 4 + 3] = Math.round(dark * 255);
  }
  ctx.putImageData(img, 0, 0);
}

/** Paint the coloured glow for a light grid (one pixel per tile), to add over the scene; false if none. */
export function glowImage(g: LightGrid, into: HTMLCanvasElement): boolean {
  if (!g.glow) return false;
  if (into.width !== g.cols || into.height !== g.rows) {
    into.width = g.cols;
    into.height = g.rows;
  }
  const ctx = into.getContext("2d")!;
  const img = ctx.createImageData(g.cols, g.rows);
  for (let k = 0; k < g.cols * g.rows; k++) {
    img.data[k * 4] = Math.round(Math.min(1, g.glow[k * 3]) * 255);
    img.data[k * 4 + 1] = Math.round(Math.min(1, g.glow[k * 3 + 1]) * 255);
    img.data[k * 4 + 2] = Math.round(Math.min(1, g.glow[k * 3 + 2]) * 255);
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

// Pixel-art ruins for the chess map (the pieces themselves are in graveyard.ts): the broken
// checkered floor, ash, toppled stone columns and the torn banners of both armies.

import type { Color } from "../chess/rules";

// ── The floor and the banners ───────────────────────────────────────────────────────────────

/** Marble and obsidian, like the board: light and dark squares with an edge and a highlight. */
const SLAB = {
  light: { face: "#bdb6a6", edge: "#7d776b", hi: "#e3ddcf" },
  dark: { face: "#3c3448", edge: "#1e1826", hi: "#5d5270" },
};

/** One square of a broken checkered floor, tilted, resting on y = 0: its top face, then its edge. */
export function drawSlab(ctx: CanvasRenderingContext2D, x: number, size: number, light: boolean, tilt: number, cracked: boolean, p: number) {
  const c = light ? SLAB.light : SLAB.dark;
  const edge = Math.max(p * 2, Math.round((size * 0.16) / p) * p);
  const face = Math.max(p * 2, Math.round((size * 0.3) / p) * p);
  const inset = Math.round((size * 0.12) / p) * p; // the far edge looks shorter (seen from above)
  ctx.save();
  ctx.translate(Math.round(x), 0);
  ctx.rotate(tilt);
  const L = Math.round(-size / 2);
  const W = Math.round(size);
  // Top face, a trapezoid in pixel rows.
  for (let y = 0; y < face; y += p) {
    const k = Math.round(((inset * (face - y)) / face) / p) * p;
    ctx.fillStyle = y === 0 ? c.hi : c.face;
    ctx.fillRect(L + k, -edge - face + y, W - 2 * k, p);
  }
  // Front edge, darker.
  ctx.fillStyle = c.edge;
  ctx.fillRect(L, -edge, W, edge);
  if (cracked) {
    // A zig-zag crack across the face.
    ctx.fillStyle = c.edge;
    const cx = L + Math.round((W * 0.45) / p) * p;
    for (let i = 0; i * p < face; i++) ctx.fillRect(cx + (i % 2 ? p : 0) - (i % 3 === 2 ? p : 0), -edge - face + i * p, p, p);
  }
  ctx.restore();
}

/** A low heap of ash and grit, centred on x. */
export function drawAsh(ctx: CanvasRenderingContext2D, x: number, width: number, height: number, p: number, rnd: () => number) {
  const cols = Math.max(2, Math.round(width / p));
  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const h = Math.round((Math.sin(u * Math.PI) * height * (0.75 + rnd() * 0.35)) / p) * p;
    if (h <= 0) continue;
    ctx.fillStyle = "#2a2d36";
    ctx.fillRect(Math.round(x - width / 2 + i * p), -h, p, h);
    ctx.fillStyle = "#4a4e5b";
    ctx.fillRect(Math.round(x - width / 2 + i * p), -h, p, p);
  }
}

/** A torn banner of one army on a broken pole, its foot at x: a swallowtail cut, a few rips. */
export function drawBanner(ctx: CanvasRenderingContext2D, x: number, height: number, color: Color, p: number, rnd: () => number, lean: number) {
  const cloth = color === "w" ? { face: "#d9d2c2", fold: "#b4ab97", line: "#5a5244" } : { face: "#3d3150", fold: "#2a2138", line: "#120d18" };
  const cols = Math.max(5, Math.round((height * 0.34) / p));
  const rows = Math.max(8, Math.round((height * 0.58) / p));
  // Ragged bottom: a swallowtail notch in the middle and one or two tears.
  const tear = Array.from({ length: cols }, (_, i) => {
    const mid = Math.abs(i - (cols - 1) / 2) / ((cols - 1) / 2); // 0 in the middle, 1 at the sides
    return Math.round((1 - mid) * rows * 0.28 + (rnd() < 0.25 ? 1 + rnd() * 3 : 0));
  });
  const hole = rnd() < 0.6 ? { x: 1 + Math.floor(rnd() * (cols - 2)), y: Math.floor(rows * (0.35 + rnd() * 0.3)) } : null;
  ctx.save();
  ctx.translate(Math.round(x), 0);
  ctx.rotate(lean);
  // The pole, splintered at the top, with a crossbar.
  ctx.fillStyle = "#2b2420";
  ctx.fillRect(0, -height, p, height);
  ctx.fillRect(-p, -height - p, p, p);
  ctx.fillRect(p, -height - 2 * p, p, p);
  ctx.fillRect(0, -height + p, (cols + 2) * p, p);
  for (let i = 0; i < cols; i++) {
    const len = rows - tear[i];
    for (let j = 0; j < len; j++) {
      if (hole && Math.abs(i - hole.x) + Math.abs(j - hole.y) < 2) continue;
      const edge = i === 0 || i === cols - 1 || j === len - 1;
      ctx.fillStyle = edge ? cloth.line : i % 3 === 1 ? cloth.fold : cloth.face;
      ctx.fillRect(p + i * p, -height + 2 * p + j * p, p, p);
    }
  }
  // The army's emblem: a small crown in the other army's colour.
  const ex = p + Math.floor(cols / 2) * p;
  const ey = -height + 2 * p + Math.round(rows * 0.28) * p;
  ctx.fillStyle = color === "w" ? "#3d3150" : "#d9d2c2";
  ctx.fillRect(ex - p, ey, p, p);
  ctx.fillRect(ex + p, ey, p, p);
  ctx.fillRect(ex, ey + p, p, p);
  ctx.fillRect(ex - p, ey + 2 * p, p * 3, p);
  ctx.restore();
}

/** A broken stone column: a fluted shaft standing to a jagged top, or toppled drums lying in a row. */
export function drawColumn(ctx: CanvasRenderingContext2D, x: number, height: number, p: number, rnd: () => number, toppled: boolean) {
  const w = Math.max(4, Math.round((height * 0.22) / p)) * p;
  const tones = ["#2c2a30", "#5e5a62", "#7f7a82", "#a29da4"];
  ctx.save();
  ctx.translate(Math.round(x), 0);
  if (toppled) {
    // Drums lying end to end, slightly apart.
    let at = 0;
    for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) {
      const len = Math.round((w * (1.1 + rnd() * 0.6)) / p) * p;
      for (let y = 0; y < w; y += p) {
        const u = y / w;
        ctx.fillStyle = tones[u < 0.15 ? 3 : u < 0.55 ? 2 : u < 0.85 ? 1 : 0];
        ctx.fillRect(at, -w + y, len, p);
      }
      ctx.fillStyle = tones[0];
      ctx.fillRect(at, -w, p, w);
      ctx.fillRect(at + len - p, -w, p, w);
      at += len + p * (1 + Math.floor(rnd() * 2));
    }
  } else {
    // Base, fluted shaft, jagged top.
    ctx.fillStyle = tones[1];
    ctx.fillRect(-w / 2 - p, -2 * p, w + 2 * p, 2 * p);
    const h = Math.round(height / p) * p;
    for (let col = 0; col < w; col += p) {
      const u = col / w;
      const top = h - Math.round((rnd() * height * 0.25) / p) * p; // the break
      ctx.fillStyle = tones[col % (3 * p) === 0 ? 0 : u < 0.3 ? 3 : u < 0.7 ? 2 : 1];
      ctx.fillRect(-w / 2 + col, -top, p, top - 2 * p);
    }
  }
  ctx.restore();
}

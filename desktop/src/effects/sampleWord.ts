// Rasterises the effect's word on a private canvas (never reads the screen or other apps).

import type { SampledWord } from "./letterBreak";

const FONT_PX = 44;
const CELL = 3;
const cache = new Map<string, SampledWord>();

export interface WordStyle {
  fontPx: number;
  cell: number;
  /** "gold": Terraria-style title lettering. "ink": dark text glyphs with a light rim (pickaxe). */
  look: "gold" | "ink";
}

const GOLD: WordStyle = { fontPx: FONT_PX, cell: CELL, look: "gold" };
/** Pickaxe glyphs: smaller, text-like, readable on light and dark backgrounds. */
export const INK: WordStyle = { fontPx: 30, cell: 2, look: "ink" };

/** Terraria-ish chunky gold lettering with a dark outline, sampled into CELL-sized pixels. */
export function sampleWord(word: string, style: WordStyle = GOLD): SampledWord {
  const cacheKey = `${style.look}:${style.fontPx}:${style.cell}:${word}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const FONT_PX = style.fontPx;
  const CELL = style.cell;
  const font = `900 ${FONT_PX}px "Andy", ui-rounded, "SF Pro Rounded", -apple-system, sans-serif`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const pad = 6;
  const w = Math.ceil(probe.measureText(word).width) + pad * 2;
  const h = FONT_PX + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = style.look === "ink" ? 4 : 6;
  ctx.strokeStyle = style.look === "ink" ? "#f4f4f4" : "#2a1a0e";
  ctx.strokeText(word, pad, h / 2);
  const g = ctx.createLinearGradient(0, pad, 0, h - pad);
  if (style.look === "ink") {
    g.addColorStop(0, "#2a2a2e");
    g.addColorStop(1, "#141418");
  } else {
    g.addColorStop(0, "#fff3a0");
    g.addColorStop(0.55, "#f2b33d");
    g.addColorStop(1, "#b8641e");
  }
  ctx.fillStyle = g;
  ctx.fillText(word, pad, h / 2);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels: SampledWord["pixels"] = [];
  for (let y = 0; y < h; y += CELL) {
    for (let x = 0; x < canvas.width; x += CELL) {
      const i = ((y + 1) * canvas.width + x + 1) * 4;
      if (data[i + 3] < 140) continue;
      pixels.push({ x, y, color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
  }
  const sampled = { w: canvas.width, h, cell: CELL, pixels };
  cache.set(cacheKey, sampled);
  return sampled;
}

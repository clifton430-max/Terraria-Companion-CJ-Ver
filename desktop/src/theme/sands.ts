// The chess map's ground: dunes of dark grey and black sand in three layers (the far ones paler
// and hazier, the near ones almost black), lit from the upper left. Each column of pixels is
// shaded by its slope (faces turned to the light are paler, the lee side darker), with a bright
// crest, wind ripples following the contour and scattered grains. Things set into a layer are
// drawn first and its sand after, so the sand covers whatever is buried in it.

/** Repeatable randomness. */
export function sandRng(seed: number): () => number {
  let s = seed >>> 0 || 7;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

export interface Dune {
  /** Height of the sand at x (px above the ground line). */
  h(x: number): number;
  face: string;
  lit: string;
  lee: string;
  crest: string;
}

/**
 * The profile of one wind-built dune over a period (u in 0..1): a long gentle slope up to a sharp
 * crest, then a short steep drop (the slip face), eased so the crest isn't a spike.
 */
export function duneShape(u: number): number {
  const v = ((u % 1) + 1) % 1;
  const up = 0.72;
  const t = v < up ? v / up : 1 - (v - up) / (1 - up);
  return v < up ? Math.sin((t * Math.PI) / 2) : t * t * (3 - 2 * t);
}

/** A layer of dunes: wind-built ridges of a few sizes around a base height. */
export function dune(seed: number, base: number, amp: number, tones: { face: string; lit: string; lee: string; crest: string }): Dune {
  const r = sandRng(seed);
  const big = { k: 1 / (260 + r() * 160), ph: r() };
  const small = { k: 1 / (90 + r() * 50), ph: r() };
  const swell = { k: 1 / (420 + r() * 200), ph: r() * 6.28 };
  return {
    h: (x) => Math.max(2, base + amp * (duneShape(x * big.k + big.ph) - 0.5) * 1.6 + amp * 0.35 * (duneShape(x * small.k + small.ph) - 0.5) + amp * 0.3 * Math.sin(x * swell.k + swell.ph)),
    ...tones,
  };
}

/** Dune crests (local tops), at least `gap` px apart, highest first. */
export function crests(d: Dune, width: number, gap: number): number[] {
  const tops: number[] = [];
  for (let x = 4; x < width - 4; x += 2) if (d.h(x) >= d.h(x - 4) && d.h(x) >= d.h(x + 4)) tops.push(x);
  tops.sort((a, b) => d.h(b) - d.h(a));
  const out: number[] = [];
  for (const x of tops) if (out.every((o) => Math.abs(o - x) >= gap)) out.push(x);
  return out;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The sand's colour for a slope: lee side, flat face and lit side blended smoothly. */
export function shade(d: Dune, slope: number): string {
  const [lee, face, lit] = [rgb(d.lee), rgb(d.face), rgb(d.lit)];
  const t = Math.max(-1, Math.min(1, slope / 1.4));
  const mix = t < 0 ? face.map((c, i) => c + (lee[i] - c) * -t) : face.map((c, i) => c + (lit[i] - c) * t);
  return `rgb(${mix.map((c) => Math.round(c)).join(",")})`;
}

/** Draw a layer of sand standing on y = 0, `width` px long. */
export function drawSand(ctx: CanvasRenderingContext2D, d: Dune, width: number, p: number, seed: number) {
  const r = sandRng(seed);
  for (let x = 0; x < width; x += p) {
    const h = Math.round(d.h(x) / p) * p;
    if (h <= 0) continue;
    const slope = d.h(x + p) - d.h(x - p); // > 0: rising to the right, facing the light (upper left)
    ctx.fillStyle = shade(d, slope);
    ctx.fillRect(x, -h, p, h);
    // The lit slopes are brightest just under the crest.
    if (slope > 0.25) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fillRect(x, -h, p, Math.min(h, 10));
    }
    // Deeper down the sand is darker (a soft gradient, not a hard line).
    const deep = Math.round((h * 0.55) / p) * p;
    for (let y = 0; y < deep; y += p) {
      ctx.fillStyle = `rgba(0, 0, 0, ${((0.22 * y) / Math.max(1, deep)).toFixed(3)})`;
      ctx.fillRect(x, -deep + y, p, p);
    }
    // Ripples, following the contour.
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    for (let y = 6; y < h - 2; y += 7) if (Math.sin(x / 9 + y * 0.8) > 0.2) ctx.fillRect(x, -h + y + Math.round(Math.sin(x / 31) * 2), p, 1);
    // The crest catches the light.
    ctx.fillStyle = d.crest;
    ctx.fillRect(x, -h, p, slope > -0.2 ? p : 1);
    // Grain: a speckle of lighter and darker sand all through it.
    for (let i = 0; i < Math.ceil(h / 6); i++) {
      if (r() < 0.35) continue;
      ctx.fillStyle = r() < 0.45 ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.32)";
      ctx.fillRect(x + (r() < 0.5 ? 0 : 1), -Math.floor(r() * h), 1, 1);
    }
  }
}

/** A small drift of sand heaped against something at x (on top of what's already drawn). */
export function drawDrift(ctx: CanvasRenderingContext2D, d: Dune, x: number, width: number, height: number, p: number) {
  const cols = Math.max(2, Math.round(width / p));
  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const bump = Math.round((Math.sin(u * Math.PI) ** 0.8 * height) / p) * p;
    if (bump <= 0) continue;
    const cx = Math.round(x - width / 2 + i * p);
    const base = Math.round(d.h(cx) / p) * p;
    ctx.fillStyle = u < 0.5 ? d.lit : d.face;
    ctx.fillRect(cx, -base - bump, p, bump + p);
    ctx.fillStyle = d.crest;
    ctx.fillRect(cx, -base - bump, p, 1);
  }
}

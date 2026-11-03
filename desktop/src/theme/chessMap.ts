// The chess map (Maps tab): a dark-fantasy battlefield, Terraria meets Hollow Knight: the
// graveyard of a chess war, half swallowed by dark grey and black sand (sands.ts). Small weathered
// stone miniatures of both armies (graveyard.ts; not the board game's pieces) lie sunk in three
// layers of dunes, toppled, snapped, leaning, buried to the neck, with torn banners planted on the
// crests and a column stump or a corner of old floor poking out here and there. The king and queen
// lie broken among them. Chains and lanterns of several kinds hang under the menu bar. Dust and ash drift (and
// swirl around the pointer) instead of falling petals, with spores, embers, pale soul-lights and
// low fog. Every particle has a dark edge and a pale core, so it shows on light and dark
// wallpapers alike. All original pixel art (chessRuins.ts); nothing darkens the desktop.

import type { PieceType } from "../chess/rules";
import { drawAsh, drawBanner, drawColumn, drawSlab } from "./chessRuins";
import { crests, drawDrift, drawSand, dune, type Dune } from "./sands";
import { HEIGHT, miniature, type Army, type Damage } from "./graveyard";
import { targetCount, windAt, type PetalSettings } from "./petals";

/** Repeatable randomness for the scenery (the same layout every redraw). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Pick = () => number;
/** A fallen army is mostly pawns. */
const ARMY: PieceType[] = ["p", "p", "p", "p", "p", "p", "p", "p", "r", "r", "n", "n", "b", "b"];

/** A soft shadow on the ground under something `w` wide. */
function shadow(ctx: CanvasRenderingContext2D, x: number, w: number, alpha = 0.32) {
  ctx.fillStyle = `rgba(8, 10, 16, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, -1, w / 2, Math.max(2, w * 0.1), 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Random wear for one piece: always aged, often cracked and chipped, sometimes snapped. */
function wear(rnd: Pick, snap: Damage["snap"] | undefined): Damage {
  return { snap, cracks: Math.floor(rnd() * 3), chips: 1 + Math.floor(rnd() * 4), lichen: Math.floor(rnd() * 3), age: 0.45 + rnd() * 0.5 };
}

type Pose = "fallen" | "tilted" | "snapped" | "buried" | "fragment" | "standing";

/**
 * One miniature on the ground at x: lying on its side, leaning, snapped with its top beside it,
 * half-buried, only a fragment left, or (rarely, and only small pieces) still standing, broken.
 * `k` is CSS px per art pixel. Returns how much ground it took.
 */
function piece(ctx: CanvasRenderingContext2D, rnd: Pick, x: number, army: Army, type: PieceType, artH: number, k: number, pose: Pose, p: number): number {
  const seed = Math.floor(rnd() * 1e9);
  const dir = rnd() < 0.5 ? -1 : 1;
  const draw = (img: HTMLCanvasElement, cx: number, cy: number, rot: number) => {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(cx), Math.round(cy));
    if (rot) ctx.rotate(rot);
    ctx.drawImage(img, Math.round((-img.width * k) / 2), Math.round((-img.height * k) / 2), img.width * k, img.height * k);
    ctx.restore();
  };
  switch (pose) {
    case "fallen": {
      const img = miniature(army, type, artH, seed, wear(rnd, undefined));
      shadow(ctx, x, img.height * k);
      // On its side: its width becomes its height; a little roll into the dirt.
      draw(img, x, (-img.width * k) / 2 + k, dir * (Math.PI / 2) + (rnd() - 0.5) * 0.12);
      return img.height * k;
    }
    case "tilted": {
      const img = miniature(army, type, artH, seed, wear(rnd, undefined));
      const a = dir * (0.35 + rnd() * 0.5);
      shadow(ctx, x, img.width * k * 1.4);
      draw(img, x, (-img.height * k * Math.cos(a)) / 2 - (img.width * k * Math.abs(Math.sin(a))) / 4 + k * 2, a);
      drawAsh(ctx, x, img.width * k * 1.3, k * 3, p, rnd);
      return img.width * k * 1.6;
    }
    case "snapped": {
      const at = 0.35 + rnd() * 0.3;
      const slant = (rnd() - 0.5) * 0.7;
      const base = miniature(army, type, artH, seed, wear(rnd, { at, slant, keep: "base" }));
      const top = miniature(army, type, artH, seed, wear(rnd, { at, slant, keep: "top" }));
      shadow(ctx, x, base.width * k);
      draw(base, x, (-base.height * k) / 2 + k, 0);
      const tx = x + dir * (base.width * k * 0.9 + artH * k * 0.25);
      shadow(ctx, tx, top.height * k * 0.6);
      draw(top, tx, (-top.width * k) / 2 + k, dir * (Math.PI / 2 + 0.2 + rnd() * 0.3));
      return base.width * k + artH * k * 0.9;
    }
    case "buried": {
      const img = miniature(army, type, artH, seed, wear(rnd, rnd() < 0.4 ? { at: 0.5 + rnd() * 0.3, slant: (rnd() - 0.5) * 0.6, keep: "base" } : undefined));
      const a = dir * rnd() * 0.5;
      draw(img, x, (-img.height * k) / 2 + img.height * k * (0.3 + rnd() * 0.2), a);
      drawAsh(ctx, x, img.width * k * 2.2, img.height * k * 0.32, p, rnd);
      return img.width * k * 2;
    }
    case "fragment": {
      const img = miniature(army, type, artH, seed, wear(rnd, { at: 0.45 + rnd() * 0.25, slant: (rnd() - 0.5) * 0.8, keep: "top" }));
      shadow(ctx, x, img.width * k);
      draw(img, x, (-img.width * k) / 2 + k, dir * (Math.PI / 2 + rnd() * 0.6));
      return img.height * k;
    }
    case "standing": {
      const img = miniature(army, type, artH, seed, wear(rnd, { at: 0.45 + rnd() * 0.35, slant: (rnd() - 0.5) * 0.5, keep: "base" }));
      shadow(ctx, x, img.width * k);
      draw(img, x, (-img.height * k) / 2 + k, (rnd() - 0.5) * 0.12);
      return img.width * k * 1.4;
    }
  }
}

/** The three layers of sand, far to near: paler and hazier far away, almost black up close. */
function dunes(S: number, seed: number): Dune[] {
  return [
    dune(seed + 1, S * 0.32, S * 0.18, { face: "#2e2f35", lit: "#41424b", lee: "#202126", crest: "#6c6f7c" }),
    dune(seed + 2, S * 0.21, S * 0.14, { face: "#1d1e22", lit: "#2d2e35", lee: "#131316", crest: "#565867" }),
    dune(seed + 3, S * 0.1, S * 0.08, { face: "#0f0f12", lit: "#1c1c21", lee: "#08080a", crest: "#434553" }),
  ];
}

/** Sink a piece into the sand of a layer at x: its foot `sink` px below the surface. */
function sunk(ctx: CanvasRenderingContext2D, d: Dune, rnd: Pick, x: number, army: Army, type: PieceType, artH: number, k: number, pose: Pose, sink: number, p: number) {
  ctx.save();
  ctx.translate(0, Math.round(-d.h(x) + sink));
  piece(ctx, rnd, x, army, type, artH, k, pose, p);
  ctx.restore();
}

/**
 * Along the Dock's top edge (standing on y = 0): the graveyard of a chess war, half swallowed by
 * dark sand. Three layers of dunes, back to front; in each, broken miniatures of both armies lie
 * sunk into the sand (fewer and smaller further back), a column stump or a corner of checkered
 * floor pokes out here and there, and the torn banners stand planted on the crests with sand
 * drifted around their poles. The king and queen lie broken in the front dunes. Drawn once per
 * layout.
 */
export function drawChessGround(ctx: CanvasRenderingContext2D, length: number, p: number, seed: number, pieceSize: number) {
  const rnd = seeded(seed);
  const k = p;
  const S = pieceSize;
  const artKing = Math.max(12, Math.round((S * 0.55) / k));
  const top = Math.ceil(S * 1.3);
  const layer = document.createElement("canvas");
  layer.width = Math.ceil(length);
  layer.height = top;
  const l = layer.getContext("2d")!;
  l.imageSmoothingEnabled = false;
  l.translate(0, top);
  const royalX = Math.round(length * (2 / 3));
  const layers = dunes(S, seed);
  const ranks = [
    { scale: 0.62, gap: [110, 200], banners: 1 },
    { scale: 0.82, gap: [85, 165], banners: 2 },
    { scale: 1, gap: [70, 145], banners: 1 },
  ];
  const sandy: Pose[] = ["fallen", "fallen", "buried", "buried", "snapped", "tilted", "fragment"];
  const flags: number[] = []; // banners already planted (kept apart across layers)
  layers.forEach((d, i) => {
    const rank = ranks[i];
    // Banners planted on the highest crests, poles sunk deep.
    const tops = crests(d, length, 260)
      .filter((x) => Math.abs(x - royalX) > S * 2 && flags.every((f) => Math.abs(f - x) > 240))
      .slice(0, rank.banners);
    flags.push(...tops);
    for (const x of tops) {
      l.save();
      l.translate(0, Math.round(-d.h(x) + S * 0.14 * rank.scale));
      drawBanner(l, x, S * rank.scale * (0.75 + rnd() * 0.15), rnd() < 0.5 ? "w" : "b", p, rnd, (rnd() - 0.5) * 0.22);
      l.restore();
    }
    // Now and then a column stump or a corner of the old floor, half under the sand.
    for (let x = 140 + rnd() * 300; x < length - 60; x += 420 + rnd() * 520) {
      if (Math.abs(x - royalX) < S * 2) continue;
      l.save();
      l.translate(0, Math.round(-d.h(x) + S * 0.25 * rank.scale));
      if (rnd() < 0.5) drawColumn(l, x, S * rank.scale * (0.4 + rnd() * 0.3), p, rnd, false);
      else drawSlab(l, x, Math.round(S * 0.4 * rank.scale), rnd() < 0.5, (rnd() - 0.5) * 0.9, true, p);
      l.restore();
    }
    // The fallen, sunk into the sand.
    for (let x = rnd() * 80; x < length; x += rank.gap[0] + rnd() * (rank.gap[1] - rank.gap[0])) {
      if (i === 2 && Math.abs(x - royalX) < S * 1.4) continue;
      const type = ARMY[Math.floor(rnd() * ARMY.length)];
      const h = Math.max(8, Math.round(artKing * HEIGHT[type] * rank.scale));
      sunk(l, d, rnd, x, rnd() < 0.5 ? "w" : "b", type, h, k, sandy[Math.floor(rnd() * sandy.length)], h * k * (0.08 + rnd() * 0.2), p);
    }
    if (i === 2) {
      // The king and queen: she lies snapped in the sand with her crown beside her; he's sunk to
      // the chest, leaning.
      const qH = Math.round(artKing * HEIGHT.q);
      const q = miniature("w", "q", qH, 7, { snap: { at: 0.62, slant: 0.25, keep: "base" }, cracks: 2, chips: 3, lichen: 1, age: 0.7 });
      const crown = miniature("w", "q", qH, 7, { snap: { at: 0.62, slant: 0.25, keep: "top" }, cracks: 1, chips: 1, lichen: 0, age: 0.7 });
      const king = miniature("w", "k", artKing, 11, { cracks: 3, chips: 3, lichen: 2, age: 0.8 });
      const at = (x: number, img: HTMLCanvasElement, rot: number, sink: number) => {
        l.save();
        l.translate(Math.round(x), Math.round(-d.h(x) + sink));
        l.rotate(rot);
        l.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
        l.restore();
      };
      at(royalX - S * 0.2, q, -Math.PI / 2 + 0.08, (-q.width * k) / 2 + q.width * k * 0.35);
      at(royalX - S * 0.95, crown, -Math.PI / 2 - 0.6, (-crown.width * k) / 2 + crown.width * k * 0.3);
      at(royalX + S * 0.6, king, 0.5, (-king.height * k) / 2 + king.height * k * 0.45);
    }
    // The sand itself, over everything set into it, then drifts against what pokes out.
    drawSand(l, d, length, p, seed + i * 31);
    for (const x of tops) drawDrift(l, d, x, S * 0.5 * rank.scale, S * 0.1 * rank.scale, p);
    if (i < 2) {
      // A little haze over what's drawn so far (not the empty sky): further sand reads further away.
      l.globalCompositeOperation = "source-atop";
      l.fillStyle = "rgba(120, 130, 150, 0.08)";
      l.fillRect(0, -top, length, top);
      l.globalCompositeOperation = "source-over";
    }
  });
  ctx.drawImage(layer, 0, -top);
}

/** Beside a left or right Dock: a low strip of dark sand with a few fragments in it (along +x). */
export function drawChessEdge(ctx: CanvasRenderingContext2D, length: number, p: number, seed: number) {
  const rnd = seeded(seed);
  const d = dune(seed, 10, 6, { face: "#1a1b1f", lit: "#26272d", lee: "#121215", crest: "#4a4c58" });
  for (let x = 60 + rnd() * 80; x < length - 40; x += 160 + rnd() * 200) sunk(ctx, d, rnd, x, rnd() < 0.5 ? "w" : "b", ARMY[Math.floor(rnd() * ARMY.length)], 10, p, rnd() < 0.5 ? "fallen" : "fragment", 5, p);
  drawSand(ctx, d, length, p, seed);
}

// ── Animated: lanterns, light, fog, spores, soul-lights, dust ─────────────────────────────

type LanternKind = "cage" | "orb" | "candle" | "hook";

interface Lantern {
  x: number;
  chain: number;
  phase: number;
  kind: LanternKind;
  lit: boolean;
  /** Hangs crooked, with a cracked pane. */
  broken: boolean;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  alpha: number;
  /** A flake of ash (a little oblong that turns) rather than a speck of dust. */
  flake: boolean;
}

interface Spore {
  x: number;
  y: number;
  phase: number;
  speed: number;
  ember: boolean;
  life: number;
}

interface Soul {
  ax: number;
  ay: number;
  phase: number;
  r: number;
}

/**
 * A hanging lantern's swing: the chain as a pendulum (longer chains swing slower, like real ones),
 * with a breath of wind now and then, and the lantern lagging a little behind its chain. Broken
 * ones hang crooked and barely move. Angles in radians.
 */
export function lanternSwing(t: number, phase: number, length: number, broken: boolean): { chain: number; lag: number } {
  const w = Math.sqrt(9.8 / Math.max(0.2, length / 60)) * 0.5; // ω for a pendulum of `length` px
  const gust = 0.55 + 0.45 * Math.sin(t * 0.13 + phase * 3);
  const amp = (broken ? 0.03 : 0.11) * gust;
  const chain = amp * Math.sin(t * w + phase) + (broken ? 0.22 : 0);
  const lag = -amp * 0.6 * Math.sin(t * w + phase - 0.9);
  return { chain, lag };
}

/** Where the pointer is (CSS px) and when it last moved (s), for swirling the dust. */
export interface Pointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
}

export const MAX_MOTES = 170;
const SWIRL_RADIUS = 110;

/** Push a mote around a moving pointer: out and around, stronger the faster it moves. */
export function swirl(m: { x: number; y: number; vx: number; vy: number }, ptr: Pointer, t: number, dt: number) {
  if (t - ptr.at > 0.25) return;
  const dx = m.x - ptr.x;
  const dy = m.y - ptr.y;
  const d = Math.hypot(dx, dy);
  if (d > SWIRL_RADIUS || d < 1) return;
  const speed = Math.min(1600, Math.hypot(ptr.vx, ptr.vy));
  const k = (1 - d / SWIRL_RADIUS) * (speed / 1600) * 900 * dt;
  // Tangential (around the pointer, in the direction it's moving) plus a little outward.
  const turn = Math.sign(ptr.vx * dy - ptr.vy * dx) || 1;
  m.vx += (-dy / d) * k * turn + (dx / d) * k * 0.35;
  m.vy += (dx / d) * k * turn + (dy / d) * k * 0.35;
}

/** A particle that reads on any wallpaper: a dark edge, then a pale (or coloured) core. */
function speck(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, core: string, alpha: number) {
  const X = Math.round(x);
  const Y = Math.round(y);
  ctx.fillStyle = `rgba(12, 14, 22, ${(alpha * 0.7).toFixed(3)})`;
  ctx.fillRect(X - 1, Y - 1, w + 2, h + 2);
  ctx.fillStyle = core.replace("A", alpha.toFixed(3));
  ctx.fillRect(X, Y, w, h);
}

export class ChessAtmosphere {
  private lanterns: Lantern[] = [];
  private swags: [number, number, number][] = [];
  private motes: Mote[] = [];
  private spores: Spore[] = [];
  private souls: Soul[] = [];
  /** Sand blown off the dune crests: short, quick streaks low over the ground. */
  private grains: { x: number; y: number; v: number; life: number; len: number }[] = [];
  private width = 0;

  constructor(private readonly rnd: () => number = Math.random) {}

  /** Lay out the lanterns, chains and soul-lights for this screen (the same every time for a width). */
  layout(width: number, ground = 800) {
    if (width === this.width) return;
    this.width = width;
    const r = seeded(4217);
    this.lanterns = [];
    const kinds: LanternKind[] = ["cage", "orb", "candle", "cage", "orb", "hook"];
    for (let x = 60 + r() * 80; x < width - 40; x += 120 + r() * 140) {
      const kind = kinds[Math.floor(r() * kinds.length)];
      const broken = kind !== "hook" && r() < 0.3;
      this.lanterns.push({ x, chain: 14 + r() * 60, phase: r() * Math.PI * 2, kind, lit: kind !== "hook" && (!broken || r() < 0.35), broken });
    }
    // Sagging chains between some neighbours.
    this.swags = [];
    for (let i = 0; i + 1 < this.lanterns.length; i++) if (r() < 0.45) this.swags.push([this.lanterns[i].x, this.lanterns[i + 1].x, 14 + r() * 26]);
    // A few pale soul-lights wandering over the battlefield.
    this.souls = Array.from({ length: Math.max(3, Math.round(width / 320)) }, () => ({ ax: r() * width, ay: ground - 60 - r() * 220, phase: r() * 10, r: 30 + r() * 60 }));
  }

  step(dt: number, t: number, s: PetalSettings | null, w: number, h: number, ground: number, ptr: Pointer | null) {
    this.layout(w, ground);
    const rnd = this.rnd;
    // Dust and ash: drift with the wind setting, hang and wander rather than falling.
    const target = s ? Math.min(MAX_MOTES, Math.round(targetCount(s.density, w, h) * 1.3)) : 0;
    const wind = s ? windAt(s, t) * 18 * s.speed : 0;
    const out: Mote[] = [];
    for (const m of this.motes) {
      if (ptr) swirl(m, ptr, t, dt);
      const drift = (s?.sway ?? 0.5) * 10;
      const fall = m.flake ? 9 : 2.5;
      m.vx += (wind + Math.cos(t * 0.45 + m.phase) * drift - m.vx) * Math.min(1, dt * 0.9);
      m.vy += ((Math.sin(t * 0.33 + m.phase * 1.7) * 7 + fall) * (s?.speed ?? 1) - m.vy) * Math.min(1, dt * 0.9);
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const gone = m.y > h + 10 || m.y < -10 || m.x < -40 || m.x > w + 40;
      if (!gone) out.push(m);
      else if (out.length < target) out.push(this.mote(w, h, false, wind));
    }
    const initial = this.motes.length === 0;
    for (let i = 0; out.length < target && (initial || i < 2); i++) out.push(this.mote(w, h, initial, wind));
    this.motes = out.length > target + 2 ? out.slice(0, target) : out;
    // Sand blowing off the dunes, with the wind (or gently rightwards when it's still).
    const gust = (Math.abs(wind) > 1 ? wind : 6) * 3.2;
    const sand = s ? Math.round(10 + 30 * Math.min(1, s.density * 1.6)) : 8;
    this.grains = this.grains.filter((g) => (g.life -= dt) > 0);
    for (const g of this.grains) {
      g.x += (gust + g.v) * dt;
      g.y += Math.sin(t * 3 + g.x / 40) * 4 * dt;
    }
    if (this.grains.length < sand && rnd() < dt * 12)
      this.grains.push({ x: gust >= 0 ? rnd() * w * 0.9 : w * 0.1 + rnd() * w * 0.9, y: ground - 4 - rnd() * 46, v: (gust >= 0 ? 1 : -1) * (10 + rnd() * 30), life: 0.8 + rnd() * 1.6, len: 2 + Math.floor(rnd() * 4) });
    // Spores and embers rise slowly from the battlefield and fade.
    const want = s ? Math.round(8 + 18 * Math.min(1, s.density * 1.5)) : 8;
    this.spores = this.spores.filter((p) => (p.life -= dt) > 0);
    for (const p of this.spores) {
      p.y -= p.speed * dt;
      p.x += Math.sin(t * 0.8 + p.phase) * 8 * dt;
    }
    if (this.spores.length < want && rnd() < dt * 4) this.spores.push({ x: rnd() * w, y: ground - rnd() * 70, phase: rnd() * 6.3, speed: 6 + rnd() * 12, ember: rnd() < 0.35, life: 6 + rnd() * 8 });
  }

  private mote(w: number, h: number, anywhere: boolean, wind: number): Mote {
    const rnd = this.rnd;
    const fromSide = !anywhere && Math.abs(wind) > 2;
    return {
      x: fromSide ? (wind > 0 ? -20 : w + 20) : rnd() * w,
      y: fromSide || anywhere ? rnd() * h : -8,
      vx: wind,
      vy: 0,
      size: rnd() < 0.65 ? 1 : 1.5,
      phase: rnd() * Math.PI * 2,
      alpha: 0.55 + rnd() * 0.4,
      flake: rnd() < 0.18,
    };
  }

  /**
   * Draw a frame: light from above, chains and lanterns under the menu bar, fog along the ground,
   * soul-lights, spores and embers, then the dust and ash.
   */
  draw(ctx: CanvasRenderingContext2D, t: number, w: number, top: number, ground: number, sizeSetting: number, hanging: boolean, foggy: boolean) {
    // Faint shafts of light falling from under the menu bar.
    if (foggy) this.drawShafts(ctx, t, w, top, ground);
    if (hanging) {
      for (const [a, b, sag] of this.swags) this.drawSwag(ctx, a, b, top, sag);
      for (const l of this.lanterns) this.drawLantern(ctx, l, t, top);
    }
    if (foggy) this.drawFog(ctx, t, w, ground);
    for (const s of this.souls) {
      const x = s.ax + Math.sin(t * 0.21 + s.phase) * s.r + Math.sin(t * 0.53 + s.phase * 2) * 12;
      const y = s.ay + Math.cos(t * 0.17 + s.phase) * s.r * 0.4;
      const pulse = 0.65 + 0.35 * Math.sin(t * 1.7 + s.phase);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
      g.addColorStop(0, `rgba(180, 225, 255, ${(0.35 * pulse).toFixed(3)})`);
      g.addColorStop(1, "rgba(180, 225, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 16, y - 16, 32, 32);
      speck(ctx, x - 1.5, y - 1.5, 3, 3, "rgba(225, 245, 255, A)", 0.6 + 0.4 * pulse);
    }
    for (const g of this.grains) speck(ctx, g.x, g.y, g.len, 1, "rgba(150, 152, 162, A)", Math.min(1, g.life * 1.5) * 0.8);
    for (const p of this.spores) {
      const fade = Math.min(1, p.life / 2) * (0.6 + 0.4 * Math.sin(t * 3 + p.phase));
      speck(ctx, p.x, p.y, 2, 2, p.ember ? "rgba(255, 170, 90, A)" : "rgba(170, 225, 255, A)", 0.85 * fade);
    }
    const k = 2 * sizeSetting;
    for (const m of this.motes) {
      const s = Math.max(1, Math.round(m.size * k));
      if (m.flake) {
        // Ash flakes turn as they drift: wide, then narrow.
        const wide = Math.sin(t * 2 + m.phase) > 0;
        speck(ctx, m.x, m.y, wide ? s + 1 : Math.max(1, s - 1), wide ? Math.max(1, s - 1) : s + 1, "rgba(150, 156, 170, A)", m.alpha);
      } else speck(ctx, m.x, m.y, s, s, "rgba(226, 232, 244, A)", m.alpha);
    }
  }

  private drawShafts(ctx: CanvasRenderingContext2D, t: number, w: number, top: number, ground: number) {
    for (let i = 0; i < 3; i++) {
      const x = w * (0.18 + i * 0.31);
      const a = 0.035 + 0.015 * Math.sin(t * 0.3 + i * 2);
      const g = ctx.createLinearGradient(x, top, x + 160, ground);
      g.addColorStop(0, `rgba(200, 220, 255, ${a.toFixed(3)})`);
      g.addColorStop(1, "rgba(200, 220, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + 60, top);
      ctx.lineTo(x + 260, ground);
      ctx.lineTo(x + 120, ground);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** A chain sagging between two anchors under the menu bar. */
  private drawSwag(ctx: CanvasRenderingContext2D, a: number, b: number, top: number, sag: number) {
    const n = Math.max(4, Math.round((b - a) / 5));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = a + (b - a) * u;
      const y = top + 4 * sag * u * (1 - u);
      ctx.fillStyle = i % 2 ? "#4b505c" : "#2a2e37";
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, i % 2 ? 2 : 3, 2);
    }
  }

  /**
   * The menu bar's chains and lanterns (the crown window), all inside the bar: small lanterns on
   * short chains from the top edge, and chains looping between them along the bottom edge.
   */
  drawHanging(ctx: CanvasRenderingContext2D, t: number, w: number, menuBar: number) {
    this.layout(w);
    // Chains sag between the rail's anchors, along the top of the bar.
    for (const [a, b] of this.swags) this.drawSwag(ctx, a, b, 3, 7);
    // Each lantern hangs from the rail on its own chain, through the bar, just below its edge.
    for (const l of this.lanterns) this.drawLantern(ctx, l, t, 0, 0, menuBar - 8 + (l.chain % 16));
  }

  /** How far below the top of the screen the menu-bar lanterns reach (for clipping). */
  static hangReach(menuBar: number): number {
    return menuBar + 8 + 16 + 34;
  }

  private drawLantern(ctx: CanvasRenderingContext2D, l: Lantern, t: number, top: number, anchor = top, chain = l.chain) {
    const drop = top - anchor + chain;
    const { chain: swing, lag } = lanternSwing(t, l.phase, drop, l.broken);
    ctx.save();
    ctx.translate(Math.round(l.x), anchor);
    // The anchor: a ring bolted to the rail.
    ctx.fillStyle = "#555b67";
    ctx.fillRect(-3, -1, 6, 2);
    ctx.rotate(swing);
    // Interlocking links: one seen face-on (an open oval), the next edge-on (a bar), alternating.
    for (let y = 0, i = 0; y < drop - 2; y += 4, i++) {
      if (i % 2) {
        ctx.fillStyle = "#3a3f4a";
        ctx.fillRect(-0.75, y - 1, 1.5, 6);
      } else {
        ctx.fillStyle = "#5a606c";
        ctx.fillRect(-2, y, 4, 5);
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(-1, y + 1, 2, 3);
      }
    }
    // The lantern trails its chain a little (a second, slower swing about the last link).
    ctx.translate(0, drop);
    ctx.rotate(lag);
    // The ring on the lantern's cap that the chain hooks into.
    ctx.strokeStyle = "#5a606c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 1.5, 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.translate(0, -drop + 3);
    const y = drop;
    const flicker = l.lit ? 0.7 + 0.18 * Math.sin(t * 7.3 + l.phase) + 0.12 * Math.sin(t * 13.1 + l.phase * 2) : 0;
    const glass = l.lit ? `rgba(200, 236, 255, ${(0.55 + 0.4 * flicker).toFixed(3)})` : "rgba(60, 70, 84, 0.85)";
    if (l.lit) {
      const g = ctx.createRadialGradient(0, y + 12, 1, 0, y + 12, 38);
      g.addColorStop(0, `rgba(190, 230, 255, ${(0.34 * flicker).toFixed(3)})`);
      g.addColorStop(1, "rgba(190, 230, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(-38, y - 26, 76, 76);
    }
    ctx.fillStyle = "#23262e";
    switch (l.kind) {
      case "cage":
        ctx.fillRect(-6, y, 12, 4);
        ctx.fillRect(-8, y + 4, 2, 16);
        ctx.fillRect(6, y + 4, 2, 16);
        ctx.fillRect(-6, y + 20, 12, 4);
        ctx.fillStyle = glass;
        ctx.fillRect(-6, y + 4, 12, 16);
        ctx.fillStyle = "#23262e";
        ctx.fillRect(-1, y + 4, 2, 16);
        break;
      case "orb":
        // A round glass orb in a ring.
        ctx.fillRect(-2, y, 4, 3);
        ctx.fillRect(-6, y + 3, 12, 2);
        ctx.fillRect(-8, y + 5, 16, 12);
        ctx.fillRect(-6, y + 17, 12, 2);
        ctx.fillStyle = glass;
        ctx.fillRect(-6, y + 5, 12, 12);
        ctx.fillRect(-4, y + 3, 8, 2);
        ctx.fillRect(-4, y + 17, 8, 2);
        break;
      case "candle":
        // A tall sconce with a candle flame.
        ctx.fillRect(-4, y, 8, 2);
        ctx.fillRect(-5, y + 2, 2, 22);
        ctx.fillRect(3, y + 2, 2, 22);
        ctx.fillRect(-6, y + 24, 12, 3);
        ctx.fillStyle = "#cfc6b0";
        ctx.fillRect(-2, y + 14, 4, 10);
        ctx.fillStyle = l.lit ? `rgba(220, 240, 255, ${(0.6 + 0.4 * flicker).toFixed(3)})` : "rgba(40, 44, 52, 0.9)";
        ctx.fillRect(-1, y + 9 + Math.round(Math.sin(t * 9 + l.phase)), 2, 4);
        break;
      case "hook":
        // Only a hook left: the lantern fell long ago.
        ctx.fillRect(-1, y, 2, 6);
        ctx.fillRect(1, y + 6, 4, 2);
        ctx.fillRect(4, y + 3, 2, 3);
        break;
    }
    if (l.broken) {
      ctx.fillStyle = "rgba(10, 12, 16, 0.9)";
      ctx.fillRect(1, y + 6, 5, 7);
      ctx.fillRect(-4, y + 13, 2, 3);
    }
    if (l.lit && l.kind !== "candle") {
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.6 * flicker).toFixed(3)})`;
      ctx.fillRect(-2, y + 9, 3, 5);
    }
    ctx.restore();
  }

  private drawFog(ctx: CanvasRenderingContext2D, t: number, w: number, ground: number) {
    for (let layer = 0; layer < 3; layer++) {
      const speed = 6 + layer * 5;
      const span = 420 + layer * 140;
      const y = ground - 14 - layer * 18;
      const offset = (((t * speed * (layer % 2 ? -1 : 1)) % span) + span) % span;
      for (let x = -span + offset; x < w + span; x += span) {
        const cx = x + span / 2;
        const g = ctx.createRadialGradient(cx, y, 4, cx, y, span * 0.55);
        // Slate, not white: it shows over light wallpapers as well as dark ones.
        g.addColorStop(0, `rgba(104, 118, 146, ${(0.16 - layer * 0.04).toFixed(3)})`);
        g.addColorStop(1, "rgba(104, 118, 146, 0)");
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, y);
        ctx.scale(1, 0.22);
        ctx.translate(-cx, -y);
        ctx.fillRect(cx - span * 0.6, y - span * 0.6, span * 1.2, span * 1.2);
        ctx.restore();
      }
    }
  }

  clear() {
    this.motes = [];
    this.spores = [];
    this.grains = [];
  }

  /** For tests. */
  get counts() {
    return { motes: this.motes.length, spores: this.spores.length, lanterns: this.lanterns.length, souls: this.souls.length, kinds: new Set(this.lanterns.map((l) => l.kind)).size };
  }
}

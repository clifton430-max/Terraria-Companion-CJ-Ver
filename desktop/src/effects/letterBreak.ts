// A purely visual, app-owned effect: a synthetic word appears on the companion's own overlay,
// cracks, scatters into pixels, and reassembles a few seconds later. It never reads, modifies or
// covers other applications' text — the word comes from the companion's own settings.

import type { Vec } from "../combat/geometry";

export type LetterPhase = "appear" | "crack" | "scatter" | "reform" | "hold" | "fade";

/** Seconds per phase (total ≈ 4.7 s). */
export const TIMELINE: Record<LetterPhase, number> = {
  appear: 0.35,
  crack: 0.5,
  scatter: 1.6,
  reform: 1.2,
  hold: 0.6,
  fade: 0.4,
};
const ORDER: LetterPhase[] = ["appear", "crack", "scatter", "reform", "hold", "fade"];

/** At most one effect at a time, no more than one start per 6 s, and a hard particle cap. */
export const MIN_INTERVAL = 6;
export const MAX_ACTIVE = 1;
export const MAX_PARTICLES = 1200;

export interface LetterParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Home position (where the pixel belongs in the intact word). */
  hx: number;
  hy: number;
  /** Position when reforming started. */
  sx: number;
  sy: number;
  color: string;
}

export interface LetterEffect {
  id: number;
  word: string;
  /** Top-left of the word, CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Particle size, CSS px. */
  cell: number;
  phase: LetterPhase;
  /** Seconds into the current phase. */
  t: number;
  particles: LetterParticle[];
  /** Seed for the crack pattern (deterministic per effect). */
  seed: number;
}

/** Rasterised word: size plus opaque pixel positions (relative to the word's top-left). */
export interface SampledWord {
  w: number;
  h: number;
  /** Pixel size of each particle (the sampling step). */
  cell: number;
  pixels: { x: number; y: number; color: string }[];
}

/** Supplied by the renderer (canvas text rendering); a fake in tests. */
export type WordSampler = (word: string) => SampledWord;

export type TriggerResult = "started" | "disabled" | "rate-limited" | "busy" | "empty";

const GRAVITY = 900;

/** Rate limits for one LetterBreaker (the word smash and the pickaxe use different ones). */
export interface BreakerLimits {
  minInterval: number;
  maxActive: number;
  maxParticles: number;
}

export const WORD_LIMITS: BreakerLimits = { minInterval: MIN_INTERVAL, maxActive: MAX_ACTIVE, maxParticles: MAX_PARTICLES };

export class LetterBreaker {
  private effectsList: LetterEffect[] = [];
  private lastStart = -Infinity;
  private nextId = 1;
  private enabledFlag = true;

  constructor(
    private readonly sample: WordSampler,
    private readonly rng: () => number,
    private readonly limits: BreakerLimits = WORD_LIMITS,
  ) {}

  get effects(): readonly LetterEffect[] {
    return this.effectsList;
  }

  get enabled() {
    return this.enabledFlag;
  }

  /** The off switch: disabling also clears everything immediately. */
  setEnabled(on: boolean) {
    this.enabledFlag = on;
    if (!on) this.stop();
  }

  /** Remove every effect right now. */
  stop() {
    this.effectsList = [];
  }

  /** Start an effect centred on `center` (clamped on screen), subject to the rate limits. */
  trigger(now: number, word: string, center: Vec, bounds: { width: number; height: number }): TriggerResult {
    if (!this.enabledFlag) return "disabled";
    if (this.effectsList.length >= this.limits.maxActive) return "busy";
    if (now - this.lastStart < this.limits.minInterval) return "rate-limited";
    const sampled = this.sample(word);
    if (sampled.pixels.length === 0) return "empty";
    const x = Math.min(Math.max(center.x - sampled.w / 2, 0), Math.max(0, bounds.width - sampled.w));
    const y = Math.min(Math.max(center.y - sampled.h / 2, 0), Math.max(0, bounds.height - sampled.h));
    // Subsample evenly if the word would exceed the particle cap.
    const cap = this.limits.maxParticles;
    const stride = Math.max(1, Math.ceil(sampled.pixels.length / cap));
    const particles = sampled.pixels
      .filter((_, i) => i % stride === 0)
      .slice(0, cap)
      .map((p) => ({ x: x + p.x, y: y + p.y, vx: 0, vy: 0, hx: x + p.x, hy: y + p.y, sx: 0, sy: 0, color: p.color }));
    this.effectsList.push({
      id: this.nextId++,
      word,
      x,
      y,
      w: sampled.w,
      h: sampled.h,
      cell: sampled.cell * stride ** 0.5,
      phase: "appear",
      t: 0,
      particles,
      seed: Math.floor(this.rng() * 1e9),
    });
    this.lastStart = now;
    return "started";
  }

  /** Advance every effect; finished effects are removed (nothing lingers). */
  step(dt: number, floorY: number) {
    for (const e of this.effectsList) {
      e.t += dt;
      while (e.t >= TIMELINE[e.phase]) {
        e.t -= TIMELINE[e.phase];
        const next = ORDER[ORDER.indexOf(e.phase) + 1];
        if (!next) {
          e.phase = "fade";
          e.t = TIMELINE.fade; // marks done
          break;
        }
        this.enterPhase(e, next);
      }
      if (e.phase === "scatter") this.scatterStep(e, dt, floorY);
      if (e.phase === "reform") this.reformStep(e);
    }
    this.effectsList = this.effectsList.filter((e) => !(e.phase === "fade" && e.t >= TIMELINE.fade));
  }

  private enterPhase(e: LetterEffect, phase: LetterPhase) {
    e.phase = phase;
    if (phase === "scatter") {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      for (const p of e.particles) {
        const a = Math.atan2(p.hy - cy, p.hx - cx) + (this.rng() - 0.5) * 1.2;
        const speed = 120 + this.rng() * 320;
        p.vx = Math.cos(a) * speed;
        p.vy = Math.sin(a) * speed - 220;
      }
    }
    if (phase === "reform") {
      for (const p of e.particles) {
        p.sx = p.x;
        p.sy = p.y;
      }
    }
    if (phase === "hold" || phase === "fade") {
      for (const p of e.particles) {
        p.x = p.hx;
        p.y = p.hy;
        p.vx = p.vy = 0;
      }
    }
  }

  private scatterStep(e: LetterEffect, dt: number, floorY: number) {
    for (const p of e.particles) {
      p.vy += GRAVITY * dt;
      p.vx *= Math.exp(-0.8 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > floorY - 1) {
        p.y = floorY - 1;
        p.vy = -Math.abs(p.vy) * 0.35;
        p.vx *= 0.7;
      }
    }
  }

  private reformStep(e: LetterEffect) {
    const f = Math.min(1, e.t / TIMELINE.reform);
    const ease = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    for (const p of e.particles) {
      p.x = p.sx + (p.hx - p.sx) * ease;
      p.y = p.sy + (p.hy - p.sy) * ease;
    }
  }
}

/** Deterministic crack polylines (word-local coordinates) for the "crack" phase. */
export function crackLines(e: LetterEffect, count = 5): Vec[][] {
  let s = e.seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const lines: Vec[][] = [];
  for (let i = 0; i < count; i++) {
    const pts: Vec[] = [{ x: rand() * e.w, y: 0 }];
    for (let k = 1; k <= 4; k++) pts.push({ x: pts[k - 1].x + (rand() - 0.5) * e.w * 0.25, y: (e.h * k) / 4 });
    lines.push(pts);
  }
  return lines;
}

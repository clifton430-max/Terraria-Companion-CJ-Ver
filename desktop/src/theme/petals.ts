// Falling cherry-blossom petals for the theme layer: a small, capped particle system with
// customisable motion (density, speed, wind, sway, tumble, size and a motion style). Pure and
// deterministic given its random source, so it's tested without a canvas.

export type PetalStyle = "drift" | "flutter" | "spiral" | "gusts";

export interface PetalSettings {
  density: number; // 0–1
  speed: number; // 0.25–2.5
  wind: number; // −1–1
  sway: number; // 0–1
  spin: number; // 0–1
  size: number; // 0.5–2
  style: PetalStyle;
}

export const DEFAULT_PETALS: PetalSettings = { density: 0.35, speed: 1, wind: 0.25, sway: 0.5, spin: 0.5, size: 1, style: "drift" };

export interface Petal {
  x: number;
  y: number;
  /** Sprite variant (shape / tint). */
  kind: number;
  /** Size multiplier for this petal (0.7–1.3, times the setting). */
  scale: number;
  rot: number;
  rotV: number;
  /** 3D tumble angle: the sprite's width is scaled by cos(flip). */
  flip: number;
  phase: number;
  fall: number;
  /** Spiral centre line (spiral style). */
  cx: number;
}

/** Hard cap so the effect stays light on any screen. */
export const MAX_PETALS = 140;
export const PETAL_KINDS = 4;

/** How many petals should be falling for a screen of this size. */
export function targetCount(density: number, width: number, height: number): number {
  const area = (width * height) / (1440 * 900);
  return Math.min(MAX_PETALS, Math.round(Math.max(0, Math.min(1, density)) * 90 * Math.max(0.3, area)));
}

export function spawnPetal(width: number, height: number, rnd: () => number, s: PetalSettings, anywhere: boolean): Petal {
  // Upwind of the screen when there's wind, so the whole width fills evenly.
  const spread = width + Math.abs(s.wind) * height * 0.6;
  const x0 = s.wind > 0 ? -Math.abs(s.wind) * height * 0.6 : 0;
  const x = x0 + rnd() * spread;
  return {
    x,
    y: anywhere ? rnd() * height : -20 - rnd() * 60,
    kind: Math.floor(rnd() * PETAL_KINDS),
    scale: 0.7 + rnd() * 0.6,
    rot: rnd() * Math.PI * 2,
    rotV: (rnd() - 0.5) * 3,
    flip: rnd() * Math.PI * 2,
    phase: rnd() * Math.PI * 2,
    fall: 26 + rnd() * 22,
    cx: x,
  };
}

/** Global wind strength over time ("gusts" style comes and goes; others are steady). */
export function windAt(s: PetalSettings, t: number): number {
  if (s.style !== "gusts") return s.wind;
  const gust = Math.max(0, Math.sin(t * 0.35 + 0.8 * Math.sin(t * 0.13)));
  return s.wind * (0.4 + 1.8 * gust) + (s.wind === 0 ? 0.5 * gust * Math.sin(t * 0.07) : 0);
}

/** Advance one petal by dt seconds at time t. */
export function stepPetal(p: Petal, dt: number, t: number, s: PetalSettings): Petal {
  const speed = s.speed;
  const wind = windAt(s, t) * 70 * speed;
  const sway = s.sway * 34;
  const spin = s.spin;
  let { x, y, rot, flip, cx } = p;
  const big = 0.85 + 0.3 * p.scale; // larger petals fall a touch faster
  switch (s.style) {
    case "flutter": {
      // Quick side-to-side flutter with bursts of slower falling.
      x += (wind + Math.sin(t * 4.2 + p.phase) * sway * 2.2) * dt;
      y += p.fall * speed * big * (0.55 + 0.6 * Math.abs(Math.sin(t * 2.6 + p.phase))) * dt;
      flip += (2 + spin * 6) * dt;
      break;
    }
    case "spiral": {
      // Corkscrew around a centre line drifting with the wind.
      cx += wind * dt;
      const r = 10 + sway * 40;
      x = cx + Math.sin(t * 1.8 + p.phase) * r;
      y += p.fall * speed * big * dt;
      flip = t * 1.8 + p.phase;
      break;
    }
    default: {
      // drift / gusts: lazy pendulum sway.
      x += (wind + Math.cos(t * 1.25 + p.phase) * sway) * dt;
      y += p.fall * speed * big * dt;
      flip += (0.6 + spin * 2.4) * dt;
    }
  }
  rot += p.rotV * spin * dt;
  return { ...p, x, y, rot, flip, cx };
}

/**
 * Step the whole system: move petals, recycle ones that left the screen, and grow or shrink
 * toward the target count (gradually, so changing settings never pops).
 */
export function stepPetals(list: Petal[], dt: number, t: number, s: PetalSettings, width: number, height: number, rnd: () => number): Petal[] {
  const target = targetCount(s.density, width, height);
  const margin = 60;
  const out: Petal[] = [];
  for (const p of list) {
    const n = stepPetal(p, dt, t, s);
    const gone = n.y > height + 20 || n.x < -margin * 4 || n.x > width + margin * 4;
    if (gone) {
      if (out.length < target) out.push(spawnPetal(width, height, rnd, s, false));
    } else out.push(n);
  }
  // On start, fill the screen at once (spread over its height); later, add a few per step.
  const initial = list.length === 0;
  for (let i = 0; out.length < target && (initial || i < 3); i++) out.push(spawnPetal(width, height, rnd, s, initial));
  return out.length > target + 2 ? out.slice(0, target) : out;
}

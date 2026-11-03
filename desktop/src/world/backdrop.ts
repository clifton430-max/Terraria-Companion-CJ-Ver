// The world's backdrop, like Terraria's: a sky that follows the time of day (sun, moon in its
// phase, stars, drifting clouds), layered parallax scenery for the biome you're in (mountains,
// forests, dunes, mushroom groves, the sea…) with a haze between the layers for depth, and the
// underground's own layered rock behind the caves. Moving into another biome crossfades the
// scenery instead of switching it; each place has its particles (snow, sand, fireflies, spores,
// pixie dust, embers) drawn over the world. All art comes from the local install.

import { getTexture } from "../assets/textures";
import { hash, HELL_TOP, SURFACE_BASE, type WorldMap, type Zone } from "./gen";
import type { Camera } from "./view";

/** One parallax layer: a background image, how fast it scrolls (0 far … 1 with the world), and
 * how high its bottom sits above the horizon (in image heights). */
interface Layer {
  bg: number;
  speed: number;
  lift: number;
}

export type ParticleKind = "leaves" | "fireflies" | "snow" | "sand" | "spores" | "glowspores" | "vile" | "ichor" | "pixie" | "embers" | "dust" | "mist" | "wisps";

interface Scene {
  layers: Layer[];
  /** Sky gradient by day (top, horizon). */
  sky: [string, string];
  /** Haze laid between the layers (aerial perspective). */
  haze: string;
  /** Day and night particles. */
  day: ParticleKind | null;
  night: ParticleKind | null;
  /** Clouds tinted (corruption purple, crimson red…), or null for white. */
  cloudTint?: string;
}

const L = (bg: number, speed: number, lift: number): Layer => ({ bg, speed, lift });

export type SceneId = "forest" | "forest2" | "forest3" | "snow" | "desert" | "jungle" | "corruption" | "crimson" | "hallow" | "mushroom" | "ocean" | "sky";

export const SCENES: Record<SceneId, Scene> = {
  forest: { layers: [L(7, 0.06, 0.45), L(8, 0.12, 0.3), L(9, 0.2, 0.15), L(10, 0.28, 0.06), L(11, 0.36, 0)], sky: ["#4a86e8", "#b4dcff"], haze: "#b4dcff", day: "leaves", night: "fireflies" },
  forest2: { layers: [L(7, 0.06, 0.45), L(8, 0.12, 0.3), L(50, 0.2, 0.12), L(51, 0.28, 0.04), L(52, 0.36, 0)], sky: ["#4a86e8", "#b4dcff"], haze: "#b4dcff", day: "leaves", night: "fireflies" },
  forest3: { layers: [L(90, 0.05, 0.4), L(91, 0.12, 0.22), L(53, 0.2, 0.1), L(54, 0.28, 0.03), L(55, 0.36, 0)], sky: ["#4a86e8", "#b4dcff"], haze: "#c2e4ff", day: "leaves", night: "fireflies" },
  snow: { layers: [L(99, 0.04, 0.4), L(36, 0.1, 0.3), L(37, 0.2, 0.12), L(38, 0.28, 0.04), L(39, 0.36, 0)], sky: ["#7aa3e6", "#e4f1ff"], haze: "#e8f3ff", day: "snow", night: "snow" },
  desert: { layers: [L(207, 0.05, 0.3), L(20, 0.12, 0.18), L(21, 0.22, 0.06), L(218, 0.34, 0)], sky: ["#5c95e6", "#f3dcae"], haze: "#f6dfb4", day: "sand", night: "sand" },
  jungle: { layers: [L(15, 0.06, 0.3), L(16, 0.14, 0.16), L(60, 0.24, 0.05), L(61, 0.34, 0)], sky: ["#3f8fd8", "#c2eab0"], haze: "#b9e2a8", day: "spores", night: "fireflies" },
  corruption: { layers: [L(225, 0.05, 0.32), L(12, 0.14, 0.18), L(13, 0.24, 0.06), L(14, 0.34, 0)], sky: ["#3d3570", "#a08cc4"], haze: "#8c78b4", day: "vile", night: "vile", cloudTint: "#8a74b8" },
  crimson: { layers: [L(174, 0.05, 0.25), L(43, 0.14, 0.16), L(44, 0.24, 0.06), L(45, 0.34, 0)], sky: ["#6a2c3c", "#d49a96"], haze: "#c88888", day: "ichor", night: "ichor", cloudTint: "#c88a8a" },
  hallow: { layers: [L(220, 0.05, 0.3), L(102, 0.14, 0.16), L(103, 0.24, 0.06), L(104, 0.34, 0)], sky: ["#6f9cff", "#ffd8f2"], haze: "#ffe0f4", day: "pixie", night: "pixie", cloudTint: "#ffe6fb" },
  mushroom: { layers: [L(231, 0.05, 0.3), L(46, 0.14, 0.16), L(47, 0.24, 0.06), L(48, 0.34, 0)], sky: ["#14215a", "#3c58b4"], haze: "#3a5ab0", day: "glowspores", night: "glowspores", cloudTint: "#6d86d8" },
  ocean: { layers: [L(210, 0.04, 0.02), L(111, 0.1, 0)], sky: ["#3d86e8", "#aee4ff"], haze: "#c4ecff", day: "mist", night: "fireflies" },
  sky: { layers: [L(113, 0.08, -0.6), L(112, 0.16, -0.4)], sky: ["#2f6fdc", "#9fd2ff"], haze: "#d8eeff", day: "wisps", night: "wisps" },
};

/** Underground backgrounds by zone: the dirt layer and the rock layer below it. */
const UNDER: Partial<Record<Zone | "default", { dirt: number; rock: number }>> = {
  default: { dirt: 2, rock: 3 },
  snow: { dirt: 120, rock: 119 },
  desert: { dirt: 122, rock: 124 },
  jungle: { dirt: 87, rock: 89 },
  mushroom: { dirt: 65, rock: 63 },
};
const HELL_BG = 5;
/** Rows of the dirt layer under the surface before the rock layer. */
const DIRT_ROWS = 24;

/** Each zone's tint over the underground backdrop. */
const UNDER_TINT: Partial<Record<Zone, string>> = {
  corruption: "rgba(80, 40, 130, 0.35)",
  crimson: "rgba(140, 30, 40, 0.35)",
  hallow: "rgba(200, 120, 220, 0.25)",
  hive: "rgba(200, 140, 20, 0.3)",
  dungeon: "rgba(30, 40, 90, 0.35)",
};

/** The scene for a column's surface biome (the forest has three looks, by world). */
export function sceneFor(map: WorldMap, zone: Zone): SceneId {
  switch (zone) {
    case "forest": {
      const v = Math.floor(hash(map.seed + 500, 1) * 3);
      return (["forest", "forest2", "forest3"] as const)[v];
    }
    case "snow":
    case "desert":
    case "jungle":
    case "corruption":
    case "crimson":
    case "hallow":
    case "mushroom":
    case "ocean":
    case "sky":
      return zone;
    default:
      return "forest";
  }
}

/** Particles for a zone (underground zones have their own), by day or night. */
export function particlesFor(scene: SceneId, zone: Zone, night: boolean): ParticleKind | null {
  if (zone === "underworld") return "embers";
  if (zone === "mushroom") return "glowspores";
  if (zone === "caverns" || zone === "underground" || zone === "dungeon") return "dust";
  const s = SCENES[scene];
  return night ? s.night : s.day;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  kind: ParticleKind;
  hue: number;
}

const FADE_S = 1.6;
/** Cloud sprites (not the wind swirls, 9–13). */
const CLOUDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 19, 20, 21];

const tintCache = new Map<string, HTMLCanvasElement>();
/** A cloud washed with a colour (the corruption's purple, the crimson's red), kept for reuse. */
function tinted(img: ImageBitmap, tint: string): HTMLCanvasElement {
  const key = `${img.width}x${img.height}:${tint}`;
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-atop";
  x.globalAlpha = 0.45;
  x.fillStyle = tint;
  x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
}
/** How much of each scenery layer sits below the horizon. */
const SINK = 0.3;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
};

export interface BackdropTime {
  /** 0–24. */
  hour: number;
  /** 0 (night) … 1 (day). */
  daylight: number;
  /** In-game day (for the moon's phase). */
  day: number;
}

export class Backdrop {
  /** Scenes being shown, oldest first, each with its opacity (the newest fades in over the rest). */
  private shown: { id: SceneId; a: number }[] = [];
  private last = 0;
  private particles: Particle[] = [];
  private zone: Zone = "forest";
  private night = false;
  private clock = 0;

  constructor(private map: WorldMap) {}

  setMap(map: WorldMap) {
    this.map = map;
    this.reset();
  }

  /** Forget the scenery shown so far (the next draw shows its own straight away). */
  reset() {
    this.shown = [];
    this.particles = [];
    this.last = 0;
  }

  /** Art the backdrop draws (so it can be loaded up front). */
  static textures(): string[] {
    const bgs = new Set<number>([HELL_BG, ...Object.values(SCENES).flatMap((s) => s.layers.map((l) => l.bg)), ...Object.values(UNDER).flatMap((u) => [u!.dirt, u!.rock])]);
    return [...[...bgs].map((n) => `Images/Background_${n}`), "Images/Sun", ...Array.from({ length: 9 }, (_, i) => `Images/Moon_${i}`), ...CLOUDS.map((i) => `Images/Cloud_${i}`)];
  }

  /** Where we are (the tile at the middle of attention) and what time it is: advance the fades. */
  update(now: number, focus: { x: number; y: number }, time: BackdropTime) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.clock += dt;
    const m = this.map;
    const x = Math.max(0, Math.min(m.size.width - 1, Math.floor(focus.x)));
    const y = Math.floor(focus.y);
    // The scenery belongs to the surface biome overhead (deep down, the rock covers it anyway).
    const surfaceZone: Zone = y < SURFACE_BASE - 80 ? "sky" : m.biome(x);
    const want = sceneFor(m, surfaceZone);
    this.zone = m.zone(x, y);
    this.night = time.daylight < 0.6;
    const top = this.shown[this.shown.length - 1];
    if (!top) this.shown.push({ id: want, a: 1 });
    else if (top.id !== want) {
      // Come back to a scene that's still fading out: lift it to the top.
      const i = this.shown.findIndex((s) => s.id === want);
      const a = i >= 0 ? this.shown.splice(i, 1)[0].a : 0;
      this.shown.push({ id: want, a });
    }
    const head = this.shown[this.shown.length - 1];
    head.a = Math.min(1, head.a + dt / FADE_S);
    // Once the newest is fully in, the ones under it go.
    if (head.a >= 1) this.shown = [head];
    this.stepParticles(dt, time);
  }

  /** The sky, the clouds, the scenery and the underground layers, behind the world's tiles. */
  drawBack(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, w: number, h: number, time: BackdropTime) {
    const m = this.map;
    const midX = Math.max(0, Math.min(m.size.width - 1, Math.floor(cam.x + w / tp / 2)));
    const horizon = (m.surface(midX) - cam.y) * tp;
    if (!this.shown.length) this.shown.push({ id: sceneFor(m, m.biome(midX)), a: 1 });
    // 1. The sky: each shown scene's gradient, dimmed and warmed by the time of day.
    for (const s of this.shown) {
      ctx.globalAlpha = s.a;
      this.drawSky(ctx, SCENES[s.id], w, h, horizon, time);
    }
    ctx.globalAlpha = 1;
    this.drawStars(ctx, w, h, time);
    this.drawSunMoon(ctx, w, h, horizon, time);
    // 2. Clouds drifting across.
    this.drawClouds(ctx, cam, tp, w, h, time);
    // 3. The scenery, far to near, with haze between the layers.
    const dark = 1 - time.daylight;
    for (const s of this.shown) this.drawScenery(ctx, SCENES[s.id], s.a, cam, tp, w, h, horizon, dark);
    // 4. Underground: layered rock behind the caves (column by column under the surface).
    this.drawUnderground(ctx, cam, tp, w, h);
  }

  private drawSky(ctx: CanvasRenderingContext2D, sc: Scene, w: number, h: number, horizon: number, time: BackdropTime) {
    const night = 1 - time.daylight;
    const top = mix(sc.sky[0], "#040818", Math.min(1, night * 1.35));
    const bottom = mix(sc.sky[1], "#16224a", Math.min(1, night * 1.35));
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(h * 0.5, horizon));
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Dawn and dusk: a warm glow low in the sky.
    const hr = time.hour;
    const glow = Math.max(0, 1 - Math.abs(hr - 5.5) / 1.4, 1 - Math.abs(hr - 19) / 1.4);
    if (glow > 0) {
      const y = Math.max(h * 0.35, Math.min(h, horizon));
      const d = ctx.createLinearGradient(0, y - h * 0.45, 0, y);
      d.addColorStop(0, "rgba(255, 140, 80, 0)");
      d.addColorStop(1, `rgba(255, 130, 70, ${(0.45 * glow).toFixed(3)})`);
      ctx.fillStyle = d;
      ctx.fillRect(0, 0, w, y);
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, time: BackdropTime) {
    const a = Math.max(0, 1 - time.daylight * 1.6);
    if (a <= 0.02) return;
    for (let i = 0; i < 140; i++) {
      const x = hash(77, i) * w;
      const y = hash(78, i) * h * 0.6;
      const tw = 0.55 + 0.45 * Math.sin(this.clock * (1 + hash(79, i) * 2) + i);
      ctx.fillStyle = `rgba(255, 255, ${200 + Math.floor(hash(80, i) * 55)}, ${(a * tw).toFixed(3)})`;
      const s = hash(81, i) < 0.12 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }

  private drawSunMoon(ctx: CanvasRenderingContext2D, w: number, h: number, horizon: number, time: BackdropTime) {
    const hr = ((time.hour % 24) + 24) % 24;
    const span = Math.max(h * 0.55, Math.min(h, horizon));
    const arc = (t: number) => ({ x: w * (0.08 + t * 0.84), y: span * 0.95 - Math.sin(Math.PI * t) * span * 0.8 });
    if (hr >= 4.5 && hr <= 19.5) {
      const sun = getTexture("Images/Sun");
      const p = arc((hr - 4.5) / 15);
      const s = Math.min(1.4, Math.max(0.8, h / 900));
      if (sun) ctx.drawImage(sun, Math.round(p.x - (sun.width * s) / 2), Math.round(p.y - (sun.height * s) / 2), sun.width * s, sun.height * s);
    } else {
      const t = (hr >= 19.5 ? hr - 19.5 : hr + 4.5) / 9;
      const moon = getTexture(`Images/Moon_${Math.abs(time.day) % 3}`);
      const p = arc(t);
      const phase = Math.abs(time.day) % 8;
      if (moon) ctx.drawImage(moon, 0, phase * 50, 50, 50, Math.round(p.x - 25), Math.round(p.y - 25), 50, 50);
    }
  }

  private drawClouds(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, w: number, h: number, time: BackdropTime) {
    const tint = SCENES[this.shown[this.shown.length - 1].id].cloudTint;
    const dim = 0.35 + time.daylight * 0.65;
    const band = w + 800;
    for (let i = 0; i < 16; i++) {
      const raw0 = getTexture(`Images/Cloud_${CLOUDS[Math.floor(hash(90, i) * CLOUDS.length)]}`);
      if (!raw0) continue;
      const img = tint ? tinted(raw0, tint) : raw0;
      const speed = 6 + hash(91, i) * 14;
      const depth = 0.03 + hash(92, i) * 0.06;
      const raw = hash(93, i) * band + this.clock * speed - cam.x * tp * depth;
      const x = ((raw % band) + band) % band - 400;
      const y = h * (0.04 + hash(94, i) * 0.34) - Math.max(0, cam.y - 120) * tp * 0.02;
      const s = 0.7 + hash(95, i) * 0.6;
      ctx.globalAlpha = (0.55 + hash(96, i) * 0.4) * dim;
      ctx.drawImage(img, Math.round(x), Math.round(y), img.width * s, img.height * s);
    }
    ctx.globalAlpha = 1;
  }

  private drawScenery(ctx: CanvasRenderingContext2D, sc: Scene, alpha: number, cam: Camera, tp: number, w: number, h: number, horizon: number, dark: number) {
    const scale = h > 1300 ? 2 : 1;
    sc.layers.forEach((layer, i) => {
      const img = getTexture(`Images/Background_${layer.bg}`);
      if (!img) return;
      // Haze over what's behind this layer (the further, the paler).
      if (i > 0) {
        ctx.globalAlpha = alpha * 0.05;
        ctx.fillStyle = sc.haze;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = alpha;
      const iw = img.width * scale;
      const ih = img.height * scale;
      // (Sunk a little behind the ground, so plenty of sky shows above the scenery.)
      const y = Math.round(horizon - ih * (1 - SINK) - ih * layer.lift + 4 * tp);
      const offset = -((((cam.x * tp * layer.speed) % iw) + iw) % iw);
      for (let x = offset - iw; x < w; x += iw) ctx.drawImage(img, Math.round(x), y, iw, ih);
      // Below the layer: its bottom colour, so no sky shows under the hills.
      if (y + ih < h) ctx.drawImage(img, 0, img.height - 1, img.width, 1, 0, y + ih - 1, w, h - (y + ih - 1));
    });
    // Night falls on the scenery too.
    if (dark > 0.02) {
      ctx.globalAlpha = alpha * dark * 0.75;
      ctx.fillStyle = "#060a1e";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  }

  private drawUnderground(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, w: number, h: number) {
    const m = this.map;
    const k = tp / 16;
    const x0 = Math.floor(cam.x);
    const x1 = Math.ceil(cam.x + w / tp);
    const yBottom = cam.y + h / tp;
    const pat = (bg: number) => {
      const img = getTexture(`Images/Background_${bg}`);
      if (!img) return null;
      const p = ctx.createPattern(img, "repeat");
      // Scrolls a little slower than the world (it's further back).
      p?.setTransform(new DOMMatrix([k * 2, 0, 0, k * 2, -cam.x * tp * 0.6, -cam.y * tp * 0.6]));
      return p;
    };
    const cache = new Map<number, CanvasPattern | null>();
    const get = (bg: number) => {
      if (!cache.has(bg)) cache.set(bg, pat(bg));
      return cache.get(bg)!;
    };
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= m.size.width) continue;
      const surface = m.surface(x);
      const top = surface + 2;
      if (top > yBottom) continue;
      const zone = m.zone(x, Math.max(top + 30, Math.floor(cam.y + h / tp / 2)));
      const set = UNDER[zone] ?? UNDER[m.biome(x)] ?? UNDER.default!;
      const X = Math.round((x - cam.x) * tp);
      const W = Math.round((x + 1 - cam.x) * tp) - X;
      const band = (a: number, b: number, bg: number) => {
        const ya = Math.max(a, cam.y);
        const yb = Math.min(b, yBottom);
        if (yb <= ya) return;
        const p = get(bg);
        const Y = Math.round((ya - cam.y) * tp);
        const H = Math.round((yb - cam.y) * tp) - Y;
        ctx.fillStyle = p ?? "#3a2c22";
        ctx.fillRect(X, Y, W, H);
        // Further back than the caves' own walls: dimmed.
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.fillRect(X, Y, W, H);
        const tint = UNDER_TINT[zone];
        if (tint) {
          ctx.fillStyle = tint;
          ctx.fillRect(X, Y, W, H);
        }
      };
      band(top, top + DIRT_ROWS, set.dirt);
      band(top + DIRT_ROWS, HELL_TOP - 6, set.rock);
      band(HELL_TOP - 6, m.size.height, HELL_BG);
    }
    // The underworld glows from below.
    const hellY = (HELL_TOP - 30 - cam.y) * tp;
    if (hellY < h) {
      const g = ctx.createLinearGradient(0, Math.max(0, hellY), 0, h);
      g.addColorStop(0, "rgba(255, 80, 20, 0)");
      g.addColorStop(1, "rgba(255, 90, 30, 0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.max(0, hellY), w, h - Math.max(0, hellY));
    }
  }

  // ── Particles ────────────────────────────────────────────────────────────────────────────

  private view = { x: 0, y: 0, w: 1, h: 1 };

  private stepParticles(dt: number, time: BackdropTime) {
    const scene = this.shown[this.shown.length - 1]?.id ?? "forest";
    const kind = particlesFor(scene, this.zone, this.night);
    const v = this.view;
    for (const p of this.particles) {
      p.age += dt;
      const sway = Math.sin((p.age + p.hue * 10) * 2.2);
      switch (p.kind) {
        case "snow":
        case "leaves":
          p.x += (p.vx + sway * 12) * dt;
          p.y += p.vy * dt;
          break;
        case "fireflies":
        case "dust":
          p.x += (p.vx + Math.sin(p.age * 1.3 + p.hue * 20) * 10) * dt;
          p.y += (p.vy + Math.cos(p.age * 1.1 + p.hue * 30) * 8) * dt;
          break;
        default:
          p.x += (p.vx + sway * 4) * dt;
          p.y += p.vy * dt;
      }
    }
    // Out of view or done: gone (the old kind dies away on its own after a change of scene).
    this.particles = this.particles.filter((p) => p.age < p.life && p.x > v.x - 64 && p.x < v.x + v.w + 64 && p.y > v.y - 96 && p.y < v.y + v.h + 64);
    if (!kind) return;
    const want = Math.min(160, Math.round(((v.w * v.h) / (1600 * 900)) * DENSITY[kind] * (0.6 + 0.4 * time.daylight + (this.night ? 0.4 : 0))));
    let n = this.particles.filter((p) => p.kind === kind).length;
    let budget = Math.ceil(dt * 60) + 1;
    while (n < want && budget-- > 0) {
      this.particles.push(spawn(kind, v));
      n++;
    }
  }

  /** Particles over the world (world pixels → screen). */
  drawFront(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, w: number, h: number) {
    const k = tp / 16;
    this.view = { x: cam.x * 16, y: cam.y * 16, w: w / k, h: h / k };
    for (const p of this.particles) {
      const X = (p.x - this.view.x) * k;
      const Y = (p.y - this.view.y) * k;
      const fade = Math.min(1, p.age / 0.6, (p.life - p.age) / 0.8);
      if (fade <= 0) continue;
      const s = Math.max(1, Math.round(p.size * Math.max(1, k * 0.75)));
      const style = STYLE[p.kind](p, this.clock);
      ctx.globalAlpha = fade * style.a;
      ctx.fillStyle = style.c;
      ctx.fillRect(Math.round(X), Math.round(Y), s, p.kind === "sand" || p.kind === "wisps" ? Math.max(1, Math.round(s / 3)) : s);
      if (style.glow) {
        ctx.globalAlpha = fade * style.a * 0.25;
        ctx.fillRect(Math.round(X) - s, Math.round(Y) - s, s * 3, s * 3);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Particles per 1600×900 view. */
const DENSITY: Record<ParticleKind, number> = { leaves: 10, fireflies: 34, snow: 150, sand: 70, spores: 40, glowspores: 60, vile: 46, ichor: 46, pixie: 60, embers: 80, dust: 26, mist: 14, wisps: 18 };

function spawn(kind: ParticleKind, v: { x: number; y: number; w: number; h: number }): Particle {
  const r = Math.random;
  const p: Particle = { x: v.x + r() * v.w, y: v.y + r() * v.h, vx: 0, vy: 0, age: 0, life: 4 + r() * 6, size: 1, kind, hue: r() };
  switch (kind) {
    case "snow":
      p.y = v.y - 20 - r() * 40;
      p.vx = -8 + r() * 6;
      p.vy = 22 + r() * 30;
      p.size = r() < 0.3 ? 2 : 1;
      p.life = 30;
      break;
    case "leaves":
      p.y = v.y - 20;
      p.vx = 10 + r() * 14;
      p.vy = 16 + r() * 14;
      p.size = 2;
      p.life = 30;
      break;
    case "sand":
      p.x = v.x - 30;
      p.vx = 140 + r() * 120;
      p.vy = 4 + r() * 10;
      p.size = 3;
      p.life = 12;
      break;
    case "fireflies":
      p.vx = -4 + r() * 8;
      p.vy = -3 + r() * 6;
      p.life = 6 + r() * 8;
      break;
    case "spores":
    case "glowspores":
      p.vy = -6 - r() * 8;
      p.vx = -3 + r() * 6;
      p.size = r() < 0.4 ? 2 : 1;
      break;
    case "vile":
      p.vx = 6 + r() * 10;
      p.vy = 4 + r() * 6;
      p.size = r() < 0.4 ? 2 : 1;
      break;
    case "ichor":
      p.vy = -8 - r() * 10;
      p.size = r() < 0.3 ? 2 : 1;
      break;
    case "pixie":
      p.vy = -10 - r() * 12;
      p.vx = -4 + r() * 8;
      p.life = 3 + r() * 4;
      break;
    case "embers":
      p.y = v.y + v.h + 10;
      p.vy = -40 - r() * 50;
      p.vx = -10 + r() * 20;
      p.size = r() < 0.3 ? 2 : 1;
      p.life = 8;
      break;
    case "dust":
      p.vx = -2 + r() * 4;
      p.vy = -1 + r() * 2;
      p.life = 8 + r() * 8;
      break;
    case "mist":
      p.vx = 6 + r() * 8;
      p.size = 3;
      p.life = 8;
      break;
    case "wisps":
      p.vx = 60 + r() * 40;
      p.size = 6;
      p.life = 6;
      break;
  }
  return p;
}

const STYLE: Record<ParticleKind, (p: Particle, clock: number) => { c: string; a: number; glow?: boolean }> = {
  snow: () => ({ c: "#ffffff", a: 0.9 }),
  leaves: (p) => ({ c: p.hue < 0.5 ? "#5fae3c" : p.hue < 0.8 ? "#8fc24a" : "#d08a34", a: 0.9 }),
  fireflies: (p, t) => ({ c: "#e8ff8a", a: 0.35 + 0.65 * Math.max(0, Math.sin(t * 2 + p.hue * 40)), glow: true }),
  sand: () => ({ c: "#e6c98c", a: 0.55 }),
  spores: () => ({ c: "#d6f08a", a: 0.7, glow: true }),
  glowspores: (p, t) => ({ c: "#7fb4ff", a: 0.55 + 0.35 * Math.sin(t * 3 + p.hue * 30), glow: true }),
  vile: () => ({ c: "#a080d0", a: 0.7 }),
  ichor: () => ({ c: "#ff5050", a: 0.7, glow: true }),
  pixie: (p, t) => ({ c: p.hue < 0.33 ? "#ff9ae6" : p.hue < 0.66 ? "#8ef2ff" : "#fff48a", a: 0.4 + 0.6 * Math.max(0, Math.sin(t * 6 + p.hue * 50)), glow: true }),
  embers: (p, t) => ({ c: p.hue < 0.5 ? "#ff9a3a" : "#ffd25a", a: 0.6 + 0.4 * Math.sin(t * 9 + p.hue * 20), glow: true }),
  dust: () => ({ c: "#d8d0c0", a: 0.3 }),
  mist: () => ({ c: "#ffffff", a: 0.18 }),
  wisps: () => ({ c: "#ffffff", a: 0.35 }),
};

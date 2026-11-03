// Drawing for Silksong Controls on the effects canvas: the Needle (original pixel art: a thin
// silver blade with a red thread), white slash crescents, silk trails, the Thread spin, the
// Clawline thread, the charge glow, dash streaks and the silk meter. Kept readable at desktop
// scale; colours echo the companion's pink/red accents.

import { getTexture } from "../assets/textures";
import type { Vec } from "../combat/geometry";
import { needleAngle, slashArc } from "./anim";
import type { NeedleKind } from "./needle";

export interface SilkVisual {
  /** Hand position (where the Needle is held). */
  hand: Vec;
  dir: 1 | -1;
  scale: number;
  attack: { kind: NeedleKind; p: number; t: number } | null;
  /** Body centre (for the spin and the meter). */
  center: Vec;
  top: number;
  trail: readonly Vec[];
  grapple: { anchor: Vec } | null;
  miss: { toward: Vec; t: number } | null;
  charge: number;
  dashing: boolean;
  silk: number;
  maxSilk: number;
  /** A Terraria sword making the strike (drawn instead of the Needle). */
  weaponArt?: { texture: string; size: [number, number]; grip: [number, number]; tip: [number, number] } | null;
  /** Feet (for the dive's landing slam). */
  feet?: Vec;
}

type Mark = (x: number, y: number, w: number, h: number) => void;

const RED = "#d02a3a";
const SILK = "#ffe4ee";

function needle(ctx: CanvasRenderingContext2D, at: Vec, angle: number, s: number) {
  const len = 22 * s;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  // Blade with a darker edge, a bright tip and a small cross-guard: chunky pixel steps.
  ctx.fillStyle = "#6b7484";
  ctx.fillRect(0, -s, len, 2 * s);
  ctx.fillStyle = "#e8eef6";
  ctx.fillRect(s, -s / 2, len - 2 * s, s);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(len - 3 * s, -s / 2, 3 * s, s);
  ctx.fillStyle = "#3a2a2e";
  ctx.fillRect(-2 * s, -2 * s, 2 * s, 4 * s);
  // The red thread trailing from the hilt.
  ctx.strokeStyle = RED;
  ctx.lineWidth = Math.max(1, s * 0.8);
  ctx.beginPath();
  ctx.moveTo(-2 * s, 0);
  ctx.quadraticCurveTo(-7 * s, 4 * s, -12 * s, 1 * s);
  ctx.stroke();
  ctx.restore();
}

/** A Terraria sword's sprite held at `at`, pointing along `angle` (its grip→tip axis). */
function sword(ctx: CanvasRenderingContext2D, at: Vec, angle: number, s: number, art: NonNullable<SilkVisual["weaponArt"]>): boolean {
  const tex = getTexture(art.texture);
  if (!tex) return false;
  // Item art shares Terraria's pixel size with the character (s = CSS px per art pixel).
  const axis = Math.atan2(art.tip[1] - art.grip[1], art.tip[0] - art.grip[0]);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle - axis);
  ctx.drawImage(tex, -art.grip[0] * s, -art.grip[1] * s, art.size[0] * s, art.size[1] * s);
  ctx.restore();
  return true;
}

export function drawSilkVisual(ctx: CanvasRenderingContext2D, v: SilkVisual, mark: Mark) {
  const s = v.scale;
  const blade = (at: Vec, angle: number, size: number) => {
    if (!(v.weaponArt && sword(ctx, at, angle, size, v.weaponArt))) needle(ctx, at, angle, size);
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Silk trail: a fading red ribbon with a pale core.
  if (v.trail.length > 1) {
    for (let i = 1; i < v.trail.length; i++) {
      const a = i / v.trail.length;
      const p0 = v.trail[i - 1];
      const p1 = v.trail[i];
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = RED;
      ctx.lineWidth = (1 + 2 * a) * s;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.strokeStyle = SILK;
      ctx.lineWidth = a * s;
      ctx.stroke();
      mark(Math.min(p0.x, p1.x) - 4 * s, Math.min(p0.y, p1.y) - 4 * s, Math.abs(p1.x - p0.x) + 8 * s, Math.abs(p1.y - p0.y) + 8 * s);
    }
    ctx.globalAlpha = 1;
  }

  // Dash streaks behind the body.
  if (v.dashing) {
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = s;
    for (let k = 0; k < 4; k++) {
      const y = v.center.y - 12 * s + k * 8 * s;
      const x0 = v.center.x - v.dir * (10 * s + k * 3 * s);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 - v.dir * (18 + k * 6) * s, y);
      ctx.stroke();
    }
    mark(v.center.x - 50 * s, v.center.y - 16 * s, 100 * s, 36 * s);
  }

  // Clawline: the thread to the anchor (or a quick miss that snaps back).
  const line = (to: Vec, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = SILK;
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.moveTo(v.hand.x, v.hand.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    needle(ctx, to, Math.atan2(to.y - v.hand.y, to.x - v.hand.x), s * 0.8);
    ctx.globalAlpha = 1;
    mark(Math.min(v.hand.x, to.x) - 30 * s, Math.min(v.hand.y, to.y) - 30 * s, Math.abs(to.x - v.hand.x) + 60 * s, Math.abs(to.y - v.hand.y) + 60 * s);
  };
  if (v.grapple) line(v.grapple.anchor, 1);
  if (v.miss && v.miss.t < 0.3) {
    const f = v.miss.t < 0.15 ? v.miss.t / 0.15 : 1 - (v.miss.t - 0.15) / 0.15;
    line({ x: v.hand.x + (v.miss.toward.x - v.hand.x) * f, y: v.hand.y + (v.miss.toward.y - v.hand.y) * f }, 0.8);
  }

  // Charge glow at the hand.
  if (v.charge > 0 && !v.attack) {
    const r = (6 + 10 * v.charge) * s;
    const g = ctx.createRadialGradient(v.hand.x, v.hand.y, 0, v.hand.x, v.hand.y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.5 + 0.5 * v.charge})`);
    g.addColorStop(1, "rgba(255,90,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(v.hand.x - r, v.hand.y - r, r * 2, r * 2);
    mark(v.hand.x - r, v.hand.y - r, r * 2, r * 2);
  }

  // Attacks: the Needle plus its slash, lunge streak or spinning thread.
  const a = v.attack;
  if (a) {
    if (a.kind === "spin") {
      const R = 34 * s;
      for (let k = 0; k < 2; k++) {
        const rot = a.t * 18 + k * Math.PI;
        ctx.strokeStyle = k === 0 ? RED : SILK;
        ctx.lineWidth = (k === 0 ? 3 : 2) * s;
        ctx.globalAlpha = 0.9 * (1 - a.p * 0.5);
        ctx.beginPath();
        ctx.arc(v.center.x, v.center.y, R * (0.75 + 0.25 * k), rot, rot + 2.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      needle(ctx, v.center, needleAngle("spin", a.p, v.dir, a.t), s);
      mark(v.center.x - R - 8 * s, v.center.y - R - 8 * s, (R + 8 * s) * 2, (R + 8 * s) * 2);
    } else if (a.kind === "charged") {
      const len = 60 * s;
      const fade = a.p < 0.15 ? 0 : 1 - (a.p - 0.15) / 0.85;
      ctx.globalAlpha = fade;
      ctx.fillStyle = SILK;
      ctx.fillRect(v.dir > 0 ? v.hand.x : v.hand.x - len, v.hand.y - 3 * s, len, 6 * s);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(v.dir > 0 ? v.hand.x : v.hand.x - len, v.hand.y - s, len, 2 * s);
      ctx.globalAlpha = 1;
      needle(ctx, v.hand, needleAngle("charged", a.p, v.dir), s * 1.15);
      mark(v.hand.x - len - 4 * s, v.hand.y - 30 * s, len * 2 + 8 * s, 60 * s);
    } else if (a.kind === "dive") {
      // Plunging streaks trailing up-back from the body, the blade leading down-forward.
      const ang = needleAngle("dive", a.p, v.dir);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = s;
      for (let k = 0; k < 4; k++) {
        const off = (k - 1.5) * 7 * s;
        const x0 = v.center.x - Math.sin(ang) * off;
        const y0 = v.center.y + Math.cos(ang) * off;
        const len = (22 + k * 5) * s;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 - Math.cos(ang) * len, y0 - Math.sin(ang) * len);
        ctx.stroke();
      }
      const tipAt = { x: v.center.x + Math.cos(ang) * 10 * s, y: v.center.y + Math.sin(ang) * 10 * s };
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(tipAt.x + Math.cos(ang) * 14 * s, tipAt.y + Math.sin(ang) * 14 * s, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      blade(tipAt, ang, s * 1.1);
      mark(v.center.x - 60 * s, v.center.y - 60 * s, 120 * s, 120 * s);
    } else if (a.kind === "slam") {
      // Landing shockwave: a flat white burst and pixel dust thrown out along the ground.
      const f = v.feet ?? { x: v.center.x, y: v.center.y + 20 * s };
      const spread = (12 + 40 * a.p) * s;
      ctx.globalAlpha = 1 - a.p;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.x - spread, f.y - 2 * s, spread * 2, 2 * s);
      ctx.fillStyle = SILK;
      for (let k = 0; k < 6; k++) {
        const side = k % 2 ? 1 : -1;
        const d = spread * (0.5 + (k >> 1) * 0.25);
        const up = Math.sin(a.p * Math.PI) * (6 + k * 2) * s;
        ctx.fillRect(f.x + side * d - s, f.y - up - 2 * s, 2 * s, 2 * s);
      }
      ctx.fillStyle = RED;
      ctx.fillRect(f.x - spread * 0.6, f.y - 4 * s, 2 * s, 2 * s);
      ctx.fillRect(f.x + spread * 0.6 - 2 * s, f.y - 4 * s, 2 * s, 2 * s);
      ctx.globalAlpha = 1;
      mark(f.x - 60 * s, f.y - 30 * s, 120 * s, 40 * s);
    } else {
      // White crescent slash (sweeps over the first half, then fades).
      const sweep = Math.min(1, a.p / 0.5);
      const arc = slashArc(a.kind, sweep, v.dir);
      const R = 24 * s;
      if (a.p > 0.1) {
        ctx.globalAlpha = a.p < 0.6 ? 1 : 1 - (a.p - 0.6) / 0.4;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 5 * s;
        ctx.beginPath();
        ctx.arc(v.hand.x, v.hand.y, R, Math.min(arc.from, arc.to), Math.max(arc.from, arc.to));
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,200,215,0.9)";
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(v.hand.x, v.hand.y, R * 0.7, Math.min(arc.from, arc.to), Math.max(arc.from, arc.to));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      blade(v.hand, needleAngle(a.kind, a.p, v.dir), s);
      mark(v.hand.x - R - 10 * s, v.hand.y - R - 10 * s, (R + 10 * s) * 2, (R + 10 * s) * 2);
    }
  }

  // Silk meter: spool pips above the head.
  const pip = 3 * s;
  const gap = 2 * s;
  const total = v.maxSilk * (pip + gap) - gap;
  const x0 = v.center.x - total / 2;
  const y0 = v.top - 8 * s;
  for (let i = 0; i < v.maxSilk; i++) {
    ctx.fillStyle = i < v.silk ? SILK : "rgba(60,30,40,0.55)";
    ctx.fillRect(x0 + i * (pip + gap), y0, pip, pip);
    if (i < v.silk) {
      ctx.fillStyle = RED;
      ctx.fillRect(x0 + i * (pip + gap), y0 + pip - s, pip, s);
    }
  }
  mark(x0 - 2, y0 - 2, total + 4, pip + 4);
  ctx.restore();
}

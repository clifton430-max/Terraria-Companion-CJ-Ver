// The Terraria cookie: summoned with a hotkey (or the tray / assistant), it drops near the
// companion; pick it up and drag it onto her to feed her. While it's out, the overlay takes clicks
// only on the cookie itself (it's added to the interactive region), so dragging never clicks the
// apps underneath. Right-click (or Esc while holding it) puts it away; it also tidies itself up
// after a few idle minutes. Art: an original pixel chocolate-chip cookie, plus the Sugar and
// Gingerbread Cookies from the local Terraria install when available.

import { getTexture } from "../assets/textures";
import { step, type Body, type Bounds, type Platform, type Wall } from "../engine/physics";

export type CookieKind = "chocolate" | "sugar" | "gingerbread";
const KINDS: readonly CookieKind[] = ["chocolate", "sugar", "gingerbread"];
/** Item sheets: three stacked frames (whole, bitten, crumbs). */
const TEXTURE: Partial<Record<CookieKind, { name: string; w: number; h: number }>> = {
  sugar: { name: "Images/Item_1919", w: 26, h: 28 },
  gingerbread: { name: "Images/Item_1920", w: 28, h: 34 },
};

const ART = 16; // original cookie, art px
const PALETTE: Record<string, string> = { o: "#5b3a1e", c: "#c98a4b", l: "#e6b276", h: "#f4d4a0", k: "#3b2414" };
/** Whole, bitten and nearly-gone stages of the original cookie. */
const STAGES = [
  ["....oooooo......", "..ooclllcloo....", ".oclhllkllclo...", ".olllkllllhlo...", "oclhllllkllllo..", "olllllkllllclo..", "ollkllllllhllo..", "oclllhllkllllo..", "olllllllllkllo..", ".ollklllhllco...", ".oclllkllllo....", "..oolllllloo....", "....oooooo......"],
  ["....oooo........", "..ooclllo.......", ".oclhllko.......", ".olllklllo......", "oclhlllllo......", "olllllkllo......", "ollklllllo......", "oclllhllklo.....", "olllllllllko....", ".ollklllhllo....", ".oclllkllllo....", "..oolllllloo....", "....oooooo......"],
  ["................", "................", "................", "................", "................", "........oo......", "......oollo.....", ".....olkllo.....", "....olllllo.....", "....ollkllo.....", ".....ollllo.....", "......oooo......", "................"],
];

export const EAT_TIME = 1.2;
/** Holding the cookie over her this long feeds her (s), or drop it on her. */
export const HOVER_FEED = 0.35;
export const IDLE_DESPAWN = 180;

export interface CookieState {
  body: Body;
  kind: CookieKind;
  held: boolean;
  /** Seconds the held cookie has overlapped the companion. */
  hover: number;
  /** Eating progress (s), or null. */
  eating: number | null;
  idle: number;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Is the cookie over her face/body (generous on purpose)? */
export function overCompanion(cookie: Rect, body: Rect): boolean {
  const target = { x: body.x - 6, y: body.y - 6, w: body.w + 12, h: body.h * 0.75 + 6 };
  return overlaps(cookie, target);
}

export function spawnCookie(near: Rect, bounds: Bounds, size: number, kind: CookieKind): CookieState {
  const side = near.x + near.w + size * 2 < bounds.width ? 1 : -1;
  const x = Math.min(Math.max(near.x + near.w / 2 + side * (near.w + size), 0), bounds.width - size);
  return {
    body: { x, y: Math.max(0, near.y - size * 2), w: size, h: size, vx: side * 60, vy: -260, grounded: false, platformId: null, facing: 1 },
    kind,
    held: false,
    hover: 0,
    eating: null,
    idle: 0,
  };
}

export type CookieEvent = "feed" | "eaten" | "expired" | null;

/** Advance the cookie: falls and lands like everything else unless held; feeding when over her. */
export function stepCookie(c: CookieState, dt: number, bounds: Bounds, platforms: readonly Platform[], walls: readonly Wall[], companion: Rect): { state: CookieState; event: CookieEvent } {
  if (c.eating !== null) {
    const eating = c.eating + dt;
    return { state: { ...c, eating }, event: c.eating < EAT_TIME && eating >= EAT_TIME ? "eaten" : null };
  }
  if (c.held) {
    const hover = overCompanion(c.body, companion) ? c.hover + dt : 0;
    if (hover >= HOVER_FEED) return { state: { ...c, hover: 0, held: false, eating: 0 }, event: "feed" };
    return { state: { ...c, hover, idle: 0 }, event: null };
  }
  const r = step(c.body, { move: 0, jump: false }, dt, bounds, undefined, platforms, walls);
  let body = r.body;
  if (body.grounded) body = { ...body, vx: body.vx * Math.exp(-8 * dt) };
  const idle = c.idle + dt;
  // Thrown or dropped onto her also counts.
  if (overCompanion(body, companion) && Math.hypot(body.vx, body.vy) > 30) return { state: { ...c, body, eating: 0 }, event: "feed" };
  return { state: { ...c, body, idle }, event: idle > IDLE_DESPAWN ? "expired" : null };
}

/** Rendering and pointer handling for the cookie element. */
export class CookieView {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private next = 0;
  state: CookieState | null = null;
  private drag: { id: number; dx: number; dy: number; samples: { x: number; y: number; t: number }[] } | null = null;

  constructor(
    private readonly hooks: {
      /** Pixel scale (CSS px per art px). */
      scale: () => number;
      picked: () => void;
      dismissed: () => void;
    },
  ) {
    this.el = document.createElement("canvas");
    this.el.className = "cookie";
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Cookie: drag it to the companion to feed her");
    this.ctx = this.el.getContext("2d")!;
    this.el.addEventListener("pointerdown", this.onDown);
    this.el.addEventListener("pointermove", this.onMove);
    this.el.addEventListener("pointerup", this.onUp);
    this.el.addEventListener("pointercancel", this.onUp);
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hooks.dismissed();
    });
    document.body.appendChild(this.el);
  }

  get out() {
    return this.state !== null;
  }

  get held() {
    return this.state?.held ?? false;
  }

  size() {
    return ART * Math.max(2, this.hooks.scale());
  }

  /** Next kind (cycles through the ones whose art is available; the original always is). */
  nextKind(): CookieKind {
    for (let i = 0; i < KINDS.length; i++) {
      const k = KINDS[(this.next + i) % KINDS.length];
      const t = TEXTURE[k];
      if (!t || getTexture(t.name)) {
        this.next = (this.next + i + 1) % KINDS.length;
        return k;
      }
    }
    return "chocolate";
  }

  show(state: CookieState) {
    this.state = state;
    this.el.hidden = false;
    for (const t of Object.values(TEXTURE)) if (t) getTexture(t.name); // start loading
  }

  hide() {
    this.state = null;
    this.drag = null;
    this.el.hidden = true;
  }

  /** Release the cookie if it's being dragged (Esc, focus loss). */
  drop() {
    if (this.state) this.state = { ...this.state, held: false };
    this.drag = null;
  }

  rect(): Rect | null {
    if (!this.state) return null;
    const b = this.state.body;
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  }

  /** Draw at its position; while eating, it sits at her mouth and shrinks through its stages. */
  draw(mouth: { x: number; y: number } | null) {
    const s = this.state;
    if (!s) return;
    const size = this.size();
    const stage = s.eating === null ? 0 : Math.min(2, Math.floor((s.eating / EAT_TIME) * 3));
    const pad = size * 0.5;
    const w = size + pad * 2;
    const dpr = window.devicePixelRatio || 1;
    if (this.el.width !== Math.round(w * dpr)) {
      this.el.width = Math.round(w * dpr);
      this.el.height = Math.round(w * dpr);
      this.el.style.width = `${w}px`;
      this.el.style.height = `${w}px`;
    }
    const at = s.eating !== null && mouth ? { x: mouth.x - size / 2, y: mouth.y - size / 2 } : { x: s.body.x, y: s.body.y };
    this.el.style.transform = `translate(${Math.round(at.x - pad)}px, ${Math.round(at.y - pad)}px)`;
    this.el.classList.toggle("held", s.held);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    ctx.imageSmoothingEnabled = false;
    const tex = TEXTURE[s.kind];
    const img = tex ? getTexture(tex.name) : undefined;
    if (tex && img) {
      const k = size / Math.max(tex.w, tex.h);
      const fh = img.height / 3;
      ctx.drawImage(img, 0, stage * fh, img.width, fh, pad + (size - tex.w * k) / 2, pad + (size - tex.h * k) / 2, img.width * k, fh * k);
    } else {
      const p = size / ART;
      const rows = STAGES[stage];
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c < rows[r].length; c++) {
          const col = PALETTE[rows[r][c]];
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillRect(pad + c * p, pad + (r + 1.5) * p, p, p);
        }
    }
    // Crumbs while she eats.
    if (s.eating !== null) {
      const p = Math.max(2, size / 12);
      ctx.fillStyle = "#c98a4b";
      for (let i = 0; i < 5; i++) {
        const t = (s.eating * 1.7 + i * 0.37) % 1;
        ctx.fillRect(pad + size * (0.2 + 0.15 * i), pad + size * (0.6 + t * 0.6), p, p);
      }
    }
  }

  private onDown = (e: PointerEvent) => {
    if (!this.state || e.button !== 0 || this.state.eating !== null) return;
    e.preventDefault();
    e.stopPropagation();
    this.el.setPointerCapture(e.pointerId);
    const b = this.state.body;
    this.drag = { id: e.pointerId, dx: e.clientX - b.x, dy: e.clientY - b.y, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    this.state = { ...this.state, held: true, idle: 0, body: { ...b, vx: 0, vy: 0, grounded: false, platformId: null } };
    this.hooks.picked();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag || !this.state || e.pointerId !== this.drag.id) return;
    e.stopPropagation();
    const b = this.state.body;
    this.drag.samples = [...this.drag.samples, { x: e.clientX, y: e.clientY, t: performance.now() }].slice(-5);
    this.state = { ...this.state, body: { ...b, x: e.clientX - this.drag.dx, y: e.clientY - this.drag.dy } };
  };

  private onUp = (e: PointerEvent) => {
    if (!this.drag || !this.state || e.pointerId !== this.drag.id) return;
    e.stopPropagation();
    const s = this.drag.samples;
    const a = s[0];
    const z = s[s.length - 1];
    const dt = Math.max(0.016, (z.t - a.t) / 1000);
    const vx = Math.max(-1500, Math.min(1500, (z.x - a.x) / dt));
    const vy = Math.max(-1500, Math.min(1500, (z.y - a.y) / dt));
    this.drag = null;
    if (this.state.held) this.state = { ...this.state, held: false, body: { ...this.state.body, vx, vy } };
  };

  destroy() {
    this.el.remove();
  }
}

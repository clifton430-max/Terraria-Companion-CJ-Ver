// CustomNotch as a home: one companion at a time can be dropped or thrown into the notch, where
// CustomNotch draws her from the same atlas and she keeps living (talking, gesturing, being petted)
// until she's pulled back out. This module owns who lives there and the overlay side of the trip
// (the absorb and pop-out effects); Rust relays everything to the notch (src-tauri/src/notch_link.rs).

import {
  notchEnter,
  notchGesture,
  notchHover,
  notchLeave,
  notchSay,
  notchStatus,
  onNotch,
  onNotchAction,
  type CharacterId,
  type NotchAction,
  type NotchResident,
  type NotchStatus,
} from "../bridge";
import { FRAMES, SPRITE_H, SPRITE_W, renderFrame } from "../engine/sprites";
import type { TerrariaRig } from "./terrariaRig";

type Rect = { x: number; y: number; w: number; h: number };

/** How far around the notch (CSS px) a held or thrown companion is caught. */
export const CATCH_MARGIN = 36;
/** Length of the absorb animation (ms); the notch is told she's arriving a little before it ends. */
export const ABSORB_MS = 1150;
const ENTER_AT = 0.8;

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Where she disappears into: the middle of the notch, pulled toward the screen edge it hangs on. */
export function mouthOf(rect: Rect, edge: NotchStatus["edge"]): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  switch (edge) {
    case "top":
      return { x: cx, y: rect.y + rect.h * 0.3 };
    case "bottom":
      return { x: cx, y: rect.y + rect.h * 0.7 };
    case "left":
      return { x: rect.x + rect.w * 0.3, y: cy };
    case "right":
      return { x: rect.x + rect.w * 0.7, y: cy };
    default:
      return { x: cx, y: cy };
  }
}

/** Direction from the notch into the screen (where she gets pushed when it's full, or pops out). */
export function inward(edge: NotchStatus["edge"]): { x: number; y: number } {
  switch (edge) {
    case "top":
      return { x: 0, y: 1 };
    case "bottom":
      return { x: 0, y: -1 };
    case "left":
      return { x: 1, y: 0 };
    default:
      return { x: -1, y: 0 };
  }
}

/** The look she's drawn with, packed as an atlas strip for the notch. */
export function atlasFromRig(rig: TerrariaRig): Omit<NotchResident, "character" | "name" | "bubble" | "gestures" | "stride" | "scale" | "arrive"> | null {
  const c = document.createElement("canvas");
  c.width = rig.image.width;
  c.height = rig.image.height;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(rig.image, 0, 0);
  return { atlas: pngBase64(c), frameWidth: rig.info.frameWidth, frameHeight: rig.info.frameHeight, frames: [...rig.info.frames], body: { ...rig.info.body } };
}

/** The built-in sprite (no Terraria install), packed with the same frame names the rig uses. */
export function atlasFromLegacy(): Omit<NotchResident, "character" | "name" | "bubble" | "gestures" | "stride" | "scale" | "arrive"> | null {
  const cells: [string, string[]][] = [];
  FRAMES.idle.forEach((f, i) => cells.push([i ? `idle${i}` : "idle", f]));
  FRAMES.walk.forEach((f, i) => cells.push([`walk${i}`, f]));
  cells.push(["jump", FRAMES.jump[0]], ["fall", FRAMES.fall[0]]);
  FRAMES.swing.slice(0, 4).forEach((f, i) => cells.push([`use${i + 1}`, f]));
  cells.push(["shoot", FRAMES.shoot[0]], ["cast", FRAMES.cast[0]]);
  const c = document.createElement("canvas");
  c.width = SPRITE_W * cells.length;
  c.height = SPRITE_H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  cells.forEach(([, f], i) => ctx.drawImage(renderFrame(f, false), i * SPRITE_W, 0));
  return { atlas: pngBase64(c), frameWidth: SPRITE_W, frameHeight: SPRITE_H, frames: cells.map(([n]) => n), body: { x: 0, y: 0, w: SPRITE_W, h: SPRITE_H } };
}

function pngBase64(c: HTMLCanvasElement): string {
  return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

export interface NotchHooks {
  /** Put her back on the desktop with her centre at (x, y), moving at (vx, vy). */
  place: (id: CharacterId, a: NotchAction) => void;
  /** The user petted her inside the notch. */
  pet: (id: CharacterId) => void;
  /** The user fed her one of the notch's cookies. */
  feed: (id: CharacterId) => void;
  /** Who's on screen right now (the resident must be one of them). */
  present: () => CharacterId[];
  /** Dev builds: a test command from Rust's /notch/debug endpoint. */
  debug?: (op: string, arg: string) => void;
}

export class NotchHome {
  private status: NotchStatus = { connected: false, rect: null, resident: null };
  /** Living in the notch, or on her way in. */
  private resident: CharacterId | null = null;
  private absorbing: CharacterId | null = null;
  private hint: "" | "empty" | "full" | "incoming" = "";
  private unlisten: (() => void)[] = [];
  /** Where the notch was last seen, to come back out there if it disappears. */
  private lastRect: Rect | null = null;

  constructor(private readonly hooks: NotchHooks) {
    void onNotch((s) => this.onStatus(s)).then((u) => this.unlisten.push(u));
    void onNotchAction((a) => this.onAction(a)).then((u) => this.unlisten.push(u));
    notchStatus()
      .then((s) => {
        // After an overlay reload Rust still knows who lives there: keep her inside (if she's still around).
        if (s.resident && this.hooks.present().includes(s.resident)) this.resident = s.resident;
        else if (s.resident) void notchLeave(s.resident).catch(() => {});
        this.onStatus(s);
      })
      .catch(() => {});
  }

  destroy() {
    this.unlisten.forEach((u) => u());
  }

  /** She lives in the notch (or is being absorbed into it): don't simulate or draw her on the desktop. */
  holds(id: CharacterId): boolean {
    return this.resident === id || this.absorbing === id;
  }

  get occupant(): CharacterId | null {
    return this.resident ?? this.absorbing;
  }

  /** The catch zone, when the notch is there and still (not being dragged around). */
  private zone(): Rect | null {
    const s = this.status;
    if (!s.connected || !s.rect || s.dragging) return null;
    return inflate(s.rect, CATCH_MARGIN);
  }

  /** Is this body (or the pointer holding her) over the notch? */
  touches(body: Rect, pointer?: { x: number; y: number } | null): boolean {
    const z = this.zone();
    if (!z) return false;
    if (overlaps(body, z)) return true;
    return !!pointer && pointer.x >= z.x && pointer.x <= z.x + z.w && pointer.y >= z.y && pointer.y <= z.y + z.h;
  }

  /** While she's held: let the notch know she's hovering over it (it opens up, or shows it's full). */
  hover(id: CharacterId, body: Rect | null, pointer?: { x: number; y: number } | null) {
    let next: "" | "empty" | "full" = "";
    if (body && this.touches(body, pointer)) next = this.occupant && this.occupant !== id ? "full" : "empty";
    this.setHint(next);
  }

  private setHint(next: "" | "empty" | "full" | "incoming") {
    if (next === this.hint) return;
    this.hint = next;
    void notchHover(next).catch(() => {});
  }

  /**
   * She was let go (or is flying) over the notch. "in": she's being absorbed (the caller hides her);
   * "full": someone else lives there (the caller bounces her off); "no": not over the notch.
   */
  offer(id: CharacterId, body: Rect, el: HTMLCanvasElement, resident: () => NotchResident | null, pointer?: { x: number; y: number } | null): "in" | "full" | "no" {
    if (this.holds(id) || !this.touches(body, pointer)) return "no";
    if (this.occupant) {
      this.setHint("");
      return "full";
    }
    const payload = resident();
    const rect = this.status.rect;
    if (!payload || !rect) return "no";
    this.absorbing = id;
    this.setHint("incoming");
    const mouth = mouthOf(rect, this.status.edge);
    const from = el.getBoundingClientRect();
    let entered: Promise<boolean> | null = null;
    absorbEffect(el, from, mouth, payload.bubble.heart, (t) => {
      if (t >= ENTER_AT && !entered) entered = notchEnter(payload).then(() => true, () => false);
    }).then(async () => {
      const ok = await (entered ?? notchEnter(payload).then(() => true, () => false));
      this.absorbing = null;
      this.setHint("");
      if (ok) {
        this.resident = id;
        return;
      }
      // The notch went away (or someone got there first): she tumbles back out.
      const dir = inward(this.status.edge);
      popEffect(mouth, payload.bubble.heart);
      this.hooks.place(id, { kind: "exit", x: mouth.x + dir.x * 60, y: mouth.y + dir.y * 60, vx: dir.x * 260, vy: dir.y * 260 - 200 });
    });
    return "in";
  }

  /** Her look changed while she's inside: send the new atlas (no arrival). */
  refresh(id: CharacterId, resident: () => NotchResident | null) {
    if (this.resident !== id) return;
    const r = resident();
    if (r) void notchEnter({ ...r, arrive: false }).catch(() => {});
  }

  /** Something she said while living in the notch. True if it went there (not to a desktop bubble). */
  say(id: CharacterId, text: string): boolean {
    if (!this.holds(id)) return false;
    void notchSay(id, text).catch(() => {});
    return true;
  }

  gesture(id: CharacterId, kind: string): boolean {
    if (this.resident !== id) return false;
    void notchGesture(id, kind).catch(() => {});
    return true;
  }

  /** Bring the resident out (she was dismissed, or something needs her on the desktop). */
  release(id: CharacterId, withEffect = true) {
    if (this.resident !== id) return;
    this.resident = null;
    void notchLeave(id).catch(() => {});
    const rect = this.status.rect ?? this.lastRect;
    if (!withEffect || !rect) return;
    const mouth = mouthOf(rect, this.status.edge);
    const dir = inward(this.status.edge);
    const at = { x: mouth.x + dir.x * 70, y: mouth.y + dir.y * 70 };
    popEffect(at, "#ff6fae");
    this.hooks.place(id, { kind: "exit", x: at.x, y: at.y, vx: dir.x * 240, vy: dir.y * 240 - 160 });
  }

  /** A rejected companion is pushed away from the notch, in screen terms. */
  bounce(): { vx: number; vy: number } {
    const d = inward(this.status.edge);
    return { vx: d.x * 520 + (d.x === 0 ? (Math.random() < 0.5 ? -160 : 160) : 0), vy: d.y * 520 - 260 };
  }

  private onStatus(s: NotchStatus) {
    const wasConnected = this.status.connected;
    this.status = s;
    if (s.rect) this.lastRect = s.rect;
    if (wasConnected && !s.connected && this.resident) {
      // CustomNotch quit: she comes back out where it was.
      const id = this.resident;
      this.release(id);
    }
  }

  /** Dev-build test hook: drop or throw a companion at the notch from outside it. */
  get geometry(): { rect: Rect; edge: NotchStatus["edge"] } | null {
    return this.status.rect ? { rect: this.status.rect, edge: this.status.edge } : null;
  }

  private onAction(a: NotchAction) {
    const kind = a.kind as string;
    if (import.meta.env.DEV && kind.startsWith("debug-")) {
      const [op, ...rest] = kind.slice(6).split(":");
      this.hooks.debug?.(op, rest.join(":"));
      return;
    }
    const id = this.resident;
    if (!id) return;
    if (a.kind === "pet") {
      this.hooks.pet(id);
      return;
    }
    if (a.kind === "feed") {
      this.hooks.feed(id);
      return;
    }
    if (a.kind === "exit") {
      this.resident = null;
      void notchLeave(id).catch(() => {});
      popEffect({ x: a.x, y: a.y }, "#ff6fae");
      this.hooks.place(id, a);
    }
  }
}

// ── Effects ────────────────────────────────────────────────────────────────────────────────────

function easeInCubic(t: number) {
  return t * t * t;
}

/** One pink soap bubble drifting from (x, y) toward (tx, ty). */
function bubbleTo(x: number, y: number, tx: number, ty: number, ms: number, size: number, tint: string) {
  const b = document.createElement("div");
  b.className = "notch-bubble";
  b.style.setProperty("--tint", tint);
  b.style.width = b.style.height = `${size}px`;
  b.style.left = `${x - size / 2}px`;
  b.style.top = `${y - size / 2}px`;
  document.body.appendChild(b);
  const anim = b.animate(
    [
      { transform: "translate(0, 0) scale(0.4)", opacity: 0 },
      { transform: `translate(${(tx - x) * 0.25}px, ${(ty - y) * 0.25}px) scale(1)`, opacity: 0.95, offset: 0.25 },
      { transform: `translate(${tx - x}px, ${ty - y}px) scale(0.2)`, opacity: 0 },
    ],
    { duration: ms, easing: "cubic-bezier(.55,0,.8,.4)" },
  );
  anim.onfinish = () => b.remove();
}

/**
 * The trip into the notch: she wobbles as it catches her, stretches toward it, spirals in and
 * shrinks away into the mouth, trailing bubbles, while a pink vortex swirls at the notch.
 */
function absorbEffect(el: HTMLCanvasElement, from: DOMRect, mouth: { x: number; y: number }, tint: string, progress: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const ghost = document.createElement("canvas");
    ghost.width = el.width;
    ghost.height = el.height;
    ghost.getContext("2d")?.drawImage(el, 0, 0);
    ghost.className = "notch-ghost";
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.setProperty("--tint", tint);
    document.body.appendChild(ghost);

    const vortex = document.createElement("div");
    vortex.className = "notch-vortex";
    vortex.style.setProperty("--tint", tint);
    vortex.style.left = `${mouth.x}px`;
    vortex.style.top = `${mouth.y}px`;
    document.body.appendChild(vortex);

    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;
    const dx = mouth.x - cx;
    const dy = mouth.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    // A sideways swing for the spiral, perpendicular to the path.
    const px = -dy / dist;
    const py = dx / dist;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const t0 = performance.now();
    let lastBubble = 0;

    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ABSORB_MS);
      progress(t);
      let x = 0;
      let y = 0;
      let sx = 1;
      let sy = 1;
      let rot = 0;
      let opacity = 1;
      if (t < 0.2) {
        // Caught: a startled wobble and squash.
        const k = t / 0.2;
        const w = Math.sin(k * Math.PI * 3) * (1 - k);
        sx = 1 + 0.18 * Math.sin(k * Math.PI);
        sy = 1 - 0.14 * Math.sin(k * Math.PI);
        rot = w * 12;
        x = -dx / dist * 10 * Math.sin(k * Math.PI);
        y = -dy / dist * 10 * Math.sin(k * Math.PI);
      } else {
        // Pulled in: accelerate along a curve, stretching toward the notch, spinning, shrinking.
        const k = (t - 0.2) / 0.8;
        const e = easeInCubic(k);
        const swing = Math.sin(k * Math.PI * 2.2) * (1 - k) * Math.min(90, dist * 0.35);
        x = dx * e + px * swing;
        y = dy * e + py * swing;
        const shrink = 1 - 0.94 * easeInCubic(Math.min(1, k * 1.05));
        const stretch = 1 + 0.6 * Math.sin(k * Math.PI);
        sx = shrink * stretch;
        sy = shrink / Math.sqrt(stretch);
        rot = k * k * 540;
        opacity = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
        if (now - lastBubble > 45) {
          lastBubble = now;
          const bx = cx + x + (Math.random() - 0.5) * from.width * shrink;
          const by = cy + y + (Math.random() - 0.5) * from.height * shrink;
          bubbleTo(bx, by, mouth.x, mouth.y, 420 + Math.random() * 260, 6 + Math.random() * 12, tint);
        }
      }
      // The stretch points along the path, so rotate into it, scale, and rotate back for the spin.
      ghost.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${sx}, ${sy}) rotate(${-angle + rot}deg)`;
      ghost.style.opacity = String(opacity);
      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }
      ghost.remove();
      // A last little gulp of bubbles at the mouth.
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        bubbleTo(mouth.x + Math.cos(a) * 46, mouth.y + Math.sin(a) * 46, mouth.x, mouth.y, 380, 6 + Math.random() * 8, tint);
      }
      vortex.classList.add("closing");
      setTimeout(() => vortex.remove(), 420);
      resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** Coming out: a pink pop with bubbles flying off. */
export function popEffect(at: { x: number; y: number }, tint: string) {
  const ring = document.createElement("div");
  ring.className = "notch-pop";
  ring.style.setProperty("--tint", tint);
  ring.style.left = `${at.x}px`;
  ring.style.top = `${at.y}px`;
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 700);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const r = 50 + Math.random() * 50;
    const size = 6 + Math.random() * 12;
    const b = document.createElement("div");
    b.className = "notch-bubble";
    b.style.setProperty("--tint", tint);
    b.style.width = b.style.height = `${size}px`;
    b.style.left = `${at.x - size / 2}px`;
    b.style.top = `${at.y - size / 2}px`;
    document.body.appendChild(b);
    const anim = b.animate(
      [
        { transform: "translate(0, 0) scale(0.3)", opacity: 1 },
        { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) scale(1)`, opacity: 0 },
      ],
      { duration: 520 + Math.random() * 240, easing: "cubic-bezier(.2,.8,.3,1)" },
    );
    anim.onfinish = () => b.remove();
  }
}

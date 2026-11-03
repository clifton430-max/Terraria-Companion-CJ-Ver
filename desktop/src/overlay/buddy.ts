// An autonomous roster character on screen beside the main (selected) companion. She roams with
// the same physics and surfaces (windows, blocks, invisible platforms), keeps a little space from
// the others, fights bosses on her own with her weapon (through the combat sim, using the shared
// tactics), talks in her own voice with her own affection meter, and can be patted (click) or made
// the selected character (double-click). Control mode never drives a buddy.

import { getCharacterRig, type CharacterId } from "../bridge";
import { getTexture } from "../assets/textures";
import { AffectionEngine, type AffectionConfig, type AffectionHooks } from "../affection/engine";
import { CHARACTERS, styleBubble } from "../characters/roster";
import { assistAttack, preferredRange, type CombatState } from "../combat/sim";
import { flyToward, tactic, type Threat } from "../combat/tactics";
import { getWeapon, type WeaponDef } from "../combat/weapons";
import { decide, initialAi, mulberry32, type AiState } from "../engine/behavior";
import { newWatchNav, watchStep, type JumpTuning } from "../engine/behaviorModes";
import { ledgeDistance, rememberVisit } from "../engine/explore";
import type { JumpPlan } from "../engine/jump";
import { dragTo, release, step, throwVelocity, type Body, type Bounds, type Ceiling, type Dir, type Platform, type PointerSample, type Wall } from "../engine/physics";
import { placeBubble } from "./bubble";
import { walkStep } from "./rigFrames";
import { TerrariaRig } from "./terrariaRig";

/** Extra canvas around the 40×56 cell for weapon swings (art px). */
const PAD = 34;
/** Two idle characters closer than this (centre to centre) are standing on top of each other. */
export const STACKED = 14;

/**
 * Avoid standing exactly on top of someone: only when this character is idle and another one's
 * centre is within STACKED px, take a small step aside (away from her, or inward at a screen
 * edge). Walking past each other and standing side by side are fine; there's no fixed spacing.
 */
export function unstack(body: { x: number; w: number }, moving: boolean, others: readonly { x: number; w: number }[], width: number): -1 | 1 | null {
  if (moving) return null;
  const cx = body.x + body.w / 2;
  const near = others.find((o) => Math.abs(o.x + o.w / 2 - cx) < STACKED);
  if (!near) return null;
  const ox = near.x + near.w / 2;
  let dir = (cx < ox || (cx === ox && body.x < width / 2) ? -1 : 1) as -1 | 1;
  if ((dir < 0 && body.x < 20) || (dir > 0 && body.x + body.w > width - 20)) dir = -dir as -1 | 1;
  return dir;
}

export interface BuddyWorld {
  bounds: Bounds;
  platforms: readonly Platform[];
  walls: readonly Wall[];
  ceilings: readonly Ceiling[];
  rigScale: number;
  /** Movement modes (spread / jumpy / grounded / watch); absent = her usual roaming. */
  modes?: BuddyModes;
}

export interface BuddyModes {
  tuning?: JumpTuning;
  /** Plans a platform jump from her body (spread / jumpy). */
  plan?: (body: Body, recent: readonly number[]) => JumpPlan | null;
  /** The hangout platform (Watch), and a planner that makes progress toward it. */
  hangout?: Platform | null;
  planToward?: (body: Body) => JumpPlan | null;
}

export interface BuddyFight {
  active: boolean;
  target: { x: number; y: number } | null;
  threats: readonly Threat[];
  slot: number;
  slots: number;
  canFly: boolean;
  combat: CombatState;
  /** Training dummy to practise on (when there's no boss). */
  practice: { x: number; y: number } | null;
}

type Gesture = "wave" | "jump" | "hug" | "sit";

export class Buddy {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly bubble: HTMLDivElement;
  private rig: TerrariaRig | null = null;
  body: Body;
  private ai: AiState = initialAi();
  private readonly rng = mulberry32(Math.floor(Math.random() * 1e9));
  private walkDistance = 0;
  private bubbleUntil = 0;
  private pose: { g: Gesture; until: number } | null = null;
  private attackT = -1;
  private attackCd = 0;
  private sinceStrike = 9;
  private flying = false;
  private landing = 0;
  private hitWall: -1 | 0 | 1 = 0;
  private watchNav = newWatchNav();
  private hangoutId: number | null = null;
  private recent: number[] = [];
  /** Walk to this x (a conversation partner), or hold still when null + `hold`. */
  goal: number | null = null;
  hold = false;
  faceToward: number | null = null;
  /** Driven from outside (moving chess pieces): feet position, frame and facing; no AI or physics. */
  private puppet: { x: number; y: number; frame: string; facing: Dir } | null = null;
  readonly affection: AffectionEngine;
  /** Fading in (walking on) or out (dismissed). */
  private fade = 0;
  leaving = false;
  weapon: WeaponDef;
  private clock = 0;
  private lastClick = 0;
  /** Being dragged by the mouse (like the main companion). */
  private drag: { id: number; dx: number; dy: number; moved: boolean; sx: number; sy: number; samples: PointerSample[] } | null = null;
  private lastBounds: Bounds = { width: window.innerWidth, height: window.innerHeight };
  /** Seconds until her next idle gesture (her personality in motion). */
  private idleGesture = 8 + Math.random() * 12;
  /** Thrown by the user and still in the air (she can be caught by the notch). */
  thrown = false;
  private thrownAt = 0;

  constructor(
    readonly id: CharacterId,
    start: Body,
    affection: { value: number; updated: number; cookies: number },
    cfg: AffectionConfig,
    weaponId: string,
    private readonly hooks: {
      busy: () => boolean;
      save: (s: { value: number; updated: number; cookies: number }) => void;
      idleSeconds: () => Promise<number>;
      select: (id: CharacterId) => void;
      sound: (kind: "pickup" | "throw" | "swing") => void;
      /** Keep the overlay taking the mouse while she's being dragged. */
      capture: (on: boolean) => void;
      /** Right-click: her little menu at (x, y). */
      menu: (id: CharacterId, x: number, y: number) => void;
      /** The combat sim and what she should swing at when clicked (nearest target), if anything. */
      combat: () => CombatState;
      target: () => { x: number; y: number } | null;
      /** CustomNotch: she's living there, so her words and gestures go to the notch (true = handled). */
      notchSay: (id: CharacterId, text: string) => boolean;
      notchGesture: (id: CharacterId, kind: string) => boolean;
      /** Held over the notch (pointer), or let go: "in" = absorbed, "full" = bounced off. */
      dragging: (b: Buddy, pointer: { x: number; y: number }) => void;
      dropped: (b: Buddy, pointer: { x: number; y: number }) => "in" | "full" | "no";
      /** Her atlas was recomposed (a new look). */
      rigChanged: (id: CharacterId) => void;
    },
  ) {
    this.body = start;
    this.weapon = getWeapon(weaponId) ?? getWeapon(CHARACTERS[id].signature)!;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "buddy";
    this.canvas.setAttribute("aria-label", CHARACTERS[id].name);
    this.ctx = this.canvas.getContext("2d")!;
    this.bubble = document.createElement("div");
    this.bubble.className = "speech-bubble buddy-bubble";
    this.bubble.hidden = true;
    styleBubble(this.bubble, id);
    document.body.append(this.canvas, this.bubble);
    const ahooks: AffectionHooks = {
      say: (t) => this.say(t),
      pose: (a) => this.gesture(a === "wave" || a === "hug" || a === "jump" || a === "sit" ? a : "wave"),
      hearts: () => {},
      save: hooks.save,
      busy: hooks.busy,
      idleSeconds: hooks.idleSeconds,
    };
    this.affection = new AffectionEngine(affection, { ...cfg, character: id }, ahooks);
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hooks.menu(this.id, e.clientX, e.clientY);
    });
  }

  async loadRig() {
    try {
      const info = await getCharacterRig(this.id);
      this.rig = await TerrariaRig.load(info);
      this.drawnKey = "";
      if (this.rig) this.hooks.rigChanged(this.id);
      if (!this.rig) console.info(`${this.id}: ${info.reason ?? "atlas unavailable"}`);
    } catch (e) {
      console.warn(`${this.id}: rig failed`, e);
    }
  }

  get available() {
    return this.rig !== null;
  }

  /** The atlas she's drawn with (null until it loads). */
  get atlas(): TerrariaRig | null {
    return this.rig;
  }

  /** Feet-centred body rect (for hitboxes, cookies, separation). */
  rect() {
    return { x: Math.round(this.body.x), y: Math.round(this.body.y), w: this.body.w, h: this.body.h };
  }

  say(text: string, seconds = Math.min(8, 3 + text.length * 0.05)) {
    if (this.hooks.notchSay(this.id, text)) return;
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    this.bubbleSize = null; // new text: measure again
    this.bubbleUntil = this.clock + seconds;
    this.placeBubble();
  }

  gesture(g: Gesture, seconds = 1.8) {
    // Jumping is reserved for conversations (expressing herself); otherwise she waves instead.
    if (g === "jump" && !this.hold) g = "wave";
    if (this.hooks.notchGesture(this.id, g)) return;
    this.pose = { g, until: this.clock + seconds };
    if (g === "jump" && this.body.grounded) this.body = { ...this.body, vy: -380, grounded: false, platformId: null };
  }

  private lookKey = "";

  /** Her look was edited in settings: recompose her atlas. */
  setLook(key: string) {
    if (key === this.lookKey) return;
    const first = this.lookKey === "";
    this.lookKey = key;
    if (!first) void this.loadRig();
    this.drawnKey = "";
  }

  configure(cfg: AffectionConfig, weaponId: string) {
    this.affection.configure({ ...cfg, character: this.id });
    this.weapon = getWeapon(weaponId) ?? getWeapon(CHARACTERS[this.id].signature)!;
  }

  /** Measured once per line of text (its size doesn't depend on where it is): no per-frame layout. */
  private bubbleSize: { w: number; h: number } | null = null;
  private bubblePlaced = "";

  private placeBubble(bounds?: Bounds) {
    if (this.bubble.hidden) return;
    if (!this.bubbleSize || !this.bubbleSize.w) this.bubbleSize = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
    const p = placeBubble(this.body, { w: this.bubbleSize.w || 200, h: this.bubbleSize.h || 40 }, bounds ?? { width: window.innerWidth });
    const transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    const tail = `${Math.round(p.tailX)}px`;
    if (transform + tail === this.bubblePlaced) return;
    this.bubblePlaced = transform + tail;
    this.bubble.style.transform = transform;
    this.bubble.style.setProperty("--tail-x", tail);
  }

  get held() {
    return this.drag !== null;
  }

  /** Pose her directly (feet-centre position), or hand her back to her own behaviour with null. */
  setPuppet(p: { x: number; y: number; frame: string; facing: Dir } | null) {
    this.puppet = p;
    if (p) this.body = { ...this.body, x: p.x - this.body.w / 2, y: p.y - this.body.h, vx: 0, vy: 0, facing: p.facing, grounded: false, platformId: null };
    else this.body = { ...this.body, grounded: false, platformId: null };
    this.flying = false;
  }

  get puppeted() {
    return this.puppet !== null;
  }

  /** Playing a gesture right now. */
  get posing() {
    return this.pose !== null;
  }

  /** Living in the notch: hidden here, but her heart keeps beating (affection, chatter). */
  away(dt: number) {
    this.clock += dt;
    this.drag = null;
    this.pose = null;
    this.thrown = false;
    this.affection.tick(this.clock);
    if (this.canvas.style.visibility !== "hidden") {
      this.canvas.style.visibility = "hidden";
      this.bubble.hidden = true;
    }
  }

  /** Back on the desktop with her centre at (x, y), moving at (vx, vy) (out of the notch). */
  placeAt(x: number, y: number, vx: number, vy: number, bounds: Bounds) {
    const b = { ...this.body, x: Math.min(Math.max(0, x - this.body.w / 2), bounds.width - this.body.w), y: Math.min(Math.max(0, y - this.body.h / 2), bounds.height - this.body.h) };
    this.body = release(b, vx, vy);
    this.ai = initialAi();
    this.fade = 1;
    this.thrown = false;
    this.canvas.style.visibility = "";
    this.drawnKey = "";
    this.placed = "";
  }

  /** Pushed away (by a notch that's already taken). */
  bounceOff(vx: number, vy: number) {
    this.body = release({ ...this.body, grounded: false, platformId: null }, vx, vy);
    this.thrown = false;
  }

  /** A pat from inside the notch; true if she answered it. */
  pat(): boolean {
    return this.affection.pet(this.clock);
  }

  /** Advance: roam (or fight, or walk to a conversation), physics, timers. */
  step(dt: number, w: BuddyWorld, others: readonly { x: number; w: number }[], fight: BuddyFight) {
    this.clock += dt;
    this.lastBounds = w.bounds;
    if (this.drag) {
      // Held by the mouse: no AI, no physics until she's let go.
      this.affection.tick(this.clock);
      if (!this.bubble.hidden && this.clock > this.bubbleUntil) this.bubble.hidden = true;
      if (this.attackT >= 0) {
        this.attackT += dt;
        if (this.attackT > 0.32) this.attackT = -1;
      }
      return;
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.sinceStrike += dt;
    this.landing = Math.max(0, this.landing - dt);
    this.fade = Math.min(1, this.fade + dt * 2);
    if (this.attackT >= 0) {
      this.attackT += dt;
      if (this.attackT > 0.32) this.attackT = -1;
    }
    if (this.pose && this.clock > this.pose.until) this.pose = null;
    if (this.puppet) {
      // Someone else is moving her (chess): keep the pose, just run the timers.
      if (!this.bubble.hidden && this.clock > this.bubbleUntil) this.bubble.hidden = true;
      this.affection.tick(this.clock);
      return;
    }
    // Idle personality: a gesture she likes now and then while standing around.
    this.idleGesture -= dt;
    if (this.idleGesture <= 0) {
      this.idleGesture = 15 + Math.random() * 25;
      const g = CHARACTERS[this.id].gestures;
      if (this.body.grounded && !this.pose && this.attackT < 0 && Math.abs(this.body.vx) < 5 && g.length) this.gesture(g[Math.floor(Math.random() * g.length)], 2.2);
    }
    if (!this.bubble.hidden && this.clock > this.bubbleUntil) this.bubble.hidden = true;

    const cx = this.body.x + this.body.w / 2;
    const cy = this.body.y + this.body.h / 2;
    let move: -1 | 0 | 1 = 0;
    let jump = false;
    let launch: JumpPlan | { vy: number; vx: number } | null = null;

    const fighting = fight.active && (fight.target !== null || fight.practice !== null) && !this.leaving && this.goal === null && !this.hold;
    if (fighting) {
      const target = fight.target ?? fight.practice!;
      const range = preferredRange(this.weapon, w.rigScale * 1.5);
      const melee = this.weapon.kind === "sword" && !this.weapon.fractal;
      const out = tactic({
        x: cx,
        y: cy,
        r: this.body.w / 2,
        grounded: this.body.grounded,
        target,
        threats: fight.threats,
        range,
        melee,
        slot: fight.slot,
        slots: fight.slots,
        canFly: fight.canFly && fight.target !== null,
        bounds: w.bounds,
        sinceStrike: this.sinceStrike,
      });
      this.body = { ...this.body, facing: out.face };
      if (out.fly) {
        // Free flight around the boss.
        this.flying = true;
        const p = flyToward(cx, cy, this.body.vx, this.body.vy, out.goal, dt);
        this.body = { ...this.body, x: p.x - this.body.w / 2, y: p.y - this.body.h / 2, vx: p.vx, vy: p.vy, grounded: false, platformId: null };
      } else {
        this.flying = false;
        const dx = out.goal.x - cx;
        move = Math.abs(dx) > 14 ? (Math.sign(dx) as -1 | 1) : 0;
        jump = out.jump;
      }
      if (out.attack && this.attackCd <= 0) {
        const hand = { x: cx + out.face * this.body.w * 0.4, y: cy - this.body.h * 0.1 };
        const aim = Math.atan2(target.y - hand.y, target.x - hand.x);
        assistAttack(fight.combat, this.weapon, hand, out.face, aim, w.rigScale * 1.5);
        this.attackCd = Math.max(0.25, this.weapon.useTime * 1.4);
        this.attackT = 0;
        this.sinceStrike = 0;
      }
    } else {
      if (this.flying) {
        this.flying = false; // drop back to normal physics
        this.body = { ...this.body, grounded: false, platformId: null };
      }
      if (this.leaving) {
        // Walk off the nearest screen edge.
        move = cx < w.bounds.width / 2 ? -1 : 1;
      } else if (this.goal !== null) {
        const dx = this.goal - cx;
        move = Math.abs(dx) > 10 ? (Math.sign(dx) as -1 | 1) : 0;
      } else if (!this.hold) {
        const m = w.modes;
        // Watch: make her way to the hangout (the overlay places her once she's on it), unless
        // she has given up on reaching it for now, in which case she roams as usual.
        const hangoutId = m?.hangout?.id ?? null;
        if (hangoutId !== this.hangoutId) {
          this.hangoutId = hangoutId;
          this.watchNav = newWatchNav(); // a new (or no) hangout: start fresh
        }
        const towardHangout = m?.hangout && m.planToward && !(this.body.grounded && this.body.platformId === m.hangout.id);
        const r = towardHangout ? watchStep(this.watchNav, this.body, m!.hangout!, () => m!.planToward!(this.body), dt, this.rng) : null;
        if (r) this.watchNav = r.nav;
        if (r && !r.resting) {
          move = r.move;
          launch = r.jump;
          jump = r.jump !== null;
        } else {
          const d = decide(
            this.ai,
            {
              grounded: this.body.grounded,
              landing: this.landing > 0,
              hitWall: this.hitWall,
              x: this.body.x,
              w: this.body.w,
              boundsWidth: w.bounds.width,
              busy: this.pose !== null,
              planJump: m?.plan ? () => m.plan!(this.body, this.recent) : undefined,
              ledgeAhead: m?.plan ? ledgeDistance(this.body, this.ai.dir, w.platforms) : undefined,
              tuning: m?.tuning,
            },
            dt,
            this.rng,
          );
          this.ai = d.ai;
          move = d.intent.move;
          jump = d.intent.jump;
          if (d.intent.jumpVelocity !== undefined) launch = { vy: d.intent.jumpVelocity, vx: d.intent.jumpVx ?? 0 };
          // Don't stand exactly on top of someone (no fixed spacing otherwise).
          const step = this.body.grounded && !jump ? unstack(this.body, move !== 0, others, w.bounds.width) : null;
          if (step) move = step;
        }
      }
      if (this.faceToward !== null && move === 0) this.body = { ...this.body, facing: (this.faceToward < cx ? -1 : 1) as Dir };
    }

    if (!this.flying) {
      const intent = launch && jump ? { move: 0 as const, jump: true, jumpVelocity: launch.vy, jumpVx: launch.vx } : { move, jump };
      const r = step(this.body, intent, dt, w.bounds, undefined, w.platforms, w.walls, w.ceilings);
      if (this.leaving) r.body.x = this.body.x + move * 120 * dt; // allowed to walk off screen
      this.body = r.body;
      this.hitWall = r.hitWall;
      if (r.landed || this.clock - this.thrownAt > 2.5) this.thrown = false;
      if (r.landed) {
        this.landing = 0.12;
        this.recent = rememberVisit(this.recent, this.body.platformId);
      }
      if (this.body.grounded) this.walkDistance += Math.abs(this.body.vx) * dt;
    }
    this.affection.tick(this.clock);
  }

  /** True once a dismissed buddy has walked off screen. */
  gone(bounds: Bounds) {
    return this.leaving && (this.body.x + this.body.w < -10 || this.body.x > bounds.width + 10);
  }

  private frame(rigScale: number): string {
    if (this.puppet && !this.drag) return this.puppet.frame;
    if (this.drag && this.attackT < 0) return "fall";
    if (this.attackT >= 0) return `use${Math.min(4, 1 + Math.floor((this.attackT / 0.32) * 4))}`;
    if (this.pose) {
      if (this.pose.g === "wave") return Math.floor(this.clock * 4) % 2 ? "wave1" : "wave2";
      if (this.pose.g === "hug") return "hug";
      if (this.pose.g === "sit") return "sit";
    }
    if (this.flying) return "glide";
    if (!this.body.grounded) return this.body.vy < 0 ? "jump" : "fall";
    if (Math.abs(this.body.vx) > 8) return `walk${walkStep(this.walkDistance * CHARACTERS[this.id].stride, rigScale)}`;
    return "idle";
  }

  /** What's on the canvas now (frame, facing, attack progress, size), so unchanged frames aren't redrawn. */
  private drawnKey = "";
  private placed = "";
  private shownOpacity = "";

  draw(rigScale: number, bounds: Bounds) {
    const rig = this.rig;
    if (!rig) return;
    const s = rigScale;
    const fw = rig.info.frameWidth;
    const fh = rig.info.frameHeight;
    const W = (fw + PAD * 2) * s;
    const H = (fh + PAD * 2) * s;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
      this.drawnKey = "";
    }
    const left = Math.round(this.body.x - (rig.info.body.x + PAD) * s);
    const top = Math.round(this.body.y - (rig.info.body.y + PAD) * s);
    const transform = `translate(${left}px, ${top}px)`;
    if (transform !== this.placed) {
      this.placed = transform;
      this.canvas.style.transform = transform;
    }
    const opacity = String(this.leaving ? Math.max(0, 1 - this.fade) : this.fade);
    if (opacity !== this.shownOpacity) {
      this.shownOpacity = opacity;
      this.canvas.style.opacity = opacity;
    }
    const frame = this.frame(s);
    const flip = this.body.facing < 0;
    const key = `${frame}:${flip}:${this.attackT >= 0 ? this.attackT.toFixed(3) : "-"}:${W}x${H}`;
    if (key === this.drawnKey) {
      this.placeBubble(bounds);
      return;
    }
    this.drawnKey = key;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(PAD * s, PAD * s);
    rig.draw(ctx, frame, flip, fw * s, fh * s);
    // Weapon during an attack, at the hand.
    if (this.attackT >= 0) this.drawWeapon(ctx, rig, frame, flip, s);
    ctx.restore();
    this.placeBubble(bounds);
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, rig: TerrariaRig, frame: string, flip: boolean, s: number) {
    const def = this.weapon;
    const art = def.art;
    const tex = art ? getTexture(art.texture) : undefined;
    if (!art || !tex) return;
    const hand = rig.info.hands[frame] ?? [rig.info.body.x + rig.info.body.w, rig.info.body.y + 20];
    const p = Math.min(1, this.attackT / 0.32);
    const hx = (flip ? rig.info.frameWidth - hand[0] : hand[0]) * s;
    const hy = hand[1] * s;
    const k = s * 0.75;
    let rot: number;
    if (def.kind === "sword") rot = ((-110 + 180 * p + 45) * Math.PI) / 180;
    else rot = 0;
    ctx.save();
    ctx.translate(hx, hy);
    if (flip) ctx.scale(-1, 1);
    ctx.rotate(rot);
    ctx.drawImage(tex, -art.grip[0] * k, -art.grip[1] * k, art.size[0] * k, art.size[1] * k);
    ctx.restore();
  }

  /** Swing or fire her weapon (at the nearest target if there is one), like a click on the main one. */
  attack() {
    if (this.attackCd > 0) return;
    const cx = this.body.x + this.body.w / 2;
    const cy = this.body.y + this.body.h / 2;
    const t = this.hooks.target();
    const face: Dir = t ? (t.x < cx ? -1 : 1) : this.body.facing;
    this.body = { ...this.body, facing: face };
    const hand = { x: cx + face * this.body.w * 0.4, y: cy - this.body.h * 0.1 };
    const aim = t ? Math.atan2(t.y - hand.y, t.x - hand.x) : face > 0 ? 0 : Math.PI;
    assistAttack(this.hooks.combat(), this.weapon, hand, face, aim, Math.max(1, Math.round(this.body.h / 42)));
    this.attackCd = Math.max(0.2, this.weapon.useTime);
    this.attackT = 0;
    this.sinceStrike = 0;
    this.hooks.sound("swing");
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, dx: e.clientX - this.body.x, dy: e.clientY - this.body.y, moved: false, sx: e.clientX, sy: e.clientY, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    this.hooks.capture(true);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.stopPropagation();
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) {
      d.moved = true;
      this.hooks.sound("pickup"); // her voice line for being picked up
    }
    if (!d.moved) return;
    d.samples = [...d.samples, { x: e.clientX, y: e.clientY, t: performance.now() }].slice(-8);
    this.body = dragTo(this.body, e.clientX - d.dx, e.clientY - d.dy, this.lastBounds);
    this.hooks.dragging(this, { x: e.clientX, y: e.clientY });
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.stopPropagation();
    this.drag = null;
    this.hooks.capture(false);
    if (d.moved) {
      // Dropped into the notch (or bounced off a full one), or thrown: keep the release speed.
      if (this.hooks.dropped(this, { x: e.clientX, y: e.clientY }) !== "no") return;
      const v = throwVelocity(d.samples, performance.now());
      this.body = release(this.body, v.vx, v.vy);
      this.thrown = Math.hypot(v.vx, v.vy) > 150;
      this.thrownAt = this.clock;
      if (Math.hypot(v.vx, v.vy) > 400) this.hooks.sound("throw");
      return;
    }
    const now = performance.now();
    if (now - this.lastClick < 350) {
      // Double-click: make her the selected (controllable) character.
      this.hooks.select(this.id);
      this.lastClick = 0;
      return;
    }
    this.lastClick = now;
    // A click: a little pat, and she brings out her weapon.
    if (!this.affection.pet(this.clock)) this.attack();
  };

  destroy() {
    this.affection.flush(this.clock, true);
    this.canvas.remove();
    this.bubble.remove();
  }
}

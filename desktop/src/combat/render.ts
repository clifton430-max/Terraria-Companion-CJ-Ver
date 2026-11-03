// Draws the combat sandbox (held weapons, slash trails, projectiles, minions, dummies,
// the Eye of Cthulhu, effects, damage numbers, HUD and the letter effect) onto a full-screen,
// pointer-transparent canvas. Real Terraria textures are used when the local install provides
// them; every sprite has a procedural fallback. Only the regions drawn last frame are cleared,
// and nothing is drawn while the scene is idle.

import { getTexture } from "../assets/textures";
import {
  CORE_FRAME,
  HAND_FRAME,
  HEAD_FRAME,
  coreCenter,
  coreFrame,
  eyeCharge,
  handCenter,
  handFrame,
  headCenter,
  headFrame,
  partCenter,
  rayLine,
  type MoonLord,
  type MoonPart,
} from "./moonlord";
import { BEE_RADIUS, QB_FRAME, QB_FRAMES, beeFrame, type QueenBee } from "./queenbee";

/** The installed Moon Lord girl add-on's parts (the add-on hides the arms). */
const GIRL = {
  torso: "addon/moongirl/Images/Extra_13",
  head: "addon/moongirl/Images/NPC_396",
  hands: "addon/moongirl/Images/NPC_397",
  eye: "addon/moongirl/Images/Extra_29",
};
import { TIMELINE, crackLines, type LetterEffect } from "../effects/letterBreak";
import { IMPACT_DURATION, strikeDust, swingGhosts, type Impact } from "../effects/pickaxe";
import type { Dir } from "../engine/physics";
import { BOSS_FRAME_H, BOSS_FRAME_W, BOSS_PIVOT, SERVANT_FRAME_H, SERVANT_FRAME_W, bossFrame, servantFrame } from "./boss";
import { handPosition, type PlayerInfo } from "./geometry";
import { swingAngle } from "./melee";
import { fractalPoint } from "./projectiles";
import { pickaxeRotation } from "./pickaxeAnim";
import { drawSilkVisual, type SilkVisual } from "../silk/render";
import { DUMMY_PALETTE, DUMMY_ROWS, MINION_ROWS, MINION_SIZE } from "./sandboxArt";
import { BASE_MANA, attackPose, maxMana, prismRamp, weaponScale, weaponTip, type CombatState, type Dummy } from "./sim";
import { ART_SIZE, SHAPES, bowString, cellColor, type WeaponPalette } from "./weaponArt";
import { getWeapon, type WeaponDef } from "./weapons";

/** Boss bar layout inside Images/UI/UI_BossBar (516×348: six 58 px layers stacked vertically). */
const BAR = { w: 516, layer: 58, fillX: 32, fillY: 22, fillW: 456, fillH: 22, headX: 17, headY: 30 };
/** Chat-style announcements (bottom-left, like Terraria's chat). */
const MESSAGE_LIFE = 7;
const MAX_MESSAGES = 5;
/** Last Prism laser colours (approximating the game's rainbow). */
const PRISM_COLORS = ["#ff4d4d", "#ffa04d", "#fff14d", "#5dff6a", "#4dc3ff", "#b44dff"];

interface Message {
  text: string;
  color: string;
  born: number;
}

type Box = [number, number, number, number];

function paint(rows: string[], color: (key: string) => string | null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const ctx = canvas.getContext("2d")!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = color(row[x]);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

/** Render a weapon's 16×16 art; bows take a string pull 0..1. */
export function paintWeapon(def: WeaponDef, pull = 0): HTMLCanvasElement {
  const canvas = paint(SHAPES[def.shape].rows, (k) => cellColor(k, def.palette));
  if (def.kind === "bow") {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = cellColor("w", def.palette) ?? "#f4f7fa";
    for (const [x, y] of bowString(pull)) ctx.fillRect(x, y, 1, 1);
  }
  return canvas;
}

function paintMinion(palette: WeaponPalette): HTMLCanvasElement {
  return paint(MINION_ROWS, (k) => (k === "k" ? "#1d1424" : cellColor(k, palette)));
}

export class CombatRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private dirty: Box[] = [];
  private dpr = 1;
  private visible = true;
  private messages: Message[] = [];
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(width: number, height: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.width = width;
    this.height = height;
    this.dirty = [];
  }

  /** Show a Terraria-chat-style line (boss announcements etc.). */
  message(text: string, color: string) {
    this.messages.push({ text, color, born: performance.now() / 1000 });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
  }

  /** True while something time-based (messages) still needs redrawing. */
  busy() {
    return this.messages.length > 0;
  }

  /** A texture recoloured to `color` (for white Terraria effect sprites such as slashes and lasers). */
  private tinted(name: string, color: string): HTMLCanvasElement | undefined {
    const tex = getTexture(name);
    if (!tex) return undefined;
    return this.sprite(`tint:${name}:${color}`, () => {
      const c = document.createElement("canvas");
      c.width = tex.width;
      c.height = tex.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(tex, 0, 0);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(tex, 0, 0);
      return c;
    });
  }

  private sprite(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let c = this.cache.get(key);
    if (!c) {
      c = make();
      this.cache.set(key, c);
    }
    return c;
  }

  private mark(x: number, y: number, w: number, h: number) {
    this.dirty.push([x - 2, y - 2, w + 4, h + 4]);
  }

  /** Clear last frame's regions and draw the current state. */
  draw(
    state: CombatState,
    player: PlayerInfo,
    letters: readonly LetterEffect[] = [],
    boss: { hp: number; maxHp: number; name?: string } | null = null,
    extras: { impacts?: readonly Impact[]; flying?: boolean; napping?: boolean; silk?: SilkVisual | null } = {},
  ) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const [x, y, w, h] of this.dirty) ctx.clearRect(x, y, w, h);
    this.dirty = [];
    ctx.imageSmoothingEnabled = false;

    for (const l of letters) this.drawLetters(l);
    for (const i of extras.impacts ?? []) this.drawImpact(i);
    if (extras.flying) this.drawFlight(state, player);
    if (extras.napping) this.drawZzz(state, player);
    if (extras.silk) drawSilkVisual(ctx, extras.silk, (x, y, w, h) => this.mark(x, y, w, h));
    for (const d of state.dummies) if ((d.kind ?? "dummy") === "dummy") this.drawDummy(d, player.scale);
    if (state.moonLord) {
      if (state.moonLord.model === "girl" && getTexture(GIRL.head)) this.drawMoonGirl(state, state.moonLord, player);
      else this.drawMoonLord(state, state.moonLord, player);
    }
    if (state.queenBee) this.drawQueenBee(state, state.queenBee);
    this.drawServants(state);
    this.drawBoss(state);
    for (const m of state.minions) this.drawMinion(state, m.weaponId, m.x, m.y, m.vx, player.scale, m.vy, m.id);
    this.drawHeldWeapon(state, player);
    for (const p of state.projectiles) this.drawProjectile(p, player);
    for (const e of state.effects) this.drawEffect(e);
    for (const t of state.texts) this.drawText(t);
    this.drawManaBar(state, player);
    if (boss) this.drawBossBar(boss);
    if (state.moonLord) this.drawMoonAttacks(state.moonLord);
    if (state.boss || state.moonLord || state.queenBee || state.player.hp < state.player.maxHp || state.player.dead) this.drawHearts(state);
    this.drawMessages();
    // An empty full-screen layer still costs compositing every frame; hide it when blank.
    const visible = this.dirty.length > 0;
    if (visible !== this.visible) {
      this.canvas.style.display = visible ? "" : "none";
      this.visible = visible;
    }
  }

  private drawDummy(d: Dummy, scale: number) {
    const ctx = this.ctx;
    const img = this.sprite("dummy", () => paint(DUMMY_ROWS, (k) => DUMMY_PALETTE[k] ?? null));
    const flash = this.sprite("dummy-flash", () => paint(DUMMY_ROWS, (k) => (DUMMY_PALETTE[k] ? "#ffffff" : null)));
    const down = d.respawn > 0;
    ctx.save();
    ctx.globalAlpha = down ? 0.3 : 1;
    ctx.translate(d.x + d.w / 2, d.y + d.h);
    ctx.rotate(d.wobble);
    ctx.drawImage(d.flash > 0 ? flash : img, -d.w / 2, -d.h, d.w, d.h);
    ctx.restore();
    const sway = Math.abs(Math.sin(d.wobble)) * d.h;
    this.mark(d.x - sway, d.y, d.w + sway * 2, d.h);

    if (!down && d.hp < d.maxHp) {
      const w = d.w;
      const h = Math.max(3, scale);
      const x = d.x;
      const y = d.y - h - 4;
      const frac = d.hp / d.maxHp;
      ctx.fillStyle = "rgba(20,14,30,0.8)";
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = frac > 0.5 ? "#5fd35f" : frac > 0.25 ? "#f2c94c" : "#eb5757";
      ctx.fillRect(x, y, w * frac, h);
      this.mark(x - 1, y - 1, w + 2, h + 2);
    }
  }

  private drawMinion(state: CombatState, weaponId: string, x: number, y: number, vx: number, scale: number, vy = 0, id = 0) {
    const def = getWeapon(weaponId);
    if (def?.kind !== "summon") return;
    const ctx = this.ctx;
    const art = def.minion.art;
    const tex = art ? getTexture(art.texture) : undefined;
    if (art && tex) {
      // Real sprite (Stardust Dragon head, Terraprisma blade), pointed along its motion.
      const k = Math.max(1, scale / 3) * (art.scale ?? 1);
      const frames = art.frames ?? 1;
      const fh = tex.height / frames;
      const frame = Math.floor(state.time * 8 + id) % frames;
      const moving = Math.hypot(vx, vy) > 20;
      const angle = moving ? Math.atan2(vy, vx) : Math.sin(state.time * 2 + id) * 0.3 - Math.PI / 2;
      const w = tex.width * k;
      const h = fh * k;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.rotate(angle + art.rotation);
      if (art.rainbow) {
        // Terraprisma: a soft hue-cycling glow behind the white blade.
        const hue = (state.time * 120 + id * 47) % 360;
        ctx.shadowColor = `hsl(${hue} 100% 65%)`;
        ctx.shadowBlur = 10 * k;
        ctx.filter = `drop-shadow(0 0 ${3 * k}px hsl(${hue} 100% 65%))`;
      }
      ctx.drawImage(tex, 0, frame * fh, tex.width, fh, -w / 2, -h / 2, w, h);
      ctx.restore();
      const r = Math.max(w, h);
      this.mark(x - r, y - r, r * 2, r * 2);
      return;
    }
    const size = MINION_SIZE * Math.max(2, scale - 1);
    const glow = def.minion.palette.c ?? "#9fe6ff";
    const pulse = 0.35 + 0.15 * Math.sin(state.time * 6);
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, hexAlpha(glow, pulse));
    g.addColorStop(1, hexAlpha(glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    const img = this.sprite(`minion:${weaponId}`, () => paintMinion(def.minion.palette));
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (vx < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
    this.mark(x - size, y - size, size * 2, size * 2);
  }

  private drawHeldWeapon(state: CombatState, player: PlayerInfo) {
    const attack = state.attack;
    if (!attack) return;
    const def = getWeapon(attack.weaponId);
    if (!def) return;
    const ctx = this.ctx;
    const s = player.scale;
    const dir: Dir = attack.dir;
    const progress = Math.min(attack.t / attack.duration, 1);
    const hand = handPosition(player, attackPose(def.kind, progress), dir);
    const shape = SHAPES[def.shape];
    // Local angle in right-facing space; the canvas is mirrored for left-facing attacks.
    const localAim = dir > 0 ? attack.aim : Math.PI - attack.aim;
    let rotation = 0;
    let pull = 0;
    switch (def.kind) {
      case "sword":
        rotation = def.pickaxe ? pickaxeRotation(progress) : ((swingAngle(def, progress) + 45) * Math.PI) / 180;
        break;
      case "bow":
        rotation = localAim;
        pull = attack.fired ? 0 : Math.min(attack.t / attack.releaseAt, 1);
        break;
      case "gun": {
        const kick = attack.t < 0.1 ? (1 - attack.t / 0.1) * 0.3 : 0;
        rotation = localAim - kick;
        break;
      }
      case "staff":
        rotation = Math.sin(progress * Math.PI) * -0.25;
        break;
      case "summon":
        rotation = Math.sin(progress * Math.PI * 2) * 0.3;
        break;
    }

    // Terraria pickaxes have no slash trail; swords do.
    if (def.kind === "sword" && progress >= def.activeFrom && !def.fractal && !def.pickaxe) {
      // Real slash texture when available, otherwise the procedural arc.
      if (!(def.slash && this.drawSlashSprite(def, hand, dir, progress, s))) this.drawSlash(def, hand, dir, progress, s);
    }
    if (def.kind === "staff" && def.channel && attack.fired && this.drawPrism(state, def, player, hand)) return;

    if (def.kind === "sword" && def.chain) {
      this.drawChainWeapon(def, hand, dir, progress, s);
      return;
    }

    const tex = def.art ? getTexture(def.art.texture) : undefined;
    if (def.art && tex) {
      const art = def.art;
      // Swords are drawn so the blade tip lands at the simulated reach (the hitbox stays truthful).
      // The pickaxe keeps Terraria's pixel scale (its reach is set to match the drawn head).
      const ws =
        def.kind === "sword" && !def.pickaxe
          ? (def.reach * s) / Math.hypot(art.tip[0] - art.grip[0], art.tip[1] - art.grip[1])
          : weaponScale(def, player);
      if (def.kind === "staff") rotation = def.channel ? localAim + Math.PI / 2 : rotation;
      // Pickaxe afterimages: earlier positions of the real sprite, fading out (Terraria-style).
      if (def.kind === "sword" && def.pickaxe) {
        for (const g of swingGhosts(progress)) {
          ctx.save();
          ctx.globalAlpha = g.alpha;
          ctx.translate(Math.round(hand.x), Math.round(hand.y));
          ctx.scale(dir, 1);
          ctx.rotate(pickaxeRotation(g.progress));
          ctx.drawImage(tex, -art.grip[0] * ws, -art.grip[1] * ws, art.size[0] * ws, art.size[1] * ws);
          ctx.restore();
        }
      }
      ctx.save();
      ctx.translate(Math.round(hand.x), Math.round(hand.y));
      ctx.scale(dir, 1);
      ctx.rotate(rotation);
      ctx.drawImage(tex, -art.grip[0] * ws, -art.grip[1] * ws, art.size[0] * ws, art.size[1] * ws);
      ctx.restore();
      const r = Math.max(art.size[0], art.size[1]) * ws * 1.2;
      this.mark(hand.x - r, hand.y - r, r * 2, r * 2);
      return;
    }

    const key = def.kind === "bow" ? `w:${def.id}:${Math.round(pull * 4)}` : `w:${def.id}`;
    const img = this.sprite(key, () => paintWeapon(def, Math.round(pull * 4) / 4));
    ctx.save();
    ctx.translate(Math.round(hand.x), Math.round(hand.y));
    ctx.scale(dir, 1);
    ctx.rotate(rotation);
    ctx.drawImage(img, -shape.grip.x * s, -shape.grip.y * s, ART_SIZE * s, ART_SIZE * s);
    if (def.kind === "bow" && !attack.fired) {
      // Nocked arrow, pulled back with the string.
      const nock = (4 - pull * 3 - shape.grip.x) * s;
      ctx.fillStyle = "#c9a46a";
      ctx.fillRect(nock, -s / 2, 3 * s - nock, s);
      ctx.fillStyle = "#dfe7ee";
      ctx.fillRect(3 * s, -s, 2 * s, 2 * s);
    }
    if (def.kind === "staff" && !attack.fired) {
      const tx = (shape.tip.x - shape.grip.x) * s;
      const ty = (shape.tip.y - shape.grip.y) * s;
      const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 6 * s);
      glow.addColorStop(0, hexAlpha(def.boltColor, 0.8));
      glow.addColorStop(1, hexAlpha(def.boltColor, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(tx - 6 * s, ty - 6 * s, 12 * s, 12 * s);
    }
    ctx.restore();
    const r = ART_SIZE * s * 1.5;
    this.mark(hand.x - r, hand.y - r, r * 2, r * 2);
  }

  /** Solar Eruption: a fiery chain from the hand out to the flail head at the simulated tip. */
  private drawChainWeapon(def: WeaponDef & { kind: "sword" }, hand: { x: number; y: number }, dir: Dir, progress: number, s: number) {
    const ctx = this.ctx;
    const chain = def.chain!;
    // Lash out then retract: the drawn reach follows the swing, peaking mid-attack.
    const extend = Math.sin(Math.min(1, progress / 0.85) * Math.PI);
    const a = (swingAngle(def, progress) * Math.PI) / 180;
    const len = def.reach * s * (0.25 + 0.75 * extend);
    const tip = { x: hand.x + dir * Math.cos(a) * len, y: hand.y + Math.sin(a) * len };
    const links = Math.max(3, Math.round(len / (3 * s)));
    for (let i = 1; i < links; i++) {
      const f = i / links;
      const wobble = Math.sin(f * Math.PI) * Math.sin(progress * 18 + i) * 2 * s;
      const x = hand.x + (tip.x - hand.x) * f;
      const y = hand.y + (tip.y - hand.y) * f + wobble;
      ctx.fillStyle = i % 2 ? chain.color : chain.link;
      ctx.fillRect(Math.round(x - s), Math.round(y - s), Math.ceil(2 * s), Math.ceil(2 * s));
    }
    const tex = def.art ? getTexture(def.art.texture) : undefined;
    const size = 14 * s;
    ctx.save();
    ctx.translate(Math.round(tip.x), Math.round(tip.y));
    ctx.scale(dir, 1);
    ctx.rotate(a + Math.PI / 4);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
    glow.addColorStop(0, hexAlpha(chain.link, 0.7));
    glow.addColorStop(1, hexAlpha(chain.color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-size, -size, size * 2, size * 2);
    if (tex && def.art) ctx.drawImage(tex, -size / 2, -size / 2, size, size);
    else {
      ctx.fillStyle = chain.link;
      ctx.fillRect(-3 * s, -3 * s, 6 * s, 6 * s);
    }
    ctx.restore();
    const minX = Math.min(hand.x, tip.x) - size;
    const minY = Math.min(hand.y, tip.y) - size;
    this.mark(minX, minY, Math.abs(tip.x - hand.x) + size * 2, Math.abs(tip.y - hand.y) + size * 2);
  }

  private drawSlash(def: WeaponDef & { kind: "sword" }, hand: { x: number; y: number }, dir: Dir, progress: number, s: number) {
    const ctx = this.ctx;
    const reach = def.reach * s;
    const from = (swingAngle(def, def.activeFrom) * Math.PI) / 180;
    const to = (swingAngle(def, Math.min(progress, def.activeTo)) * Math.PI) / 180;
    const fade = progress > def.activeTo ? 1 - (progress - def.activeTo) / (1 - def.activeTo) : 1;
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.scale(dir, 1);
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(255,255,255,${0.55 * fade})`;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.85, from, to);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,236,170,${0.35 * fade})`;
    ctx.lineWidth = 6 * s;
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.6, from, to);
    ctx.stroke();
    ctx.restore();
    this.mark(hand.x - reach - 8 * s, hand.y - reach - 8 * s, (reach + 8 * s) * 2, (reach + 8 * s) * 2);
  }

  /** Night's Edge: the real white slash crescent, tinted and swept with the swing. */
  private drawSlashSprite(def: WeaponDef & { kind: "sword" }, hand: { x: number; y: number }, dir: Dir, progress: number, s: number): boolean {
    const slash = def.slash!;
    const img = this.tinted(slash.texture, slash.color);
    if (!img) return false;
    const fw = img.width;
    const fh = img.height / slash.frames;
    const active = Math.min(1, (progress - def.activeFrom) / Math.max(0.01, def.activeTo - def.activeFrom));
    const frame = Math.min(slash.frames - 1, Math.floor(active * slash.frames));
    const size = (def.reach * s * 2.1 * fw) / 160; // crescent radius ≈ 80 of the 170 px frame
    const angle = (swingAngle(def, Math.min(progress, def.activeTo)) * Math.PI) / 180;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = progress > def.activeTo ? Math.max(0, 1 - (progress - def.activeTo) / (1 - def.activeTo)) : 0.9;
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(hand.x, hand.y);
    ctx.scale(dir, 1);
    ctx.rotate(angle);
    ctx.drawImage(img, 0, frame * fh, fw, fh, -size / 2, -size / 2, size, size);
    ctx.restore();
    this.mark(hand.x - size / 2, hand.y - size / 2, size, size);
    return true;
  }

  /** Last Prism: the holdout prism plus rainbow lasers that converge into one beam. */
  private drawPrism(state: CombatState, def: WeaponDef & { kind: "staff" }, player: PlayerInfo, hand: { x: number; y: number }): boolean {
    const ch = def.channel!;
    const attack = state.attack!;
    const ws = weaponScale(def, player);
    const origin = weaponTip(def, hand, 0, attack.dir, ws);
    const ramp = (prismRamp(def, attack.t) - 0.35) / 0.65; // 0 → 1 while converging
    const ctx = this.ctx;
    const laser = getTexture(ch.laserTexture);
    const width = ch.width * ws;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < ch.beams; i++) {
      const spread = (i - (ch.beams - 1) / 2) * 0.09 * (1 - ramp);
      const a = attack.aim + spread;
      const color = PRISM_COLORS[i % PRISM_COLORS.length];
      ctx.save();
      ctx.translate(origin.x, origin.y);
      ctx.rotate(a);
      const img = laser ? this.tinted(ch.laserTexture, color) : undefined;
      ctx.globalAlpha = 0.55 + 0.25 * ramp;
      if (img) {
        // The laser texture runs vertically: start, body and end segments of 26 px.
        ctx.rotate(-Math.PI / 2);
        const seg = img.height / 3;
        ctx.drawImage(img, 0, seg, img.width, seg, -width / 2, 0, width, ch.length);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(0, -width / 4, ch.length, width / 2);
      }
      ctx.restore();
    }
    if (ramp >= 0.99) {
      // Converged: a bright white core.
      ctx.translate(origin.x, origin.y);
      ctx.rotate(attack.aim);
      ctx.globalAlpha = 0.6 + 0.2 * Math.sin(state.time * 30);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, -width / 3, ch.length, (width * 2) / 3);
    }
    ctx.restore();
    // Holdout prism, spinning faster as it charges (5 frames).
    const hold = getTexture(ch.holdoutTexture);
    if (hold) {
      const frames = 5;
      const fh = hold.height / frames;
      const frame = Math.floor(attack.t * (8 + 16 * ramp)) % frames;
      ctx.save();
      ctx.translate(origin.x, origin.y);
      ctx.rotate(attack.aim + Math.PI / 2);
      ctx.drawImage(hold, 0, frame * fh, hold.width, fh, (-hold.width * ws) / 2, (-fh * ws) / 2, hold.width * ws, fh * ws);
      ctx.restore();
    }
    // Beams run off-screen: mark the whole band they can cover.
    const end = { x: origin.x + Math.cos(attack.aim) * ch.length, y: origin.y + Math.sin(attack.aim) * ch.length };
    const pad = width + 40;
    this.mark(Math.min(origin.x, end.x) - pad, Math.min(origin.y, end.y) - pad, Math.abs(end.x - origin.x) + pad * 2, Math.abs(end.y - origin.y) + pad * 2);
    return hold !== undefined || laser !== undefined;
  }

  private drawBoss(state: CombatState) {
    const b = state.boss;
    if (!b || b.alpha <= 0) return;
    const ctx = this.ctx;
    const s = b.scale;
    const entry = state.dummies.find((d) => d.id === state.bossDummyId);
    const tex = getTexture("Images/NPC_4");
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);
    if (tex) {
      const sy = bossFrame(b) * BOSS_FRAME_H;
      const draw = () =>
        ctx.drawImage(tex, 0, sy, BOSS_FRAME_W, BOSS_FRAME_H, -BOSS_PIVOT.x * s, -BOSS_PIVOT.y * s, BOSS_FRAME_W * s, BOSS_FRAME_H * s);
      draw();
      if (entry && entry.flash > 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = b.alpha * 0.5;
        draw();
      }
    } else {
      // Fallback: a bloodshot eyeball with its pupil along +y.
      const r = 50 * s;
      ctx.fillStyle = "#f2e8e0";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.transformed ? "#3a0a0a" : "#c0392b";
      ctx.beginPath();
      ctx.arc(0, r * 0.45, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(0, r * 0.55, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    const r = Math.max(BOSS_FRAME_H, BOSS_FRAME_W) * s;
    this.mark(b.x - r, b.y - r, r * 2, r * 2);
  }

  /** The Moon Lord: arms and torso (procedural), core, head and hands from the install's sheets. */
  private drawMoonLord(state: CombatState, m: MoonLord, player: PlayerInfo) {
    const ctx = this.ctx;
    const s = m.scale;
    const look = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
    ctx.save();
    ctx.globalAlpha = m.alpha;
    // Dying: flicker toward white.
    if (m.phase === "dying" && Math.floor(m.t * 14) % 3 === 0) ctx.filter = "brightness(1.8)";
    const skin = "#c7ad86";
    const dark = "#3b2a22";
    // Arms: shoulder → elbow → wrist, outlined.
    for (const side of ["left", "right"] as const) {
      const d = side === "left" ? -1 : 1;
      const hand = handCenter(m, side);
      const pts = [
        { x: m.x + d * 70 * s, y: m.y - 60 * s },
        { x: m.x + d * 190 * s, y: m.y + 110 * s },
        { x: hand.x, y: hand.y + 110 * s },
      ];
      for (const [w, c] of [[34, dark], [26, skin]] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w * s;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.stroke();
      }
    }
    // Torso with ribs and the chest cavity that holds the core.
    ctx.fillStyle = skin;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(m.x - 95 * s, m.y - 80 * s);
    ctx.quadraticCurveTo(m.x, m.y - 110 * s, m.x + 95 * s, m.y - 80 * s);
    ctx.quadraticCurveTo(m.x + 80 * s, m.y + 70 * s, m.x + 50 * s, m.y + 150 * s);
    ctx.quadraticCurveTo(m.x, m.y + 170 * s, m.x - 50 * s, m.y + 150 * s);
    ctx.quadraticCurveTo(m.x - 80 * s, m.y + 70 * s, m.x - 95 * s, m.y - 80 * s);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#8d7354";
    ctx.lineWidth = 3 * s;
    for (let i = 0; i < 4; i++) {
      const y = m.y - 50 * s + i * 24 * s;
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(m.x + d * 34 * s, y);
        ctx.quadraticCurveTo(m.x + d * 70 * s, y - 10 * s, m.x + d * (78 - i * 6) * s, y + 14 * s);
        ctx.stroke();
      }
    }
    const core = coreCenter(m);
    ctx.fillStyle = "#13201f";
    ctx.beginPath();
    ctx.ellipse(core.x, core.y, 36 * s, 48 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    const coreTex = getTexture("Images/NPC_398");
    if (m.alive.core || m.phase === "dying") {
      if (coreTex) {
        const f = coreFrame(m);
        ctx.drawImage(coreTex, 0, f * CORE_FRAME.h, CORE_FRAME.w, CORE_FRAME.h, core.x - (CORE_FRAME.w / 2) * s, core.y - (CORE_FRAME.h / 2) * s, CORE_FRAME.w * s, CORE_FRAME.h * s);
      } else {
        ctx.fillStyle = m.phase === "core" ? "#5affc8" : "#2a8a72";
        ctx.beginPath();
        ctx.ellipse(core.x, core.y, 26 * s, 36 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (m.phase === "core") {
        // Exposed: a pulsing glow says "hit me".
        const g = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, 70 * s);
        g.addColorStop(0, `rgba(127,255,224,${0.25 + 0.15 * Math.sin(m.t * 6)})`);
        g.addColorStop(1, "rgba(127,255,224,0)");
        ctx.fillStyle = g;
        ctx.fillRect(core.x - 70 * s, core.y - 70 * s, 140 * s, 140 * s);
      }
    }

    // Head: the eye sits behind the forehead socket.
    this.drawMoonEye(m, "head", look);
    const head = headCenter(m);
    const headTex = getTexture("Images/NPC_396");
    if (headTex) {
      const f = headFrame(m);
      const sx = (f % HEAD_FRAME.cols) * HEAD_FRAME.w;
      const sy = Math.floor(f / HEAD_FRAME.cols) * HEAD_FRAME.h;
      ctx.drawImage(headTex, sx, sy, HEAD_FRAME.w, HEAD_FRAME.h, head.x - (HEAD_FRAME.w / 2) * s, head.y - (HEAD_FRAME.h / 2) * s, HEAD_FRAME.w * s, HEAD_FRAME.h * s);
    } else {
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(head.x, head.y - 30 * s, 80 * s, 100 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawMoonEye(m, "head", look);
    }
    // Hands (the left one mirrored), palm eye behind the socket.
    const handTex = getTexture("Images/NPC_397");
    for (const side of ["left", "right"] as const) {
      this.drawMoonEye(m, side, look);
      const h = handCenter(m, side);
      if (handTex) {
        const f = handFrame(m, side);
        ctx.save();
        ctx.translate(h.x, h.y);
        if (side === "left") ctx.scale(-1, 1);
        ctx.drawImage(handTex, 0, f * HAND_FRAME.h, HAND_FRAME.w, HAND_FRAME.h, (-HAND_FRAME.w / 2) * s, (-HAND_FRAME.h / 2) * s, HAND_FRAME.w * s, HAND_FRAME.h * s);
        ctx.restore();
      } else {
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, 90 * s, 110 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        this.drawMoonEye(m, side, look);
      }
    }
    ctx.restore();

    // Per-part health bars under each part that can be hit.
    if (state.moonIds && (m.phase === "eyes" || m.phase === "core")) {
      for (const part of ["head", "left", "right", "core"] as MoonPart[]) {
        const e = state.dummies.find((d) => d.id === state.moonIds![part]);
        if (!e || e.respawn > 0 || e.hp <= 0) continue;
        const w = Math.max(40, e.w * 1.2);
        const x = e.x + e.w / 2 - w / 2;
        const y = e.y + e.h + 6;
        const frac = e.hp / e.maxHp;
        ctx.fillStyle = "rgba(10,20,24,0.8)";
        ctx.fillRect(x - 1, y - 1, w + 2, 6);
        ctx.fillStyle = e.flash > 0 ? "#ffffff" : "#5affc8";
        ctx.fillRect(x, y, w * frac, 4);
      }
    }
    this.mark(m.x - 460 * s, m.y - 340 * s, 920 * s, 560 * s);
  }

  /**
   * The Moon Lord girl (installed add-on): torso halves (mirrored), the big head with an eye
   * showing through its forehead socket, and floating hands with eyes in their palms. Eyes track
   * the companion, flare before attacking and close when destroyed; parts flash when hit.
   */
  private drawMoonGirl(state: CombatState, m: MoonLord, player: PlayerInfo) {
    const ctx = this.ctx;
    const s = m.scale;
    const look = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
    const torso = getTexture(GIRL.torso);
    const head = getTexture(GIRL.head);
    const hands = getTexture(GIRL.hands);
    const eye = getTexture(GIRL.eye);
    const flash = (part: MoonPart) => (state.dummies.find((d) => d.id === state.moonIds?.[part])?.flash ?? 0) > 0;
    ctx.save();
    ctx.globalAlpha = m.alpha;
    if (m.phase === "dying" && Math.floor(m.t * 14) % 3 === 0) ctx.filter = "brightness(1.8)";
    const breathe = 1 + Math.sin(m.t * 1.6) * 0.008;
    // Torso: the left half, and the same half mirrored for the right.
    if (torso) {
      const top = m.y - 300 * s;
      ctx.save();
      ctx.translate(m.x, top);
      ctx.scale(1, breathe);
      ctx.drawImage(torso, -torso.width * s, 0, torso.width * s, torso.height * s);
      ctx.scale(-1, 1);
      ctx.drawImage(torso, -torso.width * s, 0, torso.width * s, torso.height * s);
      ctx.restore();
    }
    // Exposed core (glowing on the bandage knot) once the eyes are down.
    if (m.phase === "core" || m.phase === "dying") {
      const c = coreCenter(m);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 70 * s);
      g.addColorStop(0, `rgba(127,255,224,${0.55 + 0.25 * Math.sin(m.t * 6)})`);
      g.addColorStop(1, "rgba(127,255,224,0)");
      ctx.fillStyle = g;
      ctx.fillRect(c.x - 70 * s, c.y - 70 * s, 140 * s, 140 * s);
      const core = getTexture("Images/NPC_398");
      if (core) {
        const f = coreFrame(m);
        ctx.save();
        if (flash("core")) ctx.filter = "brightness(2)";
        ctx.drawImage(core, 0, f * CORE_FRAME.h, CORE_FRAME.w, CORE_FRAME.h, c.x - (CORE_FRAME.w / 2) * s, c.y - (CORE_FRAME.h / 2) * s, CORE_FRAME.w * s, CORE_FRAME.h * s);
        ctx.restore();
      }
    }
    // An eye from Extra_29 (4 frames: open → shut) at a socket, looking toward the companion.
    const drawEye = (part: MoonPart, size: number) => {
      const c = partCenter(m, part);
      const charge = eyeCharge(m, part);
      if (eye) {
        const fh = eye.height / 4;
        const frame = m.alive[part] ? (charge > 0 ? 0 : Math.floor(m.t * 0.4 + (part === "left" ? 0.5 : 0)) % 7 === 6 ? 2 : 0) : 3;
        const a = Math.atan2(look.y - c.y, look.x - c.x);
        const lx = m.alive[part] ? Math.cos(a) * 3 * s : 0;
        const ly = m.alive[part] ? Math.sin(a) * 3 * s : 0;
        ctx.drawImage(eye, 0, frame * fh, eye.width, fh, c.x - (size / 2) * s + lx, c.y - (size * 0.55) * s + ly, size * s, size * 1.1 * s);
      }
      if (charge > 0 && m.alive[part]) {
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 50 * s);
        g.addColorStop(0, `rgba(160,255,235,${0.4 + 0.5 * charge})`);
        g.addColorStop(1, "rgba(160,255,235,0)");
        ctx.fillStyle = g;
        ctx.fillRect(c.x - 50 * s, c.y - 50 * s, 100 * s, 100 * s);
      }
    };
    drawEye("head", 50);
    if (head) {
      const h = headCenter(m);
      ctx.save();
      if (flash("head")) ctx.filter = "brightness(1.8)";
      ctx.drawImage(head, h.x - (head.width / 2) * s, h.y - (head.height / 2) * s, head.width * s, head.height * s);
      ctx.restore();
    }
    for (const side of ["left", "right"] as const) {
      drawEye(side, 52);
      const h = handCenter(m, side);
      if (hands) {
        const fh = hands.height / 4;
        const f = handFrame(m, side);
        ctx.save();
        ctx.translate(h.x, h.y);
        if (side === "left") ctx.scale(-1, 1);
        ctx.rotate(Math.sin(m.t * 1.3 + (side === "left" ? 0 : 1.4)) * 0.06);
        if (flash(side)) ctx.filter = "brightness(1.8)";
        ctx.drawImage(hands, 0, f * fh, hands.width, fh, (-hands.width / 2) * s, (-fh / 2) * s, hands.width * s, fh * s);
        ctx.restore();
      }
    }
    ctx.restore();
    this.drawMoonPartBars(state, m);
    this.mark(m.x - 520 * s, m.y - 620 * s, 1040 * s, 1000 * s);
  }

  /** Small health bars under each hittable Moon Lord part. */
  private drawMoonPartBars(state: CombatState, m: MoonLord) {
    if (!state.moonIds || (m.phase !== "eyes" && m.phase !== "core")) return;
    const ctx = this.ctx;
    for (const part of ["head", "left", "right", "core"] as MoonPart[]) {
      const e = state.dummies.find((d) => d.id === state.moonIds![part]);
      if (!e || e.respawn > 0 || e.hp <= 0) continue;
      const w = Math.max(40, e.w * 1.2);
      const x = e.x + e.w / 2 - w / 2;
      const y = e.y + e.h + 6;
      ctx.fillStyle = "rgba(10,20,24,0.8)";
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      ctx.fillStyle = e.flash > 0 ? "#ffffff" : "#5affc8";
      ctx.fillRect(x, y, (w * e.hp) / e.maxHp, 4);
    }
  }

  /** Queen Bee (the installed waifu add-on's sheet, or the game's), her stingers and bees. */
  private drawQueenBee(state: CombatState, q: QueenBee) {
    const ctx = this.ctx;
    const s = q.scale;
    // Charge warning: a translucent red band across her dash lane.
    if (q.charge && q.charge.warn > 0) {
      const half = QB_FRAME.h * 0.32 * s;
      ctx.fillStyle = `rgba(255,70,70,${0.12 + 0.12 * Math.sin(q.t * 30)})`;
      ctx.fillRect(0, q.charge.y - half, this.width, half * 2);
      ctx.strokeStyle = "rgba(255,90,90,0.8)";
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(0, q.charge.y);
      ctx.lineTo(this.width, q.charge.y);
      ctx.stroke();
      ctx.setLineDash([]);
      this.mark(0, q.charge.y - half - 2, this.width, half * 2 + 4);
    }
    const tex = getTexture("addon/queenbee/Images/NPC_222") ?? getTexture("Images/NPC_222");
    const entry = state.dummies.find((d) => d.id === state.queenId);
    ctx.save();
    ctx.globalAlpha = q.alpha;
    ctx.translate(q.x, q.y);
    if (q.phase === "dying") ctx.rotate(q.phaseT * 3);
    if (q.facing > 0) ctx.scale(-1, 1); // the sheet faces left
    if ((entry?.flash ?? 0) > 0) ctx.filter = "brightness(1.8)";
    else if (q.enraged) ctx.filter = "saturate(1.4) hue-rotate(-10deg)";
    if (tex) {
      const fh = tex.height / QB_FRAMES;
      const w = QB_FRAME.w * s;
      const h = fh * (w / tex.width);
      ctx.drawImage(tex, 0, beeFrame(q) * fh, tex.width, fh, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = "#ffcc33";
      ctx.beginPath();
      ctx.ellipse(0, 0, 60 * s, 40 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2a1a08";
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * 22 * s - 5 * s, -36 * s, 10 * s, 72 * s);
    }
    ctx.restore();
    const r = QB_FRAME.w * s;
    this.mark(q.x - r, q.y - r, r * 2, r * 2);
    for (const st of q.stingers) {
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(Math.atan2(st.vy, st.vx));
      ctx.fillStyle = "#2a1a08";
      ctx.fillRect(-st.r * 2, -st.r * 0.4, st.r * 2.6, st.r * 0.8);
      ctx.fillStyle = "#ffd24a";
      ctx.fillRect(-st.r * 1.2, -st.r * 0.4, st.r * 0.8, st.r * 0.8);
      ctx.restore();
      this.mark(st.x - st.r * 3, st.y - st.r * 3, st.r * 6, st.r * 6);
    }
    for (const { b } of state.bees) {
      const br = BEE_RADIUS * s;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.vx > 0) ctx.scale(-1, 1);
      ctx.fillStyle = "rgba(220,240,255,0.7)";
      const flap = Math.sin(b.age * 40) * br * 0.4;
      ctx.fillRect(-br * 0.4, -br * 1.4 - flap, br * 0.9, br * 0.9);
      ctx.fillStyle = "#ffcc33";
      ctx.fillRect(-br, -br * 0.6, br * 2, br * 1.2);
      ctx.fillStyle = "#2a1a08";
      ctx.fillRect(-br * 0.2, -br * 0.6, br * 0.4, br * 1.2);
      ctx.fillRect(-br, -br * 0.3, br * 0.4, br * 0.4);
      ctx.restore();
      this.mark(b.x - br * 2, b.y - br * 2, br * 4, br * 4);
    }
  }

  /** A Moon Lord eye: pale sclera, teal iris watching the character; dark and shut once destroyed. */
  private drawMoonEye(m: MoonLord, part: MoonPart, look: { x: number; y: number }) {
    const ctx = this.ctx;
    const s = m.scale;
    const c = partCenter(m, part);
    const [w, h] = part === "head" ? [16, 30] : [22, 40];
    ctx.save();
    if (!m.alive[part]) {
      ctx.fillStyle = "#2a1418";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, w * s, h * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const charge = eyeCharge(m, part);
    ctx.fillStyle = "#dafff5";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, w * s, h * s, 0, 0, Math.PI * 2);
    ctx.fill();
    const a = Math.atan2(look.y - c.y, look.x - c.x);
    const ix = c.x + Math.cos(a) * w * 0.35 * s;
    const iy = c.y + Math.sin(a) * h * 0.35 * s;
    if (charge > 0) {
      // Telegraph: the eye flares before it attacks.
      const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, w * 2.2 * s);
      g.addColorStop(0, `rgba(160,255,235,${0.5 + 0.5 * charge})`);
      g.addColorStop(1, "rgba(160,255,235,0)");
      ctx.fillStyle = g;
      ctx.fillRect(ix - w * 2.2 * s, iy - w * 2.2 * s, w * 4.4 * s, w * 4.4 * s);
    }
    ctx.fillStyle = "#1fc79d";
    ctx.beginPath();
    ctx.arc(ix, iy, w * 0.7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#06231d";
    ctx.beginPath();
    ctx.arc(ix, iy, w * 0.35 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ix - w * 0.4 * s, iy - w * 0.45 * s, 3 * s, 3 * s);
    ctx.restore();
  }

  /** Deathray (warning line, then the beam) and the Phantasmal shots, drawn over everything. */
  private drawMoonAttacks(m: MoonLord) {
    const ctx = this.ctx;
    const line = rayLine(m, { width: this.width, height: this.height });
    if (line && m.ray) {
      ctx.save();
      ctx.lineCap = "round";
      if (m.ray.warn > 0) {
        ctx.globalAlpha = 0.45 + 0.4 * Math.sin(m.t * 40);
        ctx.strokeStyle = "#ff5a7a";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(line.from.x, line.from.y);
        ctx.lineTo(line.to.x, line.to.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        for (const [k, c, a] of [[1.8, "#5affd0", 0.25], [1, "#9ffff0", 0.85], [0.4, "#ffffff", 1]] as const) {
          ctx.globalAlpha = a;
          ctx.strokeStyle = c;
          ctx.lineWidth = line.width * k * (0.9 + 0.1 * Math.sin(m.t * 30));
          ctx.beginPath();
          ctx.moveTo(line.from.x, line.from.y);
          ctx.lineTo(line.to.x, line.to.y);
          ctx.stroke();
        }
      }
      ctx.restore();
      const pad = line.width * 2;
      this.mark(Math.min(line.from.x, line.to.x) - pad, Math.min(line.from.y, line.to.y) - pad, Math.abs(line.to.x - line.from.x) + pad * 2, Math.abs(line.to.y - line.from.y) + pad * 2);
    }
    for (const shot of m.shots) {
      ctx.save();
      ctx.translate(shot.x, shot.y);
      const ang = Math.atan2(shot.vy, shot.vx);
      if (shot.kind === "bolt") {
        ctx.rotate(ang);
        ctx.fillStyle = "rgba(127,255,224,0.5)";
        ctx.fillRect(-shot.r * 4, -shot.r * 0.6, shot.r * 4, shot.r * 1.2);
        ctx.fillStyle = "#9ffff0";
        ctx.beginPath();
        ctx.moveTo(shot.r * 1.6, 0);
        ctx.lineTo(0, shot.r * 0.8);
        ctx.lineTo(-shot.r, 0);
        ctx.lineTo(0, -shot.r * 0.8);
        ctx.fill();
      } else if (shot.kind === "sphere") {
        const pulse = 1 + 0.15 * Math.sin(shot.age * 12);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, shot.r * 1.8 * pulse);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.4, "#b48aff");
        g.addColorStop(1, "rgba(127,255,224,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-shot.r * 2, -shot.r * 2, shot.r * 4, shot.r * 4);
        if (shot.delay !== undefined && shot.delay > 0) {
          // Hanging: a ring warns it's about to rush in.
          ctx.strokeStyle = "rgba(255,90,122,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, shot.r * (1.4 + shot.delay), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.rotate(ang);
        ctx.fillStyle = "rgba(90,255,200,0.4)";
        ctx.fillRect(-shot.r * 3, -shot.r * 0.4, shot.r * 2.4, shot.r * 0.8);
        ctx.fillStyle = "#dafff5";
        ctx.beginPath();
        ctx.arc(0, 0, shot.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1fc79d";
        ctx.beginPath();
        ctx.arc(shot.r * 0.35, 0, shot.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#06231d";
        ctx.beginPath();
        ctx.arc(shot.r * 0.45, 0, shot.r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      const r = shot.r * 5;
      this.mark(shot.x - r, shot.y - r, r * 2, r * 2);
    }
  }

  private drawServants(state: CombatState) {
    const b = state.boss;
    if (!b) return;
    const ctx = this.ctx;
    const s = b.scale;
    const tex = getTexture("Images/NPC_5");
    for (const { s: sv } of state.servants) {
      ctx.save();
      ctx.translate(sv.x, sv.y);
      ctx.rotate(Math.atan2(sv.vy, sv.vx) - Math.PI / 2);
      if (tex) {
        const sy = servantFrame(sv) * SERVANT_FRAME_H;
        ctx.drawImage(tex, 0, sy, SERVANT_FRAME_W, SERVANT_FRAME_H, (-SERVANT_FRAME_W / 2) * s, (-SERVANT_FRAME_H / 2) * s, SERVANT_FRAME_W * s, SERVANT_FRAME_H * s);
      } else {
        ctx.fillStyle = "#e8dcd0";
        ctx.beginPath();
        ctx.arc(0, 0, 9 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#b02a2a";
        ctx.fillRect(-3 * s, 3 * s, 6 * s, 5 * s);
      }
      ctx.restore();
      const r = SERVANT_FRAME_H * s;
      this.mark(sv.x - r, sv.y - r, r * 2, r * 2);
    }
  }

  /** Terraria's boss health bar (bottom centre), from UI_BossBar with the Eye's head icon. */
  private drawBossBar(boss: { hp: number; maxHp: number; name?: string }) {
    const ctx = this.ctx;
    const tex = getTexture("Images/UI/UI_BossBar");
    const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    const w = Math.min(BAR.w, this.width - 32);
    const k = w / BAR.w;
    const x = Math.round((this.width - w) / 2);
    const y = Math.round(this.height - BAR.layer * k - 70);
    if (tex) {
      const lay = (i: number) => i * BAR.layer;
      // Background track, fill (a 2 px strip stretched), then the frame on top.
      ctx.drawImage(tex, BAR.fillX, lay(3) + BAR.fillY, BAR.fillW, BAR.fillH, x + BAR.fillX * k, y + BAR.fillY * k, BAR.fillW * k, BAR.fillH * k);
      ctx.drawImage(tex, BAR.fillX, lay(1) + BAR.fillY, 2, BAR.fillH, x + BAR.fillX * k, y + BAR.fillY * k, BAR.fillW * k * frac, BAR.fillH * k);
      ctx.drawImage(tex, 0, 0, BAR.w, BAR.layer, x, y, BAR.w * k, BAR.layer * k);
      const head = boss.name === "Queen Bee" ? (getTexture("addon/queenbee/Images/NPC_Head_Boss_14") ?? getTexture("Images/NPC_Head_Boss_14")) : boss.name ? undefined : getTexture("Images/NPC_Head_Boss_0");
      if (head) ctx.drawImage(head, x + BAR.headX * k - head.width / 2, y + BAR.headY * k - head.height / 2);
    } else {
      ctx.fillStyle = "rgba(20,14,30,0.85)";
      ctx.fillRect(x + BAR.fillX * k - 2, y + BAR.fillY * k - 2, BAR.fillW * k + 4, BAR.fillH * k + 4);
      ctx.fillStyle = "#d83b3b";
      ctx.fillRect(x + BAR.fillX * k, y + BAR.fillY * k, BAR.fillW * k * frac, BAR.fillH * k);
    }
    if (boss.name) outlinedText(ctx, boss.name, x + (BAR.fillX + BAR.fillW / 2) * k, y - 4, 14, "#ffffff", "center");
    outlinedText(ctx, `${Math.ceil(boss.hp)}/${boss.maxHp}`, x + (BAR.fillX + BAR.fillW / 2) * k, y + (BAR.fillY + BAR.fillH / 2) * k, 14, "#ffffff", "center");
    this.mark(x, y - 20, BAR.w * k, BAR.layer * k + 20);
  }

  /** Life hearts and mana stars, top-right like Terraria's HUD. */
  private drawHearts(state: CombatState) {
    const ctx = this.ctx;
    const p = state.player;
    const perHeart = p.maxHp / 20;
    const heart = getTexture(p.maxHp > 400 ? "Images/Heart2" : "Images/Heart");
    const star = getTexture("Images/Mana");
    const left = this.width - 340;
    const top = 26;
    outlinedText(ctx, `Life: ${Math.ceil(p.hp)}/${p.maxHp}`, left + 130, top - 10, 14, "#ffffff", "center");
    for (let i = 0; i < 20; i++) {
      const fill = Math.max(0, Math.min(1, (p.hp - i * perHeart) / perHeart));
      const cx = left + (i % 10) * 26 + 11;
      const cy = top + Math.floor(i / 10) * 26 + 11;
      // Terraria shrinks and fades partially-filled hearts.
      const size = 22 * (fill > 0 ? 0.6 + 0.4 * fill : 0.6);
      ctx.globalAlpha = fill > 0 ? 0.35 + 0.65 * fill : 0.25;
      if (heart) ctx.drawImage(heart, cx - size / 2, cy - size / 2, size, size);
      else {
        ctx.fillStyle = "#e33";
        ctx.fillRect(cx - size / 3, cy - size / 3, (size * 2) / 3, (size * 2) / 3);
      }
    }
    ctx.globalAlpha = 1;
    const manaX = this.width - 54;
    outlinedText(ctx, "Mana", manaX + 11, top - 10, 14, "#ffffff", "center");
    const cap = maxMana(state);
    for (let i = 0; i < 5; i++) {
      const fill = Math.max(0, Math.min(1, (state.mana - i * 20) / 20));
      const size = 22 * (0.6 + 0.4 * fill);
      ctx.globalAlpha = (i + 1) * 20 > cap + 0.01 ? 0.2 : 0.35 + 0.65 * fill;
      const cy = top + i * 26 + 12;
      if (star) ctx.drawImage(star, manaX + 11 - size / 2, cy - size / 2, size, (size * 24) / 22);
      else {
        ctx.fillStyle = "#4f8dff";
        ctx.fillRect(manaX + 11 - size / 3, cy - size / 3, (size * 2) / 3, (size * 2) / 3);
      }
    }
    ctx.globalAlpha = 1;
    if (p.dead) outlinedText(ctx, `Respawning in ${Math.ceil(p.respawn)}…`, this.width / 2, this.height / 2, 22, "#e64b4b", "center");
    this.mark(left - 20, top - 30, 360, 170);
    if (p.dead) this.mark(this.width / 2 - 200, this.height / 2 - 20, 400, 40);
  }

  private drawMessages() {
    const now = performance.now() / 1000;
    this.messages = this.messages.filter((m) => now - m.born < MESSAGE_LIFE);
    const ctx = this.ctx;
    const base = this.height - 40;
    this.messages.forEach((m, i) => {
      const age = now - m.born;
      ctx.globalAlpha = age > MESSAGE_LIFE - 1 ? MESSAGE_LIFE - age : 1;
      const y = base - (this.messages.length - 1 - i) * 22;
      outlinedText(ctx, m.text, 16, y, 16, m.color, "left");
      this.mark(10, y - 14, 620, 28);
    });
    ctx.globalAlpha = 1;
  }

  /** Pickaxe impact: a quick white burst (bigger, with a crack star, when it hits the pointer). */
  private drawImpact(i: Impact) {
    const ctx = this.ctx;
    // Square dust thrown up by the strike (falls and fades).
    for (const d of strikeDust(i)) {
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.size, d.size);
      this.mark(d.x - 1, d.y - 1, d.size + 2, d.size + 2);
    }
    ctx.globalAlpha = 1;
    if (i.t >= IMPACT_DURATION) return;
    const f = Math.min(1, i.t / IMPACT_DURATION);
    const r = (i.eligible ? 22 : 12) * (0.4 + f) * (1 + 0.45 * (i.power - 1));
    ctx.save();
    ctx.globalAlpha = 1 - f;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(i.x, i.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = i.eligible ? "#ffe9a8" : "#d8d0c0";
    ctx.lineWidth = 2;
    const rays = i.eligible ? 8 : 5;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(i.x + Math.cos(a) * r * 0.5, i.y + Math.sin(a) * r * 0.5);
      ctx.lineTo(i.x + Math.cos(a) * r * 1.4, i.y + Math.sin(a) * r * 1.4);
      ctx.stroke();
    }
    ctx.restore();
    const m = r * 1.5 + 4;
    this.mark(i.x - m, i.y - m, m * 2, m * 2);
  }

  /** Napping: little "z"s drifting up from the head. */
  private drawZzz(state: CombatState, player: PlayerInfo) {
    const ctx = this.ctx;
    const x0 = player.x + player.w * (player.facing > 0 ? 0.8 : 0.2);
    const y0 = player.y + 4;
    ctx.save();
    for (let k = 0; k < 3; k++) {
      const phase = (state.time * 0.45 + k / 3) % 1;
      const size = 10 + phase * 8;
      ctx.globalAlpha = Math.sin(phase * Math.PI);
      outlinedText(ctx, "z", x0 + phase * 18 * player.facing, y0 - phase * 34, size, "#ffffff", "center");
    }
    ctx.restore();
    this.mark(x0 - 30, y0 - 50, 60, 56);
  }

  /** Control-mode flight: a small trail of sparkles under the feet. */
  private drawFlight(state: CombatState, player: PlayerInfo) {
    const ctx = this.ctx;
    const fx = player.x + player.w / 2;
    const fy = player.y + player.h;
    ctx.save();
    for (let k = 0; k < 6; k++) {
      const phase = (state.time * 3 + k / 6) % 1;
      const x = fx + Math.sin(k * 2.1 + state.time * 9) * player.w * 0.4;
      const y = fy + phase * 26;
      ctx.globalAlpha = 1 - phase;
      ctx.fillStyle = k % 2 ? "#8fe3ff" : "#ffffff";
      ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
    }
    ctx.restore();
    this.mark(fx - player.w, fy - 4, player.w * 2, 36);
  }

  /** The letter-smash effect: intact word, cracks, flying pixels, reassembly. */
  private drawLetters(e: LetterEffect) {
    const ctx = this.ctx;
    const c = e.cell;
    let alpha = 1;
    if (e.phase === "appear") alpha = e.t / TIMELINE.appear;
    if (e.phase === "fade") alpha = 1 - e.t / TIMELINE.fade;
    const shake = e.phase === "crack" ? Math.sin(e.t * 90) * 1.5 : 0;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    let minX = e.x, minY = e.y, maxX = e.x + e.w, maxY = e.y + e.h;
    for (const p of e.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x + shake), Math.round(p.y), c, c);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (e.phase === "crack") {
      const f = Math.min(1, e.t / (TIMELINE.crack * 0.8));
      ctx.strokeStyle = "rgba(20,10,4,0.95)";
      ctx.lineWidth = 2;
      for (const line of crackLines(e)) {
        ctx.beginPath();
        const n = Math.max(1, Math.ceil(f * (line.length - 1)));
        ctx.moveTo(e.x + line[0].x + shake, e.y + line[0].y);
        for (let i = 1; i <= n; i++) ctx.lineTo(e.x + line[i].x + shake, e.y + line[i].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.mark(minX - 4, minY - 4, maxX - minX + c + 8, maxY - minY + c + 8);
  }

  private drawProjectile(p: CombatState["projectiles"][number], player: PlayerInfo) {
    const ctx = this.ctx;
    const scale = player.scale;
    const k = Math.max(1, scale / 3) * 2;
    const angle = Math.atan2(p.vy, p.vx);
    if (p.art) {
      const tex = getTexture(p.art.texture);
      const def = getWeapon(p.weaponId);
      if (tex && def) {
        const ws = weaponScale(def, player);
        const frames = p.art.frames ?? 1;
        const fh = tex.height / frames;
        const frame = Math.floor((p.id + (3 - p.ttl) * 12) % frames);
        const drawAt = (x: number, y: number, a: number, alpha: number) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(x, y);
          ctx.rotate(a + p.art!.rotation);
          ctx.drawImage(tex, 0, frame * fh, tex.width, fh, (-tex.width * ws) / 2, (-fh * ws) / 2, tex.width * ws, fh * ws);
          ctx.restore();
        };
        if (p.path) {
          // Zenith afterimages trailing along the flight path.
          const f = p.path.t / p.path.duration;
          for (let i = 3; i >= 1; i--) {
            const q = fractalPoint(p.path, f - i * 0.035);
            const q2 = fractalPoint(p.path, f - i * 0.035 + 0.01);
            drawAt(q.x, q.y, Math.atan2(q2.y - q.y, q2.x - q.x), 0.15 * (4 - i));
          }
        }
        drawAt(p.x, p.y, angle, 1);
        const r = Math.max(tex.width, fh) * ws + (p.path ? 120 : 0);
        this.mark(p.x - r, p.y - r, r * 2, r * 2);
        return;
      }
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.kind === "arrow") {
      ctx.rotate(angle);
      ctx.fillStyle = "#c9a46a";
      ctx.fillRect(-8 * k, -0.5 * k, 9 * k, k);
      ctx.fillStyle = "#dfe7ee";
      ctx.fillRect(0, -1.5 * k, 3 * k, 3 * k);
      ctx.fillStyle = "#e05a5a";
      ctx.fillRect(-9 * k, -1.5 * k, 2 * k, 3 * k);
    } else if (p.kind === "bullet" && p.explosive) {
      // Firework rocket: coloured body with a sparkling exhaust.
      ctx.rotate(angle);
      ctx.fillStyle = hexAlpha("#ffd24a", 0.6);
      for (let i = 1; i <= 4; i++) {
        const jitter = Math.sin(p.id * 7 + i * 3 + p.ttl * 30) * 1.5 * k;
        ctx.fillRect(-(3 + i * 3) * k, jitter - 0.5 * k, k, k);
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(-3 * k, -k, 6 * k, 2 * k);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(3 * k, -0.5 * k, k, k);
    } else if (p.kind === "bullet") {
      ctx.rotate(angle);
      const trail = ctx.createLinearGradient(-14 * k, 0, 0, 0);
      trail.addColorStop(0, "rgba(255,233,160,0)");
      trail.addColorStop(1, "rgba(255,233,160,0.8)");
      ctx.fillStyle = trail;
      ctx.fillRect(-14 * k, -0.5 * k, 14 * k, k);
      ctx.fillStyle = p.color;
      ctx.fillRect(-2 * k, -0.75 * k, 3 * k, 1.5 * k);
    } else {
      const r = p.radius * k * 0.8;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.35, hexAlpha(p.color, 0.85));
      g.addColorStop(1, hexAlpha(p.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-r * 2.4, -r * 2.4, r * 4.8, r * 4.8);
      // Trailing sparkles behind the bolt.
      ctx.fillStyle = hexAlpha(p.color, 0.7);
      for (let i = 1; i <= 3; i++) {
        const back = (i * 7 * k) / Math.max(1, Math.hypot(p.vx, p.vy));
        const jitter = Math.sin(p.id * 13 + i * 5 + p.ttl * 20) * 3 * k;
        ctx.fillRect(-p.vx * back - k, -p.vy * back + jitter - k, 2 * k, 2 * k);
      }
    }
    ctx.restore();
    const r = 24 * k;
    this.mark(p.x - r, p.y - r, r * 2, r * 2);
  }

  private drawEffect(e: CombatState["effects"][number]) {
    const ctx = this.ctx;
    const f = e.t / e.duration;
    const alpha = 1 - f;
    ctx.save();
    ctx.translate(e.x, e.y);
    switch (e.kind) {
      case "muzzle": {
        ctx.rotate(e.angle);
        ctx.fillStyle = hexAlpha(e.color, alpha);
        const r = e.size * (0.6 + 0.4 * (1 - f));
        ctx.beginPath();
        ctx.moveTo(r * 1.6, 0);
        ctx.lineTo(r * 0.3, r * 0.4);
        ctx.lineTo(0, r * 0.9);
        ctx.lineTo(-r * 0.2, 0);
        ctx.lineTo(0, -r * 0.9);
        ctx.lineTo(r * 0.3, -r * 0.4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "spark": {
        ctx.fillStyle = hexAlpha(e.color, alpha);
        for (let i = 0; i < 5; i++) {
          const a = e.id * 1.7 + i * 1.256;
          const d = e.size * (0.5 + 2.5 * f);
          ctx.fillRect(Math.cos(a) * d - 1.5, Math.sin(a) * d - 1.5, 3, 3);
        }
        break;
      }
      case "puff":
      case "cast": {
        ctx.strokeStyle = hexAlpha(e.color, alpha * 0.9);
        ctx.lineWidth = e.kind === "cast" ? 3 : 4;
        ctx.beginPath();
        ctx.arc(0, 0, e.size * (0.4 + f), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
    const r = e.size * 2 + 8;
    this.mark(e.x - r, e.y - r, r * 2, r * 2);
  }

  private drawText(t: CombatState["texts"][number]) {
    const ctx = this.ctx;
    const f = t.t / t.duration;
    const y = t.y - 36 * f - (t.crit ? 6 * Math.sin(f * Math.PI) : 0);
    const alpha = f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4;
    const size = t.crit ? 20 : 15;
    ctx.save();
    ctx.font = `800 ${size}px ui-rounded, "SF Pro Rounded", -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(20,14,30,${alpha * 0.9})`;
    ctx.strokeText(t.text, t.x, y);
    ctx.fillStyle = hexAlpha(t.color, alpha);
    ctx.fillText(t.text, t.x, y);
    ctx.restore();
    const w = size * Math.max(3, t.text.length) * 0.7;
    this.mark(t.x - w / 2, y - size - 4, w, size + 8);
  }

  private drawManaBar(state: CombatState, player: PlayerInfo) {
    const cap = maxMana(state);
    if (state.mana >= cap - 0.01 && state.minions.length === 0) return;
    const ctx = this.ctx;
    const w = player.w * 0.8;
    const h = Math.max(3, player.scale);
    const x = player.x + (player.w - w) / 2;
    const y = player.y - h - 6;
    ctx.fillStyle = "rgba(20,14,30,0.8)";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#4f8dff";
    ctx.fillRect(x, y, (w * state.mana) / BASE_MANA, h);
    // Mana reserved by minion upkeep.
    const reserved = (w * (BASE_MANA - cap)) / BASE_MANA;
    if (reserved > 0) {
      ctx.fillStyle = "rgba(160,120,220,0.7)";
      ctx.fillRect(x + w - reserved, y, reserved, h);
    }
    this.mark(x - 1, y - 1, w + 2, h + 2);
  }
}

function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign,
) {
  ctx.save();
  ctx.font = `800 ${size}px "Andy", ui-rounded, "SF Pro Rounded", -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(10,8,14,0.95)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Silksong Controls runtime: turns key/mouse input into movement (movement.ts) and attacks,
// applies hits through the combat sim, bounces on pogo strikes (down, diagonal, dive), reports
// Letter Destroyer strikes at the pointer, and produces the frame + visuals to draw. The attack
// button uses the equipped item: the Needle's directional strikes, the Thread's silk spin, or any
// Terraria weapon (through `SilkWeapon.use`, so its timing and effects stay the sim's).

import type { Vec } from "../combat/geometry";
import { meleeStrike, type CombatState } from "../combat/sim";
import { NEEDLE_DEF, type WeaponDef } from "../combat/weapons";
import type { Body, Dir } from "../engine/physics";
import { isBlockId } from "../engine/blocks";
import { pushTrail, silkFrame, type SilkFrame } from "./anim";
import { DEFAULT_SILK_KEYS, actionFor, normalizeKeys, type SilkAction, type SilkKeys } from "./keys";
import { initialSilk, noSilkInput, silkStep, type SilkState, type SilkWorld } from "./movement";
import {
  strikeKind,
  DIVE_SPEED,
  POGO_CARRY,
  POGO_COOLDOWN,
  LUNGE_SPEED,
  MAX_SILK,
  NEEDLE,
  POGO_VELOCITY,
  chargeLevel,
  destroyerPower,
  gainSilk,
  initialNeedle,
  isActive,
  isPogo,
  landDive,
  needleHitbox,
  pogoSurface,
  startStrike,
  needleStep,
  rectContains,
  type NeedleState,
} from "./needle";
import type { SilkVisual } from "./render";

type Edge = "jump" | "dash" | "attack" | "thread" | "grapple" | "dive";

/**
 * The equipped item, as Silksong Controls sees it. `def` is the weapon (undefined = bare hands:
 * the Needle). `use` fires a Terraria weapon through the combat sim toward `aim` (radians, screen
 * space) or `point`; it returns true when the weapon was used (it respects the weapon's cooldown).
 */
export interface SilkWeapon {
  def: WeaponDef | undefined;
  use: (dir: Dir, aim: number, point: Vec | null) => boolean;
}

/** How the attack button behaves for an item. */
export function attackMode(def: WeaponDef | undefined): "needle" | "thread" | "melee" | "ranged" {
  if (!def || def.silk === "needle") return "needle";
  if (def.silk === "thread") return "thread";
  return def.kind === "sword" && !def.fractal ? "melee" : "ranged";
}

/** Aim angle for a Terraria weapon from held directions (null = aim at the cursor / straight ahead). */
export function heldAim(up: boolean, down: boolean, sideways: boolean, grounded: boolean, dir: Dir): number | null {
  const fwd = dir > 0 ? 0 : Math.PI;
  if (up) return sideways ? (dir > 0 ? -Math.PI / 4 : (-3 * Math.PI) / 4) : -Math.PI / 2;
  if (down && !grounded) return sideways ? (dir > 0 ? Math.PI / 4 : (3 * Math.PI) / 4) : Math.PI / 2;
  return sideways ? fwd : null;
}

export interface SilkStepOut {
  body: Body;
  frame: SilkFrame;
  visual: SilkVisual;
  /** Letter Destroyer strikes at the pointer (screen-overlay coordinates). */
  strikes: { x: number; y: number; power: number }[];
  sfx: ("swing" | "throw" | "grab" | "pickaxeHit")[];
}

const SPIN_TICK = 0.15;
const POINTER_SLACK = 18;

export class SilkController {
  move: SilkState = initialSilk();
  needle: NeedleState = initialNeedle();
  keys: SilkKeys = DEFAULT_SILK_KEYS;
  private held: Record<SilkAction, boolean> = { left: false, right: false, up: false, down: false, jump: false, dash: false, attack: false, thread: false, grapple: false, dive: false };
  private edges = new Set<Edge>();
  private mouseHeld = false;
  private trail: Vec[] = [];
  private miss: { toward: Vec; t: number } | null = null;
  private lastSpinTick = 0;
  private walkDistance = 0;
  private pogoCd = 0;
  /** The mouse (not a key) started the current attack: aim Terraria weapons at the cursor. */
  private mouseAim = false;
  /** Damage/reach of the current strike when a Terraria sword makes it (pogo with a sword). */
  private strikeDef: WeaponDef | null = null;

  setKeys(k: Partial<SilkKeys> | null | undefined) {
    this.keys = normalizeKeys(k);
  }

  /** Back to a clean state (leaving Control mode, switching schemes). */
  reset() {
    this.move = initialSilk();
    this.needle = { ...initialNeedle(), silk: this.needle.silk };
    for (const a of Object.keys(this.held) as SilkAction[]) this.held[a] = false;
    this.edges.clear();
    this.mouseHeld = false;
    this.trail = [];
    this.miss = null;
    this.pogoCd = 0;
    this.strikeDef = null;
  }

  /** A key went down; returns true if it's a Silksong control (so the page shouldn't react). */
  keyDown(code: string): boolean {
    const a = actionFor(code, this.keys);
    if (!a) return false;
    if (!this.held[a] && (a === "jump" || a === "dash" || a === "attack" || a === "thread" || a === "grapple" || a === "dive")) this.edges.add(a);
    if (a === "attack") this.mouseAim = false;
    this.held[a] = true;
    return true;
  }

  keyUp(code: string): boolean {
    const a = actionFor(code, this.keys);
    if (!a) return false;
    this.held[a] = false;
    return true;
  }

  /** Left mouse button: the Needle (hold to charge). */
  mouse(down: boolean) {
    if (down && !this.mouseHeld) this.edges.add("attack");
    if (down) this.mouseAim = true;
    this.mouseHeld = down;
  }

  step(
    dt: number,
    body: Body,
    world: SilkWorld,
    combat: CombatState,
    scale: number,
    rigScale: number,
    cursor: Vec | null,
    hand: (b: Body, dir: Dir) => Vec,
    weapon: SilkWeapon = { def: undefined, use: () => false },
  ): SilkStepOut {
    const sfx: SilkStepOut["sfx"] = [];
    const strikes: SilkStepOut["strikes"] = [];
    const take = (e: Edge) => {
      const had = this.edges.has(e);
      this.edges.delete(e);
      return had;
    };
    const h = this.held;
    this.pogoCd = Math.max(0, this.pogoCd - dt);
    const mode = attackMode(weapon.def);
    const sideways = h.left !== h.right;
    // Dive: its own key, or Dash while holding down in the air (the dash is used up by the dive).
    let dashPressed = take("dash");
    let divePressed = take("dive");
    if (dashPressed && h.down && !body.grounded) {
      dashPressed = false;
      divePressed = true;
    }
    const canDive = divePressed && !body.grounded && !this.needle.attack && this.move.airDashes > 0 && !this.move.grapple;
    if (canDive) this.move = { ...this.move, airDashes: this.move.airDashes - 1 };
    // Down + Jump on a window top or invisible line drops through it (placed blocks are solid).
    let jumpPressed = take("jump");
    if (jumpPressed && h.down && body.grounded && body.platformId !== null && !isBlockId(body.platformId)) {
      jumpPressed = false;
      body = { ...body, grounded: false, platformId: null, y: body.y + 2 };
    }
    const diving = this.needle.attack?.kind === "dive" && !body.grounded;
    const diveDir = this.needle.attack?.dir ?? body.facing;
    const inp = {
      ...noSilkInput(),
      left: h.left,
      right: h.right,
      up: h.up,
      down: h.down,
      jumpHeld: h.jump,
      jumpPressed,
      dashPressed,
      grapplePressed: take("grapple"),
      aim: cursor,
      force: diving ? { vx: diveDir * DIVE_SPEED * Math.SQRT1_2, vy: DIVE_SPEED * Math.SQRT1_2 } : null,
    };
    let attackPressed = take("attack");
    let threadPressed = take("thread");
    const r = silkStep(this.move, body, inp, dt, world);
    this.move = r.state;
    let b = r.body;
    for (const e of r.events) {
      if (e.type === "dash") sfx.push("throw");
      if (e.type === "grapple") sfx.push("grab");
      if (e.type === "grappleMiss") {
        this.miss = { toward: e.toward, t: 0 };
        sfx.push("swing");
      }
    }
    if (this.miss) {
      this.miss.t += dt;
      if (this.miss.t > 0.3) this.miss = null;
    }

    // The dive ends in a landing slam (or stops if it never started falling).
    if (this.needle.attack?.kind === "dive" && b.grounded) {
      this.needle = landDive(this.needle);
      sfx.push("pickaxeHit");
    }

    // Attacks: the equipped item decides what the attack button does.
    const dirHeld = (h.right ? 1 : 0) - (h.left ? 1 : 0);
    const facing: Dir = dirHeld !== 0 ? (dirHeld as Dir) : b.facing;
    const attackHeld = h.attack || this.mouseHeld;
    if (mode === "thread" && attackPressed) {
      // The Thread spins silk; with too little silk it casts through the sim (mana) instead.
      if (this.needle.silk >= 3 || this.needle.attack) threadPressed = true;
      else weapon.use(facing, facing > 0 ? 0 : Math.PI, null);
      attackPressed = false;
    }
    if ((mode === "melee" || mode === "ranged") && !this.needle.attack && (attackPressed || attackHeld) && !canDive) {
      // Terraria weapons: pogo strikes for swords in the air, otherwise the weapon's own use.
      const kind = strikeKind({ up: h.up, down: h.down, grounded: b.grounded, sideways });
      if (mode === "melee" && (kind === "down" || kind === "diag") && attackPressed && this.needle.cd <= 0) {
        this.needle = startStrike(this.needle, kind, facing);
        this.strikeDef = weapon.def ?? null;
        sfx.push("swing");
      } else {
        const aim = heldAim(h.up, h.down, sideways, b.grounded, facing);
        const point = aim === null && this.mouseAim && cursor ? cursor : null;
        const c = { x: b.x + b.w / 2, y: b.y + b.h * 0.45 };
        const pointDir: Dir = point ? (point.x < c.x ? -1 : 1) : facing;
        const angle = aim ?? (point ? Math.atan2(point.y - c.y, point.x - c.x) : facing > 0 ? 0 : Math.PI);
        weapon.use(pointDir, angle, point);
      }
      attackPressed = false;
    }
    const needleOwnsAttack = mode === "needle";
    const ns = needleStep(
      this.needle,
      {
        attackHeld: needleOwnsAttack && attackHeld,
        attackPressed: needleOwnsAttack && attackPressed,
        threadPressed,
        divePressed: canDive,
        up: h.up,
        down: h.down,
        sideways,
        grounded: b.grounded,
        facing,
      },
      dt,
    );
    this.needle = ns.state;
    if (ns.started) {
      sfx.push(ns.started === "dive" ? "throw" : "swing");
      if (ns.started === "spin") this.lastSpinTick = 0;
      // Swords keep their damage and reach for the dive; everything else dives with the Needle.
      this.strikeDef = ns.started === "dive" && mode === "melee" ? (weapon.def ?? null) : null;
    }
    if (!this.needle.attack) this.strikeDef = null;
    const a = this.needle.attack;
    if (a) {
      b = { ...b, facing: a.dir }; // facing stays with the strike
      if (a.kind === "charged" && isActive(a)) b = { ...b, vx: a.dir * LUNGE_SPEED };
      if (isActive(a)) {
        if (a.kind === "spin" && a.t - this.lastSpinTick >= SPIN_TICK) {
          a.hitIds = [];
          this.lastSpinTick = a.t;
        }
        const sword = this.strikeDef?.kind === "sword" ? this.strikeDef : null;
        const reachMul = sword && (a.kind === "down" || a.kind === "diag") ? Math.max(1, sword.reach / 26) : 1;
        const rect = needleHitbox(a, b, scale, reachMul);
        const damage = sword ? Math.max(NEEDLE[a.kind].damage, sword.damage) : NEEDLE[a.kind].damage;
        const ids = meleeStrike(combat, { ...(sword ?? NEEDLE_DEF), damage }, rect, a.dir, a.hitIds);
        let bounce = ids.length > 0;
        if (ids.length) {
          a.hitIds.push(...ids);
          this.needle = gainSilk(this.needle, ids.length);
          sfx.push("pickaxeHit");
        }
        // Letter Destroyer: a strike that lands on the pointer smashes the page there.
        const slack = { x: rect.x - POINTER_SLACK, y: rect.y - POINTER_SLACK, w: rect.w + POINTER_SLACK * 2, h: rect.h + POINTER_SLACK * 2 };
        if (!a.struckPointer && cursor && rectContains(slack, cursor.x, cursor.y)) {
          a.struckPointer = true;
          strikes.push({ x: cursor.x, y: cursor.y, power: destroyerPower(a.kind) });
          bounce = true; // pogo off the page you smashed
        }
        // Pogo strikes also bounce off surfaces below (window tops, placed blocks).
        if (isPogo(a.kind) && a.kind !== "dive" && pogoSurface(rect, b, world.platforms) !== null) bounce = true;
        if (bounce && isPogo(a.kind) && !a.bounced && this.pogoCd <= 0) {
          // Bounce with air moves refreshed; once per strike, with a short cooldown so a single
          // contact can't chain bounces, and never while standing (so the floor can't trap you).
          a.bounced = true;
          this.pogoCd = POGO_COOLDOWN;
          const carry = a.kind === "down" ? b.vx : a.dir * Math.max(POGO_CARRY, Math.abs(b.vx));
          b = { ...b, vy: -POGO_VELOCITY, vx: carry, grounded: false, platformId: null };
          this.move = { ...this.move, doubleJumps: 1, airDashes: 1 };
          if (a.kind === "dive") this.needle = { ...this.needle, attack: null, cd: 0.15 };
          sfx.push("throw");
        }
      }
    }

    // Silk trail while moving fast or striking; it shrinks away otherwise.
    const hp = hand(b, b.facing);
    const trailing = this.move.dashT > 0 || this.move.glide || this.move.grapple !== null || (a !== null && isActive(a));
    this.trail = trailing ? pushTrail(this.trail, a?.kind === "spin" ? { x: b.x + b.w / 2, y: b.y + b.h * 0.45 } : hp) : this.trail.slice(1);
    if (b.grounded) this.walkDistance += Math.abs(b.vx) * dt;

    const live = this.needle.attack;
    const frame = silkFrame(this.move.anim, live, chargeLevel(this.needle), this.walkDistance, rigScale);
    const visual: SilkVisual = {
      hand: hp,
      dir: b.facing,
      scale,
      attack: live ? { kind: live.kind, p: Math.min(1, live.t / NEEDLE[live.kind].duration), t: live.t } : null,
      // Strikes made with a Terraria sword draw that sword instead of the Needle.
      weaponArt: live && this.strikeDef?.art ? { texture: this.strikeDef.art.texture, size: this.strikeDef.art.size, grip: this.strikeDef.art.grip, tip: this.strikeDef.art.tip } : null,
      feet: { x: b.x + b.w / 2, y: b.y + b.h },
      center: { x: b.x + b.w / 2, y: b.y + b.h * 0.45 },
      top: b.y,
      trail: this.trail,
      grapple: this.move.grapple ? { anchor: { x: this.move.grapple.x, y: this.move.grapple.y } } : null,
      miss: this.miss,
      charge: chargeLevel(this.needle),
      dashing: this.move.dashT > 0,
      silk: this.needle.silk,
      maxSilk: MAX_SILK,
    };
    return { body: b, frame, visual, strikes, sfx };
  }
}

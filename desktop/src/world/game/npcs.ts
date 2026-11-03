// Creature behaviours for the background-world game: slimes hop, walkers chase and jump walls,
// flyers swoop (some shoot), bats flutter, casters teleport and cast, worms burrow with their
// bodies following, plants lunge from their vines, swimmers stay in the water, antlions spit
// sand, critters wander and flee. Bosses have their own patterns: King Slime, the Eye of
// Cthulhu, the Eater of Worlds, the Queen Bee, Skeletron and the Wall of Flesh. Written for this
// game to feel like Terraria's (they aren't the game's code).

import { HELL_TOP } from "../gen";
import type { WorldMap } from "../gen";
import { NPCS, type NpcKind, type ShotKind } from "./npcData";
import { liquidAt, moveBox, solidIn, TILE, type Box } from "./physics";

export { NPCS, type NpcKind, type NpcDef, type Drop, type ShotKind } from "./npcData";

export interface Npc extends Box {
  kind: NpcKind;
  life: number;
  dir: -1 | 1;
  /** AI timers / state. */
  t: number;
  state: number;
  count: number;
  frame: number;
  rot: number;
  alpha: number;
  /** Seconds of hit flash / immunity per source. */
  hurt: number;
  phase2?: boolean;
  /** King Slime: how many tenths of his life he has shed slimes for. */
  shed?: number;
  /** Hit by this swing id already. */
  lastSwing: number;
  /** Worm segments: the one in front, and the head (which owns the life). Boss parts: their owner. */
  ahead?: Npc;
  head?: Npc;
  /** A worm head's segments, front to back. */
  segs?: Npc[];
  /** Anchor (plants' vine root, hands' resting spot). */
  ax?: number;
  ay?: number;
  shootT?: number;
  /** Boss part role ("handL", "handR", "eyeTop", "eyeBottom", "hungry"). */
  tag?: string;
}

export function makeNpc(kind: NpcKind, x: number, y: number): Npc {
  const d = NPCS[kind];
  return { kind, x: x - d.w / 2, y: y - d.h, w: d.w, h: d.h, vx: 0, vy: 0, onGround: false, life: d.life, dir: 1, t: 0, state: 0, count: 0, frame: 0, rot: 0, alpha: 1, hurt: 0, lastSwing: -1, shootT: 1 + Math.random() };
}

export interface AiWorld {
  map: WorldMap;
  /** The nearest target's box centre (the player, or the nearest waifu); null if none. */
  target: { x: number; y: number } | null;
  night: boolean;
  rnd: () => number;
  /** Spawn another NPC (slimes from King Slime, servants from the Eye, worm segments…). */
  spawn: (kind: NpcKind, x: number, y: number) => Npc;
  /** Number of a kind currently alive. */
  alive: (kind: NpcKind) => number;
  message: (text: string) => void;
  /** A hostile projectile from `from` toward an angle. */
  shoot: (from: Npc, kind: ShotKind, angle: number, speed: number, damage: number) => void;
  /** Underworld bounds and the world's middle (for the Wall of Flesh). */
  worldWidth: number;
}

const GRAVITY = 1440;
const MAX_FALL = 600;
export const cx = (n: Box) => n.x + n.w / 2;
export const cy = (n: Box) => n.y + n.h / 2;

/** The NPC whose life counts for this one (worm heads; a boss for its parts). */
export const ownerOf = (n: Npc): Npc => (n.head && n.head !== n ? n.head : n);

/** One step of an NPC's behaviour. Returns false when it should be removed (despawned / gone). */
export function stepNpc(n: Npc, w: AiWorld, dt: number): boolean {
  n.t += dt;
  n.hurt = Math.max(0, n.hurt - dt);
  const d = NPCS[n.kind];
  const target = w.target ?? { x: cx(n) + n.dir * 200, y: cy(n) };
  const toward: -1 | 1 = target.x < cx(n) ? -1 : 1;
  // Day / night creatures leave when their time is over.
  const outOfTime = (d.night && !w.night) || (d.day && w.night);
  // Shooters.
  if (d.shoot && w.target && n.alpha > 0.5) {
    n.shootT = (n.shootT ?? d.shoot.every) - dt;
    const dist = Math.hypot(target.x - cx(n), target.y - cy(n));
    if (n.shootT <= 0 && dist < 34 * TILE) {
      n.shootT = d.shoot.every * (0.8 + w.rnd() * 0.4);
      w.shoot(n, d.shoot.kind, Math.atan2(target.y - cy(n), target.x - cx(n)), d.shoot.speed, d.shoot.damage);
    }
  }
  switch (d.ai) {
    case "slime":
      return slime(n, w, dt, toward);
    case "fighter":
      return fighter(n, w, dt, toward, d.speed ?? 70, outOfTime);
    case "flyer":
      return flyer(n, w, dt, target, d.speed ?? 200, outOfTime);
    case "bat":
      return bat(n, w, dt, target, d.speed ?? 220);
    case "caster":
      return caster(n, w, dt, target);
    case "worm":
      return worm(n, w, dt, target, d.speed ?? 260, false);
    case "wormBody":
      return !!n.head && n.head.life > 0;
    case "plant":
      return plant(n, w, dt, target);
    case "swimmer":
      return swimmer(n, w, dt, target, d.speed ?? 200, false);
    case "antlion":
      moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL });
      n.dir = toward;
      n.frame = Math.floor(n.t * 6) % d.frames;
      return true;
    case "critter":
      return critter(n, w, dt, d.speed ?? 50, outOfTime);
    case "critterFly":
      return critterFly(n, w, dt, d.speed ?? 50, outOfTime);
    case "critterSwim":
      return swimmer(n, w, dt, target, d.speed ?? 60, true);
    case "boss":
      switch (n.kind) {
        case "kingSlime":
          return stepKingSlime(n, w, dt, toward);
        case "eye":
          return stepEye(n, w, dt, target);
        case "eaterHead":
          return worm(n, w, dt, target, 340, true);
        case "queenBee":
          return stepQueenBee(n, w, dt, target);
        case "skeletron":
          return stepSkeletron(n, w, dt, target);
        case "skeletronHand":
          return stepHand(n, w, dt, target);
        case "wallOfFlesh":
          return stepWall(n, w, dt, target);
        case "wallEye":
          return stepWallEye(n, w, dt, target);
        case "hungry":
          return stepHungry(n, w, dt, target);
      }
  }
  return true;
}

function slime(n: Npc, w: AiWorld, dt: number, toward: -1 | 1): boolean {
  moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL });
  if (n.onGround) {
    n.vx *= 0.8;
    n.frame = n.t % 0.5 < 0.25 ? 0 : 1;
    if (n.t > 1 + w.rnd() * 1.2) {
      n.t = 0;
      n.dir = toward;
      const big = w.rnd() < 0.3;
      n.vy = big ? -420 : -280;
      n.vx = toward * (big ? 110 : 150);
    }
  } else n.frame = Math.min(1, NPCS[n.kind].frames - 1);
  return true;
}

function fighter(n: Npc, w: AiWorld, dt: number, toward: -1 | 1, speed: number, outOfTime: boolean | undefined): boolean {
  n.dir = toward;
  n.vx += (toward * speed - n.vx) * Math.min(1, dt * 4);
  const r = moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL, stepUp: true });
  // Blocked by a wall: jump it.
  if (r.hitX && n.onGround) n.vy = -360;
  if (r.liquid && n.vy > -60) n.vy -= 600 * dt;
  const f = NPCS[n.kind].frames;
  n.frame = n.onGround ? (f > 2 ? 1 + (Math.floor(n.t * 8) % Math.max(1, f - 1)) : Math.floor(n.t * 6) % f) : 0;
  if (outOfTime && n.t > 2) return false; // zombies leave by day
  return true;
}

function flyer(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }, max: number, outOfTime: boolean | undefined): boolean {
  const ax = Math.sign(target.x - cx(n)) * max;
  const ay = Math.sign(target.y - cy(n)) * max * 0.9;
  n.vx = Math.max(-max, Math.min(max, n.vx + ax * dt));
  n.vy = Math.max(-max, Math.min(max, n.vy + ay * dt));
  const r = moveBox(w.map, n, dt, { gravity: 0, maxFall: MAX_FALL, fly: true });
  if (r.hitX) n.vx *= -0.8;
  if (r.hitY) n.vy *= -0.8;
  n.dir = n.vx < 0 ? -1 : 1;
  if (NPCS[n.kind].facesRight) n.rot = Math.atan2(n.vy, n.vx);
  n.frame = Math.floor(n.t * 8) % NPCS[n.kind].frames;
  if (outOfTime && n.t > 2) {
    // Flee at dawn.
    n.vy = -200;
    if (n.y < -200 || n.t > 20) return false;
  }
  return true;
}

function bat(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }, speed: number): boolean {
  if (n.t % 0.6 < dt) {
    n.vx = (target.x - cx(n)) * 0.8 + (w.rnd() - 0.5) * 300;
    n.vy = (target.y - cy(n)) * 0.8 + (w.rnd() - 0.5) * 300;
    const sp = Math.hypot(n.vx, n.vy);
    if (sp > speed) {
      n.vx *= speed / sp;
      n.vy *= speed / sp;
    }
  }
  const r = moveBox(w.map, n, dt, { gravity: 0, maxFall: MAX_FALL, fly: true });
  if (r.hitX) n.vx *= -1;
  if (r.hitY) n.vy *= -1;
  n.dir = n.vx < 0 ? -1 : 1;
  n.frame = Math.floor(n.t * 10) % NPCS[n.kind].frames;
  return true;
}

/** Casters stand and cast; every few seconds they teleport somewhere near their target. */
function caster(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL });
  n.vx *= 0.8;
  n.dir = target.x < cx(n) ? -1 : 1;
  n.frame = Math.floor(n.t * 4) % Math.min(3, NPCS[n.kind].frames);
  if (n.t > 5 && w.target) {
    n.t = 0;
    for (let k = 0; k < 20; k++) {
      const tx = Math.floor(target.x / TILE + (w.rnd() - 0.5) * 30);
      const ty0 = Math.floor(target.y / TILE);
      for (let dy = -8; dy <= 8; dy++) {
        const ty = ty0 + dy;
        if (!w.map.standable(tx, ty) && !w.map.standable(tx, ty - 1) && !w.map.standable(tx, ty - 2) && w.map.solid(tx, ty + 1)) {
          n.x = tx * TILE + 8 - n.w / 2;
          n.y = (ty + 1) * TILE - n.h;
          n.alpha = 0.2;
          return true;
        }
      }
    }
  }
  n.alpha = Math.min(1, n.alpha + dt * 2);
  return true;
}

/**
 * Worms: the head steers toward its target while it's in the ground (or always, for the Eater
 * of Worlds when it's angry), falls when it's out in the air, and drags its body along.
 */
function worm(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }, speed: number, boss: boolean): boolean {
  const d = NPCS[n.kind];
  // First step: grow the body.
  if (!n.count && d.worm) {
    n.count = 1;
    n.head = n;
    n.segs = [];
    let ahead = n;
    for (let i = 0; i < d.worm.length; i++) {
      const seg = w.spawn((i === d.worm.length - 1 ? d.worm.tail : d.worm.body) as NpcKind, cx(n), cy(n) + (i + 1) * 10);
      seg.head = n;
      seg.ahead = ahead;
      n.segs.push(seg);
      ahead = seg;
    }
  }
  const tx = Math.floor(cx(n) / TILE);
  const ty = Math.floor(cy(n) / TILE);
  const inGround = w.map.solid(tx, ty) || w.map.solid(tx, ty + 1) || w.map.wall(tx, ty) > 0 || ty > w.map.surface(tx) + 2;
  if (inGround || boss) {
    const a = Math.atan2(target.y - cy(n), target.x - cx(n));
    const turn = boss ? 2.6 : 2;
    n.vx += Math.cos(a) * speed * turn * dt;
    n.vy += Math.sin(a) * speed * turn * dt;
    const sp = Math.hypot(n.vx, n.vy);
    if (sp > speed) {
      n.vx *= speed / sp;
      n.vy *= speed / sp;
    }
  } else {
    n.vy = Math.min(MAX_FALL, n.vy + GRAVITY * 0.5 * dt);
  }
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  n.rot = Math.atan2(n.vy, n.vx) + Math.PI / 2;
  // Drag each segment to a fixed spacing behind the one in front.
  for (const seg of n.segs ?? []) {
    const f = seg.ahead!;
    const dx = cx(f) - cx(seg);
    const dy = cy(f) - cy(seg);
    const dist = Math.hypot(dx, dy) || 1;
    const gap = Math.max(f.w, seg.w) * 0.75;
    seg.x += (dx / dist) * (dist - gap);
    seg.y += (dy / dist) * (dist - gap);
    seg.rot = Math.atan2(dy, dx) + Math.PI / 2;
    seg.alpha = 1;
  }
  return true;
}

function plant(n: Npc, _w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  if (n.ax === undefined) {
    n.ax = cx(n);
    n.ay = cy(n);
  }
  const dx = target.x - n.ax;
  const dy = target.y - n.ay!;
  const dist = Math.hypot(dx, dy);
  const reach = 9 * TILE;
  const k = dist > 0 ? Math.min(1, reach / dist) : 0;
  const gx = n.ax + dx * (dist < 16 * TILE ? k : 0) - n.w / 2;
  const gy = n.ay! + dy * (dist < 16 * TILE ? k : 0) - n.h / 2;
  n.x += (gx - n.x) * Math.min(1, dt * 3);
  n.y += (gy - n.y) * Math.min(1, dt * 3);
  n.rot = Math.atan2(target.y - cy(n), target.x - cx(n)) + Math.PI / 2;
  n.frame = Math.floor(n.t * 5) % 2;
  return true;
}

function swimmer(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }, speed: number, critter: boolean): boolean {
  const inWater = liquidAt(w.map, n) !== 0;
  if (inWater) {
    const targetInWater = !critter && w.target && w.map.liquid(Math.floor(target.x / TILE), Math.floor(target.y / TILE)) !== 0;
    if (targetInWater) {
      const a = Math.atan2(target.y - cy(n), target.x - cx(n));
      n.vx += Math.cos(a) * speed * 2 * dt;
      n.vy += Math.sin(a) * speed * 2 * dt;
    } else {
      if (n.t % 2 < dt) n.dir = w.rnd() < 0.5 ? -1 : 1;
      n.vx += n.dir * speed * dt;
      n.vy += (w.rnd() - 0.5) * 60 * dt;
    }
    const sp = Math.hypot(n.vx, n.vy);
    if (sp > speed) {
      n.vx *= speed / sp;
      n.vy *= speed / sp;
    }
    // Don't leave the water upward.
    if (!w.map.liquid(Math.floor(cx(n) / TILE), Math.floor((n.y - 2) / TILE)) && n.vy < 0) n.vy = 20;
    const r = moveBox(w.map, n, dt, { gravity: 0, maxFall: MAX_FALL, fly: true });
    if (r.hitX) {
      n.vx *= -1;
      n.dir = n.dir < 0 ? 1 : -1;
    }
  } else {
    // Flopping on land.
    moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL });
    if (n.onGround && n.t % 0.8 < dt) {
      n.vy = -200;
      n.vx = (w.rnd() - 0.5) * 120;
    }
  }
  if (Math.abs(n.vx) > 5) n.dir = n.vx < 0 ? -1 : 1;
  n.frame = Math.floor(n.t * 8) % NPCS[n.kind].frames;
  return true;
}

function critter(n: Npc, w: AiWorld, dt: number, speed: number, outOfTime: boolean | undefined): boolean {
  // Wander: pick a direction now and then, sometimes stop; hop over bumps.
  if (n.t > n.count) {
    n.t = 0;
    n.count = 1 + w.rnd() * 3;
    n.state = w.rnd() < 0.4 ? 0 : 1;
    n.dir = w.rnd() < 0.5 ? -1 : 1;
  }
  // Flee from whoever is close.
  if (w.target && Math.abs(w.target.x - cx(n)) < 4 * TILE && Math.abs(w.target.y - cy(n)) < 3 * TILE) {
    n.state = 2;
    n.dir = w.target.x < cx(n) ? 1 : -1;
  }
  const want = n.state === 0 ? 0 : n.dir * speed * (n.state === 2 ? 1.6 : 1);
  n.vx += (want - n.vx) * Math.min(1, dt * 6);
  const r = moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL, stepUp: true });
  if (r.hitX && n.onGround) n.vy = -260;
  const f = NPCS[n.kind].frames;
  n.frame = Math.abs(n.vx) > 5 ? Math.floor(n.t * 10) % f : 0;
  return !(outOfTime && n.t > 1 && w.rnd() < dt * 0.2);
}

function critterFly(n: Npc, w: AiWorld, dt: number, speed: number, outOfTime: boolean | undefined): boolean {
  if (n.ax === undefined) {
    n.ax = cx(n);
    n.ay = cy(n) - 3 * TILE;
  }
  if (n.t > n.count) {
    n.t = 0;
    n.count = 0.6 + w.rnd() * 1.5;
    const a = w.rnd() * Math.PI * 2;
    n.vx = Math.cos(a) * speed;
    n.vy = Math.sin(a) * speed * 0.6;
    // Drift back toward home.
    n.vx += (n.ax - cx(n)) * 0.3;
    n.vy += (n.ay! - cy(n)) * 0.3;
  }
  const r = moveBox(w.map, n, dt, { gravity: 0, maxFall: MAX_FALL, fly: true });
  if (r.hitX) n.vx *= -1;
  if (r.hitY) n.vy *= -1;
  if (Math.abs(n.vx) > 2) n.dir = n.vx < 0 ? -1 : 1;
  n.frame = Math.floor(n.t * 10) % NPCS[n.kind].frames;
  return !(outOfTime && w.rnd() < dt * 0.3);
}

// ── Bosses ──────────────────────────────────────────────────────────────────────────────────

/** King Slime: big hops toward you, teleports every few jumps, sheds slimes as he's hurt. */
function stepKingSlime(n: Npc, w: AiWorld, dt: number, toward: -1 | 1): boolean {
  const d = NPCS.kingSlime;
  // He shrinks as he loses life.
  const scale = 0.6 + 0.4 * (n.life / d.life);
  const bottom = n.y + n.h;
  const center = cx(n);
  n.w = d.w * scale;
  n.h = d.h * scale;
  n.x = center - n.w / 2;
  n.y = bottom - n.h;
  const target = w.target;
  if (n.state === 1) {
    // Teleporting: fade out, move above the target, fade in.
    n.alpha = Math.max(0, n.alpha - dt * 2);
    if (n.alpha <= 0) {
      const t = target ?? { x: center, y: bottom };
      n.x = t.x - n.w / 2 + (w.rnd() - 0.5) * 200;
      n.y = t.y - 300;
      // Don't reappear inside rock.
      for (let i = 0; i < 40 && solidIn(w.map, n.x, n.y, n.w, n.h); i++) n.y -= TILE;
      n.vx = 0;
      n.vy = 0;
      n.state = 2;
    }
    return true;
  }
  if (n.state === 2) {
    n.alpha = Math.min(1, n.alpha + dt * 2);
    if (n.alpha >= 1) n.state = 0;
  }
  moveBox(w.map, n, dt, { gravity: GRAVITY, maxFall: MAX_FALL });
  if (n.onGround) {
    n.vx *= 0.85;
    n.frame = n.t % 0.4 < 0.2 ? 0 : 1;
    if (n.t > 0.9 + w.rnd() * 0.6) {
      n.t = 0;
      n.count++;
      if (n.count % 4 === 0 || (target && Math.abs(target.x - cx(n)) > 900)) {
        n.state = 1; // teleport
        return true;
      }
      n.vy = w.rnd() < 0.35 ? -720 : -480;
      n.vx = toward * (180 + w.rnd() * 120);
    }
  } else n.frame = n.vy < 0 ? 2 : 3;
  return true;
}

/** Eye of Cthulhu: hover and summon servants, charge three times; at half life a second, angrier phase. */
function stepEye(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  const d = NPCS.eye;
  if (!w.night && n.state !== 9) {
    w.message("The Eye of Cthulhu flees as the sun rises...");
    n.state = 9;
  }
  if (n.state === 9) {
    n.vy -= 600 * dt;
    n.y += n.vy * dt;
    n.rot += dt * 4;
    return n.y > -600;
  }
  if (!n.phase2 && n.life < d.life / 2 && n.state !== 5) {
    n.state = 5; // spin into phase 2
    n.t = 0;
  }
  const px = target.x;
  const py = target.y;
  const ex = cx(n);
  const ey = cy(n);
  const face = Math.atan2(py - ey, px - ex);
  switch (n.state) {
    case 0: {
      // Hover above the target, drifting toward a spot over their head.
      const gx = px - ex;
      const gy = py - 260 - ey;
      n.vx += (gx * 2 - n.vx) * Math.min(1, dt * 2);
      n.vy += (gy * 2 - n.vy) * Math.min(1, dt * 2);
      n.rot = face - Math.PI / 2;
      if (!n.phase2 && n.t % 1.4 < dt && w.alive("servant") < 6) w.spawn("servant", ex, ey + 30);
      if (n.t > (n.phase2 ? 1.6 : 2.6)) {
        n.state = 1;
        n.t = 0;
        n.count = 0;
      }
      break;
    }
    case 1: {
      // Charge: lunge at the target, then slow down; three in a row.
      if (n.t < dt * 1.5) {
        const sp = n.phase2 ? 540 : 420;
        n.vx = Math.cos(face) * sp;
        n.vy = Math.sin(face) * sp;
        n.rot = face - Math.PI / 2;
      }
      if (n.t > 0.6) {
        n.vx *= 1 - Math.min(1, dt * 5);
        n.vy *= 1 - Math.min(1, dt * 5);
      }
      if (n.t > 0.95) {
        n.count++;
        n.t = 0;
        if (n.count >= 3) n.state = 0;
      }
      break;
    }
    case 5: {
      // The transformation: a fast spin, then the mouth opens.
      n.vx *= 0.9;
      n.vy *= 0.9;
      n.rot += dt * (6 + n.t * 12);
      if (n.t > 1.6) {
        n.phase2 = true;
        n.state = 0;
        n.t = 0;
        w.message("The Eye of Cthulhu's mouth opens...");
      }
      break;
    }
  }
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  n.frame = (n.phase2 ? 3 : 0) + (Math.floor(n.t * 8) % 3);
  return true;
}

/** Queen Bee: hovers beside her target spitting stingers and releasing bees, then dashes across three times. */
function stepQueenBee(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  const ex = cx(n);
  const ey = cy(n);
  const enraged = n.life < NPCS.queenBee.life / 2;
  if (n.state === 0) {
    const side = n.count % 2 === 0 ? -1 : 1;
    const gx = target.x + side * 320 - ex;
    const gy = target.y - 120 - ey;
    n.vx += (gx * 2.4 - n.vx) * Math.min(1, dt * 2);
    n.vy += (gy * 2.4 - n.vy) * Math.min(1, dt * 2);
    n.dir = target.x < ex ? -1 : 1;
    if (n.t % (enraged ? 0.5 : 0.8) < dt) {
      if (n.count % 3 === 2) {
        if (w.alive("bee") < 10) w.spawn("bee", ex, ey + 30);
      } else w.shoot(n, "stinger", Math.atan2(target.y - ey, target.x - ex), 420, 22);
    }
    if (n.t > 4) {
      n.state = 1;
      n.t = 0;
      n.shed = 0;
    }
  } else {
    // Dash horizontally through the target, three times.
    if (n.t < dt * 1.5) {
      n.dir = target.x < ex ? -1 : 1;
      n.vx = n.dir * (enraged ? 720 : 600);
      n.vy = (target.y - ey) * 1.5;
    }
    if (n.t > 1.1) {
      n.t = 0;
      n.shed = (n.shed ?? 0) + 1;
      if (n.shed >= 3) {
        n.state = 0;
        n.count++;
      }
    }
  }
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  n.frame = (n.state === 1 ? 4 : 0) + (Math.floor(n.t * 14) % 4);
  return true;
}

/** Skeletron: hovers over its target with its two hands swiping; every so often it spins and chases. Leaves at dawn. */
function stepSkeletron(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  if (!n.count) {
    n.count = 1;
    n.head = n;
    for (const tag of ["handL", "handR"]) {
      const h = w.spawn("skeletronHand", cx(n), cy(n));
      h.head = n;
      h.tag = tag;
    }
  }
  if (!w.night) {
    if (n.state !== 9) w.message("Skeletron retreats into the dungeon at dawn...");
    n.state = 9;
    n.y -= 300 * dt;
    return n.y > -400;
  }
  const ex = cx(n);
  const ey = cy(n);
  if (n.state === 0) {
    n.vx += ((target.x - ex) * 1.5 - n.vx) * Math.min(1, dt * 2);
    n.vy += ((target.y - 220 - ey) * 1.5 - n.vy) * Math.min(1, dt * 2);
    n.rot *= 0.9;
    if (n.t > 9) {
      n.state = 1;
      n.t = 0;
    }
  } else {
    // Spin and chase.
    const a = Math.atan2(target.y - ey, target.x - ex);
    n.vx += (Math.cos(a) * 300 - n.vx) * Math.min(1, dt * 3);
    n.vy += (Math.sin(a) * 300 - n.vy) * Math.min(1, dt * 3);
    n.rot += dt * 12;
    if (n.t > 4) {
      n.state = 0;
      n.t = 0;
    }
  }
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  n.frame = n.state === 1 ? 1 : 0;
  return true;
}

function stepHand(n: Npc, _w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  const head = n.head;
  if (!head || head.life <= 0) return false;
  const side = n.tag === "handL" ? -1 : 1;
  const rest = { x: cx(head) + side * 150, y: cy(head) + 60 };
  if (n.state === 0) {
    n.x += (rest.x - n.w / 2 - n.x) * Math.min(1, dt * 4);
    n.y += (rest.y - n.h / 2 - n.y) * Math.min(1, dt * 4);
    if (n.t > 2.2 + (side > 0 ? 1.1 : 0)) {
      n.state = 1;
      n.t = 0;
      n.ax = target.x;
      n.ay = target.y;
    }
  } else {
    // Swipe at where the target was.
    n.x += (n.ax! - n.w / 2 - n.x) * Math.min(1, dt * 6);
    n.y += (n.ay! - n.h / 2 - n.y) * Math.min(1, dt * 6);
    if (n.t > 0.7) {
      n.state = 0;
      n.t = 0;
    }
  }
  n.rot = side * 0.4;
  n.dir = side > 0 ? 1 : -1;
  return true;
}

/** The Wall of Flesh crosses the underworld; the mouth follows its target up and down; anyone it passes is dragged in. */
function stepWall(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  if (!n.count) {
    n.count = 1;
    n.head = n;
    n.dir = target.x < w.worldWidth * TILE / 2 ? 1 : -1;
    for (const tag of ["eyeTop", "eyeBottom"]) {
      const e = w.spawn("wallEye", cx(n), cy(n));
      e.head = n;
      e.tag = tag;
    }
    for (let i = 0; i < 6; i++) {
      const h = w.spawn("hungry", cx(n), cy(n));
      h.head = n;
      h.tag = "hungry";
      h.ay = (i - 2.5) * 60;
    }
  }
  const speed = 60 + 120 * (1 - n.life / NPCS.wallOfFlesh.life);
  n.vx = n.dir * speed;
  n.x += n.vx * dt;
  const top = (HELL_TOP + 8) * TILE + n.h / 2;
  const bottom = (HELL_TOP + 50) * TILE - n.h / 2;
  const gy = Math.max(top, Math.min(bottom, target.y));
  n.y += (gy - n.h / 2 - n.y) * Math.min(1, dt * 2);
  n.frame = Math.floor(n.t * 4) % 2;
  if (n.t % 3 < dt) w.shoot(n, "laser", Math.atan2(target.y - cy(n), target.x - cx(n)), 500, 30);
  // Reaching the far edge: everyone not killed it is lost (it leaves).
  return n.x > -400 && n.x < w.worldWidth * TILE + 400;
}

function stepWallEye(n: Npc, w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  const head = n.head;
  if (!head || head.life <= 0) return false;
  n.x = cx(head) - n.w / 2;
  n.y = cy(head) - n.h / 2 + (n.tag === "eyeTop" ? -170 : 170);
  n.dir = head.dir;
  n.rot = 0;
  n.frame = Math.floor(n.t * 3) % 2;
  if (n.t % 2.2 < dt) w.shoot(n, "laser", Math.atan2(target.y - cy(n), target.x - cx(n)), 520, 26);
  return true;
}

function stepHungry(n: Npc, _w: AiWorld, dt: number, target: { x: number; y: number }): boolean {
  const head = n.head;
  if (!head || head.life <= 0) return false;
  // Tethered to the wall, reaching toward the target.
  const ax = cx(head) + head.dir * 40;
  const ay = cy(head) + (n.ay ?? 0);
  const dx = target.x - ax;
  const dy = target.y - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const reach = Math.min(dist, 140 + Math.sin(n.t * 3 + (n.ay ?? 0)) * 40);
  n.x += (ax + (dx / dist) * reach - n.w / 2 - n.x) * Math.min(1, dt * 4);
  n.y += (ay + (dy / dist) * reach - n.h / 2 - n.y) * Math.min(1, dt * 4);
  n.rot = Math.atan2(dy, dx) + Math.PI / 2;
  n.frame = Math.floor(n.t * 6) % 3;
  return true;
}

/** Contact damage right now (phase 2 Eye hits harder, with less defence). */
export function contactDamage(n: Npc): number {
  if (n.kind === "eye" && n.phase2) return 23;
  if (n.kind === "kingSlime" && n.state === 1) return 0; // fading out
  if (NPCS[n.kind].critter) return 0;
  return NPCS[n.kind].damage;
}

export function defenseOf(n: Npc): number {
  if (n.kind === "eye" && n.phase2) return 0;
  if (n.kind === "eye" && n.state === 5) return 999; // invulnerable while transforming
  if (n.kind === "skeletron" && n.state === 1) return 999; // spinning
  return NPCS[n.kind].defense;
}

/** Damage dealt to an NPC: defence halves it, ±15% variance, never below 1. */
export function damageTo(raw: number, defense: number, rnd: () => number, crit = false): number {
  const v = raw * (0.85 + rnd() * 0.3);
  return Math.max(1, Math.round((crit ? v * 2 : v) - defense / 2));
}

export function isCritter(n: Npc) {
  return !!NPCS[n.kind].critter;
}

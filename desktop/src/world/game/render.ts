// Draws the game on top of the terrain: placed furniture and life crystals (also in the passive
// background), dropped items, enemies and bosses, the player in their Terraria look (with
// equipped armour) swinging the held item, arrows, dig cracks, the tile cursor, lighting and
// damage numbers. World units are pixels (16 per tile); `k` scales them to the screen.

import { getTexture } from "../../assets/textures";
import type { TerrariaRig } from "../../overlay/terrariaRig";
import { walkStep } from "../../overlay/rigFrames";
import type { Camera } from "../view";
import { tilePx } from "../view";
import type { Agent } from "./builder";
import type { Game, Input } from "./game";
import { item, itemTexture } from "./items";
import { glowImage, shadowImage, type LightGrid } from "./lighting";
import { NPCS, type Npc } from "./npcs";
import { OBJECTS, type ObjectLayer } from "./objects";
import { TILE } from "./physics";
import { TOWN, type TownNpc } from "./town";

const tintCache = new Map<string, HTMLCanvasElement>();
const glowCanvas = typeof document !== "undefined" ? document.createElement("canvas") : (null as unknown as HTMLCanvasElement);

/** A grey sheet tinted (slimes), keeping its transparency. */
function tinted(img: ImageBitmap, tint: string): HTMLCanvasElement {
  const key = `${img.width}x${img.height}:${tint}`;
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  tintCache.set(key, c);
  return c;
}

export interface View {
  cam: Camera;
  zoom: number;
  w: number;
  h: number;
}

const scaleOf = (v: View) => tilePx(v.zoom) / TILE;
const sx = (v: View, x: number) => Math.round((x - v.cam.x * TILE) * scaleOf(v));
const sy = (v: View, y: number) => Math.round((y - v.cam.y * TILE) * scaleOf(v));

/** Furniture and life crystals in view (passive background and game alike). */
export function drawObjects(ctx: CanvasRenderingContext2D, objects: ObjectLayer, v: View, clock: number) {
  const k = scaleOf(v);
  const x0 = Math.floor(v.cam.x) - 3;
  const y0 = Math.floor(v.cam.y) - 3;
  const x1 = Math.ceil(v.cam.x + v.w / tilePx(v.zoom)) + 1;
  const y1 = Math.ceil(v.cam.y + v.h / tilePx(v.zoom)) + 1;
  ctx.imageSmoothingEnabled = false;
  for (const o of objects.inRect(x0, y0, x1, y1)) {
    const d = OBJECTS[o.t];
    const img = getTexture(d.sheet);
    const X = sx(v, o.x * TILE);
    const Y = sy(v, o.y * TILE);
    if (!img) {
      ctx.fillStyle = o.t === "torch" ? "#ffcf5a" : o.t === "crystal" ? "#e2486e" : "#8a5a34";
      ctx.fillRect(X, Y, d.w * TILE * k, d.h * TILE * k);
      continue;
    }
    // Animated sheets: the furnace and hellforge flicker, the crystal glints, the larva pulses,
    // fountains run, fires burn, chimneys smoke.
    const a = d.anim;
    const anim = a
      ? ((a.skip ?? 0) + ((Math.floor(clock * a.fps) + o.x) % a.frames)) * a.stride
      : o.t === "furnace" ? (Math.floor(clock * 8) % 12) * 38 : o.t === "hellforge" ? (Math.floor(clock * 8) % 12) * 38 : o.t === "crystal" ? (Math.floor(clock * 6) % 11) * 36 : o.t === "larva" ? (Math.floor(clock * 4) % 3) * 54 : 0;
    if (o.t === "gardentree") {
      drawGardenTree(ctx, o.style ?? 0, X, Y, k);
      continue;
    }
    if (o.t === "coral") {
      ctx.drawImage(img, (o.style ?? 0) * 26, 0, 24, 26, X - 4 * k, Y - 10 * k, 24 * k, 26 * k);
      continue;
    }
    if (o.t === "torch") {
      // Standing torch frame, 20 px wide on a 22 px grid.
      ctx.drawImage(img, 0, 0, 20, 20, X - 2 * k, Y - 2 * k, 20 * k, 20 * k);
      continue;
    }
    const f = d.frame(o.style ?? 0);
    // Floor furniture's bottom row is 18 px tall in the sheets (it overlaps the floor tile).
    const tallBottom = d.support === "floor" || d.support === "door";
    for (let dy = 0; dy < d.h; dy++)
      for (let dx = 0; dx < d.w; dx++) {
        const th = tallBottom && dy === d.h - 1 ? 18 : 16;
        ctx.drawImage(img, f.sx + dx * 18, f.sy + anim + dy * 18, 16, th, X + dx * TILE * k, Y + dy * TILE * k, TILE * k, th * k);
      }
  }
}

/** Garden trees by style: trunk sheet and top (frame size, stride). */
export const GARDEN_TREES: { trunk: string; top: string; w: number; h: number; stride: number }[] = [
  { trunk: "Images/Tiles_5", top: "Images/Tree_Tops_0", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_5", top: "Images/Tree_Tops_7", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_5", top: "Images/Tree_Tops_6", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_5_3", top: "Images/Tree_Tops_4", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_5_3", top: "Images/Tree_Tops_17", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_323", top: "Images/Tree_Tops_15", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_5_1", top: "Images/Tree_Tops_2", w: 114, h: 96, stride: 116 },
  { trunk: "Images/Tiles_5_2", top: "Images/Tree_Tops_3", w: 80, h: 140, stride: 82 },
  { trunk: "Images/Tiles_5_4", top: "Images/Tree_Tops_5", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_72", top: "Images/Tree_Tops_14", w: 80, h: 80, stride: 82 },
  { trunk: "Images/Tiles_5_0", top: "Images/Tree_Tops_1", w: 80, h: 80, stride: 82 },
];

/** A garden tree: its trunk up its one column, the crown spread over the top. */
function drawGardenTree(ctx: CanvasRenderingContext2D, style: number, X: number, Y: number, k: number) {
  const t = GARDEN_TREES[style % GARDEN_TREES.length];
  const trunk = getTexture(t.trunk);
  const top = getTexture(t.top);
  const cx = X;
  for (let i = 1; i < 6; i++) {
    const y = Y + i * TILE * k;
    if (!trunk) continue;
    if (t.trunk === "Images/Tiles_72") ctx.drawImage(trunk, (i % 3) * 18, 18, 16, 16, cx, y, TILE * k, TILE * k);
    else ctx.drawImage(trunk, 0, (i % 3) * 22, 20, 20, cx - 2 * k, y - 2 * k, 20 * k, 20 * k);
  }
  if (top) {
    const v = style % 3;
    ctx.drawImage(top, v * t.stride, 0, t.w, t.h, cx + 8 * k - (t.w / 2) * k, Y + TILE * k - t.h * k + 16 * k, t.w * k, t.h * k);
  }
}

export interface PlayerArt {
  rig: TerrariaRig | null;
  /** Building mode: the companions at work, each in her own look. */
  agents?: readonly Agent[];
  agentRigs?: ReadonlyMap<string, TerrariaRig>;
  /** The adventure's town NPCs (residents, and those waiting to be met). */
  town?: readonly TownNpc[];
}

/** Everything that moves, plus cursor, cracks, light and numbers. */
export function drawGame(ctx: CanvasRenderingContext2D, g: Game, v: View, art: PlayerArt, input: Input, light: LightGrid | null, lightCanvas: HTMLCanvasElement, clock: number) {
  const k = scaleOf(v);
  ctx.imageSmoothingEnabled = false;
  // Dig cracks on tiles being mined.
  for (const [key] of g.digging) {
    const x = key % 65536;
    const y = Math.floor(key / 65536);
    const p = g.digProgress(x, y);
    if (p <= 0) continue;
    ctx.strokeStyle = `rgba(0,0,0,${0.35 + p * 0.4})`;
    ctx.lineWidth = Math.max(1, k);
    const X = sx(v, x * TILE);
    const Y = sy(v, y * TILE);
    const s = TILE * k;
    ctx.beginPath();
    ctx.moveTo(X + s * 0.2, Y + s * 0.15);
    ctx.lineTo(X + s * 0.5, Y + s * 0.5);
    ctx.lineTo(X + s * 0.35, Y + s * 0.85);
    if (p > 0.4) {
      ctx.moveTo(X + s * 0.5, Y + s * 0.5);
      ctx.lineTo(X + s * 0.85, Y + s * 0.35);
    }
    ctx.stroke();
  }
  // Dropped items (bobbing).
  for (const d of g.drops) {
    const img = getTexture(itemTexture(d.id));
    const bob = Math.sin(d.age * 4) * 1.5;
    if (img) {
      const s = Math.min(1, 16 / Math.max(img.width, img.height)) * k * 1.1;
      ctx.drawImage(img, sx(v, d.x + 6) - (img.width * s) / 2, sy(v, d.y + 12 + bob) - img.height * s, img.width * s, img.height * s);
    } else {
      ctx.fillStyle = "#fff";
      ctx.fillRect(sx(v, d.x), sy(v, d.y + bob), 12 * k, 12 * k);
    }
  }
  for (const t of art.town ?? []) drawTownNpc(ctx, t, v);
  for (const n of g.npcs) drawNpc(ctx, n, v);
  if (g.mode === "auto") for (const a of art.agents ?? []) drawAgent(ctx, a, v, art.agentRigs?.get(a.id) ?? null);
  else drawPlayer(ctx, g, v, art);
  // Arrows.
  for (const pr of g.projectiles) {
    const img = getTexture(itemTexture(pr.item));
    ctx.save();
    ctx.translate(sx(v, pr.x), sy(v, pr.y));
    ctx.rotate(Math.atan2(pr.vy, pr.vx) + Math.PI / 2);
    if (img) ctx.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
    else {
      ctx.fillStyle = "#d9c08b";
      ctx.fillRect(-k, -8 * k, 2 * k, 16 * k);
    }
    ctx.restore();
  }
  // Enemy shots: glowing bolts, coloured by kind.
  for (const h of g.hostile) {
    const r = (h.kind === "fireball" || h.kind === "skull" || h.kind === "chaos" ? 5 : 3) * k;
    ctx.fillStyle = SHOT_COLOR[h.kind] ?? "#fff";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(sx(v, h.x), sy(v, h.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  // The tile under the mouse (within reach) gets an outline, Terraria-style.
  const t = g.target(input);
  if (g.mode === "player" && t.inReach && !g.inventoryOpen && g.player.dead <= 0) {
    const kind = g.held?.kind;
    if (kind === "pickaxe" || kind === "block" || kind === "furniture" || kind === "axe") {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = Math.max(1, k);
      ctx.strokeRect(sx(v, t.tx * TILE) + 0.5, sy(v, t.ty * TILE) + 0.5, TILE * k - 1, TILE * k - 1);
    }
  }
  // Lighting: one pixel per tile, scaled up smoothly for soft shadows.
  if (light) {
    shadowImage(light, lightCanvas);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lightCanvas, sx(v, light.x0 * TILE), sy(v, light.y0 * TILE), light.cols * TILE * k, light.rows * TILE * k);
    // Coloured light on top: warm pools round the fires, blue round glowing mushrooms, lava's red.
    if (glowImage(light, glowCanvas)) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.32;
      ctx.drawImage(glowCanvas, sx(v, light.x0 * TILE), sy(v, light.y0 * TILE), light.cols * TILE * k, light.rows * TILE * k);
    }
    ctx.restore();
  }
  // Damage numbers.
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(9 * k)}px Andy, ui-rounded, -apple-system, sans-serif`;
  for (const f of g.texts) {
    ctx.globalAlpha = Math.max(0, 1 - f.age / 1.2);
    ctx.fillStyle = "#000";
    ctx.fillText(f.text, sx(v, f.x) + 1, sy(v, f.y) + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx(v, f.x), sy(v, f.y));
  }
  ctx.globalAlpha = 1;
  // What the builders (and the townsfolk) are saying, above the lighting so it's readable at night.
  if (g.mode === "auto") for (const a of art.agents ?? []) if (a.say && a.say.until > clock) drawBubble(ctx, a, v);
  for (const t of art.town ?? []) if (t.say && t.say.until > clock) drawBubble(ctx, t, v);
}

/** A sprite rig drawn over a hitbox (the rig's body rectangle is fitted to the box). */
function drawRig(ctx: CanvasRenderingContext2D, v: View, box: { x: number; y: number; w: number; h: number }, rig: TerrariaRig, frame: string, flip: boolean) {
  const k = scaleOf(v);
  const { frameWidth: fw, frameHeight: fh, body } = rig.info;
  const left = flip ? fw - body.x - body.w : body.x;
  const X = sx(v, box.x - left * (box.w / body.w));
  const Y = sy(v, box.y - body.y * (box.h / body.h));
  ctx.save();
  ctx.translate(X, Y);
  rig.draw(ctx, frame, flip, fw * (box.w / body.w) * k, fh * (box.h / body.h) * k);
  ctx.restore();
}

/** A tool swung from behind the head down past the front, like Terraria. */
function drawSwing(ctx: CanvasRenderingContext2D, v: View, cx: number, cy: number, dir: number, id: number, t: number) {
  const img = getTexture(itemTexture(id));
  if (!img) return;
  const k = scaleOf(v);
  ctx.save();
  ctx.translate(sx(v, cx + dir * 4), sy(v, cy - 2));
  if (dir < 0) ctx.scale(-1, 1);
  ctx.rotate((-110 + 170 * t) * (Math.PI / 180));
  ctx.drawImage(img, 0, -img.height * k, img.width * k, img.height * k);
  ctx.restore();
}

function drawAgent(ctx: CanvasRenderingContext2D, a: Agent, v: View, rig: TerrariaRig | null) {
  const flip = a.dir < 0;
  let frame = "idle";
  if (a.use) frame = `use${Math.min(3, Math.floor(a.use.t * 4)) + 1}`;
  else if (!a.onGround) frame = a.vy < 0 ? "jump" : "fall";
  else if (Math.abs(a.vx) > 10) frame = `walk${walkStep(a.walk, 1)}`;
  if (rig) drawRig(ctx, v, a, rig, frame, flip);
  else {
    ctx.fillStyle = "#ffcf9e";
    ctx.fillRect(sx(v, a.x), sy(v, a.y), a.w * scaleOf(v), a.h * scaleOf(v));
  }
  if (a.use) drawSwing(ctx, v, a.x + a.w / 2, a.y + a.h / 2, a.dir, a.use.item, Math.min(1, a.use.t));
}

const SHOT_COLOR: Record<string, string> = {
  stinger: "#f5d742",
  feather: "#e9e2c8",
  sand: "#e3c27a",
  bolt: "#7fd0ff",
  chaos: "#c86bff",
  fireball: "#ff7a2a",
  scythe: "#b04aff",
  laser: "#ff4a4a",
  skull: "#9be7ff",
  spit: "#8fd14f",
};

/** A town NPC from their sheet: frame 0 standing, the walk cycle from frame 2. */
function drawTownNpc(ctx: CanvasRenderingContext2D, n: TownNpc, v: View) {
  const d = TOWN[n.id];
  const img = getTexture(d.tex);
  const k = scaleOf(v);
  const cxs = sx(v, n.x + n.w / 2);
  const bottom = sy(v, n.y + n.h);
  if (!img) {
    ctx.fillStyle = "#c9a27a";
    ctx.fillRect(sx(v, n.x), sy(v, n.y), n.w * k, n.h * k);
    return;
  }
  const frames = Math.max(1, Math.floor(img.height / d.fh));
  const walking = Math.abs(n.vx) > 5 && n.onGround && frames > 4;
  const frame = walking ? 2 + (Math.floor(n.walk / 6) % Math.min(14, frames - 2)) : 0;
  ctx.save();
  ctx.translate(cxs, bottom);
  if (n.dir > 0) ctx.scale(-1, 1);
  ctx.drawImage(img, 0, frame * d.fh, d.fw, d.fh, (-d.fw * k) / 2, -d.fh * k + 2 * k, d.fw * k, d.fh * k);
  ctx.restore();
}

function drawBubble(ctx: CanvasRenderingContext2D, a: { x: number; y: number; w: number; say: { text: string } | null }, v: View) {
  const k = scaleOf(v);
  const text = a.say!.text;
  ctx.font = `600 ${Math.max(11, Math.round(6 * k))}px Andy, ui-rounded, -apple-system, sans-serif`;
  const tw = Math.min(ctx.measureText(text).width, 320);
  const pad = 6;
  const cx = sx(v, a.x + a.w / 2);
  const by = sy(v, a.y) - 10;
  const x = Math.round(cx - tw / 2 - pad);
  const h = Math.max(11, Math.round(6 * k)) + pad * 2;
  ctx.fillStyle = "rgba(20, 16, 40, 0.82)";
  ctx.strokeStyle = "rgba(255, 220, 240, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, by - h, tw + pad * 2, h, 7);
  ctx.moveTo(cx - 5, by);
  ctx.lineTo(cx, by + 6);
  ctx.lineTo(cx + 5, by);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, by - h / 2, 320);
  ctx.textBaseline = "alphabetic";
}

function drawNpc(ctx: CanvasRenderingContext2D, n: Npc, v: View) {
  const d = NPCS[n.kind];
  const k = scaleOf(v);
  let img: ImageBitmap | HTMLCanvasElement | undefined = getTexture(d.tex);
  if (img && d.tint) img = tinted(img as ImageBitmap, d.tint);
  const cxs = sx(v, n.x + n.w / 2);
  const cys = sy(v, n.y + n.h / 2);
  ctx.save();
  ctx.globalAlpha = n.alpha * (n.hurt > 0 ? 0.7 : 1);
  ctx.translate(cxs, cys);
  const scale = n.kind === "kingSlime" ? n.w / d.w : 1;
  if (n.kind === "eye") ctx.rotate(n.rot);
  else if (n.kind === "demonEye" || n.kind === "servant") ctx.rotate(n.rot + (n.kind === "servant" ? -Math.PI / 2 : 0));
  // Most sheets face left; flip to face the way they're going (eyes rotate instead).
  const rotates = n.kind === "eye" || n.kind === "demonEye" || n.kind === "servant" || !!n.head;
  if (n.head && n.kind !== "eye") ctx.rotate(n.rot);
  if (!rotates && n.dir > 0) ctx.scale(-1, 1);
  if (img) {
    const fw = d.fw * k * scale;
    const fh = d.fh * k * scale;
    // Feet on the ground: the sheet's frame bottom sits at the box bottom.
    const oy = rotates ? -fh / 2 : (n.h * k) / 2 - fh;
    ctx.drawImage(img, 0, n.frame * (d.fh + (n.kind === "eye" ? 0 : 0)), d.fw, d.fh, -fw / 2, oy, fw, fh);
  } else {
    ctx.fillStyle = d.tint ?? "#c33";
    ctx.fillRect((-n.w * k) / 2, (-n.h * k) / 2, n.w * k, n.h * k);
  }
  ctx.restore();
  // Health bar under hurt enemies (bosses use the HUD bar).
  if (!d.boss && n.life < d.life) {
    const w = 26 * k;
    const x = cxs - w / 2;
    const y = sy(v, n.y + n.h) + 3 * k;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 1, y - 1, w + 2, 4 * k + 2);
    ctx.fillStyle = n.life / d.life > 0.5 ? "#3ddc4f" : n.life / d.life > 0.25 ? "#f0c43a" : "#e8433a";
    ctx.fillRect(x, y, (w * Math.max(0, n.life)) / d.life, 4 * k);
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, g: Game, v: View, art: PlayerArt) {
  const p = g.player;
  if (p.dead > 0) return;
  const k = scaleOf(v);
  const flip = p.dir < 0;
  const use = p.use;
  const def = use ? item(use.id) : undefined;
  let frame = "idle";
  if (use && def) {
    const step = Math.min(3, Math.floor(use.t * 4));
    frame = def.kind === "shortsword" || def.kind === "bow" ? "use3" : `use${step + 1}`;
  } else if (!p.onGround) frame = p.vy < 0 ? "jump" : "fall";
  else if (Math.abs(p.vx) > 10) frame = `walk${walkStep(p.walk, 1)}`;
  ctx.save();
  // Blink while invincible after a hit.
  if (p.iframes > 0 && Math.floor(p.iframes * 16) % 2 === 0) ctx.globalAlpha = 0.45;
  const rig = art.rig;
  if (rig) drawRig(ctx, v, p, rig, frame, flip);
  else {
    ctx.fillStyle = "#ffcf9e";
    ctx.fillRect(sx(v, p.x), sy(v, p.y), p.w * k, p.h * k);
  }
  ctx.restore();
  // The held item in action.
  if (use && def) {
    const img = getTexture(itemTexture(def.id));
    if (!img) return;
    const c = g.playerCenter;
    const hx = sx(v, c.x + p.dir * 4);
    const hy = sy(v, c.y - 2);
    ctx.save();
    ctx.translate(hx, hy);
    const s = k;
    if (def.kind === "bow") {
      ctx.rotate(use.aim);
      ctx.drawImage(img, -img.width * s * 0.2, (-img.height * s) / 2, img.width * s, img.height * s);
    } else if (def.kind === "shortsword") {
      ctx.rotate(use.aim + Math.PI / 4);
      const thrust = Math.sin(use.t * Math.PI) * 10 * s;
      ctx.drawImage(img, thrust - 2 * s, -img.height * s + 2 * s, img.width * s, img.height * s);
    } else {
      // Swing from behind the head down past the front, like Terraria.
      const a = (-110 + 170 * use.t) * (Math.PI / 180);
      if (p.dir < 0) ctx.scale(-1, 1);
      ctx.rotate(a);
      ctx.drawImage(img, 0, -img.height * s, img.width * s, img.height * s);
    }
    ctx.restore();
  }
}

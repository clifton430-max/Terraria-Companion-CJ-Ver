// Draws the background world: the backdrop (sky, parallax scenery for the biome, the
// underground's rock; backdrop.ts), the terrain in 32×32-tile chunks (each rasterised once at
// native 16 px and cached, then scaled with nearest-neighbour filtering) with cave walls and the
// world's small details (plants, vines, stalactites…; flora.ts), trees of every biome and an
// underground darkening. Particles go over the top (`drawFront`).

import { getTexture, loadTexture } from "../assets/textures";
import { tileFrame, tileVariant } from "../engine/blocks";
import { Backdrop, type BackdropTime } from "./backdrop";
import { decoAt, FLORA_SHEETS, sunflowerAt } from "./flora";
import { CHUNK, hash, HELL_TOP, stoneCave, T, TILE_COUNT, WALL_SHEET, W, WorldMap, type TreeKind } from "./gen";
import { tilePx, type Camera } from "./view";

/** Tile sheets from the local install (loaded at runtime, never copied). */
const SHEETS: Record<number, string> = {
  [T.Dirt]: "Images/Tiles_0",
  [T.Grass]: "Images/Tiles_2",
  [T.Stone]: "Images/Tiles_1",
  [T.Clay]: "Images/Tiles_40",
  [T.Sand]: "Images/Tiles_53",
  [T.Copper]: "Images/Tiles_7",
  [T.Iron]: "Images/Tiles_6",
  [T.Gold]: "Images/Tiles_8",
  [T.Wood]: "Images/Tiles_30",
  [T.Mud]: "Images/Tiles_59",
  [T.Snow]: "Images/Tiles_147",
  [T.Ice]: "Images/Tiles_161",
  [T.JungleGrass]: "Images/Tiles_60",
  [T.Platform]: "Images/Tiles_19",
  [T.Silver]: "Images/Tiles_9",
  [T.Demonite]: "Images/Tiles_22",
  [T.CorruptGrass]: "Images/Tiles_23",
  [T.Ebonstone]: "Images/Tiles_25",
  [T.Meteorite]: "Images/Tiles_37",
  [T.Ash]: "Images/Tiles_57",
  [T.Hellstone]: "Images/Tiles_58",
  [T.Obsidian]: "Images/Tiles_56",
  [T.MushroomGrass]: "Images/Tiles_70",
  [T.Hive]: "Images/Tiles_225",
  [T.Cloud]: "Images/Tiles_189",
  [T.Sunplate]: "Images/Tiles_202",
  [T.BlueBrick]: "Images/Tiles_41",
  [T.GreenBrick]: "Images/Tiles_43",
  [T.PinkBrick]: "Images/Tiles_44",
  [T.GrayBrick]: "Images/Tiles_38",
  [T.RedBrick]: "Images/Tiles_39",
  [T.GoldBrick]: "Images/Tiles_45",
  [T.Glass]: "Images/Tiles_54",
  [T.SandstoneBrick]: "Images/Tiles_151",
  [T.SnowBrick]: "Images/Tiles_148",
  [T.BorealWood]: "Images/Tiles_321",
  [T.PalmWood]: "Images/Tiles_322",
  [T.RichMahogany]: "Images/Tiles_158",
  [T.Ebonwood]: "Images/Tiles_157",
  [T.ObsidianBrick]: "Images/Tiles_75",
  [T.HellstoneBrick]: "Images/Tiles_76",
  [T.LivingWood]: "Images/Tiles_191",
  [T.Leaf]: "Images/Tiles_192",
  [T.IceBrick]: "Images/Tiles_206",
  [T.Water]: "Images/Liquid_0",
  [T.Lava]: "Images/Liquid_1",
  [T.EbonstoneBrick]: "Images/Tiles_152",
  [T.MudstoneBrick]: "Images/Tiles_120",
  [T.CopperBrick]: "Images/Tiles_47",
  [T.SilverBrick]: "Images/Tiles_46",
  [T.GlowMushroomBlock]: "Images/Tiles_190",
  [T.BoneBlock]: "Images/Tiles_194",
  [T.Sandstone]: "Images/Tiles_396",
  [T.HardenedSand]: "Images/Tiles_397",
  [T.HallowedGrass]: "Images/Tiles_109",
  [T.Pearlstone]: "Images/Tiles_117",
  [T.Pearlsand]: "Images/Tiles_116",
  [T.PearlstoneBrick]: "Images/Tiles_118",
  [T.Pearlwood]: "Images/Tiles_159",
  [T.CrimsonGrass]: "Images/Tiles_199",
  [T.Crimstone]: "Images/Tiles_203",
  [T.Crimtane]: "Images/Tiles_204",
  [T.Shadewood]: "Images/Tiles_208",
  [T.Marble]: "Images/Tiles_367",
  [T.MarbleBlock]: "Images/Tiles_357",
  [T.Granite]: "Images/Tiles_368",
  [T.GraniteBlock]: "Images/Tiles_369",
  [T.StoneSlab]: "Images/Tiles_273",
  [T.SandstoneSlab]: "Images/Tiles_274",
  [T.CrystalBlock]: "Images/Tiles_385",
  [T.DynastyWood]: "Images/Tiles_311",
  [T.RedShingles]: "Images/Tiles_312",
  [T.BlueShingles]: "Images/Tiles_313",
  [T.Coralstone]: "Images/Tiles_315",
  [T.LivingMahogany]: "Images/Tiles_383",
  [T.MahoganyLeaves]: "Images/Tiles_384",
  [T.Amethyst]: "Images/Tiles_67",
  [T.Topaz]: "Images/Tiles_66",
  [T.Sapphire]: "Images/Tiles_63",
  [T.Emerald]: "Images/Tiles_65",
  [T.Ruby]: "Images/Tiles_64",
  [T.Diamond]: "Images/Tiles_68",
  [T.WoodBeam]: "Images/Tiles_124",
  [T.Hay]: "Images/Tiles_252",
  [T.CopperPlating]: "Images/Tiles_284",
};

/** Fallback colours when the install isn't available. */
const COLORS: Record<number, string> = {
  [T.Dirt]: "#976b4b",
  [T.Grass]: "#28b04a",
  [T.Stone]: "#808080",
  [T.Clay]: "#a5523a",
  [T.Sand]: "#d3c66f",
  [T.Copper]: "#b4683a",
  [T.Iron]: "#9c8c7a",
  [T.Gold]: "#d9b33f",
  [T.Wood]: "#a97d5d",
  [T.Mud]: "#5c4449",
  [T.Snow]: "#e6f2fb",
  [T.Ice]: "#9fd2f3",
  [T.JungleGrass]: "#7cc414",
  [T.Platform]: "#a97d5d",
  [T.Silver]: "#dfe6ee",
  [T.Demonite]: "#5a3cc8",
  [T.CorruptGrass]: "#8c6ed2",
  [T.Ebonstone]: "#64508c",
  [T.Meteorite]: "#6b4a3a",
  [T.Ash]: "#463c3c",
  [T.Hellstone]: "#dc3c1e",
  [T.Obsidian]: "#2a1f3d",
  [T.MushroomGrass]: "#5078ff",
  [T.Hive]: "#e6961e",
  [T.Cloud]: "#ffffff",
  [T.Sunplate]: "#f0c850",
  [T.BlueBrick]: "#283ca0",
  [T.Water]: "#1e50dc",
  [T.Lava]: "#ff7800",
  [T.HallowedGrass]: "#5ad2e6",
  [T.Pearlstone]: "#b4a8c8",
  [T.Pearlsand]: "#e6dcdc",
  [T.CrimsonGrass]: "#c83232",
  [T.Crimstone]: "#a02828",
  [T.Marble]: "#d2d8e6",
  [T.Granite]: "#28285a",
};

/** Natural background walls behind caves, by biome (dirt or stone elsewhere, by depth). */
const NATURAL_WALL: Partial<Record<string, number>> = { jungle: W.Mud, corruption: W.Ebonstone, crimson: W.Crimstone, hallow: W.Pearlstone, snow: W.Ice, mushroom: W.Mushroom };

const TRUNKS: Record<TreeKind, string> = {
  forest: "Images/Tiles_5",
  ebonwood: "Images/Tiles_5_0",
  mahogany: "Images/Tiles_5_1",
  boreal: "Images/Tiles_5_3",
  palm: "Images/Tiles_323",
  pearlwood: "Images/Tiles_5_2",
  shadewood: "Images/Tiles_5_4",
  mushroom: "Images/Tiles_72",
};

/** A tree top sheet: frame size and stride, and how many frames across. */
interface TopArt {
  sheet: string;
  w: number;
  h: number;
  stride: number;
  frames: number;
}
const top = (n: number, w = 80, h = 80, stride = 82, frames = 3): TopArt => ({ sheet: `Images/Tree_Tops_${n}`, w, h, stride, frames });

/** The tops each kind of tree can have (a forest mixes round oaks, willows and bonsai-like pines). */
const TOPS: Record<TreeKind, TopArt[]> = {
  forest: [top(0), top(0), top(9), top(7), top(6)],
  ebonwood: [top(1)],
  mahogany: [top(2, 114, 96, 116)],
  boreal: [top(4), top(12), top(17)],
  palm: [top(15)],
  pearlwood: [top(3, 80, 140, 82, 9), top(20, 80, 140, 82, 18)],
  shadewood: [top(5)],
  mushroom: [top(14)],
};

const ART = {
  dirtWall: "Images/Wall_2",
  stoneWall: "Images/Wall_1",
  trunk: "Images/Tiles_5",
  branches: "Images/Tree_Branches_0",
};

type Art = Partial<Record<keyof typeof ART, ImageBitmap>> & {
  tiles: Partial<Record<number, ImageBitmap>>;
  walls: Partial<Record<number, ImageBitmap>>;
  trunks: Partial<Record<TreeKind, ImageBitmap>>;
};

const PX = 16;

export class WorldRenderer {
  private art: Art = { tiles: {}, walls: {}, trunks: {} };
  readonly backdrop: Backdrop;
  private chunks = new Map<number, HTMLCanvasElement>();
  /** At most this many chunk canvases (≈1 MB each) are kept. */
  private maxChunks = 40;
  private loaded = false;

  constructor(private map: WorldMap) {
    this.backdrop = new Backdrop(map);
  }

  /** Load the art (resolves when done; draws use fallbacks until then). */
  async load(): Promise<void> {
    const wallNames = Object.values(WALL_SHEET).map((n) => `Images/Wall_${n}`);
    const tops = Object.values(TOPS).flatMap((ts) => ts.map((t) => t.sheet));
    const names = [...new Set([...Object.values(SHEETS), ...Object.values(ART), ...wallNames, ...Object.values(TRUNKS), ...tops, ...FLORA_SHEETS, ...Backdrop.textures()])];
    const bitmaps = await Promise.all(names.map((n) => loadTexture(n).catch(() => null)));
    const byName = new Map(names.map((n, i) => [n, bitmaps[i] ?? undefined]));
    for (let t = 1; t < TILE_COUNT; t++) if (SHEETS[t]) this.art.tiles[t] = byName.get(SHEETS[t]);
    for (const [w, n] of Object.entries(WALL_SHEET)) this.art.walls[Number(w)] = byName.get(`Images/Wall_${n}`);
    for (const k of Object.keys(TRUNKS) as TreeKind[]) this.art.trunks[k] = byName.get(TRUNKS[k]);
    for (const [k, n] of Object.entries(ART)) (this.art as Record<string, unknown>)[k] = byName.get(n);
    this.loaded = true;
    this.chunks.clear();
  }

  get hasArt() {
    return this.loaded && !!this.art.tiles[T.Dirt];
  }

  /** Use another renderer's loaded art (for an offscreen preview renderer). */
  shareArt(from: WorldRenderer) {
    this.art = from.art;
    this.loaded = from.loaded;
  }

  /** Forget the rasterised chunks (a preview renderer frees its memory after each picture). */
  dropCache() {
    this.chunks.clear();
  }

  setMap(map: WorldMap) {
    this.map = map;
    this.chunks.clear();
    this.backdrop.setMap(map);
  }

  /** A tile changed: re-rasterise its chunk (and neighbours, whose edges blend into it, and the
   * rows below, where vines hanging from it are drawn). */
  invalidate(x: number, y: number) {
    for (const dx of [-1, 0, 1])
      for (const dy of [-4, -1, 0, 1, 8]) this.chunks.delete(Math.floor((y + dy) / CHUNK) * 4096 + Math.floor((x + dx) / CHUNK));
  }

  get cachedChunks() {
    return this.chunks.size;
  }

  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = cy * 4096 + cx;
    let c = this.chunks.get(key);
    if (c) {
      this.chunks.delete(key);
      this.chunks.set(key, c);
      return c;
    }
    c = document.createElement("canvas");
    c.width = CHUNK * PX;
    c.height = CHUNK * PX;
    this.rasterize(c.getContext("2d")!, cx, cy);
    this.chunks.set(key, c);
    while (this.chunks.size > this.maxChunks) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  private rasterize(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const m = this.map;
    ctx.imageSmoothingEnabled = false;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = x0 + tx;
        const y = y0 + ty;
        const t = m.tile(x, y);
        const dx = tx * PX;
        const dy = ty * PX;
        const surface = m.surface(x);
        if (t === T.Air || t === T.Platform || t === T.Water || t === T.Lava || t === T.WoodBeam) {
          // Walls behind open space: placed / structure walls, else (in patches) the cave's
          // natural wall, with the underground backdrop showing between them.
          const wall = m.wall(x, y);
          if (wall) this.drawPlacedWall(ctx, wall, x, y, dx, dy);
          else if (y > surface + 1 && y < HELL_TOP - 4) this.drawWall(ctx, x, y, surface, dx, dy);
          if (t === T.Air) {
            for (const d of decoAt(m, x, y)) {
              const img = getTexture(d.sheet);
              if (img) ctx.drawImage(img, d.sx, d.sy, d.w, d.h, dx + d.dx, dy + d.dy, d.w, d.h);
            }
            if (y === surface - 1 && sunflowerAt(m, x)) this.drawSunflower(ctx, x, dx, dy);
            continue;
          }
        }
        if (t === T.WoodBeam) {
          const img = this.art.tiles[t];
          const up = m.tile(x, y - 1) === T.WoodBeam;
          const down = m.tile(x, y + 1) === T.WoodBeam;
          // Beams: the top, middle or bottom piece of a post.
          if (img) ctx.drawImage(img, 18 * (tileVariant(x, y) % 3), up && down ? 18 : up ? 36 : down ? 0 : 54, PX, PX, dx, dy, PX, PX);
          continue;
        }
        if (t === T.Water || t === T.Lava) {
          const img = this.art.tiles[t];
          const surfaceRow = m.liquid(x, y - 1) === 0;
          ctx.globalAlpha = t === T.Water ? 0.62 : 0.92;
          if (img) ctx.drawImage(img, 0, 0, PX, PX, dx, dy + (surfaceRow ? 2 : 0), PX, PX - (surfaceRow ? 2 : 0));
          else {
            ctx.fillStyle = COLORS[t];
            ctx.fillRect(dx, dy + (surfaceRow ? 2 : 0), PX, PX);
          }
          ctx.globalAlpha = 1;
          continue;
        }
        const sheet = this.art.tiles[t];
        if (sheet && t === T.Platform) {
          // Platforms: the plain wooden piece (row 0 of the sheet).
          ctx.drawImage(sheet, 0, 0, PX, PX, dx, dy, PX, PX);
          continue;
        }
        if (sheet) {
          const f = tileFrame(m.solid(x, y - 1), m.solid(x, y + 1), m.solid(x - 1, y), m.solid(x + 1, y), tileVariant(x, y));
          ctx.drawImage(sheet, f.x, f.y, PX, PX, dx, dy, PX, PX);
        } else {
          ctx.fillStyle = COLORS[t] ?? "#777";
          ctx.fillRect(dx, dy, PX, PX);
          if (t === T.Grass || !m.solid(x, y - 1)) {
            ctx.fillStyle = t === T.Grass ? "#3fd35e" : "rgba(255,255,255,0.18)";
            ctx.fillRect(dx, dy, PX, 3);
          }
        }
      }
    }
  }

  /** A placed or structure wall (the plain middle frame of its sheet, varied per tile). */
  private drawPlacedWall(ctx: CanvasRenderingContext2D, wall: number, x: number, y: number, dx: number, dy: number) {
    const img = this.art.walls[wall];
    if (img) {
      const v = tileVariant(x, y);
      ctx.drawImage(img, 44 + v * 36, 44, PX, PX, dx, dy, PX, PX);
    } else {
      ctx.fillStyle = "#4a3a30";
      ctx.fillRect(dx, dy, PX, PX);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(dx, dy, PX, PX);
  }

  /** The background wall behind caves: dirt near the top, stone deeper (each biome its own;
   * marble and granite in their caves). Only in patches, except right under the surface. */
  private drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, surface: number, dx: number, dy: number) {
    const cave = y > surface + 60 ? stoneCave(this.map.seed, x, y) : null;
    const patch = y < surface + 8 || this.naturalWall(x, y);
    if (!cave && !patch) return;
    const special = cave ? (cave === "marble" ? W.Marble : W.Granite) : NATURAL_WALL[this.map.biome(x)];
    const img = special && this.art.walls[special] ? this.art.walls[special] : y < surface + 22 ? this.art.dirtWall : this.art.stoneWall;
    if (img) {
      const v = tileVariant(x, y);
      ctx.drawImage(img, 44 + v * 36, 44, PX, PX, dx, dy, PX, PX);
    } else {
      ctx.fillStyle = y < surface + 22 ? "#4a3526" : "#3d3d44";
      ctx.fillRect(dx, dy, PX, PX);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(dx, dy, PX, PX);
  }

  /** Natural walls come in patches (the underground backdrop shows between them). */
  private naturalWall(x: number, y: number): boolean {
    const n = hash(this.map.seed + 37, x >> 3, y >> 3) * 0.6 + hash(this.map.seed + 38, x >> 2, y >> 2) * 0.4;
    return n > 0.42;
  }

  /** A sunflower standing on the ground below (x, y) (2 wide, 4 tall; drawn from its left column). */
  private drawSunflower(ctx: CanvasRenderingContext2D, x: number, dx: number, dy: number) {
    const img = getTexture("Images/Tiles_27");
    if (!img) return;
    const v = Math.floor(hash(this.map.seed + 341, x) * 3);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) ctx.drawImage(img, v * 36 + i * 18, j * 18, 16, j === 3 ? 18 : 16, dx + i * PX, dy - 3 * PX + j * PX, PX, j === 3 ? 18 : 16);
  }

  /**
   * Draw the view (CSS px; the context is already scaled for the display). `daylight` darkens
   * the sky at night; `lit` skips the simple depth darkening (the game draws real lighting);
   * `focus` (tile) is where attention is (the backdrop follows its biome), `hour` / `day` set the
   * sun, moon and stars, `now` (ms) moves the clouds, fades and particles.
   */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, zoom: number, w: number, h: number, opts: { daylight?: number; lit?: boolean; hour?: number; day?: number; focus?: { x: number; y: number }; now?: number } = {}) {
    const tp = tilePx(zoom);
    const k = tp / PX;
    ctx.imageSmoothingEnabled = false;
    const time: BackdropTime = { hour: opts.hour ?? 12, daylight: opts.daylight ?? 1, day: opts.day ?? 0 };
    const focus = opts.focus ?? { x: cam.x + w / tp / 2, y: cam.y + h / tp / 2 };
    this.backdrop.update(opts.now ?? performance.now(), focus, time);
    this.backdrop.drawBack(ctx, cam, tp, w, h, time);
    const cx0 = Math.floor(cam.x / CHUNK);
    const cy0 = Math.floor(cam.y / CHUNK);
    const cx1 = Math.floor((cam.x + w / tp) / CHUNK);
    const cy1 = Math.floor((cam.y + h / tp) / CHUNK);
    // Keep enough chunks for this view (plus a ring) cached while scrolling.
    this.maxChunks = Math.max(40, (cx1 - cx0 + 3) * (cy1 - cy0 + 3));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= this.map.size.width || cy * CHUNK >= this.map.size.height) continue;
        const sx = Math.round((cx * CHUNK - cam.x) * tp);
        const sy = Math.round((cy * CHUNK - cam.y) * tp);
        ctx.drawImage(this.chunk(cx, cy), sx, sy, CHUNK * PX * k, CHUNK * PX * k);
      }
    }
    this.drawTrees(ctx, cam, tp, k, w);
    this.drawCacti(ctx, cam, tp, k, w);
    if (!opts.lit) this.drawDarkness(ctx, cam, tp, w, h);
  }

  /** Particles and weather over everything else. */
  drawFront(ctx: CanvasRenderingContext2D, cam: Camera, zoom: number, w: number, h: number) {
    this.backdrop.drawFront(ctx, cam, tilePx(zoom), w, h);
  }

  private drawTrees(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, k: number, w: number) {
    const x0 = Math.floor(cam.x) - 4;
    const x1 = Math.ceil(cam.x + w / tp) + 4;
    for (let x = x0; x <= x1; x++) {
      const height = this.map.tree(x);
      if (!height) continue;
      const ground = this.map.surface(x);
      const sx = Math.round((x - cam.x) * tp);
      const kind = this.map.treeKind(x);
      const trunk = this.art.trunks[kind];
      for (let i = 1; i <= height; i++) {
        const y = Math.round((ground - i - cam.y) * tp);
        if (trunk && kind === "mushroom") ctx.drawImage(trunk, (i % 3) * 18, 18, 16, 16, sx, y, 16 * k, 16 * k);
        else if (trunk) ctx.drawImage(trunk, 0, (i % 3) * 22, 20, 20, sx - 2 * k, y - 2 * k, 20 * k, 20 * k);
        else {
          ctx.fillStyle = "#8a5a34";
          ctx.fillRect(sx + 3 * k, y, 10 * k, tp);
        }
        // An occasional leafy branch.
        if (kind === "forest" && i > 3 && i < height - 2 && hash(this.map.seed + 40, x, i) < 0.12 && this.art.branches) {
          const left = hash(this.map.seed + 41, x, i) < 0.5;
          ctx.drawImage(this.art.branches, left ? 0 : 42, (i % 3) * 42, 40, 40, left ? sx - 40 * k + 4 * k : sx + 12 * k, y - 12 * k, 40 * k, 40 * k);
        }
      }
      const topY = Math.round((ground - height - cam.y) * tp);
      const choices = TOPS[kind];
      const art = choices[Math.floor(hash(this.map.seed + 43, x) * choices.length)];
      const img = getTexture(art.sheet);
      const v = Math.floor(hash(this.map.seed + 42, x) * art.frames);
      if (img) ctx.drawImage(img, v * art.stride, 0, art.w, art.h, sx + 8 * k - (art.w / 2) * k, topY - art.h * k + 16 * k, art.w * k, art.h * k);
      else {
        ctx.fillStyle = "#2ea84f";
        ctx.beginPath();
        ctx.arc(sx + 8 * k, topY - 20 * k, 34 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Desert cacti (drawn: a trunk with arms, in cactus green). */
  private drawCacti(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, k: number, w: number) {
    const x0 = Math.floor(cam.x) - 1;
    const x1 = Math.ceil(cam.x + w / tp) + 1;
    for (let x = x0; x <= x1; x++) {
      const h = this.map.cactus(x);
      if (!h) continue;
      const ground = this.map.surface(x);
      const X = Math.round((x - cam.x) * tp);
      const top = Math.round((ground - h - cam.y) * tp);
      const bottom = Math.round((ground - cam.y) * tp);
      ctx.fillStyle = "#2f7d32";
      ctx.fillRect(X + 4 * k, top, 8 * k, bottom - top);
      ctx.fillStyle = "#4caf50";
      ctx.fillRect(X + 6 * k, top + 2 * k, 2 * k, bottom - top - 4 * k);
      if (h >= 3) {
        const armY = top + tp;
        const left = hash(this.map.seed + 27, x) < 0.5;
        ctx.fillStyle = "#2f7d32";
        ctx.fillRect(left ? X : X + 12 * k, armY, 4 * k, 3 * k);
        ctx.fillRect(left ? X : X + 12 * k, armY - 8 * k, 4 * k, 10 * k);
      }
    }
  }

  /** It gets darker deeper underground (like Terraria's light falloff, simplified). */
  private drawDarkness(ctx: CanvasRenderingContext2D, cam: Camera, tp: number, w: number, h: number) {
    const midX = Math.floor(cam.x + w / tp / 2);
    const surfaceY = (this.map.surface(Math.max(0, Math.min(this.map.size.width - 1, midX))) - cam.y) * tp;
    const start = surfaceY + 20 * tp;
    if (start >= h) return;
    const g = ctx.createLinearGradient(0, start, 0, start + 60 * tp);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, "rgba(0, 0, 0, 0.6)");
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(0, start), w, h - Math.max(0, start));
  }
}

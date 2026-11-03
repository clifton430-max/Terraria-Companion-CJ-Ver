// Cherry-blossom decorations for the theme layer, in chunky Terraria-style pixel art: a blossom
// garland just below the menu bar, grass and flowers along the Dock's edge (real Terraria plant
// sprites from the local install when available), and the petal sprites. Drawn once per layout
// change on a canvas that sits behind app windows (or click-through in front); nothing here ever
// covers the menu bar or the Dock, which macOS always draws above this window.

import type { AmbientGeometry } from "../bridge";
import { drawChessEdge, drawChessGround } from "./chessMap";
import { PETAL_KINDS } from "./petals";

const PAL: Record<string, string> = {
  P: "#ff9cc4", // petal
  L: "#ffd6e8", // petal highlight
  D: "#e0679b", // petal shadow
  c: "#ffd84a", // flower centre
  b: "#5b3a29", // branch
  h: "#8b5a3c", // branch highlight
  g: "#4caf50", // leaf
  G: "#2e7d32", // leaf shadow
};

const FLOWER = [".P.P.", "PLDLP", ".DcD.", "PLDLP", ".P.P."];
const BUD = [".P.", "PLP", ".D."];
const LEAF = ["gg.", "gGg", ".gG"];

/** Petal sprites: two shapes, two tints. */
const PETALS = [
  [".PP.", "PLLP", "PLPD", ".PD."],
  [".PPP.", "PLLPD", ".PPD."],
  [".LL.", "LLPL", "LPPD", ".LD."],
  [".LLP.", "LLPPD", ".PPD."],
];

function stamp(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, p: number) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const col = PAL[rows[r][c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + c * p), Math.round(y + r * p), p, p);
    }
  }
}

/** Small deterministic random source (layout stays the same between redraws). */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pre-rendered petal sprites (pixel scale 1; the renderer scales them). */
export function petalSprites(): HTMLCanvasElement[] {
  return Array.from({ length: PETAL_KINDS }, (_, i) => {
    const rows = PETALS[i % PETALS.length];
    const c = document.createElement("canvas");
    c.width = rows[0].length;
    c.height = rows.length;
    stamp(c.getContext("2d")!, rows, 0, 0, 1);
    return c;
  });
}

/**
 * A blossoming branch along `length` px of local x, hanging below y = 0: a wavy branch with
 * flower clusters, leaves and a few dangling sprigs. `p` = CSS px per art pixel.
 */
export function drawGarland(ctx: CanvasRenderingContext2D, length: number, p: number, seed: number) {
  const rnd = seeded(seed);
  const base = 3 * p;
  const yAt = (x: number) => base + Math.round((Math.sin(x / 41 + seed) * 2 + Math.sin(x / 97) * 1.5) * (p / 2));
  // Branch: 2 art px thick with a highlight on top.
  for (let x = 0; x < length; x += p) {
    const y = yAt(x);
    ctx.fillStyle = PAL.h;
    ctx.fillRect(x, y, p, p);
    ctx.fillStyle = PAL.b;
    ctx.fillRect(x, y + p, p, p);
  }
  let x = 6 + rnd() * 20;
  while (x < length - 8) {
    const y = yAt(x);
    const corner = x < 120 || x > length - 120;
    const n = corner ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const fx = x + (i - (n - 1) / 2) * 6 * p + (rnd() - 0.5) * 4 * p;
      const fy = y - 2 * p + (rnd() - 0.3) * 4 * p;
      stamp(ctx, rnd() < 0.8 ? FLOWER : BUD, fx, fy, p);
    }
    if (rnd() < 0.45) stamp(ctx, LEAF, x + (rnd() < 0.5 ? -5 : 4) * p, y + p, p);
    // A dangling sprig now and then (longer near the corners).
    if (rnd() < (corner ? 0.5 : 0.16)) {
      const len = (corner ? 6 : 3) + Math.floor(rnd() * 8);
      for (let k = 0; k < len; k++) {
        ctx.fillStyle = k % 3 === 2 ? PAL.g : PAL.b;
        ctx.fillRect(Math.round(x + Math.sin(k / 2) * p * 0.5), y + (2 + k) * p, p, p);
      }
      stamp(ctx, FLOWER, x - 2 * p, y + (2 + len) * p, p);
    }
    x += (corner ? 14 : 24) + rnd() * (corner ? 18 : 40);
  }
}

/** Real Terraria plant frames (Tiles_3): grass blades and pink flowers. 16×20 art px, 18-px stride. */
const GRASS_FRAMES = [0, 1, 2, 3, 4, 5, 6];
const FLOWER_FRAMES = [17, 33, 34, 43, 44];

/**
 * Grass and flowers standing on y = 0 along `length` px of local x (pointing up). Uses the plant
 * sheet when loaded, otherwise pixel blades and blossoms.
 */
export function drawGrass(ctx: CanvasRenderingContext2D, length: number, p: number, seed: number, plants: CanvasImageSource | undefined) {
  const rnd = seeded(seed);
  // Turf line: Terraria grass top over dirt.
  for (let x = 0; x < length; x += p) {
    ctx.fillStyle = (x / p) % 5 === 0 ? "#3e9e3a" : "#4fc93b";
    ctx.fillRect(x, -2 * p, p, p);
    ctx.fillStyle = "#2e7d32";
    ctx.fillRect(x, -p, p, p);
  }
  let x = rnd() * 8;
  while (x < length - 8) {
    const flower = rnd() < 0.28;
    if (plants) {
      const frames = flower ? FLOWER_FRAMES : GRASS_FRAMES;
      const f = frames[Math.floor(rnd() * frames.length)];
      const k = p * 0.75;
      ctx.drawImage(plants, f * 18, 0, 16, 20, Math.round(x), Math.round(-2 * p - 20 * k + 2 * k), 16 * k, 20 * k);
      x += 7 * p + rnd() * 9 * p;
    } else {
      const h = 3 + Math.floor(rnd() * 5);
      for (let k = 0; k < h; k++) {
        ctx.fillStyle = k > h - 2 ? "#7be06a" : "#4caf50";
        ctx.fillRect(Math.round(x + (k > h / 2 ? p : 0)), -2 * p - (k + 1) * p, p, p);
      }
      if (flower) stamp(ctx, FLOWER, x - 2 * p, -2 * p - (h + 4) * p, p);
      x += 3 * p + rnd() * 6 * p;
    }
  }
}

// ── Snow map ─────────────────────────────────────────────────────────────────────────────

const SNOW: Record<string, string> = {
  w: "#ffffff", // snow
  s: "#dbe9ff", // snow shade
  b: "#a9c4ec", // snow shadow / outline
  i: "#cfeaff", // icicle
  I: "#8fc4ff", // icicle tip
  k: "#2b2b33", // coal
  o: "#ff8a2a", // carrot
  r: "#d23a3a", // scarf
  g: "#2e7d32", // wire / leaf
};

function stampWith(ctx: CanvasRenderingContext2D, pal: Record<string, string>, rows: readonly string[], x: number, y: number, p: number) {
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) {
      const col = pal[rows[r][c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + c * p), Math.round(y + r * p), p, p);
    }
}

/** Pixel snowflakes (pixel scale 1; the renderer scales them). */
const FLAKES = [
  [".w.", "www", ".w."],
  ["w.w", ".w.", "w.w"],
  ["..w..", ".sws.", "wwsww", ".sws.", "..w.."],
  ["ww", "ws"],
];

export function snowflakeSprites(): HTMLCanvasElement[] {
  return Array.from({ length: PETAL_KINDS }, (_, i) => {
    const rows = FLAKES[i % FLAKES.length];
    const c = document.createElement("canvas");
    c.width = rows[0].length;
    c.height = rows.length;
    stampWith(c.getContext("2d")!, SNOW, rows, 0, 0, 1);
    return c;
  });
}

const PIXEL_SNOWMAN = [
  "...kkk...",
  "...kkk...",
  "..kkkkk..",
  "..swwws..",
  ".swkwkws.",
  ".swwowws.",
  "..sswss..",
  ".rrrrrrr.",
  ".swwkwws.",
  "swwwwwwws",
  "swwwkwwws",
  "swwwwwwws",
  ".sswwwss.",
  "..sssss..",
];
const LIGHT_COLORS = ["#ff4a4a", "#4aff7a", "#ffd24a", "#4ab4ff", "#ff7af0"];

/**
 * Under the menu bar: a snow cap with icicles of varying length, and a string of festive lights
 * sagging between hooks (all hanging below y = 0 along `length` px).
 */
export function drawSnowTrim(ctx: CanvasRenderingContext2D, length: number, p: number, seed: number) {
  const rnd = seeded(seed);
  // Snow cap with a bumpy lower edge.
  for (let x = 0; x < length; x += p) {
    const bump = Math.round((Math.sin(x / 23 + seed) + Math.sin(x / 61)) * 0.8 + 1.5);
    ctx.fillStyle = SNOW.w;
    ctx.fillRect(x, 0, p, (2 + bump) * p);
    ctx.fillStyle = SNOW.b;
    ctx.fillRect(x, (2 + bump) * p, p, p);
  }
  // Icicles.
  let x = 4 + rnd() * 10;
  while (x < length) {
    const len = 2 + Math.floor(rnd() * (rnd() < 0.2 ? 9 : 5));
    for (let k = 0; k < len; k++) {
      ctx.fillStyle = k === len - 1 ? SNOW.I : SNOW.i;
      ctx.fillRect(Math.round(x), (4 + k) * p, k < len - 2 ? 2 * p : p, p);
    }
    x += 7 + rnd() * 18;
  }
  // String lights: a wire sagging between hooks with coloured bulbs.
  const span = 140;
  for (let x0 = 0; x0 < length; x0 += span) {
    const sag = 6 + rnd() * 4;
    for (let t = 0; t <= span; t += p) {
      const y = (6 + sag * Math.sin((t / span) * Math.PI)) * p;
      ctx.fillStyle = SNOW.g;
      ctx.fillRect(x0 + t, y, p, p);
    }
    for (let b = 14; b < span - 6; b += 22) {
      const y = (6 + sag * Math.sin((b / span) * Math.PI)) * p;
      ctx.fillStyle = LIGHT_COLORS[Math.floor(rnd() * LIGHT_COLORS.length)];
      ctx.fillRect(x0 + b - p, y + p, 2 * p, 3 * p);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(x0 + b - p, y + p, p, p);
    }
  }
}

export interface SnowArt {
  snowman?: CanvasImageSource & { width: number; height: number };
  snowball?: CanvasImageSource;
  present?: CanvasImageSource;
  tree?: CanvasImageSource & { width: number; height: number };
}

/**
 * Along the Dock's top edge (standing on y = 0): a snowbank with snowmen, snowball piles, presents
 * and the odd Christmas tree. Uses the game's sprites when loaded, pixel art otherwise.
 */
export function drawSnowGround(ctx: CanvasRenderingContext2D, length: number, p: number, seed: number, art: SnowArt) {
  const rnd = seeded(seed);
  // Snowbank.
  for (let x = 0; x < length; x += p) {
    const h = 3 + Math.round((Math.sin(x / 37 + seed) + 1) * 1.2 + (Math.sin(x / 13) + 1) * 0.4);
    ctx.fillStyle = SNOW.w;
    ctx.fillRect(x, -h * p, p, h * p);
    ctx.fillStyle = SNOW.s;
    ctx.fillRect(x, -p, p, p);
    ctx.fillStyle = SNOW.b;
    ctx.fillRect(x, -(h + 1) * p, p, p);
  }
  let x = 40 + rnd() * 120;
  while (x < length - 60) {
    const r = rnd();
    const ground = -3 * p;
    if (r < 0.35) {
      // A snowman (the game's Snow Balla, frame 0) or a pixel one.
      if (art.snowman) {
        const fh = art.snowman.height / 7;
        const k = p * 0.55;
        ctx.drawImage(art.snowman, 0, 0, art.snowman.width, fh, Math.round(x), Math.round(ground - fh * k), art.snowman.width * k, fh * k);
      } else stampWith(ctx, SNOW, PIXEL_SNOWMAN, x, ground - PIXEL_SNOWMAN.length * p, p);
      x += 160 + rnd() * 260;
    } else if (r < 0.6) {
      // A little pile of snowballs.
      for (let i = 0; i < 3; i++) {
        const bx = x + i * 6 * p - (i === 2 ? 3 * p : 0);
        const by = ground - (i === 2 ? 10 : 5) * p;
        if (art.snowball) ctx.drawImage(art.snowball, Math.round(bx), Math.round(by), 6 * p, 6 * p);
        else {
          ctx.fillStyle = SNOW.w;
          ctx.fillRect(bx, by, 5 * p, 5 * p);
          ctx.fillStyle = SNOW.b;
          ctx.fillRect(bx, by + 4 * p, 5 * p, p);
        }
      }
      x += 90 + rnd() * 160;
    } else if (r < 0.82) {
      // Presents.
      for (let i = 0; i < 2; i++) {
        const px = x + i * 9 * p;
        if (art.present) ctx.drawImage(art.present, Math.round(px), Math.round(ground - 10 * p), 8 * p, 10 * p);
        else {
          ctx.fillStyle = LIGHT_COLORS[(i + Math.floor(rnd() * 5)) % LIGHT_COLORS.length];
          ctx.fillRect(px, ground - 8 * p, 8 * p, 8 * p);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(px + 3 * p, ground - 8 * p, 2 * p, 8 * p);
        }
      }
      x += 100 + rnd() * 160;
    } else {
      // A small Christmas tree.
      if (art.tree) {
        const k = p * 0.5;
        ctx.drawImage(art.tree, Math.round(x), Math.round(ground - art.tree.height * k), art.tree.width * k, art.tree.height * k);
      } else {
        for (let row = 0; row < 12; row++) {
          ctx.fillStyle = row % 3 === 0 ? "#1f6b2a" : "#2e8a3a";
          const half = Math.floor(row / 2) + 1;
          ctx.fillRect(x + (7 - half) * p, ground - (16 - row) * p, half * 2 * p, p);
        }
        ctx.fillStyle = "#6b4a2a";
        ctx.fillRect(x + 6 * p, ground - 4 * p, 2 * p, 4 * p);
      }
      x += 220 + rnd() * 300;
    }
  }
}

export interface DecorOptions {
  garland: boolean;
  grass: boolean;
  plants?: CanvasImageSource;
  /** Which map: cherry blossom (default), snow or the chess battlefield. */
  map?: "sakura" | "snow" | "chess";
  snow?: SnowArt;
}

/** The fallen pieces are about the Dock's height (a typical one when the Dock is hidden or at a side). */
export function chessPieceSize(g: AmbientGeometry): number {
  // (Capped by the screen's height too, for the small previews in the Maps tab.)
  return Math.round(Math.min(84, g.height * 0.2, Math.max(36, g.dockEdge === "bottom" ? g.dockSize * 0.9 : 56)));
}

/** Draw every decoration for this screen layout (the canvas covers the whole display). */
export function drawDecor(ctx: CanvasRenderingContext2D, g: AmbientGeometry, o: DecorOptions) {
  const p = 2;
  ctx.clearRect(0, 0, g.width, g.height);
  ctx.imageSmoothingEnabled = false;
  const snow = o.map === "snow";
  // The chess map's chains and lanterns sway, so they're drawn each frame (chessMap.ts).
  if (o.map === "chess") {
    if (!o.grass) return;
    ctx.save();
    if (g.dockEdge === "left") {
      ctx.translate(g.dockSize, g.height);
      ctx.rotate(-Math.PI / 2);
      drawChessEdge(ctx, g.height - g.menuBar, p, 13);
    } else if (g.dockEdge === "right") {
      ctx.translate(g.width - g.dockSize, g.menuBar);
      ctx.rotate(Math.PI / 2);
      drawChessEdge(ctx, g.height - g.menuBar, p, 17);
    } else {
      ctx.translate(0, g.height - (g.dockEdge === "bottom" ? g.dockSize : 0));
      drawChessGround(ctx, g.width, p, 11, chessPieceSize(g));
    }
    ctx.restore();
    return;
  }
  if (o.garland) {
    ctx.save();
    ctx.translate(0, g.menuBar);
    if (snow) drawSnowTrim(ctx, g.width, p, 7);
    else drawGarland(ctx, g.width, p, 7);
    ctx.restore();
  }
  if (!o.grass) return;
  ctx.save();
  switch (g.dockEdge) {
    case "left":
      // A blossoming vine (or icicles and lights) up the edge beside the Dock, onto the desktop (+x).
      ctx.translate(g.dockSize, g.height);
      ctx.rotate(-Math.PI / 2);
      if (snow) drawSnowTrim(ctx, g.height - g.menuBar, p, 13);
      else drawGarland(ctx, g.height - g.menuBar, p, 13);
      break;
    case "right":
      // Down the edge beside the Dock, hanging onto the desktop (−x).
      ctx.translate(g.width - g.dockSize, g.menuBar);
      ctx.rotate(Math.PI / 2);
      if (snow) drawSnowTrim(ctx, g.height - g.menuBar, p, 17);
      else drawGarland(ctx, g.height - g.menuBar, p, 17);
      break;
    default:
      // Grass (or a snowbank) on top of the Dock area (or the screen bottom if the Dock hides).
      ctx.translate(0, g.height - (g.dockEdge === "bottom" ? g.dockSize : 0));
      if (snow) drawSnowGround(ctx, g.width, p, 11, o.snow ?? {});
      else drawGrass(ctx, g.width, p, 11, o.plants);
  }
  ctx.restore();
}

// ── In the menu bar (the crown window) ──────────────────────────────────────────────────────

/**
 * Along the very top edge of the screen, inside the menu bar: a thin vine (or snow cap) kept to
 * the top few pixels so the menu text stays readable.
 */
function drawTopEdge(ctx: CanvasRenderingContext2D, length: number, p: number, map: "sakura" | "snow", seed: number) {
  const rnd = seeded(seed);
  if (map === "snow") {
    for (let x = 0; x < length; x += p) {
      const bump = Math.round(Math.sin(x / 19 + seed) + 1);
      ctx.fillStyle = SNOW.w;
      ctx.fillRect(x, 0, p, (1 + bump) * p);
      ctx.fillStyle = SNOW.s;
      ctx.fillRect(x, (1 + bump) * p, p, p / 2);
    }
    for (let x = 5 + rnd() * 9; x < length; x += 9 + rnd() * 16) {
      const len = 1 + Math.floor(rnd() * 2);
      ctx.fillStyle = SNOW.i;
      ctx.fillRect(Math.round(x), 2 * p, p, len * p);
    }
    return;
  }
  // A blossoming vine just under the top edge, with small blossoms and leaves.
  for (let x = 0; x < length; x += p) {
    const y = Math.round((1 + Math.sin(x / 37 + seed)) * (p / 2));
    ctx.fillStyle = PAL.b;
    ctx.fillRect(x, y, p, p);
  }
  for (let x = 4 + rnd() * 12; x < length; x += 18 + rnd() * 34) {
    if (rnd() < 0.7) stamp(ctx, BUD, x, -p / 2, p);
    else stamp(ctx, LEAF, x, 0, p);
  }
}

/** The band filling the menu bar for each map: dark enough that the white menu text stays crisp. */
function drawBand(ctx: CanvasRenderingContext2D, width: number, h: number, map: "sakura" | "snow" | "chess", p: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // Cherry Blossom is a soft, see-through pink so the blossoms (and the desktop) show through.
  const [top, bottom] = map === "snow" ? ["#1d3150", "#2a4670"] : map === "chess" ? ["#141418", "#24252b"] : ["rgba(255, 150, 196, 0.44)", "rgba(242, 96, 158, 0.54)"];
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, h);
  const rnd = seeded(map === "snow" ? 41 : map === "chess" ? 43 : 47);
  if (map === "chess") {
    // A faint checkerboard, like an old board under dust.
    const sq = Math.max(6, Math.round(h / 3));
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    for (let y = 0; y < h; y += sq) for (let x = (y / sq) % 2 ? sq : 0; x < width; x += sq * 2) ctx.fillRect(x, y, sq, sq);
  } else if (map === "snow") {
    // Faint snowflakes.
    ctx.fillStyle = "rgba(220, 235, 255, 0.16)";
    for (let x = 6 + rnd() * 20; x < width; x += 22 + rnd() * 40) {
      const y = 3 + rnd() * (h - 8);
      ctx.fillRect(x, y + p, 3 * p, p / 2);
      ctx.fillRect(x + p, y, p / 2, 3 * p);
    }
  } else {
    // Faint drifting petals.
    ctx.fillStyle = "rgba(255, 190, 220, 0.18)";
    for (let x = 4 + rnd() * 18; x < width; x += 18 + rnd() * 36) {
      const y = 2 + rnd() * (h - 6);
      ctx.fillRect(x, y, 2 * p, p);
      ctx.fillRect(x + p / 2, y - p / 2, p, 2 * p);
    }
  }
  // A thin bevel: light along the top, a darker line along the bottom edge.
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(0, 0, width, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, h - 1, width, 1);
}

/**
 * Everything a map puts in and under the menu bar, drawn in the crown window (which starts at the
 * top of the screen, just below the menu bar's own window, so the menu text and icons draw over
 * it), all inside the bar: a themed band filling it, then garlands, snow and lights, or (chess)
 * the rail its chains hang from; the chains and lanterns sway, so they're drawn each frame
 * (chessMap.ts).
 */
export function drawMenuBarDecor(ctx: CanvasRenderingContext2D, width: number, menuBar: number, map: "sakura" | "snow" | "chess") {
  const p = 2;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = false;
  drawBand(ctx, width, menuBar, map, p);
  if (map === "chess") {
    // An iron rail along the top edge, with rivets: where the chains are anchored.
    ctx.fillStyle = "#2a2e37";
    ctx.fillRect(0, 0, width, p * 1.5);
    ctx.fillStyle = "#555b67";
    for (let x = 6; x < width; x += 24) ctx.fillRect(x, 0, p, p);
    return;
  }
  // Everything stays inside the bar (nothing hangs over the apps below it).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, menuBar);
  ctx.clip();
  if (map === "snow") {
    // The snow cap along the top, icicles and a string of lights across the bar.
    drawSnowTrim(ctx, width, p, 7);
  } else {
    drawTopEdge(ctx, width, p, map, 3);
    // Two garlands woven together along the bar's lower edge.
    ctx.translate(0, menuBar - 14);
    drawGarland(ctx, width, p, 23);
    ctx.translate(0, -p);
    drawGarland(ctx, width, p, 7);
  }
  ctx.restore();
}

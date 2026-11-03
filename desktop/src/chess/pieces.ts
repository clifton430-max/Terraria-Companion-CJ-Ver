// Original 16×16 pixel-art chess pieces in a Terraria-ish style (dark outline, flat fill, a
// highlight column and a shaded base), in two palettes: pearlwood/marble for White and
// ebonwood/obsidian for Black. Rendered once per piece and colour, then scaled with no smoothing.

import type { Color, PieceType } from "./rules";

// '#' outline, 'o' fill, '+' highlight, 's' shade, '.' transparent.
export const PIECE_ART: Record<PieceType, readonly string[]> = {
  p: [
    "................",
    "................",
    "................",
    "......####......",
    ".....#o+oo#.....",
    ".....#+ooo#.....",
    ".....#oooo#.....",
    "......#oo#......",
    ".....######.....",
    "......#+o#......",
    "......#+o#......",
    ".....#o+oo#.....",
    "....#oooooo#....",
    "...##########...",
    "...#ssssssss#...",
    "...##########...",
  ],
  r: [
    "................",
    "...##..##..##...",
    "...#o##oo##o#...",
    "...#oooooooo#...",
    "...##########...",
    "....#o+ooos#....",
    "....#o+ooos#....",
    "....#o+ooos#....",
    "....#o+ooos#....",
    "....#o+ooos#....",
    "...##########...",
    "...#oooooooo#...",
    "..#oooooooooo#..",
    "..############..",
    "..#ssssssssss#..",
    "..############..",
  ],
  n: [
    "................",
    "......##.#......",
    ".....#oo#o#.....",
    "....#o+oooo#....",
    "...#o#+ooooo#...",
    "..#o+oooooooo#..",
    "..#oooo##ooooo#.",
    "...####.#+oooo#.",
    "........#+oooo#.",
    ".......#o+ooo#..",
    "......#o+ooooo#.",
    ".....#oooooooo#.",
    "....###########.",
    "....#ooooooooo#.",
    "....#sssssssss#.",
    "....###########.",
  ],
  b: [
    "................",
    ".......##.......",
    "......#oo#......",
    ".....#o+o##.....",
    ".....#o+#o#.....",
    ".....#o#oo#.....",
    ".....#+ooo#.....",
    "......#oo#......",
    ".....######.....",
    "......#+o#......",
    "......#+o#......",
    ".....#o+oo#.....",
    "....#oooooo#....",
    "...##########...",
    "...#ssssssss#...",
    "...##########...",
  ],
  q: [
    "................",
    "..#...#..#...#..",
    ".#+#.#+##+#.#+#.",
    "..#o##oooo##o#..",
    "..#o+oooooooo#..",
    "...#o+oooooo#...",
    "...##########...",
    "....#o+ooos#....",
    "....#o+ooos#....",
    ".....#+oos#.....",
    "....#o+ooos#....",
    "...#oooooooo#...",
    "...##########...",
    "..#oooooooooo#..",
    "..#ssssssssss#..",
    "..############..",
  ],
  k: [
    ".......##.......",
    "......#+o#......",
    ".....#o+ooo#....",
    "......#+o#......",
    "...####+o####...",
    "..#o+oooooooo#..",
    "..#o+oooooooo#..",
    "...#o+oooooo#...",
    "...##########...",
    "....#o+ooos#....",
    "....#o+ooos#....",
    "...#oooooooo#...",
    "...##########...",
    "..#oooooooooo#..",
    "..#ssssssssss#..",
    "..############..",
  ],
};

export const PALETTE: Record<Color, Record<"#" | "o" | "+" | "s", string>> = {
  w: { "#": "#3b2a1c", o: "#eadfc6", "+": "#fffaf0", s: "#b49c74" },
  b: { "#": "#0e0a14", o: "#4c3d63", "+": "#8a76ad", s: "#2a2038" },
};

const cache = new Map<string, HTMLCanvasElement>();

/** A light rim around Black's pieces so they stay readable on dark squares of any material. */
export const RIM: Record<Color, string | null> = { w: null, b: "rgba(255, 238, 205, 0.8)" };

/** The art with a one-pixel rim (as an 18×18 grid): pixels next to the piece become 'r'. */
export function rimmed(rows: readonly string[]): string[] {
  const at = (x: number, y: number) => (y >= 0 && y < 16 && x >= 0 && x < 16 ? rows[y][x] : ".");
  const out: string[] = [];
  for (let y = -1; y < 17; y++) {
    let line = "";
    for (let x = -1; x < 17; x++) {
      const c = at(x, y);
      if (c !== ".") line += c;
      else line += [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== ".") ? "r" : ".";
    }
    out.push(line);
  }
  return out;
}

/** Render 16×16 art (in the piece alphabet) as an 18×18 canvas with its rim, in a colour's palette. */
export function renderArt(rows: readonly string[], color: Color): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 18;
  c.height = 18;
  const ctx = c.getContext("2d")!;
  const pal: Record<string, string | null> = { ...PALETTE[color], r: RIM[color] };
  rimmed(rows).forEach((row, y) => {
    for (let x = 0; x < 18; x++) {
      const fill = pal[row[x]];
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

/** An 18×18 canvas of the piece, with its rim (cached). */
export function pieceSprite(color: Color, type: PieceType): HTMLCanvasElement {
  const key = color + type;
  let c = cache.get(key);
  if (c) return c;
  c = renderArt(PIECE_ART[type], color);
  cache.set(key, c);
  return c;
}

/** Draw a piece centred at (x, y), `size` px tall, rotated and scaled. */
export function drawPiece(ctx: CanvasRenderingContext2D, color: Color, type: PieceType, x: number, y: number, size: number, rot = 0, scale = 1, alpha = 1) {
  const s = pieceSprite(color, type);
  const k = size * scale * (18 / 16);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(s, -k / 2, -k / 2, k, k);
  ctx.restore();
}

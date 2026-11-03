// Original 16×16 pixel art for weapon archetypes. Each archetype has one shape; weapons
// recolour it through a small palette, so new weapons need data, not new art.
//
// Shape keys: k outline · a metal/primary · A primary shade · w highlight/string ·
// b wood/handle · B handle shade · c accent (gem, guard, glow)

export const ART_SIZE = 16;

export type ShapeId = "sword" | "bow" | "gun" | "staff" | "lantern" | "pickaxe";

export interface Pivot {
  /** Grip point in art pixels, used as the rotation origin when held. */
  x: number;
  y: number;
}

export const SHAPES: Record<ShapeId, { rows: string[]; grip: Pivot; tip: Pivot }> = {
  // Blade points up-right (−45°) from a grip in the lower-left.
  // Pickaxe: handle from bottom-left, head across the top-right (same orientation as swords).
  pickaxe: {
    rows: [
      "....kk..........",
      "...kwak.........",
      "....kaak........",
      ".....kaak.......",
      "......kaak......",
      ".......kaAk.....",
      "......kbkAak....",
      ".....kbk.kaak...",
      "....kbk...kaak..",
      "...kbk.....kaak.",
      "..kbk.......kawk",
      ".kbk.........kk.",
      "kbk.............",
      "kk..............",
      "................",
      "................",
    ],
    grip: { x: 2.5, y: 11.5 },
    tip: { x: 9, y: 5 },
  },
  sword: {
    rows: [
      ".............kk.",
      "............kwak",
      "...........kwak.",
      "..........kwak..",
      ".........kwak...",
      "........kwak....",
      ".......kwak.....",
      "......kwak......",
      ".kk..kwak.......",
      ".kckkwak........",
      "..kccak.........",
      "...kck..........",
      "..kbkck.........",
      ".kbk.kck........",
      "kbk...kk........",
      "kk..............",
    ],
    grip: { x: 2.5, y: 13.5 },
    tip: { x: 14.5, y: 1.5 },
  },
  // Vertical bow facing right; the string (column 4) is drawn separately so it can be pulled.
  bow: {
    rows: [
      "....kk..........",
      "....kbkk........",
      "......kbk.......",
      ".......kbk......",
      "........kbk.....",
      ".........kbk....",
      ".........kbBk...",
      "..........kcck..",
      "..........kcck..",
      ".........kbBk...",
      ".........kbk....",
      "........kbk.....",
      ".......kbk......",
      "......kbk.......",
      "....kbkk........",
      "....kk..........",
    ],
    grip: { x: 11.5, y: 8 },
    tip: { x: 4.5, y: 8 }, // nocking point of the string at rest
  },
  // Barrel points right (0°).
  gun: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      ".kkkkkkkkkkkkkk.",
      "kaaaaaaaaaaaaawk",
      "kAAAAAAAAAAAAAk.",
      "kkAkbbbkkkkkkk..",
      ".kkkbbbk.kk.....",
      "...kbbBkkck.....",
      "...kbbBk.kk.....",
      "..kbbBBk........",
      "..kbbBk.........",
      "..kkkkk.........",
      "................",
      "................",
    ],
    grip: { x: 4.5, y: 10 },
    tip: { x: 15.5, y: 5.5 }, // muzzle
  },
  // Shaft points up-right (−45°) to a gem.
  staff: {
    rows: [
      "............kk..",
      "...........kcck.",
      "..........kcwcck",
      "..........kcccck",
      "...........kcck.",
      "..........kbkk..",
      ".........kbk....",
      "........kbk.....",
      ".......kbk......",
      "......kBk.......",
      ".....kbk........",
      "....kbk.........",
      "...kBk..........",
      "..kbk...........",
      ".kbk............",
      ".kk.............",
    ],
    grip: { x: 3, y: 12.5 },
    tip: { x: 12.5, y: 2.5 },
  },
  // Lantern hanging from its ring.
  lantern: {
    rows: [
      "......kkkk......",
      ".....kk..kk.....",
      "......kkkk......",
      ".....kBbbBk.....",
      "....kkkkkkkk....",
      "....kacwwcak....",
      "....kacwwcak....",
      "....kaccccak....",
      "....kaccccak....",
      "....kkkkkkkk....",
      ".....kBbbBk.....",
      "......kkkk......",
      "................",
      "................",
      "................",
      "................",
    ],
    grip: { x: 8, y: 1 },
    tip: { x: 8, y: 7 },
  },
};

export type WeaponPalette = Partial<Record<"a" | "A" | "w" | "b" | "B" | "c", string>>;

export const BASE_PALETTE: Record<string, string | null> = {
  ".": null,
  k: "#1d1424",
  a: "#c9d3dc",
  A: "#8d9aa8",
  w: "#f4f7fa",
  b: "#8a5428",
  B: "#5e3618",
  c: "#e0b84a",
};

/** Bow string pixels for a given pull (0 = at rest, 1 = fully drawn), as [x, y] art pixels. */
export function bowString(pull: number): [number, number][] {
  const p = Math.min(Math.max(pull, 0), 1);
  const restX = 4;
  const nockX = restX - Math.round(p * 3);
  const pts: [number, number][] = [];
  for (let y = 1; y <= 14; y++) {
    // Two straight segments from the limb tips (y=1, y=14) to the nock (y≈7.5).
    const t = y <= 7 ? (y - 1) / 6.5 : (14 - y) / 6.5;
    pts.push([Math.round(restX + (nockX - restX) * t), y]);
  }
  return pts;
}

/** Resolve a shape cell to a colour using a weapon palette. */
export function cellColor(key: string, palette: WeaponPalette): string | null {
  if (key in palette) return palette[key as keyof WeaponPalette] ?? null;
  return BASE_PALETTE[key] ?? null;
}

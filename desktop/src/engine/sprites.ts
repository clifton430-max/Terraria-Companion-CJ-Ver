// Original placeholder pixel art for the companion: a small green-tunic adventurer.
// Each frame is 16×24 pixels, written as rows of palette keys and facing right.
// Frames are composed from an upper body and legs, bottom-aligned so the feet
// always sit on the last row (except airborne poses).

import type { Anim } from "./animation";

export const SPRITE_W = 16;
export const SPRITE_H = 24;

export const PALETTE: Record<string, string | null> = {
  ".": null,
  k: "#1d1424", // outline
  H: "#9a6232", // hair highlight
  h: "#6b3f1f", // hair
  s: "#f2c48d", // skin
  S: "#d29563", // skin shadow
  T: "#2f6f34", // tunic shadow
  t: "#4b9b43", // tunic
  b: "#5a3a1a", // belt
  g: "#f0c94a", // buckle
  p: "#3d4f86", // trousers
  P: "#2a365e", // trousers shadow
  o: "#4b2e1b", // boots
};

const UPPER = [
  "................",
  ".....kkkkkkk....",
  "....kHHHHHHHk...",
  "....kHhhhhhhk...",
  "....khhsssssk...",
  "....khssssksk...",
  "....khssssssk...",
  "....kSssssssk...",
  ".....kSSSSSk....",
  "....kTttttttk...",
  "...kTtttttttTk..",
  "...kTtttttttTk..",
  "...kTtttttttTk..",
  "...kbbbbgbbbbk..",
  "...ksTtttttTsk..",
  "...kkTtttttTkk..",
];

/** Arms raised, used while falling or being carried. */
const UPPER_ARMS_UP = [
  "................",
  ".....kkkkkkk....",
  "....kHHHHHHHk...",
  "....kHhhhhhhk...",
  "....khhsssssk...",
  "....khssssksk...",
  "....khssssssk...",
  ".ks.kSssssssk.sk",
  "..ks.kSSSSSk.sk.",
  "..kskTttttttksk.",
  "...kTtttttttTk..",
  "...kTtttttttTk..",
  "...kTtttttttTk..",
  "...kbbbbgbbbbk..",
  "...kTtttttttTk..",
  "...kkTtttttTkk..",
];

/** Front arm held straight out (shooting, bow, end of a sword swing). Hand at (14.5, 10.5). */
const UPPER_POINT = [
  ...UPPER.slice(0, 9),
  "....kTttttttkkk.",
  "...kTtttttttTTsk",
  "...kTtttttttkkk.",
  "...kTtttttttk...",
  "...kbbbbgbbbbk..",
  "...ksTtttttTk...",
  "...kkTtttttTkk..",
];

/** Front arm raised up and forward (casting, sword wind-up). Hand at (14.5, 5.5). */
const UPPER_RAISE = [
  ...UPPER.slice(0, 5),
  "....khssssksk.sk",
  "....khssssssk.Tk",
  "....kSssssssk.Tk",
  ".....kSSSSSkTk..",
  "....kTtttttTk...",
  "...kTtttttttTk..",
  "...kTtttttttTk..",
  "...kTtttttttTk..",
  "...kbbbbgbbbbk..",
  "...ksTtttttTk...",
  "...kkTtttttTkk..",
];

/** Drop the given rows: removing torso rows shortens the body for bob/squash poses. */
const without = (rows: string[], drop: number[]) => rows.filter((_, i) => !drop.includes(i));

const LEGS_STAND = [
  "....kpppppppk...",
  "....kpppPpppk...",
  "....kpppkpppk...",
  "....kpppkpppk...",
  "....kPppkPppk...",
  "....koookoook...",
  "....kooookooook.",
  "....kkkkk.kkkkk.",
];

const LEGS_STRIDE_A = [
  "....kpppppppk...",
  "...kpppkkpppk...",
  "...kppk..kpppk..",
  "..kppk....kppk..",
  "..kPpk....kPpk..",
  ".kook.....kook..",
  ".koook....kooook",
  ".kkkkk....kkkkkk",
];

/** Same silhouette as stride A with the shading swapped so the cycle reads as alternating legs. */
const LEGS_STRIDE_B = [
  "....kpppppppk...",
  "...kPPPkkpppk...",
  "...kPPk..kpppk..",
  "..kPPk....kppk..",
  "..kPPk....kppk..",
  ".kook.....kook..",
  ".koook....kooook",
  ".kkkkk....kkkkkk",
];

const LEGS_JUMP = [
  "....kpppppppk...",
  "...kpppppppppk..",
  "...kpppk.kpppk..",
  "...kook..kook...",
  "...kkkk..kkkk...",
];

const LEGS_FALL = [
  "....kpppppppk...",
  "....kpppkpppk...",
  "....kppk.kppk...",
  "....kppk.kppk...",
  "....kPpk.kPpk...",
  "....kook.kook...",
  "....kook.kook...",
  "....kkkk.kkkk...",
];

const LEGS_LAND = [
  "...kpppppppppk..",
  "...kppppkppppk..",
  "..kpppk..kpppk..",
  "..kppk....kppk..",
  "..kPpk....kPpk..",
  ".kook......kook.",
  ".kooook...kooook",
  ".kkkkkk...kkkkkk",
];

/** Stack upper body over legs and pad the top so the result is exactly SPRITE_H rows. */
export function compose(upper: string[], legs: string[], bottomPad = 0): string[] {
  const rows = [...upper, ...legs, ...Array(bottomPad).fill(".".repeat(SPRITE_W))];
  if (rows.length > SPRITE_H) throw new Error(`frame has ${rows.length} rows (max ${SPRITE_H})`);
  return [...Array(SPRITE_H - rows.length).fill(".".repeat(SPRITE_W)), ...rows];
}

const UPPER_BOB = without(UPPER, [11]);
const UPPER_SQUASH = without(UPPER, [0, 11, 12]);

export const FRAMES: Record<Anim, string[][]> = {
  idle: [compose(UPPER, LEGS_STAND), compose(UPPER_BOB, LEGS_STAND)],
  walk: [
    compose(UPPER, LEGS_STRIDE_A),
    compose(UPPER_BOB, LEGS_STAND),
    compose(UPPER, LEGS_STRIDE_B),
    compose(UPPER_BOB, LEGS_STAND),
  ],
  jump: [compose(UPPER, LEGS_JUMP, 2)],
  fall: [compose(UPPER_ARMS_UP, LEGS_FALL)],
  land: [compose(UPPER_SQUASH, LEGS_LAND)],
  // Attack poses: frame choice follows attack progress (see attackFrameIndex).
  swing: [compose(UPPER_RAISE, LEGS_STAND), compose(UPPER_POINT, LEGS_STAND)],
  shoot: [compose(UPPER_POINT, LEGS_STAND)],
  cast: [compose(UPPER_RAISE, LEGS_STAND)],
};

/** Render a frame to a 1×-scale canvas. Mirrors horizontally when `flip` is set. */
export function renderFrame(frame: string[], flip: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_W;
  canvas.height = SPRITE_H;
  const ctx = canvas.getContext("2d")!;
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = PALETTE[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(flip ? SPRITE_W - 1 - x : x, y, 1, 1);
    }
  });
  return canvas;
}

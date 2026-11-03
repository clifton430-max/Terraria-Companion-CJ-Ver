// Original pixel art for the training sandbox: a burlap dummy on a post, and a minion wisp.

export const DUMMY_ROWS = [
  "................",
  ".....kkkkkk.....",
  "....kssssssk....",
  "....ksSssSsk....",
  "....kssssssk....",
  "....ksSSSSsk....",
  ".....kssssk.....",
  "..kkkkkbbkkkkk..",
  ".kbbbbbbbbbbbbk.",
  "..kkkksssskkkk..",
  "....kssSsssk....",
  "....ksssSssk....",
  "....kssssssk....",
  "....kSsssSsk....",
  ".....kssssk.....",
  "......kbbk......",
  "......kbbk......",
  "......kbBk......",
  "......kbBk......",
  "......kbBk......",
  "......kbBk......",
  "....kkkbBkkk....",
  "...kbbbbbbbbk...",
  "...kkkkkkkkkk...",
];

export const DUMMY_PALETTE: Record<string, string | null> = {
  ".": null,
  k: "#1d1424",
  s: "#cfae72",
  S: "#a07f45",
  b: "#8a5428",
  B: "#5e3618",
};

export const MINION_ROWS = [
  "..kkkk..",
  ".kccwck.",
  "kcwwwcck",
  "kcwkwkck",
  "kcccccck",
  ".kcccck.",
  "..kcck..",
  "...kk...",
];

export const MINION_SIZE = 8;

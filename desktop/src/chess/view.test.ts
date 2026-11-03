import { describe, expect, it } from "vitest";
import { CHARACTER_IDS } from "../characters/roster";
import { CHEERS, CheerLimiter, GLOBAL_GAP, PER_ACTOR_GAP } from "./cheers";
import { PIECE_ART } from "./pieces";
import { newGame, parseSquare as S, play, type Game } from "./rules";
import { chairBox, cheerEvents, chessLayout, flipWidth, geometryFor, MIN_BOARD, movePairs, normalizeChess, squareAt, statusText } from "./view";
import { luminance, MATERIALS } from "./materials";
import { PALETTE } from "./pieces";

const run = (g: Game, ...moves: string[]) => {
  for (const m of moves) g = play(g, S(m.slice(0, 2)), S(m.slice(2, 4)), (m[4] as "q") || undefined)!.game;
  return g;
};

describe("layout", () => {
  it("fits on small and large screens, resting near the bottom", () => {
    for (const [W, H] of [[1280, 690], [1440, 870], [1920, 1050], [2560, 1400], [1024, 640], [800, 560]]) {
      const l = chessLayout(W, H);
      expect(l.left, `${W}x${H}`).toBeGreaterThanOrEqual(0);
      expect(l.left + l.width, `${W}x${H}`).toBeLessThanOrEqual(W);
      expect(l.top).toBeGreaterThanOrEqual(0);
      expect(l.ground).toBeLessThanOrEqual(H);
      expect(H - l.ground).toBeLessThan(12);
      expect(l.sq * 8 + 2 * l.frame).toBe(l.board.size);
      expect(l.sq).toBeGreaterThanOrEqual(20);
      // The clickable area stays inside the overlay's hitbox limit.
      expect(l.width).toBeLessThanOrEqual(1000);
      expect(l.height).toBeLessThanOrEqual(1000);
    }
  });
  it("maps clicks to squares (White at the bottom)", () => {
    const l = chessLayout(1440, 870);
    const g = geometryFor(l);
    for (const name of ["a1", "h1", "a8", "h8", "e4", "d5"]) {
      const c = g.center(S(name));
      expect(squareAt(l, c.x, c.y)).toBe(S(name));
    }
    expect(squareAt(l, l.board.x - 5, l.board.y + 50)).toBeNull();
  });
  it("puts each team's supporters beside the board on its own side", () => {
    const l = chessLayout(1440, 870);
    const g = geometryFor(l);
    expect(g.spot("w", 0).x).toBeLessThan(l.board.x);
    expect(g.spot("w", 1).x).toBeLessThan(g.spot("w", 0).x);
    expect(g.spot("b", 0).x).toBeGreaterThan(l.board.x + l.board.size);
    expect(g.spot("b", 1).x).toBeGreaterThan(g.spot("b", 0).x);
    expect(g.spot("w", 1).x).toBeGreaterThan(0);
  });
});

describe("resizing", () => {
  it("maximize uses most of the screen; restore and saved sizes are clamped; squares stay square", () => {
    for (const [W, H] of [[1440, 870], [2560, 1400], [1024, 640]]) {
      const max = chessLayout(W, H, { maximized: true });
      expect(max.board.size).toBeGreaterThan(H * 0.8);
      expect(max.left).toBeGreaterThanOrEqual(0);
      expect(max.left + max.width).toBeLessThanOrEqual(W);
      expect(max.top).toBeGreaterThanOrEqual(0);
      const tiny = chessLayout(W, H, { board: 50 });
      expect(tiny.board.size).toBeGreaterThanOrEqual(MIN_BOARD - 8);
      const huge = chessLayout(W, H, { board: 99999 });
      expect(huge.board.size).toBeLessThanOrEqual(max.board.size);
      const mid = chessLayout(W, H, { board: 500 });
      expect(Math.abs(mid.board.size - 500)).toBeLessThan(10);
      for (const l of [max, tiny, huge, mid]) expect(l.sq * 8 + 2 * l.frame).toBe(l.board.size);
    }
  });
  it("can be moved anywhere on screen like a window, and back to its spot", () => {
    for (const [W, H] of [[1440, 870], [1024, 640]]) {
      const home = chessLayout(W, H);
      expect(chessLayout(W, H, { x: -1, y: -1 })).toEqual(home);
      for (const [x, y] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.3]]) {
        for (const opts of [{ x, y }, { x, y, board: 400 }, { x, y, maximized: true }]) {
          const l = chessLayout(W, H, opts);
          expect(l.left).toBeGreaterThanOrEqual(0);
          expect(l.top).toBeGreaterThanOrEqual(0);
          expect(l.left + l.width).toBeLessThanOrEqual(W);
          expect(l.ground + 10).toBeLessThanOrEqual(H); // room for the shelf under it
          expect(l.sq * 8 + 2 * l.frame).toBe(l.board.size);
        }
      }
      const topLeft = chessLayout(W, H, { x: 0, y: 0 });
      expect(topLeft.left).toBe(4);
      expect(topLeft.top).toBe(4);
    }
    expect(normalizeChess({ x: 0.3, y: 0.6 })).toMatchObject({ x: 0.3, y: 0.6 });
    expect(normalizeChess({ x: 0.3, y: 9 })).toMatchObject({ x: -1, y: -1 });
  });
  it("maps clicks on a flipped board (playing Black)", () => {
    const l = chessLayout(1440, 870);
    const v = { flipped: true };
    const g = geometryFor(l, v);
    for (const name of ["a1", "h8", "e4"]) {
      const c = g.center(S(name));
      expect(squareAt(l, c.x, c.y, v)).toBe(S(name));
    }
    // a1 is at the top right when Black sits at the bottom.
    expect(g.center(S("a1")).x).toBeGreaterThan(g.center(S("h1")).x);
    expect(g.center(S("a1")).y).toBeLessThan(g.center(S("a8")).y);
  });
  it("seats the opponent on a chair beside the board, inside the layout", () => {
    for (const board of [260, 560, 900]) {
      const l = chessLayout(1920, 1050, { board });
      const c = chairBox(l, 112);
      expect(c.x).toBeGreaterThan(l.board.x + l.board.size);
      expect(c.x + c.w).toBeLessThanOrEqual(l.left + l.width);
      expect(c.y + c.h).toBeCloseTo(l.ground);
      const g = geometryFor(l, { flipped: false }, { h: 112 });
      expect(g.seat!.y).toBeLessThan(l.ground);
      expect(g.seat!.x).toBeGreaterThan(c.x);
    }
  });
  it("normalizes saved settings", () => {
    expect(normalizeChess(undefined)).toMatchObject({ board: 0, maximized: false, material: "marble", mode: "local" });
    expect(normalizeChess({ material: "lava", mode: "online" as never, playerColor: "b" })).toMatchObject({ material: "marble", mode: "local", playerColor: "b" });
  });
});

describe("board materials", () => {
  it("every pair has clearly different light and dark squares", () => {
    for (const m of MATERIALS) {
      const light = luminance(m.light.avg);
      const dark = luminance(m.dark.avg);
      expect(light - dark, m.name).toBeGreaterThanOrEqual(55);
      expect(light, m.name).toBeGreaterThanOrEqual(140);
      expect(dark, m.name).toBeLessThanOrEqual(135);
    }
  });
  it("pieces stand out: dark outlines on light squares, a light rim for Black", () => {
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const m of MATERIALS) {
      expect(luminance(m.light.avg) - luminance(hex(PALETTE.w["#"]))).toBeGreaterThan(100);
      expect(luminance(m.light.avg) - luminance(hex(PALETTE.b["#"]))).toBeGreaterThan(100);
    }
  });
});

describe("panel text", () => {
  it("shows whose turn it is and how the game ended", () => {
    expect(statusText(newGame())).toBe("White to move");
    expect(statusText(run(newGame(), "e2e4", "f7f6", "d1h5"))).toBe("Black to move (check!)");
    expect(statusText(run(newGame(), "f2f3", "e7e5", "g2g4", "d8h4"))).toBe("Checkmate! Black wins");
    expect(statusText(run(newGame("k7/8/1Q6/8/8/8/8/7K w - - 0 1"), "h1g1"))).toMatch(/Stalemate/);
  });
  it("names you and your companion opponent", () => {
    expect(statusText(newGame(), { w: "You", b: "Princess" })).toBe("You to move");
    expect(statusText(run(newGame(), "f2f3", "e7e5", "g2g4", "d8h4"), { w: "You", b: "Princess" })).toBe("Checkmate! Princess wins");
    expect(statusText(run(newGame(), "e2e4", "f7f5", "d1h5"), { w: "You", b: "Nurse" })).toBe("Nurse to move (check!)");
  });
  it("numbers the move list in pairs", () => {
    expect(movePairs(run(newGame(), "e2e4", "e7e5", "g1f3"))).toEqual(["1. e4 e5", "2. Nf3"]);
  });
});

describe("supporter reactions", () => {
  it("picks the right cheer for each side", () => {
    const g0 = run(newGame(), "e2e4", "d7d5");
    const r = play(g0, S("e4"), S("d5"))!;
    expect(cheerEvents(g0, r.game, r.move)).toEqual({ mover: "capture", other: "lost" });
    const c0 = run(newGame(), "e2e4", "f7f6");
    const c = play(c0, S("d1"), S("h5"))!;
    expect(cheerEvents(c0, c.game, c.move)).toEqual({ mover: "check", other: "inCheck" });
    const m0 = run(newGame(), "f2f3", "e7e5", "g2g4");
    const m = play(m0, S("d8"), S("h4"))!;
    expect(cheerEvents(m0, m.game, m.move)).toEqual({ mover: "win", other: "lose" });
    const q = play(newGame(), S("e2"), S("e4"))!;
    expect(cheerEvents(newGame(), q.game, q.move)).toEqual({ mover: null, other: null });
  });
  it("every character has lines for every event", () => {
    for (const id of CHARACTER_IDS) for (const pool of Object.values(CHEERS[id])) expect(pool.length).toBeGreaterThan(0);
  });
  it("rate-limits remarks but always announces the result", () => {
    const lim = new CheerLimiter();
    const always = () => 0; // the chance roll always passes
    expect(lim.pick("princess", "capture", "White", 0, always)).not.toBeNull();
    expect(lim.pick("nurse", "capture", "Black", 1, always)).toBeNull(); // global gap
    expect(lim.pick("nurse", "capture", "Black", GLOBAL_GAP + 0.1, always)).not.toBeNull();
    expect(lim.pick("princess", "check", "White", GLOBAL_GAP * 2 + 0.2, always)).toBeNull(); // her own gap
    expect(lim.pick("princess", "check", "White", PER_ACTOR_GAP + 0.1, always)).not.toBeNull();
    expect(lim.pick("princess", "win", "White", PER_ACTOR_GAP + 0.2, always)).not.toBeNull();
    expect(lim.pick("goblin", "start", "Black", 0.5, always)).toContain("Black");
  });
  it("doesn't repeat the same line twice in a row", () => {
    const lim = new CheerLimiter();
    let t = 0;
    let last = "";
    for (let i = 0; i < 20; i++) {
      t += PER_ACTOR_GAP + 1;
      const line = lim.pick("partygirl", "capture", "White", t, Math.random)!;
      if (line) {
        expect(line).not.toBe(last);
        last = line;
      }
    }
  });
});

describe("piece art", () => {
  it("every piece is a 16×16 grid of known pixels", () => {
    for (const rows of Object.values(PIECE_ART)) {
      expect(rows).toHaveLength(16);
      for (const r of rows) {
        expect(r).toHaveLength(16);
        expect(r).toMatch(/^[.#o+s]+$/);
      }
    }
  });
});

describe("turning the board around", () => {
  it("squashes to edge-on at the middle and opens out again, easing at both ends", () => {
    expect(flipWidth(0)).toBe(1);
    expect(flipWidth(0.5)).toBeCloseTo(0, 6);
    expect(flipWidth(1)).toBeCloseTo(1, 6);
    expect(flipWidth(0.25)).toBeCloseTo(flipWidth(0.75), 6); // symmetric
    // Eases in: slow at first, then faster towards the middle.
    expect(1 - flipWidth(0.1)).toBeLessThan(flipWidth(0.1) - flipWidth(0.2));
    expect(flipWidth(-1)).toBe(1);
    expect(flipWidth(2)).toBeCloseTo(1, 6);
  });
});

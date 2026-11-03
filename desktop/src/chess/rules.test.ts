import { describe, expect, it } from "vitest";
import {
  between,
  fromFen,
  insufficientMaterial,
  needsPromotion,
  newGame,
  parseSquare as S,
  perft,
  play,
  START_FEN,
  toFen,
  type Game,
} from "./rules";

const run = (g: Game, ...moves: string[]): Game => {
  for (const mv of moves) {
    const r = play(g, S(mv.slice(0, 2)), S(mv.slice(2, 4)), (mv[4] as "q") || undefined);
    if (!r) throw new Error(`illegal ${mv} in ${toFen(g.position)}`);
    g = r.game;
  }
  return g;
};

describe("move generation (perft)", () => {
  it("start position", () => {
    const p = fromFen(START_FEN);
    expect(perft(p, 1)).toBe(20);
    expect(perft(p, 2)).toBe(400);
    expect(perft(p, 3)).toBe(8902);
  });
  it("Kiwipete (castling, pins, promotions)", () => {
    const p = fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    expect(perft(p, 1)).toBe(48);
    expect(perft(p, 2)).toBe(2039);
    expect(perft(p, 3)).toBe(97862);
  });
  it("position 3 (en passant edge cases)", () => {
    const p = fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
    expect(perft(p, 1)).toBe(14);
    expect(perft(p, 2)).toBe(191);
    expect(perft(p, 3)).toBe(2812);
    expect(perft(p, 4)).toBe(43238);
  });
  it("position 4 (promotions, castling out of check)", () => {
    const p = fromFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
    expect(perft(p, 1)).toBe(6);
    expect(perft(p, 2)).toBe(264);
    expect(perft(p, 3)).toBe(9467);
  });
  it("position 5", () => {
    const p = fromFen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8");
    expect(perft(p, 1)).toBe(44);
    expect(perft(p, 2)).toBe(1486);
    expect(perft(p, 3)).toBe(62379);
  });
});

describe("special moves", () => {
  it("castles both sides and moves the rook", () => {
    const g = run(newGame("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), "e1g1", "e8c8");
    expect(toFen(g.position).split(" ")[0]).toBe("2kr3r/8/8/8/8/8/8/R4RK1");
    expect(g.history.map((h) => h.san)).toEqual(["O-O", "O-O-O"]);
    expect(g.history[0].move.rookFrom).toBe(S("h1"));
    expect(g.history[0].move.rookTo).toBe(S("f1"));
  });
  it("cannot castle out of, through or into check, or after the king moved", () => {
    expect(play(newGame("4k3/8/8/8/8/8/8/4K2r w K - 0 1"), S("e1"), S("g1"))).toBeNull(); // in check
    expect(play(newGame("4kr2/8/8/8/8/8/8/4K2R w K - 0 1"), S("e1"), S("g1"))).toBeNull(); // through f1
    expect(play(newGame("4k1r1/8/8/8/8/8/8/4K2R w K - 0 1"), S("e1"), S("g1"))).toBeNull(); // into g1
    const moved = run(newGame("4k3/8/8/8/8/8/8/4K2R w K - 0 1"), "e1f1", "e8e7", "f1e1", "e7e8");
    expect(play(moved, S("e1"), S("g1"))).toBeNull();
    // b1 may be attacked for queenside castling (only the king's path matters).
    expect(play(newGame("1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1"), S("e1"), S("c1"))).not.toBeNull();
  });
  it("captures en passant only immediately", () => {
    let g = run(newGame(), "e2e4", "a7a6", "e4e5", "d7d5");
    const r = play(g, S("e5"), S("d6"));
    expect(r?.move.enPassant).toBe(true);
    expect(r?.move.captureSquare).toBe(S("d5"));
    expect(r!.game.position.board[S("d5")]).toBeNull();
    expect(r!.game.history[r!.game.history.length - 1].san).toBe("exd6");
    g = run(g, "h2h3", "h7h6");
    expect(play(g, S("e5"), S("d6"))).toBeNull();
  });
  it("promotes to the chosen piece and requires a choice", () => {
    const g = newGame("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    expect(needsPromotion(g, S("a7"), S("a8"))).toBe(true);
    expect(play(g, S("a7"), S("a8"))).toBeNull();
    const r = play(g, S("a7"), S("a8"), "n");
    expect(r!.game.position.board[S("a8")]).toEqual({ color: "w", type: "n" });
    expect(r!.game.history[0].san).toBe("a8=N");
  });
});

describe("game end", () => {
  it("fool's mate is checkmate", () => {
    const g = run(newGame(), "f2f3", "e7e5", "g2g4", "d8h4");
    expect(g.status).toEqual({ kind: "checkmate", winner: "b" });
    expect(g.history[g.history.length - 1].san).toBe("Qh4#");
    expect(play(g, S("a2"), S("a3"))).toBeNull();
  });
  it("reports check", () => {
    const g = run(newGame(), "e2e4", "f7f6", "d1h5");
    expect(g.status).toEqual({ kind: "playing", check: true });
    expect(g.history[g.history.length - 1].san).toBe("Qh5+");
  });
  it("stalemate", () => {
    const s = run(newGame("k7/8/1Q6/8/8/8/8/7K w - - 0 1"), "h1g1");
    expect(s.status).toEqual({ kind: "stalemate" });
  });
  it("threefold repetition", () => {
    const g = run(newGame(), "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8");
    expect(g.status).toEqual({ kind: "draw", reason: "repetition" });
  });
  it("fifty-move rule", () => {
    const g = run(newGame("4k3/8/8/8/8/8/8/R3K3 w - - 99 80"), "a1a2");
    expect(g.status).toEqual({ kind: "draw", reason: "fifty-move" });
    // A pawn move or capture resets the count.
    const reset = run(newGame("4k3/8/8/8/8/8/P7/R3K3 w - - 99 80"), "a2a3");
    expect(reset.status.kind).toBe("playing");
  });
  it("insufficient material", () => {
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(fromFen("2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1").board)).toBe(false); // opposite shades
    expect(insufficientMaterial(fromFen("3bk3/8/8/8/8/8/8/2B1K3 w - - 0 1").board)).toBe(true); // same shade
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/NN2K3 w - - 0 1").board)).toBe(false);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/P7/4K3 w - - 0 1").board)).toBe(false);
    const g = run(newGame("4k3/8/8/8/8/8/3r4/2B1K3 w - - 0 1"), "e1d2");
    expect(g.status).toEqual({ kind: "draw", reason: "material" });
  });
});

describe("notation helpers", () => {
  it("disambiguates SAN", () => {
    const g = run(newGame("4k3/8/8/8/8/8/K7/R6R w - - 0 1"), "a1d1");
    expect(g.history[0].san).toBe("Rad1");
  });
  it("lists squares between", () => {
    expect(between(S("a1"), S("a4"))).toEqual([S("a2"), S("a3")]);
    expect(between(S("c1"), S("f4"))).toEqual([S("d2"), S("e3")]);
    expect(between(S("g1"), S("f3"))).toEqual([]);
  });
});

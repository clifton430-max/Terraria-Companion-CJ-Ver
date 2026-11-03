import { describe, expect, it } from "vitest";
import { chooseMove, evaluate, LIMITS, positionKey } from "./ai";
import { fromFen, newGame, parseSquare as S, play, squareName, type Game } from "./rules";

const det = () => 0; // deterministic: always the first of equally good moves

describe("companion chess opponent", () => {
  it("evaluates the start position as level and material properly", () => {
    expect(evaluate(fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"))).toBe(0);
    expect(evaluate(fromFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1"))).toBeGreaterThan(800);
    expect(evaluate(fromFen("4k3/8/8/8/8/8/8/3QK3 b - - 0 1"))).toBeLessThan(-800);
  });

  it("finds mate in one", () => {
    // Back-rank mate: Ra8#.
    const c = chooseMove(fromFen("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"), LIMITS.normal, det)!;
    expect(squareName(c.from) + squareName(c.to)).toBe("a1a8");
  });

  it("takes a free queen and doesn't hang its own", () => {
    const take = chooseMove(fromFen("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1"), LIMITS.normal, det)!;
    expect(squareName(take.from) + squareName(take.to)).toBe("e4d5");
    // Black queen attacked by a pawn: it must move away (or capture), not stay en prise.
    const flee = chooseMove(fromFen("4k3/8/8/3q4/4P3/8/8/4K3 b - - 0 1"), LIMITS.normal, det)!;
    expect(squareName(flee.from)).toBe("d5");
  });

  it("only ever plays legal moves and finishes whole games (easy vs easy)", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      let g: Game = newGame();
      const seen: string[] = [];
      let plies = 0;
      while (g.status.kind === "playing" && plies < 300) {
        const c = chooseMove(g.position, { ...LIMITS.easy, timeMs: 1e9, maxNodes: 1500 }, rnd, () => 0, seen);
        expect(c).not.toBeNull();
        const r = play(g, c!.from, c!.to, c!.promotion);
        expect(r, `illegal ${squareName(c!.from)}${squareName(c!.to)}`).not.toBeNull();
        g = r!.game;
        seen.push(positionKey(g.position));
        plies++;
      }
      expect(plies).toBeGreaterThan(10);
    }
  }, 60_000);

  it("stays within its time budget", () => {
    const t0 = Date.now();
    chooseMove(newGame().position, { ...LIMITS.hard, timeMs: 200 });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("promotes when it can", () => {
    const c = chooseMove(fromFen("8/P6k/8/8/8/8/8/K7 w - - 0 1"), LIMITS.normal, det)!;
    expect(squareName(c.from) + squareName(c.to)).toBe("a7a8");
    expect(c.promotion).toBe("q");
  });

  it("knows a stalemated or checkmated side has no move", () => {
    expect(chooseMove(fromFen("k7/8/1Q6/8/8/8/8/6K1 b - - 0 1"), LIMITS.easy)).toBeNull();
    expect(play(newGame(), S("e2"), S("e4"))).not.toBeNull();
  });
});

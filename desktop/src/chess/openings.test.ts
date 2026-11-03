import { describe, expect, it } from "vitest";
import { judgeMove, lessonState, moveFromSan, OPENINGS, replay } from "./openings";
import { newGame, parseSquare as S } from "./rules";

describe("opening lessons", () => {
  it("every line is legal from the start position", () => {
    for (const o of OPENINGS)
      for (const v of o.variations) {
        const g = replay(v, v.moves.length, newGame());
        expect(g, `${o.name}: ${v.name}`).not.toBeNull();
        expect(g!.history.length).toBe(v.moves.length);
      }
  });
  it("teaches the London and several other openings from both sides, with replies to adapt to", () => {
    expect(OPENINGS.find((o) => o.id === "london")?.variations.length).toBeGreaterThanOrEqual(3);
    expect(OPENINGS.length).toBeGreaterThanOrEqual(6);
    expect(OPENINGS.some((o) => o.side === "b")).toBe(true);
    for (const o of OPENINGS) for (const v of o.variations) for (const mv of v.moves) expect(mv.note.length).toBeGreaterThan(3);
  });
  it("tracks whose move it is and accepts only the book move", () => {
    const london = OPENINGS.find((o) => o.id === "london")!;
    const v = london.variations[0];
    expect(lessonState(london, v, 0)).toMatchObject({ yourTurn: true, done: false, expected: { san: "d4" } });
    expect(lessonState(london, v, 1).yourTurn).toBe(false);
    const g = newGame();
    expect(judgeMove(g, v, 0, S("d2"), S("d4"))).toEqual({ ok: true });
    const wrong = judgeMove(g, v, 0, S("e2"), S("e4"));
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.why).toContain("d4");
    expect(lessonState(london, v, v.moves.length).done).toBe(true);
  });
  it("reads SAN including castling and captures", () => {
    const g = replay(OPENINGS.find((o) => o.id === "italian")!.variations[0], 10, newGame())!;
    expect(moveFromSan(g, "O-O")?.castle).toBe("K");
    expect(moveFromSan(g, "Qe2")).toBeTruthy();
    expect(moveFromSan(g, "Qh5")).toBeNull(); // blocked by the f3 knight
  });
});

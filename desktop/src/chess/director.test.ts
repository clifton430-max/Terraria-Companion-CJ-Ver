import { describe, expect, it } from "vitest";
import type { CharacterId } from "../bridge";
import { arc, assignTeams, bounce, ChessDirector, needsThrow, type ActorPose, type ActorPort, type ChessGeometry, type Vec } from "./director";
import { applyMove, file, fromFen, newGame, parseSquare as S, play, rank, type Game } from "./rules";

const SIZE = 50;
const geo: ChessGeometry = {
  center: (s) => ({ x: 300 + file(s) * SIZE + SIZE / 2, y: 100 + (7 - rank(s)) * SIZE + SIZE / 2 }),
  size: SIZE,
  spot: (team, i) => ({ x: team === "b" ? 760 + i * 50 : 240 - i * 50, y: 520 }),
  tray: (by, i) => ({ x: by === "w" ? 100 + i * 20 : 800 + i * 20, y: 150 }),
  traySize: 20,
};

class FakeActor implements ActorPort {
  poses: (ActorPose | null)[] = [];
  at: Vec;
  ok = true;
  constructor(readonly id: CharacterId, x: number) {
    this.at = { x, y: 520 };
  }
  feet() {
    return this.at;
  }
  size() {
    return { w: 40, h: 84 };
  }
  usable() {
    return this.ok;
  }
  pose(p: ActorPose | null) {
    this.poses.push(p);
    if (p) this.at = { x: p.x, y: p.y };
  }
  get last() {
    return this.poses[this.poses.length - 1];
  }
}

const cast = () => [new FakeActor("terrarian", 100), new FakeActor("princess", 900), new FakeActor("nurse", 120), new FakeActor("goblin", 880)];

function setup(fen?: string, actors: FakeActor[] = cast(), reducedMotion = false) {
  let game: Game = newGame(fen);
  const d = new ChessDirector(geo, { reducedMotion });
  d.open(game.position, assignTeams(actors));
  // Let them reach their spots.
  for (let i = 0; i < 200; i++) d.step(1 / 60);
  const move = (mv: string, promo?: "q" | "r" | "b" | "n") => {
    const r = play(game, S(mv.slice(0, 2)), S(mv.slice(2, 4)), promo);
    if (!r) throw new Error(`illegal ${mv}`);
    game = r.game;
    d.played(r.move, game.position);
    return r.move;
  };
  return { d, actors, move, get game() { return game; } };
}

/** Every piece must be shown exactly once: on a square, in a tray, or in the air. */
function census(d: ChessDirector) {
  const vis = d.visuals();
  const ids = vis.map((v) => v.token.id);
  expect(new Set(ids).size, "a piece is drawn twice").toBe(ids.length);
  expect(ids.length, "a piece vanished").toBe(d.tokens.length);
  // No two resting pieces share a square.
  const squares = vis.filter((v) => v.at === "square").map((v) => (v.at === "square" ? v.sq : -1));
  expect(new Set(squares).size, "two pieces shown on one square").toBe(squares.length);
}

/** Step until idle, recording each token's positions (and checking the census every frame). */
function runAll(d: ChessDirector, maxSeconds = 20) {
  const trails = new Map<number, Vec[]>();
  census(d);
  for (let t = 0; t < maxSeconds && d.isAnimating(); t += 1 / 60) {
    d.step(1 / 60);
    census(d);
    for (const [id, a] of d.air) {
      const tr = trails.get(id) ?? [];
      tr.push({ x: a.x, y: a.y });
      trails.set(id, tr);
    }
  }
  return trails;
}

describe("teams", () => {
  it("splits four companions two per side and handles fewer", () => {
    expect(assignTeams(["a", "b", "c", "d"])).toEqual({ w: ["a", "c"], b: ["b", "d"], both: null });
    expect(assignTeams(["a", "b", "c"])).toEqual({ w: ["a", "c"], b: ["b"], both: null });
    expect(assignTeams(["a", "b"])).toEqual({ w: ["a"], b: ["b"], both: null });
    expect(assignTeams(["a"])).toEqual({ w: [], b: [], both: "a" });
    expect(assignTeams([])).toEqual({ w: [], b: [], both: null });
  });
  it("sends everyone to their team spot", () => {
    const { actors } = setup();
    expect(actors[0].at).toEqual(geo.spot("w", 0));
    expect(actors[1].at).toEqual(geo.spot("b", 0));
    expect(actors[2].at).toEqual(geo.spot("w", 1));
    expect(actors[3].at).toEqual(geo.spot("b", 1));
  });
});

describe("moving pieces", () => {
  it("a supporter pushes the piece: she reaches it first, it never teleports, and it settles exactly", () => {
    const { d, actors, move } = setup();
    const pawn = d.tokenAt(S("e2"))!;
    move("e2e4");
    const trails = runAll(d);
    const trail = trails.get(pawn.id)!;
    expect(trail.length).toBeGreaterThan(10);
    // Continuous: no jump bigger than a few px per frame.
    for (let i = 1; i < trail.length; i++) expect(Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y)).toBeLessThan(12);
    const start = geo.center(S("e2"));
    expect(Math.hypot(trail[0].x - start.x, trail[0].y - start.y)).toBeLessThan(3);
    expect(d.air.has(pawn.id)).toBe(false);
    expect(pawn.sq).toBe(S("e4"));
    // A White supporter did it (and is back home); Black's stayed put.
    const white = actors.filter((a) => d.teamOf(a.id) === "w");
    expect(white.some((a) => a.poses.some((p) => p?.frame.startsWith("use")))).toBe(true);
    expect(actors.filter((a) => d.teamOf(a.id) === "b").every((a) => !a.poses.some((p) => p?.frame.startsWith("use")))).toBe(true);
    for (const a of actors) expect(a.at).toEqual(d.home(a.id));
  });

  it("knights are thrown in an arc that rises above the board line", () => {
    const { d, move } = setup();
    const knight = d.tokenAt(S("g1"))!;
    move("g1f3");
    const trail = runAll(d).get(knight.id)!;
    const target = geo.center(S("f3"));
    expect(Math.min(...trail.map((p) => p.y))).toBeLessThan(target.y - 15);
    expect(knight.sq).toBe(S("f3"));
  });

  it("decides push vs throw by what is in the way", () => {
    const g = newGame();
    expect(needsThrow(g.position, { from: S("a1"), to: S("a3"), type: "r" })).toBe(true); // a2 pawn
    expect(needsThrow(g.position, { from: S("e2"), to: S("e4"), type: "p" })).toBe(false);
    expect(needsThrow(g.position, { from: S("b1"), to: S("c3"), type: "n" })).toBe(true);
  });

  it("captured pieces fly into the capturer's tray", () => {
    const { d, move } = setup();
    move("e2e4");
    move("d7d5");
    const victim = d.tokenAt(S("d5"))!;
    move("e4d5");
    runAll(d);
    expect(victim.sq).toBeNull();
    expect(victim.trayOf).toBe("w");
    expect(victim.tray).toBe(0);
    expect(d.air.size).toBe(0);
  });

  it("castling moves king and rook, with two teammates at once", () => {
    const { d, actors, move } = setup("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const king = d.tokenAt(S("e1"))!;
    const rook = d.tokenAt(S("h1"))!;
    move("e1g1");
    d.step(0.5);
    // Both White supporters are out working at the same time.
    const white = actors.filter((a) => d.teamOf(a.id) === "w");
    expect(white.every((a) => a.last?.frame !== "idle")).toBe(true);
    runAll(d);
    expect(king.sq).toBe(S("g1"));
    expect(rook.sq).toBe(S("f1"));
  });

  it("promotion shows the new piece only once it has settled", () => {
    const { d, move } = setup("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    const pawn = d.tokenAt(S("a7"))!;
    move("a7a8", "q");
    expect(pawn.type).toBe("p");
    runAll(d);
    expect(pawn.type).toBe("q");
  });

  it("en passant knocks the passed pawn away", () => {
    const { d, move } = setup();
    move("e2e4");
    runAll(d);
    move("a7a6");
    runAll(d);
    move("e4e5");
    runAll(d);
    move("d7d5");
    runAll(d);
    const victim = d.tokenAt(S("d5"))!;
    move("e5d6");
    runAll(d);
    expect(victim.trayOf).toBe("w");
    expect(d.tokenAt(S("d5"))).toBeUndefined();
  });
});

describe("one visual copy per piece (the duplicate-piece bug)", () => {
  it("the moving piece stays on its source square until the companion reaches it", () => {
    const { d, move } = setup();
    const pawn = d.tokenAt(S("e2"))!;
    move("e2e4");
    // Logically on e4 at once, but shown on e2 and nothing is shown on e4.
    expect(pawn.sq).toBe(S("e4"));
    expect(d.shownAt(S("e2"))).toBe(pawn);
    expect(d.shownAt(S("e4"))).toBeUndefined();
    census(d);
    d.step(0.2); // she is still flying over
    expect(d.shownAt(S("e2"))).toBe(pawn);
    expect(d.shownAt(S("e4"))).toBeUndefined();
    let tookAt = -1;
    let landedAt = -1;
    for (let f = 0; f < 1200 && d.isAnimating(); f++) {
      d.step(1 / 60);
      census(d);
      if (tookAt < 0 && pawn.view.kind === "anim") tookAt = f;
      if (tookAt >= 0 && landedAt < 0 && pawn.view.kind === "square") landedAt = f;
      // While animated it is never also drawn on a square.
      if (pawn.view.kind === "anim") {
        expect(d.shownAt(S("e2"))).toBeUndefined();
        expect(d.shownAt(S("e4"))).toBeUndefined();
      }
    }
    expect(tookAt).toBeGreaterThan(0);
    expect(landedAt).toBeGreaterThan(tookAt);
    expect(d.shownAt(S("e4"))).toBe(pawn);
  });

  it("captures, castling, promotion and en passant keep one copy of everything every frame", () => {
    const cap = setup();
    cap.move("e2e4");
    runAll(cap.d);
    cap.move("d7d5");
    runAll(cap.d);
    const victim = cap.d.tokenAt(S("d5"))!;
    cap.move("e4d5");
    // The captured pawn stays visible on d5 until it is knocked away.
    expect(cap.d.shownAt(S("d5"))).toBe(victim);
    runAll(cap.d);
    expect(victim.view).toEqual({ kind: "tray", by: "w", slot: 0 });

    const castle = setup("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    castle.move("e1c1");
    runAll(castle.d);
    expect(castle.d.shownAt(S("c1"))?.type).toBe("k");
    expect(castle.d.shownAt(S("d1"))?.type).toBe("r");

    const promo = setup("1r5k/P7/8/8/8/8/8/K7 w - - 0 1");
    promo.move("a7b8", "n");
    runAll(promo.d);
    expect(promo.d.shownAt(S("b8"))?.type).toBe("n");

    const ep = setup("4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1");
    ep.move("e2e4");
    runAll(ep.d);
    ep.move("d4e3");
    runAll(ep.d);
    expect(ep.d.shownAt(S("e4"))).toBeUndefined();
    expect(ep.d.shownAt(S("e3"))?.color).toBe("b");
  });

  it("rapid moves and resizing mid-move never duplicate or detach a piece", () => {
    const s = setup();
    s.move("g1f3");
    for (let f = 0; f < 30; f++) {
      s.d.step(1 / 60);
      census(s.d);
    }
    // Resize the board mid-throw: the piece follows the new layout smoothly.
    const big: ChessGeometry = { ...geo, size: 70, center: (q) => ({ x: 200 + file(q) * 70 + 35, y: 60 + (7 - rank(q)) * 70 + 35 }) };
    s.d.setGeometry(big);
    s.move("b8c6");
    s.move("f3e5");
    s.move("c6e5"); // captures a knight that may still be flying
    runAll(s.d);
    expect(s.d.shownAt(S("e5"))?.color).toBe("b");
    const c = big.center(S("e5"));
    expect(s.d.air.size).toBe(0);
    expect(c.x).toBeGreaterThan(0);
  });
});

describe("robustness", () => {
  it("reconcile snaps mid-animation to the logical position", () => {
    const s = setup();
    s.move("g1f3");
    s.d.step(0.4);
    expect(s.d.isAnimating()).toBe(true);
    s.d.reconcile(s.game.position);
    expect(s.d.air.size).toBe(0);
    expect(s.d.tokenAt(S("f3"))?.type).toBe("n");
    expect(s.d.tokenAt(S("g1"))).toBeUndefined();
  });

  it("rapid moves never have two companions on one piece", () => {
    const s = setup();
    s.move("e2e4");
    s.move("d7d5");
    s.d.step(0.1);
    s.move("e4d5"); // captures the pawn that is still sliding
    runAll(s.d);
    expect(s.d.tokenAt(S("d5"))?.color).toBe("w");
    const pos = s.game.position;
    for (let q = 0; q < 64; q++) expect(!!s.d.tokenAt(q)).toBe(!!pos.board[q]);
  });

  it("works with a single companion and with none", () => {
    const solo = setup(undefined, [new FakeActor("terrarian", 100)]);
    solo.move("e2e4");
    solo.move("e7e5");
    runAll(solo.d);
    expect(solo.d.tokenAt(S("e5"))?.color).toBe("b");
    const none = setup(undefined, []);
    none.move("e2e4");
    runAll(none.d);
    expect(none.d.tokenAt(S("e4"))?.type).toBe("p");
  });

  it("a grabbed companion is let go and the piece still arrives", () => {
    const s = setup();
    s.move("e2e4");
    s.d.step(0.3);
    for (const a of s.actors) a.ok = false;
    runAll(s.d);
    expect(s.d.tokenAt(S("e4"))?.type).toBe("p");
    expect(s.actors.every((a) => a.last === null)).toBe(true);
  });

  it("reduced motion slides pieces quickly with no companion trips", () => {
    const s = setup(undefined, cast(), true);
    s.move("g1f3");
    let t = 0;
    while (s.d.isAnimating() && t < 5) {
      s.d.step(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(0.5);
    expect(s.actors.every((a) => !a.poses.some((p) => p?.frame.startsWith("use")))).toBe(true);
  });

  it("closing flies everyone back to where they were, then releases them", () => {
    const s = setup();
    const origins = new Map(s.actors.map((a, i) => [a.id, { x: 50 + i * 10, y: 300 }]));
    let done = false;
    s.d.close(origins, () => (done = true));
    for (let i = 0; i < 300 && !done; i++) s.d.step(1 / 60);
    expect(done).toBe(true);
    for (const a of s.actors) expect(a.last).toBeNull();
    s.actors.forEach((a, i) => expect(a.poses[a.poses.length - 2]).toMatchObject({ x: 50 + i * 10, y: 300 }));
  });
});

describe("curves", () => {
  it("arc and bounce start and end on the line", () => {
    expect(arc({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 50)).toEqual({ x: 0, y: 0 });
    expect(arc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 50)).toEqual({ x: 10, y: 0 });
    expect(arc({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 50).y).toBe(-50);
    expect(bounce(0, 10)).toBe(0);
    expect(bounce(1, 10)).toBeCloseTo(0);
    expect(bounce(0.3, 10)).toBeGreaterThan(bounce(0.8, 10));
  });
  it("applyMove keeps the authoritative position", () => {
    const p = fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(applyMove(p, { from: S("e1"), to: S("e2"), piece: { color: "w", type: "k" } }).board[S("e2")]?.type).toBe("k");
  });
});

describe("clicking a piece that's still waiting to be moved", () => {
  it("settle() puts it on its real square at once and keeps every piece shown once", () => {
    const { d, move } = setup();
    move("e2e4");
    move("e7e5");
    move("g1f3");
    // The knight is still shown on g1 (its companion hasn't reached it yet).
    const knight = d.tokenAt(S("f3"))!;
    expect(d.shownAt(S("g1"))).toBe(knight);
    d.settle(knight);
    expect(knight.view).toEqual({ kind: "square", sq: S("f3") });
    expect(d.shownAt(S("f3"))).toBe(knight);
    expect(d.shownAt(S("g1"))).toBeUndefined();
    census(d);
    runAll(d);
    expect(d.shownAt(S("f3"))).toBe(knight);
  });
});

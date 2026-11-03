// The companion's chess brain: a small, bounded alpha-beta search over the legal moves from
// rules.ts (so it always plays legal moves and respects check, castling, en passant, promotion
// and the draw rules). Material plus piece-square tables, quiescence on captures so it doesn't
// blunder pieces at the horizon, MVV-LVA move ordering, iterative deepening, and a hard node and
// time budget so the desktop stays responsive. Pure: runs in a worker (aiWorker.ts) or inline.

import { applyMove, inCheck, insufficientMaterial, legalMoves, type Color, type Move, type PieceType, type Position, type Promotion } from "./rules";

export type Difficulty = "easy" | "normal" | "hard";

export interface SearchLimits {
  maxDepth: number;
  /** Wall-clock budget (ms); the best move of the last finished depth is used. */
  timeMs: number;
  /** Node budget, as a second safety net. */
  maxNodes: number;
  /** Pick randomly among moves within this many centipawns of the best (easier play). */
  slack: number;
}

export const LIMITS: Record<Difficulty, SearchLimits> = {
  easy: { maxDepth: 2, timeMs: 300, maxNodes: 20_000, slack: 90 },
  normal: { maxDepth: 3, timeMs: 900, maxNodes: 80_000, slack: 15 },
  hard: { maxDepth: 5, timeMs: 1800, maxNodes: 220_000, slack: 0 },
};

const VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from White's point of view, rank 8 first (the usual layout).
const PST: Record<PieceType, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
// In the endgame the king should walk to the centre.
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

/** Table index for a square (0 = a1) from `color`'s point of view. */
const pstIndex = (sq: number, color: Color) => {
  const f = sq & 7;
  const r = sq >> 3;
  return color === "w" ? (7 - r) * 8 + f : r * 8 + f;
};

/** Static evaluation in centipawns from the side to move's point of view. */
export function evaluate(p: Position): number {
  let score = 0;
  let nonPawn = 0;
  for (const pc of p.board) if (pc && pc.type !== "p" && pc.type !== "k") nonPawn += VALUE[pc.type];
  const endgame = nonPawn <= 1300;
  for (let s = 0; s < 64; s++) {
    const pc = p.board[s];
    if (!pc) continue;
    const i = pstIndex(s, pc.color);
    const v = VALUE[pc.type] + (pc.type === "k" && endgame ? KING_END[i] : PST[pc.type][i]);
    score += pc.color === "w" ? v : -v;
  }
  return p.turn === "w" ? score : -score;
}

const MATE = 100_000;

interface Ctx {
  nodes: number;
  deadline: number;
  maxNodes: number;
  stopped: boolean;
  now: () => number;
}

function order(moves: Move[]): Move[] {
  const score = (m: Move) => (m.captured ? 10 * VALUE[m.captured.type] - VALUE[m.piece.type] + 10_000 : 0) + (m.promotion ? VALUE[m.promotion] + 9_000 : 0) + (m.castle ? 50 : 0);
  return moves.sort((a, b) => score(b) - score(a));
}

function timeUp(c: Ctx) {
  if (c.stopped) return true;
  if (c.nodes >= c.maxNodes || ((c.nodes & 255) === 0 && c.now() > c.deadline)) c.stopped = true;
  return c.stopped;
}

function quiesce(p: Position, alpha: number, beta: number, c: Ctx, depth = 0): number {
  c.nodes++;
  const stand = evaluate(p);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (depth > 6 || timeUp(c)) return alpha;
  for (const m of order(legalMoves(p).filter((x) => x.captured || x.promotion === "q"))) {
    const score = -quiesce(applyMove(p, m), -beta, -alpha, c, depth + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function search(p: Position, depth: number, alpha: number, beta: number, ply: number, c: Ctx, history: readonly string[]): number {
  c.nodes++;
  if (p.halfmove >= 100 || insufficientMaterial(p.board)) return 0;
  const moves = legalMoves(p);
  if (!moves.length) return inCheck(p) ? -MATE + ply : 0;
  if (depth <= 0) return quiesce(p, alpha, beta, c);
  if (timeUp(c)) return evaluate(p);
  for (const m of order(moves)) {
    const next = applyMove(p, m);
    const key = keyOf(next);
    // Repeating a position we've already been in is treated as a draw (avoid or seek it).
    const score = history.includes(key) ? 0 : -search(next, depth - 1, -beta, -alpha, ply + 1, c, [...history, key]);
    if (c.stopped) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

const keyOf = (p: Position) => p.board.map((pc) => (pc ? (pc.color === "w" ? pc.type.toUpperCase() : pc.type) : ".")).join("") + p.turn;

export interface Choice {
  from: number;
  to: number;
  promotion?: Promotion;
  /** Score of the chosen move (centipawns, side to move's view), and how deep it looked. */
  score: number;
  depth: number;
  nodes: number;
}

/**
 * The move to play. `history` holds keys of earlier positions (for repetition), `rnd` breaks ties
 * and adds variety on easier settings, `now` is the clock (injectable for tests).
 */
export function chooseMove(p: Position, limits: SearchLimits, rnd: () => number = Math.random, now: () => number = () => Date.now(), history: readonly string[] = []): Choice | null {
  const root = order(legalMoves(p));
  if (!root.length) return null;
  const c: Ctx = { nodes: 0, deadline: now() + limits.timeMs, maxNodes: limits.maxNodes, stopped: false, now };
  let best: { m: Move; score: number }[] = root.map((m) => ({ m, score: 0 }));
  let depthDone = 0;
  for (let depth = 1; depth <= limits.maxDepth; depth++) {
    const scored: { m: Move; score: number }[] = [];
    let alpha = -MATE * 2;
    // Search the previous best first so a cut-off depth still improves on it.
    for (const { m } of best) {
      const next = applyMove(p, m);
      const key = keyOf(next);
      const score = history.includes(key) ? 0 : -search(next, depth - 1, -MATE * 2, -alpha + limits.slack + 1, 1, c, [...history, key]);
      if (c.stopped) break;
      scored.push({ m, score });
      if (score > alpha) alpha = score;
    }
    if (c.stopped && scored.length < best.length) {
      // Unfinished depth: keep it only if it found something clearly better than before.
      if (scored.length && depthDone > 0) {
        const top = scored.reduce((a, b) => (b.score > a.score ? b : a));
        if (top.score > best[0].score + 50) best = [top, ...best.filter((x) => x.m !== top.m)];
      }
      break;
    }
    best = scored.sort((a, b) => b.score - a.score);
    depthDone = depth;
    if (best[0].score > MATE - 100) break; // found a mate
  }
  const top = best[0].score;
  const pool = best.filter((x) => x.score >= top - limits.slack);
  const pick = pool[Math.floor(rnd() * pool.length) % pool.length];
  return { from: pick.m.from, to: pick.m.to, promotion: pick.m.promotion as Promotion | undefined, score: pick.score, depth: depthDone, nodes: c.nodes };
}

export const positionKey = keyOf;

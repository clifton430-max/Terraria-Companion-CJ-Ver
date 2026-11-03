// Chess rules for the local two-player board: legal move generation (castling, en passant,
// promotion), check, checkmate, stalemate and the automatic draws (fifty-move rule, threefold
// repetition, insufficient material), plus SAN for the move list. Pure and immutable: every move
// returns a new position, so the game state stays authoritative while the companions animate.

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface Piece {
  color: Color;
  type: PieceType;
}
export type Promotion = "q" | "r" | "b" | "n";

/** Squares are 0–63: index = rank * 8 + file, rank 0 is White's back rank, file 0 is the a-file. */
export type Square = number;

export interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export interface Position {
  board: readonly (Piece | null)[];
  turn: Color;
  castling: Castling;
  /** The square a pawn skipped over on the last move (en passant target), or null. */
  ep: Square | null;
  /** Half-moves since the last capture or pawn move (fifty-move rule). */
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: Square;
  to: Square;
  piece: Piece;
  /** The captured piece, if any (for en passant it is not on `to`; see `captureSquare`). */
  captured?: Piece;
  captureSquare?: Square;
  promotion?: Promotion;
  castle?: "K" | "Q";
  /** For castling: the rook's path. */
  rookFrom?: Square;
  rookTo?: Square;
  enPassant?: boolean;
}

export const file = (sq: Square) => sq & 7;
export const rank = (sq: Square) => sq >> 3;
export const sq = (f: number, r: number): Square => r * 8 + f;
export const other = (c: Color): Color => (c === "w" ? "b" : "w");
export const squareName = (s: Square) => "abcdefgh"[file(s)] + String(rank(s) + 1);
export function parseSquare(name: string): Square {
  const f = "abcdefgh".indexOf(name[0]);
  const r = Number(name[1]) - 1;
  if (f < 0 || !(r >= 0 && r < 8)) throw new Error(`bad square ${name}`);
  return sq(f, r);
}

const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function fromFen(fen: string): Position {
  const [placement, turn = "w", castle = "-", ep = "-", half = "0", full = "1"] = fen.trim().split(/\s+/);
  const board: (Piece | null)[] = new Array(64).fill(null);
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error("bad FEN");
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        const lower = ch.toLowerCase() as PieceType;
        if (!"pnbrqk".includes(lower)) throw new Error("bad FEN piece");
        board[sq(f, 7 - i)] = { color: ch === lower ? "b" : "w", type: lower };
        f++;
      }
    }
  });
  return {
    board,
    turn: turn === "b" ? "b" : "w",
    castling: { K: castle.includes("K"), Q: castle.includes("Q"), k: castle.includes("k"), q: castle.includes("q") },
    ep: ep === "-" ? null : parseSquare(ep),
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1,
  };
}

export function toFen(p: Position): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const pc = p.board[sq(f, r)];
      if (!pc) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += pc.color === "w" ? pc.type.toUpperCase() : pc.type;
      }
    }
    rows.push(row + (empty || ""));
  }
  const c = p.castling;
  const castle = (c.K ? "K" : "") + (c.Q ? "Q" : "") + (c.k ? "k" : "") + (c.q ? "q" : "") || "-";
  return `${rows.join("/")} ${p.turn} ${castle} ${p.ep === null ? "-" : squareName(p.ep)} ${p.halfmove} ${p.fullmove}`;
}

/** Is `target` attacked by any piece of colour `by`? */
export function attacked(board: readonly (Piece | null)[], target: Square, by: Color): boolean {
  const tf = file(target);
  const tr = rank(target);
  // Pawns attack diagonally forward, so look one rank "behind" the target from their side.
  const pr = by === "w" ? tr - 1 : tr + 1;
  for (const df of [-1, 1]) {
    if (onBoard(tf + df, pr)) {
      const pc = board[sq(tf + df, pr)];
      if (pc && pc.color === by && pc.type === "p") return true;
    }
  }
  for (const [df, dr] of KNIGHT) {
    if (!onBoard(tf + df, tr + dr)) continue;
    const pc = board[sq(tf + df, tr + dr)];
    if (pc && pc.color === by && pc.type === "n") return true;
  }
  for (const [df, dr] of KING) {
    if (!onBoard(tf + df, tr + dr)) continue;
    const pc = board[sq(tf + df, tr + dr)];
    if (pc && pc.color === by && pc.type === "k") return true;
  }
  const slide = (dirs: readonly (readonly [number, number])[], kinds: string) => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      while (onBoard(f, r)) {
        const pc = board[sq(f, r)];
        if (pc) {
          if (pc.color === by && kinds.includes(pc.type)) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, "rq") || slide(BISHOP_DIRS, "bq");
}

export function kingSquare(board: readonly (Piece | null)[], color: Color): Square {
  for (let i = 0; i < 64; i++) {
    const pc = board[i];
    if (pc && pc.type === "k" && pc.color === color) return i;
  }
  return -1;
}

export function inCheck(p: Position, color: Color = p.turn): boolean {
  const k = kingSquare(p.board, color);
  return k >= 0 && attacked(p.board, k, other(color));
}

function pseudoMoves(p: Position): Move[] {
  const out: Move[] = [];
  const { board, turn } = p;
  const push = (from: Square, to: Square, extra: Partial<Move> = {}) => {
    const captured = board[to] ?? undefined;
    out.push({ from, to, piece: board[from]!, ...(captured ? { captured, captureSquare: to } : {}), ...extra });
  };
  for (let from = 0; from < 64; from++) {
    const pc = board[from];
    if (!pc || pc.color !== turn) continue;
    const f = file(from);
    const r = rank(from);
    switch (pc.type) {
      case "p": {
        const dir = turn === "w" ? 1 : -1;
        const startRank = turn === "w" ? 1 : 6;
        const lastRank = turn === "w" ? 7 : 0;
        const addPawn = (to: Square, extra: Partial<Move> = {}) => {
          if (rank(to) === lastRank) for (const promotion of ["q", "r", "b", "n"] as const) push(from, to, { ...extra, promotion });
          else push(from, to, extra);
        };
        if (onBoard(f, r + dir) && !board[sq(f, r + dir)]) {
          addPawn(sq(f, r + dir));
          if (r === startRank && !board[sq(f, r + 2 * dir)]) push(from, sq(f, r + 2 * dir));
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f + df, r + dir)) continue;
          const to = sq(f + df, r + dir);
          const target = board[to];
          if (target && target.color !== turn) addPawn(to);
          else if (to === p.ep) {
            const capSq = sq(f + df, r);
            const victim = board[capSq];
            if (victim && victim.type === "p" && victim.color !== turn) out.push({ from, to, piece: pc, captured: victim, captureSquare: capSq, enPassant: true });
          }
        }
        break;
      }
      case "n":
      case "k": {
        for (const [df, dr] of pc.type === "n" ? KNIGHT : KING) {
          if (!onBoard(f + df, r + dr)) continue;
          const to = sq(f + df, r + dr);
          const target = board[to];
          if (!target || target.color !== turn) push(from, to);
        }
        if (pc.type === "k") {
          const home = turn === "w" ? 0 : 7;
          const enemy = other(turn);
          const rights = turn === "w" ? { K: p.castling.K, Q: p.castling.Q } : { K: p.castling.k, Q: p.castling.q };
          if (from === sq(4, home) && !attacked(board, from, enemy)) {
            const rook = (fi: number) => {
              const x = board[sq(fi, home)];
              return x && x.type === "r" && x.color === turn;
            };
            if (rights.K && rook(7) && !board[sq(5, home)] && !board[sq(6, home)] && !attacked(board, sq(5, home), enemy) && !attacked(board, sq(6, home), enemy)) {
              out.push({ from, to: sq(6, home), piece: pc, castle: "K", rookFrom: sq(7, home), rookTo: sq(5, home) });
            }
            if (rights.Q && rook(0) && !board[sq(3, home)] && !board[sq(2, home)] && !board[sq(1, home)] && !attacked(board, sq(3, home), enemy) && !attacked(board, sq(2, home), enemy)) {
              out.push({ from, to: sq(2, home), piece: pc, castle: "Q", rookFrom: sq(0, home), rookTo: sq(3, home) });
            }
          }
        }
        break;
      }
      default: {
        const dirs = pc.type === "r" ? ROOK_DIRS : pc.type === "b" ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
        for (const [df, dr] of dirs) {
          let tf = f + df;
          let tr = r + dr;
          while (onBoard(tf, tr)) {
            const to = sq(tf, tr);
            const target = board[to];
            if (target) {
              if (target.color !== turn) push(from, to);
              break;
            }
            push(from, to);
            tf += df;
            tr += dr;
          }
        }
      }
    }
  }
  return out;
}

/** Apply a move (assumed legal or at least pseudo-legal) and return the new position. */
export function applyMove(p: Position, m: Move): Position {
  const board = p.board.slice();
  board[m.from] = null;
  if (m.captureSquare !== undefined) board[m.captureSquare] = null;
  board[m.to] = m.promotion ? { color: m.piece.color, type: m.promotion } : m.piece;
  if (m.castle && m.rookFrom !== undefined && m.rookTo !== undefined) {
    board[m.rookTo] = board[m.rookFrom];
    board[m.rookFrom] = null;
  }
  const castling = { ...p.castling };
  const touch = (s: Square) => {
    if (s === sq(4, 0)) castling.K = castling.Q = false;
    if (s === sq(4, 7)) castling.k = castling.q = false;
    if (s === sq(0, 0)) castling.Q = false;
    if (s === sq(7, 0)) castling.K = false;
    if (s === sq(0, 7)) castling.q = false;
    if (s === sq(7, 7)) castling.k = false;
  };
  touch(m.from);
  touch(m.to);
  const double = m.piece.type === "p" && Math.abs(rank(m.to) - rank(m.from)) === 2;
  return {
    board,
    turn: other(p.turn),
    castling,
    ep: double ? (m.from + m.to) / 2 : null,
    halfmove: m.piece.type === "p" || m.captured ? 0 : p.halfmove + 1,
    fullmove: p.turn === "b" ? p.fullmove + 1 : p.fullmove,
  };
}

/** Every legal move for the side to move. */
export function legalMoves(p: Position): Move[] {
  return pseudoMoves(p).filter((m) => !inCheck(applyMove(p, m), p.turn));
}

export function movesFrom(p: Position, from: Square): Move[] {
  return legalMoves(p).filter((m) => m.from === from);
}

/** Count leaf positions to `depth` (move-generator correctness check). */
export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(p);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(applyMove(p, m), depth - 1);
  return n;
}

/** Bishops (and knights) only, with no mating material on either side. */
export function insufficientMaterial(board: readonly (Piece | null)[]): boolean {
  const minors: { type: PieceType; color: Color; shade: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const pc = board[i];
    if (!pc || pc.type === "k") continue;
    if (pc.type === "p" || pc.type === "r" || pc.type === "q") return false;
    minors.push({ type: pc.type, color: pc.color, shade: (file(i) + rank(i)) % 2 });
  }
  if (minors.length <= 1) return true; // K v K, K+B v K, K+N v K
  // Any number of bishops, all on the same square colour, can never mate.
  return minors.every((m) => m.type === "b") && minors.every((m) => m.shade === minors[0].shade);
}

/** Identity for repetition: placement, side to move, castling rights and a *usable* en passant. */
export function repetitionKey(p: Position): string {
  const epUsable = p.ep !== null && legalMoves(p).some((m) => m.enPassant);
  const fen = toFen({ ...p, ep: epUsable ? p.ep : null });
  return fen.split(" ").slice(0, 4).join(" ");
}

export function san(p: Position, m: Move): string {
  let s: string;
  if (m.castle) s = m.castle === "K" ? "O-O" : "O-O-O";
  else {
    const capture = !!m.captured;
    if (m.piece.type === "p") {
      s = (capture ? "abcdefgh"[file(m.from)] + "x" : "") + squareName(m.to);
      if (m.promotion) s += "=" + m.promotion.toUpperCase();
    } else {
      const rivals = legalMoves(p).filter((o) => o.to === m.to && o.from !== m.from && o.piece.type === m.piece.type);
      let dis = "";
      if (rivals.length) {
        const sameFile = rivals.some((o) => file(o.from) === file(m.from));
        const sameRank = rivals.some((o) => rank(o.from) === rank(m.from));
        if (!sameFile) dis = "abcdefgh"[file(m.from)];
        else if (!sameRank) dis = String(rank(m.from) + 1);
        else dis = squareName(m.from);
      }
      s = m.piece.type.toUpperCase() + dis + (capture ? "x" : "") + squareName(m.to);
    }
  }
  const next = applyMove(p, m);
  if (inCheck(next)) s += legalMoves(next).length ? "+" : "#";
  return s;
}

// ── Game ────────────────────────────────────────────────────────────────────────────────────

export type Status =
  | { kind: "playing"; check: boolean }
  | { kind: "checkmate"; winner: Color }
  | { kind: "stalemate" }
  | { kind: "draw"; reason: "fifty-move" | "repetition" | "material" };

export interface Game {
  position: Position;
  /** Moves played, with their SAN, oldest first. */
  history: { move: Move; san: string }[];
  /** Repetition keys of every position reached, including the start. */
  seen: string[];
  status: Status;
}

export function statusOf(p: Position, seen: readonly string[]): Status {
  const moves = legalMoves(p);
  const check = inCheck(p);
  if (!moves.length) return check ? { kind: "checkmate", winner: other(p.turn) } : { kind: "stalemate" };
  if (insufficientMaterial(p.board)) return { kind: "draw", reason: "material" };
  const key = seen[seen.length - 1];
  if (key !== undefined && seen.filter((k) => k === key).length >= 3) return { kind: "draw", reason: "repetition" };
  if (p.halfmove >= 100) return { kind: "draw", reason: "fifty-move" };
  return { kind: "playing", check };
}

export function newGame(fen = START_FEN): Game {
  const position = fromFen(fen);
  const seen = [repetitionKey(position)];
  return { position, history: [], seen, status: statusOf(position, seen) };
}

export const isOver = (g: Game) => g.status.kind !== "playing";

/**
 * Play `from`→`to` (with a promotion choice when a pawn reaches the last rank). Returns the new
 * game and the move played, or null if it is illegal, the game is over, or a promotion choice is
 * missing.
 */
export function play(g: Game, from: Square, to: Square, promotion?: Promotion): { game: Game; move: Move } | null {
  if (isOver(g)) return null;
  const candidates = movesFrom(g.position, from).filter((m) => m.to === to);
  if (!candidates.length) return null;
  const move = candidates.length === 1 && !candidates[0].promotion ? candidates[0] : candidates.find((m) => m.promotion === promotion);
  if (!move) return null;
  const position = applyMove(g.position, move);
  const seen = [...g.seen, repetitionKey(position)];
  return {
    game: { position, history: [...g.history, { move, san: san(g.position, move) }], seen, status: statusOf(position, seen) },
    move,
  };
}

/** Does moving `from`→`to` need a promotion choice? */
export function needsPromotion(g: Game, from: Square, to: Square): boolean {
  return movesFrom(g.position, from).some((m) => m.to === to && !!m.promotion);
}

/** Squares strictly between two squares on a rank/file/diagonal (empty for knight hops). */
export function between(a: Square, b: Square): Square[] {
  const df = Math.sign(file(b) - file(a));
  const dr = Math.sign(rank(b) - rank(a));
  const straight = file(a) === file(b) || rank(a) === rank(b) || Math.abs(file(b) - file(a)) === Math.abs(rank(b) - rank(a));
  if (!straight) return [];
  const out: Square[] = [];
  let f = file(a) + df;
  let r = rank(a) + dr;
  while (f !== file(b) || r !== rank(b)) {
    out.push(sq(f, r));
    f += df;
    r += dr;
  }
  return out;
}

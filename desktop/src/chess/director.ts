// Companions physically moving the chess pieces.
//
// The game in rules.ts is authoritative and is updated the moment a move is played, but the
// *displayed* board follows the animations. Every piece has exactly one visual owner at any time:
//
//   { square }  resting on a board square (drawn by the board layer)
//   { tray }    resting in a capture tray (drawn by the board layer)
//   { anim }    owned by one animation job (drawn once, by the air layer, where the job puts it)
//
// A move becomes a transaction: the piece stays visibly on its source square until a supporter
// reaches it, then the job takes ownership (in the same frame the board stops drawing it), pushes
// it (anticipation → contact → push → release → recovery) or picks it up and throws it in a
// gravity arc when other pieces are in the way (knights always hop), and on settling hands it back
// to the board at its destination — again in a single step, so there is never a frame with two
// copies or none. Captured pieces stay on their square until they are knocked into the capturer's
// tray. `reconcile()` finishes every transaction at once (focus loss, restart, close).
//
// Job positions are recomputed from the current geometry every frame, so resizing the board
// mid-move keeps the piece attached to the companion. No DOM: the view draws what `visuals()`
// reports, and companions are driven through `ActorPort`s.

import type { CharacterId } from "../bridge";
import { between, type Color, type Move, type PieceType, type Position, type Square } from "./rules";

export interface Vec {
  x: number;
  y: number;
}

/** Feet-centre position, animation frame and facing for a puppeted companion. */
export interface ActorPose {
  x: number;
  y: number;
  frame: string;
  facing: -1 | 1;
}

export interface ActorPort {
  readonly id: CharacterId;
  /** Current feet-centre position. */
  feet(): Vec;
  size(): { w: number; h: number };
  /** On screen and free to act (not being dragged, controlled or leaving). */
  usable(): boolean;
  /** Drive the companion (a pose) or hand it back to its own behaviour (null). */
  pose(p: ActorPose | null): void;
}

export interface ChessGeometry {
  /** Centre of a square on screen. */
  center(s: Square): Vec;
  /** Square size (px). */
  size: number;
  /** Feet position of supporter `i` of a team ("both" = a lone companion moving for both sides). */
  spot(team: Color | "both", i: number): Vec;
  /** Feet position of a companion seated on the opponent's chair, if there is one. */
  seat?: Vec;
  /** Centre of tray slot `i` of the pieces captured BY `by`. */
  tray(by: Color, i: number): Vec;
  traySize: number;
}

export type View = { kind: "square"; sq: Square } | { kind: "tray"; by: Color; slot: number } | { kind: "anim" };

export interface Token {
  id: number;
  color: Color;
  /** The piece as shown (a promoting pawn stays a pawn until it settles). */
  type: PieceType;
  pending: PieceType | null;
  /** Logical square (authoritative, updated as soon as a move is played); null once captured. */
  sq: Square | null;
  /** Captured: which side's tray holds it, and the slot. */
  trayOf: Color | null;
  tray: number;
  /** Where it is *shown* (follows the animations). */
  view: View;
}

export interface Airborne {
  x: number;
  y: number;
  rot: number;
  scale: number;
}

export type Visual =
  | { token: Token; at: "square"; sq: Square }
  | { token: Token; at: "tray"; by: Color; slot: number }
  | { token: Token; at: "air"; x: number; y: number; rot: number; scale: number };

export interface Sparkle {
  x: number;
  y: number;
  age: number;
}

/** Who supports whom: two per side with four, sensible splits with fewer, a lone host with one. */
export function assignTeams<T>(list: readonly T[]): { w: T[]; b: T[]; both: T | null } {
  if (list.length === 0) return { w: [], b: [], both: null };
  if (list.length === 1) return { w: [], b: [], both: list[0] };
  const w: T[] = [];
  const b: T[] = [];
  list.slice(0, 4).forEach((x, i) => (i % 2 === 0 ? w : b).push(x));
  return { w, b, both: null };
}

export const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

/** A gravity arc from a to b peaking `h` px above the straight line. */
export function arc(a: Vec, b: Vec, p: number, h: number): Vec {
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - 4 * h * p * (1 - p) };
}

/** Two decaying hops after a landing (height offset, ≥ 0 means up). */
export function bounce(p: number, h: number): number {
  if (p < 0.6) return 4 * h * (p / 0.6) * (1 - p / 0.6);
  const q = (p - 0.6) / 0.4;
  return 4 * h * 0.35 * q * (1 - q);
}

/** Pieces in the way on the board *after* the move (so a castling rook hops its king). */
export function needsThrow(after: Position, m: { from: Square; to: Square; type: PieceType }): boolean {
  if (m.type === "n") return true;
  return between(m.from, m.to).some((s) => after.board[s] !== null);
}

export const FLY_SPEED = 430;
export const PUSH_SPEED = 220;

interface Phase {
  dur: number;
  run: (p: number) => void;
}

interface Job {
  actor: ActorPort | null;
  /** Tokens this job animates (moving + captured). */
  tokens: number[];
  build: () => Phase[];
  phases: Phase[] | null;
  i: number;
  t: number;
  /** Put every token where it ends up (and the actor back to idle). */
  finish: () => void;
  /** Piece work done; only the walk back remains. */
  settled: boolean;
  onEnd?: () => void;
}

export interface DirectorOptions {
  reducedMotion: boolean;
}

export interface Teams {
  w: ActorPort[];
  b: ActorPort[];
  both: ActorPort | null;
  /** A companion who sits on the chair between moves (the opponent in companion mode). */
  seated?: CharacterId | null;
}

export class ChessDirector {
  tokens: Token[] = [];
  /** Positions of the pieces currently owned by an animation. */
  readonly air = new Map<number, Airborne>();
  sparkles: Sparkle[] = [];
  private jobs: Job[] = [];
  private nextId = 1;
  private teams: Teams = { w: [], b: [], both: null };
  private homes = new Map<CharacterId, Vec>();
  private gestures = new Map<CharacterId, { frame: string; until: number; hop: boolean }>();
  /** A held pose at home (e.g. "think" for the opponent), until cleared. */
  private holds = new Map<CharacterId, string>();
  private wasUsable = new Map<CharacterId, boolean>();
  private released = new Set<CharacterId>();
  private clock = 0;
  /** Bumped whenever resting pieces change, so the view knows to redraw the board. */
  version = 0;

  constructor(
    private geo: ChessGeometry,
    private opts: DirectorOptions,
  ) {}

  setGeometry(geo: ChessGeometry) {
    this.geo = geo;
    this.computeHomes();
    this.version++;
  }

  get geometry() {
    return this.geo;
  }

  get actors(): ActorPort[] {
    const t = this.teams;
    return t.both ? [t.both] : [...t.w, ...t.b];
  }

  teamOf(id: CharacterId): Color | "both" | null {
    if (this.teams.both?.id === id) return "both";
    if (this.teams.w.some((a) => a.id === id)) return "w";
    if (this.teams.b.some((a) => a.id === id)) return "b";
    return null;
  }

  isSeated(id: CharacterId) {
    return this.teams.seated === id;
  }

  /** Supporters of `color` (the lone host supports both). */
  supporters(color: Color): ActorPort[] {
    return this.teams.both ? [this.teams.both] : this.teams[color];
  }

  /** Start: lay out the pieces and send the companions to their places. */
  open(position: Position, teams: Teams) {
    this.reset(position);
    this.teams = teams;
    this.computeHomes();
    for (const a of this.actors) {
      this.wasUsable.set(a.id, a.usable());
      if (a.usable() && !this.opts.reducedMotion) this.flyHome(a);
    }
  }

  /**
   * Change who supports whom mid-game (a new opponent, a different mode) without touching the
   * pieces: companions no longer involved are handed back, newcomers fly to their place.
   */
  setTeams(teams: Teams) {
    this.reconcile();
    const before = new Set(this.actors.map((a) => a.id));
    const leaving = this.actors.filter((a) => ![...teams.w, ...teams.b, ...(teams.both ? [teams.both] : [])].some((n) => n.id === a.id));
    for (const a of leaving) a.pose(null);
    this.teams = teams;
    this.computeHomes();
    for (const a of this.actors) {
      this.released.delete(a.id);
      this.wasUsable.set(a.id, a.usable());
      if (a.usable() && (!before.has(a.id) || !this.opts.reducedMotion)) this.flyHome(a);
    }
  }

  /** No piece is being carried or knocked away (walks back home may still be going on). */
  piecesSettled() {
    return this.air.size === 0 && !this.jobs.some((j) => j.tokens.length > 0 && !j.settled);
  }

  /** Fresh pieces for a new game (anything mid-animation is dropped). */
  reset(position: Position) {
    for (const j of this.jobs) if (j.actor) j.actor.pose(null);
    this.jobs = [];
    this.air.clear();
    this.sparkles = [];
    this.tokens = [];
    for (let s = 0; s < 64; s++) {
      const pc = position.board[s];
      if (pc) this.tokens.push(this.newToken(pc.color, pc.type, s));
    }
    this.version++;
  }

  private newToken(color: Color, type: PieceType, s: Square): Token {
    return { id: this.nextId++, color, type, pending: null, sq: s, trayOf: null, tray: 0, view: { kind: "square", sq: s } };
  }

  private computeHomes() {
    this.homes.clear();
    const t = this.teams;
    if (t.both) this.homes.set(t.both.id, this.geo.spot("both", 0));
    let wi = 0;
    let bi = 0;
    for (const a of t.w) this.homes.set(a.id, t.seated === a.id && this.geo.seat ? this.geo.seat : this.geo.spot("w", wi++));
    for (const a of t.b) this.homes.set(a.id, t.seated === a.id && this.geo.seat ? this.geo.seat : this.geo.spot("b", bi++));
  }

  home(id: CharacterId): Vec | undefined {
    return this.homes.get(id);
  }

  /** A short cheering pose at home (wave, or a little hop). */
  gesture(id: CharacterId, kind: "wave" | "hop", seconds = 1.6) {
    this.gestures.set(id, { frame: kind === "hop" ? "jump" : "wave", until: this.clock + seconds, hop: kind === "hop" && !this.opts.reducedMotion });
  }

  /** Hold a pose at home (e.g. thinking) until `null`. */
  hold(id: CharacterId, frame: string | null) {
    if (frame) this.holds.set(id, frame);
    else this.holds.delete(id);
  }

  isAnimating() {
    return this.jobs.length > 0 || this.air.size > 0;
  }

  /** Is this companion busy with a piece (not just walking back)? */
  working(id: CharacterId) {
    return this.jobs.some((j) => j.actor?.id === id && !j.settled && j.tokens.length > 0);
  }

  /** Every piece exactly once, where it is shown. */
  visuals(): Visual[] {
    const out: Visual[] = [];
    for (const t of this.tokens) {
      if (t.view.kind === "square") out.push({ token: t, at: "square", sq: t.view.sq });
      else if (t.view.kind === "tray") out.push({ token: t, at: "tray", by: t.view.by, slot: t.view.slot });
      else {
        const a = this.air.get(t.id);
        if (a) out.push({ token: t, at: "air", ...a });
      }
    }
    return out;
  }

  /** Tokens resting on the board or in a tray (not owned by an animation). */
  resting(): Token[] {
    return this.tokens.filter((t) => t.view.kind !== "anim");
  }

  /** The token logically on `sq` (authoritative). */
  tokenAt(sq: Square): Token | undefined {
    return this.tokens.find((t) => t.sq === sq);
  }

  /** The token shown resting on `sq`, if any. */
  shownAt(sq: Square): Token | undefined {
    return this.tokens.find((t) => t.view.kind === "square" && t.view.sq === sq);
  }

  // ── Ownership: the only places a piece's visual owner changes ──────────────────────────────

  /** An animation takes the piece from wherever it rests; drawn at its current spot. */
  private take(t: Token, at: Vec) {
    t.view = { kind: "anim" };
    this.air.set(t.id, { x: at.x, y: at.y, rot: 0, scale: 1 });
    this.version++;
  }

  /** Hand a piece back to the board at its logical square (or its tray if captured). */
  private land(t: Token) {
    this.air.delete(t.id);
    if (t.pending) {
      t.type = t.pending;
      t.pending = null;
    }
    t.view = t.sq !== null ? { kind: "square", sq: t.sq } : t.trayOf ? { kind: "tray", by: t.trayOf, slot: t.tray } : t.view;
    this.version++;
  }

  /** Where a token is shown right now (for starting an animation from there). */
  private shownPos(t: Token): Vec {
    const a = this.air.get(t.id);
    if (a) return { x: a.x, y: a.y };
    if (t.view.kind === "square") return this.geo.center(t.view.sq);
    if (t.view.kind === "tray") return this.geo.tray(t.view.by, t.view.slot);
    return { x: 0, y: 0 };
  }

  /**
   * A move was just played (already applied to the authoritative game). Update the logical
   * squares at once and queue the animation; the pieces stay where they're shown until the
   * animation takes them.
   */
  played(m: Move, after: Position) {
    const mover = this.tokenAt(m.from);
    const victim = m.captureSquare !== undefined ? this.tokenAt(m.captureSquare) : undefined;
    const rook = m.castle && m.rookFrom !== undefined ? this.tokenAt(m.rookFrom) : undefined;
    // Never let two animations fight over a piece: finish any job touching these first.
    const involved = new Set([mover?.id, victim?.id, rook?.id].filter((x): x is number => x !== undefined));
    for (const j of [...this.jobs]) if (j.tokens.some((id) => involved.has(id))) this.finishJob(j);
    if (!mover) {
      this.verify(after);
      return;
    }
    const color = m.piece.color;
    if (victim) {
      victim.sq = null;
      victim.trayOf = color;
      victim.tray = this.tokens.filter((t) => t.trayOf === color && t !== victim).length;
    }
    mover.sq = m.to;
    if (m.promotion) mover.pending = m.promotion;
    if (rook && m.rookTo !== undefined) rook.sq = m.rookTo;

    const thrown = needsThrow(after, { from: m.from, to: m.to, type: m.piece.type }) && !this.opts.reducedMotion;
    const actor = this.pickActor(color, m.from, null);
    this.queue(this.moveJob(actor, mover, m.from, m.to, thrown, victim ? { token: victim, sq: m.captureSquare! } : null, color));
    if (rook && m.rookFrom !== undefined && m.rookTo !== undefined) {
      // Castling: a teammate moves the rook at the same time when there is one.
      const rookActor = this.pickActor(color, m.rookFrom, actor);
      const rookThrown = needsThrow(after, { from: m.rookFrom, to: m.rookTo, type: "r" }) && !this.opts.reducedMotion;
      this.queue(this.moveJob(rookActor, rook, m.rookFrom, m.rookTo, rookThrown, null, color));
    }
  }

  /**
   * Bring one piece to its logical square right now, finishing any animation that holds it
   * (used when the player clicks a piece that's still waiting for its companion to move it).
   */
  settle(t: Token) {
    for (const j of [...this.jobs]) if (j.tokens.includes(t.id)) this.finishJob(j);
    if (t.view.kind === "anim") this.land(t);
  }

  /** Finish every animation at once (focus loss, restart, close). */
  reconcile(position?: Position) {
    for (const j of [...this.jobs]) this.finishJob(j);
    for (const t of this.tokens) if (t.view.kind === "anim") this.land(t);
    this.air.clear();
    this.sparkles = [];
    if (position) this.verify(position);
    this.version++;
  }

  /** Make sure the logical tokens match the board; rebuild if they ever disagree. */
  verify(position: Position) {
    let ok = true;
    for (let s = 0; s < 64; s++) {
      const pc = position.board[s];
      const t = this.tokenAt(s);
      const shown = t ? (t.pending ?? t.type) : null;
      if (!pc ? !!t : !t || t.color !== pc.color || shown !== pc.type) ok = false;
    }
    if (ok) return;
    for (const j of [...this.jobs]) this.finishJob(j);
    this.air.clear();
    const trays = this.tokens.filter((t) => t.trayOf);
    this.tokens = trays;
    for (let s = 0; s < 64; s++) {
      const pc = position.board[s];
      if (pc) this.tokens.push(this.newToken(pc.color, pc.type, s));
    }
    this.version++;
  }

  /** Fly everyone back to where they were before the game, then release them. */
  close(origins: ReadonlyMap<CharacterId, Vec>, done: () => void) {
    this.reconcile();
    const left = new Set<CharacterId>();
    for (const a of this.actors) {
      const to = origins.get(a.id);
      if (!a.usable() || !to || this.opts.reducedMotion) {
        this.release(a);
        continue;
      }
      left.add(a.id);
      this.queue(
        this.flightJob(a, () => to, () => {
          this.release(a);
          left.delete(a.id);
          if (!left.size) done();
        }),
      );
    }
    if (!left.size) done();
  }

  private release(a: ActorPort) {
    this.released.add(a.id);
    a.pose(null);
  }

  /** Hand every companion back right away (window closed, app quitting). */
  releaseAll() {
    this.reconcile();
    for (const a of this.actors) this.release(a);
  }

  step(dt: number) {
    this.clock += dt;
    // Companions that were grabbed (or otherwise busy) and come back fly home again.
    for (const a of this.actors) {
      if (this.released.has(a.id)) continue;
      const u = a.usable();
      const was = this.wasUsable.get(a.id) ?? false;
      this.wasUsable.set(a.id, u);
      if (!u) {
        for (const j of this.jobs) if (j.actor === a) j.actor = null;
        if (was) a.pose(null);
      } else if (!was && !this.opts.reducedMotion) this.flyHome(a);
    }
    // Run the first job of each actor (and every actorless job) in parallel.
    const busy = new Set<CharacterId>();
    for (const j of [...this.jobs]) {
      if (j.actor) {
        if (busy.has(j.actor.id)) continue;
        busy.add(j.actor.id);
      }
      this.advance(j, dt);
    }
    // Idle companions stay at their place, facing the board, cheering now and then.
    for (const a of this.actors) {
      if (busy.has(a.id) || this.released.has(a.id) || !a.usable()) continue;
      const h = this.homes.get(a.id);
      if (!h) continue;
      const g = this.gestures.get(a.id);
      const cheering = g && this.clock < g.until;
      const hop = cheering && g.hop ? Math.abs(Math.sin(((g.until - this.clock) / 0.5) * Math.PI)) * 14 : 0;
      const rest = this.holds.get(a.id) ?? (this.isSeated(a.id) ? "sit" : "idle");
      const mid = this.geo.center(27).x; // the board's middle
      // Ease toward home (after a resize the spot moves; no snapping).
      const f = a.feet();
      const k = Math.min(1, dt * 12);
      const far = Math.hypot(h.x - f.x, h.y - hop - f.y) > 1.5;
      const x = far ? f.x + (h.x - f.x) * k : h.x;
      const y = far ? f.y + (h.y - hop - f.y) * k : h.y - hop;
      a.pose({ x, y, frame: cheering ? g.frame : rest, facing: mid < h.x ? -1 : 1 });
    }
    for (const s of this.sparkles) s.age += dt;
    this.sparkles = this.sparkles.filter((s) => s.age < 0.6);
  }

  private advance(j: Job, dt: number) {
    if (!j.phases) j.phases = j.build();
    let left = dt;
    while (left > 0 && j.i < j.phases.length) {
      const ph = j.phases[j.i];
      const room = ph.dur - j.t;
      if (left < room) {
        j.t += left;
        left = 0;
        ph.run(ph.dur > 0 ? j.t / ph.dur : 1);
      } else {
        left -= room;
        ph.run(1);
        j.i++;
        j.t = 0;
      }
    }
    if (j.i >= j.phases.length) {
      this.jobs = this.jobs.filter((x) => x !== j);
      j.onEnd?.();
    }
  }

  private finishJob(j: Job) {
    this.jobs = this.jobs.filter((x) => x !== j);
    j.finish();
    j.onEnd?.();
  }

  private queue(j: Job) {
    this.jobs.push(j);
  }

  /** A free teammate near the piece (finishing her current job if everyone is busy), or null. */
  private pickActor(color: Color, near: Square, not: ActorPort | null): ActorPort | null {
    if (this.opts.reducedMotion) return null;
    const team = this.supporters(color).filter((a) => a.usable() && a !== not);
    if (!team.length) return not && this.supporters(color).includes(not) ? not : null;
    const c = this.geo.center(near);
    const busyWith = (a: ActorPort) => this.jobs.find((j) => j.actor === a && !j.settled);
    const byDistance = (list: ActorPort[]) => [...list].sort((p, q) => dist(p.feet(), c) - dist(q.feet(), c));
    const free = byDistance(team.filter((a) => !busyWith(a)));
    if (free.length) return free[0];
    const pick = byDistance(team)[0];
    const j = busyWith(pick);
    if (j) this.finishJob(j);
    return pick;
  }

  private flyHome(a: ActorPort) {
    if (!this.homes.has(a.id)) return;
    // Drop any earlier walk home so it isn't queued twice.
    this.jobs = this.jobs.filter((j) => !(j.actor === a && j.tokens.length === 0 && !j.onEnd));
    this.queue(this.flightJob(a, () => this.homes.get(a.id) ?? a.feet()));
  }

  /** Just fly somewhere (to the spot at the start, back to her place at the end). */
  private flightJob(a: ActorPort, to: () => Vec, onEnd?: () => void): Job {
    const job: Job = {
      actor: a,
      tokens: [],
      phases: null,
      i: 0,
      t: 0,
      settled: true,
      finish: () => {
        const t = to();
        if (job.actor) a.pose({ x: t.x, y: t.y, frame: this.isSeated(a.id) ? "sit" : "idle", facing: a.feet().x < t.x ? 1 : -1 });
      },
      onEnd,
      build: () => [this.flyPhase(job, a.feet(), to, this.isSeated(a.id) ? "sit" : "idle")],
    };
    return job;
  }

  private flyPhase(job: Job, from: Vec, to: () => Vec, endFrame: string): Phase {
    const d = dist(from, to());
    const lift = Math.min(60, d * 0.25);
    return {
      dur: clamp(d / FLY_SPEED, d < 2 ? 0 : 0.25, 1.4),
      run: (p) => {
        const t = to();
        const facing: -1 | 1 = t.x < from.x ? -1 : 1;
        const pos = arc(from, t, easeInOut(p), lift);
        job.actor?.pose({ x: pos.x, y: pos.y, frame: p < 1 ? "glide" : endFrame, facing });
      },
    };
  }

  private moveJob(actor: ActorPort | null, token: Token, from: Square, to: Square, thrown: boolean, captured: { token: Token; sq: Square } | null, color: Color): Job {
    const geo = () => this.geo;
    const A = () => geo().center(from);
    const B = () => geo().center(to);
    const victim = captured?.token ?? null;
    const ids = [token.id, ...(victim ? [victim.id] : [])];
    const teamDir: -1 | 1 = color === "w" ? 1 : -1;
    const dx = B().x - A().x;
    const dir: -1 | 1 = dx > 0.5 ? 1 : dx < -0.5 ? -1 : teamDir;
    let knocked = false;
    let owned = false;
    const own = () => {
      if (owned) return;
      owned = true;
      this.take(token, this.shownPos(token));
    };
    const knock = () => {
      if (!victim || knocked) return;
      knocked = true;
      this.queue(this.knockJob(victim));
    };
    const settle = () => {
      if (job.settled) return;
      own();
      const promoted = token.pending !== null;
      this.land(token);
      if (promoted) {
        const b = B();
        this.sparkles.push({ x: b.x, y: b.y, age: 0 }, { x: b.x - 6, y: b.y - 8, age: 0.1 }, { x: b.x + 7, y: b.y - 5, age: 0.2 });
      }
      job.settled = true;
    };
    const job: Job = {
      actor,
      tokens: ids,
      phases: null,
      i: 0,
      t: 0,
      settled: false,
      finish: () => {
        knock();
        for (const k of [...this.jobs]) if (k !== job && victim && k.tokens.includes(victim.id)) this.finishJob(k);
        settle();
      },
      build: () => {
        const phases: Phase[] = [];
        const size = actor?.size() ?? { w: 40, h: 80 };
        const sq = () => geo().size;
        // Where she stands to touch the piece: beside it, on the side away from where it goes.
        const contact = (p: Vec): Vec => ({ x: p.x - dir * (sq() * 0.42 + size.w * 0.5), y: p.y + size.h * 0.42 });
        const pose = (pos: Vec, frame: string) => job.actor?.pose({ x: pos.x, y: pos.y, frame, facing: dir });
        if (actor) phases.push(this.flyPhase(job, actor.feet(), () => contact(A()), "use1"));
        if (!thrown) {
          // Push: lean back, touch (the piece is hers from here), push it along, let go, recover.
          phases.push({ dur: actor ? 0.22 : 0, run: (p) => pose({ x: contact(A()).x - dir * 5 * Math.sin(p * Math.PI), y: contact(A()).y }, "use1") });
          phases.push({
            dur: actor ? 0.08 : 0,
            run: (p) => {
              own();
              pose(contact(A()), "use2");
              const a = A();
              this.air.set(token.id, { x: a.x + dir * 2 * p, y: a.y, rot: 0, scale: 1 });
            },
          });
          const d = dist(A(), B());
          const dur = this.opts.reducedMotion ? 0.18 : clamp(d / PUSH_SPEED, 0.3, 1.3) * (actor ? 1 : 0.7);
          const knockAt = d > 0 ? Math.max(0, 1 - (sq() * 0.6) / d) : 0;
          phases.push({
            dur,
            run: (p) => {
              own();
              const e = easeInOut(p);
              const a = A();
              const b = B();
              const pos = { x: lerp(a.x + dir * 2, b.x, e), y: lerp(a.y, b.y, e) };
              this.air.set(token.id, { ...pos, rot: Math.sin(p * Math.PI * 6) * 0.04, scale: 1 });
              pose(contact(pos), Math.floor(p * 6) % 2 ? "use3" : "use2");
              if (p >= knockAt) knock();
            },
          });
          phases.push({
            dur: actor ? 0.15 : 0,
            run: (p) => {
              const b = B();
              if (!job.settled) this.air.set(token.id, { x: b.x, y: b.y, rot: 0, scale: 1 });
              const c = contact(b);
              pose({ x: c.x - dir * 6 * p, y: c.y }, "use4");
              if (p >= 1) {
                knock();
                settle();
              }
            },
          });
        } else {
          // Throw: pick it up over her head, wind up, toss it in an arc, bounce, settle exactly.
          const hand = () => {
            const c = contact(A());
            return actor ? { x: c.x + dir * size.w * 0.3, y: c.y - size.h * 1.02 } : { x: A().x, y: A().y - sq() * 0.4 };
          };
          phases.push({
            dur: actor ? 0.25 : 0.08,
            run: (p) => {
              own();
              pose(contact(A()), "use1");
              const e = easeInOut(p);
              const a = A();
              const h = hand();
              this.air.set(token.id, { x: lerp(a.x, h.x, e), y: lerp(a.y, h.y, e), rot: 0, scale: 1 });
            },
          });
          if (actor)
            phases.push({
              dur: 0.14,
              run: (p) => {
                const c = contact(A());
                const h = hand();
                pose({ x: c.x - dir * 4 * p, y: c.y }, "use2");
                this.air.set(token.id, { x: h.x - dir * 4 * p, y: h.y, rot: -dir * 0.3 * p, scale: 1 });
              },
            });
          const d0 = dist(hand(), B());
          const spin = dir * Math.PI * 2 * Math.max(1, Math.round(d0 / (sq() * 3)));
          phases.push({
            dur: clamp(Math.sqrt(d0) / 26, 0.45, 0.95),
            run: (p) => {
              const start = { x: hand().x - (actor ? dir * 4 : 0), y: hand().y };
              const b = B();
              const h = Math.max(sq() * 0.9, dist(start, b) * 0.32);
              const pos = arc(start, b, p, h);
              this.air.set(token.id, { ...pos, rot: spin * p, scale: 1 + 0.15 * Math.sin(p * Math.PI) });
              pose(contact(A()), p < 0.35 ? "use3" : "use4");
            },
          });
          phases.push({
            dur: 0.32,
            run: (p) => {
              knock();
              const b = B();
              const up = bounce(p, sq() * 0.18);
              if (!job.settled) this.air.set(token.id, { x: b.x, y: b.y - up, rot: (1 - p) * 0.25 * Math.sin(p * 20), scale: 1 });
              pose(contact(A()), "idle");
              if (p >= 1) settle();
            },
          });
        }
        if (actor) {
          const after = () => (thrown ? contact(A()) : { x: contact(B()).x - dir * 6, y: contact(B()).y });
          phases.push({ dur: 0.3, run: () => pose(after(), "idle") });
          phases.push(this.flyPhase(job, after(), () => this.homes.get(actor.id) ?? after(), this.isSeated(actor.id) ? "sit" : "idle"));
        }
        return phases;
      },
    };
    return job;
  }

  /** A captured piece is knocked off its square and tumbles into the capturing side's tray. */
  private knockJob(victim: Token): Job {
    let from: Vec | null = null;
    const to = () => this.geo.tray(victim.trayOf ?? "w", victim.tray);
    const job: Job = {
      actor: null,
      tokens: [victim.id],
      phases: null,
      i: 0,
      t: 0,
      settled: false,
      finish: () => {
        if (victim.view.kind === "anim" || victim.view.kind === "square") this.land(victim);
        job.settled = true;
      },
      build: () => [
        {
          dur: this.opts.reducedMotion ? 0.12 : 0.65,
          run: (p) => {
            if (!from) {
              from = this.shownPos(victim);
              this.take(victim, from);
            }
            const t = to();
            const end = this.geo.traySize / this.geo.size;
            const pos = arc(from, t, p, this.opts.reducedMotion ? 0 : 70);
            this.air.set(victim.id, { ...pos, rot: (this.opts.reducedMotion ? 0 : Math.PI * 3) * p, scale: lerp(1, end, p) });
            if (p >= 1) {
              this.land(victim);
              this.sparkles.push({ x: t.x, y: t.y, age: 0 });
              job.settled = true;
            }
          },
        },
      ],
    };
    return job;
  }
}

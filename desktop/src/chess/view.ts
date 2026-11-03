// The chess board in the overlay: a Terraria-style framed board resting near the bottom of the
// screen. The board, resting pieces, highlights, trays and the opponent's chair are drawn behind
// the companions; the controls, move list, lesson card, promotion picker and pieces in flight are
// layered in front of them.
//
// Modes: two local players; play the selected companion (she sits on a chair across the board,
// thinks, and moves her own pieces; everyone else supports you); or an opening lesson. Pieces are
// only ever drawn where the director says they are shown (see director.ts), so a moving piece is
// drawn exactly once. The board can be resized (corner handle), maximized and restored; the size,
// material and mode are saved in prefs.

import type { CharacterId, ChessPrefs } from "../bridge";
import { loadTexture } from "../assets/textures";
import { CHARACTERS } from "../characters/roster";
import { positionKey, type Difficulty } from "./ai";
import { CheerLimiter, type CheerEvent } from "./cheers";
import { assignTeams, ChessDirector, type ActorPort, type ChessGeometry, type Teams, type Vec } from "./director";
import { MATERIALS, materialById, rgb, type BoardMaterial } from "./materials";
import { OpponentBrain } from "./opponent";
import { judgeMove, lessonState, moveFromSan, OPENINGS, openingById, type Opening, type Variation } from "./openings";
import { drawPiece } from "./pieces";
import {
  file,
  inCheck,
  kingSquare,
  movesFrom,
  needsPromotion,
  newGame,
  other,
  play,
  rank,
  sq,
  toFen,
  type Color,
  type Game,
  type Move,
  type PieceType,
  type Promotion,
  type Square,
} from "./rules";

// ── Layout ──────────────────────────────────────────────────────────────────────────────────

export interface ChessLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Board including its frame. */
  board: { x: number; y: number; size: number };
  frame: number;
  /** One square (px). */
  sq: number;
  panel: { x: number; y: number; w: number; h: number };
  side: number;
  /** Where supporters stand (their feet). */
  ground: number;
  /** The largest board that fits (for the resize handle and Maximize). */
  maxBoard: number;
}

const PANEL_H = 40;
export const MIN_BOARD = 240;
const DEFAULT_BOARD = 560;

const sideFor = (W: number) => Math.round(Math.min(200, Math.max(96, W * 0.11)));

/** The biggest board that fits beside two side columns on a W×H overlay. */
export function maxBoardFor(W: number, H: number): number {
  const side = sideFor(W);
  return Math.max(MIN_BOARD, Math.floor(Math.min(H - PANEL_H - 22, W - 2 * side - 40)));
}

/**
 * Fit the board, its panel and the two side columns into the overlay, resting near the bottom and
 * centred. `board` is the wanted board size in px (0 = automatic); `maximized` uses the largest
 * that fits. Squares are always square and whole pixels.
 */
export function chessLayout(W: number, H: number, opts: { board?: number; maximized?: boolean; x?: number; y?: number } = {}): ChessLayout {
  const side = sideFor(W);
  const maxBoard = maxBoardFor(W, H);
  const auto = Math.min(DEFAULT_BOARD, Math.floor((H - PANEL_H - 24) * 0.9), W - 2 * side - 40);
  let size = opts.maximized ? maxBoard : opts.board ? opts.board : auto;
  size = Math.max(MIN_BOARD, Math.min(maxBoard, size));
  const frame = Math.max(6, Math.round(size / 42));
  const sqPx = Math.floor((size - 2 * frame) / 8);
  size = sqPx * 8 + 2 * frame;
  const width = size + 2 * side + 24;
  const height = size + PANEL_H + 8;
  // Dragged somewhere (fractions of the free space), or centred and resting on the floor.
  const moved = (opts.x ?? -1) >= 0 && (opts.y ?? -1) >= 0;
  const freeX = Math.max(0, W - width - 8);
  const freeY = Math.max(0, H - height - 14); // 4 px margin above, 10 px for the shelf below
  const left = moved ? 4 + Math.round(Math.min(1, opts.x!) * freeX) : Math.max(4, Math.round((W - width) / 2));
  const top = moved ? 4 + Math.round(Math.min(1, opts.y!) * freeY) : Math.max(4, H - 6 - height);
  const bx = left + side + 12;
  const by = top + PANEL_H + 8;
  return { left, top, width, height, board: { x: bx, y: by, size }, frame, sq: sqPx, panel: { x: bx, y: top, w: size, h: PANEL_H }, side, ground: top + height, maxBoard };
}

export interface BoardView {
  /** Black at the bottom (you play Black against a companion or in a lesson). */
  flipped: boolean;
}

/** Board square → screen, honouring the flip. */
function squareRect(l: ChessLayout, s: Square, v: BoardView) {
  const col = v.flipped ? 7 - file(s) : file(s);
  const row = v.flipped ? rank(s) : 7 - rank(s);
  return { x: l.board.x + l.frame + col * l.sq, y: l.board.y + l.frame + row * l.sq };
}

export function squareAt(l: ChessLayout, x: number, y: number, v: BoardView = { flipped: false }): Square | null {
  const col = Math.floor((x - l.board.x - l.frame) / l.sq);
  const row = Math.floor((y - l.board.y - l.frame) / l.sq);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return v.flipped ? sq(7 - col, row) : sq(col, 7 - row);
}

/** The opponent's chair: right of the board on the ground, sized to the companion (h = her height). */
export function chairBox(l: ChessLayout, h: number) {
  const k = (h * 0.62) / 34; // the chair sprite is 16×34
  const w = 16 * k;
  const ht = 34 * k;
  const x = l.board.x + l.board.size + 18;
  return { x, y: l.ground - ht, w, h: ht, k, seatY: l.ground - 10 * k };
}

/**
 * Screen geometry for the director. The side at the bottom of the board owns the left column
 * (supporters, its capture tray); the other side owns the right one (and the opponent's chair).
 */
export function geometryFor(l: ChessLayout, v: BoardView = { flipped: false }, seatFor?: { h: number }): ChessGeometry {
  const traySize = Math.max(14, Math.min(26, Math.floor((l.side - 16) / 5)));
  const near: Color = v.flipped ? "b" : "w";
  const chair = seatFor ? chairBox(l, seatFor.h) : null;
  return {
    center: (s) => {
      const r = squareRect(l, s, v);
      return { x: r.x + l.sq / 2, y: r.y + l.sq / 2 };
    },
    size: l.sq,
    spot: (team, i) => {
      if (team !== "both" && team !== near) return { x: l.board.x + l.board.size + 36 + i * 54, y: l.ground };
      return { x: Math.max(24, l.board.x - 36 - i * 54), y: l.ground };
    },
    seat: chair ? { x: chair.x + chair.w * 0.42, y: chair.seatY } : undefined,
    tray: (by, i) => {
      const x0 = by === near ? l.left + 10 : l.board.x + l.board.size + 14;
      return { x: x0 + traySize / 2 + (i % 5) * (traySize + 2), y: l.top + 34 + traySize / 2 + Math.floor(i / 5) * (traySize + 2) };
    },
    traySize,
  };
}

// ── Text helpers ────────────────────────────────────────────────────────────────────────────

export function statusText(g: Game, names?: Partial<Record<Color, string>>): string {
  const s = g.status;
  const side = (c: Color) => names?.[c] ?? (c === "w" ? "White" : "Black");
  switch (s.kind) {
    case "checkmate":
      return `Checkmate! ${side(s.winner)} ${side(s.winner) === "You" ? "win" : "wins"}`;
    case "stalemate":
      return "Stalemate: it's a draw";
    case "draw":
      return s.reason === "repetition" ? "Draw by threefold repetition" : s.reason === "fifty-move" ? "Draw by the fifty-move rule" : "Draw: not enough pieces to mate";
    default:
      return `${side(g.position.turn)} to move${s.check ? " (check!)" : ""}`;
  }
}

/** Move list as numbered pairs: ["1. e4 e5", "2. Nf3"]. */
export function movePairs(g: Game): string[] {
  const out: string[] = [];
  for (let i = 0; i < g.history.length; i += 2) {
    const n = i / 2 + 1;
    out.push(`${n}. ${g.history[i].san}${g.history[i + 1] ? " " + g.history[i + 1].san : ""}`);
  }
  return out;
}

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Which cheer each side's supporters should give after a move. */
export function cheerEvents(before: Game, after: Game, m: Move): { mover: CheerEvent | null; other: CheerEvent | null } {
  const st = after.status;
  if (st.kind === "checkmate") return { mover: "win", other: "lose" };
  if (st.kind !== "playing") return { mover: "draw", other: "draw" };
  if (st.check) return { mover: "check", other: "inCheck" };
  if (m.castle || m.promotion || (m.captured && VALUE[m.captured.type] >= 5)) return { mover: "good", other: m.captured ? "lost" : null };
  if (m.captured) return { mover: "capture", other: "lost" };
  let mat = 0;
  let total = 0;
  for (const pc of after.position.board) {
    if (!pc) continue;
    total += VALUE[pc.type];
    mat += (pc.color === "w" ? 1 : -1) * VALUE[pc.type];
  }
  if (before.history.length >= 40 && total <= 20 && Math.abs(mat) <= 1) return { mover: "close", other: "close" };
  return { mover: null, other: null };
}

/** A card flip's width at progress p (0..1): full, easing to edge-on at the middle, full again. */
export function flipWidth(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return Math.abs(Math.cos(Math.PI * e));
}

export const DEFAULT_CHESS: ChessPrefs = { board: 0, maximized: false, material: "marble", mode: "local", playerColor: "w", difficulty: "normal", x: -1, y: -1 };

export function normalizeChess(c?: Partial<ChessPrefs> | null): ChessPrefs {
  return {
    board: typeof c?.board === "number" && Number.isFinite(c.board) ? c.board : 0,
    maximized: !!c?.maximized,
    material: MATERIALS.some((m) => m.id === c?.material) ? c!.material! : DEFAULT_CHESS.material,
    mode: c?.mode === "companion" || c?.mode === "lesson" ? c.mode : "local",
    playerColor: c?.playerColor === "b" ? "b" : "w",
    difficulty: c?.difficulty === "easy" || c?.difficulty === "hard" ? c.difficulty : "normal",
    ...(typeof c?.x === "number" && typeof c?.y === "number" && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1 ? { x: c.x, y: c.y } : { x: -1, y: -1 }),
  };
}

// ── The view ────────────────────────────────────────────────────────────────────────────────

export interface ChessHooks {
  /** Companions on screen (the selected one first). */
  actors: () => ActorPort[];
  /** The currently selected companion (the opponent in companion mode). */
  selected: () => CharacterId;
  /** Can she play right now (on screen and not paused)? */
  opponentAvailable: (id: CharacterId) => boolean;
  say: (id: CharacterId, text: string) => void;
  /** Saved chess settings, and saving new ones. */
  prefs: () => ChessPrefs | undefined;
  save: (c: ChessPrefs) => void;
  /** The board was closed and every companion has been handed back. */
  closed: () => void;
}

interface Textures {
  light?: ImageBitmap;
  dark?: ImageBitmap;
  frame?: ImageBitmap;
  torch?: ImageBitmap;
  chair?: ImageBitmap;
}

type Notice = { kind: "changed"; to: CharacterId } | { kind: "unavailable" } | null;

interface Lesson {
  opening: Opening;
  variation: Variation;
  /** "random" or a fixed variation index. */
  choice: number | "random";
  message: string;
  hint: boolean;
}

/** She always takes at least this long to "think" (it reads as considering, not instant). */
const MIN_THINK = 0.9;

export class ChessView {
  game: Game = newGame();
  private layout: ChessLayout;
  private settings: ChessPrefs;
  private readonly director: ChessDirector;
  private readonly under: HTMLDivElement;
  private readonly board: HTMLCanvasElement;
  private readonly over: HTMLDivElement;
  private readonly air: HTMLCanvasElement;
  private readonly hit: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly statusEl: HTMLSpanElement;
  private readonly turnIcon: HTMLCanvasElement;
  private readonly historyEl: HTMLOListElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly maxBtn: HTMLButtonElement;
  private readonly grip: HTMLDivElement;
  private readonly labels: HTMLDivElement[] = [];
  private readonly card: HTMLDivElement;
  private menu: HTMLDivElement | null = null;
  private picker: HTMLDivElement | null = null;
  private selected: Square | null = null;
  private dragFrom: Square | null = null;
  private pressedSelected = false;
  private drawnKey = "";
  private artVersion = 0;
  private airDrawn = false;
  private tex: Textures = {};
  private loadedMaterial = "";
  private readonly cheers = new CheerLimiter();
  private clock = 0;
  private origins = new Map<CharacterId, Vec>();
  private closing = false;
  private confirmNew = 0;
  private readonly reducedMotion: boolean;
  // Companion opponent / lesson.
  private opponent: CharacterId | null = null;
  private notice: Notice = null;
  private brain: OpponentBrain | null = null;
  private thinking = false;
  /** Bumped by restarts, mode changes and closing: late answers for an old game are ignored. */
  private gameToken = 0;
  private lesson: Lesson | null = null;
  private resizing: { id: number; x: number; y: number; size: number } | null = null;
  /** Dragging the board by its panel (like a window's title bar). */
  private moving: { id: number; dx: number; dy: number } | null = null;
  /** Shelf height under a board that's been lifted off the floor. */
  private static readonly SHELF = 10;
  /** You turned the board around (on top of sitting on Black's side). Each new game resets it. */
  private turned = false;
  /** The card flip in progress: when it started, and whether the view has switched (halfway). */
  private flipping: { t0: number; switched: boolean } | null = null;
  private flipCanvas: HTMLCanvasElement | null = null;
  private static readonly FLIP_TIME = 0.5;

  constructor(
    private bounds: { width: number; height: number },
    private readonly hooks: ChessHooks,
  ) {
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.settings = normalizeChess(hooks.prefs());
    this.layout = chessLayout(bounds.width, bounds.height, this.settings);
    this.director = new ChessDirector(geometryFor(this.layout), { reducedMotion: this.reducedMotion });

    // Behind the companions: the board itself.
    this.under = document.createElement("div");
    this.under.className = "chess-under";
    this.board = document.createElement("canvas");
    this.under.append(this.board);
    if (!this.reducedMotion) {
      for (const s of ["left", "right"]) {
        const glow = document.createElement("div");
        glow.className = `chess-torch chess-torch-${s}`;
        this.under.append(glow);
      }
    }
    // In front of them: controls, move list, lesson card, pieces in flight.
    this.over = document.createElement("div");
    this.over.className = "chess-over";
    this.air = document.createElement("canvas");
    this.air.className = "chess-air";
    this.hit = document.createElement("div");
    this.hit.className = "chess-hit";
    this.hit.setAttribute("role", "grid");
    this.hit.setAttribute("aria-label", "Chess board");
    this.panel = document.createElement("div");
    this.panel.className = "chess-panel";
    this.turnIcon = document.createElement("canvas");
    this.turnIcon.className = "chess-turn-icon";
    this.turnIcon.width = 18;
    this.turnIcon.height = 18;
    this.statusEl = document.createElement("span");
    this.statusEl.className = "chess-status";
    this.statusEl.setAttribute("aria-live", "polite");
    const optBtn = this.button("⚙", () => this.toggleMenu(), "Options: mode, opponent, lessons, board");
    const flipBtn = this.button("⇅", () => this.flip(), "Turn the board around");
    this.maxBtn = this.button("⤢", () => this.toggleMaximize(), "Maximize the board");
    this.newBtn = this.button("New", () => this.onNewGame(), "New game");
    const closeBtn = this.button("✕", () => this.close(), "Close chess");
    const status = document.createElement("div");
    status.className = "chess-turn";
    status.append(this.turnIcon, this.statusEl);
    const buttons = document.createElement("div");
    buttons.className = "chess-buttons";
    buttons.append(optBtn, flipBtn, this.maxBtn, this.newBtn, closeBtn);
    this.panel.append(status, buttons);
    this.historyEl = document.createElement("ol");
    this.historyEl.className = "chess-history";
    this.historyEl.setAttribute("aria-label", "Moves");
    for (let i = 0; i < 2; i++) {
      const l = document.createElement("div");
      l.className = "chess-label";
      this.labels.push(l);
    }
    this.card = document.createElement("div");
    this.card.className = "chess-card";
    this.card.hidden = true;
    this.grip = document.createElement("div");
    this.grip.className = "chess-grip";
    this.grip.title = "Drag to resize the board";
    this.grip.setAttribute("aria-label", "Resize the board");
    this.over.append(this.hit, this.panel, ...this.labels, this.historyEl, this.card, this.grip, this.air);
    document.body.prepend(this.under);
    document.body.append(this.over);

    this.hit.addEventListener("pointerdown", this.onDown);
    this.hit.addEventListener("pointerup", this.onUp);
    this.hit.addEventListener("pointercancel", this.onCancel);
    this.grip.addEventListener("pointerdown", this.onGripDown);
    this.grip.addEventListener("pointermove", this.onGripMove);
    this.grip.addEventListener("pointerup", this.onGripUp);
    this.grip.addEventListener("pointercancel", this.onGripUp);
    this.panel.addEventListener("pointerdown", this.onPanelDown);
    this.panel.addEventListener("pointermove", this.onPanelMove);
    this.panel.addEventListener("pointerup", this.onPanelUp);
    this.panel.addEventListener("pointercancel", this.onPanelUp);
    this.panel.addEventListener("dblclick", this.onPanelDouble);
    this.panel.title = "Drag to move the board · double-click to put it back";
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);

    for (const a of hooks.actors()) this.origins.set(a.id, a.feet());
    this.director.open(this.game.position, { w: [], b: [], both: null });
    this.startMode(this.settings.mode, true);
    this.place();
    void this.loadTextures();
    console.info(`chess: opened (${this.settings.mode}), ${this.describeTeams()}; board ${this.layout.board.size}px`);
  }

  private button(label: string, onClick: () => void, title?: string) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chess-button";
    b.textContent = label;
    if (title) {
      b.title = title;
      b.setAttribute("aria-label", title);
    }
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private async loadTextures() {
    const mat = materialById(this.settings.material);
    this.loadedMaterial = mat.id;
    const [light, dark, frame, torch, chair] = await Promise.all([mat.light.tex, mat.dark.tex, mat.frame.tex, "Images/Item_8", "Images/Tiles_15"].map((n) => loadTexture(n).catch(() => null)));
    if (this.loadedMaterial !== mat.id) return; // switched again meanwhile
    this.tex = { light: light ?? undefined, dark: dark ?? undefined, frame: frame ?? undefined, torch: torch ?? undefined, chair: chair ?? undefined };
    this.artVersion++;
  }

  private get material(): BoardMaterial {
    return materialById(this.settings.material);
  }

  // ── Modes ────────────────────────────────────────────────────────────────────────────────

  private get mode() {
    return this.settings.mode;
  }

  /** The side you play (in two-player mode both sides are you; White sits at the bottom). */
  private get you(): Color {
    if (this.mode === "lesson" && this.lesson) return this.lesson.opening.side;
    return this.mode === "companion" ? this.settings.playerColor : "w";
  }

  /** Your side at the bottom (Black's when you play Black), unless you've turned the board around. */
  private get view(): BoardView {
    return { flipped: (this.mode !== "local" && this.you === "b") !== this.turned };
  }

  /**
   * Turn the board around, like flipping a card: the squares and pieces squash to a line, the
   * view switches to the other side halfway, and they open out again (the frame and torches stay).
   */
  flip() {
    if (this.closing || this.flipping) return;
    this.selected = null;
    this.dragFrom = null;
    if (this.reducedMotion) {
      this.turned = !this.turned;
      this.director.setGeometry(this.geometry());
      this.drawnKey = "";
      this.render();
      return;
    }
    this.flipping = { t0: this.clock, switched: false };
  }

  /** How wide the squares are drawn during a flip (1 = not flipping). */
  private flipScale(): number {
    return this.flipping ? flipWidth((this.clock - this.flipping.t0) / ChessView.FLIP_TIME) : 1;
  }

  private stepFlip() {
    const f = this.flipping;
    if (!f) return;
    const p = (this.clock - f.t0) / ChessView.FLIP_TIME;
    if (p >= 0.5 && !f.switched) {
      f.switched = true;
      this.turned = !this.turned;
      this.director.setGeometry(this.geometry());
    }
    if (p >= 1) this.flipping = null;
    this.drawnKey = "";
  }

  private get vsCompanion() {
    return this.mode === "companion" || this.mode === "lesson";
  }

  /** Set up a mode on a fresh game (or keep the position, when continuing from a lesson). */
  private startMode(mode: ChessPrefs["mode"], fresh: boolean, keepPosition = false) {
    this.cancelThinking();
    // A new game starts from your own side.
    this.turned = false;
    this.flipping = null;
    this.gameToken++;
    this.settings = { ...this.settings, mode };
    this.notice = null;
    this.selected = null;
    this.closePicker();
    if (!keepPosition) {
      this.director.reconcile();
      this.game = newGame();
      this.director.reset(this.game.position);
    }
    if (mode === "lesson") {
      if (!this.lesson) this.lesson = this.newLesson(OPENINGS[0], "random");
    } else this.lesson = null;
    this.opponent = this.vsCompanion ? this.hooks.selected() : null;
    this.director.setGeometry(this.geometry());
    this.director.setTeams(this.teamsFor());
    this.cheers.reset();
    if (!fresh) this.save();
    if (!this.torn) this.place();
    this.updateCard();
    this.drawnKey = "";
    this.render();
    if (!keepPosition) this.greet();
  }

  private newLesson(opening: Opening, choice: number | "random"): Lesson {
    const i = choice === "random" ? Math.floor(Math.random() * opening.variations.length) : Math.min(choice, opening.variations.length - 1);
    const variation = opening.variations[i];
    return { opening, variation, choice, message: `${opening.summary}\n\nThey'll answer with: ${variation.name}. ${variation.idea}`, hint: false };
  }

  private teamsFor(): Teams {
    const actors = this.hooks.actors();
    if (!this.vsCompanion) return { ...assignTeams(actors), seated: null };
    const opp = actors.find((a) => a.id === this.opponent) ?? null;
    const helpers = actors.filter((a) => a !== opp).slice(0, 3);
    const you = this.you;
    const teams: Teams = { w: [], b: [], both: null, seated: opp?.id ?? null };
    teams[you] = helpers;
    teams[other(you)] = opp ? [opp] : [];
    return teams;
  }

  private geometry(): ChessGeometry {
    const opp = this.vsCompanion ? this.hooks.actors().find((a) => a.id === this.opponent) : undefined;
    return geometryFor(this.layout, this.view, opp ? { h: opp.size().h } : undefined);
  }

  private names(): Partial<Record<Color, string>> | undefined {
    if (!this.vsCompanion || !this.opponent) return undefined;
    const you = this.you;
    return { [you]: "You", [other(you)]: CHARACTERS[this.opponent].name } as Partial<Record<Color, string>>;
  }

  // ── Layout & resizing ────────────────────────────────────────────────────────────────────

  /** The clickable area (for the overlay's hitbox); the options menu opens inside it. */
  rect() {
    const l = this.layout;
    return { x: l.left, y: l.top, w: l.width, h: l.height };
  }

  get isClosing() {
    return this.closing;
  }

  resize(bounds: { width: number; height: number }) {
    this.bounds = bounds;
    this.relayout();
  }

  private relayout() {
    this.layout = chessLayout(this.bounds.width, this.bounds.height, this.settings);
    // Animations read the geometry every frame, so a piece mid-move stays with its companion.
    this.director.setGeometry(this.geometry());
    this.closePicker();
    this.closeMenu();
    this.place();
  }

  private toggleMaximize() {
    this.settings = { ...this.settings, maximized: !this.settings.maximized };
    this.relayout();
    this.save();
  }

  private onGripDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.resizing = { id: e.pointerId, x: e.clientX, y: e.clientY, size: this.layout.board.size };
    capture(this.grip, e.pointerId);
  };

  private onGripMove = (e: PointerEvent) => {
    const r = this.resizing;
    if (!r || e.pointerId !== r.id) return;
    // The board is centred and rests on the floor: dragging up or outward makes it bigger.
    const grow = Math.max(r.y - e.clientY, (e.clientX - r.x) * 2);
    const size = Math.round(Math.max(MIN_BOARD, Math.min(this.layout.maxBoard, r.size + grow)));
    if (size === this.layout.board.size && !this.settings.maximized) return;
    this.settings = { ...this.settings, board: size, maximized: false };
    this.relayout();
  };

  private onGripUp = (e: PointerEvent) => {
    if (!this.resizing || e.pointerId !== this.resizing.id) return;
    this.resizing = null;
    this.save();
  };

  // ── Moving the board (drag the panel like a title bar) ─────────────────────────────────

  private onPanelDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.closing) return;
    // Buttons in the panel keep working; drag from anywhere else on it.
    if ((e.target as HTMLElement).closest("button, select, input")) return;
    e.preventDefault();
    e.stopPropagation();
    this.closeMenu();
    this.moving = { id: e.pointerId, dx: e.clientX - this.layout.left, dy: e.clientY - this.layout.top };
    capture(this.panel, e.pointerId);
    this.panel.classList.add("moving");
  };

  private onPanelMove = (e: PointerEvent) => {
    const m = this.moving;
    if (!m || e.pointerId !== m.id) return;
    const l = this.layout;
    const freeX = Math.max(1, this.bounds.width - l.width - 8);
    const freeY = Math.max(1, this.bounds.height - l.height - 14);
    const x = Math.min(1, Math.max(0, (e.clientX - m.dx - 4) / freeX));
    const y = Math.min(1, Math.max(0, (e.clientY - m.dy - 4) / freeY));
    if (x === this.settings.x && y === this.settings.y) return;
    this.settings = { ...this.settings, x, y };
    this.relayout();
  };

  private onPanelUp = (e: PointerEvent) => {
    if (!this.moving || e.pointerId !== this.moving.id) return;
    this.moving = null;
    this.panel.classList.remove("moving");
    this.save();
  };

  /** Double-click the panel: back to the default spot (centred on the floor). */
  private onPanelDouble = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, select, input")) return;
    this.settings = { ...this.settings, x: -1, y: -1 };
    this.relayout();
    this.save();
  };

  /** Lifted off the floor (dragged up)? Then supporters stand on a shelf under the board. */
  private get floating() {
    return this.layout.ground < this.bounds.height - 12;
  }

  private save() {
    this.hooks.save(this.settings);
  }

  private place() {
    const l = this.layout;
    const dpr = window.devicePixelRatio || 1;
    const H = l.height + ChessView.SHELF;
    Object.assign(this.under.style, { left: `${l.left}px`, top: `${l.top}px`, width: `${l.width}px`, height: `${H}px` });
    this.board.width = Math.round(l.width * dpr);
    this.board.height = Math.round(H * dpr);
    this.board.style.width = `${l.width}px`;
    this.board.style.height = `${H}px`;
    this.artVersion++;
    this.under.querySelectorAll<HTMLDivElement>(".chess-torch").forEach((t, i) => {
      Object.assign(t.style, { left: `${(i ? l.board.x + l.board.size + 2 : l.board.x - 2) - l.left}px`, top: `${l.board.y - 10 - l.top}px` });
    });
    // The air layer spans a margin around the board so thrown pieces can arc above it.
    const m = 160;
    Object.assign(this.air.style, { left: `${l.left - m}px`, top: `${l.top - m}px`, width: `${l.width + 2 * m}px`, height: `${l.height + m}px` });
    this.air.width = Math.round((l.width + 2 * m) * dpr);
    this.air.height = Math.round((l.height + m) * dpr);
    Object.assign(this.hit.style, { left: `${l.board.x + l.frame}px`, top: `${l.board.y + l.frame}px`, width: `${l.sq * 8}px`, height: `${l.sq * 8}px` });
    Object.assign(this.panel.style, { left: `${l.panel.x}px`, top: `${l.panel.y}px`, width: `${l.panel.w}px`, height: `${l.panel.h}px` });
    Object.assign(this.grip.style, { left: `${l.board.x + l.board.size - 10}px`, top: `${l.board.y - 10}px` });
    this.maxBtn.textContent = this.settings.maximized ? "⤡" : "⤢";
    this.maxBtn.title = this.settings.maximized ? "Restore the board size" : "Maximize the board";
    this.maxBtn.setAttribute("aria-label", this.maxBtn.title);
    const [left, right] = this.labels;
    Object.assign(left.style, { left: `${l.left + 6}px`, top: `${l.top + 6}px`, width: `${l.side}px` });
    Object.assign(right.style, { left: `${l.board.x + l.board.size + 12}px`, top: `${l.top + 6}px`, width: `${l.side}px` });
    const g = geometryFor(l, this.view);
    const colTop = l.top + 34 + 3 * (g.traySize + 2) + 8;
    // The move list sits in the right column, above the opponent's chair or supporters.
    const reserve = this.vsCompanion ? 170 : 130;
    Object.assign(this.historyEl.style, { left: `${l.board.x + l.board.size + 12}px`, top: `${colTop}px`, width: `${l.side}px`, height: `${Math.max(48, l.ground - reserve - colTop)}px` });
    // The lesson / notice card in the left column, above your supporters.
    Object.assign(this.card.style, { left: `${l.left + 6}px`, top: `${colTop}px`, width: `${l.side}px`, maxHeight: `${Math.max(80, l.ground - 120 - colTop)}px` });
    this.updateLabels();
  }

  private updateLabels() {
    const [left, right] = this.labels;
    const near: Color = this.view.flipped ? "b" : "w";
    const far = other(near);
    const colorName = (c: Color) => (c === "w" ? "White" : "Black");
    left.className = `chess-label near chess-label-${near === "w" ? "white" : "black"}`;
    if (this.vsCompanion && this.opponent) {
      left.textContent = `You · ${colorName(near)}`;
      right.textContent = `${this.mode === "lesson" ? "Tutor" : "Opponent"}: ${CHARACTERS[this.opponent].name}`;
      right.className = "chess-label far chess-label-opponent";
    } else {
      left.textContent = colorName(near);
      right.textContent = colorName(far);
      right.className = `chess-label far chess-label-${far === "w" ? "white" : "black"}`;
    }
    this.over.dataset.turn = this.game.position.turn === near ? "near" : "far";
  }

  // ── Input ────────────────────────────────────────────────────────────────────────────────

  /** Can you move the side to move right now? (Never her pieces, never twice in a row.) */
  private yourTurn() {
    if (this.game.status.kind !== "playing" || this.notice) return false;
    if (!this.vsCompanion) return true;
    return this.game.position.turn === this.you && !this.thinking;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.closing || this.flipping) return;
    e.preventDefault();
    e.stopPropagation();
    this.closeMenu();
    if (this.picker) return;
    const clicked = squareAt(this.layout, e.clientX, e.clientY, this.view);
    if (clicked === null || !this.yourTurn()) return;
    if (this.selected !== null && this.selected !== clicked && this.isTarget(this.selected, clicked)) {
      this.tryMove(this.selected, clicked);
      return;
    }
    const s = this.pieceSquare(clicked);
    const pc = this.game.position.board[s];
    if (pc && pc.color === this.game.position.turn) {
      this.pressedSelected = this.selected === s;
      this.selected = s;
      this.dragFrom = s;
      capture(this.hit, e.pointerId);
    } else this.selected = null;
    this.render();
  };

  /**
   * The square of the piece you meant by clicking `clicked`. A moved piece is still drawn on its
   * old square until a companion carries it over, so a click on where it's *shown* means that
   * piece; a click on its real square while it's still on the way means it too. Either way it
   * lands on its real square at once, so what you grab is what you see.
   */
  private pieceSquare(clicked: Square): Square {
    const turn = this.game.position.turn;
    const real = this.director.tokenAt(clicked);
    if (real && real.color === turn) {
      if (!(real.view.kind === "square" && real.view.sq === clicked)) this.director.settle(real);
      return clicked;
    }
    const shown = this.director.shownAt(clicked);
    if (shown && shown.color === turn && shown.sq !== null && shown.sq !== clicked) {
      this.director.settle(shown);
      return shown.sq;
    }
    return clicked;
  }

  private onUp = (e: PointerEvent) => {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === null || this.closing) return;
    const s = squareAt(this.layout, e.clientX, e.clientY, this.view);
    if (s !== null && s !== from && this.isTarget(from, s)) this.tryMove(from, s);
    else if (s === from && this.pressedSelected) this.selected = null;
    this.render();
  };

  private onCancel = () => {
    this.dragFrom = null;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (this.menu) this.closeMenu();
    else if (this.picker) this.closePicker();
    else if (this.selected !== null) {
      this.selected = null;
      this.render();
    }
  };

  private onVisibility = () => {
    if (document.visibilityState === "hidden") this.interrupt();
  };

  /** Focus lost or hidden: finish every animation at once so nothing is left half-moved. */
  interrupt() {
    this.director.reconcile(this.game.position);
    this.closePicker();
    this.dragFrom = null;
    this.resizing = null;
    this.render();
  }

  private isTarget(from: Square, to: Square) {
    return movesFrom(this.game.position, from).some((m) => m.to === to);
  }

  private tryMove(from: Square, to: Square) {
    if (this.mode === "lesson" && this.lesson) {
      const verdict = judgeMove(this.game, this.lesson.variation, this.game.history.length, from, to);
      if (!verdict.ok) {
        this.lesson.message = `Not quite! ${verdict.why}`;
        this.lesson.hint = true;
        this.selected = null;
        this.updateCard();
        this.render();
        return;
      }
    }
    if (needsPromotion(this.game, from, to)) {
      this.openPicker(from, to);
      return;
    }
    this.commit(from, to);
  }

  /** Play a move (yours or hers); the director animates it with a supporter of the mover. */
  private commit(from: Square, to: Square, promotion?: Promotion) {
    const before = this.game;
    const r = play(before, from, to, promotion);
    if (!r) return false;
    this.game = r.game;
    this.selected = null;
    this.director.played(r.move, this.game.position);
    this.react(before, r.move);
    if (this.mode === "lesson") this.afterLessonMove(r.move);
    this.render();
    return true;
  }

  private openPicker(from: Square, to: Square) {
    this.closePicker();
    const color = this.game.position.turn;
    const c = this.director.geometry.center(to);
    const p = document.createElement("div");
    p.className = "chess-picker";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Promote to");
    for (const t of ["q", "r", "b", "n"] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chess-pick";
      b.title = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[t];
      b.setAttribute("aria-label", b.title);
      const cv = document.createElement("canvas");
      cv.width = 36;
      cv.height = 36;
      drawPiece(cv.getContext("2d")!, color, t, 18, 18, 32);
      b.append(cv);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closePicker();
        this.commit(from, to, t);
      });
      p.append(b);
    }
    const cancel = this.button("×", () => this.closePicker(), "Cancel");
    cancel.classList.add("chess-pick-cancel");
    p.append(cancel);
    this.over.append(p);
    const w = p.offsetWidth || 200;
    const h = p.offsetHeight || 48;
    const l = this.layout;
    const x = Math.min(l.board.x + l.board.size - w, Math.max(l.board.x, c.x - w / 2));
    const y = c.y < l.board.y + l.board.size / 2 ? c.y + l.sq / 2 + 4 : c.y - l.sq / 2 - h - 4;
    Object.assign(p.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
    this.picker = p;
  }

  private closePicker() {
    this.picker?.remove();
    this.picker = null;
  }

  // ── Options menu ─────────────────────────────────────────────────────────────────────────

  private toggleMenu() {
    if (this.menu) this.closeMenu();
    else this.openMenu();
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private openMenu() {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "chess-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Chess options");
    menu.addEventListener("pointerdown", (e) => e.stopPropagation());
    const section = (title: string) => {
      const h = document.createElement("div");
      h.className = "chess-menu-title";
      h.textContent = title;
      menu.append(h);
    };
    const row = (...els: HTMLElement[]) => {
      const r = document.createElement("div");
      r.className = "chess-menu-row";
      r.append(...els);
      menu.append(r);
    };
    const choice = (label: string, on: boolean, act: () => void, title?: string) => {
      const b = this.button(label, act, title);
      if (on) b.classList.add("on");
      return b;
    };
    const select = (label: string, value: string, options: [string, string][], change: (v: string) => void) => {
      const l = document.createElement("label");
      l.className = "chess-menu-select";
      l.append(label);
      const s = document.createElement("select");
      for (const [v, t] of options) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        s.append(o);
      }
      s.value = value;
      s.addEventListener("change", () => change(s.value));
      l.append(s);
      return l;
    };
    const selName = CHARACTERS[this.hooks.selected()].name;
    section("Mode");
    row(
      choice("Two players", this.mode === "local", () => this.switchMode("local")),
      choice(`vs ${selName}`, this.mode === "companion", () => this.switchMode("companion"), `Play against ${selName}, your selected companion`),
      choice("Opening lessons", this.mode === "lesson", () => this.switchMode("lesson")),
    );
    if (this.mode === "companion") {
      section(`Playing ${this.opponent ? CHARACTERS[this.opponent].name : selName}`);
      row(
        select("Play as", this.settings.playerColor, [["w", "White"], ["b", "Black"]], (v) => {
          this.settings = { ...this.settings, playerColor: v === "b" ? "b" : "w" };
          this.startMode("companion", false);
          this.openMenu();
        }),
        select("Difficulty", this.settings.difficulty, [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]], (v) => {
          this.settings = { ...this.settings, difficulty: v as Difficulty };
          this.save();
        }),
      );
    }
    if (this.mode === "lesson" && this.lesson) {
      const L = this.lesson;
      section("Lesson");
      row(
        select("Opening", L.opening.id, OPENINGS.map((o) => [o.id, `${o.name} (as ${o.side === "w" ? "White" : "Black"})`]), (v) => {
          this.lesson = this.newLesson(openingById(v) ?? OPENINGS[0], "random");
          this.startMode("lesson", false);
          this.openMenu();
        }),
      );
      row(
        select("They answer", String(L.choice), [["random", "A random reply"], ...L.opening.variations.map((v, i) => [String(i), v.name] as [string, string])], (v) => {
          this.lesson = this.newLesson(L.opening, v === "random" ? "random" : Number(v));
          this.startMode("lesson", false);
          this.openMenu();
        }),
      );
    }
    section("Board");
    row(
      select("Blocks", this.settings.material, MATERIALS.map((m) => [m.id, m.name]), (v) => {
        this.settings = { ...this.settings, material: v };
        void this.loadTextures();
        this.artVersion++;
        this.save();
      }),
    );
    this.over.append(menu);
    const l = this.layout;
    const w = menu.offsetWidth || 280;
    Object.assign(menu.style, { left: `${Math.round(Math.max(4, l.panel.x + l.panel.w - w))}px`, top: `${l.panel.y + l.panel.h + 4}px` });
    this.menu = menu;
  }

  private switchMode(mode: ChessPrefs["mode"]) {
    this.closeMenu();
    if (mode === this.mode) return;
    this.startMode(mode, false);
    if (mode !== "local" && this.opponent) {
      this.hooks.say(this.opponent, mode === "lesson" ? "Lesson time. I'll be your tutor." : "Ready when you are. Good luck.");
    }
  }

  // ── Game flow ────────────────────────────────────────────────────────────────────────────

  private onNewGame() {
    if (this.game.status.kind === "playing" && this.game.history.length > 0 && this.clock > this.confirmNew) {
      this.confirmNew = this.clock + 3;
      this.newBtn.textContent = "Sure?";
      return;
    }
    this.restart();
  }

  restart() {
    this.confirmNew = 0;
    this.newBtn.textContent = "New";
    if (this.lesson) this.lesson = this.newLesson(this.lesson.opening, this.lesson.choice);
    this.startMode(this.mode, false);
  }

  /** Close: everyone goes back to where they were, then the board disappears. */
  close() {
    if (this.closing) return;
    this.closing = true;
    this.cancelThinking();
    this.gameToken++;
    this.closePicker();
    this.closeMenu();
    this.over.classList.add("closing");
    this.under.classList.add("closing");
    this.director.close(this.origins, () => this.teardown());
  }

  /** Remove everything right away (the overlay is going away). */
  destroy() {
    this.cancelThinking();
    this.director.releaseAll();
    this.teardown();
  }

  private torn = false;
  private teardown() {
    if (this.torn) return;
    this.torn = true;
    this.brain?.dispose();
    this.brain = null;
    this.hit.removeEventListener("pointerdown", this.onDown);
    this.hit.removeEventListener("pointerup", this.onUp);
    this.hit.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.under.remove();
    this.over.remove();
    this.hooks.closed();
  }

  private cancelThinking() {
    this.brain?.cancel();
    if (this.thinking && this.opponent) this.director.hold(this.opponent, null);
    this.thinking = false;
  }

  /** Is the opponent still the selected, available companion? If not, ask (don't guess). */
  private checkOpponent() {
    if (!this.vsCompanion || !this.opponent) return;
    const sel = this.hooks.selected();
    let next: Notice = null;
    if (sel !== this.opponent) next = { kind: "changed", to: sel };
    else if (!this.hooks.opponentAvailable(this.opponent)) next = { kind: "unavailable" };
    if (JSON.stringify(next) === JSON.stringify(this.notice)) return;
    this.notice = next;
    if (next) {
      this.cancelThinking();
      this.gameToken++;
    }
    this.updateCard();
    this.drawnKey = "";
  }

  /** Keep playing the same game against the newly selected companion. */
  private acceptOpponent(id: CharacterId) {
    this.cancelThinking();
    this.gameToken++;
    this.opponent = id;
    this.notice = null;
    this.director.setGeometry(this.geometry());
    this.director.setTeams(this.teamsFor());
    this.updateLabels();
    this.updateCard();
    this.drawnKey = "";
    this.hooks.say(id, "My turn to play.");
  }

  /** Her move: think (bounded, off the main thread), then play it with her own hands. */
  private maybeOpponentMoves() {
    if (!this.vsCompanion || !this.opponent || this.notice || this.thinking || this.closing) return;
    if (this.game.status.kind !== "playing" || this.game.position.turn === this.you) return;
    if (!this.director.piecesSettled()) return; // let your piece land first
    if (this.mode === "lesson") {
      this.lessonReply();
      return;
    }
    const token = this.gameToken;
    const opp = this.opponent;
    this.thinking = true;
    this.drawnKey = "";
    this.director.hold(opp, "sit");
    const team = this.you === "w" ? "Black" : "White";
    const line = this.cheers.pick(opp, "think", team, this.clock, Math.random);
    if (line) this.hooks.say(opp, line);
    const started = this.clock;
    this.brain ??= new OpponentBrain();
    void this.brain.think(toFen(this.game.position), this.settings.difficulty, this.historyKeys()).then((choice) => {
      const go = () => {
        if (token !== this.gameToken || !this.thinking) return;
        this.thinking = false;
        this.drawnKey = "";
        this.director.hold(opp, null);
        if (choice) this.commit(choice.from, choice.to, choice.promotion);
      };
      const wait = Math.max(0, MIN_THINK - (this.clock - started));
      if (wait > 0) window.setTimeout(go, wait * 1000);
      else go();
    });
  }

  /** Every position reached so far (for the repetition rule inside her search). */
  private historyKeys(): string[] {
    let g = newGame();
    const keys = [positionKey(g.position)];
    for (const h of this.game.history) {
      const r = play(g, h.move.from, h.move.to, h.move.promotion);
      if (!r) break;
      g = r.game;
      keys.push(positionKey(g.position));
    }
    return keys;
  }

  // ── Lessons ──────────────────────────────────────────────────────────────────────────────

  private lessonReply() {
    const L = this.lesson;
    if (!L) return;
    const st = lessonState(L.opening, L.variation, this.game.history.length);
    if (st.done || st.yourTurn || !st.expected) return;
    const token = this.gameToken;
    this.thinking = true;
    this.drawnKey = "";
    window.setTimeout(() => {
      if (token !== this.gameToken) return;
      this.thinking = false;
      this.drawnKey = "";
      const mv = moveFromSan(this.game, st.expected!.san);
      if (mv) this.commit(mv.from, mv.to, mv.promotion);
    }, 900);
  }

  private afterLessonMove(m: Move) {
    const L = this.lesson;
    if (!L) return;
    const played = this.game.history.length;
    const last = L.variation.moves[played - 1];
    const st = lessonState(L.opening, L.variation, played);
    const yours = m.piece.color === L.opening.side;
    L.hint = false;
    if (st.done) {
      L.message = `${yours ? `Well played: ${last?.san}` : `They played ${last?.san}`}. ${last?.note ?? ""}\n\nLine complete! You know the ${L.opening.name} against ${L.variation.name.replace(/^Against /, "")}. Try another reply, or keep playing from here.`;
    } else if (yours) {
      L.message = `Good: ${last?.san}. ${last?.note ?? ""}`;
    } else {
      L.message = `They played ${last?.san}. ${last?.note ?? ""}\n\nYour move: ${st.expected?.san}. ${st.expected?.note ?? ""}`;
    }
    if (yours && this.opponent && Math.random() < 0.3) this.hooks.say(this.opponent, ["Good move.", "That's the right idea.", "Exactly right.", "Well played."][Math.floor(Math.random() * 4)]);
    this.updateCard();
  }

  private updateCard() {
    const card = this.card;
    card.replaceChildren();
    const n = this.notice;
    if (n && this.opponent) {
      card.hidden = false;
      const p = document.createElement("p");
      if (n.kind === "changed") {
        p.textContent = `Your selected companion is now ${CHARACTERS[n.to].name}. Who should you play?`;
        card.append(p, this.button(`Play ${CHARACTERS[n.to].name}`, () => this.acceptOpponent(n.to)), this.button("Two players", () => this.switchMode("local")));
      } else {
        p.textContent = `${CHARACTERS[this.opponent].name} can't play right now (hidden or paused). Bring her back, select another companion, or switch to two players.`;
        card.append(p, this.button("Two players", () => this.switchMode("local")));
      }
      return;
    }
    const L = this.mode === "lesson" ? this.lesson : null;
    if (!L) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const title = document.createElement("strong");
    title.textContent = `${L.opening.name}: ${L.variation.name}`;
    const body = document.createElement("p");
    const st = lessonState(L.opening, L.variation, this.game.history.length);
    body.textContent = this.game.history.length === 0 && st.expected ? `${L.message}\n\nYour first move: ${st.expected.san}. ${st.expected.note}` : L.message;
    card.append(title, body);
    const buttons = document.createElement("div");
    buttons.className = "chess-card-buttons";
    if (!st.done && st.yourTurn)
      buttons.append(
        this.button("Hint", () => {
          L.hint = true;
          this.render();
        }),
      );
    if (st.done) {
      buttons.append(
        this.button("Next reply", () => {
          this.lesson = this.newLesson(L.opening, "random");
          this.startMode("lesson", false);
        }),
        this.button(`Keep playing vs ${this.opponent ? CHARACTERS[this.opponent].name : "her"}`, () => {
          this.settings = { ...this.settings, playerColor: L.opening.side };
          this.startMode("companion", false, true);
        }),
      );
    }
    card.append(buttons);
  }

  // ── Supporters ───────────────────────────────────────────────────────────────────────────

  private greet() {
    if (this.vsCompanion && this.opponent) {
      const helper = this.director.supporters(this.you)[0];
      if (helper) this.speak(helper.id, "start", this.you);
      return;
    }
    for (const c of ["w", "b"] as const) {
      const a = this.director.supporters(c)[0];
      if (!a) continue;
      if (this.director.teamOf(a.id) === "both" && c === "b") break;
      this.speak(a.id, "start", c);
    }
  }

  private speak(id: CharacterId, ev: CheerEvent, team: Color) {
    const line = this.cheers.pick(id, ev, team === "w" ? "White" : "Black", this.clock, Math.random);
    if (!line) return false;
    this.hooks.say(id, line);
    this.director.gesture(id, ev === "win" || ev === "check" || ev === "capture" || ev === "good" ? "hop" : "wave");
    return true;
  }

  private react(before: Game, m: Move) {
    const color = m.piece.color;
    const ev = cheerEvents(before, this.game, m);
    const pick = (c: Color) => {
      const list = this.director.supporters(c).filter((a) => a.usable());
      return list[Math.floor(Math.random() * list.length)];
    };
    if (this.game.status.kind !== "playing") {
      for (const c of ["w", "b"] as const) {
        const e = c === color ? ev.mover : ev.other;
        if (!e) continue;
        for (const a of this.director.supporters(c)) {
          if (this.director.teamOf(a.id) === "both") {
            if (c === color) this.speak(a.id, e === "lose" ? "win" : e, color);
          } else this.speak(a.id, e, c);
        }
      }
      return;
    }
    const first = ev.mover && pick(color);
    const spoke = first ? this.speak(first.id, ev.mover!, color) : false;
    const opp = other(color);
    if (ev.other && !spoke) {
      const a = pick(opp);
      if (a && this.director.teamOf(a.id) !== "both") this.speak(a.id, ev.other, opp);
    }
  }

  // ── Frame ────────────────────────────────────────────────────────────────────────────────

  step(dt: number) {
    this.clock += dt;
    if (this.confirmNew && this.clock > this.confirmNew) {
      this.confirmNew = 0;
      this.newBtn.textContent = "New";
    }
    if (!this.closing) {
      this.checkOpponent();
      this.maybeOpponentMoves();
    }
    this.stepFlip();
    this.director.step(dt);
    this.render();
  }

  private hintSquares(): Square[] {
    const L = this.lesson;
    if (this.mode !== "lesson" || !L || !L.hint) return [];
    const st = lessonState(L.opening, L.variation, this.game.history.length);
    if (!st.yourTurn || !st.expected) return [];
    const mv = moveFromSan(this.game, st.expected.san);
    return mv ? [mv.from, mv.to] : [];
  }

  private render() {
    if (this.torn) return;
    const key = `${this.director.version}|${this.selected}|${this.game.history.length}|${this.artVersion}|${this.thinking}|${this.notice?.kind}|${this.lesson?.hint}|${this.settings.material}|${this.mode}`;
    if (key !== this.drawnKey) {
      this.drawBoard();
      this.drawnKey = key;
      this.updatePanel();
    }
    if (this.director.air.size || this.director.sparkles.length || this.airDrawn) this.drawAir();
  }

  private updatePanel() {
    let text = statusText(this.game, this.names());
    if (this.thinking && this.opponent && this.game.status.kind === "playing") text = `${CHARACTERS[this.opponent].name} is ${this.mode === "lesson" ? "answering" : "thinking"}…`;
    if (this.notice) text = this.notice.kind === "changed" ? "Choose your opponent" : "Opponent unavailable";
    this.statusEl.textContent = text;
    const ictx = this.turnIcon.getContext("2d")!;
    ictx.clearRect(0, 0, 18, 18);
    const st = this.game.status;
    const color = st.kind === "checkmate" ? st.winner : this.game.position.turn;
    drawPiece(ictx, color, st.kind === "playing" ? "p" : "k", 9, 9, 16);
    this.updateLabels();
    const pairs = movePairs(this.game);
    if (this.historyEl.childElementCount !== pairs.length || (pairs.length && this.historyEl.lastElementChild?.textContent !== pairs[pairs.length - 1])) {
      this.historyEl.replaceChildren(
        ...pairs.map((t) => {
          const li = document.createElement("li");
          li.textContent = t;
          return li;
        }),
      );
      this.historyEl.scrollTop = this.historyEl.scrollHeight;
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, tex: ImageBitmap | undefined, fallback: readonly number[], variant: number, x: number, y: number, w: number, h: number) {
    if (tex) ctx.drawImage(tex, variant * 18, 18, 16, 16, x, y, w, h);
    else {
      ctx.fillStyle = rgb(fallback);
      ctx.fillRect(x, y, w, h);
    }
  }

  private drawBoard() {
    const l = this.layout;
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.board.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, l.width, l.height + ChessView.SHELF);
    ctx.translate(-l.left, -l.top);
    const { x: bx, y: by, size } = l.board;
    if (this.floating) this.drawShelf(ctx, l);
    const f = l.frame;
    const mat = this.material;
    const v = this.view;
    const geo = this.director.geometry;

    // A soft drop shadow under the board, then the block frame with a bevel.
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(bx + 5, by + 7, size, size);
    const fstep = Math.max(8, f * 2);
    for (let y = by; y < by + size; y += fstep) for (let x = bx; x < bx + size; x += fstep) this.drawTile(ctx, this.tex.frame, mat.frame.avg, 1, x, y, Math.min(fstep, bx + size - x), Math.min(fstep, by + size - y));
    ctx.fillStyle = "rgba(20, 10, 4, 0.45)";
    ctx.fillRect(bx, by, size, size);
    ctx.strokeStyle = "#140a04";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, size - 2, size - 2);
    ctx.strokeStyle = "rgba(255, 220, 170, 0.28)";
    ctx.strokeRect(bx + 3, by + 3, size - 6, size - 6);

    // Squares and pieces: drawn straight on, or onto a card that squashes while the board flips.
    const inner = { x: bx + f, y: by + f, w: l.sq * 8, h: l.sq * 8 };
    const scale = this.flipScale();
    if (scale >= 1) this.drawInner(ctx, l, v, geo);
    else {
      const c = (this.flipCanvas ??= document.createElement("canvas"));
      if (c.width !== this.board.width || c.height !== this.board.height) {
        c.width = this.board.width;
        c.height = this.board.height;
      }
      const off = c.getContext("2d")!;
      off.setTransform(dpr, 0, 0, dpr, 0, 0);
      off.clearRect(0, 0, l.width, l.height + ChessView.SHELF);
      off.imageSmoothingEnabled = false;
      off.translate(-l.left, -l.top);
      this.drawInner(off, l, v, geo);
      // The hollow behind the card, then the card itself, darker as it turns edge-on.
      ctx.fillStyle = "rgba(10, 6, 4, 0.9)";
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      const w = Math.max(1, inner.w * scale);
      const x = inner.x + (inner.w - w) / 2;
      ctx.drawImage(c, (inner.x - l.left) * dpr, (inner.y - l.top) * dpr, inner.w * dpr, inner.h * dpr, x, inner.y, w, inner.h);
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.55 * (1 - scale)).toFixed(3)})`;
      ctx.fillRect(x, inner.y, w, inner.h);
      ctx.fillStyle = `rgba(255, 236, 200, ${(0.5 * (1 - scale)).toFixed(3)})`;
      ctx.fillRect(Math.round(x), inner.y, 1, inner.h);
      ctx.fillRect(Math.round(x + w) - 1, inner.y, 1, inner.h);
    }
    // Inner shadow so the squares sit inside the frame.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + f - 1, by + f - 1, l.sq * 8 + 2, l.sq * 8 + 2);

    // Coordinates in the frame.
    if (f >= 9) {
      ctx.fillStyle = "rgba(255, 230, 190, 0.85)";
      ctx.font = `600 ${Math.max(8, Math.round(f * 0.95))}px Andy, ui-rounded, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let c = 0; c < 8; c++) ctx.fillText("abcdefgh"[c], squareRect(l, sq(c, 0), v).x + l.sq / 2, by + size - f / 2);
      for (let r = 0; r < 8; r++) ctx.fillText(String(r + 1), bx + f / 2, squareRect(l, sq(0, r), v).y + l.sq / 2);
    }

    // Captured pieces beside the board (they don't flip).
    for (const vis of this.director.visuals()) {
      if (vis.at !== "tray") continue;
      const c = geo.tray(vis.by, vis.slot);
      drawPiece(ctx, vis.token.color, vis.token.type, c.x, c.y, geo.traySize);
    }

    // Banners where supporters stand; the opponent's chair.
    for (const team of ["w", "b"] as const) {
      this.director.supporters(team).forEach((a, i) => {
        if (this.director.isSeated(a.id)) return;
        if (this.director.teamOf(a.id) === "both" && team === "b") return;
        const p = geo.spot(team, i);
        const leftSide = p.x < bx;
        this.drawBanner(ctx, p.x + (leftSide ? 22 : -22), l.ground, team, leftSide);
      });
    }
    if (this.vsCompanion && this.opponent) {
      const opp = this.hooks.actors().find((a) => a.id === this.opponent);
      if (opp) this.drawChair(ctx, chairBox(l, opp.size().h));
    }
    this.drawTorch(ctx, bx - 2, by + 4);
    this.drawTorch(ctx, bx + size + 2, by + 4);

    // Warm torchlight over the board.
    const glow = ctx.createRadialGradient(bx + size / 2, by + size * 0.35, size * 0.1, bx + size / 2, by + size / 2, size * 0.8);
    glow.addColorStop(0, "rgba(255, 190, 110, 0.08)");
    glow.addColorStop(1, "rgba(20, 10, 30, 0.14)");
    ctx.fillStyle = glow;
    ctx.fillRect(bx, by, size, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** The squares, highlights and the pieces standing on them (what turns over when the board flips). */
  private drawInner(ctx: CanvasRenderingContext2D, l: ChessLayout, v: BoardView, geo: ChessGeometry) {
    const mat = this.material;
    // Squares: the material's light and dark blocks.
    const last = this.game.history[this.game.history.length - 1]?.move;
    for (let s = 0; s < 64; s++) {
      const r = squareRect(l, s, v);
      const light = (rank(s) + file(s)) % 2 === 1;
      const variant = ((rank(s) * 7 + file(s) * 3) % 3) + 1;
      this.drawTile(ctx, light ? this.tex.light : this.tex.dark, light ? mat.light.avg : mat.dark.avg, variant, r.x, r.y, l.sq, l.sq);
      if (last && (s === last.from || s === last.to)) {
        ctx.fillStyle = "rgba(255, 214, 90, 0.32)";
        ctx.fillRect(r.x, r.y, l.sq, l.sq);
      }
    }
    const pos = this.game.position;
    if (inCheck(pos)) {
      const c = geo.center(kingSquare(pos.board, pos.turn));
      const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, l.sq * 0.7);
      g.addColorStop(0, "rgba(255, 60, 40, 0.8)");
      g.addColorStop(1, "rgba(255, 60, 40, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(c.x - l.sq, c.y - l.sq, l.sq * 2, l.sq * 2);
    }

    // Lesson hint: the book move's squares.
    for (const s of this.hintSquares()) {
      const r = squareRect(l, s, v);
      ctx.strokeStyle = "rgba(120, 255, 150, 0.95)";
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 2.5, r.y + 2.5, l.sq - 5, l.sq - 5);
    }

    if (this.selected !== null) {
      const r = squareRect(l, this.selected, v);
      ctx.strokeStyle = "#f3cf4c";
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, l.sq - 3, l.sq - 3);
      for (const m of movesFrom(pos, this.selected)) {
        const t = geo.center(m.to);
        ctx.beginPath();
        if (m.captured) {
          ctx.strokeStyle = "rgba(255, 90, 60, 0.9)";
          ctx.lineWidth = 3;
          ctx.arc(t.x, t.y, l.sq * 0.42, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(20, 16, 30, 0.5)";
          ctx.arc(t.x, t.y, l.sq * 0.14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Pieces exactly where the director shows them (never one owned by an animation).
    const pieceSize = Math.round(l.sq * 0.86);
    for (const vis of this.director.visuals()) {
      if (vis.at === "square") {
        const c = geo.center(vis.sq);
        ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
        ctx.beginPath();
        ctx.ellipse(c.x, c.y + l.sq * 0.36, l.sq * 0.3, l.sq * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        drawPiece(ctx, vis.token.color, vis.token.type, c.x, c.y, pieceSize);
      }
    }
  }

  /** A wooden shelf the whole width of the layout, under a board lifted off the floor. */
  private drawShelf(ctx: CanvasRenderingContext2D, l: ChessLayout) {
    const y = l.ground;
    const h = ChessView.SHELF - 2;
    const step = 16;
    for (let x = l.left; x < l.left + l.width; x += step) this.drawTile(ctx, this.tex.frame ?? undefined, this.material.frame.avg, 2, x, y, Math.min(step, l.left + l.width - x), h);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(l.left, y + h - 2, l.width, 2);
    ctx.fillStyle = "rgba(255, 220, 170, 0.25)";
    ctx.fillRect(l.left, y, l.width, 1);
  }

  /** The wooden chair from the install (Tiles_15, facing the board), or a drawn stand-in. */
  private drawChair(ctx: CanvasRenderingContext2D, c: { x: number; y: number; w: number; h: number; k: number }) {
    const t = this.tex.chair;
    if (t) {
      // Style 0 (wood); the frame with its back on the right, so she faces the board on the left.
      ctx.drawImage(t, 18, 0, 16, 16, c.x, c.y, c.w, 16 * c.k);
      ctx.drawImage(t, 18, 18, 16, 18, c.x, c.y + 16 * c.k, c.w, 18 * c.k);
      return;
    }
    const k = c.k;
    ctx.fillStyle = "#3b2414";
    ctx.fillRect(c.x + 11 * k, c.y, 4 * k, c.h); // back post
    ctx.fillRect(c.x + 1 * k, c.y + 22 * k, 14 * k, 3 * k); // seat
    ctx.fillRect(c.x + 1 * k, c.y + 25 * k, 3 * k, c.h - 25 * k); // front leg
    ctx.fillStyle = "#8a5a34";
    ctx.fillRect(c.x + 12 * k, c.y + k, 2 * k, c.h - 2 * k);
    ctx.fillRect(c.x + 2 * k, c.y + 22 * k, 12 * k, 2 * k);
  }

  private drawBanner(ctx: CanvasRenderingContext2D, x: number, ground: number, team: Color, pointRight: boolean) {
    const h = 54;
    ctx.fillStyle = "#3b2414";
    ctx.fillRect(Math.round(x) - 1, ground - h, 3, h);
    ctx.fillStyle = team === "w" ? "#efe4cb" : "#4c3d63";
    ctx.beginPath();
    const dir = pointRight ? 1 : -1;
    const fx = Math.round(x) + 2 * dir;
    ctx.moveTo(fx, ground - h + 2);
    ctx.lineTo(fx + dir * 22, ground - h + 8);
    ctx.lineTo(fx, ground - h + 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = team === "w" ? "#3b2a1c" : "#0e0a14";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number) {
    if (this.tex.torch) {
      const t = this.tex.torch;
      ctx.drawImage(t, Math.round(x - t.width), Math.round(y - t.height * 2 + 6), t.width * 2, t.height * 2);
      return;
    }
    ctx.fillStyle = "#5a3a1e";
    ctx.fillRect(x - 2, y - 10, 4, 14);
    ctx.fillStyle = "#ffcf5a";
    ctx.fillRect(x - 3, y - 16, 6, 6);
    ctx.fillStyle = "#fff2b0";
    ctx.fillRect(x - 1, y - 15, 2, 3);
  }

  private drawAir() {
    const l = this.layout;
    const m = 160;
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.air.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, l.width + 2 * m, l.height + m);
    ctx.translate(-(l.left - m), -(l.top - m));
    const pieceSize = Math.round(l.sq * 0.86);
    for (const vis of this.director.visuals()) {
      if (vis.at === "air") drawPiece(ctx, vis.token.color, vis.token.type, vis.x, vis.y, pieceSize, vis.rot, vis.scale);
    }
    for (const s of this.director.sparkles) {
      const k = 1 - s.age / 0.6;
      const r = 3 + 6 * (s.age / 0.6);
      ctx.fillStyle = `rgba(255, 244, 170, ${k.toFixed(2)})`;
      ctx.fillRect(Math.round(s.x - r), Math.round(s.y) - 1, Math.round(r * 2), 2);
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y - r), 2, Math.round(r * 2));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.airDrawn = this.director.air.size > 0 || this.director.sparkles.length > 0;
  }

  /** For speech lines: which team a companion is on. */
  teamName(id: CharacterId) {
    const t = this.director.teamOf(id);
    return t === "w" ? "White" : t === "b" ? "Black" : t === "both" ? "both teams" : null;
  }

  describeTeams(): string {
    if (this.vsCompanion && this.opponent) {
      const helpers = this.director.supporters(this.you).map((a) => CHARACTERS[a.id].name);
      return `${CHARACTERS[this.opponent].name} plays ${this.you === "w" ? "Black" : "White"}${helpers.length ? `; ${helpers.join(", ")} cheer for you` : ""}`;
    }
    const names = (c: Color) => this.director.supporters(c).map((a) => CHARACTERS[a.id].name);
    const acts = this.director.actors;
    if (acts.length === 1 && this.director.teamOf(acts[0].id) === "both") return `${CHARACTERS[acts[0].id].name} will move the pieces for both sides`;
    const w = names("w");
    const b = names("b");
    if (!w.length && !b.length) return "the pieces will move themselves";
    return `${w.join(" and ") || "nobody"} for White, ${b.join(" and ") || "nobody"} for Black`;
  }
}

/** Keep receiving a drag's events outside the element (never fatal if the pointer is gone). */
function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // The pointer was already released; the drag still works while over the element.
  }
}

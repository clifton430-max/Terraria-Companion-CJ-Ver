// Build mode's on-screen layer: draws the placed blocks with the real Terraria tile sheets (flat
// pixel fallback when the game art isn't available), shows a placement preview under the pointer,
// and turns clicks into placing / removing blocks while Build mode is on. Outside Build mode the
// overlay stays click-through, so ordinary desktop clicks can never place anything.

import { getTexture, loadTexture } from "../assets/textures";
import {
  BLOCK_ART,
  BLOCK_KINDS,
  MAX_BLOCKS,
  TILE,
  blockSurfaces,
  canPlace,
  cellAt,
  cellRect,
  occupancy,
  place,
  remove,
  tileFrame,
  tileVariant,
  type Block,
  type BlockKind,
  type BlockSurfaces,
  type Grid,
  type PlaceCheck,
} from "../engine/blocks";

type Rect = { x: number; y: number; w: number; h: number };

export interface BuildStatus {
  active: boolean;
  kind: BlockKind;
  count: number;
  max: number;
  /** Why the last placement was refused (shown briefly in the HUD). */
  note: string | null;
}

const NOTES: Record<Exclude<PlaceCheck, { ok: true }>["reason"], string> = {
  occupied: "There's already a block there.",
  limit: `Block limit reached (${MAX_BLOCKS}). Right-click blocks to remove some.`,
  outside: "Blocks must be on screen.",
  body: "Can't place a block inside the character.",
};

export class BuildLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  blocks: Block[] = [];
  kind: BlockKind = "dirt";
  active = false;
  private grid: Grid = { cell: TILE * 2, floor: 0, width: 0 };
  private cached: BlockSurfaces = { platforms: [], walls: [], ceilings: [] };
  private hover: { x: number; y: number } | null = null;
  private painting: "place" | "remove" | null = null;
  private lastPaint = "";
  private note: string | null = null;
  private noteTimer = 0;
  private dirty = true;

  constructor(
    private readonly hooks: {
      /** Blocks or kind changed by the user (persist them). */
      changed: (blocks: Block[], kind: BlockKind) => void;
      /** Surfaces changed (rebuild physics). */
      surfaces: () => void;
      status: (s: BuildStatus) => void;
      sound: (kind: "place" | "remove" | "deny") => void;
    },
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "blocks";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    // Under the character and effects.
    document.body.prepend(this.canvas);
    // Redraw once each tile sheet arrives (drawn with the fallback until then).
    for (const k of BLOCK_KINDS) void loadTexture(BLOCK_ART[k].tiles).then(() => this.invalidate());
  }

  destroy() {
    clearTimeout(this.noteTimer);
    this.canvas.remove();
  }

  get surfaces(): BlockSurfaces {
    return this.cached;
  }

  /** Grid geometry: one Terraria tile per cell at the character's art scale, floor at the bottom. */
  setGrid(rigScale: number, width: number, height: number) {
    const cell = TILE * Math.max(1, rigScale);
    if (cell === this.grid.cell && width === this.grid.width && height === this.grid.floor) return;
    this.grid = { cell, floor: height, width };
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.rebuild();
  }

  /** Saved blocks (from preferences). Ignored when equal to what's shown (our own save echoing). */
  load(blocks: Block[], kind: BlockKind) {
    const changedKind = kind !== this.kind;
    this.kind = kind;
    if (JSON.stringify(blocks) !== JSON.stringify(this.blocks)) {
      this.blocks = blocks;
      this.rebuild();
    } else if (changedKind) {
      this.invalidate();
    }
  }

  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.painting = null;
    if (!on) this.hover = null;
    document.body.classList.toggle("building", on);
    this.invalidate();
  }

  selectKind(kind: BlockKind) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.hooks.changed(this.blocks, kind);
    this.invalidate();
  }

  /** Build-mode keys: 1/2/3 pick dirt/stone/wood. Returns true when handled. */
  key(code: string): boolean {
    if (!this.active) return false;
    const i = ["Digit1", "Digit2", "Digit3"].indexOf(code);
    if (i < 0) return false;
    this.selectKind(BLOCK_KINDS[i]);
    return true;
  }

  /** Left button places, right button (or Shift+click) removes; dragging paints. */
  pointerDown(x: number, y: number, button: number, shift: boolean, body: Rect): boolean {
    if (!this.active || (button !== 0 && button !== 2)) return false;
    this.painting = button === 2 || shift ? "remove" : "place";
    this.lastPaint = "";
    this.paint(x, y, body, true);
    return true;
  }

  pointerMove(x: number, y: number, body: Rect) {
    if (!this.active) return;
    const cell = cellAt(this.grid, x, y);
    const prev = this.hover ? cellAt(this.grid, this.hover.x, this.hover.y) : null;
    this.hover = { x, y };
    if (!prev || prev.c !== cell.c || prev.r !== cell.r) this.invalidate();
    if (this.painting) this.paint(x, y, body, false);
  }

  pointerUp() {
    this.painting = null;
  }

  private paint(x: number, y: number, body: Rect, first: boolean) {
    const { c, r } = cellAt(this.grid, x, y);
    const id = `${c},${r}`;
    if (id === this.lastPaint) return;
    this.lastPaint = id;
    if (this.painting === "remove") {
      const next = remove(this.blocks, c, r);
      if (next) this.commit(next, "remove");
      return;
    }
    const check = canPlace(this.blocks, this.grid, c, r, body);
    if (check.ok) {
      this.commit(place(this.blocks, this.grid, c, r, this.kind, body)!, "place");
    } else if (first || check.reason === "limit") {
      // Dragging over existing blocks is quiet; a direct click explains the refusal.
      if (check.reason !== "occupied" || first) {
        this.setNote(NOTES[check.reason]);
        this.hooks.sound("deny");
      }
    }
  }

  private commit(next: Block[], sound: "place" | "remove") {
    this.blocks = next;
    this.hooks.sound(sound);
    this.hooks.changed(this.blocks, this.kind);
    this.rebuild();
  }

  private setNote(text: string) {
    this.note = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      this.note = null;
      this.emitStatus();
    }, 2200);
    this.emitStatus();
  }

  private rebuild() {
    this.cached = blockSurfaces(this.blocks, this.grid);
    this.hooks.surfaces();
    this.invalidate();
  }

  private invalidate() {
    this.dirty = true;
    this.emitStatus();
  }

  private emitStatus() {
    this.hooks.status({ active: this.active, kind: this.kind, count: this.blocks.length, max: MAX_BLOCKS, note: this.note });
  }

  /** Redraw if anything changed (cheap: at most a few hundred tiles). */
  draw(body: Rect) {
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.grid.width, this.grid.floor);
    ctx.imageSmoothingEnabled = false;
    const occ = occupancy(this.blocks);
    const has = (c: number, r: number) => occ.has(`${c},${r}`);
    for (const b of this.blocks) {
      // Row r is drawn with up = r + 1 (rows count upward from the floor).
      const frame = tileFrame(has(b.c, b.r + 1), has(b.c, b.r - 1), has(b.c - 1, b.r), has(b.c + 1, b.r), tileVariant(b.c, b.r));
      this.drawTile(b.k, cellRect(this.grid, b.c, b.r), frame, has, b);
    }
    if (this.active && this.hover) this.drawPreview(body);
  }

  private drawTile(kind: BlockKind, rect: Rect, frame: { x: number; y: number }, has: (c: number, r: number) => boolean, b?: Block) {
    const ctx = this.ctx;
    const tex = getTexture(BLOCK_ART[kind].tiles);
    if (tex) {
      ctx.drawImage(tex, frame.x, frame.y, TILE, TILE, rect.x, rect.y, rect.w, rect.h);
      return;
    }
    // Fallback: a flat block with darker rims on exposed edges.
    const art = BLOCK_ART[kind];
    const px = rect.w / TILE;
    ctx.fillStyle = art.color;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = art.edge;
    if (!b || !has(b.c, b.r + 1)) ctx.fillRect(rect.x, rect.y, rect.w, 2 * px);
    if (!b || (!has(b.c, b.r - 1) && b.r > 0)) ctx.fillRect(rect.x, rect.y + rect.h - 2 * px, rect.w, 2 * px);
    if (!b || !has(b.c - 1, b.r)) ctx.fillRect(rect.x, rect.y, 2 * px, rect.h);
    if (!b || !has(b.c + 1, b.r)) ctx.fillRect(rect.x + rect.w - 2 * px, rect.y, 2 * px, rect.h);
  }

  private drawPreview(body: Rect) {
    const ctx = this.ctx;
    const { c, r } = cellAt(this.grid, this.hover!.x, this.hover!.y);
    const rect = cellRect(this.grid, c, r);
    const occupied = this.blocks.some((b) => b.c === c && b.r === r);
    const check = canPlace(this.blocks, this.grid, c, r, body);
    if (!occupied) {
      ctx.globalAlpha = check.ok ? 0.55 : 0.3;
      this.drawTile(this.kind, rect, tileFrame(false, false, false, false, 0), () => false);
      ctx.globalAlpha = 1;
    }
    // Outline: white = place here, amber = right-click removes this block, red = can't place.
    ctx.strokeStyle = occupied ? "#ffc24a" : check.ok ? "rgba(255,255,255,0.9)" : "#ff5a5a";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    if (!occupied && !check.ok) {
      ctx.beginPath();
      ctx.moveTo(rect.x + 4, rect.y + 4);
      ctx.lineTo(rect.x + rect.w - 4, rect.y + rect.h - 4);
      ctx.moveTo(rect.x + rect.w - 4, rect.y + 4);
      ctx.lineTo(rect.x + 4, rect.y + rect.h - 4);
      ctx.stroke();
    }
  }
}

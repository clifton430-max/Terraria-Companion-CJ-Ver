// Platform-edit mode for invisible platforms: drag on empty space to draw a line, drag a line to
// move it, drag an end to resize / re-angle it, right-click (or Delete) to remove it. Lines are
// drawn only while editing (optionally faintly at other times); outside edit mode the overlay stays
// click-through, so nothing here can catch a normal desktop click.

import {
  MAX_LINES,
  MIN_LINE_PX,
  constrain,
  linePlatforms,
  moveSeg,
  pick,
  segLength,
  snapAngle,
  toFrac,
  toPx,
  walkable,
  type Line,
  type Seg,
} from "../engine/lines";
import type { Platform } from "../engine/physics";

type Bounds = { width: number; height: number };

export interface LineStatus {
  active: boolean;
  count: number;
  max: number;
  selected: boolean;
  note: string | null;
}

type Drag =
  | { kind: "draw"; seg: Seg }
  | { kind: "end"; index: number; end: "a" | "b" }
  | { kind: "move"; index: number; startX: number; startY: number; orig: Seg };

export class LineLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  lines: Line[] = [];
  active = false;
  /** Draw lines faintly outside edit mode. */
  show = false;
  private bounds: Bounds = { width: 0, height: 0 };
  private cached: Platform[] = [];
  private selected: number | null = null;
  private hover: { x: number; y: number } | null = null;
  private drag: Drag | null = null;
  private note: string | null = null;
  private noteTimer = 0;
  private dirty = true;

  constructor(
    private readonly hooks: {
      changed: (lines: Line[]) => void;
      surfaces: () => void;
      status: (s: LineStatus) => void;
    },
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "lines";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    document.body.prepend(this.canvas);
  }

  destroy() {
    clearTimeout(this.noteTimer);
    this.canvas.remove();
  }

  get platforms(): Platform[] {
    return this.cached;
  }

  setBounds(width: number, height: number) {
    if (width === this.bounds.width && height === this.bounds.height) return;
    this.bounds = { width, height };
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.rebuild();
  }

  load(lines: Line[], show: boolean) {
    if (show !== this.show) {
      this.show = show;
      this.invalidate();
    }
    if (JSON.stringify(lines) === JSON.stringify(this.lines)) return;
    this.lines = lines;
    if (this.selected !== null && this.selected >= lines.length) this.selected = null;
    this.rebuild();
  }

  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.drag = null;
    this.selected = null;
    if (!on) this.hover = null;
    document.body.classList.toggle("editing-lines", on);
    this.invalidate();
  }

  /** Edit-mode keys. Returns true when handled (Esc first clears the selection). */
  key(e: { key: string; shiftKey: boolean }): "handled" | "exit" | null {
    if (!this.active) return null;
    if (e.key === "Escape") {
      if (this.selected !== null || this.drag) {
        this.selected = null;
        this.drag = null;
        this.invalidate();
        return "handled";
      }
      return "exit";
    }
    if (this.selected === null) return null;
    if (e.key === "Delete" || e.key === "Backspace") {
      this.removeAt(this.selected);
      return "handled";
    }
    const step = e.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = nudge[e.key];
    if (!d) return null;
    const s = moveSeg(toPx(this.lines[this.selected], this.bounds), d[0], d[1], this.bounds);
    this.replace(this.selected, s);
    return "handled";
  }

  pointerDown(x: number, y: number, button: number): boolean {
    if (!this.active || (button !== 0 && button !== 2)) return false;
    const hit = pick(this.lines, this.bounds, x, y, this.selected);
    if (button === 2) {
      if (hit) this.removeAt(hit.index);
      return true;
    }
    if (hit && hit.part !== "body") {
      this.selected = hit.index;
      this.drag = { kind: "end", index: hit.index, end: hit.part };
    } else if (hit) {
      this.selected = hit.index;
      this.drag = { kind: "move", index: hit.index, startX: x, startY: y, orig: toPx(this.lines[hit.index], this.bounds) };
    } else {
      this.selected = null;
      if (this.lines.length >= MAX_LINES) {
        this.setNote(`Platform limit reached (${MAX_LINES}). Delete one first.`);
        return true;
      }
      this.drag = { kind: "draw", seg: { ax: x, ay: y, bx: x, by: y } };
    }
    this.invalidate();
    return true;
  }

  pointerMove(x: number, y: number, shift: boolean) {
    if (!this.active) return;
    this.hover = { x, y };
    const d = this.drag;
    if (d?.kind === "draw") {
      const end = snapAngle({ x: d.seg.ax, y: d.seg.ay }, { x, y }, shift);
      d.seg = constrain({ ...d.seg, bx: end.x, by: end.y }, this.bounds, "b");
    } else if (d?.kind === "end") {
      const s = toPx(this.lines[d.index], this.bounds);
      const fixed = d.end === "a" ? { x: s.bx, y: s.by } : { x: s.ax, y: s.ay };
      const p = snapAngle(fixed, { x, y }, shift);
      const next = d.end === "a" ? { ax: p.x, ay: p.y, bx: s.bx, by: s.by } : { ax: s.ax, ay: s.ay, bx: p.x, by: p.y };
      const c = constrain(next, this.bounds, d.end);
      // Never shrink below the minimum or turn too steep to stand on.
      if (segLength(c) >= MIN_LINE_PX && walkable(c)) this.replace(d.index, c, false);
    } else if (d?.kind === "move") {
      this.replace(d.index, moveSeg(d.orig, x - d.startX, y - d.startY, this.bounds), false);
    }
    this.invalidate();
  }

  pointerUp() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === "draw") {
      if (segLength(d.seg) < MIN_LINE_PX) {
        if (segLength(d.seg) > 4) this.setNote("Too short: drag at least a little farther.");
      } else if (!walkable(d.seg)) {
        this.setNote("Too steep for the character to stand on.");
      } else {
        this.lines = [...this.lines, toFrac(d.seg, this.bounds)];
        this.selected = this.lines.length - 1;
        this.commit();
      }
    } else if (d) {
      this.commit();
    }
    this.invalidate();
  }

  private replace(index: number, s: Seg, save = true) {
    this.lines = this.lines.map((l, i) => (i === index ? toFrac(s, this.bounds) : l));
    if (save) this.commit();
    else this.rebuild();
  }

  private removeAt(index: number) {
    this.lines = this.lines.filter((_, i) => i !== index);
    this.selected = null;
    this.commit();
  }

  private commit() {
    this.hooks.changed(this.lines);
    this.rebuild();
  }

  private rebuild() {
    this.cached = linePlatforms(this.lines, this.bounds);
    this.hooks.surfaces();
    this.invalidate();
  }

  private setNote(text: string) {
    this.note = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      this.note = null;
      this.emit();
    }, 2200);
    this.emit();
  }

  private invalidate() {
    this.dirty = true;
    this.emit();
  }

  private emit() {
    this.hooks.status({ active: this.active, count: this.lines.length, max: MAX_LINES, selected: this.selected !== null, note: this.note });
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.bounds.width, this.bounds.height);
    if (!this.active && !this.show) return; // invisible during normal use
    ctx.lineCap = "round";
    const hover = this.active && this.hover && !this.drag ? pick(this.lines, this.bounds, this.hover.x, this.hover.y, this.selected) : null;
    this.lines.forEach((l, i) => {
      const s = toPx(l, this.bounds);
      if (!this.active) {
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        this.stroke(s);
        return;
      }
      const sel = i === this.selected;
      const over = hover?.index === i;
      ctx.strokeStyle = sel ? "#ffd36a" : over ? "#b8f4ff" : "#5fd8ff";
      ctx.lineWidth = sel ? 3 : 2;
      ctx.setLineDash(sel ? [] : [8, 5]);
      this.stroke(s);
      ctx.setLineDash([]);
      for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) {
        ctx.fillStyle = sel ? "#ffd36a" : "#5fd8ff";
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeStyle = "#0b2030";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      }
    });
    const d = this.drag;
    if (d?.kind === "draw") {
      const ok = walkable(d.seg);
      ctx.strokeStyle = ok ? "rgba(255,255,255,0.95)" : "#ff5a5a";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      this.stroke(d.seg);
      ctx.setLineDash([]);
    }
  }

  private stroke(s: Seg) {
    this.ctx.beginPath();
    this.ctx.moveTo(s.ax, s.ay);
    this.ctx.lineTo(s.bx, s.by);
    this.ctx.stroke();
  }
}

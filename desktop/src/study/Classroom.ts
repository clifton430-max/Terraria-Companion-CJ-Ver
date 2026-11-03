// Study help, the part you see (in the overlay): you drag a box around the question; a pink,
// bubbly frame stays around it; a little classroom opens beside it, and the lesson is written on
// its chalkboard in waves (the answer first, then the explanation a little at a time). A ghost
// cursor shows things on screen: it points at options, circles the best one, and carries
// drag-and-drop items to where they belong. It's only an animation: nothing is ever clicked,
// typed or dragged in your work.

import { parseLesson, screenText, waves, waveTime, type Box, type Chalk, type Lesson, type ScreenLine, type Wave } from "./lesson";
import "./study.css";

export interface ClassroomHooks {
  /** Overlay CSS px → global screen points: the overlay's top-left on screen. */
  origin(): Promise<{ x: number; y: number }>;
  /** Read the text in a box (global points). */
  look(box: Box): Promise<ScreenLine[]>;
  /** The lesson JSON for some text. */
  ask(text: string, task: "teach" | "review" | "simpler"): Promise<string>;
  cancel(): void;
  /** Hand the question to Gemini (clipboard + browser); true if it opened. */
  gemini(text: string): Promise<boolean>;
  /** The overlay takes every click (for drawing the box) or goes back to click-through. */
  capture(on: boolean): void;
  wantFocus(): void;
  /** Her reactions (a short bubble line and a pose). */
  say(text: string): void;
  react(pose: "wave" | "jump" | "think"): void;
  closed(): void;
}

type Phase = "select" | "reading" | "thinking" | "lesson" | "error";

const LINES = {
  start: ["Ready to help with homework. Show me the question.", "Point me to the question.", "Tutor mode on. Which question?"],
  thinking: ["Let me think.", "Reading carefully.", "One moment."],
  done: ["Got it. Let's go through it.", "Watch the board.", "Here's how this works."],
  hard: ["This one is tricky. Want me to ask Gemini as well?", "A difficult one. Gemini could help."],
  bye: ["Good luck. You're well prepared.", "That's all for now.", "Good work today."],
};
const pick = (a: readonly string[]) => a[Math.floor(Math.random() * a.length)];

export class Classroom {
  private phase: Phase = "select";
  private readonly root: HTMLDivElement;
  private shade: HTMLDivElement | null = null;
  private frameEl: HTMLDivElement | null = null;
  private room: HTMLDivElement | null = null;
  private board: HTMLDivElement | null = null;
  private controls: HTMLDivElement | null = null;
  private cursor: HTMLDivElement | null = null;
  private box: Box | null = null; // overlay CSS px
  private origin = { x: 0, y: 0 };
  private lines: ScreenLine[] = [];
  private lesson: Lesson | null = null;
  private queue: Wave[] = [];
  private shown = 0;
  private timer = 0;
  private paused = false;
  private closedFlag = false;
  private usedGemini = false;

  constructor(private readonly hooks: ClassroomHooks) {
    this.root = document.createElement("div");
    this.root.className = "study";
    document.body.append(this.root);
    this.hooks.say(pick(LINES.start));
    this.hooks.react("wave");
    this.startSelect();
  }

  get isOpen() {
    return !this.closedFlag;
  }

  /** The clickable parts (overlay CSS px), for the overlay's hit region. */
  rects(): Box[] {
    if (this.phase === "select") return [{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }];
    const r = this.room?.getBoundingClientRect();
    return r ? [{ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }] : [];
  }

  // ── Drawing the box ───────────────────────────────────────────────────────────────────────

  private startSelect() {
    this.phase = "select";
    this.hooks.capture(true);
    this.hooks.wantFocus();
    const shade = document.createElement("div");
    shade.className = "study-shade";
    const hint = document.createElement("div");
    hint.className = "study-hint";
    hint.textContent = "Drag a box around the question  (Esc to cancel)";
    shade.append(hint);
    const sel = document.createElement("div");
    sel.className = "study-select";
    sel.hidden = true;
    shade.append(sel);
    this.root.append(shade);
    this.shade = shade;
    let start: { x: number; y: number } | null = null;
    const rect = (e: PointerEvent) => {
      const x = Math.min(start!.x, e.clientX);
      const y = Math.min(start!.y, e.clientY);
      return { x, y, w: Math.abs(e.clientX - start!.x), h: Math.abs(e.clientY - start!.y) };
    };
    shade.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      try {
        shade.setPointerCapture(e.pointerId);
      } catch {
        // fine without
      }
      sel.hidden = false;
    });
    shade.addEventListener("pointermove", (e) => {
      if (!start) return;
      const r = rect(e);
      Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    shade.addEventListener("pointerup", (e) => {
      if (!start) return;
      const r = rect(e);
      start = null;
      if (r.w < 24 || r.h < 16) {
        sel.hidden = true;
        return;
      }
      void this.chosen(r);
    });
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.close();
  };

  private async chosen(box: Box) {
    this.box = box;
    this.shade?.remove();
    this.shade = null;
    this.hooks.capture(false);
    this.origin = await this.hooks.origin().catch(() => ({ x: 0, y: 0 }));
    this.showFrame(box);
    this.openRoom();
    await this.read();
  }

  // ── The pink frame ───────────────────────────────────────────────────────────────────────

  private showFrame(b: Box) {
    const f = document.createElement("div");
    f.className = "study-frame";
    Object.assign(f.style, { left: `${b.x - 6}px`, top: `${b.y - 6}px`, width: `${b.w + 12}px`, height: `${b.h + 12}px` });
    // Bubbles and little hearts drifting up all around it.
    const n = Math.min(28, Math.max(12, Math.round((b.w + b.h) / 40)));
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = i % 5 === 0 ? "study-heart" : "study-bubble";
      const along = Math.random();
      const side = i % 4;
      const pos = side === 0 ? { left: `${along * 100}%`, top: "-6px" } : side === 1 ? { left: "calc(100% + 2px)", top: `${along * 100}%` } : side === 2 ? { left: `${along * 100}%`, top: "calc(100% + 2px)" } : { left: "-8px", top: `${along * 100}%` };
      Object.assign(s.style, pos, { animationDelay: `${(Math.random() * 4).toFixed(2)}s`, animationDuration: `${(3 + Math.random() * 3).toFixed(2)}s`, ["--size" as string]: `${6 + Math.round(Math.random() * 10)}px` });
      f.append(s);
    }
    this.root.append(f);
    this.frameEl = f;
  }

  // ── The classroom ─────────────────────────────────────────────────────────────────────────

  private openRoom() {
    const room = document.createElement("div");
    room.className = "study-room";
    room.innerHTML = `
      <div class="sr-bunting">${Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
      <div class="sr-window"><span class="sr-cloud"></span></div>
      <div class="sr-plaque">Study Time</div>
      <div class="sr-board"><div class="sr-writing"></div></div>
      <div class="sr-tray"><i class="w"></i><i class="p"></i><i class="y"></i><b></b></div>
      <div class="sr-floor"></div>
      <div class="sr-controls"></div>`;
    room.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.root.append(room);
    this.room = room;
    this.board = room.querySelector(".sr-writing");
    this.controls = room.querySelector(".sr-controls");
    this.placeRoom();
  }

  /** Beside the question: whichever side has room (else below or above), inside the screen. */
  private placeRoom() {
    if (!this.room || !this.box) return;
    const W = Math.min(460, window.innerWidth - 24);
    const H = Math.min(360, window.innerHeight - 24);
    const b = this.box;
    const gap = 18;
    let x: number;
    let y: number;
    if (window.innerWidth - (b.x + b.w) >= W + gap) [x, y] = [b.x + b.w + gap, b.y];
    else if (b.x >= W + gap) [x, y] = [b.x - W - gap, b.y];
    else if (window.innerHeight - (b.y + b.h) >= H + gap) [x, y] = [b.x, b.y + b.h + gap];
    else [x, y] = [b.x, b.y - H - gap];
    x = Math.max(12, Math.min(window.innerWidth - W - 12, x));
    y = Math.max(12, Math.min(window.innerHeight - H - 12, y));
    Object.assign(this.room.style, { left: `${x}px`, top: `${y}px`, width: `${W}px`, height: `${H}px` });
  }

  private setControls(buttons: [string, () => void, string?][]) {
    if (!this.controls) return;
    this.controls.replaceChildren(
      ...buttons.map(([label, fn, cls]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `sr-btn ${cls ?? ""}`;
        b.textContent = label;
        b.addEventListener("click", (e) => (e.stopPropagation(), fn()));
        return b;
      }),
    );
  }

  /** A short note on the board (reading, thinking, problems). */
  private note(text: string, busy: boolean) {
    if (!this.board) return;
    const p = document.createElement("div");
    p.className = `sr-chalk soft${busy ? " busy" : ""}`;
    p.textContent = text;
    this.board.replaceChildren(p);
  }

  // ── Reading and asking ────────────────────────────────────────────────────────────────────

  private global(b: Box): Box {
    return { x: b.x + this.origin.x, y: b.y + this.origin.y, w: b.w, h: b.h };
  }
  private local(b: Box): Box {
    return { x: b.x - this.origin.x, y: b.y - this.origin.y, w: b.w, h: b.h };
  }

  private async read(task: "teach" | "review" | "simpler" = "teach") {
    if (!this.box) return;
    this.phase = "reading";
    this.stopWaves();
    this.note("Reading the question...", true);
    this.setControls([["✕ Close", () => this.close()]]);
    // Keep the frame out of the picture while reading.
    if (this.frameEl) this.frameEl.style.visibility = "hidden";
    await new Promise((r) => setTimeout(r, 140));
    let lines: ScreenLine[];
    try {
      lines = await this.hooks.look(this.global(this.box));
    } catch (e) {
      if (this.frameEl) this.frameEl.style.visibility = "";
      return this.fail((e as { message?: string })?.message ?? String(e));
    }
    if (this.frameEl) this.frameEl.style.visibility = "";
    if (this.closedFlag) return;
    this.lines = lines.map((l) => ({ ...this.local(l), text: l.text }));
    if (!lines.length) return this.fail("I couldn't find any text in that box. Try drawing it around the words?");
    this.phase = "thinking";
    this.note("Thinking...", true);
    this.hooks.say(pick(LINES.thinking));
    this.hooks.react("think");
    this.setControls([["Ask Gemini instead ✨", () => void this.askGemini()], ["✕ Close", () => this.close()]]);
    let raw: string;
    try {
      raw = await this.hooks.ask(screenText(lines), task);
    } catch (e) {
      return this.fail((e as { message?: string })?.message ?? String(e));
    }
    if (this.closedFlag) return;
    const lesson = parseLesson(raw);
    if (!lesson) return this.fail("My notes came out scrambled... want to try again, or ask Gemini?");
    this.teach(lesson);
  }

  private fail(message: string) {
    this.phase = "error";
    this.note(message, false);
    this.setControls([["Try again", () => void this.read()], ["Ask Gemini ✨", () => void this.askGemini()], ["✕ Close", () => this.close()]]);
  }

  private async askGemini() {
    const ok = await this.hooks.gemini(screenText(this.lines.length ? this.lines : [])).catch(() => false);
    this.usedGemini = this.usedGemini || ok;
    this.badge();
    this.hooks.say(ok ? "I opened Gemini. The question is on your clipboard: paste it with ⌘V." : "Gemini didn't open. Is a browser available?");
  }

  /** Shows on the board that external AI is helping. */
  private badge() {
    if (!this.room || !this.usedGemini || this.room.querySelector(".sr-badge")) return;
    const b = document.createElement("div");
    b.className = "sr-badge";
    b.textContent = "✨ Gemini (external AI) is helping";
    this.room.append(b);
  }

  // ── The lesson, in waves ─────────────────────────────────────────────────────────────────

  private teach(lesson: Lesson) {
    this.lesson = lesson;
    this.phase = "lesson";
    this.queue = waves(lesson, this.lines);
    this.shown = 0;
    this.board?.replaceChildren();
    this.hooks.say(lesson.cheer || pick(LINES.done));
    this.hooks.react("jump");
    this.paused = false;
    this.renderControls();
    this.nextWave();
  }

  private renderControls() {
    const l = this.lesson;
    const b: [string, () => void, string?][] = [];
    b.push([this.paused ? "▶ Go on" : "⏸ Pause", () => this.togglePause()]);
    b.push(["Next ›", () => this.nextWave(true)]);
    if (l?.kind === "writing") b.push(["Read my writing ✎", () => void this.read("review"), "pink"]);
    b.push(["Simpler, please", () => void this.read("simpler")]);
    if (l?.hard || this.usedGemini) b.push(["Ask Gemini ✨", () => void this.askGemini(), "pink"]);
    b.push(["✕", () => this.close()]);
    this.setControls(b);
  }

  private togglePause() {
    this.paused = !this.paused;
    if (!this.paused && this.shown < this.queue.length) this.nextWave();
    else clearTimeout(this.timer);
    this.renderControls();
  }

  private stopWaves() {
    clearTimeout(this.timer);
    this.timer = 0;
  }

  private nextWave(now = false) {
    this.stopWaves();
    if (this.closedFlag || !this.board) return;
    if (this.shown >= this.queue.length) {
      if (this.lesson?.hard && !this.usedGemini) {
        this.hooks.say(pick(LINES.hard));
        this.renderControls();
      }
      return;
    }
    const wave = this.queue[this.shown++];
    // Older writing fades and slides up, so the board never fills with text.
    const old = [...this.board.children] as HTMLElement[];
    old.forEach((el, i) => el.classList.toggle("old", i < old.length - 4 && !el.classList.contains("keep")));
    while (this.board.children.length > 7) this.board.firstElementChild?.remove();
    wave.forEach((c, i) => setTimeout(() => this.write(c), i * 650));
    const show = wave.find((c) => c.point || c.carry);
    if (show) setTimeout(() => this.demo(show), 300);
    if (!this.paused || now) this.timer = window.setTimeout(() => !this.paused && this.nextWave(), waveTime(wave) * 1000 + (wave.length - 1) * 650);
  }

  /** Write one line in chalk: revealed left to right, with dust at the tip. */
  private write(c: Chalk) {
    if (!this.board) return;
    const el = document.createElement("div");
    el.className = `sr-chalk ${c.tone}${c.tone === "title" || c.tone === "answer" ? " keep" : ""}`;
    el.textContent = c.text;
    el.style.setProperty("--dur", `${Math.min(1.6, 0.35 + c.text.length * 0.018).toFixed(2)}s`);
    this.board.append(el);
    for (let i = 0; i < 6; i++) {
      const d = document.createElement("i");
      d.className = "sr-dust";
      d.style.setProperty("--d", `${(i * 0.12).toFixed(2)}s`);
      d.style.setProperty("--x", `${Math.round(Math.random() * 100)}%`);
      el.append(d);
    }
    this.board.scrollTop = this.board.scrollHeight;
  }

  // ── The ghost cursor ─────────────────────────────────────────────────────────────────────

  private ghost(): HTMLDivElement {
    if (!this.cursor) {
      const c = document.createElement("div");
      c.className = "study-cursor";
      c.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2 L3 19 L8 15 L11 22 L14 21 L11 14 L18 14 Z" fill="#ff8fc4" stroke="#7a2350" stroke-width="1.4" stroke-linejoin="round"/><circle cx="18" cy="5" r="2.2" fill="#fff" opacity=".9"/></svg>`;
      const r = this.room?.getBoundingClientRect();
      Object.assign(c.style, { left: `${r ? r.left + 40 : 40}px`, top: `${r ? r.top + 40 : 40}px` });
      this.root.append(c);
      this.cursor = c;
    }
    return this.cursor;
  }

  /** Glide the ghost cursor to a point (CSS transition), leaving a little sparkle trail. */
  private async glide(x: number, y: number, ms = 700) {
    const c = this.ghost();
    c.style.transitionDuration = `${ms}ms`;
    const from = c.getBoundingClientRect();
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement("i");
      s.className = "study-sparkle";
      Object.assign(s.style, { left: `${from.left + ((x - from.left) * i) / 6}px`, top: `${from.top + ((y - from.top) * i) / 6}px`, animationDelay: `${(i * ms) / 6000}s` });
      this.root.append(s);
      setTimeout(() => s.remove(), ms + 900);
    }
    Object.assign(c.style, { left: `${x}px`, top: `${y}px` });
    await new Promise((r) => setTimeout(r, ms + 60));
  }

  /** Show on screen what the line on the board is about: point, circle or carry. Never clicks. */
  private async demo(c: Chalk) {
    if (c.point) {
      const p = c.point;
      await this.glide(p.x + Math.min(p.w, 40) * 0.5, p.y + p.h * 0.6);
      if (c.circle) this.ring(p);
      else this.highlight(p);
    } else if (c.carry) {
      const { from, to, label } = c.carry;
      await this.glide(from.x + from.w / 2, from.y + from.h / 2);
      const cursor = this.ghost();
      cursor.classList.add("grab");
      const tag = document.createElement("div");
      tag.className = "study-carry";
      tag.textContent = label;
      Object.assign(tag.style, { left: `${from.x + from.w / 2}px`, top: `${from.y + from.h / 2}px` });
      this.root.append(tag);
      await new Promise((r) => setTimeout(r, 200));
      tag.style.transitionDuration = "1100ms";
      Object.assign(tag.style, { left: `${to.x + to.w / 2}px`, top: `${to.y + to.h / 2}px` });
      await this.glide(to.x + to.w / 2, to.y + to.h / 2, 1100);
      cursor.classList.remove("grab");
      this.highlight(to);
      setTimeout(() => tag.classList.add("drop"), 100);
      setTimeout(() => tag.remove(), 1600);
    }
  }

  private ring(b: Box) {
    const r = document.createElement("div");
    r.className = "study-ring";
    Object.assign(r.style, { left: `${b.x - 10}px`, top: `${b.y - 8}px`, width: `${b.w + 20}px`, height: `${b.h + 16}px` });
    this.root.append(r);
  }

  private highlight(b: Box) {
    const r = document.createElement("div");
    r.className = "study-glow";
    Object.assign(r.style, { left: `${b.x - 4}px`, top: `${b.y - 3}px`, width: `${b.w + 8}px`, height: `${b.h + 6}px` });
    this.root.append(r);
    setTimeout(() => r.remove(), 2200);
  }

  // ── Closing ──────────────────────────────────────────────────────────────────────────────

  close() {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.stopWaves();
    this.hooks.cancel();
    if (this.phase === "select") this.hooks.capture(false);
    else this.hooks.say(pick(LINES.bye));
    window.removeEventListener("keydown", this.onKey);
    this.root.classList.add("closing");
    setTimeout(() => this.root.remove(), 350);
    this.hooks.closed();
  }
}

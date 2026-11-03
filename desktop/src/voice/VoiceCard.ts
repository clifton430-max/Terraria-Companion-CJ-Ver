// The small push-to-talk card shown beside the character: listening indicator with input level,
// transcribing, editable transcript (or the box Wispr Flow types into), thinking, the answer, or
// an error. Only its own box is clickable (it's added to the overlay's interactive region while
// visible).

import { prettyShortcut } from "./shortcut";
import type { VoiceState } from "./machine";

export interface VoiceCardHandlers {
  cancel: () => void;
  stop: () => void;
  send: (text: string) => void;
  openChat: () => void;
  close: () => void;
  wantFocus: () => void;
  /** Correct the last question and send it again. */
  edit: () => void;
  /** Open Wispr Flow (it's installed but not running). */
  launchWispr: () => void;
}

/** After Wispr Flow types into her input, wait this long for more before sending (auto-submit). */
const DICTATION_SETTLE_MS = 900;

export class VoiceCard {
  readonly el: HTMLDivElement;
  private meter: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private shownKind = "idle";
  private settle = 0;

  constructor(private readonly h: VoiceCardHandlers) {
    this.el = document.createElement("div");
    this.el.className = "voice-card";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Voice input");
    // Presses inside the card never reach the character (no drag/throw).
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(this.el);
  }

  get visible() {
    return !this.el.hidden;
  }

  rect(): { x: number; y: number; w: number; h: number } | null {
    if (this.el.hidden) return null;
    const r = this.el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  place(x: number, y: number) {
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  setLevel(v: number) {
    if (this.meter) this.meter.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
  }

  /** Listening status line: speaking, or the auto-send countdown after you go quiet. */
  setListening(speaking: boolean, sendIn: number | null) {
    if (!this.status) return;
    this.status.textContent = speaking ? "Hearing you…" : sendIn !== null ? `Sending in ${Math.max(0, sendIn).toFixed(1)} s… (keep talking to continue)` : this.status.dataset.idle ?? "";
    this.el.classList.toggle("speaking", speaking);
  }

  render(state: VoiceState, opts: { shortcut: string; mode: "hold" | "toggle"; autoSubmit?: boolean; silence?: number }) {
    if (state.kind === "idle") {
      this.el.hidden = true;
      this.shownKind = "idle";
      return;
    }
    // Don't rebuild the editor while the user is typing in it.
    const kind = state.kind === "review" && state.dictating ? "dictating" : state.kind;
    if (state.kind === "review" && this.shownKind === kind) return;
    clearTimeout(this.settle);
    this.shownKind = kind;
    this.el.hidden = false;
    this.el.className = `voice-card ${state.kind}`;
    this.meter = null;
    this.status = null;
    const btn = (label: string, fn: () => void, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `vc-btn ${cls}`;
      b.textContent = label;
      b.addEventListener("click", (e) => (e.stopPropagation(), fn()));
      return b;
    };
    const text = (t: string, cls = "") => Object.assign(document.createElement("div"), { className: `vc-text ${cls}`, textContent: t });
    const row = (...kids: HTMLElement[]) => {
      const d = document.createElement("div");
      d.className = "vc-row";
      d.append(...kids);
      return d;
    };
    const key = prettyShortcut(opts.shortcut);
    switch (state.kind) {
      case "listening": {
        const bar = document.createElement("div");
        bar.className = "vc-meter";
        this.meter = document.createElement("div");
        bar.appendChild(this.meter);
        const hint = opts.autoSubmit
          ? `I'll send it after ${opts.silence ?? 2} s of silence`
          : opts.mode === "hold"
            ? `Release ${key} when you're done`
            : `Press ${key} again when you're done`;
        this.status = text(hint, "hint");
        this.status.dataset.idle = hint;
        const live = state.interim ? [text(`“${state.interim}…”`, "q live")] : [];
        this.el.replaceChildren(text("● Listening…", "rec"), bar, ...live, this.status, row(btn("Send now", this.h.stop, "primary"), btn("Cancel", this.h.cancel)));
        break;
      }
      case "transcribing":
        this.el.replaceChildren(text("Turning that into text…"), row(btn("Cancel", this.h.cancel)));
        break;
      case "review": {
        const ta = document.createElement("textarea");
        ta.value = state.text;
        if (state.dictating) {
          // Wispr Flow types the whole phrase in at once: with auto-submit, send once it settles.
          ta.placeholder = "Speak with Wispr Flow…";
          if (opts.autoSubmit)
            ta.addEventListener("input", () => {
              clearTimeout(this.settle);
              this.settle = window.setTimeout(() => ta.value.trim() && this.h.send(ta.value), DICTATION_SETTLE_MS);
            });
        }
        ta.rows = 3;
        ta.maxLength = 2000;
        ta.addEventListener("keydown", (e) => {
          e.stopPropagation(); // typing never reaches the character's controls
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.h.send(ta.value);
          } else if (e.key === "Escape") this.h.cancel();
        });
        ta.addEventListener("pointerdown", () => this.h.wantFocus());
        const hint = state.dictating
          ? opts.autoSubmit
            ? "I'm listening through Wispr Flow: use its key and speak. I'll send it when you're done."
            : "I'm listening through Wispr Flow: use its key and speak, then press Enter."
          : "Did I hear that right? Edit if needed:";
        this.el.replaceChildren(text(hint, "hint"), ta, row(btn("Send", () => this.h.send(ta.value), "primary"), btn("Cancel", this.h.cancel)));
        this.h.wantFocus();
        setTimeout(() => ta.focus(), 50);
        break;
      }
      case "thinking":
        this.el.replaceChildren(text(`“${state.question}”`, "q"), text("Thinking…"), row(btn("Cancel", this.h.cancel)));
        break;
      case "answer":
        this.el.replaceChildren(text(`“${state.question}”`, "q"), text(state.answer, "a"), row(btn("Edit & resend", this.h.edit), btn("Open chat", this.h.openChat), btn("Close", this.h.close)));
        break;
      case "error":
        this.el.replaceChildren(text(state.message, "err"), row(...(state.launch ? [btn("Open Wispr Flow", this.h.launchWispr, "primary")] : []), btn("Close", this.h.close)));
        break;
    }
  }

  destroy() {
    this.el.remove();
  }
}

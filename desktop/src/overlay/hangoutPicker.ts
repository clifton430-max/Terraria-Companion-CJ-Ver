// "Which platform should we hang out on?": numbered badges over every invisible platform; click
// one to make it the hangout. While it's up the overlay takes clicks (so a badge can be clicked
// anywhere on screen); a click elsewhere, Esc, the Cancel button or 25 seconds put it away.

import { toPx, type Line } from "../engine/lines";

const TIMEOUT_MS = 25_000;

export class HangoutPicker {
  private readonly root: HTMLDivElement;
  private timer = 0;
  private done = false;

  constructor(
    lines: readonly Line[],
    bounds: { width: number; height: number },
    current: number,
    private readonly hooks: { chosen: (index: number) => void; closed: () => void },
  ) {
    this.root = document.createElement("div");
    this.root.className = "hangout-picker";
    const hint = document.createElement("div");
    hint.className = "hangout-hint";
    hint.textContent = "Pick a platform for the companions to hang out on";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "chess-button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });
    hint.append(cancel);
    this.root.append(hint);
    lines.forEach((l, i) => {
      const s = toPx(l, bounds);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `hangout-badge${i === current ? " current" : ""}`;
      b.textContent = String(i + 1);
      b.setAttribute("aria-label", `Platform ${i + 1}`);
      b.style.left = `${Math.round((s.ax + s.bx) / 2)}px`;
      b.style.top = `${Math.round((s.ay + s.by) / 2)}px`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hooks.chosen(i);
        this.close();
      });
      this.root.append(b);
    });
    // A click on empty space cancels.
    this.root.addEventListener("click", () => this.close());
    window.addEventListener("keydown", this.onKey);
    document.body.append(this.root);
    this.timer = window.setTimeout(() => this.close(), TIMEOUT_MS);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.close();
  };

  close() {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
    this.hooks.closed();
  }
}

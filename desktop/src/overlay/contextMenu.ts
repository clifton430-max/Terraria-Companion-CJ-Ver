// Right-click menu on the character: a pure item model (tested) plus a small DOM renderer.
// The menu lives in the overlay; while it's open its box is added to the interactive hitbox so it
// can be clicked without making the rest of the overlay stop passing clicks through.

import type { IdlePose } from "../bridge";
import { IDLE_LABEL, IDLE_POSES } from "./idle";

export type MenuAction =
  | { type: "askQuestion" }
  | { type: "openChat" }
  | { type: "askScreen" }
  | { type: "study" }
  | { type: "voice" }
  | { type: "toggleStay" }
  | { type: "pose"; pose: IdlePose | "rotate" }
  | { type: "settings" }
  | { type: "close" };

export interface MenuItem {
  id: string;
  label: string;
  action: MenuAction | null;
  disabled?: boolean;
  hint?: string;
  checked?: boolean;
  children?: MenuItem[];
}

export interface MenuState {
  stay: boolean;
  rotating: boolean;
  pose: IdlePose;
  screenEnabled: boolean;
  /** Voice input is enabled in settings. */
  voiceAvailable: boolean;
}

export function menuItems(s: MenuState): MenuItem[] {
  return [
    { id: "ask", label: "Ask a question…", action: { type: "askQuestion" } },
    { id: "chat", label: "Open chat", action: { type: "openChat" } },
    {
      id: "screen",
      label: "Ask about my screen",
      action: { type: "askScreen" },
      hint: s.screenEnabled ? "One screenshot, sent with your question, then discarded" : "Turn on screen understanding in Awareness settings first",
    },
    {
      id: "study",
      label: "Study help",
      action: s.screenEnabled ? { type: "study" } : null,
      disabled: !s.screenEnabled,
      hint: s.screenEnabled ? "Box a question and I'll teach it on a chalkboard (you choose the answer)" : "Turn on screen understanding in Awareness settings first",
    },
    {
      id: "voice",
      label: "Start voice input",
      action: s.voiceAvailable ? { type: "voice" } : null,
      disabled: !s.voiceAvailable,
      hint: s.voiceAvailable ? "Speak, then press Done (or use your voice shortcut)" : "Turn on voice input in Awareness → Assistant & voice input",
    },
    { id: "stay", label: s.stay ? "Stop staying put" : "Stay put here", action: { type: "toggleStay" }, checked: s.stay },
    {
      id: "pose",
      label: "Idle pose",
      action: null,
      children: [
        { id: "pose-rotate", label: "Rotate automatically", action: { type: "pose", pose: "rotate" }, checked: s.rotating },
        ...IDLE_POSES.map((p) => ({ id: `pose-${p}`, label: IDLE_LABEL[p], action: { type: "pose" as const, pose: p }, checked: !s.rotating && s.pose === p })),
      ],
    },
    { id: "settings", label: "Companion settings", action: { type: "settings" } },
    { id: "close", label: "Close", action: { type: "close" } },
  ];
}

/** Top-left for a menu of size (w, h) next to the character, kept inside the screen. */
export function menuPosition(body: { x: number; y: number; w: number; h: number }, size: { w: number; h: number }, bounds: { width: number; height: number }): { x: number; y: number } {
  const margin = 6;
  // Prefer the right side of the character; flip left if it doesn't fit.
  let x = body.x + body.w + 10;
  if (x + size.w > bounds.width - margin) x = body.x - size.w - 10;
  x = Math.min(Math.max(x, margin), Math.max(margin, bounds.width - size.w - margin));
  const y = Math.min(Math.max(body.y + body.h / 2 - size.h / 2, margin), Math.max(margin, bounds.height - size.h - margin));
  return { x, y };
}

/** Union of two rectangles (character + open menu = interactive region). */
export function unionRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Seconds the menu stays open without the pointer over it. */
export const MENU_IDLE_CLOSE = 8;

/** Minimal DOM menu. `onAction` receives the chosen action; the menu closes itself afterwards. */
export class ContextMenu {
  readonly el: HTMLDivElement;
  private openFlag = false;

  constructor(private readonly onAction: (a: MenuAction) => void) {
    this.el = document.createElement("div");
    this.el.className = "ctx-menu";
    this.el.setAttribute("role", "menu");
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get isOpen() {
    return this.openFlag;
  }

  open(state: MenuState, place: (size: { w: number; h: number }) => { x: number; y: number }) {
    this.el.replaceChildren(...menuItems(state).map((i) => this.render(i)));
    this.el.hidden = false;
    this.openFlag = true;
    const pos = place({ w: this.el.offsetWidth || 200, h: this.el.offsetHeight || 240 });
    this.el.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
    (this.el.querySelector("button:not([disabled])") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  close() {
    this.el.hidden = true;
    this.openFlag = false;
  }

  /** Current box in overlay CSS px, or null when closed. */
  rect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.openFlag) return null;
    const r = this.el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  destroy() {
    this.el.remove();
  }

  private render(item: MenuItem): HTMLElement {
    if (item.children) {
      const group = document.createElement("div");
      group.className = "ctx-group";
      const title = document.createElement("div");
      title.className = "ctx-title";
      title.textContent = item.label;
      group.append(title, ...item.children.map((c) => this.render(c)));
      return group;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ctx-item${item.checked ? " checked" : ""}`;
    b.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemcheckbox");
    if (item.checked !== undefined) b.setAttribute("aria-checked", String(item.checked));
    b.textContent = item.label;
    if (item.hint) b.title = item.hint;
    b.disabled = !!item.disabled || item.action === null;
    // Act on pointerdown/click without letting the press reach the character (no drag starts).
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!item.action) return;
      this.close();
      if (item.action.type !== "close") this.onAction(item.action);
    });
    return b;
  }
}

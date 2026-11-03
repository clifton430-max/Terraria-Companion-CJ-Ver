// Input for the background world. Its window sits under Finder's desktop icons, so it never
// gets clicks or keys itself: Rust's event tap forwards what's aimed at the bare desktop
// (desktop_layer.rs) and this turns each one back into the DOM events the world already handles
// (pointer, click, context menu, wheel, keys), on the element under the pointer.

export interface Mods {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export type WorldInput =
  | { t: "down" | "move" | "up"; x: number; y: number; button: number; mods: Mods; pan?: boolean }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number; mods: Mods }
  | { t: "keydown" | "keyup"; code: string; key: string; repeat: boolean; mods: Mods }
  /** The keys aren't the world's any more (you clicked elsewhere or switched apps). */
  | { t: "blur" };

/** One DOM event to fire: on the element under the pointer (`at`), the pressed one, or the window. */
export interface Planned {
  on: "at" | "pressed" | "window";
  type: "pointerdown" | "pointermove" | "pointerup" | "click" | "contextmenu" | "wheel" | "keydown" | "keyup" | "blur";
  init: Record<string, unknown>;
}

const BUTTON_BITS = [1, 4, 2]; // DOM `buttons` for button 0 (left), 1 (middle), 2 (right)

/**
 * The DOM events for one forwarded input. `pressed` is the button held since the last down (or
 * null); `sameTarget` says whether the element under a release is the one that was pressed (a
 * click). Pure, so it's testable without a DOM.
 */
export function plan(e: WorldInput, pressed: number | null, sameTarget: boolean): Planned[] {
  if (e.t === "blur") return [{ on: "window", type: "blur", init: {} }];
  const mods = { shiftKey: e.mods.shift, altKey: e.mods.alt, ctrlKey: e.mods.ctrl, metaKey: e.mods.meta };
  switch (e.t) {
    case "down":
    case "move":
    case "up": {
      const held = e.t === "up" ? 0 : e.t === "down" ? BUTTON_BITS[e.button] ?? 1 : pressed === null ? 0 : BUTTON_BITS[pressed] ?? 1;
      const base = { ...mods, clientX: e.x, clientY: e.y, button: e.t === "move" ? -1 : e.button, buttons: held, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true, cancelable: true, composed: true };
      const on = e.t !== "down" && pressed !== null ? "pressed" : "at";
      const out: Planned[] = [{ on, type: e.t === "down" ? "pointerdown" : e.t === "move" ? "pointermove" : "pointerup", init: base }];
      if (e.t === "up" && pressed !== null && sameTarget) out.push({ on: "at", type: e.button === 2 ? "contextmenu" : "click", init: { ...base, detail: 1 } });
      return out;
    }
    case "wheel":
      return [{ on: "at", type: "wheel", init: { ...mods, clientX: e.x, clientY: e.y, deltaX: e.dx, deltaY: e.dy, deltaMode: 0, bubbles: true, cancelable: true, composed: true } }];
    case "keydown":
    case "keyup":
      return [{ on: "window", type: e.t, init: { ...mods, code: e.code, key: e.key, repeat: e.repeat, bubbles: true, cancelable: true } }];
  }
}

/** Fires forwarded input into this window's document. */
export function createInputDispatcher(doc: Document = document, win: Window = window): (e: WorldInput) => void {
  let pressedEl: Element | null = null;
  let pressed: number | null = null;
  return (e) => {
    const at = "x" in e ? (doc.elementFromPoint(e.x, e.y) ?? doc.body) : doc.body;
    if (e.t === "down") {
      pressedEl = at;
      pressed = e.button;
    }
    for (const p of plan(e, e.t === "down" ? null : pressed, at === pressedEl)) {
      const target: EventTarget = p.on === "window" ? win : p.on === "pressed" ? (pressedEl ?? at) : at;
      const ev =
        p.type === "wheel"
          ? new WheelEvent(p.type, p.init)
          : p.type === "keydown" || p.type === "keyup"
            ? new KeyboardEvent(p.type, p.init)
            : p.type === "click" || p.type === "contextmenu"
              ? new MouseEvent(p.type, p.init)
              : p.type === "blur"
                ? new FocusEvent("blur")
                : new PointerEvent(p.type, p.init);
      target.dispatchEvent(ev);
    }
    if (e.t === "up") {
      pressedEl = null;
      pressed = null;
    }
  };
}

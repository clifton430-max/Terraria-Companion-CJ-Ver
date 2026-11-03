// Letter Destroyer: a bookmarklet that makes clicked letters (and small page elements) fly off
// the screen. Purely visual and temporary: hidden letters keep their layout, everything is put
// back exactly when it's turned off (Esc, the HUD's ×, or clicking the bookmarklet again), and a
// page refresh restores everything too. It never changes URLs, bookmarks, storage or settings,
// and it sends no page content anywhere. If the Terraria Companion app is running, it pings it on
// 127.0.0.1 with just an event name and a count so the desktop buddy can cheer, and it asks the app
// for pickaxe strikes: when the companion's pickaxe hits near the pointer, the letters there fly.
//
// This file is both an ES module (for tests) and the bookmarklet source: the app embeds its raw
// text (with `export` removed) into a `javascript:` URL. Keep everything self-contained.

/** Pure helpers (unit-tested). */
export function destroyerHelpers() {
  const GRAVITY = 2200;

  /** Initial velocity for a piece at (px, py) knocked from a click at (cx, cy). */
  function launchVelocity(cx, cy, px, py, rnd) {
    let dx = px - cx;
    let dy = py - cy;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const speed = 380 + rnd() * 420;
    return {
      vx: dx * speed + (rnd() - 0.5) * 160,
      vy: Math.min(dy * speed, 0) - 520 - rnd() * 380, // always kicked upward first
      vr: (rnd() - 0.5) * 1440, // degrees per second
    };
  }

  /** Advance a flying piece; returns false once it has left the viewport (or timed out). */
  function stepFlyer(f, dt, viewportHeight) {
    f.vy += GRAVITY * dt;
    f.vx *= Math.exp(-0.25 * dt);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
    f.age += dt;
    return f.y < viewportHeight + 200 && f.age < 6;
  }

  /**
   * Which characters to knock out: a contiguous run around the clicked one whose centres are within
   * `radius` of the click, never starting or ending on whitespace. `rects[i]` is the box of
   * character i (or null if it has none). Returns [start, end] inclusive, or null.
   */
  function pickRun(chars, rects, clicked, x, y, radius) {
    const near = (i) => {
      const r = rects[i];
      if (!r) return false;
      return Math.hypot(r.x + r.w / 2 - x, r.y + r.h / 2 - y) <= radius;
    };
    if (clicked < 0 || clicked >= chars.length || /\s/.test(chars[clicked])) return null;
    let a = clicked;
    let b = clicked;
    while (a - 1 >= 0 && near(a - 1)) a--;
    while (b + 1 < chars.length && near(b + 1)) b++;
    while (a < b && /\s/.test(chars[a])) a++;
    while (b > a && /\s/.test(chars[b])) b--;
    return [a, b];
  }

  /** What a click on an element does: fly the whole element, only its text, or nothing. */
  function elementPolicy(rect, viewport, tag) {
    const t = String(tag).toLowerCase();
    if (t === "html" || t === "body") return "skip";
    if (rect.w < 2 || rect.h < 2) return "skip";
    // Huge blocks (page sections) aren't thrown whole; only their letters are.
    if (rect.w * rect.h > viewport.w * viewport.h * 0.35) return "text-only";
    return "fly";
  }

  /**
   * Undo a text split made by wrapping characters: merge the hidden span's text and the trailing
   * text node back into the original node, then remove both. Works on any objects shaped like
   * DOM text nodes / elements; returns false if the page changed them in the meantime.
   */
  function restoreSplit(before, span, after) {
    if (!before || !span || !span.parentNode || span.parentNode !== before.parentNode) return false;
    const tail = after && after.parentNode === span.parentNode ? after.data : "";
    before.data = before.data + span.textContent + tail;
    span.parentNode.removeChild(span);
    if (after && after.parentNode) after.parentNode.removeChild(after);
    return true;
  }

  /** Event payload for the desktop app: never any page text or URL. */
  function pingPayload(event, count) {
    const allowed = ["on", "smash", "off"];
    return JSON.stringify({ event: allowed.includes(event) ? event : "smash", count: Math.max(0, Math.min(9999, Math.floor(count) || 0)) });
  }

  /**
   * Convert a global screen point (macOS points, from the companion app) into this page's viewport
   * coordinates, accounting for the window position, browser toolbars and page zoom. Returns null
   * when the point isn't inside this page's visible area.
   */
  function screenToClient(sx, sy, win) {
    if (!(win.innerWidth > 0) || !(win.innerHeight > 0) || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    // macOS browser windows have no side borders, so outer width / inner width is the page zoom.
    let z = win.outerWidth / win.innerWidth;
    if (!Number.isFinite(z) || z < 0.25 || z > 5) z = 1;
    const toolbars = Math.max(0, win.outerHeight - win.innerHeight * z);
    const x = (sx - win.screenX) / z;
    const y = (sy - win.screenY - toolbars) / z;
    if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) return null;
    return { x, y };
  }

  /** Smash radius (px) for a click (power 1) or a pickaxe strike of `power` (1–3). */
  function strikeRadius(power) {
    const p = Math.min(3, Math.max(1, Math.floor(power) || 1));
    return 34 * (1 + 0.9 * (p - 1));
  }

  /** Square dust bits for a pickaxe strike: more and faster for stronger pickaxes. */
  function strikeDust(power, rnd) {
    const p = Math.min(3, Math.max(1, Math.floor(power) || 1));
    const colors = ["#fff3b0", "#d8b48a", "#a87a4a", "#ffffff"];
    const bits = [];
    for (let i = 0; i < 10 * p; i++) {
      const a = -Math.PI * (0.1 + 0.8 * rnd());
      const v = (260 + rnd() * 380) * Math.sqrt(p);
      bits.push({ vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: (rnd() - 0.5) * 900, size: 3 + Math.floor(rnd() * 3), color: colors[Math.floor(rnd() * colors.length) % colors.length] });
    }
    return bits;
  }

  return { GRAVITY, launchVelocity, stepFlyer, pickRun, elementPolicy, restoreSplit, pingPayload, screenToClient, strikeRadius, strikeDust };
}

/** The bookmarklet itself (runs in the page). */
export function letterDestroyer() {
  const w = window;
  const d = document;
  if (w.__tcLetterDestroyer) {
    w.__tcLetterDestroyer.stop(); // clicking the bookmarklet again turns it off
    return;
  }
  if (!d.body) return;
  const H = destroyerHelpers();
  const PORT = 47833;
  const MAX_FLYERS = 500;
  const undo = [];
  const flyers = [];
  let smashed = 0;
  let raf = 0;
  let last = 0;
  let pingTimer = 0;
  let pendingPing = 0;

  const ping = (event, count) => {
    try {
      fetch("http://127.0.0.1:" + PORT + "/destroyer", { method: "POST", mode: "no-cors", body: H.pingPayload(event, count), keepalive: true }).catch(() => {});
    } catch (e) {
      /* browser refused: the effect still works */
    }
  };

  // Layer for flying pieces and a small HUD, both in a closed shadow root so page CSS can't touch them.
  const host = d.createElement("div");
  host.setAttribute("data-tc-letter-destroyer", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const layer = d.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;";
  const hud = d.createElement("div");
  hud.style.cssText =
    "position:fixed;right:14px;bottom:14px;pointer-events:auto;font:600 12px/1.3 -apple-system,system-ui,sans-serif;color:#fff;background:rgba(32,42,92,.94);border:2px solid #0e1430;border-radius:6px;padding:7px 10px;display:flex;gap:8px;align-items:center;box-shadow:0 3px 0 rgba(0,0,0,.3);";
  const label = d.createElement("span");
  const close = d.createElement("button");
  close.textContent = "×";
  close.title = "Stop and restore the page";
  close.style.cssText = "font:inherit;font-size:14px;color:#fff;background:rgba(150,40,40,.9);border:2px solid #0e1430;border-radius:4px;cursor:pointer;padding:0 7px;";
  hud.append(label, close);
  root.append(layer, hud);
  d.documentElement.appendChild(host);
  const updateLabel = () => (label.textContent = "Letter Destroyer: click to smash · Esc to stop · " + smashed + " smashed");
  updateLabel();

  const spawn = (node, x, y, cx, cy, velocity) => {
    if (flyers.length >= MAX_FLYERS) return;
    const v = velocity || H.launchVelocity(cx, cy, x, y, Math.random);
    node.style.position = "fixed";
    node.style.left = "0";
    node.style.top = "0";
    node.style.margin = "0";
    node.style.pointerEvents = "none";
    node.style.willChange = "transform";
    layer.appendChild(node);
    flyers.push({ node, x, y, vx: v.vx, vy: v.vy, vr: v.vr, rot: 0, age: 0 });
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const vh = w.innerHeight;
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      if (!H.stepFlyer(f, dt, vh)) {
        f.node.remove();
        flyers.splice(i, 1);
      } else {
        f.node.style.transform = "translate(" + f.x + "px," + f.y + "px) rotate(" + f.rot + "deg)";
      }
    }
    raf = flyers.length ? requestAnimationFrame(tick) : 0;
  };

  const caretAt = (x, y) => {
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  };

  const charRect = (node, i) => {
    const r = d.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    const b = r.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
  };

  /** Knock out letters of a text node near (x, y). Returns true if something was smashed. */
  const smashText = (node, offset, x, y, radius) => {
    const text = node.data;
    if (!text || !node.parentNode) return false;
    // The caret may sit after the clicked character; test both neighbours.
    let clicked = -1;
    for (const i of [offset, offset - 1]) {
      const r = i >= 0 && i < text.length ? charRect(node, i) : null;
      if (r && x >= r.x - 3 && x <= r.x + r.w + 3 && y >= r.y - 3 && y <= r.y + r.h + 3) {
        clicked = i;
        break;
      }
    }
    if (clicked < 0) return false;
    const side = Math.ceil(radius / 2); // characters to examine on each side
    const lo = Math.max(0, clicked - side);
    const hi = Math.min(text.length - 1, clicked + side);
    const chars = [];
    const rects = [];
    for (let i = lo; i <= hi; i++) {
      chars.push(text[i]);
      rects.push(charRect(node, i));
    }
    const run = H.pickRun(chars, rects, clicked - lo, x, y, radius);
    if (!run) return false;
    const a = run[0] + lo;
    const b = run[1] + lo;
    const style = getComputedStyle(node.parentNode);
    // Flying copies of each visible character.
    for (let i = a; i <= b; i++) {
      const r = rects[i - lo];
      if (!r || /\s/.test(text[i])) continue;
      const s = d.createElement("span");
      s.textContent = text[i];
      s.style.font = style.font;
      s.style.color = style.color;
      s.style.letterSpacing = style.letterSpacing;
      s.style.lineHeight = r.h + "px";
      s.style.whiteSpace = "pre";
      spawn(s, r.x, r.y, x, y);
      smashed++;
    }
    // Hide the originals in place (layout unchanged) and remember how to put them back.
    const range = d.createRange();
    range.setStart(node, a);
    range.setEnd(node, b + 1);
    const span = d.createElement("span");
    span.style.visibility = "hidden";
    span.setAttribute("data-tc-smashed", "");
    try {
      range.surroundContents(span);
    } catch (e) {
      return false;
    }
    const after = span.nextSibling && span.nextSibling.nodeType === 3 ? span.nextSibling : null;
    undo.push(() => H.restoreSplit(node, span, after));
    return true;
  };

  /** Throw a whole (small) element, leaving its space empty until restored. */
  const smashElement = (el, x, y) => {
    const b = el.getBoundingClientRect();
    const rect = { x: b.left, y: b.top, w: b.width, h: b.height };
    const policy = H.elementPolicy(rect, { w: w.innerWidth, h: w.innerHeight }, el.tagName);
    if (policy !== "fly") return false;
    let copy;
    if (el.tagName === "CANVAS") {
      copy = d.createElement("canvas");
      copy.width = el.width;
      copy.height = el.height;
      try {
        copy.getContext("2d").drawImage(el, 0, 0);
      } catch (e) {
        /* tainted canvas: an empty copy still flies */
      }
    } else if (el.tagName === "IFRAME" || el.tagName === "VIDEO") {
      copy = d.createElement("div");
      copy.style.background = "rgba(120,120,120,.35)";
      copy.style.border = "1px solid rgba(0,0,0,.3)";
    } else {
      copy = el.cloneNode(true);
      const cs = getComputedStyle(el);
      copy.style.color = cs.color;
      copy.style.font = cs.font;
      copy.style.background = cs.background;
      copy.style.border = cs.border;
      copy.style.borderRadius = cs.borderRadius;
    }
    copy.removeAttribute && copy.removeAttribute("id");
    copy.style.width = rect.w + "px";
    copy.style.height = rect.h + "px";
    copy.style.boxSizing = "border-box";
    spawn(copy, rect.x, rect.y, x, y);
    const prev = el.style.visibility;
    el.style.visibility = "hidden";
    undo.push(() => {
      el.style.visibility = prev;
      return true;
    });
    smashed++;
    return true;
  };

  /** A quick ring where a pickaxe strike landed. */
  const ring = (x, y, radius) => {
    const r = d.createElement("div");
    const size = Math.round(radius * 1.1);
    r.style.cssText = "position:fixed;left:" + (x - size / 2) + "px;top:" + (y - size / 2) + "px;width:" + size + "px;height:" + size + "px;border:3px solid #fff3b0;border-radius:50%;pointer-events:none;transition:transform .3s ease-out,opacity .3s ease-out;";
    layer.appendChild(r);
    requestAnimationFrame(() => {
      r.style.transform = "scale(1.8)";
      r.style.opacity = "0";
    });
    setTimeout(() => r.remove(), 350);
  };

  /** Pickaxe impact in the page: a quick flash and square dust thrown up from the strike. */
  const impact = (x, y, power) => {
    const flash = d.createElement("div");
    const size = 40 + 30 * power;
    flash.style.cssText = "position:fixed;left:" + (x - size / 2) + "px;top:" + (y - size / 2) + "px;width:" + size + "px;height:" + size + "px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(255,255,255,.95),rgba(255,243,176,.5) 40%,rgba(255,243,176,0) 70%);transition:opacity .18s ease-out;";
    layer.appendChild(flash);
    requestAnimationFrame(() => (flash.style.opacity = "0"));
    setTimeout(() => flash.remove(), 220);
    for (const b of H.strikeDust(power, Math.random)) {
      const bit = d.createElement("div");
      bit.style.width = b.size + "px";
      bit.style.height = b.size + "px";
      bit.style.background = b.color;
      spawn(bit, x, y, x, y, { vx: b.vx, vy: b.vy, vr: b.vr });
    }
  };

  /** Smash whatever is at viewport point (x, y): letters first, else a small element. */
  const smashAt = (x, y, radius) => {
    radius = radius || H.strikeRadius(1);
    const before = smashed;
    const caret = caretAt(x, y);
    let done = !!(caret && caret.node && caret.node.nodeType === 3 && smashText(caret.node, caret.offset, x, y, radius));
    if (!done) {
      host.style.display = "none";
      const el = d.elementFromPoint(x, y);
      host.style.display = "";
      if (el) done = smashElement(el, x, y);
    }
    if (smashed > before) {
      updateLabel();
      pendingPing += smashed - before;
      if (!pingTimer)
        pingTimer = setTimeout(() => {
          ping("smash", pendingPing);
          pendingPing = 0;
          pingTimer = 0;
        }, 400);
    }
    return done;
  };

  const onClick = (e) => {
    if (e.button !== 0 || e.composedPath().includes(host)) return;
    // While active, clicks smash instead of following links or pressing buttons.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    smashAt(e.clientX, e.clientY);
  };

  // Pickaxe strikes from the desktop companion (screen points), while this page is visible.
  let since = null;
  let pollTimer = 0;
  let stopped = false;
  const poll = () => {
    if (stopped) return;
    const url = "http://127.0.0.1:" + PORT + "/destroyer/strikes" + (since === null ? "" : "?since=" + since);
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        since = data.latest;
        if (d.visibilityState !== "visible") return;
        for (const s of data.strikes || []) {
          const p = H.screenToClient(s.x, s.y, w);
          if (!p) continue;
          const radius = H.strikeRadius(s.power);
          ring(p.x, p.y, radius);
          impact(p.x, p.y, s.power || 1);
          smashAt(p.x, p.y, radius);
        }
        pollTimer = setTimeout(poll, 150);
      })
      .catch(() => {
        // App not running or the browser blocked the local request: keep working without it.
        pollTimer = setTimeout(poll, 3000);
      });
  };
  poll();
  // Swallow the rest of the click sequence so pages don't react to it.
  const swallow = (e) => {
    if (e.button === 0 && !e.composedPath().includes(host)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };
  const onKey = (e) => {
    if (e.key === "Escape") stop();
  };

  const listeners = [
    ["click", onClick],
    ["mousedown", swallow],
    ["mouseup", swallow],
    ["pointerdown", swallow],
    ["pointerup", swallow],
    ["auxclick", swallow],
    ["keydown", onKey],
    ["pagehide", () => stop()],
  ];
  for (const [type, fn] of listeners) w.addEventListener(type, fn, true);
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    stop();
  });

  function stop() {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    for (const [type, fn] of listeners) w.removeEventListener(type, fn, true);
    if (raf) cancelAnimationFrame(raf);
    if (pingTimer) clearTimeout(pingTimer);
    flyers.length = 0;
    // Put everything back, newest first.
    while (undo.length) {
      try {
        undo.pop()();
      } catch (e) {
        /* the page replaced that content itself */
      }
    }
    host.remove();
    delete w.__tcLetterDestroyer;
    ping("off", smashed);
  }

  w.__tcLetterDestroyer = { stop };
  ping("on", 0);
}

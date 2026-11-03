import { describe, expect, it } from "vitest";
import { destroyerHelpers } from "./destroyer.js";
import raw from "./destroyer.js?raw";
import { bookmarkletCode, bookmarkletUrl } from "./bookmarklet";

const H = destroyerHelpers();

describe("letter destroyer physics", () => {
  it("knocks pieces away from the click and always upward first", () => {
    const right = H.launchVelocity(100, 100, 130, 100, () => 0.5);
    const left = H.launchVelocity(100, 100, 70, 100, () => 0.5);
    expect(right.vx).toBeGreaterThan(0);
    expect(left.vx).toBeLessThan(0);
    expect(right.vy).toBeLessThan(0);
    expect(H.launchVelocity(100, 100, 100, 140, () => 0.5).vy).toBeLessThan(0); // even below the click
  });

  it("pieces fall under gravity and are removed once off-screen or after a timeout", () => {
    const f = { x: 0, y: 500, vx: 100, vy: -600, vr: 90, rot: 0, age: 0 };
    let alive = true;
    let minY = f.y;
    let steps = 0;
    while (alive && steps < 1000) {
      alive = H.stepFlyer(f, 1 / 60, 800);
      minY = Math.min(minY, f.y);
      steps++;
    }
    expect(minY).toBeLessThan(500); // went up first
    expect(alive).toBe(false);
    expect(f.y > 800 || f.age >= 6).toBe(true);
    expect(f.rot).toBeGreaterThan(0);
  });
});

describe("choosing letters", () => {
  const word = "Hello world";
  const rects = [...word].map((_, i) => ({ x: i * 10, y: 0, w: 10, h: 20 }));
  it("takes a contiguous run near the click, trimmed of spaces", () => {
    expect(H.pickRun([...word], rects, 2, 25, 10, 12)).toEqual([1, 3]);
    expect(H.pickRun([...word], rects, 6, 65, 10, 20)).toEqual([4, 8]); // may span a space mid-run
  });
  it("ignores clicks on whitespace and characters without boxes", () => {
    expect(H.pickRun([...word], rects, 5, 55, 10, 30)).toBeNull();
    expect(H.pickRun(["a"], [null], 0, 0, 0, 30)).toEqual([0, 0]);
    expect(H.pickRun([...word], rects, 99, 0, 0, 30)).toBeNull();
  });
});

describe("element policy", () => {
  const vp = { w: 1000, h: 800 };
  it("throws small elements, only letters of huge ones, and never the page itself", () => {
    expect(H.elementPolicy({ x: 0, y: 0, w: 24, h: 24 }, vp, "BUTTON")).toBe("fly");
    expect(H.elementPolicy({ x: 0, y: 0, w: 900, h: 700 }, vp, "DIV")).toBe("text-only");
    expect(H.elementPolicy({ x: 0, y: 0, w: 100, h: 100 }, vp, "BODY")).toBe("skip");
    expect(H.elementPolicy({ x: 0, y: 0, w: 1, h: 100 }, vp, "IMG")).toBe("skip");
  });
});

describe("restoring the page", () => {
  /** Minimal DOM-like nodes. */
  function split(text: string, a: number, b: number) {
    const parent: { children: unknown[]; removeChild(n: unknown): void } = {
      children: [],
      removeChild(n: unknown) {
        this.children = this.children.filter((c) => c !== n);
        (n as { parentNode: unknown }).parentNode = null;
      },
    };
    const before = { data: text.slice(0, a), parentNode: parent as unknown };
    const span = { textContent: text.slice(a, b), parentNode: parent as typeof parent | null };
    const after = { data: text.slice(b), parentNode: parent };
    parent.children = [before, span, after];
    return { parent, before, span, after };
  }

  it("merges the hidden letters back into the original text node exactly", () => {
    const { parent, before, span, after } = split("https://example.com", 8, 15);
    expect(H.restoreSplit(before, span, after)).toBe(true);
    expect(before.data).toBe("https://example.com");
    expect(parent.children).toEqual([before]);
  });

  it("successive smashes undo cleanly in reverse order", () => {
    // First smash "ample", then "ex" in what remained before it.
    const text = "example";
    const first = split(text, 2, 7); // before "ex", span "ample"
    const second = split(first.before.data, 0, 2); // before "", span "ex", after ""
    // Make the second split act on the first's `before` node.
    const before = first.before;
    before.data = second.before.data;
    const parent = first.parent;
    const span2 = { textContent: "ex", parentNode: parent };
    const after2 = { data: "", parentNode: parent };
    parent.children = [before, span2, after2, first.span, first.after];
    expect(H.restoreSplit(before, span2, after2)).toBe(true);
    expect(H.restoreSplit(before, first.span, first.after)).toBe(true);
    expect(before.data).toBe("example");
    expect(parent.children).toEqual([before]);
  });

  it("gives up safely if the page already replaced the content", () => {
    const { before, span, after } = split("abc", 1, 2);
    span.parentNode = null;
    expect(H.restoreSplit(before, span, after)).toBe(false);
    expect(before.data).toBe("a");
  });
});

describe("desktop buddy ping", () => {
  it("sends only an event name and a count, never page content", () => {
    expect(JSON.parse(H.pingPayload("smash", 12.7))).toEqual({ event: "smash", count: 12 });
    expect(JSON.parse(H.pingPayload("steal-cookies", -5))).toEqual({ event: "smash", count: 0 });
    expect(Object.keys(JSON.parse(H.pingPayload("on", 0)))).toEqual(["event", "count"]);
  });
});

describe("pickaxe strikes from the desktop companion", () => {
  // A 1200×800 window at (100, 50) with an 80 px tall toolbar area.
  const win = { screenX: 100, screenY: 50, outerWidth: 1200, outerHeight: 880, innerWidth: 1200, innerHeight: 800 };
  it("maps screen points into the page below the browser toolbars", () => {
    expect(H.screenToClient(400, 330, win)).toEqual({ x: 300, y: 200 });
  });
  it("accounts for page zoom", () => {
    const zoomed = { ...win, innerWidth: 600, innerHeight: 400 }; // 200% zoom
    expect(H.screenToClient(400, 330, zoomed)).toEqual({ x: 150, y: 100 });
  });
  it("ignores strikes outside this page (other windows, the toolbar, off-screen)", () => {
    expect(H.screenToClient(50, 330, win)).toBeNull();
    expect(H.screenToClient(400, 100, win)).toBeNull(); // on the toolbar
    expect(H.screenToClient(2000, 330, win)).toBeNull();
    expect(H.screenToClient(NaN, 1, win)).toBeNull();
    expect(H.screenToClient(400, 330, { ...win, innerWidth: 0 })).toBeNull();
  });
});

describe("strike power", () => {
  it("stronger pickaxes smash a wider area; bad values fall back to a normal click", () => {
    expect(H.strikeRadius(1)).toBe(34);
    expect(H.strikeRadius(2)).toBeGreaterThan(H.strikeRadius(1) * 1.5);
    expect(H.strikeRadius(99)).toBe(H.strikeRadius(3));
    expect(H.strikeRadius(NaN)).toBe(34);
    expect(H.strikeRadius(undefined as unknown as number)).toBe(34);
  });
});

describe("strike dust in the page", () => {
  it("throws more, faster dust for stronger pickaxes, always upward first", () => {
    const one = H.strikeDust(1, () => 0.5);
    const two = H.strikeDust(2, () => 0.5);
    expect(one.length).toBe(10);
    expect(two.length).toBe(20);
    expect(Math.abs(two[0].vy)).toBeGreaterThan(Math.abs(one[0].vy));
    expect(one.every((b) => b.vy < 0)).toBe(true);
    expect(H.strikeDust(NaN, () => 0.1).length).toBe(10);
  });
});

describe("bookmarklet packaging", () => {
  it("is a self-contained javascript: URL with no module syntax", () => {
    const code = bookmarkletCode(raw);
    expect(code).not.toMatch(/^\s*export\s/m);
    expect(code).not.toMatch(/\bimport\s/);
    expect(code.startsWith("(()=>{")).toBe(true);
    expect(code.trim().endsWith("letterDestroyer();})()")).toBe(true);
    expect(() => new Function(code)).not.toThrow(); // valid JavaScript
    const url = bookmarkletUrl(raw);
    expect(url.startsWith("javascript:")).toBe(true);
    expect(decodeURIComponent(url.slice("javascript:".length))).toBe(code);
    expect(url.length).toBeLessThan(60000);
  });

  it("only ever contacts the local companion app", () => {
    const urls: string[] = raw.match(/https?:\/\/[^"'\s)]+/g) ?? [];
    expect(urls.every((u: string) => u.startsWith("http://127.0.0.1"))).toBe(true);
  });
});

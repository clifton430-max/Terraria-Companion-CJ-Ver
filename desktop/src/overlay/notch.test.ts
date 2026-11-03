import { beforeEach, describe, expect, it, vi } from "vitest";

// The bridge talks to Rust; here it's a fake notch that records what the overlay asks of it.
const calls: { cmd: string; args: unknown[] }[] = [];
let statusListener: ((s: unknown) => void) | null = null;
let actionListener: ((a: unknown) => void) | null = null;
let enterResult: () => Promise<void> = () => Promise.resolve();
vi.mock("../bridge", () => ({
  notchEnter: (...args: unknown[]) => (calls.push({ cmd: "enter", args }), enterResult()),
  notchLeave: (...args: unknown[]) => (calls.push({ cmd: "leave", args }), Promise.resolve(true)),
  notchSay: (...args: unknown[]) => (calls.push({ cmd: "say", args }), Promise.resolve(true)),
  notchGesture: (...args: unknown[]) => (calls.push({ cmd: "gesture", args }), Promise.resolve(true)),
  notchHover: (...args: unknown[]) => (calls.push({ cmd: "hover", args }), Promise.resolve()),
  notchStatus: () => Promise.resolve({ connected: false, rect: null, resident: null }),
  onNotch: (cb: (s: unknown) => void) => ((statusListener = cb), Promise.resolve(() => {})),
  onNotchAction: (cb: (a: unknown) => void) => ((actionListener = cb), Promise.resolve(() => {})),
}));
vi.mock("../engine/sprites", () => ({ FRAMES: {}, SPRITE_W: 16, SPRITE_H: 24, renderFrame: () => null }));

const { NotchHome, inflate, inward, mouthOf, overlaps, CATCH_MARGIN } = await import("./notch");

const RECT = { x: 1674, y: 510, w: 36, h: 168 };
const near = { x: RECT.x - 30, y: RECT.y + 40, w: 20, h: 42 };
const far = { x: 200, y: 300, w: 20, h: 42 };

function resident(id: string) {
  return {
    character: id,
    name: id,
    atlas: "",
    frameWidth: 40,
    frameHeight: 56,
    frames: ["idle"],
    body: { x: 10, y: 12, w: 20, h: 42 },
    bubble: { top: "#fff", bottom: "#fff", border: "#f0a", text: "#000", heart: "#f0a" },
    gestures: [],
    stride: 1,
    scale: 2,
    arrive: true,
  } as never;
}

/** The absorb has finished (the overlay clears its "incoming" hint once the notch answered). */
function settled() {
  return vi.waitFor(() => {
    const hints = calls.filter((c) => c.cmd === "hover").map((c) => c.args[0]);
    expect(hints.lastIndexOf("")).toBeGreaterThan(hints.lastIndexOf("incoming"));
  });
}

/** A canvas stand-in for the absorb effect (it only reads the size and draws a copy). */
function canvas() {
  return { width: 40, height: 56, getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 56 }) } as never;
}

describe("notch geometry", () => {
  it("catches around the notch and points into the screen", () => {
    expect(overlaps(near, inflate(RECT, CATCH_MARGIN))).toBe(true);
    expect(overlaps(far, inflate(RECT, CATCH_MARGIN))).toBe(false);
    expect(inward("right")).toEqual({ x: -1, y: 0 });
    expect(inward("top")).toEqual({ x: 0, y: 1 });
    // The mouth sits toward the screen edge the notch hangs on.
    expect(mouthOf(RECT, "right").x).toBeGreaterThan(RECT.x + RECT.w / 2);
    expect(mouthOf({ x: 0, y: -34, w: 200, h: 34 }, "top").y).toBeLessThan(-34 + 17);
  });
});

describe("NotchHome", () => {
  let home: InstanceType<typeof NotchHome>;
  const placed: { id: string; x: number; y: number }[] = [];
  const fed: string[] = [];

  beforeEach(async () => {
    calls.length = 0;
    placed.length = 0;
    fed.length = 0;
    enterResult = () => Promise.resolve();
    // The absorb animation runs on animation frames; run them instantly for the test.
    let t = 0;
    globalThis.performance ??= { now: () => t } as never;
    vi.stubGlobal("requestAnimationFrame", (cb: (n: number) => void) => setTimeout(() => cb((t += 2000)), 0));
    vi.stubGlobal("document", {
      createElement: () => ({ style: { setProperty() {} }, classList: { add() {} }, getContext: () => ({ drawImage() {} }), animate: () => ({}), remove() {} }),
      body: { appendChild() {} },
    });
    home = new NotchHome({ place: (id, a) => placed.push({ id, x: a.x, y: a.y }), pet: () => {}, feed: (id) => fed.push(id), present: () => ["nurse", "goblin"] as never });
    await Promise.resolve();
    statusListener!({ connected: true, rect: RECT, edge: "right", expanded: false, dragging: false, resident: null });
  });

  it("takes one companion and turns the next away while she lives there", async () => {
    expect(home.offer("nurse", far, canvas(), () => resident("nurse"))).toBe("no");
    expect(home.offer("nurse", near, canvas(), () => resident("nurse"))).toBe("in");
    // On her way in, nobody else gets in.
    expect(home.offer("goblin", near, canvas(), () => resident("goblin"))).toBe("full");
    // (Turning her away cleared the hover hint, so wait for the notch itself.)
    await vi.waitFor(() => expect(home.gesture("nurse", "wave")).toBe(true));
    expect(home.occupant).toBe("nurse");
    expect(home.holds("nurse")).toBe(true);
    expect(home.holds("goblin")).toBe(false);
    expect(home.offer("goblin", near, canvas(), () => resident("goblin"))).toBe("full");
    expect(calls.filter((c) => c.cmd === "enter")).toHaveLength(1);
  });

  it("routes the resident's words to the notch and leaves everyone else's alone", async () => {
    home.offer("nurse", near, canvas(), () => resident("nurse"));
    await settled();
    expect(home.say("nurse", "Hi Master!")).toBe(true);
    expect(home.say("goblin", "I'm out here")).toBe(false);
    expect(home.gesture("nurse", "wave")).toBe(true);
    expect(calls.filter((c) => c.cmd === "say")).toEqual([{ cmd: "say", args: ["nurse", "Hi Master!"] }]);
  });

  it("feeds the resident a cookie from the notch, and nobody when she's out", async () => {
    actionListener!({ kind: "feed", x: 0, y: 0, vx: 0, vy: 0 });
    expect(fed).toEqual([]);
    home.offer("nurse", near, canvas(), () => resident("nurse"));
    await settled();
    actionListener!({ kind: "feed", x: 0, y: 0, vx: 0, vy: 0 });
    expect(fed).toEqual(["nurse"]);
  });

  it("lets her out when she's pulled out, and then takes someone else", async () => {
    home.offer("nurse", near, canvas(), () => resident("nurse"));
    await settled();
    actionListener!({ kind: "exit", x: 800, y: 400, vx: 0, vy: 0 });
    expect(placed).toEqual([{ id: "nurse", x: 800, y: 400 }]);
    expect(home.occupant).toBe(null);
    expect(calls.some((c) => c.cmd === "leave" && c.args[0] === "nurse")).toBe(true);
    expect(home.offer("goblin", near, canvas(), () => resident("goblin"))).toBe("in");
    await settled();
  });

  it("puts her back on the desktop if the notch can't take her, or goes away", async () => {
    enterResult = () => Promise.reject(new Error("occupied"));
    home.offer("nurse", near, canvas(), () => resident("nurse"));
    await settled();
    expect(placed.map((p) => p.id)).toEqual(["nurse"]);
    expect(home.occupant).toBe(null);

    enterResult = () => Promise.resolve();
    home.offer("goblin", near, canvas(), () => resident("goblin"));
    await settled();
    expect(home.occupant).toBe("goblin");
    statusListener!({ connected: false, rect: null, resident: "goblin" });
    expect(home.occupant).toBe(null);
    expect(placed.map((p) => p.id)).toEqual(["nurse", "goblin"]);
  });

  it("ignores a notch that's being dragged around", () => {
    statusListener!({ connected: true, rect: RECT, edge: "right", expanded: false, dragging: true, resident: null });
    expect(home.offer("nurse", near, canvas(), () => resident("nurse"))).toBe("no");
  });
});

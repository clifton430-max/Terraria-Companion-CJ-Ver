import { describe, expect, it } from "vitest";
import { decide, initialAi, mulberry32 } from "./behavior";
import { planJump, simulateJump, solveJump } from "./jump";
import {
  DEFAULT_PHYSICS as cfg,
  dragTo,
  makeBody,
  release,
  step,
  type Body,
  type Intent,
  type Platform,
} from "./physics";
import { carry, visibleTops, type WindowRect } from "./platforms";

const bounds = { width: 1440, height: 800 };
const dt = 1 / 60;
const W = 48;
const H = 72;
const idle: Intent = { move: 0, jump: false };
const walkRight: Intent = { move: 1, jump: false };
const walkLeft: Intent = { move: -1, jump: false };

/** A window at (x, y) of size w×h, and its top edge as a platform. */
const win = (id: number, x: number, y: number, w: number, h: number): WindowRect => ({ id, x, y, w, h });
const top = (id: number, left: number, right: number, y: number): Platform => ({ id, left, right, top: y });

/** A body whose feet are at `bottom`, horizontally centred on `cx`. */
function bodyAt(cx: number, bottom: number, over: Partial<Body> = {}): Body {
  return { ...makeBody(0, bounds, W, H), x: cx - W / 2, y: bottom - H, grounded: false, ...over };
}

function simulate(body: Body, intent: Intent, seconds: number, platforms: Platform[]) {
  let b = body;
  const landings: { id: number | null; impact: number }[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const r = step(b, intent, dt, bounds, cfg, platforms);
    b = r.body;
    if (r.landed) landings.push({ id: b.platformId, impact: r.impactSpeed });
    intent = { ...intent, jump: false, jumpVelocity: undefined, jumpVx: undefined };
  }
  return { body: b, landings };
}

describe("landing on window tops", () => {
  const p = [top(7, 400, 900, 300)];

  it("a falling body lands exactly on the top edge and records the window", () => {
    const { body, landings } = simulate(bodyAt(600, 100), idle, 2, p);
    expect(body.grounded).toBe(true);
    expect(body.platformId).toBe(7);
    expect(body.y + body.h).toBe(300);
    expect(landings).toEqual([{ id: 7, impact: expect.any(Number) }]);
    expect(landings[0].impact).toBeGreaterThan(0);
  });

  it("does not pass through the top even at maximum fall speed with a large step", () => {
    const fast = bodyAt(600, 290, { vy: cfg.maxFallSpeed });
    const r = step(fast, idle, 1 / 20, bounds, cfg, p);
    expect(r.body.platformId).toBe(7);
    expect(r.body.y + r.body.h).toBe(300);
  });

  it("lands on the highest of several stacked edges crossed in one step", () => {
    const stack = [top(1, 400, 900, 320), top(2, 400, 900, 305)];
    const r = step(bodyAt(600, 300, { vy: cfg.maxFallSpeed }), idle, 1 / 30, bounds, cfg, stack);
    expect(r.body.platformId).toBe(2);
  });

  it("is one-way: a body rising through the edge passes it", () => {
    const rising = bodyAt(600, 310, { vy: -500 });
    const r = step(rising, idle, dt, bounds, cfg, p);
    expect(r.body.grounded).toBe(false);
    expect(r.body.y + r.body.h).toBeLessThan(310);
  });

  it("ignores an edge the feet started below (e.g. released overlapping a window)", () => {
    const { body } = simulate(bodyAt(600, 320), idle, 2, p);
    expect(body.platformId).toBeNull();
    expect(body.y).toBe(bounds.height - H); // fell through to the floor
  });

  it("misses the platform when only the transparent sprite margin overlaps", () => {
    // Feet span is the middle 40% of the sprite; the outer 30% on each side doesn't count.
    const cx = 400 - W * 0.25; // feet end ~5px left of the edge
    const { body } = simulate(bodyAt(cx, 100), idle, 2, p);
    expect(body.platformId).toBeNull();
  });

  it("platform tops are ignored when no platforms are given", () => {
    const { body } = simulate(bodyAt(600, 100), idle, 2, []);
    expect(body.y).toBe(bounds.height - H);
    expect(body.platformId).toBeNull();
  });
});

describe("standing, walking off and jumping off", () => {
  const p = [top(7, 400, 700, 300)];
  const standing = (cx: number) => ({ ...bodyAt(cx, 300), grounded: true, platformId: 7 });

  it("a standing body stays put with no landing events", () => {
    const { body, landings } = simulate(standing(550), idle, 1, p);
    expect(body.platformId).toBe(7);
    expect(body.y + body.h).toBe(300);
    expect(landings).toEqual([]);
  });

  it("walking past the right edge drops off and lands on the floor", () => {
    const { body, landings } = simulate(standing(650), walkRight, 3, p);
    expect(body.platformId).toBeNull();
    expect(body.y).toBe(bounds.height - H);
    expect(landings[landings.length - 1]?.id).toBeNull();
    // It left the window to the right.
    expect(body.x + body.w * cfg.footInset).toBeGreaterThan(700);
  });

  it("walking past the left edge drops off too", () => {
    const { body } = simulate(standing(450), walkLeft, 3, p);
    expect(body.platformId).toBeNull();
    expect(body.x + body.w * (1 - cfg.footInset)).toBeLessThan(400);
  });

  it("walks seamlessly across two adjacent segments at the same height", () => {
    const pair = [top(1, 400, 600, 300), top(2, 600, 800, 300)];
    const start = { ...bodyAt(580, 300), grounded: true, platformId: 1 };
    const { body } = simulate(start, walkRight, 1, pair);
    expect(body.grounded).toBe(true);
    expect(body.y + body.h).toBe(300);
  });

  it("can jump off a window and land back on it", () => {
    const { body, landings } = simulate(standing(550), { move: 0, jump: true }, 2, p);
    expect(landings.map((l) => l.id)).toEqual([7]);
    expect(body.platformId).toBe(7);
  });

  it("falls when its window disappears (closed or minimised)", () => {
    const { body } = simulate(standing(550), idle, 3, []);
    expect(body.platformId).toBeNull();
    expect(body.y).toBe(bounds.height - H);
  });

  it("follows the edge if the window's top moves between steps", () => {
    const moved = [top(7, 400, 700, 340)];
    const r = step(standing(550), idle, dt, bounds, cfg, moved);
    expect(r.body.platformId).toBe(7);
    expect(r.body.y + r.body.h).toBe(340);
  });

  it("drops off rather than going above the ceiling if the window is dragged to the top", () => {
    const high = [top(7, 400, 700, 30)];
    const r = step(standing(550), idle, dt, bounds, cfg, high);
    expect(r.body.platformId).toBeNull();
    expect(r.body.y).toBeGreaterThanOrEqual(0);
  });

  it("screen-edge walls still apply while standing on a window", () => {
    const wide = [top(9, 0, bounds.width, 300)];
    const start = { ...bodyAt(0, 300), x: bounds.width - W, vx: cfg.walkSpeed, grounded: true, platformId: 9 };
    const r = step(start, walkRight, dt, bounds, cfg, wide);
    expect(r.hitWall).toBe(1);
    expect(r.body.x).toBe(bounds.width - W);
  });
});

describe("dragging and throwing with platforms", () => {
  const p = [top(7, 400, 900, 300)];

  it("picking the body up detaches it from its window", () => {
    const held = dragTo({ ...bodyAt(600, 300), grounded: true, platformId: 7 }, 600, 100, bounds);
    expect(held.platformId).toBeNull();
    expect(held.grounded).toBe(false);
  });

  it("a body dropped above a window lands on it", () => {
    const dropped = release(dragTo(bodyAt(600, 300), 600 - W / 2, 50, bounds), 0, 0, cfg);
    const { body } = simulate(dropped, idle, 2, p);
    expect(body.platformId).toBe(7);
  });

  it("a body thrown upward through a window lands on top of it", () => {
    const thrown = release(bodyAt(600, 500), 0, -1100, cfg); // peaks ~300px up
    const { body } = simulate(thrown, idle, 3, p);
    expect(body.platformId).toBe(7);
  });
});

describe("visibleTops", () => {
  it("turns a lone window into one full-width segment", () => {
    expect(visibleTops([win(1, 100, 200, 500, 300)], bounds)).toEqual([top(1, 100, 600, 200)]);
  });

  it("hides the part of a top edge covered by a window in front", () => {
    const front = win(1, 300, 100, 200, 400); // covers y=200 between x=300..500
    const back = win(2, 100, 200, 600, 300);
    expect(visibleTops([front, back], bounds)).toEqual([
      top(1, 300, 500, 100),
      top(2, 100, 300, 200),
      top(2, 500, 700, 200),
    ]);
  });

  it("does not hide edges behind a window that sits lower", () => {
    const front = win(1, 300, 250, 200, 400); // its top is below the back window's top
    const back = win(2, 100, 200, 600, 300);
    expect(visibleTops([front, back], bounds).filter((s) => s.id === 2)).toEqual([top(2, 100, 700, 200)]);
  });

  it("drops fully covered windows and slivers narrower than the minimum", () => {
    const front = win(1, 100, 100, 600, 400);
    const hidden = win(2, 200, 200, 300, 100);
    const sliver = win(3, 690, 200, 20, 100); // only 10px pokes out
    expect(visibleTops([front, hidden, sliver], bounds).map((s) => s.id)).toEqual([1]);
  });

  it("clips to the overlay and skips tops at the ceiling or below the floor", () => {
    expect(visibleTops([win(1, -200, 300, 400, 100)], bounds)).toEqual([top(1, 0, 200, 300)]);
    expect(visibleTops([win(2, 100, 0, 400, 300)], bounds)).toEqual([]);
    expect(visibleTops([win(3, 100, 800, 400, 300)], bounds)).toEqual([]);
  });

  it("stacked windows with identical bounds yield only the frontmost", () => {
    const same = [win(1, 100, 200, 500, 300), win(2, 100, 200, 500, 300), win(3, 100, 200, 500, 300)];
    expect(visibleTops(same, bounds)).toEqual([top(1, 100, 600, 200)]);
  });
});

describe("carry (moving platforms)", () => {
  const standing: Body = { ...bodyAt(300, 200), grounded: true, platformId: 1 };

  it("moves the body with its window", () => {
    const b = carry(standing, [win(1, 100, 200, 500, 300)], [win(1, 160, 180, 500, 300)], bounds);
    expect(b.x - standing.x).toBe(60);
    expect(b.y - standing.y).toBe(-20);
  });

  it("follows only the top edge when the window is resized", () => {
    const b = carry(standing, [win(1, 100, 200, 500, 300)], [win(1, 50, 220, 550, 280)], bounds);
    expect(b.x).toBe(standing.x);
    expect(b.y - standing.y).toBe(20);
  });

  it("leaves bodies that are not on that window alone", () => {
    const airborne = { ...standing, grounded: false, platformId: null };
    expect(carry(airborne, [win(1, 0, 0, 1, 1)], [win(1, 9, 9, 1, 1)], bounds)).toBe(airborne);
    const onFloor = makeBody(300, bounds, W, H);
    expect(carry(onFloor, [win(1, 0, 0, 1, 1)], [win(1, 9, 9, 1, 1)], bounds)).toBe(onFloor);
  });

  it("does nothing when the window vanished; the next step lets it fall", () => {
    const b = carry(standing, [win(1, 100, 200, 500, 300)], [], bounds);
    expect(b).toBe(standing);
    expect(step(b, idle, dt, bounds, cfg, []).body.platformId).toBeNull();
  });

  it("keeps the body on screen when a window is dragged past the edge", () => {
    const b = carry(standing, [win(1, 100, 200, 500, 300)], [win(1, 1300, 200, 500, 300)], bounds);
    expect(b.x).toBe(bounds.width - W);
  });

  it("a body carried by a moving window across many snapshots stays on it", () => {
    let body = standing;
    let windows = [win(1, 100, 200, 500, 300)];
    for (let i = 0; i < 30; i++) {
      const next = [win(1, 100 + i * 8, 200 - i * 3, 500, 300)];
      body = carry(body, windows, next, bounds);
      windows = next;
      for (let s = 0; s < 6; s++) body = step(body, idle, dt, bounds, cfg, visibleTops(windows, bounds)).body;
    }
    expect(body.platformId).toBe(1);
    expect(body.y + body.h).toBe(windows[0].y);
  });
});

describe("jump planning", () => {
  /** Simulate a planned jump and report where it landed. */
  function fly(start: Body, plan: { vy: number; vx: number }, platforms: Platform[]) {
    return simulate(start, { move: 0, jump: true, jumpVelocity: plan.vy, jumpVx: plan.vx }, 4, platforms).body;
  }

  it("jumps from the floor up onto a window", () => {
    const target = top(5, 600, 1000, bounds.height - 180);
    const start = makeBody(300, bounds, W, H);
    const plan = solveJump(start, target, cfg)!;
    expect(plan).not.toBeNull();
    expect(fly(start, plan, [target]).platformId).toBe(5);
  });

  it("jumps between two windows at different heights, both ways", () => {
    const a = top(1, 100, 400, 500);
    const b = top(2, 550, 900, 380);
    const onA: Body = { ...bodyAt(300, 500), grounded: true, platformId: 1 };
    const up = solveJump(onA, b, cfg)!;
    const landedB = fly(onA, up, [a, b]);
    expect(landedB.platformId).toBe(2);

    const down = solveJump(landedB, a, cfg)!;
    expect(fly(landedB, down, [a, b]).platformId).toBe(1);
  });

  it("verified plans land on a narrow target across a range of offsets and heights", () => {
    let planned = 0;
    let cases = 0;
    for (const dx of [-400, -250, -120, 120, 250, 400]) {
      for (const rise of [-300, -100, 40, 120, 180]) {
        cases++;
        const start: Body = { ...bodyAt(720, 450), grounded: true, platformId: 1 };
        const platforms = [top(1, 600, 840, 450), top(2, 720 + dx - 40, 720 + dx + 40, 450 - rise)];
        const plan = planJump(start, platforms, bounds, () => 0, cfg);
        // Every upward jump must be plannable; short drops beside or under the starting
        // window may be rejected (the arc clips it) - those are reached by walking off.
        if (rise > 0) expect(plan, `dx=${dx} rise=${rise}`).not.toBeNull();
        if (!plan) continue;
        planned++;
        expect(plan.targetId).toBe(2);
        expect(fly(start, plan, platforms).platformId, `dx=${dx} rise=${rise}`).toBe(2);
      }
    }
    expect(planned / cases).toBeGreaterThanOrEqual(0.8);
  });

  it("rejects an arc that would come back down on the starting window", () => {
    const start: Body = { ...bodyAt(720, 450), grounded: true, platformId: 1 };
    const platforms = [top(1, 600, 840, 450), top(2, 560, 640, 750)];
    const raw = solveJump(start, platforms[1], cfg)!;
    expect(simulateJump(start, raw, platforms, bounds, cfg)).toBe(1); // the naive arc fails
    expect(planJump(start, platforms, bounds, () => 0, cfg)).toBeNull();
  });

  it("rejects an arc that would land on a window in between", () => {
    const start = makeBody(200, bounds, W, H);
    const blocker = top(3, 380, 560, 640);
    const target = top(2, 600, 760, 560);
    const raw = solveJump(start, target, cfg)!;
    expect(raw).not.toBeNull();
    const via = simulateJump(start, raw, [blocker, target], bounds, cfg);
    const plan = planJump(start, [blocker, target], bounds, () => 0.99, cfg);
    if (via !== 2) expect(plan?.targetId).not.toBe(2);
    if (plan) expect(simulateJump(start, plan, [blocker, target], bounds, cfg)).toBe(plan.targetId);
  });

  it("rejects targets that are too high, too far, or under the ceiling", () => {
    const start = makeBody(300, bounds, W, H);
    expect(solveJump(start, top(1, 300, 600, 60), cfg)).toBeNull(); // 740px rise
    expect(solveJump(start, top(1, 1200, 1400, 700), cfg)).toBeNull(); // too far
    const nearCeiling: Body = { ...bodyAt(300, 120), grounded: true, platformId: 9 };
    expect(solveJump(nearCeiling, top(1, 400, 600, 100), cfg)).toBeNull();
  });

  it("walks off rather than jumping to a platform directly below", () => {
    const start: Body = { ...bodyAt(500, 300), grounded: true, platformId: 1 };
    expect(solveJump(start, top(2, 400, 700, 500), cfg)).toBeNull();
  });

  it("planJump skips the current window and is deterministic for a seed", () => {
    const start: Body = { ...bodyAt(300, 500), grounded: true, platformId: 1 };
    const platforms = [top(1, 100, 400, 500), top(2, 550, 900, 420), top(3, 0, 200, 420)];
    const a = planJump(start, platforms, bounds, mulberry32(3), cfg);
    const b = planJump(start, platforms, bounds, mulberry32(3), cfg);
    expect(a).toEqual(b);
    expect(a?.targetId).not.toBe(1);
    expect(planJump({ ...start, grounded: false }, platforms, bounds, mulberry32(3), cfg)).toBeNull();
  });

  it("the AI uses a planned jump and the arc reaches the target", () => {
    const platforms = [top(1, 100, 400, 500), top(2, 560, 900, 400)];
    let body: Body = { ...bodyAt(300, 500), grounded: true, platformId: 1 };
    const plan = solveJump(body, platforms[1], cfg)!;
    const ai = { ...initialAi(), timer: 0 };
    const d = decide(
      ai,
      { grounded: true, landing: false, hitWall: 0, x: body.x, w: W, boundsWidth: bounds.width, planJump: () => plan },
      dt,
      () => 0, // always take the platform-jump branch
    );
    expect(d.intent).toMatchObject({ jump: true, jumpVelocity: plan.vy, jumpVx: plan.vx });
    body = fly(body, plan, platforms);
    expect(body.platformId).toBe(2);
  });
});

describe("long-run invariants with platforms", () => {
  it("wandering among windows for 3 minutes never leaves the screen or sinks into a top", () => {
    const windows = [win(1, 100, 420, 420, 300), win(2, 600, 300, 400, 300), win(3, 1050, 520, 300, 200)];
    const platforms = visibleTops(windows, bounds);
    const rng = mulberry32(11);
    let body = makeBody(700, bounds, W, H);
    let ai = initialAi();
    let hitWall: -1 | 0 | 1 = 0;
    const visited = new Set<number | null>();
    for (let i = 0; i < 60 * 180; i++) {
      const snapshot = body;
      const d = decide(
        ai,
        {
          grounded: body.grounded,
          landing: false,
          hitWall,
          x: body.x,
          w: W,
          boundsWidth: bounds.width,
          planJump: () => planJump(snapshot, platforms, bounds, rng, cfg),
        },
        dt,
        rng,
      );
      ai = d.ai;
      const r = step(body, d.intent, dt, bounds, cfg, platforms);
      body = r.body;
      hitWall = r.hitWall;
      if (body.grounded) visited.add(body.platformId);
      expect(body.x).toBeGreaterThanOrEqual(0);
      expect(body.x).toBeLessThanOrEqual(bounds.width - W);
      expect(body.y).toBeGreaterThanOrEqual(0);
      expect(body.y).toBeLessThanOrEqual(bounds.height - H);
      if (body.platformId !== null) {
        const p = platforms.find((q) => q.id === body.platformId)!;
        expect(body.y + body.h).toBe(p.top);
      }
    }
    // It should have stood on the floor and on at least two different windows.
    expect(visited.has(null)).toBe(true);
    expect([...visited].filter((v) => v !== null).length).toBeGreaterThanOrEqual(2);
  });
});

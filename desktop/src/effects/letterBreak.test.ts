import { describe, expect, it } from "vitest";
import { MAX_PARTICLES, MIN_INTERVAL, TIMELINE, LetterBreaker, crackLines, type WordSampler } from "./letterBreak";

/** Fake sampler: a solid w×h block per word (no canvas needed). */
const block = (w: number, h: number): WordSampler => () => {
  const pixels = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) pixels.push({ x, y, color: "#fff" });
  return { w, h, cell: 2, pixels };
};
const bounds = { width: 1000, height: 600 };
const total = Object.values(TIMELINE).reduce((a, b) => a + b, 0);
const seq = () => {
  let i = 0;
  return () => ((i++ * 0.37) % 1);
};

function runFor(lb: LetterBreaker, seconds: number, floor = 600) {
  for (let t = 0; t < seconds; t += 1 / 60) lb.step(1 / 60, floor);
}

describe("letter-smash effect", () => {
  it("runs appear → crack → scatter → reform → hold → fade, then cleans itself up", () => {
    const lb = new LetterBreaker(block(80, 20), seq());
    expect(lb.trigger(0, "HI", { x: 500, y: 300 }, bounds)).toBe("started");
    const phases = new Set<string>();
    for (let t = 0; t < total + 0.5; t += 1 / 60) {
      lb.step(1 / 60, 600);
      if (lb.effects[0]) phases.add(lb.effects[0].phase);
    }
    expect([...phases]).toEqual(["appear", "crack", "scatter", "reform", "hold", "fade"]);
    expect(lb.effects).toHaveLength(0); // nothing lingers
  });

  it("pixels scatter away and then return exactly to their places", () => {
    const lb = new LetterBreaker(block(60, 20), seq());
    lb.trigger(0, "X", { x: 500, y: 300 }, bounds);
    runFor(lb, TIMELINE.appear + TIMELINE.crack + TIMELINE.scatter * 0.6);
    const e = lb.effects[0];
    const displaced = e.particles.filter((p) => Math.hypot(p.x - p.hx, p.y - p.hy) > 10).length;
    expect(displaced).toBeGreaterThan(e.particles.length * 0.8);
    runFor(lb, TIMELINE.scatter * 0.4 + TIMELINE.reform + 0.05);
    expect(lb.effects[0].phase).toBe("hold");
    for (const p of lb.effects[0].particles) {
      expect(p.x).toBeCloseTo(p.hx, 5);
      expect(p.y).toBeCloseTo(p.hy, 5);
    }
  });

  it("scattered pixels never fall through the floor", () => {
    const lb = new LetterBreaker(block(60, 20), seq());
    lb.trigger(0, "X", { x: 500, y: 560 }, bounds);
    for (let t = 0; t < total; t += 1 / 60) {
      lb.step(1 / 60, 580);
      for (const p of lb.effects[0]?.particles ?? []) expect(p.y).toBeLessThanOrEqual(580);
    }
  });

  it("is rate limited and allows only one at a time", () => {
    const lb = new LetterBreaker(block(40, 10), seq());
    expect(lb.trigger(0, "A", { x: 100, y: 100 }, bounds)).toBe("started");
    expect(lb.trigger(0.1, "A", { x: 100, y: 100 }, bounds)).toBe("busy");
    lb.stop();
    expect(lb.trigger(1, "A", { x: 100, y: 100 }, bounds)).toBe("rate-limited");
    expect(lb.trigger(MIN_INTERVAL + 0.01, "A", { x: 100, y: 100 }, bounds)).toBe("started");
  });

  it("the off switch clears active effects immediately and blocks new ones", () => {
    const lb = new LetterBreaker(block(40, 10), seq());
    lb.trigger(0, "A", { x: 100, y: 100 }, bounds);
    lb.setEnabled(false);
    expect(lb.effects).toHaveLength(0);
    expect(lb.trigger(100, "A", { x: 100, y: 100 }, bounds)).toBe("disabled");
    lb.setEnabled(true);
    expect(lb.trigger(100, "A", { x: 100, y: 100 }, bounds)).toBe("started");
  });

  it("caps particles, keeps the word on screen, and has deterministic cracks", () => {
    const lb = new LetterBreaker(block(400, 200), seq()); // 20k candidate pixels
    lb.trigger(0, "BIG", { x: 0, y: 0 }, bounds);
    const e = lb.effects[0];
    expect(e.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
    expect(crackLines(e)).toEqual(crackLines(e));
    expect(new LetterBreaker(block(10, 10), seq()).trigger(0, "", { x: 0, y: 0 }, bounds)).toBe("started");
    const empty = new LetterBreaker(() => ({ w: 0, h: 0, cell: 1, pixels: [] }), seq());
    expect(empty.trigger(0, " ", { x: 0, y: 0 }, bounds)).toBe("empty");
  });
});

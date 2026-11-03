import { describe, expect, it } from "vitest";
import { AffectionEngine, type AffectionConfig, type AffectionHooks } from "./engine";
import { AWAY_CAP } from "./model";

const cfg: AffectionConfig = { intensity: "normal", decay: 2, spontaneous: true, frequency: 1, attention: true, quiet: false, quietHours: false, quietStart: 22, quietEnd: 8 };

function rng(seed = 9) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function make(initial = { value: 50, updated: Date.now(), cookies: 0 }, over: Partial<AffectionHooks> = {}, c = cfg) {
  const said: string[] = [];
  const saves: { value: number; updated: number; cookies: number }[] = [];
  let idle = 0;
  const hooks: AffectionHooks = {
    say: (t) => void said.push(t),
    pose: () => {},
    hearts: () => {},
    save: (s) => void saves.push(s),
    busy: () => false,
    idleSeconds: async () => idle,
    ...over,
  };
  const e = new AffectionEngine(initial, c, hooks, rng(), 0, Date.now());
  return { e, said, saves, setIdle: (s: number) => (idle = s) };
}

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe("affection engine", () => {
  it("persists across restarts: time the app was closed barely decays it", () => {
    const week = 7 * 24 * 3600 * 1000;
    const { e } = make({ value: 60, updated: Date.now() - week, cookies: 0 });
    expect(e.value).toBeCloseTo(60 - AWAY_CAP);
    const fresh = make({ value: 60, updated: Date.now() - 60_000, cookies: 0 });
    expect(fresh.e.value).toBeGreaterThan(59.9);
  });

  it("feeding raises affection, reacts and saves right away", () => {
    const { e, said, saves } = make();
    e.fed(10);
    expect(e.value).toBeCloseTo(58);
    expect(said.length).toBe(1);
    expect(saves[saves.length - 1]?.value).toBeCloseTo(58);
    expect(saves[saves.length - 1]?.cookies).toBe(1);
  });

  it("decays while you're active, far less while you're away", async () => {
    const { e, setIdle } = make({ value: 50, updated: Date.now(), cookies: 0 }, {}, { ...cfg, spontaneous: false, decay: 3.6 }); // 0.001/s
    for (let t = 0; t <= 600; t += 5) e.tick(t);
    const active = 50 - e.value;
    expect(active).toBeGreaterThan(0.5);
    setIdle(10_000);
    e.tick(605);
    await flushPromises();
    const before = e.value;
    for (let t = 610; t <= 1210; t += 5) e.tick(t);
    expect(before - e.value).toBeLessThan(active * 0.2);
  });

  it("saves periodically, not every tick", () => {
    const { e, saves } = make({ value: 50, updated: Date.now(), cookies: 0 }, {}, { ...cfg, spontaneous: false });
    for (let t = 0; t <= 120; t += 5) e.tick(t);
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.length).toBeLessThanOrEqual(5);
  });

  it("a click is never a kiss, even at the highest rapport (CJ Ver)", () => {
    const { e } = make({ value: 95, updated: Date.now(), cookies: 0 });
    for (let t = 0; t < 600; t += 5) e.tick(t);
    expect(e.pet(600)).toBe(false);
  });

  it("adopts a reset made in settings", () => {
    const { e } = make({ value: 80, updated: Date.now(), cookies: 2 });
    e.adopt({ value: 30, cookies: 2 });
    expect(e.value).toBe(30);
  });

  it("speaks spontaneously only when allowed", async () => {
    const quiet = make({ value: 60, updated: Date.now(), cookies: 0 }, {}, { ...cfg, quiet: true });
    for (let t = 0; t < 3 * 3600; t += 5) quiet.e.tick(t);
    expect(quiet.said).toHaveLength(0);
    const chatty = make({ value: 60, updated: Date.now(), cookies: 0 });
    for (let t = 0; t < 3 * 3600; t += 5) chatty.e.tick(t);
    expect(chatty.said.length).toBeGreaterThan(5);
    expect(chatty.said.length).toBeLessThan(3 * 3600 / 150);
    expect(new Set(chatty.said).size).toBeGreaterThan(chatty.said.length * 0.6); // varied
  });
});

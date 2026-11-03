import { describe, expect, it } from "vitest";
import { EAT_TIME, HOVER_FEED, IDLE_DESPAWN, overCompanion, spawnCookie, stepCookie, type CookieState } from "./cookie";

const bounds = { width: 1440, height: 900 };
const her = { x: 700, y: 900 - 84, w: 40, h: 84 };
const dt = 1 / 60;

function run(c: CookieState, seconds: number) {
  let s = c;
  const events: string[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const r = stepCookie(s, dt, bounds, [], [], her);
    s = r.state;
    if (r.event) events.push(r.event);
  }
  return { s, events };
}

describe("cookie", () => {
  it("spawns beside her and drops to the floor without feeding her", () => {
    const c = spawnCookie(her, bounds, 48, "chocolate");
    expect(overCompanion(c.body, her)).toBe(false);
    const { s, events } = run(c, 2);
    expect(s.body.grounded).toBe(true);
    expect(s.body.y + s.body.h).toBeCloseTo(900);
    expect(events).toEqual([]);
  });

  it("hovering it over her feeds her, then she eats it", () => {
    let c: CookieState = { ...spawnCookie(her, bounds, 48, "chocolate"), held: true };
    c = { ...c, body: { ...c.body, x: her.x, y: her.y + 10 } };
    const { s, events } = run(c, HOVER_FEED + EAT_TIME + 0.2);
    expect(events).toEqual(["feed", "eaten"]);
    expect(s.eating).not.toBeNull();
  });

  it("dropping it onto her also feeds her", () => {
    const c: CookieState = { ...spawnCookie(her, bounds, 48, "sugar"), body: { x: her.x, y: her.y - 200, w: 48, h: 48, vx: 0, vy: 0, grounded: false, platformId: null, facing: 1 } };
    expect(run(c, 1).events[0]).toBe("feed");
  });

  it("holding it elsewhere doesn't feed; a lying cookie tidies itself up eventually", () => {
    const held: CookieState = { ...spawnCookie(her, bounds, 48, "chocolate"), held: true, body: { x: 100, y: 100, w: 48, h: 48, vx: 0, vy: 0, grounded: false, platformId: null, facing: 1 } };
    expect(run(held, 3).events).toEqual([]);
    const lying = run(spawnCookie(her, bounds, 48, "chocolate"), 1).s;
    expect(run({ ...lying, idle: IDLE_DESPAWN - 0.5 }, 1).events).toContain("expired");
  });
});

import { describe, expect, it } from "vitest";
import { IDLE_POSES, IdleRotation, MAX_INTERVAL, MIN_INTERVAL, clampInterval, idleFrame, type IdleSettings } from "./idle";

const rotate: IdleSettings = { mode: "rotate", fixed: "stand", interval: 30, paused: false };

describe("idle poses", () => {
  it("maps every pose to frames the atlas has", () => {
    const atlas = new Set(["idle", "sit", "sit2", "nap", "wave1", "wave2"]);
    for (const p of IDLE_POSES) for (let t = 0; t < 8; t += 0.1) expect(atlas.has(idleFrame(p, t).frame)).toBe(true);
  });

  it("animates: legs swing, waving alternates, looking around flips facing", () => {
    expect(idleFrame("swingLegs", 0).frame).toBe("sit");
    expect(idleFrame("swingLegs", 0.5).frame).toBe("sit2");
    expect(idleFrame("wave", 0.4).frame).toBe("wave2");
    expect(idleFrame("wave", 3).frame).toBe("idle");
    expect(idleFrame("lookAround", 0.5).flip).toBe(false);
    expect(idleFrame("lookAround", 2).flip).toBe(true);
  });

  it("a fixed pose is held", () => {
    const r = new IdleRotation(() => 0);
    for (let t = 0; t < 1000; t += 7) r.update(t, { ...rotate, mode: "fixed", fixed: "nap" });
    expect(r.current).toBe("nap");
  });

  it("rotates after the interval, never repeating the same pose back to back", () => {
    const r = new IdleRotation(() => 0.99);
    const seen = [r.current];
    for (let t = 0; t <= 300; t += 1) {
      r.update(t, rotate);
      if (r.current !== seen[seen.length - 1]) seen.push(r.current);
    }
    expect(seen.length).toBeGreaterThanOrEqual(10); // about every 30 s
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("pause freezes both the animation and the rotation; resume continues", () => {
    const r = new IdleRotation(() => 0.3);
    r.switchTo("swingLegs", 0);
    const frozen = r.update(0.5, { ...rotate, paused: true });
    for (let t = 0.5; t < 200; t += 1) expect(r.update(t, { ...rotate, paused: true })).toEqual(frozen);
    expect(r.current).toBe("swingLegs");
    const before = r.current;
    for (let t = 200; t < 240; t += 1) r.update(t, rotate);
    expect(r.current).not.toBe(before); // rotation resumes from where it was held
  });

  it("clamps the interval", () => {
    expect(clampInterval(1)).toBe(MIN_INTERVAL);
    expect(clampInterval(1e6)).toBe(MAX_INTERVAL);
    expect(clampInterval(NaN)).toBe(45);
  });
});

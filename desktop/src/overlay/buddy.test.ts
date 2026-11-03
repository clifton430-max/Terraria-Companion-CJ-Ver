import { describe, expect, it } from "vitest";
import { STACKED, unstack } from "./buddy";

describe("characters move independently (no fixed spacing)", () => {
  const w = 40;
  it("can stand side by side and walk past each other", () => {
    expect(unstack({ x: 500, w }, false, [{ x: 530, w }], 1440)).toBeNull(); // 30 px apart: fine
    expect(unstack({ x: 500, w }, true, [{ x: 502, w }], 1440)).toBeNull(); // walking past: fine
  });

  it("only steps aside when idle and right on top of someone", () => {
    expect(unstack({ x: 500, w }, false, [{ x: 505, w }], 1440)).toBe(-1);
    expect(unstack({ x: 505, w }, false, [{ x: 500, w }], 1440)).toBe(1);
    expect(unstack({ x: 500, w }, false, [{ x: 500 + STACKED + 1, w }], 1440)).toBeNull();
  });

  it("steps inward at a screen edge", () => {
    expect(unstack({ x: 5, w }, false, [{ x: 8, w }], 1440)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { placeBubble } from "./bubble";

const size = { w: 200, h: 60 };
const bounds = { width: 1440 };

describe("speech bubble placement", () => {
  it("sits centred above the character with the tail in the middle", () => {
    const p = placeBubble({ x: 700, y: 500, w: 40 }, size, bounds);
    expect(p).toEqual({ x: 620, y: 424, tailX: 100 });
  });

  it("stays on screen near the edges while the tail still points at the character", () => {
    const left = placeBubble({ x: 0, y: 500, w: 40 }, size, bounds);
    expect(left.x).toBe(8);
    expect(left.tailX).toBe(16); // as close to the character as the rounded corner allows
    const right = placeBubble({ x: 1400, y: 500, w: 40 }, size, bounds);
    expect(right.x + size.w).toBeLessThanOrEqual(1440 - 8);
    expect(right.x + right.tailX).toBeCloseTo(Math.min(1420, right.x + size.w - 16));
  });

  it("never goes above the top of the screen", () => {
    expect(placeBubble({ x: 700, y: 20, w: 40 }, size, bounds).y).toBe(8);
  });
});

import { describe, expect, it } from "vitest";
import { CHEER_GAP, DestroyerBuddy } from "./buddy";

describe("desktop buddy reactions to the bookmarklet", () => {
  it("greets on activation and says goodbye when the page is restored", () => {
    const b = new DestroyerBuddy(() => 0);
    expect(b.react({ event: "on", count: 0 }, 0)?.pose).toBe("wave");
    expect(b.react({ event: "off", count: 30 }, 1)?.text).toMatch(/restored|back/i);
  });

  it("cheers for smashes at most every few seconds, louder for big combos", () => {
    const b = new DestroyerBuddy(() => 0);
    b.react({ event: "on", count: 0 }, 0);
    expect(b.react({ event: "smash", count: 3 }, 1)).toBeNull(); // too soon after the greeting
    const cheer = b.react({ event: "smash", count: 3 }, CHEER_GAP + 0.1);
    expect(cheer?.pose).toBe("jump");
    expect(b.react({ event: "smash", count: 3 }, CHEER_GAP + 1)).toBeNull();
    expect(b.react({ event: "smash", count: 20 }, CHEER_GAP * 3)?.text).toMatch(/combo|incredible/i);
    expect(b.react({ event: "smash", count: 0 }, CHEER_GAP * 10)).toBeNull();
  });
});

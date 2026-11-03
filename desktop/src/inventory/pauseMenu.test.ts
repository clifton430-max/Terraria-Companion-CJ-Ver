import { describe, expect, it } from "vitest";
import { moonPhase, step, timeOfDay } from "./PauseMenu";

describe("the pause menu", () => {
  it("wraps around the section list both ways", () => {
    expect(step(0, -1, 10)).toBe(9);
    expect(step(9, 1, 10)).toBe(0);
    expect(step(3, 1, 10)).toBe(4);
  });

  it("shows the real moon: new and full on known dates", () => {
    const near = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    expect(near(moonPhase(new Date(Date.UTC(2024, 0, 11, 11, 57))), 0)).toBeLessThan(0.02); // new moon
    expect(near(moonPhase(new Date(Date.UTC(2024, 0, 25, 17, 54))), 0.5)).toBeLessThan(0.02); // full moon
  });

  it("names the time of day", () => {
    expect(timeOfDay(2)).toBe("Late Night");
    expect(timeOfDay(6)).toBe("Early Morning");
    expect(timeOfDay(13)).toBe("Daytime");
    expect(timeOfDay(18)).toBe("Evening");
    expect(timeOfDay(22)).toBe("Night");
  });
});

import { describe, expect, it } from "vitest";
import { WorldMap } from "../gen";
import { worldLocations } from "./locations";

describe("places to explore", () => {
  it("puts the beaches on the dry sand, not out at sea", () => {
    for (const seed of [1, 42, 1723747264, 99]) {
      const map = new WorldMap(seed);
      for (const l of worldLocations(map).filter((l) => l.biome === "ocean")) {
        expect(map.biome(l.x), `${seed} ${l.id}`).toBe("ocean");
        expect(map.liquid(l.x, map.surface(l.x) - 1), `${seed} ${l.id} is in the water`).toBe(0);
      }
    }
  });
});

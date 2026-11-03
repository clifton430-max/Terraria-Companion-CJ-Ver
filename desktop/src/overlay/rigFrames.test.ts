import { describe, expect, it } from "vitest";
import { WALK_FRAMES, WALK_PX_PER_FRAME, resolveFrame, rigScaleFor, selectRigFrame, walkStep } from "./rigFrames";

const base = { attackProgress: 0, walkDistance: 0, rigScale: 2 };

describe("Terraria rig frame selection", () => {
  it("maps movement animations to atlas frames", () => {
    expect(selectRigFrame({ ...base, anim: "idle" })).toBe("idle");
    expect(selectRigFrame({ ...base, anim: "land" })).toBe("idle");
    expect(selectRigFrame({ ...base, anim: "jump" })).toBe("jump");
    expect(selectRigFrame({ ...base, anim: "fall" })).toBe("fall");
    expect(selectRigFrame({ ...base, anim: "walk" })).toBe("walk0");
  });

  it("swings through the four item-use stages by attack progress", () => {
    const at = (p: number) => selectRigFrame({ ...base, anim: "swing", attackProgress: p });
    expect([0, 0.24, 0.25, 0.5, 0.75, 0.99, 1].map(at)).toEqual(["use1", "use1", "use2", "use3", "use4", "use4", "use4"]);
    expect(selectRigFrame({ ...base, anim: "shoot" })).toBe("shoot");
    expect(selectRigFrame({ ...base, anim: "cast" })).toBe("cast");
  });

  it("advances the walk cycle with distance travelled and wraps after 14 frames", () => {
    const px = WALK_PX_PER_FRAME * 2; // CSS px per frame at rig scale 2
    expect(walkStep(0, 2)).toBe(0);
    expect(walkStep(px - 0.01, 2)).toBe(0);
    expect(walkStep(px, 2)).toBe(1);
    expect(walkStep(px * WALK_FRAMES, 2)).toBe(0);
    expect(walkStep(px * (WALK_FRAMES + 3), 2)).toBe(3);
    expect(selectRigFrame({ ...base, anim: "walk", walkDistance: px * 5 })).toBe("walk5");
    // Larger art walks proportionally farther per frame, so feet don't slide.
    expect(walkStep(WALK_PX_PER_FRAME * 3, 3)).toBe(1);
  });

  it("keeps the character close to its previous on-screen size", () => {
    expect(rigScaleFor(2)).toBe(1);
    expect(rigScaleFor(3)).toBe(2); // default: 42 px body × 2 = 84 px vs 72 px before
    expect(rigScaleFor(4)).toBe(3);
    expect(rigScaleFor(1)).toBe(1);
  });
});

describe("frame fallbacks (skins or atlases missing poses)", () => {
  const full = ["idle", "walk0", "walk1", "jump", "fall", "use1", "use2", "shoot", "cast", "sit", "ride", "wave1", "wave2", "hug"];
  it("uses the requested frame when present", () => {
    for (const f of full) expect(resolveFrame(full, f)).toBe(f);
  });
  it("falls back to the nearest available pose, ending at idle", () => {
    const minimal = ["idle", "walk0", "jump", "shoot"];
    expect(resolveFrame(minimal, "sit")).toBe("jump");
    expect(resolveFrame(minimal, "wave2")).toBe("shoot");
    expect(resolveFrame(minimal, "walk9")).toBe("walk0");
    expect(resolveFrame(minimal, "use3")).toBe("shoot");
    expect(resolveFrame(["idle"], "hug")).toBe("idle");
    expect(resolveFrame(["only"], "whatever")).toBe("only");
    expect(resolveFrame([], "x")).toBe("x");
  });
});

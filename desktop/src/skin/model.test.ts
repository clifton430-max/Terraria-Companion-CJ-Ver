import { describe, expect, it } from "vitest";
import type { Appearance, SkinInfo } from "../bridge";
import { effectiveSkin, normalizeSkin, rigKey } from "./model";

const look = { skinVariant: 0, hair: 1 } as Appearance;
const both: SkinInfo[] = [
  { id: "default", name: "Default", available: true, detail: "" },
  { id: "waifu2b", name: "2B", available: true, detail: "Waifu 2B" },
];

describe("skin selection", () => {
  it("normalizes unknown or stale ids to the default", () => {
    expect(normalizeSkin("waifu2b")).toBe("waifu2b");
    expect(normalizeSkin("bogus")).toBe("default");
    expect(normalizeSkin(undefined)).toBe("default");
  });

  it("falls back to the default when the selected skin's pack is missing", () => {
    expect(effectiveSkin("waifu2b", both)).toBe("waifu2b");
    expect(effectiveSkin("waifu2b", [both[0], { ...both[1], available: false }])).toBe("default");
    expect(effectiveSkin("waifu2b", [both[0]])).toBe("default");
    expect(effectiveSkin("default", both)).toBe("default");
  });

  it("the rig key changes on skin switch (so the atlas reloads immediately) and back again", () => {
    const a = rigKey(look, "default");
    const b = rigKey(look, "waifu2b");
    expect(a).not.toBe(b);
    expect(rigKey(look, "default")).toBe(a);
    expect(rigKey({ ...look, hair: 2 }, "default")).not.toBe(a);
    expect(rigKey(look, "nonsense" as never)).toBe(a);
  });
});

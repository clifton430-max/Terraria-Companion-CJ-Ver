import { describe, expect, it } from "vitest";
import { stripWake } from "./wake";

describe("wake names", () => {
  const names = ["Goblin Girl", "Rose"];
  it("her name first, with or without a lead-in", () => {
    expect(stripWake("Rose, what's the weather?", names)).toBe("what's the weather?");
    expect(stripWake("Hey Rose, open the chess board.", names)).toBe("open the chess board.");
    expect(stripWake("okay rose play terraria", names)).toBe("play terraria");
    expect(stripWake("Hey, Goblin Girl: hi!", names)).toBe("hi!");
  });
  it("just her name leaves nothing to ask", () => {
    expect(stripWake("Hey Rose.", names)).toBe("");
  });
  it("not her name, or not at the start", () => {
    expect(stripWake("Roseanne is coming over", names)).toBeNull();
    expect(stripWake("Tell Rose I said hi", names)).toBeNull();
    expect(stripWake("hello world", names)).toBeNull();
    expect(stripWake("", names)).toBeNull();
    expect(stripWake("Rose", [])).toBeNull();
  });
  it("ignores case and accents", () => {
    expect(stripWake("HEY RÓSE how are you", ["Rose"])).toBe("how are you");
  });
});

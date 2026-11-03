import { describe, expect, it } from "vitest";
import { linesFor, pickLine } from "../affection/dialogue";
import { parseCommand, validateAction } from "../assistant/actions";
import { LAYOUT, MOON_PARTS, moonScale, partRect, spawnMoonLord } from "../combat/moonlord";
import { getWeapon } from "../combat/weapons";
import { goblinAppRemark } from "./lines";
import { CHARACTERS, CHARACTER_IDS } from "./roster";

function rng(seed = 5) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const id = (t: string) => {
  const p = parseCommand(t);
  return p?.kind === "action" ? [p.action.id, p.action.args?.name] : null;
};

describe("roster characters", () => {
  it("each has a real signature weapon", () => {
    for (const c of CHARACTER_IDS) expect(getWeapon(CHARACTERS[c].signature), c).toBeTruthy();
    expect(getWeapon("royal-scepter")?.kind).toBe("staff");
    expect(getWeapon("confetti-cannon")?.kind).toBe("gun");
  });

  it("speak in their own distinct voices, without emojis", () => {
    const r = rng(3);
    const by = (c: (typeof CHARACTER_IDS)[number]) => new Set(linesFor("spontaneous", "smitten", c));
    const girls = ["princess", "partygirl", "nurse", "zoologist", "goblin"] as const;
    for (const a of girls) for (const b of girls) if (a !== b) for (const l of by(a)) expect(by(b).has(l), `${a}/${b}`).toBe(false);
    for (const c of girls)
      for (const situation of ["spontaneous", "pet", "feed", "welcomeBack", "awayAsk", "victory"] as const)
        for (const l of linesFor(situation, "devoted", c)) expect(/\p{Extended_Pictographic}/u.test(l), l).toBe(false);
    expect(pickLine("spontaneous", "close", "strong", [], r, "zoologist")).toBeTruthy();
  });

  it("goblin girl comments on apps by name only", () => {
    const r = rng(1);
    expect(goblinAppRemark("Visual Studio Code", r)).toContain("Visual Studio Code");
    expect(goblinAppRemark("Safari", r)).toContain("Safari");
  });
});

describe("assistant roster commands", () => {
  it("understands switching, summoning and dismissing characters", () => {
    expect(id("switch to the Princess")).toEqual(["character.select", "princess"]);
    expect(id("let me control the nurse")).toEqual(["character.select", "nurse"]);
    expect(id("bring out the party girl")).toEqual(["character.summon", "partygirl"]);
    expect(id("bring out the goblin girl")).toEqual(["character.summon", "goblin"]);
    expect(id("send the fox girl away")).toEqual(["character.dismiss", "zoologist"]);
    expect(id("summon queen bee")).toEqual(["boss.queen", undefined]);
    expect(validateAction({ action: "character.select", args: { name: "Zoologist" } })).toEqual({ id: "character.select", args: { name: "zoologist" } });
    expect(validateAction({ action: "character.select", args: { name: "Bowser" } })).toBeNull();
  });
});

describe("Moon Lord girl model", () => {
  it("fits the whole model on screen with every part inside", () => {
    for (const bounds of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 800 }]) {
      const m = spawnMoonLord("normal", bounds, 300, "girl");
      m.y = Math.min(LAYOUT.girl.extent.up * m.scale + 16, bounds.height - LAYOUT.girl.extent.down * m.scale - 140);
      expect(m.scale).toBeLessThanOrEqual(moonScale(bounds, "girl") + 1e-9);
      for (const p of MOON_PARTS) {
        const r = partRect(m, p);
        expect(r.x, `${bounds.width} ${p}`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(bounds.width);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y + r.h).toBeLessThanOrEqual(bounds.height);
      }
    }
  });

  it("keeps the classic layout when the add-on isn't installed", () => {
    const m = spawnMoonLord("normal", { width: 1440, height: 900 }, 700);
    expect(m.model).toBe("classic");
  });
});

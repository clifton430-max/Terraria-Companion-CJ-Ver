import { describe, expect, it } from "vitest";
import type { ReactionRule } from "../bridge";
import { DWELL, GLOBAL_GAP, ReactionEngine, matchRule, newRule, type ReactionSettings } from "./engine";

const rule = (over: Partial<ReactionRule>): ReactionRule => ({
  id: "r",
  bundleId: "com.apple.Safari",
  name: "Safari",
  enabled: true,
  comments: ["Hi!", "Hello again!", "Yay~"],
  voice: "none",
  animation: "wave",
  cooldown: 60,
  chance: 1,
  quiet: false,
  windowSwitches: false,
  ...over,
});
const on: ReactionSettings = { enabled: true, quiet: false, quietText: false, excluded: [] };
const sw = (bundleId: string, sameApp = false) => ({ bundleId, name: bundleId, sameApp });
const always = () => 0;

describe("app identity matching", () => {
  const rules = [rule({ id: "s" }), rule({ id: "c", bundleId: "com.google.Chrome", enabled: false }), rule({ id: "any", bundleId: "*" })];
  it("uses the app's own rule, falls back to '*', and a disabled own rule means never", () => {
    expect(matchRule(rules, "com.apple.Safari")?.id).toBe("s");
    expect(matchRule(rules, "com.example.Other")?.id).toBe("any");
    expect(matchRule(rules, "com.google.Chrome")).toBeNull();
    expect(matchRule([rule({ bundleId: "*", enabled: false })], "x")).toBeNull();
  });
});

describe("reaction engine", () => {
  it("reacts after the dwell with one of the user's comments and the chosen animation", () => {
    const e = new ReactionEngine(always);
    e.onSwitch(sw("com.apple.Safari"), 0);
    expect(e.tick(DWELL - 0.1, [rule({})], on)).toBeNull();
    const r = e.tick(DWELL, [rule({})], on)!;
    expect(["Hi!", "Hello again!", "Yay~"]).toContain(r.text);
    expect(r.animation).toBe("wave");
    expect(r.voice).toBeNull(); // voice "none"
  });

  it("debounces rapid switching: only the app you settle on reacts", () => {
    const e = new ReactionEngine(always);
    const rules = [rule({ id: "s" }), rule({ id: "c", bundleId: "com.google.Chrome", comments: ["Chrome!"] })];
    e.onSwitch(sw("com.apple.Safari"), 0);
    e.onSwitch(sw("com.google.Chrome"), 0.4);
    expect(e.tick(1.6, rules, on)).toBeNull(); // Chrome hasn't dwelt long enough yet
    expect(e.tick(0.4 + DWELL, rules, on)!.text).toBe("Chrome!");
  });

  it("honours per-app cooldowns and the global gap", () => {
    const e = new ReactionEngine(always);
    const rules = [rule({ cooldown: 600 }), rule({ id: "c", bundleId: "com.google.Chrome", cooldown: 10 })];
    const at = (b: string, t: number) => {
      e.onSwitch(sw(b), t);
      return e.tick(t + DWELL, rules, on);
    };
    expect(at("com.apple.Safari", 0)).not.toBeNull();
    expect(at("com.google.Chrome", 20)).toBeNull(); // global gap
    expect(at("com.google.Chrome", GLOBAL_GAP + 5)).not.toBeNull();
    expect(at("com.apple.Safari", GLOBAL_GAP * 3)).toBeNull(); // Safari's own 600 s cooldown
    expect(at("com.apple.Safari", 700)).not.toBeNull();
  });

  it("ignores same-app window switches unless the rule opts in", () => {
    const e = new ReactionEngine(always);
    e.onSwitch(sw("com.apple.Safari", true), 0);
    expect(e.tick(5, [rule({})], on)).toBeNull();
    e.onSwitch(sw("com.apple.Safari", true), 10);
    expect(e.tick(15, [rule({ windowSwitches: true })], on)).not.toBeNull();
  });

  it("respects the global switch, exclusions and the per-rule enable flag", () => {
    for (const [settings, rules] of [
      [{ ...on, enabled: false }, [rule({})]],
      [{ ...on, excluded: ["com.apple.Safari"] }, [rule({})]],
      [on, [rule({ enabled: false })]],
    ] as const) {
      const e = new ReactionEngine(always);
      e.onSwitch(sw("com.apple.Safari"), 0);
      expect(e.tick(5, rules, settings)).toBeNull();
    }
  });

  it("frequency: a failed chance roll stays quiet and uses up that app's turn", () => {
    const e = new ReactionEngine(() => 0.9);
    e.onSwitch(sw("com.apple.Safari"), 0);
    expect(e.tick(5, [rule({ chance: 0.5 })], on)).toBeNull();
  });

  it("quiet modes: voice off globally or per rule, text optionally hidden; missing voice still shows text", () => {
    const voiced = rule({ voice: "random" });
    const e = new ReactionEngine(always);
    expect(e.preview(voiced, on).voice).toBe("hit0");
    expect(e.preview(voiced, { ...on, quiet: true }).voice).toBeNull();
    expect(e.preview(rule({ voice: "hit2", quiet: true }), on).voice).toBeNull();
    const hidden = e.preview(voiced, { ...on, quiet: true, quietText: true });
    expect(hidden.text).toBeNull();
    expect(hidden.animation).toBe("wave"); // a silent wave is still allowed
    expect(e.preview(rule({ comments: [] }), on).text).toBeNull();
  });

  it("doesn't repeat the previous comment when there's a choice", () => {
    const e = new ReactionEngine(always);
    const seen = [0, 1, 2, 3].map(() => e.preview(rule({}), on).text);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("new rules get unique ids and gentle defaults", () => {
    const r = newRule({ bundleId: "com.x", name: "X" }, [rule({ id: "rule1" })]);
    expect(r.id).toBe("rule2");
    expect(r).toMatchObject({ enabled: true, voice: "none", chance: 1, windowSwitches: false });
  });
});

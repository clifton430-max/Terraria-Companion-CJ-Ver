import { describe, expect, it } from "vitest";
import type { VoiceClip } from "../bridge";
import { SFX_COOLDOWN, SfxDirector, VOICE_COOLDOWN, VOICE_POOLS, VoiceDirector, type AudioSettings } from "./director";

const on: AudioSettings = { muted: false, voiceEnabled: true, voiceVolume: 0.6, sfxVolume: 0.5 };
const all = new Set<VoiceClip>(["hit0", "hit1", "hit2", "killed"]);
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

describe("voice director", () => {
  it("picks from the event's pool and avoids repeating the last line", () => {
    const d = new VoiceDirector(seq(0, 0, 0, 0));
    const clips: VoiceClip[] = [];
    for (let i = 0; i < 6; i++) {
      const t = i * 10;
      const pick = d.request("click", t, on, all);
      expect(pick).not.toBeNull();
      clips.push(pick!.clip);
      d.finished();
    }
    for (const c of clips) expect(VOICE_POOLS.click).toContain(c);
    for (let i = 1; i < clips.length; i++) expect(clips[i]).not.toBe(clips[i - 1]);
  });

  it("respects per-event cooldowns", () => {
    const d = new VoiceDirector(Math.random);
    expect(d.request("click", 0, on, all)).not.toBeNull();
    d.finished();
    expect(d.request("click", VOICE_COOLDOWN.click / 2, on, all)).toBeNull();
    expect(d.request("click", VOICE_COOLDOWN.click + 0.01, on, all)).not.toBeNull();
  });

  it("never overlaps lines: equal or lower priority waits, higher priority interrupts", () => {
    const d = new VoiceDirector(Math.random);
    const first = d.request("pickup", 0, on, all)!;
    expect(first.interrupt).toBe(false);
    d.started(0, 0.8);
    expect(d.request("click", 0.2, on, all)).toBeNull(); // lower
    expect(d.request("throw", 0.3, on, all)).toBeNull(); // equal
    const hurt = d.request("damage", 0.4, on, all)!;
    expect(hurt.interrupt).toBe(true); // higher
    d.started(0.4, 0.7);
    expect(d.request("death", 0.5, on, all)!.clip).toBe("killed");
    d.finished();
    expect(d.request("click", 2, on, all)).not.toBeNull();
  });

  it("is silent when muted, disabled, at zero volume, or when no clip loaded", () => {
    const d = new VoiceDirector(Math.random);
    expect(d.request("click", 0, { ...on, muted: true }, all)).toBeNull();
    expect(d.request("click", 0, { ...on, voiceEnabled: false }, all)).toBeNull();
    expect(d.request("click", 0, { ...on, voiceVolume: 0 }, all)).toBeNull();
    expect(d.request("click", 0, on, new Set())).toBeNull(); // every file missing
    expect(d.request("death", 0, on, new Set(["hit0"]))).toBeNull(); // death line missing
    expect(d.request("victory", 0, on, all)).toBeNull(); // the pack has no victory line
    // A partially missing pool still works with what's there.
    expect(d.request("click", 10, on, new Set(["hit2"]))!.clip).toBe("hit2");
  });
});

describe("sfx director", () => {
  it("plays vanilla sounds with a short anti-stacking cooldown, honours mute and missing files", () => {
    const s = new SfxDirector(seq(0.99));
    expect(s.request("pickaxeHit", 0, on, new Set())).toEqual({ name: "Tink_2", volume: 0.5 });
    expect(s.request("pickaxeHit", SFX_COOLDOWN / 2, on, new Set())).toBeNull();
    expect(s.request("pickaxeHit", 1, { ...on, muted: true }, new Set())).toBeNull();
    expect(s.request("pickaxeHit", 1, { ...on, sfxVolume: 0 }, new Set())).toBeNull();
    expect(s.request("grab", 1, on, new Set(["Grab"]))).toBeNull();
    expect(s.request("pickaxeHit", 2, on, new Set(["Tink_1", "Tink_2"]))!.name).toBe("Tink_0");
  });
});

// Pure decision logic for voice lines and sound effects: which clip (if any) plays for an
// interaction, with randomised pools, per-event cooldowns, one voice at a time and priorities.
// Playback itself lives in engine.ts; this module has no browser dependencies (tested directly).

import type { VoiceClip } from "../bridge";

export type VoiceEvent = "click" | "pickup" | "throw" | "land" | "damage" | "death" | "victory" | "reaction";
export type SfxEvent = "grab" | "throw" | "swing" | "pickaxeHit" | "pickaxeMiss" | "eat";

/**
 * Voice-pack clips per interaction. The installed pack only has three hit lines and one death
 * line per voice, so pools reuse them; "victory" has no matching line and stays silent.
 */
export const VOICE_POOLS: Record<VoiceEvent, readonly VoiceClip[]> = {
  click: ["hit0", "hit1", "hit2"],
  pickup: ["hit1", "hit2"],
  throw: ["hit0", "hit2"],
  land: ["hit0", "hit1"],
  damage: ["hit0", "hit1", "hit2"],
  death: ["killed"],
  victory: [],
  /** App-switch reactions name their clip explicitly (see `request(..., only)`). */
  reaction: ["hit0", "hit1", "hit2", "killed"],
};

/** Higher wins: may interrupt a lower-priority line that's still playing. */
export const VOICE_PRIORITY: Record<VoiceEvent, number> = {
  click: 1,
  land: 1,
  reaction: 1,
  pickup: 2,
  throw: 2,
  victory: 3,
  damage: 4,
  death: 5,
};

/** Minimum seconds between two lines for the same interaction. */
export const VOICE_COOLDOWN: Record<VoiceEvent, number> = {
  click: 0.9,
  land: 1.5,
  reaction: 0,
  pickup: 0.6,
  throw: 0.6,
  victory: 3,
  damage: 1.2,
  death: 0,
};

/** Vanilla Terraria sounds (Content/Sounds) per effect; one is picked at random. */
export const SFX_POOLS: Record<SfxEvent, readonly string[]> = {
  grab: ["Grab"],
  throw: ["Item_1"],
  swing: ["Item_1"],
  pickaxeHit: ["Tink_0", "Tink_1", "Tink_2"],
  pickaxeMiss: ["Dig_0", "Dig_1", "Dig_2"],
  // Terraria's eating sound.
  eat: ["Item_2"],
};

/** Minimum seconds between two plays of the same effect (stops machine-gun stacking). */
export const SFX_COOLDOWN = 0.06;

export interface AudioSettings {
  muted: boolean;
  voiceEnabled: boolean;
  voiceVolume: number;
  sfxVolume: number;
}

export interface VoicePick {
  clip: VoiceClip;
  /** Interrupt the line that's currently playing. */
  interrupt: boolean;
  volume: number;
}

export class VoiceDirector {
  private lastAt = new Map<VoiceEvent, number>();
  private lastClip = new Map<VoiceEvent, VoiceClip>();
  private busyUntil = -Infinity;
  private busyPriority = 0;

  constructor(private readonly rng: () => number) {}

  /**
   * Decide whether `event` speaks now. `available` lists clips that loaded successfully (missing
   * or undecodable clips are skipped). Call `started` with the clip duration once it plays.
   */
  request(event: VoiceEvent, now: number, settings: AudioSettings, available: ReadonlySet<VoiceClip>, only?: VoiceClip): VoicePick | null {
    if (settings.muted || !settings.voiceEnabled || settings.voiceVolume <= 0) return null;
    const last = this.lastAt.get(event);
    if (last !== undefined && now - last < VOICE_COOLDOWN[event]) return null;
    const priority = VOICE_PRIORITY[event];
    const playing = now < this.busyUntil;
    if (playing && priority <= this.busyPriority) return null;
    let pool = VOICE_POOLS[event].filter((c) => available.has(c) && (only === undefined || c === only));
    if (pool.length === 0) return null;
    // Don't repeat the previous line for this interaction when there's a choice.
    const prev = this.lastClip.get(event);
    if (pool.length > 1 && prev) pool = pool.filter((c) => c !== prev);
    const clip = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))];
    this.lastAt.set(event, now);
    this.lastClip.set(event, clip);
    this.busyPriority = priority;
    this.busyUntil = now + 0.5; // until started() reports the real duration
    return { clip, interrupt: playing, volume: settings.voiceVolume };
  }

  /** Playback began: the voice channel is busy for `duration` seconds. */
  started(now: number, duration: number) {
    this.busyUntil = now + Math.max(0, duration);
  }

  /** Playback ended or failed early. */
  finished() {
    this.busyUntil = -Infinity;
    this.busyPriority = 0;
  }

  get busy() {
    return this.busyUntil;
  }
}

export class SfxDirector {
  private lastAt = new Map<SfxEvent, number>();

  constructor(private readonly rng: () => number) {}

  request(event: SfxEvent, now: number, settings: AudioSettings, missing: ReadonlySet<string>): { name: string; volume: number } | null {
    if (settings.muted || settings.sfxVolume <= 0) return null;
    const last = this.lastAt.get(event);
    if (last !== undefined && now - last < SFX_COOLDOWN) return null;
    const pool = SFX_POOLS[event].filter((n) => !missing.has(n));
    if (pool.length === 0) return null;
    this.lastAt.set(event, now);
    return { name: pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))], volume: settings.sfxVolume };
  }
}

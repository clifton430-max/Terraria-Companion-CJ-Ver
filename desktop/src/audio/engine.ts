// Web Audio playback for sound effects (vanilla Terraria sounds), served as WAV by Rust over
// `tasset://`. Everything is preloaded in the background; an event whose clip isn't decoded yet is
// simply skipped, so nothing ever blocks. Missing files, unsupported codecs and decode errors mark
// the clip unavailable and are logged once.
//
// CJ Ver: the companions never make vocal sounds. There are no voice lines and no hit, pick-up or
// grab noises; only neutral effects play (tool swings, pickaxe hits, eating). The voice methods
// are kept so callers don't change, and always do nothing.

import { soundUrl, type AudioPrefs, type VoiceClip } from "../bridge";
import { SFX_POOLS, SfxDirector, type AudioSettings, type SfxEvent, type VoiceEvent } from "./director";

/** Effects that are vocal or "cute" noises: never played in CJ Ver. */
const SILENT_SFX: ReadonlySet<SfxEvent> = new Set(["grab"]);
const ALL_SFX = [...new Set(Object.entries(SFX_POOLS).filter(([k]) => !SILENT_SFX.has(k as SfxEvent)).flatMap(([, v]) => v))];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly failed = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly sfx = new SfxDirector(Math.random);
  private readonly sfxSources = new Set<AudioBufferSourceNode>();
  private settings: AudioSettings = { muted: false, voiceEnabled: false, voiceVolume: 0, sfxVolume: 0.5 };
  private master = 1;
  private disposed = false;

  configure(prefs: AudioPrefs) {
    this.settings = { muted: prefs.muted, voiceEnabled: false, voiceVolume: 0, sfxVolume: prefs.sfxVolume };
    this.master = Math.max(0, Math.min(1, prefs.master ?? 1));
    if (prefs.muted) this.stopAll();
    // Preload in the background.
    if (!prefs.muted) for (const n of ALL_SFX) void this.load(soundUrl(n));
  }

  /** No voices in CJ Ver. */
  reactionVoice(_clip: VoiceClip): boolean {
    return false;
  }

  /** No voices in CJ Ver. */
  voiceEvent(_event: VoiceEvent, _only?: VoiceClip): boolean {
    return false;
  }

  sfxEvent(event: SfxEvent) {
    if (SILENT_SFX.has(event)) return;
    const missing = new Set(ALL_SFX.filter((n) => this.failed.has(soundUrl(n)) || !this.buffers.has(soundUrl(n))));
    const pick = this.sfx.request(event, this.now(), this.settings, missing);
    if (!pick) return;
    const buffer = this.buffers.get(soundUrl(pick.name));
    if (!buffer) return;
    const src = this.play(buffer, pick.volume);
    if (!src) return;
    this.sfxSources.add(src);
    src.onended = () => this.sfxSources.delete(src);
  }

  /** No hit noises in CJ Ver. */
  addonHit(): boolean {
    return false;
  }

  /** No hit noises in CJ Ver. */
  preloadAddonHits() {}

  stopVoice() {}

  stopAll() {
    for (const s of this.sfxSources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sfxSources.clear();
  }

  dispose() {
    this.disposed = true;
    this.stopAll();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Names of clips that failed (for diagnostics/tests). */
  get unavailable(): string[] {
    return [...this.failed];
  }

  private now() {
    return performance.now() / 1000;
  }

  private context(): AudioContext | null {
    if (this.disposed) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch (e) {
        console.warn("audio unavailable", e);
        this.disposed = true;
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private play(buffer: AudioBuffer, volume: number): AudioBufferSourceNode | null {
    const ctx = this.context();
    if (!ctx) return null;
    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume * this.master));
      src.buffer = buffer;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return src;
    } catch (e) {
      console.warn("audio playback failed", e);
      return null;
    }
  }

  private load(url: string): Promise<void> {
    if (this.buffers.has(url) || this.failed.has(url)) return Promise.resolve();
    const pending = this.loading.get(url);
    if (pending) return pending;
    const p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.trim());
        const data = await res.arrayBuffer();
        const ctx = this.context();
        if (!ctx) throw new Error("no audio context");
        const buffer = await ctx.decodeAudioData(data);
        this.buffers.set(url, buffer);
      } catch (e) {
        this.failed.add(url);
        console.info(`audio clip unavailable: ${url} (${e instanceof Error ? e.message : String(e)})`);
      } finally {
        this.loading.delete(url);
      }
    })();
    this.loading.set(url, p);
    return p;
  }
}

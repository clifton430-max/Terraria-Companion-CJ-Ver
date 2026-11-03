// Runs the hidden affection meter inside the overlay: applies interactions, decays it (full rate
// only while you're actively using the computer, judged by the system idle timer), persists it
// through preferences, and drives spontaneous dialogue, attention requests while you're away,
// welcome-backs and the playful cookie / kiss requests. Talking is done through hooks so the
// companion keeps control of bubbles, poses and sounds.

import { pickLine, spontaneousSituation, type Situation } from "./dialogue";
import { AWAY_AFTER, applyEvent, decay, newChatter, newMeter, stepChatter, tierOf, tierIndex, type AffectionEvent, type ChatterSettings, type ChatterState, type Meter, type Tier } from "./model";

export interface AffectionHooks {
  say: (text: string) => void;
  pose: (animation: "wave" | "hug" | "jump" | "sit") => void;
  hearts: (count: number) => void;
  /** Persist { value, updated, cookies }. */
  save: (state: { value: number; updated: number; cookies: number }) => void;
  /** Is now a bad moment to talk (menu, voice card, editing, Control mode)? */
  busy: () => boolean;
  /** Seconds since the user's last input (system idle timer), polled every few seconds. */
  idleSeconds: () => Promise<number>;
}

export interface AffectionConfig extends ChatterSettings {
  intensity: "subtle" | "normal" | "strong";
  /** Whose voice she speaks in. */
  character?: import("../bridge").CharacterId;
  /** Points per active hour. */
  decay: number;
}

const POLL = 5; // s between idle-timer reads
const SAVE_EVERY = 30; // s
const PET_LINE_COOLDOWN = 25; // s
const RECENT = 12;

export class AffectionEngine {
  private meter: Meter;
  private cookies: number;
  private chatter: ChatterState;
  private recent: string[] = [];
  private idle = 0;
  private lastPoll = -Infinity;
  private lastTick: number | null = null;
  private lastSave = 0;
  private dirty = false;
  private lastPetLine = -Infinity;
  private savedValue: number;

  constructor(
    initial: { value: number; updated: number; cookies: number },
    private cfg: AffectionConfig,
    private readonly hooks: AffectionHooks,
    private readonly rnd: () => number = Math.random,
    now = performance.now() / 1000,
    wallNow = Date.now(),
  ) {
    // Time the app wasn't running counts as "away" (barely any decay).
    const away = initial.updated > 0 ? Math.max(0, (wallNow - initial.updated) / 1000) : 0;
    this.meter = newMeter(decay(initial.value, cfg.decay, 0, away));
    this.cookies = initial.cookies;
    this.savedValue = initial.value;
    this.dirty = this.meter.value !== initial.value || initial.updated === 0;
    this.chatter = newChatter(now, cfg, rnd);
  }

  get value() {
    return this.meter.value;
  }

  get tier(): Tier {
    return tierOf(this.meter.value);
  }

  configure(cfg: AffectionConfig) {
    this.cfg = cfg;
  }

  /** Preferences changed elsewhere (e.g. reset in settings): adopt a value we didn't write. */
  adopt(state: { value: number; cookies: number }) {
    if (Math.abs(state.value - this.savedValue) > 0.01 && Math.abs(state.value - this.meter.value) > 0.01) {
      this.meter = newMeter(state.value);
      this.savedValue = state.value;
    }
    this.cookies = Math.max(this.cookies, state.cookies);
  }

  /** Say a line for a situation at the current tier (no repeats of recent lines). */
  speak(situation: Situation): boolean {
    const line = pickLine(situation, this.tier, this.cfg.intensity, this.recent, this.rnd, this.cfg.character ?? "terrarian");
    if (!line) return false;
    this.recent = [...this.recent, line].slice(-RECENT);
    this.hooks.say(line);
    return true;
  }

  /** An interaction happened. Returns the change in affection. */
  event(ev: AffectionEvent, nowMs = Date.now()): number {
    const r = applyEvent(this.meter, ev, nowMs);
    this.meter = r.meter;
    if (r.delta !== 0) this.dirty = true;
    return r.delta;
  }

  /** The user clicked her (without dragging). Returns true if that answered a kiss request (never in CJ Ver). */
  pet(now: number): boolean {
    this.event("pet");
    if (now - this.lastPetLine > PET_LINE_COOLDOWN && this.rnd() < 0.4) {
      this.lastPetLine = now;
      this.speak("pet");
      if (tierIndex(this.tier) >= 2) this.hooks.hearts(2);
    }
    return false;
  }

  /** She was fed a cookie. */
  fed(now: number) {
    this.cookies++;
    const delta = this.event("feed");
    this.speak(delta < 2 ? "feedMany" : "feed");
    this.hooks.hearts(delta < 2 ? 2 : 5);
    this.hooks.pose("jump");
    this.lastPetLine = now;
    this.flush(now, true);
  }

  /** A remark the user made (chat or voice), for affection and an optional reaction. */
  remark(kind: "kind" | "rude" | "plain", spoken: boolean, react: boolean) {
    this.event(kind === "plain" ? (spoken ? "voice" : "chat") : kind);
    if (react && kind !== "plain") {
      this.speak(kind);
      if (kind === "kind") this.hooks.hearts(3);
    }
  }

  victory() {
    this.event("victory");
    this.speak("victory");
    this.hooks.pose("jump");
  }

  /** Call every frame (cheap); polls the idle timer every few seconds. */
  tick(now: number) {
    if (now - this.lastPoll >= POLL) {
      this.lastPoll = now;
      this.hooks
        .idleSeconds()
        .then((s) => (this.idle = Number.isFinite(s) ? s : 0))
        .catch(() => {});
      const dt = this.lastTick === null ? 0 : Math.min(60, now - this.lastTick);
      this.lastTick = now;
      const before = this.meter.value;
      const away = this.idle >= AWAY_AFTER;
      this.meter = { ...this.meter, value: decay(this.meter.value, this.cfg.decay, away ? 0 : dt, away ? dt : 0) };
      if (this.meter.value !== before) this.dirty = true;
      this.chatterStep(now);
      this.flush(now, false);
    }
  }

  private chatterStep(now: number) {
    const hour = new Date().getHours();
    const r = stepChatter(this.chatter, now, this.idle, hour, this.hooks.busy(), this.cfg, this.rnd);
    this.chatter = r.state;
    switch (r.say) {
      case "spontaneous": {
        const situation = spontaneousSituation(this.tier, this.rnd);
        if (!this.speak(situation)) this.speak("spontaneous");
        const i = tierIndex(this.tier);
        // Warmer tiers come with warmer gestures.
        if (i >= 3 && this.rnd() < 0.5) {
          this.hooks.pose("wave");
          this.hooks.hearts(2);
        } else if (i >= 1 && this.rnd() < 0.3) this.hooks.pose("wave");
        break;
      }
      case "awayAsk":
        this.speak("awayAsk");
        this.hooks.pose(this.rnd() < 0.5 ? "jump" : "wave");
        break;
      case "welcomeBack":
        this.event("return");
        this.speak("welcomeBack");
        this.hooks.pose("wave");
        if (tierIndex(this.tier) >= 2) this.hooks.hearts(3);
        break;
    }
  }

  /** Save now and then, or right away after something important. */
  flush(now: number, force: boolean) {
    if (!this.dirty || (!force && now - this.lastSave < SAVE_EVERY)) return;
    this.lastSave = now;
    this.dirty = false;
    this.savedValue = Math.round(this.meter.value * 100) / 100;
    this.hooks.save({ value: this.savedValue, updated: Date.now(), cookies: this.cookies });
  }
}

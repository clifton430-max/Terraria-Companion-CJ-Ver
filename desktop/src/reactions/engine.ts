// Pure reaction logic for app switches: rule matching by bundle id, per-app cooldowns, a global
// minimum gap, debouncing of rapid switches, chance, quiet modes and comment choice. The overlay
// feeds it switch events and turns its decisions into a speech bubble, voice line and pose.

import type { AppSwitch, ReactionAnimation, ReactionRule, VoiceClip } from "../bridge";

/** An app must stay in front this long before it gets a reaction (rapid switching is ignored). */
export const DWELL = 1.5;
/** Minimum seconds between any two reactions, whatever the app. */
export const GLOBAL_GAP = 90;
const VOICE_CHOICES: VoiceClip[] = ["hit0", "hit1", "hit2"];

export interface ReactionSettings {
  enabled: boolean;
  quiet: boolean;
  quietText: boolean;
  excluded: readonly string[];
}

export interface Reaction {
  bundleId: string;
  name: string;
  /** Speech-bubble text (null when quiet mode hides text or the rule has no comments). */
  text: string | null;
  voice: VoiceClip | null;
  animation: ReactionAnimation | null;
  ruleId: string;
}

/** The rule for an app: its own rule if it has one (even disabled, which means "never"), else "*". */
export function matchRule(rules: readonly ReactionRule[], bundleId: string): ReactionRule | null {
  const own = rules.find((r) => r.bundleId === bundleId);
  if (own) return own.enabled ? own : null;
  return rules.find((r) => r.bundleId === "*" && r.enabled) ?? null;
}

export class ReactionEngine {
  private pending: { ev: AppSwitch; at: number } | null = null;
  private lastByApp = new Map<string, number>();
  private lastAny = -Infinity;
  private lastComment = new Map<string, string>();

  constructor(private readonly rng: () => number) {}

  /** A switch happened; it's only acted on after DWELL seconds without another switch. */
  onSwitch(ev: AppSwitch, now: number) {
    this.pending = { ev, at: now };
  }

  /** Forget a pending switch (e.g. awareness turned off). */
  cancel() {
    this.pending = null;
  }

  tick(now: number, rules: readonly ReactionRule[], settings: ReactionSettings): Reaction | null {
    const p = this.pending;
    if (!p || now - p.at < DWELL) return null;
    this.pending = null;
    if (!settings.enabled || settings.excluded.includes(p.ev.bundleId)) return null;
    const rule = matchRule(rules, p.ev.bundleId);
    if (!rule) return null;
    if (p.ev.sameApp && !rule.windowSwitches) return null;
    if (now - this.lastAny < GLOBAL_GAP) return null;
    const last = this.lastByApp.get(p.ev.bundleId);
    if (last !== undefined && now - last < rule.cooldown) return null;
    if (this.rng() >= rule.chance) {
      // A skipped roll still counts as this app's turn, so it doesn't retry on the next switch.
      this.lastByApp.set(p.ev.bundleId, now);
      return null;
    }
    this.lastByApp.set(p.ev.bundleId, now);
    this.lastAny = now;
    return this.build(rule, p.ev, settings);
  }

  /** The Preview button: ignores cooldowns, chance and the dwell, but respects quiet modes. */
  preview(rule: ReactionRule, settings: ReactionSettings): Reaction {
    return this.build(rule, { bundleId: rule.bundleId, name: rule.name, sameApp: false }, settings);
  }

  private build(rule: ReactionRule, ev: AppSwitch, settings: ReactionSettings): Reaction {
    let pool = rule.comments.filter((c) => c.trim());
    const prev = this.lastComment.get(rule.id);
    if (pool.length > 1 && prev) pool = pool.filter((c) => c !== prev);
    const comment = pool.length ? pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))] : null;
    if (comment) this.lastComment.set(rule.id, comment);
    const silent = settings.quiet || rule.quiet || rule.voice === "none";
    const voice: VoiceClip | null =
      silent || rule.voice === "none"
        ? null
        : rule.voice === "random"
          ? VOICE_CHOICES[Math.floor(this.rng() * VOICE_CHOICES.length) % VOICE_CHOICES.length]
          : rule.voice;
    return {
      bundleId: ev.bundleId,
      name: ev.name,
      text: settings.quietText ? null : comment,
      voice,
      animation: rule.animation === "none" ? null : rule.animation,
      ruleId: rule.id,
    };
  }
}

/** A fresh rule for the settings editor. */
export function newRule(app: { bundleId: string; name: string }, existing: readonly ReactionRule[]): ReactionRule {
  let n = existing.length + 1;
  while (existing.some((r) => r.id === `rule${n}`)) n++;
  return {
    id: `rule${n}`,
    bundleId: app.bundleId,
    name: app.name,
    enabled: true,
    comments: ["You've got this."],
    voice: "none",
    animation: "wave",
    cooldown: 1800,
    chance: 1,
    quiet: false,
    windowSwitches: false,
  };
}

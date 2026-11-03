// The companion roster: who each character is, what they fight with, and how their speech bubble
// looks. CJ Ver: a team of professionals in suits, drawn from Terraria's player sheets with
// suit appearances (see src-tauri/src/terraria_app.rs); no add-on packs are used.

import type { CharacterId, CharacterPrefs } from "../bridge";

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** Short line for the roster UI. */
  tagline: string;
  /** Add-on pack she needs, if any. */
  addon: "princess" | "waifu2" | "goblin" | null;
  /** Weapon she fights with by default. */
  signature: string;
  /** Speech-bubble colours. */
  bubble: { top: string; bottom: string; border: string; text: string; heart: string };
  /** Walk cadence multiplier (stride length). */
  stride: number;
  /** Idle gestures she likes (her personality in motion). */
  gestures: readonly ("wave" | "jump" | "hug" | "sit")[];
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  terrarian: {
    id: "terrarian",
    name: "Morgan",
    tagline: "Executive Assistant. Keeps your day running smoothly. Navy suit.",
    addon: null,
    signature: "terra-blade",
    bubble: { top: "#ffffff", bottom: "#eef2f7", border: "#2f4a72", text: "#1b2a40", heart: "#2f4a72" },
    stride: 1,
    gestures: ["wave", "sit"],
  },
  princess: {
    id: "princess",
    name: "Avery",
    tagline: "Chief of Staff. Organised and decisive. Charcoal suit. Royal Scepter.",
    addon: null,
    signature: "royal-scepter",
    bubble: { top: "#ffffff", bottom: "#f0f0f2", border: "#3d3f45", text: "#202125", heart: "#3d3f45" },
    stride: 0.95,
    gestures: ["wave", "sit"],
  },
  partygirl: {
    id: "partygirl",
    name: "Jordan",
    tagline: "Events & Communications Lead. Upbeat and polished. Burgundy suit. Confetti Cannon.",
    addon: null,
    signature: "confetti-cannon",
    bubble: { top: "#ffffff", bottom: "#f6eef0", border: "#7a2638", text: "#3a1019", heart: "#7a2638" },
    stride: 1.05,
    gestures: ["wave", "jump"],
  },
  nurse: {
    id: "nurse",
    name: "Riley",
    tagline: "Health & Wellness Advisor. Calm and practical. Grey suit. Syringe Toss.",
    addon: null,
    signature: "syringe-toss",
    bubble: { top: "#ffffff", bottom: "#eef4f3", border: "#2f6f68", text: "#123430", heart: "#2f6f68" },
    stride: 0.9,
    gestures: ["wave", "sit"],
  },
  zoologist: {
    id: "zoologist",
    name: "Quinn",
    tagline: "Research Analyst. Precise and curious. Brown suit. Fox Claws.",
    addon: null,
    signature: "fox-claws",
    bubble: { top: "#ffffff", bottom: "#f5f0ea", border: "#6b4a2b", text: "#2e1f10", heart: "#6b4a2b" },
    stride: 1,
    gestures: ["sit", "wave"],
  },
  goblin: {
    id: "goblin",
    name: "Casey",
    tagline: "Engineering Lead. Direct and technical. Olive suit. Spiky balls.",
    addon: null,
    signature: "spiky-balls",
    bubble: { top: "#ffffff", bottom: "#eff3ec", border: "#3f5a35", text: "#1a2716", heart: "#3f5a35" },
    stride: 0.95,
    gestures: ["wave", "jump"],
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

/** The name you gave her, if any (shown in settings and the Terraria HUD). */
export function customName(id: CharacterId, chars: Pick<CharacterPrefs, "per"> | null | undefined): string {
  return chars?.per?.find((p) => p.id === id)?.name?.trim() ?? "";
}

/** Her custom name, or her built-in one. */
export function displayName(id: CharacterId, chars: Pick<CharacterPrefs, "per"> | null | undefined): string {
  return customName(id, chars) || CHARACTERS[id].name;
}

/** Apply a character's bubble colours to a speech-bubble element. (CJ Ver: fixed, neutral colours.) */
export function styleBubble(el: HTMLElement, id: CharacterId, _pink = 0.5) {
  const b = CHARACTERS[id].bubble;
  el.style.setProperty("--bubble-top", b.top);
  el.style.setProperty("--bubble-bottom", b.bottom);
  el.style.setProperty("--bubble-border", b.border);
  el.style.setProperty("--bubble-text", b.text);
  el.style.setProperty("--bubble-heart", b.heart);
}

// Pure skin-selection rules shared by the overlay and the settings UI.

import type { Appearance, SkinId, SkinInfo } from "../bridge";

export const SKIN_IDS: readonly SkinId[] = ["default", "waifu2b"];

/** A valid skin id (unknown/stale values → "default"). */
export function normalizeSkin(id: unknown): SkinId {
  return SKIN_IDS.includes(id as SkinId) ? (id as SkinId) : "default";
}

/** The skin that will actually be drawn: the selection if available, else the default. */
export function effectiveSkin(selected: SkinId, skins: readonly SkinInfo[]): SkinId {
  const s = normalizeSkin(selected);
  return skins.find((k) => k.id === s)?.available ? s : "default";
}

/** Atlas identity: changes whenever the drawn character would change. */
export function rigKey(appearance: Appearance, skin: SkinId): string {
  return JSON.stringify([appearance, normalizeSkin(skin)]);
}

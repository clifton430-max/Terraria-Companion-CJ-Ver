// Item icons and Terraria UI textures shared by the inventory window and the dock.
// Textures come from the existing `tasset://` loader (decoded and cached by Rust).

import type { CSSProperties } from "react";
import { textureUrl } from "../assets/textures";
import { paintWeapon } from "../combat/render";
import type { WeaponDef } from "../combat/weapons";

const iconCache = new Map<string, string>();

/** Original pixel-art icon (also the fallback when a Terraria texture can't be loaded). */
export function paintedIcon(def: WeaponDef): string {
  let url = iconCache.get(def.id);
  if (!url) {
    url = paintWeapon(def).toDataURL();
    iconCache.set(def.id, url);
  }
  return url;
}

/** Real item art from the local install for Terraria weapons, else the painted icon. */
export function iconUrl(def: WeaponDef): string {
  return def.art ? textureUrl(def.art.texture) : paintedIcon(def);
}

/** <img onError> handler: swap a missing texture for the painted icon (once). */
export function fallbackToPainted(def: WeaponDef) {
  return (e: { currentTarget: HTMLImageElement }) => {
    const img = e.currentTarget;
    if (!img.src.startsWith("data:")) img.src = paintedIcon(def);
  };
}

/** Terraria UI textures used as CSS backgrounds (stylesheets keep plain-colour fallbacks). */
export const UI_VARS = {
  "--slot-back": `url("${textureUrl("Images/Inventory_Back")}")`,
  "--slot-selected": `url("${textureUrl("Images/Inventory_Back14")}")`,
  "--panel-border": `url("${textureUrl("Images/UI/PanelBorder")}")`,
} as CSSProperties;

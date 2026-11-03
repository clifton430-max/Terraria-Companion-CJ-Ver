// Lazily loads decoded textures from the user's local Terraria install via `tasset://`.
// Callers draw synchronously with `getTexture`, which returns undefined until loaded (or when the
// art is unavailable), so every renderer keeps a fallback.

import { assetUrl } from "../bridge";

const loaded = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap | null>>();
const failed = new Set<string>();

/** Start loading `name` (e.g. "Images/NPC_4"); resolves to null if unavailable. */
export function loadTexture(name: string): Promise<ImageBitmap | null> {
  const ready = loaded.get(name);
  if (ready) return Promise.resolve(ready);
  if (failed.has(name)) return Promise.resolve(null);
  let p = pending.get(name);
  if (!p) {
    p = (async () => {
      try {
        // "addon/<pack>/Images/..." names come straight from an installed add-on pack.
        const res = await fetch(assetUrl(name.startsWith("addon/") ? `/${name}.png` : `/texture/${name}.png`));
        if (!res.ok) throw new Error(String(res.status));
        const bmp = await createImageBitmap(await res.blob());
        loaded.set(name, bmp);
        return bmp;
      } catch {
        failed.add(name);
        return null;
      } finally {
        pending.delete(name);
      }
    })();
    pending.set(name, p);
  }
  return p;
}

/** The texture if already loaded; otherwise kicks off loading and returns undefined. */
export function getTexture(name: string | undefined): ImageBitmap | undefined {
  if (!name) return undefined;
  const t = loaded.get(name);
  if (!t && !failed.has(name) && !pending.has(name)) void loadTexture(name);
  return t;
}

/** URL form for <img> elements (inventory icons, CSS). */
export const textureUrl = (name: string) => assetUrl(name.startsWith("addon/") ? `/${name}.png` : `/texture/${name}.png`);

// Control-scheme switch (Terraria / Silksong) and each scheme's keybind table.

import { useEffect, useState } from "react";
import { patchPrefs, type Prefs } from "../bridge";
import { SILK_ACTIONS, SILK_ACTION_LABEL, bindable, keyLabel, normalizeKeys, rebind, type SilkAction } from "../silk/keys";
import { TERRARIA_ACTIONS, TERRARIA_ACTION_LABEL, normalizeTerrariaKeys, rebindTerraria, type TerrariaKeys } from "../overlay/controls";

const save = (patch: Parameters<typeof patchPrefs>[0]) => patchPrefs(patch).catch(() => {});

export default function SilkControlsPanel({ prefs }: { prefs: Prefs }) {
  const c = prefs.control;
  const scheme = c.scheme === "silksong" ? "silksong" : "terraria";
  const keys = normalizeKeys(c.silkKeys);
  const tkeys = normalizeTerrariaKeys(c.terrariaKeys);
  const [capturing, setCapturing] = useState<SilkAction | null>(null);
  const [capturingT, setCapturingT] = useState<keyof TerrariaKeys | null>(null);

  useEffect(() => {
    if (!capturing && !capturingT) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        setCapturingT(null);
        return;
      }
      if (!bindable(e.code) || e.code.startsWith("Arrow")) return; // wait for a usable key (arrows always move anyway)
      if (capturing) save({ control: { ...c, silkKeys: rebind(keys, capturing, e.code) } });
      if (capturingT) save({ control: { ...c, terrariaKeys: rebindTerraria(tkeys, capturingT, e.code) } });
      setCapturing(null);
      setCapturingT(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, capturingT, c, keys, tkeys]);

  return (
    <>
      <div className="choice-row" role="radiogroup" aria-label="Control scheme">
        <span className="label">Controls</span>
        <button className={`action small ${scheme === "terraria" ? "on" : ""}`} role="radio" aria-checked={scheme === "terraria"} onClick={() => save({ control: { ...c, scheme: "terraria" } })}>
          Terraria Controls
        </button>
        <button className={`action small ${scheme === "silksong" ? "on" : ""}`} role="radio" aria-checked={scheme === "silksong"} onClick={() => save({ control: { ...c, scheme: "silksong" } })}>
          Silksong Controls
        </button>
      </div>
      <p className="muted">Active: {scheme === "silksong" ? "Silksong Controls (Needle, dash, wall jump, glide, Clawline)" : "Terraria Controls (your items, Space to fly)"}</p>
      {scheme === "terraria" && (
        <div className="keybinds">
          {TERRARIA_ACTIONS.map((a) => (
            <div key={a} className="keybind">
              <span>{TERRARIA_ACTION_LABEL[a]}</span>
              <button className={`action small ${capturingT === a ? "on" : ""}`} onClick={() => setCapturingT(capturingT === a ? null : a)} title="Click, then press a key (Esc cancels)">
                {capturingT === a ? "Press a key…" : keyLabel(tkeys[a])}
              </button>
            </div>
          ))}
          <p className="muted">Arrow keys also move. Click (or hold) to use your item toward the cursor; the mouse wheel or 1–0 switch items.</p>
          <button className="action small" onClick={() => save({ control: { ...c, terrariaKeys: normalizeTerrariaKeys(null) } })}>
            Reset keys
          </button>
        </div>
      )}
      {scheme === "silksong" && (
        <div className="keybinds">
          {SILK_ACTIONS.map((a) => (
            <div key={a} className="keybind">
              <span>{SILK_ACTION_LABEL[a]}</span>
              <button className={`action small ${capturing === a ? "on" : ""}`} onClick={() => setCapturing(capturing === a ? null : a)} title="Click, then press a key (Esc cancels)">
                {capturing === a ? "Press a key…" : keyLabel(keys[a])}
              </button>
            </div>
          ))}
          <p className="muted">
            Arrow keys also move. Left click uses the Needle too, and hold it to charge. Hold Up or Down while striking to aim; Down in the air
            bounces (pogo). Aim the Clawline with the mouse. Fill silk by landing hits; the Thread spin costs {3}.
          </p>
          <button className="action small" onClick={() => save({ control: { ...c, silkKeys: normalizeKeys(null) } })}>
            Reset keys
          </button>
        </div>
      )}
    </>
  );
}

// Build mode settings: the toggle shortcut, which block a click places, and clearing placed blocks.
// Blocks live only in the companion's overlay (nothing on the real desktop is changed).

import { useEffect, useState } from "react";
import { buildShortcutStatus, patchPrefs, setBuildMode, type BuildPrefs, type Prefs } from "../bridge";
import { textureUrl } from "../assets/textures";
import { BLOCK_ART, BLOCK_KINDS, MAX_BLOCKS } from "../engine/blocks";
import ShortcutField from "./ShortcutField";
import { appShortcuts } from "../voice/shortcut";

const save = (build: BuildPrefs) => patchPrefs({ build }).catch(() => {});

export default function BuildPanel({ prefs }: { prefs: Prefs }) {
  const build = prefs.build;
  const [status, setStatus] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => buildShortcutStatus().then(setStatus).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [build.toggleEnabled, build.toggleShortcut, prefs.control.toggleShortcut, prefs.voiceInput.enabled, prefs.voiceInput.shortcut]);
  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  return (
    <section className="tpanel">
      <h2>Build mode</h2>
      <div className="choice-row" role="radiogroup" aria-label="Block to place">
        {BLOCK_KINDS.map((k) => (
          <button key={k} className={`action small ${build.kind === k ? "on" : ""}`} role="radio" aria-checked={build.kind === k} onClick={() => save({ ...build, kind: k })}>
            <img className="block-icon" src={textureUrl(BLOCK_ART[k].item)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
            {BLOCK_ART[k].name}
          </button>
        ))}
      </div>
      <div className="choice-row">
        <button className="action" onClick={() => setBuildMode(true).catch(() => {})}>
          Start building
        </button>
        <button
          className={`action ${confirmClear ? "boss" : ""}`}
          disabled={build.blocks.length === 0}
          onClick={() => {
            if (!confirmClear) return setConfirmClear(true);
            setConfirmClear(false);
            save({ ...build, blocks: [] });
          }}
        >
          {confirmClear ? "Click again to remove all" : "Clear all blocks"}
        </button>
        <span className="muted">
          {build.blocks.length}/{MAX_BLOCKS} placed
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={build.toggleEnabled} onChange={(e) => save({ ...build, toggleEnabled: e.target.checked })} />
        Toggle Build mode with a shortcut
      </label>
      <div className="choice-row">
        <span className="label">Shortcut</span>
        <ShortcutField value={build.toggleShortcut} others={appShortcuts(prefs, "Build mode")} defaultValue="Control+Shift+B" onChange={(s) => save({ ...build, toggleShortcut: s })} />
      </div>
      {build.toggleEnabled && status && <p className={`muted ${status.startsWith("Shortcut active") ? "" : "warn"}`}>{status}</p>}
      <p className="muted">
        In Build mode, click to place the selected block, right-click (or ⇧-click) to remove, drag to paint; 1/2/3 switch blocks. Blocks are
        solid: the character stands, walks, jumps, wall-clings and pogos on them, and falls if you remove the one it's on. They're drawn by
        the companion only; your desktop isn't changed. Esc, the shortcut again, or switching apps exits.
      </p>
    </section>
  );
}

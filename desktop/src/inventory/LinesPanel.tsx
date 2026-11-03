// Invisible platforms: the edit-mode shortcut, an optional faint outline outside edit mode, and
// clearing them. Lines are walkable one-way surfaces drawn by the companion only.

import { useEffect, useState } from "react";
import { linesShortcutStatus, patchPrefs, setLinesMode, type LinePrefs, type Prefs } from "../bridge";
import { MAX_LINES } from "../engine/lines";
import ShortcutField from "./ShortcutField";
import { appShortcuts } from "../voice/shortcut";

const save = (lines: LinePrefs) => patchPrefs({ lines }).catch(() => {});

export default function LinesPanel({ prefs }: { prefs: Prefs }) {
  const l = prefs.lines;
  const [status, setStatus] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => linesShortcutStatus().then(setStatus).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [l.toggleEnabled, l.toggleShortcut, prefs.build.toggleShortcut, prefs.control.toggleShortcut, prefs.voiceInput.enabled, prefs.voiceInput.shortcut]);
  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);
  return (
    <section className="tpanel">
      <h2>Invisible platforms</h2>
      <div className="choice-row">
        <button className="action" onClick={() => setLinesMode(true).catch(() => {})}>
          Edit platforms
        </button>
        <button
          className={`action ${confirmClear ? "boss" : ""}`}
          disabled={l.items.length === 0}
          onClick={() => {
            if (!confirmClear) return setConfirmClear(true);
            setConfirmClear(false);
            save({ ...l, items: [] });
          }}
        >
          {confirmClear ? "Click again to remove all" : "Clear all"}
        </button>
        <span className="muted">
          {l.items.length}/{MAX_LINES}
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={l.show} onChange={(e) => save({ ...l, show: e.target.checked })} />
        Show a faint outline outside edit mode
      </label>
      <label className="check">
        <input type="checkbox" checked={l.toggleEnabled} onChange={(e) => save({ ...l, toggleEnabled: e.target.checked })} />
        Toggle edit mode with a shortcut
      </label>
      <div className="choice-row">
        <span className="label">Shortcut</span>
        <ShortcutField value={l.toggleShortcut} others={appShortcuts(prefs, "Platform editing")} defaultValue="Control+Shift+P" onChange={(s) => save({ ...l, toggleShortcut: s })} />
      </div>
      {l.toggleEnabled && status && <p className={`muted ${status.startsWith("Shortcut active") ? "" : "warn"}`}>{status}</p>}
      <p className="muted">
        In edit mode, drag on empty space to draw a flat or sloped line (nearly flat snaps flat; hold ⇧ for 15° steps). Drag a line to
        move it, drag an end to resize or tilt it, right-click or press Delete to remove it, and use the arrow keys to nudge. Lines are
        invisible otherwise. The character lands, walks, and jumps on them like window tops: they're one-way, so it can jump up
        through them, and drop down with S (Silksong: Down + Jump). A roaming character drops off a line after 20 s, so it can't get
        stuck. Lines stay where you put them across restarts.
      </p>
    </section>
  );
}

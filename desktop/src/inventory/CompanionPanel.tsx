// Companion settings: mode & pose, cursor modes, the Eye of Cthulhu fight and the letter effect.
// Everything persists through patch_prefs (validated in Rust) and takes effect immediately.

import { useEffect, useState } from "react";
import { combatCommand, controlShortcutStatus, patchPrefs, type BossDifficulty, type CursorMode, type DockLaunch, type Prefs } from "../bridge";
import { normalizeDock } from "../dock/model";
import IdlePanel from "./IdlePanel";
import ShortcutField from "./ShortcutField";
import { appShortcuts } from "../voice/shortcut";
import SilkControlsPanel from "./SilkControlsPanel";
import BuildPanel from "./BuildPanel";
import LinesPanel from "./LinesPanel";
import PersonaPanel from "./PersonaPanel";
import CharactersPanel from "./CharactersPanel";
import DestroyerPanel from "./DestroyerPanel";

const CURSOR_MODES: [CursorMode, string, string][] = [
  ["off", "Off", "Normal behaviour."],
  ["ride", "Ride Cursor", "Sits on the pointer and rides along."],
  ["hug", "Hold Cursor", "Holds the pointer from the side."],
  ["become", "Become Cursor", "A tiny companion points where the pointer is (cosmetic)."],
];
const DIFFICULTIES: [BossDifficulty, string][] = [
  ["easy", "Easy"],
  ["normal", "Normal"],
  ["expert", "Expert"],
  ["master", "Master"],
];

const DOCK_LAUNCH: [DockLaunch, string][] = [
  ["remember", "Remember"],
  ["show", "Always"],
  ["hide", "Never"],
];

const save = (patch: Parameters<typeof patchPrefs>[0]) => patchPrefs(patch).catch(() => {});

/** The panel's blocks; the pause menu shows them under different sections. */
export type CompanionPart = "sound" | "pickaxe" | "control" | "characters" | "persona" | "build" | "lines" | "dock" | "idle" | "destroyer" | "cursor" | "bosses" | "letters";

export default function CompanionPanel({ prefs, parts }: { prefs: Prefs; parts?: CompanionPart[] }) {
  const show = (part: CompanionPart) => !parts || parts.includes(part);
  const [word, setWord] = useState(prefs.effects.word);
  useEffect(() => setWord(prefs.effects.word), [prefs.effects.word]);

  const dock = normalizeDock(prefs.dock);
  const [controlStatus, setControlStatus] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => controlShortcutStatus().then(setControlStatus).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [prefs.control.toggleEnabled, prefs.control.toggleShortcut, prefs.voiceInput.enabled, prefs.voiceInput.shortcut]);
  const audio = prefs.audio;
  const pick = prefs.pickaxe;
  return (
    <div className="companion-panel">
      {show("sound") && (
      <section className="tpanel">
        <h2>Sound</h2>
        <div className="choice-row">
          <button className={`action ${audio.muted ? "on" : ""}`} aria-pressed={audio.muted} onClick={() => save({ audio: { ...audio, muted: !audio.muted } })}>
            {audio.muted ? "Muted" : "Mute all"}
          </button>
        </div>
        <label className="slider">
          Master
          <input type="range" min={0} max={1} step={0.05} value={audio.master ?? 1} onChange={(e) => save({ audio: { ...audio, master: Number(e.target.value) } })} />
          <span>{Math.round((audio.master ?? 1) * 100)}%</span>
        </label>
        <label className="slider">
          Effects
          <input type="range" min={0} max={1} step={0.05} value={audio.sfxVolume} onChange={(e) => save({ audio: { ...audio, sfxVolume: Number(e.target.value) } })} />
          <span>{Math.round(audio.sfxVolume * 100)}%</span>
        </label>
        <p className="muted">The team never uses voices or vocal sounds in this version. Effects use Terraria's own sounds (tool swings, pickaxe hits, eating).</p>
      </section>
      )}

      {show("pickaxe") && (
      <section className="tpanel">
        <h2>Pickaxe</h2>
        <label className="check">
          <input type="checkbox" checked={pick.effects} onChange={(e) => save({ pickaxe: { ...pick, effects: e.target.checked } })} />
          Smash letters on webpages (with the Letter Destroyer bookmarklet)
        </label>
        <label className="slider">
          Swing
          <input type="range" min={0.15} max={2} step={0.05} value={pick.cooldown} onChange={(e) => save({ pickaxe: { ...pick, cooldown: Number(e.target.value) } })} />
          <span>{pick.cooldown.toFixed(2)} s</span>
        </label>
        <div className="choice-row">
          <button className="action" onClick={() => combatCommand("stopEffects").catch(() => {})}>
            Stop effects
          </button>
        </div>
        <p className="muted">
          Equip the Copper Pickaxe, turn on the Letter Destroyer bookmarklet in your browser, then swing with the pointer over some text near
          the companion (Control mode: click there). The page knocks those letters off itself; a refresh or Esc puts them back. Without the
          bookmarklet running, the swing just shows its impact burst.
        </p>
      </section>
      )}

      {show("control") && (
      <section className="tpanel">
        <h2>Control mode</h2>
        <SilkControlsPanel prefs={prefs} />
        <label className="slider">
          Flight
          <input
            type="range"
            min={120}
            max={640}
            step={20}
            value={prefs.control.flightSpeed}
            onChange={(e) => save({ control: { ...prefs.control, flightSpeed: Number(e.target.value) } })}
          />
          <span>{prefs.control.flightSpeed}px/s</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.control.toggleEnabled} onChange={(e) => save({ control: { ...prefs.control, toggleEnabled: e.target.checked } })} />
          Toggle Control mode with a shortcut
        </label>
        <div className="choice-row">
          <span className="label">Shortcut</span>
          <ShortcutField value={prefs.control.toggleShortcut} others={appShortcuts(prefs, "Control mode")} defaultValue="Control+Shift+C" onChange={(s) => save({ control: { ...prefs.control, toggleShortcut: s } })} />
        </div>
        {prefs.control.toggleEnabled && controlStatus && (
          <p className={`muted ${controlStatus.startsWith("Shortcut active") ? "" : "warn"}`}>{controlStatus}</p>
        )}
        <p className="muted">
          Press the shortcut (works from any app) or use Tray → Control Character. Hold Space to fly, A/D to steer, drag the character to carry
          it. Esc, the shortcut again, or switching apps exits.
        </p>
      </section>
      )}

      {show("characters") && <CharactersPanel prefs={prefs} />}

      {show("persona") && <PersonaPanel prefs={prefs} />}

      {show("build") && <BuildPanel prefs={prefs} />}

      {show("lines") && <LinesPanel prefs={prefs} />}


      {show("dock") && (
      <section className="tpanel">
        <h2>Dock</h2>
        <div className="choice-row">
          <button className={`action ${dock.visible ? "on" : ""}`} aria-pressed={dock.visible} onClick={() => save({ dock: { visible: !dock.visible } })}>
            {dock.visible ? "Hide dock" : "Show dock"}
          </button>
          <button className={`action ${dock.expanded ? "on" : ""}`} aria-pressed={dock.expanded} onClick={() => save({ dock: { expanded: !dock.expanded } })}>
            {dock.expanded ? "Expanded" : "Collapsed"}
          </button>
          <button className="action" onClick={() => save({ dock: { resetPosition: true } })}>
            Reset position
          </button>
        </div>
        <div className="choice-row" role="radiogroup" aria-label="Dock layout">
          <span className="label">Layout</span>
          {(["full", "compact"] as const).map((l) => (
            <button key={l} className={`action small ${dock.layout === l ? "on" : ""}`} role="radio" aria-checked={dock.layout === l} onClick={() => save({ dock: { layout: l } })}>
              {l === "full" ? "Full" : "Compact"}
            </button>
          ))}
        </div>
        <div className="choice-row" role="radiogroup" aria-label="Show dock on launch">
          <span className="label">On launch</span>
          {DOCK_LAUNCH.map(([id, label]) => (
            <button key={id} className={`action small ${dock.onLaunch === id ? "on" : ""}`} role="radio" aria-checked={dock.onLaunch === id} onClick={() => save({ dock: { onLaunch: id } })}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted">Drag the dotted grip to move it; the spot is remembered.</p>
      </section>
      )}

      {show("idle") && <IdlePanel prefs={prefs} />}
      {show("destroyer") && <DestroyerPanel prefs={prefs} />}

      {show("cursor") && (
      <section className="tpanel">
        <h2>Cursor</h2>
        <div className="choice-grid" role="radiogroup" aria-label="Cursor mode">
          {CURSOR_MODES.map(([id, label, hint]) => (
            <button key={id} className={`action ${prefs.cursorMode === id ? "on" : ""}`} role="radio" aria-checked={prefs.cursorMode === id} title={hint} onClick={() => save({ cursorMode: id })}>
              {label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={prefs.hideSystemCursor} onChange={(e) => save({ hideSystemCursor: e.target.checked })} />
          Hide the real pointer in Become Cursor
        </label>
        <p className="muted">
          Clicks always go to the apps underneath. The pointer reappears over the menu bar, in Control mode, and when you
          switch modes or quit. Turn off from the tray: Cursor → Off.
        </p>
      </section>
      )}

      {show("bosses") && (
      <section className="tpanel">
        <h2>Bosses</h2>
        <div className="choice-row" role="radiogroup" aria-label="Boss difficulty">
          {DIFFICULTIES.map(([id, label]) => (
            <button key={id} className={`action small ${prefs.bossDifficulty === id ? "on" : ""}`} role="radio" aria-checked={prefs.bossDifficulty === id} onClick={() => save({ bossDifficulty: id })}>
              {label}
            </button>
          ))}
        </div>
        <div className="choice-row">
          <button className="action boss" onClick={() => combatCommand("summonBoss").catch(() => {})}>
            Eye of Cthulhu
          </button>
          <button className="action boss" onClick={() => combatCommand("summonQueenBee").catch(() => {})}>
            Queen Bee
          </button>
          <button className="action boss" onClick={() => combatCommand("summonMoonLord").catch(() => {})}>
            Moon Lord
          </button>
          <button className="action" onClick={() => combatCommand("retryBoss").catch(() => {})}>
            Retry
          </button>
          <button className="action" onClick={() => combatCommand("dismissBoss").catch(() => {})}>
            Dismiss
          </button>
        </div>
        <p className="muted">
          Difficulty applies the next time a boss is summoned; one boss fights at a time. The Moon Lord rises from below: destroy its head
          and palm eyes, then its exposed core. Watch for the red warning line before its Deathray. Equip a weapon on the Inventory tab
          (Silksong Controls work too).
        </p>
      </section>
      )}

      {show("letters") && (
      <section className="tpanel">
        <h2>Letter smash</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.effects.letterBreak}
            onChange={(e) => save({ effects: { ...prefs.effects, letterBreak: e.target.checked } })}
          />
          Enable the letter effect
        </label>
        <div className="choice-row">
          <input
            className="word"
            aria-label="Word to smash"
            value={word}
            maxLength={16}
            onChange={(e) => setWord(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""))}
            onBlur={() => save({ effects: { ...prefs.effects, word } })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <button className="action" disabled={!prefs.effects.letterBreak} onClick={() => combatCommand("letterSmash").catch(() => {})}>
            Smash
          </button>
          <button className="action" onClick={() => combatCommand("stopEffects").catch(() => {})}>
            Stop
          </button>
        </div>
        <p className="muted">
          The companion draws its own word on its overlay and breaks it. It never reads or changes text in other apps.
          Once every 6 seconds at most.
        </p>
      </section>
      )}
    </div>
  );
}

// Settings for the Terraria world under your desktop icons: play it (as your waifu, or let the
// waifus play), show it, pick a seed, make a new world, zoom, explore (the bare desktop's clicks and
// keys go to the world until Esc), the pan chord, editing, and whether the companions walk on the
// terrain. Games keep running behind other apps' windows.

import { useEffect, useState } from "react";
import { accessibilityStatus, openAccessibilitySettings, patchPrefs, startGame, worldNav, worldSave, type GameMode, type Prefs, type WorldPrefs } from "../bridge";
import { CHARACTERS, CHARACTER_IDS } from "../characters/roster";
import { randomSeed, seedFrom } from "../world/gen";
import { ZOOMS, nearestZoom } from "../world/view";

const DEFAULT_WORLD: WorldPrefs = { enabled: false, seed: 0, zoom: 2, cameraX: -1, cameraY: -1, edit: false, collide: true, play: true };
const MODIFIERS = [
  { id: "Control", sym: "⌃" },
  { id: "Option", sym: "⌥" },
  { id: "Shift", sym: "⇧" },
  { id: "Command", sym: "⌘" },
] as const;
const DEFAULT_CHORD = ["Option", "Command"];

/** Is Accessibility granted? Checked now and every couple of seconds (it changes in System Settings). */
function useAccessibility(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => void accessibilityStatus().then((v) => live && setOk(v), () => live && setOk(null));
    check();
    const t = window.setInterval(check, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return ok;
}

export default function WorldPanel({ prefs }: { prefs: Prefs }) {
  const w = prefs.world ?? DEFAULT_WORLD;
  const [seedText, setSeedText] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const set = (patch: Partial<WorldPrefs>) => patchPrefs({ world: { ...w, ...patch } }).catch(() => {});
  /** A different seed is a different world: its edits and camera start fresh. */
  const newWorld = (seed: number) => {
    void worldSave(JSON.stringify({ version: 1, seed, edits: [] })).catch(() => {});
    set({ seed, cameraX: -1, cameraY: -1, enabled: true });
    setConfirmNew(false);
  };
  const zoom = nearestZoom(w.zoom);
  const access = useAccessibility();
  const [refused, setRefused] = useState(false);
  const start = (mode: GameMode) => void startGame(mode).then((r) => setRefused(r.needsAccessibility), () => {});
  const explore = () => void worldNav(true).then((ok) => setRefused(!ok), () => {});
  const chord = w.panChord?.length ? w.panChord : DEFAULT_CHORD;
  const toggleMod = (id: string) => {
    const next = chord.includes(id) ? chord.filter((m) => m !== id) : [...chord, id];
    if (next.length) set({ panChord: MODIFIERS.map((m) => m.id).filter((m) => next.includes(m)) });
  };
  const chordText = MODIFIERS.filter((m) => chord.includes(m.id)).map((m) => m.sym).join("");
  const selected = prefs.characters?.selected ?? "terrarian";
  const builders = (prefs.characters?.active ?? []).slice(0, 4);
  const playerChoice = w.player && w.player !== "selected" && (CHARACTER_IDS as string[]).includes(w.player) ? w.player : "selected";
  return (
    <section className="tpanel">
      <h2>Terraria world</h2>
      <div className="world-play-box">
        <label className="slider">
          Who plays
          <select value={playerChoice} onChange={(e) => set({ player: e.target.value })} aria-label="Who plays Terraria">
            <option value="selected">My selected companion ({CHARACTERS[selected]?.name ?? selected})</option>
            {CHARACTER_IDS.map((id) => (
              <option key={id} value={id}>
                {CHARACTERS[id].name}
              </option>
            ))}
          </select>
        </label>
        <div className="choice-row">
          <button className="action" onClick={() => start("player")}>
            ▶ Play Terraria
          </button>
          <button className="action" onClick={() => start("auto")}>
            Let my waifus play
          </button>
        </div>
        <p className="muted small">
          Play Terraria: your selected team member steps out of the desktop into the world and you control them. Let the team play:{" "}
          {builders.length ? builders.map((id) => CHARACTERS[id]?.name ?? id).join(", ") : CHARACTERS[selected]?.name} play through
          Terraria on their own while you watch: they build a home and a town, invite NPCs, gather, craft better gear, explore every biome,
          fight the bosses in order, and build a big themed luxury house in each biome. Their progress and buildings are saved, so the
          adventure carries on next time (speed it up to 16× in the game panel). The world keeps running behind your other windows, and
          switching apps only lets go of your keys.
        </p>
        {(access === false || refused) && (
          <div className="choice-row world-blocked" role="alert">
            <span>
              The world sits under your desktop icons, so exploring and playing need Accessibility permission to take the bare desktop's
              clicks and keys (icons, widgets and windows keep theirs).
            </span>
            <button className="action small" onClick={() => void openAccessibilitySettings().catch(() => {})}>
              Open Accessibility settings
            </button>
          </div>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={w.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Show a Terraria world behind my windows
      </label>
      <div className="choice-row">
        <button className="action small" disabled={!w.enabled} onClick={explore}>
          Explore…
        </button>
        <span className="muted">Drag or scroll the bare desktop to look around; Esc or Done when finished. Icons, widgets and windows keep working.</span>
      </div>
      <label className="slider">
        Zoom
        <input type="range" min={0} max={ZOOMS.length - 1} step={1} value={ZOOMS.indexOf(zoom as (typeof ZOOMS)[number])} onChange={(e) => set({ zoom: ZOOMS[Number(e.target.value)] })} />
        <span>{zoom}×</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={w.drag ?? true} onChange={(e) => set({ drag: e.target.checked })} />
        Hold {chordText} and drag (or scroll) the bare desktop to look around the world
      </label>
      <div className="choice-row" role="group" aria-label="Keys to hold while dragging the world">
        {MODIFIERS.map((m) => (
          <button
            key={m.id}
            className={`action small ${chord.includes(m.id) ? "on" : ""}`}
            aria-pressed={chord.includes(m.id)}
            disabled={w.drag === false}
            onClick={() => toggleMod(m.id)}
          >
            {m.sym} {m.id}
          </button>
        ))}
      </div>
      {chord.includes("Control") && (
        <p className="muted small" role="alert">
          ⌃-click is a right-click on macOS, so Finder will open its desktop menu when you start a ⌃ drag. A chord without ⌃ avoids that.
        </p>
      )}
      <p className="muted small">
        The world sits under your desktop icons and widgets, so a plain click or drag still selects icons as usual. With the keys held,
        Finder still draws its selection box while you pan. Works wherever the bare desktop shows; the companions keep walking on
        whatever terrain comes into view.
      </p>
      <label className="check">
        <input type="checkbox" checked={w.collide} onChange={(e) => set({ collide: e.target.checked })} />
        Companions walk on the terrain
      </label>
      <label className="check">
        <input type="checkbox" checked={w.edit} onChange={(e) => set({ edit: e.target.checked })} />
        Edit terrain while exploring (click to place, right-click to remove)
      </label>
      <div className="choice-row">
        <span className="muted">Seed {w.seed || "(not made yet)"}</span>
        <input
          className="world-seed"
          type="text"
          value={seedText}
          placeholder="Seed (number or words)"
          aria-label="World seed"
          maxLength={40}
          onChange={(e) => setSeedText(e.target.value)}
        />
        <button className="action small" disabled={!seedText.trim()} onClick={() => newWorld(seedFrom(seedText))}>
          Use seed
        </button>
        <button className={`action small ${confirmNew ? "on" : ""}`} onClick={() => (confirmNew ? newWorld(randomSeed()) : setConfirmNew(true))}>
          {confirmNew ? "Sure? Edits are lost" : "New random world"}
        </button>
        <button className="action small" onClick={() => set({ cameraX: -1, cameraY: -1 })} disabled={!w.enabled}>
          Recenter view
        </button>
      </div>
      <p className="muted small">
        Forest, snow, desert, jungle, corruption, ocean, mushroom caves and the underworld, with the dungeon, cabins, sky islands,
        hives, chasms and NPC settlements, drawn with art from your Terraria install. As a background it's scenery only. Playing, you
        mine, build, craft at stations, wear armour, fight the biome's enemies, and take on the pre-hardmode bosses. Esc opens the inventory; Leave game takes you back to the desktop, and
        switching apps just lets go of your keys while the game keeps running. Character Control always drives your desktop companion. The same seed always makes the same world; your edits and progress are saved.
      </p>
    </section>
  );
}

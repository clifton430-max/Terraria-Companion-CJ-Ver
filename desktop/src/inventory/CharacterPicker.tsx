// Character tab roster: every character with a live preview, who's selected (Control mode drives
// her) and who's on screen, and an editor for the one you pick. The original companion uses the
// existing appearance/skin editors; the add-on girls are drawn from fixed sprite sheets, so they
// have their weapon, hit sound and chatter settings.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCharacterRig, getPlayerRig, listAddons, patchPrefs, type AddonInfo, type CharacterId, type CharacterPrefs, type CharacterSettings, type Prefs } from "../bridge";
import { TerrariaRig } from "../overlay/terrariaRig";
import { CHARACTERS, CHARACTER_IDS } from "../characters/roster";
import { WEAPONS, isPickaxe } from "../combat/weapons";

const PREVIEW = ["idle", "walk1", "walk4", "walk8", "walk11", "use2", "use4", "idle"];
const MAX_ON_SCREEN = 4;
function Preview({ id, lookKey }: { id: CharacterId; lookKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let stop = false;
    let timer = 0;
    (async () => {
      const info = id === "terrarian" ? await getPlayerRig() : await getCharacterRig(id);
      const rig = await TerrariaRig.load(info);
      if (stop) return;
      if (!rig) return setNote(info.reason ?? "Preview unavailable");
      setNote("");
      let i = 0;
      const draw = () => {
        const c = ref.current;
        if (!c || stop) return;
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        rig.draw(ctx, PREVIEW[i++ % PREVIEW.length], false, c.width, c.height);
        timer = window.setTimeout(draw, 200);
      };
      draw();
    })().catch((e) => setNote(String(e)));
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, lookKey]);
  return (
    <>
      <canvas ref={ref} className="skin-preview" width={80} height={112} aria-hidden="true" />
      {note && <span className="skin-note">{note}</span>}
    </>
  );
}

export default function CharacterPicker({ prefs, defaultEditor }: { prefs: Prefs; defaultEditor: ReactNode }) {
  const c = prefs.characters;
  const [editing, setEditing] = useState<CharacterId>(c.selected);
  const [addons, setAddons] = useState<AddonInfo | null>(null);
  useEffect(() => {
    listAddons().then(setAddons).catch(() => setAddons(null));
  }, []);
  const save = (characters: CharacterPrefs) => patchPrefs({ characters }).catch(() => {});
  const setChar = (id: CharacterId, patch: Partial<CharacterSettings>) => save({ ...c, per: c.per.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const available = (id: CharacterId) => {
    const need = CHARACTERS[id].addon;
    return !need || !addons || !!addons[need];
  };
  const cs = c.per.find((p) => p.id === editing);
  const def = CHARACTERS[editing];
  const weapons = WEAPONS.filter((w) => !isPickaxe(w) && !w.silk);

  return (
    <>
      <section className="tpanel skins">
        <h2>Characters</h2>
        <div className="skin-row" role="radiogroup" aria-label="Character to edit">
          {CHARACTER_IDS.map((id) => {
            const ok = available(id);
            const per = c.per.find((p) => p.id === id);
            const lookKey = id === "terrarian" ? `${JSON.stringify(prefs.appearance)}|${prefs.skin}` : JSON.stringify(per?.look ?? null);
            return (
              <button key={id} className={`skin-card ${editing === id ? "selected" : ""}`} role="radio" aria-checked={editing === id} disabled={!ok} onClick={() => setEditing(id)}>
                {ok ? <Preview id={id} lookKey={lookKey} /> : <span className="skin-missing">Add-on not installed</span>}
                <strong style={{ color: CHARACTERS[id].bubble.border }}>{CHARACTERS[id].name}</strong>
                <span className="skin-detail">{c.selected === id ? "Selected (Control mode drives her)" : c.active.includes(id) ? "On screen" : "Off screen"}</span>
              </button>
            );
          })}
        </div>
        <div className="choice-row">
          <button className="action small" disabled={c.selected === editing || !available(editing)} onClick={() => save({ ...c, selected: editing, active: c.active.includes(editing) ? c.active : [...c.active, editing].slice(-MAX_ON_SCREEN) })}>
            {c.selected === editing ? `${def.name} is selected` : `Select ${def.name}`}
          </button>
          <button
            className="action small"
            disabled={c.selected === editing || !available(editing) || (!c.active.includes(editing) && c.active.length >= MAX_ON_SCREEN)}
            onClick={() => save({ ...c, active: c.active.includes(editing) ? c.active.filter((a) => a !== editing) : [...c.active, editing] })}
          >
            {c.active.includes(editing) ? "Dismiss from screen" : "Summon to screen"}
          </button>
        </div>
      </section>

      {editing === "terrarian" ? (
        defaultEditor
      ) : (
        <section className="tpanel">
          <h2>{def.name}</h2>
          <p className="muted">{def.tagline}</p>
          <p className="muted small">Wears a fixed suit drawn from Terraria's own player sprites. Morgan's look can be changed from the Character tab.</p>
          <label className="slider">
            Weapon
            <select value={cs?.weapon || def.signature} onChange={(e) => setChar(editing, { weapon: e.target.value === def.signature ? "" : e.target.value })}>
              {weapons.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.id === def.signature ? " (signature)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={cs?.chatter ?? true} onChange={(e) => setChar(editing, { chatter: e.target.checked })} />
            Talks on their own
          </label>
        </section>
      )}
    </>
  );
}

// The character roster: who's on screen, who's selected (Control mode drives only the selected
// one), each character's weapon, hit sound and chatter, conversations between characters, and
// companion combat AI. Characters from add-on packs show whether their pack is installed.

import { useEffect, useState } from "react";
import { combatCommand, listAddons, patchPrefs, type AddonInfo, type BehaviorPrefs, type CharacterId, type CharacterPrefs, type CharacterSettings, type JumpStyle, type Prefs } from "../bridge";
import { DEFAULT_BEHAVIOR, isDefaultBehavior, normalizeBehavior, watchIndex } from "../engine/behaviorModes";
import { sanitizeLines } from "../engine/lines";
import { CHARACTERS, CHARACTER_IDS, customName } from "../characters/roster";
import { WEAPONS, isPickaxe } from "../combat/weapons";

const save = (characters: CharacterPrefs) => patchPrefs({ characters }).catch(() => {});
const MAX_ON_SCREEN = 4;

/** Her custom name: edited locally, saved on Enter or when you click away. */
function NameField({ id, value, onSave }: { id: CharacterId; value: string; onSave: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onSave(text.trim());
  return (
    <label className="slider">
      Name
      <input
        type="text"
        value={text}
        maxLength={24}
        placeholder={CHARACTERS[id].name}
        aria-label={`Name for ${CHARACTERS[id].name}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

export default function CharactersPanel({ prefs }: { prefs: Prefs }) {
  const c = prefs.characters;
  const [addons, setAddons] = useState<AddonInfo | null>(null);
  useEffect(() => {
    listAddons().then(setAddons).catch(() => setAddons(null));
  }, []);
  const set = (patch: Partial<CharacterPrefs>) => save({ ...c, ...patch });
  const setChar = (id: CharacterId, patch: Partial<CharacterSettings>) => save({ ...c, per: c.per.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const available = (id: CharacterId) => {
    const need = CHARACTERS[id].addon;
    return !need || !addons || !!addons[need];
  };
  const packOf = (id: CharacterId) => {
    const need = CHARACTERS[id].addon;
    return need && addons ? addons[need] : null;
  };
  const weapons = WEAPONS.filter((w) => !isPickaxe(w) && !w.silk);
  const behavior = normalizeBehavior(c.behavior);
  const setBehavior = (patch: Partial<BehaviorPrefs>) => set({ behavior: { ...behavior, ...patch } });
  const lines = sanitizeLines(prefs.lines?.items);
  const watching = watchIndex(lines, behavior.watch);

  return (
    <section className="tpanel wide">
      <h2>Characters</h2>
      <div className="roster">
        {CHARACTER_IDS.map((id) => {
          const def = CHARACTERS[id];
          const s = c.per.find((p) => p.id === id);
          const onScreen = c.active.includes(id);
          const selected = c.selected === id;
          const ok = available(id);
          const affection = id === "terrarian" ? prefs.affection.value : (s?.affection.value ?? 30);
          return (
            <div key={id} className={`roster-card ${selected ? "selected" : ""} ${ok ? "" : "missing"}`} style={{ borderColor: def.bubble.border }}>
              <div className="roster-head">
                <strong style={{ color: def.bubble.border }}>{customName(id, c) || def.name}</strong>
                {customName(id, c) && <span className="muted small">({def.name})</span>}
                {selected && <span className="tag">Selected</span>}
              </div>
              <p className="muted">{def.tagline}</p>
              <NameField id={id} value={s?.name ?? ""} onSave={(name) => setChar(id, { name })} />
              {def.addon && <p className="muted small">{ok ? `Add-on: ${packOf(id) ?? "installed"}` : "Needs its add-on pack (not installed)"}</p>}
              <div className="choice-row">
                <button
                  className={`action small ${onScreen ? "on" : ""}`}
                  disabled={!ok || selected || (!onScreen && c.active.length >= MAX_ON_SCREEN)}
                  onClick={() => set({ active: onScreen ? c.active.filter((a) => a !== id) : [...c.active, id] })}
                >
                  {onScreen ? "Dismiss" : "Summon"}
                </button>
                <button className={`action small ${selected ? "on" : ""}`} disabled={!ok || selected} onClick={() => set({ selected: id, active: onScreen ? c.active : [...c.active, id].slice(-MAX_ON_SCREEN) })}>
                  {selected ? "Controlled" : "Select"}
                </button>
              </div>
              <label className="slider">
                Weapon
                <select value={s?.weapon || def.signature} onChange={(e) => setChar(id, { weapon: e.target.value === def.signature ? "" : e.target.value })}>
                  {weapons.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.id === def.signature ? " (signature)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={s?.chatter ?? true} onChange={(e) => setChar(id, { chatter: e.target.checked })} />
                Talks on their own
              </label>
              {prefs.persona.showAffection && (
                <p className="muted small">
                  Rapport {Math.round(affection)}/100
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted">
        Up to {MAX_ON_SCREEN} characters can be on screen. Control mode drives only the selected one; the others keep roaming, chatting and
        fighting on their own. Double-click a character on screen to select them; click to get their attention. Each has their own role and
        personality, and the selected one answers chat and voice. A name you give them shows here and in the Terraria world, and works as
        a Wispr Flow wake name ("Hey Rose, …"); they still introduce themselves by their own name.
      </p>
      <label className="check">
        <input type="checkbox" checked={c.interactions} onChange={(e) => set({ interactions: e.target.checked })} />
        Characters walk over and have short work conversations with each other
      </label>
      <label className="slider">
        How often
        <input type="range" min={0.25} max={3} step={0.25} value={c.interactionFrequency} disabled={!c.interactions} onChange={(e) => set({ interactionFrequency: Number(e.target.value) })} />
        <span>{c.interactionFrequency < 0.75 ? "Rarely" : c.interactionFrequency <= 1.25 ? "Sometimes" : "Often"}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={c.autoFight} onChange={(e) => set({ autoFight: e.target.checked })} />
        Companions fight bosses on their own (dodge, keep range, spread out)
      </label>
      <label className="check">
        <input type="checkbox" checked={c.aiFlight} disabled={!c.autoFight} onChange={(e) => set({ aiFlight: e.target.checked })} />
        Let them fly around bosses
      </label>
      <h3>Movement</h3>
      <label className="check">
        <input type="checkbox" checked={behavior.spread} onChange={(e) => setBehavior({ spread: e.target.checked })} />
        Spread out (prefer different platforms; they still meet up to talk, cuddle or play chess)
      </label>
      <label className="slider">
        Jumping
        <select value={behavior.jump} onChange={(e) => setBehavior({ jump: e.target.value as JumpStyle })}>
          <option value="normal">Normal</option>
          <option value="jumpy">More jumpy (hop between platforms)</option>
          <option value="grounded">Stay grounded (rarely jump)</option>
        </select>
      </label>
      <label className="slider">
        Hangout
        <select
          value={watching >= 0 ? String(watching) : ""}
          disabled={!lines.length}
          onChange={(e) => setBehavior({ watch: e.target.value === "" ? null : lines[Number(e.target.value)] })}
        >
          <option value="">{lines.length ? "None" : "No invisible platforms yet"}</option>
          {lines.map((_, i) => (
            <option key={i} value={i}>
              Platform {i + 1}
            </option>
          ))}
        </select>
      </label>
      <div className="choice-row">
        <button className="action small" disabled={!lines.length} onClick={() => combatCommand("pickHangout").catch(() => {})}>
          Pick on screen…
        </button>
        <button className="action small" disabled={isDefaultBehavior(behavior)} onClick={() => set({ behavior: { ...DEFAULT_BEHAVIOR } })}>
          Reset movement to default
        </button>
      </div>
      <p className="muted small">
        With a hangout, the companions make their way to that invisible platform and take turns sitting side by side and cuddling.
        Draw platforms in platform edit mode first; numbers match the labels shown when you pick on screen. These also work by voice:
        “spread out a bit”, “be more jumpy”, “stay grounded”, “go watch from platform 2”, “reset your movement”.
        {behavior.watch && watching < 0 ? " The saved hangout platform no longer exists, so it's ignored." : ""}
      </p>
      <p className="muted small">
        Combat AI works with the companion's own boss simulator (Eye of Cthulhu, Queen Bee, Moon Lord, training dummies). It can't see a
        real Terraria game. Conversations pause during boss fights and never involve the character you're controlling; Quiet mode or
        turning off spontaneous dialogue silences them.
      </p>
    </section>
  );
}

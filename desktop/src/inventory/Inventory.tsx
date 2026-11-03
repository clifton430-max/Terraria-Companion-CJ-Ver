import { useEffect, useState } from "react";
import { combatCommand, getPrefs, hideInventory, onPrefs, onSettingsTab, showChat, patchPrefs, type Prefs } from "../bridge";
import { UI_VARS, fallbackToPainted, iconUrl } from "./icons";
import AppearanceEditor from "./AppearanceEditor";
import CompanionPanel from "./CompanionPanel";
import SkinPicker from "./SkinPicker";
import CharacterPicker from "./CharacterPicker";
import MapsPanel from "./MapsPanel";
import AwarenessPanel from "./AwarenessPanel";
import PauseMenu, { type MenuCompanion, type MenuSection } from "./PauseMenu";
import { CHARACTERS, displayName } from "../characters/roster";
import { HOTBAR_SIZE, matchesCategory } from "../combat/inventory";
import { CATEGORY_LABEL, categoryOf, getWeapon, weaponStats } from "../combat/weapons";
import { FILTERS, useArsenal } from "./useArsenal";
import "./inventory.css";

/** The menu's sections, top to bottom. */
const SECTIONS: MenuSection[] = [
  { id: "characters", label: "CHARACTERS", sub: "Team, looks & names" },
  { id: "behavior", label: "BEHAVIOR", sub: "Personality & idle poses" },
  { id: "assistant", label: "ASSISTANT", sub: "Local AI & voice input" },
  { id: "world", label: "WORLD", sub: "Terraria world & places" },
  { id: "combat", label: "COMBAT", sub: "Arsenal, control & bosses" },
  { id: "awareness", label: "AWARENESS", sub: "Screen & app reactions" },
  { id: "desktop", label: "DESKTOP", sub: "Building, cursor & dock" },
  { id: "maps", label: "MAPS", sub: "Themes & the menu bar" },
  { id: "sound", label: "SOUND", sub: "Voices & effects" },
  { id: "system", label: "SYSTEM", sub: "General & controls" },
];
type SectionId = (typeof SECTIONS)[number]["id"];

/** The old tab names ("open your settings" from the assistant and the tray) → sections. */
const FROM_TAB: Record<string, SectionId> = { items: "combat", character: "characters", maps: "maps", companion: "behavior", awareness: "awareness" };

/** General controls: show or pause the companion, open the chat, and the keys. */
function SystemPanel({ prefs }: { prefs: Prefs }) {
  return (
    <>
      <section className="tpanel">
        <h2>Companion</h2>
        <div className="choice-row">
          <button className={`action ${prefs.visible ? "on" : ""}`} aria-pressed={prefs.visible} onClick={() => patchPrefs({ visible: !prefs.visible }).catch(() => {})}>
            {prefs.visible ? "Shown on the desktop" : "Hidden"}
          </button>
          <button className={`action ${prefs.paused ? "on" : ""}`} aria-pressed={prefs.paused} onClick={() => patchPrefs({ paused: !prefs.paused }).catch(() => {})}>
            {prefs.paused ? "Paused" : "Pause her"}
          </button>
          <button className="action" onClick={() => showChat().catch(() => {})}>
            Open chat
          </button>
        </div>
      </section>
      <section className="tpanel">
        <h2>This menu</h2>
        <p className="keys">
          <kbd>↑</kbd>/<kbd>↓</kbd> choose a section · <kbd>⏎</kbd> or <kbd>→</kbd> open it · <kbd>Tab</kbd> move through its settings ·{" "}
          <kbd>Esc</kbd> or <kbd>←</kbd> back · <kbd>Esc</kbd> on the list closes the menu. The mouse works everywhere: hover to choose,
          click to open.
        </p>
      </section>
      <section className="tpanel">
        <h2>Combat keys</h2>
        <p className="keys">
          In Combat: <kbd>1</kbd>–<kbd>0</kbd> select · <kbd>Q</kbd>/<kbd>E</kbd> cycle · <kbd>F</kbd> attack · <kbd>←</kbd>/<kbd>→</kbd> attack left/right ·{" "}
          <kbd>T</kbd> training · <kbd>R</kbd> reset · <kbd>X</kbd> dismiss · <kbd>B</kbd> boss · <kbd>L</kbd> letters
        </p>
      </section>
    </>
  );
}

export default function Inventory() {
  const [section, setSection] = useState<SectionId>("characters");
  // "Open your settings" from the assistant can ask for a specific tab.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    onSettingsTab((t) => {
      if (FROM_TAB[t]) setSection(FROM_TAB[t]);
    }).then((s) => (disposed ? s() : (stop = s)));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const appearance = prefs?.appearance ?? null;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    getPrefs()
      .then((p) => {
        if (!disposed) setPrefs(p);
      })
      .catch(() => {});
    onPrefs(setPrefs).then((s) => (disposed ? s() : (stop = s)));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  // (The arsenal's keys work in Combat only; Esc and the arrows belong to the menu.)
  const a = useArsenal(prefs, section === "combat");
  const { inv, training, filter, inspected, dragFrom, shown, shownIndex, equipped } = a;

  const arsenal = (<>
      <nav className="filters" aria-label="Weapon categories">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter ${filter === f ? "active" : ""}`}
            aria-pressed={filter === f}
            onClick={() => a.setFilter(f)}
          >
            {f === "all" ? "All" : CATEGORY_LABEL[f]}
          </button>
        ))}
      </nav>

      <div className="grid" role="grid" aria-label="Inventory slots">
        {a.rows.map((row, r) => (
          <div className={`row ${r === 0 ? "hotbar" : ""}`} role="row" key={r}>
            {row.map((index) => {
              const def = getWeapon(inv.slots[index]);
              const dim = !matchesCategory(inv.slots[index], filter) && filter !== "all";
              const classes = [
                "slot",
                index === inv.selected ? "selected" : "",
                index === inspected ? "inspected" : "",
                dim ? "dim" : "",
                dragFrom === index ? "dragging" : "",
              ].join(" ");
              return (
                <button
                  key={index}
                  role="gridcell"
                  className={classes}
                  aria-selected={index === inv.selected}
                  aria-label={`${index < HOTBAR_SIZE ? `Hotbar ${(index + 1) % 10}: ` : ""}${def ? def.name : "Empty"}`}
                  title={def ? `${def.name} · ${CATEGORY_LABEL[categoryOf(def)]}` : "Empty"}
                  onClick={() => a.onSlotClick(index)}
                  onDoubleClick={() => a.onSlotDouble(index)}
                  onMouseEnter={() => def && a.setInspected(index)}
                  draggable={!!def}
                  onDragStart={(e) => {
                    a.setDragFrom(index);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => a.setDragFrom(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    a.onDrop(index);
                  }}
                >
                  {r === 0 && <span className="slot-key">{(index + 1) % 10}</span>}
                  {def && (
                    <img
                      src={iconUrl(def)}
                      alt=""
                      draggable={false}
                      onError={fallbackToPainted(def)}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section className="panels">
        <article className="details" aria-live="polite">
          {shown ? (
            <>
              <h2 style={{ color: shown.rarity }}>{shown.name}</h2>
              <p className="category">{CATEGORY_LABEL[categoryOf(shown)]} · {shown.kind}</p>
              <dl>
                {weaponStats(shown).map((s) => (
                  <div key={s.label}>
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="description">{shown.description}</p>
              {shownIndex !== inv.selected && (
                <button className="action" onClick={a.equipShown}>
                  {shownIndex < HOTBAR_SIZE ? "Select" : "Equip to hotbar slot " + ((inv.selected + 1) % 10)}
                </button>
              )}
            </>
          ) : (
            <p className="muted">Empty slot. Drag a weapon here to move it.</p>
          )}
        </article>

        <aside className="training">
          <h2>Training</h2>
          <button
            className={`action ${training ? "on" : ""}`}
            aria-pressed={training}
            onClick={a.toggleTraining}
          >
            {training ? "Training on" : "Start training"}
          </button>
          <button className="action" onClick={() => combatCommand("attack").catch(() => {})}>
            Attack
          </button>
          <button className="action" onClick={() => combatCommand("reset").catch(() => {})}>
            Reset dummies
          </button>
          <button className="action" onClick={() => combatCommand("dismiss").catch(() => {})}>
            Dismiss minions
          </button>
          <p className="keys">
            <kbd>1</kbd>–<kbd>0</kbd> select · <kbd>Q</kbd>/<kbd>E</kbd> cycle · <kbd>F</kbd> attack ·{" "}
            <kbd>←</kbd>/<kbd>→</kbd> attack left/right · <kbd>T</kbd> training · <kbd>R</kbd> reset ·{" "}
            <kbd>X</kbd> dismiss · <kbd>B</kbd> boss · <kbd>L</kbd> letters · <kbd>Esc</kbd> close
          </p>
        </aside>
      </section>
      </>);

  // Your selected companion hangs in the menu, in her colours, with her name.
  const sel = prefs?.characters.selected;
  const companion: MenuCompanion | null =
    prefs && sel
      ? {
          id: sel,
          name: displayName(sel, prefs.characters),
          colors: CHARACTERS[sel].bubble,
          lookKey: sel === "terrarian" ? `${prefs.skin}|${JSON.stringify(prefs.appearance)}` : JSON.stringify(prefs.characters.per.find((p) => p.id === sel)?.look ?? {}),
        }
      : null;

  return (
    <main className="inventory" style={UI_VARS}>
      <PauseMenu sections={SECTIONS} active={section} onActive={(id) => setSection(id as SectionId)} onClose={() => hideInventory().catch(() => {})} companion={companion}>
        {!prefs ? (
          <p className="muted">Loading…</p>
        ) : section === "characters" ? (
          <>
            <CharacterPicker
              prefs={prefs}
              defaultEditor={
                <>
                  <SkinPicker selected={prefs.skin} />
                  {appearance && <AppearanceEditor appearance={appearance} />}
                </>
              }
            />
            <CompanionPanel prefs={prefs} parts={["characters"]} />
          </>
        ) : section === "behavior" ? (
          <CompanionPanel prefs={prefs} parts={["persona", "idle"]} />
        ) : section === "assistant" ? (
          <AwarenessPanel prefs={prefs} parts={["assistant"]} />
        ) : section === "world" ? (
          <MapsPanel prefs={prefs} parts={["world", "places"]} />
        ) : section === "combat" ? (
          <>
            <p className="equipped">
              Equipped: {equipped ? <strong style={{ color: equipped.rarity }}>{equipped.name}</strong> : <em>nothing</em>}
            </p>
            {arsenal}
            <CompanionPanel prefs={prefs} parts={["control", "pickaxe", "bosses"]} />
          </>
        ) : section === "awareness" ? (
          <AwarenessPanel prefs={prefs} parts={["screen", "reactions"]} />
        ) : section === "desktop" ? (
          <CompanionPanel prefs={prefs} parts={["build", "lines", "cursor", "dock", "letters", "destroyer"]} />
        ) : section === "maps" ? (
          <MapsPanel prefs={prefs} parts={["maps", "theme"]} />
        ) : section === "sound" ? (
          <CompanionPanel prefs={prefs} parts={["sound"]} />
        ) : (
          <SystemPanel prefs={prefs} />
        )}
      </PauseMenu>
    </main>
  );
}

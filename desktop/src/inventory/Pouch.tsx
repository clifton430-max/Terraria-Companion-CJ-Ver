// The compact inventory opened from the notch (CustomNotch's inventory button): the same arsenal as
// the menu's Combat section (filters, the 50 slots with the hotbar, inspecting, drag to swap,
// equipping, training and its keys) in a small dark panel that matches CustomNotch's own panels.
// It's a popover: Esc, its close button or clicking elsewhere puts it away.

import { useEffect, useState } from "react";
import { combatCommand, getPrefs, hidePouch, onPouchOpened, onPrefs, pouchOpenMenu, type Prefs } from "../bridge";
import { HOTBAR_SIZE, matchesCategory } from "../combat/inventory";
import { CATEGORY_LABEL, categoryOf, getWeapon, weaponStats } from "../combat/weapons";
import { fallbackToPainted, iconUrl } from "./icons";
import { FILTERS, useArsenal } from "./useArsenal";
import "./pouch.css";

export default function Pouch() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  // Bumped each time it opens, to replay the entrance.
  const [opened, setOpened] = useState(0);

  useEffect(() => {
    let stops: (() => void)[] = [];
    let disposed = false;
    getPrefs()
      .then((p) => !disposed && setPrefs(p))
      .catch(() => {});
    const keep = (s: () => void) => (disposed ? s() : stops.push(s));
    onPrefs(setPrefs).then(keep);
    onPouchOpened(() => setOpened((n) => n + 1)).then(keep);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hidePouch().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      stops.forEach((s) => s());
      stops = [];
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const a = useArsenal(prefs, true);
  const { inv, training, filter, inspected, dragFrom, shown, shownIndex, equipped } = a;

  return (
    <main className="pouch" key={opened}>
      <header className="pouch-head">
        <div className="pouch-title">
          <h1>Inventory</h1>
          <p>
            {equipped ? (
              <>
                Equipped <strong style={{ color: equipped.rarity }}>{equipped.name}</strong>
              </>
            ) : (
              "Nothing equipped"
            )}
          </p>
        </div>
        <button className="pouch-pill" onClick={() => pouchOpenMenu().catch(() => {})} title="Open the full menu">
          Full Menu
        </button>
        <button className="pouch-close" onClick={() => hidePouch().catch(() => {})} title="Close (Esc)" aria-label="Close">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </header>

      <nav className="pouch-tabs" aria-label="Weapon categories">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? "active" : ""} aria-pressed={filter === f} onClick={() => a.setFilter(f)}>
            {f === "all" ? "All" : CATEGORY_LABEL[f]}
          </button>
        ))}
      </nav>

      <div className="pouch-grid" role="grid" aria-label="Inventory slots">
        {a.rows.map((row, r) => (
          <div className={`pouch-row ${r === 0 ? "hotbar" : ""}`} role="row" key={r}>
            {row.map((index) => {
              const def = getWeapon(inv.slots[index]);
              const dim = filter !== "all" && !matchesCategory(inv.slots[index], filter);
              const classes = [
                "pouch-slot",
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
                  {r === 0 && <span className="key">{(index + 1) % 10}</span>}
                  {def && <img src={iconUrl(def)} alt="" draggable={false} onError={fallbackToPainted(def)} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <article className="pouch-card pouch-details" aria-live="polite">
        {shown ? (
          <>
            <div className="pouch-details-head">
              <div>
                <h2 style={{ color: shown.rarity }}>{shown.name}</h2>
                <p className="sub">
                  {CATEGORY_LABEL[categoryOf(shown)]} · {shown.kind}
                </p>
              </div>
              {shownIndex !== inv.selected && (
                <button className="pouch-pill accent" onClick={a.equipShown}>
                  {shownIndex < HOTBAR_SIZE ? "Select" : `Equip to ${(inv.selected + 1) % 10}`}
                </button>
              )}
            </div>
            <dl>
              {weaponStats(shown).map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="desc">{shown.description}</p>
          </>
        ) : (
          <p className="sub empty">Empty slot. Drag a weapon here to move it.</p>
        )}
      </article>

      <section className="pouch-actions" aria-label="Training">
        <button className={`pouch-pill ${training ? "on" : ""}`} aria-pressed={training} onClick={a.toggleTraining}>
          <i className="dot" />
          {training ? "Training" : "Train"}
        </button>
        <button className="pouch-pill" onClick={() => combatCommand("attack").catch(() => {})}>
          Attack
        </button>
        <button className="pouch-pill" onClick={() => combatCommand("reset").catch(() => {})}>
          Reset
        </button>
        <button className="pouch-pill" onClick={() => combatCommand("dismiss").catch(() => {})}>
          Dismiss
        </button>
      </section>

      <p className="pouch-keys">
        <kbd>1</kbd>–<kbd>0</kbd> select · <kbd>Q</kbd>/<kbd>E</kbd> cycle · <kbd>F</kbd> attack · <kbd>T</kbd> train · <kbd>R</kbd> reset ·{" "}
        <kbd>X</kbd> dismiss · <kbd>B</kbd> boss · <kbd>L</kbd> letters
      </p>
    </main>
  );
}

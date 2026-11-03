// The quick-action dock: a small always-on-top Terraria hotbar with the six end-game weapons and
// buttons for the boss, Stay-Put, cursor modes and the inventory. It lives in its own
// non-focusable window, so clicking it never steals the keyboard or affects the overlay's
// click-through. All changes go through patch_prefs / combat_command / show_inventory.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  combatCommand,
  getPrefs,
  onBossState,
  onPrefs,
  patchPrefs,
  setDockSize,
  showChat,
  showInventory,
  type Prefs,
} from "../bridge";
import { textureUrl } from "../assets/textures";
import { fromSaved } from "../combat/inventory";
import { getWeapon } from "../combat/weapons";
import { UI_VARS, fallbackToPainted, iconUrl } from "../inventory/icons";
import {
  ACTION_ICONS,
  DOCK_ACTIONS,
  DOCK_WEAPONS,
  actionEffect,
  actionLabel,
  dockLayout,
  equippedId,
  normalizeDock,
  weaponEffect,
  type DockActionId,
  type DockControlId,
  type DockEffect,
} from "./model";
import "./dock.css";

/** Two-letter labels for the compact layout (where there's no name line). */
const SHORT: Record<string, string> = {
  "terra-blade": "TB",
  "nights-edge": "NE",
  megashark: "MS",
  "daedalus-stormbow": "DS",
  "last-prism": "LP",
  zenith: "ZE",
  "copper-pickaxe": "PX",
  picksaw: "PS",
};
const FALLBACK_GLYPH: Record<DockActionId, string> = { boss: "👁", stay: "Zz", cursor: "↖", chat: "💬", inventory: "▤" };

/** Terraria texture for an action, or a text glyph if the art isn't available. */
function ActionIcon({ id }: { id: DockActionId }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="glyph">{FALLBACK_GLYPH[id]}</span>;
  return <img src={textureUrl(ACTION_ICONS[id])} alt="" draggable={false} onError={() => setFailed(true)} />;
}

function run(effect: DockEffect | null) {
  if (!effect) return;
  const done = (p: Promise<unknown>) => p.catch((e) => console.warn("dock action failed", e));
  if (effect.kind === "combat") done(combatCommand(effect.action));
  else if (effect.kind === "prefs") done(patchPrefs(effect.patch));
  else if (effect.kind === "showChat") done(showChat());
  else done(showInventory());
}

export default function Dock() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [bossActive, setBossActive] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [availWidth, setAvailWidth] = useState(() => window.screen.availWidth);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    getPrefs()
      .then((p) => !disposed && setPrefs(p))
      .catch(() => {});
    Promise.all([onPrefs(setPrefs), onBossState(setBossActive)]).then((s) => (disposed ? s.forEach((f) => f()) : stops.push(...s)));
    // Display changes don't fire resize events in this window; re-check the screen width.
    const timer = window.setInterval(() => setAvailWidth(window.screen.availWidth), 2000);
    return () => {
      disposed = true;
      stops.forEach((f) => f());
      clearInterval(timer);
    };
  }, []);

  const dock = normalizeDock(prefs?.dock);
  const layout = useMemo(
    () => dockLayout({ availableWidth: availWidth, layout: dock.layout, expanded: dock.expanded, slotCount: DOCK_WEAPONS.length }),
    [availWidth, dock.layout, dock.expanded],
  );

  useEffect(() => {
    setDockSize(layout.width, layout.height).catch(() => {});
  }, [layout.width, layout.height]);

  if (!prefs) return null;

  const inv = fromSaved(prefs.inventory, prefs.selectedSlot);
  const equipped = equippedId(inv);
  const equippedDef = getWeapon(equipped);
  const m = layout.metrics;
  const modeState = { companionMode: prefs.companionMode, cursorMode: prefs.cursorMode, dock };
  const control = (id: DockControlId) => actionLabel(id, modeState, bossActive);

  const style = {
    ...UI_VARS,
    "--slot": `${m.slot}px`,
    "--action": `${m.action}px`,
    "--gap": `${m.gap}px`,
    "--pad": `${m.pad}px`,
    "--grip": `${m.grip}px`,
    "--controls": `${m.controls}px`,
    "--name": `${m.nameLine}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
  } as CSSProperties;

  const hovered = hover ? getWeapon(hover) : undefined;
  const nameText = hover && !hovered ? hover : (hovered ?? equippedDef)?.name ?? "Nothing equipped";
  const nameColor = hover && !hovered ? "#ffffff" : (hovered ?? equippedDef)?.rarity ?? "#ffffff";

  return (
    <main className={`dock ${dock.layout}`} style={style} onMouseLeave={() => setHover(null)}>
      <div className="grip" data-tauri-drag-region title="Drag to move the dock" aria-label="Drag to move" />

      {layout.collapsed ? (
        <button
          className="slot selected"
          title="Expand dock"
          aria-label={`Expand dock (equipped: ${equippedDef?.name ?? "nothing"})`}
          onClick={() => run(actionEffect("collapse", modeState))}
        >
          {equippedDef && <img src={iconUrl(equippedDef)} alt="" draggable={false} onError={fallbackToPainted(equippedDef)} />}
        </button>
      ) : (
        <div className="body">
          {m.nameLine > 0 && (
            <div className="name" style={{ color: nameColor }} aria-live="polite">
              {nameText}
            </div>
          )}
          <div className={`content ${layout.actionsBelow ? "below" : ""}`}>
            <div className="slots" role="radiogroup" aria-label="Weapons" style={{ gridTemplateColumns: `repeat(${layout.columns}, var(--slot))` }}>
              {DOCK_WEAPONS.map((id) => {
                const def = getWeapon(id);
                if (!def) return null;
                const on = id === equipped;
                return (
                  <button
                    key={id}
                    className={`slot ${on ? "selected" : ""}`}
                    role="radio"
                    aria-checked={on}
                    aria-label={def.name}
                    title={def.name}
                    onMouseEnter={() => setHover(id)}
                    onClick={() => run(weaponEffect(prefs, id))}
                  >
                    <img src={iconUrl(def)} alt="" draggable={false} onError={fallbackToPainted(def)} />
                    {dock.layout === "compact" && <span className="short">{SHORT[id]}</span>}
                  </button>
                );
              })}
            </div>
            {!layout.actionsBelow && <div className="divider" />}
            <div className="actions">
              {DOCK_ACTIONS.map((id) => {
                const label = actionLabel(id, modeState, bossActive);
                const on = (id === "boss" && bossActive) || (id === "stay" && prefs.companionMode === "stay") || (id === "cursor" && prefs.cursorMode !== "off");
                return (
                  <button
                    key={id}
                    className={`action-btn ${id} ${on ? "on" : ""}`}
                    aria-label={label}
                    aria-pressed={on}
                    title={label}
                    onMouseEnter={() => setHover(label)}
                    onClick={() => run(actionEffect(id, modeState))}
                  >
                    <ActionIcon id={id} />
                    {id === "cursor" && prefs.cursorMode !== "off" && <span className="badge">{prefs.cursorMode[0].toUpperCase()}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="controls">
        <button className="ctl" aria-label={control("collapse")} title={control("collapse")} onMouseEnter={() => setHover(control("collapse"))} onClick={() => run(actionEffect("collapse", modeState))}>
          {dock.expanded ? "–" : "+"}
        </button>
        <button className="ctl" aria-label={control("close")} title={control("close")} onMouseEnter={() => setHover(control("close"))} onClick={() => run(actionEffect("close", modeState))}>
          ×
        </button>
      </div>
    </main>
  );
}

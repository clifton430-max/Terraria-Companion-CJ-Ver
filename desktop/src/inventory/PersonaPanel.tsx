// Personality & affection: how cutesy she is, spontaneous dialogue (frequency, attention requests,
// quiet hours), the hidden affection meter (decay, optional peek, reset) and the cookie hotkey.

import { useEffect, useState } from "react";
import { combatCommand, cookieShortcutStatus, patchPrefs, type PersonaPrefs, type Prefs } from "../bridge";
import { tierOf } from "../affection/model";
import ShortcutField from "./ShortcutField";
import { appShortcuts } from "../voice/shortcut";

const save = (persona: PersonaPrefs) => patchPrefs({ persona }).catch(() => {});
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
const TIER_LABEL = { shy: "New", friendly: "Familiar", close: "Trusted", smitten: "Trusted", devoted: "Trusted" } as const;

export default function PersonaPanel({ prefs }: { prefs: Prefs }) {
  const p = prefs.persona;
  const set = (patch: Partial<PersonaPrefs>) => save({ ...p, ...patch });
  const [status, setStatus] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => cookieShortcutStatus().then(setStatus).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [p.cookieEnabled, p.cookieShortcut, prefs.build.toggleShortcut, prefs.lines.toggleShortcut, prefs.control.toggleShortcut, prefs.voiceInput.enabled, prefs.voiceInput.shortcut]);
  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  const value = prefs.affection.value;

  return (
    <section className="tpanel">
      <h2>Personality &amp; rapport</h2>
      <div className="choice-row" role="radiogroup" aria-label="Personality intensity">
        <span className="label">Personality</span>
        {(["subtle", "normal", "strong"] as const).map((k) => (
          <button key={k} className={`action small ${p.intensity === k ? "on" : ""}`} role="radio" aria-checked={p.intensity === k} onClick={() => set({ intensity: k })}>
            {k === "subtle" ? "Subtle" : k === "normal" ? "Normal" : "Expressive"}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={p.spontaneous} onChange={(e) => set({ spontaneous: e.target.checked })} />
        Make occasional remarks on their own (reminders, check-ins)
      </label>
      <label className="slider">
        How often
        <input type="range" min={0.25} max={3} step={0.25} value={p.frequency} disabled={!p.spontaneous} onChange={(e) => set({ frequency: Number(e.target.value) })} />
        <span>{p.frequency < 0.75 ? "Rarely" : p.frequency <= 1.25 ? "Sometimes" : p.frequency <= 2 ? "Often" : "Chatty"}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={p.attention} disabled={!p.spontaneous} onChange={(e) => set({ attention: e.target.checked })} />
        Check in when I've been away (a few times at most), and welcome me back
      </label>
      <div className="choice-row">
        <label className="check">
          <input type="checkbox" checked={p.quietHours} onChange={(e) => set({ quietHours: e.target.checked })} />
          Quiet hours
        </label>
        <select value={p.quietStart} disabled={!p.quietHours} onChange={(e) => set({ quietStart: Number(e.target.value) })} aria-label="Quiet from">
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
        <span className="muted">to</span>
        <select value={p.quietEnd} disabled={!p.quietHours} onChange={(e) => set({ quietEnd: Number(e.target.value) })} aria-label="Quiet until">
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
      </div>
      <label className="slider">
        Rapport decay
        <input type="range" min={0} max={10} step={0.5} value={p.decay} onChange={(e) => set({ decay: Number(e.target.value) })} />
        <span>{p.decay === 0 ? "Off" : `${p.decay}/h`}</span>
      </label>
      <div className="choice-row">
        <label className="check">
          <input type="checkbox" checked={p.showAffection} onChange={(e) => set({ showAffection: e.target.checked })} />
          Show rapport
        </label>
        {p.showAffection && (
          <span className="muted">
            {Math.round(value)}/100 · {TIER_LABEL[tierOf(value)]}
          </span>
        )}
        <button
          className={`action small ${confirmReset ? "boss" : ""}`}
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            setConfirmReset(false);
            patchPrefs({ affection: { value: 30, updated: Date.now(), cookies: prefs.affection.cookies } }).catch(() => {});
          }}
        >
          {confirmReset ? "Click again to reset" : "Reset rapport"}
        </button>
      </div>
      <div className="choice-row">
        <label className="check">
          <input type="checkbox" checked={p.cookieEnabled} onChange={(e) => set({ cookieEnabled: e.target.checked })} />
          Cookie hotkey
        </label>
        <ShortcutField value={p.cookieShortcut} others={appShortcuts(prefs, "Cookie")} defaultValue="Control+Shift+K" onChange={(s) => set({ cookieShortcut: s })} />
        <button className="action small" onClick={() => combatCommand("toggleCookie").catch(() => {})}>
          Give cookie
        </button>
      </div>
      {p.cookieEnabled && status && <p className={`muted ${status.startsWith("Shortcut active") ? "" : "warn"}`}>{status}</p>}
      <p className="muted">
        Her affection is hidden and grows when you chat, pat her (click), feed her cookies (drag the cookie onto her) and win fights
        together. It fades slowly while you use the computer, and only a little while you're away or the app is closed. Warmer levels
        unlock sweeter dialogue, hugs and the occasional request for a cookie or a kiss (click her to give one). Quiet mode (Awareness) and
        quiet hours silence her remarks. Right-click the cookie or press Esc while holding it to put it away.
      </p>
    </section>
  );
}

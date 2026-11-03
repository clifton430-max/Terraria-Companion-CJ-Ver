// Cherry-blossom theme settings: decorations (menu-bar garland, Dock-edge grass), falling petals
// and how they move. macOS doesn't let apps restyle the real menu bar or Dock, so the theme is a
// click-through layer drawn behind app windows (or in front, still under the menu bar and Dock).

import { patchPrefs, type PetalStyle, type Prefs, type ThemePrefs } from "../bridge";

const save = (theme: ThemePrefs) => patchPrefs({ theme }).catch(() => {});

const STYLES: [PetalStyle, string, string][] = [
  ["drift", "Drift", "Lazy side-to-side sway"],
  ["flutter", "Flutter", "Quick fluttering, tumbling"],
  ["spiral", "Spiral", "Corkscrew as they fall"],
  ["gusts", "Gusts", "Wind that comes and goes"],
];

const PRESETS: [string, Partial<ThemePrefs>][] = [
  ["Gentle", { density: 0.25, speed: 0.7, wind: 0.15, sway: 0.4, spin: 0.35, style: "drift" }],
  ["Breezy", { density: 0.4, speed: 1.1, wind: 0.6, sway: 0.6, spin: 0.6, style: "gusts" }],
  ["Flurry", { density: 0.8, speed: 1.4, wind: 0.3, sway: 0.8, spin: 0.9, style: "flutter" }],
];

export default function ThemePanel({ prefs }: { prefs: Prefs }) {
  const t = prefs.theme;
  const set = (patch: Partial<ThemePrefs>) => save({ ...t, ...patch });
  const slider = (label: string, key: "density" | "speed" | "wind" | "sway" | "spin" | "size", min: number, max: number, step: number, show: (v: number) => string) => (
    <label className="slider">
      {label}
      <input type="range" min={min} max={max} step={step} value={t[key]} disabled={!t.enabled || !t.petals} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <span>{show(t[key])}</span>
    </label>
  );
  return (
    <section className="tpanel">
      <h2>Map effects</h2>
      <label className="check">
        <input type="checkbox" checked={t.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Show the map (decorations and falling petals / snow)
      </label>
      <div className="choice-row">
        <label className="check">
          <input type="checkbox" checked={t.garland} disabled={!t.enabled} onChange={(e) => set({ garland: e.target.checked })} />
          Menu-bar decoration
        </label>
        <label className="check">
          <input type="checkbox" checked={t.grass} disabled={!t.enabled} onChange={(e) => set({ grass: e.target.checked })} />
          Dock-edge decoration
        </label>
        <label className="check">
          <input type="checkbox" checked={t.petals} disabled={!t.enabled} onChange={(e) => set({ petals: e.target.checked })} />
          Falling petals / snow
        </label>
      </div>
      <div className="choice-row" role="radiogroup" aria-label="Petal motion">
        <span className="label">Motion</span>
        {STYLES.map(([id, label, hint]) => (
          <button key={id} title={hint} className={`action small ${t.style === id ? "on" : ""}`} role="radio" aria-checked={t.style === id} disabled={!t.enabled || !t.petals} onClick={() => set({ style: id })}>
            {label}
          </button>
        ))}
      </div>
      {slider("Density", "density", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      {slider("Speed", "speed", 0.25, 2.5, 0.05, (v) => `${v.toFixed(2)}×`)}
      {slider("Wind", "wind", -1, 1, 0.05, (v) => (Math.abs(v) < 0.025 ? "calm" : `${v < 0 ? "←" : "→"} ${Math.round(Math.abs(v) * 100)}%`))}
      {slider("Sway", "sway", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      {slider("Tumble", "spin", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      {slider("Size", "size", 0.5, 2, 0.05, (v) => `${v.toFixed(2)}×`)}
      <div className="choice-row">
        <span className="label">Presets</span>
        {PRESETS.map(([name, p]) => (
          <button key={name} className="action small" disabled={!t.enabled} onClick={() => set({ ...p, petals: true })}>
            {name}
          </button>
        ))}
      </div>
      <div className="choice-row" role="radiogroup" aria-label="Theme layer">
        <span className="label">Layer</span>
        <button className={`action small ${t.layer === "behind" ? "on" : ""}`} role="radio" aria-checked={t.layer === "behind"} onClick={() => set({ layer: "behind" })}>
          Behind windows
        </button>
        <button className={`action small ${t.layer === "front" ? "on" : ""}`} role="radio" aria-checked={t.layer === "front"} onClick={() => set({ layer: "front" })}>
          In front of windows
        </button>
      </div>
      <p className="muted">
        macOS doesn't let apps restyle the real menu bar or Dock, so this is a decorative layer. <b>Behind windows</b> (recommended)
        decorates the desktop only and never covers your apps. <b>In front</b> floats petals over windows. Either way it's
        click-through, and the menu bar and Dock always draw on top of it.
      </p>
    </section>
  );
}

// The saved-locations gallery: every biome, structure, settlement, the town, the boss arena and
// the houses the waifus have found or built on their adventure, each with a preview, a biome label
// and how far along it is. Click one to look at it in the background world.

import { useEffect, useMemo, useState } from "react";
import { onPlaces, placesGoto, placesLoad, type Place, type PlacesFile } from "../bridge";

const KIND_LABEL: Record<Place["kind"], string> = {
  biome: "Biome",
  structure: "Structure",
  settlement: "NPC settlement",
  town: "Town",
  arena: "Boss arena",
  house: "House",
};

const FILTERS: { id: string; label: string; kinds: Place["kind"][] }[] = [
  { id: "all", label: "All", kinds: ["biome", "structure", "settlement", "town", "arena", "house"] },
  { id: "houses", label: "Houses", kinds: ["house"] },
  { id: "towns", label: "Towns & settlements", kinds: ["town", "settlement"] },
  { id: "biomes", label: "Biomes", kinds: ["biome"] },
  { id: "places", label: "Structures & arenas", kinds: ["structure", "arena"] },
];

function parse(raw: string | null): Place[] {
  if (!raw) return [];
  try {
    const f = JSON.parse(raw) as Partial<PlacesFile>;
    return Array.isArray(f.places) ? f.places.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  } catch {
    return [];
  }
}

export default function PlacesPanel({ worldOn }: { worldOn: boolean }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [filter, setFilter] = useState("all");
  const [went, setWent] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void placesLoad()
        .then((raw) => alive && setPlaces(parse(raw)))
        .catch(() => {});
    load();
    let unlisten: (() => void) | undefined;
    void onPlaces(load).then((u) => (alive ? (unlisten = u) : u()));
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? FILTERS[0].kinds;
    // Built places first (newest progress on top), then by when they were found.
    const rank = (p: Place) => (p.kind === "house" ? 0 : p.kind === "town" ? 1 : p.kind === "arena" ? 2 : p.kind === "settlement" ? 3 : p.kind === "biome" ? 4 : 5);
    return places.filter((p) => kinds.includes(p.kind)).sort((a, b) => rank(a) - rank(b) || (a.day ?? 0) - (b.day ?? 0));
  }, [places, filter]);
  const go = (p: Place) => {
    void placesGoto(p.x, p.y).catch(() => {});
    setWent(p.id);
  };
  return (
    <section className="tpanel">
      <h2>Saved places</h2>
      <p className="muted small">
        Everywhere the waifus have been on their adventure: biomes, towns and settlements, the boss arena and the houses they build (a big
        themed luxury house in every biome is their long-term goal). Click a place to look at it in the background world; while they play,
        click a waifu's name in the game panel to follow her again.
      </p>
      <div className="choice-row places-filters" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={`action small ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {!worldOn && <p className="muted small">Turn on "Show a Terraria world behind my windows" to look at places.</p>}
      {shown.length === 0 ? (
        <p className="muted">{places.length ? "Nothing of this kind found yet." : 'No places yet. Choose "Let the team play" and they\'ll start exploring.'}</p>
      ) : (
        <div className="places-grid">
          {shown.map((p) => {
            const pct = p.progress !== undefined ? Math.round(Math.max(0, Math.min(1, p.progress)) * 100) : null;
            return (
              <button key={p.id} className={`place-card ${went === p.id ? "selected" : ""}`} onClick={() => go(p)} disabled={!worldOn} title={`Look at ${p.name}`}>
                <div className="place-preview">{p.preview ? <img src={p.preview} alt="" /> : <span className="muted small">No preview yet</span>}</div>
                <strong>{p.name}</strong>
                <span className="place-tags">
                  <span className="place-tag">{p.label}</span>
                  <span className="place-tag kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
                </span>
                {pct !== null && (
                  <span className="place-progress" aria-label={`${pct}% built`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                )}
                <span className="skin-detail">
                  {p.status}
                  {p.day !== undefined ? ` · found on day ${p.day + 1}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Maps: the desktop environment theme. Cherry Blossom (petals, blossom garland, grass), Snow
// (snowflakes, icicles and festive lights under the menu bar, a snowbank with snowmen, snowballs,
// presents and trees by the Dock) or Chess (a dark-fantasy battlefield: chains and lanterns,
// fallen pieces and rubble by the Dock, fog, spores and drifting dust). Switching is instant and
// saved; the controls below (density, speed, wind...) apply to whichever map is on.

import { useEffect, useRef } from "react";
import { patchPrefs, type Prefs, type ThemePrefs } from "../bridge";
import { loadTexture } from "../assets/textures";
import { drawDecor, petalSprites, snowflakeSprites, type SnowArt } from "../theme/decor";
import { ChessAtmosphere } from "../theme/chessMap";
import ThemePanel from "./ThemePanel";
import PlacesPanel from "./PlacesPanel";
import WorldPanel from "./WorldPanel";

const MAPS: { id: ThemePrefs["map"]; name: string; blurb: string }[] = [
  { id: "sakura", name: "Cherry Blossom", blurb: "Pink petals, a blossoming branch under the menu bar, grass and flowers by the Dock." },
  { id: "snow", name: "Snow", blurb: "Falling snow, icicles and festive lights under the menu bar, snowmen, snowballs and presents by the Dock." },
  { id: "chess", name: "Chess", blurb: "A chess graveyard in dark sand: broken stone pieces half-buried in dunes, torn banners on the crests, lanterns in the menu bar, blowing sand and drifting ash." },
];

/** A small live preview of a map (decorations plus a few drifting particles). */
function MapPreview({ map }: { map: ThemePrefs["map"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let stop = false;
    let raf = 0;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const W = c.width;
    const H = c.height;
    const snow: SnowArt = {};
    const atmos = map === "chess" ? new ChessAtmosphere() : null;
    let t = 0;
    let plants: ImageBitmap | undefined;
    const sprites = map === "snow" ? snowflakeSprites() : petalSprites();
    const bits = Array.from({ length: 14 }, (_, i) => ({ x: (i * 37) % W, y: (i * 53) % H, k: i % sprites.length, v: 10 + (i % 5) * 4 }));
    const deco = document.createElement("canvas");
    deco.width = W;
    deco.height = H;
    const paintDeco = () => {
      const d = deco.getContext("2d")!;
      d.clearRect(0, 0, W, H);
      d.save();
      drawDecor(d, { width: W, height: H, menuBar: 10, dockEdge: "bottom", dockSize: 16 }, { garland: true, grass: true, map, plants, snow });
      d.restore();
    };
    paintDeco();
    (async () => {
      if (map === "snow") {
        const [snowman, snowball, present, tree] = await Promise.all(["Images/NPC_145", "Images/Item_949", "Images/Item_1869", "Images/Tiles_171"].map((n) => loadTexture(n)));
        Object.assign(snow, { snowman: snowman ?? undefined, snowball: snowball ?? undefined, present: present ?? undefined, tree: tree ?? undefined });
      } else if (map !== "chess") plants = (await loadTexture("Images/Tiles_3")) ?? undefined;
      if (!stop) paintDeco();
    })().catch(() => {});
    let last = performance.now();
    const frame = (now: number) => {
      if (stop) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.imageSmoothingEnabled = false;
      t += dt;
      ctx.fillStyle = map === "snow" ? "#1d2a4a" : map === "chess" ? "#141821" : "#2a2440";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e9e9ee";
      ctx.fillRect(0, 0, W, 10); // menu bar
      ctx.fillStyle = "#c8c8d2";
      ctx.fillRect(W * 0.2, H - 16, W * 0.6, 16); // Dock
      ctx.drawImage(deco, 0, 0);
      if (atmos) {
        atmos.step(dt, t, { density: 0.25, speed: 1, wind: 0.2, sway: 0.5, spin: 0.5, size: 0.6, style: "drift" }, W, H, H - 16, null);
        atmos.draw(ctx, t, W, 10, H - 16, 0.6, true, true);
        raf = requestAnimationFrame(frame);
        return;
      }
      for (const b of bits) {
        b.y += b.v * dt;
        b.x += Math.sin(now / 900 + b.k) * 6 * dt;
        if (b.y > H - 16) b.y = 10;
        ctx.drawImage(sprites[b.k], Math.round(b.x), Math.round(b.y), sprites[b.k].width * 2, sprites[b.k].height * 2);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [map]);
  return <canvas ref={ref} className="map-preview" width={240} height={130} aria-hidden="true" />;
}

/** The panel's blocks; the pause menu shows them under different sections. */
export type MapsPart = "maps" | "world" | "places" | "theme";

export default function MapsPanel({ prefs, parts }: { prefs: Prefs; parts?: MapsPart[] }) {
  const t = prefs.theme;
  const current = t.map ?? "sakura";
  const show = (part: MapsPart) => !parts || parts.includes(part);
  return (
    <>
      {show("maps") && (
      <section className="tpanel skins">
        <h2>Maps</h2>
        <div className="map-row" role="radiogroup" aria-label="Desktop map">
          {MAPS.map((m) => {
            const on = current === m.id;
            return (
              <button key={m.id} className={`skin-card map-card ${on ? "selected" : ""}`} role="radio" aria-checked={on} onClick={() => patchPrefs({ theme: { ...t, map: m.id, enabled: true } }).catch(() => {})}>
                <MapPreview map={m.id} />
                <strong>{m.name}</strong>
                <span className="skin-detail">{m.blurb}</span>
                {on && <span className="skin-badge">Selected</span>}
              </button>
            );
          })}
        </div>
        <p className="muted">
          Each map fills the menu bar with its own band (your menus and icons stay on top and clickable) and decorates the Dock edge.
          Everything is click-through. Snowmen, snowballs, presents and trees use art from your Terraria install when it's found.
        </p>
      </section>
      )}
      {show("world") && <WorldPanel prefs={prefs} />}
      {show("places") && <PlacesPanel worldOn={!!prefs.world?.enabled} />}
      {show("theme") && <ThemePanel prefs={prefs} />}
    </>
  );
}

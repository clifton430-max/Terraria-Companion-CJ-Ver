import { useEffect, useRef, useState } from "react";
import { getSkinRig, patchPrefs, type Appearance, type AppearanceColors } from "../bridge";
import { TerrariaRig } from "../overlay/terrariaRig";

const COLOR_FIELDS: [keyof AppearanceColors, string][] = [
  ["skin", "Skin"],
  ["hair", "Hair"],
  ["eyes", "Eyes"],
  ["shirt", "Shirt"],
  ["undershirt", "Undershirt"],
  ["pants", "Pants"],
  ["shoes", "Shoes"],
];

const VARIANTS = Array.from({ length: 12 }, (_, i) => i);
/** Preview animation: idle, a few walk frames and a swing. */
const PREVIEW_FRAMES = ["idle", "walk1", "walk4", "walk8", "walk11", "use1", "use3", "use4"];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(n) || lo));
const optionalId = (v: string) => (v.trim() === "" ? null : clamp(Number(v), 1, 999));

export default function AppearanceEditor({ appearance }: { appearance: Appearance }) {
  const [draft, setDraft] = useState(appearance);
  const [status, setStatus] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const saveTimer = useRef(0);

  useEffect(() => setDraft(appearance), [appearance]);

  // Live preview of the real composed character for the saved appearance.
  useEffect(() => {
    let stop = false;
    let timer = 0;
    (async () => {
      // Always preview the editable default look, whichever skin is worn.
      const info = await getSkinRig("default");
      const rig = await TerrariaRig.load(info);
      if (stop) return;
      if (!rig) {
        setStatus(`Built-in art in use: ${info.reason ?? "Terraria assets unavailable"}`);
        return;
      }
      setStatus(
        `Terraria ${info.gameVersion ?? ""} art` + (info.missing.length ? ` · missing: ${info.missing.join(", ")}` : ""),
      );
      let i = 0;
      const draw = () => {
        const c = canvasRef.current;
        if (!c || stop) return;
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        rig.draw(ctx, PREVIEW_FRAMES[i % PREVIEW_FRAMES.length], false, c.width, c.height);
        i++;
        timer = window.setTimeout(draw, 220);
      };
      draw();
    })().catch((e) => setStatus(String(e)));
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [appearance]);

  /** Update the draft immediately and persist shortly after (colour pickers fire continuously). */
  const update = (next: Appearance) => {
    setDraft(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      patchPrefs({ appearance: next }).catch((e) => setStatus(String(e)));
    }, 200);
  };

  return (
    <section className="appearance">
      <canvas ref={canvasRef} className="appearance-preview" width={120} height={168} aria-label="Character preview" />
      <div className="appearance-fields">
        <label>
          Body
          <select value={draft.skinVariant} onChange={(e) => update({ ...draft, skinVariant: Number(e.target.value) })}>
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                Variant {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hair style
          <input
            type="number"
            min={1}
            max={228}
            value={draft.hair}
            onChange={(e) => update({ ...draft, hair: clamp(Number(e.target.value), 1, 228) })}
          />
        </label>
        <div className="colors">
          {COLOR_FIELDS.map(([key, label]) => (
            <label key={key}>
              <input
                type="color"
                value={draft.colors[key]}
                onChange={(e) => update({ ...draft, colors: { ...draft.colors, [key]: e.target.value } })}
              />
              {label}
            </label>
          ))}
        </div>
        <fieldset>
          <legend>Armor (item art ids; blank = none)</legend>
          {(["head", "body", "legs"] as const).map((slot) => (
            <label key={slot}>
              {slot}
              <input
                type="number"
                min={1}
                max={999}
                value={draft.armor[slot] ?? ""}
                onChange={(e) => update({ ...draft, armor: { ...draft.armor, [slot]: optionalId(e.target.value) } })}
              />
            </label>
          ))}
          <label>
            hair under helmet
            <select
              value={draft.hairUnderHelmet}
              onChange={(e) => update({ ...draft, hairUnderHelmet: e.target.value as Appearance["hairUnderHelmet"] })}
            >
              <option value="hide">hide</option>
              <option value="alt">short (hat)</option>
              <option value="full">full</option>
            </select>
          </label>
        </fieldset>
        <p className="muted">{status}</p>
      </div>
    </section>
  );
}

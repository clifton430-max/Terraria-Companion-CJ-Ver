// Skin selector: the default appearance and skins found in installed resource packs, each with
// a live animated preview. Selecting one applies immediately (the overlay reloads its atlas).

import { useEffect, useRef, useState } from "react";
import { getSkinRig, listSkins, patchPrefs, type SkinId, type SkinInfo } from "../bridge";
import { TerrariaRig } from "../overlay/terrariaRig";
import { normalizeSkin } from "../skin/model";

const PREVIEW = ["idle", "walk1", "walk4", "walk8", "walk11", "use2", "use4", "idle"];

function SkinPreview({ id }: { id: SkinId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let stop = false;
    let timer = 0;
    (async () => {
      const info = await getSkinRig(id);
      const rig = await TerrariaRig.load(info);
      if (stop) return;
      if (!rig) return setNote(info.reason ?? "Preview unavailable");
      if (info.skinNote) setNote(info.skinNote);
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
  }, [id]);
  return (
    <>
      <canvas ref={ref} className="skin-preview" width={80} height={112} aria-hidden="true" />
      {note && <span className="skin-note">{note}</span>}
    </>
  );
}

export default function SkinPicker({ selected }: { selected: SkinId }) {
  const [skins, setSkins] = useState<SkinInfo[]>([]);
  const current = normalizeSkin(selected);
  useEffect(() => {
    listSkins().then(setSkins).catch(() => setSkins([]));
  }, []);
  return (
    <section className="tpanel skins">
      <h2>Skin</h2>
      <div className="skin-row" role="radiogroup" aria-label="Companion skin">
        {skins.map((s) => {
          const on = s.id === current;
          return (
            <button
              key={s.id}
              className={`skin-card ${on ? "selected" : ""}`}
              role="radio"
              aria-checked={on}
              disabled={!s.available}
              title={s.detail}
              onClick={() => patchPrefs({ skin: s.id }).catch(() => {})}
            >
              {s.available ? <SkinPreview id={s.id} /> : <span className="skin-missing">Not installed</span>}
              <strong>{s.name}</strong>
              <span className="skin-detail">{s.detail}</span>
              {on && <span className="skin-badge">Selected</span>}
            </button>
          );
        })}
      </div>
      
    </section>
  );
}

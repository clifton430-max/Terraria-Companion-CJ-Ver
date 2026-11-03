// The menu's figure: your selected companion hanging upside down by a rope tied round her feet,
// swaying slowly. Drawn from her own sprites (the same rig as the Character tab's previews), big
// and crisp; the swing and the drop-in are CSS (pause.css).

import { useEffect, useRef } from "react";
import { getCharacterRig, getPlayerRig, type CharacterId } from "../bridge";
import { TerrariaRig } from "../overlay/terrariaRig";

/** Her idle loop while she hangs (a breath now and then). */
const FRAMES = ["idle", "idle", "idle", "idle", "walk1", "idle", "idle", "idle"];

export default function HangingCompanion({ id, lookKey }: { id: CharacterId; lookKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let stop = false;
    let timer = 0;
    (async () => {
      const info = id === "terrarian" ? await getPlayerRig() : await getCharacterRig(id);
      const rig = await TerrariaRig.load(info);
      if (stop || !rig) return;
      let i = 0;
      const draw = () => {
        const c = ref.current;
        if (!c || stop) return;
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        rig.draw(ctx, FRAMES[i++ % FRAMES.length], false, c.width, c.height);
        timer = window.setTimeout(draw, 420);
      };
      draw();
    })().catch(() => {});
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, lookKey]);
  return (
    <div className="p3-hang" aria-hidden="true">
      <div className="p3-hang-swing">
        <span className="p3-rope" />
        <canvas ref={ref} className="p3-hang-figure" width={80} height={112} />
      </div>
    </div>
  );
}

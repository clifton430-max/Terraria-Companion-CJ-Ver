// Stay-Put: favourite spot and idle poses (rotate automatically or hold one), with previews.

import { useEffect, useRef, useState } from "react";
import { combatCommand, getSkinRig, patchPrefs, type IdlePose, type Prefs } from "../bridge";
import { IDLE_LABEL, IDLE_POSES, MAX_INTERVAL, MIN_INTERVAL, idleFrame } from "../overlay/idle";
import { TerrariaRig } from "../overlay/terrariaRig";

const save = (patch: Parameters<typeof patchPrefs>[0]) => patchPrefs(patch).catch(() => {});

function PosePreview({ rig, pose, paused }: { rig: TerrariaRig | null; pose: IdlePose; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!rig) return;
    let t = 0;
    let stop = false;
    const draw = () => {
      const c = ref.current;
      if (!c || stop) return;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      const f = idleFrame(pose, t);
      rig.draw(ctx, f.frame, f.flip, c.width, c.height);
      if (!paused) t += 0.15;
      timer = window.setTimeout(draw, 150);
    };
    let timer = 0;
    draw();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [rig, pose, paused]);
  return <canvas ref={ref} className="pose-preview" width={40} height={56} aria-hidden="true" />;
}

export default function IdlePanel({ prefs }: { prefs: Prefs }) {
  const [rig, setRig] = useState<TerrariaRig | null>(null);
  const idle = prefs.idle ?? { mode: "rotate", interval: 45, paused: false };
  useEffect(() => {
    let stop = false;
    getSkinRig(prefs.skin)
      .then((info) => TerrariaRig.load(info))
      .then((r) => !stop && setRig(r))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [prefs.skin, prefs.appearance]);
  const setIdle = (p: Partial<typeof idle>) => save({ idle: { ...idle, ...p } });

  return (
    <section className="tpanel">
      <h2>Stay put &amp; idle poses</h2>
      <div className="choice-row">
        <button className={`action ${prefs.companionMode === "stay" ? "on" : ""}`} onClick={() => save({ companionMode: prefs.companionMode === "stay" ? "roam" : "stay" })}>
          {prefs.companionMode === "stay" ? "Staying put (click to roam)" : "Roaming (click to stay put)"}
        </button>
        <button className="action small" onClick={() => combatCommand("setFavoriteSpot").catch(() => {})} title="Save where the character is right now">
          Set Favorite Spot
        </button>
        <button className="action small" disabled={!prefs.stayPosition} onClick={() => combatCommand("returnToFavorite").catch(() => {})}>
          Return to spot
        </button>
      </div>
      <div className="choice-row" role="radiogroup" aria-label="Idle pose mode">
        <button className={`action small ${idle.mode === "rotate" ? "on" : ""}`} role="radio" aria-checked={idle.mode === "rotate"} onClick={() => setIdle({ mode: "rotate" })}>
          Rotate poses
        </button>
        <button className={`action small ${idle.mode === "fixed" ? "on" : ""}`} role="radio" aria-checked={idle.mode === "fixed"} onClick={() => setIdle({ mode: "fixed" })}>
          One pose
        </button>
        <button className={`action small ${idle.paused ? "on" : ""}`} aria-pressed={idle.paused} onClick={() => setIdle({ paused: !idle.paused })}>
          {idle.paused ? "Resume animation" : "Pause animation"}
        </button>
      </div>
      <div className="pose-grid" role="radiogroup" aria-label="Idle pose">
        {IDLE_POSES.map((p) => {
          const on = idle.mode === "fixed" && prefs.idlePose === p;
          return (
            <button
              key={p}
              className={`pose-card ${on ? "selected" : ""}`}
              role="radio"
              aria-checked={on}
              title={`Hold "${IDLE_LABEL[p]}"`}
              onClick={() => save({ idlePose: p, idle: { ...idle, mode: "fixed" } })}
            >
              <PosePreview rig={rig} pose={p} paused={idle.paused} />
              <span>{IDLE_LABEL[p]}</span>
            </button>
          );
        })}
      </div>
      <label className="slider">
        Every
        <input type="range" min={MIN_INTERVAL} max={MAX_INTERVAL} step={5} value={idle.interval} disabled={idle.mode !== "rotate"} onChange={(e) => setIdle({ interval: Number(e.target.value) })} />
        <span>{idle.interval} s</span>
      </label>
      <p className="muted">
        Poses only change the drawing; the spot, physics and clicks stay the same. Drag it away and it stays where dropped; Return to
        spot (or switching Stay-Put on) goes back to the favorite.
      </p>
    </section>
  );
}

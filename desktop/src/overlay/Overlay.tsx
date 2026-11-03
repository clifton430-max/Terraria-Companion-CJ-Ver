import { useEffect, useRef, useState } from "react";
import {
  getBuildMode,
  getControlMode,
  getLinesMode,
  onBuild,
  onLines,
  getPlatforms,
  getPlayerRig,
  getCharacterRig,
  getPrefs,
  onCombat,
  onAppSwitch,
  onControl,
  onCursor,
  onReactionPreview,
  onVoiceKey,
  onDestroyer,
  onPlatforms,
  onPrefs,
  onWorldPlay,
  onCompanionSay,
  onWisprDictate,
  onWisprDictation,
  onWisprProblem,
  getWorldPlay,
  type Prefs,
} from "../bridge";
import { Companion } from "./companion";
import { TerrariaRig } from "./terrariaRig";
import { rigKey } from "../skin/model";
import { prettyShortcut } from "../voice/shortcut";
import { keyLabel, normalizeKeys, type SilkKeys } from "../silk/keys";
import { DEFAULT_TERRARIA_KEYS, normalizeTerrariaKeys, type TerrariaKeys } from "./controls";
import { textureUrl } from "../assets/textures";
import { BLOCK_ART, BLOCK_KINDS } from "../engine/blocks";
import type { BuildStatus } from "./buildLayer";
import type { LineStatus } from "./lineLayer";
import "./overlay.css";

export default function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const [control, setControl] = useState(false);
  const [toggleKey, setToggleKey] = useState<string | null>(null);
  const [silkKeys, setSilkKeys] = useState<SilkKeys | null>(null);
  const [tKeys, setTKeys] = useState<TerrariaKeys>(DEFAULT_TERRARIA_KEYS);
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const [buildKey, setBuildKey] = useState<string | null>(null);
  const [lines, setLines] = useState<LineStatus | null>(null);
  const [linesKey, setLinesKey] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let companion: Companion | undefined;
    let appearanceKey = "";
    let rigRequest = 0;
    const unlisteners: (() => void)[] = [];

    /** (Re)load the real Terraria character for the saved appearance; falls back silently. */
    const loadRig = async (prefs: Prefs) => {
      // The atlas depends on the appearance and the skin (switching applies immediately).
      // The atlas depends on the selected character too (Ryuko, Satsuki, Goblin Girl or the original).
      const selected = prefs.characters?.selected ?? "terrarian";
      const look = prefs.characters?.per.find((c) => c.id === selected)?.look;
      const key = `${rigKey(prefs.appearance, prefs.skin)}|${selected}|${JSON.stringify(look ?? null)}`;
      if (key === appearanceKey) return;
      appearanceKey = key;
      const request = ++rigRequest;
      try {
        const info = selected === "terrarian" ? await getPlayerRig() : await getCharacterRig(selected);
        const rig = await TerrariaRig.load(info);
        if (disposed || request !== rigRequest) return;
        if (!rig) console.info("Using built-in art:", info.reason ?? "atlas unavailable");
        if (info.skinNote) console.info(info.skinNote);
        companion?.setRig(rig);
      } catch (e) {
        console.warn("Terraria rig failed to load; using built-in art", e);
      }
    };

    (async () => {
      const prefs = await getPrefs();
      if (disposed || !canvasRef.current || !fxRef.current) return;
      setToggleKey(prefs.control?.toggleEnabled ? prefs.control.toggleShortcut : null);
      setSilkKeys(prefs.control?.scheme === "silksong" ? normalizeKeys(prefs.control.silkKeys) : null);
      setTKeys(normalizeTerrariaKeys(prefs.control?.terrariaKeys));
      setBuildKey(prefs.build?.toggleEnabled ? prefs.build.toggleShortcut : null);
      companion = new Companion(canvasRef.current, fxRef.current, prefs);
      companion.onBuildStatus = (st) => setBuild(st);
      companion.onLineStatus = (st) => setLines(st);
      setLinesKey(prefs.lines?.toggleEnabled ? prefs.lines.toggleShortcut : null);
      const stops = await Promise.all([
        onPrefs((p) => {
          setToggleKey(p.control?.toggleEnabled ? p.control.toggleShortcut : null);
          setSilkKeys(p.control?.scheme === "silksong" ? normalizeKeys(p.control.silkKeys) : null);
          setTKeys(normalizeTerrariaKeys(p.control?.terrariaKeys));
          setBuildKey(p.build?.toggleEnabled ? p.build.toggleShortcut : null);
          setLinesKey(p.lines?.toggleEnabled ? p.lines.toggleShortcut : null);
          companion?.applyPrefs(p);
          void loadRig(p);
        }),
        onCombat((c) => companion?.handleCombatCommand(c)),
        onPlatforms((windows) => companion?.setWindows(windows)),
        onCursor((pos) => companion?.setPointer(pos)),
        onAppSwitch((ev) => companion?.onAppSwitch(ev)),
        onReactionPreview((rule) => companion?.previewReaction(rule)),
        onVoiceKey((state) => companion?.onVoiceKey(state)),
        onDestroyer((ev) => companion?.onDestroyer(ev)),
        onControl((enabled) => {
          companion?.setControl(enabled);
          setControl(enabled);
        }),
        onBuild((enabled) => companion?.setBuild(enabled)),
        onLines((enabled) => companion?.setLinesEdit(enabled)),
        // Playing the background world: she (or everyone, when they build) steps into it.
        onWorldPlay((on, mode) => companion?.setInGame(on ? mode : null)),
        onCompanionSay((text) => companion?.say(text)),
        onWisprDictate(() => companion?.onWisprDictate()),
        onWisprProblem((s) => companion?.onWisprProblem(s)),
        onWisprDictation((d) => companion?.onWisprDictation(d)),
      ]);
      if (disposed) stops.forEach((stop) => stop());
      else unlisteners.push(...stops);
      // Fetch after subscribing so no snapshot is missed in between.
      const [windows, controlOn, buildOn, linesOn] = await Promise.all([getPlatforms(), getControlMode(), getBuildMode(), getLinesMode()]);
      if (disposed) return;
      companion.setWindows(windows);
      companion.setControl(controlOn);
      companion.setBuild(buildOn);
      companion.setLinesEdit(linesOn);
      if (await getWorldPlay().catch(() => false)) companion.setInGame("player");
      setControl(controlOn);
      void loadRig(prefs);
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((stop) => stop());
      companion?.destroy();
    };
  }, []);

  return (
    <>
      {build?.active && (
        <div className={`control-hud build-hud${control ? " below" : ""}`} role="status">
          Build mode ·
          {BLOCK_KINDS.map((k, i) => (
            <span key={k} className={`block-slot${build.kind === k ? " selected" : ""}`}>
              <kbd>{i + 1}</kbd>
              <img src={textureUrl(BLOCK_ART[k].item)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
              {BLOCK_ART[k].name}
            </span>
          ))}
          · click place · right-click / ⇧-click remove · {build.count}/{build.max} ·{" "}
          {build.note ? <span className="note">{build.note}</span> : (
            <>
              <kbd>Esc</kbd>
              {buildKey && (
                <>
                  {" "}or <kbd>{prettyShortcut(buildKey)}</kbd>
                </>
              )}{" "}
              to stop
            </>
          )}
        </div>
      )}
      {lines?.active && (
        <div className={`control-hud build-hud${control ? " below" : ""}`} role="status">
          Invisible platforms · drag to draw (⇧ snaps to 15°) · drag a line to move, an end to resize · right-click or Delete removes · arrows
          nudge · {lines.count}/{lines.max} ·{" "}
          {lines.note ? (
            <span className="note">{lines.note}</span>
          ) : (
            <>
              <kbd>Esc</kbd>
              {linesKey && (
                <>
                  {" "}or <kbd>{prettyShortcut(linesKey)}</kbd>
                </>
              )}{" "}
              to stop
            </>
          )}
        </div>
      )}
      <canvas ref={canvasRef} className="companion" aria-label="Desktop companion" />
      <canvas ref={fxRef} className="fx" aria-hidden="true" />
      {control && (
        <div className="control-hud" role="status">
          {silkKeys ? (
            <>
              Silksong controls · <kbd>{keyLabel(silkKeys.left)}</kbd>/<kbd>{keyLabel(silkKeys.right)}</kbd> run · <kbd>{keyLabel(silkKeys.jump)}</kbd> jump
              (again: double, hold: glide) · <kbd>{keyLabel(silkKeys.dash)}</kbd> dash · <kbd>{keyLabel(silkKeys.attack)}</kbd>/click attack with equipped item ·{" "}
              <kbd>{keyLabel(silkKeys.down)}</kbd>+direction+attack diagonal pogo · <kbd>{keyLabel(silkKeys.dive)}</kbd> dive · <kbd>{keyLabel(silkKeys.thread)}</kbd> Thread ·{" "}
              <kbd>{keyLabel(silkKeys.grapple)}</kbd> Clawline · <kbd>1</kbd>–<kbd>0</kbd> select · <kbd>Esc</kbd>
            </>
          ) : (
            <>
              Controlling character · <kbd>{keyLabel(tKeys.left)}</kbd>/<kbd>{keyLabel(tKeys.right)}</kbd> move · <kbd>{keyLabel(tKeys.jump)}</kbd> jump ·{" "}
              <kbd>{keyLabel(tKeys.down)}</kbd> drop · click to use item · wheel or{" "}
              <kbd>1</kbd>–<kbd>0</kbd> select · <kbd>Esc</kbd>
            </>
          )}
          {toggleKey && (
            <>
              {" "}or <kbd>{prettyShortcut(toggleKey)}</kbd>
            </>
          )}{" "}
          to stop
        </div>
      )}
    </>
  );
}

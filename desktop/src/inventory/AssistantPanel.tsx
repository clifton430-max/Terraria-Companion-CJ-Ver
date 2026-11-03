// Assistant settings (local model, answer length, provider status) and voice-input preferences.
// The global shortcut is registered by Rust only while voice input is enabled.

import { useEffect, useState } from "react";
import { aiStatus, patchPrefs, voiceShortcutStatus, type AiStatus, type AnswerLength, type Prefs } from "../bridge";
import ShortcutField from "./ShortcutField";
import { appShortcuts } from "../voice/shortcut";
import { displayName } from "../characters/roster";

const save = (patch: Parameters<typeof patchPrefs>[0]) => patchPrefs(patch).catch(() => {});
const LENGTHS: [AnswerLength, string][] = [
  ["short", "Short"],
  ["medium", "Medium"],
  ["long", "Long"],
];

export default function AssistantPanel({ prefs }: { prefs: Prefs }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [shortcutStatus, setShortcutStatus] = useState("");
  const ai = prefs.ai;
  const v = prefs.voiceInput;
  const wispr = (v.source ?? "wispr") === "wispr";

  useEffect(() => {
    aiStatus().then(setStatus).catch(() => {});
    // Listing devices never prompts; names appear once microphone access has been granted.
    navigator.mediaDevices?.enumerateDevices?.().then((d) => setMics(d.filter((x) => x.kind === "audioinput"))).catch(() => setMics([]));
  }, []);

  // Registration happens in Rust when the prefs change; read back whether it worked.
  useEffect(() => {
    const t = window.setTimeout(() => voiceShortcutStatus().then(setShortcutStatus).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [v.enabled, v.shortcut]);


  return (
    <section className="tpanel">
      <h2>Assistant &amp; voice input</h2>
      <div className="choice-row">
        <span className="label">Provider</span>
        <span className={`perm ${status?.available ? "ok" : "off"}`} title={status?.reason ?? ""}>
          {status === null ? "Checking…" : status.available ? "Ollama on this Mac (no API key needed)" : `Unavailable: ${status.reason ?? "not running"}`}
        </span>
      </div>
      <label className="slider">
        Model
        <select value={ai.model} onChange={(e) => save({ ai: { ...ai, model: e.target.value } })}>
          <option value="auto">Auto{status?.model ? ` (${status.model})` : ""}</option>
          {(status?.models ?? []).map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.vision ? " · can see images" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="choice-row" role="radiogroup" aria-label="Answer length">
        <span className="label">Answers</span>
        {LENGTHS.map(([id, label]) => (
          <button key={id} className={`action small ${ai.length === id ? "on" : ""}`} role="radio" aria-checked={ai.length === id} onClick={() => save({ ai: { ...ai, length: id } })}>
            {label}
          </button>
        ))}
      </div>

      <h3>Voice input</h3>
      <label className="check">
        <input type="checkbox" checked={v.enabled} onChange={(e) => save({ voiceInput: { ...v, enabled: e.target.checked } })} />
        Enable voice input
      </label>
      <div className="choice-row" role="radiogroup" aria-label="Where voice comes from">
        <button className={`action small ${wispr ? "on" : ""}`} role="radio" aria-checked={wispr} onClick={() => save({ voiceInput: { ...v, source: "wispr" } })}>
          Wispr Flow
        </button>
        <button className={`action small ${wispr ? "" : "on"}`} role="radio" aria-checked={!wispr} onClick={() => save({ voiceInput: { ...v, source: "apple" } })}>
          Apple Speech push-to-talk
        </button>
      </div>
      {wispr && (
        <p className="muted">
          Wispr Flow does the listening. Press its key (fn, unless you changed it) with no text field focused and my input opens, so your
          words land with me; or start with my name ("Hey {displayName(prefs.characters.selected, prefs.characters)}, …") anywhere and I'll take it back out of the other app
          and answer. The shortcut below opens my input too. If Wispr Flow isn't installed or running, I'll tell you when you press the
          key (nothing else listens instead). Catching its key and taking text back need Accessibility permission.
        </p>
      )}
      <div className="choice-row">
        <span className="label">Shortcut</span>
        <ShortcutField value={v.shortcut} others={appShortcuts(prefs, "Voice input")} defaultValue="Control+Shift+Space" onChange={(s) => save({ voiceInput: { ...v, shortcut: s } })} />
        <div className="choice-row" role="radiogroup" aria-label="Recording mode" hidden={wispr}>
          <button className={`action small ${v.mode === "hold" ? "on" : ""}`} role="radio" aria-checked={v.mode === "hold"} onClick={() => save({ voiceInput: { ...v, mode: "hold" } })}>
            Hold to talk
          </button>
          <button className={`action small ${v.mode === "toggle" ? "on" : ""}`} role="radio" aria-checked={v.mode === "toggle"} onClick={() => save({ voiceInput: { ...v, mode: "toggle" } })}>
            Press to toggle
          </button>
        </div>
      </div>
      {v.enabled && shortcutStatus && <p className={`muted ${shortcutStatus.startsWith("Shortcut active") ? "" : "warn"}`}>{shortcutStatus}</p>}
      <label className="check">
        <input type="checkbox" checked={v.autoSubmit ?? true} onChange={(e) => save({ voiceInput: { ...v, autoSubmit: e.target.checked } })} />
        Send automatically when I stop talking
      </label>
      {!wispr && (
        <>
          <label className="slider">
            Silence
            <input
              type="range"
              min={1}
              max={6}
              step={0.5}
              value={v.silence ?? 2}
              disabled={!(v.autoSubmit ?? true)}
              onChange={(e) => save({ voiceInput: { ...v, silence: Number(e.target.value) } })}
            />
            <span>{(v.silence ?? 2).toFixed(1)} s</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={v.review} disabled={v.autoSubmit ?? true} onChange={(e) => save({ voiceInput: { ...v, review: e.target.checked } })} />
            Let me check and edit what I said before it's sent (when not sending automatically)
          </label>
          <p className="muted">
            With automatic sending, I start listening as soon as voice input starts, show what I'm hearing, and send it after that many seconds of
            silence. Press <b>Send now</b> or <b>Cancel</b> anytime, and use <b>Edit &amp; resend</b> on the answer to fix a mis-heard word. The
            microphone is only on while the card says "Listening".
          </p>
        </>
      )}
      {!wispr && (
        <>
          <label className="slider">
            Mic
            <select value={v.microphone} onChange={(e) => save({ voiceInput: { ...v, microphone: e.target.value } })}>
              <option value="default">System default</option>
              {mics
                .filter((m) => m.deviceId && m.deviceId !== "default")
                .map((m, i) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label || `Microphone ${i + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">
            The microphone is used only while you hold (or toggle) the shortcut, or press Start voice input in the right-click menu; a red
            "Listening" card shows the whole time. Speech is turned into text by Apple's speech recognition (on this Mac when supported), and
            the recording is discarded straight after. macOS asks once for Microphone and Speech Recognition access. Microphone names appear
            after access is granted.
          </p>
        </>
      )}
    </section>
  );
}

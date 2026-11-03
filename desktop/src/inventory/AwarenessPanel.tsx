// Screen Awareness & Privacy, plus the per-app reaction rules editor.

import { useEffect, useState } from "react";
import {
  chatCancel,
  chatHistoryClear,
  openPrivacySettings,
  patchPrefs,
  previewReaction,
  requestScreenPermission,
  runningApps,
  screenStatus,
  showChat,
  type AppInfo,
  type AwarenessPrefs,
  type Prefs,
  type ReactionAnimation,
  type ReactionRule,
  type ReactionVoice,
  type ScreenStatus,
} from "../bridge";
import { newRule } from "../reactions/engine";
import AssistantPanel from "./AssistantPanel";

const VOICES: [ReactionVoice, string][] = [
  ["none", "No voice"],
  ["random", "Random voice line"],
  ["hit0", "Voice line 1"],
  ["hit1", "Voice line 2"],
  ["hit2", "Voice line 3"],
  ["killed", "Voice line 4"],
];
const ANIMATIONS: [ReactionAnimation, string][] = [
  ["none", "No pose"],
  ["wave", "Wave"],
  ["jump", "Hop"],
  ["hug", "Lean In"],
  ["sit", "Sit"],
  ["nap", "Nap"],
];

const save = (patch: Parameters<typeof patchPrefs>[0]) => patchPrefs(patch).catch(() => {});

function Privacy({ a, prefs, apps }: { a: AwarenessPrefs; prefs: Prefs; apps: AppInfo[] }) {
  const [screen, setScreen] = useState<ScreenStatus | null>(null);
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState("");
  const set = (p: Partial<AwarenessPrefs>) => save({ awareness: { ...a, ...p } });
  useEffect(() => {
    const check = () => screenStatus().then(setScreen).catch(() => {});
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [a.screenEnabled]);
  const appName = (id: string) => apps.find((x) => x.bundleId === id)?.name ?? id;

  return (
    <section className="tpanel">
      <h2>Screen Awareness &amp; Privacy</h2>
      <label className="check" title="Reads only which app is in front (its bundle id and name). No screenshots, titles or history.">
        <input type="checkbox" checked={a.appEnabled} onChange={(e) => set({ appEnabled: e.target.checked })} />
        React when I switch apps
      </label>
      <label className="check" title="Lets you press 'Ask about my screen' in the chat. One screenshot per question, discarded afterwards.">
        <input type="checkbox" checked={a.screenEnabled} onChange={(e) => set({ screenEnabled: e.target.checked })} />
        Allow "Ask about my screen" (screen understanding)
      </label>
      {a.screenEnabled && screen && (
        <div className="choice-row">
          <span className={`perm ${screen.permission ? "ok" : "off"}`}>
            Screen Recording permission: {screen.permission ? "granted" : "not granted"}
          </span>
          {!screen.permission && (
            <>
              <button className="action small" onClick={() => requestScreenPermission().then(() => screenStatus().then(setScreen)).catch(() => {})}>
                Ask macOS
              </button>
              <button className="action small" onClick={() => openPrivacySettings().catch(() => {})}>
                Open System Settings
              </button>
            </>
          )}
        </div>
      )}
      <div className="choice-row">
        <label className="check">
          <input type="checkbox" checked={a.quiet} onChange={(e) => set({ quiet: e.target.checked })} />
          Quiet mode (no spoken reactions)
        </label>
        <label className="check">
          <input type="checkbox" checked={a.quietText} disabled={!a.quiet} onChange={(e) => set({ quietText: e.target.checked })} />
          also hide speech bubbles
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.audio.muted} onChange={(e) => save({ audio: { ...prefs.audio, muted: e.target.checked } })} />
          Mute all sound
        </label>
      </div>
      <label className="check" title="Off: screenshots exist only in memory while the question is answered.">
        <input type="checkbox" checked={a.keepScreenshots} onChange={(e) => set({ keepScreenshots: e.target.checked })} />
        Keep small screenshot previews in the chat
      </label>
      <label className="check" title="Off: the chat is forgotten when the app quits (and any saved copy is deleted).">
        <input type="checkbox" checked={a.keepHistory} onChange={(e) => set({ keepHistory: e.target.checked })} />
        Keep chat history between launches
      </label>
      <div className="choice-row">
        <button
          className="action small"
          onClick={() => {
            chatCancel().catch(() => {});
            setNotice("Any running question or screen analysis was cancelled.");
          }}
        >
          Cancel screen analysis
        </button>
        <button
          className="action small"
          onClick={() => {
            chatHistoryClear().catch(() => {});
            setNotice("Saved chat history deleted. (Clear the open chat with its Clear button.)");
          }}
        >
          Clear saved chat history
        </button>
        <button className="action small" onClick={() => showChat().catch(() => {})}>
          Open chat
        </button>
      </div>
      {notice && <p className="muted">{notice}</p>}
      <h3>Excluded apps (never reacted to or captured)</h3>
      <ul className="excluded">
        {a.excluded.map((id) => (
          <li key={id}>
            <span title={id}>{appName(id)}</span>
            <button className="action small" title="Stop excluding" onClick={() => set({ excluded: a.excluded.filter((x) => x !== id) })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="choice-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="App to exclude">
          <option value="">Choose a running app…</option>
          {apps
            .filter((x) => !a.excluded.includes(x.bundleId))
            .map((x) => (
              <option key={x.bundleId} value={x.bundleId}>
                {x.name}
              </option>
            ))}
        </select>
        <button className="action small" disabled={!pick} onClick={() => (set({ excluded: [...a.excluded, pick] }), setPick(""))}>
          Exclude
        </button>
      </div>
      <p className="muted">
        Never used: keystrokes, clipboard, window titles, page contents or accessibility data. No activity history is kept. Screenshots
        are refused while an excluded app is in front or a password field is active.
      </p>
    </section>
  );
}

function RuleEditor({ rule, onChange, onDelete }: { rule: ReactionRule; onChange: (r: ReactionRule) => void; onDelete: () => void }) {
  const [comments, setComments] = useState(rule.comments.join("\n"));
  useEffect(() => setComments(rule.comments.join("\n")), [rule.comments]);
  return (
    <div className="rule-edit">
      <label className="field">
        Comments (one per line, picked at random)
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          onBlur={() => onChange({ ...rule, comments: comments.split("\n").map((c) => c.trim()).filter(Boolean) })}
          rows={4}
        />
      </label>
      <div className="choice-row">
        <select value={rule.voice} onChange={(e) => onChange({ ...rule, voice: e.target.value as ReactionVoice })} aria-label="Voice line">
          {VOICES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={rule.animation} onChange={(e) => onChange({ ...rule, animation: e.target.value as ReactionAnimation })} aria-label="Pose">
          {ANIMATIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <label className="slider">
        Cooldown
        <input type="range" min={1} max={240} step={1} value={Math.round(rule.cooldown / 60)} onChange={(e) => onChange({ ...rule, cooldown: Number(e.target.value) * 60 })} />
        <span>{Math.round(rule.cooldown / 60)} min</span>
      </label>
      <label className="slider">
        Frequency
        <input type="range" min={0.05} max={1} step={0.05} value={rule.chance} onChange={(e) => onChange({ ...rule, chance: Number(e.target.value) })} />
        <span>{Math.round(rule.chance * 100)}%</span>
      </label>
      <div className="choice-row">
        <label className="check">
          <input type="checkbox" checked={rule.quiet} onChange={(e) => onChange({ ...rule, quiet: e.target.checked })} />
          Quiet (text only)
        </label>
        <label className="check" title="Normally switching between windows of the same app is ignored.">
          <input type="checkbox" checked={rule.windowSwitches} onChange={(e) => onChange({ ...rule, windowSwitches: e.target.checked })} />
          Also react to window switches
        </label>
        <button className="action small danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className="muted">Reactions are shown as text only; the team never uses voices in this version.</p>
    </div>
  );
}

/** The panel's blocks; the pause menu shows them under different sections. */
export type AwarenessPart = "assistant" | "screen" | "reactions";

export default function AwarenessPanel({ prefs, parts }: { prefs: Prefs; parts?: AwarenessPart[] }) {
  const show = (part: AwarenessPart) => !parts || parts.includes(part);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  useEffect(() => {
    runningApps().then(setApps).catch(() => {});
  }, []);
  const rules = prefs.reactions;
  const setRules = (next: ReactionRule[]) => save({ reactions: next });
  const update = (r: ReactionRule) => setRules(rules.map((x) => (x.id === r.id ? r : x)));
  const add = () => {
    const app = adding === "*" ? { bundleId: "*", name: "Any other app" } : apps.find((x) => x.bundleId === adding);
    if (!app || rules.some((r) => r.bundleId === app.bundleId)) return;
    const r = newRule(app, rules);
    setRules([...rules, r]);
    setOpen(r.id);
    setAdding("");
  };

  return (
    <div className="awareness-panel">
      {show("assistant") && <AssistantPanel prefs={prefs} />}
      {show("screen") && <Privacy a={prefs.awareness} prefs={prefs} apps={apps} />}
      {show("reactions") && (
      <section className="tpanel">
        <h2>App reactions</h2>
        <p className="muted">
          When you switch to an app (and stay for a moment), the companion may say something. Each app has its own cooldown; there's also
          at least 90 s between any two reactions.
        </p>
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.id} className={r.enabled ? "" : "disabled"}>
              <div className="rule-row">
                <input type="checkbox" checked={r.enabled} onChange={(e) => update({ ...r, enabled: e.target.checked })} aria-label={`Enable ${r.name}`} />
                <button className="rule-name" onClick={() => setOpen(open === r.id ? null : r.id)} title={r.bundleId}>
                  {r.bundleId === "*" ? "★ " : ""}
                  {r.name}
                  <span className="muted"> · {r.comments.length} comment{r.comments.length === 1 ? "" : "s"}</span>
                </button>
                <button className="action small" onClick={() => previewReaction(r).catch(() => {})} title="Show this reaction now">
                  Preview
                </button>
              </div>
              {open === r.id && <RuleEditor rule={r} onChange={update} onDelete={() => setRules(rules.filter((x) => x.id !== r.id))} />}
            </li>
          ))}
        </ul>
        <div className="choice-row">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="App for a new rule">
            <option value="">Add a rule for…</option>
            {!rules.some((r) => r.bundleId === "*") && <option value="*">Any other app (fallback)</option>}
            {apps
              .filter((x) => !rules.some((r) => r.bundleId === x.bundleId))
              .map((x) => (
                <option key={x.bundleId} value={x.bundleId}>
                  {x.name}
                </option>
              ))}
          </select>
          <button className="action small" disabled={!adding} onClick={add}>
            Add
          </button>
        </div>
      </section>
      )}
    </div>
  );
}

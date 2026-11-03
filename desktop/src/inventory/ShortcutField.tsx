// Click-then-press shortcut capture, shared by every companion shortcut setting. While recording,
// all global shortcuts are paused (so any combination can be captured without triggering it),
// the current binding is shown, conflicts are explained, and Reset restores the default.

import { useEffect, useState } from "react";
import { suspendShortcuts } from "../bridge";
import { prettyShortcut, shortcutConflictWith, shortcutFromEvent, type OtherShortcut } from "../voice/shortcut";

export default function ShortcutField({
  value,
  others,
  defaultValue,
  onChange,
}: {
  value: string;
  /** Other active companion shortcuts (to detect clashes). */
  others: readonly OtherShortcut[];
  defaultValue?: string;
  onChange: (s: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Pause global shortcuts while recording, and always resume afterwards.
  useEffect(() => {
    if (!capturing) return;
    suspendShortcuts(true).catch(() => {});
    return () => {
      suspendShortcuts(false).catch(() => {});
    };
  }, [capturing]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      // Captured here only: these presses never trigger the inventory's own shortcuts.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      const s = shortcutFromEvent(e);
      if (!s) return; // wait for a full combination
      const why = shortcutConflictWith(s, others);
      setProblem(why);
      if (!why) {
        onChange(s);
        setCapturing(false);
      }
    };
    const onBlur = () => setCapturing(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [capturing, others, onChange]);

  const resetProblem = defaultValue ? shortcutConflictWith(defaultValue, others) : null;
  return (
    <>
      <button className={`action small ${capturing ? "on" : ""}`} onClick={() => (setProblem(null), setCapturing(!capturing))} title="Click, then press the key combination (Esc cancels)">
        {capturing ? "Press keys… (Esc to cancel)" : prettyShortcut(value)}
      </button>
      {defaultValue && value !== defaultValue && !capturing && (
        <button
          className="action small"
          title={resetProblem ?? `Back to ${prettyShortcut(defaultValue)}`}
          onClick={() => {
            if (resetProblem) setProblem(resetProblem);
            else {
              setProblem(null);
              onChange(defaultValue);
            }
          }}
        >
          Reset to {prettyShortcut(defaultValue)}
        </button>
      )}
      {problem && <span className="muted warn">{problem}</span>}
    </>
  );
}

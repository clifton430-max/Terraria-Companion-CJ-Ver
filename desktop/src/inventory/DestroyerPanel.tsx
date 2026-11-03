// Settings section for the Letter Destroyer bookmarklet: install link, code to copy, and the
// optional local connection to the desktop buddy.

import { useEffect, useMemo, useState } from "react";
import { destroyerStatus, patchPrefs, type Prefs } from "../bridge";
import { bookmarkletCode, bookmarkletUrl } from "../bookmarklet/bookmarklet";

export default function DestroyerPanel({ prefs }: { prefs: Prefs }) {
  const url = useMemo(() => bookmarkletUrl(), []);
  const code = useMemo(() => "javascript:" + bookmarkletCode(), []);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState("");
  const connect = prefs.destroyer?.connect ?? true;

  useEffect(() => {
    const t = window.setTimeout(() => destroyerStatus().then(setStatus).catch(() => {}), 700);
    return () => clearTimeout(t);
  }, [connect]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied("Copied! Paste it as a bookmark's URL."))
      .catch(() => setCopied("Couldn't copy automatically. Select the text below and press ⌘C."));
  };

  return (
    <section className="tpanel">
      <h2>Letter Destroyer bookmarklet</h2>
      <p className="muted">
        Smash letters on any webpage: they fly off with physics, and refreshing the page (or pressing Esc) puts everything back. It's
        purely visual and never changes pages, URLs, bookmarks or settings.
      </p>
      <div className="choice-row">
        {/* Drag this link to the browser's bookmarks bar. Clicking it here does nothing. */}
        <a className="bookmarklet" href={url} onClick={(e) => e.preventDefault()} draggable title="Drag me to your browser's bookmarks bar">
          ★ Letter Destroyer
        </a>
        <button className="action small" onClick={copy}>
          Copy bookmarklet
        </button>
      </div>
      {copied && <p className="muted">{copied}</p>}
      <ol className="muted steps">
        <li>Show your bookmarks bar (Chrome/Safari: ⌘⇧B).</li>
        <li>Drag the ★ Letter Destroyer link onto it, or make a new bookmark and paste the copied code as its URL.</li>
        <li>On any page, click the bookmark, then click text or small things to smash them. Esc, × or clicking the bookmark again stops it.</li>
      </ol>
      <textarea className="code" readOnly value={code} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Bookmarklet code" />
      <label className="check" title="The bookmarklet sends only 'started', 'smashed N letters' or 'stopped' to 127.0.0.1. Never page text or addresses.">
        <input type="checkbox" checked={connect} onChange={(e) => patchPrefs({ destroyer: { connect: e.target.checked } }).catch(() => {})} />
        Let the bookmarklet tell my companion when I smash things
      </label>
      {connect && status && <p className="muted">{status}</p>}
      <p className="muted">
        Doesn't run on browser pages such as chrome:// pages, the new-tab page or the extension store (browsers block bookmarklets
        there). The buddy link may need the browser's permission to reach this Mac (local network access); the effect works either way.
      </p>
    </section>
  );
}

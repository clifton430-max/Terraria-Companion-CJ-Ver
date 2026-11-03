// The chat window: general questions to the local model, plus a separate, clearly labelled
// "Ask about my screen" action that only works after the user opts in and grants permission.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  combatCommand,
  aiStatus,
  chatAsk,
  chatCancel,
  chatHistoryClear,
  chatHistoryLoad,
  chatHistorySave,
  getPrefs,
  hideChat,
  onChatAppend,
  onChatCommand,
  onPrefs,
  openPrivacySettings,
  requestScreenPermission,
  screenStatus,
  showInventory,
  type AiStatus,
  type ChatFailure,
  type Prefs,
  type ScreenStatus,
} from "../bridge";
import { UI_VARS } from "../inventory/icons";
import { MAX_INPUT, canSend, chatReducer, emptyChat, providerMessages, storableMessages } from "./model";
import { emptyRouter, route, routeText } from "../assistant/router";
import { appDeps } from "../assistant/deps";
import { sentiment } from "../affection/model";
import "./chat.css";

let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${++seq}`;

function asFailure(e: unknown): ChatFailure {
  if (e && typeof e === "object" && "kind" in e && "message" in e) return e as ChatFailure;
  return { kind: "error", message: String(e) };
}

export default function Chat() {
  const [state, dispatch] = useReducer(chatReducer, undefined, emptyChat);
  const [text, setText] = useState("");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [screen, setScreen] = useState<ScreenStatus | null>(null);
  const [screenHelp, setScreenHelp] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const screenRef = useRef<() => void>(() => {});
  const loaded = useRef(false);

  const refresh = useCallback(() => {
    aiStatus().then(setStatus).catch((e) => setStatus({ available: false, provider: "Ollama", models: [], model: null, reason: String(e) }));
    screenStatus().then(setScreen).catch(() => setScreen(null));
  }, []);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    getPrefs()
      .then((p) => {
        if (disposed) return;
        setPrefs(p);
        if (p.awareness.keepHistory)
          chatHistoryLoad()
            .then((m) => {
              if (!loaded.current) dispatch({ type: "load", messages: m });
              loaded.current = true;
            })
            .catch(() => {});
        else loaded.current = true;
      })
      .catch(() => {});
    onPrefs(setPrefs).then((s) => (disposed ? s() : (stop = s)));
    refresh();
    // Re-check permission/model when the window regains focus (e.g. after System Settings).
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  // Save only when history keeping is on (Rust also enforces this).
  useEffect(() => {
    if (!prefs || !loaded.current) return;
    const a = prefs.awareness;
    if (a.keepHistory) chatHistorySave(storableMessages(state.entries, true, a.keepScreenshots)).catch(() => {});
  }, [state.entries, prefs]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [state.entries, state.pending]);

  const routerRef = useRef(emptyRouter());
  const ask = async (question: string, withScreen: boolean) => {
    if (!canSend(state, question)) return;
    const id = nextId();
    const history = providerMessages(state.entries);
    dispatch({ type: "send", id, text: question, screen: withScreen });
    setText("");
    // Affection: talking to her counts; kind or rude words count more (the overlay keeps the meter).
    const mood = sentiment(question);
    combatCommand(mood === "kind" ? "affectionKind" : mood === "rude" ? "affectionRude" : "affectionChat").catch(() => {});
    if (!withScreen) {
      // Companion requests ("turn on roam mode") are done by the app and reported honestly;
      // anything else is a question for the assistant (with a screenshot if it's about the screen).
      try {
        const r = await route(question, routerRef.current, appDeps());
        routerRef.current = r.state;
        if (r.route.kind !== "ask") {
          dispatch({ type: "reply", id, text: routeText(r.route), thumbnail: null });
          return;
        }
        if (r.route.screen) {
          withScreen = true;
          dispatch({ type: "markScreen", id });
        }
      } catch {
        // Routing failed: answer it as a normal question.
      }
    }
    try {
      const reply = await chatAsk(id, [...history, { role: "user", content: question.trim().slice(0, MAX_INPUT) }], withScreen);
      dispatch({ type: "reply", id, text: reply.text, thumbnail: reply.thumbnail });
    } catch (e) {
      dispatch({ type: "fail", id, failure: asFailure(e) });
      if (withScreen) refresh();
    }
  };

  const askScreen = () => {
    if (!prefs?.awareness.screenEnabled || !screen?.permission) {
      setScreenHelp(true);
      return;
    }
    void ask(text.trim() || "What's on my screen right now? Anything I should know?", true);
  };

  const cancel = () => {
    if (state.pending) chatCancel(state.pending.id).catch(() => {});
  };

  const clear = () => {
    cancel();
    dispatch({ type: "clear" });
    chatHistoryClear().catch(() => {});
  };

  screenRef.current = askScreen;

  // Commands from the character's right-click menu.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    let stopAppend: (() => void) | undefined;
    onChatCommand((cmd) => {
      if (cmd === "focus") inputRef.current?.focus();
      else screenRef.current();
    }).then((s) => (disposed ? s() : (stop = s)));
    onChatAppend((qa) => dispatch({ type: "append", question: qa.question, answer: qa.answer })).then((s) => (disposed ? s() : (stopAppend = s)));
    return () => {
      disposed = true;
      stop?.();
      stopAppend?.();
    };
  }, []);

  const busy = state.pending !== null;
  const screenReady = !!prefs?.awareness.screenEnabled && !!screen?.permission;

  return (
    <main className="chat" style={UI_VARS}>
      <header className="chat-head">
        <strong>Chat</strong>
        <span className={`ai-status ${status?.available ? "ok" : "off"}`} title={status?.reason ?? status?.provider ?? ""}>
          {status === null ? "Checking…" : status.available ? `${status.model} · local` : "AI unavailable"}
        </span>
        <button className="action small" onClick={clear} disabled={state.entries.length === 0 && !busy} title="Clear the conversation">
          Clear
        </button>
        <button className="action small" onClick={() => hideChat().catch(() => {})} title="Close">
          ×
        </button>
      </header>

      {status && !status.available && (
        <p className="chat-banner error">
          {status.reason ?? "The local AI isn't available."} No answers can be generated until it is. (Free and local: install
          Ollama from ollama.com and run <code>ollama pull qwen3.5:4b</code>.)
        </p>
      )}

      {screenHelp && (
        <div className="chat-banner">
          {!prefs?.awareness.screenEnabled ? (
            <>
              <p>
                <strong>Ask about my screen is off.</strong> When on, each time you press it I take one screenshot, send it to the
                local model on this Mac, and throw it away afterwards. Nothing is recorded continuously.
              </p>
              <button className="action small" onClick={() => showInventory().catch(() => {})}>
                Open privacy settings
              </button>
            </>
          ) : (
            <>
              <p>
                <strong>Screen Recording permission needed.</strong> macOS asks once; then turn on Terraria Companion CJ Ver in System
                Settings → Privacy &amp; Security → Screen &amp; System Audio Recording, and reopen the app.
              </p>
              <button className="action small" onClick={() => requestScreenPermission().then(refresh).catch(() => {})}>
                Ask macOS for permission
              </button>
              <button className="action small" onClick={() => openPrivacySettings().catch(() => {})}>
                Open System Settings
              </button>
            </>
          )}
          <button className="action small" onClick={() => setScreenHelp(false)}>
            Keep chatting
          </button>
        </div>
      )}

      <div className="chat-log" ref={listRef} aria-live="polite">
        {state.entries.length === 0 && !busy && (
          <div className="chat-empty">
            <p>Hi! Ask me anything~ Questions, writing, plans, code, games…</p>
            <p className="muted">
              Answers come from {status?.available ? "a small AI model running on this Mac" : "a local AI model (not available right now)"}. Small
              models can be wrong, so double-check important things!
            </p>
          </div>
        )}
        {state.entries.map((e) => (
          <div key={e.id} className={`msg ${e.role} ${e.tone ?? ""}`}>
            {e.screen && e.role === "user" && <span className="tag">📷 screen</span>}
            {e.thumbnail && <img className="thumb" src={e.thumbnail} alt="Screenshot preview" />}
            <span className="text">{e.content}</span>
          </div>
        ))}
        {busy && (
          <div className="msg assistant loading">
            <span className="dots" aria-label="Thinking">
              {state.pending?.screen ? "Looking at your screen" : "Thinking"}
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
            <button className="action small" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text, false);
        }}
      >
        <textarea
          ref={inputRef}
          value={text}
          maxLength={MAX_INPUT}
          placeholder="Type a question…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Keys stay in this window; they never reach the character's controls.
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(text, false);
            }
          }}
          aria-label="Message"
        />
        <div className="chat-buttons">
          <button type="submit" className="action" disabled={!canSend(state, text) || !status?.available}>
            Send
          </button>
          <button
            type="button"
            className={`action screen ${screenReady ? "" : "locked"}`}
            disabled={busy}
            onClick={askScreen}
            title={
              screenReady
                ? "Takes one screenshot now, sends it to the local model with your question, then discards it"
                : "Screen understanding is off or needs permission. Click for details"
            }
          >
            📷 Ask about my screen
          </button>
        </div>
      </form>
    </main>
  );
}

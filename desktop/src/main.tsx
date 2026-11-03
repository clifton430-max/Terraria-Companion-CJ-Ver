import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Overlay from "./overlay/Overlay";
import Inventory from "./inventory/Inventory";
import Pouch from "./inventory/Pouch";
import Dock from "./dock/Dock";
import Chat from "./chat/Chat";
import Ambient from "./theme/Ambient";
import Crown from "./theme/Crown";

// All windows load the same bundle; the window label picks the view.
const label = getCurrentWindow().label;
const isInventory = label === "inventory";
const isPouch = label === "pouch";
const isDock = label === "dock";
const isChat = label === "chat";
const isDecor = label === "decor";
const isCrown = label === "crown";
const isAmbient = label === "ambient" || isDecor || isCrown;
document.body.classList.add(isInventory ? "inventory-body" : isPouch ? "pouch-body" : isDock ? "dock-body" : isChat ? "chat-body" : isAmbient ? "ambient-body" : "overlay-body");

// Relay uncaught errors to the terminal (printed only when the app runs with TC_DEBUG=1).
const report = (what: unknown) => invoke("debug_log", { message: `${getCurrentWindow().label}: ${String(what)}` }).catch(() => {});
window.addEventListener("error", (e) => report(e.error?.stack ?? e.message));
window.addEventListener("unhandledrejection", (e) => report(e.reason?.stack ?? e.reason));
// Also relay info/warnings (e.g. an audio clip that failed to decode) for TC_DEBUG runs.
for (const level of ["info", "warn"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    report(`${level}: ${args.map(String).join(" ")}`);
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isInventory ? <Inventory /> : isPouch ? <Pouch /> : isDock ? <Dock /> : isChat ? <Chat /> : isCrown ? <Crown /> : isAmbient ? <Ambient front={isDecor} /> : <Overlay />}</React.StrictMode>,
);

// Pure chat state: messages, the one in-flight request, and what gets sent or saved. General
// questions and "Ask about my screen" share the log but are separate request kinds.

import type { ChatFailure, ChatMessage, StoredMessage } from "../bridge";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  /** User message that asked about the screen, or the answer to one. */
  screen?: boolean;
  /** Screenshot preview (only when keeping screenshots is on). */
  thumbnail?: string | null;
  /** Notice styling. */
  tone?: "error" | "refused" | "cancelled";
}

export interface ChatState {
  entries: ChatEntry[];
  pending: { id: string; screen: boolean } | null;
}

export const emptyChat = (): ChatState => ({ entries: [], pending: null });

export type ChatAction =
  | { type: "send"; id: string; text: string; screen: boolean }
  | { type: "reply"; id: string; text: string; thumbnail: string | null }
  | { type: "fail"; id: string; failure: ChatFailure }
  | { type: "clear" }
  | { type: "load"; messages: StoredMessage[] }
  | { type: "append"; question: string; answer: string }
  /** The question turned out to be about the screen (a screenshot will be attached). */
  | { type: "markScreen"; id: string };

export const MAX_INPUT = 2000;

export function canSend(state: ChatState, text: string): boolean {
  return state.pending === null && text.trim().length > 0;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      if (!canSend(state, action.text)) return state;
      const entry: ChatEntry = { id: `u-${action.id}`, role: "user", content: action.text.trim().slice(0, MAX_INPUT), screen: action.screen };
      return { entries: [...state.entries, entry], pending: { id: action.id, screen: action.screen } };
    }
    case "reply": {
      if (state.pending?.id !== action.id) return state; // stale (cancelled or cleared)
      const entry: ChatEntry = { id: `a-${action.id}`, role: "assistant", content: action.text, screen: state.pending.screen, thumbnail: action.thumbnail };
      return { entries: attachThumb([...state.entries, entry], action.id, action.thumbnail), pending: null };
    }
    case "fail": {
      if (state.pending?.id !== action.id) return state;
      const tone = action.failure.kind === "refused" ? "refused" : action.failure.kind === "cancelled" ? "cancelled" : "error";
      return { entries: [...state.entries, { id: `n-${action.id}`, role: "notice", content: action.failure.message, tone }], pending: null };
    }
    case "clear":
      return emptyChat();
    case "markScreen":
      if (state.pending?.id !== action.id) return state;
      return {
        entries: state.entries.map((e) => (e.id === `u-${action.id}` ? { ...e, screen: true } : e)),
        pending: { ...state.pending, screen: true },
      };
    case "append": {
      // A voice question answered outside the chat window.
      const n = state.entries.length;
      return {
        ...state,
        entries: [
          ...state.entries,
          { id: `v-u-${n}`, role: "user", content: action.question },
          { id: `v-a-${n}`, role: "assistant", content: action.answer },
        ],
      };
    }
    case "load":
      return {
        pending: null,
        entries: action.messages.map((m, i) => ({ id: `h-${i}`, role: m.role, content: m.content, screen: m.screen, thumbnail: m.thumbnail ?? null })),
      };
  }
}

/** Show the preview on the user's question too. */
function attachThumb(entries: ChatEntry[], id: string, thumb: string | null): ChatEntry[] {
  if (!thumb) return entries;
  return entries.map((e) => (e.id === `u-${id}` ? { ...e, thumbnail: thumb } : e));
}

/** What the model sees: user/assistant turns only (notices and previews are never sent). */
export function providerMessages(entries: readonly ChatEntry[]): ChatMessage[] {
  return entries.filter((e) => e.role === "user" || e.role === "assistant").map((e) => ({ role: e.role as "user" | "assistant", content: e.content }));
}

/** What may be saved: nothing unless history keeping is on; previews only if that's on too. */
export function storableMessages(entries: readonly ChatEntry[], keepHistory: boolean, keepScreenshots: boolean): StoredMessage[] {
  if (!keepHistory) return [];
  return entries
    .filter((e) => e.role === "user" || e.role === "assistant")
    .map((e) => ({ role: e.role as "user" | "assistant", content: e.content, screen: !!e.screen, thumbnail: keepScreenshots ? (e.thumbnail ?? null) : null }));
}

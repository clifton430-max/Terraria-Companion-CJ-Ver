// Decides what a message is: an answer to a pending "are you sure?", a request to change the
// companion (handled by actions.ts, verified, and reported honestly), or an ordinary question for
// the assistant, which gets a fresh screenshot attached when it's about the screen. General
// assistant answers and companion actions stay separate: questions never change settings.

import {
  CATALOG,
  catalogText,
  clearlyAbout,
  confirmationFor,
  didYouMean,
  executeAction,
  isYes,
  looksLikeCommand,
  parseCommand,
  validateAction,
  type Action,
  type ActionDeps,
  type ActionResult,
} from "./actions";

export type Route =
  | { kind: "done"; action: Action; result: ActionResult }
  | { kind: "confirm"; action: Action; prompt: string }
  | { kind: "clarify"; question: string }
  | { kind: "declined"; message: string }
  | { kind: "ask"; screen: boolean };

export interface RouterState {
  /** Action waiting for a yes/no. */
  pending: Action | null;
}

export const emptyRouter = (): RouterState => ({ pending: null });

export interface RouterDeps extends ActionDeps {
  /** The local model's routing (JSON text), or undefined when it isn't available. */
  classify?: (text: string, catalog: string) => Promise<string>;
}

/** Longest message that still auto-attaches a screenshot (longer ones carry their own context). */
const SCREEN_MAX_CHARS = 200;

/** Is this a question about what's on the screen right now? */
export function wantsScreen(text: string): boolean {
  if (text.length > SCREEN_MAX_CHARS) return false;
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")} `;
  const phrases = [
    " my screen", " on screen", " on the screen", " what am i looking at", " what's this", " what is this", " whats this",
    " this error", " explain this", " what should i do here", " what do i do here", " what does this mean", " what does this say",
    " this page", " this window", " this code", " this message", " this dialog", " this popup", " this pop-up", " read this",
    " look at this", " can you see", " do you see", " help me with this", " summarize this", " summarise this", " what's going on here",
    " translate this", " is this right", " is this correct", " what's wrong here", " what's wrong with this", " screenshot",
  ];
  return phrases.some((p) => t.includes(p));
}

async function run(action: Action, deps: RouterDeps): Promise<Route> {
  const prompt = confirmationFor(action);
  if (prompt) return { kind: "confirm", action, prompt };
  return { kind: "done", action, result: await executeAction(action, deps) };
}

/** Route one message. Returns the route and the next router state. */
export async function route(text: string, state: RouterState, deps: RouterDeps): Promise<{ route: Route; state: RouterState }> {
  const trimmed = text.trim();
  // A pending confirmation: yes runs it, no cancels; anything else drops it and carries on.
  if (state.pending) {
    const yes = isYes(trimmed);
    if (yes === true) return { route: { kind: "done", action: state.pending, result: await executeAction(state.pending, deps) }, state: { pending: null } };
    if (yes === false) return { route: { kind: "declined", message: "Okay, I won't. Nothing changed." }, state: { pending: null } };
    state = { pending: null };
  }

  const parsed = parseCommand(trimmed);
  if (parsed?.kind === "clarify") return { route: { kind: "clarify", question: parsed.question }, state };
  if (parsed?.kind === "action") {
    const r = await run(parsed.action, deps);
    return { route: r, state: r.kind === "confirm" ? { pending: r.action } : state };
  }

  // Unusual phrasing of a command: let the local model pick from the catalog (validated here).
  if (deps.classify && looksLikeCommand(trimmed)) {
    try {
      const raw = JSON.parse(await deps.classify(trimmed, catalogText())) as { action?: string; question?: string };
      const action = validateAction(raw);
      if (action) {
        if (typeof raw.question === "string" && raw.question.trim() && action.id === "idle.pose" && !action.args?.pose) {
          return { route: { kind: "clarify", question: raw.question.trim().slice(0, 200) }, state };
        }
        // The small local model can misread; when the wording doesn't clearly match, ask first.
        if (!clearlyAbout(trimmed, action.id) && !confirmationFor(action)) {
          return { route: { kind: "confirm", action, prompt: didYouMean(action) }, state: { pending: action } };
        }
        const r = await run(action, deps);
        return { route: r, state: r.kind === "confirm" ? { pending: r.action } : state };
      }
      if (raw.action && raw.action !== "none" && typeof raw.question === "string" && raw.question.trim()) {
        return { route: { kind: "clarify", question: raw.question.trim().slice(0, 200) }, state };
      }
    } catch {
      // Model unavailable or unreadable: treat it as an ordinary message.
    }
  }
  return { route: { kind: "ask", screen: wantsScreen(trimmed) }, state };
}

/** Text to show/say for a non-"ask" route. */
export function routeText(r: Exclude<Route, { kind: "ask" }>): string {
  switch (r.kind) {
    case "done":
      return r.result.message;
    case "confirm":
      return r.prompt;
    case "clarify":
      return r.question;
    case "declined":
      return r.message;
  }
}

export { CATALOG };

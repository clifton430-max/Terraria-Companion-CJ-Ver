// Push-to-talk state machine (pure). Hold mode: key down starts, key up stops and transcribes.
// Toggle mode: each key press starts/stops. With auto-submit, the recording also ends by itself
// after a stretch of silence (see silence.ts) and the transcript is sent without a review step;
// "Edit" on the answer lets you correct it and send again. Cancel works from any state.
// Through Wispr Flow there's no recording of our own: "dictate" opens her input for Wispr Flow to
// type into, "dictated" is a dictation already meant for her (it started with her name), and
// "unavailable" says why Wispr Flow can't carry voice right now.

export type VoiceState =
  | { kind: "idle" }
  | { kind: "listening"; since: number; interim?: string }
  | { kind: "transcribing" }
  /** `dictating`: waiting for Wispr Flow to type into it. */
  | { kind: "review"; text: string; dictating?: boolean }
  | { kind: "thinking"; question: string }
  | { kind: "answer"; question: string; answer: string }
  /** `launch`: Wispr Flow is installed but not running (offer to open it). */
  | { kind: "error"; message: string; launch?: boolean };

export type VoiceEvent =
  | { type: "keyDown"; now: number }
  | { type: "keyUp"; now: number }
  | { type: "start"; now: number }
  | { type: "stop"; now: number }
  | { type: "cancel" }
  | { type: "transcribed"; text: string }
  | { type: "failed"; message: string }
  | { type: "send"; text: string }
  | { type: "answered"; answer: string }
  /** Live (partial) transcript while still listening. */
  | { type: "interim"; text: string }
  /** The user went quiet after speaking (auto-submit). */
  | { type: "silence"; now: number }
  /** Nothing was said. */
  | { type: "noSpeech" }
  /** Correct the last question and send it again. */
  | { type: "edit" }
  | { type: "close" }
  /** Wispr Flow is about to dictate: open her input for it. */
  | { type: "dictate" }
  /** A Wispr Flow dictation that started with her name (the name already stripped). */
  | { type: "dictated"; text: string }
  /** Wispr Flow can't carry voice right now. */
  | { type: "unavailable"; message: string; launch: boolean };

export interface VoiceSettings {
  enabled: boolean;
  mode: "hold" | "toggle";
  review: boolean;
  /** Send automatically after silence (and skip the review step). */
  autoSubmit?: boolean;
}

/** Shorter recordings are treated as an accidental tap. */
export const MIN_RECORDING = 0.35;
export const MAX_RECORDING = 30;
/** A press shorter than this (with auto-submit on) means "start listening", not push-to-talk. */
export const TAP_TO_TALK = 0.6;

/** Side effects the caller performs after a transition. */
export type VoiceEffect = "startRecording" | "stopAndTranscribe" | "discardRecording" | "ask" | "cancelAsk" | null;

export interface Transition {
  state: VoiceState;
  effect: VoiceEffect;
}

const idle: VoiceState = { kind: "idle" };

export function voiceStep(state: VoiceState, ev: VoiceEvent, s: VoiceSettings): Transition {
  if (ev.type === "cancel" || ev.type === "close") {
    const effect = state.kind === "listening" ? "discardRecording" : state.kind === "thinking" ? "cancelAsk" : null;
    return { state: idle, effect };
  }
  const startListening = (now: number): Transition => ({ state: { kind: "listening", since: now }, effect: "startRecording" });
  const stopListening = (since: number, now: number): Transition =>
    now - since < MIN_RECORDING
      ? { state: { kind: "error", message: "Hold the shortcut while you speak, then release it." }, effect: "discardRecording" }
      : { state: { kind: "transcribing" }, effect: "stopAndTranscribe" };

  const free = state.kind === "idle" || state.kind === "answer" || state.kind === "error" || (state.kind === "review" && !!state.dictating);
  switch (ev.type) {
    case "dictate":
      return free ? { state: { kind: "review", text: "", dictating: true }, effect: null } : { state, effect: null };
    case "dictated": {
      const text = ev.text.trim();
      if (!text || !free) return { state, effect: null };
      return { state: { kind: "thinking", question: text }, effect: "ask" };
    }
    case "unavailable":
      return state.kind === "thinking" ? { state, effect: null } : { state: { kind: "error", message: ev.message, launch: ev.launch }, effect: state.kind === "listening" ? "discardRecording" : null };
    case "keyDown":
      if (!s.enabled) return { state, effect: null };
      if (state.kind === "listening") return s.mode === "toggle" ? stopListening(state.since, ev.now) : { state, effect: null };
      if (state.kind === "idle" || state.kind === "answer" || state.kind === "error") return startListening(ev.now);
      return { state, effect: null }; // busy: transcribing, reviewing or thinking
    case "keyUp":
      if (s.mode === "hold" && state.kind === "listening") {
        // With auto-submit, a quick tap starts hands-free listening (silence sends it); a real
        // hold is push-to-talk as before.
        if (s.autoSubmit && ev.now - state.since < TAP_TO_TALK) return { state, effect: null };
        return stopListening(state.since, ev.now);
      }
      return { state, effect: null };
    case "start":
      if (!s.enabled || (state.kind !== "idle" && state.kind !== "answer" && state.kind !== "error")) return { state, effect: null };
      return startListening(ev.now);
    case "stop":
      return state.kind === "listening" ? stopListening(state.since, ev.now) : { state, effect: null };
    case "transcribed": {
      if (state.kind !== "transcribing") return { state, effect: null };
      const text = ev.text.trim();
      if (!text) return { state: { kind: "error", message: "I didn't catch that. Try again?" }, effect: null };
      return s.review && !s.autoSubmit ? { state: { kind: "review", text }, effect: null } : { state: { kind: "thinking", question: text }, effect: "ask" };
    }
    case "interim":
      return state.kind === "listening" && ev.text.trim() ? { state: { ...state, interim: ev.text.trim() }, effect: null } : { state, effect: null };
    case "silence":
      return state.kind === "listening" && s.autoSubmit ? { state: { kind: "transcribing" }, effect: "stopAndTranscribe" } : { state, effect: null };
    case "noSpeech":
      return state.kind === "listening"
        ? { state: { kind: "error", message: "I didn't hear anything. Try again when you're ready." }, effect: "discardRecording" }
        : { state, effect: null };
    case "edit":
      return state.kind === "answer" || state.kind === "error" ? { state: { kind: "review", text: state.kind === "answer" ? state.question : "" }, effect: null } : { state, effect: null };
    case "send": {
      const text = ev.text.trim();
      if (state.kind !== "review" || !text) return { state, effect: null };
      return { state: { kind: "thinking", question: text }, effect: "ask" };
    }
    case "answered":
      return state.kind === "thinking" ? { state: { kind: "answer", question: state.question, answer: ev.answer }, effect: null } : { state, effect: null };
    case "failed":
      if (state.kind === "transcribing" || state.kind === "thinking" || state.kind === "listening") return { state: { kind: "error", message: ev.message }, effect: null };
      return { state, effect: null };
  }
}

/** Friendly text for getUserMedia errors. */
export function micErrorMessage(name: string): string {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is off for Terraria Companion CJ Ver. Turn it on in System Settings → Privacy & Security → Microphone, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "That microphone isn't available. Pick another one in Awareness → Assistant & voice input.";
    case "NotReadableError":
      return "The microphone is busy or couldn't start.";
    default:
      return "The microphone couldn't start.";
  }
}

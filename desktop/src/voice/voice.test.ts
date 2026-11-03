import { describe, expect, it } from "vitest";
import { MIN_RECORDING, micErrorMessage, voiceStep, type VoiceSettings, type VoiceState } from "./machine";
import { encodeWav, level, resample, toBase64 } from "./wav";

const hold: VoiceSettings = { enabled: true, mode: "hold", review: true };
const toggle: VoiceSettings = { ...hold, mode: "toggle" };
const idle: VoiceState = { kind: "idle" };

describe("push-to-talk", () => {
  it("hold mode: key down records, key up transcribes", () => {
    let t = voiceStep(idle, { type: "keyDown", now: 0 }, hold);
    expect(t).toEqual({ state: { kind: "listening", since: 0 }, effect: "startRecording" });
    expect(voiceStep(t.state, { type: "keyDown", now: 0.5 }, hold).effect).toBeNull(); // key repeat ignored
    t = voiceStep(t.state, { type: "keyUp", now: 2 }, hold);
    expect(t).toEqual({ state: { kind: "transcribing" }, effect: "stopAndTranscribe" });
  });

  it("toggle mode: a second press stops; key up does nothing", () => {
    let t = voiceStep(idle, { type: "keyDown", now: 0 }, toggle);
    expect(voiceStep(t.state, { type: "keyUp", now: 0.1 }, toggle).effect).toBeNull();
    t = voiceStep(t.state, { type: "keyDown", now: 3 }, toggle);
    expect(t.effect).toBe("stopAndTranscribe");
  });

  it("a tap that's too short is discarded with a hint", () => {
    const t = voiceStep({ kind: "listening", since: 0 }, { type: "keyUp", now: MIN_RECORDING / 2 }, hold);
    expect(t.effect).toBe("discardRecording");
    expect(t.state.kind).toBe("error");
  });

  it("review step lets the transcript be edited before sending; or it's sent straight away", () => {
    let t = voiceStep({ kind: "transcribing" }, { type: "transcribed", text: " how do I mine " }, hold);
    expect(t.state).toEqual({ kind: "review", text: "how do I mine" });
    t = voiceStep(t.state, { type: "send", text: "how do I mine copper?" }, hold);
    expect(t).toEqual({ state: { kind: "thinking", question: "how do I mine copper?" }, effect: "ask" });
    t = voiceStep(t.state, { type: "answered", answer: "With a pickaxe!" }, hold);
    expect(t.state).toEqual({ kind: "answer", question: "how do I mine copper?", answer: "With a pickaxe!" });
    const direct = voiceStep({ kind: "transcribing" }, { type: "transcribed", text: "hi" }, { ...hold, review: false });
    expect(direct).toEqual({ state: { kind: "thinking", question: "hi" }, effect: "ask" });
  });

  it("cancel works from any state and cleans up what's running", () => {
    expect(voiceStep({ kind: "listening", since: 0 }, { type: "cancel" }, hold)).toEqual({ state: idle, effect: "discardRecording" });
    expect(voiceStep({ kind: "thinking", question: "q" }, { type: "cancel" }, hold)).toEqual({ state: idle, effect: "cancelAsk" });
    expect(voiceStep({ kind: "review", text: "x" }, { type: "close" }, hold)).toEqual({ state: idle, effect: null });
  });

  it("errors, empty transcripts, disabled input and busy states", () => {
    expect(voiceStep({ kind: "transcribing" }, { type: "transcribed", text: "  " }, hold).state.kind).toBe("error");
    expect(voiceStep({ kind: "transcribing" }, { type: "failed", message: "denied" }, hold).state).toEqual({ kind: "error", message: "denied" });
    expect(voiceStep(idle, { type: "keyDown", now: 0 }, { ...hold, enabled: false }).state).toBe(idle);
    const thinking: VoiceState = { kind: "thinking", question: "q" };
    expect(voiceStep(thinking, { type: "keyDown", now: 0 }, hold).state).toBe(thinking);
    expect(voiceStep({ kind: "error", message: "x" }, { type: "keyDown", now: 1 }, hold).effect).toBe("startRecording");
    expect(voiceStep(idle, { type: "start", now: 0 }, hold).effect).toBe("startRecording"); // menu button
    expect(voiceStep({ kind: "listening", since: 0 }, { type: "stop", now: 2 }, hold).effect).toBe("stopAndTranscribe");
  });

  it("explains microphone permission problems", () => {
    expect(micErrorMessage("NotAllowedError")).toMatch(/Privacy & Security → Microphone/);
    expect(micErrorMessage("NotFoundError")).toMatch(/Pick another/);
  });
});

describe("recording to WAV", () => {
  it("resamples to 16 kHz and encodes a valid 16-bit mono WAV", () => {
    const one = new Float32Array(48000).fill(0.5);
    const r = resample(one, 48000);
    expect(r.length).toBe(16000);
    const wav = encodeWav(r);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(32000);
    expect(v.getInt16(44, true)).toBe(16383); // 0.5 × 32767, truncated
    expect(toBase64(new Uint8Array([102, 111, 111]))).toBe("Zm9v");
  });

  it("handles empty input and measures levels", () => {
    expect(resample(new Float32Array(0), 44100).length).toBe(0);
    expect(level(new Float32Array(0))).toBe(0);
    expect(level(new Float32Array(100).fill(0))).toBe(0);
    expect(level(new Float32Array(100).fill(1))).toBe(1);
  });
});

describe("auto-submit after silence", () => {
  const auto = { enabled: true, mode: "toggle" as const, review: true, autoSubmit: true };
  it("silence ends listening and transcribes; the transcript is sent without review", () => {
    const l = voiceStep({ kind: "idle" }, { type: "keyDown", now: 0 }, auto);
    expect(l.state.kind).toBe("listening");
    const s = voiceStep(l.state, { type: "silence", now: 3 }, auto);
    expect(s).toEqual({ state: { kind: "transcribing" }, effect: "stopAndTranscribe" });
    const t = voiceStep(s.state, { type: "transcribed", text: "turn on roam mode" }, auto);
    expect(t).toEqual({ state: { kind: "thinking", question: "turn on roam mode" }, effect: "ask" });
  });

  it("without auto-submit, silence does nothing and review still applies", () => {
    const manual = { ...auto, autoSubmit: false };
    const l = voiceStep({ kind: "idle" }, { type: "keyDown", now: 0 }, manual);
    expect(voiceStep(l.state, { type: "silence", now: 3 }, manual).state.kind).toBe("listening");
    expect(voiceStep({ kind: "transcribing" }, { type: "transcribed", text: "hi" }, manual).state.kind).toBe("review");
  });

  it("shows live text, handles 'nothing said', and lets you edit and resend", () => {
    const l = voiceStep({ kind: "idle" }, { type: "start", now: 0 }, auto).state;
    expect(voiceStep(l, { type: "interim", text: "what am I" }, auto).state).toEqual({ kind: "listening", since: 0, interim: "what am I" });
    const none = voiceStep(l, { type: "noSpeech" }, auto);
    expect(none.state.kind).toBe("error");
    expect(none.effect).toBe("discardRecording");
    const edit = voiceStep({ kind: "answer", question: "turn on roan mode", answer: "?" }, { type: "edit" }, auto);
    expect(edit.state).toEqual({ kind: "review", text: "turn on roan mode" });
    expect(voiceStep(edit.state, { type: "send", text: "turn on roam mode" }, auto).effect).toBe("ask");
  });

  it("manual Done still works while listening (if detection misses the end)", () => {
    const l = voiceStep({ kind: "idle" }, { type: "start", now: 0 }, auto).state;
    expect(voiceStep(l, { type: "stop", now: 2 }, auto).effect).toBe("stopAndTranscribe");
  });

  describe("through Wispr Flow", () => {
    const s: VoiceSettings = { enabled: true, mode: "hold", review: true, autoSubmit: true };
    it("opens her input for Wispr Flow, then sends what it typed", () => {
      let t = voiceStep(idle, { type: "dictate" }, s);
      expect(t.state).toEqual({ kind: "review", text: "", dictating: true });
      t = voiceStep(t.state, { type: "send", text: "what's the time?" }, s);
      expect(t).toEqual({ state: { kind: "thinking", question: "what's the time?" }, effect: "ask" });
    });
    it("a dictation that started with her name goes straight to her", () => {
      expect(voiceStep(idle, { type: "dictated", text: "  hello  " }, s)).toEqual({ state: { kind: "thinking", question: "hello" }, effect: "ask" });
      expect(voiceStep({ kind: "thinking", question: "x" }, { type: "dictated", text: "again" }, s).effect).toBeNull(); // busy
      expect(voiceStep(idle, { type: "dictated", text: " " }, s).effect).toBeNull();
    });
    it("says why it can't listen, offering to open Wispr Flow when it's only not running", () => {
      const t = voiceStep(idle, { type: "unavailable", message: "Wispr Flow isn't running", launch: true }, s);
      expect(t.state).toEqual({ kind: "error", message: "Wispr Flow isn't running", launch: true });
      expect(voiceStep({ kind: "thinking", question: "x" }, { type: "unavailable", message: "m", launch: false }, s).state.kind).toBe("thinking");
    });
  });
});

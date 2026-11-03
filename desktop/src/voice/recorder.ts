// Microphone capture for push-to-talk (WebView getUserMedia + Web Audio). Audio is kept in memory
// only while recording; the microphone is released as soon as recording stops or is cancelled.

import { MAX_RECORDING } from "./machine";
import { level } from "./wav";

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private samples = 0;

  get active() {
    return this.stream !== null;
  }

  /** Starts recording; rejects with a DOMException (e.g. NotAllowedError) if the mic can't start. */
  /** `onLevel(level, seconds)` runs once per audio block (for the meter and silence detection). */
  async start(deviceId: string, onLevel: (v: number, dt: number) => void, onLimit: () => void): Promise<void> {
    this.release();
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, channelCount: 1 };
    if (deviceId && deviceId !== "default") audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const limit = MAX_RECORDING * this.ctx.sampleRate;
    this.node.onaudioprocess = (e) => {
      const block = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(block);
      this.samples += block.length;
      onLevel(level(block), block.length / (this.ctx?.sampleRate ?? 48000));
      if (this.samples >= limit) onLimit();
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination); // required for processing to run; outputs silence
  }

  /** A copy of the audio so far, without stopping (for live transcription). */
  peek(): { samples: Float32Array; rate: number } | null {
    if (!this.ctx || this.samples === 0) return null;
    const out = new Float32Array(this.samples);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return { samples: out, rate: this.ctx.sampleRate };
  }

  /** Stop and return the audio (the microphone is released immediately). */
  stop(): { samples: Float32Array; rate: number } {
    const rate = this.ctx?.sampleRate ?? 48000;
    const out = new Float32Array(this.samples);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    this.release();
    return { samples: out, rate };
  }

  /** Throw the recording away and release the microphone. */
  cancel() {
    this.release();
  }

  private release() {
    if (this.node) this.node.onaudioprocess = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.chunks = [];
    this.samples = 0;
  }
}

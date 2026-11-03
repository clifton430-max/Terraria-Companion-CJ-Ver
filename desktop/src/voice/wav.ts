// Turn recorded Float32 audio into a small 16 kHz mono 16-bit WAV for the speech helper.

export const TARGET_RATE = 16000;

/** Linear-interpolation resample to `to` Hz (speech doesn't need more than 16 kHz). */
export function resample(input: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (!(from > 0) || input.length === 0) return new Float32Array(0);
  if (from === to) return input.slice();
  const outLen = Math.max(1, Math.floor((input.length * to) / from));
  const out = new Float32Array(outLen);
  const ratio = from / to;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, input.length - 1);
    const f = pos - a;
    out[i] = input[a] * (1 - f) + input[b] * f;
  }
  return out;
}

/** 16-bit PCM mono WAV bytes. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** RMS level 0..1 of a block (for the input meter). */
export function level(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  return Math.min(1, Math.sqrt(sum / block.length) * 4);
}

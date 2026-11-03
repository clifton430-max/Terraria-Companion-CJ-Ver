// Loads and draws the real Terraria player atlas composed by the Rust backend.

import { assetUrl, type RigInfo } from "../bridge";
import type { RigGeometry } from "../combat/geometry";
import { resolveFrame } from "./rigFrames";

export class TerrariaRig {
  private readonly index = new Map<string, number>();

  private constructor(
    readonly info: RigInfo,
    readonly image: ImageBitmap,
  ) {
    info.frames.forEach((name, i) => this.index.set(name, i));
  }

  /** Fetch the atlas; resolves to null when the real art isn't available (caller falls back). */
  static async load(info: RigInfo): Promise<TerrariaRig | null> {
    if (!info.available || !info.path) return null;
    try {
      const res = await fetch(assetUrl(info.path));
      if (!res.ok) return null;
      const image = await createImageBitmap(await res.blob());
      return new TerrariaRig(info, image);
    } catch {
      return null;
    }
  }

  /** Atlas key: changes whenever the appearance (and so the atlas) changes. */
  get key(): string {
    return this.info.path ?? "";
  }

  frameIndex(name: string): number {
    return this.index.get(name) ?? this.index.get(resolveFrame(this.info.frames, name)) ?? 0;
  }

  /** Draw a frame filling a `w`×`h` canvas, mirrored about its centre when facing left. */
  draw(ctx: CanvasRenderingContext2D, frame: string, flip: boolean, w: number, h: number) {
    const { frameWidth: fw, frameHeight: fh } = this.info;
    const sx = this.frameIndex(frame) * fw;
    ctx.save();
    if (flip) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.image, sx, 0, fw, fh, 0, 0, w, h);
    ctx.restore();
  }

  geometry(scale: number): RigGeometry {
    const hand = (frame: string) => {
      const h = this.info.hands[frame];
      return h ? { x: h[0], y: h[1] } : undefined;
    };
    return {
      scale,
      cellW: this.info.frameWidth,
      originX: this.info.body.x,
      originY: this.info.body.y,
      hands: { point: hand("shoot"), raise: hand("cast") },
    };
  }
}

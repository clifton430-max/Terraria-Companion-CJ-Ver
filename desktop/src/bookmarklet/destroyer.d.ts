// Types for destroyer.js (kept as plain JavaScript so its raw text can become the bookmarklet).

export interface Flyer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vr: number;
  rot: number;
  age: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLike {
  data: string;
  parentNode: unknown;
}

export interface SpanLike {
  textContent: string;
  parentNode: { removeChild(n: unknown): unknown } | null;
}

export function destroyerHelpers(): {
  GRAVITY: number;
  launchVelocity(cx: number, cy: number, px: number, py: number, rnd: () => number): { vx: number; vy: number; vr: number };
  stepFlyer(f: Flyer, dt: number, viewportHeight: number): boolean;
  pickRun(chars: string[], rects: (Box | null)[], clicked: number, x: number, y: number, radius: number): [number, number] | null;
  elementPolicy(rect: Box, viewport: { w: number; h: number }, tag: string): "fly" | "text-only" | "skip";
  restoreSplit(before: TextLike, span: SpanLike, after: TextLike | null): boolean;
  pingPayload(event: string, count: number): string;
  screenToClient(
    sx: number,
    sy: number,
    win: { screenX: number; screenY: number; outerWidth: number; outerHeight: number; innerWidth: number; innerHeight: number },
  ): { x: number; y: number } | null;
  strikeRadius(power: number): number;
  strikeDust(power: number, rnd: () => number): { vx: number; vy: number; vr: number; size: number; color: string }[];
};

export function letterDestroyer(): void;

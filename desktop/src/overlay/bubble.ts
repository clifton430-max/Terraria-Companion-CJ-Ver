// Speech-bubble placement (pure): above the character, kept on screen, with the tail pointing at
// the character even when the bubble is pushed in from a screen edge.

export interface BubblePlacement {
  x: number;
  y: number;
  /** Tail position from the bubble's left edge (px). */
  tailX: number;
}

const EDGE = 8;
const TAIL_INSET = 16;
const GAP = 16;

export function placeBubble(
  body: { x: number; y: number; w: number },
  size: { w: number; h: number },
  bounds: { width: number },
): BubblePlacement {
  const cx = body.x + body.w / 2;
  const x = Math.min(Math.max(cx - size.w / 2, EDGE), Math.max(EDGE, bounds.width - size.w - EDGE));
  const y = Math.max(EDGE, body.y - size.h - GAP);
  const tailX = Math.min(Math.max(cx - x, TAIL_INSET), Math.max(TAIL_INSET, size.w - TAIL_INSET));
  return { x, y, tailX };
}

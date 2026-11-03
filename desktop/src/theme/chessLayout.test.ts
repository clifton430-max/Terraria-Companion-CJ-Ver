import { describe, expect, it, vi } from "vitest";

// A canvas that accepts every call, so the layout code runs without a DOM.
const ctx = (): unknown => new Proxy({}, { get: (_t, k) => (k === "createRadialGradient" || k === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });

describe("laying out the chess battlefield", () => {
  it("finishes for any screen width and piece size (no endless loops around the queen)", async () => {
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx() }) });
    const { drawChessGround, drawChessEdge, ChessAtmosphere } = await import("./chessMap");
    for (const width of [240, 800, 1280, 1440, 1512, 1710, 1728, 1920, 2560, 3024, 3840])
      for (const size of [14, 36, 52, 63, 70, 84]) {
        for (const seed of [11, 12, 13]) drawChessGround(ctx() as CanvasRenderingContext2D, width, 2, seed, size);
        drawChessEdge(ctx() as CanvasRenderingContext2D, width, 2, 13);
      }
    const a = new ChessAtmosphere();
    a.step(1 / 30, 0, null, 1710, 1107, 1037, null);
    a.draw(ctx() as CanvasRenderingContext2D, 1, 1710, 0, 1037, 1, true, true);
    expect(a.counts.lanterns).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

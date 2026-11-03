// Asks the chess search for a move: in a worker when possible (the overlay stays smooth), inline
// with the same bounded budget otherwise. Every request has an id; restarting or closing cancels
// it, and a late answer for an old position is ignored.

import { chooseMove, LIMITS, type Choice, type Difficulty } from "./ai";
import { fromFen } from "./rules";

export class OpponentBrain {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (c: Choice | null) => void; fen: string; difficulty: Difficulty; history: string[] } | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<{ id: number; choice: Choice | null }>) => {
        const p = this.pending;
        if (!p || p.id !== e.data.id) return; // cancelled or superseded
        this.pending = null;
        p.resolve(e.data.choice);
      };
      this.worker.onerror = () => {
        // The worker couldn't run: think inline from now on, starting with this request.
        this.worker?.terminate();
        this.worker = null;
        const p = this.pending;
        this.pending = null;
        if (p) p.resolve(this.inline(p.fen, p.difficulty, p.history));
      };
    } catch {
      this.worker = null;
    }
  }

  /** Resolves with her move (null if cancelled or there is none). */
  think(fen: string, difficulty: Difficulty, history: string[]): Promise<Choice | null> {
    this.cancel();
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending = { id, resolve, fen, difficulty, history };
      if (this.worker) {
        this.worker.postMessage({ id, fen, difficulty, history });
        return;
      }
      // Inline: yield a frame first so the "thinking" pose shows, then search within budget.
      setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        resolve(this.inline(fen, difficulty, history));
      }, 30);
    });
  }

  /** The same bounded search on the main thread (shorter budget so animations barely pause). */
  private inline(fen: string, difficulty: Difficulty, history: string[]) {
    return chooseMove(fromFen(fen), { ...LIMITS[difficulty], timeMs: Math.min(LIMITS[difficulty].timeMs, 500) }, Math.random, () => Date.now(), history);
  }

  cancel() {
    const p = this.pending;
    this.pending = null;
    p?.resolve(null);
  }

  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}

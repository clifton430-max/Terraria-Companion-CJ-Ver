// Runs the chess search off the main thread so the companions keep animating while she thinks.
import { chooseMove, LIMITS, type Difficulty } from "./ai";
import { fromFen } from "./rules";

self.onmessage = (e: MessageEvent<{ id: number; fen: string; difficulty: Difficulty; history: string[] }>) => {
  const { id, fen, difficulty, history } = e.data;
  const choice = chooseMove(fromFen(fen), LIMITS[difficulty], Math.random, () => Date.now(), history);
  (self as unknown as Worker).postMessage({ id, choice });
};

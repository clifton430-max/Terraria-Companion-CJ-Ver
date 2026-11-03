// What the supporters say during a chess game, in each character's own voice, and when. Lines are
// picked without repeating the last one, and a rate limiter keeps the cheering occasional: a
// global gap between any two remarks, a longer gap per character, and a chance to stay quiet for
// the routine events. The start and the result are always announced.

import type { CharacterId } from "../bridge";

export type CheerEvent =
  | "start" // the game begins (one supporter per side)
  | "capture" // our side took a piece
  | "lost" // our side lost a piece
  | "check" // we gave check
  | "inCheck" // our king is in check
  | "good" // a strong move by our side (a capture of a big piece, castling, promotion)
  | "close" // a tense late game
  | "win"
  | "lose"
  | "draw"
  | "think"; // the companion opponent considering her move

type Pool = readonly string[];

/** {t} = our team's colour ("White"/"Black"). CJ Ver: professional, composed commentary. */
export const CHEERS: Record<CharacterId, Record<CheerEvent, Pool>> = {
  terrarian: {
    start: ["Good luck, {t}. Play steadily.", "Supporting {t}. Let's have a good game."],
    capture: ["Good capture.", "Material gained.", "Nicely taken."],
    lost: ["We lost one. Stay focused.", "That's fine. We'll recover.", "A setback. Keep going."],
    check: ["Check.", "Their king is under pressure."],
    inCheck: ["Protect the king.", "Careful now."],
    good: ["Strong move.", "Well played.", "Excellent."],
    close: ["It's close. Stay calm.", "Every move counts now."],
    win: ["We won. Well played.", "Victory. Good game."],
    lose: ["Good game. Rematch?", "We'll do better next time."],
    draw: ["A draw. Well contested.", "Even result. Good game."],
    think: ["Considering the options.", "Let me think.", "One moment."],
  },
  princess: {
    start: ["{t}, let's execute the plan.", "Objective: win with {t}. Let's begin."],
    capture: ["Captured. On to the next.", "Good. That's progress.", "Efficient."],
    lost: ["Noted. Adjust and continue.", "An acceptable cost.", "Regroup."],
    check: ["Check. Keep the pressure on.", "Their king has limited options."],
    inCheck: ["Secure the king first.", "Priority one: the king."],
    good: ["Decisive move.", "Exactly to plan."],
    close: ["Tight finish. Stay disciplined.", "Focus. This is the deciding phase."],
    win: ["Objective achieved.", "Win secured. Well done."],
    lose: ["We'll review and come back stronger.", "Good game. Let's debrief and rematch."],
    draw: ["A balanced outcome.", "Draw agreed. Fair result."],
    think: ["Reviewing priorities.", "Assessing the position.", "Planning the next step."],
  },
  partygirl: {
    start: ["Go, {t}. Let's make it a great game.", "Rooting for {t}."],
    capture: ["Nice one.", "Great capture.", "That's a win for us."],
    lost: ["Shake it off. Plenty of game left.", "We'll get it back.", "Keep your spirits up."],
    check: ["Check. Great pressure.", "That's check."],
    inCheck: ["Heads up, protect the king.", "Careful. Defend first."],
    good: ["That was a great move.", "Really well played."],
    close: ["What a close game.", "Exciting finish ahead."],
    win: ["We won. Well done, everyone.", "Victory. Great game."],
    lose: ["Good game. Next one's ours.", "Still a great match. Rematch?"],
    draw: ["A draw. A fair finish.", "Even match. Well played, both sides."],
    think: ["What's the best move here?", "Thinking it through.", "Let me consider this."],
  },
  nurse: {
    start: ["Team {t}, stay calm and breathe.", "I'll keep an eye on {t}. Play well."],
    capture: ["Clean capture. Well done.", "Textbook.", "Efficient."],
    lost: ["We'll manage. Keep going.", "A minor setback.", "Stay composed."],
    check: ["Check. Their king is under strain.", "Check. Keep it steady."],
    inCheck: ["Stay calm. Protect the king.", "Don't rush. Defend carefully."],
    good: ["Excellent technique.", "Very precise."],
    close: ["Tense position. Steady hands.", "Breathe. Take your time."],
    win: ["We won. Well done.", "Victory. Good composure."],
    lose: ["We'll recover. Good game.", "A loss is a learning opportunity."],
    draw: ["A draw. Stable result.", "Even. Healthy competition."],
    think: ["Let me examine the position.", "Careful assessment first.", "Weighing the options."],
  },
  zoologist: {
    start: ["Observing closely. Good luck, {t}.", "Data collection begins. Go, {t}."],
    capture: ["Capture confirmed.", "Good. The numbers favour us.", "Noted: material gained."],
    lost: ["One piece down. Reassessing.", "That changes the picture slightly.", "Noted. Adjusting."],
    check: ["Check. Their king is cornered.", "Check confirmed."],
    inCheck: ["Defend the king first.", "Threat detected. Respond carefully."],
    good: ["Well reasoned.", "That move is well supported."],
    close: ["The evidence is evenly split.", "Very close position."],
    win: ["Result confirmed: we won.", "As the analysis suggested. Well done."],
    lose: ["Good game. Plenty to learn from it.", "We'll review the data and try again."],
    draw: ["A draw. Statistically fair.", "Evenly matched."],
    think: ["Analysing the position.", "Checking the variations.", "Looking for weaknesses."],
  },
  goblin: {
    start: ["Running the numbers. Team {t} has this.", "Let's engineer a win, {t}."],
    capture: ["Material advantage acquired.", "Clean capture.", "Efficient."],
    lost: ["Recalculating.", "Acceptable losses.", "Adjusting the plan."],
    check: ["Check. Their king is out of options.", "Calculated."],
    inCheck: ["Defensive measures, now.", "Shield the king."],
    good: ["Precision move.", "Solid engineering."],
    close: ["The margins are thin.", "By my calculations, it's close."],
    win: ["Victory, as planned.", "We won. Clean result."],
    lose: ["Back to the drawing board. Rematch.", "Data collected. Next time we win."],
    draw: ["Perfectly balanced.", "A draw. The math checks out."],
    think: ["Running calculations.", "Hold on, crunching numbers.", "Evaluating the options."],
  },
};

export const GLOBAL_GAP = 3.5;
export const PER_ACTOR_GAP = 8;
const CHANCE: Record<CheerEvent, number> = { start: 1, win: 1, lose: 1, draw: 1, check: 0.9, inCheck: 0.7, capture: 0.75, lost: 0.6, good: 0.7, close: 0.35, think: 0.35 };
const ALWAYS: ReadonlySet<CheerEvent> = new Set(["start", "win", "lose", "draw"]);

export class CheerLimiter {
  private lastAny = -Infinity;
  private lastBy = new Map<string, number>();
  private lastLine = new Map<string, string>();

  /**
   * The line `who` should say for `ev` at time `now` (seconds), or null to stay quiet.
   * Results always speak; other events respect the gaps and chance.
   */
  pick(who: CharacterId, ev: CheerEvent, team: "White" | "Black", now: number, rnd: () => number): string | null {
    if (!ALWAYS.has(ev)) {
      if (now - this.lastAny < GLOBAL_GAP) return null;
      if (now - (this.lastBy.get(who) ?? -Infinity) < PER_ACTOR_GAP) return null;
      if (rnd() >= CHANCE[ev]) return null;
    }
    const pool = CHEERS[who][ev];
    const last = this.lastLine.get(who);
    const options = pool.length > 1 ? pool.filter((l) => l !== last) : pool;
    const line = options[Math.floor(rnd() * options.length) % options.length];
    this.lastAny = now;
    this.lastBy.set(who, now);
    this.lastLine.set(who, line);
    return line.replace(/\{t\}/g, team);
  }

  reset() {
    this.lastAny = -Infinity;
    this.lastBy.clear();
  }
}

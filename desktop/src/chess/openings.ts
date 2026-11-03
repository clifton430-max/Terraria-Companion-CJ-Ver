// Opening lessons for the chess tutorial. Each opening is taught from one side; its variations are
// the opponent's most common answers, with a note on every move explaining the idea and how your
// plan changes against that reply. Moves are SAN, checked against the rules engine by tests.

import { legalMoves, play, san, type Color, type Game, type Move } from "./rules";

export interface LessonMove {
  san: string;
  note: string;
}

export interface Variation {
  name: string;
  /** How to adapt against this reply, shown when the line starts. */
  idea: string;
  moves: LessonMove[];
}

export interface Opening {
  id: string;
  name: string;
  /** The side you play. */
  side: Color;
  summary: string;
  variations: Variation[];
}

const m = (san: string, note: string): LessonMove => ({ san, note });

export const OPENINGS: Opening[] = [
  {
    id: "london",
    name: "London System",
    side: "w",
    summary: "A solid set-up for White: d4, Bf4, e3, Nf3, c3 and Nbd2, the same plan against almost anything. Easy to learn, hard to crack.",
    variations: [
      {
        name: "Against …d5 and …c5",
        idea: "Black fights for the centre with …c5. Keep the pawn chain c3–d4–e3 and develop calmly; your dark-squared bishop is already outside the chain.",
        moves: [
          m("d4", "Claim the centre with the queen's pawn."),
          m("d5", "Black mirrors you."),
          m("Bf4", "The London move: the bishop comes out before e3 locks it in."),
          m("Nf6", "Black develops naturally."),
          m("e3", "Supports d4 and opens a path for the other bishop."),
          m("e6", "Black builds a solid wall."),
          m("Nf3", "Develop the knight toward the centre and get ready to castle."),
          m("c5", "Black strikes at d4: the key moment."),
          m("c3", "Answer …c5 with c3, so d4 stays protected by a pawn."),
          m("Nc6", "Black adds pressure on d4."),
          m("Nbd2", "The knight goes to d2 (not c3, where your c-pawn sits) to support e4 later."),
          m("Bd6", "Black offers to trade your strong bishop."),
          m("Bg3", "Keep the bishop: if Black takes on g3, recapture with hxg3 and use the open h-file."),
        ],
      },
      {
        name: "Against a King's Indian set-up (…g6)",
        idea: "Black fianchettoes and castles fast. Same plan, but play h3 so your bishop has a retreat on h2 and …Nh5 never bothers it.",
        moves: [
          m("d4", "Centre first."),
          m("Nf6", "Flexible: Black hasn't committed a central pawn."),
          m("Bf4", "Bishop out early, as always in the London."),
          m("g6", "Black prepares …Bg7 (a King's Indian set-up)."),
          m("e3", "Solid support for d4."),
          m("Bg7", "The bishop aims down the long diagonal at your queenside."),
          m("Nf3", "Develop and prepare to castle."),
          m("O-O", "Black is safe already."),
          m("Be2", "Modest but solid: no target for …e5-e4 forks."),
          m("d6", "Black prepares …e5."),
          m("h3", "Make a retreat for your bishop (h2), so …Nh5 or …e5 doesn't win it."),
        ],
      },
      {
        name: "Against an early …c5 and …Qb6",
        idea: "Black attacks b2 with the queen. Don't panic: Qb3 offers a queen trade that straightens Black's pawns toward the centre for you.",
        moves: [
          m("d4", "Centre."),
          m("d5", "Classical reply."),
          m("Bf4", "The London bishop."),
          m("c5", "An early strike at d4."),
          m("e3", "Hold d4 with a pawn."),
          m("Nc6", "Pressure on d4."),
          m("c3", "The pawn chain is complete: d4 is rock solid."),
          m("Qb6", "Black's queen eyes the b2 pawn, left alone by your bishop."),
          m("Qb3", "Defend b2 and offer a trade: …Qxb3 axb3 opens the a-file for your rook."),
        ],
      },
    ],
  },
  {
    id: "italian",
    name: "Italian Game",
    side: "w",
    summary: "1.e4 e5 2.Nf3 Nc6 3.Bc4: rapid development, the bishop aiming at f7, and a slow build-up with c3 and d3 (the Giuoco Pianissimo).",
    variations: [
      {
        name: "Giuoco Piano (3…Bc5)",
        idea: "Black mirrors you. Play c3 and d3 for a solid centre, castle, and only later push d4.",
        moves: [
          m("e4", "Take the centre and open lines for the queen and bishop."),
          m("e5", "Black does the same."),
          m("Nf3", "Develop with a threat: the e5 pawn is attacked."),
          m("Nc6", "Black defends e5."),
          m("Bc4", "The Italian bishop aims at f7, Black's weakest square."),
          m("Bc5", "Black's bishop mirrors yours."),
          m("c3", "Prepare d4 and give your bishop a home on b3 later."),
          m("Nf6", "Black counter-attacks e4."),
          m("d3", "Calm: protect e4 instead of rushing d4."),
          m("d6", "Black also builds slowly."),
          m("O-O", "King to safety before the middlegame starts."),
          m("O-O", "Both sides are ready to manoeuvre."),
        ],
      },
      {
        name: "Two Knights (3…Nf6)",
        idea: "Black attacks e4 at once. Defend with d3 instead of grabbing tactics. The quiet line is safe and keeps your plan.",
        moves: [
          m("e4", "Centre."),
          m("e5", "Symmetry."),
          m("Nf3", "Attack e5."),
          m("Nc6", "Defend it."),
          m("Bc4", "Eye f7."),
          m("Nf6", "The Two Knights: Black hits e4 right away."),
          m("d3", "Protect e4 calmly. (Ng5 is sharp; d3 keeps things under control.)"),
          m("Be7", "Black chooses a modest, safe set-up."),
          m("O-O", "Castle."),
          m("O-O", "Black castles too."),
          m("Re1", "The rook supports e4 and the centre."),
        ],
      },
    ],
  },
  {
    id: "ruy",
    name: "Ruy Lopez",
    side: "w",
    summary: "1.e4 e5 2.Nf3 Nc6 3.Bb5: pressure on the knight that defends e5. One of the oldest and richest openings.",
    variations: [
      {
        name: "Morphy Defence (3…a6)",
        idea: "Black asks the bishop where it's going. Retreat to a4 and keep the pin idea; c3 and d4 come later.",
        moves: [
          m("e4", "Centre."),
          m("e5", "Classical."),
          m("Nf3", "Attack e5."),
          m("Nc6", "Defend."),
          m("Bb5", "The Spanish bishop pressures the defender of e5."),
          m("a6", "The most popular reply: question the bishop."),
          m("Ba4", "Keep the pressure; the bishop will later sit on b3."),
          m("Nf6", "Black develops and hits e4."),
          m("O-O", "Castle: e4 is safe because …Nxe4 runs into Re1."),
          m("Be7", "The solid Closed Ruy Lopez."),
          m("Re1", "Protect e4 for real."),
          m("b5", "Black gains space and kicks the bishop."),
          m("Bb3", "The bishop is happy on the a2–g8 diagonal."),
          m("d6", "Black solidifies e5."),
          m("c3", "Prepare d4: White's classic plan."),
        ],
      },
      {
        name: "Berlin Defence (3…Nf6)",
        idea: "Black counter-attacks e4 and is happy to trade queens. Castle and win the pawn back with Re1 or d4.",
        moves: [
          m("e4", "Centre."),
          m("e5", "Classical."),
          m("Nf3", "Attack e5."),
          m("Nc6", "Defend."),
          m("Bb5", "Spanish bishop."),
          m("Nf6", "The Berlin: straight at e4."),
          m("O-O", "Castle anyway: you can win the pawn back."),
          m("Nxe4", "Black grabs the pawn."),
          m("Re1", "Pin the knight against the king's file and regain the material."),
        ],
      },
      {
        name: "Exchange Variation",
        idea: "Here you take on c6 yourself. Black gets the bishop pair but doubled pawns; aim for an endgame where your healthy kingside majority counts.",
        moves: [
          m("e4", "Centre."),
          m("e5", "Classical."),
          m("Nf3", "Attack e5."),
          m("Nc6", "Defend."),
          m("Bb5", "Spanish bishop."),
          m("a6", "Question the bishop."),
          m("Bxc6", "Take: Black's pawns get doubled."),
          m("dxc6", "Black recaptures toward the centre, opening the queen's file."),
          m("O-O", "Castle; e5 isn't really hanging yet (…Qd4 would fork)."),
        ],
      },
    ],
  },
  {
    id: "qgd",
    name: "Queen's Gambit",
    side: "w",
    summary: "1.d4 d5 2.c4: offer a wing pawn to pull Black's d-pawn away from the centre.",
    variations: [
      {
        name: "Declined (2…e6)",
        idea: "Black holds d5. Develop with Nc3 and Bg5 to pressure the knight that defends d5.",
        moves: [
          m("d4", "Centre."),
          m("d5", "Classical reply."),
          m("c4", "The gambit: challenge d5 from the side."),
          m("e6", "Declined: Black keeps a pawn on d5."),
          m("Nc3", "More pressure on d5."),
          m("Nf6", "Black defends d5 again."),
          m("Bg5", "Pin the defender of d5."),
          m("Be7", "Black breaks the pin."),
          m("e3", "Open the way for your other bishop."),
          m("O-O", "Black castles."),
          m("Nf3", "Develop and castle next."),
        ],
      },
      {
        name: "Accepted (2…dxc4)",
        idea: "Black takes the pawn but can't keep it. Play e3 and win it back with Bxc4, gaining a big centre.",
        moves: [
          m("d4", "Centre."),
          m("d5", "Classical."),
          m("c4", "The gambit."),
          m("dxc4", "Accepted: Black gives up the centre for a pawn."),
          m("e3", "Open the bishop's path to c4."),
          m("Nf6", "Black develops."),
          m("Bxc4", "Pawn regained, with a free hand in the centre."),
          m("e6", "Black opens their own bishop."),
          m("Nf3", "Develop and castle."),
        ],
      },
      {
        name: "Slav (2…c6)",
        idea: "Black supports d5 with the c-pawn, keeping the light bishop free. Develop knights first and keep an eye on c4.",
        moves: [
          m("d4", "Centre."),
          m("d5", "Classical."),
          m("c4", "The gambit."),
          m("c6", "The Slav: d5 is held without blocking the bishop."),
          m("Nf3", "Develop; Black might still take on c4."),
          m("Nf6", "Black develops."),
          m("Nc3", "Pressure d5 and guard e4."),
        ],
      },
    ],
  },
  {
    id: "sicilian",
    name: "Sicilian Defence",
    side: "b",
    summary: "1.e4 c5: Black fights for d4 from the side, leading to sharp, unbalanced games.",
    variations: [
      {
        name: "Open Sicilian (Najdorf)",
        idea: "White opens the centre with d4. Take on d4, develop …Nf6 and play …a6: flexible and solid.",
        moves: [
          m("e4", "White takes the centre."),
          m("c5", "The Sicilian: control d4 from the wing."),
          m("Nf3", "White prepares d4."),
          m("d6", "Prepare …Nf6 without allowing e5."),
          m("d4", "White opens the centre."),
          m("cxd4", "Trade your wing pawn for White's centre pawn."),
          m("Nxd4", "White recaptures."),
          m("Nf6", "Hit e4 so White must defend it."),
          m("Nc3", "White defends."),
          m("a6", "The Najdorf: control b5 and keep every option open."),
        ],
      },
      {
        name: "Against the Alapin (2.c3)",
        idea: "White wants to build a pawn centre with d4. Attack e4 with …Nf6 at once, then hop to d5.",
        moves: [
          m("e4", "Centre."),
          m("c5", "Sicilian."),
          m("c3", "The Alapin: White prepares d4."),
          m("Nf6", "Attack e4 before d4 arrives."),
          m("e5", "White chases the knight."),
          m("Nd5", "A great central square."),
          m("d4", "White builds the centre anyway."),
          m("cxd4", "Break it up."),
        ],
      },
    ],
  },
  {
    id: "french",
    name: "French Defence",
    side: "b",
    summary: "1.e4 e6 2.d4 d5: a tough, solid defence; Black counter-attacks White's centre with …c5.",
    variations: [
      {
        name: "Classical (3.Nc3)",
        idea: "White develops and defends e4. Pin or attack with …Nf6, then …Be7 for a sturdy position.",
        moves: [
          m("e4", "Centre."),
          m("e6", "Prepare …d5."),
          m("d4", "White takes the full centre."),
          m("d5", "Challenge e4 at once."),
          m("Nc3", "White defends e4."),
          m("Nf6", "Add pressure on e4."),
          m("Bg5", "White pins the knight."),
          m("Be7", "Unpin calmly."),
        ],
      },
      {
        name: "Advance (3.e5)",
        idea: "White locks the centre. Hit the base of the chain with …c5, then pile up on d4 with …Nc6 and …Qb6.",
        moves: [
          m("e4", "Centre."),
          m("e6", "French."),
          m("d4", "Centre."),
          m("d5", "Challenge."),
          m("e5", "The Advance: White gains space."),
          m("c5", "Attack the base of White's pawn chain (d4)."),
          m("c3", "White supports d4."),
          m("Nc6", "More pressure on d4."),
          m("Nf3", "White defends again."),
          m("Qb6", "Pile up on d4 and eye b2."),
        ],
      },
      {
        name: "Exchange (3.exd5)",
        idea: "White trades in the centre. The position is symmetrical; develop quickly and your light bishop is free now.",
        moves: [
          m("e4", "Centre."),
          m("e6", "French."),
          m("d4", "Centre."),
          m("d5", "Challenge."),
          m("exd5", "White releases the tension."),
          m("exd5", "Recapture: your light bishop is no longer blocked."),
          m("Nf3", "White develops."),
          m("Nf6", "Mirror and develop."),
        ],
      },
    ],
  },
  {
    id: "caro",
    name: "Caro-Kann Defence",
    side: "b",
    summary: "1.e4 c6 2.d4 d5: like the French, but the light bishop comes out to f5 before …e6.",
    variations: [
      {
        name: "Classical (3.Nc3 dxe4)",
        idea: "Take on e4 and develop the bishop to f5 with tempo, then retreat it to g6 when chased.",
        moves: [
          m("e4", "Centre."),
          m("c6", "Prepare …d5 with support."),
          m("d4", "White takes the centre."),
          m("d5", "Challenge e4."),
          m("Nc3", "White defends."),
          m("dxe4", "Trade off White's e-pawn."),
          m("Nxe4", "White recaptures."),
          m("Bf5", "Develop with an attack on the knight: the Caro-Kann bishop."),
          m("Ng3", "White chases the bishop."),
          m("Bg6", "Keep the bishop on its diagonal."),
        ],
      },
      {
        name: "Advance (3.e5)",
        idea: "White gains space. Get the bishop out to f5 first, then close with …e6 and later hit back with …c5.",
        moves: [
          m("e4", "Centre."),
          m("c6", "Caro-Kann."),
          m("d4", "Centre."),
          m("d5", "Challenge."),
          m("e5", "The Advance."),
          m("Bf5", "Bishop out before …e6 locks it in."),
          m("Nf3", "White develops."),
          m("e6", "Now the solid pawn wall."),
        ],
      },
    ],
  },
  {
    id: "kid",
    name: "King's Indian Defence",
    side: "b",
    summary: "1.d4 Nf6 2.c4 g6: let White build a big centre, then strike it with …e5 or …c5.",
    variations: [
      {
        name: "Classical (5.Nf3)",
        idea: "Fianchetto, castle, then hit the centre with …e5. Your bishop on g7 becomes a monster.",
        moves: [
          m("d4", "White's queen's pawn."),
          m("Nf6", "Control e4 without committing a pawn."),
          m("c4", "White grabs space."),
          m("g6", "Prepare the fianchetto."),
          m("Nc3", "White develops."),
          m("Bg7", "The long-diagonal bishop."),
          m("e4", "White builds the big centre."),
          m("d6", "Keep e5 in reserve."),
          m("Nf3", "White develops."),
          m("O-O", "King safe first."),
          m("Be2", "White prepares to castle."),
          m("e5", "The thematic strike at White's centre."),
        ],
      },
      {
        name: "Against the London (2.Bf4)",
        idea: "If White avoids c4 for a London set-up, keep the fianchetto and aim for …d6 and …e5 anyway.",
        moves: [
          m("d4", "Queen's pawn."),
          m("Nf6", "Flexible."),
          m("Bf4", "A London System."),
          m("g6", "Fianchetto anyway."),
          m("Nf3", "White develops."),
          m("Bg7", "Long diagonal."),
          m("e3", "White's London chain."),
          m("d6", "Prepare …e5 or …Nh5 to chase the bishop."),
        ],
      },
    ],
  },
];

export const openingById = (id: string) => OPENINGS.find((o) => o.id === id);

/** The legal move in `g` written as `text` in SAN (check marks ignored), or null. */
export function moveFromSan(g: Game, text: string): Move | null {
  const clean = (s: string) => s.replace(/[+#!?]/g, "");
  return legalMoves(g.position).find((mv) => clean(san(g.position, mv)) === clean(text)) ?? null;
}

export interface LessonState {
  /** Index of the next move in the variation. */
  index: number;
  done: boolean;
  /** The move expected next, and whose it is. */
  expected: LessonMove | null;
  yourTurn: boolean;
}

/** Where the lesson stands after `played` moves. */
export function lessonState(o: Opening, v: Variation, played: number): LessonState {
  const expected = v.moves[played] ?? null;
  const turn: Color = played % 2 === 0 ? "w" : "b";
  return { index: played, done: played >= v.moves.length, expected, yourTurn: turn === o.side };
}

/**
 * Check the student's move against the book. Returns "book" when it matches, otherwise a short
 * explanation of what the opening wants here.
 */
export function judgeMove(g: Game, v: Variation, played: number, from: number, to: number): { ok: true } | { ok: false; why: string } {
  const exp = v.moves[played];
  if (!exp) return { ok: true };
  const want = moveFromSan(g, exp.san);
  if (want && want.from === from && want.to === to) return { ok: true };
  return { ok: false, why: `In this line the move is ${exp.san}: ${exp.note}` };
}

/** Replay a variation's first `n` moves (for tests and for jumping back). */
export function replay(v: Variation, n: number, start: Game): Game | null {
  let g = start;
  for (const lm of v.moves.slice(0, n)) {
    const mv = moveFromSan(g, lm.san);
    if (!mv) return null;
    const r = play(g, mv.from, mv.to, mv.promotion);
    if (!r) return null;
    g = r.game;
  }
  return g;
}

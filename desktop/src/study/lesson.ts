// Study help, the pure part: turn the local model's JSON into a lesson (never trusting its shape),
// find each option and drag-and-drop item on screen from the recognised text lines, and break
// the lesson into short "waves" that appear on the chalkboard one after another: the answer
// first, then the explanation a little at a time, so there's never a wall of text.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenLine extends Box {
  text: string;
}

export type Kind = "multiple_choice" | "writing" | "drag_drop" | "other";

export interface Option {
  label: string;
  text: string;
  meaning: string;
}

export interface Pair {
  item: string;
  target: string;
  why: string;
}

export interface Lesson {
  kind: Kind;
  question: string;
  answer: string;
  answerLabel: string;
  options: Option[];
  concepts: string[];
  steps: string[];
  pairs: Pair[];
  brainstorm: string[];
  outline: string[];
  feedback: string[];
  hard: boolean;
  cheer: string;
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const list = (v: unknown, max = 8, len = 220) =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, len))
        .filter(Boolean)
        .slice(0, max)
    : [];

/** The model's reply as a lesson, or null if it isn't one. Tolerates text around the JSON. */
export function parseLesson(raw: string): Lesson | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      v = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kinds: Kind[] = ["multiple_choice", "writing", "drag_drop", "other"];
  const kind = kinds.includes(o.kind as Kind) ? (o.kind as Kind) : "other";
  const options = Array.isArray(o.options)
    ? o.options
        .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
        .map((x) => ({ label: str(x.label, 12), text: str(x.text, 200), meaning: str(x.meaning, 260) }))
        .filter((x) => x.label || x.text)
        .slice(0, 8)
    : [];
  const pairs = Array.isArray(o.pairs)
    ? o.pairs
        .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
        .map((x) => ({ item: str(x.item, 160), target: str(x.target, 160), why: str(x.why, 200) }))
        .filter((x) => x.item && x.target)
        .slice(0, 10)
    : [];
  const lesson: Lesson = {
    kind,
    question: str(o.question),
    answer: str(o.answer, 200),
    answerLabel: str(o.answerLabel, 12),
    options,
    concepts: list(o.concepts, 6, 80),
    steps: list(o.steps, 7),
    pairs,
    brainstorm: list(o.brainstorm),
    outline: list(o.outline),
    feedback: list(o.feedback),
    hard: o.hard === true,
    cheer: str(o.cheer, 120),
  };
  const empty = !lesson.answer && !lesson.steps.length && !lesson.options.length && !lesson.pairs.length && !lesson.brainstorm.length && !lesson.feedback.length;
  return empty ? null : lesson;
}

/** All the text in the box, top to bottom, for the model. */
export function screenText(lines: readonly ScreenLine[]): string {
  return lines.map((l) => l.text).join("\n");
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** How well a screen line matches some text (0..1): shared words, weighted by the text's words. */
function overlap(line: string, text: string): number {
  const a = new Set(norm(line).split(" ").filter((w) => w.length > 1 || /\d/.test(w)));
  const b = norm(text).split(" ").filter((w) => w.length > 1 || /\d/.test(w));
  if (!b.length) return 0;
  return b.filter((w) => a.has(w)).length / b.length;
}

/** A line that starts with this option label ("B", "B.", "(b)", "b)"). */
function startsWithLabel(line: string, label: string): boolean {
  if (!label) return false;
  const l = label.replace(/[^\p{L}\p{N}]/gu, "");
  return new RegExp(`^\\s*[\\(\\[]?${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\)\\].:]\\s`, "iu").test(`${line} `);
}

/** Where an option is on screen: its label at the start of a line, else the best text match. */
export function findOption(lines: readonly ScreenLine[], o: Pick<Option, "label" | "text">): ScreenLine | null {
  const byLabel = lines.find((l) => startsWithLabel(l.text, o.label) && (!o.text || overlap(l.text, o.text) > 0.3 || norm(l.text).length < 4));
  if (byLabel) return byLabel;
  return findText(lines, o.text);
}

/** The line that best matches some text (at least half its words), or null. */
export function findText(lines: readonly ScreenLine[], text: string): ScreenLine | null {
  if (!text) return null;
  let best: ScreenLine | null = null;
  let score = 0.5;
  for (const l of lines) {
    const s = overlap(l.text, text) + (norm(l.text) === norm(text) ? 1 : 0);
    if (s > score) {
      score = s;
      best = l;
    }
  }
  return best;
}

/** One piece of chalkboard writing. `point` is a box on screen the ghost cursor shows meanwhile. */
export interface Chalk {
  text: string;
  tone: "title" | "answer" | "label" | "plain" | "soft";
  point?: Box;
  /** Drag-and-drop: show this item being carried here. */
  carry?: { from: Box; to: Box; label: string };
  /** Circle it (the best choice). */
  circle?: boolean;
}

/** A wave: what appears on the board at once (one or two short lines). */
export type Wave = Chalk[];

/**
 * The lesson as waves: the answer first, then the explanation in small pieces. Multiple choice
 * ends by handing the choice back ("your pick!"); she never selects anything.
 */
export function waves(l: Lesson, lines: readonly ScreenLine[]): Wave[] {
  const out: Wave[] = [];
  const best = l.options.find((o) => o.label && o.label === l.answerLabel) ?? (l.answer ? l.options.find((o) => o.text && norm(l.answer).includes(norm(o.text))) : undefined);
  switch (l.kind) {
    case "writing": {
      out.push([{ text: "Let's plan it together!", tone: "title" }]);
      if (l.feedback.length) {
        out.push([{ text: "About your writing:", tone: "label" }]);
        for (const f of l.feedback) out.push([{ text: f, tone: "plain" }]);
        break;
      }
      if (l.concepts.length) out.push([{ text: "Key ideas", tone: "label" }, { text: l.concepts.join(" · "), tone: "plain" }]);
      if (l.brainstorm.length) {
        out.push([{ text: "Ideas to write about", tone: "label" }]);
        for (let i = 0; i < l.brainstorm.length; i += 2) out.push(l.brainstorm.slice(i, i + 2).map((t) => ({ text: `• ${t}`, tone: "plain" as const })));
      }
      if (l.outline.length) {
        out.push([{ text: "A shape for it", tone: "label" }]);
        l.outline.forEach((t, i) => out.push([{ text: `${i + 1}. ${t}`, tone: "plain" }]));
      }
      for (const s of l.steps) out.push([{ text: s, tone: "soft" }]);
      out.push([{ text: "The wording is up to you. Write it, then I'll review it.", tone: "soft" }]);
      break;
    }
    case "drag_drop": {
      out.push([{ text: "Answer", tone: "title" }, { text: l.answer || "Here's where each one goes:", tone: "answer" }]);
      for (const p of l.pairs) {
        const from = findText(lines, p.item);
        const to = findText(lines, p.target);
        out.push([
          { text: `${p.item} → ${p.target}`, tone: "label", ...(from && to ? { carry: { from, to, label: p.item } } : {}) },
          ...(p.why ? [{ text: p.why, tone: "plain" as const }] : []),
        ]);
      }
      if (l.concepts.length) out.push([{ text: `It's about: ${l.concepts.join(" · ")}`, tone: "soft" }]);
      out.push([{ text: "Drag them over yourself when you're ready.", tone: "soft" }]);
      break;
    }
    default: {
      const where = best ? findOption(lines, best) : null;
      out.push([{ text: "Answer", tone: "title" }, { text: l.answer || (best ? `${best.label}. ${best.text}` : ""), tone: "answer", ...(where ? { point: where, circle: true } : {}) }]);
      if (l.concepts.length) out.push([{ text: `It's about: ${l.concepts.join(" · ")}`, tone: "soft" }]);
      for (const s of l.steps) out.push([{ text: s, tone: "plain" }]);
      for (const o of l.options) {
        const at = findOption(lines, o);
        out.push([{ text: `${o.label ? `${o.label}. ` : ""}${o.text}${o === best ? "  ★" : ""}`, tone: "label", ...(at ? { point: at } : {}) }, ...(o.meaning ? [{ text: o.meaning, tone: "plain" as const }] : [])]);
      }
      if (l.kind === "multiple_choice") out.push([{ text: "Your choice. Pick the answer you think is right.", tone: "soft" }]);
    }
  }
  return out.filter((w) => w.some((c) => c.text));
}

/** Seconds a wave stays before the next one: time to read it, unhurried. */
export function waveTime(w: Wave): number {
  const words = w.reduce((n, c) => n + c.text.split(/\s+/).length, 0);
  return Math.min(9, Math.max(2.2, 1.2 + words * 0.32));
}

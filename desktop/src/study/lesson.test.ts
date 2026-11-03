import { describe, expect, it } from "vitest";
import { findOption, findText, parseLesson, screenText, waves, waveTime, type ScreenLine } from "./lesson";

const line = (text: string, y: number): ScreenLine => ({ text, x: 100, y, w: 300, h: 20 });
const screen = [line("Which organelle is the powerhouse of the cell?", 100), line("A. Nucleus", 140), line("B. Mitochondria", 170), line("C. Ribosome", 200), line("D. Golgi apparatus", 230), line("Next", 280)];

const reply = JSON.stringify({
  kind: "multiple_choice",
  question: "Which organelle makes the cell's energy?",
  answer: "B. Mitochondria",
  answerLabel: "B",
  options: [
    { label: "A", text: "Nucleus", meaning: "Holds DNA; doesn't make energy." },
    { label: "B", text: "Mitochondria", meaning: "Makes ATP through respiration." },
    { label: "C", text: "Ribosome", meaning: "Builds proteins." },
    { label: "D", text: "Golgi apparatus", meaning: "Packages proteins." },
  ],
  concepts: ["organelles", "energy"],
  steps: ["Cells need energy.", "ATP is that energy.", "Mitochondria make ATP."],
  hard: false,
  cheer: "You've got this!",
});

describe("study help lessons", () => {
  it("reads the model's lesson, and survives junk around it or missing fields", () => {
    const l = parseLesson(reply)!;
    expect(l.kind).toBe("multiple_choice");
    expect(l.options).toHaveLength(4);
    expect(parseLesson(`Sure! Here you go: ${reply} Hope that helps`)?.answerLabel).toBe("B");
    expect(parseLesson("no json here")).toBeNull();
    expect(parseLesson("{}")).toBeNull();
    expect(parseLesson(JSON.stringify({ kind: "weird", steps: ["one"] }))?.kind).toBe("other");
  });

  it("finds options on screen by their label, or by their words", () => {
    expect(findOption(screen, { label: "B", text: "Mitochondria" })?.y).toBe(170);
    expect(findOption(screen, { label: "", text: "Golgi apparatus" })?.y).toBe(230);
    expect(findText(screen, "something else entirely")).toBeNull();
    expect(screenText(screen).split("\n")).toHaveLength(6);
  });

  it("puts the answer first, circled on screen, then explains in short waves, and hands the choice back", () => {
    const w = waves(parseLesson(reply)!, screen);
    expect(w[0][0]).toMatchObject({ text: "Answer", tone: "title" });
    expect(w[0][1]).toMatchObject({ text: "B. Mitochondria", tone: "answer", circle: true, point: { y: 170 } });
    expect(w.every((wave) => wave.length <= 2)).toBe(true); // never a wall of text
    expect(w.some((wave) => wave[0].text.startsWith("B. Mitochondria  ★"))).toBe(true);
    expect(w[w.length - 1][0].text).toMatch(/Your choice/);
    for (const wave of w) expect(waveTime(wave)).toBeGreaterThanOrEqual(2.2);
  });

  it("drag and drop: shows each item carried to its place, and leaves the dragging to you", () => {
    const lines = [line("Mammal", 100), line("Bird", 140), line("Dog", 200), line("Eagle", 240)];
    const l = parseLesson(JSON.stringify({ kind: "drag_drop", answer: "Dog → Mammal, Eagle → Bird", pairs: [{ item: "Dog", target: "Mammal", why: "Has fur, feeds milk." }, { item: "Eagle", target: "Bird", why: "Feathers." }] }))!;
    const w = waves(l, lines);
    expect(w[1][0].carry).toEqual({ from: lines[2], to: lines[0], label: "Dog" });
    expect(w[w.length - 1][0].text).toMatch(/yourself/);
  });

  it("writing: ideas and an outline, never an essay; reviewing gives feedback on your own words", () => {
    const plan = waves(parseLesson(JSON.stringify({ kind: "writing", brainstorm: ["rivers shape land", "floods", "farming"], outline: ["Hook", "Two causes", "Conclusion"] }))!, []);
    expect(plan[0][0].text).toMatch(/plan it together/);
    expect(plan.flat().some((c) => c.text.startsWith("1. Hook"))).toBe(true);
    expect(plan[plan.length - 1][0].text).toMatch(/wording is up to you/);
    const review = waves(parseLesson(JSON.stringify({ kind: "writing", feedback: ["Strong opening.", "Add an example in paragraph two."] }))!, []);
    expect(review.flat().map((c) => c.text)).toContain("Add an example in paragraph two.");
  });
});

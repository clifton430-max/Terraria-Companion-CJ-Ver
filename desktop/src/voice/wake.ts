// Wake names for Wispr Flow: a dictation that starts with the main companion's name ("Rose, …",
// "Hey Rose, …", "Okay Goblin Girl …") is meant for her even if it was typed into another app.

const LEAD_INS = ["hey", "hi", "hello", "okay", "ok", "yo", "oi"];

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * What's left of a dictation after her name (and an optional lead-in), or null if it doesn't
 * start with one of `names`. Case, accents and the punctuation Wispr Flow adds don't matter.
 */
export function stripWake(text: string, names: readonly string[]): string | null {
  const words = text.trim();
  const lower = norm(words);
  let at = 0;
  const lead = LEAD_INS.find((l) => new RegExp(`^${l}\\b[\\s,.!]*`).test(lower));
  if (lead) at = lower.match(new RegExp(`^${lead}\\b[\\s,.!]*`))![0].length;
  // Longest names first ("Goblin Girl" before "Goblin").
  const sorted = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const n = norm(name);
    if (!lower.startsWith(n, at)) continue;
    const end = at + n.length;
    // A whole word: followed by the end, a space or punctuation (not "Roseanne").
    if (end < lower.length && /[\p{L}\p{N}]/u.test(lower[end])) continue;
    return words.slice(end).replace(/^[\s,.:;!?-]+/, "").trim();
  }
  return null;
}

import { describe, expect, it } from "vitest";
import { canSend, chatReducer, emptyChat, providerMessages, storableMessages } from "./model";

const send = (text: string, id = "1", screen = false) => ({ type: "send" as const, id, text, screen });

describe("chat state", () => {
  it("starts empty and won't send blank text or while a request is in flight", () => {
    const s = emptyChat();
    expect(s.entries).toHaveLength(0);
    expect(canSend(s, "   ")).toBe(false);
    const sent = chatReducer(s, send("hi"));
    expect(sent.pending).toEqual({ id: "1", screen: false });
    expect(canSend(sent, "again")).toBe(false);
    expect(chatReducer(sent, send("again", "2"))).toBe(sent);
  });

  it("renders the answer and clears the loading state", () => {
    let s = chatReducer(emptyChat(), send(" How do I mine? "));
    s = chatReducer(s, { type: "reply", id: "1", text: "Swing your pickaxe~", thumbnail: null });
    expect(s.pending).toBeNull();
    expect(s.entries.map((e) => [e.role, e.content])).toEqual([
      ["user", "How do I mine?"],
      ["assistant", "Swing your pickaxe~"],
    ]);
  });

  it("shows errors, refusals and cancellation as notices that are never sent to the model", () => {
    for (const kind of ["error", "refused", "cancelled"] as const) {
      let s = chatReducer(emptyChat(), send("q"));
      s = chatReducer(s, { type: "fail", id: "1", failure: { kind, message: `${kind}!` } });
      expect(s.pending).toBeNull();
      expect(s.entries[1]).toMatchObject({ role: "notice", tone: kind, content: `${kind}!` });
      expect(providerMessages(s.entries)).toEqual([{ role: "user", content: "q" }]);
    }
  });

  it("ignores late replies after cancel or clear", () => {
    let s = chatReducer(emptyChat(), send("q"));
    s = chatReducer(s, { type: "fail", id: "1", failure: { kind: "cancelled", message: "Cancelled." } });
    const late = chatReducer(s, { type: "reply", id: "1", text: "too late", thumbnail: null });
    expect(late).toBe(s);
    const cleared = chatReducer(chatReducer(emptyChat(), send("q")), { type: "clear" });
    expect(chatReducer(cleared, { type: "reply", id: "1", text: "x", thumbnail: null })).toEqual(emptyChat());
  });

  it("keeps screen questions separate and attaches a preview only when one is returned", () => {
    let s = chatReducer(emptyChat(), send("what's this?", "s", true));
    expect(s.pending).toEqual({ id: "s", screen: true });
    s = chatReducer(s, { type: "reply", id: "s", text: "A code editor.", thumbnail: "data:image/png;base64,AA" });
    expect(s.entries[0]).toMatchObject({ screen: true, thumbnail: "data:image/png;base64,AA" });
    expect(s.entries[1]).toMatchObject({ screen: true });
    // Previews never go to the model.
    expect(JSON.stringify(providerMessages(s.entries))).not.toContain("base64");
  });

  it("adds voice questions answered outside the chat (kept as normal context)", () => {
    const s = chatReducer(emptyChat(), { type: "append", question: "hi?", answer: "Hello~" });
    expect(providerMessages(s.entries)).toEqual([
      { role: "user", content: "hi?" },
      { role: "assistant", content: "Hello~" },
    ]);
    expect(s.pending).toBeNull();
  });

  it("saves nothing unless history keeping is on, and previews only if that's on too", () => {
    let s = chatReducer(emptyChat(), send("q", "1", true));
    s = chatReducer(s, { type: "reply", id: "1", text: "a", thumbnail: "data:image/png;base64,AA" });
    expect(storableMessages(s.entries, false, true)).toEqual([]);
    expect(storableMessages(s.entries, true, false).every((m) => m.thumbnail === null)).toBe(true);
    expect(storableMessages(s.entries, true, true)[0].thumbnail).toBe("data:image/png;base64,AA");
    const loaded = chatReducer(emptyChat(), { type: "load", messages: storableMessages(s.entries, true, false) });
    expect(loaded.entries.map((e) => e.content)).toEqual(["q", "a"]);
  });
});

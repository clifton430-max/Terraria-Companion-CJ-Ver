import { describe, expect, it } from "vitest";
import type { Prefs, PrefsPatch } from "../bridge";
import { defaultInventory } from "../combat/inventory";
import { CATALOG, executeAction, isInfoQuestion, itemFor, parseCommand, validateAction, type ActionId } from "./actions";
import { emptyRouter, route, wantsScreen, type RouterDeps } from "./router";

/** In-memory app: prefs patches merge like Rust's apply (top-level fields replaced). */
function fakeApp(overrides: Partial<Prefs> = {}, opts: { brokenField?: keyof Prefs } = {}) {
  const prefs = {
    visible: true,
    paused: false,
    scale: 3,
    companionMode: "stay",
    idlePose: "stand",
    idle: { mode: "rotate", interval: 30, paused: false },
    training: false,
    inventory: defaultInventory().slots,
    selectedSlot: 0,
    control: { flightSpeed: 320, toggleEnabled: true, toggleShortcut: "Control+Shift+C", scheme: "terraria", silkKeys: {} },
    theme: { enabled: true, garland: true, grass: true, petals: true, density: 0.35, speed: 1, wind: 0.25, sway: 0.5, spin: 0.5, size: 1, style: "drift", layer: "behind", map: "sakura" },
    persona: { intensity: "normal", spontaneous: true, frequency: 1, attention: true, quietHours: false, quietStart: 22, quietEnd: 8, decay: 1.5, bubblePink: 0.5, showAffection: false, cookieEnabled: true, cookieShortcut: "Control+Shift+K" },
    affection: { value: 60, updated: 0, cookies: 0 },
    audio: { muted: false, voiceEnabled: true, voiceVolume: 1, sfxVolume: 1, voice: "active" },
    awareness: { screenEnabled: false },
    build: { toggleEnabled: true, toggleShortcut: "Control+Shift+B", kind: "dirt", blocks: [{ c: 1, r: 0, k: "dirt" }] },
    lines: { toggleEnabled: true, toggleShortcut: "Control+Shift+P", show: false, items: [{ x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5 }] },
    ...overrides,
  } as unknown as Prefs;
  const state = { prefs, control: false, build: false, lines: false, calls: [] as string[], openWindows: 0 };
  const deps: RouterDeps = {
    getPrefs: async () => structuredClone(state.prefs),
    patchPrefs: async (p: PrefsPatch) => {
      const next = { ...state.prefs, ...p } as Prefs;
      if (opts.brokenField && opts.brokenField in p) (next as unknown as Record<string, unknown>)[opts.brokenField] = (state.prefs as unknown as Record<string, unknown>)[opts.brokenField];
      state.prefs = next;
    },
    getControlMode: async () => state.control,
    setControlMode: async (on) => void (state.control = on),
    getBuildMode: async () => state.build,
    setBuildMode: async (on) => void (state.build = on),
    getLinesMode: async () => state.lines,
    setLinesMode: async (on) => void (state.lines = on),
    combat: async (a) => void state.calls.push(a),
    showSettings: async (tab) => void state.calls.push(`settings:${tab}`),
    showInventory: async () => void state.calls.push("inventory"),
    showChat: async () => void state.calls.push("chat"),
    startGame: async (mode) => (state.calls.push(`game:${mode}`), { ok: true, blocked: 0 }),
    stopGame: async () => void state.calls.push("game:stop"),
  };
  return { state, deps };
}

const id = (text: string) => {
  const p = parseCommand(text);
  return p?.kind === "action" ? p.action.id : p?.kind ?? null;
};

describe("natural-language companion commands", () => {
  it("understands the example requests", () => {
    const cases: [string, ActionId][] = [
      ["Switch me to character control mode.", "control.on"],
      ["Turn on Roam Mode.", "mode.roam"],
      ["Make her stop moving.", "mode.stay"],
      ["Change her idle animation.", "idle.pose"],
      ["Turn the petals down.", "petals.less"],
      ["Switch to Silksong controls.", "scheme.silksong"],
      ["Give me my pickaxe.", "equip"],
      ["Open your settings.", "settings.open"],
      ["Make your speech bubble pinker.", "bubble.pinker"],
    ];
    for (const [text, want] of cases) expect(id(text), text).toBe(want);
  });

  it("handles other phrasings", () => {
    expect(id("could you let me control you?")).toBe("control.on");
    expect(id("exit control mode please")).toBe("control.off");
    expect(id("go back to terraria controls")).toBe("scheme.terraria");
    expect(id("let her wander around")).toBe("mode.roam");
    expect(id("please stay put")).toBe("mode.stay");
    expect(id("more petals!")).toBe("petals.more");
    expect(id("no petals please, turn them off")).toBe("petals.off");
    expect(id("summon the moon lord")).toBe("boss.moon");
    expect(id("can I have a cookie")).toBe("cookie.give");
    expect(id("equip the zenith")).toBe("equip");
    expect(id("mute yourself")).toBe("sound.mute");
    expect(id("sit down")).toBe("idle.pose");
    expect(id("clear all my blocks")).toBe("blocks.clear");
    expect(id("reset your affection")).toBe("affection.reset");
  });

  it("driving her yourself means Control mode, not Roam", () => {
    expect(id("I want to drive her around myself")).toBe("control.on");
    expect(id("let me play as her")).toBe("control.on");
  });

  it("leaves questions and ordinary chat alone", () => {
    for (const t of ["What is roam mode?", "How do I beat the Moon Lord?", "What's the capital of France?", "Tell me a joke", "explain this error", "how does silksong pogo work"]) {
      expect(parseCommand(t), t).toBeNull();
    }
    expect(isInfoQuestion("what is control mode")).toBe(true);
    expect(isInfoQuestion("can you turn on control mode")).toBe(false);
  });

  it("picks the strongest pickaxe for 'my pickaxe' and resolves item names", () => {
    expect(itemFor("my pickaxe")?.id).toBe("picksaw");
    expect(itemFor("zenith")?.id).toBe("zenith");
    expect(itemFor("needle")?.id).toBe("needle");
    expect(itemFor("xyzzy")).toBeNull();
  });

  it("validates actions proposed by the local model", () => {
    expect(validateAction({ action: "mode.roam" })).toEqual({ id: "mode.roam" });
    expect(validateAction({ action: "rm -rf" })).toBeNull();
    expect(validateAction({ action: "equip", args: { item: "my pickaxe" } })).toEqual({ id: "equip", args: { item: "picksaw" } });
    expect(validateAction({ action: "equip", args: { item: "banana" } })).toBeNull();
    expect(validateAction({ action: "settings.open", args: { tab: "evil" } })).toEqual({ id: "settings.open", args: { tab: "companion" } });
  });

  it("only destructive and privacy actions need confirmation", () => {
    const confirms = (Object.keys(CATALOG) as ActionId[]).filter((k) => CATALOG[k].confirm);
    expect(confirms.sort()).toEqual(["affection.reset", "blocks.clear", "companion.hide", "lines.clear", "screen.on"]);
  });
});

describe("executing actions (verified)", () => {
  it("switches control mode and reports it", async () => {
    const { state, deps } = fakeApp();
    const r = await executeAction({ id: "control.on" }, deps);
    expect(r.ok).toBe(true);
    expect(state.control).toBe(true);
  });

  it("changes real settings and verifies them", async () => {
    const { state, deps } = fakeApp();
    expect((await executeAction({ id: "mode.roam" }, deps)).ok).toBe(true);
    expect(state.prefs.companionMode).toBe("roam");
    expect((await executeAction({ id: "scheme.silksong" }, deps)).ok).toBe(true);
    expect(state.prefs.control.scheme).toBe("silksong");
    await executeAction({ id: "petals.less" }, deps);
    expect(state.prefs.theme.density).toBeCloseTo(0.2);
    await executeAction({ id: "bubble.pinker" }, deps);
    expect(state.prefs.persona.bubblePink).toBeCloseTo(0.75);
    await executeAction({ id: "idle.pose", args: { pose: "next" } }, deps);
    expect(state.prefs.idlePose).toBe("sit");
    expect(state.prefs.idle?.mode).toBe("fixed");
  });

  it("equips the pickaxe, swapping from the backpack if needed", async () => {
    const { state, deps } = fakeApp({ selectedSlot: 2 } as Partial<Prefs>);
    const r = await executeAction({ id: "equip", args: { item: "picksaw" } }, deps);
    expect(r.ok).toBe(true);
    expect(state.prefs.inventory?.[state.prefs.selectedSlot]).toBe("picksaw");
    const z = await executeAction({ id: "equip", args: { item: "zenith" } }, deps);
    expect(z.ok).toBe(true);
    expect(state.prefs.inventory?.[state.prefs.selectedSlot]).toBe("zenith");
  });

  it("never claims success when the setting didn't change", async () => {
    const { state, deps } = fakeApp({}, { brokenField: "companionMode" });
    const r = await executeAction({ id: "mode.roam" }, deps);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/didn't take/);
    expect(state.prefs.companionMode).toBe("stay");
  });

  it("opens settings and spawns cookies through the app", async () => {
    const { state, deps } = fakeApp();
    await executeAction({ id: "settings.open", args: { tab: "companion" } }, deps);
    await executeAction({ id: "cookie.give" }, deps);
    expect(state.calls).toEqual(["settings:companion", "spawnCookie"]);
  });
});

describe("routing", () => {
  it("asks before destructive changes and respects the answer", async () => {
    const { state, deps } = fakeApp();
    let r = await route("clear all the blocks", emptyRouter(), deps);
    expect(r.route.kind).toBe("confirm");
    expect(state.prefs.build.blocks).toHaveLength(1);
    const declined = await route("no", r.state, deps);
    expect(declined.route.kind).toBe("declined");
    expect(state.prefs.build.blocks).toHaveLength(1);
    r = await route("clear all the blocks", emptyRouter(), deps);
    const yes = await route("yes", r.state, deps);
    expect(yes.route.kind).toBe("done");
    expect(state.prefs.build.blocks).toHaveLength(0);
    expect(yes.state.pending).toBeNull();
  });

  it("asks a short follow-up when the target is unclear", async () => {
    const { deps } = fakeApp();
    const r = await route("turn it off", emptyRouter(), deps);
    expect(r.route.kind).toBe("clarify");
  });

  it("uses the local model for unusual phrasing, but only within the catalog", async () => {
    const { state, deps } = fakeApp();
    const r = await route("could you make the little sakura things vanish", emptyRouter(), { ...deps, classify: async () => JSON.stringify({ action: "petals.off" }) });
    expect(r.route.kind).toBe("done");
    expect(state.prefs.theme.petals).toBe(false);
    // A model pick that doesn't clearly match the wording is confirmed first, not executed.
    const unsure = await route("please do the thing", emptyRouter(), { ...deps, classify: async () => JSON.stringify({ action: "mode.roam" }) });
    expect(unsure.route.kind).toBe("confirm");
    expect(state.prefs.companionMode).toBe("stay");
    const ok = await route("yes", unsure.state, deps);
    expect(ok.route.kind).toBe("done");
    expect(state.prefs.companionMode).toBe("roam");
    const bad = await route("please do the thing", emptyRouter(), { ...deps, classify: async () => JSON.stringify({ action: "format.disk" }) });
    expect(bad.route).toEqual({ kind: "ask", screen: false });
    const down = await route("please do the thing", emptyRouter(), { ...deps, classify: async () => Promise.reject(new Error("offline")) });
    expect(down.route.kind).toBe("ask");
  });

  it("sends ordinary questions to the assistant, with a screenshot when they're about the screen", async () => {
    const { deps } = fakeApp();
    let called = false;
    const classify = async () => ((called = true), JSON.stringify({ action: "none" }));
    expect((await route("What's the capital of France?", emptyRouter(), { ...deps, classify })).route).toEqual({ kind: "ask", screen: false });
    expect(called).toBe(false); // plain questions never even reach the action router
    for (const q of ["What am I looking at?", "Explain this error", "What should I do here?", "what's on my screen"]) {
      expect((await route(q, emptyRouter(), deps)).route, q).toEqual({ kind: "ask", screen: true });
    }
    expect(wantsScreen("Explain this error: " + "x".repeat(300))).toBe(false); // pasted text carries its own context
  });
});

describe("taking you to macOS System Settings", () => {
  const pane = (t: string) => {
    const p = parseCommand(t);
    return p?.kind === "action" && p.action.id === "macos.open" ? p.action.args?.pane : null;
  };
  it("understands requests for the Mac's settings", () => {
    expect(pane("take me to my bluetooth settings")).toBe("bluetooth");
    expect(pane("where can I change my wallpaper?")).toBe("wallpaper");
    expect(pane("open wifi settings")).toBe("wifi");
    expect(pane("open my mac's microphone permissions")).toBe("microphone");
    expect(pane("open system settings")).toBe("main");
    expect(pane("how do I change the screen recording permission")).toBe("screen-recording");
    expect(pane("open display settings on my mac")).toBe("displays");
  });

  it("leaves the companion's own settings and other requests alone", () => {
    expect(pane("open your settings")).toBeNull();
    expect(pane("mute yourself")).toBeNull();
    expect(pane("what is bluetooth?")).toBeNull();
    expect(pane("open the chat window")).toBeNull();
    const p = parseCommand("Open your settings.");
    expect(p?.kind === "action" && p.action.id).toBe("settings.open");
  });

  it("opens the pane through the app and reports honestly", async () => {
    const opened: string[] = [];
    const { deps } = fakeApp();
    const ok = await executeAction({ id: "macos.open", args: { pane: "bluetooth" } }, { ...deps, openSystemSettings: async (p) => (opened.push(p), true) });
    expect(ok.ok).toBe(true);
    expect(opened).toEqual(["bluetooth"]);
    const fail = await executeAction({ id: "macos.open", args: { pane: "bluetooth" } }, { ...deps, openSystemSettings: async () => false });
    expect(fail.ok).toBe(false);
    expect(validateAction({ action: "macos.open", args: { pane: "evil" } })).toEqual({ id: "macos.open", args: { pane: "main" } });
  });
});

describe("maps by request", () => {
  it("switches between Snow and Cherry Blossom (verified)", async () => {
    expect(id("switch to the snow map")).toBe("map.snow");
    expect(id("make it snow")).toBe("map.snow");
    expect(id("back to cherry blossoms")).toBe("map.sakura");
    expect(id("turn the snow down")).toBe("petals.less");
    const { state, deps } = fakeApp();
    expect((await executeAction({ id: "map.snow" }, deps)).ok).toBe(true);
    expect(state.prefs.theme.map).toBe("snow");
    expect((await executeAction({ id: "map.sakura" }, deps)).ok).toBe(true);
    expect(state.prefs.theme.map).toBe("sakura");
  });
});

describe("chess and movement modes by voice or text", () => {
  const chars = (behavior?: object) => ({
    characters: { active: ["terrarian"], selected: "terrarian", interactions: true, interactionFrequency: 1, autoFight: true, aiFlight: true, per: [], ...(behavior ? { behavior } : {}) },
  });
  const threeLines = { lines: { toggleEnabled: true, toggleShortcut: "Control+Shift+P", show: false, items: [
    { x1: 0.1, y1: 0.6, x2: 0.3, y2: 0.6 },
    { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.3 },
    { x1: 0.7, y1: 0.7, x2: 0.9, y2: 0.7 },
  ] } };

  it("opens and closes chess from natural phrasings", () => {
    for (const t of ["let's play chess", "Play chess", "pull up the chessboard", "can we play a game of chess?", "how about a game of chess?", "I want to play chess", "bring out the chess board", "chess time!"]) expect(id(t), t).toBe("chess.open");
    for (const t of ["put the chess board away", "close the chess board", "no more chess", "I'm done with chess", "pack up the chess set"]) expect(id(t), t).toBe("chess.close");
  });

  it("leaves chess questions and stories to the chat", () => {
    for (const t of ["how do knights move in chess?", "what's the best chess opening?", "I played chess with my dad yesterday", "who invented chess"]) expect(id(t), t).toBeNull();
  });

  it("understands the movement modes", () => {
    const cases: [string, ActionId][] = [
      ["spread out a bit", "behavior.spread"],
      ["could you guys spread out?", "behavior.spread"],
      ["don't bunch up so much", "behavior.spread"],
      ["stay together please", "behavior.together"],
      ["be more jumpy", "behavior.jumpy"],
      ["jump around more!", "behavior.jumpy"],
      ["hop around between platforms", "behavior.jumpy"],
      ["stay grounded", "behavior.grounded"],
      ["please stop jumping so much", "behavior.grounded"],
      ["keep your feet on the ground", "behavior.grounded"],
      ["go watch from platform 2", "behavior.watch"],
      ["hang out on the top platform", "behavior.watch"],
      ["pick a hangout spot", "behavior.watch"],
      ["stop hanging out on the platform", "behavior.unwatch"],
      ["reset your movement", "behavior.reset"],
      ["go back to normal movement", "behavior.reset"],
    ];
    for (const [text, want] of cases) expect(id(text), text).toBe(want);
  });

  it("catches the everyday ways of asking for jumping and spreading out", () => {
    for (const t of ["become jumpy", "become jumping", "start jumping", "jump around", "make them jumpy", "jumpy mode", "jumping mode", "everyone jump on the platforms", "go jump on the platforms", "be bouncy"]) expect(id(t), t).toBe("behavior.jumpy");
    for (const t of ["spread apart", "you guys spread apart", "everyone spread out", "girls, give each other some space", "can you all spread apart"]) expect(id(t), t).toBe("behavior.spread");
  });

  it("a model guess of 'hang out on a platform' for a jumping request is confirmed, not run", async () => {
    const { state, deps } = fakeApp({ ...chars(), ...threeLines } as Partial<Prefs>);
    const r = await route("could the girls get more boingy", emptyRouter(), { ...deps, classify: async () => JSON.stringify({ action: "behavior.watch", args: { which: "top" } }) });
    expect(r.route.kind).toBe("confirm");
    expect(state.prefs.characters!.behavior).toBeUndefined();
    const ok = await route("make the girls hop a lot", emptyRouter(), { ...deps, classify: async () => JSON.stringify({ action: "behavior.jumpy" }) });
    expect(ok.route.kind).toBe("done");
  });

  it("never treats unrelated speech as a movement command", () => {
    for (const t of ["I jump around a lot when I'm excited", "watch out!", "watch this", "my cat is so jumpy", "the ground is wet today", "we spread the butter thin", "I was hanging out with friends", "the cat is jumping on the couch", "that movie had a jump scare"]) expect(id(t), t).toBeNull();
    // Platform editing and clearing still mean what they did.
    expect(id("edit platforms")).toBe("lines.on");
    expect(id("clear all the platforms")).toBe("lines.clear");
  });

  it("sends the chess commands to the overlay", async () => {
    const { state, deps } = fakeApp();
    const r = await route("let's play chess", emptyRouter(), deps);
    expect(r.route.kind).toBe("done");
    expect(state.calls).toContain("openChess");
    await route("put the chess board away", emptyRouter(), deps);
    expect(state.calls).toContain("closeChess");
  });

  it("saves movement modes, combines them, and resets", async () => {
    const { state, deps } = fakeApp(chars() as Partial<Prefs>);
    expect((await executeAction({ id: "behavior.spread" }, deps)).ok).toBe(true);
    expect((await executeAction({ id: "behavior.grounded" }, deps)).ok).toBe(true);
    expect(state.prefs.characters!.behavior).toEqual({ spread: true, jump: "grounded", watch: null });
    expect((await executeAction({ id: "behavior.jumpy" }, deps)).ok).toBe(true);
    expect(state.prefs.characters!.behavior!.jump).toBe("jumpy");
    expect(state.prefs.characters!.behavior!.spread).toBe(true);
    const reset = await executeAction({ id: "behavior.reset" }, deps);
    expect(reset.ok).toBe(true);
    expect(state.prefs.characters!.behavior).toEqual({ spread: false, jump: "normal", watch: null });
  });

  it("picks the hangout by number or place, or asks on screen", async () => {
    const { state, deps } = fakeApp({ ...chars(), ...threeLines } as Partial<Prefs>);
    const r = await executeAction({ id: "behavior.watch", args: { which: "go watch from platform 2" } }, deps);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Platform 2");
    expect(state.prefs.characters!.behavior!.watch).toEqual(threeLines.lines.items[1]);
    await executeAction({ id: "behavior.watch", args: { which: "the lowest platform" } }, deps);
    expect(state.prefs.characters!.behavior!.watch).toEqual(threeLines.lines.items[2]);
    await executeAction({ id: "behavior.watch", args: { which: "the left one" } }, deps);
    expect(state.prefs.characters!.behavior!.watch).toEqual(threeLines.lines.items[0]);
    const pick = await executeAction({ id: "behavior.watch", args: { which: "hang out on a platform" } }, deps);
    expect(pick.ok).toBe(true);
    expect(state.calls).toContain("pickHangout");
    const missing = await executeAction({ id: "behavior.watch", args: { which: "platform 7" } }, deps);
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("1 to 3");
    expect((await executeAction({ id: "behavior.unwatch" }, deps)).ok).toBe(true);
    expect(state.prefs.characters!.behavior!.watch).toBeNull();
  });

  it("explains instead of inventing a platform when there are none", async () => {
    const { state, deps } = fakeApp({ ...chars(), lines: { toggleEnabled: true, toggleShortcut: "Control+Shift+P", show: false, items: [] } } as Partial<Prefs>);
    const r = await executeAction({ id: "behavior.watch", args: { which: "platform 1" } }, deps);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/aren't any invisible platforms/);
    expect(state.prefs.characters!.behavior).toBeUndefined();
    expect(state.calls).not.toContain("pickHangout");
  });

  it("validates model-proposed movement actions", () => {
    // Over-long args are dropped; Watch then falls back to letting the user pick on screen.
    expect(validateAction({ action: "behavior.watch", args: { which: "x".repeat(80) } })).toEqual({ id: "behavior.watch", args: { which: "pick" } });
    expect(validateAction({ action: "behavior.watch" })).toEqual({ id: "behavior.watch", args: { which: "pick" } });
    expect(validateAction({ action: "chess.open" })).toEqual({ id: "chess.open" });
  });
});

describe("the Terraria world background by voice or text", () => {
  it("shows, hides and explores the world", () => {
    expect(id("show the terraria world")).toBe("world.show");
    expect(id("flip the board")).toBe("chess.flip");
    expect(id("switch to the chess map")).toBe("map.chess");
    expect(id("can you help me with my homework")).toBe("study.help");
    expect(id("explain this question to me")).toBe("study.help");
    expect(id("tutor me please")).toBe("study.help");
    expect(id("use the hollow knight theme")).toBe("map.chess");
    expect(id("turn the chess board around")).toBe("chess.flip");
    expect(id("rotate the chessboard")).toBe("chess.flip");
    expect(id("put the terraria world behind my windows")).toBe("world.show");
    expect(id("hide the world background")).toBe("world.hide");
    expect(id("let me explore the world")).toBe("world.explore");
    expect(id("what is the biggest country in the world")).toBeNull();
  });
  it("saves the setting and asks Rust to start exploring", async () => {
    const { state, deps } = fakeApp();
    expect((await executeAction({ id: "world.show" }, deps)).ok).toBe(true);
    expect(state.prefs.world?.enabled).toBe(true);
    await executeAction({ id: "world.explore" }, deps);
    expect(state.calls).toContain("exploreWorld");
    expect((await executeAction({ id: "world.hide" }, deps)).ok).toBe(true);
    expect(state.prefs.world?.enabled).toBe(false);
  });
});

describe("playing Terraria by voice or text", () => {
  it("tells playing yourself from letting the companions play", () => {
    expect(id("play terraria")).toBe("game.play");
    expect(id("let me play terraria")).toBe("game.play");
    expect(id("let the girls play terraria")).toBe("game.auto");
    expect(id("play terraria for me")).toBe("game.auto");
    expect(id("build me a house in terraria")).toBe("game.auto");
    expect(id("stop playing")).toBe("game.stop");
    expect(id("play chess with me")).not.toBe("game.play");
    expect(id("show the terraria world")).toBe("world.show");
  });
  it("starts with other windows still open (the world keeps running behind them)", async () => {
    const { state, deps } = fakeApp();
    state.openWindows = 2;
    expect((await executeAction({ id: "game.auto" }, deps)).ok).toBe(true);
    expect((await executeAction({ id: "game.play" }, deps)).ok).toBe(true);
    expect((await executeAction({ id: "game.stop" }, deps)).ok).toBe(true);
    expect(state.calls).toEqual(["game:auto", "game:player", "game:stop"]);
  });
});

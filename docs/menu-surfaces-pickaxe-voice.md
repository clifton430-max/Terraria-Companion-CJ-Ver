# Right-click menu, surface segments, pickaxe animation, assistant settings and voice input

This milestone was built in five steps. The chat AI provider is unchanged: it still uses the local
Ollama model.

## 1. Right-click menu (`src/overlay/contextMenu.ts`)

Right-clicking the character opens a small Terraria-style menu beside it. It sits to the right of
the character, flips left near the screen edge, and always stays on screen.

| Item | What it does |
| --- | --- |
| Ask a question… | Opens the chat and focuses the message box |
| Open chat | Opens the chat |
| Ask about my screen | Opens the chat and starts a screen question (the existing privacy checks still apply) |
| Start voice input | Starts push-to-talk; disabled until voice input is enabled |
| Stay put here / Stop staying put | Switches Stay-Put on or off |
| Idle pose | Rotate automatically, or one of the six poses |
| Companion settings | Opens the inventory window |
| Close | Closes the menu |

**Click-through:** while the menu is open, its box is added to the overlay's interactive region.
Everywhere else still passes clicks through to your apps.

**Closing:** it closes when you choose an item, left-click the character, or leave it alone for
8 s. A right-click never starts a drag.

## 2. Surface segments (`src/engine/physics.ts`, `src/engine/platforms.ts`)

- **Segments:** walkable surfaces are line segments. A segment can have a different height at its
  right end (`topRight`), which makes it a slope. Up to about 50° is walkable; steeper segments are
  ignored as surfaces.
- **Support:** each step re-finds what's under the feet.
  - The body's own window is followed at any height, so a window moving between polls is fine.
  - Otherwise it moves onto an adjoining segment within 6 px up or 14 px down. This gives smooth
    slopes, corners and cross-window walking.
  - Gaps and bigger drops are real falls. Segments far from the feet are never snapped to.
- **Walls:** vertical boundaries (`Wall`). `junctionWalls` adds one where a taller window in front
  covers part of another window's top.
  - Walls only stop a grounded body whose feet are on that top.
  - Walking on the floor in front of windows, jumps, throws and Control-mode flight are never
    blocked.
- **Refreshing:** geometry is rebuilt from every window snapshot (every 100 ms), so moved, resized,
  new, closed and cross-display windows are handled.
- **Not supported:**
  - Windows only provide horizontal tops and vertical sides, so slopes never come from window
    geometry (the engine supports them for explicitly supplied segments).
  - Rounded corners, transparent window areas and window contents aren't treated as geometry.

Tests: `src/engine/segments.test.ts` (16).

## 3. Terraria-style pickaxe (`src/combat/pickaxeAnim.ts`)

- **Assets:** Terraria has no separate held-pickaxe frames. The item sprite (Copper Pickaxe,
  `Item_1`) pivots in the hand while the arm steps through the player sheet's use frames
  (`use1`–`use4`).
- **Swing:** linear, about 200°, from behind the head (-160°) to forward and down (40°). This is an
  approximation from observed gameplay, not taken from game code.
  - The hitbox uses the same arc.
  - The sprite is drawn at Terraria's pixel scale, with no sword slash, mirrored when facing left.
- **Strike:** when the head points 15° below forward (about 88% through the swing). The impact
  burst and cracking letters appear at the drawn head.
- **Cancelling:** grabbing the character, switching Control mode, or switching apps cancels a swing
  with no strike. The cooldown setting still applies.

Tests: `src/combat/pickaxeAnim.test.ts` (8).

## 4. Assistant settings (Inventory → Awareness → *Assistant & voice input*)

- **Provider status:** local Ollama, no API key needed.
- **Model:** a picker over installed Ollama models (default "auto").
- **Answer length:** Short, Medium or Long. This sets both the instruction and the token limit:

  | Length | Token limit |
  | --- | --- |
  | Short | 160 |
  | Medium | 512 |
  | Long | 1500 |

- **Voice input:** enable switch, shortcut capture (validated, with macOS system shortcuts
  refused), hold-to-talk or toggle, microphone choice, and whether to review the transcript before
  it's sent.

## 5a. Voice through Wispr Flow (the default; `src-tauri/src/wispr.rs`, `src/voice/wake.ts`)

Assistant settings → *Voice input* → **Wispr Flow** (default) or **Apple Speech push-to-talk**
(below). Wispr Flow has no API: it types what you say into whichever text field has focus. So the
companion works with that instead of listening herself:

- **Its key:** press Wispr Flow's dictation key (push-to-talk or hands-free, read from its own
  `config.json`; fn and fn+Space by default) with no other app's text field focused, and her
  voice card opens with an input that takes focus, so the words land there. With *Send
  automatically* on, it's sent about a second after Wispr Flow finishes typing; otherwise press
  Enter. Her own voice shortcut opens the same input.
- **Her name:** a dictation that starts with the main companion's name, built-in or custom, with
  or without a lead-in ("Hey Rose, …", "Okay Goblin Girl …"), is hers even if it went into another
  app. Wispr Flow's local history (`flow.sqlite`, read only, checked when it changes; only the
  text and target app of new entries) shows it; she presses ⌘Z in that app to take it back out and
  answers. If that app isn't frontmost any more, or there's no permission, she says she couldn't.
- **When it can't work** (not installed, not running, no dictation key set, or no Accessibility
  permission), she says so in a bubble when you press the key, and offers to open Wispr Flow if
  it's only not running. Nothing else listens instead.
- **Permissions:** seeing Wispr Flow's key and pressing ⌘Z need Accessibility. Without it, her
  own voice shortcut still opens her input.

## 5. Push-to-talk voice input (`src-tauri/src/voice.rs`, `src/voice/`)

**Shortcut:**
- The global shortcut (default ⌃⇧Space) is registered with Tauri's global-shortcut plugin, and
  only while voice input is enabled.
- Key down and key up drive the state machine (`machine.ts`) in hold or toggle mode.
- If registration fails, settings show why.

**Flow:**
1. **Listening:** a red card with a level meter, Cancel and Done. The character glows red. The
   recording stops at 30 s.
2. **Transcribing:** the recording is converted to a 16 kHz mono WAV in memory and piped to the
   bundled Swift helper (`helpers/speech-helper.swift`, Apple Speech framework, on-device when
   supported). Nothing is written to disk.
3. **Review:** you can edit the transcript, then Enter sends it.
4. **Thinking:** the question goes to the local assistant.
5. **Answer:** shown in the card, with **Open chat** (copies the question and answer into the chat)
   and **Close**.

**Permissions:** macOS asks once each. Grant them in System Settings → Privacy & Security:
- Microphone
- Speech Recognition

**Build:** `tauri build` first runs `src-tauri/helpers/build.sh` (needs
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` while the Xcode license is unaccepted). The
helper is bundled as an external binary next to the app executable. `src-tauri/bin/` is
git-ignored.

Tests: `src/voice/voice.test.ts` (13) and `voice.rs` (5).

## Not built

Breaking letters and icons that appear in other apps (for example a browser address bar) isn't
part of this project. The existing pickaxe effect cracks glyphs that the companion draws itself
near the pointer.

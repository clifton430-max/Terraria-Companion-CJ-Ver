# Screen awareness, reactions, idle poses and chat

## App awareness (app-switch reactions)

**How the frontmost app is detected:**
- A background thread samples `NSWorkspace.frontmostApplication` every 0.5 s. It reads only the
  bundle id and display name.
- This needs no macOS permission and never takes screenshots.
- It runs only while app awareness or screen understanding is on.
- Only the current app is held in memory. No list or history is kept, and nothing is written to
  disk.
- Same-app window switches are noticed by comparing window ids (never titles). This happens only
  when a rule asks for it.

**Reactions** (`src/reactions/engine.ts`): each rule has
- the app (bundle id, or `*` as the fallback for apps without their own rule) and whether it's
  enabled
- comments (one is picked at random, never the same one twice in a row)
- an optional voice line and pose
- a cooldown, a frequency (chance) and a per-rule quiet flag

Rules for when a reaction fires:
- An app must stay in front for 1.5 s, so rapid switching only reacts to where you settle.
- There are at least 90 s between any two reactions.
- An app's own disabled rule means "never". It does not fall back to `*`.
- Global quiet mode removes spoken reactions, and can optionally hide the speech bubbles too.

**Defaults:**

| Rule | Frequency | Cooldown |
| --- | --- | --- |
| Terraria (`org.Terraria`) | 100% | 15 min |
| VS Code | 50% | 30 min |
| Any other app | 25% | 30 min |

Every default comment can be edited or deleted under Inventory → **Awareness** → App reactions,
which also has a **Preview** button for each rule.

**Voice:** voice lines can only be the installed companion Voice Pack's four clips (its hit and death
sounds). If the pack is missing, the text shows on its own.

## Screen understanding ("Ask about my screen")

It's off by default and only runs when you press the button in the chat. Checks run in this order,
and each refusal is explained without falling back to anything else:
1. Screen understanding is on.
2. The app in front isn't excluded (password managers, Keychain Access, the login window and
   System Settings are excluded by default).
3. No password field is active: `IsSecureEventInputEnabled` is checked, which reports only that
   secure input is on, never what is typed.
4. Screen Recording permission is granted.

**Capture:**
- One `CGDisplayCreateImage` capture of the main display, downscaled to at most 1280 px.
- It's held in memory only and sent with the question to the local model.
- It's dropped as soon as the answer, an error or a cancellation comes back.
- No file is ever written.
- The chat window hides itself during the capture.
- A small preview is kept in the chat only if **Keep small screenshot previews** is on. It's saved
  to disk only if chat history is kept too (`src-tauri/src/chat_store.rs`).

**Permission:** macOS → System Settings → Privacy & Security → **Screen & System Audio
Recording** → enable *Terraria Companion*, then quit and reopen it. The app's **Ask macOS** button
triggers the system prompt once, and **Open System Settings** jumps to the right pane. App
awareness works without this permission.

**Not verified:** a real capture was not run during development, because that would have needed
the permission and would have captured your screen. The privacy checks and cleanup are covered by
unit tests with a fake capture source. `CGDisplayCreateImage` is deprecated in recent macOS SDKs
(but still present on macOS 27.2). If it returns nothing, the chat reports a capture failure.

## Answer generation

- **Provider:** your local **Ollama** server at `127.0.0.1:11434`. It was already installed and
  running, with three models: qwen3.5:4b, qwen3.5:2b and ministral-3:3b, all vision-capable.
- **Cost and keys:** it's free, private and needs no API keys, so no secrets exist anywhere.
- **Model choice:** "auto" picks qwen3.5:4b, then ministral-3:3b, then qwen3.5:2b. A vision model
  is required for screen questions.
- **Transport:** requests use the system `curl` and are cancelled by killing it.
- **If Ollama isn't running:** the chat says so and no answer is invented.
- **Quality:** answers take about 2–4 s, but these small models often get Terraria facts wrong.
  The persona tells them to admit uncertainty, and the chat warns about it.

## Chat

You can open the chat from:
- the dock (Book icon)
- the tray (*Chat with Companion…*)
- the right-click menu on the character (a right-click never starts a drag)
- the Awareness tab

The chat window shows the message log, a loading state with Cancel, error and refusal notices, an
empty state and a Clear button. Keystrokes stay in that window and never reach the character's
controls.

History is kept for the session only, unless **Keep chat history between launches** is on.
Turning that off deletes any saved copy.

## Stay-Put, favourite spot and idle poses

**Favourite spot:**
- **Set Favorite Spot** (tray *Mode* menu or the Companion tab) saves the character's spot as
  screen fractions, so it survives resolution changes and removed displays (values are clamped on
  screen), and switches to Stay-Put.
- **Return to spot** (or switching Stay-Put on) goes back there.
- Dragging the character in Stay-Put leaves it where it's dropped without changing the favourite.
- Wandering and pursuit never move it. During a boss fight it only defends without moving.

**Idle poses:** Stand, Look around, Sit, Sit & swing legs, Wave and Nap (with drifting "z"s).
They rotate every 10–600 s (default 45 s), or you can hold one, and pause/resume freezes the
animation and the rotation.

| Pose | How it's drawn |
| --- | --- |
| Sit, Sit & swing legs, Nap | Composed poses (the game has no sitting or sleeping frames) |
| Look around | Mirrors the idle frame |

The 2B skin uses the same poses through its armour layers.

**Migration:** older preferences keep a previously chosen non-standing pose as a fixed pose;
otherwise rotation starts.

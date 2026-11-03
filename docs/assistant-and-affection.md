# Smart assistant, voice auto-submit, personality, affection and the cookie

Everything runs on your **local Ollama** (no cloud, no API keys).

## Screen questions (`src/assistant/router.ts` → `wantsScreen`)

Questions about the screen get one fresh screenshot attached automatically, in chat and by voice:
"What am I looking at?", "Explain this error", "What should I do here?", "what's on my screen",
"is this right?" and similar. The capture happens at the moment you ask, the screenshot is used
for that question only, and it's then discarded (or kept as a thumbnail if you turned that on).
Messages longer than 200 characters don't trigger it, since pasted text carries its own context.

The existing privacy checks still apply:

- Screen understanding must be turned on (Awareness, or say "allow screen questions").
- Excluded apps are never captured.
- Nothing is captured while a password field is active.
- If Screen Recording permission is missing, she explains how to grant it: System Settings →
  Privacy & Security → Screen & System Audio Recording → turn on Terraria Companion, then quit and
  reopen it.

## Changing settings by asking (`src/assistant/actions.ts`)

| Step | What happens |
| --- | --- |
| 1. Rules | Common phrasings map straight to an action ("Switch me to character control mode", "Make her stop moving", "Turn the petals down", "Give me my pickaxe", "Open your settings", "Make your speech bubble pinker", ~50 actions). Questions *about* features ("what is roam mode?") are never treated as commands |
| 2. Local model | If the wording is unusual but sounds like a request, the local model picks an action id from the catalog in JSON mode. The app validates it against the catalog (unknown ids and bad arguments are rejected). If the request's wording doesn't clearly match the chosen action, she asks "Did you mean…? (yes / no)" before doing anything |
| 3. Confirm | Clearing blocks or platforms, resetting affection, allowing screenshots, and hiding her all ask "are you sure?" first |
| 4. Clarify | Vague requests like "turn it off" get a short follow-up question |
| 5. Verify | After every change the app reads the setting back. She only says it worked if it did; otherwise she says it didn't take |

**macOS System Settings:** "take me to my Bluetooth settings", "where can I change my
wallpaper?", "open microphone permissions" and "open System Settings" open that pane. Requests that
say "your settings" still open the companion's own settings.

The panes come from a fixed list of about 30 (Wi-Fi, Bluetooth, Network, Sound, Displays,
Wallpaper, Appearance, Desktop & Dock, Notifications, Focus, Battery, Keyboard, Trackpad,
Accessibility, Software Update, Storage, and the Privacy panes: Screen Recording, Microphone, Speech
Recognition, Camera, Location). Rust validates them. The pane is only shown; nothing in it is
changed.

General questions ("what's the capital of France?") never reach the action router; they go to
the assistant as before.

## Voice input (`src/voice/silence.ts`, `machine.ts`)

- Voice input starts listening right away.
- An adaptive detector learns the room's noise level, needs about 0.25 s of real speech before
  arming, and submits after **2 s of silence**. The timeout is adjustable from 1 to 6 s.
- Speaking again resets the timer, and short pauses and coughs don't end the recording.
- The card shows a recording indicator, a level meter, "Hearing you…", a "Sending in 1.2 s…"
  countdown and a live transcript. The live text comes from re-transcribing the audio so far
  every ~2 s, because Apple's speech helper here works on whole recordings.
- **Shortcut:** in Hold mode with auto-send on, a quick tap (under 0.6 s) starts hands-free
  listening and silence sends it. Holding still works as push-to-talk.
- **Changing it:** Awareness → Assistant & voice input. Click the shortcut, then press the new keys.
  All global shortcuts pause while you record, so any combination can be captured. *Reset*
  restores ⌃⇧Space. Clashes with the Control, Build, Platform or cookie shortcuts, or with macOS,
  are explained along with where to change the other shortcut. The shortcut is saved and
  re-registered at launch.
- **Send now** and **Cancel** work at any time. **Edit & resend** on the answer fixes a misheard
  word.
- No speech within 8 s gives a friendly "didn't hear anything" instead of sending an empty
  recording.
- Microphone errors explain how to fix them.
- The microphone is only open while the card says "Listening".
- Turn off "Send automatically" to go back to manual Done plus the optional review step.

## Personality (`src-tauri/src/ai.rs`)

Every chat and voice answer uses a cute, affectionate anime-girl persona: playful, sweet, a
little teasing or shy, encouraging, with "Master" or "s-sempai" now and then. The system prompt
tells the model to stay accurate first and never use emojis, and emojis are also stripped from
answers.

It is shaped by:

- **Intensity** (Subtle / Normal / Extra cute).
- **Affection level**: shy → friendly → close → smitten → devoted.

Speech bubbles and spontaneous lines use the same voice (`src/affection/dialogue.ts`). Lines with
honorifics are thinned out at lower intensity so the nicknames never feel forced.

## Hidden affection (`src/affection/model.ts`, `engine.ts`)

**Storage:** a value from 0 to 100, saved in preferences (`affection`) and restored on launch. It
stays hidden unless you tick *Peek at her affection* in Companion → *Personality & affection*,
which also has *Reset affection* (asks first).

**Gains**, each capped per hour so nothing can be farmed:

| Interaction | Gain |
| --- | --- |
| Chatting | +0.4 |
| Talking by voice | +0.5 |
| Kind words | +2 |
| Patting her (a click) | +0.3 |
| Cookies | +8, then 4, 2, 1 in quick succession |
| Winning a boss fight | +3 |
| Coming back after being away | +1 |
| Kisses | +3 |
| Rude words | −3 |

**Decay:** set your rate (default 1.5 points per hour). It only runs at full rate while you're
actively using the computer, judged by the macOS idle timer (no input is observed). Time away or
with the app closed decays at 10% of the rate, capped at 3 points per absence. Decay alone never
takes affection below 10.

**Tiers** unlock warmer dialogue, hugs, waves and hearts:

| Tier | Range | Unlocks |
| --- | --- | --- |
| Shy | 0–19 | Polite, reserved lines |
| Friendly | 20–44 | Cheerful lines, waves |
| Close | 45–69 | Openly affectionate lines; playful cookie requests |
| Smitten | 70–89 | Flustered, adoring lines; hugs; kiss requests (click her within 12 s to give one) |
| Devoted | 90–100 | The most affectionate lines |

**Spontaneous dialogue:**

- Remarks come every 6–14 minutes at 1×, never closer than 2.5 minutes, with recent lines not
  repeated.
- While you're away (no input for 4+ minutes) she asks for attention at most 3 times, then
  welcomes you back.
- She doesn't interrupt while a menu, the voice card, Build or Platform-edit mode, or Control mode
  is active.

You can turn it off, change the frequency, disable the attention requests, set quiet hours
(across midnight works), or use Quiet mode in Awareness.

## Cookie (`src/overlay/cookie.ts`)

- **Summon it** with ⌃⇧K (rebindable), tray → *Give Cookie*, *Give cookie* in settings, or ask:
  "can I have a cookie?". Each spawn rotates between an original pixel chocolate-chip cookie and
  Terraria's Sugar and Gingerbread Cookies from your install.
- **Feed her** by dragging the cookie onto her: hold it over her for a moment, or drop or throw it
  onto her. She says "Is that for me?", eats it through three bite stages with crumbs, plays
  Terraria's eating sound (if sound is on), jumps for joy, shows hearts and gains affection.
- **No stray clicks:** only the cookie's own small area takes clicks while it's out, and a drag is
  captured, so nothing underneath is clicked.
- **Put it away** with a right-click, Esc while holding it, or the hotkey again. It also tidies
  itself up after 3 idle minutes.

## Limitations

- Answers are only as accurate as the small local model. In a live test, qwen3.5 4B invented a
  Terraria detail. A bigger Ollama model, chosen in Awareness → AI model, helps.
- The command parser covers common phrasings. Unusual ones depend on the local model, and
  uncertain picks are confirmed first.
- The live transcript is periodic (~2 s), not word-by-word.
- I couldn't test screenshot questions end to end here, since that needs the Screen Recording
  permission granted to the installed app. The routing and capture paths are unit-tested.
- Voice auto-submit was tested with simulated audio levels, not a real microphone.

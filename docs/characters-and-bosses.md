# Characters, add-ons, Queen Bee, the Moon Lord remodel and companion combat AI

## Add-ons found on this Mac (read at runtime, never copied or modified)

| Add-on (Workshop resource pack) | Used for | Files used |
| --- | --- | --- |
| Somehow companion Princess (2507435498) | Princess | `TownNPCs/Princess_Default` (23 frames) |
| 2.0v companion pack (2712709024) | Party Girl, Nurse, Zoologist | `NPC_208`, `TownNPCs/Nurse_Default`, `TownNPCs/BestiaryGirl_Default` (23 frames each; the Angler, a child, is not used) |
| Calamity Texture Pack (2450167250) | Goblin Girl | Her NPC sheet mapped onto the 38 poses (14-frame walk, jump, throw for attacks, wave, sit), mirrored to face right | Tinkerer's Spiky Balls (arcing throws) | Confident, nerdy, cheeky inventor; comments on the app you switch to (by name only) |

Each girl also has idle gestures that fit her personality: the Party Girl bounces, the Zoologist
sits, the Princess waves, the Nurse fusses.

**On screen:** up to four characters at once. Summon and dismiss them in Companion → *Characters*,
or ask ("bring out the goblin girl", "send the Nurse away"). They walk in from the edge and walk off
when dismissed.

**Control and selection:** the *selected* character is the one Control mode drives (and the one who
answers chat). Select with *Select*, by double-clicking her on screen, or by asking ("switch to
the Princess"). When you switch, the previous character stays where she was as an autonomous buddy, and
the others aren't touched.

**Every character is a full character:**

- **Drag** any of them and let go to throw.
- **Click** her to bring out her weapon: she swings or fires at the nearest boss or dummy, or into
  the air, and the click counts as a pat.
- **Double-click** to make her the selected character.
- **Right-click** for her menu: Select, Give her a cookie, Swing her weapon, Send her away.

Only the selected character responds to Control mode.

**Moving together:** there's no fixed spacing. Characters can stand side by side and walk past
each other, and only step aside if two of them are standing still right on top of each other. In
a conversation, one walks over, the other waits, and both face each other until the last line.

**Jumping:** characters jump only to reach another surface (window tops, blocks, platforms;
planned, with a 6–12 s cooldown so jumps never chain), in combat, or to express themselves during a
conversation. Roaming never hops at random, and gestures outside conversations wave instead.

**Voice cues:** character voice lines play only when a character is picked up, takes damage from a
boss or mob, or is slain. Clicks, landings, throws, victories and app reactions are silent. Game
sound effects (weapon swings, the cookie) still play; Sound → Effects controls them.

**Per character:** affection (saved separately; the original companion keeps its existing value),
weapon, hit sound (voice pack / Yamete / off), chatter on or off, and speech-bubble colours.

**Personality** shows up in two places, using the shared intensity and frequency settings in
*Personality & affection*:

- **AI answers:** per-character persona prompts in `ai.rs`.
- **Spontaneous lines:** per-character pools by affection tier, in `characters/lines.ts`.

**Romance boundary:** romance is playful and affectionate, never sexual.

## Names you give them (Characters tab)

Each roster card has a *Name* field (up to 24 characters; empty = her built-in name). Your name
shows on the card (with the built-in one beside it), in the Terraria HUD and journal, and works as
a Wispr Flow wake name for the selected companion ("Hey Rose, …"). She still calls herself by her
own name in bubbles, chat and AI answers.

## Conversations (`characters/banter.ts`)

Now and then (every 8–20 minutes, adjustable, never under 4 minutes) an autonomous character walks
over to another. They argue about who loves Master most, in 3–6 lines with gestures, then make up,
both gush about Master, team up, or pout. Each character has her own voice.

They never involve the character you're controlling, and they pause during boss fights. They're
silenced by Quiet mode or by turning spontaneous dialogue off, and have their own toggle.

## Companion combat AI (`combat/tactics.ts`)

Threats are read from the simulator itself:

- Eye of Cthulhu dashes and Servants.
- Moon Lord shots and the Deathray, including its warning phase.
- Queen Bee charge lanes (with warning), stingers and bees.

What the companions do:

- **Dodge:** predict where each threat will be over the next 0.8 s, then sidestep its path, jump
  over it, or leave the beam or lane.
- **Fight:** keep their weapon's range, retreat after melee strikes, and fly around bosses (if
  allowed).
- **Spread out:** each companion gets its own slot around the target so they don't stack.

Autonomous characters keep fighting while you control another one. They hit through the same
simulator (`assistAttack`), but they don't take damage themselves. Only the selected character has
health.

If a pickaxe or the Needle/Thread is equipped, the main companion fights with the best weapon from
your hotbar without changing your selection.

**Not connected to the real game:** this all applies to the companion's own boss simulator. There
is no connection to a running Terraria game.

## Bosses

- **Queen Bee** (`combat/queenbee.ts`):
  - Enters from above, hovers firing stinger volleys, and charges across the screen 3–4 times.
    Each charge is telegraphed by a red band.
  - Summons bees that can be destroyed. Below half health she enrages (faster, more stingers, more
    bees).
  - Has a named health bar with her pack's icon, hit flashes, and a spinning death fall.
  - Uses the add-on sheet (charge frames 0–3, hover 4–11), falling back to the game's.
- **Moon Lord girl:** when the add-on is installed, the Moon Lord is drawn from its parts:
  - Torso halves (mirrored), the big head, and floating peace-sign hands. The add-on hides the
    arms.
  - Eyes show through the forehead and palm sockets. They track the companion, flare before
    attacks and shut when destroyed.
  - Parts flash when hit, the hands reach toward their target when attacking, and the exposed core
    glows on the bandage knot.
  - Mechanics, phases, health and defeat are unchanged.
  - Hitboxes follow the girl layout; the classic look and layout are used without the add-on.

## Sound

- **Master volume:** Companion → *Sound*.
- **Hit sound:** per character, the voice pack, the Yamete add-on (decoded from the pack, at most
  once every 1.5 s, at your voice volume × master), or off.
- **Turning things off:** sound effects, spoken voice lines and conversations can each be turned
  off separately.

## Limitations

- **Not checked by eye:** in-app, the multi-character roster wasn't exercised in a live run (your
  saved roster has only the original companion). The character atlases, the bosses' textures and
  the boss fights were checked through rendered atlases, the live texture log and tests.
- **Buddies:** they don't take damage, can't be dragged or thrown, and talk with canned lines. Only
  the selected character answers chat and voice with the AI.
- **Goblin Girl:** her attack is the town-NPC throw. She has no Silksong-specific poses (they fall
  back to her closest frames).

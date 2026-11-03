# Terraria Companion CJ Ver (desktop)

> CJ Ver is the family-friendly edition: a professional team in suits, no voices or vocal
> sounds, no add-on packs, and strictly professional dialogue. See the README at the repo root.

A macOS desktop companion built with Tauri 2, React 19, TypeScript and Rust.
A small pixel-art adventurer lives on top of your desktop. It wanders along
the bottom of the screen, stands on and jumps between other apps' windows,
and can be picked up and thrown.

- **Milestone 1:** the companion shell (overlay, physics, tray, inventory,
  preferences).
- **Milestone 2:** other apps' windows become platforms.
- **Milestone 3:** a weapon and inventory system with a combat training
  sandbox.
- **Asset milestone:** the character is drawn with the **real Terraria
  player art**, loaded at runtime from your own Terraria install. It is
  customizable and can be controlled like in Terraria.
- **Boss & modes milestone:** a summonable **Eye of Cthulhu**, six end-game
  Terraria weapons (Terra Blade, Night's Edge, Megashark, Daedalus Stormbow,
  Last Prism, Zenith), a **Stay-Put** mode, visual **cursor modes** and a
  harmless **letter-smash** effect. See `docs/boss-weapons-modes.md`.
- **Dock milestone:** a draggable, always-on-top **Terraria-style dock** with
  the six weapons and quick actions, and a pixel-art app icon.
- **Awareness milestone:** **app-switch reactions** with speech bubbles,
  a **chat panel** answered by your local Ollama (plus an opt-in "Ask about my
  screen"), a **favorite spot** and **rotating idle poses**. See
  `docs/screen-awareness-and-chat.md`.
- **Menu, surfaces & voice milestone:** a right-click menu on the character,
  sloped and stepped surface segments with walls, a Terraria-style pickaxe
  swing, assistant settings, and push-to-talk voice questions. See
  `docs/menu-surfaces-pickaxe-voice.md`.

**Install / launch:** build with `npm run tauri build -- --bundles app` and
copy `src-tauri/target/release/bundle/macos/Terraria Companion CJ Ver.app` into
`/Applications`. Then open *Terraria Companion CJ Ver* from Applications, Launchpad
or Spotlight. It runs from the menu bar (no Dock icon).

There is no gameplay integration with Terraria itself yet. The weapon system covers **five
archetypes** (sword, bow, gun, magic staff and summon), with two original
weapons each plus the six Terraria weapons above. It does not attempt to
reproduce Terraria's full weapon roster.
Combat is an internal simulation that happens only on the companion's own
overlay. It never interacts with, clicks or controls other applications.

## Using it

| Action | How |
| --- | --- |
| Pick up / throw | Drag the character with the mouse and let go mid-motion to throw it |
| Attack | Click the character (without dragging), press `F` or `Space`, use the inventory's **Attack** button, or press `←`/`→` to attack in that direction |
| Switch weapons | `1`–`0` select a hotbar slot, `Q`/`E` (or `[`/`]`) cycle; or click a hotbar slot in the inventory |
| Training mode | Tray → *Training* → *Training Mode*, the inventory's **Start training** button, or `T`. Dummies appear and the companion fights them on its own |
| Reset / dismiss | Tray → *Training* → *Reset Dummies* / *Dismiss Minions*, or `R` / `X` |
| Open / close inventory | Double-click the character, or use the tray menu → *Open Inventory*. In the inventory, `Esc` closes it |
| Show / hide companion | Tray menu → *Hide Companion* / *Show Companion* |
| Pause | Tray menu → *Pause* (freezes movement and animation, and stops window polling) |
| Walk on windows | Tray menu → *Walk on Windows* (on by default). Turn it off to stop all window-geometry reads |
| Size | Tray menu → *Size* → Small / Medium / Large. The built-in sprite uses 2×, 3× or 4×; the Terraria art uses 1×, 2× or 3×, which keeps a similar on-screen height. |
| Control the character | Tray → *Control Character*. While it's on: `A`/`D` (or `←`/`→`) move, `Space`/`W` jump (release early for a short hop), `S`/`↓` drop through a window, click or hold to use the equipped item toward the cursor, mouse wheel or `1`–`0` to select. `Esc`, switching apps (⌘-Tab) or the tray item ends it. A banner shows while it's active. |
| Customize the character | Inventory window → **Character** tab: body variant, hair style, seven colors, armor head/body/legs, and hair under a helmet. It has a live preview. |
| Eye of Cthulhu | Inventory → **Companion** tab → *Bosses* (*Eye of Cthulhu / Retry / Dismiss*) and difficulty, tray → *Boss*, or `B`. The companion fights it with the equipped weapon |
| Stay put | Companion tab or tray → *Mode* → *Stay Put*, with a *Stand / Sit / Wave* pose. Drag it to move its spot |
| Cursor modes | Companion tab or tray → *Cursor* → *Ride / Hug / Become Cursor*. Clicks always pass through. *Off* restores normal behaviour |
| Letter smash | Companion tab → *Smash* (or `L`, tray → *Effects*). *Stop* or the checkbox turns it off at once |
| Quick-action dock | A small Terraria hotbar (shown by default). Click a weapon to equip it. The buttons summon/dismiss the Eye, toggle Stay-Put, cycle cursor modes (Off → Ride → Hug → Become) and open the inventory. **–** collapses it and **×** hides it. Drag the dotted grip to move it. Tray → *Show/Hide Dock*; layout, launch behaviour and position reset are on the Companion tab |
| Skin | Inventory → **Character** tab → *Skin*: Default or 2B (needs the "companion 2B" Workshop pack). Applies immediately |
| Sound | Companion tab → *Sound*: mute, voice on/off, voice and effect volume, and which voice from the voice pack |
| Pickaxe | Equip the Copper Pickaxe (hotbar slot 6 or the dock) and swing. Swings you trigger (click or hold in Control mode, `F`, the dock) strike at the pointer wherever it is; swings the companion makes on its own need the pointer within reach. With the Letter Destroyer running, the page's letters at that spot break. This never sends a real click, so nothing underneath is activated. *Stop effects* or the checkbox clears the effect at once |
| Control mode extras | Drag the character to carry it, and release to throw. Hold `Space` to fly and `A`/`D` to steer; release to fall. `Esc` exits |
| Right-click menu | Right-click the character: ask a question, open the chat, ask about the screen, start voice input, Stay-Put, idle pose, settings |
| Chat | Dock Book button, tray → *Chat with Companion…*, or the right-click menu |
| Letter Destroyer | Companion tab → *Letter Destroyer bookmarklet*: drag the ★ link to your bookmarks bar, click it on any page, then click text to send letters flying. Esc or a refresh restores the page |
| Silksong Controls | Companion → *Control mode* → **Silksong Controls**, then Control mode (⌃⇧C). Run, double jump, glide, dash, wall jump and Clawline, plus the Needle (side, up, pogo, diagonal pogo, charged), the dive attack (`O`) and the Thread spin. The attack button uses the equipped item, so every Terraria weapon works too. Keys are rebindable. See `docs/silksong-controls.md` |
| Build mode | ⌃⇧B (rebindable), tray → *Build Mode*, or Companion → *Build mode* → *Start building*. Click to place Dirt / Stone / Wood (`1`/`2`/`3`), right-click or ⇧-click to remove, drag to paint. Up to 400 blocks, saved between launches. Blocks are solid surfaces for walking, jumping, wall-clinging and pogoing (one-block steps are climbed automatically). The overlay draws them; the desktop isn't changed. `Esc`, the shortcut or switching apps exits. See `docs/building-and-bosses.md` |
| Invisible platforms | ⌃⇧P (rebindable), tray → *Edit Invisible Platforms*, or Companion → *Invisible platforms* → *Edit platforms*. Drag to draw a flat or sloped line, drag to move, drag an end to resize or tilt, right-click or Delete to remove. They're invisible outside edit mode (a faint outline is optional) and saved between launches. The character walks on them like window tops (one-way: jump up through, `S` or Down + Jump to drop). See `docs/theme-and-platforms.md` |
| Cherry blossom theme | Companion → *Cherry blossom theme*: a garland under the menu bar, grass and flowers by the Dock, and falling petals (density, speed, wind, sway, tumble, size, motion style, presets). A click-through layer behind your windows (or in front); macOS doesn't allow restyling the real menu bar or Dock |
| Ask her to change things | In chat or by voice: "turn on roam mode", "switch to Silksong controls", "give me my pickaxe", "turn the petals down", "open your settings"… She does it, checks it worked and tells you honestly. Destructive or privacy changes ask first. See `docs/assistant-and-affection.md` |
| Screen questions | Ask "what am I looking at?" or "explain this error": she takes one fresh screenshot for that question (needs screen understanding on and Screen Recording permission) |
| Personality & affection | Companion → *Personality & affection*: intensity, spontaneous dialogue, attention requests, quiet hours, decay, bubble pinkness, optional affection peek and reset |
| Cookie | ⌃⇧K (rebindable) or tray → *Give Cookie*, then drag the cookie onto her to feed her |
| Moon Lord | Companion → *Bosses* → *Moon Lord*, or tray → *Boss* → *Summon Moon Lord*. Destroy the head and palm eyes, then the exposed core. Uses the boss difficulty; *Retry / Dismiss* apply to it too |
| Voice input | Enable it in Awareness → *Assistant & voice input*, then press ⌃⇧Space (or hold it, or use your own shortcut) and speak. She sends it after 2 s of silence (adjustable), shows a live transcript, and has *Send now*, *Cancel* and *Edit & resend*. Needs Microphone and Speech Recognition permission |
| App reactions & privacy | Inventory → **Awareness** tab: turn reactions or screen understanding on or off, quiet mode, retention settings, excluded apps, and per-app reaction rules (add, edit, preview, disable, delete) |
| Favorite spot & idle poses | Companion tab → *Stay put & idle poses*, or tray → *Mode*: Set Favorite Spot, Return to Spot, rotate or hold a pose, pause the animation |
| Chess | Say or type "let's play chess" / "pull up the chessboard". A Terraria-style board for two local players (no computer opponent): click a piece then a square, or drag it. Full rules (castling, en passant, promotion with a choice, check, mate, stalemate, fifty-move, threefold repetition, insufficient material). The companions on screen split into White and Black supporters, cheer in character, and push or throw the pieces for you. ⚙ switches to playing your selected companion (she sits across the board and moves her own pieces) or to opening lessons (London, Italian, Ruy Lopez, Queen's Gambit, Sicilian, French, Caro-Kann, King's Indian), and picks the board's Terraria blocks. Drag the corner grip to resize, ⤢ to maximize. *New* / ✕, or "put the chess board away". See `docs/chess-and-movement-modes.md` |
| Movement modes | Say "spread out a bit", "be more jumpy", "stay grounded", "go watch from platform 2" (or "pick a hangout spot"), "reset your movement"; or Character tab → *Movement*. Saved between launches. See `docs/chess-and-movement-modes.md` |
| Terraria world | Maps tab → *Terraria world*, tray → World, or "show the terraria world": a world behind your windows (forest, snow, desert, jungle; caves, ores, trees, life crystals) that the companions walk on. **Play Terraria** puts your companion (selected companion, or one you pick) into the world: mine, build, craft, wear armour, fight enemies and summon King Slime or the Eye of Cthulhu (Esc inventory; *Leave game* leaves). **Let the team play** has the on-screen companions play through Terraria on their own: a first house, a town with NPCs, better gear, exploring every biome, the bosses up to the Wall of Flesh, and a big themed luxury house in every biome (saved; speed up to 16×). Maps tab → *Saved places* shows everywhere they've been and built (preview, biome, progress); click one to look there. When no game is running, drag the bare desktop (or scroll) to look around the world. Both need other windows minimised or hidden (*Hide other apps & play*), and pause if one comes back. *Explore…* lets you drag, scroll and zoom around it (and edit tiles); Esc or *Done* makes it click-through again. Seed, new world, zoom and editing are in settings. See `docs/terraria-world.md` |
| Quit | Tray menu → *Quit Terraria Companion* |

The app has no Dock icon (`ActivationPolicy::Accessory`). The menu-bar tray
icon is its only control surface. Closing either window hides it instead of
quitting.

Preferences (visibility, pause, size, walk speed, last horizontal position,
walk on windows, inventory layout, equipped hotbar slot, training mode,
character appearance) are saved to
`~/Library/Application Support/com.terrariacompanion.desktop/prefs.json`.
A missing, corrupt or hand-edited file falls back to safe defaults.

## Development

```sh
cd desktop
npm install
npm test                    # Vitest: physics, platforms, jumps, behaviour, animation, combat, inventory
(cd src-tauri && cargo test) # Rust: preferences, hit-testing, window filtering, combat commands
(cd src-tauri && cargo test probe_window_list -- --ignored --nocapture)  # live window-list diagnostic
npm run tauri dev           # run with hot reload
npm run tauri build -- --bundles app
open "src-tauri/target/release/bundle/macos/Terraria Companion CJ Ver.app"
```

> **Xcode license note:** if `cargo` fails with *"You have not agreed to the
> Xcode license agreements"*, either accept it yourself
> (`sudo xcodebuild -license`) or build against the standalone Command Line
> Tools for that one command by prefixing it with
> `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

## Architecture

```
src/
  engine/            pure TypeScript, no DOM/Tauri, fully unit tested
    physics.ts       gravity, walking, jumping, wall/floor/ceiling and one-way platform collision, drag & throw
    platforms.ts     window rects → visible top-edge platforms; carrying on moving windows
    jump.ts          jump planner (analytic arc + simulation check against all platforms)
    behavior.ts      seeded idle/walk/hop/platform-jump AI
    animation.ts     state → animation (idle, walk, jump, fall, land) and frame timing
    sprites.ts       original 16×24 pixel art as palette strings
  combat/            weapon system, pure and deterministic except art/render
    weapons.ts       typed weapon definitions (data) and tooltip stats
    weaponArt.ts     16×16 archetype shapes, palette-swapped per weapon
    inventory.ts     50 slots, 10-slot hotbar, select/cycle/swap/equip, persistence
    sim.ts           combat state: dummies, attacks, cooldowns, mana, damage, effects
    melee.ts         sword arcs and swept blade hit detection
    projectiles.ts   projectile motion, gravity, homing, ballistic aiming
    minions.ts       summon follow/target/strike behaviour
    damage.ts        damage rolls and the serialisable RNG
    geometry.ts      rects, swept segment tests, hand positions
    shortcuts.ts     keyboard map shared by both windows
    sandboxArt.ts    training dummy and minion art
    render.ts        canvas renderer for combat visuals (DOM)
  overlay/
    companion.ts     rAF loop, character drawing, dragging, hitbox, combat wiring
    Overlay.tsx      React mount: character canvas + combat effects canvas
  inventory/         inventory window UI
  bridge.ts          typed wrappers for Rust commands/events
  main.tsx           picks the view by window label ("overlay" | "inventory")
src-tauri/src/
  lib.rs             windows, tray menu, click-through and platform watchers, commands
  windows.rs         Core Graphics window list → filtered, overlay-local platforms (+ tests)
  combat.rs          validated combat commands relayed to the overlay (+ tests)
  prefs.rs           preference load/save/sanitize (+ tests)
  hit.rs             cursor → window-local hit-testing (+ tests)
```

Both windows are defined in `tauri.conf.json`. The **overlay** window is
transparent, borderless, always on top, visible on all Spaces, and has no
taskbar entry or shadow. At startup it is sized to the primary monitor's
*work area* (the screen minus the menu bar and Dock), so the character
stands on top of the Dock.

### Terraria art pipeline (local only)

```
Terraria.app/Contents/Resources/Content/Images/*.xnb      (your install; read-only)
  └─ src-tauri/src/terraria/locate.rs   find the install: default Steam library → libraryfolders.vdf;
                                        version from changelog.txt, build from appmanifest_105600.acf
  └─ terraria/xnb.rs      XNA 4.0 XNB: LZX via `lzxd` (MIT/Apache-2.0), Texture2D, SurfaceFormat Color
  └─ terraria/alpha.rs    premultiplied → straight alpha (transparent pixels → 0,0,0,0)
  └─ terraria/store.rs    name allow-list (Images/…), canonicalized inside Content (no traversal or
                          symlink escape); on-demand decode; PNG cache at
                          ~/Library/Caches/com.terrariacompanion.desktop/terraria-assets/
                            <version>-b<build>/d<decoder version>/Images/*.png  (+ rigs/<key>.png)
                          stale entries (source newer, corrupt PNG, other game/decoder version) are
                          rebuilt or pruned
  └─ terraria/player.rs   composes the player atlas (23 poses) from the layered sheets; see
                          docs/terraria-player-rendering.md for the measured mapping
  └─ terraria_app.rs      `get_player_rig` command + `tasset://localhost/{rig,texture}/…` scheme
                          (GET only, CORS for canvas use, decoded off the main thread)
WebView: overlay/terrariaRig.ts loads the atlas; overlay/rigFrames.ts picks the frame;
         companion.ts draws it (40×56 cell at an integer scale) — falls back to built-in art.
```

- **Nothing redistributed:** no game files, decoded images or derived art
  are bundled into the app, committed, or generated into source files. Tests
  use synthetic XNB fixtures, including a genuine LZX uncompressed-block
  stream built in code. One local-only test decodes your real install when
  present and skips otherwise.
- **Fallback:** if Terraria isn't found (or a sheet is missing or corrupt),
  the companion keeps using its original built-in sprite.
- **Debug logging:** running with `TC_DEBUG=1` logs rig composition and
  `tasset://` requests (paths and sizes only).
- **Physics unchanged:** physics, AI, dragging, throwing, window platforms
  and combat are independent of the art. The Terraria character only changes
  the body box to Terraria's 20×42 hitbox at the chosen scale, and the hand
  anchors used for held weapons.

### Control Character mode

Turning it on (from the tray) makes the overlay a focused, fully interactive
window. It then receives your keyboard and every click on the screen area it
covers, like a game window.
- **Input:** movement goes through the same `physics.step()` as the AI, with
  keyboard intents instead of AI intents. Clicks use the equipped weapon
  aimed at the cursor.
- **Permissions:** no global keyboard hooks or extra macOS permissions are
  used. Input is captured only while the overlay has focus.
- **Exiting:** `Esc`, switching apps, or the tray item ends control mode,
  and click-through returns immediately. The menu bar (and so the tray) stays
  reachable, because the overlay doesn't cover it.

### Coordinate systems

Four coordinate spaces are involved. Mixing them up is the usual source of
"the character floats 25 px above the window" bugs.

| Space | Origin | y axis | Units | Used by |
| --- | --- | --- | --- | --- |
| **AppKit screen** | bottom-left of the main display | up | points | `NSWindow.frame`, `NSScreen.frame` (not used directly; Tauri converts) |
| **Core Graphics global** | top-left of the main display (the one with the menu bar) | down | points | `kCGWindowBounds`, `NSEvent.mouseLocation` as reported by Tauri |
| **Tauri physical** | same as Core Graphics global | down | points × the window's scale factor (2 on Retina) | `inner_position`, `cursor_position`, `Monitor::work_area` |
| **Overlay CSS** | top-left of the overlay window (the main display's work area, just below the menu bar) | down | CSS px = points | the physics engine, sprites, hitboxes, platforms |

- **Displays:** displays to the left of or above the main display have
  negative global coordinates. The main display's origin is always (0, 0).
- **Retina:** 1 point = 2 physical pixels on a 2× display. The webview runs
  at zoom 1, so 1 CSS px = 1 point. The sprite canvas uses a
  `devicePixelRatio`-sized backing store, so each art pixel lands on whole
  device pixels.
- **Windows → overlay:** in `windows.rs`, the overlay's origin in points is
  `inner_position / scale_factor`. A Core Graphics window rectangle in
  overlay CSS px is then `(x − originX, y − originY, w, h)`. For example,
  with a 25 pt menu bar, a window at global y = 325 has its top edge at
  overlay y = 300.
- **Cursor → overlay:** in `hit.rs`, the overlay-local point is
  `(cursor_physical − origin_physical) / scale_factor`.
- **Physics:** in overlay CSS px, the floor is at `y = innerHeight` (the top
  of the Dock), the ceiling at `y = 0` and the walls at `x = 0` and
  `x = innerWidth`. Bodies are positioned by their top-left corner.

### How click-through works

The overlay covers the screen but ignores the mouse by default
(`NSWindow.ignoresMouseEvents`, via Tauri's `set_ignore_cursor_events`).
The frontend reports the character's rectangle to Rust, at most 20 times a
second. A background thread reads the global cursor position
(`NSEvent.mouseLocation`, via Tauri's `cursor_position`). It checks every
16 ms while the cursor is within 150 px of the character, and every 100 ms
otherwise. When the cursor comes within 4 px of the character, the thread
turns mouse input on. When it leaves, the thread turns input off. During a
drag the frontend sets a *capture* flag, so input stays on even if the
cursor briefly gets ahead of the sprite.

### How window platforms work

1. **Discovery (Rust, `windows.rs`).** Every 100 ms while the companion is
   visible, unpaused, and *Walk on Windows* is on, the app calls
   `CGWindowListCopyWindowInfo(OnScreenOnly | ExcludeDesktopElements)`.
   It reads only `kCGWindowNumber`, `kCGWindowOwnerPID`, `kCGWindowLayer`,
   `kCGWindowAlpha` and `kCGWindowBounds`. A window counts as a platform when
   it:
   - belongs to another process (our own overlay and inventory are excluded);
   - is on layer 0, the normal app-window layer. This excludes the Dock, menu
     bar, Notification Center, floating palettes, screen savers and our
     always-on-top overlay;
   - has an alpha of at least 0.1, which excludes invisible helper windows;
   - is at least 120×60 pt, which excludes tooltips and popovers;
   - intersects the overlay.

   Minimized windows, windows of hidden apps and windows on other Spaces are
   not on screen, so Core Graphics leaves them out. Results are converted to
   overlay CSS px, capped at 64 windows and kept front-to-back. They are sent
   to the overlay **only when something changed**, so a still desktop causes
   no UI updates. Each call costs about 0.4 ms (measured with
   `probe_window_list`).
2. **Platforms (TypeScript, `platforms.ts`).** Each window contributes the
   *visible* part of its top edge. Wherever a window in front covers that
   line, the edge is cut away, so the character never lands on an edge you
   can't see. Stacked windows with identical bounds collapse to the frontmost
   one, and slivers under 24 px are dropped.
3. **Collision (TypeScript, `physics.ts`).** Window tops are **one-way**:
   - The character lands only when its feet cross the edge from above while
     falling. The crossing test runs from the previous position to the new
     one, so even the fastest fall can't pass through the edge.
   - It can rise through a window from below, so jumps and throws pass
     upward through it.
   - The *feet* are the middle 40% of the sprite. Walking until the feet
     leave the edge makes it fall.
   - Window sides are not walls. The screen edges still are.
4. **Moving windows.** When a new snapshot arrives, a character standing on
   a window moves by that window's change in position. If the window was
   resized instead of moved, only the top edge is followed. If its window
   closes, minimizes, hides, moves to another Space or gets covered, the
   next physics step finds no support and the character falls.
5. **Jumping to platforms (TypeScript, `jump.ts`).** At each decision the AI
   sometimes looks for another platform. It solves an arc using the
   engine's real gravity and air drag, raising the arc if the horizontal
   speed would be too high. It then **simulates the jump with the real
   physics against every platform**, and keeps only arcs that land on the
   target. Arcs that would clip the starting window or land on a window in
   between are rejected. Planned jumps reach about 600 px up and 480 px
   across.

### Surface segments (slopes, steps and walls)

- **Segments:** walkable surfaces are line segments (`Platform`). A segment can have a
  different height at its right end (`topRight`), which makes it a slope.
  - Segments up to about 50° can be walked on; steeper ones are ignored as surfaces.
- **Grounded movement:** each step re-finds support under the feet. The body's own window is
  always followed, even if it moved. Otherwise it moves onto an adjoining segment within 6 px up
  or 14 px down.
  - This lets it follow slopes and cross from one window's top to another's without falling or
    jittering.
  - Gaps and bigger drops are real falls.
- **Walls:** `Wall` is a vertical boundary. `junctionWalls` adds one where a taller window in
  front covers part of another window's top, so walking along that top stops at the corner.
  - Walls only stop a grounded body whose feet are on that top. Walking on the floor in front of
    windows, jumping, thrown flight and Control-mode flight are never blocked.
- **Refreshing geometry:** segments and walls are rebuilt from every window snapshot (Rust polls
  every 100 ms), so moved, resized, new, closed and cross-display windows are picked up.
- **Roaming:** `engine/explore.ts` follows the same connected segments to find how far the surface
  continues.
  - At a ledge the companion usually pauses, peeks and turns back (65%); otherwise it drops off on
    purpose. It decides once per ledge.
  - Jumps prefer window tops it hasn't visited recently (the last 4).
- **Not supported:** real window outlines only give horizontal tops and vertical sides. Slopes
  never come from windows; the engine handles them for explicitly supplied segments. Rounded
  corners, transparent areas and window content are not geometry.

### How the weapon system works

**Data.** Each weapon in `combat/weapons.ts` is a typed record. The `kind`
field (`sword | bow | gun | staff | summon`) selects the behaviour and the
fields that weapon needs: reach and arc for swords, draw time, speed and
gravity for bows, pellets and spread for guns, mana, homing and pierce for
staffs, and mana, upkeep and minion stats for summons. Artwork is one
original 16×16 shape per archetype, recoloured by a per-weapon palette. A
new weapon is a new data entry.

| Archetype | Weapons | Behaviour |
| --- | --- | --- |
| Sword | Rustic Sword, Ember Blade | Wind-up, then a directional swing arc. The blade is a segment from the hand, swept in 5° steps and tested against dummies. It hits only during the active part of the swing, at most once per target. A slash trail is drawn. |
| Bow | Pine Bow, Recurve Bow | The string is drawn back (the art changes) and the arrow released at `drawTime`. Arrows fall under gravity. The AI and aim-assist solve the ballistic angle. The Recurve Bow pierces one target. |
| Gun | Pocket Pistol, Scattergun | Fires on the first frame from the muzzle, with a flash and recoil kick. Rounds are very fast (1500–1800 px/s). The Scattergun fires 4 pellets in a spread. |
| Magic staff | Spark Wand, Frost Staff | Costs mana up front, raises the staff with a glowing tip, and casts a bolt at `castTime`. The bolt homes toward the nearest dummy it hasn't hit yet. The Frost Staff pierces two targets. |
| Summon | Wisp Lantern, Firefly Jar | A cast spawns a minion that follows beside the character's head. It darts at dummies within range, with a per-dummy hit cooldown, and bounces off after each strike. At most 2 minions; a third replaces the oldest. Each minion **reserves upkeep from maximum mana** until it is dismissed. |

**Simulation.** `combat/sim.ts` holds all combat state as plain data and
advances it with `stepCombat(state, dt, player, bounds)`:
- **RNG:** a seeded RNG is stored inside the state, so the same seed and
  inputs always give the same result. A test checks this.
- **Cooldowns:** each weapon's `useTime` is both its animation length and
  its cooldown.
- **Mana:** 100, regenerating at 14/s after a 0.9 s delay. Upkeep reduces
  the maximum.
- **Damage:** ±15% variance, double damage on a crit, minus half the
  target's defence, with a minimum of 1.
- **Projectiles:** collision is a swept segment-versus-rectangle test, so a
  1800 px/s bullet hits even at 10 fps. Projectiles are removed when they
  hit the floor or leave the screen.
- **Dummies:** 300 HP each. They sway with knockback, flash when hit, show
  an HP bar, fall at 0 HP and stand back up after 2.5 s.
- **Feedback:** damage numbers float up, orange for normal hits and larger
  and red for crits.

**Character integration.** Combat never moves the character. Attacks add
three poses (`swing`, `shoot`, `cast`) to the existing animation system,
and attack poses override movement poses. While an attack plays, the
existing AI stands still. In training mode the AI gets a *combat goal*. It
walks to the nearest dummy using the normal `decide()` → `physics.step()`
path, keeps the equipped weapon's preferred range (ranged weapons back away
when crowded), turns to face the target and attacks when the weapon is
ready. Platforming, dragging, throwing and screen-edge collision are
unchanged.

**Rendering.** A second, full-screen canvas sits above the character with
`pointer-events: none`, so click-through behaves exactly as before. It
redraws only while something is moving, clears only the regions it drew
last frame, and is hidden entirely when empty. Measured CPU (percent of one
core, app process plus WebKit): about 5% + 5% with training off, and about
7% + 7% with training on and a bow firing continuously.

**Inventory and persistence.** The inventory window lists the weapons with:
- category filters (All / Melee / Ranged / Magic / Summon);
- a hotbar where the equipped slot is outlined in gold;
- drag-and-drop to swap slots;
- double-click (or **Equip**) to move a backpack weapon into the equipped
  slot;
- a tooltip panel with damage, speed, knockback, crit and archetype-specific
  stats.

The layout and selected slot are saved through Rust preferences. Rust
validates them: at most 50 slots, short ASCII ids only, slot index 0–9.
Changes are broadcast so both windows stay in sync. Commands from the tray
and the inventory window (`attack`, `reset`, `dismiss`) go through a Rust
allowlist before reaching the overlay.

### Privacy

- The app never reads window titles (`kCGWindowName`), owner or app names,
  or window contents. It never calls a screen-capture API such as
  `CGWindowListCreateImage` or ScreenCaptureKit.
- The window list's *bounds* are available to any app without permission,
  so the app needs neither Screen Recording nor Accessibility permission.
- Window geometry is held in memory only, as the latest snapshot. It is
  never written to disk or sent anywhere. Turning off *Walk on Windows*
  stops the polling and clears the snapshot.
- Running with `TC_DEBUG=1` prints each snapshot's ids and bounds to
  stderr, for manual testing only.

### Performance

Measured on this Mac over 30 seconds, as a percentage of one CPU core:

| State | App process | WebKit renderer |
| --- | --- | --- |
| Paused | 0.9% | 0.4% |
| Active (walking, polling windows) | 4.9% | 4.4% |

Most of the active cost is the 60 fps animation loop. Window polling is
about 0.4%. While paused, the frame loop drops to 4 fps and window polling
stops.

## Manual testing on macOS

Launch the app with
`open "src-tauri/target/release/bundle/macos/Terraria Companion CJ Ver.app"`, or
run the binary directly with `TC_DEBUG=1` set to watch window snapshots.

1. **Landing on a window:** open a normal window, such as Finder or
   TextEdit, about halfway up the screen. Drag the character above it and
   let go. It should fall and stand exactly on the window's top edge (the
   title bar).
2. **Standing still:** the character stays on the window and keeps
   wandering along its top.
3. **Walking off:** watch, or drop it near an end. Once its feet pass the
   window's edge, it falls to the floor or onto a window below.
4. **Moving windows:** while it's standing on a window, drag that window by
   its title bar, away from the character. The character rides along, with
   up to 0.1 s of lag. Resize the window from its right edge until the edge
   passes the character, and it should fall.
5. **Minimizing, closing, hiding:** minimize the window (⌘M), close it, or
   hide the app (⌘H). The character falls.
6. **Covered edges:** drag a second window so it covers part of the first
   window's top edge. The character should never land on the covered part.
7. **Jumping between windows:** arrange two windows at different heights
   within about 400 px horizontally and 500 px vertically. Leave the
   character on one and wait. Within a minute or so it should jump to the
   other, and up from the floor onto a window.
8. **Throwing through:** throw the character upward from below a window. It
   passes through and lands on top.
9. **Unchanged behavior:** the screen edges still block it, dragging and
   throwing still work, and so do Pause and unpause (it resumes on the same
   window), Show/Hide, Size, double-click for the inventory, and Quit. Your
   preferences survive a relaunch.
10. **Walk on Windows off:** turn it off in the tray. The character should
    drop to the floor and ignore windows.

### Weapons and training (Milestone 3)

1. **Inventory:** open it (double-click the character). The hotbar shows
   five weapons, one per archetype, and the backpack has five more.
   - Hover a weapon to see its stats.
   - Click the category filters and check that the other weapons dim.
   - Drag a backpack weapon onto a hotbar slot; the two swap.
   - Double-click a backpack weapon to equip it in the gold-outlined slot.
   - Quit and relaunch: the layout and selection are restored.
2. **Shortcuts:** with the inventory focused, press `1`–`5` and `Q`/`E`.
   The equipped weapon changes, and the overlay uses it immediately.
3. **Training:** press `T`, or click **Start training**. Three dummies
   appear on the floor near the character, and the companion walks over and
   fights them.
4. **Sword (slot 1):** a wind-up, then a forward swing with a white slash
   arc. Only dummies within reach in front take damage, once per swing.
5. **Bow (slot 2):** the string pulls back with an arrow nocked, then the
   arrow flies in an arc and hits. Press `←`/`→` (in the inventory) to fire
   left or right. With nothing in the way, the arrow lands on the floor.
6. **Gun (slot 3):** a muzzle flash and a fast round. Equip the
   **Scattergun** to see four pellets.
7. **Staff (slot 4):** the staff is raised with a glowing gem and a seeking
   spark flies out. A blue mana bar appears above the character and refills
   after a short delay. Spam `F`: "Low mana" appears and casting stops until
   mana regenerates.
8. **Summon (slot 5):** a wisp appears, hovers beside the character and
   darts at dummies. Cast twice more: there are never more than two, and the
   purple part of the mana bar (upkeep) grows. Press `X` to dismiss them,
   which frees the upkeep.
9. **Damage numbers and dummies:** every hit shows a floating number, with
   crits larger and red. Dummies flash and sway, show an HP bar, and when
   defeated fade out and stand back up after 2.5 s. Press `R` (or tray →
   *Reset Dummies*) to restore full health and clear minions and
   projectiles.
10. **Manual attacks:** click the character to attack with the equipped
    weapon. Dragging still picks it up instead, and double-clicking still
    opens the inventory. With training off, attacks still animate and
    projectiles fly, but there is nothing to hit.
11. **Regression:** pause freezes combat too, and platforming, dragging,
    throwing, Size, Hide/Show and Quit all behave as before.

## Known limitations

**Pickaxe effect:** it's visual only. The companion draws random glyphs on its
own transparent overlay near the pointer. It never reads, modifies or clicks
anything in other apps (including Chrome tabs), so the glyphs aren't the
letters under the pointer.

**Dock:** it's a separate, non-focusable window (`focusable: false`, with
first-click accepted). Using it never takes keyboard focus from your current
app, and the character overlay stays click-through. macOS may still briefly
treat the companion as the active app on a click, because it isn't a true
non-activating `NSPanel`. Tooltips may not appear while another app is
frontmost; the full layout's name line shows the same text on hover.

**Boss, Terraria weapons and modes:** the approximations are listed in
`docs/boss-weapons-modes.md`. In short: the Eye's AI is clean-room, with
desktop-tuned health and speeds. The weapons have no ammo or tile collision.
*Sit* is a composed pose. Hiding the real pointer uses a private macOS API
and is opt-in. Letter smash uses its own word, never other apps' text.

**Terraria character art** (details in `docs/terraria-player-rendering.md`)
- **Not compared against the game:** no frame has been checked pixel for
  pixel against the game's own player renderer. The walk-arm timing and the
  back-arm cell choices are inferred from the sheets.
- **Not drawn yet:** accessories, wings, dyes and vanity. Per-helmet and
  per-armor rules (hair visibility, arm hiding, female-specific armor) are
  manual or approximate.
- **Weapons over arms:** held weapons are drawn over the whole arm. The
  game's forearm-over-item pieces aren't used.
- **Unverified placement:** the on-screen position and scale of the overlay
  were verified by tests and by inspecting the atlas the app served, not by
  capturing the screen.
- **Mac-only assumption:** the `tasset://` URL form assumes macOS (or Linux).
  Windows would need the `http://tasset.localhost` form, which is handled but
  untested.

**Control Character mode**
- **Takes over input:** while it's on, the overlay takes all clicks in the
  area it covers, so other apps can't be clicked until you press `Esc` or
  switch apps.
- **Focus only:** keyboard input works only while the overlay is focused.
  There are deliberately no global hotkeys.

**Click-through**
- Input is switched for the whole window, not per pixel. While the cursor is
  over the character's rectangle, the transparent corners of that rectangle
  also catch clicks.
- Because of polling, there is up to about 16 ms of latency near the
  character, or up to 100 ms when the cursor jumps from more than 150 px
  away in a single movement. A very fast click right as the cursor arrives
  can still land on the app underneath.
- Clicking the character makes the companion the active app, so the
  previously focused app loses keyboard focus until you click back into it.
  `acceptFirstMouse` is enabled so the first click is not swallowed.

**Transparency and private API**
- Transparent webview windows on macOS need Tauri's `macOSPrivateApi` /
  `macos-private-api` feature, which turns off the WKWebView background
  through a private API. This is the only private API in use. It makes the
  app ineligible for the Mac App Store; direct distribution is unaffected.
  Everything else uses public AppKit APIs through Tauri.

**Spaces and full screen**
- The overlay joins all Spaces (`visibleOnAllWorkspaces`), so it follows you
  when you switch desktops.
- It does **not** appear over other apps' native full-screen Spaces. That
  would need the `NSWindowCollectionBehaviorFullScreenAuxiliary` collection
  behavior, which Tauri does not expose. Adding it would mean calling AppKit
  directly through `objc2`.
- Mission Control and Exposé may show the overlay as a window.

**Multiple displays**
- Only the primary display's work area is covered. The overlay is re-fitted
  when the scale factor changes. Plugging in or removing a monitor, or
  resizing the Dock, takes effect after a restart.

**Window platforms**
- **Polling lag:** window geometry is sampled every 100 ms. A character
  riding a window that's being dragged quickly moves in visible steps and
  can lag by up to 0.1 s. macOS has no public, permission-free notification
  for other apps' window moves. The Accessibility API offers one, but it
  needs Accessibility permission, so it isn't used.
- **Rectangles only:** window bounds include invisible padding some apps
  draw around their content, and rounded corners and shadows aren't
  modelled. On some windows the character may appear to stand a few pixels
  above the visible title bar.
- **Layer-0 rule:** some apps put their windows on other levels (for
  example floating "always on top" windows and some utility panels), so
  those are never platforms. Conversely, an app with an invisible but opaque
  layer-0 window could create a platform you can't see. The alpha and size
  filters catch the common cases.
- **No side collisions:** windows are one-way platforms only, with no side
  or underside collision, by design.
- **Unreachable edges:** maximized windows have their top edge at the menu
  bar, where the character can't stand, so they act as no platform at all.
- **Primary display only:** windows are clipped to the overlay. Windows on
  other displays are ignored.
- **Clicking near the character:** while the cursor is over the character,
  clicks go to the character. Standing on a title bar can block a click on
  the title bar right underneath it, but moving the cursor a few pixels
  aside works.

**Weapons and combat**
- **Scope:** only five archetypes (ten weapons) are implemented. There is no
  ammo, no weapon prefixes or modifiers, no buffs, no enemies other than
  training dummies, and no damage to or from the player.
- **Projectile collisions:** projectiles collide with dummies, the floor
  and the screen edges, but not with other apps' windows.
- **Minions:** minions fly freely and ignore platforms.
- **Keyboard focus:** keyboard shortcuts work only while the inventory
  window, or the overlay after clicking the character, has keyboard focus.
  There are deliberately no global hotkeys. They would capture keys from
  other apps.
- **Click versus double-click:** clicking the character attacks, so a
  double-click (to open the inventory) also attempts an attack.
- **Dummy placement:** dummies are placed on the floor of the primary
  display near the character. They don't stand on windows and aren't
  draggable.
- **Training AI:** the AI approaches by walking. If the character is on a
  window, it walks off the edge toward the dummy. It doesn't path-find
  around obstacles, since there are none on the floor.

**Permissions**
- None are needed: no Accessibility, Screen Recording or Input Monitoring.
  Reading the cursor position and toggling `ignoresMouseEvents` both work
  without them. Keyboard shortcuts work only when an app window has focus.
  There are no global hotkeys, which would need Input Monitoring or
  Accessibility permission.

**Accessibility**
- The character is decorative and cannot be reached by keyboard or
  VoiceOver. The tray menu is the accessible way to control the app.
- The inventory uses real buttons with grid roles, `aria-selected`, item
  names as `alt` and `title` text, visible focus rings, and number-key / `Esc`
  shortcuts.

**Distribution**
- The `.app` is unsigned and not notarized. On another Mac, Gatekeeper will
  ask for confirmation the first time it opens (right-click → Open).

## Art

- **Terraria art:** the character is drawn from **Terraria's own player
  sheets**, read at runtime from *your* installed copy of the game and cached
  only in your user cache folder. That art is © Re-Logic and is never
  included in this repository or the app bundle (see
  `docs/terraria-asset-integration.md` for the licensing notes).
- **Original art:** the built-in fallback character, the weapons, the
  training dummy and the minion are original placeholder pixel art drawn for
  this project, in `src/engine/sprites.ts`, `src/combat/weaponArt.ts` and
  `src/combat/sandboxArt.ts`. Weapon names are original too.

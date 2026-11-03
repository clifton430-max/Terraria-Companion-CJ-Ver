# Pickaxe strikes, cherry blossom theme, invisible platforms

## Pickaxe and Control mode

Control mode still captures every click, so nothing on the desktop gets clicked by accident.
Three things are kept separate:

- **Character interaction:** a press on the character picks it up, as before.
- **Pickaxe strikes:** a swing you trigger yourself strikes the pointer position at its impact
  frame, at any distance. That covers a click or hold in Control mode, `F`, the dock's attack and
  Silksong attacks with a pickaxe. Swings the companion makes on its own (roam, training) keep the
  pickaxe's reach rule (340 px; the Picksaw reaches farther). See `strikeReach()` in
  `src/effects/pickaxe.ts`.
- **Click-through:** strikes reach the page only through the Letter Destroyer link (a local queue
  at 127.0.0.1:47833 that the bookmarklet polls). They never arrive as mouse clicks, so links,
  buttons and other apps underneath are never activated. Outside Control, Build and Platform-edit
  modes the overlay stays click-through except over the character.

If no page has the Letter Destroyer running, the companion says so (at most every 45 s).

## Maps (Inventory → Maps)

**The menu bar (every map):** each map fills the menu bar with its own band, drawn in a
click-through, full-screen window just *under* the menu bar's own window (`crown`,
`src/theme/Crown.tsx`; full-screen because macOS pushes a shorter window starting at the top down
below the bar). The menu bar is see-through, so the band shows, while macOS keeps drawing the Apple
menu, menu names, status icons and clock on top, readable and clickable. Cherry Blossom: a soft,
see-through pink (the desktop and blossoms show through; over a strongly coloured wallpaper the
pink mixes with it), with a vine along the top edge and garlands along the bottom. Snow: night
blue with faint snowflakes, a snow cap with icicles and a string of lights. Chess: charcoal with a
faint checkerboard and an iron rail with chains sagging along the top; lanterns of several kinds
hang from the rail on interlocking chains that hook into a ring on each lantern's cap, dangling
just below the bar's edge and swinging like pendulums (longer chains slower, the lantern lagging a
little behind its chain, broken ones crooked and nearly still). Nothing else reaches below the bar.

There are three maps, which switch instantly, are saved across restarts, and can also be switched by
asking ("switch to the snow map", "switch to the chess map"):

- **Cherry Blossom:** everything below.
- **Snow:**
  - Pixel snowflakes fall instead of petals, using the same density, speed, wind, sway and size
    controls.
  - Under the menu bar: a snow cap with icicles and a string of coloured festive lights.
  - Along the Dock: a snowbank with snowmen (the game's Snow Balla, `NPC_145`), snowball piles
    (`Item_949`), presents (`Item_1869`) and Christmas trees (`Tiles_171`), each with a pixel-art
    fallback.
  - Beside a left or right Dock: icicles and lights.
- **Chess** (`src/theme/chessMap.ts`, `sands.ts`, `graveyard.ts`, `chessRuins.ts`): the graveyard of
  a chess war, half swallowed by dark sand; dark fantasy in the spirit of Hollow Knight. Nothing
  darkens the desktop or the world.
  - **Dark grey and black sand** along the Dock (a compact strip, about one Dock-height at its
    tallest) in three layers of wind-built dunes (a long slope
    up to a sharp crest, a steep drop behind), paler and hazier far away, almost black up close.
    Smoothly lit from the upper left, with bright crests, ripples and grain.
  - **Its own miniatures,** not the chess game's pieces: small weathered stone pieces turned from
    real piece profiles (the knight from its own outline), marble for one army and obsidian with a
    rim of light for the other, each aged differently (grime, lichen, cracks, chips, broken
    bases). They lie sunk into the sand: toppled, snapped with the top beside the base, leaning,
    buried to the neck, or only a fragment left; fewer and smaller further back, so it never feels
    crowded. The king and queen lie broken in the front dunes: she's snapped with her crown beside
    her, he's sunk to the chest. Now and then a column stump or a corner of checkered floor pokes
    out of the sand.
  - **Banners** of both armies stand planted on the dune crests, poles sunk deep and sand drifted
    against them, kept well apart.
  - **Particles that read on any wallpaper** (each has a dark edge and a pale core): sand blowing
    low off the dunes with the wind, drifting dust and ash flakes that swirl around the pointer,
    rising spores and embers, pale soul-lights, low slate fog and faint shafts of light.
  - No Terraria blocks, and no background silhouettes.

Assets checked in the Terraria and tModLoader installs:

- **Used:** the snow-block tiles, the three snowman enemies (only the Snow Balla, since the others
  carry a gun and a knife), snowballs, candy-cane blocks, the Christmas tree and presents.
- **Not found:** no snowflake particle texture, and no snow-specific mod assets in tModLoader.

## Cherry blossom theme (`src/theme/`)

**What macOS allows:** apps can't restyle the real menu bar or Dock. There's no public API for
it; the menu bar only follows Light/Dark mode and the wallpaper, and tools that restyle the Dock
inject into a system process with SIP disabled. Changing the wallpaper would change a global
setting, so the app doesn't do that either. What an app *can* do is draw its own transparent,
click-through windows at a chosen level.

So the theme is a separate full-display window (`ambient`) that is always click-through:

| Layer setting | Where it draws |
| --- | --- |
| Behind windows (default) | Window level −1: above the desktop picture, behind every app window. Decorates only the visible desktop and never covers apps |
| In front of windows | Floating level: petals drift over windows. Still click-through, and still below the menu bar and Dock, which macOS draws at higher levels |

**Decorations** (original pixel art in Terraria's style, `decor.ts`):

- A blossoming branch just below the menu bar, with denser clusters and dangling sprigs at the
  corners.
- Grass and flowers growing on the Dock's top edge. These use the real Terraria plant sprites
  (`Tiles_3` grass blades plus pink flower frames 17, 33, 34, 43, 44) from your install, with pixel
  fallbacks.
- A blossoming vine beside a left or right Dock.

The Dock's position comes from the display's usable area (no system files are read).

**Petals** (`petals.ts`):

- **Options:** density, speed, wind (either direction), sway, tumble, size, and a motion style:
  *Drift* (lazy sway), *Flutter* (quick fluttering), *Spiral* (corkscrew) or *Gusts* (the wind comes
  and goes). There are presets (*Gentle*, *Breezy*, *Flurry*) and checkboxes to switch the
  garland, grass and petals on or off.
- **Cost:** capped at 140 petals and drawn at ≤ 30 fps. The animation stops entirely when petals
  are off, at zero density, or when the window isn't visible.

## Invisible platforms (`src/engine/lines.ts`, `src/overlay/lineLayer.ts`)

| Input (in Platform-edit mode: ⌃⇧P, tray, or settings) | Effect |
| --- | --- |
| Drag on empty space | Draw a line. Nearly flat snaps flat; ⇧ snaps to 15° steps. Red preview = too steep or too short |
| Drag a line | Move it |
| Drag an end handle | Resize or tilt it |
| Click | Select (gold) |
| Right-click, Delete / Backspace | Remove |
| Arrow keys (⇧ = 10 px) | Nudge the selected line |
| Esc | Deselect, then leave edit mode |

**Visibility:** lines are invisible outside edit mode. Optionally a faint outline shows; the
setting is under Companion → *Invisible platforms*.

**Physics:** each line becomes a sloped one-way platform, handled by the same `step()` as window
tops. That covers Terraria movement, Silksong movement, Roam, the jump planner and ledge
awareness. The character lands, stands, walks (uphill and downhill), jumps off, and falls when the
line is deleted or it walks off the end. Moving a line carries a character standing on it.

**Saving:** lines persist as screen fractions (`lines.items`), so they keep their place across
restarts and resolution changes. Rust validates them: finite, on screen, not degenerate, at most
100.

**No traps:**

- Lines are one-way: jump up through them, and drop down with `S` (Terraria Controls) or
  Down + Jump (Silksong Controls).
- Lines steeper than a walkable slope (~50°) are refused.
- A single line spans at most 70% of the screen width, so there's always an edge to step off.
- A roaming character that stays on one line for 20 s drops through it.

## Limitations

- On screen, the theme was checked by rendering the garland and grass layouts to images and by a
  live run (plant sprites loaded, no errors). The petals were checked through tests; I haven't
  watched them on your desktop.
- In *Behind windows* mode, decorations are hidden wherever app windows cover the desktop. That's
  by design.
- The theme layer covers the primary display only.
- Pickaxe strikes need the Letter Destroyer bookmarklet running in a visible browser tab. The new
  reach rule is unit-tested. The full Control-mode path (swing → local queue → page) wasn't
  exercised against a live browser page.

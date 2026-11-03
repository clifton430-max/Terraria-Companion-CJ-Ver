# The settings menu (pause-menu style)

The settings window (tray → Settings, "open your settings", or the inventory shortcut) is a
slanted, deep-blue pause menu (`src/inventory/PauseMenu.tsx`, `HangingCompanion.tsx`, `pause.css`).
It's original CSS and SVG inspired by Persona 3 Reload's pause menu; no Persona files, fonts, logos
or art are used, and the figure is your own companion.

## Layout

The window opens at 1280×800 (it can be resized down to 560×460).

- **Backdrop:** a deep-blue watery gradient with drifting light shafts, soft caustics and rising
  bubbles.
- **Your companion's space** (left): a broad slanted slab of open space in your selected
  companion's own colours (her speech-bubble palette: Goblin Girl green, the Princess's pink...),
  edged in her strong colour, with a soft dot and stripe texture drifting across it.
- **Her, hanging upside down** (top left): your selected companion, drawn from her own sprites at
  3.4× and flipped head-down, hangs by a rope tied round her feet. She drops in with a little
  bounce when the menu opens, then sways slowly from the rope's top and bobs, breathing now and
  then. Choosing someone else (or changing her look) redraws her.
- **Her name** (bottom left, under her): huge, bold, slanted letters in her colour with a white and
  dark outline, in its own column so it never runs into the sections. Your custom name if you gave
  her one.
- **Clock** (top): the date, the day, today's real moon phase and the time of day.
- **Sections** (beside her): big condensed italic names stepping down a diagonal in her dark ink.
  The chosen one turns white on a slab of her colour with a dark shard springing in behind it; the
  open one has a tick in her colour.
- **Panel** (right): the section's settings on an angled panel that wipes in with a slight skew,
  with an outlined title and a subtitle. The existing settings panels are restyled to match.
- **Hints** (bottom): ↑↓ Select · ⏎ Confirm · Esc Back/Close.
- In a narrow window the section names run across the top, her name moves to the top right and
  the figure is hidden.

## Sections

| Section | What's in it |
| --- | --- |
| Characters | Character picker, skins and appearance, the roster (names, weapons, on screen) |
| Behavior | Personality and affection, idle poses |
| Assistant | Local AI (Ollama) and voice input (Wispr Flow / Apple Speech) |
| World | The Terraria world, playing, exploring, saved places |
| Combat | The weapon arsenal and training, control mode, the pickaxe, bosses |
| Awareness | Screen awareness and privacy, app reactions |
| Desktop | Build mode, invisible platforms, cursor modes, the dock, letter smash, Letter Destroyer |
| Maps | The maps (Cherry Blossom, Snow, Chess) and theme settings |
| Sound | Volumes and voice lines |
| System | Show or pause the companion, open the chat, the keys |

Every control is the same component as before, connected to the same setting.

## Keys and mouse

↑/↓ choose a section · Enter or → open it (its first control takes focus; Tab moves on) · Esc or ←
back to the list · Esc on the list closes the window. Hover a section to highlight it, click to open
it. The Combat section keeps the arsenal keys (1–0, Q/E, F, T, R, X, B, L).

## Why not the game's own assets

The Persona 3 Reload install (the demo, under GameHub) packs its assets in Unreal Engine `.pak` and
IoStore `.utoc`/`.ucas` archives whose index is AES-encrypted. Tools such as FModel can only open
them with the game's key, so the menu's real textures, fonts and animation data weren't extracted,
and none would be shipped in this project anyway.

## Testing it

`TC_DEMO=settings npm run tauri dev` opens the settings window a few seconds after launch.

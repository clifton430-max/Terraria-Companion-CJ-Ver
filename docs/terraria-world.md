# Terraria world behind your windows (and playing it)

A Terraria-style world drawn behind ordinary app windows. As scenery, the companions walk on its hills, step up ledges and fall into its caves. Played (by you, or by the companions on their own), it has biomes, structures, town NPCs, enemies, bosses, events, crafting, building and saved progress.

## Where it lives

- **Window:** it draws in the theme window (`ambient`), a full-display layer at the **desktop window level** (`desktop_layer.rs`): above the wallpaper, under Finder's desktop icons, the desktop widgets and every app window, on every Space. Layer order, bottom to top: world, then a "behind" theme (garland and grass, petals, snow or the chess map).
- **Input:** the window never takes clicks or keys itself (Finder's icon layer is above it). An event tap watches what's aimed at the *bare* desktop (no window, icon or widget under the pointer) and forwards it to the world as DOM events (`src/world/input.ts`).
- **Never paused:** WebKit's throttling of covered windows is turned off for the world and overlay webviews (`backgroundThrottling: disabled` plus window-occlusion detection off), so the world and the companions keep running behind full-screen apps.
- **A "front" theme has its own window** (`decor`): always on top, click-through, never focusable, under the menu bar and Dock. So cherry blossoms or snow set to *In front of windows* stay visible over Chrome and other apps whether or not the world is shown. (Before, a front theme was drawn in the bottom window whenever the world was on, so it only showed inside the world.)
- **Normally:** the world is a picture. Clicks, drags and keys on the desktop reach Finder's icons and widgets as usual, and it only redraws when something changes.
- **Exploring** (Maps tab → *Explore…*, tray → World → *Explore World…*, or "explore the world"): clicks, drags and scrolls on the bare desktop go to the world until you press Esc or click *Done*, and so do keys once you've clicked it (until you click elsewhere or switch apps; ⌘ shortcuts always stay the system's). Icons, widgets and windows keep their clicks. This needs **Accessibility** permission (to take input away from Finder); without it, exploring doesn't start and the panel (or the companion) says why, with a button to the right Settings pane.
  - Drag, scroll or use the trackpad to look around.
  - ⌘/Ctrl-scroll or +/− to zoom; arrows or WASD to move; Home to centre.
  - E toggles editing: left-click places the chosen tile, right-click or ⇧-click removes, and dragging paints.

## The world (`src/world/gen.ts`)

- **Determinism:** every tile is a pure function of (seed, x, y). The world is 4200×600 tiles (about a Terraria "small" world). Nothing is stored except the seed and your edits.
- **Terrain** (`terrain.ts`, `gen.ts`): rolling hills of grass over dirt, clay pockets, sandy dips, then stone with dirt and mud pockets and copper, iron, silver and gold veins (each vein one metal: copper and iron near the top, silver and gold deeper). Winding tunnels run below the topsoil, with big caverns deeper down and the occasional surface entrance.
- **Biomes:** ocean (water, beaches, palms) at both edges, then snow and jungle on opposite sides, the corruption, a desert, forest around the spawn, glowing mushroom caves underground, and the underworld (ash, hellstone, lava, obsidian) at the bottom. Each has its own blocks, background walls and trees.
- **Structures** (`structures.ts`): the dungeon (with the Old Man), cabins with chests, sky islands, corruption chasms with shadow orbs and a demon altar, bee hives with a larva, underworld ruins with a hellforge, and NPC settlements where town NPCs wait to be met. Pots, herbs, mushrooms and life crystals are scattered through the world.
- **Trees:** spaced apart on flat ground, using trunks, tops and branches from the install (forest, boreal, jungle, corruption and palm). Felled trees grow back at the next dawn.
- **Art:** loaded at runtime from your install through the app's existing asset loader. Plain colours are used if it isn't found, and nothing is copied into the repo.

  | Thing | Install files |
  | --- | --- |
  | Tiles | `Tiles_0/1/2/40/53/6/7/8/30/59` |
  | Cave walls | `Wall_1/2` |
  | Sky | `Background_0` |
  | Parallax | `Background_7/8/9` |
  | Trees | `Tiles_5`, `Tree_Tops_0`, `Tree_Branches_0` |
  | Plants | `Tiles_3` |

- **Rendering** (`render.ts`):
  - Terrain is drawn in 32×32-tile chunks, each rasterized once at 16 px and cached (bounded LRU, about 1 MB per chunk), then scaled with nearest-neighbour filtering.
  - Zoom steps (1, 1.5, 2, 2.5, 3, 4×) keep a whole number of pixels per tile, and the camera snaps to the device-pixel grid, so tiles stay crisp and aligned.
  - Tile edges use the same autotile framing as Build mode.

## Saving

- **Prefs** (`world`): shown, seed (picked at random the first time), zoom, camera, editing, and "companions walk on the terrain".
- **Edits:** saved separately in `world.json` in the app's config folder, size-capped and validated. A different seed starts fresh, and an invalid file is ignored.
- **Camera:** saved when exploring ends. While you explore it's streamed live to the companions (throttled to 20 updates a second) without touching the disk.

## Companions on the terrain (`view.ts`)

- **Surfaces:** the visible terrain becomes the same solid platforms, walls (with the one-block auto-step) and ceilings as placed blocks, in its own id range.
- **Lift-out:** if the world scrolls or switches on around a character, she's lifted onto open ground.
- **Off switch:** turn off "Companions walk on the terrain" to keep the world purely decorative.

## Looking around from the desktop

- **When nothing is running** (no game, not exploring), hold the **pan chord** (default ⌥⌘) and drag the bare desktop to move the view across the world; scrolling with it held pans too. The view is saved when you let go. A plain click or drag still selects icons as usual.
- **Finder sees it too:** watching a drag needs no permission, but it can't be taken away from Finder, so its selection rectangle shows while you pan. ⌃ makes Finder open its desktop menu (⌃-click is a right-click), so the settings warn about chords with ⌃.
- **Your windows aren't affected:** the world window stays under the icons and behind all app windows and never takes the keyboard or focus.
- **The companions keep going:** their AI and animations run throughout. They walk on whatever terrain scrolls into view, and terrain moving onto them lifts them out.
- **No accidental grabs:** while a world drag is in progress, the overlay doesn't take the pointer, so passing over a companion doesn't pick her up. Starting a drag on a companion still picks her up as before.
- **Setting:** Maps tab → *Hold ⌥⌘ and drag (or scroll) the bare desktop…* (on by default), with a modifier-only picker for the chord (⌃ ⌥ ⇧ ⌘).

## Saved places (the gallery)

- **What's in it:** every biome, structure, NPC settlement, the town, the boss arena and every house the companions have found or built, each with a name, a preview picture, a biome label, a progress bar (houses and the arena) and a status line (who lives there, which boss was beaten there...).
- **Where:** Maps tab → *Saved places*. Filter by houses, towns and settlements, biomes, or structures and arenas.
- **Click a place to look at it.** While the companions play, the camera stays there until you click a companion's name (or the world) to follow her again; the game panel has the same list under *Places*. When nothing is running, the background view moves there (and is saved).
- **How it's kept:** the world window writes `world_places.json` next to the world save (validated, size-capped) every 15 s while they play, drawing one missing or out-of-date preview each time (a small JPEG of the spot at the smallest zoom, with buildings and furniture). The list is for the current seed.

## Limitations

- **Primary display only:** the world covers the primary display, like the theme layer.
- **Desktop icons and widgets:** they draw above the world. Telling an icon from the bare desktop uses Finder's accessibility tree (icons and their labels are skipped); without Accessibility permission only windows are checked, which is all panning needs.
- **Menu bar and Dock:** they always draw above it.
- **Exploring and playing:** work only where the bare desktop shows, and need Accessibility permission.


## Playing the world

**Starting and stopping:**
- **Two ways to play** (Maps tab → *Terraria world*, tray → World, or by voice/text):
  - **Play Terraria** ("play terraria"): your companion plays and you control her. By default that's your selected companion; *Who plays* picks another.
  - **Let the team play** ("let the girls play terraria", "build me a house in terraria"): the companions on screen (up to four) play through Terraria on their own. See *The companions' adventure* below.
- **Other windows can stay open:** the game starts and keeps running whatever is on screen; nothing pauses it. It needs Accessibility permission (see *Exploring*); without it the panel or the companion says why.
- **Your main companion stays on the desktop:** she never disappears when a game starts. She keeps walking, talking and reacting there (and can still be picked up) while the world plays its own copy of her. When the companions play on their own, the *other* companions on screen step into the world and come back when the game stops.
  - Character Control always drives the desktop companion; turning it on ends a game.
- **Input:** clicks on the bare desktop, and keys after you've clicked it, go to the game (forwarded by the event tap; the window stays under the icons and behind your apps). Switching apps only lets go of your keys: the game keeps running. The overlay stays click-through. The inventory and chat panels hide when a game starts.
- **Leave:** click *Leave game* / *Stop playing*, press Esc in building mode, say "stop playing", or use tray → World → Stop. The world goes back to being passive scenery.

**The companions' adventure (`adventure.ts`, `builder.ts`, `house.ts`, `nav.ts`):**
- **A director decides the priorities**, re-thought every 2 s, roughly the order a Terraria player would go in:
  1. A boss on screen: everyone fights it. An invasion: everyone defends the town.
  2. The first house (wood, two doors, a loft, a stone roof, work bench and furnace).
  3. Town houses whenever a town NPC is ready to move in (Guide, Merchant, Demolitionist, Dryad, Arms Dealer, Painter, Dye Trader, Angler, Witch Doctor, Clothier, Mechanic and Stylist, each with Terraria-like conditions). NPCs waiting at settlements are met first, then move in when there's a valid room (walls, a door, light, a table and a chair).
  4. Gear: torches, healing potions, a bow and arrows (topped up when low; bought from the Merchant when that's cheap), then iron, gold, demonite, jungle and molten tools, weapons and armour as bosses fall.
  5. Life crystals until everyone is strong.
  6. The next boss, once life and defence are high enough: King Slime and the Eye (summoned, at the arena or in town), the Eater of Worlds (smashing shadow orbs), the Queen Bee (the larva), Skeletron (the Old Man, at night) and the Wall of Flesh (the guide voodoo doll in the underworld). A fight that drags on for six minutes without progress ends with the boss leaving; they prepare more and try again.
  7. **Luxury houses, the long-term goal:** one big themed house per biome, unlocked as they progress (forest first, then ocean, desert, snow, jungle, corruption, mushroom, sky and underworld). Each has 3–4 floors of 3–4 rooms (bedrooms, kitchen, library, workshop, storage, hall...), optional towers with spires, a pitched, stepped, flat or dome roof, a foundation down to the ground, ramped doorsteps, and furniture, lights, chests, crafting stations and decorations in the biome's style (boreal, rich mahogany, palm, ebonwood, mushroom, skyware, obsidian...). They're real tiles, walls and furniture in the world, built over time.
  8. Exploring the next unseen place (looting chests and pots on the way), then helping with the luxury house, then resting.
- **Preparing and adapting** (`tools.ts`): every goal is planned through the recipe tree. If something is missing, they gather it (chop, mine, hunt, harvest, catch stars), craft it, place the station it needs or buy it. A tool that can't break something gets replaced with one that can. Plans that loop are dropped, and things that can't be found are set aside for a while.
- **Getting unstuck:** A* pathfinding over a two-column body (walk, step, jump, fall, platforms); bridging gaps; digging out of tunnels; stepping aside for builders; giving up on unreachable tasks (and life crystals) for a while; the Magic Mirror home; and a watchdog that resets anyone who hasn't moved or done anything useful in 45 s.
- **Wood** (`builder.ts`, `trees.test.ts`): only *good trees* are chosen: room to stand beside the trunk's base, not on a sky island, and not more than 200 tiles further than the nearest one. On a ledge above the trunk or in a hole below it, she paths down (or up) to the base instead of standing there. On the way, she won't dig through the team's buildings or world structures for a tree. A tree she can't reach (no closer in 15 s, 10 s beside it without reaching the trunk, a catch-all reset, or a trunk that won't come down) gets a **tree mark** the whole team respects, saved with the adventure: left alone 1 min, then 5 min, then until the next dawn. With no good tree nearby she takes wood from the team's own chests or from world chests they've already opened (never Master's), then travels further for trees, then puts the goal aside until a mark expires.
- **Bags:** the 50-slot inventory is shared with player mode; the team carries 150 more slots (four girls, four bags), saved with the adventure. Rubble from digging is kept to a couple of stacks each.
- **Enemies are on:** monsters, events (Blood Moon, goblin army, slime rain) and bosses happen as in player mode, with spawn caps.
- **HUD:** the current focus, a boss or event bar, coins, day and residents, the bosses defeated, what each companion is doing and her life (click a name to follow her), the latest journal lines, *Places*, speed 1×/2×/4×/8×/16× and Stop.
- **Saving:** the adventure (projects, residents, met NPCs, discovered places, max life, bags) is saved inside `world_player.json`; buildings live in `world.json`. Next time they carry on where they were.
- **Pace:** in a simulated run (`adventure.test.ts` checks the first hour), they finish the first house and a town house, take in residents and craft iron gear within the first hour, have half a dozen residents and full iron armour after a few hours, and beat King Slime after about five hours of play (under 20 minutes at 16×). Wood and ore are the slow parts, as in Terraria.
- **Older building mode:** `Builders` (one house, peaceful) still exists in `builder.ts` and is covered by `builder.test.ts`.

**What's in it** (`src/world/game/`):
- **Player:** your companion in her own look (`get_character_rig`). Armour still gives defence, but it isn't drawn on her.
  - Movement uses Terraria's numbers: 3 px/tick run, a held 5 px/tick jump of about six tiles, gravity, a one-block auto-step, one-way platforms (S drops through), and fall damage past 25 tiles.
  - Your custom Terraria keybinds from settings are used.
- **Mining and building:** pickaxes dig with power-based hit counts, axes chop trees (wood) and cacti, and mined blocks drop as items you collect. You can place dirt, stone, wood, sand, clay, mud, snow, ice and platforms.
- **Furniture:** placed work benches, furnaces, anvils, chests (40 slots; shift-click moves stacks) and torches. Furniture falls if its floor is dug out.
- **Inventory:** 50 slots with a 10-slot hotbar, Terraria-style stacking, a cursor item, right-click to split, and three armour slots for defence.
- **Crafting:** recipes need the nearby station (work bench, furnace, anvil). The chain runs: wood → torches, bench, wooden gear → furnace → copper, iron and gold bars → anvil → copper and iron tools, weapons and armour, gold armour → demonite bars from the Eye of Cthulhu → Nightmare Pickaxe and Light's Bane. Boss summons and healing potions are craftable too.
- **Combat:**
  - Weapons: swords and pickaxes swing and hit along the arc; shortswords stab toward the mouse; bows fire arrows with gravity (unholy arrows pierce).
  - Damage rules: enemy defence halves damage, with variance and crits. Knockback, invincibility frames and floating damage numbers are in.
- **Survival:**
  - Life is 100 to start, plus 20 per life crystal (found in caves) up to 400. It regenerates when you avoid damage.
  - Mushrooms and lesser healing potions heal (H uses the best one), with potion sickness.
  - When you die you respawn at the world's centre.
- **Enemies by place and time:**
  - Surface: green and blue slimes by day; zombies and demon eyes at night (they leave at dawn).
  - Underground: cave bats and slimes, with skeletons deeper down.
  - Spawns happen off screen with a cap, and enemies despawn far away.
- **Bosses:**
  - **King Slime** (Slime Crown): hops, teleports, sheds slimes and shrinks as he's hurt.
  - **Eye of Cthulhu** (Suspicious Looking Eye, at night only): hovers, summons servants, charges in threes, enters a faster second phase at half life, and flees at dawn.
  - Both get a boss bar, drops, and are remembered once defeated.
- **Biomes:** forest in the middle, snow and jungle on opposite sides, and a desert. Each has its own blocks, trees (boreal and jungle canopies) and cacti.
- **Day and night:** one real second is one game minute, so a full day takes 24 minutes. Sunlight falls down open shafts and fades through rock. Torches, furnaces and life crystals glow, and you have a dim personal light.
- **Saving:**
  - Progress (inventory, armour, life and max life, position, time, bosses) goes to `world_player.json` every 30 s and when you leave.
  - Tiles, furniture, chests, chopped trees and taken crystals go to `world.json`.
  - A different seed starts fresh, and bad files are ignored.

All sprites (items, enemies, bosses, furniture, tiles, the HUD's slots and hearts) are loaded at runtime from your Terraria install. The game's code was not copied or decompiled; behaviours and numbers were written for this app to feel like Terraria.

**Not included (yet):**
- **Hardmode:** everything after the Wall of Flesh (hallow, mechanical bosses, Plantera onward). Defeating the Wall is the adventure's last boss.
- **World features:** crimson, honey, flowing liquids (water and lava are still pools), slopes, and wiring.
- **Systems:** fishing, game sounds, the minimap, NPC happiness, and the full Terraria item list (about 250 items are in).
- **Simplifications:** behaviours, numbers and generation are Terraria-inspired, written for this app; town NPC conditions, shops and boss patterns are simplified.

# Building, new weapons and the Moon Lord

## Build mode (`src/engine/blocks.ts`, `src/overlay/buildLayer.ts`)

**Turning it on:** press ⌃⇧B (change it under Companion → *Build mode*), use tray → *Build Mode*,
or click *Start building*. While Build mode is on, the overlay takes mouse input (Rust sets
`build`, which the hover watcher treats like Control mode). `Esc`, the shortcut again, or switching
apps turns it off. When it's off, the overlay is click-through, so a normal desktop click can never
place a block.

| Input | Effect |
| --- | --- |
| Left click / drag | Place the selected block (paints across cells while dragging) |
| Right click, ⇧-click / drag | Remove blocks |
| 1 / 2 / 3 | Dirt / Stone / Wood |
| Pointer | Preview of the block: white outline = can place, amber = existing block (right-click removes it), red ✕ = can't place (the HUD says why) |

**Grid:** one Terraria tile (16 art px) per cell at the character's art scale, anchored to the
screen's bottom-left, so row 0 sits on the floor. Placement is refused on an occupied cell, off
screen, over the 400-block limit, or inside the character.

**Saving:** blocks persist in preferences (`build.blocks`, as `{c, r, k}`). Rust validates them:
known kinds only, in-range cells, no duplicates, at most 400.

**Art:** real tile sheets from your install (`Tiles_0` dirt, `Tiles_1` stone, `Tiles_30` wood). Each
block is framed from its four neighbours, Terraria-style, with three variants per shape. This was
checked against the real sheets. If the art can't load, blocks fall back to flat colours with
darker rims.

**Physics:** `blockSurfaces()` turns the blocks into:

- **Platforms:** each row of exposed tops. Ids are negative, so they are solid and `dropThrough`
  refuses them.
- **Solid walls:** each exposed side. Unlike window junction walls, these block airborne bodies
  too. A grounded body walking into a wall one block high is lifted on top (Terraria's auto-step).
- **Ceilings:** each exposed underside. A rising head stops below it.

Everything uses the shared `step()`, so roaming, the jump planner, ledge awareness, Silksong
movement (wall cling, Clawline, pogo bounces) and window platforms all see the blocks.
Removing the block the character stands on makes it fall at once.

## New weapons (`src/combat/weapons.ts`)

Item and projectile art comes from the local install at runtime (`Item_*`, `Projectile_*`).
Nothing is copied into the repo.

| Weapon | Item art | Behaviour |
| --- | --- | --- |
| Meowmere | Item_3063 | Sword; each swing launches a piercing cat (Projectile_502) |
| S.D.M.G. | Item_1553 | Very fast gun; luminite streaks (Projectile_638) |
| Celebration Mk2 | Item_3930 | Firework rockets that burst on contact or at the end of their flight, splash damage in a 70 px radius, random colours |
| Solar Eruption | Item_3473 | Long-reach lash, drawn as a fiery chain from the hand to the flail head |
| Stardust Dragon Staff | Item_3531 | Summon; dragon head sprite (Projectile_625) darts at targets |
| Terraprisma | Item_5005 | Summon; white blade (Projectile_946) with a hue-cycling glow |
| Vortex Beater | Item_3475 | Fast gun; vortex rounds (Projectile_616) |
| Needle / Thread | (original art) | Silksong items; see `silksong-controls.md` |

Approximations (also listed in each item's tooltip): no ammo, no tile collisions for
projectiles, a single-head dragon, and simplified Terraprisma formations.

## Moon Lord (`src/combat/moonlord.ts`)

Summon it from Companion → *Bosses* → *Moon Lord* or tray → *Boss* → *Summon Moon Lord*.
Summoning one boss ends the other. *Retry* restarts the last boss summoned; *Dismiss* sends either
away. Difficulty (Easy / Normal / Expert / Master) scales health, damage and attack rate.

| | |
| --- | --- |
| Look | Head (NPC_396, 8 tentacle frames), hands (NPC_397: open palm, a fist once the eye is destroyed) and core (NPC_398: covered, then a beating heart) from your install. The torso, arms and eyes are drawn procedurally, so the eyes can track the character, flare before attacking and shut when destroyed. Scaled to fit the screen |
| Phases | Rises from below (untouchable) → the head eye and both palm eyes can be hit → once all three are destroyed, "The Moon Lord's core is exposed!" → the core takes damage → death throes (3 s of bursts, fade) → "Moon Lord has been defeated!" (victory event) |
| Attacks | Phantasmal Bolts (hands, a fast fan of three); Phantasmal Spheres (hands, a ring that hangs with a red warning ring, then rushes); Phantasmal Deathray (head: 1.1 s red dashed warning line, then a 1.6 s beam that tracks slowly enough to outrun); homing Phantasmal Eyes and bolt bursts (core phase) |
| Health | Bottom boss bar named "Moon Lord" (all parts combined), plus small bars under each hittable part. The companion's hearts show during the fight |
| Fairness | Attacks pause while the companion is slain (4 s respawn). No contact damage from the body |

All weapons work against it (Terraria and Silksong schemes), and so does the companion's
auto-fight in roam mode.

## Limitations

- Blocks are anchored to the screen, not to windows. Moving a window doesn't move blocks.
  Changing the character size rescales the grid along with the character.
- Mixed block kinds join up like a single tile type. Terraria blends dirt and stone with special
  edge frames.
- The Moon Lord is a desktop-sized approximation: no True Eyes of Cthulhu, no leech tongue, and
  no legs.
- In-app visuals were checked in a live run only through logs (textures loaded, no errors). The
  pose and tile renders were checked as images; the full Moon Lord fight was checked through tests,
  not by eye.

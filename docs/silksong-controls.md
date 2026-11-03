# Silksong Controls (movement and the base Needle)

A second Control-mode scheme inspired by Hollow Knight: Silksong. Switch it in Inventory →
**Companion** → *Control mode* (Terraria Controls / Silksong Controls; saved across restarts). Then
start Control mode (⌃⇧C or the tray). Esc leaves it.

## The Silksong installation

**What's there:** found at `Steam/steamapps/common/Hollow Knight Silksong`. It's a Unity build:
art and animation data are packed in Unity asset files (`resources.assets`,
`sharedassets0.assets`) and about 2,068 compressed Addressables bundles
(`StreamingAssets/aa/**.bundle`).

**Why none of it is used:** no Unity asset reader is installed, and none was downloaded. The game's
art is also proprietary, so nothing is extracted, copied or bundled.

**What's used instead:** the game served as a reference for feel only (from general knowledge of
how Hornet moves). Every sprite and effect here is original pixel art in the companion's Terraria
style. Timings are tuned by feel and are not read from the game's files.

## Default keys (rebindable; Esc stays reserved)

| Action | Key |
| --- | --- |
| Run | A / D (arrows also work) |
| Look / strike up, down | W / S |
| Jump (again in the air: double jump; hold while falling: glide) | Space |
| Dash | K |
| Needle (hold, then release: charged strike) | J or left click |
| Thread spin | L |
| Clawline grapple (aims at the mouse) | U |
| Dive attack (in the air; Down + Dash also works) | O |
| Diagonal pogo | Down + Left/Right + attack, in the air |
| Select hotbar item | 1–0 (unless bound to an action) |

## Movement (`src/silk/movement.ts`)

Built on the existing physics step, so window tops, steps, junction walls, carrying and landing all
still apply.

| Move | How it works |
| --- | --- |
| Run | 260 px/s, with snappy acceleration and braking |
| Sprint | Hold the direction out of a dash to reach 420 px/s |
| Jump | 760 px/s. Variable height: let go early for a short hop. 0.1 s coyote time and a 0.12 s jump buffer |
| Double jump | Once per airtime, refreshed on landing, on a wall cling, after a pogo and after the grapple |
| Glide | Hold jump while falling (after the double jump, or after a moment in the air). Fall speed is capped at 110 px/s |
| Dash | 0.17 s at 760 px/s with no gravity. 0.4 s cooldown, one dash per airtime |
| Wall cling and wall jump | Press into a screen edge or a window junction wall while airborne. The fall slows to 110 px/s; jump to push off and away |
| Clawline | Fires toward the mouse at the best point on a window edge within 380 px and about 35° of the aim, then pulls you up to it. Jump while pulling to launch. No anchor means a visible miss that snaps back, so you never get stuck |

## Needle and Thread (`src/silk/needle.ts`, `src/silk/controller.ts`)

| Attack | Details |
| --- | --- |
| Side strike | Strikes on press with a windup, a swing and a follow-through. 0.3 s cooldown |
| Up strike | Hold Up while striking |
| Down strike (pogo) | Hold Down in the air. A hit bounces you up and refreshes air moves |
| Charged Needle Strike | Hold attack for 0.55 s (a glow builds at the hand), then release. A forward lunge with a long hitbox and 3× damage |
| Thread spin | Costs 3 silk. Spins for 0.6 s and hits all around every 0.15 s |
| Diagonal pogo | Down + a direction in the air. Strikes down-forward; bounces off an enemy, a surface below (window top, placed block) or the Letter Destroyer pointer. Own pose (`diag`) |
| Dive attack | Dive key, or Dash while holding Down, in the air (uses the air dash). A 45° plunge at 860 px/s that stays live the whole way down. Hitting something bounces you up; landing makes a slam shockwave on both sides, then a short recovery. Poses `dive` and `slam` |

**Bounce rules:** each pogo strike bounces at most once, with a 0.12 s cooldown between bounces.
Standing on the floor never bounces, so the screen bottom can't trap you. Every bounce refreshes the
double jump and air dash.

**Equipped item:** the attack button uses whatever is equipped, so Terraria weapons work under
Silksong Controls with their own timing, cooldowns and effects:

| Equipped | Attack button |
| --- | --- |
| Needle (or nothing) | The Needle strikes above |
| Thread | Silk spin (3 silk). With too little silk it casts through the sim with mana instead |
| Swords and pickaxes | Their normal Terraria swing. Down / diagonal-down in the air becomes a pogo strike with the sword's damage and reach, drawn with the sword's sprite. The dive also uses the sword's damage |
| Guns, bows, staffs, summons, Zenith | Fire through the sim: toward the cursor (mouse attack), in the held direction (Up, Down in the air, diagonals), or straight ahead |

The Needle and Thread are also normal inventory items (hotbar slots 8 and 9). Under Terraria Controls
the Needle is a quick sword and the Thread a mana spin. Switching schemes keeps the inventory and
settings.

**Silk meter:** 9 spools above the head. Each hit fills one.

**Hits:** damage training dummies, the Eye of Cthulhu and its Servants through the existing combat
sim, so damage numbers, sparks and boss health all work.

**Letter Destroyer:** a strike that covers the mouse pointer smashes the page there (spin power 3,
charged power 2, others 1), with the usual impact burst.

## Art

**Original pixel art (`src/silk/render.ts`):**
- the Needle: a silver blade with a red thread tassel
- white and pink slash crescents
- the charged lunge streak
- spinning silk rings
- a red and white silk trail while dashing, gliding, grappling or striking
- the Clawline thread, the charge glow, dash streaks, and the silk-meter pips

**New character poses:** `dash`, `cling`, `glide`, `pogo` and `lunge`, composed from your
character's own sheets (and any skin, such as 2B) by `src-tauri/src/terraria/player.rs`, so the
buddy keeps its look.

**Other frames:** run uses the walk cycle, landing a quick squash, and the spin whirls between two
frames. Atlases without the new poses fall back to similar ones.

## Integration

- Terraria Controls, roaming, Stay-Put, dragging and throwing, pickaxes, the chat and the speech
  bubble are unchanged.
- Silksong Controls only apply in Control mode. Switching scheme or leaving Control mode resets the
  movement state; the silk meter is kept.

## Limitations

- **Animation:** the character art has no frames that combine running legs with an attack pose,
  so attacking while running shows the attack pose gliding along.
- **Wall cling:** only works on vertical surfaces the physics knows: screen edges, window
  junction walls and the sides of placed blocks. There's no wall *climbing*.
- **Clawline:** anchors to window and placed-block tops (no ceilings or arbitrary objects).
- **Pogo with ranged weapons:** guns and staffs aim down instead of pogoing (they have no strike
  to bounce off).
- **Not built:** upgraded Needles, Crests, tools, healing (Bind) and enemies, by design.

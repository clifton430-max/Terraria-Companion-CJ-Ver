# Eye of Cthulhu, Terraria weapons and companion modes

This covers the boss fight, the six end-game weapons, Stay-Put, the cursor modes and the letter
effect. All of it runs on the companion's own transparent overlay. Nothing here reads, clicks,
types into or changes another application.

## Eye of Cthulhu (`src/combat/boss.ts`, `src/combat/sim.ts`)

**Source of the behaviour.** The AI is a clean-room re-implementation of the Eye's publicly
documented behaviour (the official wiki and observed gameplay). It is not a translation of
decompiled game code. Re-Logic has issued takedowns for redistributed decompiled source, so none is
used or committed.

**What it does**
- It spawns above the screen and descends to hover above the companion. While hovering in its first
  form it summons Servants of Cthulhu (capped by difficulty).
- It dashes three times at the companion, then hovers again.
- At 50% health it spins in place, switches to the mouth frames (NPC_4 frames 3–5), loses defence,
  deals more contact damage and stops summoning. Second-form dashes are faster.
- Expert and Master add a frenzy below 20% health: rapid chained dashes.
- At 0 health it announces its defeat, fades and is removed. If the companion dies or you dismiss
  it, it flies off the top of the screen.
- Servants home in with inertia and give up after 25 s.

**Difficulty** (Companion tab or tray → *Boss* → difficulty): Easy, Normal, Expert, Master. Health, contact damage, speed and Servant caps scale with it, and so does the
companion's damage taken (Terraria's defence factor of 0.5 / 0.75 / 1).

**Desktop tuning (approximations)**
- Health is the game's 2800 × 2.5. The companion's weapons are end-game, so the vanilla value would
  end the fight in seconds.
- The companion has 500 life and 30 defence. It regenerates 6 life/s after 4 s without being hit,
  has 0.67 s of invincibility after a hit and respawns 4 s after dying (the fight continues).
- Speeds are in screen px/s scaled by the character size, not game tiles.

**Balance, measured by `terrariaWeapons.test.ts`** (the AI fights the Eye with each weapon; seeded
and deterministic):

| Weapon | Normal | Master |
| --- | --- | --- |
| Terra Blade | won, 27 s, 0 deaths | — |
| Night's Edge | won, 123 s, 0 deaths | — |
| Megashark | won, 129 s, 0 deaths | lost after 400 s, 9 deaths |
| Daedalus Stormbow | won, 59 s, 0 deaths | — |
| Last Prism | won, 48 s, 0 deaths | — |
| Zenith | won, 21 s, 0 deaths | won, 254 s, 8 deaths |

**Controls:** Companion tab → *Summon / Retry / Dismiss*, tray → *Boss*, or `B` (toggles summon and
dismiss) while the overlay or inventory has focus. With a boss present the companion fights it
automatically using the equipped weapon (training mode isn't required). In Stay-Put it fights only
what comes within reach, without moving. In Control mode you fight it yourself.

**Art:** NPC_4 (Eye, pivot 55,110), NPC_5 (Servant), UI_BossBar (six stacked 58 px layers: frame,
fill, damage, track, shield ×2), NPC_Head_Boss_0, Heart2 and Mana. Each has a drawn fallback.

## Weapons (`src/combat/weapons.ts`)

Item art, projectile sprites and the slash and laser textures are loaded at runtime from the local
install, and the original pixel art is the fallback. Each weapon's `approximation` field states how
it differs from the game:

- **Terra Blade:** every swing fires a piercing Terra Beam (Projectile_132). In the game the beam
  depends on health.
- **Night's Edge:** a swing with the real slash crescent (Projectile_972, tinted). Damage comes from
  the blade arc only.
- **Megashark:** rapid fire with musket-ball sprites (Projectile_14). There's no ammo system.
- **Daedalus Stormbow:** 3–5 Holy Arrow sprites (Projectile_91) rain from above the target, without
  the falling-star bonus.
- **Last Prism:** a 3 s channel that drains mana. Six lasers converge over 1.2 s while damage ramps
  from 35% to 100%. Laser segments come from Projectile_632 (tinted per colour) and the spinning
  holdout from Projectile_633. The beam ignores tiles and pierces everything.
- **Zenith:** each use throws one spectral sword (a random sword from the game's list) on an
  out-and-back arc to the target, with afterimages. There's no blade hitbox.

Melee item art is scaled so the drawn blade tip lands at the simulated reach, so what you see is
what hits.

## Stay-Put mode

Companion tab → *Stay put*, or tray → *Mode* → *Stay Put*. It stops wandering and pursuit. Gravity,
platforms, dragging and throwing still work, and wherever you drop it becomes the new spot. If it's
knocked away it walks back. The spot is saved as screen fractions in `prefs.json` (`stayPosition`)
and restored on the next launch. It also moves with a window it's standing on. Poses: *Stand*,
*Sit* and *Wave*. Terraria's sheets have no sitting frame, so *Sit* is composed from the jump legs
with the upper body lowered 6 px. That is an approximation. *Roam* resumes immediately.

## Cursor modes (`src/overlay/modes.ts`)

Tray → *Cursor*, or the Companion tab. These are visual only.
- **Ride Cursor:** the character sits on the pointer (ride pose) and trails it slightly.
- **Hug Cursor:** the character's hand holds the pointer from the side facing the screen centre.
- **Become Cursor:** a 1× character whose pointing hand sits exactly on the pointer's hotspot.

While a cursor mode is on, the overlay never takes clicks: every click goes to the app underneath,
and the character can't be dragged. Rust streams the pointer position (overlay coordinates only) to
the overlay while a mode is on.

**Hiding the real pointer** is optional (*Hide the real pointer in Become Cursor*), off by default,
and applies only to Become Cursor. macOS normally only lets the frontmost app hide the cursor. The
companion is a background app, so it uses the private CoreGraphics connection property
`SetsCursorInBackground` before `CGDisplayHideCursor`. It doesn't need extra permissions, but it is
an undocumented API and could stop working in a future macOS. The pointer is shown again when:
- the pointer is over the menu bar or outside the overlay
- Control mode starts
- the mode or the option changes, or the companion is hidden
- the app quits, or panics (panic hook and exit handler)

`examples/cursor_hide_check.rs` verifies the hide and restore on this Mac.

Leaving a cursor mode drops the character where it is, back under normal physics.

## Letter smash (`src/effects/letterBreak.ts`)

A word from the companion's own settings (default `TERRARIA`; A–Z, 0–9 and spaces, at most 16
characters, sanitised in Rust) is drawn on the companion's overlay above it. The word cracks,
scatters into pixels that bounce on the companion's floor, reassembles and fades, all in about
4.7 s.

**Scope:** it never reads other apps' text, injects keystrokes, edits documents or alters webpages.
Identifying real on-screen letters would need screen capture or Accessibility access, so it uses
its own synthetic word instead.

**Limits:** one effect at a time, at most one start every 6 s, and at most 1200 particles.
Finished effects are removed entirely.

**Off switch:** Companion tab → *Stop* (clears it now), the *Enable* checkbox, or tray →
*Effects*. Turning the effect off also clears anything active.

Triggers: *Smash*, tray → *Effects* → *Letter Smash*, or `L`.

## Tests

| File | What it covers |
| --- | --- |
| `boss.test.ts` | Spawn and descent, triple dash aimed at the target, Servant cap, the 50% transform, defeat and fade, fleeing, difficulty and frenzy, determinism |
| `terrariaWeapons.test.ts` | Weapon cooldowns and damage, beam, skyfall, prism ramp, fractal paths, projectile collision, the boss sandbox, the AI balance table above |
| `modes.test.ts` | Ride, hug and become anchors; follow smoothing; Stay home round-trip; pose frames; mode priority; stay walk-back; cursor-mode exit |
| `letterBreak.test.ts` | Phase order and self-cleanup, exact reassembly, floor collision, rate limit and busy, off switch, particle cap, on-screen clamping |
| Rust `prefs.rs` / `combat.rs` / `cursor_hide.rs` | Prefs validation and round-trip, word sanitising, the action allowlist, the hide decision |

## Developer aids

- `TC_DEBUG=1` logs asset requests and front-end errors to stderr.
- `TC_DEMO=summonBoss,letterSmash` sends those allowlisted commands a few seconds after launch.

## Quick-action dock (`src/dock/`, `src-tauri/src/dock.rs`)

- **Window:** a third Tauri window (`dock`): transparent, always on top, on all Spaces, not
  focusable, and it accepts the first click. It is separate from the overlay, so the overlay's
  click-through is never touched.
  - Dragging uses a grip with `data-tauri-drag-region`. The `dock` capability grants only
    `core:window:allow-start-dragging`.
  - Rust saves the position about 0.6 s after the dock stops moving.
- **Placement** (`dock.rs`, unit-tested): the saved top-left in logical points is clamped into the
  usable area of the display that contains it. If that display is gone, it goes to the primary
  display; with no saved position, it goes to the bottom centre. A guard re-checks every 2 s, so
  unplugging or resizing a display pulls it back on screen.
- **Size:** the frontend computes the layout and asks Rust to resize the window (`set_dock_size`,
  clamped to 48–1600 × 36–480 px).
  - Everything fits in one row on a normal screen.
  - On narrow screens the action buttons move under the slots, and then the slots wrap.
  - *Compact* uses smaller slots and two-letter weapon labels instead of the name line.
- **Actions** (`dock/model.ts`, unit-tested) all use existing validated paths:
  - Weapons: `patch_prefs` with the inventory and selected slot. A weapon on the hotbar is
    selected; one in the backpack is swapped into the selected slot. Unknown or stale ids send
    nothing.
  - Boss: `combat_command("toggleBoss")`, a new allowlisted action. The overlay decides between
    summoning and dismissing, and broadcasts boss state so the button can highlight.
  - Stay-Put and cursor mode: `patch_prefs`.
  - Inventory: `show_inventory`.
- **Prefs** (`dock` in `prefs.json`):
  - `visible`, `expanded`, `layout` (`full`/`compact`) and `position`.
  - `onLaunch`: `remember`, `show` or `hide`.
  - A malformed dock section resets only the dock settings.

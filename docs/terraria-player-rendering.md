# Terraria player rendering: measured mapping and status

How the companion draws the player from the real Terraria sheets in your local install, what was
measured, what was inferred, and what is not done yet. The code lives in
`desktop/src-tauri/src/terraria/player.rs`, with tests in the same file.

**How the mapping was measured**
- Measurements come from Terraria **1.4.5.8** (Steam build 24893155).
- `cargo run --example terraria_sheets -- <dir>` prints the opaque bounds of every 40×56 cell and
  frame.
- `cargo run --example terraria_layer_stats -- <names>` compares the brightness of layers.
- `cargo run --example terraria_player_preview -- <dir>` writes the composed atlas so it can be
  inspected.
- All three tools read the game files in place and write only to the folder you give them. No
  game art is stored in this repository.

## Confidence levels

| Level | Meaning |
| --- | --- |
| **Measured** | Read from pixel bounds or the file list |
| **Visual** | Identified by inspecting decoded previews at 4× |
| **Inferred** | Chosen by reasoning from the sheets; not compared against the game's own renderer |

## Sheet geometry (Measured)

| Sheet | Size | Structure |
| --- | --- | --- |
| `Player_<v>_0/1/2` (head, eye whites, eyes) | 40×1118 | 20 frames, 56 px apart. The last frame is 54 px tall. |
| `Player_<v>_10/11/12` (leg skin, pants, shoes) | 40×1120 | 20 frames |
| `Armor_Head_<n>`, `Armor_Legs_<n>` | 40×1120 | 20 frames, the same layout as head and legs |
| `Player_Hair_<n>`, `Player_HairAlt_<n>` | 40×784 | 14 frames |
| `Player_<v>_3..9,13`, `Armor/Armor_<n>` | 360×224 | 9 × 4 grid of 40×56 cells |

All cells share one coordinate frame, so pieces are combined by overlaying cells at the same
origin. No per-piece offsets are needed, except the walk bob below.

## Frames and offsets

| Fact | Source | Level |
| --- | --- | --- |
| Strip frames: 0 standing, 1–4 item use, 5 jump, 6–19 walk | Leg and head bounds plus previews | Measured + Visual |
| Walk bob: on frames 7–9 and 14–16 the head, eyes and helmet sit 2 px higher. Legs lift on 7–9 and 14–15. | Bounds | Measured |
| The torso and arms follow the head bob. The renderer *measures* the offset from the head strip at runtime instead of hard-coding it. | Code | Measured |
| Hair strip = walk cycle only: hair frame = strip frame − 6 when ≥ 6, else 0. Hair lifts on its frames 1–3 and 8–10, which matches head frames 7–9 and 14–16. | Bounds | Measured |
| Body box: 20×42 at (10, 12) in the cell. The head starts at y 12 and the feet end at y 53. | Bounds | Measured |

## Composite grid cells

| Cell(s) | Contents | Used for | Level |
| --- | --- | --- | --- |
| (0,0) | Male torso (skin and shirt) | Torso for variants 0–3, 8 and 10 | Measured |
| (0,2) | Female torso (`Player_4_3` has its torso only here) | Torso for variants 4–7, 9 and 11 | Measured |
| (2,0) | Arm hanging at rest (sleeve and hand) | Front arm when idle; back arm in non-walk poses | Visual |
| (3,0) (4,0) (5,0) (6,0) | Arm straight up, diagonal up-forward, horizontal forward, diagonal down | Item-use stages `use1`–`use4`; `shoot` = (5,0), `cast` = (4,0) | Visual (matches the four classic use frames) |
| (2,1) | Arm raised overhead | `jump` and `fall` | Visual |
| (4,1) (3,1) (5,1) (6,1) | The same bent-elbow arm with the hand moving 2 px at a time, ordered back to front (hand x 8, 10, 12, 14) | Walk arm swing | Visual (cells) + **Inferred** (timing) |
| (7,0–3), (8,0–3) | Front and back straight arms, each row 2 px shorter | **Not used.** Most likely the variable-length "stretch" arms the game rotates for custom item use. | Inferred |
| (1,0) | Torso nearly identical to (0,0) (one-pixel difference) | Not used | Measured |
| Rows 2–3, columns 2–6 | Small forearm and hand fragments on the front side, probably drawn over held items | Not used | Inferred |
| (0,3), (1,2) | Shirt-only pieces (back shoulder; female torso shirt) | (1,2) not used; (0,2) is used | Measured |

### Walk arm timing (Inferred)
- **Shape of the swing:** the front arm follows a sine wave over the 14-frame stride. Its forward
  extreme is at walk step 2.5 (strip frames 8–9) and its back extreme at step 9.5 (frames 15–16),
  timed to the widest leg frames (8–9 and 14–15, measured).
- **Back arm:** uses the opposite phase.
- **Status:** this is a reasoned choice and has *not* been checked against the game drawing the
  same frame.

## Layers and colors

The draw order, back to front, is:
1. Back arm
2. Leg skin, then pants and shoes (or leg armor)
3. Torso skin, then undershirt and shirt (or body armor)
4. Head, eye whites, eyes
5. Hair (or nothing, or `HairAlt`, under a helmet)
6. Helmet
7. Front arm: arm skin, then sleeve (layer 8), shirt sleeve (13) and hand (9) — or body-armor arm

| Layer | Color |
| --- | --- |
| 0, 3, 7, 9, 10 | Skin |
| 1 | Unchanged (white) |
| 2 | Eyes |
| 4, 8 | Undershirt |
| 6, 13 | Shirt |
| 11 | Pants |
| 12 | Shoes |
| Hair | Hair color |
| Armor | Not tinted (pre-colored) |

Tinting multiplies each channel: `out = texel × color / 255`.

Other notes on layers:
- **Duplicate layers.** Layers 4/8 and 5/9 are pixel-identical on variant 0, so they are not
  darker back-arm copies (Measured).
- **Variant fallback.** Only variants 0, 4, 10 and 11 include skin layers. Clothing variants
  inherit their body from 4 (variants 4–7 and 9), 10 (variant 11) or 0 (everything else)
  (Measured from the file list).
- **Unused layers.** Layer 14 (variants 3, 7, 8) and layer 15 are not drawn.

## Alpha

- **Source format:** XNB textures store premultiplied alpha. The decoder converts to straight
  alpha, and fully transparent pixels become `(0,0,0,0)`.
- **Compositing:** layers combine with straight-alpha "over".
- **Check:** the served atlas was checked over a dark background and showed no halos.

## Appearance support

| Option | Status |
| --- | --- |
| Body variant 0–11 | Supported, with the fallback chains above |
| Hair style 1–228 | Supported. A missing number is reported and drawn without hair. |
| Skin, hair, eye, shirt, undershirt, pants and shoe colors | Supported |
| Armor head, body and legs (by sheet id) | Supported. Body armor replaces both sleeves and shirt, leg armor replaces pants and shoes, and helmets hide hair by default. |
| Hair under a helmet: hide / short (`HairAlt`) / full | Supported. This is a manual setting, since there is no per-helmet data. |
| Accessories, wings, dyes, vanity | **Stored only; not drawn yet** |

## Not done or unverified

1. **No ground truth.** No frame has been compared pixel for pixel with the game's own player
   renderer. That would need a tModLoader-side render export, which was deliberately not run.
2. **Walk arm phase** and back-arm cell choices are inferred (see above).
3. **Per-armor rules** (helmets that should show hair, armor that hides arms, female-specific
   armor bodies) aren't modelled.
4. **Unused cells.** The stretch arms (columns 7–8) and the forearm-over-item fragments aren't
   used, so held weapons are drawn over the whole arm.
5. **On-screen placement.** The overlay's position and scale on the desktop were checked with
   unit-tested math and the served atlas, not by capturing the screen (that needs Screen
   Recording permission).

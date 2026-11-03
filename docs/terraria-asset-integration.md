# Terraria asset integration: discovery and loading feasibility

- **Status:** research only. The application's behavior has not changed,
  nothing has been committed, and no game assets have been copied into this
  repository.
- **Date:** 2026-10-15
- **Goal:** render the desktop companion with Terraria's real character,
  equipment, item, monster, projectile, effect and UI art, loaded from your
  local game install.

### Evidence labels

| Label | Meaning |
| --- | --- |
| **[Local]** | Read from the install on this Mac. Every texture claim marked [Local] comes from actually decoding the file with a throwaway probe (see Appendix A). |
| **[Observed]** | Seen in decoded previews |
| **[Hypothesis]** | Not yet verified |

---

## 1. Summary

- **Feasible, and the formats are now known.**
  - All 15,123 image assets are XNA `.xnb` files: `Texture2D`, 32-bit RGBA,
    one mip level. 15,100 of them are LZX-compressed.
  - A small Rust decoder using the MIT/Apache `lzxd` crate decoded every
    sample tried, including items, NPCs, projectiles, player layers, armor,
    UI, buffs, hair and an animated item, into correct images **[Local]**.
- **Load from the install at runtime; never ship or commit the art.** The
  companion should find the Terraria install and decode textures lazily in
  Rust. Converted PNGs go in a per-game-build cache under
  `~/Library/Caches/`, and the WebView reads them through a custom `tasset://`
  URL scheme. Nothing is redistributed. If no install is found, the current
  original art remains the fallback.
- **The player character is built from layers.** It is drawn from separate
  grayscale body layers (skin, eyes, hair, shirt, undershirt, pants, shoes),
  tinted with the character's colors, plus pre-colored armor and accessory
  sheets.
  - The sheets are cleanly structured: 40×56 cells, with 20-frame vertical
    strips for head and legs and a 9×4 grid for torso and arm pieces.
  - Customizing appearance with the real assets is therefore feasible. The
    missing piece is *which composite cell each animation frame uses*. That
    is game logic, not asset data (§5.2).
- **Metadata is the main gap, not pixels.** Frame counts, animation speeds,
  item names and stats, and per-NPC tint colors are not in the image files.
  The recommended source is a small, read-only metadata export from the
  existing tModLoader mod using public API arrays (§4.3).

---

## 2. Local asset locations and version evidence

| Item | Value | Evidence |
| --- | --- | --- |
| Install | `~/Library/Application Support/Steam/steamapps/common/Terraria/Terraria.app` | [Local] |
| Content root | `Terraria.app/Contents/Resources/Content/` (755 MB) | [Local] |
| Game version | **1.4.5.8** | `steamapps/common/Terraria/changelog.txt` begins "Version 1.4.5.8 Changes" [Local] |
| Steam build | `buildid` 24893155 | `steamapps/appmanifest_105600.acf` [Local] |
| Bundle metadata | `CFBundleShortVersionString` "1.0", which is not the game version. Use the changelog and build id instead. | `Info.plist` [Local] |
| Runtime | The Mac build runs `Terraria.exe` under Mono with FNA (`FNA.dll`, `monoconfig`) | [Local] |
| ID ranges on disk | Items up to `Item_6195`, NPCs up to 696, projectiles up to 1135, buffs up to 400, head armor up to 292, leg armor up to 253, body armor up to 261, gore up to 1406 | [Local]. These exceed tModLoader 1.4.4.9's ranges, so these are the **1.4.5** assets. |
| tModLoader content | `steamapps/common/tModLoader/Content/` holds only 601 tModLoader-specific XNBs (9 MB). tModLoader reads vanilla art from the Terraria install. | [Local] |

**Version policy.**
- Key the cache by the Steam `buildid`, and re-index when it changes.
- Asset IDs are stable across Terraria updates (new content is appended),
  but art can be retouched, so never hard-code pixel offsets that weren't
  measured on the installed build.
- **Other Steam libraries:** if a user's Terraria lives in another Steam
  library, find it from `steamapps/libraryfolders.vdf`, with a manual path
  setting as the fallback.

---

## 3. Asset categories and formats

### 3.1 Content inventory [Local]

| Folder | Files | Size | Contents |
| --- | --- | --- | --- |
| `Images/` (top level) | ~13,900 | 77 MB total for `Images/` | Sprites named `<Kind>_<id>.xnb` |
| `Images/Armor/` | 203 | | Composite body armor sheets (`Armor_<id>`) |
| `Images/Accessories/` | 50 | | Composite accessory sheets (`Acc_HandsOn_*`, `Acc_HandsOff_*`, …) |
| `Images/UI/` | many, with subfolders | | Interface art: `Bestiary`, `CharCreation`, `Creative`, `Minimap/*`, `PlayerResourceSets/*` (health and mana bar styles), `WorldGen`, `Workshop` |
| `Images/Misc/`, `Backgrounds/`, `TownNPCs/`, `SplashScreens/` | | | Sky effects, backgrounds, town NPC variants and portraits |
| `Fonts/` | 5 | 26 MB | SpriteFonts: `Combat_Text`, `Combat_Crit` (the damage-number fonts), `Mouse_Text`, `Item_Stack`, `Death_Text` |
| `Sounds/` | 863 | 179 MB | Per-file `SoundEffect` XNBs |
| `Wave Bank.xwb`, `Sound Bank.xsb`, `TerrariaMusic.xgs` | 3 | | XACT banks (music) |
| `*Shader.xnb` | 3 | | Compiled effects (not usable in a WebView) |

Top-level image kinds by count: Item 6134, Gore 1404, Projectile 1136,
Tiles 762, NPC 697, Buff 401, Glow 384, Wall 366, Background 344, Extra
316, Armor_Head 292, Armor_Legs 253, Player_Hair and Player_HairAlt 228
each, Player 89, NPC_Head 81, Wings 51, Acc_Back 41, NPC_Head_Boss 40,
ItemFlame 32, Acc_Shoes 30, Inventory_Back 25, Acc_Face 23,
Acc_HandsOn 21, Acc_Balloon 19, Acc_Waist 17, Acc_Front 17, Acc_Neck 14,
Acc_HandsOff 13, Acc_Shield 12, BackPack 9, Clothes 6, Acc_Beard 4, and
others.

### 3.2 XNB container format [Local]

| Field | Observed value |
| --- | --- |
| Magic | `XNB` |
| Platform byte | `w` (Windows) for **all** 15,123 images, even in the Mac build |
| Version | 5 (XNA 4.0) |
| Flags | `0x81` (HiDef plus **LZX-compressed**) on 15,100 images; `0x01` (uncompressed) on 23. Fonts use `0x80`; sounds use `0x01`. |
| Compressed body | LZX with a 64 KB window, split into XNA framing (`0xFF` frame and block size headers or 2-byte block sizes). Decompressed with `lzxd` (`WindowSize::KB64`). |
| Payload | Type-reader table, then one `Texture2D`: surface format **0** (Color, RGBA8), width, height, mip count **1**, data size, then the pixels |
| Alpha | **Premultiplied.** In `UI/Bestiary/Icon_Tags_Shadow` (4,650 semi-transparent pixels), no channel ever exceeds alpha. Most sprites are pure 0/255 alpha, so it rarely matters, but effects and UI must be un-premultiplied before use in canvas `ImageData`, or drawn with premultiplied blending in WebGL. |

---

## 4. Sprite sheet organization

### 4.1 Measured examples [Local] [Observed]

Item, NPC and projectile names below follow the public Terraria Wiki ID
lists. Confirm them with the metadata export (§4.3) before relying on them.

| Asset | Size | Organization |
| --- | --- | --- |
| `Item_4` (Iron Broadsword) | 36×36 | Single icon. It is also the held, swung sprite: the game draws the item texture rotated around the hand. |
| `Item_39` (Wooden Bow) / `Item_96` (Musket) / `Item_165` (Water Bolt) / `Item_1309` (Slime Staff) | 16×32 / 56×18 / 28×32 / 26×34 | Single icons, drawn in hand during use |
| `Item_75` (Fallen Star) | 22×208 | Animated item: vertical frames. The frame count isn't in the file (§4.3). |
| `NPC_1` (Blue Slime) | 32×52 | 2 vertical frames of 32×26, **grayscale and tinted per NPC type** at draw time |
| `NPC_488` (Target Dummy) | 32×550 | Vertical frames with 2 px separator rows (visible as magenta rows) |
| `NPC_4` (Eye of Cthulhu) / `NPC_50` (King Slime) | 110×996 / 174×720 | Vertical boss frames |
| `Projectile_1` (Wooden Arrow) / `Projectile_14` (Bullet) | 14×32 / 2×20 | Single frame, drawn rotated to the velocity |
| `Projectile_335` | 22×120 | Animated: vertical frames |
| `Buff_24` | 32×32 | Buff icon |
| `Inventory_Back` | 52×52 | Inventory slot background (25 variants: hotbar, selected, favorite and others) |
| `UI/Cursor_0` | 14×14 | Mouse cursor |

General rules:
- Multi-frame sprites stack frames **vertically**.
- Frame height = (texture height ÷ frame count) − separator, where the
  separator is usually 2 px.
- Horizontal grids are used only by the player and armor composite sheets.

### 4.2 Player sheets [Local] [Observed]

Every player cell is **40×56** px. The visible character is about 20×42,
and the rest is room for limbs and items.

| Layer file | Size | Layout | Colouring |
| --- | --- | --- | --- |
| `Player_<v>_0` head, `_1` eye whites, `_2` eyes | 40×1118 | 20-frame vertical strip | Grayscale. Tinted with skin, white and eye color. |
| `Player_<v>_10` leg skin, `_11` pants, `_12` shoes | 40×1120 | 20-frame vertical strip | Grayscale. Tinted with skin, pants and shoe color. |
| `Player_<v>_3` torso skin, `_4` undershirt, `_5` hands, `_6` shirt, `_7` arm skin, `_8` arm undershirt, `_9` arm hand, `_13` arm shirt | 360×224 | **9×4 composite grid** of 40×56 cells. The first two columns hold torso front and back variants; the remaining columns hold arm, hand and shoulder pieces for every arm angle. | Grayscale, tinted |
| `Player_<v>_15` | 40×168 | 3 cells (an extra or variant layer) | |
| `Player_Hair_<n>` / `Player_HairAlt_<n>` | 40×784 | 14 cells. `HairAlt` is used under hats. | Grayscale, tinted with hair color |
| `Armor_Head_<n>`, `Armor_Legs_<n>` | 40×1120 | 20-frame strips, matching head and legs | **Pre-colored** |
| `Armor/Armor_<n>` (body armor) | 360×224 | Same 9×4 composite grid as the body layers | Pre-colored |
| `Accessories/Acc_*`, `Wings_<n>`, `Acc_Back_*`, … | various | Composite or strip sheets per slot | Pre-colored (dyes recolor them in game) |

- **Skin variants:** `<v>` is the body variant. The files present are 0–11,
  but not every variant has every layer, and missing layers fall back to
  variant 0 **[Observed]** from the file list.
- **Strip frames [Observed]:** in the 20-frame head and leg strips, frame 0
  is standing, 1–4 are item-use poses, 5 is jumping and 6–19 are the walk
  cycle (the head bobs on some walk frames).
- **[Hypothesis] Walk timing:** the in-game walk cycle advances with
  horizontal speed rather than at a fixed rate (Terraria Wiki), stepping
  through frames 6–19. The companion can use its own timing for this.

### 4.3 What the images don't contain, and where to get it

| Needed | Not in the images | Recommended source |
| --- | --- | --- |
| Frame counts and animation speeds (NPCs, projectiles, animated items) | Yes | Export from tModLoader's public arrays: `Main.npcFrameCount`, `Main.projFrames`, `Main.itemAnimations` |
| Display names (items, NPCs, buffs) | Yes. They live in localization data inside the game assembly. | Export `Lang.GetItemNameValue`, `Lang.GetNPCNameValue`, … from the mod |
| Item stats (damage, use time, use style, shoot projectile, mana, rarity) | Yes | Export from `ContentSamples.ItemsByType` |
| NPC tint colors (slimes and others) and sizes | Yes | Export from `ContentSamples.NpcsByNetId` (`color`, `width`, `height`) |
| Hitbox sizes | Yes | Same export |
| Which composite cell each player frame uses, and the head-bob offsets | Yes. This is engine logic. | §5.2 options |

The existing `terraria-mod/CompanionArsenal` mod can add a client-only
**metadata exporter**. It would write `companion-metadata.json` (IDs,
names, frame counts, stats, colors) using public tModLoader API reads only.

- **Run it** once per game update, with the same request-file mechanism as
  the in-game test harness.
- **What it contains:** game facts, not code or art.
- **Version caveat:** tModLoader runs 1.4.4.9 data while the art on disk is
  1.4.5.8. IDs that exist in both match. Newer 1.4.5 IDs would have art but
  no exported metadata until tModLoader's 1.4.5 version ships.

---

## 5. Rendering the real assets in the companion

### 5.1 Static sprites: items, weapons, projectiles, monsters, buffs, UI

Each of these is just a decoded texture plus a frame rectangle.

| Feature | Real asset | How to draw it |
| --- | --- | --- |
| Weapons in hand | `Item_<id>` | Rotate around the grip during swings (as the game does), or hold at the aim angle for bows, guns and staffs. Size comes from the texture, so the current 16×16 weapon art goes away. |
| Inventory icons | `Item_<id>` + `Inventory_Back*` slot frames | The inventory window draws real slots and icons. Stack counts could use the `Item_Stack` font. |
| Projectiles | `Projectile_<id>` | Rotated to velocity. Frames are cycled using `projFrames` from the export. |
| Training targets | `NPC_488` (Target Dummy) or any `NPC_<id>` | Slice vertical frames. Tint grayscale NPCs with the exported color. |
| Summon minions | The summon's projectile sprite (for example a minion projectile ID from the export) | Frames from `projFrames` |
| Damage numbers | `Combat_Text` / `Combat_Crit` SpriteFonts | Decode the SpriteFont (glyph texture, rects, kerning) and draw glyphs. CSS text remains the fallback. |
| Buffs and mana UI | `Buff_<id>`, `UI/PlayerResourceSets/*` | Small icons and bars over the character |
| Effects | `Extra_*`, `Glow_*`, `Gore_*`, dust sheets in `Images/` | Slashes, glows and death gore. Choose case by case; some rely on shaders that can't be reproduced, so approximate those with additive canvas blending. |

### 5.2 The player character (appearance customization)

The real assets do support customization. Hair style, the four body
colors, eye color, skin variant, and armor head, body and legs are all
separate sheets.

To draw one frame, take for each layer in back-to-front order:
- the correct cell (a strip index for head and legs, or a grid cell for
  torso, arms, hands and shoulders);
- an offset (head bob);
- for grayscale layers, a tint.

Two options for the frame-to-cell mapping:

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| **A. Assemble in the companion** (recommended first) | Author our own small data table mapping each companion animation state (idle, walk 6–19, jump, fall, swing poses) to strip indices, composite cells and offsets. Build it by *measuring the decoded sheets* (layout facts, not copied code). Tint grayscale layers per pixel into a cached offscreen canvas. | Works without launching the game. Supports in-companion customization (colors, hair, armor IDs). Fast. | Needs careful authoring and visual checks. Complex gear (wings, capes, layered accessories, dyes) is approximate at first. |
| **B. Export from tModLoader** (later, "import my character") | The mod draws the chosen character with the game's own player renderer into an offscreen target for each needed frame, and writes a PNG atlas to the companion's cache on this Mac | Pixel-exact, including dyes, accessories, wings and vanity | Requires a tModLoader run whenever the outfit changes. Tied to tModLoader 1.4.4 behavior. Generated locally only. |

**[Hypothesis]** Equipment drawing rules (hair hidden or switched to
`HairAlt` under some helmets, armor that hides arms, female body variants)
will need per-ID flags. Option B gets them for free; option A needs a small
rules table, which the metadata export can partly supply (for example
equip-slot flags from `ArmorIDs.*` sets).

### 5.3 Scale

- **Size:** Terraria art is 1 texel = 1 screen pixel at zoom 1, with
  40×56-cell, about 20×42-visible characters. The current companion draws a
  16×24 sprite at 3× (48×72 CSS px). The real character at **2×**
  (about 40×84 visible) is about the same height.
- **Hitbox:** derive the body and hitbox size from the measured visible
  bounds, not the 40×56 cell. Physics constants (walk speed, jump) stay in
  CSS px and need only small retuning.

---

## 6. Recommended loading and caching architecture

```
Terraria.app/Contents/Resources/Content/**.xnb          (read-only, never modified)
        │  locate (default Steam path → libraryfolders.vdf → user setting)
        ▼
Rust  src-tauri/src/terraria_assets/
        ├─ locate.rs     install discovery + version (changelog header, appmanifest buildid)
        ├─ xnb.rs        XNB header, LZX (lzxd), Texture2D (+ later SpriteFont, SoundEffect)
        ├─ cache.rs      ~/Library/Caches/com.terrariacompanion.desktop/terraria/<buildid>/<path>.png
        │                (un-premultiplied RGBA → PNG, written on first request; LRU size cap)
        ├─ index.rs      header-only scan → manifest.json {path, w, h} (fast; no decompression)
        └─ protocol      Tauri async URI scheme  tasset://images/Item_4  →  PNG bytes
                         · allowlist: Images/**, Fonts/** only; reject "..", absolute paths, non-.xnb
                         · decode on a worker thread; never block the main thread
        ▼
WebView TS  src/assets/
        ├─ assetStore.ts   fetch("tasset://…") → createImageBitmap; in-memory map; fallback to original art
        ├─ sheet.ts        SpriteSheet {image, frames: Rect[]}; vertical-strip & grid slicers; separator rows
        ├─ metadata.ts     companion-metadata.json from the mod (optional; graceful when absent)
        └─ playerRig.ts    layered compositor (§5.2A) → cached ImageBitmap per (frame, facing, look)
```

Design points:
- **Lazy and cached.** First use decodes in about a millisecond for small
  sprites [Hypothesis, to measure]. Later loads read the PNG cache, then
  memory. Re-index only when `buildid` changes. Don't decode or cache
  entire categories up front.
- **Never redistributed.**
  - The cache lives in `~/Library/Caches`, outside the repo.
  - Add a `.gitignore` guard and a test that fails if `.xnb`, or PNGs
    derived from it, appear under `desktop/`.
  - Never bundle decoded assets into `tauri build` output.
- **Security.**
  - The URI handler serves only allowlisted relative paths inside the
    detected Content root, read-only.
  - The XNB parser bounds-checks every length field, and rejects oversized
    dimensions (for example over 8192 px) and unknown readers.
  - The parser is fuzz-tested with truncated files.
- **CSP.** The app currently runs with `csp: null`. When this lands, set a
  CSP that allows `img-src 'self' tasset: data:` and
  `connect-src 'self' tasset:`.
- **Graceful fallback.** With no install, or a decode failure, the current
  original sprites keep working. A status line in the tray or inventory
  shows "Using Terraria assets (1.4.5.8)" or "Using built-in art".

---

## 7. Changes the current renderer needs

| Current (Milestones 1–3) | Change |
| --- | --- |
| `engine/sprites.ts`: 16×24 palette-string frames rendered to canvases (`renderFrame`) | Becomes a fallback. Add `playerRig.ts`, which composites real layers per animation frame into cached bitmaps. `FRAMES`/`Anim` names stay, mapped to rig states. |
| `overlay/companion.ts`: one small canvas sized `SPRITE_W/H × scale`, translated each frame | Canvas sized to the 40×56 cell × scale. The body and hitbox come from measured visible bounds. Drawing is unchanged (cached bitmap blit). |
| `combat/weaponArt.ts` + `render.ts` `paintWeapon`: original 16×16 shapes with palettes | Replace with `Item_<id>` textures, plus per-item grip offsets (texture corner for swords, center for bows and guns). Weapon definitions gain `itemId` and `projectileId`. |
| `combat/sandboxArt.ts`: original dummy and minion art | `NPC_488` frames for dummies, minion projectile sheets for summons |
| `combat/render.ts` procedural arrows, bullets, bolts and effects | Projectile sprites rotated to velocity. Keep procedural glows only where the game uses shaders. |
| Damage numbers via canvas text | SpriteFont glyph rendering (`Combat_Text`/`Combat_Crit`), with text as the fallback |
| `inventory/Inventory.tsx`: icons from `paintWeapon().toDataURL()` | `<img src="tasset://images/Item_N">` or bitmaps, plus `Inventory_Back*` slot frames. Names and tooltips from metadata. |
| `combat/weapons.ts` data | Add `itemId`, and optionally `projectileId` / `npcId`, per weapon. Stats can come from the metadata export to match the game. |
| Rust: no asset code | New `terraria_assets` module plus the URI scheme. New dependencies: `lzxd` (MIT/Apache) and `png` (MIT/Apache). |
| Tests | Rust: XNB parsing against synthetic fixtures we generate ourselves (no game files in the repo), plus bounds and fuzz cases. TS: slicer and rig math with tiny synthetic bitmaps. An optional local-only integration test runs only when an install is detected. |

Suggested order:
1. Rust decoder, cache and URI scheme.
2. Item icons in the inventory.
3. Held weapons and projectiles.
4. Dummies and monsters.
5. The player rig with color customization.
6. Fonts.
7. The tModLoader metadata export, followed by character import.

---

## 8. Licensing and usage notes

- **Ownership.** Terraria's art, fonts and sounds are Re-Logic's copyrighted
  assets (see the DMCA evidence in `terraria-mod-compatibility-audit.md`).
  This plan only **reads them at runtime from your own licensed install**,
  for personal use. They are never copied into the repo, committed,
  bundled, uploaded or shared.
- **Precedent.** This is the same pattern community tools use. TEdit, the
  community world editor, reads textures from the user's install
  **[Hypothesis]** (from general knowledge; not checked during this
  research).
- **Publishing.** Before distributing the companion to anyone else, review
  Terraria's EULA and Re-Logic's guidance on fan tools. Builds must never
  embed decoded art.
- **No reverse engineering.** Nothing here requires decompiling game code.
  The formats are standard XNA containers, and the metadata comes from
  tModLoader's public API.

---

## 9. Open questions

1. **Player frame mapping:** which composite cells, at which offsets, for
   each animation state. This decides option A's effort (§5.2).
2. **Equipment rules:** hair and helmet interaction, arm-hiding armor, and
   female body sheets per armor ID.
3. **Which vanilla items, projectiles and NPCs** should stand in for the
   ten companion weapons and the minions. This is a design choice; the
   metadata export would make the stats match the real game.
4. **Decode cost:** cold-start decode time for many sprites at once
   (measure with the real cache).
5. **1.4.5 versus tModLoader 1.4.4 metadata:** acceptable until tModLoader's
   1.4.5 version is stable?
6. **SpriteFont and sound support** (fonts for damage numbers; sounds are a
   separate feature).

---

## Appendix A: how this was verified

- **Read-only access:** `ls`, `find`, `stat`, `xxd` and Python reads of
  headers under `Terraria.app/Contents/Resources/Content`. Nothing was
  launched or modified.
- **Header survey:** all 15,123 image headers were read (platform byte and
  flags).
- **Decoder probe:** a throwaway Rust probe (`lzxd` + `png`) in the session's
  temporary folder, *not* in this repo. It decoded 30+ samples (items,
  NPCs, projectiles, buffs, UI, all player layers 0–15, hair, armor head,
  legs and body) and reported dimensions, surface format, mip count and
  alpha statistics.
- **Visual checks:** PNG previews were viewed at 2–3× to identify strip and
  grid layouts and the grayscale-versus-pre-colored layers. All previews
  and the probe stay in the temporary folder and were deleted after this
  research.
- **Repository:** no game assets, decoded images or probe code were added.

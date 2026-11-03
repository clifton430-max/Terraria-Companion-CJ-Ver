# Terraria mod compatibility audit (Milestone 4)

- **Status:** audit only. No mod has been created, built or tested, and no
  in-game weapon exists yet.
- **Date:** 2026-10-15
- **Scope:** decide how to turn the desktop companion's five weapon
  archetypes into real in-game weapons, and how the companion and the game
  could later share data.

### Evidence labels

Every finding below carries one of these labels:

| Label | Meaning |
| --- | --- |
| **[Source]** | Read in the decompiled repository (commit `7a0caff`) |
| **[Docs]** | Official tModLoader or Steam material, or tModLoader's ExampleMod (MIT) |
| **[Local]** | Read-only metadata from this Mac |
| **[Hypothesis]** | Not yet verified |

---

## 1. Executive summary and recommended architecture

**Recommendation: GO, but only through tModLoader's public API. NO-GO for
any work based on the decompiled source.**

- **Build on tModLoader.** Implement in-game weapons as a small tModLoader
  mod on the **1.4.4 stable branch**. It is already installed on this Mac
  as `1.4.4.9+2026.08.3.0` **[Local]**.
- **Use only the public API.** Write the mod against tModLoader's public
  API (`ModItem`, `ModProjectile`, `ModBuff`, `ModPlayer`, `DamageClass`),
  using the MIT-licensed ExampleMod as the pattern reference.
- **Treat the decompiled repository as reading material only.** It is
  useful for understanding vanilla mechanics. It must never be copied,
  built, redistributed or used as a dependency.

Three findings drive this recommendation:

1. **The decompiled code is proprietary, and Re-Logic enforces that.**
   - The referenced repository (`AliceSavard/Terarria1405`) is a JetBrains
     dotPeek decompilation of the Steam `Terraria.exe`. It has **no
     license** **[Source]**.
   - On 2020-06-02, Re-Logic filed a DMCA notice against a near-identical
     decompiled 1.4.0.3 repository. The notice says Terraria "is not in any
     way an open source project" and "This is a decompiled repository of
     our proprietary source code. It must be removed."
     ([github/dmca notice](https://github.com/github/dmca/blob/master/2020/06/2020-06-02-Terraria.md))
2. **The decompiled code is the wrong version.**
   - The decompilation is Terraria **1.4.0.5** (2020) **[Source]**.
   - tModLoader stable is built on Terraria **1.4.4.9** **[Local]** **[Docs]**.
   - The installed vanilla game is **1.4.5.8** **[Local]**.
   - The modding APIs differ in ways that matter. For example, 1.4.0.5 marks
     damage type with boolean `melee`/`ranged`/`magic`/`summon` fields,
     while tModLoader 1.4.4 uses `Item.DamageType = DamageClass.*` and
     `NPC.HitInfo` **[Source]** **[Docs]**.
3. **tModLoader already covers every proof-of-concept need with supported
   hooks**, including working examples for swords, guns, magic weapons,
   staffs, minions, sentries and whips **[Docs]**.

### Recommended architecture

```
┌───────────────────────────┐   (future, one-way, versioned JSON;    ┌──────────────────────────┐
│ tModLoader mod (C#)       │    not built in this milestone)        │ Desktop companion        │
│  • ModItem / ModProjectile│ ─────────────────────────────────────▶ │  (Tauri: Rust + TS)      │
│  • ModBuff (minion upkeep)│   state file in the mod's own folder,  │  • Rust validates input  │
│  • ModPlayer (telemetry)  │   or a 127.0.0.1 socket with a token   │  • TS sim stays local    │
└────────────▲──────────────┘                                        └────────────▲─────────────┘
             │ both consume                                                       │
             └───────────── shared/weapons/*.json  (weapon spec v1, Terraria units) ┘
```

- **Shared data, separate behaviour.** One versioned weapon-spec format
  holds the stats. Each side keeps its own behaviour code: C# against
  tModLoader in game, the existing TypeScript simulation on the desktop.
  Neither side runs the other's code.
- **One-way bridge first.** The game reports state (equipped weapon, hits)
  to the companion. The companion never sends input into the game.

---

## 2. Repository and version identification

### 2.1 Decompiled reference repository

| Item | Finding | Evidence |
| --- | --- | --- |
| Location | `https://github.com/AliceSavard/Terarria1405`, linked from `Terraria 1405/tera.md` in this project. There is **no local copy** in the project. | **[Local]** |
| Commit inspected | `7a0caff0935af766303751579ed209b0cfc619ff` (2025-12-02). The default branch has a single commit. | **[Source]** |
| Self-description | "Terraria 1.4.0.5 decompiled, refactored, modified". The README says "Modifying Terraria 1.4.0.5 from decompiled source code made with JetBrains dotPeek". | **[Source]** |
| Version | `AssemblyInfo.cs`: `AssemblyVersion`/`AssemblyFileVersion` 1.4.0.5. `Main.cs`: `versionNumber = "v1.4.0.5"`, `curRelease = 230`. `Terraria1405.csproj`: `ApplicationVersion` 1.4.0.5. | **[Source]** |
| Provenance | The csproj comment reads "Project was exported from assembly: …\Steam\steamapps\common\Terraria\Terraria.exe". The assembly attributes give company "Re-Logic", copyright "© 2020 Re-Logic". | **[Source]** |
| Build target | .NET Framework 4.6, XNA 4.0, `WinExe`, x86 (Debug). It references the proprietary `Terraria.exe`, ReLogic, Steamworks and RailSDK libraries, which are excluded from the repo. Windows-only. | **[Source]** |
| License | None (GitHub reports no license). The README itself says the repo cannot be used to recreate a working game, and its setup steps require a purchased Steam copy. | **[Source]** |
| Modified? | Yes. The author describes it as "refactored, modified", so it is **not** a faithful copy of the shipped binary. The line numbers below apply to this commit only. | **[Source]** |
| Size | About 223 MB, including a 15 MB `.pdb`. Core files are large: `Item.cs` about 45.7k lines, `Player.cs` about 37.3k, `Projectile.cs` about 29.9k, `NPC.cs` about 51k. | **[Source]** |

### 2.2 What is installed on this Mac (read-only metadata)

| Component | Version | Evidence |
| --- | --- | --- |
| Terraria (vanilla, Steam app 105600) | **1.4.5.8**, build id 24893155 | `steamapps/common/Terraria/changelog.txt` header and `appmanifest_105600.acf` **[Local]** |
| tModLoader (Steam app 1281930) | **1.4.4.9+2026.08.3.0, stable branch**, build id 25640906 | Startup line of `tModLoader-Logs/client.log`, last run 2026-10-14 **[Local]** |
| tModLoader runtime | `net8.0`, bundled `dotnet/` folder; graphics through FNA | `tModLoader.runtimeconfig.json` and the log **[Local]** |
| tModLoader saves | `~/Library/Application Support/Terraria/tModLoader` (no `ModSources/` yet) | Log and directory listing **[Local]** |
| .NET SDK | **Not installed** (`dotnet` is not on the PATH) | **[Local]** |
| Machine | Apple Silicon (`arm64`), macOS 27.2 | **[Local]** |

### 2.3 Upstream status

- **tModLoader releases:** the latest GitHub release is
  `v2026.08.3.0`, "1.4.4-refs/heads/stable" (published 2026-10-01). It
  matches the installed build. **[Docs]**
- **The 1.4.5 port:** a `1.4.5` branch exists and Steam beta updates are
  shipping, but it was not stable as of the October 2026 update. Steam news
  also warns that players and worlds from vanilla 1.4.5 cannot be used on
  current tModLoader. **[Docs]**
  ([April 2026 update](https://steamcommunity.com/games/1281930/announcements/detail/540007781835474837),
  [October 2026 update](https://steamcommunity.com/games/1281930/announcements/detail/719043624313028698))
- **Vanilla 1.4.5:** press coverage reported a 2026-01-27 release. The
  installed 1.4.5.8 confirms that 1.4.5 shipped. **[Local]**

### 2.4 The `rea` link

`rea/reverseeng.md` points to `morluto/rea`, an MIT-licensed set of agent
tools for reverse engineering binaries and apps. **This audit did not use
it.** tModLoader exposes supported APIs, and decompiling or disassembling
Terraria binaries would only increase the licensing exposure in §7.

---

## 3. Relevant source locations (decompiled 1.4.0.5, commit `7a0caff`)

These are descriptions and pointers only. No decompiled code is reproduced
here or anywhere in this project. All line numbers are approximate and tied
to the commit above.

| System | Location | What it does | Label |
| --- | --- | --- | --- |
| Item definitions | `Item.cs`: `SetDefaults1`–`SetDefaults5` (lines ~2485, 14827, 23519, 29980, 38089), dispatched from `SetDefaults` (~44049) | Giant switch statements, split because of their size, that assign each item type its stats | [Source] |
| Item stat fields | `Item.cs` ~68–161 | `damage`, `crit`, `knockBack`, `useTime`, `useAnimation`, `useStyle`, `autoReuse`, `shoot`, `shootSpeed`, `ammo`/`useAmmo`, `mana`, `noMelee`, `channel`, `buffType`, `reuseDelay`, plus damage-class **booleans** `melee`/`ranged`/`magic`/`summon`/`sentry` | [Source] |
| Archetype helpers | `Item.cs` ~43312–43876 | Private helpers `DefaultToWhip`, `DefaultToStaff`, `DefaultToSpear`, `DefaultToBow`, `DefaultToMagicWeapon`, `DefaultToRangedWeapon`, `DefaultToThrownWeapon` | [Source] |
| Prefixes (modifiers) | `Item.Prefix(int)` ~247 | Applies damage, speed, crit, knockback and mana multipliers per prefix | [Source] |
| Item use pipeline | `Player.ItemCheck` (~27674) → `ItemCheckWrapped` (~20090), with parts such as `ItemCheck_CheckCanUse` (~33341), `ItemCheck_StartActualUse` (~33205), `ItemCheck_ApplyUseStyle` (~32698), `ItemCheck_ApplyHoldStyle` (~32390) | Per-frame weapon use: whether the item can be used, its animation timers and its use style | [Source] |
| Use timers | `Player.SetItemTime` / `ApplyItemTime` / `ApplyItemAnimation` (~1771–1806) | Timing in ticks (60 per second) | [Source] |
| Melee hits | `ItemCheck_GetMeleeHitbox` (~29216), `ItemCheck_MeleeHitNPCs` (~28594), `ApplyNPCOnHitEffects` (~28681), `ApplyDamageToNPC` (~13146) | Builds the swing hitbox from the held item's frame and resolves hits on NPCs | [Source] |
| Shooting | `ItemCheck_Shoot(int, Item, int)` (~30497); `Projectile.NewProjectile` (~8585) | Spawns projectiles, including spread and multi-shot cases, ammo-driven projectile changes and minion spawning | [Source] |
| Ammunition | `Player.HasAmmo` (~34179), `Player.PickAmmo` (~34206); `ID/AmmoID.cs` (for example `Arrow` = 40, `Bullet` = 97) | Finds and consumes compatible ammo and adds the ammo's damage and speed | [Source] |
| Damage scaling | `Player.GetWeaponDamage` (~34154), `GetWeaponCrit` (~34145), `GetWeaponKnockback` (~34130); fields `meleeDamage`, `rangedDamage`, `magicDamage`, `minionDamage`, `arrowDamage`, `bulletDamage`, `meleeCrit`/`rangedCrit`/`magicCrit` (default 4) | Multiplies base damage by the class multiplier (plus arrow, bullet or rocket multipliers for ranged weapons). Crit chance comes from the class. | [Source] |
| Damage roll | `Main.DamageVar` (~49517) | Random ±15% variance, with an optional luck re-roll | [Source] |
| Defence | `Main.CalculateDamageNPCsTake` (~49538) | Damage minus half the defence, with a minimum of 1 | [Source] |
| Applying a hit | `NPC.StrikeNPC` (~46808) | Applies defence, doubles crits, applies `takenDamageMultiplier` and shows `CombatText` | [Source] |
| Crit rolls | `ItemCheck_MeleeHitNPCs` region (~28616); `Projectile.Damage` (~9420, crit checks ~9658) | A 1–100 roll compared against class crit | [Source] |
| Damage numbers | `CombatText.NewText` (`CombatText.cs` ~37) | Floating numbers, with separate colours for crits | [Source] |
| Mana | `Player.CheckMana` (~36611), `ItemCheck_PayMana` (~33669), `ItemCheck_ApplyManaRegenDelay` (~32643), `UpdateManaRegen` (~12414); fields `statMana`, `statManaMax2`, `manaCost`, `manaRegenDelay` | Cost is scaled by `manaCost`, with an automatic mana-potion fallback (mana flower) and a regeneration delay | [Source] |
| Buffs | `Player.AddBuff` (~2195), `DelBuff` (~2312), `UpdateBuffs` (~5814); `ID/BuffID.cs` (for example `BabySlime` = 64, `ManaSickness` = 94) | Buff timers and effects | [Source] |
| Summon upkeep | `Player.UpdateBuffs` (~6286 onward) | Each minion buff stays active only while the player owns at least one matching minion projectile (`ownedProjectileCounts`), and is removed otherwise | [Source] |
| Minion slots | Player fields `maxMinions` (default 1), `numMinions`, `slotsMinions`; `FreeUpPetsAndMinions` (~33228) | Minions are limited by **slots**, and the oldest is removed when over the limit. They cost no mana upkeep. | [Source] |
| Minion targeting | `Player.UpdateMinionTarget` (~36855), `MinionNPCTargetAim` (~36779), `MinionAttackTargetNPC`; `Projectile.Minion_FindTargetInRange` (~19026) | Targeting via the right-click target or the nearest valid NPC | [Source] |
| Minion flags | `ProjectileID.Sets.MinionTargettingFeature`, `MinionSacrificable` (`ID/ProjectileID.cs` ~987) | Opt-in behaviour flags | [Source] |
| Projectiles | `Projectile.SetDefaults` (~208), `AI()` (~14477) with `AI_xxx` routines (for example `AI_001` arrows and bullets, `AI_026`/`AI_062` minions, `AI_009_MagicMissiles`, `AI_165_Whip`); fields `aiStyle`, `penetrate`, `minion`, `minionSlots`, `localNPCHitCooldown`, `extraUpdates`, `tileCollide` | A behaviour routine is chosen by `aiStyle`. `penetrate` is the pierce count. | [Source] |

### 3.1 How this compares with the companion's simulation

The desktop simulation (`desktop/src/combat/`) was written independently.
It happens to match the vanilla basics: ±15% variance, damage minus half the
defence with a minimum of 1, and double damage on crits **[Source]**. It
differs in these ways:

| Concept | Desktop (Milestone 3) | Vanilla / tModLoader | Effect on a shared model |
| --- | --- | --- | --- |
| Time | Seconds | Ticks, 60 per second | Store ticks and convert on the desktop |
| Speed and distance | CSS px per second; sprite pixels | World px per tick; tiles (16 px) | Store Terraria units |
| Crit | Absolute per weapon (0.04 includes the base) | Weapon crit **added to** class crit (base 4) | `item.crit = round(desktopCrit × 100) − 4` |
| Damage class | Implied by `kind` | `DamageClass` (tModLoader) or booleans (1.4.0.5) | Add an explicit `damageClass` field |
| Ammo | None | `useAmmo`; ammo adds damage and speed | Add an optional `ammo` field; the desktop may ignore it |
| Bow draw time | Charge phase (`drawTime`) | Vanilla bows fire instantly | A draw phase needs `channel` plus a held projectile. Mark it optional. |
| Staff cast time | `castTime` delay | Vanilla staffs fire on use | Treat as desktop-only, or as a held projectile |
| Homing and pierce | `homing`, `pierce` | Custom AI; `penetrate` = pierce + 1 | Map `pierce` to `penetrate`; homing needs custom AI |
| Summon upkeep | Reserves **mana** | Uses **minion slots** | **Mismatch.** The shared model should use `minionSlots`; mana upkeep stays a desktop rule. |
| Minion cap | 2 | `maxMinions` (base 1, raised by gear) | Desktop-only constant |
| Swing arc | Explicit `arcFrom`/`arcTo` and active window | Hitbox from the item frame and use style | Arcs are desktop-only unless a custom swing projectile is used |

**Conclusion:** the five archetypes map cleanly onto a shared stat model.
That covers damage, use time, knockback, crit, mana, projectile speed,
pierce, damage class and ammo. The behaviour differences (draw and cast
phases, arcs, mana upkeep) should stay in each runtime as optional,
per-side fields.

---

## 4. Official documentation and compatibility

| Topic | Finding | Source |
| --- | --- | --- |
| License | tModLoader is MIT-licensed. ExampleMod is in the same repository. | [Docs] [tModLoader/tModLoader](https://github.com/tModLoader/tModLoader) |
| Ownership requirement | "This community-made mod requires that you own Terraria." Using it requires agreeing to a third-party EULA. | [Docs] [Steam store page](https://store.steampowered.com/app/1281930/tModLoader/) |
| macOS support | "tModLoader will work for Windows, Mac and Linux." 1.4.4 requires macOS 12 Monterey or later, and "tModLoader relies on NET 8 runtime". The page doesn't mention Apple Silicon, but the installed build runs on this arm64 Mac. | [Docs] [Local] |
| Modding prerequisites | Install the **.NET 8.0 SDK**; use an IDE (Visual Studio, VS Code, Rider) or a text editor; put sources in `ModSources`; build with Workshop → Develop Mods → **Build + Reload**. Required files: one `Mod` class, `build.txt`, `description.txt`, `<ModName>.csproj`. | [Docs] [Basic modding guide](https://github.com/tModLoader/tModLoader/wiki/Basic-tModLoader-Modding-Guide), [developer guide](https://github.com/tModLoader/tModLoader/wiki/tModLoader-guide-for-developers) |
| Mac setup page | A "Developing on Mac or Linux" wiki page exists, but its content couldn't be retrieved during the audit. **[Hypothesis]**: VS Code or Rider with the .NET 8 SDK for arm64 works. To verify in Phase 0. | [Docs] |
| Example weapons (1.4.4 branch) | `ExampleSword`, `ExampleCustomSwingSword`, `ExampleShortsword`, `ExampleGun`, `ExampleShotgun`, `ExampleCustomAmmoGun`, `ExampleHeldProjectileWeapon`, `ExampleMagicWeapon`, `ExampleStaff`, `ExampleWhip`, `ExampleSpear`, `ExampleYoyo`, among others | [Docs] [ExampleMod/Content/Items/Weapons](https://github.com/tModLoader/tModLoader/tree/1.4.4/ExampleMod/Content/Items/Weapons) |
| Example summons | `ExampleSimpleMinion` (item, `ModBuff` and `ModProjectile` in one file), `ExampleSentry` | [Docs] [ExampleMod/Content/Projectiles/Minions](https://github.com/tModLoader/tModLoader/tree/1.4.4/ExampleMod/Content/Projectiles/Minions) |
| API surface used by those examples | `ModItem.SetDefaults`; `Item.DamageType = DamageClass.Melee/Ranged/Magic/Summon`; `MeleeEffects`; `OnHitNPC(Player, NPC, NPC.HitInfo, int)`; `ModifyShootStats(...)`; `Shoot(Player, EntitySource_ItemUse_WithAmmo, ...)`; `HoldoutOffset`; `ModifyManaCost`; `Item.useAmmo = AmmoID.Bullet`; `Item.mana`; `Item.buffType` / `Item.shoot`; `ModBuff.Update(Player, ref int)`; `ProjectileID.Sets.MinionTargettingFeature` / `MinionSacrificable`; `Main.projPet`; `Projectile.minionSlots` | [Docs] (read from the ExampleMod files above) |
| Version pinning | Mods build against the installed tModLoader. `build.txt` holds the mod version, and tModLoader records its own version in the built `.tmod`. The installed `tModPorter` tool helps port mods to new versions. | [Docs] [Local] |
| Upcoming break | tModLoader for 1.4.5 is in beta, so expect a port, likely with tModPorter, once it is stable. | [Docs] |

**Compatibility verdict:** target **tModLoader 1.4.4 stable** (the
installed `1.4.4.9+2026.08.x`), C# 12 (`tMLMod.targets` sets
`LangVersion 12.0` **[Local]**) and .NET 8. Do **not** target vanilla
1.4.5.8 directly, and do not target the 1.4.0.5 decompilation.

---

## 5. Proposed mod project structure and prerequisites

*Proposal only. None of this has been created.*

```
mod/CompanionArsenal/                 ← tracked in this repo (source of truth)
  build.txt                           displayName, author, version, side = Client (until a bridge needs otherwise)
  description.txt
  icon.png                            original art
  CompanionArsenal.csproj             imports ..\tModLoader.targets (tModLoader's standard template)
  CompanionArsenal.cs                 the single Mod class
  Common/Specs/WeaponSpec.cs          maps shared/weapons/*.json (embedded resource) to Item fields
  Content/Items/Weapons/EmberBlade.cs + .png        (Phase 1, melee)
  Content/Items/Weapons/PineBow.cs + .png           (Phase 2, ranged)
  Content/Items/Weapons/SparkWand.cs + .png         (Phase 3, magic)
  Content/Projectiles/SparkBolt.cs + .png
  Content/Items/Weapons/WispLantern.cs + .png       (Phase 4, summon)
  Content/Projectiles/WispMinion.cs + .png
  Content/Buffs/WispMinionBuff.cs + .png
  Localization/en-US_Mods.CompanionArsenal.hjson     names and tooltips
  Common/Players/CompanionTelemetryPlayer.cs        (Phase 6, bridge; separate approval)
shared/weapons/*.json                 weapon spec v1, the single source of stats
```

tModLoader builds from
`~/Library/Application Support/Terraria/tModLoader/ModSources/CompanionArsenal`.
Keep the source in this repo and copy or symlink it into `ModSources`.
**[Hypothesis]** A symlink works with Build + Reload on macOS. To verify in
Phase 0.

- **Art:** reuse the companion's original 16×16 weapon art, scaled to
  tModLoader's texture conventions. No vanilla textures.

### Prerequisites

| Prerequisite | State on this Mac | Action |
| --- | --- | --- |
| Terraria, owned and installed | Present (1.4.5.8) | None |
| tModLoader 1.4.4 stable | Present (`1.4.4.9+2026.08.3.0`) | None. Optionally turn off automatic Steam updates during development. |
| .NET 8 SDK (arm64) | **Missing** | **Needs your approval before installing.** Microsoft's installer or Homebrew. |
| IDE | Unknown | VS Code with C# Dev Kit, or JetBrains Rider |
| Test character and world | Not yet created | Create a dedicated tModLoader player and world. Vanilla 1.4.5 saves cannot be used in tModLoader 1.4.4. Back up `~/Library/Application Support/Terraria` first. |
| Git | Present | None |

---

## 6. Phased proof of concept and acceptance tests

Each phase needs your explicit go-ahead, because it installs tools or runs
the game.

| Phase | Deliverable | Acceptance tests |
| --- | --- | --- |
| **0. Environment** | .NET 8 SDK installed; empty mod created with tModLoader's "Create Mod" | Build + Reload succeeds on macOS arm64. The log shows the mod loaded with no errors. The mod can be disabled and removed cleanly. |
| **1. Melee: Ember Blade** | `ModItem` with `DamageClass.Melee`, the standard swing style, original texture, stats from the spec | Shows in the inventory with a correct tooltip. On a Target Dummy, damage numbers fall within ±15% of `spec.damage × meleeDamage` (minus defence/2). Crit rate is about `4 + item.crit` percent over 200 hits. Use time measured in ticks matches the spec. Autoreuse works as specified. |
| **2. Ranged: Pine Bow** | `DamageClass.Ranged`, `useAmmo = AmmoID.Arrow`, vanilla arrows first; optional draw phase via a held projectile afterwards | Consumes one arrow per shot. With no arrows it won't fire. Damage is weapon plus ammo. Arrows arc, hit the dummy and despawn on tiles. Ammo-saving effects behave like vanilla bows. |
| **3. Magic: Spark Wand** | `DamageClass.Magic`, `Item.mana`, a custom `ModProjectile` that homes toward the nearest valid NPC | Mana drops by `cost × manaCost`. It won't cast without mana unless a mana flower triggers. The bolt curves to hit an off-axis dummy. It never targets town NPCs or critters. It times out and dies on tiles. |
| **4. Summon: Wisp Lantern** | `DamageClass.Summon`, `ModBuff` plus a minion `ModProjectile` following ExampleSimpleMinion (`minionSlots = 1`, targeting flags) | Using it adds the buff and spawns one minion. The minion follows, attacks the dummy and honours the right-click target. Recasting beyond `maxMinions` replaces the oldest. Cancelling the buff removes the minion. It survives save and reload as vanilla minions do. |
| **5. Shared specs** | `shared/weapons/*.json` (spec v1); the companion and the mod both read it; unit converters | Companion unit tests: spec → desktop conversion round-trips. A mod debug command prints loaded stats matching the JSON. Changing one value in the JSON changes both sides after a rebuild. |
| **6. Bridge design, then prototype** (separate approval) | A design document first, then a one-way state feed | The companion shows the in-game equipped weapon within one second. Malformed or oversized messages are rejected by Rust. Nothing is sent unless both apps opt in. Neither side needs a public network port. |

Multiplayer is out of scope for the proof of concept. Phases 1–4 still
follow the ExampleMod patterns (owner checks, `Main.myPlayer`), so a later
multiplayer pass is not blocked.

---

## 7. Integration boundary (future bridge, not built)

| Rule | Reason |
| --- | --- |
| **One-way by default:** game → companion telemetry (equipped weapon id, attack events, damage dealt). The companion never injects input or commands into Terraria. | Keeps the companion out of game logic, avoids anything that looks like automation, and avoids multiplayer desync |
| **Transport, option A:** the mod writes a small JSON state file in its own tModLoader data folder, and the companion watches it | No network surface; the simplest option |
| **Transport, option B:** a `127.0.0.1`-only socket with a random per-session token in a user-readable-only (0600) file | Lower latency. Never bind 0.0.0.0. |
| **Versioned schema** (`bridgeVersion`), validated in **Rust** with size limits, like the existing `combat.rs` allowlist | Untrusted input stays outside the WebView |
| **No personal or world data:** no player names, world names, chat or server addresses | Privacy |
| **Opt-in on both sides:** a mod config toggle and a companion tray toggle | User control |
| **Client-side only mod** until multiplayer is designed | Avoids server and sync requirements |

The companion's existing boundaries stay as they are. It already relays only
`attack`/`reset`/`dismiss` through a validated Rust allowlist and never
controls other applications.

---

## 8. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | **Copyright and redistribution:** using or copying decompiled Terraria code, or redistributing it. Re-Logic has issued a DMCA notice against a decompiled repository before. | Medium (if misused) | High | Never copy, vendor, build or link the decompiled repo. Write mod code only against the tModLoader API, using ExampleMod (MIT) patterns and original art. The local audit clone was temporary and has been deleted. |
| R2 | **Version drift:** decompiled 1.4.0.5, tModLoader base 1.4.4.9 and vanilla 1.4.5.8 differ in APIs and mechanics | High | Medium | Use the 1.4.4 ExampleMod and documentation as the reference, and treat 1.4.0.5 notes as hints only. Verify behaviour in game. |
| R3 | **tModLoader 1.4.5 port** breaks the mod's API | High (within months) | Medium | Keep the mod small, follow tModPorter, keep specs data-driven, and pin to stable during development |
| R4 | **Save incompatibility:** vanilla 1.4.5 saves can't load in tModLoader 1.4.4 | High | Medium | Use dedicated tModLoader test saves and back up before Phase 0 |
| R5 | **macOS toolchain:** .NET 8 SDK on arm64 and macOS 27, FNA, Build + Reload behaviour, symlinked ModSources | Medium | Medium | Phase 0 verifies everything before any weapon work. Fall back to copying sources instead of symlinking. |
| R6 | **Mods run unsandboxed** with full user privileges | Inherent | High | Install only your own mod and trusted mods. Never load mod code from the companion. Review dependencies. |
| R7 | **Bridge attack surface** (later phases) | Low to medium | Medium | One-way, localhost or file only, token, Rust validation, size limits, opt-in |
| R8 | **Model mismatch:** draw and cast phases, arcs, mana upkeep versus minion slots | Certain | Low | Shared stats plus per-runtime behaviour fields. Document the differences (§3.1). |
| R9 | **Steam Workshop publishing rules** | Low (if not publishing) | Medium | Keep the mod local and private until you decide to publish and have read the Workshop EULA |
| R10 | **Maintaining two codebases** (TypeScript and C#) | Medium | Medium | One spec source, parity tests, a minimal C# surface |
| R11 | **Balance and fairness** when used online | Low | Low | Single-player or client-only proof of concept. Balance against vanilla tiers later. |

---

## 9. Unresolved questions

1. **Terraria EULA wording on decompiling and modding.** The EULA text
   wasn't retrieved. The evidence used here is the DMCA notice and the Steam
   listing's ownership requirement. *Action:* read Terraria's EULA on Steam
   and terraria.org before publishing anything.
2. **Re-Logic's formal position on tModLoader.** tModLoader ships on Steam
   as a free app that requires owning Terraria. Whether Re-Logic formally
   endorses it was not verified in this audit **[Hypothesis]**.
3. **macOS developer workflow.** The Mac and Linux wiki page couldn't be
   read. Build + Reload, IDE debugging and symlinked sources are untested on
   macOS 27 arm64.
4. **Design choice: Terraria-authentic or companion-authentic.** Should the
   in-game weapons use ammo, instant bows and minion slots (authentic), or
   draw times, cast delays and mana upkeep (matching the companion)? The
   recommendation is authentic first, with optional held-projectile variants
   later.
5. **Bridge direction.** One-way (recommended) or later two-way, such as
   equipping from the desktop? Two-way needs its own review.
6. **Timing of tModLoader 1.4.5 stable.** It decides whether to start on
   1.4.4 now (recommended) or wait.
7. **Accuracy of the decompilation.** The repo is refactored and modified,
   so a mechanic read there could differ from shipped 1.4.0.5 and certainly
   from 1.4.4.9. All §3 findings are background only. In-game behaviour
   under tModLoader is authoritative.

---

## 10. Go / no-go

| Decision | Verdict |
| --- | --- |
| Build in-game weapons as a **tModLoader 1.4.4 mod** using the public API, ExampleMod patterns and original art | **GO**, after you approve installing the .NET 8 SDK (Phase 0) |
| Proof-of-concept order: melee → ranged → magic, then summon, then shared specs | **GO** |
| Read the decompiled 1.4.0.5 repo to *understand* mechanics | Acceptable for private reference only. Never copy, build or redistribute it. |
| Modify, rebuild or run the decompiled source, or patch Terraria binaries | **NO-GO** |
| Use REA or other decompilers on Terraria binaries | **NO-GO** (unnecessary, and it increases R1) |
| Redistribute any game code or assets, or publish to the Workshop before a licensing review | **NO-GO** |
| Build a game ↔ companion bridge now | **NO-GO** until the proof of concept is done and the bridge design is approved. One-way first. |

---

## Appendix A: evidence collected (read-only)

- **Companion repository:**
  - `git status` was clean at the start.
  - Tags: `milestone-1`, `milestone-2`.
  - HEAD at the start was `f501e5c` (Milestone 3).
  - Files read: `Terraria 1405/tera.md` and `rea/reverseeng.md` (RTF files
    containing one link each).
- **Decompiled repository:**
  - Retrieved as a shallow, sparse, blob-filtered clone into a temporary
    session scratch directory outside this project.
  - Only `.cs`, `.md` and project files were checked out; no binaries.
  - Nothing was built or executed. The clone was deleted after the audit.
  - Files consulted: `README.md`, `AssemblyInfo.cs`, `Terraria1405.csproj`,
    `Main.cs`, `Item.cs`, `Player.cs`, `Projectile.cs`, `NPC.cs`,
    `CombatText.cs`, `ID/AmmoID.cs`, `ID/BuffID.cs`, `ID/ItemID.cs`,
    `ID/ProjectileID.cs`.
- **GitHub metadata** for `AliceSavard/Terarria1405`: no license; created
  2020-07-31; last pushed 2025-12-02.
- **Re-Logic DMCA notice**, `github/dmca` `2020/06/2020-06-02-Terraria.md`.
- **tModLoader:**
  - Repository license: MIT.
  - Latest release: `v2026.08.3.0` (2026-10-01).
  - Branches include `1.4.4` and `1.4.5`.
  - ExampleMod 1.4.4 listings, plus the hook signatures in `ExampleSword`,
    `ExampleGun`, `ExampleMagicWeapon` and `ExampleSimpleMinion`.
- **Steam:** tModLoader store page (macOS requirements, ownership
  requirement, third-party EULA) and tModLoader update announcements.
- **Local install metadata only** (nothing launched or modified):
  - Terraria `changelog.txt` header.
  - Steam `appmanifest_*.acf` build ids.
  - `tModLoader.runtimeconfig.json`.
  - The first lines of `tModLoader-Logs/client.log` (version string).
  - Directory names under `steamapps/common` and
    `~/Library/Application Support/Terraria`.
  - `dotnet` availability, CPU architecture and macOS version.

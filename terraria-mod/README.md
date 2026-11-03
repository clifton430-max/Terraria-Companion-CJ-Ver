# Companion Arsenal (tModLoader mod)

The in-game half of the Terraria Desktop Companion. It is a tModLoader mod
that brings the companion's weapons into the real game.

**Version 0.1 contains one weapon, Ember Blade.**

- **API only:** it is built only against tModLoader's public API, following
  the official templates and ExampleMod.
- (see `tools/make_art.py`).
- **Background:** the design rationale and risks are in
  [`../docs/terraria-mod-compatibility-audit.md`](../docs/terraria-mod-compatibility-audit.md).

## Ember Blade

A standard Terraria broadsword. It uses the game's own melee mechanics, not
the desktop companion's custom wind-up.

| Stat | Value | Notes |
| --- | --- | --- |
| Damage | 22 melee | Scales with melee damage bonuses. Prefixes such as Legendary apply. |
| Use time | 33 ticks ("Slow") | The companion's 0.55 s at 60 ticks per second |
| Critical chance | +6% | Plus the base 4%, for 10% total, matching the companion |
| Knockback | 6.5 ("Strong") | |
| Autoswing | Yes | |
| Rarity | Orange | |
| On hit | Inflicts **On Fire!** for 3 s on NPCs and on players in PvP | |
| Swing effect | Occasional torch embers | |
| Sell value | 54 silver | |
| Recipe | 12 Iron Bars or Lead Bars (recipe group) + 25 Torches, at an Iron or Lead Anvil | |

## Prerequisites

| Requirement | Version verified on 2026-10-15 | Notes |
| --- | --- | --- |
| Terraria (Steam) | Owned; vanilla install is 1.4.5.8 | tModLoader needs you to own Terraria. It runs separately from the vanilla game. |
| tModLoader (Steam app 1281930) | **1.4.4.9+2026.08.3.0, stable** | Based on Terraria 1.4.4.9. On Apple Silicon it runs as x86_64 under Rosetta 2. |
| .NET 8 SDK, **x64** | 8.0.426, installed user-locally in `~/.dotnet-x64` | The official guide asks for the x64 SDK, which matches tModLoader's x64 runtime. Don't use .NET 9 or 10. |
| macOS | 27.2, Apple Silicon (arm64) | tModLoader 1.4.4 needs macOS 12 or later |

### Installing the .NET 8 SDK without admin rights

This uses Microsoft's official install script and changes no system or PATH
settings:

```sh
curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --channel 8.0 --architecture x64 --install-dir "$HOME/.dotnet-x64" --no-path
"$HOME/.dotnet-x64/dotnet" --list-sdks   # should list 8.0.x
```

Alternatively, use the x64 `.pkg` installer from
<https://dotnet.microsoft.com/download/dotnet/8.0>, which needs an
administrator password, and set `DOTNET=$(command -v dotnet)` when
building.

## Build

```sh
./terraria-mod/build.sh
```

The script runs the supported tModLoader workflow:

1. It creates `~/Library/Application Support/Terraria/tModLoader/ModSources/`
   if needed. It writes the standard `tModLoader.targets` there, the same
   file tModLoader generates, pointing at the installed `tMLMod.targets`.
2. It symlinks `terraria-mod/CompanionArsenal` into `ModSources`, so the
   in-game **Workshop → Develop Mods** menu shows the mod and
   **Build + Reload** also works.
3. It runs `dotnet build`. The compiler output goes through tModLoader's
   analyzers. The `BuildMod` step then calls `tModLoader.dll -server -build`,
   the same packager the in-game button uses, to produce
   `~/Library/Application Support/Terraria/tModLoader/Mods/CompanionArsenal.tmod`
   and add the mod to `Mods/enabled.json`.

The macOS detail that `build.sh` handles:
- **The problem:** packaging loads tModLoader's native `FNA3D` library to
  convert PNG textures. tModLoader's own launcher points
  `DYLD_LIBRARY_PATH` at `Libraries/Native/OSX`, but MSBuild runs the step
  through `/bin/sh`, and macOS System Integrity Protection strips `DYLD_*`
  variables from it.
- **The fix:** `tools/bin/dotnet` is a tiny shim, placed first on `PATH` for
  the build process only. It re-applies the launcher's variables and then
  runs the real SDK.

Overrides: `TML_DIR` (tModLoader install), `TML_SAVE` (save folder) and
`DOTNET` (SDK host). Extra arguments are passed through to `dotnet build`.

To regenerate the textures after editing the companion's art, run
`python3 terraria-mod/tools/make_art.py`.

## Install and enable

`build.sh` installs and enables the mod for you. To do it by hand:
1. Copy `CompanionArsenal.tmod` into
   `~/Library/Application Support/Terraria/tModLoader/Mods/`.
2. In tModLoader, enable it under **Workshop → Manage Mods**, then click
   **Reload Mods**.

To uninstall, disable the mod in Manage Mods. Optionally delete the `.tmod`
and the `ModSources/CompanionArsenal` symlink.

## Controls and in-game testing

Ember Blade uses Terraria's normal controls. Select it on the hotbar and
**left-click** (or hold, since it autoswings) to swing toward the cursor.

To test it:
1. **Back up first.** Vanilla Terraria 1.4.5 saves can't be loaded in
   tModLoader 1.4.4. Use a new tModLoader character and world, and back up
   `~/Library/Application Support/Terraria` beforehand.
2. Launch **tModLoader** from Steam. Confirm *Companion Arsenal* is enabled
   in Workshop → Manage Mods.
3. Get the sword in one of two ways:
   - Create a **Journey** mode character, open the Power menu → Research,
     find "Ember Blade" and duplicate it.
   - Or craft it: 12 Iron or Lead Bars and 25 Torches at an anvil.
4. Check the tooltip: name "Ember Blade" in orange, 22 melee damage, 10%
   critical strike chance, slow speed, strong knockback, "Sets enemies
   ablaze".
5. Place a **Target Dummy** and swing at it.
   - Damage numbers should land around 19–25 against 0 defence (±15%),
     with occasional red crits.
   - The dummy should show the On Fire! debuff.
   - Embers should appear along the swing.

### Headless engine smoke test (developers)

The mod includes a console-only command for tModLoader's dedicated server.
Start a server with the mod enabled and type `companioncheck`. It checks the
item's loaded stats and recipe, spawns a Target Dummy, runs Ember Blade's
on-hit hook against it and confirms On Fire! was applied. It ends with
`ALL PASS` or a count of failures. The command does nothing in single
player or for chat users.

## Verification status (2026-10-15)

| Check | Result |
| --- | --- |
| `dotnet build` with tModLoader analyzers | **Passed:** 0 warnings, 0 errors |
| tModLoader packaging (`-build`), producing `.tmod` | **Passed** |
| Loaded by the tModLoader 1.4.4.9 **dedicated server**, plus `companioncheck` | **Passed 9/9:** item type, localized name, melee class and damage, swing style and use time, crit, knockback and autoswing, rarity, recipe, On Fire! applied to a real Target Dummy |
| Loaded by the tModLoader 1.4.4.9 **client** on macOS (launched through Steam) | **Passed:** "Mod Load Completed", with textures loaded. The only warning was a missing `icon_small.png`, now added. |
| **Swinging the sword in a world as a player** | **Not yet verified.** The automated session could not operate the game window. Follow the in-game testing steps above. |

## Project layout

```
terraria-mod/
  build.sh                          supported build and package workflow (see above)
  tools/bin/dotnet                  build-only shim that restores DYLD_* for packaging
  tools/make_art.py                 textures from desktop/src/combat/weaponArt.ts
  CompanionArsenal/
    build.txt, description.txt      mod metadata
    icon.png, icon_small.png        mod icons (original art)
    CompanionArsenal.cs             the single Mod class
    CompanionArsenal.csproj         official template; imports ..\tModLoader.targets
    Content/Items/Weapons/EmberBlade.cs + .png
    Common/Commands/SelfTestCommand.cs   server console smoke test
    Localization/en-US_Mods.CompanionArsenal.hjson
    Properties/launchSettings.json  official template (run or debug tModLoader from an IDE)
```

## Known limitations

- **Not verified as a player in game.** See the verification table above.
- **Version targets.** The mod targets **tModLoader 1.4.4 stable**. It
  doesn't run in vanilla Terraria, and it will need porting (tModLoader
  ships `tModPorter` for this) once tModLoader's 1.4.5 branch becomes
  stable.
- **Saves.** Vanilla 1.4.5 characters and worlds can't be used in
  tModLoader 1.4.4.
- **Rosetta.** On Apple Silicon, tModLoader and the build's packaging step
  run as x86_64 under Rosetta 2. The x64 SDK is deliberate.
- **Balance.** 22 damage in an iron-tier recipe is on the strong side for
  early game. It's tuned to match the desktop companion and may be
  rebalanced.
- **Scope.** Only one weapon so far. The ranged, magic and summon weapons
  from the audit's plan come next.
- **Workshop.** Not published. Keep it local until the licensing review in
  the audit is done.
- **Multiplayer.** Not tested. The item uses standard synced fields and
  hooks, but no multiplayer session was run.

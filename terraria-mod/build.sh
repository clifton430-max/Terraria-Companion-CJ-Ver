#!/usr/bin/env bash
# Build Companion Arsenal into a .tmod using tModLoader's supported workflow:
# `dotnet build` on the mod project, whose BuildMod target (from the installed tMLMod.targets)
# runs `dotnet tModLoader.dll -server -build <mod dir>` — the same packager as in-game "Build + Reload".
#
# Environment overrides:
#   TML_DIR   tModLoader install  (default: Steam install on macOS)
#   TML_SAVE  tModLoader save dir (default: ~/Library/Application Support/Terraria/tModLoader)
#   DOTNET    .NET 8 SDK host     (default: ~/.dotnet-x64/dotnet, then `dotnet` on PATH)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOD_NAME="CompanionArsenal"
TML_DIR="${TML_DIR:-$HOME/Library/Application Support/Steam/steamapps/common/tModLoader}"
TML_SAVE="${TML_SAVE:-$HOME/Library/Application Support/Terraria/tModLoader}"
if [[ -z "${DOTNET:-}" ]]; then
  if [[ -x "$HOME/.dotnet-x64/dotnet" ]]; then DOTNET="$HOME/.dotnet-x64/dotnet"; else DOTNET="$(command -v dotnet || true)"; fi
fi

[[ -f "$TML_DIR/tMLMod.targets" ]] || { echo "tModLoader not found at: $TML_DIR" >&2; exit 1; }
[[ -n "$DOTNET" && -x "$DOTNET" ]] || { echo ".NET 8 SDK not found; see terraria-mod/README.md" >&2; exit 1; }
"$DOTNET" --list-sdks | grep -q '^8\.' || { echo "A .NET 8 SDK is required (found: $("$DOTNET" --list-sdks))" >&2; exit 1; }

# Same file tModLoader writes into ModSources (ModCompile.UpdateReferencesFolder); the .csproj imports ..\tModLoader.targets.
targets_xml="<Project ToolsVersion=\"14.0\" xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\">
  <Import Project=\"$TML_DIR/tMLMod.targets\" />
</Project>"
mkdir -p "$TML_SAVE/ModSources"
[[ -f "$TML_SAVE/ModSources/tModLoader.targets" ]] || printf '%s' "$targets_xml" > "$TML_SAVE/ModSources/tModLoader.targets"
printf '%s' "$targets_xml" > "$HERE/tModLoader.targets"  # lets IDEs open the repo copy directly (gitignored)

# Link the repo's mod folder into ModSources so tModLoader's Develop Mods menu sees it too.
link="$TML_SAVE/ModSources/$MOD_NAME"
if [[ -L "$link" ]]; then
  [[ "$(readlink "$link")" == "$HERE/$MOD_NAME" ]] || { echo "$link points elsewhere: $(readlink "$link")" >&2; exit 1; }
elif [[ -e "$link" ]]; then
  echo "$link already exists and is not our symlink; move it aside first." >&2; exit 1
else
  ln -s "$HERE/$MOD_NAME" "$link"
fi

# BuildMod's Exec calls plain `dotnet` via /bin/sh. Put our shim first on PATH (this process only); it restores
# the native-library environment that SIP strips, then runs the chosen SDK.
export TML_DIR TML_REAL_DOTNET="$DOTNET"
export PATH="$HERE/tools/bin:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
"$DOTNET" build "$link/$MOD_NAME.csproj" "$@"
echo "Built: $TML_SAVE/Mods/$MOD_NAME.tmod"

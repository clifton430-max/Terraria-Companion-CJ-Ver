#!/usr/bin/env bash
# Automated in-game test of Companion Arsenal weapons in the real tModLoader client.
#
#   ./terraria-mod/tools/run_ingame_test.sh [--no-build]
#
# 1. Builds the mod (unless --no-build).
# 2. Creates a throwaway test world with the headless server if it doesn't exist yet.
# 3. Writes a one-shot request file that the mod consumes on startup (normal launches never test).
# 4. Launches tModLoader through Steam. The mod enters the test world as a throwaway character,
#    swings Ember Blade via the game's own input path at two frozen targets, writes results.json and quits.
# 5. Prints the results; exits 0 only if every check passed.
#
# Test files live in "$TML_SAVE/CompanionArsenalTest/", not in your Players/Worlds folders.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TML_SAVE="${TML_SAVE:-$HOME/Library/Application Support/Terraria/tModLoader}"
TEST_DIR="$TML_SAVE/CompanionArsenalTest"
RESULTS="$TEST_DIR/results.json"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-420}"

# PID of a running tModLoader client (not a dedicated server), or nothing. Never fails (set -e safe).
client_running() {
  local pid
  for pid in $(pgrep -f "tModLoader.dll" || true); do
    if ! ps -o args= -p "$pid" | grep -q -- "-server"; then echo "$pid"; return 0; fi
  done
  return 0
}

[[ "${1:-}" == "--no-build" ]] || "$HERE/../build.sh" >/dev/null
echo "Mod built and enabled."

if [[ -n "$(client_running)" ]]; then
  echo "tModLoader is already running. Quit it first, then rerun this script." >&2
  exit 2
fi

mkdir -p "$TEST_DIR"
if [[ ! -f "$TEST_DIR/CompanionTest.wld" ]]; then
  python3 -I "$HERE/tml_server.py" create-world "$TEST_DIR/CompanionTest.wld"
fi

run_id="$(date +%s)-$$"
rm -f "$RESULTS"
printf '{"runId":"%s"}\n' "$run_id" > "$TEST_DIR/autotest-request.json"
echo "Launching tModLoader through Steam (run $run_id). Please don't touch the game window until it closes."
open "steam://rungameid/1281930"

deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
until [[ -f "$RESULTS" ]] && grep -q "\"$run_id\"" "$RESULTS"; do
  if (( $(date +%s) > deadline )); then
    echo "No results after ${TIMEOUT_SECONDS}s. Check tModLoader-Logs/client.log for [AutoTest] lines." >&2
    rm -f "$TEST_DIR/autotest-request.json"
    exit 1
  fi
  sleep 2
done

# Give the client a moment to exit on its own; stop it if it lingers.
for _ in $(seq 1 30); do [[ -z "$(client_running)" ]] && break; sleep 1; done
pid="$(client_running)"; [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true

python3 -I - "$RESULTS" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"\nCompanion Arsenal in-game test — {r['tModLoader']} — run {r['runId']}")
for c in r["checks"]:
    print(f"  [{'PASS' if c['pass'] else 'FAIL'}] {c['name']}: {c['detail']}")
print(f"  swings={r['swings']} hits={len(r['hits'])} crits={r['critCount']} onFire={r['onFire']}")
print("RESULT:", "ALL PASS" if r["passed"] else "FAILED")
sys.exit(0 if r["passed"] else 1)
PY

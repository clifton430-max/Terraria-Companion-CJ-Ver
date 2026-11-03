#!/usr/bin/env python3
"""Headless tModLoader dedicated-server helper (standard library only).

  create-world PATH        generate a small world at PATH (if missing) with the enabled mods, then exit
  selftest [PATH]          load PATH (creating it if needed) and run the mod's `companioncheck` console test

Binds to 127.0.0.1:7799 only. Uses tModLoader's bundled .NET and the same native-library
environment its macOS launcher sets.

Note: with -autocreate the server ignores the -world path and saves to
"{save}/Worlds/<worldname>.wld" (adding a number if taken). create-world therefore generates under a
unique temporary name and moves the result to PATH, leaving the user's Worlds list untouched.
"""
import glob
import os
import queue
import subprocess
import sys
import threading
import time

TML = os.environ.get("TML_DIR", os.path.expanduser("~/Library/Application Support/Steam/steamapps/common/tModLoader"))
SAVE = os.environ.get("TML_SAVE", os.path.expanduser("~/Library/Application Support/Terraria/tModLoader"))


def start(world: str, create_as: str | None = None) -> tuple[subprocess.Popen, "queue.Queue[str]"]:
    env = dict(os.environ, DOTNET_CLI_TELEMETRY_OPTOUT="1")
    if sys.platform == "darwin":
        env["DYLD_LIBRARY_PATH"] = f"{TML}/Libraries/Native/OSX"
        env["VK_ICD_FILENAMES"] = f"{TML}/Libraries/Native/OSX/MoltenVK_icd.json"
    args = [f"{TML}/dotnet/dotnet", "tModLoader.dll", "-server", "-world", world,
            "-players", "1", "-port", "7799", "-ip", "127.0.0.1"]
    if create_as:
        args += ["-autocreate", "1", "-worldname", create_as]  # 1 = small world
    proc = subprocess.Popen(args, cwd=TML, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1)
    lines: "queue.Queue[str]" = queue.Queue()
    threading.Thread(target=lambda: [lines.put(l) for l in proc.stdout], daemon=True).start()
    return proc, lines


def wait_for(proc, lines, token: str, timeout: float, echo=lambda l: None) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            line = lines.get(timeout=1).rstrip()
        except queue.Empty:
            if proc.poll() is not None:
                return False
            continue
        echo(line)
        if token in line:
            return True
    return False


def stop(proc) -> int:
    if proc.poll() is None:
        proc.stdin.write("exit\n")
        proc.stdin.flush()
    try:
        return proc.wait(timeout=90)
    except subprocess.TimeoutExpired:
        proc.kill()
        return -9


def create_world(target: str) -> bool:
    """Generate a small world under a unique name in the save's Worlds folder, then move it to target."""
    temp = f"CompanionArsenalTmp{os.getpid()}"
    proc, lines = start(os.path.join(SAVE, "Worlds", temp + ".wld"), create_as=temp)
    ok = wait_for(proc, lines, "Server started", 600)
    code = stop(proc)
    made = os.path.join(SAVE, "Worlds", temp)
    if ok and code == 0 and os.path.exists(made + ".wld"):
        for ext in (".wld", ".twld"):
            if os.path.exists(made + ext):
                os.replace(made + ext, os.path.splitext(target)[0] + ext)
    for leftover in glob.glob(os.path.join(SAVE, "Worlds", temp + "*")):
        os.remove(leftover)
    return os.path.exists(target)


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("create-world", "selftest"):
        print(__doc__)
        return 2
    mode = sys.argv[1]
    world = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.expanduser(
        "~/Library/Application Support/Terraria/tModLoader/CompanionArsenalTest/CompanionTest.wld")
    os.makedirs(os.path.dirname(world), exist_ok=True)
    if not os.path.exists(world):
        print(f"Generating a small test world at {world} (about a minute)...", flush=True)
        if not create_world(world):
            print("World generation failed; see tModLoader-Logs/server.log", flush=True)
            return 1
        print("World created.", flush=True)
    if mode == "create-world":
        return 0
    print(f"Starting tModLoader server on {world}...", flush=True)
    proc, lines = start(world)
    if not wait_for(proc, lines, "Server started", 600):
        print("Server failed to start; see tModLoader-Logs/server.log", flush=True)
        stop(proc)
        return 1
    ok = True
    if mode == "selftest":
        proc.stdin.write("companioncheck\n")
        proc.stdin.flush()
        echo = lambda l: print(l.lstrip(": "), flush=True) if ("PASS" in l or "FAIL" in l or "selftest" in l) else None
        ok = wait_for(proc, lines, "selftest done", 60, echo)
    code = stop(proc)
    print(f"Server exited with code {code}.", flush=True)
    return 0 if ok and code == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Generate Companion Arsenal textures from the desktop companion's original pixel art.

The sword shape is read from desktop/src/combat/weaponArt.ts (single source of truth) and
recoloured with the Ember Blade palette from desktop/src/combat/weapons.ts. Writes:
  CompanionArsenal/Content/Items/Weapons/EmberBlade.png  32x32 (16x16 art at 2x)
  CompanionArsenal/icon.png                             80x80 mod icon (mod browser)
  CompanionArsenal/icon_small.png                       30x30 mod icon (in-game mod list)
Standard library only. Usage: python3 terraria-mod/tools/make_art.py
"""
import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ART_TS = ROOT / "desktop/src/combat/weaponArt.ts"
MOD = ROOT / "terraria-mod/CompanionArsenal"

BASE = {"k": "#1d1424", "a": "#c9d3dc", "A": "#8d9aa8", "w": "#f4f7fa", "b": "#8a5428", "B": "#5e3618", "c": "#e0b84a"}
EMBER = {"a": "#ffa04a", "A": "#c2501f", "w": "#ffe39a", "c": "#8f2c1a"}  # weapons.ts EMBER palette


def sword_rows() -> list[str]:
    src = ART_TS.read_text()
    block = re.search(r"sword:\s*\{\s*rows:\s*\[(.*?)\]", src, re.S)
    if not block:
        raise SystemExit("sword shape not found in weaponArt.ts")
    rows = re.findall(r'"([^"]*)"', block.group(1))
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), "expected 16x16 art"
    return rows


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def render(rows: list[str], scale: int, size: int, background=None) -> list[list[tuple]]:
    pixels = [[background or (0, 0, 0, 0)] * size for _ in range(size)]
    offset = (size - 16 * scale) // 2
    for y, row in enumerate(rows):
        for x, key in enumerate(row):
            if key == ".":
                continue
            color = rgba(EMBER.get(key, BASE[key]))
            for dy in range(scale):
                for dx in range(scale):
                    pixels[offset + y * scale + dy][offset + x * scale + dx] = color
    return pixels


def write_png(path: Path, pixels: list[list[tuple]]) -> None:
    height, width = len(pixels), len(pixels[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    print(f"wrote {path.relative_to(ROOT)} ({width}x{height})")


if __name__ == "__main__":
    rows = sword_rows()
    write_png(MOD / "Content/Items/Weapons/EmberBlade.png", render(rows, 2, 32))
    write_png(MOD / "icon.png", render(rows, 4, 80, background=rgba("#2a1d3a")))
    write_png(MOD / "icon_small.png", render(rows, 1, 30, background=rgba("#2a1d3a")))

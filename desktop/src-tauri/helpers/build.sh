#!/bin/sh
# Builds the speech and text-recognition helpers next to this script as Tauri external binaries
# (bin/<name>-<target triple>). Run automatically before `tauri build` / `tauri dev`.
set -e
cd "$(dirname "$0")"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p ../bin
OUT="../bin/speech-helper-$TRIPLE"
if [ ! -f "$OUT" ] || [ speech-helper.swift -nt "$OUT" ]; then
  xcrun --sdk macosx swiftc -O speech-helper.swift -o "$OUT" -framework Speech -framework AVFoundation
fi
OCR="../bin/ocr-helper-$TRIPLE"
if [ ! -f "$OCR" ] || [ ocr-helper.swift -nt "$OCR" ]; then
  xcrun --sdk macosx swiftc -O ocr-helper.swift -o "$OCR" -framework Vision -framework AppKit
fi

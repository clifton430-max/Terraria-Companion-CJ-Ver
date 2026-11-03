# Terraria Companion CJ Ver

A family-friendly macOS desktop companion. A small team of Terraria-style professionals in suits lives on your desktop: they walk along the bottom of the screen, stand on your windows, give occasional reminders, play chess with you, help with homework and answer questions. A Terraria-style world runs behind your windows, and the team can build a town there on their own.

This is a separate edition of Terraria Companion. Compared with the original:

| | CJ Ver |
| --- | --- |
| **Characters** | Six original professionals in suits, drawn from Terraria's own player sprites (no add-on character packs) |
| **Voices** | None. No voice lines and no hit, pick-up or grab noises. Only neutral effects play (tool swings, pickaxe hits, eating) |
| **Dialogue** | Strictly professional: courteous and concise, with no pet names, honorifics, romance, kisses, hugs or hearts |
| **Chat persona** | The AI chat answers as a professional assistant |
| **Add-ons** | Resource packs and add-ons (skins, voice packs, replacement boss art, sound packs) are never loaded |
| **App identity** | Its own app name and bundle ID (`com.terrariacompanion.cjver`), so its settings and saved world are separate from the original's |

## The team

| Name | Role | Suit |
| --- | --- | --- |
| Morgan | Executive Assistant | Navy (the look can be changed from the Character tab) |
| Avery | Chief of Staff | Charcoal |
| Jordan | Events & Communications Lead | Burgundy |
| Riley | Health & Wellness Advisor | Grey |
| Quinn | Research Analyst | Brown |
| Casey | Engineering Lead | Olive |

## Requirements

- macOS 14 or newer
- **Terraria installed through Steam** on the same Mac. The characters, the world and the sounds are read from your own Terraria install at runtime, and none of the game's art is stored in this repository. Without Terraria the app still runs, but the characters can't be drawn.
- To build: Node.js 20+, Rust (via [rustup](https://rustup.rs)) and the Xcode Command Line Tools (`xcode-select --install`)
- Optional: [Ollama](https://ollama.com) for the chat panel (the app picks a supported local model)

## Build and install

```sh
cd desktop
npm install
npm run tauri build -- --bundles app
cp -R "src-tauri/target/release/bundle/macos/Terraria Companion CJ Ver.app" /Applications/
open "/Applications/Terraria Companion CJ Ver.app"
```

The first build takes several minutes. The app runs from the menu bar (no Dock icon).

On first launch macOS may ask for permissions, depending on the features you use:

- **Accessibility**: playing in the background world, and voice-input shortcuts
- **Microphone** and **Speech Recognition**: push-to-talk questions (you speaking to the app; the team never speaks back out loud)
- **Screen Recording**: only if you turn on "Ask about my screen" in chat

## Using it

- **Click** a team member to get their attention. **Drag** to move them, or throw them.
- **Double-click** a team member to open the menu (inventory, characters, settings).
- **Right-click** a team member for quick actions: ask a question, chat, study help, stay put and idle poses.
- The **menu bar icon** has the main options, including "Let the Team Play (Build a House)", which sends them into the background world.
- **Chat**: ask anything; the selected team member answers. You can also type requests such as "let's play chess" or "build me a house in Terraria".

## Development

```sh
cd desktop
npm test                         # front-end tests (Vitest)
(cd src-tauri && cargo test --lib)  # Rust tests
npm run tauri dev                # run with hot reload
```

`desktop/README.md` covers the architecture in detail. The files in `docs/` are developer notes carried over from the original project, so a few describe features that this edition removes.

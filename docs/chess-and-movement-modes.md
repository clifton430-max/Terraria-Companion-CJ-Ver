# Chess, movement modes, inventory scrolling and performance

## Chess

Open it by voice or text ("let's play chess", "play chess", "pull up the chessboard", "how about a game of chess?"), and close it with the *Close* button or "put the chess board away". Questions about chess ("how do knights move?") still go to chat.

- **Board:** a framed board rests near the bottom of the screen. The squares use Terraria's wood (`Tiles_30`) and stone (`Tiles_1`) tiles, and the frame has torches (`Item_8`) with flickering light. These are loaded at runtime from the local install, and plain colours are used when it isn't available. The pieces are original 16×16 pixel art (`src/chess/pieces.ts`). The layout scales from about 800×560 up to large displays (`chessLayout`).
- **Players:** two local players, with no computer opponent. Click a piece and then a square, or drag it.
  - The board shows the selection, legal targets, captures, the last move and a check glow.
  - The panel shows whose turn it is or the result, plus *New game* (a second click confirms while a game is in progress) and *Close*.
  - The right-hand column holds the move list (SAN), and each side has a tray of captured pieces.
- **Rules** (`src/chess/rules.ts`): legal moves, check, checkmate, stalemate, castling, en passant, promotion with a choice (Q/R/B/N picker), and automatic draws by the fifty-move rule, threefold repetition and insufficient material. Move generation is checked against the standard perft positions.
- **Supporters** (`src/chess/director.ts`):
  - **Teams:** the companions on screen become supporters. With four, two stand left of the board for White and two right of it for Black, with team banners. With three it's 2 + 1, with two it's 1 + 1, one companion moves for both sides, and with none the pieces move themselves.
  - **Cheering** (`src/chess/cheers.ts`): they cheer in their own voices at the start, on captures, losses, checks, strong moves and tense endgames, and on the result. A global gap, a per-character gap and a chance roll keep it from getting noisy, and no line repeats twice in a row.
- **Moving pieces:**
  - **Push:** a supporter from the mover's team flies over and pushes the piece (anticipation, contact, push, release, recovery), then flies back to her spot.
  - **Throw:** if a piece is in the way, or for any knight, she picks it up and throws it in a gravity arc that spins, bounces and settles exactly on its square.
  - **Captures:** captured pieces are knocked into the capturer's tray.
  - **Castling:** king and rook move together, with the rook moved by a teammate if one is free (the rook hops the king).
  - **Promotion:** the pawn turns into the chosen piece with a sparkle when it lands.
- **Robustness:**
  - The game state is authoritative. Animations never teleport a piece, and no two companions handle the same piece.
  - Losing focus, hiding the window, *New game* or *Close* snaps every animation to the real position.
  - A companion that's dragged away, controlled, paused or dismissed is let go, and the piece still arrives.
  - Reduced motion (the macOS setting) gives short direct slides with no companion trips and no torch flicker.
- **Closing:** everyone flies back to where they were, then their normal behaviour resumes. Stay-Put keeps its spot, and modes and control are untouched. Conversations don't start during a game, and one in progress is called off.

## Chess, part 2: one copy per piece, materials, resizing, opponent, lessons

**The duplicate-piece bug and its fix.**
- **Cause:** the director stored one square per piece and moved it to the destination the moment a move was played. The board layer redrew the piece there immediately, while the companion was still flying over. When she grabbed it, a second, airborne copy was added without the board being redrawn, so both showed at once.
- **Fix:** each piece now has a logical square (authoritative, updated immediately) and a separate visual owner: `square`, `tray` or `anim` (`src/chess/director.ts`). Two private methods are the only places the owner changes:
  - `take()`: the animation takes the piece at its current spot.
  - `land()`: the piece goes back to the board at its logical square.
- **What the view draws:** only what `visuals()` reports. Every piece appears exactly once, the source square stays occupied until the companion touches the piece, and the destination stays empty until it settles.
- **Captures:** a captured piece stays visible until it's knocked into the tray.
- **Resizing:** job positions are read from the live geometry every frame, so resizing mid-move keeps the piece in the companion's hands.
- **Tests:** `director.test.ts` checks this frame by frame for ordinary moves, captures, en passant, castling, promotion, rapid moves and resizing.

**Board materials** (`src/chess/materials.ts`, ⚙ → Board).
- **How they were chosen:** the tile sheets were found in the local install (`…/Terraria.app/Contents/Resources/Content/Images`, 765 `Tiles_*` sheets) through the app's own locator, then 60 candidates were decoded with `examples/terraria_textures.rs` and compared by average colour.
- **Presets** (squares, frame):

  | Preset | Light squares | Dark squares | Frame |
  | --- | --- | --- | --- |
  | Marble & Mahogany (default) | Marble Block | Rich Mahogany | Wood |
  | Snow & Stone Brick | Snow Brick | Gray Brick | Obsidian Brick |
  | Sandstone & Dungeon | Sandstone Brick | Blue Dungeon Brick | Obsidian Brick |
  | Pearlstone & Red Brick | Pearlstone Brick | Red Brick | Living Wood |
  | Ice & Cobalt | Ice Brick | Cobalt Brick | Gray Brick |
  | Candy Cane | Green Candy Cane | Red Candy Cane | Wood |

- **Contrast:** every pair differs by at least 55 in luminance. The measured average colours are also the fallback when the install isn't available. Black pieces have a light rim so they read on any dark square.
- **Other assets:** the chair is the wooden chair from `Tiles_15`, the torches are `Item_8`, and nothing is copied into the repo.

**Moving it.** Drag the panel strip (the bar with the status and buttons) like a window's title bar; the buttons in it still work. When the board is lifted off the floor, its supporters stand on a wooden shelf under it. Double-click the panel to put the board back in its default spot. The position is saved (`chess.x`/`chess.y`, fractions of the free space; -1 = default).

**Size.**
- Drag the gold corner grip to resize. The board stays square, centred and resting on the floor.
- ⤢ maximizes it to the largest board that fits, and ⤡ restores the previous size.
- The size, maximized state, material and mode are saved in prefs (`chess`).

**Play your companion** (⚙ → Mode → "vs …").
- **Opponent:** the selected companion plays the other side from a chair beside the board, labelled "Opponent". The others support you from your side.
- **Turns:** she thinks (a "thinking…" status and the occasional line in her own voice), then flies over and pushes or throws her own piece, just as supporters do. You can't move her pieces or move twice in a row.
- **Engine** (`src/chess/ai.ts`): alpha-beta search with iterative deepening, quiescence and piece-square tables, on top of the full rules engine. It runs in a Web Worker under a time and node budget (Easy, Normal or Hard), with an inline fallback. Restarting, switching mode or closing cancels a pending answer.
- **Opponent changes:** if the selected companion changes or she's hidden or paused, the game pauses and asks who to play. It never silently picks someone else.
- **Colour:** you can play White or Black. Playing Black flips the board.

**Turning the board around** (⇅ in the panel strip, or "flip the board" / "turn the board
around"). A card flip of about half a second: the squares and the pieces on them squash to a
line, the view switches to the other side halfway, and they open out again, easing in and out.
The frame, torches and captured-piece trays stay put, and the supporters move to their new sides.
It happens on its own when you play Black (your pieces start at the bottom), and each new game
starts from your own side. Clicks wait until it's done; with reduced motion it's instant.

**Opening lessons** (⚙ → Mode → Opening lessons; `src/chess/openings.ts`).
- **Openings:** the London System (three replies: …d5/…c5, a King's Indian set-up, early …Qb6), Italian, Ruy Lopez, Queen's Gambit, Sicilian, French, Caro-Kann and King's Indian. Each has variations for the opponent's common answers, and every line is checked as legal by tests.
- **How it plays:** the tutor (your selected companion) plays the opponent's moves. The card explains every move and how the plan changes against that reply.
- **Wrong moves:** they're refused with the reason. *Hint* outlines the book move.
- **At the end:** try another reply, or keep playing her from that position.

## Movement modes

Set them by voice or text, or in Character tab → *Movement*. They're saved in prefs (`characters.behavior`), and *Reset movement to default* or "reset your movement" undoes them all.

| Say | Effect |
| --- | --- |
| "spread out a bit", "don't bunch up" | When another companion is on the same surface, they prefer jumping to a free window top, block or invisible line. There's no fixed spacing, and conversations, chess and cuddles still bring them together. "stay together" turns it off. |
| "be more jumpy", "jump around more" | More purposeful platform jumps, all physics-verified to land. Cooldowns and a rest after a streak of four keep it from looping, and they turn back at ledges instead of dropping to the ground. |
| "stay grounded", "stop jumping so much" | Optional jumps become rare and only go downward. They walk off ledges and drop through invisible lines sooner. Necessary movement is unaffected. |
| "go watch from platform 2", "hang out on the top platform", "pick a hangout spot" | One invisible platform becomes the hangout, chosen by number, ordinal, or place (left / right / top / bottom / middle). If the request is unclear, numbered badges appear on screen to click. Companions make their way there, using stepping stones when needed, then alternate 10 s sitting side by side with 6 s cuddling in pairs. With no invisible platforms she explains instead of inventing one. A moved hangout line stays the hangout, and a deleted one is dropped. "stop hanging out on the platform" ends it. |

- **Unreachable hangouts:** if nobody can find a way up to the hangout (for example, a line near the top of the screen with no stepping stones), each companion gives up after 20 s without progress, roams normally for a minute, then tries again. The selected one says once that she can't reach it.
- **Model guesses are checked per action:** "jump" in a request no longer lets the local model pick "hang out on a platform" without asking. Each movement action needs its own words (for example "hang out", "platform" or "watch from" for Watch). That earlier mismatch is what sent everyone to a corner.
- **Combinations:** spread and watch work together (spread doesn't apply on the hangout). Jumpy and grounded only change jumping, and "normal" uses the AI's original constants exactly.
- **Who follows the modes:** Stay-Put keeps the selected companion in place, while the others still follow the modes. Control mode, chess and conversations take priority.
- **Not a command:** first-person remarks ("I jump around a lot"), "watch out", and anything mentioning editing or settings aren't treated as commands. There are no shell commands.

## Inventory scrolling: the actual cause

- **What was ruled out:** the scroll container itself was fine. In WebKit (an in-process WKWebView harness sending real wheel and trackpad-phase events) every tab of the real built inventory scrolled to the bottom.
- **The cause:** the overlay is a full-screen, always-on-top window. It stops being click-through wherever a character, buddy, cookie or menu is, and whenever a drag capture flag is set. The inventory is a normal window underneath it. So when a roaming character overlapped the inventory, or a capture flag stayed set, the overlay received the wheel events and its document can't scroll.
- **Fixes:**
  - The hover watcher (`spawn_hover_watcher`, `hit::overlay_interactive`) now keeps the overlay click-through whenever the cursor is over the visible inventory or chat window. It never flips state in the middle of a mouse press, so drags keep their target.
  - The overlay's global `html { overflow: hidden }` rule is now scoped to the overlay window.
  - The inventory is a fixed-height scroll container with `overscroll-behavior: contain`, and its header and tabs stay pinned.
  - The Letter Destroyer's code box no longer scrolls on its own. It's copy-only, and it was trapping wheel and trackpad gestures that should have scrolled the page.

## Companion and Inventory tab layout

- **Clipping** (cause found by measuring in WebKit):
  - The dock's stylesheet had unscoped generic rules (`.slot`, `.grip`, `.name`…), and every window loads the same bundle. Its `.slot { height: var(--slot) }` collapsed the inventory's item slots to 16 px and hid the lower rows. `dock.css` is now scoped to the dock window, and the inventory's own slot background (which had been cancelled by a stray `background-color`) is fixed.
  - The Companion tab's `1fr 1fr` grid let long content widen the right column past the window. It now uses balanced CSS columns (two at the default size, one or three as the window narrows or widens), with `min-width: 0` and capped selects.
- **Empty space:** grid rows stretched short panels (Sound) and the item details box to their neighbours' height. Panels now keep their natural height; the Companion tab is 12% shorter with nothing removed.
- **Resizable window:** the inventory window can now be resized (minimum 480×420). At 480, 620 and 900 px wide no tab overflows or clips.

## Performance (no behaviour changes)

- Buddies redraw their canvas only when the frame, facing, attack progress, size or rig changes. Before, they cleared and redrew every frame. Their transform and opacity styles are only written when they change.
- Speech bubbles (main and buddies) are measured once per line instead of reading `offsetWidth`/`offsetHeight` every frame, which forced a synchronous layout. Their position styles are only written when they change.
- The chess board is redrawn only when the position, selection or art changes. Pieces in flight use a separate layer that's drawn only while something moves.

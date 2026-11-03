# Letter Destroyer bookmarklet

A bookmarklet that makes letters and small page elements fly off the screen when you click
them. Install it from Inventory → **Companion** → *Letter Destroyer bookmarklet*. Either drag the
★ link to the bookmarks bar, or copy the code and paste it as a bookmark's URL.

## Behaviour (`desktop/src/bookmarklet/destroyer.js`)

**Clicking:**
- **Text:** the clicked letter and its neighbours within about 34 px fly off with gravity, spin
  and an upward kick.
- **Small elements** (icons, buttons, images): the whole element flies.
- **Large blocks:** not thrown whole; only their letters are.
- While it's on, clicks smash instead of following links or pressing buttons.

**Restoring the page:**
- Hidden originals keep their layout (`visibility: hidden`) until restored.
- Turning it off (Esc, the HUD's ×, clicking the bookmarklet again, or leaving the page) puts back
  every letter and element, newest first, and removes the injected layer, HUD and all listeners.
- Refreshing the page always restores everything, because nothing is stored.

**What it never touches:** URLs, bookmarks, storage, cookies and settings.

**Isolation:** the HUD and the flying pieces live in a closed shadow root, so page styles can't
interfere. Up to 500 pieces can be in the air at once.

**Pages where it doesn't run:** browsers don't run bookmarklets on chrome:// pages, the new-tab
page, extension stores, or the built-in PDF viewer.
- Cross-origin iframes can't be reached inside, but they fly as a whole box.
- Text drawn into a canvas or an image can only fly as the whole element.

## Desktop buddy link (`desktop/src-tauri/src/destroyer_link.rs`)

**What gets sent:** if the app is running, the bookmarklet POSTs `{event, count}` to
`http://127.0.0.1:47833/destroyer`:
- the events are `on`, `smash` and `off`
- page text and URLs are never sent

**How the app handles it:**
- The listener binds to the loopback address only.
- It accepts only that request shape, returns no data, and rate-limits to 20 events per 2 s.
- It answers the browser's private-network preflight.
- It can be turned off with *Let the bookmarklet tell my companion…*.

**How the buddy reacts:** it greets you, cheers for smashes (at most every 6 s, louder for big
combos), and says goodbye when the page is restored. Quiet mode's "hide speech bubbles" option
applies.

**Browser permission:** some browsers ask before a page may talk to a local address ("local
network access"). If that's denied, or the app isn't running, the effect still works on its own.

## The companion's pickaxe uses it

The pickaxe no longer draws its own glyphs.

**What happens on a strike:**
1. The Copper Pickaxe strikes with the pointer within reach of the companion's hand (340 px).
2. The app queues a strike at that screen position (`destroyer_strike`, global points).
3. Any page with the Letter Destroyer active polls `GET /destroyer/strikes` about every 150 ms.
4. That page converts the point to its own coordinates, accounting for window position, browser
   toolbars and page zoom.
5. If the point is inside the page and the tab is visible, it shows a ring and smashes there
   exactly like a click.

**Limits:**
- Strikes expire after 1.5 s and are never replayed to a page that starts listening later.
- If no page is listening, the companion says so at most every 45 s, and the swing just shows its
  impact burst.
- The *Smash letters on webpages* checkbox (Companion → Pickaxe) turns strikes off.

**Accuracy:** the conversion assumes a standard macOS browser window (no side borders). Unusual
window chrome or overlapping browser windows can shift or duplicate where a strike lands.

## Tests

| File | What it covers |
| --- | --- |
| `bookmarklet/destroyer.test.ts` | Physics, letter selection, element policy, exact restore including repeated smashes, the payload containing no page data, valid self-contained `javascript:` packaging, and only contacting 127.0.0.1 |
| `bookmarklet/buddy.test.ts` | The buddy's reactions and their rate limit |
| `destroyer_link.rs` | Request parsing, event validation, response headers, rate limiting, and the strike queue (new strikes once, never stale or replayed) |
| `destroyer.test.ts`, screen-to-page cases | The toolbar offset, page zoom, and ignoring points outside the page |

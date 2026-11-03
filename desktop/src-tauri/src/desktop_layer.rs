//! The background world as a desktop layer (macOS).
//!
//! * **Level:** the world window sits at the desktop window level: above the wallpaper, under
//!   Finder's desktop icons, the desktop widgets and every app window. It never takes clicks or
//!   keys itself (macOS would hand them to Finder's icon layer first anyway).
//! * **Input:** an event tap watches what's aimed at the *bare* desktop (no window, icon or widget
//!   under the pointer) and forwards it to the world window as synthetic DOM events:
//!   - always, while the world is shown: a drag or scroll with the pan chord held (default ⌥⌘)
//!     moves the view. Finder still gets the drag too (its selection rectangle shows), so this
//!     only watches, which needs no permission.
//!   - while exploring or playing: clicks, drags and scrolls on the bare desktop go to the world
//!     instead of Finder, and so do the keys once you've clicked it (until you click something
//!     else or switch apps). Taking input away from Finder needs Accessibility permission;
//!     without it, exploring and playing don't start (see `accessibility_trusted`).
//! * **Never paused:** WebKit suspends timers and animation frames in covered windows; that's
//!   turned off for the world and overlay webviews so the world and the waifus keep running.

#[cfg(target_os = "macos")]
pub use macos::*;

/// Modifier names as saved in prefs, and their Core Graphics flag bits.
pub const MODIFIERS: [(&str, u64); 4] = [("Control", 0x40000), ("Option", 0x80000), ("Shift", 0x20000), ("Command", 0x100000)];
const ALL_MODS: u64 = 0x40000 | 0x80000 | 0x20000 | 0x100000;

/// The flag bits of a saved chord (unknown names are ignored; empty = no chord).
pub fn chord_flags(names: &[String]) -> u64 {
    names.iter().filter_map(|n| MODIFIERS.iter().find(|(m, _)| m == n).map(|(_, f)| *f)).fold(0, |a, f| a | f)
}

/// Exactly the chord's modifiers are held (extra ones mean a different gesture, e.g. ⇧⌥⌘).
pub fn chord_held(flags: u64, chord: u64) -> bool {
    chord != 0 && flags & ALL_MODS == chord
}

/// DOM `code` and `key` for a macOS virtual key code (ANSI layout), or None for keys the world
/// doesn't use.
pub fn dom_key(keycode: u16, shift: bool) -> Option<(&'static str, String)> {
    const LETTERS: [(u16, char); 26] = [
        (0, 'a'), (11, 'b'), (8, 'c'), (2, 'd'), (14, 'e'), (3, 'f'), (5, 'g'), (4, 'h'), (34, 'i'), (38, 'j'), (40, 'k'), (37, 'l'), (46, 'm'),
        (45, 'n'), (31, 'o'), (35, 'p'), (12, 'q'), (15, 'r'), (1, 's'), (17, 't'), (32, 'u'), (9, 'v'), (13, 'w'), (7, 'x'), (16, 'y'), (6, 'z'),
    ];
    const CODES: [&str; 26] = [
        "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR",
        "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
    ];
    if let Some(i) = LETTERS.iter().position(|(k, _)| *k == keycode) {
        let c = LETTERS[i].1;
        return Some((CODES[i], if shift { c.to_ascii_uppercase() } else { c }.to_string()));
    }
    const DIGITS: [(u16, &str, &str, &str); 10] = [
        (29, "Digit0", "0", ")"), (18, "Digit1", "1", "!"), (19, "Digit2", "2", "@"), (20, "Digit3", "3", "#"), (21, "Digit4", "4", "$"),
        (23, "Digit5", "5", "%"), (22, "Digit6", "6", "^"), (26, "Digit7", "7", "&"), (28, "Digit8", "8", "*"), (25, "Digit9", "9", "("),
    ];
    if let Some((_, code, plain, shifted)) = DIGITS.iter().find(|(k, ..)| *k == keycode) {
        return Some((code, if shift { shifted } else { plain }.to_string()));
    }
    let (code, plain, shifted) = match keycode {
        49 => ("Space", " ", " "),
        36 => ("Enter", "Enter", "Enter"),
        48 => ("Tab", "Tab", "Tab"),
        53 => ("Escape", "Escape", "Escape"),
        51 => ("Backspace", "Backspace", "Backspace"),
        123 => ("ArrowLeft", "ArrowLeft", "ArrowLeft"),
        124 => ("ArrowRight", "ArrowRight", "ArrowRight"),
        125 => ("ArrowDown", "ArrowDown", "ArrowDown"),
        126 => ("ArrowUp", "ArrowUp", "ArrowUp"),
        115 => ("Home", "Home", "Home"),
        24 => ("Equal", "=", "+"),
        27 => ("Minus", "-", "_"),
        69 => ("NumpadAdd", "+", "+"),
        78 => ("NumpadSubtract", "-", "-"),
        43 => ("Comma", ",", "<"),
        47 => ("Period", ".", ">"),
        44 => ("Slash", "/", "?"),
        41 => ("Semicolon", ";", ":"),
        39 => ("Quote", "'", "\""),
        33 => ("BracketLeft", "[", "{"),
        30 => ("BracketRight", "]", "}"),
        50 => ("Backquote", "`", "~"),
        _ => return None,
    };
    Some((code, if shift { shifted } else { plain }.to_string()))
}

/// Accessibility roles of Finder's desktop items (icons and their labels); anything else of
/// Finder's under the pointer is the bare desktop.
pub fn is_icon_role(role: &str) -> bool {
    matches!(role, "AXImage" | "AXTextField" | "AXStaticText" | "AXButton" | "AXCell" | "AXRow" | "AXIcon")
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{chord_held, dom_key, is_icon_role};
    use crate::{windows, AppState, AMBIENT};
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    type Id = *mut c_void;
    type Sel = *mut c_void;
    type Ref = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGPoint,
    }

    type TapCallback = unsafe extern "C" fn(proxy: Ref, ty: u32, event: Ref, user: *mut c_void) -> Ref;

    #[link(name = "objc")]
    unsafe extern "C" {
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventTapCreate(tap: u32, place: u32, options: u32, mask: u64, cb: TapCallback, user: *mut c_void) -> Ref;
        fn CGEventTapEnable(tap: Ref, enable: bool);
        fn CGEventGetLocation(e: Ref) -> CGPoint;
        fn CGEventGetFlags(e: Ref) -> u64;
        fn CGEventGetIntegerValueField(e: Ref, field: u32) -> i64;
        fn CGEventGetDoubleValueField(e: Ref, field: u32) -> f64;
        fn CGWindowLevelForKey(key: i32) -> i32;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGEventCreateKeyboardEvent(source: Ref, key: u16, down: bool) -> Ref;
        fn CGEventSetFlags(e: Ref, flags: u64);
        fn CGEventPost(tap: u32, e: Ref);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFRunLoopDefaultMode: Ref;
        fn CFMachPortCreateRunLoopSource(alloc: Ref, port: Ref, order: isize) -> Ref;
        fn CFMachPortInvalidate(port: Ref);
        fn CFRunLoopGetCurrent() -> Ref;
        fn CFRunLoopAddSource(rl: Ref, source: Ref, mode: Ref);
        fn CFRunLoopRemoveSource(rl: Ref, source: Ref, mode: Ref);
        fn CFRunLoopRunInMode(mode: Ref, seconds: f64, return_after_source: bool) -> i32;
        fn CFRelease(p: *const c_void);
        fn CFStringCreateWithCString(alloc: Ref, s: *const c_char, encoding: u32) -> Ref;
        fn CFStringGetCString(s: Ref, buf: *mut c_char, size: isize, encoding: u32) -> bool;
        fn CFGetTypeID(p: Ref) -> usize;
        fn CFStringGetTypeID() -> usize;
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> Ref;
        fn AXUIElementCopyElementAtPosition(app: Ref, x: f32, y: f32, out: *mut Ref) -> i32;
        fn AXUIElementCopyAttributeValue(el: Ref, attr: Ref, out: *mut Ref) -> i32;
        fn AXUIElementGetPid(el: Ref, pid: *mut i32) -> i32;
        fn AXUIElementSetMessagingTimeout(el: Ref, seconds: f32) -> i32;
        fn AXUIElementIsAttributeSettable(el: Ref, attr: Ref, settable: *mut bool) -> i32;
    }

    const UTF8: u32 = 0x0800_0100;
    const SESSION_TAP: u32 = 1;
    const HEAD_INSERT: u32 = 0;
    const DEFAULT_TAP: u32 = 0;
    const LISTEN_ONLY: u32 = 1;
    const DESKTOP_LEVEL_KEY: i32 = 2;
    const DESKTOP_ICON_LEVEL_KEY: i32 = 18;

    const LEFT_DOWN: u32 = 1;
    const LEFT_UP: u32 = 2;
    const RIGHT_DOWN: u32 = 3;
    const RIGHT_UP: u32 = 4;
    const MOVED: u32 = 5;
    const LEFT_DRAGGED: u32 = 6;
    const RIGHT_DRAGGED: u32 = 7;
    const KEY_DOWN: u32 = 10;
    const KEY_UP: u32 = 11;
    const FLAGS_CHANGED: u32 = 12;
    const SCROLL: u32 = 22;
    const OTHER_DOWN: u32 = 25;
    const OTHER_UP: u32 = 26;
    const OTHER_DRAGGED: u32 = 27;
    const TAP_DISABLED_TIMEOUT: u32 = 0xFFFF_FFFE;
    const TAP_DISABLED_INPUT: u32 = 0xFFFF_FFFF;

    const FIELD_AUTOREPEAT: u32 = 8;
    const FIELD_KEYCODE: u32 = 9;
    const FIELD_SCROLL_POINT_Y: u32 = 96;
    const FIELD_SCROLL_POINT_X: u32 = 97;

    const SHIFT: u64 = 0x20000;
    const CONTROL: u64 = 0x40000;
    const OPTION: u64 = 0x80000;
    const COMMAND: u64 = 0x100000;

    fn sel(name: &CStr) -> Sel {
        unsafe { sel_registerName(name.as_ptr()) }
    }

    // ── Window level and throttling ─────────────────────────────────────────────────────────

    /// Put a window at the desktop level (above the wallpaper, under the icons), on every Space,
    /// out of ⌘` cycling and Mission Control's shuffle. Runs on the main thread.
    pub fn to_desktop_level(app: &AppHandle, win: &WebviewWindow) {
        let Ok(ns) = win.ns_window() else { return };
        let ns = ns as usize;
        let _ = app.run_on_main_thread(move || unsafe {
            let ns = ns as Id;
            let level = CGWindowLevelForKey(DESKTOP_LEVEL_KEY) as isize;
            let set_level: unsafe extern "C" fn(Id, Sel, isize) = std::mem::transmute(objc_msgSend as *const ());
            set_level(ns, sel(c"setLevel:"), level);
            let get: unsafe extern "C" fn(Id, Sel) -> usize = std::mem::transmute(objc_msgSend as *const ());
            let behavior = get(ns, sel(c"collectionBehavior"));
            // canJoinAllSpaces | stationary | ignoresCycle
            let set: unsafe extern "C" fn(Id, Sel, usize) = std::mem::transmute(objc_msgSend as *const ());
            set(ns, sel(c"setCollectionBehavior:"), behavior | 1 | (1 << 4) | (1 << 6));
        });
    }

    /// Put a window just below the menu bar's own window (above every app window), on every Space
    /// and over full-screen apps too. The menu bar is see-through, so what's drawn under it shows,
    /// while macOS keeps drawing the menu names and status icons on top. Click-through.
    pub fn to_menu_bar_level(app: &AppHandle, win: &WebviewWindow) {
        let Ok(ns) = win.ns_window() else { return };
        let ns = ns as usize;
        let _ = app.run_on_main_thread(move || unsafe {
            let ns = ns as Id;
            const UNDER_MENU_BAR: isize = 23; // NSMainMenuWindowLevel (24) - 1
            let set_level: unsafe extern "C" fn(Id, Sel, isize) = std::mem::transmute(objc_msgSend as *const ());
            set_level(ns, sel(c"setLevel:"), UNDER_MENU_BAR);
            let get: unsafe extern "C" fn(Id, Sel) -> usize = std::mem::transmute(objc_msgSend as *const ());
            let behavior = get(ns, sel(c"collectionBehavior"));
            // canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary
            let set: unsafe extern "C" fn(Id, Sel, usize) = std::mem::transmute(objc_msgSend as *const ());
            set(ns, sel(c"setCollectionBehavior:"), behavior | 1 | (1 << 4) | (1 << 6) | (1 << 8));
        });
    }

    /// Keep a webview's timers and animation frames running while its window is covered
    /// (WebKit's window-occlusion detection otherwise suspends them).
    pub fn keep_running_when_covered(win: &WebviewWindow) {
        let _ = win.with_webview(|w| unsafe {
            let wk = w.inner() as Id;
            if wk.is_null() {
                return;
            }
            let responds: unsafe extern "C" fn(Id, Sel, Sel) -> bool = std::mem::transmute(objc_msgSend as *const ());
            let s = sel(c"_setWindowOcclusionDetectionEnabled:");
            if responds(wk, sel(c"respondsToSelector:"), s) {
                let set: unsafe extern "C" fn(Id, Sel, bool) = std::mem::transmute(objc_msgSend as *const ());
                set(wk, s, false);
            }
        });
    }

    // ── Permission ──────────────────────────────────────────────────────────────────────────

    /// Accessibility permission (needed to take desktop clicks and keys away from Finder).
    pub fn accessibility_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    // ── Hit testing ─────────────────────────────────────────────────────────────────────────

    struct CfStr(Ref);
    impl CfStr {
        fn new(s: &CStr) -> Self {
            Self(unsafe { CFStringCreateWithCString(std::ptr::null_mut(), s.as_ptr(), UTF8) })
        }
    }
    impl Drop for CfStr {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0 as *const c_void) }
            }
        }
    }

    fn cf_string(r: Ref) -> Option<String> {
        if r.is_null() || unsafe { CFGetTypeID(r) != CFStringGetTypeID() } {
            return None;
        }
        let mut buf = [0 as c_char; 128];
        unsafe { CFStringGetCString(r, buf.as_mut_ptr(), buf.len() as isize, UTF8) }.then(|| unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())
    }

    /// The process and role of the accessibility element at a point (needs the permission).
    fn element_at(x: f64, y: f64) -> Option<(i32, String)> {
        let system = system_element();
        let mut el: Ref = std::ptr::null_mut();
        if unsafe { AXUIElementCopyElementAtPosition(system, x as f32, y as f32, &mut el) } != 0 || el.is_null() {
            return None;
        }
        let mut pid = 0;
        unsafe { AXUIElementGetPid(el, &mut pid) };
        let attr = CfStr::new(c"AXRole");
        let mut role: Ref = std::ptr::null_mut();
        let ok = unsafe { AXUIElementCopyAttributeValue(el, attr.0, &mut role) } == 0;
        let name = if ok { cf_string(role) } else { None };
        if !role.is_null() {
            unsafe { CFRelease(role as *const c_void) };
        }
        unsafe { CFRelease(el as *const c_void) };
        Some((pid, name.unwrap_or_default()))
    }

    fn system_element() -> Ref {
        static SYSTEM: OnceLock<usize> = OnceLock::new();
        *SYSTEM.get_or_init(|| unsafe {
            let s = AXUIElementCreateSystemWide();
            AXUIElementSetMessagingTimeout(s, 0.15);
            s as usize
        }) as Ref
    }

    /// Another app has a text field (or editable text) focused, so Wispr Flow will type there.
    /// Our own fields don't count (they're the companion's), and nothing is known without the
    /// Accessibility permission (false).
    pub fn text_field_focused_elsewhere() -> bool {
        let system = system_element();
        let focused = CfStr::new(c"AXFocusedUIElement");
        let mut el: Ref = std::ptr::null_mut();
        if unsafe { AXUIElementCopyAttributeValue(system, focused.0, &mut el) } != 0 || el.is_null() {
            return false;
        }
        let mut pid = 0;
        unsafe { AXUIElementGetPid(el, &mut pid) };
        let role_attr = CfStr::new(c"AXRole");
        let mut role: Ref = std::ptr::null_mut();
        let role_name = if unsafe { AXUIElementCopyAttributeValue(el, role_attr.0, &mut role) } == 0 { cf_string(role) } else { None };
        if !role.is_null() {
            unsafe { CFRelease(role as *const c_void) };
        }
        let range = CfStr::new(c"AXSelectedTextRange");
        let mut settable = false;
        let editable = unsafe { AXUIElementIsAttributeSettable(el, range.0, &mut settable) } == 0 && settable;
        unsafe { CFRelease(el as *const c_void) };
        pid != std::process::id() as i32 && (editable || matches!(role_name.as_deref(), Some("AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField")))
    }

    /// Press ⌘Z in the frontmost app (takes back what Wispr Flow just typed there). Needs the
    /// Accessibility permission; false without it.
    pub fn post_undo() -> bool {
        if !accessibility_trusted() {
            return false;
        }
        const KEY_Z: u16 = 6;
        unsafe {
            for down in [true, false] {
                let e = CGEventCreateKeyboardEvent(std::ptr::null_mut(), KEY_Z, down);
                if e.is_null() {
                    return false;
                }
                CGEventSetFlags(e, COMMAND);
                CGEventPost(0, e);
                CFRelease(e as *const c_void);
            }
        }
        true
    }

    /// Nothing but the desktop under this point (global display points): no other app's window,
    /// none of ours that takes the pointer, no desktop icon and no widget.
    fn bare_desktop(x: f64, y: f64, overlay_hot: bool, check_icons: bool) -> bool {
        let own = std::process::id() as i32;
        let icons = unsafe { CGWindowLevelForKey(DESKTOP_ICON_LEVEL_KEY) } as i64;
        let main = unsafe { CGDisplayBounds(CGMainDisplayID()) };
        for w in windows::list_windows() {
            if !(x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) || w.layer <= icons + 1 || w.alpha < 0.01 {
                continue;
            }
            if w.pid != own {
                return false;
            }
            // Ours: the panels block; the full-screen overlay only where a companion takes the pointer.
            let full = w.w >= main.size.x - 1.0 && w.h >= main.size.y - 50.0;
            if !full || overlay_hot {
                return false;
            }
        }
        if !check_icons {
            return true;
        }
        match element_at(x, y) {
            None => true,
            Some((pid, _)) if pid == own => true,
            Some((pid, role)) => is_finder(pid) && !is_icon_role(&role),
        }
    }

    fn is_finder(pid: i32) -> bool {
        static FINDER: AtomicU64 = AtomicU64::new(0);
        let cached = FINDER.load(Ordering::Relaxed);
        if cached != 0 && cached as i32 == pid {
            return true;
        }
        let is = crate::apps::running_apps().iter().any(|a| a.pid == pid && a.bundle_id == "com.apple.finder");
        if is {
            FINDER.store(pid as u64, Ordering::Relaxed);
        }
        is
    }

    // ── The tap ─────────────────────────────────────────────────────────────────────────────

    #[derive(Default)]
    struct Tap {
        /// A press started on the world: its drags and release go there too.
        capture: bool,
        /// A pan-chord drag of the passive world in progress (Finder sees it too).
        pan: bool,
        /// Keys go to the world (you clicked it, and haven't clicked elsewhere or switched apps).
        focused: bool,
        focus_pid: i32,
        /// Scroll events come in bursts: hit-test once per burst.
        scroll: Option<(Instant, f64, f64, bool)>,
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static TAP: Mutex<Option<Tap>> = Mutex::new(None);
    /// The current tap's mach port (to re-enable it after a timeout), as usize.
    static PORT: AtomicU64 = AtomicU64::new(0);
    /// The tap can take events away (Accessibility granted) rather than only watch.
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    /// A companion under the pointer takes it (the overlay isn't click-through there).
    pub static OVERLAY_HOT: AtomicBool = AtomicBool::new(false);
    /// Wispr Flow's push-to-talk / hands-free keys went down (voice input hooks in here).
    pub type KeyHook = fn(&AppHandle, u32, u16, u64);
    static KEY_HOOK: OnceLock<KeyHook> = OnceLock::new();

    pub fn set_key_hook(hook: KeyHook) {
        let _ = KEY_HOOK.set(hook);
    }

    /// What the world is doing right now: (shown, exploring or playing, pan chord flags).
    fn mode(app: &AppHandle) -> (bool, bool, u64) {
        let state = app.state::<AppState>();
        let interactive = state.world_nav.load(Ordering::Relaxed) || state.world_play.load(Ordering::Relaxed);
        let p = state.prefs.lock().unwrap();
        let shown = p.visible && p.world.enabled;
        let chord = if p.world.drag { super::chord_flags(&p.world.pan_chord) } else { 0 };
        (shown, interactive, chord)
    }

    fn frontmost_pid() -> i32 {
        crate::apps::frontmost().map(|a| a.pid).unwrap_or(0)
    }

    /// Hand an input event to the world window (as a synthetic DOM event; see Ambient.tsx).
    fn send(app: &AppHandle, payload: serde_json::Value) {
        let _ = app.emit_to(AMBIENT, "companion://world-input", payload);
    }

    fn mods(flags: u64) -> serde_json::Value {
        serde_json::json!({ "shift": flags & SHIFT != 0, "alt": flags & OPTION != 0, "ctrl": flags & CONTROL != 0, "meta": flags & COMMAND != 0 })
    }

    fn button_of(ty: u32) -> u8 {
        match ty {
            LEFT_DOWN | LEFT_UP | LEFT_DRAGGED => 0,
            RIGHT_DOWN | RIGHT_UP | RIGHT_DRAGGED => 2,
            _ => 1,
        }
    }

    /// Ambient-window CSS px for a global point (the window covers the primary display).
    fn local(app: &AppHandle, p: CGPoint) -> (f64, f64) {
        static ORIGIN: Mutex<Option<(Instant, f64, f64)>> = Mutex::new(None);
        let mut o = ORIGIN.lock().unwrap();
        if o.is_none_or(|(at, ..)| at.elapsed() > Duration::from_secs(2)) {
            let origin = app
                .get_webview_window(AMBIENT)
                .and_then(|w| Some((w.outer_position().ok()?, w.scale_factor().ok()?)))
                .map(|(pos, s)| (pos.x as f64 / s, pos.y as f64 / s))
                .unwrap_or((0.0, 0.0));
            *o = Some((Instant::now(), origin.0, origin.1));
        }
        let (_, ox, oy) = o.unwrap();
        (p.x - ox, p.y - oy)
    }

    unsafe extern "C" fn callback(_proxy: Ref, ty: u32, event: Ref, _user: *mut c_void) -> Ref {
        if ty == TAP_DISABLED_TIMEOUT || ty == TAP_DISABLED_INPUT {
            let port = PORT.load(Ordering::Relaxed) as usize as Ref;
            if !port.is_null() {
                unsafe { CGEventTapEnable(port, true) };
            }
            return event;
        }
        let Some(app) = APP.get() else { return event };
        if matches!(ty, MOVED | LEFT_DRAGGED | RIGHT_DRAGGED | OTHER_DRAGGED) {
            stream_pointer(app, event);
        }
        let flags = unsafe { CGEventGetFlags(event) };
        if matches!(ty, KEY_DOWN | KEY_UP | FLAGS_CHANGED) {
            let code = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) } as u16;
            if let Some(hook) = KEY_HOOK.get() {
                hook(app, ty, code, flags);
            }
        }
        let swallow = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle(app, ty, event, flags))).unwrap_or(false);
        if swallow && ACTIVE.load(Ordering::Relaxed) { std::ptr::null_mut() } else { event }
    }

    /// The chess map's dust swirls around the pointer: its position goes to the theme windows
    /// (about 30 times a second, only while that map is showing). Watching the pointer needs no
    /// permission.
    fn stream_pointer(app: &AppHandle, event: Ref) {
        static LAST: Mutex<Option<Instant>> = Mutex::new(None);
        let mut last = LAST.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_millis(33)) {
            return;
        }
        let on = {
            let state = app.state::<AppState>();
            let p = state.prefs.lock().unwrap();
            p.visible && p.theme.enabled && p.theme.map == "chess"
        };
        if !on {
            return;
        }
        *last = Some(Instant::now());
        drop(last);
        let (x, y) = local(app, unsafe { CGEventGetLocation(event) });
        for label in [AMBIENT, crate::DECOR] {
            let _ = app.emit_to(label, "companion://pointer", serde_json::json!({ "x": x, "y": y }));
        }
    }

    /// Route one event; true = it was the world's (take it away from Finder).
    fn handle(app: &AppHandle, ty: u32, event: Ref, flags: u64) -> bool {
        let (shown, interactive, chord) = mode(app);
        let active = ACTIVE.load(Ordering::Relaxed);
        let mut guard = TAP.lock().unwrap();
        let tap = guard.get_or_insert_with(Tap::default);
        if !shown {
            *tap = Tap::default();
            return false;
        }
        let at = unsafe { CGEventGetLocation(event) };
        let hot = OVERLAY_HOT.load(Ordering::Relaxed);
        let takes = interactive && active;
        match ty {
            LEFT_DOWN | RIGHT_DOWN | OTHER_DOWN => {
                if takes {
                    if bare_desktop(at.x, at.y, hot, true) {
                        tap.capture = true;
                        tap.focused = true;
                        tap.focus_pid = frontmost_pid();
                        let (x, y) = local(app, at);
                        send(app, serde_json::json!({ "t": "down", "x": x, "y": y, "button": button_of(ty), "mods": mods(flags) }));
                        return true;
                    }
                    if std::mem::take(&mut tap.focused) {
                        send(app, serde_json::json!({ "t": "blur" }));
                    }
                } else if ty == LEFT_DOWN && chord_held(flags, chord) && !interactive && bare_desktop(at.x, at.y, hot, active) {
                    tap.pan = true;
                    let (x, y) = local(app, at);
                    // No modifiers: the chord means "pan", not "zoom" or "paint".
                    send(app, serde_json::json!({ "t": "down", "x": x, "y": y, "button": 0, "mods": mods(0), "pan": true }));
                }
                false
            }
            LEFT_DRAGGED | RIGHT_DRAGGED | OTHER_DRAGGED | MOVED => {
                if tap.capture || tap.pan || (takes && tap.focused && ty == MOVED) {
                    let (x, y) = local(app, at);
                    send(app, serde_json::json!({ "t": "move", "x": x, "y": y, "button": button_of(ty), "mods": mods(if tap.pan { 0 } else { flags }) }));
                    return tap.capture;
                }
                false
            }
            LEFT_UP | RIGHT_UP | OTHER_UP => {
                if tap.capture || tap.pan {
                    let (x, y) = local(app, at);
                    send(app, serde_json::json!({ "t": "up", "x": x, "y": y, "button": button_of(ty), "mods": mods(if tap.pan { 0 } else { flags }) }));
                    let took = tap.capture;
                    tap.capture = false;
                    tap.pan = false;
                    return took;
                }
                false
            }
            SCROLL => {
                let pan = !interactive && chord_held(flags, chord);
                if !takes && !pan {
                    return false;
                }
                let bare = match tap.scroll {
                    Some((when, x, y, bare)) if when.elapsed() < Duration::from_millis(200) && (x - at.x).abs() < 40.0 && (y - at.y).abs() < 40.0 => bare,
                    _ => bare_desktop(at.x, at.y, hot, active),
                };
                tap.scroll = Some((Instant::now(), at.x, at.y, bare));
                if !bare {
                    return false;
                }
                let dy = -unsafe { CGEventGetDoubleValueField(event, FIELD_SCROLL_POINT_Y) };
                let dx = -unsafe { CGEventGetDoubleValueField(event, FIELD_SCROLL_POINT_X) };
                let (x, y) = local(app, at);
                send(app, serde_json::json!({ "t": "wheel", "x": x, "y": y, "dx": dx, "dy": dy, "mods": mods(if pan { 0 } else { flags }) }));
                takes
            }
            KEY_DOWN | KEY_UP => {
                if !(takes && tap.focused) {
                    return false;
                }
                // Switched apps since (⌘-Tab, a click in the Dock...): the keys are that app's again.
                if frontmost_pid() != tap.focus_pid {
                    tap.focused = false;
                    send(app, serde_json::json!({ "t": "blur" }));
                    return false;
                }
                // ⌘ shortcuts stay the system's (⌘-Tab, ⌘-Space, ⌘-Q...).
                if flags & COMMAND != 0 {
                    return false;
                }
                let code = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) } as u16;
                let Some((code, key)) = dom_key(code, flags & SHIFT != 0) else { return false };
                let repeat = unsafe { CGEventGetIntegerValueField(event, FIELD_AUTOREPEAT) } != 0;
                send(app, serde_json::json!({ "t": if ty == KEY_DOWN { "keydown" } else { "keyup" }, "code": code, "key": key, "repeat": repeat, "mods": mods(flags) }));
                true
            }
            _ => false,
        }
    }

    fn mask(types: &[u32]) -> u64 {
        types.iter().fold(0, |m, t| m | (1u64 << t))
    }

    /// Start the tap thread. It runs an active tap once Accessibility is granted (re-checked
    /// every couple of seconds), and a watch-only one (pan chord) until then.
    pub fn start(app: AppHandle) {
        if APP.set(app).is_err() {
            return;
        }
        std::thread::spawn(|| {
            let mouse = mask(&[LEFT_DOWN, LEFT_UP, RIGHT_DOWN, RIGHT_UP, MOVED, LEFT_DRAGGED, RIGHT_DRAGGED, SCROLL, OTHER_DOWN, OTHER_UP, OTHER_DRAGGED]);
            let keys = mask(&[KEY_DOWN, KEY_UP, FLAGS_CHANGED]);
            loop {
                let trusted = accessibility_trusted();
                let port = unsafe { CGEventTapCreate(SESSION_TAP, HEAD_INSERT, if trusted { DEFAULT_TAP } else { LISTEN_ONLY }, mouse | keys, callback, std::ptr::null_mut()) };
                if port.is_null() {
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
                ACTIVE.store(trusted, Ordering::Relaxed);
                PORT.store(port as usize as u64, Ordering::Relaxed);
                unsafe {
                    let source = CFMachPortCreateRunLoopSource(std::ptr::null_mut(), port, 0);
                    let rl = CFRunLoopGetCurrent();
                    CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);
                    CGEventTapEnable(port, true);
                    // Run until the permission changes, then rebuild the tap to match.
                    while accessibility_trusted() == trusted {
                        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 2.0, false);
                    }
                    PORT.store(0, Ordering::Relaxed);
                    CFRunLoopRemoveSource(rl, source, kCFRunLoopDefaultMode);
                    CFMachPortInvalidate(port);
                    CFRelease(source as *const c_void);
                    CFRelease(port as *const c_void);
                }
                *TAP.lock().unwrap() = None;
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod other {
    use tauri::{AppHandle, WebviewWindow};
    pub fn to_desktop_level(_app: &AppHandle, win: &WebviewWindow) {
        let _ = win.set_always_on_bottom(true);
    }
    pub fn keep_running_when_covered(_win: &WebviewWindow) {}
    pub fn to_menu_bar_level(_app: &AppHandle, win: &WebviewWindow) {
        let _ = win.set_always_on_top(true);
    }
    pub fn accessibility_trusted() -> bool {
        true
    }
    pub fn start(_app: AppHandle) {}
    pub fn text_field_focused_elsewhere() -> bool {
        false
    }
    pub fn post_undo() -> bool {
        false
    }
    pub static OVERLAY_HOT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    pub type KeyHook = fn(&AppHandle, u32, u16, u64);
    pub fn set_key_hook(_hook: KeyHook) {}
}
#[cfg(not(target_os = "macos"))]
pub use other::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chords() {
        let c = chord_flags(&["Option".into(), "Command".into(), "Nonsense".into()]);
        assert_eq!(c, 0x80000 | 0x100000);
        assert!(chord_held(0x80000 | 0x100000 | 0x100, c)); // device bits don't matter
        assert!(!chord_held(0x80000, c));
        assert!(!chord_held(0x80000 | 0x100000 | 0x20000, c)); // ⇧⌥⌘ is something else
        assert!(!chord_held(0, 0));
    }

    #[test]
    fn keys() {
        assert_eq!(dom_key(13, false), Some(("KeyW", "w".into())));
        assert_eq!(dom_key(13, true), Some(("KeyW", "W".into())));
        assert_eq!(dom_key(18, false), Some(("Digit1", "1".into())));
        assert_eq!(dom_key(53, false), Some(("Escape", "Escape".into())));
        assert_eq!(dom_key(24, true), Some(("Equal", "+".into())));
        assert_eq!(dom_key(49, false), Some(("Space", " ".into())));
        assert_eq!(dom_key(200, false), None);
    }

    #[test]
    fn icon_roles() {
        assert!(is_icon_role("AXImage"));
        assert!(is_icon_role("AXTextField"));
        assert!(!is_icon_role("AXScrollArea"));
        assert!(!is_icon_role("AXGroup"));
    }
}

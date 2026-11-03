pub mod ai;
pub mod apps;
mod chat_store;
mod combat;
pub mod cursor_hide;
mod desktop_layer;
mod dock;
pub mod terraria;
mod hit;
mod prefs;
pub mod screen;
pub mod voice;
mod destroyer_link;
mod notch_link;
pub mod terraria_app;
pub mod windows;
mod wispr;
mod study;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hit::Rect;
use prefs::{BossDifficulty, CompanionMode, CursorMode, DockPosition, IdleMode, IdlePose, Prefs, PrefsPatch};
use windows::PlatformWindow;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State,
    WebviewWindow, WindowEvent, Wry,
};

const OVERLAY: &str = "overlay";
const INVENTORY: &str = "inventory";
const DOCK: &str = "dock";
const CHAT: &str = "chat";
/// The compact inventory opened from the notch (CustomNotch's look), beside the notch.
const POUCH: &str = "pouch";
/// Full-screen, always click-through decoration layer (cherry-blossom theme), behind app windows.
const AMBIENT: &str = "ambient";
/// The theme decorations (garland, grass, petals / snow) when they go in front of app windows.
const DECOR: &str = "decor";
/// Each map's menu-bar band and top decorations (garland, snow and lights, chains and lanterns),
/// just under the menu bar's own window (its text draws on top); always click-through.
const CROWN: &str = "crown";

/// Foreground-app switches (bundle id + name only) for the overlay's reactions.
const APP_SWITCH_EVENT: &str = "companion://app-switch";
/// How often the frontmost app is sampled while awareness is on.
const APP_POLL: Duration = Duration::from_millis(500);
/// Quiet period after the dock stops moving before its position is saved.
const DOCK_SAVE_DELAY: Duration = Duration::from_millis(600);
/// How often the dock is re-checked against the (possibly changed) display layout.
const DOCK_GUARD_POLL: Duration = Duration::from_secs(2);
const PREFS_EVENT: &str = "companion://prefs";
const PLATFORMS_EVENT: &str = "companion://platforms";
const COMBAT_EVENT: &str = "companion://combat";
const CONTROL_EVENT: &str = "companion://control";
const BUILD_EVENT: &str = "companion://build";
const LINES_EVENT: &str = "companion://lines";
const SETTINGS_TAB_EVENT: &str = "companion://settings-tab";
/// The pouch was opened (it plays its entrance).
const POUCH_EVENT: &str = "companion://pouch";
/// Cursor position (overlay CSS px) streamed to the overlay while a cursor mode is active.
const CURSOR_EVENT: &str = "companion://cursor";
/// Window-geometry polling interval while the companion is active.
const PLATFORM_POLL: Duration = Duration::from_millis(100);
/// Slower check interval while hidden, paused or with platforms disabled.
const PLATFORM_IDLE_POLL: Duration = Duration::from_millis(500);
/// Extra CSS pixels around the character that still count as "over" it.
const HOVER_PAD: f64 = 4.0;
const HOVER_POLL: Duration = Duration::from_millis(16);
/// Slower cursor polling while the cursor is far from the character.
const HOVER_IDLE_POLL: Duration = Duration::from_millis(100);
/// Cursor distance (CSS px) from the character within which fast polling kicks in.
/// At 100 ms per poll a cursor would need to cross this in under 0.1 s to be missed.
const HOVER_NEAR: f64 = 150.0;
/// How many polls between refreshing the cached window origin and scale factor.
const GEOMETRY_REFRESH_TICKS: u32 = 30;
const OWN_FRAMES_REFRESH_TICKS: u32 = 4;
const SIZES: [(u32, &str); 3] = [(2, "Small"), (3, "Medium"), (4, "Large")];

struct AppState {
    prefs: Mutex<Prefs>,
    prefs_path: PathBuf,
    /// The character's interactive region in overlay CSS pixels, reported by the frontend.
    hitbox: Mutex<Option<Rect>>,
    /// Extra interactive rectangles away from the character (the cookie).
    hitbox_extra: Mutex<Vec<Rect>>,
    /// True while a drag is in progress, so the overlay keeps receiving mouse events
    /// even if the cursor briefly outruns the character.
    capture: AtomicBool,
    /// Last platform snapshot sent to the overlay (front-to-back, overlay CSS pixels).
    platforms: Mutex<Vec<PlatformWindow>>,
    /// "Control Character" mode: the overlay takes keyboard focus and all mouse input.
    control: AtomicBool,
    /// Bumped whenever control or build mode changes so the hover watcher re-applies click-through.
    control_epoch: AtomicU32,
    /// Build mode: the overlay takes the mouse so clicks place and remove blocks. Session-only.
    build: AtomicBool,
    /// Invisible-platform editing: like Build mode, the overlay takes the mouse. Session-only.
    lines: AtomicBool,
    /// Bumped on every dock move; a save runs only if no newer move arrived meanwhile.
    dock_move_gen: AtomicU64,
    /// The app that was in front before the companion's own windows (current value only, no
    /// history); used to honour exclusions for "Ask about my screen".
    last_external_app: Mutex<Option<apps::AppInfo>>,
    chat_history_path: PathBuf,
    /// The voice shortcut currently registered with macOS, and a status line for settings.
    voice_shortcut: Mutex<Option<String>>,
    voice_shortcut_status: Mutex<String>,
    control_shortcut: Mutex<Option<String>>,
    control_shortcut_status: Mutex<String>,
    build_shortcut: Mutex<Option<String>>,
    build_shortcut_status: Mutex<String>,
    lines_shortcut: Mutex<Option<String>>,
    lines_shortcut_status: Mutex<String>,
    cookie_shortcut: Mutex<Option<String>>,
    cookie_shortcut_status: Mutex<String>,
    /// While a new shortcut is being recorded in settings, every global shortcut is released so the
    /// keys reach the settings window (and don't trigger their old action).
    shortcuts_suspended: AtomicBool,
    destroyer_status: Mutex<String>,
    destroyer_strikes: Mutex<destroyer_link::Strikes>,
    /// The companion living in CustomNotch (if any), her messages, and where the notch is.
    notch: Arc<notch_link::Shared>,
    /// Exploring the background world: its window takes the mouse and keys. Session-only.
    world_nav: AtomicBool,
    /// The background-world game is running (your companion plays, or they build on their own).
    world_play: AtomicBool,
    /// A drag across the bare desktop is moving the world's view (companions don't take the pointer).
    world_drag: AtomicBool,
    /// Terrain edits for the background world (separate from prefs; can be large).
    world_path: PathBuf,
}

struct TrayItems {
    toggle_visible: MenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
    platforms: CheckMenuItem<Wry>,
    training: CheckMenuItem<Wry>,
    control: CheckMenuItem<Wry>,
    build: CheckMenuItem<Wry>,
    lines: CheckMenuItem<Wry>,
    modes: Vec<(CompanionMode, CheckMenuItem<Wry>)>,
    poses: Vec<(IdlePose, CheckMenuItem<Wry>)>,
    cursor_modes: Vec<(CursorMode, CheckMenuItem<Wry>)>,
    hide_cursor: CheckMenuItem<Wry>,
    difficulties: Vec<(BossDifficulty, CheckMenuItem<Wry>)>,
    letter_break: CheckMenuItem<Wry>,
    inventory: MenuItem<Wry>,
    dock: MenuItem<Wry>,
    rotate_poses: CheckMenuItem<Wry>,
    app_awareness: CheckMenuItem<Wry>,
    quiet: CheckMenuItem<Wry>,
    sizes: Vec<(u32, CheckMenuItem<Wry>)>,
    world: CheckMenuItem<Wry>,
}

/// Mutate, sanitize, persist and broadcast preferences, then sync windows and tray.
fn update_prefs(app: &AppHandle, f: impl FnOnce(&mut Prefs)) -> Prefs {
    let state = app.state::<AppState>();
    let prefs = {
        let mut guard = state.prefs.lock().unwrap();
        let before = guard.clone();
        f(&mut guard);
        *guard = guard.clone().sanitized();
        if *guard != before {
            if let Err(err) = prefs::save(&state.prefs_path, &guard) {
                eprintln!("failed to save preferences: {err}");
            }
        }
        guard.clone()
    };
    // Turning history keeping off deletes the saved conversation right away.
    if !prefs.awareness.keep_history {
        let _ = std::fs::remove_file(&state.chat_history_path);
    }
    sync_ui(app, &prefs);
    let _ = app.emit(PREFS_EVENT, &prefs);
    prefs
}

/// What each registered global shortcut does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ShortcutRole {
    Voice,
    Control,
    Build,
    Lines,
    Cookie,
}

/// Which shortcuts should be registered: voice (while enabled) and the Control-mode toggle (while
/// enabled). If both use the same keys, the voice shortcut wins and the toggle reports a conflict.
fn wanted_shortcuts(prefs: &Prefs) -> (Option<String>, Result<Option<String>, String>) {
    let voice = if prefs.voice_input.enabled { voice::to_plugin_accelerator(&prefs.voice_input.shortcut) } else { None };
    let control = if prefs.control.toggle_enabled { voice::to_plugin_accelerator(&prefs.control.toggle_shortcut) } else { None };
    let control = match (&voice, control) {
        (Some(v), Some(c)) if *v == c => Err("That's the same as the voice shortcut; pick a different one.".to_string()),
        (_, c) => Ok(c),
    };
    (voice, control)
}

/// The Platform-edit toggle, unless off or clashing with the voice, Control or Build shortcuts.
fn wanted_lines_shortcut(prefs: &Prefs) -> Result<Option<String>, String> {
    let lines = if prefs.lines.toggle_enabled { voice::to_plugin_accelerator(&prefs.lines.toggle_shortcut) } else { None };
    let (voice, control) = wanted_shortcuts(prefs);
    let build = wanted_build_shortcut(prefs).ok().flatten();
    match lines {
        Some(l) if voice.as_ref() == Some(&l) => Err("That's the same as the voice shortcut; pick a different one.".into()),
        Some(l) if control.as_ref().ok().and_then(|c| c.as_ref()) == Some(&l) => {
            Err("That's the same as the Control-mode shortcut; pick a different one.".into())
        }
        Some(l) if build.as_ref() == Some(&l) => Err("That's the same as the Build-mode shortcut; pick a different one.".into()),
        l => Ok(l),
    }
}

/// The cookie shortcut, unless off or clashing with any other role's keys.
fn wanted_cookie_shortcut(prefs: &Prefs) -> Result<Option<String>, String> {
    let cookie = if prefs.persona.cookie_enabled { voice::to_plugin_accelerator(&prefs.persona.cookie_shortcut) } else { None };
    let (voice, control) = wanted_shortcuts(prefs);
    let others = [
        ("voice", voice),
        ("Control-mode", control.ok().flatten()),
        ("Build-mode", wanted_build_shortcut(prefs).ok().flatten()),
        ("Platform-edit", wanted_lines_shortcut(prefs).ok().flatten()),
    ];
    match cookie {
        Some(c) => match others.iter().find(|(_, o)| o.as_ref() == Some(&c)) {
            Some((name, _)) => Err(format!("That's the same as the {name} shortcut; pick a different one.")),
            None => Ok(Some(c)),
        },
        None => Ok(None),
    }
}

/// The Build-mode toggle, unless off or clashing with the voice or Control shortcuts.
fn wanted_build_shortcut(prefs: &Prefs) -> Result<Option<String>, String> {
    let build = if prefs.build.toggle_enabled { voice::to_plugin_accelerator(&prefs.build.toggle_shortcut) } else { None };
    let (voice, control) = wanted_shortcuts(prefs);
    match build {
        Some(b) if voice.as_ref() == Some(&b) => Err("That's the same as the voice shortcut; pick a different one.".into()),
        Some(b) if control.as_ref().ok().and_then(|c| c.as_ref()) == Some(&b) => {
            Err("That's the same as the Control-mode shortcut; pick a different one.".into())
        }
        b => Ok(b),
    }
}

/// Register one role's shortcut (unregistering its previous one); returns a status line.
fn sync_one(app: &AppHandle, slot: &Mutex<Option<String>>, wanted: Option<String>, off: &str) -> String {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let mut current = slot.lock().unwrap();
    let gs = app.global_shortcut();
    if *current != wanted {
        if let Some(old) = current.take() {
            let _ = gs.unregister(old.as_str());
        }
        if let Some(accel) = &wanted {
            if let Err(e) = gs.register(accel.as_str()) {
                return format!("Couldn't register this shortcut ({e}). It may be used by another app; pick another.");
            }
            *current = Some(accel.clone());
        }
    }
    if current.is_some() { "Shortcut active.".into() } else { off.into() }
}

/// Keep the global shortcuts in step with preferences; failures are reported in settings.
fn sync_shortcuts(app: &AppHandle, prefs: &Prefs) {
    let Some(state) = app.try_state::<AppState>() else { return };
    if state.shortcuts_suspended.load(Ordering::Relaxed) {
        // Recording a new shortcut: release everything (statuses are kept).
        for slot in [&state.voice_shortcut, &state.control_shortcut, &state.build_shortcut, &state.lines_shortcut, &state.cookie_shortcut] {
            sync_one(app, slot, None, "");
        }
        return;
    }
    let (voice, control) = wanted_shortcuts(prefs);
    // Release the build toggle first too, so keys can move between roles.
    let build = wanted_build_shortcut(prefs);
    if build.is_err() || build.as_ref().ok() != Some(&*state.build_shortcut.lock().unwrap()) {
        sync_one(app, &state.build_shortcut, None, "");
    }
    let lines = wanted_lines_shortcut(prefs);
    if lines.is_err() || lines.as_ref().ok() != Some(&*state.lines_shortcut.lock().unwrap()) {
        sync_one(app, &state.lines_shortcut, None, "");
    }
    let cookie = wanted_cookie_shortcut(prefs);
    if cookie.is_err() || cookie.as_ref().ok() != Some(&*state.cookie_shortcut.lock().unwrap()) {
        sync_one(app, &state.cookie_shortcut, None, "");
    }
    // Release the control toggle first so a key combination can move from one role to the other.
    let control_status = match control {
        Ok(c) => {
            let s = sync_one(app, &state.control_shortcut, c.clone(), "The Control-mode shortcut is off.");
            let v = sync_one(app, &state.voice_shortcut, voice, "Voice input is off.");
            *state.voice_shortcut_status.lock().unwrap() = v;
            s
        }
        Err(conflict) => {
            sync_one(app, &state.control_shortcut, None, "");
            let v = sync_one(app, &state.voice_shortcut, voice, "Voice input is off.");
            *state.voice_shortcut_status.lock().unwrap() = v;
            conflict
        }
    };
    if std::env::var_os("TC_DEBUG").is_some() {
        eprintln!("[shortcuts] voice: {} | control: {control_status}", state.voice_shortcut_status.lock().unwrap());
    }
    *state.control_shortcut_status.lock().unwrap() = control_status;
    let build_status = match build {
        Ok(b) => sync_one(app, &state.build_shortcut, b, "The Build-mode shortcut is off."),
        Err(conflict) => conflict,
    };
    *state.build_shortcut_status.lock().unwrap() = build_status;
    let lines_status = match lines {
        Ok(l) => sync_one(app, &state.lines_shortcut, l, "The Platform-edit shortcut is off."),
        Err(conflict) => conflict,
    };
    *state.lines_shortcut_status.lock().unwrap() = lines_status;
    let cookie_status = match cookie {
        Ok(c) => sync_one(app, &state.cookie_shortcut, c, "The cookie shortcut is off."),
        Err(conflict) => conflict,
    };
    *state.cookie_shortcut_status.lock().unwrap() = cookie_status;
}

/// Which role a pressed shortcut belongs to.
fn shortcut_role(app: &AppHandle, pressed: &tauri_plugin_global_shortcut::Shortcut) -> Option<ShortcutRole> {
    use std::str::FromStr;
    let state = app.try_state::<AppState>()?;
    let matches = |slot: &Mutex<Option<String>>| {
        slot.lock().unwrap().as_deref().and_then(|a| tauri_plugin_global_shortcut::Shortcut::from_str(a).ok()).is_some_and(|s| s == *pressed)
    };
    if matches(&state.voice_shortcut) {
        Some(ShortcutRole::Voice)
    } else if matches(&state.control_shortcut) {
        Some(ShortcutRole::Control)
    } else if matches(&state.build_shortcut) {
        Some(ShortcutRole::Build)
    } else if matches(&state.lines_shortcut) {
        Some(ShortcutRole::Lines)
    } else if matches(&state.cookie_shortcut) {
        Some(ShortcutRole::Cookie)
    } else {
        None
    }
}

/// Control, Build and Platform-edit modes make the whole overlay take mouse input.
fn captures_all(state: &AppState) -> bool {
    state.control.load(Ordering::Relaxed) || state.build.load(Ordering::Relaxed) || state.lines.load(Ordering::Relaxed)
}

/// Screen geometry for the theme layer: CSS points of the primary display, the menu bar's height
/// and where the macOS Dock is (inferred from the display's usable area; nothing else is read).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AmbientGeometry {
    width: f64,
    height: f64,
    menu_bar: f64,
    /// "bottom", "left", "right" or "hidden".
    dock_edge: &'static str,
    dock_size: f64,
}

fn ambient_geometry_for(win: &WebviewWindow) -> Option<AmbientGeometry> {
    let m = win.primary_monitor().ok().flatten()?;
    let s = m.scale_factor();
    let (mx, my) = (m.position().x as f64 / s, m.position().y as f64 / s);
    let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
    let a = m.work_area();
    let (ax, ay) = (a.position.x as f64 / s, a.position.y as f64 / s);
    let (aw, ah) = (a.size.width as f64 / s, a.size.height as f64 / s);
    Some(dock_layout(mw, mh, ax - mx, ay - my, aw, ah))
}

/// Pure part of the geometry: given the display size and its usable area (relative to the display).
fn dock_layout(mw: f64, mh: f64, ax: f64, ay: f64, aw: f64, ah: f64) -> AmbientGeometry {
    let bottom = mh - (ay + ah);
    let left = ax;
    let right = mw - (ax + aw);
    // An auto-hidden Dock leaves only a few points.
    let (dock_edge, dock_size) = if bottom >= 12.0 && bottom >= left && bottom >= right {
        ("bottom", bottom)
    } else if left >= 12.0 && left >= right {
        ("left", left)
    } else if right >= 12.0 {
        ("right", right)
    } else {
        ("hidden", 0.0)
    };
    AmbientGeometry { width: mw, height: mh, menu_bar: ay.max(0.0), dock_edge, dock_size }
}

/// Cover the whole primary display (the menu bar and Dock always draw above this window).
fn fit_ambient(win: &WebviewWindow) -> tauri::Result<()> {
    if let Some(m) = win.primary_monitor()? {
        win.set_position(*m.position())?;
        win.set_size(*m.size())?;
    }
    Ok(())
}

/// The crown window covers the whole primary display, like the theme windows: macOS pushes a
/// shorter window that starts at the top down below the menu bar, but leaves a full-height one in
/// place. It only draws in the menu bar's strip and just below it, and is click-through.
fn fit_crown(win: &WebviewWindow) -> tauri::Result<()> {
    fit_ambient(win)
}

/// Theme decorations shown in front of app windows (their own always-on-top window)?
fn theme_in_front(prefs: &Prefs) -> bool {
    prefs.visible && prefs.theme.enabled && prefs.theme.layer == "front"
}

/// Show / hide the theme layers. The background world and a "behind" theme live in the bottom
/// window; a "front" theme gets its own always-on-top window, so the petals or snow stay visible
/// over Chrome and other apps even while the world is shown behind them. Neither is ever over the
/// menu bar or the Dock (higher window levels), and the front one is always click-through.
fn sync_ambient(app: &AppHandle, prefs: &Prefs) {
    if let Some(crown) = app.get_webview_window(CROWN) {
        let want = prefs.visible && prefs.theme.enabled && prefs.theme.garland;
        let shown = crown.is_visible().unwrap_or(false);
        if want && !shown {
            let _ = fit_crown(&crown);
            let _ = crown.set_ignore_cursor_events(true);
            let _ = crown.show();
            desktop_layer::to_menu_bar_level(app, &crown);
        } else if !want && shown {
            let _ = crown.hide();
        }
    }
    if let Some(decor) = app.get_webview_window(DECOR) {
        let front = theme_in_front(prefs);
        let shown = decor.is_visible().unwrap_or(false);
        if front && !shown {
            let _ = fit_ambient(&decor);
            let _ = decor.set_ignore_cursor_events(true);
            let _ = decor.show();
        } else if !front && shown {
            let _ = decor.hide();
        }
    }
    let Some(win) = app.get_webview_window(AMBIENT) else { return };
    // The bottom window draws the world, plus the theme when it's meant to be behind windows.
    let want = prefs.visible && (prefs.world.enabled || (prefs.theme.enabled && !theme_in_front(prefs)));
    desktop_layer::to_desktop_level(app, &win);
    let state = app.state::<AppState>();
    if !want || !prefs.world.enabled {
        state.world_nav.store(false, Ordering::Relaxed);
    }
    if !want || !prefs.world.enabled {
        if state.world_play.load(Ordering::Relaxed) {
            // The world went away while playing: leave Control Mode.
            state.world_play.store(false, Ordering::Relaxed);
            let _ = app.emit("companion://world-play", serde_json::json!({ "on": false, "mode": "" }));
        }
    }
    // Under Finder's icons the window never gets input itself; the event tap forwards what's
    // aimed at the bare desktop (desktop_layer.rs).
    let _ = win.set_ignore_cursor_events(true);
    let shown = win.is_visible().unwrap_or(false);
    if want && !shown {
        let _ = fit_ambient(&win);
        let _ = win.show();
    } else if !want && shown {
        let _ = win.hide();
    }
}

/// Exploring and playing take desktop clicks and keys away from Finder, which needs
/// Accessibility permission. Without it they don't start (the panels and the assistant say why;
/// from the tray or a shortcut, `say_needs_accessibility` has the companion say it).
fn world_input_allowed() -> bool {
    desktop_layer::accessibility_trusted()
}

fn say_needs_accessibility(app: &AppHandle) {
    let _ = app.emit_to(
        OVERLAY,
        "companion://say",
        "The world sits under your desktop icons now, so I need Accessibility permission to give it your clicks and keys. Turn on Terraria Companion CJ Ver in System Settings → Privacy & Security → Accessibility (there's a button in Maps settings)."
            .to_string(),
    );
}

/// Open System Settings at Privacy & Security → Accessibility.
#[tauri::command]
fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").spawn();
}

#[tauri::command]
fn accessibility_status() -> bool {
    desktop_layer::accessibility_trusted()
}

/// Can Wispr Flow carry voice input right now (and if not, what the companion says)?
#[tauri::command]
fn wispr_status() -> wispr::Status {
    wispr::status()
}

#[tauri::command]
fn wispr_launch() -> bool {
    wispr::launch()
}

/// Take back (⌘Z) a dictation that went into another app but was meant for the companion.
#[tauri::command]
fn wispr_take_back(app_id: String) -> bool {
    wispr::take_back(&app_id)
}

/// A desktop drag of the world started / ended (so the companions don't grab the pointer mid-drag).
#[tauri::command]
fn world_dragging(state: State<AppState>, on: bool) {
    state.world_drag.store(on, Ordering::Relaxed);
}

/// Explore the background world: clicks, drags and scrolls on the bare desktop (and keys, once
/// you've clicked it) go to the world (drag to look around, edit tiles) until Esc / Done. It stays
/// under the desktop icons and behind app windows the whole time, so they keep working. Returns
/// false when it can't start (no Accessibility permission).
fn set_world_nav(app: &AppHandle, on: bool) -> bool {
    if on && app.state::<AppState>().world_play.load(Ordering::Relaxed) {
        return true; // already playing it
    }
    if on && !world_input_allowed() {
        return false;
    }
    if on && !app.state::<AppState>().prefs.lock().unwrap().world.enabled {
        update_prefs(app, |p| p.world.enabled = true);
    }
    let state = app.state::<AppState>();
    state.world_nav.store(on, Ordering::Relaxed);
    let _ = app.emit("companion://world-nav", on);
    true
}

#[tauri::command]
fn world_nav(app: AppHandle, on: bool) -> bool {
    set_world_nav(&app, on)
}

#[tauri::command]
fn get_world_nav(state: State<AppState>) -> bool {
    state.world_nav.load(Ordering::Relaxed)
}

/// Live camera while exploring, for the companions walking on the terrain (not saved; the
/// world window saves the camera in prefs when exploring ends).
#[tauri::command]
fn world_view(app: AppHandle, x: f64, y: f64, zoom: f64) {
    if [x, y, zoom].iter().all(|v| v.is_finite()) {
        let _ = app.emit_to(OVERLAY, "companion://world-view", serde_json::json!({ "x": x, "y": y, "zoom": zoom }));
    }
}

const WORLD_FILE_MAX: usize = 24 * 1024 * 1024;

/// Saved background-world gameplay (inventory, player, progress), if any.
#[tauri::command]
fn game_load(state: State<AppState>) -> Option<String> {
    let data = std::fs::read_to_string(state.world_path.with_file_name("world_player.json")).ok()?;
    (data.len() <= WORLD_FILE_MAX).then_some(data)
}

/// Save gameplay progress (validated JSON, size-capped).
#[tauri::command]
fn game_save(state: State<AppState>, data: String) -> bool {
    if data.len() > WORLD_FILE_MAX || serde_json::from_str::<serde_json::Value>(&data).is_err() {
        return false;
    }
    let path = state.world_path.with_file_name("world_player.json");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &data).is_ok() && std::fs::rename(&tmp, &path).is_ok()
}

const PLACES_FILE_MAX: usize = 12 * 1024 * 1024;
const PLACES_EVENT: &str = "companion://places";
const GOTO_EVENT: &str = "companion://world-goto";

/// The saved-locations gallery (written by the world window: names, labels, progress, previews).
#[tauri::command]
fn places_load(state: State<AppState>) -> Option<String> {
    let data = std::fs::read_to_string(state.world_path.with_file_name("world_places.json")).ok()?;
    (data.len() <= PLACES_FILE_MAX).then_some(data)
}

/// Save the gallery (validated JSON, size-capped) and tell the settings window.
#[tauri::command]
fn places_save(app: AppHandle, state: State<AppState>, data: String) -> bool {
    if data.len() > PLACES_FILE_MAX || serde_json::from_str::<serde_json::Value>(&data).is_err() {
        return false;
    }
    let path = state.world_path.with_file_name("world_places.json");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    let ok = std::fs::write(&tmp, &data).is_ok() && std::fs::rename(&tmp, &path).is_ok();
    if ok {
        let _ = app.emit_to(INVENTORY, PLACES_EVENT, ());
    }
    ok
}

/// Look at a saved place: the world window moves its camera there (tile coordinates).
#[tauri::command]
fn places_goto(app: AppHandle, x: f64, y: f64) {
    if x.is_finite() && y.is_finite() && (0.0..100_000.0).contains(&x) && (0.0..100_000.0).contains(&y) {
        let _ = app.emit_to(AMBIENT, GOTO_EVENT, serde_json::json!({ "x": x, "y": y }));
    }
}

/// The saved terrain edits (JSON written by the world window), if any.
#[tauri::command]
fn world_load(state: State<AppState>) -> Option<String> {
    let data = std::fs::read_to_string(&state.world_path).ok()?;
    (data.len() <= WORLD_FILE_MAX).then_some(data)
}

/// Save terrain edits (validated JSON, size-capped) and tell the overlay.
#[tauri::command]
fn world_save(app: AppHandle, state: State<AppState>, data: String) -> bool {
    if data.len() > WORLD_FILE_MAX || serde_json::from_str::<serde_json::Value>(&data).is_err() {
        return false;
    }
    if let Some(dir) = state.world_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = state.world_path.with_extension("json.tmp");
    let ok = std::fs::write(&tmp, &data).is_ok() && std::fs::rename(&tmp, &state.world_path).is_ok();
    if ok {
        let _ = app.emit_to(OVERLAY, "companion://world-edits", ());
    }
    ok
}

fn sync_ui(app: &AppHandle, prefs: &Prefs) {
    sync_shortcuts(app, prefs);
    sync_ambient(app, prefs);
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let shown = overlay.is_visible().unwrap_or(false);
        if prefs.visible && !shown {
            let _ = overlay.show();
        } else if !prefs.visible && shown {
            let _ = overlay.hide();
        }
    }
    if let Some(dock) = app.get_webview_window(DOCK) {
        let shown = dock.is_visible().unwrap_or(false);
        if prefs.dock.visible && !shown {
            place_dock(app, &dock);
            // Not focusable (see tauri.conf.json), so showing it never takes keyboard focus.
            let _ = dock.show();
        } else if !prefs.dock.visible && shown {
            let _ = dock.hide();
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.dock.set_text(if prefs.dock.visible { "Hide Dock" } else { "Show Dock" });
        let label = if prefs.visible { "Hide Companion" } else { "Show Companion" };
        let _ = items.toggle_visible.set_text(label);
        let _ = items.pause.set_checked(prefs.paused);
        let _ = items.platforms.set_checked(prefs.platforms);
        let _ = items.training.set_checked(prefs.training);
        for (m, item) in &items.modes {
            let _ = item.set_checked(*m == prefs.companion_mode);
        }
        let rotating = prefs.idle.as_ref().is_some_and(|i| i.mode == IdleMode::Rotate);
        for (p, item) in &items.poses {
            let _ = item.set_checked(!rotating && *p == prefs.idle_pose);
        }
        let _ = items.rotate_poses.set_checked(rotating);
        let _ = items.app_awareness.set_checked(prefs.awareness.app_enabled);
        let _ = items.quiet.set_checked(prefs.awareness.quiet);
        for (m, item) in &items.cursor_modes {
            let _ = item.set_checked(*m == prefs.cursor_mode);
        }
        let _ = items.hide_cursor.set_checked(prefs.hide_system_cursor);
        for (d, item) in &items.difficulties {
            let _ = item.set_checked(*d == prefs.boss_difficulty);
        }
        let _ = items.letter_break.set_checked(prefs.effects.letter_break);
        let _ = items.world.set_checked(prefs.world.enabled);
        for (scale, item) in &items.sizes {
            let _ = item.set_checked(*scale == prefs.scale);
        }
    }
}

fn set_inventory_visible(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window(INVENTORY) {
        if visible {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        } else {
            let _ = win.hide();
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let label = if visible { "Close Inventory" } else { "Open Inventory" };
        let _ = items.inventory.set_text(label);
    }
}

fn set_chat_visible(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window(CHAT) {
        if visible {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        } else {
            let _ = win.hide();
        }
    }
}

/// Run the bookmarklet's local endpoint while enabled in settings (restarts when re-enabled).
fn spawn_destroyer_link(app: AppHandle) {
    std::thread::spawn(move || loop {
        let enabled = || app.state::<AppState>().prefs.lock().unwrap().destroyer.connect;
        if enabled() {
            *app.state::<AppState>().destroyer_status.lock().unwrap() = format!("Listening on 127.0.0.1:{}.", destroyer_link::PORT);
            let emitter = app.clone();
            let state = app.state::<AppState>();
            let result = destroyer_link::serve(enabled, &state.destroyer_strikes, |ev| {
                let _ = emitter.emit(destroyer_link::EVENT, &ev);
            });
            let failed = result.is_err();
            *app.state::<AppState>().destroyer_status.lock().unwrap() = match result {
                Ok(()) => "Not listening.".into(),
                Err(e) => format!("Couldn't listen ({e})."),
            };
            if failed {
                std::thread::sleep(Duration::from_secs(10)); // retry later (port may free up)
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    });
}

/// Overlay origin (logical points, top-left of the primary display) for converting notch
/// geometry and pointer positions between global points and overlay CSS px.
fn overlay_origin(app: &AppHandle) -> Option<(f64, f64)> {
    let win = app.get_webview_window(OVERLAY)?;
    let (origin, scale) = (win.inner_position().ok()?, win.scale_factor().ok()?);
    Some((origin.x as f64 / scale, origin.y as f64 / scale))
}

/// The notch as the overlay sees it (CSS px), or disconnected.
fn notch_payload(app: &AppHandle) -> serde_json::Value {
    let state = app.state::<AppState>();
    let connected = state.notch.connected(std::time::Instant::now());
    let resident = state.notch.resident();
    match (state.notch.geometry().filter(|_| connected), overlay_origin(app)) {
        (Some(g), Some((ox, oy))) => serde_json::json!({
            "connected": true,
            "rect": { "x": g.x - ox, "y": g.y - oy, "w": g.w, "h": g.h },
            "edge": g.edge,
            "expanded": g.expanded,
            "dragging": g.dragging,
            "resident": resident,
        }),
        _ => serde_json::json!({ "connected": false, "rect": null, "resident": resident }),
    }
}

/// Serve CustomNotch's link, forward its geometry and actions to the overlay, and tell the
/// overlay when the notch app goes away (so a resident can come back out).
fn spawn_notch_link(app: AppHandle) {
    let shared = app.state::<AppState>().notch.clone();
    let geo_app = app.clone();
    let act_app = app.clone();
    std::thread::spawn(move || loop {
        let (geo_app, act_app) = (geo_app.clone(), act_app.clone());
        let result = notch_link::serve(
            shared.clone(),
            move |g| {
                if std::env::var_os("TC_DEBUG").is_some() {
                    eprintln!("[notch] {} {:.0},{:.0} {:.0}×{:.0} expanded={} dragging={}", g.edge, g.x, g.y, g.w, g.h, g.expanded, g.dragging);
                }
                let _ = geo_app.emit_to(OVERLAY, notch_link::EVENT, notch_payload(&geo_app));
            },
            move |a| {
                if std::env::var_os("TC_DEBUG").is_some() {
                    eprintln!("[notch] action {}", a.kind);
                }
                if a.kind == "inventory" {
                    // The compact inventory, beside the notch (the full menu is a click away in it).
                    show_pouch(&act_app);
                    return;
                }
                let (ox, oy) = overlay_origin(&act_app).unwrap_or((0.0, 0.0));
                let payload = serde_json::json!({ "kind": a.kind, "x": a.x - ox, "y": a.y - oy, "vx": a.vx, "vy": a.vy });
                let _ = act_app.emit_to(OVERLAY, notch_link::ACTION_EVENT, payload);
            },
        );
        if let Err(e) = result {
            if std::env::var_os("TC_DEBUG").is_some() {
                eprintln!("[notch] {e}");
            }
        }
        std::thread::sleep(Duration::from_secs(10)); // retry later (port may free up)
    });
    std::thread::spawn(move || {
        let mut was = false;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = app.state::<AppState>().notch.connected(std::time::Instant::now());
            if now != was {
                was = now;
                let _ = app.emit_to(OVERLAY, notch_link::EVENT, notch_payload(&app));
            }
        }
    });
}

/// Open the compact inventory next to the notch (or centred, if the notch isn't known).
fn show_pouch(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POUCH) else { return };
    let size = logical_size(&win).unwrap_or((340.0, 536.0));
    match app.state::<AppState>().notch.geometry() {
        Some(g) => {
            // The display the notch is on (its usable area, in global points).
            let area = win
                .available_monitors()
                .unwrap_or_default()
                .into_iter()
                .map(|m| {
                    let (a, s) = (m.work_area(), m.scale_factor());
                    (a.position.x as f64 / s, a.position.y as f64 / s, a.size.width as f64 / s, a.size.height as f64 / s)
                })
                .find(|&(x, y, w, h)| {
                    let (cx, cy) = (g.x + g.w / 2.0, g.y + g.h / 2.0);
                    cx >= x - 40.0 && cx <= x + w + 40.0 && cy >= y - 40.0 && cy <= y + h + 40.0
                })
                .unwrap_or((0.0, 0.0, 1440.0, 900.0));
            let (x, y) = notch_link::pouch_origin(&g, size, area);
            let _ = win.set_position(LogicalPosition::new(x, y));
        }
        None => {
            let _ = win.center();
        }
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit(POUCH_EVENT, "open");
}

#[tauri::command]
fn hide_pouch(app: AppHandle) {
    if let Some(win) = app.get_webview_window(POUCH) {
        let _ = win.hide();
    }
}

/// From the pouch: the full menu, at its Combat section.
#[tauri::command]
fn pouch_open_menu(app: AppHandle) {
    hide_pouch(app.clone());
    set_inventory_visible(&app, true);
    let _ = app.emit(SETTINGS_TAB_EVENT, "items");
}

/// Sample the frontmost app (only while app awareness or screen understanding is on) and tell
/// the overlay about switches. Keeps only the current app in memory; nothing is logged or saved.
fn spawn_app_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let own_bundle = app.config().identifier.clone();
        let mut detector = apps::SwitchDetector::default();
        loop {
            std::thread::sleep(APP_POLL);
            let state = app.state::<AppState>();
            let (aware, screen, excluded, want_windows) = {
                let p = state.prefs.lock().unwrap();
                (
                    p.awareness.app_enabled,
                    p.awareness.screen_enabled,
                    p.awareness.excluded.clone(),
                    p.reactions.iter().any(|r| r.enabled && r.window_switches),
                )
            };
            if !aware && !screen {
                detector.reset();
                *state.last_external_app.lock().unwrap() = None;
                continue;
            }
            let Some(front) = apps::frontmost() else { continue };
            if front.bundle_id != own_bundle {
                *state.last_external_app.lock().unwrap() = Some(front.clone());
            }
            if !aware {
                detector.reset();
                continue;
            }
            // Window ids (never titles) only when some rule asks for same-app window switches.
            let window = if want_windows { apps::front_window_of(&windows::list_windows(), front.pid) } else { None };
            if let Some(ev) = detector.observe(Some(&front), window, &own_bundle, &excluded) {
                if std::env::var_os("TC_DEBUG").is_some() {
                    eprintln!("[apps] switch to {} (same app: {})", ev.bundle_id, ev.same_app);
                }
                let _ = app.emit(APP_SWITCH_EVENT, &ev);
            }
        }
    });
}

fn toggle_inventory_window(app: &AppHandle) {
    let visible = app
        .get_webview_window(INVENTORY)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    set_inventory_visible(app, !visible);
}

/// Usable areas (menu bar and macOS Dock excluded) of every display, primary first, in points.
fn work_areas(win: &WebviewWindow) -> Vec<dock::Area> {
    let to_area = |m: &tauri::Monitor| {
        let a = m.work_area();
        let s = m.scale_factor();
        dock::Area {
            x: a.position.x as f64 / s,
            y: a.position.y as f64 / s,
            w: a.size.width as f64 / s,
            h: a.size.height as f64 / s,
        }
    };
    let primary = win.primary_monitor().ok().flatten();
    let mut areas: Vec<dock::Area> = primary.iter().map(to_area).collect();
    for m in win.available_monitors().unwrap_or_default() {
        let a = to_area(&m);
        if !areas.contains(&a) {
            areas.push(a);
        }
    }
    areas
}

fn logical_size(win: &WebviewWindow) -> Option<(f64, f64)> {
    let size = win.outer_size().ok()?;
    let scale = win.scale_factor().ok()?;
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

/// Move the dock to its saved spot (or the default), clamped into a display's usable area.
fn place_dock(app: &AppHandle, win: &WebviewWindow) {
    let saved = app.state::<AppState>().prefs.lock().unwrap().dock.position.map(|p| (p.x, p.y));
    let Some(size) = logical_size(win) else { return };
    if let Some((x, y)) = dock::place(saved, size, &work_areas(win)) {
        let _ = win.set_position(LogicalPosition::new(x, y));
    }
}

/// Debounced save of the dock's position after the user drags it.
fn on_dock_moved(app: &AppHandle, win: &WebviewWindow, pos: PhysicalPosition<i32>) {
    let scale = win.scale_factor().unwrap_or(1.0);
    let logical = DockPosition { x: pos.x as f64 / scale, y: pos.y as f64 / scale };
    let state = app.state::<AppState>();
    let generation = state.dock_move_gen.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(DOCK_SAVE_DELAY);
        if app.state::<AppState>().dock_move_gen.load(Ordering::Relaxed) != generation {
            return; // still moving
        }
        let unchanged = app.state::<AppState>().prefs.lock().unwrap().dock.position.is_some_and(|p| {
            (p.x - logical.x).abs() < 0.5 && (p.y - logical.y).abs() < 0.5
        });
        if !unchanged {
            update_prefs(&app, |p| p.dock.position = Some(logical));
        }
    });
}

/// Keep the dock on screen when displays are added, removed or resized.
fn spawn_dock_guard(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(DOCK_GUARD_POLL);
        let Some(win) = app.get_webview_window(DOCK) else { continue };
        if !win.is_visible().unwrap_or(false) {
            continue;
        }
        let (Ok(pos), Ok(scale), Some(size)) = (win.outer_position(), win.scale_factor(), logical_size(&win)) else {
            continue;
        };
        let current = (pos.x as f64 / scale, pos.y as f64 / scale);
        if let Some(next) = dock::place(Some(current), size, &work_areas(&win)) {
            if (next.0 - current.0).abs() > 1.0 || (next.1 - current.1).abs() > 1.0 {
                let _ = win.set_position(LogicalPosition::new(next.0, next.1));
            }
        }
    });
}

/// Cover the primary monitor's usable area (excludes the menu bar and Dock).
fn fit_overlay_to_work_area(win: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match win.primary_monitor()? {
        Some(m) => Some(m),
        None => win.current_monitor()?,
    };
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        win.set_position(PhysicalPosition::new(area.position.x, area.position.y))?;
        win.set_size(PhysicalSize::new(area.size.width, area.size.height))?;
    }
    Ok(())
}

/// Poll the global cursor position and make the overlay click-through everywhere
/// except over the character. Uses only `NSEvent.mouseLocation` (via Tauri) and
/// `NSWindow.ignoresMouseEvents`, neither of which needs Accessibility permission.
fn spawn_hover_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut interactive = false;
        let mut seen_epoch = 0u32;
        let mut geometry: Option<((f64, f64), f64)> = None;
        let mut tick: u32 = 0;
        let mut poll = HOVER_POLL;
        let mut hider = cursor_hide::CursorHider::default();
        let mut last_cursor: Option<(i32, i32)> = None;
        let mut own_frames: Vec<(f64, f64, f64, f64)> = Vec::new();
        loop {
            std::thread::sleep(poll);
            let Some(win) = app.get_webview_window(OVERLAY) else {
                continue;
            };
            let state = app.state::<AppState>();

            if tick % GEOMETRY_REFRESH_TICKS == 0 || geometry.is_none() {
                geometry = match (win.inner_position(), win.scale_factor()) {
                    (Ok(origin), Ok(scale)) => Some(((origin.x as f64, origin.y as f64), scale)),
                    _ => None,
                };
            }
            // Our own regular windows sit under the always-on-top overlay; track where they are so
            // the overlay never steals their clicks or scrolling (e.g. a character walking behind
            // the inventory). Refreshed often enough to follow a window that was just opened/moved.
            if tick % OWN_FRAMES_REFRESH_TICKS == 0 {
                own_frames = own_window_frames(&app);
            }
            tick = tick.wrapping_add(1);

            // Control mode makes the whole overlay interactive; leaving it re-enables click-through.
            let epoch = state.control_epoch.load(Ordering::Relaxed);
            if epoch != seen_epoch {
                seen_epoch = epoch;
                interactive = !interactive; // force the next comparison to re-apply
            }
            let control = captures_all(&state);
            let (cursor_mode, hide_opt_in, visible) = {
                let p = state.prefs.lock().unwrap();
                (p.cursor_mode, p.hide_system_cursor, p.visible)
            };
            let cursor_active = cursor_mode != CursorMode::Off && visible;

            // Cursor modes put the character under the pointer, so the overlay must never take
            // clicks then (otherwise the desktop would become unclickable). Control mode wins.
            let capture = control || (!cursor_active && state.capture.load(Ordering::Relaxed));
            let distance = if cursor_active { None } else { cursor_distance(&app, &state, geometry) };
            // She stays on the desktop during games too, so she can still be picked up (the event
            // tap gives the world only clicks on the bare desktop, never ones on her).
            let wanted = !state.world_drag.load(Ordering::Relaxed) && (capture || distance.is_some_and(|d| d <= HOVER_PAD));
            let over_own = !own_frames.is_empty()
                && app.cursor_position().is_ok_and(|c| own_frames.iter().any(|f| hit::in_frame(*f, (c.x, c.y))));
            let want = hit::overlay_interactive(wanted, over_own, over_own && mouse_button_down(), interactive);
            if want != interactive && win.set_ignore_cursor_events(!want).is_ok() {
                interactive = want;
            }
            desktop_layer::OVERLAY_HOT.store(interactive, Ordering::Relaxed);

            // Stream the cursor position for the visual cursor modes, and manage optional hiding.
            let local = if cursor_active { cursor_local(&app, geometry) } else { None };
            if let Some((x, y)) = local {
                let rounded = (x.round() as i32, y.round() as i32);
                if last_cursor != Some(rounded) {
                    last_cursor = Some(rounded);
                    let _ = app.emit(CURSOR_EVENT, serde_json::json!({ "x": x, "y": y }));
                }
            } else {
                last_cursor = None;
            }
            let overlay_size = win
                .inner_size()
                .ok()
                .zip(geometry)
                .map(|(s, (_, scale))| (s.width as f64 / scale, s.height as f64 / scale))
                .unwrap_or((0.0, 0.0));
            hider.set(cursor_hide::should_hide(
                cursor_mode == CursorMode::Become,
                hide_opt_in,
                control,
                local,
                overlay_size,
            ));

            poll = if capture || cursor_active || distance.is_some_and(|d| d <= HOVER_NEAR) {
                HOVER_POLL
            } else {
                HOVER_IDLE_POLL
            };
        }
    });
}

/// Physical frames of our visible regular windows (inventory, chat).
fn own_window_frames(app: &AppHandle) -> Vec<(f64, f64, f64, f64)> {
    [INVENTORY, CHAT]
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .filter_map(|w| {
            let p = w.outer_position().ok()?;
            let s = w.outer_size().ok()?;
            Some((p.x as f64, p.y as f64, s.width as f64, s.height as f64))
        })
        .collect()
}

/// Is any mouse button held right now? Reads only the button state (no events are observed).
fn mouse_button_down() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        unsafe extern "C" {
            fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
        }
        // kCGEventSourceStateCombinedSessionState = 0; left, right, other.
        (0..3).any(|b| unsafe { CGEventSourceButtonState(0, b) })
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Cursor position in overlay CSS px.
fn cursor_local(app: &AppHandle, geometry: Option<((f64, f64), f64)>) -> Option<(f64, f64)> {
    let (origin, scale) = geometry?;
    let cursor = app.cursor_position().ok()?;
    Some(hit::to_local((cursor.x, cursor.y), origin, scale))
}

/// Cursor distance (CSS px) from the character, or None when hidden or unknown.
fn cursor_distance(
    app: &AppHandle,
    state: &AppState,
    geometry: Option<((f64, f64), f64)>,
) -> Option<f64> {
    if !state.prefs.lock().unwrap().visible {
        return None;
    }
    let rect = (*state.hitbox.lock().unwrap())?;
    let extra = state.hitbox_extra.lock().unwrap().clone();
    let (origin, scale) = geometry?;
    let cursor = app.cursor_position().ok()?;
    let local = hit::to_local((cursor.x, cursor.y), origin, scale);
    Some(extra.iter().fold(hit::distance(&rect, local), |d, r| d.min(hit::distance(r, local))))
}

/// Poll other apps' window geometry and push changes to the overlay.
/// Only bounds are read (see `windows.rs`); nothing is captured or stored on disk.
fn spawn_platform_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let own_pid = std::process::id() as i32;
        // `TC_DEBUG=1` logs a one-line geometry summary per change, for manual testing.
        let debug = std::env::var_os("TC_DEBUG").is_some();
        loop {
            let state = app.state::<AppState>();
            let (active, enabled) = {
                let p = state.prefs.lock().unwrap();
                (p.visible && !p.paused && p.platforms, p.platforms)
            };
            // While hidden or paused the character is frozen, so keep the last snapshot
            // (it must still match when movement resumes). Disabling platforms clears it.
            let next = if active {
                app.get_webview_window(OVERLAY).and_then(|win| snapshot(&win, own_pid))
            } else if !enabled {
                Some(Vec::new())
            } else {
                None
            };
            if let Some(next) = next {
                let mut last = state.platforms.lock().unwrap();
                if *last != next {
                    if debug {
                        let tops: Vec<String> =
                            next.iter().map(|p| format!("{}@{},{} {}w", p.id, p.x, p.y, p.w)).collect();
                        eprintln!("[platforms] {} eligible: {}", next.len(), tops.join("  "));
                    }
                    let _ = app.emit(PLATFORMS_EVENT, &next);
                    *last = next;
                }
            }
            std::thread::sleep(if active { PLATFORM_POLL } else { PLATFORM_IDLE_POLL });
        }
    });
}

fn snapshot(win: &WebviewWindow, own_pid: i32) -> Option<Vec<PlatformWindow>> {
    let pos = win.inner_position().ok()?;
    let size = win.inner_size().ok()?;
    let scale = win.scale_factor().ok()?;
    let overlay = windows::physical_to_points(
        pos.x as f64,
        pos.y as f64,
        size.width as f64,
        size.height as f64,
        scale,
    );
    Some(windows::to_platforms(&windows::list_windows(), own_pid, overlay))
}

fn build_tray(app: &AppHandle, prefs: &Prefs) -> tauri::Result<()> {
    let toggle_visible = MenuItem::with_id(
        app,
        "toggle_visible",
        if prefs.visible { "Hide Companion" } else { "Show Companion" },
        true,
        None::<&str>,
    )?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause", true, prefs.paused, None::<&str>)?;
    let platforms = CheckMenuItem::with_id(
        app,
        "platforms",
        "Walk on Windows",
        true,
        prefs.platforms,
        None::<&str>,
    )?;
    let inventory = MenuItem::with_id(app, "inventory", "Open Inventory", true, None::<&str>)?;
    let dock_item = MenuItem::with_id(
        app,
        "toggle_dock",
        if prefs.dock.visible { "Hide Dock" } else { "Show Dock" },
        true,
        None::<&str>,
    )?;
    let training =
        CheckMenuItem::with_id(app, "training", "Training Mode", true, prefs.training, None::<&str>)?;
    let reset_training =
        MenuItem::with_id(app, "reset_training", "Reset Dummies", true, None::<&str>)?;
    let dismiss_minions =
        MenuItem::with_id(app, "dismiss_minions", "Dismiss Minions", true, None::<&str>)?;
    let control = CheckMenuItem::with_id(app, "control", "Control Character", true, false, None::<&str>)?;
    let build = CheckMenuItem::with_id(app, "build", "Build Mode", true, false, None::<&str>)?;
    let lines = CheckMenuItem::with_id(app, "lines", "Edit Invisible Platforms", true, false, None::<&str>)?;
    let cookie = MenuItem::with_id(app, "cookie", "Give Cookie", true, None::<&str>)?;

    // Companion mode: roam or stay put (with a pose).
    let check = |id: &str, label: &str, on: bool| CheckMenuItem::with_id(app, id, label, true, on, None::<&str>);
    let modes = vec![
        (CompanionMode::Roam, check("mode_roam", "Roam", prefs.companion_mode == CompanionMode::Roam)?),
        (CompanionMode::Stay, check("mode_stay", "Stay Put", prefs.companion_mode == CompanionMode::Stay)?),
    ];
    let rotating = prefs.idle.as_ref().is_some_and(|i| i.mode == IdleMode::Rotate);
    let poses = vec![
        (IdlePose::Stand, check("pose_stand", "Stand", !rotating && prefs.idle_pose == IdlePose::Stand)?),
        (IdlePose::LookAround, check("pose_look", "Look Around", !rotating && prefs.idle_pose == IdlePose::LookAround)?),
        (IdlePose::Sit, check("pose_sit", "Sit", !rotating && prefs.idle_pose == IdlePose::Sit)?),
        (IdlePose::SwingLegs, check("pose_swing", "Sit & Swing Legs", !rotating && prefs.idle_pose == IdlePose::SwingLegs)?),
        (IdlePose::Wave, check("pose_wave", "Wave", !rotating && prefs.idle_pose == IdlePose::Wave)?),
        (IdlePose::Nap, check("pose_nap", "Nap", !rotating && prefs.idle_pose == IdlePose::Nap)?),
    ];
    let rotate_poses = check("pose_rotate", "Rotate Poses Automatically", rotating)?;
    let pose_sep = PredefinedMenuItem::separator(app)?;
    let pose_menu = Submenu::with_items(
        app,
        "Idle Pose",
        true,
        &[&rotate_poses, &pose_sep, &poses[0].1, &poses[1].1, &poses[2].1, &poses[3].1, &poses[4].1, &poses[5].1],
    )?;
    let set_spot = MenuItem::with_id(app, "favorite_set", "Set Favorite Spot Here", true, None::<&str>)?;
    let go_spot = MenuItem::with_id(app, "favorite_return", "Return to Favorite Spot", true, None::<&str>)?;
    let mode_sep = PredefinedMenuItem::separator(app)?;
    let mode_menu = Submenu::with_items(app, "Mode", true, &[&modes[0].1, &modes[1].1, &mode_sep, &set_spot, &go_spot, &pose_menu])?;
    let chat_item = MenuItem::with_id(app, "chat", "Chat with Companion…", true, None::<&str>)?;
    let app_awareness = check("awareness_apps", "React to App Switches", prefs.awareness.app_enabled)?;
    let quiet = check("quiet", "Quiet Mode", prefs.awareness.quiet)?;

    // Cursor modes (visual only) and the opt-in real-cursor hiding for Become.
    let cursor_modes = vec![
        (CursorMode::Off, check("cursor_off", "Off", prefs.cursor_mode == CursorMode::Off)?),
        (CursorMode::Ride, check("cursor_ride", "Ride Cursor", prefs.cursor_mode == CursorMode::Ride)?),
        (CursorMode::Hug, check("cursor_hug", "Hold Cursor", prefs.cursor_mode == CursorMode::Hug)?),
        (CursorMode::Become, check("cursor_become", "Become Cursor", prefs.cursor_mode == CursorMode::Become)?),
    ];
    let hide_cursor = check("hide_cursor", "Hide Real Cursor in Become Mode", prefs.hide_system_cursor)?;
    let cursor_sep = PredefinedMenuItem::separator(app)?;
    let cursor_menu = Submenu::with_items(
        app,
        "Cursor",
        true,
        &[&cursor_modes[0].1, &cursor_modes[1].1, &cursor_modes[2].1, &cursor_modes[3].1, &cursor_sep, &hide_cursor],
    )?;

    // Eye of Cthulhu.
    let summon = MenuItem::with_id(app, "boss_summon", "Summon Eye of Cthulhu", true, None::<&str>)?;
    let summon_moon = MenuItem::with_id(app, "boss_moon", "Summon Moon Lord", true, None::<&str>)?;
    let summon_queen = MenuItem::with_id(app, "boss_queen", "Summon Queen Bee", true, None::<&str>)?;
    let retry = MenuItem::with_id(app, "boss_retry", "Retry Fight", true, None::<&str>)?;
    let dismiss_boss = MenuItem::with_id(app, "boss_dismiss", "Dismiss Boss", true, None::<&str>)?;
    let difficulties = vec![
        (BossDifficulty::Easy, check("diff_easy", "Easy", prefs.boss_difficulty == BossDifficulty::Easy)?),
        (BossDifficulty::Normal, check("diff_normal", "Normal", prefs.boss_difficulty == BossDifficulty::Normal)?),
        (BossDifficulty::Expert, check("diff_expert", "Expert", prefs.boss_difficulty == BossDifficulty::Expert)?),
        (BossDifficulty::Master, check("diff_master", "Master", prefs.boss_difficulty == BossDifficulty::Master)?),
    ];
    let diff_menu = Submenu::with_items(
        app,
        "Difficulty",
        true,
        &[&difficulties[0].1, &difficulties[1].1, &difficulties[2].1, &difficulties[3].1],
    )?;
    let boss_menu = Submenu::with_items(app, "Boss", true, &[&summon, &summon_queen, &summon_moon, &retry, &dismiss_boss, &diff_menu])?;

    // Temporary visual effects, with an immediate off switch.
    let letter_break = check("fx_letters", "Letter Smash Enabled", prefs.effects.letter_break)?;
    let smash_now = MenuItem::with_id(app, "fx_smash", "Smash Letters Now", true, None::<&str>)?;
    let stop_fx = MenuItem::with_id(app, "fx_stop", "Stop All Effects", true, None::<&str>)?;
    let effects_menu = Submenu::with_items(app, "Effects", true, &[&letter_break, &smash_now, &stop_fx])?;
    let training_menu = Submenu::with_items(
        app,
        "Training",
        true,
        &[&training, &reset_training, &dismiss_minions],
    )?;
    let sizes = SIZES
        .iter()
        .map(|(scale, label)| {
            CheckMenuItem::with_id(
                app,
                format!("size_{scale}"),
                *label,
                true,
                prefs.scale == *scale,
                None::<&str>,
            )
            .map(|item| (*scale, item))
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let size_menu = Submenu::with_items(
        app,
        "Size",
        true,
        &[&sizes[0].1, &sizes[1].1, &sizes[2].1],
    )?;
    let world = check("world_toggle", "Terraria World Background", prefs.world.enabled)?;
    let world_explore = MenuItem::with_id(app, "world_explore", "Explore World…", true, None::<&str>)?;
    let game_play = MenuItem::with_id(app, "game_play", "Play Terraria", true, None::<&str>)?;
    let game_auto = MenuItem::with_id(app, "game_auto", "Let the Team Play (Build a House)", true, None::<&str>)?;
    let game_stop = MenuItem::with_id(app, "game_stop", "Stop Playing", true, None::<&str>)?;
    let world_menu = Submenu::with_items(app, "World", true, &[&world, &world_explore, &game_play, &game_auto, &game_stop])?;
    let quit = MenuItem::with_id(app, "quit", "Quit Terraria Companion CJ Ver", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle_visible,
            &pause,
            &platforms,
            &control,
            &build,
            &lines,
            &cookie,
            &mode_menu,
            &cursor_menu,
            &boss_menu,
            &effects_menu,
            &chat_item,
            &app_awareness,
            &quiet,
            &inventory,
            &dock_item,
            &training_menu,
            &size_menu,
            &world_menu,
            &separator,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Terraria Companion CJ Ver")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()));
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayItems {
        toggle_visible,
        pause,
        platforms,
        training,
        control,
        build,
        lines,
        modes,
        poses,
        cursor_modes,
        hide_cursor,
        difficulties,
        letter_break,
        inventory,
        dock: dock_item,
        rotate_poses,
        app_awareness,
        quiet,
        sizes,
        world,
    });
    Ok(())
}

/// Enter or leave "Control Character" mode. Entering focuses the overlay so it receives the
/// keyboard and every click (like a game window); leaving restores click-through. Session-only.
/// Control Mode is on (driving a companion, or playing the background world).
fn control_active(state: &AppState) -> bool {
    state.control.load(Ordering::Relaxed)
}

/// Start / stop playing the background world: its window takes the mouse and keyboard (it stays
/// behind app windows); the overlay stays click-through so clicks reach the world.
fn set_world_play(app: &AppHandle, on: bool, mode: &str) {
    let state = app.state::<AppState>();
    if state.world_play.swap(on, Ordering::Relaxed) == on {
        // Already playing: switching between "player" and "auto" just tells the world.
        if on {
            let _ = app.emit("companion://world-play", serde_json::json!({ "on": true, "mode": mode }));
        }
        return;
    }
    if on {
        state.world_nav.store(false, Ordering::Relaxed);
    }
    state.control_epoch.fetch_add(1, Ordering::Relaxed);
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let _ = overlay.set_ignore_cursor_events(true);
    }
    let _ = app.emit("companion://world-play", serde_json::json!({ "on": on, "mode": mode }));
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GameStart {
    ok: bool,
    /// Kept for the UI's shape: other windows never block a game any more (always 0).
    blocked: usize,
    /// Didn't start: playing needs Accessibility permission (the world is under the icons).
    needs_accessibility: bool,
}

/// Start the background-world game: "player" (your companion plays) or "auto" (your companions
/// play on their own). Other apps' windows can stay open: the world keeps running behind them.
#[tauri::command]
fn start_game(app: AppHandle, mode: String) -> GameStart {
    let mode = if mode == "auto" { "auto" } else { "player" };
    if !world_input_allowed() {
        return GameStart { ok: false, blocked: 0, needs_accessibility: true };
    }
    if !app.state::<AppState>().prefs.lock().unwrap().world.enabled {
        update_prefs(&app, |p| p.world.enabled = true);
    }
    set_control(&app, false);
    // Our own panels step aside too, so the world is the whole screen.
    for label in [INVENTORY, CHAT] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
    set_world_play(&app, true, mode);
    GameStart { ok: true, blocked: 0, needs_accessibility: false }
}

#[tauri::command]
fn stop_game(app: AppHandle) {
    set_world_play(&app, false, "");
}

/// macOS "Hide Others": clears the desktop for the game (nothing is closed).
#[tauri::command]
fn hide_other_apps(app: AppHandle) {
    let _ = app.run_on_main_thread(apps::hide_other_apps);
}

#[tauri::command]
fn get_world_play(state: State<AppState>) -> bool {
    state.world_play.load(Ordering::Relaxed)
}

fn set_control(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    // Character Control always drives the desktop companion; leaving a game first if one runs.
    if enabled && state.world_play.load(Ordering::Relaxed) {
        set_world_play(app, false, "");
    }
    if state.control.swap(enabled, Ordering::Relaxed) == enabled {
        return;
    }
    state.control_epoch.fetch_add(1, Ordering::Relaxed);
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let _ = overlay.set_ignore_cursor_events(!captures_all(&state));
        if enabled {
            let _ = overlay.show();
            let _ = overlay.set_focus();
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.control.set_checked(enabled);
    }
    let _ = app.emit(CONTROL_EVENT, enabled);
}

/// Enter or leave Build mode: the overlay takes the mouse (clicks place / remove blocks) and the
/// keyboard (block selection, Esc). Leaving restores click-through. Session-only.
fn set_build(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    if enabled {
        set_lines(app, false); // one editing mode at a time
    }
    if state.build.swap(enabled, Ordering::Relaxed) == enabled {
        return;
    }
    state.control_epoch.fetch_add(1, Ordering::Relaxed);
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let _ = overlay.set_ignore_cursor_events(!captures_all(&state));
        if enabled {
            let _ = overlay.show();
            let _ = overlay.set_focus();
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.build.set_checked(enabled);
    }
    let _ = app.emit(BUILD_EVENT, enabled);
}

/// Enter or leave Platform-edit mode (draw, move, resize and delete invisible platforms). The
/// overlay takes the mouse and keyboard; leaving restores click-through. Session-only.
fn set_lines(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    if enabled {
        set_build(app, false);
    }
    if state.lines.swap(enabled, Ordering::Relaxed) == enabled {
        return;
    }
    state.control_epoch.fetch_add(1, Ordering::Relaxed);
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let _ = overlay.set_ignore_cursor_events(!captures_all(&state));
        if enabled {
            let _ = overlay.show();
            let _ = overlay.set_focus();
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.lines.set_checked(enabled);
    }
    let _ = app.emit(LINES_EVENT, enabled);
}

/// Developer aid for manual testing: `TC_DEMO=summonBoss,letterSmash` sends those combat
/// commands (through the same validation as the tray) a few seconds apart after launch;
/// `control` toggles Control Mode the same way the tray item does; `settings` opens the settings
/// window.
fn spawn_demo(app: AppHandle) {
    let Some(list) = std::env::var_os("TC_DEMO") else { return };
    let actions: Vec<String> = list.to_string_lossy().split(',').map(|s| s.trim().to_string()).collect();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        for action in actions {
            // "control" toggles Control Mode (plays the world when it's shown), like the tray item.
            if action == "play" || action == "auto" {
                let r = start_game(app.clone(), action.clone());
                eprintln!("[demo] start_game({action}): ok={} blocked={}", r.ok, r.blocked);
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
            if action == "stop" {
                set_world_play(&app, false, "");
                eprintln!("[demo] stop_game");
                continue;
            }
            if action == "settings" {
                set_inventory_visible(&app, true);
                eprintln!("[demo] settings");
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
            if action == "control" {
                let on = !control_active(&app.state::<AppState>());
                set_control(&app, on);
                eprintln!("[demo] control: {on}");
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
            let ok = send_combat(&app, &action, None);
            eprintln!("[demo] {action}: {}", if ok { "sent" } else { "rejected" });
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

/// Validate and forward a combat command to the overlay. Returns whether it was accepted.
fn send_combat(app: &AppHandle, action: &str, dir: Option<i8>) -> bool {
    match combat::parse(action, dir) {
        Some(command) if command.action == combat::CombatAction::ExploreWorld => {
            let ok = set_world_nav(app, true);
            if !ok {
                say_needs_accessibility(app);
            }
            ok
        }
        Some(command) => app.emit(COMBAT_EVENT, command).is_ok(),
        None => false,
    }
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "toggle_visible" => {
            update_prefs(app, |p| p.visible = !p.visible);
        }
        "pause" => {
            update_prefs(app, |p| p.paused = !p.paused);
        }
        "platforms" => {
            update_prefs(app, |p| p.platforms = !p.platforms);
        }
        "inventory" => toggle_inventory_window(app),
        "world_toggle" => {
            update_prefs(app, |p| p.world.enabled = !p.world.enabled);
        }
        "world_explore" => {
            if !set_world_nav(app, true) {
                say_needs_accessibility(app);
            }
        }
        "game_play" | "game_auto" => {
            let mode = if id == "game_auto" { "auto" } else { "player" };
            if start_game(app.clone(), mode.into()).needs_accessibility {
                say_needs_accessibility(app);
            }
        }
        "game_stop" => set_world_play(app, false, ""),
        "toggle_dock" => {
            update_prefs(app, |p| p.dock.visible = !p.dock.visible);
        }
        "training" => {
            update_prefs(app, |p| p.training = !p.training);
        }
        "control" => {
            let on = !control_active(&app.state::<AppState>());
            set_control(app, on);
        }
        "build" => {
            let on = !app.state::<AppState>().build.load(Ordering::Relaxed);
            set_build(app, on);
        }
        "lines" => {
            let on = !app.state::<AppState>().lines.load(Ordering::Relaxed);
            set_lines(app, on);
        }
        "cookie" => {
            send_combat(app, "toggleCookie", None);
        }
        "mode_roam" => {
            update_prefs(app, |p| p.companion_mode = CompanionMode::Roam);
        }
        "mode_stay" => {
            update_prefs(app, |p| p.companion_mode = CompanionMode::Stay);
        }
        "pose_stand" | "pose_sit" | "pose_wave" | "pose_look" | "pose_swing" | "pose_nap" => {
            let pose = match id {
                "pose_sit" => IdlePose::Sit,
                "pose_wave" => IdlePose::Wave,
                "pose_look" => IdlePose::LookAround,
                "pose_swing" => IdlePose::SwingLegs,
                "pose_nap" => IdlePose::Nap,
                _ => IdlePose::Stand,
            };
            update_prefs(app, |p| {
                p.idle_pose = pose;
                p.idle.get_or_insert_with(Default::default).mode = IdleMode::Fixed;
            });
        }
        "pose_rotate" => {
            update_prefs(app, |p| {
                let idle = p.idle.get_or_insert_with(Default::default);
                idle.mode = if idle.mode == IdleMode::Rotate { IdleMode::Fixed } else { IdleMode::Rotate };
            });
        }
        "favorite_set" => {
            send_combat(app, "setFavoriteSpot", None);
        }
        "favorite_return" => {
            send_combat(app, "returnToFavorite", None);
        }
        "chat" => set_chat_visible(app, true),
        "awareness_apps" => {
            update_prefs(app, |p| p.awareness.app_enabled = !p.awareness.app_enabled);
        }
        "quiet" => {
            update_prefs(app, |p| p.awareness.quiet = !p.awareness.quiet);
        }
        "cursor_off" | "cursor_ride" | "cursor_hug" | "cursor_become" => {
            let mode = match id {
                "cursor_ride" => CursorMode::Ride,
                "cursor_hug" => CursorMode::Hug,
                "cursor_become" => CursorMode::Become,
                _ => CursorMode::Off,
            };
            update_prefs(app, |p| p.cursor_mode = mode);
        }
        "hide_cursor" => {
            update_prefs(app, |p| p.hide_system_cursor = !p.hide_system_cursor);
        }
        "diff_easy" | "diff_normal" | "diff_expert" | "diff_master" => {
            let d = match id {
                "diff_easy" => BossDifficulty::Easy,
                "diff_expert" => BossDifficulty::Expert,
                "diff_master" => BossDifficulty::Master,
                _ => BossDifficulty::Normal,
            };
            update_prefs(app, |p| p.boss_difficulty = d);
        }
        "boss_summon" => {
            send_combat(app, "summonBoss", None);
        }
        "boss_queen" => {
            send_combat(app, "summonQueenBee", None);
        }
        "boss_moon" => {
            send_combat(app, "summonMoonLord", None);
        }
        "boss_retry" => {
            send_combat(app, "retryBoss", None);
        }
        "boss_dismiss" => {
            send_combat(app, "dismissBoss", None);
        }
        "fx_letters" => {
            update_prefs(app, |p| p.effects.letter_break = !p.effects.letter_break);
        }
        "fx_smash" => {
            send_combat(app, "letterSmash", None);
        }
        "fx_stop" => {
            send_combat(app, "stopEffects", None);
        }
        "reset_training" => {
            send_combat(app, "reset", None);
        }
        "dismiss_minions" => {
            send_combat(app, "dismiss", None);
        }
        "quit" => app.exit(0),
        other => {
            if let Some(scale) = other.strip_prefix("size_").and_then(|s| s.parse().ok()) {
                update_prefs(app, |p| p.scale = scale);
            }
        }
    }
}

#[tauri::command]
fn get_prefs(state: State<AppState>) -> Prefs {
    state.prefs.lock().unwrap().clone()
}

#[tauri::command]
fn patch_prefs(app: AppHandle, patch: PrefsPatch) -> Prefs {
    update_prefs(&app, |p| p.apply(&patch))
}

#[tauri::command]
fn get_platforms(state: State<AppState>) -> Vec<PlatformWindow> {
    state.platforms.lock().unwrap().clone()
}

#[tauri::command]
fn set_hitbox(state: State<AppState>, rect: Option<Rect>, extra: Option<Vec<Rect>>) {
    *state.hitbox.lock().unwrap() = rect;
    // At most 8 extras with sane sizes (up to 4000×4000 so a maximized chess board fits; the
    // overlay only takes clicks inside them while the cursor is there).
    *state.hitbox_extra.lock().unwrap() = extra.unwrap_or_default().into_iter().filter(|r| r.w > 0.0 && r.h > 0.0 && r.w <= 4000.0 && r.h <= 4000.0).take(8).collect();
}

#[tauri::command]
fn set_capture(state: State<AppState>, active: bool) {
    state.capture.store(active, Ordering::Relaxed);
}

#[tauri::command]
fn toggle_inventory(app: AppHandle) {
    toggle_inventory_window(&app);
}

#[tauri::command]
fn hide_inventory(app: AppHandle) {
    set_inventory_visible(&app, false);
}

/// Open the inventory window (used by the dock; never toggles it closed).
#[tauri::command]
fn show_inventory(app: AppHandle) {
    set_inventory_visible(&app, true);
}

/// Resize the dock to fit its layout (size validated), keeping it inside the usable area.
#[tauri::command]
fn set_dock_size(app: AppHandle, width: f64, height: f64) {
    let Some(win) = app.get_webview_window(DOCK) else { return };
    let (w, h) = dock::clamp_size(width, height);
    if let Some((cw, ch)) = logical_size(&win) {
        if (cw - w).abs() < 0.5 && (ch - h).abs() < 0.5 {
            return;
        }
    }
    let _ = win.set_size(LogicalSize::new(w, h));
    place_dock(&app, &win);
}

#[tauri::command]
fn set_control_mode(app: AppHandle, enabled: bool) {
    set_control(&app, enabled);
}

#[tauri::command]
fn get_control_mode(state: State<AppState>) -> bool {
    control_active(&state)
}

#[tauri::command]
fn set_build_mode(app: AppHandle, enabled: bool) {
    set_build(&app, enabled);
}

#[tauri::command]
fn get_build_mode(state: State<AppState>) -> bool {
    state.build.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_lines_mode(app: AppHandle, enabled: bool) {
    set_lines(&app, enabled);
}

#[tauri::command]
fn get_lines_mode(state: State<AppState>) -> bool {
    state.lines.load(Ordering::Relaxed)
}

/// Pause (or resume) all global shortcuts while settings records a new one.
#[tauri::command]
fn suspend_shortcuts(app: AppHandle, suspended: bool) {
    let state = app.state::<AppState>();
    if state.shortcuts_suspended.swap(suspended, Ordering::Relaxed) == suspended {
        return;
    }
    let prefs = state.prefs.lock().unwrap().clone();
    sync_shortcuts(&app, &prefs);
}

#[tauri::command]
fn cookie_shortcut_status(app: AppHandle) -> String {
    app.state::<AppState>().cookie_shortcut_status.lock().unwrap().clone()
}

#[tauri::command]
fn lines_shortcut_status(app: AppHandle) -> String {
    app.state::<AppState>().lines_shortcut_status.lock().unwrap().clone()
}

#[tauri::command]
fn ambient_geometry(app: AppHandle) -> Option<AmbientGeometry> {
    ambient_geometry_for(&app.get_webview_window(AMBIENT)?)
}

#[tauri::command]
fn build_shortcut_status(app: AppHandle) -> String {
    app.state::<AppState>().build_shortcut_status.lock().unwrap().clone()
}

/// Compose (or reuse) the real-Terraria-art player atlas for the saved appearance and skin.
/// Runs off the main thread; returns `available: false` with a reason when the game isn't found.
#[tauri::command]
async fn get_player_rig(app: AppHandle) -> terraria_app::RigInfo {
    let (appearance, skin) = {
        let state = app.state::<AppState>();
        let p = state.prefs.lock().unwrap();
        (p.appearance.clone(), p.skin)
    };
    compose_rig(app, appearance, skin).await
}

/// The player in the background-world game, wearing armour (sheet ids 1–4 = copper, iron, silver,
/// gold). Uses the saved look with the default skin; the saved appearance isn't changed.
#[tauri::command]
async fn get_game_rig(app: AppHandle, head: Option<u16>, body: Option<u16>, legs: Option<u16>) -> terraria_app::RigInfo {
    let mut appearance = app.state::<AppState>().prefs.lock().unwrap().appearance.clone();
    let ok = |v: Option<u16>| v.filter(|n| (1..=300).contains(n));
    appearance.armor.head = ok(head);
    appearance.armor.body = ok(body);
    appearance.armor.legs = ok(legs);
    compose_rig(app, appearance, prefs::SkinId::default()).await
}

/// Atlas for a specific skin (settings previews); doesn't change the saved skin.
#[tauri::command]
async fn get_skin_rig(app: AppHandle, skin: prefs::SkinId) -> terraria_app::RigInfo {
    let appearance = app.state::<AppState>().prefs.lock().unwrap().appearance.clone();
    compose_rig(app, appearance, skin).await
}

async fn compose_rig(app: AppHandle, appearance: terraria::player::Appearance, skin: prefs::SkinId) -> terraria_app::RigInfo {
    tauri::async_runtime::spawn_blocking(move || app.state::<terraria_app::TerrariaAssets>().rig_for(&appearance, skin))
        .await
        .unwrap_or_else(|e| terraria_app::RigInfo::unavailable(format!("rig task failed: {e}")))
}

/// Atlas for a roster character (see `TerrariaAssets::character_rig`).
#[tauri::command]
async fn get_character_rig(app: AppHandle, id: String) -> terraria_app::RigInfo {
    if !prefs::CHARACTER_IDS.contains(&id.as_str()) {
        return terraria_app::RigInfo::unavailable("unknown character".into());
    }
    let (appearance, skin, look) = {
        let state = app.state::<AppState>();
        let p = state.prefs.lock().unwrap();
        let look = p.characters.per.iter().find(|c| c.id == id).map(|c| c.look.clone()).unwrap_or_default();
        (p.appearance.clone(), p.skin, look)
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<terraria_app::TerrariaAssets>().character_rig_with(&id, &appearance, skin, (&look.skin, &look.eyes, look.hair))
    })
        .await
        .unwrap_or_else(|e| terraria_app::RigInfo::unavailable(format!("rig task failed: {e}")))
}

/// Installed add-on packs (characters, boss textures, sounds).
#[tauri::command]
fn list_addons(app: AppHandle) -> crate::terraria::addons::AddonInfo {
    app.state::<terraria_app::TerrariaAssets>().addon_info()
}

#[tauri::command]
fn list_skins(app: AppHandle) -> Vec<terraria_app::SkinInfo> {
    app.state::<terraria_app::TerrariaAssets>().skins()
}

#[tauri::command]
fn list_voices(app: AppHandle) -> terraria_app::VoiceList {
    app.state::<terraria_app::TerrariaAssets>().voices()
}

/// Pointer position in overlay CSS px (for the pickaxe effect). Uses only the global mouse
/// location (no Accessibility or Screen Recording permission); never reads what's under it.
#[tauri::command]
fn get_cursor(app: AppHandle) -> Option<(f64, f64)> {
    let win = app.get_webview_window(OVERLAY)?;
    let origin = win.inner_position().ok()?;
    let scale = win.scale_factor().ok()?;
    cursor_local(&app, Some(((origin.x as f64, origin.y as f64), scale)))
}

/// Transcribe a push-to-talk recording (base64 WAV) with the bundled speech helper.
#[tauri::command]
async fn transcribe(audio: String, locale: Option<String>) -> Result<voice::Transcript, voice::VoiceFailure> {
    tauri::async_runtime::spawn_blocking(move || {
        let wav = voice::base64_decode(&audio).ok_or_else(|| voice::VoiceFailure { kind: "badaudio".into(), message: "The recording couldn't be read.".into() })?;
        drop(audio);
        voice::transcribe(&wav, locale.as_deref())
    })
    .await
    .unwrap_or_else(|e| Err(voice::VoiceFailure { kind: "helper".into(), message: e.to_string() }))
}

/// A pickaxe strike at an overlay point: queue it (as a global screen point) for any page running
/// the Letter Destroyer. Returns whether such a page is currently listening.
#[tauri::command]
fn destroyer_strike(app: AppHandle, x: f64, y: f64, power: Option<u8>) -> bool {
    let state = app.state::<AppState>();
    if !state.prefs.lock().unwrap().destroyer.connect || !x.is_finite() || !y.is_finite() {
        return false;
    }
    let Some(win) = app.get_webview_window(OVERLAY) else { return false };
    let (Ok(origin), Ok(scale)) = (win.inner_position(), win.scale_factor()) else { return false };
    let (gx, gy) = (origin.x as f64 / scale + x, origin.y as f64 / scale + y);
    let now = std::time::Instant::now();
    let mut strikes = state.destroyer_strikes.lock().unwrap();
    strikes.push(gx, gy, power.unwrap_or(1), now);
    strikes.connected(now)
}

#[tauri::command]
fn destroyer_status(app: AppHandle) -> String {
    app.state::<AppState>().destroyer_status.lock().unwrap().clone()
}

/// Where CustomNotch is (overlay CSS px) and who lives in it.
#[tauri::command]
fn notch_status(app: AppHandle) -> serde_json::Value {
    notch_payload(&app)
}

/// A companion moves into the notch (or the resident's look changed). Fails if someone else
/// already lives there.
#[tauri::command]
fn notch_enter(app: AppHandle, resident: notch_link::ResidentIn) -> Result<(), String> {
    app.state::<AppState>().notch.enter(resident, &prefs::CHARACTER_IDS, std::time::Instant::now())
}

#[tauri::command]
fn notch_leave(app: AppHandle, character: String) -> bool {
    app.state::<AppState>().notch.leave(&character)
}

/// The resident said something: it waits in the notch until it's read.
#[tauri::command]
fn notch_say(app: AppHandle, character: String, text: String) -> bool {
    app.state::<AppState>().notch.say(&character, &text)
}

#[tauri::command]
fn notch_gesture(app: AppHandle, character: String, gesture: String) -> bool {
    app.state::<AppState>().notch.gesture(&character, &gesture)
}

/// A companion is held over the notch ("empty" / "full"), on her way in ("incoming"), or not ("").
#[tauri::command]
fn notch_hover(app: AppHandle, state: String) {
    app.state::<AppState>().notch.hover(&state);
}

#[tauri::command]
fn control_shortcut_status(app: AppHandle) -> String {
    app.state::<AppState>().control_shortcut_status.lock().unwrap().clone()
}

#[tauri::command]
fn voice_shortcut_status(app: AppHandle) -> String {
    app.state::<AppState>().voice_shortcut_status.lock().unwrap().clone()
}

/// Let the overlay take keyboard focus (to edit a transcript); it gives it back on close.
#[tauri::command]
fn focus_overlay(app: AppHandle) {
    if let Some(w) = app.get_webview_window(OVERLAY) {
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn running_apps() -> Vec<apps::AppInfo> {
    apps::running_apps()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenStatus {
    opted_in: bool,
    permission: bool,
    secure_input: bool,
}

#[tauri::command]
fn screen_status(app: AppHandle) -> ScreenStatus {
    let opted_in = app.state::<AppState>().prefs.lock().unwrap().awareness.screen_enabled;
    #[cfg(target_os = "macos")]
    let permission = <screen::CoreGraphicsScreen as screen::ScreenSource>::has_permission(&screen::CoreGraphicsScreen);
    #[cfg(not(target_os = "macos"))]
    let permission = false;
    ScreenStatus { opted_in, permission, secure_input: apps::secure_input_enabled() }
}

/// Show macOS's Screen Recording prompt (only after the user opted in and pressed the button).
#[tauri::command]
fn request_screen_permission(app: AppHandle) -> bool {
    if !app.state::<AppState>().prefs.lock().unwrap().awareness.screen_enabled {
        return false;
    }
    #[cfg(target_os = "macos")]
    return screen::CoreGraphicsScreen::request_permission();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Open System Settings at Privacy & Security → Screen Recording.
#[tauri::command]
fn open_privacy_settings() {
    let _ = std::process::Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn();
}

/// macOS System Settings panes the assistant may open when asked ("take me to my Bluetooth
/// settings"). Only these fixed URLs; nothing is changed, the pane is just shown.
pub fn system_settings_url(pane: &str) -> Option<&'static str> {
    Some(match pane {
        "main" => "x-apple.systempreferences:",
        "wifi" => "x-apple.systempreferences:com.apple.wifi-settings-extension",
        "bluetooth" => "x-apple.systempreferences:com.apple.BluetoothSettings",
        "network" => "x-apple.systempreferences:com.apple.Network-Settings.extension",
        "sound" => "x-apple.systempreferences:com.apple.Sound-Settings.extension",
        "displays" => "x-apple.systempreferences:com.apple.Displays-Settings.extension",
        "wallpaper" => "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension",
        "appearance" => "x-apple.systempreferences:com.apple.Appearance-Settings.extension",
        "desktop-dock" => "x-apple.systempreferences:com.apple.Desktop-Settings.extension",
        "control-center" => "x-apple.systempreferences:com.apple.ControlCenter-Settings.extension",
        "notifications" => "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
        "focus" => "x-apple.systempreferences:com.apple.Focus-Settings.extension",
        "screen-time" => "x-apple.systempreferences:com.apple.Screen-Time-Settings.extension",
        "battery" => "x-apple.systempreferences:com.apple.Battery-Settings.extension",
        "keyboard" => "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
        "trackpad" => "x-apple.systempreferences:com.apple.Trackpad-Settings.extension",
        "mouse" => "x-apple.systempreferences:com.apple.Mouse-Settings.extension",
        "accessibility" => "x-apple.systempreferences:com.apple.Accessibility-Settings.extension",
        "general" => "x-apple.systempreferences:com.apple.systempreferences.GeneralSettings",
        "software-update" => "x-apple.systempreferences:com.apple.Software-Update-Settings.extension",
        "storage" => "x-apple.systempreferences:com.apple.settings.Storage",
        "users" => "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension",
        "lock-screen" => "x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension",
        "privacy" => "x-apple.systempreferences:com.apple.preference.security?Privacy",
        "screen-recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        "speech" => "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
        "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
        "accessibility-privacy" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "location" => "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
        _ => return None,
    })
}

#[tauri::command]
fn open_system_settings(pane: String) -> bool {
    match system_settings_url(&pane) {
        Some(url) => std::process::Command::new("/usr/bin/open").arg(url).spawn().is_ok(),
        None => false,
    }
}

#[tauri::command]
async fn ai_status(app: AppHandle) -> ai::AiStatus {
    let model = app.state::<AppState>().prefs.lock().unwrap().ai.model.clone();
    tauri::async_runtime::spawn_blocking(move || ai::status(&ai::Curl, &model))
        .await
        .unwrap_or_else(|e| ai::AiStatus { available: false, provider: "Ollama".into(), models: vec![], model: None, reason: Some(e.to_string()) })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatReply {
    text: String,
    /// Small screenshot preview (data URL), only when the user chose to keep screenshots.
    thumbnail: Option<String>,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ChatFailure {
    /// "refused" (privacy/permission), "cancelled", or "error".
    kind: String,
    message: String,
}

/// Ask the local model. With `screen`, one screenshot is captured after every privacy check,
/// used for this answer only, and dropped before returning (unless keeping previews is on).
#[tauri::command]
async fn chat_ask(app: AppHandle, request_id: String, messages: Vec<ai::ChatMessage>, screen: bool) -> Result<ChatReply, ChatFailure> {
    let requests = app.state::<ai::Requests>();
    let cancel = requests.start(&request_id);
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<AppState>();
        let (model, length, aware, keep_shots, style) = {
            let p = state.prefs.lock().unwrap();
            let style = ai::Style { intensity: p.persona.intensity.clone(), affection: p.selected_affection(), character: p.characters.selected.clone() };
            (p.ai.model.clone(), p.ai.length.clone(), p.awareness.clone(), p.awareness.keep_screenshots, style)
        };
        let mut thumbnail = None;
        let shot = if screen {
            let front = state.last_external_app.lock().unwrap().clone().or_else(apps::frontmost);
            // Keep the chat window out of the picture while capturing.
            let chat = worker.get_webview_window(CHAT).filter(|w| w.is_visible().unwrap_or(false));
            if let Some(w) = &chat {
                let _ = w.hide();
                std::thread::sleep(Duration::from_millis(180));
            }
            let ctx = screen::Context {
                opted_in: aware.screen_enabled,
                front_bundle: front.as_ref().map(|a| a.bundle_id.as_str()),
                front_name: front.as_ref().map(|a| a.name.as_str()),
                excluded: &aware.excluded,
                secure_input: apps::secure_input_enabled(),
            };
            #[cfg(target_os = "macos")]
            let captured = screen::capture_checked(&ctx, &screen::CoreGraphicsScreen);
            #[cfg(not(target_os = "macos"))]
            let captured: Result<screen::Shot, screen::Refusal> = Err(screen::Refusal::CaptureFailed { detail: "macOS only".into() });
            if let Some(w) = &chat {
                let _ = w.show();
            }
            match captured {
                Ok(s) => Some(s),
                Err(r) => return Err(ChatFailure { kind: "refused".into(), message: r.message() }),
            }
        } else {
            None
        };
        if let Some(s) = &shot {
            if keep_shots {
                thumbnail = Some(format!("data:image/png;base64,{}", ai::base64(&s.thumb)));
            }
        }
        let answer = ai::ask_styled(&ai::Curl, &model, &messages, shot.as_ref().map(|s| s.png.as_slice()), &cancel, &length, &style);
        drop(shot); // the screenshot never outlives the request
        match answer {
            Ok(text) => Ok(ChatReply { text, thumbnail }),
            Err(ai::AiError::Cancelled) => Err(ChatFailure { kind: "cancelled".into(), message: ai::AiError::Cancelled.message() }),
            Err(e) => Err(ChatFailure { kind: "error".into(), message: e.message() }),
        }
    })
    .await
    .unwrap_or_else(|e| Err(ChatFailure { kind: "error".into(), message: e.to_string() }));
    app.state::<ai::Requests>().finish(&request_id);
    result
}

/// The part of the screen you boxed, for study help: captured after the screen-awareness privacy
/// checks, its text read on this Mac (Apple Vision), the pixels dropped. Returns the lines in
/// global points.
#[tauri::command]
async fn study_look(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<Vec<study::Line>, ChatFailure> {
    if !(w >= 8.0 && h >= 8.0) || ![x, y, w, h].iter().all(|v| v.is_finite()) {
        return Err(ChatFailure { kind: "error".into(), message: "That box is too small to read.".into() });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let aware = state.prefs.lock().unwrap().awareness.clone();
        let front = state.last_external_app.lock().unwrap().clone().or_else(apps::frontmost);
        let ctx = screen::Context {
            opted_in: aware.screen_enabled,
            front_bundle: front.as_ref().map(|a| a.bundle_id.as_str()),
            front_name: front.as_ref().map(|a| a.name.as_str()),
            excluded: &aware.excluded,
            secure_input: apps::secure_input_enabled(),
        };
        #[cfg(target_os = "macos")]
        {
            struct Region(f64, f64, f64, f64);
            impl screen::ScreenSource for Region {
                fn has_permission(&self) -> bool {
                    screen::ScreenSource::has_permission(&screen::CoreGraphicsScreen)
                }
                fn capture(&self) -> Result<screen::Shot, String> {
                    Ok(screen::Shot { png: screen::capture_rect(self.0, self.1, self.2, self.3)?, width: 0, height: 0, thumb: Vec::new() })
                }
            }
            let shot = screen::capture_checked(&ctx, &Region(x, y, w, h)).map_err(|r| ChatFailure { kind: "refused".into(), message: r.message() })?;
            let json = study::read_text(&shot.png).map_err(|e| ChatFailure { kind: "error".into(), message: e })?;
            drop(shot); // the pixels never outlive the reading
            Ok(study::place_lines(&json, (x, y, w, h)))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = ctx;
            Err(ChatFailure { kind: "error".into(), message: "Study help reads the screen on macOS only.".into() })
        }
    })
    .await
    .unwrap_or_else(|e| Err(ChatFailure { kind: "error".into(), message: e.to_string() }))
}

/// A chalkboard lesson for the question's text from the local model (JSON; see study.rs).
#[tauri::command]
async fn study_ask(app: AppHandle, request_id: String, text: String, task: study::Task) -> Result<String, ChatFailure> {
    let requests = app.state::<ai::Requests>();
    let cancel = requests.start(&request_id);
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let model = worker.state::<AppState>().prefs.lock().unwrap().ai.model.clone();
        match study::ask_lesson(&ai::Curl, &model, &text, task, &cancel) {
            Ok(json) => Ok(json),
            Err(ai::AiError::Cancelled) => Err(ChatFailure { kind: "cancelled".into(), message: ai::AiError::Cancelled.message() }),
            Err(e) => Err(ChatFailure { kind: "error".into(), message: e.message() }),
        }
    })
    .await
    .unwrap_or_else(|e| Err(ChatFailure { kind: "error".into(), message: e.to_string() }));
    app.state::<ai::Requests>().finish(&request_id);
    result
}

/// Hand a hard question to Gemini: the prompt goes on the clipboard and Gemini opens in the browser.
#[tauri::command]
fn study_gemini(text: String) -> bool {
    let copied = study::copy(&study::gemini_prompt(&text));
    #[cfg(target_os = "macos")]
    let opened = std::process::Command::new("open").arg("https://gemini.google.com/app").spawn().is_ok();
    #[cfg(not(target_os = "macos"))]
    let opened = false;
    copied && opened
}

/// Map a request onto one of the app's actions with the local model (JSON only; the frontend
/// validates the result against its own catalog and performs the action itself).
#[tauri::command]
async fn ai_classify(app: AppHandle, request: String, catalog: String) -> Result<String, ChatFailure> {
    let model = app.state::<AppState>().prefs.lock().unwrap().ai.model.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cancel = std::sync::atomic::AtomicBool::new(false);
        ai::classify(&ai::Curl, &model, &request, &catalog, &cancel).map_err(|e| ChatFailure { kind: "error".into(), message: e.message() })
    })
    .await
    .unwrap_or_else(|e| Err(ChatFailure { kind: "error".into(), message: e.to_string() }))
}

/// Seconds since the last keyboard / mouse input anywhere (to tell "away" from "busy"). Reads only
/// the idle timer; no input is observed.
#[tauri::command]
fn user_idle_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        unsafe extern "C" {
            fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
        }
        // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = ~0.
        let v = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        if v.is_finite() && v >= 0.0 { v } else { 0.0 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}

/// Open the settings window on a tab ("items", "character", "maps", "companion", "awareness").
#[tauri::command]
fn show_settings(app: AppHandle, tab: Option<String>) {
    set_inventory_visible(&app, true);
    if let Some(tab) = tab.filter(|t| ["items", "character", "maps", "companion", "awareness"].contains(&t.as_str())) {
        let _ = app.emit(SETTINGS_TAB_EVENT, tab);
    }
}

#[tauri::command]
fn chat_cancel(app: AppHandle, request_id: Option<String>) {
    let requests = app.state::<ai::Requests>();
    match request_id {
        Some(id) => {
            requests.cancel(&id);
        }
        None => requests.cancel_all(),
    }
}

use chat_store::StoredMessage;

#[tauri::command]
fn chat_history_load(app: AppHandle) -> Vec<StoredMessage> {
    let state = app.state::<AppState>();
    if !state.prefs.lock().unwrap().awareness.keep_history {
        return Vec::new();
    }
    std::fs::read_to_string(&state.chat_history_path)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<StoredMessage>>(&t).ok())
        .unwrap_or_default()
}

/// Save the conversation if (and only if) history keeping is on; previews only if that's on too.
#[tauri::command]
fn chat_history_save(app: AppHandle, messages: Vec<StoredMessage>) {
    let state = app.state::<AppState>();
    let (keep, shots) = {
        let p = state.prefs.lock().unwrap();
        (p.awareness.keep_history, p.awareness.keep_screenshots)
    };
    match chat_store::to_store(&messages, keep, shots) {
        None => {
            let _ = std::fs::remove_file(&state.chat_history_path);
        }
        Some(cleaned) => {
            if let Ok(json) = serde_json::to_string(&cleaned) {
                if let Some(dir) = state.chat_history_path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(&state.chat_history_path, json);
            }
        }
    }
}

#[tauri::command]
fn chat_history_clear(app: AppHandle) {
    let _ = std::fs::remove_file(&app.state::<AppState>().chat_history_path);
}

#[tauri::command]
fn show_chat(app: AppHandle) {
    set_chat_visible(&app, true);
}

#[tauri::command]
fn hide_chat(app: AppHandle) {
    set_chat_visible(&app, false);
}

/// Front-end errors, printed only when `TC_DEBUG` is set (truncated; never persisted).
#[tauri::command]
fn debug_log(message: String) {
    if std::env::var_os("TC_DEBUG").is_some() {
        eprintln!("[webview] {}", message.chars().take(500).collect::<String>());
    }
}

#[tauri::command]
fn combat_command(app: AppHandle, action: String, dir: Option<i8>) -> Result<(), String> {
    if send_combat(&app, &action, dir) {
        Ok(())
    } else {
        Err(format!("unknown combat action: {action}"))
    }
}

#[cfg(test)]
mod shortcut_tests {
    use super::*;

    #[test]
    fn voice_and_control_shortcuts_never_share_keys() {
        let mut p = Prefs::default();
        p.voice_input.enabled = true;
        let (voice, control) = wanted_shortcuts(&p);
        assert_eq!(voice.as_deref(), Some("Control+Shift+Space"));
        assert_eq!(control, Ok(Some("Control+Shift+KeyC".into())));
        p.control.toggle_shortcut = p.voice_input.shortcut.clone();
        assert!(wanted_shortcuts(&p).1.is_err());
        // With voice input off, the same keys are fine for the toggle.
        p.voice_input.enabled = false;
        assert_eq!(wanted_shortcuts(&p), (None, Ok(Some("Control+Shift+Space".into()))));
        p.control.toggle_enabled = false;
        assert_eq!(wanted_shortcuts(&p).1, Ok(None));
    }

    #[test]
    fn dock_position_is_inferred_from_the_usable_area() {
        // 1440×900 display, 25-pt menu bar.
        let g = dock_layout(1440.0, 900.0, 0.0, 25.0, 1440.0, 800.0);
        assert_eq!((g.dock_edge, g.dock_size, g.menu_bar), ("bottom", 75.0, 25.0));
        let g = dock_layout(1440.0, 900.0, 70.0, 25.0, 1370.0, 875.0);
        assert_eq!((g.dock_edge, g.dock_size), ("left", 70.0));
        let g = dock_layout(1440.0, 900.0, 0.0, 25.0, 1380.0, 875.0);
        assert_eq!((g.dock_edge, g.dock_size), ("right", 60.0));
        let g = dock_layout(1440.0, 900.0, 0.0, 25.0, 1440.0, 871.0); // auto-hidden: 4 pt
        assert_eq!(g.dock_edge, "hidden");
    }

    #[test]
    fn only_known_system_settings_panes_open() {
        assert!(system_settings_url("bluetooth").unwrap().starts_with("x-apple.systempreferences:"));
        assert!(system_settings_url("microphone").unwrap().contains("Privacy_Microphone"));
        assert!(system_settings_url("rm -rf /").is_none());
        assert!(system_settings_url("https://example.com").is_none());
    }

    #[test]
    fn cookie_shortcut_defaults_and_never_clashes() {
        let mut p = Prefs::default();
        assert_eq!(wanted_cookie_shortcut(&p), Ok(Some("Control+Shift+KeyK".into())));
        p.persona.cookie_shortcut = p.build.toggle_shortcut.clone();
        assert!(wanted_cookie_shortcut(&p).unwrap_err().contains("Build"));
        p.persona.cookie_enabled = false;
        assert_eq!(wanted_cookie_shortcut(&p), Ok(None));
    }

    #[test]
    fn lines_shortcut_defaults_and_never_clashes() {
        let mut p = Prefs::default();
        assert_eq!(wanted_lines_shortcut(&p), Ok(Some("Control+Shift+KeyP".into())));
        p.lines.toggle_shortcut = p.build.toggle_shortcut.clone();
        assert!(wanted_lines_shortcut(&p).is_err());
        p.lines.toggle_shortcut = p.control.toggle_shortcut.clone();
        assert!(wanted_lines_shortcut(&p).is_err());
        p.lines.toggle_enabled = false;
        assert_eq!(wanted_lines_shortcut(&p), Ok(None));
    }

    #[test]
    fn build_shortcut_defaults_and_never_clashes() {
        let mut p = Prefs::default();
        assert_eq!(wanted_build_shortcut(&p), Ok(Some("Control+Shift+KeyB".into())));
        p.build.toggle_shortcut = p.control.toggle_shortcut.clone();
        assert!(wanted_build_shortcut(&p).is_err());
        p.voice_input.enabled = true;
        p.build.toggle_shortcut = p.voice_input.shortcut.clone();
        assert!(wanted_build_shortcut(&p).is_err());
        p.build.toggle_enabled = false;
        assert_eq!(wanted_build_shortcut(&p), Ok(None));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A panic must not leave the real cursor hidden either.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        cursor_hide::force_show();
        default_hook(info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Push-to-talk: key down / key up of the user's voice shortcut go to the overlay.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    match shortcut_role(app, shortcut) {
                        // Through Wispr Flow, her shortcut just opens her input for it.
                        Some(ShortcutRole::Voice) if wispr::active(app) => {
                            if event.state == ShortcutState::Pressed {
                                wispr::on_dictation_key(app, true);
                            }
                        }
                        Some(ShortcutRole::Voice) => {
                            let state = if event.state == ShortcutState::Pressed { "pressed" } else { "released" };
                            let _ = app.emit(voice::VOICE_KEY_EVENT, state);
                        }
                        // Toggle Control mode on key down (key up is ignored).
                        Some(ShortcutRole::Control) if event.state == ShortcutState::Pressed => {
                            let on = !control_active(&app.state::<AppState>());
                            set_control(app, on);
                        }
                        Some(ShortcutRole::Build) if event.state == ShortcutState::Pressed => {
                            let on = !app.state::<AppState>().build.load(Ordering::Relaxed);
                            set_build(app, on);
                        }
                        Some(ShortcutRole::Lines) if event.state == ShortcutState::Pressed => {
                            let on = !app.state::<AppState>().lines.load(Ordering::Relaxed);
                            set_lines(app, on);
                        }
                        Some(ShortcutRole::Cookie) if event.state == ShortcutState::Pressed => {
                            send_combat(app, "toggleCookie", None);
                        }
                        _ => {}
                    }
                })
                .build(),
        )
        // Local Terraria art for the WebView, decoded off the main thread.
        .register_asynchronous_uri_scheme_protocol(terraria_app::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            let is_get = request.method() == tauri::http::Method::GET;
            std::thread::spawn(move || {
                let (status, body) = if !is_get {
                    (405, b"method not allowed".to_vec())
                } else {
                    match app.try_state::<terraria_app::TerrariaAssets>() {
                        Some(assets) => assets.serve(&path),
                        None => (503, b"assets not ready".to_vec()),
                    }
                };
                let content_type = terraria_app::content_type(&path, status);
                responder.respond(terraria_app::response_typed(status, body, content_type));
            });
        })
        .setup(|app| {
            // Menu-bar-only app: no Dock icon, controlled from the tray.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let prefs_path = app.path().app_config_dir()?.join("prefs.json");
            let mut prefs = prefs::load(&prefs_path);
            // "Dock visible on launch" (remember / always / never).
            prefs.dock.visible = prefs.dock.launch_visible();
            app.manage(AppState {
                prefs: Mutex::new(prefs.clone()),
                prefs_path,
                hitbox: Mutex::new(None),
                hitbox_extra: Mutex::new(Vec::new()),
                capture: AtomicBool::new(false),
                platforms: Mutex::new(Vec::new()),
                control: AtomicBool::new(false),
                control_epoch: AtomicU32::new(0),
                build: AtomicBool::new(false),
                lines: AtomicBool::new(false),
                dock_move_gen: AtomicU64::new(0),
                last_external_app: Mutex::new(None),
                voice_shortcut: Mutex::new(None),
                voice_shortcut_status: Mutex::new("Voice input is off.".into()),
                control_shortcut: Mutex::new(None),
                control_shortcut_status: Mutex::new("The Control-mode shortcut is off.".into()),
                build_shortcut: Mutex::new(None),
                build_shortcut_status: Mutex::new("The Build-mode shortcut is off.".into()),
                lines_shortcut: Mutex::new(None),
                lines_shortcut_status: Mutex::new("The Platform-edit shortcut is off.".into()),
                cookie_shortcut: Mutex::new(None),
                cookie_shortcut_status: Mutex::new("The cookie shortcut is off.".into()),
                shortcuts_suspended: AtomicBool::new(false),
                destroyer_status: Mutex::new("Not listening.".into()),
                destroyer_strikes: Mutex::new(destroyer_link::Strikes::default()),
                notch: Arc::new(notch_link::Shared::default()),
                chat_history_path: app.path().app_config_dir()?.join("chat_history.json"),
                world_nav: AtomicBool::new(false),
                world_play: AtomicBool::new(false),
                world_drag: AtomicBool::new(false),
                world_path: app.path().app_config_dir()?.join("world.json"),
            });
            app.manage(ai::Requests::default());
            // Real Terraria art, read from the local install and cached under ~/Library/Caches.
            let asset_cache = app.path().app_cache_dir()?.join("terraria-assets");
            app.manage(terraria_app::TerrariaAssets::init(asset_cache));

            if let Some(overlay) = app.get_webview_window(OVERLAY) {
                if let Err(err) = fit_overlay_to_work_area(&overlay) {
                    eprintln!("failed to size overlay: {err}");
                }
                overlay.set_ignore_cursor_events(true)?;
                overlay.set_visible_on_all_workspaces(true)?;
            }

            if let Some(ambient) = app.get_webview_window(AMBIENT) {
                let _ = fit_ambient(&ambient);
                ambient.set_ignore_cursor_events(true)?;
                ambient.set_visible_on_all_workspaces(true)?;
            }
            if let Some(decor) = app.get_webview_window(DECOR) {
                let _ = fit_ambient(&decor);
                decor.set_ignore_cursor_events(true)?;
                decor.set_visible_on_all_workspaces(true)?;
            }
            if let Some(crown) = app.get_webview_window(CROWN) {
                let _ = fit_crown(&crown);
                crown.set_ignore_cursor_events(true)?;
                crown.set_visible_on_all_workspaces(true)?;
            }
            build_tray(app.handle(), &prefs)?;
            sync_ui(app.handle(), &prefs);
            spawn_hover_watcher(app.handle().clone());
            for label in [AMBIENT, OVERLAY, DECOR, CROWN] {
                if let Some(w) = app.get_webview_window(label) {
                    desktop_layer::keep_running_when_covered(&w);
                }
            }
            desktop_layer::set_key_hook(wispr::key_hook);
            desktop_layer::start(app.handle().clone());
            wispr::spawn_watcher(app.handle().clone());
            spawn_platform_watcher(app.handle().clone());
            spawn_dock_guard(app.handle().clone());
            spawn_app_watcher(app.handle().clone());
            spawn_destroyer_link(app.handle().clone());
            spawn_notch_link(app.handle().clone());
            spawn_demo(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing either window hides it; only the tray's Quit exits the app.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let app = window.app_handle();
                match window.label() {
                    INVENTORY => set_inventory_visible(app, false),
                    OVERLAY => {
                        update_prefs(app, |p| p.visible = false);
                    }
                    DOCK => {
                        update_prefs(app, |p| p.dock.visible = false);
                    }
                    CHAT => set_chat_visible(app, false),
                    POUCH => hide_pouch(app.clone()),
                    AMBIENT | DECOR | CROWN => {
                        update_prefs(app, |p| p.theme.enabled = false);
                    }
                    _ => {}
                }
            }
            // The pouch is a popover: clicking anywhere else puts it away.
            WindowEvent::Focused(false) if window.label() == POUCH => {
                let _ = window.hide();
            }
            WindowEvent::Moved(pos) if window.label() == DOCK => {
                if let Some(dock) = window.app_handle().get_webview_window(DOCK) {
                    on_dock_moved(window.app_handle(), &dock, *pos);
                }
            }
            WindowEvent::ScaleFactorChanged { .. } if window.label() == DOCK => {
                if let Some(dock) = window.app_handle().get_webview_window(DOCK) {
                    place_dock(window.app_handle(), &dock);
                }
            }
            WindowEvent::ScaleFactorChanged { .. } if window.label() == OVERLAY => {
                if let Some(overlay) = window.app_handle().get_webview_window(OVERLAY) {
                    let _ = fit_overlay_to_work_area(&overlay);
                }
                for label in [AMBIENT, DECOR] {
                    if let Some(w) = window.app_handle().get_webview_window(label) {
                        let _ = fit_ambient(&w);
                    }
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_prefs,
            patch_prefs,
            get_platforms,
            set_hitbox,
            set_capture,
            toggle_inventory,
            hide_inventory,
            show_inventory,
            hide_pouch,
            pouch_open_menu,
            set_dock_size,
            running_apps,
            transcribe,
            voice_shortcut_status,
            control_shortcut_status,
            destroyer_status,
            destroyer_strike,
            notch_status,
            notch_enter,
            notch_leave,
            notch_say,
            notch_gesture,
            notch_hover,
            focus_overlay,
            screen_status,
            request_screen_permission,
            open_privacy_settings,
            ai_status,
            chat_ask,
            study_look,
            study_ask,
            study_gemini,
            chat_cancel,
            chat_history_load,
            chat_history_save,
            chat_history_clear,
            show_chat,
            hide_chat,
            combat_command,
            get_player_rig,
            get_skin_rig,
            get_character_rig,
            list_addons,
            list_skins,
            list_voices,
            get_cursor,
            set_control_mode,
            get_control_mode,
            set_build_mode,
            get_build_mode,
            build_shortcut_status,
            set_lines_mode,
            get_lines_mode,
            lines_shortcut_status,
            ambient_geometry,
            world_nav,
            open_accessibility_settings,
            accessibility_status,
            wispr_status,
            wispr_launch,
            wispr_take_back,
            get_world_nav,
            world_view,
            world_load,
            world_save,
            game_load,
            game_save,
            places_load,
            places_save,
            places_goto,
            get_world_play,
            world_dragging,
            start_game,
            stop_game,
            hide_other_apps,
            get_game_rig,
            ai_classify,
            user_idle_seconds,
            show_settings,
            open_system_settings,
            cookie_shortcut_status,
            suspend_shortcuts,
            debug_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Whatever happens, never leave the real cursor hidden.
            if let tauri::RunEvent::Exit = event {
                cursor_hide::force_show();
            }
        });
}

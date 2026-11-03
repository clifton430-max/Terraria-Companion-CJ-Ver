//! Voice input through Wispr Flow (the dictation app), instead of a voice pipeline of our own.
//!
//! Wispr Flow has no API: it types what you say into whichever text field has focus. So:
//! * **Its key:** when you press Wispr Flow's push-to-talk (or hands-free) key and no other
//!   app's text field is focused, the companion's input opens and takes focus, so the words land
//!   there. The keys are read from Wispr Flow's own settings (`config.json`) and seen by the
//!   desktop event tap (desktop_layer.rs), which needs the Accessibility permission.
//! * **Her name:** a dictation that starts with the main companion's name ("Hey Rose, …") is
//!   hers even if it went into another app: Wispr Flow's local history (`flow.sqlite`, read only,
//!   text of new entries only, never the audio or screenshots) shows it, the overlay matches the
//!   name, and `take_back` presses ⌘Z in that app.
//! * **Not usable** (not installed, not running, no dictation key, no permission): the companion
//!   says so in a bubble when you press the key, and offers to launch it. Nothing falls back to
//!   another voice system on its own.

use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

pub const BUNDLE: &str = "com.electron.wispr-flow";
const OWN_BUNDLE: &str = "com.terrariacompanion.cjver";
pub const DICTATE_EVENT: &str = "companion://wispr-dictate";
pub const PROBLEM_EVENT: &str = "companion://wispr-problem";
pub const DICTATION_EVENT: &str = "companion://wispr-dictation";

/// Why Wispr Flow can't carry voice right now, or None if it can.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Problem {
    NotInstalled,
    NotRunning,
    NoShortcut,
    NoAccessibility,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub problem: Option<Problem>,
    /// What the companion says about it.
    pub message: String,
    /// Installed but not running: she offers to launch it.
    pub can_launch: bool,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn support_dir() -> PathBuf {
    home().join("Library/Application Support/Wispr Flow")
}

fn installed() -> bool {
    [PathBuf::from("/Applications/Wispr Flow.app"), home().join("Applications/Wispr Flow.app")].iter().any(|p| p.exists())
}

fn running() -> bool {
    crate::apps::running_apps().iter().any(|a| a.bundle_id == BUNDLE)
}

/// Wispr Flow's dictation keys (push-to-talk and hands-free), as sets of macOS key codes, from
/// its settings: `prefs.user.shortcuts` maps "63" or "49+63" to an action name.
pub fn dictation_keys(config: &serde_json::Value) -> Vec<Vec<u16>> {
    let Some(map) = config.pointer("/prefs/user/shortcuts").and_then(|v| v.as_object()) else { return Vec::new() };
    let mut out: Vec<Vec<u16>> = map
        .iter()
        .filter(|(_, action)| matches!(action.as_str(), Some("ptt" | "popo" | "handsfree" | "hands_free" | "handsFree")))
        .filter_map(|(keys, _)| keys.split('+').map(|k| k.trim().parse::<u16>().ok()).collect::<Option<Vec<u16>>>())
        .filter(|k| !k.is_empty() && k.len() <= 4)
        .collect();
    out.sort();
    out
}

fn read_keys() -> Vec<Vec<u16>> {
    std::fs::read_to_string(support_dir().join("config.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).map(|v| dictation_keys(&v)).unwrap_or_default()
}

pub fn status() -> Status {
    let (problem, message) = if !installed() {
        (Some(Problem::NotInstalled), "I listen through Wispr Flow, but it isn't installed. Install it from wisprflow.ai, or switch to Apple Speech push-to-talk in Assistant settings.")
    } else if !running() {
        (Some(Problem::NotRunning), "Wispr Flow isn't running, so I can't hear you. Shall I open it?")
    } else if read_keys().is_empty() {
        (Some(Problem::NoShortcut), "Wispr Flow has no dictation key set up. Pick one in Wispr Flow's settings, then try again.")
    } else if !crate::desktop_layer::accessibility_trusted() {
        (Some(Problem::NoAccessibility), "To catch Wispr Flow's key and take back words meant for me, I need Accessibility permission (System Settings → Privacy & Security → Accessibility).")
    } else {
        (None, "")
    };
    Status { problem, message: message.into(), can_launch: problem == Some(Problem::NotRunning) }
}

pub fn launch() -> bool {
    std::process::Command::new("open").args(["-b", BUNDLE]).spawn().is_ok()
}

/// Voice input is on and set to come through Wispr Flow.
pub fn active(app: &AppHandle) -> bool {
    let state = app.state::<crate::AppState>();
    let p = state.prefs.lock().unwrap();
    p.voice_input.enabled && p.voice_input.source == "wispr"
}

/// Wispr Flow's key went down (or the companion's own voice shortcut, `force`): open her input
/// unless another app's field will get the words, or say what's wrong.
pub fn on_dictation_key(app: &AppHandle, force: bool) {
    let app = app.clone();
    // Off the event tap's thread: the accessibility queries can take a moment.
    std::thread::spawn(move || {
        let s = status();
        if s.problem.is_some() {
            let _ = app.emit_to(crate::OVERLAY, PROBLEM_EVENT, s);
            return;
        }
        if force || !crate::desktop_layer::text_field_focused_elsewhere() {
            let _ = app.emit_to(crate::OVERLAY, DICTATE_EVENT, ());
        }
    });
}

/// ⌘Z in the app a dictation meant for the companion went into (only if it's still frontmost).
pub fn take_back(target: &str) -> bool {
    if target.is_empty() || target == OWN_BUNDLE {
        return false;
    }
    let front = crate::apps::frontmost().map(|a| a.bundle_id).unwrap_or_default();
    front == target && crate::desktop_layer::post_undo()
}

// ── Which keys are down ──────────────────────────────────────────────────────────────────────

/// Tracks held keys from the event tap and notices when one of the dictation combos goes down.
#[derive(Default)]
pub struct KeyWatch {
    down: HashSet<u16>,
    combos: Vec<Vec<u16>>,
    fired: bool,
}

/// The flag bit for a modifier key code (flags-changed events say down/up through it).
fn modifier_flag(code: u16) -> Option<u64> {
    match code {
        63 | 179 => Some(0x800000), // fn / globe
        54 | 55 => Some(0x100000),  // command
        56 | 60 => Some(0x20000),   // shift
        58 | 61 => Some(0x80000),   // option
        59 | 62 => Some(0x40000),   // control
        _ => None,
    }
}

impl KeyWatch {
    pub fn set_combos(&mut self, combos: Vec<Vec<u16>>) {
        self.combos = combos;
    }

    /// One key event (10 down, 11 up, 12 flags changed); true when a dictation combo has just
    /// become fully held.
    pub fn update(&mut self, ty: u32, code: u16, flags: u64) -> bool {
        match ty {
            10 => {
                self.down.insert(code);
            }
            11 => {
                self.down.remove(&code);
            }
            12 => {
                if let Some(bit) = modifier_flag(code) {
                    if flags & bit != 0 {
                        self.down.insert(code);
                    } else {
                        self.down.remove(&code);
                    }
                }
            }
            _ => return false,
        }
        let held = self.combos.iter().any(|c| c.iter().all(|k| self.down.contains(k)));
        let fire = held && !self.fired;
        self.fired = held;
        fire
    }
}

static WATCH: std::sync::Mutex<Option<(SystemTime, KeyWatch)>> = std::sync::Mutex::new(None);

/// The event tap's key hook (see desktop_layer::set_key_hook).
pub fn key_hook(app: &AppHandle, ty: u32, code: u16, flags: u64) {
    if !active(app) {
        return;
    }
    let mut guard = WATCH.lock().unwrap();
    // Re-read Wispr Flow's keys every so often (they can be changed in its settings).
    let stale = guard.as_ref().is_none_or(|(at, _)| at.elapsed().unwrap_or_default() > Duration::from_secs(10));
    if stale {
        let mut w = guard.take().map(|(_, w)| w).unwrap_or_default();
        w.set_combos(read_keys());
        *guard = Some((SystemTime::now(), w));
    }
    let (_, w) = guard.as_mut().unwrap();
    if w.update(ty, code, flags) {
        drop(guard);
        on_dictation_key(app, false);
    }
}

// ── New dictations (for her name) ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Dictation {
    pub at: String,
    /// The app it went into (bundle id).
    pub app: String,
    pub text: String,
}

/// Dictations newer than `after` (Wispr Flow's timestamps sort as text), oldest first.
fn newer(after: &str) -> Vec<Dictation> {
    let db = support_dir().join("flow.sqlite");
    let uri = format!("file:{}?mode=ro", db.display());
    // Only the text Wispr Flow typed and where; nothing else from the row.
    let sql = format!(
        "select timestamp as at, coalesce(app, '') as app, coalesce(pastedText, formattedText, asrText, '') as text from History where timestamp > '{}' and isArchived = 0 order by timestamp asc limit 5",
        after.replace('\'', "")
    );
    let Ok(out) = std::process::Command::new("/usr/bin/sqlite3").args(["-readonly", "-json", &uri, &sql]).output() else { return Vec::new() };
    if !out.status.success() || out.stdout.is_empty() {
        return Vec::new();
    }
    #[derive(serde::Deserialize)]
    struct Row {
        at: String,
        app: String,
        text: String,
    }
    serde_json::from_slice::<Vec<Row>>(&out.stdout)
        .map(|rows| rows.into_iter().map(|r| Dictation { at: r.at, app: r.app, text: r.text.chars().take(2000).collect() }).collect())
        .unwrap_or_default()
}

fn latest() -> String {
    let db = support_dir().join("flow.sqlite");
    let uri = format!("file:{}?mode=ro", db.display());
    std::process::Command::new("/usr/bin/sqlite3")
        .args(["-readonly", &uri, "select coalesce(max(timestamp), '') from History"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Watch Wispr Flow's history for new dictations into other apps (for her name). Checks only when
/// the database changes, and only while voice input goes through Wispr Flow.
pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let wal = support_dir().join("flow.sqlite-wal");
        let db = support_dir().join("flow.sqlite");
        let mut seen: Option<String> = None;
        let mut stamp: Option<(SystemTime, SystemTime)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(300));
            if !active(&app) {
                seen = None;
                continue;
            }
            let now = (
                std::fs::metadata(&wal).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH),
                std::fs::metadata(&db).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH),
            );
            if seen.is_none() {
                // Start from now: older dictations were never meant for her.
                seen = Some(latest());
                stamp = Some(now);
                continue;
            }
            if stamp == Some(now) {
                continue;
            }
            stamp = Some(now);
            for d in newer(seen.as_deref().unwrap_or("")) {
                seen = Some(d.at.clone());
                if d.app != OWN_BUNDLE && !d.text.trim().is_empty() {
                    let _ = app.emit_to(crate::OVERLAY, DICTATION_EVENT, d);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_dictation_keys_from_wispr_flows_settings() {
        let cfg: serde_json::Value = serde_json::from_str(r#"{"prefs":{"user":{"shortcuts":{"53":"dismiss","63":"ptt","49+63":"popo","59+63":"lens","x+1":"ptt"}}}}"#).unwrap();
        assert_eq!(dictation_keys(&cfg), vec![vec![49, 63], vec![63]]);
        assert!(dictation_keys(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn notices_a_combo_going_down_once() {
        let mut w = KeyWatch::default();
        w.set_combos(vec![vec![63], vec![49, 63]]);
        assert!(w.update(12, 63, 0x800000), "fn down");
        assert!(!w.update(10, 49, 0x800000), "still held: no second fire");
        assert!(!w.update(11, 49, 0x800000));
        assert!(!w.update(12, 63, 0), "fn up");
        assert!(!w.update(10, 0, 0), "an ordinary key");
        assert!(w.update(12, 63, 0x800000), "fn down again");
    }

    #[test]
    fn needs_every_key_of_the_combo() {
        let mut w = KeyWatch::default();
        w.set_combos(vec![vec![49, 63]]);
        assert!(!w.update(10, 49, 0));
        assert!(w.update(12, 63, 0x800000));
    }

    #[test]
    fn never_takes_back_from_itself() {
        assert!(!take_back(OWN_BUNDLE));
        assert!(!take_back(""));
    }
}

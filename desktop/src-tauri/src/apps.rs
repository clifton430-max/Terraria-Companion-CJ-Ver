//! Foreground-application awareness: which app is frontmost (bundle id + display name), the list
//! of running regular apps (for the settings picker), and whether a password field has secure
//! keyboard input enabled. Uses `NSWorkspace`/`NSRunningApplication` (no permission needed) and
//! Carbon's `IsSecureEventInputEnabled`. Never reads window titles, contents or keystrokes, and
//! keeps no history: only the current app is remembered, to detect the next switch.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Stable identifier, e.g. "com.google.Chrome". Apps without one use "pid:<n>" (not stored).
    pub bundle_id: String,
    pub name: String,
    #[serde(skip)]
    pub pid: i32,
}

/// Sent to the overlay when the user brings a different app (or, if enabled, a different
/// window of the same app) to the front.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSwitch {
    pub bundle_id: String,
    pub name: String,
    /// True when only the front window changed within the same app.
    pub same_app: bool,
}

/// Turns a stream of "what's frontmost now" samples into switch events.
#[derive(Debug, Default)]
pub struct SwitchDetector {
    current: Option<String>,
    window: Option<u32>,
}

impl SwitchDetector {
    /// `front_window` is the id of the app's frontmost window (only used to notice same-app
    /// window changes; never its title). Our own app and excluded apps never produce events,
    /// but switching *to* them still counts as leaving the previous app.
    pub fn observe(&mut self, app: Option<&AppInfo>, front_window: Option<u32>, own_bundle: &str, excluded: &[String]) -> Option<AppSwitch> {
        let app = app?;
        if app.bundle_id == own_bundle {
            return None; // clicking the companion's own windows isn't a switch
        }
        if self.current.as_deref() != Some(app.bundle_id.as_str()) {
            self.current = Some(app.bundle_id.clone());
            self.window = front_window;
            if excluded.iter().any(|e| e == &app.bundle_id) {
                return None;
            }
            return Some(AppSwitch { bundle_id: app.bundle_id.clone(), name: app.name.clone(), same_app: false });
        }
        if front_window.is_some() && front_window != self.window {
            let first = self.window.is_none();
            self.window = front_window;
            if !first && !excluded.iter().any(|e| e == &app.bundle_id) {
                return Some(AppSwitch { bundle_id: app.bundle_id.clone(), name: app.name.clone(), same_app: true });
            }
        }
        None
    }

    /// Forget the current app (e.g. when awareness is turned off).
    pub fn reset(&mut self) {
        self.current = None;
        self.window = None;
    }
}

/// Frontmost layer-0 window of `pid` from a front-to-back window list (ids only).
pub fn front_window_of(windows: &[crate::windows::RawWindow], pid: i32) -> Option<u32> {
    windows.iter().find(|w| w.pid == pid && w.layer == 0).map(|w| w.id)
}

#[cfg(target_os = "macos")]
pub use macos::{frontmost, running_apps, secure_input_enabled};

#[cfg(not(target_os = "macos"))]
pub fn frontmost() -> Option<AppInfo> {
    None
}
#[cfg(not(target_os = "macos"))]
pub fn running_apps() -> Vec<AppInfo> {
    Vec::new()
}
#[cfg(not(target_os = "macos"))]
pub fn secure_input_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
mod macos {
    use super::AppInfo;
    use std::ffi::{c_char, c_void, CStr};

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
        fn objc_autoreleasePoolPush() -> *mut c_void;
        fn objc_autoreleasePoolPop(pool: *mut c_void);
    }
    #[link(name = "AppKit", kind = "framework")]
    unsafe extern "C" {}
    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }

    fn sel(name: &CStr) -> Sel {
        unsafe { sel_registerName(name.as_ptr()) }
    }
    /// `[obj sel]` returning an object pointer.
    unsafe fn send_id(obj: Id, s: &CStr) -> Id {
        let f: unsafe extern "C" fn(Id, Sel) -> Id = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        if obj.is_null() { std::ptr::null_mut() } else { unsafe { f(obj, sel(s)) } }
    }
    unsafe fn send_isize(obj: Id, s: &CStr) -> isize {
        let f: unsafe extern "C" fn(Id, Sel) -> isize = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        if obj.is_null() { 0 } else { unsafe { f(obj, sel(s)) } }
    }
    unsafe fn send_i32(obj: Id, s: &CStr) -> i32 {
        let f: unsafe extern "C" fn(Id, Sel) -> i32 = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        if obj.is_null() { 0 } else { unsafe { f(obj, sel(s)) } }
    }
    /// `[[NSApplication sharedApplication] hideOtherApplications:nil]` (Hide Others, ⌥⌘H).
    pub fn hide_other_apps() {
        unsafe {
            let cls = objc_getClass(c"NSApplication".as_ptr());
            let app = send_id(cls, c"sharedApplication");
            if app.is_null() {
                return;
            }
            let f: unsafe extern "C" fn(Id, Sel, Id) = std::mem::transmute(objc_msgSend as *const ());
            f(app, sel(c"hideOtherApplications:"), std::ptr::null_mut());
        }
    }
    unsafe fn object_at(arr: Id, i: usize) -> Id {
        let f: unsafe extern "C" fn(Id, Sel, usize) -> Id = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        unsafe { f(arr, sel(c"objectAtIndex:"), i) }
    }
    unsafe fn nsstring(s: Id) -> Option<String> {
        let f: unsafe extern "C" fn(Id, Sel) -> *const c_char = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        if s.is_null() {
            return None;
        }
        let p = unsafe { f(s, sel(c"UTF8String")) };
        if p.is_null() { None } else { Some(unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()) }
    }

    unsafe fn app_info(app: Id) -> Option<AppInfo> {
        if app.is_null() {
            return None;
        }
        let pid = unsafe { send_i32(app, c"processIdentifier") };
        let bundle = unsafe { nsstring(send_id(app, c"bundleIdentifier")) };
        let name = unsafe { nsstring(send_id(app, c"localizedName")) }.unwrap_or_default();
        Some(AppInfo { bundle_id: bundle.unwrap_or_else(|| format!("pid:{pid}")), name, pid })
    }

    struct Pool(*mut c_void);
    impl Pool {
        fn new() -> Self {
            Pool(unsafe { objc_autoreleasePoolPush() })
        }
    }
    impl Drop for Pool {
        fn drop(&mut self) {
            unsafe { objc_autoreleasePoolPop(self.0) }
        }
    }

    fn workspace() -> Id {
        unsafe { send_id(objc_getClass(c"NSWorkspace".as_ptr()), c"sharedWorkspace") }
    }

    /// The app that currently has focus.
    pub fn frontmost() -> Option<AppInfo> {
        let _pool = Pool::new();
        unsafe { app_info(send_id(workspace(), c"frontmostApplication")) }
    }

    /// Running apps that show in the Dock (activation policy "regular"), sorted by name.
    pub fn running_apps() -> Vec<AppInfo> {
        let _pool = Pool::new();
        let arr = unsafe { send_id(workspace(), c"runningApplications") };
        let n = unsafe { send_isize(arr, c"count") }.max(0) as usize;
        let mut out: Vec<AppInfo> = (0..n)
            .filter_map(|i| unsafe {
                let app = object_at(arr, i);
                // NSApplicationActivationPolicyRegular == 0
                if send_isize(app, c"activationPolicy") != 0 {
                    return None;
                }
                app_info(app)
            })
            .filter(|a| !a.bundle_id.starts_with("pid:"))
            .collect();
        out.sort_by_key(|a| a.name.to_lowercase());
        out.dedup_by(|a, b| a.bundle_id == b.bundle_id);
        out
    }

    /// True while some app has secure keyboard entry on (typically a focused password field).
    pub fn secure_input_enabled() -> bool {
        unsafe { IsSecureEventInputEnabled() != 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str) -> AppInfo {
        AppInfo { bundle_id: id.into(), name: id.to_uppercase(), pid: 1 }
    }
    const OWN: &str = "com.terrariacompanion.cjver";

    #[test]
    fn reports_each_switch_to_a_different_app_once() {
        let mut d = SwitchDetector::default();
        let ev = d.observe(Some(&app("com.google.Chrome")), Some(1), OWN, &[]).unwrap();
        assert_eq!(ev, AppSwitch { bundle_id: "com.google.Chrome".into(), name: "COM.GOOGLE.CHROME".into(), same_app: false });
        assert_eq!(d.observe(Some(&app("com.google.Chrome")), Some(1), OWN, &[]), None); // same sample again
        assert!(d.observe(Some(&app("com.apple.Safari")), Some(5), OWN, &[]).is_some());
        assert!(d.observe(Some(&app("com.google.Chrome")), Some(1), OWN, &[]).is_some()); // back again
    }

    #[test]
    fn window_changes_within_an_app_are_flagged_same_app() {
        let mut d = SwitchDetector::default();
        d.observe(Some(&app("com.apple.Safari")), Some(1), OWN, &[]);
        let ev = d.observe(Some(&app("com.apple.Safari")), Some(2), OWN, &[]).unwrap();
        assert!(ev.same_app);
        assert_eq!(d.observe(Some(&app("com.apple.Safari")), None, OWN, &[]), None); // unknown window: no event
    }

    #[test]
    fn own_app_and_excluded_apps_never_produce_events() {
        let mut d = SwitchDetector::default();
        assert_eq!(d.observe(Some(&app(OWN)), Some(1), OWN, &[]), None);
        let excluded = vec!["com.1password.1password".to_string()];
        assert_eq!(d.observe(Some(&app("com.1password.1password")), Some(3), OWN, &excluded), None);
        assert_eq!(d.observe(Some(&app("com.1password.1password")), Some(4), OWN, &excluded), None);
        // Leaving the excluded app for another app is reported normally.
        assert!(d.observe(Some(&app("com.apple.Safari")), Some(9), OWN, &excluded).is_some());
        assert_eq!(d.observe(None, None, OWN, &[]), None);
        d.reset();
        assert!(d.observe(Some(&app("com.apple.Safari")), Some(9), OWN, &[]).is_some());
    }

    #[test]
    fn front_window_lookup_uses_layer_zero_windows_of_the_pid() {
        use crate::windows::RawWindow;
        let w = |id, pid, layer| RawWindow { id, pid, layer, alpha: 1.0, x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let list = [w(1, 7, 25), w(2, 9, 0), w(3, 7, 0), w(4, 7, 0)];
        assert_eq!(front_window_of(&list, 7), Some(3));
        assert_eq!(front_window_of(&list, 8), None);
    }
}


/// Hide every other app (macOS "Hide Others"); must run on the main thread. Nothing is closed or
/// quit, and the apps come back from the Dock or ⌘-Tab.
pub fn hide_other_apps() {
    #[cfg(target_os = "macos")]
    macos::hide_other_apps();
}

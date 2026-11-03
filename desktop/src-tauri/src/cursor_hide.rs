//! Optional hiding of the real macOS cursor for the cosmetic "Become Cursor" mode.
//!
//! Safety design:
//! * Off by default; only active when the user enables both Become mode *and* "hide real cursor".
//! * The cursor is shown again whenever the pointer is outside the overlay (so the menu bar and
//!   tray are always usable with a visible cursor), in Control Character mode, when the setting
//!   or mode changes, when the app quits, and from a panic hook.
//! * Hide/show calls are reference counted by the OS, so [`CursorHider`] tracks its own state and
//!   only ever issues balanced calls. macOS also restores the cursor if the process exits.
//!
//! Background apps can't hide the cursor with public APIs alone; this uses the documented
//! `CGDisplayHideCursor` plus the private `CGSSetConnectionProperty("SetsCursorInBackground")`
//! connection property, the same technique long used by cursor-hiding utilities.

/// Whether the real cursor should currently be hidden.
pub fn should_hide(
    become_mode: bool,
    opted_in: bool,
    control_mode: bool,
    cursor_local: Option<(f64, f64)>,
    overlay_size: (f64, f64),
) -> bool {
    if !(become_mode && opted_in) || control_mode {
        return false;
    }
    match cursor_local {
        // The overlay covers the work area only, so this excludes the menu bar and the Dock.
        Some((x, y)) => x >= 0.0 && y >= 0.0 && x < overlay_size.0 && y < overlay_size.1,
        None => false,
    }
}

/// Owns the hidden/visible state so OS calls stay balanced.
#[derive(Default)]
pub struct CursorHider {
    hidden: bool,
}

impl CursorHider {
    pub fn set(&mut self, hide: bool) {
        if hide == self.hidden {
            return;
        }
        if hide {
            if platform::hide() {
                self.hidden = true;
            }
        } else {
            platform::show();
            self.hidden = false;
        }
    }

    pub fn is_hidden(&self) -> bool {
        self.hidden
    }
}

impl Drop for CursorHider {
    fn drop(&mut self) {
        self.set(false);
    }
}

/// Unconditionally make the cursor visible again (exit and panic paths).
pub fn force_show() {
    platform::show_all();
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_core_foundation::{CFBoolean, CFString};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicI32, Ordering};

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayHideCursor(display: u32) -> i32;
        fn CGDisplayShowCursor(display: u32) -> i32;
        fn _CGSDefaultConnection() -> i32;
        fn CGSSetConnectionProperty(cid: i32, target: i32, key: *const c_void, value: *const c_void) -> i32;
    }

    /// Outstanding hide calls issued by this process.
    static HIDES: AtomicI32 = AtomicI32::new(0);

    pub fn hide() -> bool {
        unsafe {
            let cid = _CGSDefaultConnection();
            let key = CFString::from_static_str("SetsCursorInBackground");
            let value = CFBoolean::new(true);
            let key_ptr: *const CFString = &*key;
            let value_ptr: *const CFBoolean = value;
            CGSSetConnectionProperty(cid, cid, key_ptr.cast(), value_ptr.cast());
            if CGDisplayHideCursor(CGMainDisplayID()) == 0 {
                HIDES.fetch_add(1, Ordering::SeqCst);
                return true;
            }
        }
        false
    }

    pub fn show() {
        if HIDES.load(Ordering::SeqCst) > 0 {
            unsafe {
                if CGDisplayShowCursor(CGMainDisplayID()) == 0 {
                    HIDES.fetch_sub(1, Ordering::SeqCst);
                }
            }
        }
    }

    pub fn show_all() {
        while HIDES.load(Ordering::SeqCst) > 0 {
            let before = HIDES.load(Ordering::SeqCst);
            show();
            if HIDES.load(Ordering::SeqCst) == before {
                break; // the OS refused; don't spin
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn hide() -> bool {
        false
    }
    pub fn show() {}
    pub fn show_all() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZE: (f64, f64) = (1440.0, 800.0);

    #[test]
    fn hides_only_in_become_mode_when_opted_in_and_inside_the_overlay() {
        assert!(should_hide(true, true, false, Some((10.0, 10.0)), SIZE));
        assert!(!should_hide(false, true, false, Some((10.0, 10.0)), SIZE), "other cursor modes never hide");
        assert!(!should_hide(true, false, false, Some((10.0, 10.0)), SIZE), "opt-in required");
        assert!(!should_hide(true, true, true, Some((10.0, 10.0)), SIZE), "control mode keeps the cursor");
    }

    #[test]
    fn shows_over_the_menu_bar_dock_and_other_displays() {
        assert!(!should_hide(true, true, false, Some((10.0, -5.0)), SIZE), "menu bar (above the overlay)");
        assert!(!should_hide(true, true, false, Some((10.0, 805.0)), SIZE), "Dock (below the overlay)");
        assert!(!should_hide(true, true, false, Some((-300.0, 100.0)), SIZE), "another display");
        assert!(!should_hide(true, true, false, None, SIZE), "unknown position");
    }
}

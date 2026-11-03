//! Discovery of other apps' on-screen windows, used as platforms the companion can stand on.
//!
//! Only window *geometry* is read: id, owning PID, layer, alpha and bounds. Window titles
//! (`kCGWindowName`), owner names and window contents are never requested, so no Screen
//! Recording permission is needed and nothing about what is on screen is captured or stored.
//!
//! Coordinates: `kCGWindowBounds` is in global display space measured in points, with the
//! origin at the top-left of the main display and y increasing downward. Secondary displays
//! can have negative coordinates. The overlay's CSS pixels are also points, so converting to
//! overlay-local coordinates is a translation by the overlay's origin (in points).

use serde::Serialize;

/// A window as reported by Core Graphics, in global display points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RawWindow {
    pub id: u32,
    pub pid: i32,
    pub layer: i64,
    pub alpha: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// An eligible window in overlay-local CSS pixels. Lists are kept front-to-back,
/// which the frontend uses to work out which top edges are visible.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PlatformWindow {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A rectangle in global display points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Minimum window size (points) to count as a platform; skips tooltips, popovers, palettes.
pub const MIN_WIDTH: f64 = 120.0;
pub const MIN_HEIGHT: f64 = 60.0;
/// Windows more transparent than this are treated as invisible overlays.
pub const MIN_ALPHA: f64 = 0.1;
/// Upper bound on platforms sent to the frontend per snapshot.
pub const MAX_PLATFORMS: usize = 64;

/// Convert a Tauri physical position/size to global display points.
/// Tauri reports macOS window geometry as points × the window's scale factor.
pub fn physical_to_points(x: f64, y: f64, w: f64, h: f64, scale_factor: f64) -> PointRect {
    let s = if scale_factor > 0.0 { scale_factor } else { 1.0 };
    PointRect { x: x / s, y: y / s, w: w / s, h: h / s }
}

/// Whether a window can act as a platform at all.
pub fn is_eligible(win: &RawWindow, own_pid: i32) -> bool {
    win.pid != own_pid
        // Layer 0 holds normal app windows. The Dock, menu bar, Notification Center,
        // floating panels, screen savers and our own always-on-top overlay are all above it.
        && win.layer == 0
        && win.alpha >= MIN_ALPHA
        && win.w >= MIN_WIDTH
        && win.h >= MIN_HEIGHT
        && win.w.is_finite()
        && win.h.is_finite()
}

/// Filter Core Graphics windows (front-to-back) and convert them into overlay-local
/// platforms, dropping any that don't intersect the overlay.
pub fn to_platforms(raw: &[RawWindow], own_pid: i32, overlay: PointRect) -> Vec<PlatformWindow> {
    raw.iter()
        .filter(|w| is_eligible(w, own_pid))
        .filter(|w| {
            w.x < overlay.x + overlay.w
                && w.x + w.w > overlay.x
                && w.y < overlay.y + overlay.h
                && w.y + w.h > overlay.y
        })
        .map(|w| PlatformWindow {
            id: w.id,
            x: (w.x - overlay.x).round(),
            y: (w.y - overlay.y).round(),
            w: w.w.round(),
            h: w.h.round(),
        })
        .take(MAX_PLATFORMS)
        .collect()
}

#[cfg(target_os = "macos")]
pub use macos::list_windows;

/// Window discovery is macOS-only; other platforms simply have no platforms.
#[cfg(not(target_os = "macos"))]
pub fn list_windows() -> Vec<RawWindow> {
    Vec::new()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::RawWindow;
    use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType, CGRect};
    use objc2_core_graphics::{
        kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowLayer, kCGWindowNumber,
        kCGWindowOwnerPID, CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo,
        CGWindowListOption,
    };

    type WindowInfo = CFDictionary<CFString, CFType>;

    /// Snapshot of on-screen windows, front-to-back. Minimized windows, windows of hidden
    /// apps and windows on other Spaces are not "on screen" and are excluded by Core Graphics.
    pub fn list_windows() -> Vec<RawWindow> {
        let options =
            CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
        let Some(array) = CGWindowListCopyWindowInfo(options, kCGNullWindowID) else {
            return Vec::new();
        };
        // SAFETY: CGWindowListCopyWindowInfo documents its result as an array of
        // dictionaries keyed by CFString.
        let array: &CFArray<WindowInfo> = unsafe { array.cast_unchecked() };
        array.iter().filter_map(|info| parse(&info)).collect()
    }

    fn number(info: &WindowInfo, key: &CFString) -> Option<f64> {
        let value: CFRetained<CFType> = info.get(key)?;
        value.downcast::<CFNumber>().ok()?.as_f64()
    }

    fn parse(info: &WindowInfo) -> Option<RawWindow> {
        // SAFETY: these are immutable CFString constants exported by CoreGraphics.
        let (k_number, k_pid, k_layer, k_alpha, k_bounds) = unsafe {
            (kCGWindowNumber, kCGWindowOwnerPID, kCGWindowLayer, kCGWindowAlpha, kCGWindowBounds)
        };
        let bounds = info.get(k_bounds)?.downcast::<CFDictionary>().ok()?;
        let mut rect = CGRect::default();
        // SAFETY: `bounds` is the CGRect dictionary representation and `rect` is a valid out-pointer.
        if !unsafe { CGRectMakeWithDictionaryRepresentation(Some(&bounds), &mut rect) } {
            return None;
        }
        Some(RawWindow {
            id: number(info, k_number)? as u32,
            pid: number(info, k_pid)? as i32,
            layer: number(info, k_layer)? as i64,
            alpha: number(info, k_alpha).unwrap_or(1.0),
            x: rect.origin.x,
            y: rect.origin.y,
            w: rect.size.width,
            h: rect.size.height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: i32 = 4242;

    fn win(id: u32, x: f64, y: f64, w: f64, h: f64) -> RawWindow {
        RawWindow { id, pid: 1, layer: 0, alpha: 1.0, x, y, w, h }
    }

    /// Main display 1440×900 pt with a 25 pt menu bar; overlay = work area.
    const OVERLAY: PointRect = PointRect { x: 0.0, y: 25.0, w: 1440.0, h: 800.0 };

    #[test]
    fn physical_to_points_divides_by_scale() {
        let r = physical_to_points(0.0, 50.0, 2880.0, 1600.0, 2.0);
        assert_eq!(r, PointRect { x: 0.0, y: 25.0, w: 1440.0, h: 800.0 });
        assert_eq!(physical_to_points(10.0, 10.0, 1.0, 1.0, 0.0).x, 10.0);
    }

    #[test]
    fn converts_global_points_to_overlay_local() {
        let p = to_platforms(&[win(7, 200.0, 325.0, 600.0, 400.0)], OWN, OVERLAY);
        assert_eq!(p, vec![PlatformWindow { id: 7, x: 200.0, y: 300.0, w: 600.0, h: 400.0 }]);
    }

    #[test]
    fn handles_overlay_on_a_secondary_display_with_negative_origin() {
        // Display to the left of the main one: its points have negative x.
        let overlay = PointRect { x: -1920.0, y: 0.0, w: 1920.0, h: 1080.0 };
        let p = to_platforms(&[win(1, -1500.0, 400.0, 800.0, 300.0)], OWN, overlay);
        assert_eq!(p[0].x, 420.0);
        assert_eq!(p[0].y, 400.0);
    }

    #[test]
    fn filters_own_hidden_system_and_tiny_windows() {
        let raw = [
            RawWindow { pid: OWN, ..win(1, 100.0, 100.0, 500.0, 400.0) }, // our own window
            RawWindow { layer: 20, ..win(2, 100.0, 100.0, 500.0, 400.0) }, // Dock-level
            RawWindow { layer: 3, ..win(3, 100.0, 100.0, 500.0, 400.0) },  // floating panel
            RawWindow { alpha: 0.0, ..win(4, 100.0, 100.0, 500.0, 400.0) }, // invisible
            win(5, 100.0, 100.0, 80.0, 400.0),                             // too narrow
            win(6, 100.0, 100.0, 500.0, 30.0),                             // too short
            win(7, 3000.0, 100.0, 500.0, 400.0),                           // other display
            win(8, 100.0, 100.0, 500.0, 400.0),                            // eligible
        ];
        let ids: Vec<u32> = to_platforms(&raw, OWN, OVERLAY).iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![8]);
    }

    #[test]
    fn preserves_front_to_back_order_and_caps_count() {
        let raw: Vec<RawWindow> =
            (0..100).map(|i| win(i, 10.0 + i as f64, 100.0, 300.0, 200.0)).collect();
        let p = to_platforms(&raw, OWN, OVERLAY);
        assert_eq!(p.len(), MAX_PLATFORMS);
        assert!(p.windows(2).all(|pair| pair[0].id < pair[1].id));
    }

    #[test]
    fn rounds_fractional_points() {
        let p = to_platforms(&[win(1, 100.4, 125.6, 300.5, 200.0)], OWN, OVERLAY);
        assert_eq!((p[0].x, p[0].y), (100.0, 101.0));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_window_list_is_readable_without_crashing() {
        // Smoke test against the real API; contents depend on the machine.
        for w in list_windows() {
            assert!(w.w >= 0.0 && w.h >= 0.0);
        }
    }

    /// Manual diagnostic: `cargo test probe_window_list -- --ignored --nocapture`.
    /// Prints window counts, eligible geometry and the per-call cost of the API.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn probe_window_list() {
        let raw = list_windows();
        let overlay = PointRect { x: -10000.0, y: -10000.0, w: 20000.0, h: 20000.0 };
        let eligible = to_platforms(&raw, std::process::id() as i32, overlay);
        println!("on-screen windows: {}, eligible: {}", raw.len(), eligible.len());
        for p in &eligible {
            println!("  id {:>6}  x {:>6} y {:>6} w {:>6} h {:>6}", p.id, p.x, p.y, p.w, p.h);
        }
        let runs = 200;
        let start = std::time::Instant::now();
        for _ in 0..runs {
            std::hint::black_box(list_windows());
        }
        println!("avg list_windows(): {:?}", start.elapsed() / runs);
    }
}

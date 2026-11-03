//! Hit-testing used to decide when the overlay should accept mouse input.

use serde::Deserialize;

/// A rectangle in the overlay's CSS (logical) pixel space.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Convert a global physical cursor position into window-local logical pixels.
pub fn to_local(cursor: (f64, f64), window_origin: (f64, f64), scale_factor: f64) -> (f64, f64) {
    let scale = if scale_factor > 0.0 { scale_factor } else { 1.0 };
    (
        (cursor.0 - window_origin.0) / scale,
        (cursor.1 - window_origin.1) / scale,
    )
}

/// Distance from `point` to the nearest edge of `rect` (0 when inside).
pub fn distance(rect: &Rect, point: (f64, f64)) -> f64 {
    let dx = (rect.x - point.0).max(point.0 - (rect.x + rect.w)).max(0.0);
    let dy = (rect.y - point.1).max(point.1 - (rect.y + rect.h)).max(0.0);
    dx.hypot(dy)
}

/// Whether a physical-pixel point lies inside a physical frame `(x, y, w, h)`.
pub fn in_frame(frame: (f64, f64, f64, f64), point: (f64, f64)) -> bool {
    point.0 >= frame.0 && point.0 < frame.0 + frame.2 && point.1 >= frame.1 && point.1 < frame.1 + frame.3
}

/// Should the (always-on-top, full-screen) overlay take mouse input? `wanted` is its usual answer
/// (near a character, dragging, or a capture-all mode). Over one of our own windows (inventory,
/// chat) the overlay gives way so they get clicks and scrolling — but never mid-press, so a drag
/// that started on either side keeps its target (`current` is kept while a button is down).
pub fn overlay_interactive(wanted: bool, over_own_window: bool, button_down: bool, current: bool) -> bool {
    if !over_own_window {
        wanted
    } else if button_down {
        current
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: Rect = Rect { x: 100.0, y: 200.0, w: 48.0, h: 72.0 };

    #[test]
    fn converts_physical_to_logical() {
        assert_eq!(to_local((300.0, 500.0), (100.0, 100.0), 2.0), (100.0, 200.0));
        assert_eq!(to_local((10.0, 10.0), (0.0, 0.0), 0.0), (10.0, 10.0));
    }

    #[test]
    fn inside_and_edges_have_zero_distance() {
        assert_eq!(distance(&R, (124.0, 236.0)), 0.0);
        assert_eq!(distance(&R, (100.0, 200.0)), 0.0);
        assert_eq!(distance(&R, (148.0, 272.0)), 0.0);
    }

    #[test]
    fn distance_is_zero_inside_and_euclidean_outside() {
        assert_eq!(distance(&R, (120.0, 230.0)), 0.0);
        assert_eq!(distance(&R, (90.0, 230.0)), 10.0);
        assert_eq!(distance(&R, (148.0 + 3.0, 272.0 + 4.0)), 5.0);
    }

    #[test]
    fn hover_padding_threshold() {
        let pad = 4.0;
        assert!(distance(&R, (97.0, 236.0)) <= pad);
        assert!(distance(&R, (124.0, 280.0)) > pad);
    }

    #[test]
    fn own_windows_take_input_from_the_overlay() {
        // Away from our windows the overlay behaves as before.
        assert!(overlay_interactive(true, false, false, false));
        assert!(!overlay_interactive(false, false, true, true));
        // Over the inventory/chat with no button held, the overlay is click-through.
        assert!(!overlay_interactive(true, true, false, true));
        // Mid-press nothing flips, so drags keep their window.
        assert!(overlay_interactive(true, true, true, true));
        assert!(!overlay_interactive(true, true, true, false));
    }

    #[test]
    fn frame_containment_is_half_open() {
        let f = (10.0, 20.0, 100.0, 50.0);
        assert!(in_frame(f, (10.0, 20.0)));
        assert!(in_frame(f, (109.9, 69.9)));
        assert!(!in_frame(f, (110.0, 30.0)));
        assert!(!in_frame(f, (50.0, 70.0)));
        assert!(!in_frame(f, (9.0, 30.0)));
    }
}

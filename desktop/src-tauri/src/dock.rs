//! Pure placement rules for the dock window (logical/CSS points, global desktop coordinates).

/// An axis-aligned area in logical points (a monitor's usable work area).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Gap kept between the dock and the edges of the usable area.
pub const MARGIN: f64 = 8.0;
/// Accepted dock window sizes (anything else from the frontend is clamped).
pub const MIN_W: f64 = 48.0;
pub const MAX_W: f64 = 1600.0;
pub const MIN_H: f64 = 36.0;
pub const MAX_H: f64 = 480.0;

/// Clamp a requested window size into the accepted range (non-finite → minimum).
pub fn clamp_size(w: f64, h: f64) -> (f64, f64) {
    let fix = |v: f64, lo: f64, hi: f64| if v.is_finite() { v.clamp(lo, hi) } else { lo };
    (fix(w, MIN_W, MAX_W), fix(h, MIN_H, MAX_H))
}

/// The area the dock belongs to: the one containing its centre, else the first (primary).
pub fn area_for(pos: (f64, f64), size: (f64, f64), areas: &[Area]) -> Option<Area> {
    let (cx, cy) = (pos.0 + size.0 / 2.0, pos.1 + size.1 / 2.0);
    areas
        .iter()
        .copied()
        .find(|a| cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h)
        .or_else(|| areas.first().copied())
}

/// Keep the whole dock inside `area` (with a margin). If it can't fit, pin it to the top-left.
pub fn clamp_to_area(pos: (f64, f64), size: (f64, f64), area: Area) -> (f64, f64) {
    let axis = |p: f64, len: f64, start: f64, span: f64| {
        let lo = start + MARGIN;
        let hi = start + span - len - MARGIN;
        if hi < lo { start.max(start + (span - len) / 2.0).min(start + span) } else if p.is_finite() { p.clamp(lo, hi) } else { lo }
    };
    (axis(pos.0, size.0, area.x, area.w), axis(pos.1, size.1, area.y, area.h))
}

/// Default spot: centred along the bottom of the usable area, just above the macOS Dock.
pub fn default_position(size: (f64, f64), area: Area) -> (f64, f64) {
    clamp_to_area((area.x + (area.w - size.0) / 2.0, area.y + area.h - size.1 - MARGIN * 2.0), size, area)
}

/// Where to put the dock: the saved spot clamped into its display, or the default.
pub fn place(saved: Option<(f64, f64)>, size: (f64, f64), areas: &[Area]) -> Option<(f64, f64)> {
    match saved {
        Some(pos) if pos.0.is_finite() && pos.1.is_finite() => {
            let area = area_for(pos, size, areas)?;
            Some(clamp_to_area(pos, size, area))
        }
        _ => areas.first().map(|a| default_position(size, *a)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Area = Area { x: 0.0, y: 25.0, w: 1440.0, h: 800.0 };
    const SIDE: Area = Area { x: 1440.0, y: 0.0, w: 1920.0, h: 1080.0 };

    #[test]
    fn default_is_bottom_centre_of_primary() {
        let p = place(None, (400.0, 80.0), &[MAIN, SIDE]).unwrap();
        assert_eq!(p.0, 520.0);
        assert_eq!(p.1, 25.0 + 800.0 - 80.0 - 16.0);
    }

    #[test]
    fn saved_position_is_kept_when_on_screen() {
        assert_eq!(place(Some((100.0, 300.0)), (400.0, 80.0), &[MAIN]), Some((100.0, 300.0)));
        // On the second display.
        assert_eq!(place(Some((2000.0, 500.0)), (400.0, 80.0), &[MAIN, SIDE]), Some((2000.0, 500.0)));
    }

    #[test]
    fn stale_positions_are_pulled_back_on_screen() {
        // A display that no longer exists: falls back to the primary and is clamped into it.
        let p = place(Some((5000.0, 2000.0)), (400.0, 80.0), &[MAIN]).unwrap();
        assert_eq!(p, (1440.0 - 400.0 - MARGIN, 25.0 + 800.0 - 80.0 - MARGIN));
        // Under the menu bar / off the left edge.
        assert_eq!(place(Some((-300.0, 0.0)), (400.0, 80.0), &[MAIN]), Some((MARGIN, 25.0 + MARGIN)));
        // Non-finite values use the default.
        assert_eq!(place(Some((f64::NAN, 1.0)), (400.0, 80.0), &[MAIN]), place(None, (400.0, 80.0), &[MAIN]));
    }

    #[test]
    fn shrinking_display_keeps_the_dock_inside() {
        let small = Area { x: 0.0, y: 25.0, w: 1024.0, h: 600.0 };
        let p = place(Some((1200.0, 700.0)), (400.0, 80.0), &[small]).unwrap();
        assert!(p.0 + 400.0 <= 1024.0 && p.1 + 80.0 <= 625.0);
        // Wider than the display: stays at the left edge instead of going negative.
        let tiny = Area { x: 0.0, y: 0.0, w: 300.0, h: 300.0 };
        assert_eq!(clamp_to_area((50.0, 50.0), (400.0, 80.0), tiny).0, 0.0);
    }

    #[test]
    fn sizes_are_clamped() {
        assert_eq!(clamp_size(10.0, 9999.0), (MIN_W, MAX_H));
        assert_eq!(clamp_size(f64::INFINITY, f64::NAN), (MIN_W, MIN_H));
        assert_eq!(clamp_size(420.0, 90.0), (420.0, 90.0));
    }

    #[test]
    fn no_displays_means_no_placement() {
        assert_eq!(place(None, (400.0, 80.0), &[]), None);
    }
}

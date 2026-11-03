//! Developer check: hide the real cursor from a background process for ~0.3 s, confirm the OS
//! reports it hidden, then restore it and confirm it is visible again.
//!
//!   cargo run --example cursor_hide_check
use desktop_lib::cursor_hide::{force_show, CursorHider};
use std::{thread::sleep, time::Duration};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGCursorIsVisible() -> u8;
}

fn visible() -> bool {
    unsafe { CGCursorIsVisible() != 0 }
}

fn main() {
    let before = visible();
    let mut hider = CursorHider::default();
    hider.set(true);
    sleep(Duration::from_millis(300));
    let during = visible();
    let tracked = hider.is_hidden();
    hider.set(false);
    sleep(Duration::from_millis(100));
    let after = visible();
    force_show();
    println!("visible before={before} during={during} (hider says hidden={tracked}) after={after}");
    assert!(after, "cursor must be visible again");
}

//! Explicit, one-shot screen understanding. A screenshot is taken only when the user presses
//! "Ask about my screen", after every privacy check passes. It lives in memory only (downscaled
//! PNG bytes), is handed to the local model, and is dropped as soon as the request finishes or is
//! cancelled. Nothing is written to disk. Uses the Core Graphics capture API, which needs the macOS
//! Screen Recording permission; app-switch awareness never uses it.

use serde::Serialize;

/// Longest edge of the image sent to the model (smaller = faster, and less detail retained).
pub const MAX_EDGE: u32 = 1280;

/// An in-memory screenshot. Dropping it frees the pixels (there is no other copy).
pub struct Shot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// A small preview, only shown in the chat if the user enabled keeping screenshots.
    pub thumb: Vec<u8>,
}

/// Longest edge of the optional chat preview.
pub const THUMB_EDGE: u32 = 320;

/// Why a screen request didn't run. Each has a user-facing explanation; none fall back to a less
/// private method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Refusal {
    /// Screen understanding is switched off in settings.
    NotOptedIn,
    /// The app in front is on the exclusion list.
    ExcludedApp { name: String },
    /// A password field (secure keyboard entry) is active somewhere.
    SecureInput,
    /// macOS Screen Recording permission hasn't been granted to the companion.
    NoPermission,
    /// The capture call failed.
    CaptureFailed { detail: String },
}

impl Refusal {
    pub fn message(&self) -> String {
        match self {
            Refusal::NotOptedIn => "Screen understanding is off. Turn it on in Companion → Screen Awareness & Privacy to ask about your screen.".into(),
            Refusal::ExcludedApp { name } => format!("{name} is on your excluded-apps list, so I won't look at the screen while it's in front."),
            Refusal::SecureInput => "A password field looks active (secure keyboard entry is on), so I won't take a screenshot right now.".into(),
            Refusal::NoPermission => "macOS hasn't given me Screen Recording permission yet. Open System Settings → Privacy & Security → Screen & System Audio Recording, turn on Terraria Companion CJ Ver, then quit and reopen it.".into(),
            Refusal::CaptureFailed { detail } => format!("I couldn't capture the screen ({detail})."),
        }
    }
}

/// The capture backend (real Core Graphics, or a fake in tests).
pub trait ScreenSource {
    fn has_permission(&self) -> bool;
    fn capture(&self) -> Result<Shot, String>;
}

/// Inputs to the privacy checks, gathered just before capturing.
pub struct Context<'a> {
    pub opted_in: bool,
    pub front_bundle: Option<&'a str>,
    pub front_name: Option<&'a str>,
    pub excluded: &'a [String],
    pub secure_input: bool,
}

/// Run every check in order, then capture. Order matters: no capture call is made unless the
/// user opted in, the front app isn't excluded, no password field is active and permission exists.
pub fn capture_checked(ctx: &Context, src: &dyn ScreenSource) -> Result<Shot, Refusal> {
    if !ctx.opted_in {
        return Err(Refusal::NotOptedIn);
    }
    if let Some(bundle) = ctx.front_bundle {
        if ctx.excluded.iter().any(|e| e == bundle) {
            return Err(Refusal::ExcludedApp { name: ctx.front_name.unwrap_or(bundle).to_string() });
        }
    }
    if ctx.secure_input {
        return Err(Refusal::SecureInput);
    }
    if !src.has_permission() {
        return Err(Refusal::NoPermission);
    }
    src.capture().map_err(|detail| Refusal::CaptureFailed { detail })
}

/// Box-filter downscale of RGBA pixels so the longest edge is at most `max_edge`.
pub fn downscale_rgba(px: &[u8], w: u32, h: u32, max_edge: u32) -> (Vec<u8>, u32, u32) {
    let longest = w.max(h);
    if longest <= max_edge || w == 0 || h == 0 {
        return (px.to_vec(), w, h);
    }
    let f = longest.div_ceil(max_edge);
    let (nw, nh) = (w / f, h / f);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh {
        for x in 0..nw {
            let mut acc = [0u32; 4];
            for dy in 0..f {
                for dx in 0..f {
                    let i = (((y * f + dy) * w + x * f + dx) * 4) as usize;
                    for k in 0..4 {
                        acc[k] += px[i + k] as u32;
                    }
                }
            }
            let o = ((y * nw + x) * 4) as usize;
            for k in 0..4 {
                out[o + k] = (acc[k] / (f * f)) as u8;
            }
        }
    }
    (out, nw, nh)
}

#[cfg(target_os = "macos")]
pub use macos::{capture_rect, CoreGraphicsScreen};

#[cfg(target_os = "macos")]
mod macos {
    use super::{downscale_rgba, ScreenSource, Shot, MAX_EDGE};
    use std::ffi::c_void;

    type CGImageRef = *mut c_void;
    type CFDataRef = *const c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayCreateImage(display: u32) -> CGImageRef;
        fn CGDisplayCreateImageForRect(display: u32, rect: Rect) -> CGImageRef;
        fn CGImageGetWidth(image: CGImageRef) -> usize;
        fn CGImageGetHeight(image: CGImageRef) -> usize;
        fn CGImageGetBytesPerRow(image: CGImageRef) -> usize;
        fn CGImageGetBitsPerPixel(image: CGImageRef) -> usize;
        fn CGImageGetBitmapInfo(image: CGImageRef) -> u32;
        fn CGImageGetDataProvider(image: CGImageRef) -> *mut c_void;
        fn CGDataProviderCopyData(provider: *mut c_void) -> CFDataRef;
        fn CGImageRelease(image: CGImageRef);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
        fn CFDataGetLength(data: CFDataRef) -> isize;
        fn CFRelease(cf: *const c_void);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }

    /// An image's pixels as RGBA (and its size), releasing the image.
    unsafe fn image_rgba(image: CGImageRef) -> Result<(Vec<u8>, usize, usize), String> {
        unsafe {
            if image.is_null() {
                return Err("macOS returned no image".into());
            }
            let (w, h) = (CGImageGetWidth(image), CGImageGetHeight(image));
            let (stride, bpp, info) = (CGImageGetBytesPerRow(image), CGImageGetBitsPerPixel(image), CGImageGetBitmapInfo(image));
            let data = CGDataProviderCopyData(CGImageGetDataProvider(image));
            if data.is_null() || bpp != 32 || w == 0 || h == 0 {
                if !data.is_null() {
                    CFRelease(data);
                }
                CGImageRelease(image);
                return Err(format!("unsupported pixel format ({bpp} bpp)"));
            }
            let len = CFDataGetLength(data) as usize;
            let bytes = std::slice::from_raw_parts(CFDataGetBytePtr(data), len);
            // Byte order: little-endian 32-bit (bitmapInfo order flag 0x2000) is BGRA in memory.
            let bgra = info & 0x7000 == 0x2000;
            let mut rgba = vec![0u8; w * h * 4];
            for y in 0..h {
                let row = &bytes[y * stride..(y * stride + w * 4).min(len)];
                for x in 0..row.len() / 4 {
                    let s = &row[x * 4..x * 4 + 4];
                    let o = (y * w + x) * 4;
                    let (r, g, b) = if bgra { (s[2], s[1], s[0]) } else { (s[1], s[2], s[3]) };
                    rgba[o..o + 4].copy_from_slice(&[r, g, b, 255]);
                }
            }
            CFRelease(data);
            CGImageRelease(image);
            Ok((rgba, w, h))
        }
    }

    /// Part of the main display (global points, top-left origin) at full resolution, as PNG bytes,
    /// for reading its text. In memory only.
    pub fn capture_rect(x: f64, y: f64, w: f64, h: f64) -> Result<Vec<u8>, String> {
        unsafe {
            let (rgba, pw, ph) = image_rgba(CGDisplayCreateImageForRect(CGMainDisplayID(), Rect { x, y, w, h }))?;
            crate::terraria::store::encode_png(pw as u32, ph as u32, &rgba).map_err(|e| e.to_string())
        }
    }

    /// The main display, captured with `CGDisplayCreateImage`.
    pub struct CoreGraphicsScreen;

    impl CoreGraphicsScreen {
        /// Shows macOS's own Screen Recording prompt (once per app); returns current access.
        pub fn request_permission() -> bool {
            unsafe { CGRequestScreenCaptureAccess() }
        }
    }

    impl ScreenSource for CoreGraphicsScreen {
        fn has_permission(&self) -> bool {
            unsafe { CGPreflightScreenCaptureAccess() }
        }

        fn capture(&self) -> Result<Shot, String> {
            unsafe {
                let (rgba, w, h) = image_rgba(CGDisplayCreateImage(CGMainDisplayID()))?;
                let (small, sw, sh) = downscale_rgba(&rgba, w as u32, h as u32, MAX_EDGE);
                drop(rgba);
                let png = crate::terraria::store::encode_png(sw, sh, &small).map_err(|e| e.to_string())?;
                let (t, tw, th) = downscale_rgba(&small, sw, sh, super::THUMB_EDGE);
                let thumb = crate::terraria::store::encode_png(tw, th, &t).map_err(|e| e.to_string())?;
                Ok(Shot { png, width: sw, height: sh, thumb })
            }
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::Cell;

    /// Fake screen that counts captures.
    pub struct Fake {
        pub permission: bool,
        pub fail: bool,
        pub captures: Cell<u32>,
    }

    impl ScreenSource for Fake {
        fn has_permission(&self) -> bool {
            self.permission
        }
        fn capture(&self) -> Result<Shot, String> {
            self.captures.set(self.captures.get() + 1);
            if self.fail { Err("display asleep".into()) } else { Ok(Shot { png: vec![1, 2, 3], width: 1, height: 1, thumb: vec![9] }) }
        }
    }

    fn ctx<'a>(excluded: &'a [String]) -> Context<'a> {
        Context { opted_in: true, front_bundle: Some("com.apple.Safari"), front_name: Some("Safari"), excluded, secure_input: false }
    }

    #[test]
    fn captures_only_after_every_check_passes() {
        let src = Fake { permission: true, fail: false, captures: Cell::new(0) };
        let shot = capture_checked(&ctx(&[]), &src).unwrap();
        assert_eq!(shot.png, vec![1, 2, 3]);
        assert_eq!(src.captures.get(), 1);
    }

    #[test]
    fn refusals_never_touch_the_screen() {
        let src = Fake { permission: true, fail: false, captures: Cell::new(0) };
        let ex = vec!["com.apple.Safari".to_string()];
        assert_eq!(capture_checked(&Context { opted_in: false, ..ctx(&[]) }, &src).err(), Some(Refusal::NotOptedIn));
        assert_eq!(capture_checked(&ctx(&ex), &src).err(), Some(Refusal::ExcludedApp { name: "Safari".into() }));
        assert_eq!(capture_checked(&Context { secure_input: true, ..ctx(&[]) }, &src).err(), Some(Refusal::SecureInput));
        let no_perm = Fake { permission: false, fail: false, captures: Cell::new(0) };
        assert_eq!(capture_checked(&ctx(&[]), &no_perm).err(), Some(Refusal::NoPermission));
        assert_eq!(src.captures.get() + no_perm.captures.get(), 0);
        for r in [Refusal::NotOptedIn, Refusal::SecureInput, Refusal::NoPermission] {
            assert!(!r.message().is_empty());
        }
    }

    #[test]
    fn capture_failures_are_reported() {
        let src = Fake { permission: true, fail: true, captures: Cell::new(0) };
        let err = capture_checked(&ctx(&[]), &src).err().unwrap();
        assert_eq!(err, Refusal::CaptureFailed { detail: "display asleep".into() });
        assert!(err.message().contains("display asleep"));
    }

    #[test]
    fn downscales_to_the_max_edge() {
        let px = vec![200u8; 2560 * 1600 * 4];
        let (out, w, h) = downscale_rgba(&px, 2560, 1600, 1280);
        assert_eq!((w, h), (1280, 800));
        assert_eq!(out.len(), (1280 * 800 * 4) as usize);
        assert!(out.iter().all(|&b| b == 200));
        let (same, w2, _) = downscale_rgba(&px[..400], 10, 10, 1280);
        assert_eq!((same.len(), w2), (400, 10));
    }
}

//! Local link to the CustomNotch app, so one companion at a time can live inside the notch.
//! Listens on 127.0.0.1 only (never the network) and only answers requests carrying the
//! `X-Notch-Link` header, which a web page can't send here (no CORS is offered):
//!   GET  /notch/state?session=S&since=V   long-poll (up to 4 s) for the resident, her messages,
//!                                         gestures and the approach hint
//!   GET  /notch/atlas/N.png               the resident's sprite atlas (exactly what the overlay draws)
//!   POST /notch/geometry                  {"x","y","w","h","edge","expanded","dragging"} (global
//!                                         points, top-left origin)
//!   POST /notch/action                    {"kind": "exit"|"pet"|"feed"|"inventory", "x","y","vx","vy"}
//! The overlay decides who goes in and out; this module only holds the shared state and serves it.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const PORT: u16 = 47834;
/// Notch geometry / connection changes, for the overlay.
pub const EVENT: &str = "companion://notch";
/// Something the user did to the resident inside the notch, for the overlay.
pub const ACTION_EVENT: &str = "companion://notch-action";

const HEADER: &str = "x-notch-link";
const MAX_REQUEST: usize = 8 * 1024;
/// Long-poll wait. The notch re-polls right away, so this is also its heartbeat.
pub const POLL_WAIT: Duration = Duration::from_secs(4);
/// The notch counts as connected if it started a state poll within this window (a poll plus the
/// moment it takes to ask again). A poll that ends after the notch quit doesn't count.
pub const CONNECTED_WINDOW: Duration = Duration::from_secs(6);
const MAX_CONNECTIONS: usize = 12;
const MAX_MESSAGES: usize = 40;
const MAX_TEXT: usize = 2000;
const MAX_ATLAS: usize = 4 * 1024 * 1024;
/// An arrival older than this isn't replayed to a notch that connects later.
const ARRIVAL_FRESH: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct BodyBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Bubble {
    pub top: String,
    pub bottom: String,
    pub border: String,
    pub text: String,
    pub heart: String,
}

/// A companion moving into the notch, as sent by the overlay.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentIn {
    pub character: String,
    pub name: String,
    /// Base64 PNG: one row of `frameWidth`×`frameHeight` cells named by `frames`.
    pub atlas: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub frames: Vec<String>,
    /// Her body box inside a cell (feet at its bottom), in art pixels.
    pub body: BodyBox,
    pub bubble: Bubble,
    pub gestures: Vec<String>,
    pub stride: f64,
    /// Her draw scale on the desktop (CSS px per art px).
    pub scale: f64,
    /// Play the arrival (false when only her look changed).
    pub arrive: bool,
}

struct Resident {
    character: String,
    name: String,
    atlas_id: u64,
    frame_width: u32,
    frame_height: u32,
    frames: Vec<String>,
    body: BodyBox,
    bubble: Bubble,
    gestures: Vec<String>,
    stride: f64,
    scale: f64,
    arrival: u64,
    arrived_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: u64,
    pub character: String,
    pub name: String,
    pub text: String,
    /// Unix milliseconds.
    pub at: u64,
}

/// Where the notch is, in global points (top-left origin).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub edge: String,
    pub expanded: bool,
    pub dragging: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Action {
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
}

#[derive(Default)]
struct Link {
    version: u64,
    resident: Option<Resident>,
    atlas: Vec<u8>,
    next_atlas: u64,
    arrivals: u64,
    messages: VecDeque<Message>,
    next_message: u64,
    gesture: Option<(u64, String)>,
    next_gesture: u64,
    hover: String,
    geometry: Option<Geometry>,
    last_seen: Option<Instant>,
}

/// State shared by the overlay's commands and the notch's requests.
pub struct Shared {
    /// Distinguishes this run's message ids from an earlier run's (the notch keeps old messages).
    pub session: u64,
    link: Mutex<Link>,
    changed: Condvar,
}

impl Default for Shared {
    fn default() -> Self {
        let session = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(1);
        Shared { session, link: Mutex::new(Link::default()), changed: Condvar::new() }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn is_color(s: &str) -> bool {
    s.len() <= 9 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn is_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 24 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl Shared {
    fn bump(&self, link: &mut Link) {
        link.version += 1;
        self.changed.notify_all();
    }

    /// Who lives in the notch now.
    pub fn resident(&self) -> Option<String> {
        self.link.lock().unwrap().resident.as_ref().map(|r| r.character.clone())
    }

    /// Move a companion in (or refresh the resident's art). Only one may live there at a time.
    pub fn enter(&self, r: ResidentIn, known: &[&str], now: Instant) -> Result<(), String> {
        if !known.contains(&r.character.as_str()) {
            return Err("unknown character".into());
        }
        let ok_frames = !r.frames.is_empty() && r.frames.len() <= 256 && r.frames.iter().all(|f| is_name(f));
        let ok_cell = (4..=256).contains(&r.frame_width) && (4..=256).contains(&r.frame_height);
        let b = r.body;
        let ok_body = [b.x, b.y, b.w, b.h].iter().all(|v| v.is_finite() && (0.0..=256.0).contains(v)) && b.w > 0.0 && b.h > 0.0;
        let c = &r.bubble;
        let ok_colors = [&c.top, &c.bottom, &c.border, &c.text, &c.heart].iter().all(|s| is_color(s));
        if !ok_frames || !ok_cell || !ok_body || !ok_colors {
            return Err("bad resident".into());
        }
        let png = crate::voice::base64_decode(&r.atlas).ok_or("bad atlas")?;
        if png.len() > MAX_ATLAS || !png.starts_with(b"\x89PNG") {
            return Err("bad atlas".into());
        }
        let mut link = self.link.lock().unwrap();
        if let Some(cur) = &link.resident {
            if cur.character != r.character {
                return Err("occupied".into());
            }
        }
        let arrival = match (&link.resident, r.arrive) {
            (Some(cur), false) => cur.arrival,
            _ => {
                link.arrivals += 1;
                link.arrivals
            }
        };
        let arrived_at = link.resident.as_ref().filter(|_| !r.arrive).map(|c| c.arrived_at).unwrap_or(now);
        link.next_atlas += 1;
        link.atlas = png;
        link.resident = Some(Resident {
            character: r.character,
            name: clip(&r.name, 40),
            atlas_id: link.next_atlas,
            frame_width: r.frame_width,
            frame_height: r.frame_height,
            frames: r.frames,
            body: r.body,
            bubble: r.bubble,
            gestures: r.gestures.into_iter().filter(|g| is_name(g)).take(8).collect(),
            stride: if r.stride.is_finite() { r.stride.clamp(0.3, 3.0) } else { 1.0 },
            scale: if r.scale.is_finite() { r.scale.clamp(0.5, 8.0) } else { 2.0 },
            arrival,
            arrived_at,
        });
        link.hover.clear();
        self.bump(&mut link);
        Ok(())
    }

    /// She left (pulled out, sent away, or her app is closing). Her messages stay readable.
    pub fn leave(&self, character: &str) -> bool {
        let mut link = self.link.lock().unwrap();
        if link.resident.as_ref().is_none_or(|r| r.character != character) {
            return false;
        }
        link.resident = None;
        link.atlas.clear();
        link.gesture = None;
        self.bump(&mut link);
        true
    }

    /// Something the resident said. Ignored for anyone not living in the notch.
    pub fn say(&self, character: &str, text: &str) -> bool {
        let text = text.trim();
        if text.is_empty() {
            return false;
        }
        let mut link = self.link.lock().unwrap();
        let Some(name) = link.resident.as_ref().filter(|r| r.character == character).map(|r| r.name.clone()) else { return false };
        link.next_message += 1;
        let m = Message { id: link.next_message, character: character.into(), name, text: clip(text, MAX_TEXT), at: now_ms() };
        link.messages.push_back(m);
        while link.messages.len() > MAX_MESSAGES {
            link.messages.pop_front();
        }
        self.bump(&mut link);
        true
    }

    /// An expression or gesture (wave, hug, sit, happy, hearts…) for the resident to play.
    pub fn gesture(&self, character: &str, kind: &str) -> bool {
        if !is_name(kind) {
            return false;
        }
        let mut link = self.link.lock().unwrap();
        if link.resident.as_ref().is_none_or(|r| r.character != character) {
            return false;
        }
        link.next_gesture += 1;
        link.gesture = Some((link.next_gesture, kind.into()));
        self.bump(&mut link);
        true
    }

    /// A companion is being held over the notch: "empty" (it would take her), "full", or "".
    pub fn hover(&self, state: &str) {
        let state = if ["empty", "full", "incoming"].contains(&state) { state } else { "" };
        let mut link = self.link.lock().unwrap();
        if link.hover != state {
            link.hover = state.into();
            self.bump(&mut link);
        }
    }

    pub fn geometry(&self) -> Option<Geometry> {
        self.link.lock().unwrap().geometry.clone()
    }

    /// Store new geometry; true if it changed.
    pub fn set_geometry(&self, g: Geometry, now: Instant) -> bool {
        let mut link = self.link.lock().unwrap();
        link.last_seen = Some(now);
        if link.geometry.as_ref() == Some(&g) {
            return false;
        }
        link.geometry = Some(g);
        true
    }

    pub fn connected(&self, now: Instant) -> bool {
        self.link.lock().unwrap().last_seen.is_some_and(|t| now.duration_since(t) < CONNECTED_WINDOW)
    }

    fn touch(&self, now: Instant) {
        self.link.lock().unwrap().last_seen = Some(now);
    }

    fn atlas(&self, id: u64) -> Option<Vec<u8>> {
        let link = self.link.lock().unwrap();
        link.resident.as_ref().filter(|r| r.atlas_id == id).map(|_| link.atlas.clone())
    }

    /// Wait (up to `wait`) for anything newer than `since`, then describe the current state.
    fn snapshot(&self, session: Option<u64>, since: Option<u64>, wait: Duration, now: Instant) -> serde_json::Value {
        let mut link = self.link.lock().unwrap();
        if session == Some(self.session) {
            if let Some(since) = since {
                let deadline = now + wait;
                while link.version <= since {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        break;
                    }
                    link = self.changed.wait_timeout(link, left).unwrap().0;
                }
            }
        }
        let resident = link.resident.as_ref().map(|r| {
            serde_json::json!({
                "character": r.character,
                "name": r.name,
                "atlas": format!("/notch/atlas/{}.png", r.atlas_id),
                "frameWidth": r.frame_width,
                "frameHeight": r.frame_height,
                "frames": r.frames,
                "body": r.body,
                "bubble": r.bubble,
                "gestures": r.gestures,
                "stride": r.stride,
                "scale": r.scale,
                "arrival": r.arrival,
                "arrivalFresh": Instant::now().duration_since(r.arrived_at) < ARRIVAL_FRESH,
            })
        });
        let gesture = link.gesture.as_ref().map(|(id, kind)| serde_json::json!({ "id": id, "kind": kind }));
        serde_json::json!({
            "session": self.session,
            "version": link.version,
            "resident": resident,
            "messages": link.messages,
            "gesture": gesture,
            "hover": link.hover,
        })
    }
}

pub struct Request {
    pub method: String,
    pub path: String,
    pub linked: bool,
    pub body: String,
}

/// Parse a raw HTTP/1.1 request. None if malformed or too big.
pub fn parse_request(raw: &[u8]) -> Option<Request> {
    if raw.len() > MAX_REQUEST {
        return None;
    }
    let text = std::str::from_utf8(raw).ok()?;
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text, ""));
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let linked = lines.any(|l| l.split_once(':').is_some_and(|(k, _)| k.trim().eq_ignore_ascii_case(HEADER)));
    Some(Request { method, path, linked, body: body.to_string() })
}

fn query(path: &str, key: &str) -> Option<u64> {
    path.split_once('?')?.1.split('&').find_map(|kv| kv.strip_prefix(key)?.strip_prefix('=')).and_then(|v| v.parse().ok())
}

fn num(v: &serde_json::Value, key: &str) -> Option<f64> {
    v.get(key)?.as_f64().filter(|n| n.is_finite())
}

pub fn parse_geometry(body: &str) -> Option<Geometry> {
    let v: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let edge = v.get("edge")?.as_str()?;
    if !["top", "bottom", "left", "right"].contains(&edge) {
        return None;
    }
    let (w, h) = (num(&v, "w")?, num(&v, "h")?);
    if !(0.0..=10_000.0).contains(&w) || !(0.0..=10_000.0).contains(&h) {
        return None;
    }
    Some(Geometry {
        x: num(&v, "x")?,
        y: num(&v, "y")?,
        w,
        h,
        edge: edge.into(),
        expanded: v.get("expanded").and_then(|b| b.as_bool()).unwrap_or(false),
        dragging: v.get("dragging").and_then(|b| b.as_bool()).unwrap_or(false),
    })
}

/// Where the inventory pouch goes: beside the notch on the screen side of it, centred on it and
/// kept inside `area` (all global points, top-left origin), like CustomNotch's own panels.
pub fn pouch_origin(g: &Geometry, size: (f64, f64), area: (f64, f64, f64, f64)) -> (f64, f64) {
    const GAP: f64 = 12.0;
    let (w, h) = size;
    let (cx, cy) = (g.x + g.w / 2.0, g.y + g.h / 2.0);
    let (x, y) = match g.edge.as_str() {
        "top" => (cx - w / 2.0, g.y + g.h + GAP),
        "bottom" => (cx - w / 2.0, g.y - GAP - h),
        "left" => (g.x + g.w + GAP, cy - h / 2.0),
        _ => (g.x - GAP - w, cy - h / 2.0),
    };
    let (ax, ay, aw, ah) = area;
    let clamp = |v: f64, lo: f64, hi: f64| if hi < lo { lo } else { v.clamp(lo, hi) };
    (clamp(x, ax + 8.0, ax + aw - w - 8.0), clamp(y, ay + 8.0, ay + ah - h - 8.0))
}

pub fn parse_action(body: &str) -> Option<Action> {
    let v: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let kind = v.get("kind")?.as_str()?;
    if !["exit", "pet", "feed", "inventory"].contains(&kind) {
        return None;
    }
    let speed = |k: &str| num(&v, k).unwrap_or(0.0).clamp(-6000.0, 6000.0);
    Some(Action { kind: kind.into(), x: num(&v, "x").unwrap_or(0.0), y: num(&v, "y").unwrap_or(0.0), vx: speed("vx"), vy: speed("vy") })
}

pub enum Reply {
    Status(u16),
    Json(String),
    Png(Vec<u8>),
}

/// What to answer, plus a geometry change or user action to forward.
pub fn handle(req: &Request, shared: &Shared, now: Instant) -> (Reply, Option<Geometry>, Option<Action>) {
    if !req.linked {
        return (Reply::Status(403), None, None);
    }
    let path = req.path.split('?').next().unwrap_or("");
    match (req.method.as_str(), path) {
        ("GET", "/notch/state") => {
            shared.touch(now);
            let snap = shared.snapshot(query(&req.path, "session"), query(&req.path, "since"), POLL_WAIT, now);
            (Reply::Json(snap.to_string()), None, None)
        }
        ("GET", p) if p.starts_with("/notch/atlas/") => {
            let id = p.trim_start_matches("/notch/atlas/").trim_end_matches(".png").parse::<u64>().ok();
            match id.and_then(|id| shared.atlas(id)) {
                Some(png) => (Reply::Png(png), None, None),
                None => (Reply::Status(404), None, None),
            }
        }
        ("POST", "/notch/geometry") => match parse_geometry(&req.body) {
            Some(g) => {
                let changed = shared.set_geometry(g.clone(), now);
                (Reply::Status(204), changed.then_some(g), None)
            }
            None => (Reply::Status(400), None, None),
        },
        // Debug builds only: drive the overlay's side for testing ("drop"/"throw" a companion at
        // the notch, or have the resident "say" something), like CustomNotch's DEBUG hooks.
        #[cfg(debug_assertions)]
        ("POST", "/notch/debug") => {
            let v: serde_json::Value = serde_json::from_str(req.body.trim()).unwrap_or_default();
            let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");
            let arg = v.get("arg").and_then(|o| o.as_str()).unwrap_or("");
            (Reply::Status(204), None, Some(Action { kind: format!("debug-{op}:{arg}"), x: 0.0, y: 0.0, vx: 0.0, vy: 0.0 }))
        }
        ("POST", "/notch/action") => match parse_action(&req.body) {
            Some(a) if a.kind == "inventory" || shared.resident().is_some() => (Reply::Status(204), None, Some(a)),
            Some(_) => (Reply::Status(409), None, None),
            None => (Reply::Status(400), None, None),
        },
        _ => (Reply::Status(404), None, None),
    }
}

fn status_line(status: u16) -> &'static str {
    match status {
        200 => "200 OK",
        204 => "204 No Content",
        400 => "400 Bad Request",
        403 => "403 Forbidden",
        409 => "409 Conflict",
        503 => "503 Service Unavailable",
        _ => "404 Not Found",
    }
}

pub fn response(reply: &Reply) -> Vec<u8> {
    let (status, ctype, body): (u16, &str, &[u8]) = match reply {
        Reply::Status(s) => (*s, "", b""),
        Reply::Json(j) => (200, "application/json", j.as_bytes()),
        Reply::Png(p) => (200, "image/png", p),
    };
    let ctype = if ctype.is_empty() { String::new() } else { format!("Content-Type: {ctype}\r\nCache-Control: no-store\r\n") };
    let mut out = format!("HTTP/1.1 {}\r\n{ctype}Content-Length: {}\r\nConnection: close\r\n\r\n", status_line(status), body.len()).into_bytes();
    out.extend_from_slice(body);
    out
}

fn read_request(stream: &mut TcpStream) -> Option<Vec<u8>> {
    stream.set_read_timeout(Some(Duration::from_millis(800))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_REQUEST {
            return None;
        }
        if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..end]).to_ascii_lowercase();
            let len = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length:"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if buf.len() >= end + 4 + len {
                break;
            }
        }
    }
    Some(buf)
}

/// Serve forever; each connection gets its own thread (the state poll waits). Returns an error
/// message if the port can't be opened.
pub fn serve(
    shared: Arc<Shared>,
    on_geometry: impl Fn(Geometry) + Send + Sync + 'static,
    on_action: impl Fn(Action) + Send + Sync + 'static,
) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| format!("port {PORT} unavailable: {e}"))?;
    let on_geometry = Arc::new(on_geometry);
    let on_action = Arc::new(on_action);
    let open = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        if !stream.peer_addr().is_ok_and(|a| a.ip().is_loopback()) {
            continue;
        }
        if open.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
            let _ = stream.write_all(&response(&Reply::Status(503)));
            continue;
        }
        open.fetch_add(1, Ordering::Relaxed);
        let (shared, on_geometry, on_action, open) = (shared.clone(), on_geometry.clone(), on_action.clone(), open.clone());
        std::thread::spawn(move || {
            let (reply, geometry, action) = read_request(&mut stream)
                .and_then(|raw| parse_request(&raw))
                .map(|r| handle(&r, &shared, Instant::now()))
                .unwrap_or((Reply::Status(400), None, None));
            let _ = stream.write_all(&response(&reply));
            drop(stream);
            if let Some(g) = geometry {
                on_geometry(g);
            }
            if let Some(a) = action {
                on_action(a);
            }
            open.fetch_sub(1, Ordering::Relaxed);
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KNOWN: [&str; 2] = ["terrarian", "nurse"];
    const PNG_B64: &str = "iVBORw0KGgo="; // the PNG signature is enough for validation

    fn resident(id: &str, arrive: bool) -> ResidentIn {
        ResidentIn {
            character: id.into(),
            name: "Nurse".into(),
            atlas: PNG_B64.into(),
            frame_width: 40,
            frame_height: 56,
            frames: vec!["idle".into(), "walk0".into()],
            body: BodyBox { x: 10.0, y: 12.0, w: 20.0, h: 42.0 },
            bubble: Bubble { top: "#ffffff".into(), bottom: "#ffe1e1".into(), border: "#d23a3a".into(), text: "#4a1010".into(), heart: "#ff4a4a".into() },
            gestures: vec!["wave".into(), "../etc".into()],
            stride: 1.0,
            scale: 2.0,
            arrive,
        }
    }

    fn req(raw: &str) -> Request {
        parse_request(raw.as_bytes()).unwrap()
    }

    fn state(shared: &Shared) -> serde_json::Value {
        shared.snapshot(None, None, Duration::ZERO, Instant::now())
    }

    #[test]
    fn only_one_companion_lives_in_the_notch() {
        let s = Shared::default();
        let t = Instant::now();
        assert!(s.enter(resident("nurse", true), &KNOWN, t).is_ok());
        assert_eq!(s.enter(resident("terrarian", true), &KNOWN, t).unwrap_err(), "occupied");
        assert_eq!(s.resident().as_deref(), Some("nurse"));
        // Her own refresh (a new look) is fine and keeps her arrival.
        let arrival = state(&s)["resident"]["arrival"].clone();
        assert!(s.enter(resident("nurse", false), &KNOWN, t).is_ok());
        assert_eq!(state(&s)["resident"]["arrival"], arrival);
        assert!(!s.leave("terrarian"));
        assert!(s.leave("nurse"));
        assert!(s.enter(resident("terrarian", true), &KNOWN, t).is_ok());
    }

    #[test]
    fn rejects_unknown_or_malformed_residents() {
        let s = Shared::default();
        let t = Instant::now();
        assert!(s.enter(resident("stranger", true), &KNOWN, t).is_err());
        let mut bad = resident("nurse", true);
        bad.atlas = "bm90IGEgcG5n".into(); // "not a png"
        assert!(s.enter(bad, &KNOWN, t).is_err());
        let mut bad = resident("nurse", true);
        bad.bubble.top = "red; background:url(x)".into();
        assert!(s.enter(bad, &KNOWN, t).is_err());
        let mut bad = resident("nurse", true);
        bad.frames = vec!["../../x".into()];
        assert!(s.enter(bad, &KNOWN, t).is_err());
        // Odd gesture names are dropped, not trusted.
        assert!(s.enter(resident("nurse", true), &KNOWN, t).is_ok());
        assert_eq!(state(&s)["resident"]["gestures"], serde_json::json!(["wave"]));
    }

    #[test]
    fn messages_accumulate_instead_of_overwriting() {
        let s = Shared::default();
        assert!(!s.say("nurse", "nobody home"));
        s.enter(resident("nurse", true), &KNOWN, Instant::now()).unwrap();
        assert!(s.say("nurse", "Hello, Master!"));
        assert!(s.say("nurse", "Are you resting enough?"));
        assert!(!s.say("terrarian", "I'm not in there"));
        assert!(!s.say("nurse", "   "));
        let m = state(&s)["messages"].clone();
        assert_eq!(m.as_array().unwrap().len(), 2);
        assert_eq!(m[0]["text"], "Hello, Master!");
        assert_eq!(m[1]["id"].as_u64().unwrap(), m[0]["id"].as_u64().unwrap() + 1);
        // Leaving keeps what she said.
        s.leave("nurse");
        assert_eq!(state(&s)["messages"].as_array().unwrap().len(), 2);
        for i in 0..MAX_MESSAGES + 5 {
            s.enter(resident("nurse", true), &KNOWN, Instant::now()).unwrap();
            s.say("nurse", &format!("line {i}"));
        }
        assert_eq!(state(&s)["messages"].as_array().unwrap().len(), MAX_MESSAGES);
    }

    #[test]
    fn requests_need_the_link_header() {
        let s = Shared::default();
        let t = Instant::now();
        let (r, _, _) = handle(&req("GET /notch/state HTTP/1.1\r\nHost: x\r\n\r\n"), &s, t);
        assert!(matches!(r, Reply::Status(403)));
        let (r, _, _) = handle(&req("GET /notch/state HTTP/1.1\r\nX-Notch-Link: 1\r\n\r\n"), &s, t);
        assert!(matches!(r, Reply::Json(_)));
        assert!(s.connected(t));
        let (r, _, _) = handle(&req("OPTIONS /notch/action HTTP/1.1\r\nX-Notch-Link: 1\r\n\r\n"), &s, t);
        assert!(matches!(r, Reply::Status(404)));
    }

    #[test]
    fn geometry_and_actions_are_validated() {
        let s = Shared::default();
        let t = Instant::now();
        let post = |path: &str, body: &str| handle(&req(&format!("POST {path} HTTP/1.1\r\nx-notch-link: 1\r\nContent-Length: {}\r\n\r\n{body}", body.len())), &s, t);
        let (r, g, _) = post("/notch/geometry", r#"{"x":1300,"y":400,"w":36,"h":168,"edge":"right","expanded":false}"#);
        assert!(matches!(r, Reply::Status(204)));
        assert_eq!(g.unwrap().edge, "right");
        // Same geometry again: nothing to forward.
        let (_, g, _) = post("/notch/geometry", r#"{"x":1300,"y":400,"w":36,"h":168,"edge":"right","expanded":false}"#);
        assert!(g.is_none());
        let (r, _, _) = post("/notch/geometry", r#"{"x":1,"y":1,"w":1,"h":1,"edge":"sideways"}"#);
        assert!(matches!(r, Reply::Status(400)));
        // Exit/pet/feed need a resident; inventory doesn't.
        let (r, _, a) = post("/notch/action", r#"{"kind":"exit","x":10,"y":10}"#);
        assert!(matches!(r, Reply::Status(409)) && a.is_none());
        let (r, _, _) = post("/notch/action", r#"{"kind":"feed"}"#);
        assert!(matches!(r, Reply::Status(409)));
        let (_, _, a) = post("/notch/action", r#"{"kind":"inventory"}"#);
        assert_eq!(a.unwrap().kind, "inventory");
        s.enter(resident("nurse", true), &KNOWN, t).unwrap();
        let (_, _, a) = post("/notch/action", r#"{"kind":"exit","x":10,"y":20,"vx":99999,"vy":-5}"#);
        assert_eq!(a.unwrap(), Action { kind: "exit".into(), x: 10.0, y: 20.0, vx: 6000.0, vy: -5.0 });
        let (_, _, a) = post("/notch/action", r#"{"kind":"feed"}"#);
        assert_eq!(a.unwrap().kind, "feed");
        let (r, _, _) = post("/notch/action", r#"{"kind":"rm"}"#);
        assert!(matches!(r, Reply::Status(400)));
    }

    #[test]
    fn the_pouch_sits_beside_the_notch_on_screen() {
        let g = |x, y, w, h, edge: &str| Geometry { x, y, w, h, edge: edge.into(), expanded: true, dragging: false };
        let area = (0.0, 25.0, 1728.0, 1092.0);
        // Docked right: to its left, centred on it.
        assert_eq!(pouch_origin(&g(1400.0, 300.0, 328.0, 500.0, "right"), (340.0, 460.0), area), (1048.0, 320.0));
        // Docked top: below it.
        assert_eq!(pouch_origin(&g(600.0, 0.0, 440.0, 296.0, "top"), (340.0, 460.0), area), (650.0, 308.0));
        // Near a corner it stays on screen.
        let (x, y) = pouch_origin(&g(0.0, 900.0, 328.0, 400.0, "left"), (340.0, 460.0), area);
        assert_eq!((x, y), (340.0, 1117.0 - 460.0 - 8.0));
    }

    #[test]
    fn the_poll_waits_for_news_and_serves_the_atlas() {
        let s = Arc::new(Shared::default());
        let first = state(&s);
        let version = first["version"].as_u64().unwrap();
        let waiter = {
            let s = s.clone();
            std::thread::spawn(move || s.snapshot(Some(s.session), Some(version), Duration::from_secs(3), Instant::now()))
        };
        std::thread::sleep(Duration::from_millis(50));
        s.enter(resident("nurse", true), &KNOWN, Instant::now()).unwrap();
        let snap = waiter.join().unwrap();
        assert!(snap["version"].as_u64().unwrap() > version);
        assert_eq!(snap["resident"]["character"], "nurse");
        assert_eq!(snap["resident"]["arrivalFresh"], true);
        let atlas = snap["resident"]["atlas"].as_str().unwrap().to_string();
        let (r, _, _) = handle(&req(&format!("GET {atlas} HTTP/1.1\r\nX-Notch-Link: 1\r\n\r\n")), &s, Instant::now());
        assert!(matches!(r, Reply::Png(ref p) if p.starts_with(b"\x89PNG")));
        // A different session (a new run) doesn't wait.
        let t = Instant::now();
        s.snapshot(Some(1), Some(u64::MAX), Duration::from_secs(2), t);
        assert!(t.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn hover_hints_are_limited_to_known_states() {
        let s = Shared::default();
        s.hover("empty");
        assert_eq!(state(&s)["hover"], "empty");
        s.hover("<script>");
        assert_eq!(state(&s)["hover"], "");
    }
}

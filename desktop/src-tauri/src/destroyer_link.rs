//! Tiny local endpoint linking the Letter Destroyer bookmarklet and the desktop buddy. Listens on
//! 127.0.0.1 only (never the network):
//!   POST /destroyer          {"event": "on"|"smash"|"off", "count": n}  → the buddy reacts
//!   GET  /destroyer/strikes?since=N                                      → pickaxe strikes
//! Strikes are the screen position where the companion's pickaxe hit (the pointer), so the page
//! can smash its own letters there. Page content and URLs are never sent or accepted. Rate-limited;
//! it can be turned off in settings.

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const PORT: u16 = 47833;
pub const EVENT: &str = "companion://destroyer";
const MAX_REQUEST: usize = 8 * 1024;
/// At most this many forwarded events per window.
const RATE_LIMIT: usize = 20;
const RATE_WINDOW: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DestroyerEvent {
    pub event: String,
    pub count: u32,
}

/// A pickaxe strike at a global screen point (macOS points, top-left origin).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Strike {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    /// Pickaxe power 1–3 (stronger pickaxes smash a bigger area).
    pub power: u8,
}

/// Strikes waiting for the page to pick them up, and when a page last asked.
#[derive(Default)]
pub struct Strikes {
    next_id: u64,
    list: VecDeque<(Strike, Instant)>,
    last_poll: Option<Instant>,
}

/// Strikes older than this are dropped (the page would smash the wrong place).
pub const STRIKE_TTL: Duration = Duration::from_millis(1500);
/// A page counts as connected if it polled within this window.
pub const CONNECTED_WINDOW: Duration = Duration::from_secs(2);
const MAX_STRIKES: usize = 16;

impl Strikes {
    pub fn push(&mut self, x: f64, y: f64, power: u8, now: Instant) -> u64 {
        self.next_id += 1;
        self.list.push_back((Strike { id: self.next_id, x, y, power: power.clamp(1, 3) }, now));
        while self.list.len() > MAX_STRIKES {
            self.list.pop_front();
        }
        self.next_id
    }

    /// Fresh strikes newer than `since` (and remember that a page is listening).
    pub fn since(&mut self, since: u64, now: Instant) -> Vec<Strike> {
        self.last_poll = Some(now);
        self.list.retain(|(_, t)| now.duration_since(*t) < STRIKE_TTL);
        self.list.iter().filter(|(s, _)| s.id > since).map(|(s, _)| s.clone()).collect()
    }

    /// The newest strike id (pages start from here so they don't replay old strikes).
    pub fn latest(&self) -> u64 {
        self.next_id
    }

    pub fn connected(&self, now: Instant) -> bool {
        self.last_poll.is_some_and(|t| now.duration_since(t) < CONNECTED_WINDOW)
    }
}

pub struct Request {
    pub method: String,
    pub path: String,
    pub body: String,
}

/// Parse a raw HTTP/1.1 request (headers + body). None if malformed or too big.
pub fn parse_request(raw: &[u8]) -> Option<Request> {
    if raw.len() > MAX_REQUEST {
        return None;
    }
    let text = std::str::from_utf8(raw).ok()?;
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text, ""));
    let mut line = head.lines().next()?.split_whitespace();
    let method = line.next()?.to_string();
    let path = line.next()?.to_string();
    Some(Request { method, path, body: body.to_string() })
}

/// Validate a ping body into an event (only known event names, bounded count).
pub fn parse_event(body: &str) -> Option<DestroyerEvent> {
    let v: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let event = v.get("event")?.as_str()?;
    if !["on", "smash", "off"].contains(&event) {
        return None;
    }
    let count = v.get("count").and_then(|c| c.as_f64()).filter(|c| c.is_finite()).unwrap_or(0.0).clamp(0.0, 9999.0) as u32;
    Some(DestroyerEvent { event: event.into(), count })
}

/// `since` query value from "/destroyer/strikes?since=N" (missing or bad → None).
fn since_param(path: &str) -> Option<u64> {
    path.split_once('?')?.1.split('&').find_map(|kv| kv.strip_prefix("since=")).and_then(|v| v.parse().ok())
}

/// Response for a request: status, JSON body (if any), and the event to forward (if any).
pub fn handle(req: &Request, strikes: &Mutex<Strikes>, now: Instant) -> (u16, Option<String>, Option<DestroyerEvent>) {
    let path = req.path.split('?').next().unwrap_or("");
    match (req.method.as_str(), path) {
        ("OPTIONS", "/destroyer") | ("OPTIONS", "/destroyer/strikes") => (204, None, None),
        ("POST", "/destroyer") => match parse_event(&req.body) {
            Some(ev) => (204, None, Some(ev)),
            None => (400, None, None),
        },
        ("GET", "/destroyer/strikes") => {
            let mut s = strikes.lock().unwrap();
            let body = match since_param(&req.path) {
                Some(since) => serde_json::json!({ "latest": s.latest(), "strikes": s.since(since, now) }),
                // First poll: report the current id only, so old strikes aren't replayed.
                None => {
                    s.since(u64::MAX, now);
                    serde_json::json!({ "latest": s.latest(), "strikes": [] })
                }
            };
            (200, Some(body.to_string()), None)
        }
        _ => (404, None, None),
    }
}

/// HTTP response with the CORS / Private Network Access headers a web page needs to reach localhost.
pub fn response(status: u16, body: Option<&str>) -> String {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        429 => "Too Many Requests",
        _ => "Not Found",
    };
    let body = body.unwrap_or("");
    let ctype = if body.is_empty() { "" } else { "Content-Type: application/json\r\nCache-Control: no-store\r\n" };
    format!(
        "HTTP/1.1 {status} {reason}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\n{ctype}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Sliding-window rate limiter.
#[derive(Default)]
pub struct RateLimit(Vec<Instant>);

impl RateLimit {
    pub fn allow(&mut self, now: Instant) -> bool {
        self.0.retain(|t| now.duration_since(*t) < RATE_WINDOW);
        if self.0.len() >= RATE_LIMIT {
            return false;
        }
        self.0.push(now);
        true
    }
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
        // Stop once headers + the declared body have arrived.
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

/// Serve while `enabled()` is true; `on_event` gets each accepted event. Returns an error message if
/// the port can't be opened (e.g. another program uses it).
pub fn serve(enabled: impl Fn() -> bool, strikes: &Mutex<Strikes>, on_event: impl Fn(DestroyerEvent)) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| format!("port {PORT} unavailable: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let mut limit = RateLimit::default();
    while enabled() {
        match listener.accept() {
            Ok((mut stream, addr)) => {
                if !addr.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                let now = Instant::now();
                let (status, body, ev) = read_request(&mut stream)
                    .and_then(|raw| parse_request(&raw))
                    .map(|r| handle(&r, strikes, now))
                    .unwrap_or((400, None, None));
                let status = match ev {
                    Some(ev) if limit.allow(now) => {
                        on_event(ev);
                        status
                    }
                    Some(_) => 429,
                    None => status,
                };
                let _ = stream.write_all(response(status, body.as_deref()).as_bytes());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(60)),
            Err(_) => std::thread::sleep(Duration::from_millis(200)),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(raw: &str) -> Request {
        parse_request(raw.as_bytes()).unwrap()
    }

    fn h(raw: &str) -> (u16, Option<DestroyerEvent>) {
        let (status, _, ev) = handle(&req(raw), &Mutex::new(Strikes::default()), Instant::now());
        (status, ev)
    }

    #[test]
    fn accepts_only_well_formed_pings() {
        let ok = req("POST /destroyer HTTP/1.1\r\nContent-Type: text/plain\r\nContent-Length: 29\r\n\r\n{\"event\":\"smash\",\"count\":7}");
        let (status, _, ev) = handle(&ok, &Mutex::new(Strikes::default()), Instant::now());
        assert_eq!((status, ev), (204, Some(DestroyerEvent { event: "smash".into(), count: 7 })));
        assert_eq!(h("OPTIONS /destroyer HTTP/1.1\r\n\r\n").0, 204);
        assert_eq!(h("POST /destroyer HTTP/1.1\r\n\r\n{\"event\":\"rm -rf\"}").0, 400);
        assert_eq!(h("POST /destroyer HTTP/1.1\r\n\r\nnot json").0, 400);
        assert_eq!(h("GET /destroyer HTTP/1.1\r\n\r\n").0, 404);
        assert_eq!(h("POST /prefs HTTP/1.1\r\n\r\n{}").0, 404);
        assert!(parse_request(&vec![b'a'; MAX_REQUEST + 1]).is_none());
        assert!(parse_request(b"").is_none());
    }

    #[test]
    fn counts_are_bounded_and_extra_fields_ignored() {
        assert_eq!(parse_event(r#"{"event":"on","count":-4}"#).unwrap().count, 0);
        assert_eq!(parse_event(r#"{"event":"off","count":1e9}"#).unwrap().count, 9999);
        assert_eq!(parse_event(r#"{"event":"smash","url":"https://x","text":"secret"}"#).unwrap(), DestroyerEvent { event: "smash".into(), count: 0 });
    }

    #[test]
    fn responses_allow_pages_to_reach_localhost_and_return_no_data() {
        let r = response(204, None);
        assert!(r.starts_with("HTTP/1.1 204"));
        assert!(r.contains("Access-Control-Allow-Private-Network: true"));
        assert!(r.contains("Access-Control-Allow-Origin: *"));
        assert!(r.ends_with("Content-Length: 0\r\nConnection: close\r\n\r\n"));
        let j = response(200, Some("{}"));
        assert!(j.contains("Content-Type: application/json") && j.ends_with("\r\n\r\n{}"));
    }

    #[test]
    fn rate_limits_bursts() {
        let mut l = RateLimit::default();
        let t = Instant::now();
        for _ in 0..RATE_LIMIT {
            assert!(l.allow(t));
        }
        assert!(!l.allow(t));
        assert!(l.allow(t + RATE_WINDOW + Duration::from_millis(1)));
    }

    #[test]
    fn pages_pick_up_new_pickaxe_strikes_once_and_never_stale_ones() {
        let strikes = Mutex::new(Strikes::default());
        let t0 = Instant::now();
        let get = |path: &str, now: Instant| {
            let (status, body, _) = handle(&req(&format!("GET {path} HTTP/1.1\r\n\r\n")), &strikes, now);
            assert_eq!(status, 200);
            serde_json::from_str::<serde_json::Value>(&body.unwrap()).unwrap()
        };
        strikes.lock().unwrap().push(1.0, 1.0, 1, t0); // before any page was listening
        let first = get("/destroyer/strikes", t0);
        assert_eq!(first["strikes"].as_array().unwrap().len(), 0); // not replayed
        let since = first["latest"].as_u64().unwrap();
        assert!(strikes.lock().unwrap().connected(t0));
        strikes.lock().unwrap().push(300.0, 200.0, 2, t0);
        let next = get(&format!("/destroyer/strikes?since={since}"), t0);
        assert_eq!(next["strikes"][0]["x"], 300.0);
        assert_eq!(next["strikes"][0]["power"], 2);
        let latest = next["latest"].as_u64().unwrap();
        assert_eq!(get(&format!("/destroyer/strikes?since={latest}"), t0)["strikes"].as_array().unwrap().len(), 0);
        // Strikes expire quickly.
        strikes.lock().unwrap().push(5.0, 5.0, 9, t0);
        let later = t0 + STRIKE_TTL + Duration::from_millis(10);
        assert_eq!(get(&format!("/destroyer/strikes?since={latest}"), later)["strikes"].as_array().unwrap().len(), 0);
        assert!(!strikes.lock().unwrap().connected(later + CONNECTED_WINDOW + Duration::from_millis(10)));
    }
}

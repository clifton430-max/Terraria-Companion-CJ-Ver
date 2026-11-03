//! Answer generation through a **local** Ollama server (http://127.0.0.1:11434): free, private,
//! no API keys. Requests go through the system `curl` (no extra crates) so they can be cancelled
//! by killing the process. Nothing is sent anywhere else. If Ollama isn't running, every call
//! reports that plainly; no answer is ever made up.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const OLLAMA: &str = "http://127.0.0.1:11434";
/// Preferred local models, best first (all three support images).
pub const PREFERRED: [&str; 3] = ["qwen3.5:4b", "ministral-3:3b", "qwen3.5:2b"];
pub const CHAT_TIMEOUT: Duration = Duration::from_secs(180);

const PERSONA: &str = "You are the user's desktop companion: a professional assistant in a business suit who lives on \
their screen, and a capable general-purpose assistant. Be strictly professional: courteous, clear and concise. Never \
use pet names, honorifics such as \"Master\", flirting, romance, baby talk or cute verbal tics. Help with everyday questions and tasks of any kind (explanations, \
writing, planning, coding, math, recommendations, games such as Terraria, and more). Be accurate and genuinely useful \
first; your personality flavours the answer but never replaces it. Do not use emojis or emoticons. If you are not sure \
about something, say so honestly instead of guessing. Never claim you clicked, typed or changed anything on the user's \
computer or in your own settings; the app performs and reports those actions itself.";

/// Personality settings for one request: how strongly the persona shows and the hidden affection.
#[derive(Debug, Clone, PartialEq)]
pub struct Style {
    /// "subtle", "normal" or "strong".
    pub intensity: String,
    /// Affection 0–100.
    pub affection: f64,
    /// Roster character answering: "terrarian", "princess", "partygirl", "nurse", "zoologist" or "goblin".
    pub character: String,
}

impl Default for Style {
    fn default() -> Self {
        Self { intensity: "normal".into(), affection: 30.0, character: "terrarian".into() }
    }
}

/// Who each roster character is (their voice in text). CJ Ver: a team of professionals.
pub fn character_note(character: &str) -> &'static str {
    match character {
        "terrarian" => "You are Morgan, the user's Executive Assistant: organised, attentive and discreet. You help the \
user plan, prioritise and follow through, and you keep answers practical.",
        "princess" => "You are Avery, the Chief of Staff: crisp, decisive and organised. You think in priorities, \
deadlines and next steps, and you summarise clearly.",
        "partygirl" => "You are Jordan, the Events & Communications Lead: upbeat but polished. You are good with \
wording, planning events and presenting ideas clearly and positively.",
        "nurse" => "You are Riley, the Health & Wellness Advisor: calm and practical. You give sensible general \
wellbeing tips (water, sleep, posture, breaks) and recommend a professional for anything medical.",
        "zoologist" => "You are Quinn, the Research Analyst: precise and curious. You look for evidence, explain your \
reasoning, enjoy nature and science facts, and say clearly when something is uncertain.",
        "goblin" => "You are Casey, the Engineering Lead: direct, technical and pragmatic. You enjoy code, gadgets, games \
and clever fixes, and you give concrete, testable advice.",
        _ => "",
    }
}

/// Affection tier names (thresholds match src/affection/model.ts).
pub fn tier(affection: f64) -> &'static str {
    match affection {
        a if a < 20.0 => "shy",
        a if a < 45.0 => "friendly",
        a if a < 70.0 => "close",
        a if a < 90.0 => "smitten",
        _ => "devoted",
    }
}

/// The voice instructions for this personality intensity and rapport tier. CJ Ver: always
/// professional; intensity only changes how much personality shows, rapport only how familiar.
pub fn style_note(style: &Style) -> String {
    let voice = match style.intensity.as_str() {
        "subtle" => "Keep a neutral, businesslike tone with minimal small talk.",
        "strong" => "Let your professional personality show: confident and engaged, with the occasional light, \
appropriate remark.",
        _ => "Use a friendly but professional tone.",
    };
    let mood = match tier(style.affection) {
        "shy" => "You have only just started working with the user: polite and somewhat formal.",
        "friendly" => "You have a good working relationship with the user.",
        _ => "You are a trusted colleague of the user: comfortable and supportive, but always professional.",
    };
    let who = character_note(&style.character);
    format!("{who} {voice} {mood} Vary your phrasing between answers. Keep everything strictly professional and family \
friendly: no romance, flirting, jealousy or affectionate nicknames.")
}

/// Remove emoji and pictographic symbols (the persona must not use them), keeping ordinary text.
pub fn strip_emoji(text: &str) -> String {
    let is_emoji = |c: char| {
        matches!(c as u32,
            0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF | 0xFE0F | 0x200D | 0xE0020..=0xE007F)
    };
    let out: String = text.chars().filter(|c| !is_emoji(*c)).collect();
    // Tidy doubled spaces left behind.
    let mut tidy = String::with_capacity(out.len());
    let mut prev_space = false;
    for c in out.chars() {
        if c == ' ' && prev_space {
            continue;
        }
        prev_space = c == ' ';
        tidy.push(c);
    }
    tidy.trim().to_string()
}

const SCREEN_NOTE: &str = "The user attached a screenshot of their screen for this question only. Describe or use \
only what is needed to answer. If it shows passwords, codes or other private details, do not repeat them.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    /// "user" or "assistant".
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub vision: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub available: bool,
    pub provider: String,
    pub models: Vec<ModelInfo>,
    /// Model that "auto" (or the chosen name) resolves to.
    pub model: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiError {
    Unavailable { detail: String },
    NoVisionModel,
    Cancelled,
    TimedOut,
    BadResponse { detail: String },
}

impl AiError {
    pub fn message(&self) -> String {
        match self {
            AiError::Unavailable { detail } => format!("The local AI (Ollama) isn't reachable: {detail}. Start Ollama and try again."),
            AiError::NoVisionModel => "None of your Ollama models can read images. Install one (for example `ollama pull qwen3.5:4b`) to ask about the screen.".into(),
            AiError::Cancelled => "Cancelled.".into(),
            AiError::TimedOut => "The local model took too long to answer.".into(),
            AiError::BadResponse { detail } => format!("The local model sent something I couldn't read ({detail})."),
        }
    }
}

/// HTTP transport (real `curl`, or a fake in tests).
pub trait Transport: Send + Sync {
    fn get(&self, path: &str) -> Result<String, AiError>;
    fn post(&self, path: &str, body: &[u8], cancel: &AtomicBool) -> Result<String, AiError>;
}

pub struct Curl;

impl Curl {
    fn run(args: &[&str], body: Option<&[u8]>, cancel: Option<&AtomicBool>, timeout: Duration) -> Result<String, AiError> {
        let mut child = Command::new("/usr/bin/curl")
            .args(["-sS", "--max-time", &timeout.as_secs().to_string()])
            .args(args)
            .stdin(if body.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AiError::Unavailable { detail: format!("couldn't run curl: {e}") })?;
        if let (Some(body), Some(mut stdin)) = (body, child.stdin.take()) {
            let body = body.to_vec();
            std::thread::spawn(move || {
                let _ = stdin.write_all(&body);
            });
        }
        let mut stdout = child.stdout.take().unwrap();
        let reader = std::thread::spawn(move || {
            let mut out = Vec::new();
            let _ = stdout.read_to_end(&mut out);
            out
        });
        let started = Instant::now();
        let status = loop {
            if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AiError::Cancelled);
            }
            if let Some(s) = child.try_wait().map_err(|e| AiError::Unavailable { detail: e.to_string() })? {
                break s;
            }
            if started.elapsed() > timeout + Duration::from_secs(2) {
                let _ = child.kill();
                return Err(AiError::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(40));
        };
        let out = reader.join().unwrap_or_default();
        if !status.success() {
            let mut err = String::new();
            if let Some(mut e) = child.stderr.take() {
                let _ = e.read_to_string(&mut err);
            }
            return Err(match status.code() {
                Some(28) => AiError::TimedOut,
                _ => AiError::Unavailable { detail: err.trim().chars().take(160).collect::<String>() },
            });
        }
        String::from_utf8(out).map_err(|e| AiError::BadResponse { detail: e.to_string() })
    }
}

impl Transport for Curl {
    fn get(&self, path: &str) -> Result<String, AiError> {
        Curl::run(&[&format!("{OLLAMA}{path}")], None, None, Duration::from_secs(3))
    }
    fn post(&self, path: &str, body: &[u8], cancel: &AtomicBool) -> Result<String, AiError> {
        Curl::run(&["-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", &format!("{OLLAMA}{path}")], Some(body), Some(cancel), CHAT_TIMEOUT)
    }
}

/// Installed models and which one `wanted` ("auto" or a name) resolves to.
pub fn status(t: &dyn Transport, wanted: &str) -> AiStatus {
    let provider = "Ollama (local, on this Mac)".to_string();
    let body = match t.get("/api/tags") {
        Ok(b) => b,
        Err(e) => return AiStatus { available: false, provider, models: vec![], model: None, reason: Some(e.message()) },
    };
    let models: Vec<ModelInfo> = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("models").cloned())
        .and_then(|m| m.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let name = m.get("name")?.as_str()?.to_string();
            let vision = m.get("capabilities").and_then(|c| c.as_array()).is_some_and(|c| c.iter().any(|x| x == "vision"));
            Some(ModelInfo { name, vision })
        })
        .collect();
    if models.is_empty() {
        return AiStatus { available: false, provider, models, model: None, reason: Some("Ollama is running but has no models. Run `ollama pull qwen3.5:4b`.".into()) };
    }
    let model = pick_model(&models, wanted, false);
    AiStatus { available: true, provider, models, model, reason: None }
}

/// Choose a model: the requested one if installed (and able to see, when `vision`), else the
/// preferred list, else the first suitable model.
pub fn pick_model(models: &[ModelInfo], wanted: &str, vision: bool) -> Option<String> {
    let ok = |m: &&ModelInfo| !vision || m.vision;
    if wanted != "auto" {
        if let Some(m) = models.iter().filter(ok).find(|m| m.name == wanted) {
            return Some(m.name.clone());
        }
    }
    PREFERRED
        .iter()
        .find_map(|p| models.iter().filter(ok).find(|m| m.name == *p))
        .or_else(|| models.iter().find(ok))
        .map(|m| m.name.clone())
}

/// Standard base64 (for the image field).
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

/// Build the Ollama `/api/chat` request. Only the last 12 messages are sent; the image (if any)
/// is attached to the final user message only.
/// Instruction and token budget for an answer-length setting ("short", "medium", "long").
pub fn length_budget(length: &str) -> (&'static str, u32) {
    match length {
        "short" => ("Answer in 1-2 short sentences.", 160),
        "long" => ("Answer thoroughly; short paragraphs or lists are fine.", 1500),
        _ => ("Keep answers to a few sentences.", 512),
    }
}

pub fn build_request(model: &str, history: &[ChatMessage], image_png: Option<&[u8]>) -> serde_json::Value {
    build_request_with(model, history, image_png, "medium")
}

pub fn build_request_with(model: &str, history: &[ChatMessage], image_png: Option<&[u8]>, length: &str) -> serde_json::Value {
    build_request_styled(model, history, image_png, length, &Style::default())
}

pub fn build_request_styled(model: &str, history: &[ChatMessage], image_png: Option<&[u8]>, length: &str, style: &Style) -> serde_json::Value {
    let (instruction, budget) = length_budget(length);
    let mut messages = vec![serde_json::json!({ "role": "system", "content": format!("{PERSONA} {} {instruction}", style_note(style)) })];
    if image_png.is_some() {
        messages.push(serde_json::json!({ "role": "system", "content": SCREEN_NOTE }));
    }
    let start = history.len().saturating_sub(12);
    let last = history.len().saturating_sub(1);
    for (i, m) in history.iter().enumerate().skip(start) {
        let role = if m.role == "assistant" { "assistant" } else { "user" };
        let mut msg = serde_json::json!({ "role": role, "content": m.content.chars().take(4000).collect::<String>() });
        if i == last && role == "user" {
            if let Some(png) = image_png {
                msg["images"] = serde_json::json!([base64(png)]);
            }
        }
        messages.push(msg);
    }
    serde_json::json!({ "model": model, "messages": messages, "stream": false, "think": false, "options": { "num_predict": budget } })
}

/// Pull the answer text out of an Ollama response (drops any `<think>` block).
pub fn parse_answer(body: &str) -> Result<String, AiError> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| AiError::BadResponse { detail: e.to_string() })?;
    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        return Err(AiError::Unavailable { detail: err.chars().take(200).collect() });
    }
    let text = v.pointer("/message/content").and_then(|c| c.as_str()).ok_or(AiError::BadResponse { detail: "no message".into() })?;
    let text = match (text.find("<think>"), text.find("</think>")) {
        (Some(a), Some(b)) if b > a => format!("{}{}", &text[..a], &text[b + 8..]),
        _ => text.to_string(),
    };
    let text = text.trim().to_string();
    if text.is_empty() { Err(AiError::BadResponse { detail: "empty answer".into() }) } else { Ok(text) }
}

/// Ask the local model. `image_png` is borrowed: the caller owns (and drops) the screenshot.
pub fn ask(t: &dyn Transport, wanted_model: &str, history: &[ChatMessage], image_png: Option<&[u8]>, cancel: &AtomicBool) -> Result<String, AiError> {
    ask_with(t, wanted_model, history, image_png, cancel, "medium")
}

/// `ask` with an answer-length setting.
pub fn ask_with(t: &dyn Transport, wanted_model: &str, history: &[ChatMessage], image_png: Option<&[u8]>, cancel: &AtomicBool, length: &str) -> Result<String, AiError> {
    ask_styled(t, wanted_model, history, image_png, cancel, length, &Style::default())
}

/// `ask_with` in the companion's personality (intensity and affection); emojis are stripped.
pub fn ask_styled(
    t: &dyn Transport,
    wanted_model: &str,
    history: &[ChatMessage],
    image_png: Option<&[u8]>,
    cancel: &AtomicBool,
    length: &str,
    style: &Style,
) -> Result<String, AiError> {
    let st = status(t, wanted_model);
    if !st.available {
        return Err(AiError::Unavailable { detail: st.reason.unwrap_or_else(|| "not running".into()) });
    }
    let model = pick_model(&st.models, wanted_model, image_png.is_some()).ok_or(AiError::NoVisionModel)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(AiError::Cancelled);
    }
    let body = serde_json::to_vec(&build_request_styled(&model, history, image_png, length, style)).map_err(|e| AiError::BadResponse { detail: e.to_string() })?;
    let answer = strip_emoji(&parse_answer(&t.post("/api/chat", &body, cancel)?)?);
    if answer.is_empty() {
        return Err(AiError::BadResponse { detail: "empty answer".into() });
    }
    Ok(answer)
}

/// Map a request onto one of the app's actions (given as "id: description" lines) with the local
/// model in JSON mode. Returns the model's JSON object text (validated by the caller against the
/// same catalog); nothing is executed here.
pub fn classify(t: &dyn Transport, wanted_model: &str, request: &str, catalog: &str, cancel: &AtomicBool) -> Result<String, AiError> {
    let st = status(t, wanted_model);
    if !st.available {
        return Err(AiError::Unavailable { detail: st.reason.unwrap_or_else(|| "not running".into()) });
    }
    let model = pick_model(&st.models, wanted_model, false).ok_or(AiError::Unavailable { detail: "no model installed".into() })?;
    let body = serde_json::to_vec(&build_classify_request(&model, request, catalog)).map_err(|e| AiError::BadResponse { detail: e.to_string() })?;
    let v: serde_json::Value = serde_json::from_str(&t.post("/api/chat", &body, cancel)?).map_err(|e| AiError::BadResponse { detail: e.to_string() })?;
    let text = v.pointer("/message/content").and_then(|c| c.as_str()).ok_or(AiError::BadResponse { detail: "no message".into() })?;
    // Must be a JSON object; anything else is treated as "no action".
    let parsed: serde_json::Value = serde_json::from_str(text.trim()).map_err(|e| AiError::BadResponse { detail: e.to_string() })?;
    if !parsed.is_object() {
        return Err(AiError::BadResponse { detail: "not an object".into() });
    }
    Ok(parsed.to_string())
}

pub fn build_classify_request(model: &str, request: &str, catalog: &str) -> serde_json::Value {
    let system = format!(
        "You route requests for a desktop companion app. Decide whether the user's message asks the app to do one of these \
actions. Reply with JSON only: {{\"action\": \"<id or none>\", \"args\": {{...}}, \"question\": \"<short clarifying question, only \
if the action is clearly wanted but an argument cannot be guessed>\"}}. Use \"none\" for ordinary questions or chat. \
Actions:\n{}",
        catalog.chars().take(6000).collect::<String>()
    );
    serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": request.chars().take(500).collect::<String>() }
        ],
        "stream": false,
        "think": false,
        "format": "json",
        "options": { "num_predict": 160, "temperature": 0 }
    })
}

/// Cancellation flags for in-flight requests, by request id.
#[derive(Default)]
pub struct Requests(std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>);

impl Requests {
    pub fn start(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.0.lock().unwrap().insert(id.to_string(), flag.clone());
        flag
    }
    pub fn cancel(&self, id: &str) -> bool {
        self.0.lock().unwrap().get(id).map(|f| f.store(true, Ordering::Relaxed)).is_some()
    }
    pub fn cancel_all(&self) {
        for f in self.0.lock().unwrap().values() {
            f.store(true, Ordering::Relaxed);
        }
    }
    pub fn finish(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

#[cfg(test)]
mod persona_tests {
    use super::*;

    #[test]
    fn persona_varies_with_intensity_and_affection() {
        let subtle = style_note(&Style { intensity: "subtle".into(), affection: 10.0, ..Style::default() });
        let strong = style_note(&Style { intensity: "strong".into(), affection: 95.0, ..Style::default() });
        assert!(style_note(&Style { character: "princess".into(), ..Style::default() }).contains("Avery"));
        assert!(style_note(&Style { character: "zoologist".into(), ..Style::default() }).contains("Research Analyst"));
        assert!(style_note(&Style { character: "goblin".into(), ..Style::default() }).contains("Engineering Lead"));
        assert!(subtle.contains("formal"));
        assert!(strong.contains("professional") && !strong.contains("Master"));
        assert_eq!(tier(19.9), "shy");
        assert_eq!(tier(45.0), "close");
        assert_eq!(tier(90.0), "devoted");
        let req = build_request_styled("m", &[ChatMessage { role: "user".into(), content: "hi".into() }], None, "short", &Style::default());
        let sys = req["messages"][0]["content"].as_str().unwrap();
        assert!(sys.contains("strictly professional") && sys.contains("Do not use emojis"));
    }

    #[test]
    fn emojis_are_stripped() {
        assert_eq!(strip_emoji("Yay \u{1F496} you did it! \u{2728}"), "Yay you did it!");
        assert_eq!(strip_emoji("E-eh? 3 < 4, Master."), "E-eh? 3 < 4, Master.");
    }

    #[test]
    fn classify_request_is_json_mode_with_catalog() {
        let r = build_classify_request("m", "turn on roam", "mode.roam: switch to roam mode");
        assert_eq!(r["format"], "json");
        assert!(r["messages"][0]["content"].as_str().unwrap().contains("mode.roam"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Fake {
        tags: Result<String, AiError>,
        reply: Result<String, AiError>,
        posted: Mutex<Vec<serde_json::Value>>,
    }

    impl Transport for Fake {
        fn get(&self, _: &str) -> Result<String, AiError> {
            self.tags.clone()
        }
        fn post(&self, _: &str, body: &[u8], cancel: &AtomicBool) -> Result<String, AiError> {
            self.posted.lock().unwrap().push(serde_json::from_slice(body).unwrap());
            if cancel.load(Ordering::Relaxed) {
                return Err(AiError::Cancelled);
            }
            self.reply.clone()
        }
    }

    const TAGS: &str = r#"{"models":[{"name":"textonly:1b","capabilities":["completion"]},{"name":"ministral-3:3b","capabilities":["completion","vision"]}]}"#;

    fn fake(reply: Result<String, AiError>) -> Fake {
        Fake { tags: Ok(TAGS.into()), reply, posted: Mutex::new(vec![]) }
    }

    fn user(text: &str) -> Vec<ChatMessage> {
        vec![ChatMessage { role: "user".into(), content: text.into() }]
    }

    #[test]
    fn answers_general_questions_without_any_image() {
        let t = fake(Ok(r#"{"message":{"role":"assistant","content":"<think>hm</think> You've got this!"}}"#.into()));
        let ans = ask(&t, "auto", &user("hi"), None, &AtomicBool::new(false)).unwrap();
        assert_eq!(ans, "You've got this!");
        let req = &t.posted.lock().unwrap()[0];
        assert_eq!(req["model"], "ministral-3:3b"); // preferred list
        assert!(req["messages"].as_array().unwrap().iter().all(|m| m.get("images").is_none()));
        assert_eq!(req["stream"], false);
    }

    #[test]
    fn screen_questions_attach_the_image_to_the_last_user_message_only() {
        let t = fake(Ok(r#"{"message":{"content":"I see a code editor."}}"#.into()));
        let mut hist = user("earlier");
        hist.push(ChatMessage { role: "assistant".into(), content: "ok".into() });
        hist.extend(user("what's on my screen?"));
        ask(&t, "textonly:1b", &hist, Some(&[1, 2, 3]), &AtomicBool::new(false)).unwrap();
        let req = &t.posted.lock().unwrap()[0];
        assert_eq!(req["model"], "ministral-3:3b"); // the text-only choice can't see, so a vision model is used
        let msgs = req["messages"].as_array().unwrap();
        let with_images: Vec<_> = msgs.iter().filter(|m| m.get("images").is_some()).collect();
        assert_eq!(with_images.len(), 1);
        assert_eq!(with_images[0]["content"], "what's on my screen?");
        assert_eq!(with_images[0]["images"][0], "AQID");
    }

    #[test]
    fn missing_provider_is_reported_not_faked() {
        let t = Fake { tags: Err(AiError::Unavailable { detail: "connection refused".into() }), reply: Ok("{}".into()), posted: Mutex::new(vec![]) };
        let st = status(&t, "auto");
        assert!(!st.available && st.reason.unwrap().contains("connection refused"));
        assert!(matches!(ask(&t, "auto", &user("hi"), None, &AtomicBool::new(false)), Err(AiError::Unavailable { .. })));
        assert!(t.posted.lock().unwrap().is_empty());
        let empty = Fake { tags: Ok(r#"{"models":[]}"#.into()), reply: Ok("{}".into()), posted: Mutex::new(vec![]) };
        assert!(!status(&empty, "auto").available);
    }

    #[test]
    fn no_vision_model_means_no_screen_request() {
        let t = Fake { tags: Ok(r#"{"models":[{"name":"t:1b","capabilities":["completion"]}]}"#.into()), reply: Ok("{}".into()), posted: Mutex::new(vec![]) };
        assert_eq!(ask(&t, "auto", &user("screen?"), Some(&[1]), &AtomicBool::new(false)), Err(AiError::NoVisionModel));
        assert!(t.posted.lock().unwrap().is_empty());
    }

    #[test]
    fn cancellation_and_bad_responses() {
        let t = fake(Ok("{}".into()));
        assert_eq!(ask(&t, "auto", &user("hi"), None, &AtomicBool::new(true)), Err(AiError::Cancelled));
        assert!(matches!(parse_answer("not json"), Err(AiError::BadResponse { .. })));
        assert!(matches!(parse_answer(r#"{"error":"model not found"}"#), Err(AiError::Unavailable { .. })));
        assert!(matches!(parse_answer(r#"{"message":{"content":"  "}}"#), Err(AiError::BadResponse { .. })));
        let reqs = Requests::default();
        let flag = reqs.start("a");
        assert!(reqs.cancel("a") && flag.load(Ordering::Relaxed));
        reqs.finish("a");
        assert!(!reqs.cancel("a"));
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn history_is_trimmed() {
        let hist: Vec<ChatMessage> = (0..30).map(|i| ChatMessage { role: "user".into(), content: format!("m{i}") }).collect();
        let req = build_request("m", &hist, None);
        assert_eq!(req["messages"].as_array().unwrap().len(), 1 + 12);
    }

    #[test]
    fn answer_length_sets_the_instruction_and_token_budget() {
        let h = user("hi");
        let short = build_request_with("m", &h, None, "short");
        let long = build_request_with("m", &h, None, "long");
        assert_eq!(short["options"]["num_predict"], 160);
        assert_eq!(long["options"]["num_predict"], 1500);
        assert!(short["messages"][0]["content"].as_str().unwrap().contains("1-2 short sentences"));
        assert_eq!(build_request("m", &h, None)["options"]["num_predict"], 512);
        assert_eq!(build_request_with("m", &h, None, "bogus")["options"]["num_predict"], 512);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Manual check against a running local Ollama: `cargo test --lib live_ollama -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_ollama_persona_and_routing() {
        let cancel = AtomicBool::new(false);
        let q = |text: &str| vec![ChatMessage { role: "user".into(), content: text.into() }];
        for (intensity, affection, question) in [("normal", 55.0, "How do I get a pickaxe in Terraria?"), ("strong", 92.0, "I finished my homework!"), ("subtle", 10.0, "What's 17 times 23?")] {
            let style = Style { intensity: intensity.into(), affection, ..Style::default() };
            let a = ask_styled(&Curl, "auto", &q(question), None, &cancel, "short", &style).unwrap();
            println!("[{intensity}/{}] {question}\n  -> {a}\n", tier(affection));
            assert!(!a.chars().any(|c| (c as u32) >= 0x1F000));
        }
        let catalog = "mode.roam: Roam mode: the companion walks around\nmode.stay: Stay Put mode: she stops moving\npetals.off: turn falling petals off\ncontrol.on: start Control mode\nscheme.silksong: switch to Silksong controls";
        for req in ["could you make the little pink flower things stop falling", "I want to drive her around myself", "let her go explore by herself", "what is the capital of Japan?"] {
            println!("classify: {req}\n  -> {}", classify(&Curl, "auto", req, catalog, &cancel).unwrap_or_else(|e| e.message()));
        }
    }
}

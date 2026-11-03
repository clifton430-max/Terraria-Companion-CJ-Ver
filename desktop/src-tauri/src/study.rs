//! Study help: the companion as a personal tutor for the question you point at.
//!
//! * **Looking:** you drag a box around the question; that part of the screen is captured (after
//!   the same privacy checks as "Ask about my screen") at full resolution, its text and where each
//!   line is are read with Apple's Vision framework on this Mac (the bundled `ocr-helper`), and the
//!   pixels are dropped. Nothing is written to disk.
//! * **Thinking:** the text goes to the local model, which answers in a fixed JSON shape (the kind
//!   of question, the best answer, what every option means, the concepts, short explanation
//!   steps, where drag-and-drop items belong, ideas and an outline for writing, or feedback on
//!   your own writing). The frontend turns that into the chalkboard lesson.
//! * **Gemini:** for a hard question you can hand it to Gemini: the prompt is copied to the
//!   clipboard and gemini.google.com opens in your browser (shown as external help on the board).
//! * She never clicks, types or drags anything in your work; demonstrations are animations only.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

const OCR_HELPER: &str = "ocr-helper";
const OCR_TIMEOUT: Duration = Duration::from_secs(20);
/// Most text sent to the model from one question.
pub const MAX_TEXT: usize = 6000;

/// A line of text on screen, in global display points (top-left origin).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Deserialize)]
struct OcrLine {
    text: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// The helper's normalized boxes (0..1 within the captured region) → global points, top to bottom.
pub fn place_lines(json: &str, region: (f64, f64, f64, f64)) -> Vec<Line> {
    let (rx, ry, rw, rh) = region;
    let mut lines: Vec<Line> = serde_json::from_str::<Vec<OcrLine>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter(|l| !l.text.trim().is_empty() && [l.x, l.y, l.w, l.h].iter().all(|v| v.is_finite()))
        .map(|l| Line { text: l.text.trim().chars().take(400).collect(), x: rx + l.x * rw, y: ry + l.y * rh, w: l.w * rw, h: l.h * rh })
        .collect();
    lines.sort_by(|a, b| (a.y, a.x).partial_cmp(&(b.y, b.x)).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

fn helper_path() -> Option<PathBuf> {
    let beside = std::env::current_exe().ok()?.parent()?.join(OCR_HELPER);
    if beside.exists() {
        return Some(beside);
    }
    let triple = if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" };
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(format!("{OCR_HELPER}-{triple}"));
    dev.exists().then_some(dev)
}

/// Read the text in a PNG with the bundled helper (Apple Vision, on this Mac).
pub fn read_text(png: &[u8]) -> Result<String, String> {
    let path = helper_path().ok_or("the text-recognition helper is missing from this build")?;
    let mut child = Command::new(path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(png).map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let mut out = String::new();
                child.stdout.take().map(|mut s| s.read_to_string(&mut out));
                if !status.success() {
                    let mut err = String::new();
                    child.stderr.take().map(|mut s| s.read_to_string(&mut err));
                    return Err(format!("text recognition failed ({})", err.trim()));
                }
                return Ok(out);
            }
            None if start.elapsed() > OCR_TIMEOUT => {
                let _ = child.kill();
                return Err("text recognition took too long".into());
            }
            None => std::thread::sleep(Duration::from_millis(30)),
        }
    }
}

/// What the tutor is asked to do with the question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Task {
    /// Teach this question.
    Teach,
    /// Give feedback on the user's own writing in the box (never rewrite it).
    Review,
    /// Explain it again, more simply.
    Simpler,
}

const SYSTEM: &str = "You are a kind, encouraging personal tutor. The student points at a homework question on their screen; its text (read from the screen, so it may contain small reading errors) is below. Teach it so they understand and can do it themselves. Reply with JSON only, no other text, in exactly this shape:
{\"kind\": \"multiple_choice\" | \"writing\" | \"drag_drop\" | \"other\",
 \"question\": \"the question in one short sentence\",
 \"answer\": \"the best answer in a few words (for multiple choice: the option label and its text; for drag and drop: a one-line summary; for writing: empty)\",
 \"answerLabel\": \"the best option's label exactly as written (A, B, 1, a...) or empty\",
 \"options\": [{\"label\": \"A\", \"text\": \"the option text\", \"meaning\": \"what this option means and why it is or isn't the best fit, one sentence\"}],
 \"concepts\": [\"each key idea the question tests, a few words each\"],
 \"steps\": [\"the reasoning in 3 to 6 short steps, under 22 words each, simple words\"],
 \"pairs\": [{\"item\": \"text of an item to drag, exactly as written\", \"target\": \"text of where it belongs, exactly as written\", \"why\": \"one short reason\"}],
 \"brainstorm\": [\"for writing: ideas to write about\"],
 \"outline\": [\"for writing: a short outline, one point per entry\"],
 \"feedback\": [\"only when reviewing the student's own writing: what works and what to improve, specific and kind\"],
 \"hard\": true or false,
 \"cheer\": \"one short, cute, encouraging line\"}
Leave out fields that don't apply (use empty lists). Never write an essay or paragraph answer for the student: for writing, help them brainstorm, outline and understand; when reviewing, give feedback on their writing and do not rewrite it.";

/// The messages for one lesson.
pub fn lesson_prompt(text: &str, task: Task) -> Vec<crate::ai::ChatMessage> {
    let ask = match task {
        Task::Teach => "Teach this question.",
        Task::Review => "This box contains the question and the student's own writing. Review their writing: what works, what to improve. Do not rewrite it.",
        Task::Simpler => "Explain this question again, more simply, with an everyday example in the steps.",
    };
    let clipped: String = text.chars().take(MAX_TEXT).collect();
    vec![
        crate::ai::ChatMessage { role: "system".into(), content: SYSTEM.into() },
        crate::ai::ChatMessage { role: "user".into(), content: format!("{ask}\n\nText on screen:\n{clipped}") },
    ]
}

/// The request body (JSON mode, no thinking, room for the whole lesson).
pub fn lesson_request(model: &str, messages: &[crate::ai::ChatMessage]) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": messages.iter().map(|m| serde_json::json!({ "role": m.role, "content": m.content })).collect::<Vec<_>>(),
        "stream": false,
        "think": false,
        "format": "json",
        "options": { "num_predict": 1400, "temperature": 0.2 }
    })
}

/// Ask the local model for a lesson; returns its JSON text (the frontend validates it).
pub fn ask_lesson(t: &dyn crate::ai::Transport, wanted: &str, text: &str, task: Task, cancel: &AtomicBool) -> Result<String, crate::ai::AiError> {
    let st = crate::ai::status(t, wanted);
    if !st.available {
        return Err(crate::ai::AiError::Unavailable { detail: st.reason.unwrap_or_else(|| "not running".into()) });
    }
    let model = crate::ai::pick_model(&st.models, wanted, false).ok_or(crate::ai::AiError::Unavailable { detail: "no model installed".into() })?;
    let body = serde_json::to_vec(&lesson_request(&model, &lesson_prompt(text, task))).map_err(|e| crate::ai::AiError::BadResponse { detail: e.to_string() })?;
    crate::ai::parse_answer(&t.post("/api/chat", &body, cancel)?)
}

/// The prompt handed to Gemini for a hard question (copied to the clipboard).
pub fn gemini_prompt(text: &str) -> String {
    let clipped: String = text.chars().take(MAX_TEXT).collect();
    format!("Please help me understand this homework question. Explain the concepts and the reasoning step by step so I can work it out myself:\n\n{clipped}")
}

/// Put text on the clipboard (pbcopy).
pub fn copy(text: &str) -> bool {
    let Ok(mut child) = Command::new("/usr/bin/pbcopy").stdin(Stdio::piped()).spawn() else { return false };
    let ok = child.stdin.take().map(|mut s| s.write_all(text.as_bytes()).is_ok()).unwrap_or(false);
    ok && child.wait().map(|s| s.success()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_recognized_lines_on_screen_top_to_bottom() {
        let json = r#"[{"text":"B) Paris","x":0.1,"y":0.6,"w":0.3,"h":0.1,"confidence":1},{"text":"Capital of France?","x":0.0,"y":0.1,"w":0.8,"h":0.1,"confidence":1},{"text":"  ","x":0,"y":0,"w":0,"h":0}]"#;
        let lines = place_lines(json, (100.0, 200.0, 400.0, 300.0));
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "Capital of France?");
        assert_eq!(lines[1], Line { text: "B) Paris".into(), x: 140.0, y: 380.0, w: 120.0, h: 30.0 });
        assert!(place_lines("not json", (0.0, 0.0, 1.0, 1.0)).is_empty());
    }

    #[test]
    fn asks_for_json_and_never_for_a_finished_essay() {
        let m = lesson_prompt("Write an essay about rivers.", Task::Teach);
        assert!(m[0].content.contains("JSON only"));
        assert!(m[0].content.contains("Never write an essay"));
        assert!(m[1].content.contains("rivers"));
        let r = lesson_request("qwen", &m);
        assert_eq!(r["format"], "json");
        assert_eq!(r["stream"], false);
        let review = lesson_prompt("x", Task::Review);
        assert!(review[1].content.contains("Do not rewrite"));
    }

    #[test]
    fn clips_long_text() {
        let long = "a".repeat(MAX_TEXT * 2);
        assert!(lesson_prompt(&long, Task::Teach)[1].content.len() < MAX_TEXT + 200);
        assert!(gemini_prompt(&long).len() < MAX_TEXT + 300);
    }
}

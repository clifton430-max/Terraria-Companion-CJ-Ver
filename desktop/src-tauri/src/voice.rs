//! Push-to-talk support: converting the saved shortcut for the global-shortcut plugin, and running
//! the bundled speech helper (Apple Speech framework) on a recording held in memory. The recording
//! is piped to the helper's stdin and never written to disk.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const VOICE_KEY_EVENT: &str = "companion://voice-key";
const HELPER: &str = "speech-helper";
const TIMEOUT: Duration = Duration::from_secs(45);
/// Recordings larger than this (≈ 60 s at 16 kHz mono) are refused.
pub const MAX_AUDIO_BYTES: usize = 2_000_000;

/// "Control+Shift+Space" (settings format) → "Control+Shift+Space" in the plugin's syntax
/// ("Option" → "Alt", "Command" → "Super", "K" → "KeyK", "7" → "Digit7").
pub fn to_plugin_accelerator(s: &str) -> Option<String> {
    if !crate::prefs::valid_shortcut(s) {
        return None;
    }
    let parts: Vec<&str> = s.split('+').collect();
    let (key, mods) = parts.split_last()?;
    let mut out: Vec<String> = mods
        .iter()
        .map(|m| match *m {
            "Option" => "Alt".to_string(),
            "Command" => "Super".to_string(),
            other => other.to_string(),
        })
        .collect();
    let k = if key.len() == 1 && key.chars().all(|c| c.is_ascii_uppercase()) {
        format!("Key{key}")
    } else if key.len() == 1 && key.chars().all(|c| c.is_ascii_digit()) {
        format!("Digit{key}")
    } else {
        key.to_string()
    };
    out.push(k);
    Some(out.join("+"))
}

/// Standard base64 decoding (the WebView sends the recording as base64 text).
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    };
    let clean: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if clean.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        let pad = chunk.iter().rev().take_while(|&&b| b == b'=').count();
        if pad > 2 {
            return None;
        }
        let mut n = 0u32;
        for (i, &b) in chunk.iter().enumerate() {
            let v = if b == b'=' && i >= 4 - pad { 0 } else { val(b)? };
            n = n << 6 | v;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    #[serde(default)]
    pub on_device: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceFailure {
    /// "denied", "restricted", "unavailable", "nospeech", "badaudio", "timeout", "helper".
    pub kind: String,
    pub message: String,
}

fn failure(kind: &str, message: impl Into<String>) -> VoiceFailure {
    VoiceFailure { kind: kind.into(), message: message.into() }
}

/// Interpret the helper's one-line JSON output.
pub fn parse_helper_output(out: &str) -> Result<Transcript, VoiceFailure> {
    let v: serde_json::Value = serde_json::from_str(out.trim()).map_err(|_| failure("helper", "The speech helper gave an unreadable answer."))?;
    if let Some(kind) = v.get("error").and_then(|e| e.as_str()) {
        let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("Speech recognition failed.");
        return Err(failure(kind, msg.chars().take(300).collect::<String>()));
    }
    serde_json::from_value::<Transcript>(v).map_err(|_| failure("helper", "The speech helper gave an unexpected answer."))
}

/// The bundled helper: next to the app executable in a build, or in `src-tauri/bin` during dev.
pub fn helper_path() -> Option<PathBuf> {
    let beside = std::env::current_exe().ok()?.parent()?.join(HELPER);
    if beside.is_file() {
        return Some(beside);
    }
    let triple = if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" };
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(format!("{HELPER}-{triple}"));
    dev.is_file().then_some(dev)
}

/// Transcribe a WAV recording (bytes stay in memory and are dropped afterwards).
pub fn transcribe(wav: &[u8], locale: Option<&str>) -> Result<Transcript, VoiceFailure> {
    if wav.len() > MAX_AUDIO_BYTES {
        return Err(failure("badaudio", "The recording was too long."));
    }
    let path = helper_path().ok_or_else(|| failure("helper", "The speech helper isn't installed with this build."))?;
    let mut cmd = Command::new(path);
    if let Some(l) = locale.filter(|l| l.len() <= 20 && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) {
        cmd.arg(l);
    }
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| failure("helper", format!("Couldn't start the speech helper: {e}")))?;
    let mut stdin = child.stdin.take().unwrap();
    let audio = wav.to_vec();
    std::thread::spawn(move || {
        let _ = stdin.write_all(&audio);
    });
    let mut stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| failure("helper", e.to_string()))?.is_some() {
            break;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            return Err(failure("timeout", "Transcription took too long."));
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    parse_helper_output(&reader.join().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn converts_saved_shortcuts_to_plugin_accelerators_that_parse() {
        assert_eq!(to_plugin_accelerator("Control+Shift+Space").as_deref(), Some("Control+Shift+Space"));
        assert_eq!(to_plugin_accelerator("Option+Command+K").as_deref(), Some("Alt+Super+KeyK"));
        assert_eq!(to_plugin_accelerator("Control+7").as_deref(), Some("Control+Digit7"));
        for s in ["Control+Shift+Space", "Option+Command+K", "Control+7", "Command+Shift+F5", "Control+Option+Backquote"] {
            let accel = to_plugin_accelerator(s).unwrap();
            assert!(Shortcut::from_str(&accel).is_ok(), "{s} → {accel}");
        }
        assert_eq!(to_plugin_accelerator("Shift+K"), None);
        assert_eq!(to_plugin_accelerator("nonsense"), None);
    }

    #[test]
    fn base64_round_trips() {
        for data in [&b""[..], b"f", b"fo", b"foo", b"RIFF\x00\x01\xff"] {
            assert_eq!(base64_decode(&crate::ai::base64(data)).unwrap(), data);
        }
        assert!(base64_decode("abc").is_none());
        assert!(base64_decode("a$==").is_none());
    }

    #[test]
    fn parses_helper_results_and_errors() {
        assert_eq!(parse_helper_output(r#"{"text":"how do I mine","onDevice":true}"#).unwrap(), Transcript { text: "how do I mine".into(), on_device: true });
        let denied = parse_helper_output(r#"{"error":"denied","message":"Speech Recognition is turned off."}"#).unwrap_err();
        assert_eq!(denied.kind, "denied");
        assert_eq!(parse_helper_output("garbage").unwrap_err().kind, "helper");
        assert_eq!(parse_helper_output("{}").unwrap_err().kind, "helper");
    }

    #[test]
    fn oversized_recordings_are_refused_before_running_anything() {
        assert_eq!(transcribe(&vec![0u8; MAX_AUDIO_BYTES + 1], None).unwrap_err().kind, "badaudio");
    }

    #[test]
    fn the_built_helper_rejects_non_wav_input_without_asking_for_permission() {
        // Only when the helper has been built (helpers/build.sh); bad audio is refused before any
        // permission request, so this never triggers a system prompt.
        if helper_path().is_none() {
            return;
        }
        assert_eq!(transcribe(b"definitely not audio", None).unwrap_err().kind, "badaudio");
    }
}

//! What may be written to the saved chat history: nothing unless the user keeps history, and
//! screenshot previews only if they also keep screenshots. Pure, so the rules are unit-tested.

use serde::{Deserialize, Serialize};

pub const MAX_STORED_MESSAGES: usize = 200;
const MAX_CONTENT: usize = 8000;
const MAX_THUMB: usize = 400_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub screen: bool,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

/// The messages to save, or `None` meaning "delete any saved history".
pub fn to_store(messages: &[StoredMessage], keep_history: bool, keep_screenshots: bool) -> Option<Vec<StoredMessage>> {
    if !keep_history {
        return None;
    }
    let start = messages.len().saturating_sub(MAX_STORED_MESSAGES);
    Some(
        messages[start..]
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| StoredMessage {
                role: m.role.clone(),
                content: m.content.chars().take(MAX_CONTENT).collect(),
                screen: m.screen,
                thumbnail: if keep_screenshots {
                    m.thumbnail.clone().filter(|t| t.starts_with("data:image/png;base64,") && t.len() < MAX_THUMB)
                } else {
                    None
                },
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, thumb: Option<&str>) -> StoredMessage {
        StoredMessage { role: role.into(), content: "hi".into(), screen: thumb.is_some(), thumbnail: thumb.map(String::from) }
    }

    #[test]
    fn nothing_is_saved_unless_history_is_kept() {
        assert_eq!(to_store(&[msg("user", None)], false, true), None);
    }

    #[test]
    fn screenshots_are_never_retained_unless_explicitly_enabled() {
        let msgs = [msg("user", Some("data:image/png;base64,AAAA")), msg("assistant", None)];
        let saved = to_store(&msgs, true, false).unwrap();
        assert!(saved.iter().all(|m| m.thumbnail.is_none()));
        assert!(saved[0].screen); // the fact that it was a screen question is kept, the image isn't
        let kept = to_store(&msgs, true, true).unwrap();
        assert_eq!(kept[0].thumbnail.as_deref(), Some("data:image/png;base64,AAAA"));
    }

    #[test]
    fn only_png_data_urls_of_bounded_size_and_real_roles_are_saved() {
        let big = format!("data:image/png;base64,{}", "A".repeat(MAX_THUMB));
        let msgs = [msg("user", Some("https://example.com/x.png")), msg("user", Some(&big)), msg("system", None), msg("notice", None)];
        let saved = to_store(&msgs, true, true).unwrap();
        assert_eq!(saved.len(), 2);
        assert!(saved.iter().all(|m| m.thumbnail.is_none()));
        let many: Vec<_> = (0..500).map(|_| msg("user", None)).collect();
        assert_eq!(to_store(&many, true, false).unwrap().len(), MAX_STORED_MESSAGES);
    }
}

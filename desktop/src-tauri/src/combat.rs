//! Commands forwarded to the overlay's combat sandbox (from the tray or the inventory window).
//!
//! The combat simulation itself lives entirely in the overlay's TypeScript. Rust only relays
//! a small, validated set of commands; it never touches other applications.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CombatAction {
    /// Use the equipped weapon, optionally facing left (-1) or right (1).
    Attack,
    /// Restore every training dummy and clear projectiles, effects and minions.
    Reset,
    /// Remove all summoned minions, freeing their mana upkeep.
    Dismiss,
    /// Summon the Eye of Cthulhu (desktop simulation).
    SummonBoss,
    /// Send the boss away (whichever boss is fighting).
    DismissBoss,
    /// Summon the Moon Lord (desktop simulation).
    SummonMoonLord,
    /// Summon Queen Bee (desktop simulation).
    SummonQueenBee,
    /// Spawn a cookie near the companion, or put it away if one is out.
    ToggleCookie,
    /// Put the cookie away.
    DismissCookie,
    /// Spawn a cookie (no-op if one is already out).
    SpawnCookie,
    /// Affection signals from the chat window (the overlay owns the meter): a message was sent,
    /// it was kind, or it was rude.
    AffectionChat,
    AffectionKind,
    AffectionRude,
    /// Restart the boss fight (full health for both sides).
    RetryBoss,
    /// Play the synthetic letter-smash effect once (rate-limited in the overlay).
    LetterSmash,
    /// Immediately stop and clear every temporary visual effect.
    StopEffects,
    /// Summon the Eye of Cthulhu if none is fighting, otherwise dismiss it (dock button).
    ToggleBoss,
    /// Save the character's current spot as its Stay-Put favourite.
    SetFavoriteSpot,
    /// Walk/drop back to the saved favourite spot (and stay there).
    ReturnToFavorite,
    /// Open the local two-player chess board (companions cheer and move the pieces).
    OpenChess,
    /// Close the chess board; companions go back to what they were doing.
    CloseChess,
    /// Turn the chess board around (view it from the other side).
    FlipChess,
    /// Study help: draw a box around a question and she tutors you through it.
    StudyHelp,
    /// Show the numbered invisible platforms so the user can pick the companions' hangout.
    PickHangout,
    /// Explore the background world (handled in Rust: the world window takes the mouse).
    ExploreWorld,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CombatCommand {
    pub action: CombatAction,
    pub dir: Option<i8>,
}

/// Validate a command coming from the frontend. Unknown actions are rejected and
/// a direction other than -1/1 is dropped.
pub fn parse(action: &str, dir: Option<i8>) -> Option<CombatCommand> {
    let action = match action {
        "attack" => CombatAction::Attack,
        "reset" => CombatAction::Reset,
        "dismiss" => CombatAction::Dismiss,
        "summonBoss" => CombatAction::SummonBoss,
        "dismissBoss" => CombatAction::DismissBoss,
        "summonMoonLord" => CombatAction::SummonMoonLord,
        "toggleCookie" => CombatAction::ToggleCookie,
        "summonQueenBee" => CombatAction::SummonQueenBee,
        "dismissCookie" => CombatAction::DismissCookie,
        "spawnCookie" => CombatAction::SpawnCookie,
        "affectionChat" => CombatAction::AffectionChat,
        "affectionKind" => CombatAction::AffectionKind,
        "affectionRude" => CombatAction::AffectionRude,
        "retryBoss" => CombatAction::RetryBoss,
        "letterSmash" => CombatAction::LetterSmash,
        "stopEffects" => CombatAction::StopEffects,
        "toggleBoss" => CombatAction::ToggleBoss,
        "setFavoriteSpot" => CombatAction::SetFavoriteSpot,
        "returnToFavorite" => CombatAction::ReturnToFavorite,
        "openChess" => CombatAction::OpenChess,
        "closeChess" => CombatAction::CloseChess,
        "flipChess" => CombatAction::FlipChess,
        "studyHelp" => CombatAction::StudyHelp,
        "pickHangout" => CombatAction::PickHangout,
        "exploreWorld" => CombatAction::ExploreWorld,
        _ => return None,
    };
    let dir = dir.filter(|d| *d == -1 || *d == 1);
    Some(CombatCommand { action, dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_known_actions() {
        assert_eq!(
            parse("attack", Some(-1)),
            Some(CombatCommand { action: CombatAction::Attack, dir: Some(-1) })
        );
        assert_eq!(parse("reset", None).unwrap().action, CombatAction::Reset);
        assert_eq!(parse("dismiss", None).unwrap().action, CombatAction::Dismiss);
    }

    #[test]
    fn accepts_boss_and_effect_actions() {
        for (name, action) in [
            ("summonBoss", CombatAction::SummonBoss),
            ("dismissBoss", CombatAction::DismissBoss),
            ("summonMoonLord", CombatAction::SummonMoonLord),
            ("toggleCookie", CombatAction::ToggleCookie),
            ("summonQueenBee", CombatAction::SummonQueenBee),
            ("dismissCookie", CombatAction::DismissCookie),
            ("spawnCookie", CombatAction::SpawnCookie),
            ("affectionKind", CombatAction::AffectionKind),
            ("retryBoss", CombatAction::RetryBoss),
            ("letterSmash", CombatAction::LetterSmash),
            ("stopEffects", CombatAction::StopEffects),
            ("toggleBoss", CombatAction::ToggleBoss),
            ("setFavoriteSpot", CombatAction::SetFavoriteSpot),
            ("returnToFavorite", CombatAction::ReturnToFavorite),
            ("openChess", CombatAction::OpenChess),
            ("closeChess", CombatAction::CloseChess),
            ("flipChess", CombatAction::FlipChess),
            ("studyHelp", CombatAction::StudyHelp),
            ("pickHangout", CombatAction::PickHangout),
            ("exploreWorld", CombatAction::ExploreWorld),
        ] {
            assert_eq!(parse(name, None).unwrap().action, action);
        }
        let json = serde_json::to_string(&parse("summonBoss", None).unwrap()).unwrap();
        assert_eq!(json, r#"{"action":"summonBoss","dir":null}"#);
    }

    #[test]
    fn rejects_unknown_actions_and_bad_directions() {
        assert_eq!(parse("launch_missiles", None), None);
        assert_eq!(parse("", None), None);
        assert_eq!(parse("attack", Some(5)).unwrap().dir, None);
        assert_eq!(parse("attack", Some(0)).unwrap().dir, None);
    }

    #[test]
    fn serializes_for_the_frontend() {
        let json = serde_json::to_string(&parse("attack", Some(1)).unwrap()).unwrap();
        assert_eq!(json, r#"{"action":"attack","dir":1}"#);
    }
}

//! Companion skins: the user's own appearance ("default") or the 2B outfit from the installed
//! "Waifu 2B" resource pack, drawn by the same layered player renderer (the pack replaces three
//! vanilla armour sheets, so it maps onto the head/body/legs armour layers directly).

use super::packs::ArmorOverrides;
use super::player::{Appearance, AppearanceColors, ArmorSlots, HairUnderHelmet};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SkinId {
    /// The appearance from the Character tab.
    #[default]
    Default,
    /// 2B, from the "Waifu 2B" resource pack (falls back to Default if the pack is missing).
    Waifu2b,
}

impl SkinId {
    pub fn key(self) -> &'static str {
        match self {
            SkinId::Default => "default",
            SkinId::Waifu2b => "waifu2b",
        }
    }
}

/// The appearance used for 2B: a female body with pale skin, and the pack's armour sheets.
/// The pack's head sheet already contains 2B's white bob and headband, so the player's own hair
/// is hidden under it. Missing slots stay empty (the base body shows through) rather than failing.
pub fn waifu_2b_appearance(armor: &ArmorOverrides) -> Appearance {
    Appearance {
        skin_variant: 4,
        hair: 1,
        colors: AppearanceColors {
            skin: "#f3ddd0".into(),
            hair: "#e8e8e8".into(),
            eyes: "#3c4654".into(),
            shirt: "#202020".into(),
            undershirt: "#303030".into(),
            pants: "#1a1a1a".into(),
            shoes: "#141414".into(),
        },
        armor: ArmorSlots { head: armor.head.first().copied(), body: armor.body.first().copied(), legs: armor.legs.first().copied() },
        hair_under_helmet: HairUnderHelmet::Hide,
        accessories: Vec::new(),
    }
}

/// CJ Ver: each companion's suit, drawn from the game's own player sheets. Clothing variant 3
/// (men's coat) and 7 (women's coat) read as a suit jacket over a white shirt, tinted to each
/// person's colour; trousers match the jacket. "terrarian" (Morgan) is also the default
/// appearance in a new install, so it can still be changed from the Character tab.
pub fn cj_suit(id: &str) -> Appearance {
    // (variant, hair style, skin, hair, eyes, suit colour)
    let (variant, hair, skin, hair_color, eyes, suit) = match id {
        "princess" => (7, 26, "#f1c9a5", "#1b1b1f", "#3a3a50", "#33363c"), // Avery: charcoal
        "partygirl" => (7, 50, "#c68a5e", "#3b2416", "#2f2a24", "#6a1f2e"), // Jordan: burgundy
        "nurse" => (3, 8, "#8d5a3b", "#161210", "#2a2420", "#5a5f66"),      // Riley: grey
        "zoologist" => (7, 47, "#f5d2b8", "#7a3b1c", "#3c6a4a", "#5b3f27"), // Quinn: brown
        "goblin" => (3, 31, "#a8714a", "#241a12", "#2a2a2a", "#3f4f30"),    // Casey: olive
        _ => (3, 5, "#e0b090", "#3a2616", "#3a4a66", "#24365e"),            // Morgan: navy
    };
    Appearance {
        skin_variant: variant,
        hair,
        colors: AppearanceColors {
            skin: skin.into(),
            hair: hair_color.into(),
            eyes: eyes.into(),
            shirt: suit.into(),
            undershirt: "#f4f4f4".into(),
            pants: suit.into(),
            shoes: "#141414".into(),
        },
        armor: ArmorSlots::default(),
        hair_under_helmet: HairUnderHelmet::Hide,
        accessories: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everyone_has_a_distinct_valid_suit() {
        let ids = ["terrarian", "princess", "partygirl", "nurse", "zoologist", "goblin"];
        let suits: Vec<Appearance> = ids.iter().map(|id| cj_suit(id)).collect();
        for (a, id) in suits.iter().zip(ids) {
            assert_eq!(a.clone().sanitized(), *a, "{id}");
            assert!(matches!(a.skin_variant, 3 | 7), "{id}: a coat (suit) variant");
            assert_eq!(a.armor, ArmorSlots::default(), "{id}: no armour");
        }
        let colours: std::collections::HashSet<_> = suits.iter().map(|a| a.colors.shirt.clone()).collect();
        assert_eq!(colours.len(), ids.len());
    }

    #[test]
    fn maps_pack_armor_onto_the_armor_layers() {
        let a = waifu_2b_appearance(&ArmorOverrides { head: vec![237], body: vec![224], legs: vec![205] });
        assert_eq!(a.armor, ArmorSlots { head: Some(237), body: Some(224), legs: Some(205) });
        assert_eq!(a.hair_under_helmet, HairUnderHelmet::Hide);
        assert!(super::super::player::is_female(a.skin_variant));
        assert_eq!(a.clone().sanitized(), a);
    }

    #[test]
    fn partial_packs_leave_missing_slots_empty() {
        let a = waifu_2b_appearance(&ArmorOverrides { head: vec![237], ..Default::default() });
        assert_eq!(a.armor, ArmorSlots { head: Some(237), body: None, legs: None });
    }

    #[test]
    fn skin_ids_serialize_as_camel_case() {
        assert_eq!(serde_json::to_string(&SkinId::Waifu2b).unwrap(), "\"waifu2b\"");
        assert_eq!(serde_json::from_str::<SkinId>("\"default\"").unwrap(), SkinId::Default);
        assert!(serde_json::from_str::<SkinId>("\"bogus\"").is_err());
    }
}

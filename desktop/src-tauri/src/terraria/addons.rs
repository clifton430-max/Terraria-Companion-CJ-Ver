//! Installed resource-pack "add-ons" the companion can use, found by name and by the files they
//! contain: the "Somehow Waifu Princess" pack, the "2.0v Waifu" pack's town-NPC girls (Party Girl,
//! Nurse, Zoologist), the goblin-girl Goblin Tinkerer sheet, the Moon Lord girl and Queen Bee waifu
//! boss textures, and the "Yamete" hit sounds.
//! Nothing is copied: files are read from the pack folders at runtime and never written.

use super::packs::ResourcePack;
use super::player::{CELL_H, CELL_W};
use super::xnb::Texture;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Addon {
    Princess,
    Waifu2,
    MoonGirl,
    QueenBee,
    Goblin,
    Yamete,
}

impl Addon {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "princess" => Some(Addon::Princess),
            "waifu2" => Some(Addon::Waifu2),
            "moongirl" => Some(Addon::MoonGirl),
            "queenbee" => Some(Addon::QueenBee),
            "goblin" => Some(Addon::Goblin),
            "yamete" => Some(Addon::Yamete),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Addons {
    pub princess: Option<ResourcePack>,
    pub waifu2: Option<ResourcePack>,
    pub moon_girl: Option<ResourcePack>,
    pub queen_bee: Option<ResourcePack>,
    pub goblin: Option<ResourcePack>,
    pub yamete: Option<ResourcePack>,
}

/// For the settings UI: which pack provides each add-on.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonInfo {
    pub princess: Option<String>,
    pub waifu2: Option<String>,
    pub moon_girl: Option<String>,
    pub queen_bee: Option<String>,
    pub goblin: Option<String>,
    pub yamete: Option<String>,
}

fn has(pack: &ResourcePack, rel: &str) -> bool {
    pack.content().join(rel).is_file()
}

fn named(pack: &ResourcePack, words: &[&str]) -> bool {
    let n = pack.name.to_lowercase();
    words.iter().any(|w| n.contains(w))
}

/// Pick, for each add-on, a pack whose name matches (preferred) or that has the key files.
pub fn detect(packs: &[ResourcePack]) -> Addons {
    let pick = |words: &[&str], files: &[&str], need_name: bool| -> Option<ResourcePack> {
        let with_files = |p: &&ResourcePack| files.iter().all(|f| has(p, f));
        packs
            .iter()
            .filter(with_files)
            .find(|p| named(p, words))
            .or_else(|| if need_name { None } else { packs.iter().find(|p| with_files(p)) })
            .cloned()
    };
    Addons {
        princess: pick(&["princess"], &["Images/TownNPCs/Princess_Default.png"], false),
        waifu2: pick(&["2.0v waifu", "waifu mega", "2.0 waifu"], &["Images/NPC_208.png", "Images/TownNPCs/Nurse_Default.png", "Images/TownNPCs/BestiaryGirl_Default.png"], false),
        moon_girl: pick(&["moon lord", "月总"], &["Images/NPC_396.png", "Images/Extra_13.png"], false),
        // Texture overhauls (e.g. Calamity) also replace NPC_222; require the name for the bee.
        queen_bee: pick(&["queen bee"], &["Images/NPC_222.png"], true),
        goblin: pick(&["goblin"], &["Images/NPC_107.png"], false),
        yamete: pick(&["yamete"], &["Sounds/Female_Hit_0.xnb"], true),
    }
}

impl Addons {
    pub fn get(&self, a: Addon) -> Option<&ResourcePack> {
        match a {
            Addon::Princess => self.princess.as_ref(),
            Addon::Waifu2 => self.waifu2.as_ref(),
            Addon::MoonGirl => self.moon_girl.as_ref(),
            Addon::QueenBee => self.queen_bee.as_ref(),
            Addon::Goblin => self.goblin.as_ref(),
            Addon::Yamete => self.yamete.as_ref(),
        }
    }

    pub fn info(&self) -> AddonInfo {
        let label = |p: &Option<ResourcePack>| p.as_ref().map(|p| format!("{} ({})", p.name, p.id));
        AddonInfo {
            princess: label(&self.princess),
            waifu2: label(&self.waifu2),
            moon_girl: label(&self.moon_girl),
            queen_bee: label(&self.queen_bee),
            goblin: label(&self.goblin),
            yamete: label(&self.yamete),
        }
    }
}

/// A file inside an add-on pack: `rel` must be a plain relative path (letters, digits, `_`, `-`,
/// `.`, `/`), with the given extension, and must resolve inside the pack's Content folder.
pub fn pack_file(pack: &ResourcePack, rel: &str, ext: &str) -> Option<std::path::PathBuf> {
    if rel.is_empty() || rel.len() > 200 || rel.contains("..") || rel.starts_with('/') || !rel.ends_with(ext) {
        return None;
    }
    if !rel.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-./".contains(&b)) {
        return None;
    }
    let root = std::fs::canonicalize(pack.content()).ok()?;
    let path = std::fs::canonicalize(root.join(rel)).ok()?;
    (path.starts_with(&root) && path.is_file()).then_some(path)
}

// ── Characters ───────────────────────────────────────────────────────────────────────────────

/// Where each sheet-based character's art lives: (add-on, file in the pack, frames in the sheet).
pub fn npc_sheet(id: &str) -> Option<(Addon, &'static str, u32)> {
    match id {
        "goblin" => Some((Addon::Goblin, "Images/NPC_107.png", 25)),
        "princess" => Some((Addon::Princess, "Images/TownNPCs/Princess_Default.png", 23)),
        "partygirl" => Some((Addon::Waifu2, "Images/NPC_208.png", 23)),
        "nurse" => Some((Addon::Waifu2, "Images/TownNPCs/Nurse_Default.png", 23)),
        "zoologist" => Some((Addon::Waifu2, "Images/TownNPCs/BestiaryGirl_Default.png", 23)),
        _ => None,
    }
}

/// Town-girl (23-frame) sheet frame for each pose: 0 idle, 1 jump, 2–15 walk, 16 sit (sleep for
/// the Zoologist), 17 smile, 18 eyes closed (shy / blink), 19–22 attack.
pub fn town_frame(pose: &str) -> u32 {
    if let Some(step) = pose.strip_prefix("walk").and_then(|n| n.parse::<u32>().ok()) {
        return 2 + step.min(13);
    }
    match pose {
        "jump" | "fall" | "cling" | "glide" => 1,
        "use1" | "cast" => 19,
        "use2" | "shoot" | "lunge" => 20,
        "use3" | "pogo" | "diag" | "dive" => 21,
        "use4" | "slam" => 22,
        "wave1" | "happy" => 17,
        "wave2" | "hug" | "shy" => 18,
        "sit" | "sit2" | "ride" | "nap" => 16,
        "dash" => 9,
        _ => 0,
    }
}

/// The Zoologist's sit frame is her sleeping pose with "Zzz" letters (which read backwards once
/// mirrored), so she sits and naps with her eyes-closed frame instead.
pub fn zoologist_frame(pose: &str) -> u32 {
    match town_frame(pose) {
        16 => 18,
        f => f,
    }
}

pub fn town_hand(frame: u32) -> [f32; 2] {
    match frame {
        19 => [26.0, 22.0],
        20 => [34.0, 30.0],
        21 => [33.0, 36.0],
        22 => [28.0, 38.0],
        _ => [24.0, 36.0],
    }
}

/// Goblin Tinkerer (town NPC) sheet frame for each companion pose. Standard 25-frame town-NPC
/// layout: 0 idle, 1 jump, 2–15 walk, 16–17 wave, 18 sitting-ish, 19–20 talk, 21–24 throw.
pub fn goblin_frame(pose: &str) -> u32 {
    if let Some(step) = pose.strip_prefix("walk").and_then(|n| n.parse::<u32>().ok()) {
        return 2 + step.min(13);
    }
    match pose {
        "jump" | "fall" | "cling" | "glide" => 1,
        "use1" => 21,
        "use2" | "cast" => 22,
        "use3" | "shoot" | "lunge" | "pogo" | "diag" | "dive" => 23,
        "use4" | "slam" => 24,
        "wave1" => 16,
        "wave2" | "hug" => 17,
        "sit" | "sit2" | "ride" | "nap" => 18,
        "dash" => 10,
        _ => 0, // idle
    }
}

/// Hand (weapon grip) per sheet frame, in the *right-facing* (mirrored) cell; throw frames swing
/// the arm from behind the head to forward and down, other frames hold it at the side.
fn goblin_hand(frame: u32) -> [f32; 2] {
    match frame {
        21 => [24.0, 24.0],
        22 => [34.0, 28.0],
        23 => [35.0, 36.0],
        24 => [30.0, 40.0],
        16 | 17 => [27.0, 18.0],
        _ => [24.0, 36.0],
    }
}

/// Build a pose atlas (same layout as the player rig: one 40×56 cell per pose, facing right) from
/// the goblin NPC sheet, which faces left and is 40 px wide with 25 frames stacked vertically.
pub fn goblin_atlas(sheet: &Texture, poses: &[String]) -> Result<(Vec<u8>, u32, u32, BTreeMap<String, [f32; 2]>), String> {
    npc_atlas(sheet, 25, poses, goblin_frame, goblin_hand)
}

/// Build a pose atlas from a town-NPC sheet (`frames` stacked vertically, facing left): each frame
/// is mirrored to face right, centred horizontally and bottom-aligned in a 40×56 cell (larger
/// frames, like the Zoologist's 42×58, lose their outer pixels).
pub fn npc_atlas(
    sheet: &Texture,
    frames: u32,
    poses: &[String],
    frame_of: fn(&str) -> u32,
    hand_of: fn(u32) -> [f32; 2],
) -> Result<(Vec<u8>, u32, u32, BTreeMap<String, [f32; 2]>), String> {
    if frames == 0 || sheet.width < CELL_W - 4 || sheet.height < frames * (CELL_H - 8) {
        return Err(format!("NPC sheet is {}×{}, too small for {frames} frames", sheet.width, sheet.height));
    }
    let fh = sheet.height / frames;
    let fw = sheet.width;
    let x_off = fw as i32 - CELL_W as i32; // extra columns to drop (split between both sides)
    let (w, h) = (CELL_W * poses.len() as u32, CELL_H);
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    let mut hands = BTreeMap::new();
    for (i, pose) in poses.iter().enumerate() {
        let f = frame_of(pose).min(frames - 1);
        // Bottom-align each sheet frame in the cell (feet on the cell floor), mirrored.
        let dy = CELL_H as i32 - fh as i32;
        for y in 0..fh {
            for x in 0..CELL_W {
                // Mirror, then centre a wider/narrower frame in the 40-px cell.
                let sx = fw as i32 - 1 - (x as i32 + x_off / 2);
                if sx < 0 || sx >= fw as i32 {
                    continue;
                }
                let src = (((f * fh + y) * sheet.width + sx as u32) * 4) as usize;
                let ty = y as i32 + dy;
                if ty < 0 || ty >= CELL_H as i32 {
                    continue;
                }
                let dst = ((ty as u32 * w + i as u32 * CELL_W + x) * 4) as usize;
                rgba[dst..dst + 4].copy_from_slice(&sheet.rgba[src..src + 4]);
            }
        }
        hands.insert(pose.clone(), hand_of(f));
    }
    Ok((rgba, w, h, hands))
}

/// Does a path look like one of the pack's hit sounds (`Female_Hit_0..2`)?
pub fn is_yamete_clip(name: &str) -> bool {
    matches!(name, "Female_Hit_0" | "Female_Hit_1" | "Female_Hit_2")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terraria::packs::test_support::{png, temp_dir, write};

    fn pack(tag: &str, name: &str, files: &[&str]) -> ResourcePack {
        let root = temp_dir(&format!("addon-{tag}"));
        for f in files {
            write(&root.join("Content").join(f), &png(2, 2, [255, 0, 0, 255]));
        }
        ResourcePack { id: tag.into(), name: name.into(), author: "x".into(), workshop: true, root }
    }

    #[test]
    fn detects_addons_by_name_and_files() {
        let calamity = pack("cal", "Calamity Texture Pack", &["Images/NPC_107.png", "Images/NPC_222.png"]);
        let bee = pack("bee", "Terraria Queen Bee Texture Waifu", &["Images/NPC_222.png"]);
        let princess = pack("pr", "Somehow Waifu Princess", &["Images/TownNPCs/Princess_Default.png"]);
        let w2 = pack("w2", "2.0v Waifu MEGA Pack", &["Images/NPC_208.png", "Images/TownNPCs/Nurse_Default.png", "Images/TownNPCs/BestiaryGirl_Default.png", "Images/TownNPCs/Princess_Default.png"]);
        let moon = pack("moon", "girl moon lord", &["Images/NPC_396.png", "Images/Extra_13.png"]);
        let found = detect(&[calamity.clone(), bee.clone(), w2.clone(), princess.clone(), moon.clone()]);
        assert_eq!(found.queen_bee.as_ref().map(|p| p.id.as_str()), Some("bee")); // not Calamity
        assert_eq!(found.goblin.as_ref().map(|p| p.id.as_str()), Some("cal")); // files are enough
        assert_eq!(found.princess.as_ref().map(|p| p.id.as_str()), Some("pr")); // by name, not the 2.0 pack's copy
        assert_eq!(found.waifu2.as_ref().map(|p| p.id.as_str()), Some("w2"));
        assert_eq!(found.moon_girl.as_ref().map(|p| p.id.as_str()), Some("moon"));
        assert!(found.yamete.is_none());
        let only_cal = detect(&[calamity]);
        assert!(only_cal.queen_bee.is_none());
    }

    #[test]
    fn pack_files_stay_inside_the_pack() {
        let p = pack("files", "x", &["Images/Item_1909.png"]);
        assert!(pack_file(&p, "Images/Item_1909.png", ".png").is_some());
        assert!(pack_file(&p, "../pack.json", ".json").is_none());
        assert!(pack_file(&p, "/etc/passwd", ".png").is_none());
        assert!(pack_file(&p, "Images/Item 1909.png", ".png").is_none());
        assert!(pack_file(&p, "Images/Missing.png", ".png").is_none());
    }

    #[test]
    fn goblin_poses_map_to_town_npc_frames_and_mirror() {
        assert_eq!(goblin_frame("idle"), 0);
        assert_eq!(goblin_frame("walk0"), 2);
        assert_eq!(goblin_frame("walk13"), 15);
        assert_eq!(goblin_frame("use1"), 21);
        // A sheet with a marker pixel at the left edge of frame 0 lands on the right edge.
        let mut rgba = vec![0u8; 40 * 1400 * 4];
        rgba[(10 * 40) * 4..(10 * 40) * 4 + 4].copy_from_slice(&[9, 9, 9, 255]);
        let sheet = Texture { width: 40, height: 1400, rgba };
        let (atlas, w, h, hands) = goblin_atlas(&sheet, &["idle".to_string(), "use1".to_string()]).unwrap();
        assert_eq!((w, h), (80, 56));
        let i = ((10 * w + 39) * 4) as usize;
        assert_eq!(&atlas[i..i + 4], &[9, 9, 9, 255]);
        assert_eq!(hands["use1"], [24.0, 24.0]);
    }

    #[test]
    fn town_girls_map_and_fit_wider_frames() {
        assert_eq!(town_frame("idle"), 0);
        assert_eq!(town_frame("walk13"), 15);
        assert_eq!(town_frame("use1"), 19);
        assert_eq!(npc_sheet("zoologist").map(|s| s.2), Some(23));
        // A 42×58 sheet (Zoologist size) fits a 40×56 cell, mirrored and bottom-aligned.
        let (w, h) = (42u32, 58 * 23);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        let at = ((57 * w + 1) * 4) as usize; // bottom row, second column of frame 0
        rgba[at..at + 4].copy_from_slice(&[7, 7, 7, 255]);
        let sheet = Texture { width: w, height: h, rgba };
        let (atlas, aw, _, _) = npc_atlas(&sheet, 23, &["idle".to_string()], town_frame, town_hand).unwrap();
        let i = ((55 * aw + 39) * 4) as usize; // lands on the last column of the cell's bottom row
        assert_eq!(&atlas[i..i + 4], &[7, 7, 7, 255]);
    }
}

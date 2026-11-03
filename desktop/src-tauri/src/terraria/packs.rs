//! Terraria resource packs installed on this Mac (Steam Workshop and the local ResourcePacks
//! folder): discovery, the 2B armour skin, the voice pack, and a texture source that prefers a
//! pack's PNG over the game's `.xnb`. Read-only; nothing is copied out of the packs.

use super::player::TextureSource;
use super::store::validate_name;
use super::xnb::Texture;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Steam Workshop content for Terraria (resource packs live under `<library>/steamapps/workshop/content/105600`).
pub const WORKSHOP_APP: &str = "105600";
/// Largest pack PNG accepted (armour sheets are a few hundred KB).
const MAX_PACK_PNG: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePack {
    /// Workshop item id or local folder name.
    pub id: String,
    pub name: String,
    pub author: String,
    pub workshop: bool,
    #[serde(skip)]
    pub root: PathBuf,
}

impl ResourcePack {
    pub fn content(&self) -> PathBuf {
        self.root.join("Content")
    }
}

#[derive(serde::Deserialize, Default)]
#[serde(default, rename_all = "PascalCase")]
struct PackJson {
    name: String,
    author: String,
}

fn read_pack(dir: &Path, workshop: bool) -> Option<ResourcePack> {
    let text = fs::read_to_string(dir.join("pack.json")).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    // Some packs have raw line breaks inside strings (invalid JSON); fall back to reading the
    // "Name" / "Author" values directly.
    let meta: PackJson = serde_json::from_str(text).unwrap_or_else(|_| PackJson { name: loose_field(text, "Name"), author: loose_field(text, "Author") });
    if !dir.join("Content").is_dir() {
        return None;
    }
    Some(ResourcePack {
        id: dir.file_name()?.to_string_lossy().into_owned(),
        name: if meta.name.trim().is_empty() { "Unnamed pack".into() } else { meta.name.trim().to_string() },
        author: meta.author.trim().to_string(),
        workshop,
        root: dir.to_path_buf(),
    })
}

/// The string value after `"key":` in a not-quite-JSON pack.json ("" if absent).
fn loose_field(text: &str, key: &str) -> String {
    let Some(at) = text.find(&format!("\"{key}\"")) else { return String::new() };
    let rest = &text[at + key.len() + 2..];
    let Some(colon) = rest.find(':') else { return String::new() };
    let rest = rest[colon + 1..].trim_start();
    let Some(body) = rest.strip_prefix('"') else { return String::new() };
    body.split('"').next().unwrap_or("").chars().filter(|c| !c.is_control()).collect::<String>().trim().to_string()
}

/// Every unpacked resource pack in the given Steam libraries and local ResourcePacks folders.
/// (Zipped local packs are not read.)
pub fn discover(steam_libraries: &[PathBuf], local_dirs: &[PathBuf]) -> Vec<ResourcePack> {
    let mut packs = Vec::new();
    let mut scan = |dir: PathBuf, workshop: bool| {
        let Ok(entries) = fs::read_dir(&dir) else { return };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        packs.extend(dirs.iter().filter_map(|d| read_pack(d, workshop)));
    };
    for lib in steam_libraries {
        scan(lib.join("steamapps/workshop/content").join(WORKSHOP_APP), true);
    }
    for dir in local_dirs {
        scan(dir.clone(), false);
    }
    packs
}

// ── Skins ───────────────────────────────────────────────────────────────────────────────────

/// Armour sheets a pack replaces (vanilla slot ids), found by file name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorOverrides {
    pub head: Vec<u16>,
    pub body: Vec<u16>,
    pub legs: Vec<u16>,
}

impl ArmorOverrides {
    pub fn is_empty(&self) -> bool {
        self.head.is_empty() && self.body.is_empty() && self.legs.is_empty()
    }
}

fn ids_with(dir: &Path, prefix: &str) -> Vec<u16> {
    let mut ids: Vec<u16> = fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    name.strip_prefix(prefix)?.strip_suffix(".png")?.parse().ok()
                })
                .collect()
        })
        .unwrap_or_default();
    ids.sort_unstable();
    ids
}

pub fn armor_overrides(pack: &ResourcePack) -> ArmorOverrides {
    let images = pack.content().join("Images");
    ArmorOverrides {
        head: ids_with(&images, "Armor_Head_"),
        body: ids_with(&images.join("Armor"), "Armor_"),
        legs: ids_with(&images, "Armor_Legs_"),
    }
}

/// The 2B outfit pack: a pack whose name mentions "2B" and that replaces armour sheets.
pub fn find_2b(packs: &[ResourcePack]) -> Option<(ResourcePack, ArmorOverrides)> {
    packs.iter().find_map(|p| {
        let named = p.name.to_ascii_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == "2b");
        let armor = armor_overrides(p);
        (named && !armor.is_empty()).then(|| (p.clone(), armor))
    })
}

/// Texture source that serves `Content/<name>.png` from a pack when present and falls back to
/// `base` (the game) otherwise. Paths are validated and confined to the pack's Content folder.
pub struct PackTextures<'a> {
    pub base: &'a dyn TextureSource,
    pub content: PathBuf,
}

impl PackTextures<'_> {
    /// Resolved PNG path for a texture name, if the pack has it.
    pub fn resolve(&self, name: &str) -> Option<PathBuf> {
        validate_name(name).ok()?;
        let root = fs::canonicalize(&self.content).ok()?;
        let path = fs::canonicalize(root.join(format!("{name}.png"))).ok()?;
        (path.starts_with(&root) && path.is_file()).then_some(path)
    }
}

impl TextureSource for PackTextures<'_> {
    fn get(&self, name: &str) -> Option<Arc<Texture>> {
        if let Some(path) = self.resolve(name) {
            match decode_png(&path) {
                Ok(t) => return Some(Arc::new(t)),
                Err(e) => eprintln!("resource pack: {} could not be decoded ({e}); using the game's art", path.display()),
            }
        }
        self.base.get(name)
    }
}

/// Decode a PNG of any colour type/bit depth to straight-alpha RGBA8.
pub fn decode_png(path: &Path) -> Result<Texture, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_PACK_PNG {
        return Err(format!("{} bytes is too large", meta.len()));
    }
    let mut decoder = png::Decoder::new(fs::File::open(path).map_err(|e| e.to_string())?);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let (w, h) = (frame.width, frame.height);
    if w == 0 || h == 0 || w > 8192 || h > 8192 {
        return Err(format!("bad dimensions {w}x{h}"));
    }
    let px = &buf[..frame.buffer_size()];
    let rgba: Vec<u8> = match frame.color_type {
        png::ColorType::Rgba => px.to_vec(),
        png::ColorType::Rgb => px.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => px.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        png::ColorType::Grayscale => px.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("palette was not expanded".into()),
    };
    Ok(Texture { width: w, height: h, rgba })
}

/// Size + modification time of the pack files a skin uses, for cache keys (a pack update
/// produces a new key, so stale composed atlases are never served).
pub fn files_signature(paths: &[PathBuf]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in paths {
        let (len, mtime) = fs::metadata(p)
            .map(|m| (m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs())))
            .unwrap_or((0, 0));
        for b in p.to_string_lossy().bytes().chain(len.to_le_bytes()).chain(mtime.to_le_bytes()) {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}

// ── Voice pack ──────────────────────────────────────────────────────────────────────────────

/// The four voice clips the waifu voice pack provides per voice.
pub const VOICE_CLIPS: [&str; 4] = ["hit0", "hit1", "hit2", "killed"];

/// One selectable voice: the pack's active top-level sounds or one of its variant folders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    /// "active" or the variant's index in [`VoicePack::voices`] as a string.
    pub id: String,
    pub label: String,
    /// Clip names from [`VOICE_CLIPS`] that exist for this voice.
    pub clips: Vec<String>,
    #[serde(skip)]
    pub dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePack {
    pub pack: ResourcePack,
    pub voices: Vec<Voice>,
}

fn clip_candidates(clip: &str) -> Vec<String> {
    let stems: Vec<String> = match clip {
        "hit0" | "hit1" | "hit2" => {
            let n = &clip[3..];
            vec![format!("Female_Hit_{n}"), format!("Player_Hit_{n}")]
        }
        "killed" => vec!["Player_Killed".into()],
        _ => vec![],
    };
    // Prefer ready-made WAVs, then XNBs; the pack prefixes its variant copies with '@'.
    let mut out = Vec::new();
    for ext in ["wav", "xnb"] {
        for stem in &stems {
            out.push(format!("@{stem}.{ext}"));
            out.push(format!("{stem}.{ext}"));
        }
    }
    out
}

/// File for `clip` in a voice folder, if present.
pub fn clip_file(dir: &Path, clip: &str) -> Option<PathBuf> {
    clip_candidates(clip).into_iter().map(|f| dir.join(f)).find(|p| p.is_file())
}

fn voice_in(dir: &Path, id: String, label: String) -> Option<Voice> {
    let clips: Vec<String> = VOICE_CLIPS.iter().filter(|c| clip_file(dir, c).is_some()).map(|c| c.to_string()).collect();
    (!clips.is_empty()).then(|| Voice { id, label, clips, dir: dir.to_path_buf() })
}

/// Voice-actor credit from a `VA - Name.txt` marker file in a variant folder.
fn credit(dir: &Path) -> Option<String> {
    fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let n = e.file_name().to_string_lossy().into_owned();
        n.strip_prefix("VA - ")?.strip_suffix(".txt").map(|s| s.trim().to_string())
    })
}

/// The first pack with player-hit/death sounds in `Content/Sounds`, with its active voice and
/// every variant folder (searched two levels below `Sounds`).
pub fn find_voice_pack(packs: &[ResourcePack]) -> Option<VoicePack> {
    // Several packs can replace the hit sounds (e.g. one-off "Yamete" or moan packs). Prefer a
    // pack that calls itself a voice pack, then the one offering the most voices, so the companion
    // keeps using the real voice pack; single-sound packs are used only as explicit add-ons.
    let mut found: Vec<VoicePack> = packs.iter().filter_map(|p| voice_pack_in(p)).collect();
    found.sort_by_key(|v| {
        let named = v.pack.name.to_lowercase().contains("voice");
        (std::cmp::Reverse(named), std::cmp::Reverse(v.voices.len()))
    });
    found.into_iter().next()
}

fn voice_pack_in(p: &ResourcePack) -> Option<VoicePack> {
    Some(p).and_then(|p| {
        let sounds = p.content().join("Sounds");
        let mut voices: Vec<Voice> = voice_in(&sounds, "active".into(), "Active voice (pack default)".into()).into_iter().collect();
        let mut variant_dirs = Vec::new();
        for group in fs::read_dir(&sounds).ok()?.flatten().map(|e| e.path()).filter(|d| d.is_dir()) {
            if clip_file(&group, "hit0").is_some() {
                variant_dirs.push(group.clone());
            }
            if let Ok(inner) = fs::read_dir(&group) {
                variant_dirs.extend(inner.flatten().map(|e| e.path()).filter(|d| d.is_dir()));
            }
        }
        variant_dirs.sort();
        for dir in variant_dirs {
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let label = match credit(&dir) {
                Some(va) => format!("{name} ({va})"),
                None => name,
            };
            let id = (voices.len()).to_string();
            if let Some(v) = voice_in(&dir, id, label) {
                voices.push(v);
            }
        }
        // Re-number variants densely after filtering (the active voice keeps "active").
        let mut n = 0;
        for v in voices.iter_mut().filter(|v| v.id != "active") {
            n += 1;
            v.id = n.to_string();
        }
        (!voices.is_empty()).then(|| VoicePack { pack: p.clone(), voices })
    })
}

#[cfg(test)]
mod voice_choice_tests {
    use super::test_support::{temp_dir, write};
    use super::*;

    #[test]
    fn prefers_the_real_voice_pack_over_single_sound_packs() {
        let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec();
        let mk = |tag: &str, name: &str, voices: &[&str]| {
            let root = temp_dir(&format!("voicechoice-{tag}"));
            for v in voices {
                let dir = if v.is_empty() { root.join("Content/Sounds") } else { root.join("Content/Sounds").join(v) };
                for clip in ["Female_Hit_0.xnb", "Female_Hit_1.xnb", "Female_Hit_2.xnb", "Female_Killed.xnb"] {
                    write(&dir.join(clip), &wav);
                }
            }
            ResourcePack { id: tag.into(), name: name.into(), author: "x".into(), workshop: true, root }
        };
        let yamete = mk("y", "Yamete sound for girl", &[""]);
        let voice = mk("v", "Waifu Voice Pack", &["", "Youth/1", "Youth/2"]);
        let chosen = find_voice_pack(&[yamete.clone(), voice.clone()]).map(|v| v.pack.id);
        assert_eq!(chosen.as_deref(), Some("v"));
        assert_eq!(find_voice_pack(&[yamete]).map(|v| v.pack.id).as_deref(), Some("y"));
    }
}

#[cfg(test)]
pub mod test_support {
    use std::path::{Path, PathBuf};

    pub fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tc-packs-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn write(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    /// Tiny RGBA PNG filled with one colour.
    pub fn png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
        let px: Vec<u8> = (0..w * h).flat_map(|_| rgba).collect();
        crate::terraria::store::encode_png(w, h, &px).unwrap()
    }

    /// A fake Steam library with a 2B pack and a voice pack, mirroring the installed layout.
    pub fn library(tag: &str) -> PathBuf {
        let lib = temp_dir(tag);
        let ws = lib.join("steamapps/workshop/content/105600");
        write(&ws.join("3113488461/pack.json"), br#"{ "Name": "Waifu 2B", "Author": "lunchbag" }"#);
        write(&ws.join("3113488461/Content/Images/Armor_Head_237.png"), &png(40, 1120, [255, 255, 255, 255]));
        write(&ws.join("3113488461/Content/Images/Armor/Armor_224.png"), &png(360, 224, [10, 10, 10, 255]));
        write(&ws.join("3113488461/Content/Images/Armor_Legs_205.png"), &png(40, 1120, [20, 20, 20, 255]));
        write(&ws.join("2665172132/pack.json"), "\u{feff}{ \"Name\": \"Waifu Voice Pack\", \"Author\": \"M\" }".as_bytes());
        let snd = crate::terraria::sound::test_support::sound_xnb(1, &[0; 960]);
        for f in ["Female_Hit_0.xnb", "Female_Hit_1.xnb", "Female_Hit_2.xnb", "Player_Killed.xnb"] {
            write(&ws.join("2665172132/Content/Sounds").join(f), &snd);
        }
        let v = ws.join("2665172132/Content/Sounds/Choose your favorite/Youth - 5");
        write(&v.join("@Female_Hit_0.wav"), &crate::terraria::sound::xnb_to_wav(&snd).unwrap().0);
        write(&v.join("@Player_Killed.xnb"), &snd);
        write(&v.join("VA - Someone.txt"), b"");
        write(&ws.join("2665172132/Content/Sounds/Choose your favorite/Empty/readme.txt"), b"");
        write(&ws.join("999/readme.txt"), b"not a pack");
        lib
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    #[test]
    fn discovers_workshop_packs_and_ignores_non_packs() {
        let lib = library("discover");
        let packs = discover(&[lib.clone()], &[lib.join("nope")]);
        let names: Vec<&str> = packs.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Waifu Voice Pack", "Waifu 2B"]);
        assert!(packs.iter().all(|p| p.workshop));
    }

    #[test]
    fn finds_the_2b_skin_and_its_armor_slots() {
        let lib = library("skin");
        let (pack, armor) = find_2b(&discover(&[lib], &[])).unwrap();
        assert_eq!(pack.id, "3113488461");
        assert_eq!(armor, ArmorOverrides { head: vec![237], body: vec![224], legs: vec![205] });
        assert!(find_2b(&[]).is_none());
    }

    #[test]
    fn pack_textures_override_the_game_and_fall_back() {
        struct Game;
        impl TextureSource for Game {
            fn get(&self, name: &str) -> Option<Arc<Texture>> {
                (name == "Images/Player_0_0").then(|| Arc::new(Texture { width: 1, height: 1, rgba: vec![1, 2, 3, 4] }))
            }
        }
        let lib = library("override");
        let (pack, _) = find_2b(&discover(&[lib], &[])).unwrap();
        let src = PackTextures { base: &Game, content: pack.content() };
        let head = src.get("Images/Armor_Head_237").unwrap();
        assert_eq!((head.width, head.height, &head.rgba[..4]), (40, 1120, &[255, 255, 255, 255][..]));
        assert_eq!(src.get("Images/Armor/Armor_224").unwrap().width, 360);
        assert_eq!(src.get("Images/Player_0_0").unwrap().rgba, vec![1, 2, 3, 4]); // from the game
        assert!(src.get("Images/Armor_Head_1").is_none());
        assert!(src.get("Images/../../pack.json").is_none()); // traversal rejected
    }

    #[test]
    fn corrupt_pack_pngs_fall_back_to_the_game() {
        struct Game;
        impl TextureSource for Game {
            fn get(&self, _: &str) -> Option<Arc<Texture>> {
                Some(Arc::new(Texture { width: 2, height: 2, rgba: vec![0; 16] }))
            }
        }
        let dir = temp_dir("corrupt");
        write(&dir.join("Content/Images/Armor_Head_5.png"), b"\x89PNG garbage");
        let src = PackTextures { base: &Game, content: dir.join("Content") };
        assert_eq!(src.get("Images/Armor_Head_5").unwrap().width, 2);
    }

    #[test]
    fn signature_changes_when_a_pack_file_changes() {
        let dir = temp_dir("sig");
        let f = dir.join("a.png");
        write(&f, b"one");
        let a = files_signature(&[f.clone()]);
        write(&f, b"three");
        assert_ne!(a, files_signature(&[f.clone()]));
        assert_ne!(files_signature(&[dir.join("missing.png")]), a);
    }

    #[test]
    fn finds_the_voice_pack_active_voice_and_variants() {
        let lib = library("voice");
        let vp = find_voice_pack(&discover(&[lib], &[])).unwrap();
        assert_eq!(vp.pack.name, "Waifu Voice Pack");
        let ids: Vec<(&str, &str)> = vp.voices.iter().map(|v| (v.id.as_str(), v.label.as_str())).collect();
        assert_eq!(ids, [("active", "Active voice (pack default)"), ("1", "Youth - 5 (Someone)")]);
        assert_eq!(vp.voices[0].clips, ["hit0", "hit1", "hit2", "killed"]);
        assert_eq!(vp.voices[1].clips, ["hit0", "killed"]);
        // WAV preferred over XNB; '@' copies found.
        assert!(clip_file(&vp.voices[1].dir, "hit0").unwrap().ends_with("@Female_Hit_0.wav"));
        assert!(clip_file(&vp.voices[1].dir, "hit2").is_none());
        assert!(clip_file(&vp.voices[0].dir, "bogus").is_none());
    }
}

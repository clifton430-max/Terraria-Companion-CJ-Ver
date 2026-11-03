//! App integration for local Terraria assets: shared state, the `get_player_rig` command and the
//! `tasset://` URI scheme the WebView loads images from.
//!
//! Routes (GET only):
//!   tasset://localhost/rig/<key>.png             composed player atlas from `get_player_rig`
//!   tasset://localhost/texture/Images/<name>.png decoded game texture (allow-listed names only)
//!   tasset://localhost/sound/<Name>.wav           vanilla `Content/Sounds/<Name>.xnb` as WAV
//!   tasset://localhost/voice/<voice>/<clip>.wav   voice-pack clip (`active` or a variant number;
//!                                                 clip is one of hit0, hit1, hit2, killed)

use crate::terraria::addons::{self, Addon};
use crate::terraria::packs::{self, ArmorOverrides, ResourcePack, VoicePack};
use crate::terraria::player::{self, Appearance, ComposeOptions, Rect, BODY_BOX, CELL_H, CELL_W};
use crate::terraria::skins::{self, SkinId};
use crate::terraria::sound;
use crate::terraria::store::{encode_png, validate_name, AssetStore, DECODER_VERSION};
use crate::terraria::locate;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub const SCHEME: &str = "tasset";

/// `TC_DEBUG=1` logs rig composition and asset requests to stderr (paths and sizes only).
fn debug() -> bool {
    std::env::var_os("TC_DEBUG").is_some()
}
/// Composed atlases kept in memory (one per recent appearance).
const MAX_CACHED_RIGS: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RigInfo {
    pub available: bool,
    /// Why the real art isn't available (no install, decode failure…); the app falls back.
    pub reason: Option<String>,
    /// Atlas URL for the WebView (`tasset://localhost/rig/<key>.png`).
    pub path: Option<String>,
    pub frame_width: u32,
    pub frame_height: u32,
    pub frames: Vec<String>,
    pub hands: BTreeMap<String, [f32; 2]>,
    pub body: Rect,
    pub game_version: Option<String>,
    pub missing: Vec<String>,
    /// Skin actually drawn ("default" or "waifu2b").
    pub skin: String,
    /// Set when the requested skin wasn't available and the default was used instead.
    pub skin_note: Option<String>,
}

/// A selectable skin for the settings UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinInfo {
    pub id: SkinId,
    pub name: String,
    pub available: bool,
    /// Where the art comes from, or why it can't be used.
    pub detail: String,
}

/// Voice choices for the settings UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceList {
    pub pack: Option<String>,
    pub voices: Vec<packs::Voice>,
}

impl RigInfo {
    pub fn unavailable(reason: String) -> Self {
        Self {
            available: false,
            reason: Some(reason),
            path: None,
            frame_width: CELL_W,
            frame_height: CELL_H,
            frames: Vec::new(),
            hands: BTreeMap::new(),
            body: BODY_BOX,
            game_version: None,
            missing: Vec::new(),
            skin: "default".into(),
            skin_note: None,
        }
    }
}

pub struct TerrariaAssets {
    store: Option<AssetStore>,
    unavailable: Option<String>,
    rigs: Mutex<HashMap<String, Arc<(Vec<u8>, RigInfo)>>>,
    /// The "Waifu 2B" resource pack and the armour sheets it replaces, if installed.
    skin_2b: Option<(ResourcePack, ArmorOverrides)>,
    voice: Option<VoicePack>,
    /// Character and boss add-ons (KILL la KILL, goblin girl, Moon Lord girl, Queen Bee, Yamete).
    addons: addons::Addons,
}

/// Largest vanilla sound name accepted on the `/sound/` route.
const MAX_SOUND_NAME: usize = 40;

impl TerrariaAssets {
    /// Locate the game and prepare a store whose cache lives under `cache_root`.
    pub fn init(cache_root: PathBuf) -> Self {
        match locate::locate(None) {
            Ok(install) => {
                let store = AssetStore::new(install, cache_root);
                if let Err(e) = store.prune_stale_caches() {
                    eprintln!("terraria assets: could not prune old caches: {e}");
                }
                Self::with_packs(Some(store), None)
            }
            Err(reason) => {
                eprintln!("terraria assets unavailable: {reason}");
                Self::with_packs(None, Some(reason))
            }
        }
    }

    /// CJ Ver: resource packs and add-ons (anime character sheets, the 2B skin, voice packs, boss
    /// textures, hit sounds) are never looked for or loaded; everyone is drawn from the game's own
    /// player sheets in a suit (see `skins::cj_suit`).
    fn with_packs(store: Option<AssetStore>, unavailable: Option<String>) -> Self {
        Self { store, unavailable, rigs: Mutex::new(HashMap::new()), skin_2b: None, voice: None, addons: Default::default() }
    }

    /// Skins offered in settings, with availability. (CJ Ver: only your own appearance.)
    pub fn skins(&self) -> Vec<SkinInfo> {
        vec![SkinInfo {
            id: SkinId::Default,
            name: "Default".into(),
            available: true,
            detail: "Your appearance from the Character tab".into(),
        }]
    }

    pub fn voices(&self) -> VoiceList {
        VoiceList {
            pack: self.voice.as_ref().map(|v| format!("{} by {}", v.pack.name, v.pack.author)),
            voices: self.voice.as_ref().map(|v| v.voices.clone()).unwrap_or_default(),
        }
    }

    /// Which add-on packs are installed.
    pub fn addon_info(&self) -> addons::AddonInfo {
        self.addons.info()
    }

    /// Atlas for a roster character: "terrarian" (your own look / skin), or a town-NPC sheet from an
    /// add-on: "princess" (Somehow Waifu Princess), "partygirl", "nurse", "zoologist" (2.0v Waifu
    /// pack) or "goblin" (the goblin-girl Goblin Tinkerer).
    pub fn character_rig(&self, id: &str, appearance: &Appearance, skin: SkinId) -> RigInfo {
        self.character_rig_with(id, appearance, skin, ("", "", 0))
    }

    /// `character_rig` with a KILL la KILL look override (skin, eyes, hair; empty/0 = default).
    pub fn character_rig_with(&self, id: &str, appearance: &Appearance, skin: SkinId, look: (&str, &str, u16)) -> RigInfo {
        // CJ Ver: Morgan ("terrarian") wears your appearance from the Character tab (a navy suit by
        // default); everyone else has their own fixed suit. No add-on sheets or skins.
        let _ = (look, skin);
        match id {
            "terrarian" => self.rig_for(appearance, SkinId::Default),
            other => self.rig_for(&skins::cj_suit(other), SkinId::Default),
        }
    }

    /// Atlas for a sheet-based character (goblin girl, princess, party girl, nurse, zoologist).
    fn npc_rig(&self, id: &str) -> RigInfo {
        let Some(store) = &self.store else {
            return RigInfo::unavailable(self.unavailable.clone().unwrap_or_else(|| "Terraria not found".into()));
        };
        let Some((addon, rel, frames)) = addons::npc_sheet(id) else { return RigInfo::unavailable("unknown character".into()) };
        let Some(pack) = self.addons.get(addon) else { return RigInfo::unavailable("Her add-on pack isn't installed".into()) };
        let Some(path) = addons::pack_file(pack, rel, ".png") else { return RigInfo::unavailable(format!("{rel} missing from the pack")) };
        let sig = packs::files_signature(&[path.clone()]);
        let key = format!("{id}-{sig}-d{DECODER_VERSION}");
        if let Some(hit) = self.rigs.lock().unwrap().get(&key) {
            return hit.1.clone();
        }
        let sheet = match packs::decode_png(&path) {
            Ok(t) => t,
            Err(e) => return RigInfo::unavailable(e),
        };
        let names: Vec<String> = player::poses().into_iter().map(|p| p.name).collect();
        let built = if id == "goblin" { addons::goblin_atlas(&sheet, &names) } else { addons::npc_atlas(&sheet, frames, &names, if id == "zoologist" { addons::zoologist_frame } else { addons::town_frame }, addons::town_hand) };
        let (rgba, w, h, hands) = match built {
            Ok(a) => a,
            Err(e) => return RigInfo::unavailable(e),
        };
        let png = match encode_png(w, h, &rgba) {
            Ok(p) => p,
            Err(e) => return RigInfo::unavailable(e.to_string()),
        };
        let info = RigInfo {
            available: true,
            reason: None,
            path: Some(format!("/rig/{key}.png")),
            frame_width: CELL_W,
            frame_height: CELL_H,
            frames: names,
            hands,
            body: BODY_BOX,
            game_version: store.install().version.clone(),
            missing: Vec::new(),
            skin: id.into(),
            skin_note: None,
        };
        self.remember(key, png, &info);
        info
    }

    fn remember(&self, key: String, png: Vec<u8>, info: &RigInfo) {
        let mut rigs = self.rigs.lock().unwrap();
        if rigs.len() >= MAX_CACHED_RIGS {
            rigs.clear();
        }
        rigs.insert(key, Arc::new((png, info.clone())));
    }

    /// Compose (or reuse) the atlas for `appearance` drawn as `skin`.
    pub fn rig_for(&self, appearance: &Appearance, skin: SkinId) -> RigInfo {
        // Resolve the skin: 2B uses its own appearance plus the pack's sheets; if the pack is gone
        // the user's default appearance is drawn instead (and the UI is told why).
        let (used, look, pack, note) = match (skin, &self.skin_2b) {
            (SkinId::Waifu2b, Some((pack, armor))) => (SkinId::Waifu2b, skins::waifu_2b_appearance(armor), Some(pack), None),
            (SkinId::Waifu2b, None) => (SkinId::Default, appearance.clone(), None, Some("2B pack not found; showing the default skin".to_string())),
            _ => (SkinId::Default, appearance.clone(), None, None),
        };
        self.compose_with_pack(look, pack, used.key(), note)
    }

    /// Compose (or reuse) an atlas for `look`, with `pack`'s sheets layered over the game's.
    fn compose_with_pack(&self, look: Appearance, pack: Option<&ResourcePack>, skin_key: &str, note: Option<String>) -> RigInfo {
        let Some(store) = &self.store else {
            return RigInfo::unavailable(self.unavailable.clone().unwrap_or_else(|| "Terraria not found".into()));
        };
        // Cache key covers the look, the skin and the pack files' size/mtime (a pack update
        // invalidates old atlases).
        let pack_sig = pack.map_or_else(String::new, |p| {
            let src = packs::PackTextures { base: store, content: p.content() };
            let files: Vec<_> = look_files(&look).iter().filter_map(|n| src.resolve(n)).collect();
            format!("-{}", packs::files_signature(&files))
        });
        let key = format!("{}-{}{pack_sig}-d{DECODER_VERSION}", look.clone().sanitized().cache_key(), skin_key);
        if let Some(hit) = self.rigs.lock().unwrap().get(&key) {
            return RigInfo { skin_note: note, ..hit.1.clone() };
        }
        let started = std::time::Instant::now();
        let composed = match pack {
            Some(p) => {
                let src = packs::PackTextures { base: store, content: p.content() };
                player::compose_skin(&src, &look, ComposeOptions { front_overlays: true })
            }
            None => player::compose(store, &look),
        };
        let rig = match composed {
            Ok(r) => r,
            Err(e) => return RigInfo::unavailable(e.to_string()),
        };
        let png = match encode_png(rig.width, rig.height, &rig.rgba) {
            Ok(p) => p,
            Err(e) => return RigInfo::unavailable(e.to_string()),
        };
        let info = RigInfo {
            available: true,
            reason: None,
            path: Some(format!("/rig/{key}.png")),
            frame_width: CELL_W,
            frame_height: CELL_H,
            frames: rig.frames,
            hands: rig.hands,
            body: BODY_BOX,
            game_version: store.install().version.clone(),
            missing: rig.missing,
            skin: skin_key.into(),
            skin_note: note,
        };
        // Keep a copy beside the texture cache (same game/decoder key) for inspection and reuse.
        let rig_file = store.cache_dir().join("rigs").join(format!("{key}.png"));
        if let Err(e) = std::fs::create_dir_all(rig_file.parent().unwrap()).and_then(|_| std::fs::write(&rig_file, &png)) {
            eprintln!("terraria assets: rig cache write {}: {e}", rig_file.display());
        }
        if debug() {
            eprintln!(
                "[assets] composed rig {key}: {} frames, {}x{} px, {} B png in {:?}; missing {:?}",
                info.frames.len(), rig.width, rig.height, png.len(), started.elapsed(), info.missing
            );
        }
        self.remember(key, png, &info);
        info
    }

    /// Resolve a `tasset://` request path to (status, body). Never reads outside the game's
    /// content folder: texture names are validated and canonicalized by [`AssetStore`].
    pub fn serve(&self, path: &str) -> (u16, Vec<u8>) {
        let result = self.serve_inner(path);
        if debug() {
            eprintln!("[assets] GET {path} -> {} ({} B)", result.0, result.1.len());
        }
        result
    }

    fn serve_inner(&self, path: &str) -> (u16, Vec<u8>) {
        if let Some(key) = path.strip_prefix("/rig/").and_then(|p| p.strip_suffix(".png")) {
            if !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                return (400, b"bad rig key".to_vec());
            }
            return match self.rigs.lock().unwrap().get(key) {
                Some(hit) => (200, hit.0.clone()),
                None => (404, b"rig not composed".to_vec()),
            };
        }
        // Add-on pack files: /addon/<klk|moongirl|queenbee|goblin>/Images/....png (served as-is)
        // and /addonsound/yamete/Female_Hit_<n>.wav (decoded like the game's sounds).
        if let Some(rest) = path.strip_prefix("/addon/") {
            let Some((which, rel)) = rest.split_once('/') else { return (400, b"bad add-on path".to_vec()) };
            let Some(addon) = Addon::parse(which).filter(|a| *a != Addon::Yamete) else { return (400, b"unknown add-on".to_vec()) };
            let Some(pack) = self.addons.get(addon) else { return (404, b"add-on not installed".to_vec()) };
            let Some(file) = addons::pack_file(pack, rel, ".png").filter(|_| rel.starts_with("Images/")) else { return (404, b"not in pack".to_vec()) };
            return match std::fs::read(&file) {
                Ok(bytes) => (200, bytes),
                Err(e) => (404, e.to_string().into_bytes()),
            };
        }
        if let Some(clip) = path.strip_prefix("/addonsound/yamete/").and_then(|p| p.strip_suffix(".wav")) {
            if !addons::is_yamete_clip(clip) {
                return (400, b"bad clip".to_vec());
            }
            let Some(pack) = self.addons.get(Addon::Yamete) else { return (404, b"add-on not installed".to_vec()) };
            let Some(file) = addons::pack_file(pack, &format!("Sounds/{clip}.xnb"), ".xnb") else { return (404, b"clip not found".to_vec()) };
            return match std::fs::read(&file) {
                Ok(bytes) => match sound::xnb_to_wav(&bytes) {
                    Ok((wav, _)) => (200, wav),
                    Err(e) => (415, e.to_string().into_bytes()),
                },
                Err(e) => (404, e.to_string().into_bytes()),
            };
        }
        if let Some(name) = path.strip_prefix("/sound/").and_then(|p| p.strip_suffix(".wav")) {
            if name.is_empty() || name.len() > MAX_SOUND_NAME || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                return (400, b"bad sound name".to_vec());
            }
            let Some(store) = &self.store else { return (404, b"Terraria not found".to_vec()) };
            let file = store.install().content_dir.join("Sounds").join(format!("{name}.xnb"));
            return match std::fs::read(&file) {
                Ok(bytes) => match sound::xnb_to_wav(&bytes) {
                    Ok((wav, _)) => (200, wav),
                    Err(e) => (415, e.to_string().into_bytes()),
                },
                Err(_) => (404, b"sound not found".to_vec()),
            };
        }
        if let Some(rest) = path.strip_prefix("/voice/").and_then(|p| p.strip_suffix(".wav")) {
            let Some((voice_id, clip)) = rest.split_once('/') else { return (400, b"bad voice path".to_vec()) };
            if !packs::VOICE_CLIPS.contains(&clip) {
                return (400, b"bad voice clip".to_vec());
            }
            let Some(voice) = self.voice.as_ref().and_then(|vp| vp.voices.iter().find(|v| v.id == voice_id)) else {
                return (404, b"voice not found".to_vec());
            };
            let Some(file) = packs::clip_file(&voice.dir, clip) else { return (404, b"clip not found".to_vec()) };
            return match std::fs::read(&file) {
                Ok(bytes) if file.extension().is_some_and(|e| e == "wav") => match sound::validate_wav(&bytes) {
                    Ok(_) => (200, bytes),
                    Err(e) => (415, e.to_string().into_bytes()),
                },
                Ok(bytes) => match sound::xnb_to_wav(&bytes) {
                    Ok((wav, _)) => (200, wav),
                    Err(e) => (415, e.to_string().into_bytes()),
                },
                Err(e) => (404, e.to_string().into_bytes()),
            };
        }
        if let Some(name) = path.strip_prefix("/texture/").and_then(|p| p.strip_suffix(".png")) {
            if validate_name(name).is_err() {
                return (400, b"bad texture name".to_vec());
            }
            let Some(store) = &self.store else { return (404, b"Terraria not found".to_vec()) };
            return match store.texture_png(name) {
                Ok(png) => (200, png),
                Err(e) => (404, e.to_string().into_bytes()),
            };
        }
        (404, b"unknown route".to_vec())
    }
}

/// Texture names (without the pack prefix) an appearance's armour layers would load.
fn look_files(look: &Appearance) -> Vec<String> {
    let mut v = Vec::new();
    if let Some(id) = look.armor.head {
        v.push(format!("Images/Armor_Head_{id}"));
    }
    if let Some(id) = look.armor.body {
        v.push(format!("Images/Armor/Armor_{id}"));
    }
    if let Some(id) = look.armor.legs {
        v.push(format!("Images/Armor_Legs_{id}"));
    }
    v
}

/// Content type for a served path.
pub fn content_type(path: &str, status: u16) -> &'static str {
    match status {
        200 if path.ends_with(".wav") => "audio/wav",
        200 => "image/png",
        _ => "text/plain",
    }
}

/// Build the HTTP response for the URI scheme handler.
pub fn response_typed(status: u16, body: Vec<u8>, content_type: &str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        // The overlay draws these into a canvas, so allow cross-origin reads from the app origin.
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terraria::store::test_support::Sandbox;

    fn assets(sb: &Sandbox) -> TerrariaAssets {
        TerrariaAssets { store: Some(sb.store("1.4.5.8", "1")), unavailable: None, rigs: Mutex::new(HashMap::new()), skin_2b: None, voice: None, addons: Default::default() }
    }

    /// Sandbox with a head strip so composition succeeds.
    fn body_sandbox(tag: &str) -> Sandbox {
        let sb = Sandbox::new(tag);
        let mut head = vec![0u8; (CELL_W * CELL_H * 20 * 4) as usize];
        head[((12 * CELL_W + 20) * 4) as usize..][..4].copy_from_slice(&[255, 255, 255, 255]);
        sb.add_texture("Images/Player_0_0", CELL_W, CELL_H * 20, &head);
        sb.add_texture("Images/Player_4_0", CELL_W, CELL_H * 20, &head);
        sb
    }

    /// Assets with the fake 2B and voice packs from `packs::test_support::library`.
    fn with_packs(sb: &Sandbox, tag: &str) -> (TerrariaAssets, std::path::PathBuf) {
        let lib = packs::test_support::library(tag);
        let found = packs::discover(&[lib.clone()], &[]);
        let mut a = assets(sb);
        a.skin_2b = packs::find_2b(&found);
        a.voice = packs::find_voice_pack(&found);
        a.addons = addons::detect(&found);
        (a, lib)
    }

    #[test]
    fn serves_textures_and_rejects_bad_routes() {
        let sb = Sandbox::new("serve-routes");
        sb.add_texture("Images/Item_1", 1, 1, &[255, 0, 0, 255]);
        let a = assets(&sb);
        let (status, body) = a.serve("/texture/Images/Item_1.png");
        assert_eq!(status, 200);
        assert!(body.starts_with(b"\x89PNG"));
        assert_eq!(a.serve("/texture/Images/Item_404.png").0, 404);
        assert_eq!(a.serve("/texture/Images/../../etc/passwd.png").0, 400);
        assert_eq!(a.serve("/texture/Sounds/Chat.png").0, 400);
        assert_eq!(a.serve("/rig/../../x.png").0, 400);
        assert_eq!(a.serve("/rig/abc.png").0, 404);
        assert_eq!(a.serve("/etc/passwd").0, 404);
    }

    #[test]
    fn rig_is_composed_once_and_then_served_by_key() {
        let sb = Sandbox::new("serve-rig");
        // Minimal real-format body: a head strip so composition succeeds.
        let mut head = vec![0u8; (CELL_W * CELL_H * 20 * 4) as usize];
        head[((12 * CELL_W + 20) * 4) as usize..][..4].copy_from_slice(&[255, 255, 255, 255]);
        sb.add_texture("Images/Player_0_0", CELL_W, CELL_H * 20, &head);
        let a = assets(&sb);
        let info = a.rig_for(&Appearance::default(), SkinId::Default);
        assert!(info.available, "{:?}", info.reason);
        assert_eq!(info.frames.len(), player::poses().len());
        let path = info.path.clone().unwrap();
        let (status, png) = a.serve(&path);
        assert_eq!(status, 200);
        assert!(png.starts_with(b"\x89PNG"));
        // Same appearance → same key; different appearance → different key.
        assert_eq!(a.rig_for(&Appearance::default(), SkinId::Default).path, info.path);
        assert_ne!(a.rig_for(&Appearance { hair: 3, ..Default::default() }, SkinId::Default).path, info.path);
    }

    #[test]
    fn missing_install_reports_unavailable() {
        let a = TerrariaAssets { store: None, unavailable: Some("Terraria is not installed".into()), rigs: Mutex::new(HashMap::new()), skin_2b: None, voice: None, addons: Default::default() };
        let info = a.rig_for(&Appearance::default(), SkinId::Waifu2b);
        assert!(!info.available);
        assert_eq!(info.reason.as_deref(), Some("Terraria is not installed"));
        assert_eq!(a.serve("/texture/Images/Item_1.png").0, 404);
    }

    #[test]
    fn missing_2b_pack_falls_back_to_the_default_skin() {
        let sb = body_sandbox("skin-fallback");
        let a = assets(&sb);
        let info = a.rig_for(&Appearance::default(), SkinId::Waifu2b);
        assert!(info.available);
        assert_eq!(info.skin, "default");
        assert!(info.skin_note.unwrap().contains("not found"));
        assert_eq!(info.path, a.rig_for(&Appearance::default(), SkinId::Default).path);
        // CJ Ver: only the default skin is ever offered.
        let skins = a.skins();
        assert_eq!(skins.len(), 1);
        assert!(skins[0].available);
    }

    #[test]
    fn the_2b_skin_uses_the_pack_and_has_its_own_cache_key() {
        let sb = body_sandbox("skin-2b");
        let (a, lib) = with_packs(&sb, "skin-2b-lib");
        let default = a.rig_for(&Appearance::default(), SkinId::Default);
        let two_b = a.rig_for(&Appearance::default(), SkinId::Waifu2b);
        assert!(two_b.available, "{:?}", two_b.reason);
        assert_eq!(two_b.skin, "waifu2b");
        assert!(two_b.missing.is_empty(), "{:?}", two_b.missing); // all three sheets came from the pack
        assert_ne!(two_b.path, default.path);
        // The user's own appearance doesn't change the 2B look (same atlas).
        assert_eq!(a.rig_for(&Appearance { hair: 9, ..Default::default() }, SkinId::Waifu2b).path, two_b.path);
        assert_eq!(a.skins().len(), 1); // (CJ Ver: never offered in settings)
        // Updating a pack file invalidates the cached atlas.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let head = lib.join("steamapps/workshop/content/105600/3113488461/Content/Images/Armor_Head_237.png");
        packs::test_support::write(&head, &packs::test_support::png(40, 1120, [200, 0, 0, 255]));
        assert_ne!(a.rig_for(&Appearance::default(), SkinId::Waifu2b).path, two_b.path);
    }

    #[test]
    fn serves_voice_clips_and_vanilla_sounds_as_wav() {
        let sb = body_sandbox("voice-routes");
        let (a, _) = with_packs(&sb, "voice-routes-lib");
        std::fs::create_dir_all(sb.content.join("Sounds")).unwrap();
        std::fs::write(sb.content.join("Sounds/Dig_0.xnb"), sound::test_support::sound_xnb(1, &[0; 200])).unwrap();
        std::fs::write(sb.content.join("Sounds/Bad.xnb"), sound::test_support::sound_xnb(2, &[0; 200])).unwrap();
        for path in ["/voice/active/hit0.wav", "/voice/active/killed.wav", "/voice/1/hit0.wav", "/voice/1/killed.wav", "/sound/Dig_0.wav"] {
            let (status, body) = a.serve(path);
            assert_eq!(status, 200, "{path}: {}", String::from_utf8_lossy(&body));
            assert!(sound::validate_wav(&body).is_ok(), "{path}");
            assert_eq!(content_type(path, status), "audio/wav");
        }
        assert_eq!(a.serve("/voice/1/hit2.wav").0, 404); // variant lacks that clip
        assert_eq!(a.serve("/voice/9/hit0.wav").0, 404);
        assert_eq!(a.serve("/voice/active/../../x.wav").0, 400);
        assert_eq!(a.serve("/voice/active/moan.wav").0, 400);
        assert_eq!(a.serve("/sound/Bad.wav").0, 415); // ADPCM: unsupported codec
        assert_eq!(a.serve("/sound/Nope.wav").0, 404);
        assert_eq!(a.serve("/sound/../x.wav").0, 400);
        assert_eq!(a.voices().voices.len(), 2);
    }
}

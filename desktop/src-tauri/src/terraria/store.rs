//! Safe, on-demand access to Terraria textures with a versioned PNG cache.
//!
//! * Names are relative, extension-less paths like `Images/Player_0_0`. Only `[A-Za-z0-9_]`
//!   segments under an allow-listed top folder are accepted; the resolved file is canonicalized
//!   and must stay inside the detected `Content` directory (no traversal, no symlink escapes).
//! * Decoded textures are converted to straight alpha, encoded as PNG and cached at
//!   `<cache root>/<game key>/d<DECODER_VERSION>/<name>.png`. The key combines the game version
//!   and Steam build id, so a game update or decoder change never serves stale art. A cached
//!   file older than its source `.xnb`, or one that isn't a valid PNG, is re-decoded.
//! * Nothing is ever written inside the game folder or the repository.

use super::alpha::unpremultiply;
use super::locate::Install;
use super::xnb::{decode_texture, Texture, XnbError};
use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Bump when decoding or conversion output changes, to invalidate every cached PNG.
pub const DECODER_VERSION: u32 = 1;
/// Top-level content folders that may be served.
const ALLOWED_ROOTS: &[&str] = &["Images"];
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug)]
pub enum AssetError {
    InvalidName(String),
    NotFound(String),
    OutsideContent(String),
    Decode(String, XnbError),
    Io(String),
}

impl fmt::Display for AssetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName(n) => write!(f, "invalid asset name {n:?}"),
            Self::NotFound(n) => write!(f, "asset not found: {n}"),
            Self::OutsideContent(n) => write!(f, "asset resolves outside the Terraria content folder: {n}"),
            Self::Decode(n, e) => write!(f, "cannot decode {n}: {e}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AssetError {}

/// Validate a requested asset name without touching the filesystem.
pub fn validate_name(name: &str) -> Result<(), AssetError> {
    let invalid = || AssetError::InvalidName(name.to_string());
    if name.is_empty() || name.len() > 128 || name.starts_with('/') {
        return Err(invalid());
    }
    let mut segments = name.split('/');
    let root = segments.next().ok_or_else(invalid)?;
    if !ALLOWED_ROOTS.contains(&root) {
        return Err(invalid());
    }
    let rest: Vec<&str> = segments.collect();
    if rest.is_empty() || rest.len() > 4 {
        return Err(invalid());
    }
    for seg in rest {
        if seg.is_empty() || !seg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err(invalid());
        }
    }
    Ok(())
}

/// Cache directory name for a game install: `<version>-b<build>` with unknowns as `unknown`.
pub fn game_key(install: &Install) -> String {
    let clean = |s: &Option<String>| {
        s.as_deref()
            .map(|v| v.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.').collect::<String>())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "unknown".into())
    };
    format!("{}-b{}", clean(&install.version), clean(&install.build_id))
}

pub struct AssetStore {
    content_dir: PathBuf,
    cache_root: PathBuf,
    cache_dir: PathBuf,
    install: Install,
    memory: Mutex<HashMap<String, Arc<Texture>>>,
}

impl AssetStore {
    /// `cache_root` is the app's cache folder for Terraria assets (e.g.
    /// `~/Library/Caches/<bundle id>/terraria-assets`).
    pub fn new(install: Install, cache_root: PathBuf) -> Self {
        let cache_dir = cache_root.join(game_key(&install)).join(format!("d{DECODER_VERSION}"));
        Self {
            content_dir: install.content_dir.clone(),
            cache_root,
            cache_dir,
            install,
            memory: Mutex::new(HashMap::new()),
        }
    }

    pub fn install(&self) -> &Install {
        &self.install
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    /// Resolve a validated name to a canonical `.xnb` path inside the content directory.
    pub fn resolve(&self, name: &str) -> Result<PathBuf, AssetError> {
        validate_name(name)?;
        let candidate = self.content_dir.join(format!("{name}.xnb"));
        let canonical = fs::canonicalize(&candidate).map_err(|_| AssetError::NotFound(name.to_string()))?;
        if !canonical.starts_with(&self.content_dir) || !canonical.is_file() {
            return Err(AssetError::OutsideContent(name.to_string()));
        }
        Ok(canonical)
    }

    fn cache_path(&self, name: &str) -> PathBuf {
        self.cache_dir.join(format!("{name}.png"))
    }

    /// Decoded texture with straight alpha. Lookup order: memory → fresh versioned PNG cache on
    /// disk → decode the game's `.xnb` (then write the PNG cache). A cache write failure is not
    /// fatal; the texture is still returned.
    pub fn texture(&self, name: &str) -> Result<Arc<Texture>, AssetError> {
        if let Some(t) = self.memory.lock().unwrap().get(name) {
            return Ok(t.clone());
        }
        let source = self.resolve(name)?;
        let cached = self.cache_path(name);
        let tex = match read_fresh_cache(&cached, &source).and_then(|png| decode_png(&png)) {
            Some(tex) => tex,
            None => {
                let bytes = fs::read(&source).map_err(|e| AssetError::Io(format!("{}: {e}", source.display())))?;
                let mut tex = decode_texture(&bytes).map_err(|e| AssetError::Decode(name.to_string(), e))?;
                unpremultiply(&mut tex.rgba);
                if let Err(e) = encode_png(tex.width, tex.height, &tex.rgba).and_then(|png| {
                    write_atomic(&cached, &png).map_err(|e| AssetError::Io(format!("cache write {}: {e}", cached.display())))
                }) {
                    eprintln!("terraria assets: {e}");
                }
                tex
            }
        };
        let tex = Arc::new(tex);
        self.memory.lock().unwrap().insert(name.to_string(), tex.clone());
        Ok(tex)
    }

    /// PNG bytes for a texture, served from the versioned disk cache when fresh.
    pub fn texture_png(&self, name: &str) -> Result<Vec<u8>, AssetError> {
        let source = self.resolve(name)?;
        let cached = self.cache_path(name);
        if let Some(bytes) = read_fresh_cache(&cached, &source) {
            return Ok(bytes);
        }
        let tex = self.texture(name)?;
        match read_fresh_cache(&cached, &source) {
            Some(bytes) => Ok(bytes),
            None => encode_png(tex.width, tex.height, &tex.rgba),
        }
    }

    /// Delete cache folders for other game versions or decoder versions. Only removes
    /// directories this store could have created (names matching `<version>-b<build>`).
    pub fn prune_stale_caches(&self) -> io::Result<usize> {
        let current = game_key(&self.install);
        let mut removed = 0;
        let Ok(entries) = fs::read_dir(&self.cache_root) else { return Ok(0) };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if !path.is_dir() || !name.contains("-b") {
                continue;
            }
            if name != current {
                fs::remove_dir_all(&path)?;
                removed += 1;
                continue;
            }
            for sub in fs::read_dir(&path)?.flatten() {
                let sub_name = sub.file_name().to_string_lossy().into_owned();
                if sub_name.starts_with('d') && sub_name != format!("d{DECODER_VERSION}") && sub.path().is_dir() {
                    fs::remove_dir_all(sub.path())?;
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }
}

/// Cached PNG if it exists, is a PNG, and is at least as new as its source.
fn read_fresh_cache(cached: &Path, source: &Path) -> Option<Vec<u8>> {
    let cached_time = fs::metadata(cached).and_then(|m| m.modified()).ok()?;
    let source_time = fs::metadata(source).and_then(|m| m.modified()).ok()?;
    if cached_time < source_time {
        return None;
    }
    let bytes = fs::read(cached).ok()?;
    bytes.starts_with(PNG_SIGNATURE).then_some(bytes)
}

/// Decode one of our cached PNGs (8-bit RGBA only); anything else is treated as a cache miss.
fn decode_png(bytes: &[u8]) -> Option<Texture> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    buf.truncate(info.buffer_size());
    Some(Texture { width: info.width, height: info.height, rgba: buf })
}

pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, AssetError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| AssetError::Io(e.to_string()))?;
        writer.write_image_data(rgba).map_err(|e| AssetError::Io(e.to_string()))?;
    }
    Ok(out)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::super::xnb::fixtures::*;
    use super::*;

    /// A temporary fake `Content` folder plus cache root, removed on drop.
    pub struct Sandbox {
        pub root: PathBuf,
        pub content: PathBuf,
        pub cache: PathBuf,
    }

    impl Sandbox {
        pub fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!("tc-assets-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            let content = root.join("Content");
            fs::create_dir_all(content.join("Images")).unwrap();
            let cache = root.join("cache");
            Self { content: fs::canonicalize(&content).unwrap(), root, cache }
        }

        pub fn add_texture(&self, name: &str, width: u32, height: u32, rgba: &[u8]) {
            let path = self.content.join(format!("{name}.xnb"));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, xnb_lzx(&texture_payload(width, height, rgba, 0))).unwrap();
        }

        pub fn install(&self, version: &str, build: &str) -> Install {
            Install { content_dir: self.content.clone(), version: Some(version.into()), build_id: Some(build.into()) }
        }

        pub fn store(&self, version: &str, build: &str) -> AssetStore {
            AssetStore::new(self.install(version, build), self.cache.clone())
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::Sandbox;
    use super::*;

    #[test]
    fn validates_names() {
        for ok in ["Images/Player_0_0", "Images/Armor/Armor_12", "Images/UI/Cursor_0"] {
            assert!(validate_name(ok).is_ok(), "{ok}");
        }
        for bad in [
            "", "/Images/Item_1", "Images", "Images/", "Images/../Fonts/Mouse_Text", "Images/./Item_1",
            "Sounds/Chat", "Images/Item_1.xnb", "Images/Item 1", "Images\\Item_1", "Fonts/Combat_Text",
            "Images/a/b/c/d/e",
        ] {
            assert!(matches!(validate_name(bad), Err(AssetError::InvalidName(_))), "{bad:?}");
        }
    }

    #[test]
    fn serves_textures_as_straight_alpha_png_and_caches_them() {
        let sb = Sandbox::new("serve");
        sb.add_texture("Images/Item_1", 2, 1, &[64, 32, 0, 128, 255, 0, 0, 255]);
        let store = sb.store("1.4.5.8", "24893155");
        let png = store.texture_png("Images/Item_1").unwrap();
        assert!(png.starts_with(PNG_SIGNATURE));
        assert_eq!(store.texture("Images/Item_1").unwrap().rgba, vec![128, 64, 0, 128, 255, 0, 0, 255]);
        let cached = store.cache_dir().join("Images/Item_1.png");
        assert!(cached.is_file());
        assert!(cached.starts_with(&sb.cache), "cache must stay under the cache root");
        assert_eq!(store.cache_dir(), sb.cache.join("1.4.5.8-b24893155").join(format!("d{DECODER_VERSION}")));
        // Second call is served from the cache file.
        assert_eq!(store.texture_png("Images/Item_1").unwrap(), png);
    }

    #[test]
    fn missing_files_and_traversal_are_rejected() {
        let sb = Sandbox::new("paths");
        let store = sb.store("1.4.5.8", "1");
        assert!(matches!(store.texture_png("Images/Item_404"), Err(AssetError::NotFound(_))));
        assert!(matches!(store.texture_png("Images/../../etc/passwd"), Err(AssetError::InvalidName(_))));
        // A symlink inside Images that escapes the content folder must not be followed.
        let outside = sb.root.join("secret.xnb");
        fs::write(&outside, b"XNBw").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, sb.content.join("Images/Escape.xnb")).unwrap();
        #[cfg(unix)]
        assert!(matches!(store.resolve("Images/Escape"), Err(AssetError::OutsideContent(_))));
    }

    #[test]
    fn corrupt_textures_report_decode_errors() {
        let sb = Sandbox::new("corrupt");
        fs::write(sb.content.join("Images/Item_2.xnb"), b"XNBw\x05\x81\x20\x00\x00\x00garbage-garbage-garbage").unwrap();
        let store = sb.store("1.4.5.8", "1");
        assert!(matches!(store.texture_png("Images/Item_2"), Err(AssetError::Decode(..))));
        assert!(!store.cache_dir().join("Images/Item_2.png").exists());
    }

    #[test]
    fn new_game_version_uses_a_new_cache_and_prunes_the_old_one() {
        let sb = Sandbox::new("version");
        sb.add_texture("Images/Item_1", 1, 1, &[1, 2, 3, 255]);
        let old = sb.store("1.4.5.7", "100");
        old.texture_png("Images/Item_1").unwrap();
        let new = sb.store("1.4.5.8", "200");
        assert_ne!(old.cache_dir(), new.cache_dir());
        new.texture_png("Images/Item_1").unwrap();
        // Unrelated folders in the cache root are left alone.
        fs::create_dir_all(sb.cache.join("notes")).unwrap();
        assert_eq!(new.prune_stale_caches().unwrap(), 1);
        assert!(!old.cache_dir().exists());
        assert!(new.cache_dir().join("Images/Item_1.png").exists());
        assert!(sb.cache.join("notes").exists());
    }

    #[test]
    fn stale_or_corrupt_cache_entries_are_redecoded() {
        let sb = Sandbox::new("stale");
        sb.add_texture("Images/Item_1", 1, 1, &[1, 2, 3, 255]);
        let store = sb.store("1.4.5.8", "1");
        let first = store.texture_png("Images/Item_1").unwrap();
        let cached = store.cache_dir().join("Images/Item_1.png");
        fs::write(&cached, b"not a png").unwrap();
        assert_eq!(store.texture_png("Images/Item_1").unwrap(), first);

        // Source updated after the cache was written: the newer art must be served.
        let fresh = sb.store("1.4.5.8", "1"); // new store, empty memory cache
        std::thread::sleep(std::time::Duration::from_millis(1100));
        sb.add_texture("Images/Item_1", 1, 1, &[9, 9, 9, 255]);
        let updated = fresh.texture_png("Images/Item_1").unwrap();
        assert_ne!(updated, first);
    }

    #[test]
    fn decoded_textures_are_cached_on_disk_and_reused_by_a_fresh_store() {
        let sb = Sandbox::new("disk-cache");
        sb.add_texture("Images/Player_0_0", 2, 1, &[64, 32, 0, 128, 0, 0, 0, 0]);
        let first = sb.store("1.4.5.8", "7");
        let tex = first.texture("Images/Player_0_0").unwrap();
        let cached = first.cache_dir().join("Images/Player_0_0.png");
        assert!(cached.is_file(), "texture() must write the versioned disk cache");

        // A new store (empty memory) reads the cache: prove it by corrupting the source while the
        // cache is still newer than it.
        let src = sb.content.join("Images/Player_0_0.xnb");
        let mtime = fs::metadata(&cached).unwrap().modified().unwrap();
        fs::write(&src, b"corrupted").unwrap();
        let f = fs::File::options().write(true).open(&src).unwrap();
        f.set_modified(mtime - std::time::Duration::from_secs(10)).unwrap();
        let second = sb.store("1.4.5.8", "7");
        assert_eq!(second.texture("Images/Player_0_0").unwrap().rgba, tex.rgba);

        // Once the source is newer than the cache, it is decoded again (and here, fails cleanly).
        f.set_modified(mtime + std::time::Duration::from_secs(10)).unwrap();
        let third = sb.store("1.4.5.8", "7");
        assert!(matches!(third.texture("Images/Player_0_0"), Err(AssetError::Decode(..))));
    }

    #[test]
    fn game_key_sanitizes_unknown_values() {
        let sb = Sandbox::new("key");
        let mut install = sb.install("1.4.5.8", "24893155");
        assert_eq!(game_key(&install), "1.4.5.8-b24893155");
        install.version = Some("../../x".into());
        install.build_id = None;
        assert_eq!(game_key(&install), "....x-bunknown");
    }
}

//! Find the local Terraria install and identify its version.
//!
//! Search order: explicit override → default Steam library → other Steam libraries listed in
//! `steamapps/libraryfolders.vdf`. Version comes from the first line of `changelog.txt`
//! ("Version 1.4.5.8 Changes") and the Steam build id from `appmanifest_105600.acf`.

use std::fs;
use std::path::{Path, PathBuf};

pub const TERRARIA_STEAM_APP_ID: u32 = 105600;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Install {
    /// Canonical path of the game's `Content` directory.
    pub content_dir: PathBuf,
    /// Game version from the changelog, e.g. "1.4.5.8".
    pub version: Option<String>,
    /// Steam build id, e.g. "24893155".
    pub build_id: Option<String>,
}

/// `Content` directory inside a Steam `common/Terraria` folder (macOS app bundle or Windows/Linux layout).
fn content_dir_in(game_dir: &Path) -> Option<PathBuf> {
    [
        game_dir.join("Terraria.app/Contents/Resources/Content"),
        game_dir.join("Content"),
    ]
    .into_iter()
    .find(|p| p.join("Images").is_dir())
}

/// Version from a Terraria changelog's first line.
pub fn parse_changelog_version(text: &str) -> Option<String> {
    let first = text.lines().next()?.trim();
    let rest = first.strip_prefix("Version ")?;
    let version: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    (!version.is_empty() && version.contains('.')).then_some(version)
}

/// `"buildid"` value from a Steam app manifest.
pub fn parse_appmanifest_build_id(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let mut parts = line.split('"').filter(|s| !s.trim().is_empty());
        (parts.next()? == "buildid").then(|| parts.next().map(str::to_owned)).flatten()
    })
    .filter(|id| id.chars().all(|c| c.is_ascii_digit()))
}

/// Library paths from Steam's `libraryfolders.vdf` (`"path"  "/Volumes/Games/SteamLibrary"`).
pub fn parse_library_folders(text: &str) -> Vec<PathBuf> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split('"').filter(|s| !s.trim().is_empty());
            (parts.next()? == "path").then(|| parts.next().map(PathBuf::from)).flatten()
        })
        .collect()
}

fn default_steam_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Steam"))
}

/// Every Steam library on this Mac: the default one plus those in `libraryfolders.vdf`.
pub fn steam_libraries() -> Vec<PathBuf> {
    let Some(root) = default_steam_root() else { return Vec::new() };
    let mut libs = vec![root.clone()];
    for lib in fs::read_to_string(root.join("steamapps/libraryfolders.vdf")).map(|t| parse_library_folders(&t)).unwrap_or_default() {
        if !libs.contains(&lib) {
            libs.push(lib);
        }
    }
    libs
}

/// Local (non-Workshop) resource pack folders for vanilla Terraria and tModLoader.
pub fn local_resource_pack_dirs() -> Vec<PathBuf> {
    std::env::var_os("HOME")
        .map(|h| {
            let base = PathBuf::from(h).join("Library/Application Support/Terraria");
            vec![base.join("ResourcePacks"), base.join("tModLoader/ResourcePacks")]
        })
        .unwrap_or_default()
}

/// Inspect one Steam library (`<library>/steamapps`).
fn install_in_library(library: &Path) -> Option<Install> {
    let steamapps = library.join("steamapps");
    let game_dir = steamapps.join("common/Terraria");
    let content = content_dir_in(&game_dir)?;
    Some(Install {
        content_dir: fs::canonicalize(content).ok()?,
        version: fs::read_to_string(game_dir.join("changelog.txt")).ok().as_deref().and_then(parse_changelog_version),
        build_id: fs::read_to_string(steamapps.join(format!("appmanifest_{TERRARIA_STEAM_APP_ID}.acf")))
            .ok()
            .as_deref()
            .and_then(parse_appmanifest_build_id),
    })
}

/// Locate Terraria. `override_content` may point directly at a `Content` directory.
pub fn locate(override_content: Option<&Path>) -> Result<Install, String> {
    if let Some(dir) = override_content {
        let content = fs::canonicalize(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        if !content.join("Images").is_dir() {
            return Err(format!("{} has no Images folder", content.display()));
        }
        return Ok(Install { content_dir: content, version: None, build_id: None });
    }
    let root = default_steam_root().ok_or("HOME is not set")?;
    if let Some(found) = install_in_library(&root) {
        return Ok(found);
    }
    let libraries = fs::read_to_string(root.join("steamapps/libraryfolders.vdf"))
        .map(|t| parse_library_folders(&t))
        .unwrap_or_default();
    libraries
        .iter()
        .find_map(|lib| install_in_library(lib))
        .ok_or_else(|| "Terraria is not installed in any Steam library".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_version_from_changelog() {
        assert_eq!(
            parse_changelog_version("Version 1.4.5.8 Changes ------------\n\nI. Content").as_deref(),
            Some("1.4.5.8")
        );
        assert_eq!(parse_changelog_version("Changelog\nVersion 1.4"), None);
        assert_eq!(parse_changelog_version(""), None);
    }

    #[test]
    fn reads_build_id_from_appmanifest() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"105600\"\n\t\"buildid\"\t\t\"24893155\"\n}";
        assert_eq!(parse_appmanifest_build_id(acf).as_deref(), Some("24893155"));
        assert_eq!(parse_appmanifest_build_id("\"buildid\" \"abc\""), None);
    }

    #[test]
    fn reads_library_paths() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"/Users/x/Library/Application Support/Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"/Volumes/Games/SteamLibrary\"\n\t}\n}";
        assert_eq!(
            parse_library_folders(vdf),
            vec![PathBuf::from("/Users/x/Library/Application Support/Steam"), PathBuf::from("/Volumes/Games/SteamLibrary")]
        );
    }

    #[test]
    fn override_must_contain_images() {
        let dir = std::env::temp_dir().join(format!("tc-locate-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(locate(Some(&dir)).is_err());
        fs::create_dir_all(dir.join("Images")).unwrap();
        assert_eq!(locate(Some(&dir)).unwrap().content_dir, fs::canonicalize(&dir).unwrap());
        fs::remove_dir_all(&dir).unwrap();
    }
}

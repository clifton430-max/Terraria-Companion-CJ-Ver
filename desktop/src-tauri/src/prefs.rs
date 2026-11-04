//! Locally persisted user preferences, stored as JSON in the app config directory.

use crate::terraria::player::Appearance;
pub use crate::terraria::skins::SkinId;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

pub const MIN_SCALE: u32 = 2;
pub const MAX_SCALE: u32 = 6;
pub const MIN_WALK_SPEED: f64 = 20.0;
pub const MAX_WALK_SPEED: f64 = 200.0;
/// Inventory size and hotbar width; must match the frontend's `combat/inventory.ts`.
pub const INVENTORY_SLOTS: usize = 50;
pub const HOTBAR_SLOTS: u32 = 10;
/// Longest accepted item id; ids are short ASCII slugs like `ember-blade`.
pub const MAX_ITEM_ID_LEN: usize = 48;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
    /// Whether the companion overlay is shown.
    pub visible: bool,
    /// Whether the companion's movement and AI are frozen.
    pub paused: bool,
    /// Integer pixel-art scale factor (CSS pixels per sprite pixel).
    pub scale: u32,
    /// Walking speed in CSS pixels per second.
    pub walk_speed: f64,
    /// Last horizontal position as a fraction (0..=1) of the usable screen width.
    pub last_x: Option<f64>,
    /// Whether other apps' windows act as platforms the companion can stand on.
    pub platforms: bool,
    /// Selected (equipped) hotbar slot, 0..HOTBAR_SLOTS.
    pub selected_slot: u32,
    /// Item id per inventory slot; `None` until the user first rearranges items.
    pub inventory: Option<Vec<Option<String>>>,
    /// Whether the combat training sandbox (dummies) is active.
    pub training: bool,
    /// Player look for the Terraria-art character renderer.
    pub appearance: Appearance,
    pub companion_mode: CompanionMode,
    /// Home position for Stay mode; `None` means "wherever the companion is when Stay starts".
    pub stay_position: Option<StayPosition>,
    pub idle_pose: IdlePose,
    pub cursor_mode: CursorMode,
    /// Hide the real macOS cursor while in Become mode (opt-in; restored automatically).
    pub hide_system_cursor: bool,
    pub effects: EffectPrefs,
    pub boss_difficulty: BossDifficulty,
    /// The draggable quick-action dock. A malformed section resets only the dock settings.
    #[serde(deserialize_with = "lenient_dock")]
    pub dock: DockPrefs,
    /// Which skin the companion wears (falls back to Default when its pack is missing).
    #[serde(deserialize_with = "lenient")]
    pub skin: SkinId,
    #[serde(deserialize_with = "lenient")]
    pub audio: AudioPrefs,
    #[serde(deserialize_with = "lenient")]
    pub pickaxe: PickaxePrefs,
    #[serde(deserialize_with = "lenient")]
    pub control: ControlPrefs,
    /// `None` only in preferences saved before idle rotation existed (migrated on load). The
    /// field-level default makes a missing key read as `None` so the migration can see it.
    #[serde(default, deserialize_with = "lenient")]
    pub idle: Option<IdlePrefs>,
    #[serde(deserialize_with = "lenient")]
    pub awareness: AwarenessPrefs,
    #[serde(deserialize_with = "lenient_reactions")]
    pub reactions: Vec<ReactionRule>,
    #[serde(deserialize_with = "lenient")]
    pub ai: AiPrefs,
    #[serde(deserialize_with = "lenient")]
    pub voice_input: VoiceInputPrefs,
    #[serde(deserialize_with = "lenient")]
    pub destroyer: DestroyerPrefs,
    /// Build mode: the toggle shortcut, selected block and the blocks placed on screen.
    #[serde(deserialize_with = "lenient")]
    pub build: BuildPrefs,
    /// Cherry-blossom desktop theme (decorations and falling petals).
    #[serde(deserialize_with = "lenient")]
    pub theme: ThemePrefs,
    /// Invisible platforms (lines the character can walk on) and their edit-mode shortcut.
    #[serde(deserialize_with = "lenient")]
    pub lines: LinePrefs,
    /// Chess board size, material and game mode.
    #[serde(deserialize_with = "lenient")]
    pub chess: ChessPrefs,
    /// The terrain-only Terraria world behind app windows.
    #[serde(deserialize_with = "lenient")]
    pub world: WorldPrefs,
    /// Personality, spontaneous dialogue, affection decay and the cookie shortcut.
    #[serde(deserialize_with = "lenient")]
    pub persona: PersonaPrefs,
    /// The hidden affection meter (persisted; only shown if the user asks to inspect it).
    #[serde(deserialize_with = "lenient")]
    pub affection: AffectionState,
    /// The character roster: who's on screen, who's selected (and controllable), per-character
    /// settings and affection, conversations between characters, and companion combat AI.
    #[serde(deserialize_with = "lenient")]
    pub characters: CharacterPrefs,
}

pub const CHARACTER_IDS: [&str; 6] = ["terrarian", "princess", "partygirl", "nurse", "zoologist", "goblin"];
pub const MAX_ON_SCREEN: usize = 4;
pub const HIT_SOUNDS: [&str; 3] = ["voice", "yamete", "off"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CharacterSettings {
    pub id: String,
    /// Weapon this character uses when fighting on her own ("" = her signature weapon).
    pub weapon: String,
    /// Sound when she's hit: "voice" (voice pack), "yamete" (add-on, if installed) or "off".
    pub hit_sound: String,
    /// Her own spontaneous remarks.
    pub chatter: bool,
    /// Her own affection (the original companion keeps using the top-level `affection`).
    pub affection: AffectionState,
    /// Look overrides for add-on characters (empty = her default).
    pub look: CharacterLook,
    /// A name you gave her ("" = her built-in name). Shown in settings and the Terraria HUD and
    /// journal, and answers as a Wispr Flow wake name; she still calls herself by her own name.
    pub name: String,
}

/// Longest custom name (characters).
pub const MAX_NAME: usize = 24;

/// Trimmed, single-line, at most `MAX_NAME` characters; anything unprintable is dropped.
pub fn sanitize_name(s: &str) -> String {
    let clean: String = s.chars().filter(|c| !c.is_control()).collect();
    clean.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_NAME).collect::<String>().trim().to_string()
}

/// Editable parts of an add-on character's look: skin tone, eye colour and which of the pack's
/// hairstyles she wears. Empty values mean "her default".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CharacterLook {
    pub skin: String,
    pub eyes: String,
    pub hair: u16,
}

/// Hairstyle choices per character (none: every roster character is drawn from a fixed sheet).
pub fn allowed_hair(_id: &str) -> &'static [u16] {
    &[]
}

impl CharacterLook {
    fn sanitized(mut self, id: &str) -> Self {
        let color = |c: &str| if crate::terraria::player::parse_hex(c).is_some() { c.to_string() } else { String::new() };
        self.skin = color(&self.skin);
        self.eyes = color(&self.eyes);
        if !allowed_hair(id).contains(&self.hair) {
            self.hair = 0;
        }
        self
    }
}

impl CharacterSettings {
    fn new(id: &str) -> Self {
        Self { id: id.into(), weapon: String::new(), hit_sound: "voice".into(), chatter: true, affection: AffectionState::default(), look: CharacterLook::default(), name: String::new() }
    }
}

impl Default for CharacterSettings {
    fn default() -> Self {
        Self::new("terrarian")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CharacterPrefs {
    /// Characters on screen (the selected one is always among them).
    pub active: Vec<String>,
    /// The character that Control mode drives (and that answers chat).
    pub selected: String,
    /// Characters wander over and talk to each other now and then.
    pub interactions: bool,
    /// Conversation frequency multiplier (0.25–3).
    pub interaction_frequency: f64,
    /// Companions fight bosses on their own.
    pub auto_fight: bool,
    /// Companions may fly during boss fights.
    pub ai_flight: bool,
    pub per: Vec<CharacterSettings>,
    /// How they move around (set by voice: "spread out", "more jumpy", "stay grounded", "watch").
    pub behavior: BehaviorPrefs,
}

pub const JUMP_STYLES: [&str; 3] = ["normal", "jumpy", "grounded"];

/// Persistent movement modes for every companion on screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BehaviorPrefs {
    /// Prefer different surfaces from each other (no fixed spacing).
    pub spread: bool,
    /// "normal", "jumpy" (more purposeful platform jumps) or "grounded" (far fewer optional jumps).
    pub jump: String,
    /// The invisible platform chosen as the hangout (matched by its endpoints), if any.
    pub watch: Option<Line>,
}

impl Default for BehaviorPrefs {
    fn default() -> Self {
        Self { spread: false, jump: "normal".into(), watch: None }
    }
}

impl BehaviorPrefs {
    pub fn sanitized(mut self) -> Self {
        if !JUMP_STYLES.contains(&self.jump.as_str()) {
            self.jump = "normal".into();
        }
        let ok = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
        if self.watch.is_some_and(|l| !(ok(l.x1) && ok(l.y1) && ok(l.x2) && ok(l.y2))) {
            self.watch = None;
        }
        self
    }
}

impl Default for CharacterPrefs {
    fn default() -> Self {
        Self {
            active: vec!["terrarian".into()],
            selected: "terrarian".into(),
            interactions: true,
            interaction_frequency: 1.0,
            auto_fight: true,
            ai_flight: true,
            per: CHARACTER_IDS.iter().map(|id| CharacterSettings::new(id)).collect(),
            behavior: BehaviorPrefs::default(),
        }
    }
}

impl CharacterPrefs {
    pub fn sanitized(mut self) -> Self {
        let known = |s: &str| CHARACTER_IDS.contains(&s);
        if !known(&self.selected) {
            self.selected = "terrarian".into();
        }
        let mut seen = std::collections::HashSet::new();
        self.active.retain(|id| known(id) && seen.insert(id.clone()));
        // The selected character is always on screen, even past the on-screen limit.
        match self.active.iter().position(|id| *id == self.selected) {
            Some(i) if i < MAX_ON_SCREEN => {}
            Some(i) => {
                let sel = self.active.remove(i);
                self.active.insert(0, sel);
            }
            None => self.active.insert(0, self.selected.clone()),
        }
        self.active.truncate(MAX_ON_SCREEN);
        self.interaction_frequency = clamp_or(self.interaction_frequency, 0.25, 3.0, 1.0);
        self.behavior = std::mem::take(&mut self.behavior).sanitized();
        // Exactly one settings entry per character, in roster order.
        let mut per = Vec::new();
        for id in CHARACTER_IDS {
            let mut c = self.per.iter().find(|c| c.id == id).cloned().unwrap_or_else(|| CharacterSettings::new(id));
            c.weapon = sanitize_item_id(Some(c.weapon.clone())).unwrap_or_default();
            if !HIT_SOUNDS.contains(&c.hit_sound.as_str()) {
                c.hit_sound = "voice".into();
            }
            c.affection = c.affection.sanitized();
            c.look = c.look.clone().sanitized(id);
            c.name = sanitize_name(&c.name);
            per.push(c);
        }
        self.per = per;
        self
    }
}

impl Prefs {
    /// Affection of the selected character (the original companion uses the top-level value).
    pub fn selected_affection(&self) -> f64 {
        if self.characters.selected == "terrarian" {
            self.affection.value
        } else {
            self.characters.per.iter().find(|c| c.id == self.characters.selected).map_or(30.0, |c| c.affection.value)
        }
    }
}

pub const DEFAULT_COOKIE_SHORTCUT: &str = "Control+Shift+K";
pub const PERSONA_INTENSITIES: [&str; 3] = ["subtle", "normal", "strong"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PersonaPrefs {
    /// How strongly the cute companion personality shows: "subtle", "normal" or "strong".
    pub intensity: String,
    /// Spontaneous sweet remarks and idle chatter.
    pub spontaneous: bool,
    /// Spontaneous dialogue frequency multiplier (0.25–3).
    pub frequency: f64,
    /// Cutely ask for attention when you've been away for a while.
    pub attention: bool,
    /// No spontaneous dialogue between these hours (local time, 0–23; start may be after end).
    pub quiet_hours: bool,
    pub quiet_start: u8,
    pub quiet_end: u8,
    /// Affection lost per hour of active computer use (0–10).
    pub decay: f64,
    /// Speech-bubble pinkness (0 = pale, 1 = very pink).
    pub bubble_pink: f64,
    /// Show the (normally hidden) affection value in settings.
    pub show_affection: bool,
    pub cookie_enabled: bool,
    pub cookie_shortcut: String,
}

impl Default for PersonaPrefs {
    fn default() -> Self {
        Self {
            intensity: "normal".into(),
            spontaneous: true,
            frequency: 1.0,
            attention: true,
            quiet_hours: false,
            quiet_start: 22,
            quiet_end: 8,
            decay: 1.5,
            bubble_pink: 0.5,
            show_affection: false,
            cookie_enabled: true,
            cookie_shortcut: DEFAULT_COOKIE_SHORTCUT.into(),
        }
    }
}

impl PersonaPrefs {
    pub fn sanitized(mut self) -> Self {
        let d = PersonaPrefs::default();
        if !PERSONA_INTENSITIES.contains(&self.intensity.as_str()) {
            self.intensity = d.intensity;
        }
        self.frequency = clamp_or(self.frequency, 0.25, 3.0, d.frequency);
        self.decay = clamp_or(self.decay, 0.0, 10.0, d.decay);
        self.bubble_pink = clamp_or(self.bubble_pink, 0.0, 1.0, d.bubble_pink);
        self.quiet_start = self.quiet_start.min(23);
        self.quiet_end = self.quiet_end.min(23);
        if !valid_shortcut(&self.cookie_shortcut) {
            self.cookie_shortcut = d.cookie_shortcut;
        }
        self
    }
}

/// Affection 0–100 and when it was last updated (Unix ms), so decay can resume after a restart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AffectionState {
    pub value: f64,
    pub updated: f64,
    /// Cookies received (lifetime; for variety in reactions).
    pub cookies: u32,
}

impl Default for AffectionState {
    fn default() -> Self {
        Self { value: 30.0, updated: 0.0, cookies: 0 }
    }
}

impl AffectionState {
    pub fn sanitized(mut self) -> Self {
        self.value = clamp_or(self.value, 0.0, 100.0, 30.0);
        if !self.updated.is_finite() || self.updated < 0.0 {
            self.updated = 0.0;
        }
        self
    }
}

pub const PETAL_STYLES: [&str; 4] = ["drift", "flutter", "spiral", "gusts"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemePrefs {
    pub enabled: bool,
    /// Blossom garland just below the menu bar.
    pub garland: bool,
    /// Grass and flowers along the Dock's edge.
    pub grass: bool,
    pub petals: bool,
    /// 0–1: how many petals are falling at once.
    pub density: f64,
    /// 0.25–2.5: fall speed multiplier.
    pub speed: f64,
    /// −1–1: sideways wind (negative blows left).
    pub wind: f64,
    /// 0–1: side-to-side sway.
    pub sway: f64,
    /// 0–1: how much petals tumble.
    pub spin: f64,
    /// 0.5–2: petal size multiplier.
    pub size: f64,
    /// Motion style: "drift", "flutter", "spiral" or "gusts".
    pub style: String,
    /// "behind" (behind app windows, on the desktop) or "front" (over windows, still under the
    /// menu bar and Dock, always click-through).
    pub layer: String,
    /// Desktop map (environment theme): "sakura" (cherry blossom), "snow" or "chess" (the
    /// dark-fantasy battlefield).
    pub map: String,
}

pub const MAPS: [&str; 3] = ["sakura", "snow", "chess"];

impl Default for ThemePrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            garland: true,
            grass: true,
            petals: true,
            density: 0.35,
            speed: 1.0,
            wind: 0.25,
            sway: 0.5,
            spin: 0.5,
            size: 1.0,
            style: "drift".into(),
            layer: "behind".into(),
            map: "sakura".into(),
        }
    }
}

impl ThemePrefs {
    pub fn sanitized(mut self) -> Self {
        let d = ThemePrefs::default();
        self.density = clamp_or(self.density, 0.0, 1.0, d.density);
        self.speed = clamp_or(self.speed, 0.25, 2.5, d.speed);
        self.wind = clamp_or(self.wind, -1.0, 1.0, d.wind);
        self.sway = clamp_or(self.sway, 0.0, 1.0, d.sway);
        self.spin = clamp_or(self.spin, 0.0, 1.0, d.spin);
        self.size = clamp_or(self.size, 0.5, 2.0, d.size);
        if !PETAL_STYLES.contains(&self.style.as_str()) {
            self.style = d.style;
        }
        if self.layer != "behind" && self.layer != "front" {
            self.layer = d.layer;
        }
        if !MAPS.contains(&self.map.as_str()) {
            self.map = d.map;
        }
        self
    }
}

pub const MAX_LINES: usize = 100;
pub const DEFAULT_LINES_SHORTCUT: &str = "Control+Shift+P";

/// One invisible platform: endpoints as fractions (0–1) of the usable screen area, so they stay
/// put across resolution changes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LinePrefs {
    pub toggle_enabled: bool,
    pub toggle_shortcut: String,
    /// Draw the lines faintly even outside edit mode.
    pub show: bool,
    pub items: Vec<Line>,
}

/// The background world: a seed (0 = not generated yet), zoom, saved camera, editing, and whether
/// the companions walk on the terrain. Terrain edits live in their own file (see lib.rs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorldPrefs {
    pub enabled: bool,
    pub seed: u32,
    pub zoom: f64,
    /// Camera (left / top edge, in tiles); negative = the default view.
    pub camera_x: f64,
    pub camera_y: f64,
    pub edit: bool,
    pub collide: bool,
    /// Unused since Start replaced Control Mode for the game (kept so old prefs still load).
    pub play: bool,
    /// Who plays when you press Play: "selected" (your selected companion) or a character id.
    pub player: String,
    /// Drag or scroll the bare desktop with the pan chord held to look around the world.
    pub drag: bool,
    /// The modifiers held for that ("Control", "Option", "Shift", "Command"); default ⌥⌘.
    pub pan_chord: Vec<String>,
}

impl Default for WorldPrefs {
    fn default() -> Self {
        Self { enabled: false, seed: 0, zoom: 2.0, camera_x: -1.0, camera_y: -1.0, edit: false, collide: true, play: true, player: "selected".into(), drag: true, pan_chord: default_pan_chord() }
    }
}

pub fn default_pan_chord() -> Vec<String> {
    vec!["Option".into(), "Command".into()]
}

impl WorldPrefs {
    pub fn sanitized(mut self) -> Self {
        // Known modifiers only, in a fixed order, no repeats; none left = the default.
        let chord: Vec<String> = ["Control", "Option", "Shift", "Command"].iter().filter(|m| self.pan_chord.iter().any(|c| c == *m)).map(|m| m.to_string()).collect();
        self.pan_chord = if chord.is_empty() { default_pan_chord() } else { chord };
        if !(self.zoom.is_finite() && (1.0..=4.0).contains(&self.zoom)) {
            self.zoom = 2.0;
        }
        let ok = |v: f64| v.is_finite() && (-1.0..=100_000.0).contains(&v);
        if !(ok(self.camera_x) && ok(self.camera_y)) {
            self.camera_x = -1.0;
            self.camera_y = -1.0;
        }
        if self.seed > 2_147_483_646 {
            self.seed %= 2_147_483_646;
        }
        if self.player != "selected" && !CHARACTER_IDS.contains(&self.player.as_str()) {
            self.player = "selected".into();
        }
        self
    }
}

pub const CHESS_MATERIALS: [&str; 6] = ["marble", "snow", "dungeon", "hallow", "ice", "candy"];
pub const CHESS_MODES: [&str; 3] = ["local", "companion", "lesson"];
pub const CHESS_DIFFICULTIES: [&str; 3] = ["easy", "normal", "hard"];

/// The chess board: its size (CSS px; 0 = automatic), maximized, block material, and game mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChessPrefs {
    pub board: f64,
    pub maximized: bool,
    pub material: String,
    /// "local" (two players), "companion" (play the selected companion) or "lesson" (openings).
    pub mode: String,
    /// The side you play against a companion: "w" or "b".
    pub player_color: String,
    pub difficulty: String,
    /// Where the board was dragged: fractions (0–1) of the free space; -1 = default spot.
    pub x: f64,
    pub y: f64,
}

impl Default for ChessPrefs {
    fn default() -> Self {
        Self { board: 0.0, maximized: false, material: "marble".into(), mode: "local".into(), player_color: "w".into(), difficulty: "normal".into(), x: -1.0, y: -1.0 }
    }
}

impl ChessPrefs {
    pub fn sanitized(mut self) -> Self {
        let d = Self::default();
        if !(self.board.is_finite() && (self.board == 0.0 || (200.0..=4000.0).contains(&self.board))) {
            self.board = 0.0;
        }
        if !CHESS_MATERIALS.contains(&self.material.as_str()) {
            self.material = d.material;
        }
        if !CHESS_MODES.contains(&self.mode.as_str()) {
            self.mode = d.mode;
        }
        if self.player_color != "w" && self.player_color != "b" {
            self.player_color = d.player_color;
        }
        if !CHESS_DIFFICULTIES.contains(&self.difficulty.as_str()) {
            self.difficulty = d.difficulty;
        }
        // A position is both coordinates in 0–1, or neither (-1, -1).
        let ok = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
        if !(ok(self.x) && ok(self.y)) {
            self.x = -1.0;
            self.y = -1.0;
        }
        self
    }
}

impl Default for LinePrefs {
    fn default() -> Self {
        Self { toggle_enabled: true, toggle_shortcut: DEFAULT_LINES_SHORTCUT.into(), show: false, items: Vec::new() }
    }
}

impl LinePrefs {
    /// Finite, on-screen, not degenerate, at most MAX_LINES.
    pub fn sanitized(mut self) -> Self {
        if !valid_shortcut(&self.toggle_shortcut) {
            self.toggle_shortcut = DEFAULT_LINES_SHORTCUT.into();
        }
        let ok = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
        self.items.retain(|l| ok(l.x1) && ok(l.y1) && ok(l.x2) && ok(l.y2) && (l.x2 - l.x1).hypot(l.y2 - l.y1) >= 0.005);
        self.items.truncate(MAX_LINES);
        self
    }
}

/// Most blocks that can be on screen at once.
pub const MAX_BLOCKS: usize = 400;
/// Grid limits (cells from the screen's bottom-left corner; generous for large displays).
pub const MAX_BLOCK_COL: i32 = 1000;
pub const MAX_BLOCK_ROW: i32 = 500;
pub const DEFAULT_BUILD_SHORTCUT: &str = "Control+Shift+B";
pub const BLOCK_KINDS: [&str; 3] = ["dirt", "stone", "wood"];

/// One placed block: grid column/row (row 0 sits on the screen floor) and its kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub c: i32,
    pub r: i32,
    pub k: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BuildPrefs {
    pub toggle_enabled: bool,
    pub toggle_shortcut: String,
    /// Block placed by a click: "dirt", "stone" or "wood".
    pub kind: String,
    pub blocks: Vec<Block>,
}

impl Default for BuildPrefs {
    fn default() -> Self {
        Self { toggle_enabled: true, toggle_shortcut: DEFAULT_BUILD_SHORTCUT.into(), kind: "dirt".into(), blocks: Vec::new() }
    }
}

impl BuildPrefs {
    /// Known kinds, in-range cells, no duplicates (the first placement wins), at most MAX_BLOCKS.
    pub fn sanitized(mut self) -> Self {
        if !BLOCK_KINDS.contains(&self.kind.as_str()) {
            self.kind = "dirt".into();
        }
        if !valid_shortcut(&self.toggle_shortcut) {
            self.toggle_shortcut = DEFAULT_BUILD_SHORTCUT.into();
        }
        let mut seen = std::collections::HashSet::new();
        self.blocks.retain(|b| {
            BLOCK_KINDS.contains(&b.k.as_str())
                && (0..=MAX_BLOCK_COL).contains(&b.c)
                && (0..=MAX_BLOCK_ROW).contains(&b.r)
                && seen.insert((b.c, b.r))
        });
        self.blocks.truncate(MAX_BLOCKS);
        self
    }
}

/// Letter Destroyer bookmarklet integration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DestroyerPrefs {
    /// Listen on 127.0.0.1 for the bookmarklet's pings so the buddy can react.
    pub connect: bool,
}

impl Default for DestroyerPrefs {
    fn default() -> Self {
        Self { connect: true }
    }
}

fn lenient_reactions<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<ReactionRule>, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_else(|_| default_reactions()))
}

/// Voice lines and sound effects. Volumes are 0..=1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AudioPrefs {
    /// Master mute (voice and effects).
    pub muted: bool,
    pub voice_enabled: bool,
    pub voice_volume: f64,
    pub sfx_volume: f64,
    /// Voice-pack voice: "active" (the pack's default) or a variant number.
    pub voice: String,
    /// Master volume (0–1), applied on top of the voice and effect volumes.
    pub master: f64,
}

impl Default for AudioPrefs {
    fn default() -> Self {
        Self { muted: false, voice_enabled: true, voice_volume: 0.6, sfx_volume: 0.5, voice: "active".into(), master: 1.0 }
    }
}

/// The pickaxe tool and its pointer-anchored letter effect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PickaxePrefs {
    /// Seconds between swings.
    pub cooldown: f64,
    /// Master switch for the glyph-cracking effect at the pointer.
    pub effects: bool,
}

impl Default for PickaxePrefs {
    fn default() -> Self {
        Self { cooldown: 0.45, effects: true }
    }
}

pub const MIN_PICKAXE_COOLDOWN: f64 = 0.15;
pub const MAX_PICKAXE_COOLDOWN: f64 = 2.0;

/// Character Control mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ControlPrefs {
    /// Upward speed while holding Space (CSS px/s).
    pub flight_speed: f64,
    /// Global shortcut that turns Control mode on/off.
    pub toggle_enabled: bool,
    pub toggle_shortcut: String,
    /// "terraria" (classic controls) or "silksong" (Hornet-style movement and the Needle).
    pub scheme: String,
    /// Key codes for Silksong Controls.
    pub silk_keys: SilkKeys,
    /// Key codes for Terraria Controls (arrow keys always work too).
    pub terraria_keys: TerrariaKeys,
}

/// Terraria Controls bindings (KeyboardEvent.code values). Mirrors src/overlay/controls.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TerrariaKeys {
    pub left: String,
    pub right: String,
    pub jump: String,
    /// A second jump key (W by default).
    pub jump2: String,
    pub down: String,
}

impl Default for TerrariaKeys {
    fn default() -> Self {
        let k = |s: &str| s.to_string();
        Self { left: k("KeyA"), right: k("KeyD"), jump: k("Space"), jump2: k("KeyW"), down: k("KeyS") }
    }
}

impl TerrariaKeys {
    fn slots(&mut self) -> [&mut String; 5] {
        [&mut self.left, &mut self.right, &mut self.jump, &mut self.jump2, &mut self.down]
    }

    /// Valid, conflict-free bindings (invalid or duplicate keys fall back to their defaults; if
    /// that still collides, all defaults).
    pub fn sanitized(mut self) -> Self {
        let defaults = TerrariaKeys::default();
        let mut d = defaults.clone();
        let fallback: Vec<String> = d.slots().iter().map(|s| s.to_string()).collect();
        let mut used = std::collections::HashSet::new();
        for (slot, def) in self.slots().into_iter().zip(fallback) {
            if !bindable_key(slot) || used.contains(slot.as_str()) {
                *slot = def;
            }
            used.insert(slot.clone());
        }
        let mut copy = self.clone();
        let all: std::collections::HashSet<String> = copy.slots().iter().map(|s| s.to_string()).collect();
        if all.len() == 5 { self } else { defaults }
    }
}

pub const DEFAULT_CONTROL_SHORTCUT: &str = "Control+Shift+C";

impl Default for ControlPrefs {
    fn default() -> Self {
        Self { flight_speed: 320.0, toggle_enabled: true, toggle_shortcut: DEFAULT_CONTROL_SHORTCUT.into(), scheme: "terraria".into(), silk_keys: SilkKeys::default(), terraria_keys: TerrariaKeys::default() }
    }
}

/// Silksong Controls bindings (KeyboardEvent.code values). Mirrors src/silk/keys.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SilkKeys {
    pub left: String,
    pub right: String,
    pub up: String,
    pub down: String,
    pub jump: String,
    pub dash: String,
    pub attack: String,
    pub thread: String,
    pub grapple: String,
    pub dive: String,
}

impl Default for SilkKeys {
    fn default() -> Self {
        let k = |s: &str| s.to_string();
        Self { left: k("KeyA"), right: k("KeyD"), up: k("KeyW"), down: k("KeyS"), jump: k("Space"), dash: k("KeyK"), attack: k("KeyJ"), thread: k("KeyL"), grapple: k("KeyU"), dive: k("KeyO") }
    }
}

const SILK_NAMED: [&str; 20] = [
    "Space", "ShiftLeft", "ShiftRight", "Enter", "Semicolon", "Quote", "Comma", "Period", "Slash", "BracketLeft", "BracketRight", "Backslash",
    "Backquote", "Minus", "Equal", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
];

/// A key that may be bound (Esc and modifier-only keys like Command stay reserved).
pub fn bindable_key(code: &str) -> bool {
    let letter = code.strip_prefix("Key").is_some_and(|k| k.len() == 1 && k.chars().all(|c| c.is_ascii_uppercase()));
    let digit = code.strip_prefix("Digit").is_some_and(|k| k.len() == 1 && k.chars().all(|c| c.is_ascii_digit()));
    letter || digit || SILK_NAMED.contains(&code)
}

impl SilkKeys {
    fn slots(&mut self) -> [&mut String; 10] {
        [&mut self.left, &mut self.right, &mut self.up, &mut self.down, &mut self.jump, &mut self.dash, &mut self.attack, &mut self.thread, &mut self.grapple, &mut self.dive]
    }

    /// Valid, conflict-free bindings; invalid or duplicate keys fall back to defaults (in action
    /// order), and if that still collides, all defaults are used.
    pub fn sanitized(mut self) -> Self {
        let defaults = SilkKeys::default();
        let mut d = defaults.clone();
        let fallback: Vec<String> = d.slots().iter().map(|s| s.to_string()).collect();
        let mut used = std::collections::HashSet::new();
        for (slot, def) in self.slots().into_iter().zip(fallback) {
            if !bindable_key(slot) || used.contains(slot.as_str()) {
                *slot = def;
            }
            used.insert(slot.clone());
        }
        let mut copy = self.clone();
        let all: std::collections::HashSet<String> = copy.slots().iter().map(|s| s.to_string()).collect();
        if all.len() == 10 { self } else { defaults }
    }
}

pub const MIN_FLIGHT_SPEED: f64 = 120.0;
pub const MAX_FLIGHT_SPEED: f64 = 640.0;

/// Deserialize a section, falling back to its default if it's malformed (instead of rejecting
/// the whole preferences file).
fn lenient<'de, D: serde::Deserializer<'de>, T: Default + serde::de::DeserializeOwned>(d: D) -> Result<T, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

fn clamp_or(v: f64, lo: f64, hi: f64, default: f64) -> f64 {
    if v.is_finite() { v.clamp(lo, hi) } else { default }
}

/// "active" or a short number; anything else becomes "active".
fn sanitize_voice(v: &str) -> String {
    if v == "active" || (!v.is_empty() && v.len() <= 3 && v.bytes().all(|b| b.is_ascii_digit())) { v.to_string() } else { "active".into() }
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            visible: true,
            paused: false,
            // New installs start small.
            scale: 2,
            walk_speed: 70.0,
            last_x: None,
            platforms: true,
            selected_slot: 0,
            inventory: None,
            training: false,
            appearance: crate::terraria::skins::cj_suit("terrarian"),
            companion_mode: CompanionMode::Roam,
            stay_position: None,
            idle_pose: IdlePose::Stand,
            cursor_mode: CursorMode::Off,
            hide_system_cursor: false,
            effects: EffectPrefs::default(),
            boss_difficulty: BossDifficulty::Normal,
            dock: DockPrefs::default(),
            skin: SkinId::Default,
            audio: AudioPrefs::default(),
            pickaxe: PickaxePrefs::default(),
            control: ControlPrefs::default(),
            idle: Some(IdlePrefs::default()),
            awareness: AwarenessPrefs::default(),
            reactions: default_reactions(),
            ai: AiPrefs::default(),
            voice_input: VoiceInputPrefs::default(),
            destroyer: DestroyerPrefs::default(),
            build: BuildPrefs::default(),
            theme: ThemePrefs::default(),
            lines: LinePrefs::default(),
            chess: ChessPrefs::default(),
            world: WorldPrefs::default(),
            persona: PersonaPrefs::default(),
            affection: AffectionState::default(),
            characters: CharacterPrefs::default(),
        }
    }
}

/// Partial update sent from the frontend. Absent fields are left unchanged.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrefsPatch {
    pub visible: Option<bool>,
    pub paused: Option<bool>,
    pub scale: Option<u32>,
    pub walk_speed: Option<f64>,
    pub last_x: Option<f64>,
    pub selected_slot: Option<u32>,
    pub inventory: Option<Vec<Option<String>>>,
    pub training: Option<bool>,
    pub appearance: Option<Appearance>,
    pub companion_mode: Option<CompanionMode>,
    pub stay_position: Option<StayPosition>,
    pub idle_pose: Option<IdlePose>,
    pub cursor_mode: Option<CursorMode>,
    pub hide_system_cursor: Option<bool>,
    pub effects: Option<EffectPrefs>,
    pub boss_difficulty: Option<BossDifficulty>,
    pub dock: Option<DockPatch>,
    pub skin: Option<SkinId>,
    pub audio: Option<AudioPrefs>,
    pub pickaxe: Option<PickaxePrefs>,
    pub control: Option<ControlPrefs>,
    pub build: Option<BuildPrefs>,
    pub theme: Option<ThemePrefs>,
    pub lines: Option<LinePrefs>,
    pub chess: Option<ChessPrefs>,
    pub world: Option<WorldPrefs>,
    pub persona: Option<PersonaPrefs>,
    pub affection: Option<AffectionState>,
    pub characters: Option<CharacterPrefs>,
    pub idle: Option<IdlePrefs>,
    pub awareness: Option<AwarenessPrefs>,
    pub reactions: Option<Vec<ReactionRule>>,
    pub ai: Option<AiPrefs>,
    pub voice_input: Option<VoiceInputPrefs>,
    pub destroyer: Option<DestroyerPrefs>,
}

/// Dock settings. `position` is the window's top-left in logical points (global coordinates).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DockPrefs {
    /// Whether the dock is currently shown (remembered across launches).
    pub visible: bool,
    /// What to do with `visible` at launch.
    pub on_launch: DockLaunch,
    pub expanded: bool,
    pub layout: DockLayout,
    pub position: Option<DockPosition>,
}

impl Default for DockPrefs {
    fn default() -> Self {
        // Hidden until you open it (from the menu bar or the Menu).
        Self { visible: false, on_launch: DockLaunch::Remember, expanded: true, layout: DockLayout::Full, position: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DockLaunch {
    /// Show it if it was showing when the app quit.
    #[default]
    Remember,
    Show,
    Hide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DockLayout {
    #[default]
    Full,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DockPosition {
    pub x: f64,
    pub y: f64,
}

/// Partial dock update; `resetPosition` clears the saved spot (back to bottom centre).
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DockPatch {
    pub visible: Option<bool>,
    pub on_launch: Option<DockLaunch>,
    pub expanded: Option<bool>,
    pub layout: Option<DockLayout>,
    pub position: Option<DockPosition>,
    pub reset_position: bool,
}

fn lenient_dock<'de, D: serde::Deserializer<'de>>(d: D) -> Result<DockPrefs, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

/// Saved coordinates beyond this are treated as corrupt.
const MAX_DOCK_COORD: f64 = 100_000.0;

impl DockPrefs {
    fn sanitized(mut self) -> Self {
        self.position = self
            .position
            .filter(|p| p.x.is_finite() && p.y.is_finite() && p.x.abs() <= MAX_DOCK_COORD && p.y.abs() <= MAX_DOCK_COORD);
        self
    }

    /// Visibility right after launch.
    pub fn launch_visible(&self) -> bool {
        match self.on_launch {
            DockLaunch::Remember => self.visible,
            DockLaunch::Show => true,
            DockLaunch::Hide => false,
        }
    }

    pub fn apply(&mut self, patch: &DockPatch) {
        if let Some(v) = patch.visible {
            self.visible = v;
        }
        if let Some(l) = patch.on_launch {
            self.on_launch = l;
        }
        if let Some(e) = patch.expanded {
            self.expanded = e;
        }
        if let Some(l) = patch.layout {
            self.layout = l;
        }
        if let Some(p) = patch.position {
            self.position = Some(p);
        }
        if patch.reset_position {
            self.position = None;
        }
    }
}

/// Roam freely (wander, platform-hop, pursue targets) or stay put at a chosen spot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CompanionMode {
    #[default]
    Roam,
    Stay,
}

/// Pose shown while staying put.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum IdlePose {
    #[default]
    Stand,
    Sit,
    Wave,
    /// Standing and glancing left and right.
    LookAround,
    /// Sitting and swinging the legs.
    SwingLegs,
    /// Sitting with the head down, napping.
    Nap,
}

/// Idle-pose behaviour while staying put: rotate through poses or hold `idle_pose`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum IdleMode {
    #[default]
    Rotate,
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct IdlePrefs {
    pub mode: IdleMode,
    /// Seconds between pose changes when rotating.
    pub interval: f64,
    /// Freeze pose animation (and rotation).
    pub paused: bool,
}

impl Default for IdlePrefs {
    fn default() -> Self {
        Self { mode: IdleMode::Rotate, interval: 45.0, paused: false }
    }
}

pub const MIN_IDLE_INTERVAL: f64 = 10.0;
pub const MAX_IDLE_INTERVAL: f64 = 600.0;

/// Screen awareness and privacy. App awareness reads only the frontmost app's bundle id and name;
/// screen understanding (screenshots) is a separate, explicit, off-by-default feature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AwarenessPrefs {
    /// React when you switch apps.
    pub app_enabled: bool,
    /// Allow "Ask about my screen" (one screenshot per question, with permission).
    pub screen_enabled: bool,
    /// Keep a small copy of screenshots in the chat (only saved if history is kept too).
    pub keep_screenshots: bool,
    /// Save the chat across launches.
    pub keep_history: bool,
    /// Bundle ids that are never reacted to and never captured.
    pub excluded: Vec<String>,
    /// Quiet mode: no spoken reactions.
    pub quiet: bool,
    /// Quiet mode also hides text reactions (speech bubbles).
    pub quiet_text: bool,
}

/// Password managers, keychain and system authentication UI: excluded by default.
pub const DEFAULT_EXCLUDED: [&str; 8] = [
    "com.1password.1password",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "com.apple.keychainaccess",
    "com.apple.Passwords",
    "com.apple.loginwindow",
    "com.apple.SecurityAgent",
    "com.apple.systempreferences",
];

impl Default for AwarenessPrefs {
    fn default() -> Self {
        Self {
            app_enabled: true,
            screen_enabled: false,
            keep_screenshots: false,
            keep_history: false,
            excluded: DEFAULT_EXCLUDED.iter().map(|s| s.to_string()).collect(),
            quiet: false,
            quiet_text: false,
        }
    }
}

/// How the companion reacts when a given app comes to the front.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ReactionRule {
    pub id: String,
    /// Bundle id, or "*" for any app without its own rule.
    pub bundle_id: String,
    pub name: String,
    pub enabled: bool,
    pub comments: Vec<String>,
    /// "none", "random" or a voice clip ("hit0", "hit1", "hit2", "killed").
    pub voice: String,
    /// "none", "wave", "hug", "jump", "sit" or "nap".
    pub animation: String,
    /// Seconds before this app can trigger again.
    pub cooldown: f64,
    /// Chance (0..1) of reacting when allowed.
    pub chance: f64,
    /// Text only for this app (no voice).
    pub quiet: bool,
    /// Also react when switching between this app's windows.
    pub window_switches: bool,
}

impl Default for ReactionRule {
    fn default() -> Self {
        Self {
            id: "rule".into(),
            bundle_id: "*".into(),
            name: "Any app".into(),
            enabled: true,
            comments: Vec::new(),
            voice: "none".into(),
            animation: "wave".into(),
            cooldown: 1800.0,
            chance: 0.35,
            quiet: false,
            window_switches: false,
        }
    }
}

pub const MAX_RULES: usize = 40;
pub const MAX_COMMENTS: usize = 20;
pub const MAX_COMMENT_LEN: usize = 200;
const VOICES: [&str; 6] = ["none", "random", "hit0", "hit1", "hit2", "killed"];
const ANIMATIONS: [&str; 6] = ["none", "wave", "hug", "jump", "sit", "nap"];

pub fn default_reactions() -> Vec<ReactionRule> {
    let rule = |id: &str, bundle: &str, name: &str, comments: &[&str], cooldown: f64, chance: f64, animation: &str| ReactionRule {
        id: id.into(),
        bundle_id: bundle.into(),
        name: name.into(),
        comments: comments.iter().map(|c| c.to_string()).collect(),
        cooldown,
        chance,
        animation: animation.into(),
        ..ReactionRule::default()
    };
    vec![
        rule("terraria", "org.Terraria", "Terraria", &["S-sempai welcome back! Ready for another adventure?", "Ooh, adventure time! I'll be right here cheering~"], 900.0, 1.0, "jump"),
        rule("vscode", "com.microsoft.VSCode", "Visual Studio Code", &["You've got this! I'm cheering for you~", "Ehehe, look at you go!", "Take your time. You're doing great!"], 1800.0, 0.5, "wave"),
        rule(
            "any",
            "*",
            "Any other app",
            &["You've got this! I'm cheering for you~", "Ehehe, look at you go!", "Need a little help? I'm right here!", "S-sempai welcome back! Ready for another adventure?", "Take your time. You're doing great!"],
            1800.0,
            0.25,
            "wave",
        ),
    ]
}

/// Answer generation (local Ollama).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiPrefs {
    /// "auto" or an installed Ollama model name.
    pub model: String,
    /// Answer length: "short", "medium" or "long".
    pub length: String,
}

impl Default for AiPrefs {
    fn default() -> Self {
        Self { model: "auto".into(), length: "medium".into() }
    }
}

/// Voice input (push-to-talk) settings. Recording itself isn't implemented yet; these are stored
/// and validated so the shortcut and microphone are ready when it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VoiceInputPrefs {
    pub enabled: bool,
    /// Global shortcut in accelerator form, e.g. "Control+Shift+Space".
    pub shortcut: String,
    /// "hold" (press and hold to talk) or "toggle" (press to start, again to stop).
    pub mode: String,
    /// Microphone device id from the WebView ("default" = system default).
    pub microphone: String,
    /// Show the recognised text for editing before it's sent (ignored while auto-submit is on).
    pub review: bool,
    /// Send automatically once you stop speaking (after `silence` seconds).
    pub auto_submit: bool,
    /// Seconds of silence that end the recording (1–6).
    pub silence: f64,
    /// Where voice comes from: "wispr" (Wispr Flow dictates into her input, the default) or
    /// "apple" (her own push-to-talk, transcribed with Apple Speech).
    pub source: String,
}

pub const DEFAULT_VOICE_SHORTCUT: &str = "Control+Shift+Space";

impl Default for VoiceInputPrefs {
    fn default() -> Self {
        Self { enabled: false, shortcut: DEFAULT_VOICE_SHORTCUT.into(), mode: "hold".into(), microphone: "default".into(), review: true, auto_submit: true, silence: 2.0, source: "wispr".into() }
    }
}

const SHORTCUT_MODIFIERS: [&str; 4] = ["Control", "Option", "Command", "Shift"];

/// A shortcut needs at least one of Control/Option/Command (Shift alone would collide with
/// typing) plus exactly one key: a letter, digit, F1–F20, Space, or a few named keys.
pub fn valid_shortcut(s: &str) -> bool {
    let parts: Vec<&str> = s.split('+').collect();
    if parts.len() < 2 || parts.len() > 5 || s.len() > 60 {
        return false;
    }
    let (key, mods) = parts.split_last().unwrap();
    let mut seen = std::collections::HashSet::new();
    if !mods.iter().all(|m| SHORTCUT_MODIFIERS.contains(m) && seen.insert(*m)) {
        return false;
    }
    if !mods.iter().any(|m| *m != "Shift") {
        return false;
    }
    let named = ["Space", "Enter", "Tab", "Backquote", "Slash", "Period", "Comma", "Semicolon"];
    let f_key = key.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=20).contains(&n));
    (key.len() == 1 && key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())) || named.contains(key) || f_key
}

fn clean_text(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(max).collect::<String>().trim().to_string()
}

fn valid_bundle(s: &str) -> bool {
    s == "*" || (!s.is_empty() && s.len() <= 200 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b)))
}

impl ReactionRule {
    fn sanitized(mut self, index: usize) -> Option<Self> {
        if !valid_bundle(&self.bundle_id) {
            return None;
        }
        self.id = clean_text(&self.id, 40);
        if self.id.is_empty() || !self.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            self.id = format!("rule{index}");
        }
        self.name = clean_text(&self.name, 80);
        if self.name.is_empty() {
            self.name = self.bundle_id.clone();
        }
        self.comments = self.comments.iter().map(|c| clean_text(c, MAX_COMMENT_LEN)).filter(|c| !c.is_empty()).take(MAX_COMMENTS).collect();
        if !VOICES.contains(&self.voice.as_str()) {
            self.voice = "none".into();
        }
        if !ANIMATIONS.contains(&self.animation.as_str()) {
            self.animation = "none".into();
        }
        self.cooldown = clamp_or(self.cooldown, 10.0, 86_400.0, 1800.0);
        self.chance = clamp_or(self.chance, 0.0, 1.0, 1.0);
        Some(self)
    }
}

/// Visual cursor companion modes. None of them move, click or replace the real cursor by
/// default; `hide_system_cursor` (Become only) is a separate, opt-in setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CursorMode {
    #[default]
    Off,
    Ride,
    Hug,
    Become,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum BossDifficulty {
    Easy,
    #[default]
    Normal,
    Expert,
    Master,
}

/// Where to stay put, as fractions (0..=1) of the usable screen.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct StayPosition {
    pub x: f64,
    pub y: f64,
}

pub const MAX_EFFECT_WORD_LEN: usize = 16;

/// Temporary visual effects (all app-owned, drawn only on the companion's overlay).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EffectPrefs {
    /// Master switch for the synthetic letter-smash effect.
    pub letter_break: bool,
    /// The synthetic word that gets smashed (A–Z, 0–9, space).
    pub word: String,
}

impl Default for EffectPrefs {
    fn default() -> Self {
        Self { letter_break: true, word: "TERRARIA".into() }
    }
}

/// Keep only A–Z, 0–9 and spaces (upper-cased), trimmed and at most 16 characters.
fn sanitize_word(word: &str) -> String {
    let cleaned: String = word.to_ascii_uppercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ').collect();
    let limited: String = cleaned.trim().chars().take(MAX_EFFECT_WORD_LEN).collect();
    let trimmed = limited.trim();
    if trimmed.is_empty() { EffectPrefs::default().word } else { trimmed.to_string() }
}

/// Accept only short ASCII slugs; anything else becomes an empty slot.
fn sanitize_item_id(id: Option<String>) -> Option<String> {
    id.filter(|s| {
        !s.is_empty()
            && s.len() <= MAX_ITEM_ID_LEN
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })
}

impl Prefs {
    /// Clamp every field into its valid range so bad or hand-edited files can't break the app.
    pub fn sanitized(mut self) -> Self {
        self.scale = self.scale.clamp(MIN_SCALE, MAX_SCALE);
        self.walk_speed = if self.walk_speed.is_finite() {
            self.walk_speed.clamp(MIN_WALK_SPEED, MAX_WALK_SPEED)
        } else {
            Prefs::default().walk_speed
        };
        self.last_x = self.last_x.filter(|x| x.is_finite()).map(|x| x.clamp(0.0, 1.0));
        self.selected_slot = self.selected_slot.min(HOTBAR_SLOTS - 1);
        self.appearance = self.appearance.sanitized();
        self.stay_position = self
            .stay_position
            .filter(|p| p.x.is_finite() && p.y.is_finite())
            .map(|p| StayPosition { x: p.x.clamp(0.0, 1.0), y: p.y.clamp(0.0, 1.0) });
        self.effects.word = sanitize_word(&self.effects.word);
        self.dock = self.dock.sanitized();
        let a = AudioPrefs::default();
        self.audio.voice_volume = clamp_or(self.audio.voice_volume, 0.0, 1.0, a.voice_volume);
        self.audio.sfx_volume = clamp_or(self.audio.sfx_volume, 0.0, 1.0, a.sfx_volume);
        self.audio.voice = sanitize_voice(&self.audio.voice);
        self.pickaxe.cooldown = clamp_or(self.pickaxe.cooldown, MIN_PICKAXE_COOLDOWN, MAX_PICKAXE_COOLDOWN, PickaxePrefs::default().cooldown);
        // Migration: older files have no idle section. Keep a chosen non-standing pose fixed;
        // otherwise start rotating.
        let mut idle = self.idle.take().unwrap_or(IdlePrefs {
            mode: if self.idle_pose == IdlePose::Stand { IdleMode::Rotate } else { IdleMode::Fixed },
            ..IdlePrefs::default()
        });
        idle.interval = clamp_or(idle.interval, MIN_IDLE_INTERVAL, MAX_IDLE_INTERVAL, IdlePrefs::default().interval);
        self.idle = Some(idle);
        self.awareness.excluded = self.awareness.excluded.iter().map(|e| clean_text(e, 200)).filter(|e| valid_bundle(e) && e != "*").take(100).collect();
        self.awareness.excluded.dedup();
        self.reactions = self.reactions.drain(..).take(MAX_RULES).enumerate().filter_map(|(i, r)| r.sanitized(i)).collect();
        let mut seen = std::collections::HashSet::new();
        for (i, r) in self.reactions.iter_mut().enumerate() {
            if !seen.insert(r.id.clone()) {
                r.id = format!("{}-{i}", r.id);
            }
        }
        self.ai.model = clean_text(&self.ai.model, 80);
        if self.ai.model.is_empty() || !self.ai.model.bytes().all(|b| b.is_ascii_alphanumeric() || b":._-/".contains(&b)) {
            self.ai.model = "auto".into();
        }
        if !["short", "medium", "long"].contains(&self.ai.length.as_str()) {
            self.ai.length = "medium".into();
        }
        let vd = VoiceInputPrefs::default();
        if !valid_shortcut(&self.voice_input.shortcut) {
            self.voice_input.shortcut = vd.shortcut;
        }
        if self.voice_input.mode != "hold" && self.voice_input.mode != "toggle" {
            self.voice_input.mode = vd.mode;
        }
        if self.voice_input.source != "wispr" && self.voice_input.source != "apple" {
            self.voice_input.source = vd.source;
        }
        self.voice_input.microphone = clean_text(&self.voice_input.microphone, 200);
        if self.voice_input.microphone.is_empty() {
            self.voice_input.microphone = vd.microphone;
        }
        self.control.flight_speed = clamp_or(self.control.flight_speed, MIN_FLIGHT_SPEED, MAX_FLIGHT_SPEED, ControlPrefs::default().flight_speed);
        if !valid_shortcut(&self.control.toggle_shortcut) {
            self.control.toggle_shortcut = DEFAULT_CONTROL_SHORTCUT.into();
        }
        if self.control.scheme != "terraria" && self.control.scheme != "silksong" {
            self.control.scheme = "terraria".into();
        }
        self.control.silk_keys = self.control.silk_keys.clone().sanitized();
        self.control.terraria_keys = self.control.terraria_keys.clone().sanitized();
        self.build = std::mem::take(&mut self.build).sanitized();
        self.theme = std::mem::take(&mut self.theme).sanitized();
        self.lines = std::mem::take(&mut self.lines).sanitized();
        self.chess = std::mem::take(&mut self.chess).sanitized();
        self.world = std::mem::take(&mut self.world).sanitized();
        self.persona = std::mem::take(&mut self.persona).sanitized();
        self.affection = std::mem::take(&mut self.affection).sanitized();
        self.characters = std::mem::take(&mut self.characters).sanitized();
        self.audio.master = clamp_or(self.audio.master, 0.0, 1.0, 1.0);
        self.voice_input.silence = clamp_or(self.voice_input.silence, 1.0, 6.0, 2.0);
        self.inventory = self.inventory.map(|slots| {
            let mut slots: Vec<Option<String>> =
                slots.into_iter().take(INVENTORY_SLOTS).map(sanitize_item_id).collect();
            slots.resize(INVENTORY_SLOTS, None);
            slots
        });
        self
    }

    pub fn apply(&mut self, patch: &PrefsPatch) {
        if let Some(v) = patch.visible {
            self.visible = v;
        }
        if let Some(p) = patch.paused {
            self.paused = p;
        }
        if let Some(scale) = patch.scale {
            self.scale = scale;
        }
        if let Some(speed) = patch.walk_speed {
            self.walk_speed = speed;
        }
        if let Some(x) = patch.last_x {
            self.last_x = Some(x);
        }
        if let Some(slot) = patch.selected_slot {
            self.selected_slot = slot;
        }
        if let Some(inventory) = &patch.inventory {
            self.inventory = Some(inventory.clone());
        }
        if let Some(training) = patch.training {
            self.training = training;
        }
        if let Some(appearance) = &patch.appearance {
            self.appearance = appearance.clone();
        }
        if let Some(mode) = patch.companion_mode {
            self.companion_mode = mode;
        }
        if let Some(pos) = patch.stay_position {
            self.stay_position = Some(pos);
        }
        if let Some(pose) = patch.idle_pose {
            self.idle_pose = pose;
        }
        if let Some(mode) = patch.cursor_mode {
            self.cursor_mode = mode;
        }
        if let Some(hide) = patch.hide_system_cursor {
            self.hide_system_cursor = hide;
        }
        if let Some(effects) = &patch.effects {
            self.effects = effects.clone();
        }
        if let Some(d) = patch.boss_difficulty {
            self.boss_difficulty = d;
        }
        if let Some(dock) = &patch.dock {
            self.dock.apply(dock);
        }
        if let Some(skin) = patch.skin {
            self.skin = skin;
        }
        if let Some(audio) = &patch.audio {
            self.audio = audio.clone();
        }
        if let Some(pickaxe) = &patch.pickaxe {
            self.pickaxe = pickaxe.clone();
        }
        if let Some(control) = &patch.control {
            self.control = control.clone();
        }
        if let Some(build) = &patch.build {
            self.build = build.clone();
        }
        if let Some(theme) = &patch.theme {
            self.theme = theme.clone();
        }
        if let Some(lines) = &patch.lines {
            self.lines = lines.clone();
        }
        if let Some(chess) = &patch.chess {
            self.chess = chess.clone();
        }
        if let Some(world) = &patch.world {
            self.world = world.clone();
        }
        if let Some(persona) = &patch.persona {
            self.persona = persona.clone();
        }
        if let Some(affection) = &patch.affection {
            self.affection = affection.clone();
        }
        if let Some(characters) = &patch.characters {
            self.characters = characters.clone();
        }
        if let Some(idle) = &patch.idle {
            self.idle = Some(idle.clone());
        }
        if let Some(a) = &patch.awareness {
            self.awareness = a.clone();
        }
        if let Some(r) = &patch.reactions {
            self.reactions = r.clone();
        }
        if let Some(ai) = &patch.ai {
            self.ai = ai.clone();
        }
        if let Some(v) = &patch.voice_input {
            self.voice_input = v.clone();
        }
        if let Some(d) = &patch.destroyer {
            self.destroyer = d.clone();
        }
        *self = self.clone().sanitized();
    }
}

/// Load preferences, falling back to defaults when the file is missing or unreadable.
pub fn load(path: &Path) -> Prefs {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Prefs>(&text).ok())
        .unwrap_or_default()
        .sanitized()
}

/// Save preferences atomically (write to a temp file, then rename over the target).
pub fn save(path: &Path, prefs: &Prefs) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(prefs).map_err(io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "terraria-companion-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = fs::remove_dir_all(&dir);
        dir.join("prefs.json")
    }

    #[test]
    fn missing_file_yields_defaults() {
        assert_eq!(load(&temp_path("missing")), Prefs::default());
    }

    #[test]
    fn corrupt_file_yields_defaults() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Prefs::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let path = temp_path("roundtrip");
        let prefs = Prefs {
            visible: false,
            paused: true,
            scale: 4,
            walk_speed: 120.0,
            last_x: Some(0.25),
            platforms: false,
            selected_slot: 3,
            inventory: Some({
                let mut slots = vec![None; INVENTORY_SLOTS];
                slots[0] = Some("ember-blade".into());
                slots
            }),
            training: true,
            appearance: Appearance { hair: 12, skin_variant: 4, ..Appearance::default() },
            companion_mode: CompanionMode::Stay,
            stay_position: Some(StayPosition { x: 0.3, y: 0.6 }),
            idle_pose: IdlePose::Wave,
            cursor_mode: CursorMode::Hug,
            hide_system_cursor: true,
            effects: EffectPrefs { letter_break: false, word: "HI".into() },
            boss_difficulty: BossDifficulty::Master,
            dock: DockPrefs {
                visible: false,
                on_launch: DockLaunch::Show,
                expanded: false,
                layout: DockLayout::Compact,
                position: Some(DockPosition { x: 120.0, y: 640.0 }),
            },
            skin: SkinId::Waifu2b,
            audio: AudioPrefs { muted: true, voice_enabled: false, voice_volume: 0.3, sfx_volume: 0.9, voice: "13".into(), master: 0.8 },
            pickaxe: PickaxePrefs { cooldown: 1.0, effects: false },
            control: ControlPrefs {
                flight_speed: 500.0,
                toggle_enabled: false,
                toggle_shortcut: "Option+Command+M".into(),
                scheme: "silksong".into(),
                silk_keys: SilkKeys { attack: "KeyX".into(), dash: "ShiftLeft".into(), ..SilkKeys::default() },
                terraria_keys: TerrariaKeys { left: "KeyJ".into(), right: "KeyL".into(), ..TerrariaKeys::default() },
            },
            idle: Some(IdlePrefs { mode: IdleMode::Fixed, interval: 120.0, paused: true }),
            awareness: AwarenessPrefs { app_enabled: false, screen_enabled: true, keep_history: true, quiet: true, excluded: vec!["com.apple.Safari".into()], ..AwarenessPrefs::default() },
            reactions: vec![ReactionRule { id: "x".into(), bundle_id: "com.apple.Safari".into(), name: "Safari".into(), comments: vec!["hi".into()], ..ReactionRule::default() }],
            ai: AiPrefs { model: "qwen3.5:2b".into(), length: "long".into() },
            voice_input: VoiceInputPrefs { enabled: true, shortcut: "Option+Command+K".into(), mode: "toggle".into(), microphone: "abc123".into(), review: false, ..VoiceInputPrefs::default() },
            destroyer: DestroyerPrefs { connect: false },
            build: BuildPrefs { kind: "stone".into(), blocks: vec![Block { c: 2, r: 0, k: "wood".into() }], ..BuildPrefs::default() },
            theme: ThemePrefs { style: "spiral".into(), wind: -0.5, ..ThemePrefs::default() },
            lines: LinePrefs { show: true, items: vec![Line { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.55 }], ..LinePrefs::default() },
            chess: ChessPrefs { board: 640.0, maximized: true, material: "ice".into(), mode: "companion".into(), player_color: "b".into(), difficulty: "hard".into(), x: 0.25, y: 0.5 },
            world: WorldPrefs { enabled: true, seed: 777, zoom: 3.0, camera_x: 120.5, camera_y: 140.0, edit: true, collide: false, play: false, player: "princess".into(), drag: false, pan_chord: vec!["Shift".into(), "Command".into()] },
            persona: PersonaPrefs { intensity: "strong".into(), quiet_hours: true, ..PersonaPrefs::default() },
            affection: AffectionState { value: 64.5, updated: 1_700_000_000_000.0, cookies: 3 },
            characters: CharacterPrefs { active: vec!["terrarian".into(), "goblin".into()], selected: "goblin".into(), ..CharacterPrefs::default() },
        };
        save(&path, &prefs).unwrap();
        assert_eq!(load(&path), prefs);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn partial_file_fills_in_defaults_and_ignores_unknown_fields() {
        let path = temp_path("partial");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"paused": true, "futureField": 1}"#).unwrap();
        let prefs = load(&path);
        assert!(prefs.paused);
        assert_eq!(prefs.scale, Prefs::default().scale);
    }

    #[test]
    fn sanitize_clamps_out_of_range_values() {
        let prefs = Prefs {
            scale: 99,
            walk_speed: f64::NAN,
            last_x: Some(3.0),
            ..Prefs::default()
        }
        .sanitized();
        assert_eq!(prefs.scale, MAX_SCALE);
        assert_eq!(prefs.walk_speed, Prefs::default().walk_speed);
        assert_eq!(prefs.last_x, Some(1.0));

        let prefs = Prefs { scale: 0, walk_speed: 1.0, ..Prefs::default() }.sanitized();
        assert_eq!(prefs.scale, MIN_SCALE);
        assert_eq!(prefs.walk_speed, MIN_WALK_SPEED);
    }

    #[test]
    fn sanitize_inventory_and_selected_slot() {
        let mut long = vec![Some("pine-bow".to_string()); 80];
        long[1] = Some("../../etc/passwd".into());
        long[2] = Some("x".repeat(MAX_ITEM_ID_LEN + 1));
        long[3] = Some(String::new());
        let prefs = Prefs { selected_slot: 42, inventory: Some(long), ..Prefs::default() }.sanitized();
        assert_eq!(prefs.selected_slot, HOTBAR_SLOTS - 1);
        let slots = prefs.inventory.unwrap();
        assert_eq!(slots.len(), INVENTORY_SLOTS);
        assert_eq!(slots[0].as_deref(), Some("pine-bow"));
        assert_eq!(slots[1], None);
        assert_eq!(slots[2], None);
        assert_eq!(slots[3], None);

        let short = Prefs { inventory: Some(vec![Some("a".into())]), ..Prefs::default() }.sanitized();
        assert_eq!(short.inventory.unwrap().len(), INVENTORY_SLOTS);
    }

    #[test]
    fn patch_sets_combat_fields() {
        let mut prefs = Prefs::default();
        prefs.apply(&PrefsPatch {
            selected_slot: Some(4),
            training: Some(true),
            inventory: Some(vec![Some("spark-wand".into())]),
            ..Default::default()
        });
        assert_eq!(prefs.selected_slot, 4);
        assert!(prefs.training);
        assert_eq!(prefs.inventory.as_ref().unwrap()[0].as_deref(), Some("spark-wand"));
        // Fields absent from a later patch are untouched.
        prefs.apply(&PrefsPatch { last_x: Some(0.1), ..Default::default() });
        assert_eq!(prefs.selected_slot, 4);
        assert!(prefs.inventory.is_some());
    }

    #[test]
    fn appearance_persists_and_is_sanitized() {
        let path = temp_path("appearance");
        let mut prefs = Prefs::default();
        let mut look = Appearance { hair: 9, skin_variant: 99, ..Appearance::default() };
        look.colors.shirt = "#123ABC".into();
        prefs.apply(&PrefsPatch { appearance: Some(look), ..Default::default() });
        assert_eq!(prefs.appearance.hair, 9);
        assert_eq!(prefs.appearance.skin_variant, crate::terraria::player::MAX_VARIANT);
        assert_eq!(prefs.appearance.colors.shirt, "#123abc");
        save(&path, &prefs).unwrap();
        assert_eq!(load(&path).appearance, prefs.appearance);

        // Old preference files without an appearance load the default look (CJ Ver: Morgan's suit).
        fs::write(&path, r#"{"scale": 3}"#).unwrap();
        assert_eq!(load(&path).appearance, crate::terraria::skins::cj_suit("terrarian"));
        // A malformed colour in a hand-edited file is repaired, not fatal.
        fs::write(&path, r#"{"appearance": {"hair": 4, "colors": {"skin": "blue"}}}"#).unwrap();
        let loaded = load(&path).appearance;
        assert_eq!(loaded.hair, 4);
        assert_eq!(loaded.colors.skin, crate::terraria::player::AppearanceColors::default().skin);
    }

    #[test]
    fn modes_effects_and_difficulty_persist_and_validate() {
        let path = temp_path("modes");
        let mut prefs = Prefs::default();
        prefs.apply(&PrefsPatch {
            companion_mode: Some(CompanionMode::Stay),
            stay_position: Some(StayPosition { x: 1.7, y: f64::NAN }),
            idle_pose: Some(IdlePose::Sit),
            cursor_mode: Some(CursorMode::Ride),
            hide_system_cursor: Some(true),
            effects: Some(EffectPrefs { letter_break: false, word: "  hello, world!! 12345678 ".into() }),
            boss_difficulty: Some(BossDifficulty::Expert),
            ..Default::default()
        });
        assert_eq!(prefs.companion_mode, CompanionMode::Stay);
        assert_eq!(prefs.stay_position, None, "non-finite positions are dropped");
        prefs.apply(&PrefsPatch { stay_position: Some(StayPosition { x: 1.7, y: -0.2 }), ..Default::default() });
        assert_eq!(prefs.stay_position, Some(StayPosition { x: 1.0, y: 0.0 }));
        assert_eq!(prefs.effects.word, "HELLO WORLD 1234");
        assert!(!prefs.effects.letter_break);
        save(&path, &prefs).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded, prefs);
        assert_eq!(loaded.idle_pose, IdlePose::Sit);
        assert_eq!(loaded.cursor_mode, CursorMode::Ride);
        assert_eq!(loaded.boss_difficulty, BossDifficulty::Expert);

        // Unknown enum values in a hand-edited file fall back to defaults instead of failing.
        fs::write(&path, r#"{"cursorMode": "teleport", "scale": 4}"#).unwrap();
        let fallback = load(&path);
        assert_eq!(fallback, Prefs::default(), "an invalid field makes the whole file fall back safely");
        // An empty or symbol-only word becomes the default word.
        assert_eq!(sanitize_word("!!!"), "TERRARIA");
    }

    #[test]
    fn patch_updates_only_given_fields() {
        let mut prefs = Prefs::default();
        prefs.apply(&PrefsPatch { last_x: Some(0.5), ..Default::default() });
        assert_eq!(prefs.last_x, Some(0.5));
        assert_eq!(prefs.scale, Prefs::default().scale);
        prefs.apply(&PrefsPatch { scale: Some(10), ..Default::default() });
        assert_eq!(prefs.scale, MAX_SCALE);
    }

    #[test]
    fn dock_defaults_patches_and_stale_values() {
        let mut p = Prefs::default();
        // A new install starts with the dock hidden, and small.
        assert!(!p.dock.visible && p.dock.expanded && p.dock.position.is_none());
        assert_eq!(p.scale, 2);
        p.apply(&PrefsPatch {
            dock: Some(DockPatch { expanded: Some(false), position: Some(DockPosition { x: 10.0, y: 20.0 }), ..Default::default() }),
            ..Default::default()
        });
        assert!(!p.dock.expanded && !p.dock.visible);
        assert_eq!(p.dock.position, Some(DockPosition { x: 10.0, y: 20.0 }));
        p.apply(&PrefsPatch { dock: Some(DockPatch { reset_position: true, ..Default::default() }), ..Default::default() });
        assert_eq!(p.dock.position, None);
        // Corrupt coordinates are dropped.
        p.dock.position = Some(DockPosition { x: f64::NAN, y: 1.0 });
        assert_eq!(p.clone().sanitized().dock.position, None);
        p.dock.position = Some(DockPosition { x: 1e9, y: 1.0 });
        assert_eq!(p.sanitized().dock.position, None);
    }

    #[test]
    fn dock_launch_visibility() {
        let mut d = DockPrefs { visible: false, ..DockPrefs::default() };
        assert!(!d.launch_visible());
        d.on_launch = DockLaunch::Show;
        assert!(d.launch_visible());
        d.visible = true;
        d.on_launch = DockLaunch::Hide;
        assert!(!d.launch_visible());
    }

    #[test]
    fn old_prefs_files_without_dock_load_with_defaults() {
        let path = temp_path("nodock");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"visible":true,"scale":3,"dock":{"layout":"bogus"}}"#).unwrap();
        // An invalid dock section resets only the dock; the rest of the file is kept.
        let p = load(&path);
        assert_eq!(p.dock, DockPrefs::default());
        fs::write(&path, r#"{"visible":false,"dock":{"expanded":false,"layout":"bogus"}}"#).unwrap();
        let p = load(&path);
        assert!(!p.visible);
        assert_eq!(p.dock, DockPrefs::default());
        fs::write(&path, r#"{"visible":false}"#).unwrap();
        let p = load(&path);
        assert!(!p.visible);
        assert_eq!(p.dock, DockPrefs::default());
    }

    #[test]
    fn skin_audio_pickaxe_and_flight_are_validated() {
        let mut p = Prefs::default();
        assert_eq!(p.skin, SkinId::Default);
        p.apply(&PrefsPatch {
            skin: Some(SkinId::Waifu2b),
            audio: Some(AudioPrefs { muted: false, voice_enabled: true, voice_volume: 7.0, sfx_volume: f64::NAN, voice: "../etc".into(), master: 1.0 }),
            pickaxe: Some(PickaxePrefs { cooldown: 0.0, effects: true }),
            control: Some(ControlPrefs { flight_speed: 1e9, toggle_enabled: true, toggle_shortcut: "Shift+M".into(), ..ControlPrefs::default() }),
            ..Default::default()
        });
        assert_eq!(p.skin, SkinId::Waifu2b);
        assert_eq!(p.audio.voice_volume, 1.0);
        assert_eq!(p.audio.sfx_volume, AudioPrefs::default().sfx_volume);
        assert_eq!(p.audio.voice, "active");
        assert_eq!(p.pickaxe.cooldown, MIN_PICKAXE_COOLDOWN);
        assert_eq!(p.control.flight_speed, MAX_FLIGHT_SPEED);
        assert_eq!(p.control.toggle_shortcut, DEFAULT_CONTROL_SHORTCUT); // Shift alone isn't allowed
        assert!(valid_shortcut(DEFAULT_CONTROL_SHORTCUT));
    }

    #[test]
    fn malformed_new_sections_reset_only_themselves() {
        let path = temp_path("lenient-new");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"visible":false,"skin":"bogus","audio":{"voiceVolume":"loud"},"pickaxe":7,"control":null}"#).unwrap();
        let p = load(&path);
        assert!(!p.visible);
        assert_eq!(p.skin, SkinId::Default);
        assert_eq!(p.audio, AudioPrefs::default());
        assert_eq!(p.pickaxe, PickaxePrefs::default());
        assert_eq!(p.control, ControlPrefs::default());
        fs::write(&path, r#"{"skin":"waifu2b","audio":{"voice":"7","muted":true}}"#).unwrap();
        let p = load(&path);
        assert_eq!(p.skin, SkinId::Waifu2b);
        assert!(p.audio.muted && p.audio.voice == "7" && p.audio.voice_enabled);
    }

    #[test]
    fn old_prefs_migrate_idle_settings() {
        let path = temp_path("idle-migrate");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"companionMode":"stay","idlePose":"sit"}"#).unwrap();
        let p = load(&path);
        assert_eq!(p.idle, Some(IdlePrefs { mode: IdleMode::Fixed, ..IdlePrefs::default() }));
        assert_eq!(p.idle_pose, IdlePose::Sit);
        fs::write(&path, r#"{"idlePose":"stand"}"#).unwrap();
        assert_eq!(load(&path).idle.unwrap().mode, IdleMode::Rotate);
        fs::write(&path, r#"{"idle":{"mode":"fixed","interval":1,"paused":true},"idlePose":"nap"}"#).unwrap();
        let p = load(&path);
        assert_eq!(p.idle.unwrap(), IdlePrefs { mode: IdleMode::Fixed, interval: MIN_IDLE_INTERVAL, paused: true });
        assert_eq!(p.idle_pose, IdlePose::Nap);
        // Old files also get the default awareness settings and reactions.
        assert!(p.awareness.app_enabled && !p.awareness.screen_enabled && !p.awareness.keep_screenshots && !p.awareness.keep_history);
        assert_eq!(p.reactions, default_reactions());
    }

    #[test]
    fn privacy_defaults_are_conservative() {
        let a = AwarenessPrefs::default();
        assert!(!a.screen_enabled && !a.keep_screenshots && !a.keep_history);
        assert!(a.excluded.iter().any(|e| e == "com.apple.keychainaccess"));
    }

    #[test]
    fn reaction_rules_are_validated() {
        let mut p = Prefs::default();
        let long = "x".repeat(500);
        p.apply(&PrefsPatch {
            reactions: Some(vec![
                ReactionRule { id: "a".into(), bundle_id: "com.apple.Safari".into(), comments: vec!["  hi\n".into(), "".into(), long.clone()], voice: "scream".into(), animation: "moonwalk".into(), cooldown: 1.0, chance: 9.0, ..Default::default() },
                ReactionRule { id: "a".into(), bundle_id: "bad bundle;rm".into(), ..Default::default() },
                ReactionRule { id: "a".into(), bundle_id: "*".into(), name: "".into(), ..Default::default() },
            ]),
            awareness: Some(AwarenessPrefs { excluded: vec!["com.ok.app".into(), "not ok!".into(), "*".into()], ..Default::default() }),
            ai: Some(AiPrefs { model: "$(evil)".into(), ..Default::default() }),
            ..Default::default()
        });
        assert_eq!(p.reactions.len(), 2); // the bad bundle id is dropped
        let r = &p.reactions[0];
        assert_eq!(r.comments.len(), 2);
        assert_eq!(r.comments[0], "hi");
        assert_eq!(r.comments[1].chars().count(), MAX_COMMENT_LEN);
        assert_eq!((r.voice.as_str(), r.animation.as_str(), r.cooldown, r.chance), ("none", "none", 10.0, 1.0));
        assert_ne!(p.reactions[1].id, "a"); // duplicate ids made unique
        assert_eq!(p.reactions[1].name, "*");
        assert_eq!(p.awareness.excluded, vec!["com.ok.app".to_string()]);
        assert_eq!(p.ai.model, "auto");
    }

    #[test]
    fn answer_length_and_voice_input_are_validated() {
        let mut p = Prefs::default();
        assert_eq!(p.ai.length, "medium");
        assert!(!p.voice_input.enabled);
        assert!(valid_shortcut(DEFAULT_VOICE_SHORTCUT));
        p.apply(&PrefsPatch {
            ai: Some(AiPrefs { model: "auto".into(), length: "epic".into() }),
            voice_input: Some(VoiceInputPrefs { enabled: true, shortcut: "Shift+A".into(), mode: "whisper".into(), microphone: "  ".into(), review: true, ..VoiceInputPrefs::default() }),
            ..Default::default()
        });
        assert_eq!(p.ai.length, "medium");
        assert_eq!(p.voice_input.shortcut, DEFAULT_VOICE_SHORTCUT); // Shift alone isn't enough
        assert_eq!(p.voice_input.mode, "hold");
        assert_eq!(p.voice_input.microphone, "default");
        assert!(p.voice_input.enabled);
        for ok in ["Control+Option+Space", "Command+Shift+F5", "Option+K", "Control+9"] {
            assert!(valid_shortcut(ok), "{ok}");
        }
        for bad in ["Space", "Control+", "Control+Control+K", "Hyper+K", "Control+Escape", "Control+ab", "Control+F30", "Shift+Space"] {
            assert!(!valid_shortcut(bad), "{bad}");
        }
    }

    #[test]
    fn control_scheme_and_silk_keys_persist_and_validate() {
        let mut p = Prefs::default();
        assert_eq!(p.control.scheme, "terraria");
        p.apply(&PrefsPatch {
            control: Some(ControlPrefs {
                scheme: "silksong".into(),
                silk_keys: SilkKeys { attack: "KeyX".into(), dash: "KeyX".into(), jump: "Escape".into(), thread: "MetaLeft".into(), ..SilkKeys::default() },
                ..ControlPrefs::default()
            }),
            ..Default::default()
        });
        assert_eq!(p.control.scheme, "silksong");
        let k = &p.control.silk_keys;
        assert_eq!(k.dash, "KeyX"); // dash comes first in action order
        assert_eq!(k.attack, "KeyJ"); // duplicate → default
        assert_eq!(k.jump, "Space"); // Esc is reserved
        assert_eq!(k.thread, "KeyL"); // modifier keys aren't bindable
        p.apply(&PrefsPatch { control: Some(ControlPrefs { scheme: "doom".into(), ..ControlPrefs::default() }), ..Default::default() });
        assert_eq!(p.control.scheme, "terraria");
        assert!(bindable_key("KeyQ") && bindable_key("Digit3") && bindable_key("ArrowUp") && !bindable_key("Escape") && !bindable_key("KeyQQ"));
    }

    #[test]
    fn build_blocks_are_validated_and_capped() {
        let mut p = Prefs::default();
        assert_eq!(p.build.kind, "dirt");
        assert!(p.build.blocks.is_empty());
        let mut blocks = vec![
            Block { c: 3, r: 0, k: "stone".into() },
            Block { c: 3, r: 0, k: "dirt".into() },   // duplicate cell
            Block { c: -1, r: 0, k: "dirt".into() },  // off grid
            Block { c: 4, r: 0, k: "lava".into() },   // unknown kind
            Block { c: 5, r: MAX_BLOCK_ROW + 1, k: "wood".into() },
        ];
        for i in 0..(MAX_BLOCKS as i32 + 50) {
            blocks.push(Block { c: i % 900, r: 1 + i / 900, k: "wood".into() });
        }
        p.apply(&PrefsPatch {
            build: Some(BuildPrefs { kind: "obsidian".into(), toggle_shortcut: "Shift+B".into(), blocks, ..BuildPrefs::default() }),
            ..Default::default()
        });
        assert_eq!(p.build.kind, "dirt");
        assert_eq!(p.build.toggle_shortcut, DEFAULT_BUILD_SHORTCUT);
        assert_eq!(p.build.blocks.len(), MAX_BLOCKS);
        assert_eq!(p.build.blocks[0], Block { c: 3, r: 0, k: "stone".into() });
        assert!(p.build.blocks.iter().all(|b| b.k != "lava" && b.c >= 0 && b.r <= MAX_BLOCK_ROW));
    }

    #[test]
    fn theme_and_lines_are_validated() {
        let mut p = Prefs::default();
        assert!(p.theme.enabled && p.theme.petals);
        p.apply(&PrefsPatch {
            theme: Some(ThemePrefs { density: 7.0, speed: f64::NAN, wind: -3.0, style: "tornado".into(), layer: "top".into(), ..ThemePrefs::default() }),
            lines: Some(LinePrefs {
                toggle_shortcut: "P".into(),
                items: vec![
                    Line { x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5 },
                    Line { x1: 0.2, y1: 0.2, x2: 0.2, y2: 0.2 },     // zero length
                    Line { x1: -0.1, y1: 0.5, x2: 0.4, y2: 0.5 },    // off screen
                    Line { x1: 0.1, y1: f64::NAN, x2: 0.4, y2: 0.5 }, // not a number
                ],
                ..LinePrefs::default()
            }),
            ..Default::default()
        });
        assert_eq!(p.theme.density, 1.0);
        assert_eq!(p.theme.speed, 1.0);
        assert_eq!(p.theme.wind, -1.0);
        assert_eq!(p.theme.style, "drift");
        assert_eq!(p.theme.layer, "behind");
        assert_eq!(p.theme.map, "sakura");
        p.apply(&PrefsPatch { theme: Some(ThemePrefs { map: "snow".into(), ..ThemePrefs::default() }), ..Default::default() });
        assert_eq!(p.theme.map, "snow");
        p.apply(&PrefsPatch { theme: Some(ThemePrefs { map: "chess".into(), ..ThemePrefs::default() }), ..Default::default() });
        assert_eq!(p.theme.map, "chess");
        p.apply(&PrefsPatch { theme: Some(ThemePrefs { map: "lava".into(), ..ThemePrefs::default() }), ..Default::default() });
        assert_eq!(p.theme.map, "sakura");
        assert_eq!(p.lines.items.len(), 1);
        assert_eq!(p.lines.toggle_shortcut, DEFAULT_LINES_SHORTCUT);
        let many = LinePrefs { items: vec![Line { x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5 }; MAX_LINES + 5], ..LinePrefs::default() }.sanitized();
        assert_eq!(many.items.len(), MAX_LINES);
    }

    #[test]
    fn persona_affection_and_voice_timeout_are_validated() {
        let mut p = Prefs::default();
        assert_eq!(p.affection.value, 30.0);
        assert!(p.voice_input.auto_submit);
        assert_eq!(p.voice_input.silence, 2.0);
        p.apply(&PrefsPatch {
            persona: Some(PersonaPrefs { intensity: "extreme".into(), frequency: 99.0, decay: -1.0, quiet_start: 40, cookie_shortcut: "K".into(), ..PersonaPrefs::default() }),
            affection: Some(AffectionState { value: 250.0, updated: f64::NAN, cookies: 1 }),
            voice_input: Some(VoiceInputPrefs { silence: 0.1, ..VoiceInputPrefs::default() }),
            ..Default::default()
        });
        assert_eq!(p.persona.intensity, "normal");
        assert_eq!(p.persona.frequency, 3.0);
        assert_eq!(p.persona.decay, 0.0);
        assert_eq!(p.persona.quiet_start, 23);
        assert_eq!(p.persona.cookie_shortcut, DEFAULT_COOKIE_SHORTCUT);
        assert_eq!(p.affection.value, 100.0);
        assert_eq!(p.affection.updated, 0.0);
        assert_eq!(p.voice_input.silence, 1.0);
    }

    #[test]
    fn character_roster_is_validated() {
        let mut p = Prefs::default();
        assert_eq!(p.characters.active, vec!["terrarian".to_string()]);
        assert_eq!(p.characters.per.len(), CHARACTER_IDS.len());
        p.apply(&PrefsPatch {
            characters: Some(CharacterPrefs {
                active: vec!["goblin".into(), "goblin".into(), "bowser".into(), "princess".into(), "nurse".into(), "terrarian".into()],
                selected: "nobody".into(),
                interaction_frequency: 50.0,
                per: vec![CharacterSettings { id: "princess".into(), weapon: "bad id!".into(), hit_sound: "scream".into(), ..CharacterSettings::new("princess") }],
                ..CharacterPrefs::default()
            }),
            ..Default::default()
        });
        let c = &p.characters;
        assert_eq!(c.selected, "terrarian");
        assert_eq!(c.active, vec!["goblin", "princess", "nurse", "terrarian"]);
        let over = CharacterPrefs { active: vec!["goblin".into(), "princess".into(), "nurse".into(), "terrarian".into(), "goblin".into()], selected: "terrarian".into(), ..CharacterPrefs::default() }.sanitized();
        assert!(over.active.contains(&"terrarian".to_string()));
        let missing = CharacterPrefs { active: vec!["goblin".into(), "princess".into(), "nurse".into(), "goblin".into()], selected: "terrarian".into(), ..CharacterPrefs::default() }.sanitized();
        assert_eq!(missing.active[0], "terrarian");
        assert_eq!(c.interaction_frequency, 3.0);
        let ryuko = c.per.iter().find(|x| x.id == "princess").unwrap();
        assert_eq!((ryuko.weapon.as_str(), ryuko.hit_sound.as_str()), ("", "voice"));
        assert_eq!(c.per.len(), CHARACTER_IDS.len());
        let looks = CharacterPrefs {
            per: vec![
                CharacterSettings { look: CharacterLook { skin: "#ffeedd".into(), eyes: "nope".into(), hair: 112 }, ..CharacterSettings::new("princess") },
                CharacterSettings { look: CharacterLook { skin: String::new(), eyes: "#112233".into(), hair: 108 }, ..CharacterSettings::new("nurse") },
            ],
            ..CharacterPrefs::default()
        }
        .sanitized();
        let r = &looks.per.iter().find(|x| x.id == "princess").unwrap().look;
        assert_eq!((r.skin.as_str(), r.eyes.as_str(), r.hair), ("#ffeedd", "", 0)); // no hair choices for sheet characters
        let s2 = &looks.per.iter().find(|x| x.id == "nurse").unwrap().look;
        assert_eq!(s2.hair, 0);
        p.characters.selected = "goblin".into();
        p.characters.per[5].affection.value = 77.0;
        assert_eq!(p.selected_affection(), 77.0);
    }

    #[test]
    fn terraria_keys_are_rebindable_and_validated() {
        let mut p = Prefs::default();
        assert_eq!(p.control.terraria_keys, TerrariaKeys::default());
        p.apply(&PrefsPatch {
            control: Some(ControlPrefs {
                terraria_keys: TerrariaKeys { left: "KeyJ".into(), right: "KeyL".into(), jump: "KeyI".into(), jump2: "KeyI".into(), down: "Escape".into() },
                ..ControlPrefs::default()
            }),
            ..Default::default()
        });
        let k = &p.control.terraria_keys;
        assert_eq!((k.left.as_str(), k.right.as_str(), k.jump.as_str()), ("KeyJ", "KeyL", "KeyI"));
        assert_eq!(k.jump2, "KeyW"); // duplicate fell back to its default
        assert_eq!(k.down, "KeyS"); // Esc is reserved
    }

    #[test]
    fn old_control_sections_get_the_new_defaults() {
        let path = temp_path("control-scheme");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"control":{"flightSpeed":400}}"#).unwrap();
        let p = load(&path);
        assert_eq!(p.control.flight_speed, 400.0);
        assert_eq!(p.control.scheme, "terraria");
        assert_eq!(p.control.silk_keys, SilkKeys::default());
    }

    #[test]
    fn behavior_modes_default_sanitize_and_survive_missing_fields() {
        assert_eq!(CharacterPrefs::default().behavior, BehaviorPrefs::default());
        let bad = BehaviorPrefs { spread: true, jump: "moonwalk".into(), watch: Some(Line { x1: 0.1, y1: 0.2, x2: 1.5, y2: 0.2 }) }.sanitized();
        assert_eq!((bad.spread, bad.jump.as_str(), bad.watch), (true, "normal", None));
        let good = BehaviorPrefs { spread: false, jump: "grounded".into(), watch: Some(Line { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.2 }) }.sanitized();
        assert_eq!(good.jump, "grounded");
        assert!(good.watch.is_some());
        // Older prefs files have no "behavior" section: defaults apply.
        let old: CharacterPrefs = serde_json::from_str(r#"{"active":["terrarian"],"selected":"terrarian"}"#).unwrap();
        assert_eq!(old.behavior, BehaviorPrefs::default());
        let partial: CharacterPrefs = serde_json::from_str(r#"{"behavior":{"jump":"jumpy"}}"#).unwrap();
        assert_eq!((partial.behavior.jump.as_str(), partial.behavior.spread), ("jumpy", false));
    }

    #[test]
    fn chess_prefs_default_and_sanitize() {
        let c = ChessPrefs { board: f64::NAN, maximized: true, material: "lava".into(), mode: "online".into(), player_color: "red".into(), difficulty: "god".into(), x: 0.5, y: 7.0 }.sanitized();
        assert_eq!(c, ChessPrefs { maximized: true, ..ChessPrefs::default() });
        assert_eq!(ChessPrefs { board: 50.0, ..ChessPrefs::default() }.sanitized().board, 0.0);
        assert_eq!(ChessPrefs { board: 720.0, ..ChessPrefs::default() }.sanitized().board, 720.0);
        let moved = ChessPrefs { x: 0.2, y: 0.4, ..ChessPrefs::default() }.sanitized();
        assert_eq!((moved.x, moved.y), (0.2, 0.4));
        let old: Prefs = serde_json::from_str("{}").unwrap();
        assert_eq!(old.chess, ChessPrefs::default());
    }

    #[test]
    fn world_prefs_default_and_sanitize() {
        let w = WorldPrefs { zoom: 99.0, camera_x: f64::NAN, seed: u32::MAX, ..WorldPrefs::default() }.sanitized();
        assert_eq!((w.zoom, w.camera_x, w.camera_y), (2.0, -1.0, -1.0));
        assert!(w.seed < 2_147_483_647);
        let old: Prefs = serde_json::from_str("{}").unwrap();
        assert_eq!(old.world, WorldPrefs::default());
        assert!(!old.world.enabled);
        // Desktop dragging is on by default, including for prefs saved before it existed.
        assert!(old.world.drag);
        let before: WorldPrefs = serde_json::from_str(r#"{"enabled":true,"seed":5}"#).unwrap();
        assert!(before.drag);
    }
}

#[cfg(test)]
mod pan_chord_tests {
    use super::*;

    #[test]
    fn pan_chord_is_cleaned_up() {
        let w = WorldPrefs { pan_chord: vec!["Command".into(), "Bogus".into(), "Option".into(), "Command".into()], ..Default::default() }.sanitized();
        assert_eq!(w.pan_chord, vec!["Option".to_string(), "Command".to_string()]);
        let w = WorldPrefs { pan_chord: vec![], ..Default::default() }.sanitized();
        assert_eq!(w.pan_chord, default_pan_chord());
        // Old prefs without the field load with the default.
        let w: WorldPrefs = serde_json::from_str(r#"{"enabled":true,"drag":true}"#).unwrap();
        assert_eq!(w.sanitized().pan_chord, default_pan_chord());
    }
}

#[cfg(test)]
mod name_tests {
    use super::*;

    #[test]
    fn custom_names_are_cleaned_up() {
        assert_eq!(sanitize_name("  Ayla \n\t the  Brave "), "Ayla the Brave");
        assert_eq!(sanitize_name("\u{7}"), "");
        assert_eq!(sanitize_name(&"x".repeat(40)).len(), MAX_NAME);
        let mut c = CharacterPrefs::default();
        c.per[1].name = "  Rose\u{0}  ".into();
        assert_eq!(c.sanitized().per[1].name, "Rose");
    }
}

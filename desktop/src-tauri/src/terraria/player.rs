//! Compose a Terraria player from the game's own layered player sheets into a frame atlas.
//!
//! Layout facts used here were *measured* from the installed sheets (see
//! `docs/terraria-player-rendering.md` and `examples/terraria_sheets.rs`):
//!
//! * Every piece lives in a 40×56 cell that shares one coordinate frame, so pieces are placed by
//!   simply overlaying cells. Head, eyes, legs, hair and helmets are vertical strips; torso and
//!   arms come from 9×4 composite grids.
//! * Strip frames: 0 stand, 1–4 item use, 5 jump, 6–19 walk. On walk frames 7–9 and 14–16 the
//!   head is drawn 2 px higher; that offset is measured at runtime from the head strip and applied
//!   to the torso and arms.
//! * Hair strips have 14 frames covering the walk cycle: hair frame = strip frame − 6 while
//!   walking, else 0.
//! * Composite cells: torso (0,0) for male bodies, (0,2) for female bodies; arm at rest (2,0);
//!   item-use arm stages (3,0) up, (4,0) diagonal up, (5,0) forward, (6,0) diagonal down; arm
//!   raised overhead (2,1); bent walking arm (4,1),(3,1),(5,1),(6,1) from back to front.
//! * Grayscale layers are tinted by multiplying with the appearance colours; armour is pre-coloured.

use super::store::{AssetError, AssetStore};
use super::xnb::Texture;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CELL_W: u32 = 40;
pub const CELL_H: u32 = 56;

/// Player texture layer indices (the `n` in `Images/Player_<variant>_<n>`), named by what they draw.
pub mod layer {
    pub const HEAD: u32 = 0;
    pub const EYE_WHITES: u32 = 1;
    pub const EYES: u32 = 2;
    pub const TORSO_SKIN: u32 = 3;
    pub const UNDERSHIRT: u32 = 4;
    pub const SHIRT: u32 = 6;
    pub const ARM_SKIN: u32 = 7;
    pub const ARM_UNDERSHIRT: u32 = 8;
    pub const ARM_HAND: u32 = 9;
    pub const LEG_SKIN: u32 = 10;
    pub const PANTS: u32 = 11;
    pub const SHOES: u32 = 12;
    pub const ARM_SHIRT: u32 = 13;
}

pub const MAX_VARIANT: u8 = 11;
pub const MAX_HAIR: u16 = 500;
pub const MAX_ARMOR_ID: u16 = 999;

/// Colours as "#rrggbb".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceColors {
    pub skin: String,
    pub hair: String,
    pub eyes: String,
    pub shirt: String,
    pub undershirt: String,
    pub pants: String,
    pub shoes: String,
}

impl Default for AppearanceColors {
    fn default() -> Self {
        // Terraria's default new-character colours.
        Self {
            skin: "#ff7d5a".into(),
            hair: "#d75a37".into(),
            eyes: "#695a4b".into(),
            shirt: "#afa58c".into(),
            undershirt: "#a0b4d7".into(),
            pants: "#ffe6af".into(),
            shoes: "#a0693c".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ArmorSlots {
    /// `Images/Armor_Head_<id>`.
    pub head: Option<u16>,
    /// `Images/Armor/Armor_<id>` (composite body sheet).
    pub body: Option<u16>,
    /// `Images/Armor_Legs_<id>`.
    pub legs: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HairUnderHelmet {
    /// Hide hair entirely (full helmets). Default, since most helmets cover the head.
    #[default]
    Hide,
    /// Use the game's short `Player_HairAlt_<n>` style (hats).
    Alt,
    /// Draw full hair under the helmet.
    Full,
}

/// Player appearance, persisted in preferences.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    /// Body/clothing variant 0–11 (`Player_<variant>_*`).
    pub skin_variant: u8,
    /// Hair style, `Player_Hair_<n>` (1-based).
    pub hair: u16,
    pub colors: AppearanceColors,
    pub armor: ArmorSlots,
    pub hair_under_helmet: HairUnderHelmet,
    /// Accessory item ids. Stored for the future; not drawn yet.
    pub accessories: Vec<u16>,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            skin_variant: 0,
            hair: 1,
            colors: AppearanceColors::default(),
            armor: ArmorSlots::default(),
            hair_under_helmet: HairUnderHelmet::Hide,
            accessories: Vec::new(),
        }
    }
}

pub fn parse_hex(color: &str) -> Option<[u8; 3]> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(hex, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

impl Appearance {
    /// Clamp/repair every field so hand-edited or old preferences can't break rendering.
    pub fn sanitized(mut self) -> Self {
        let defaults = AppearanceColors::default();
        self.skin_variant = self.skin_variant.min(MAX_VARIANT);
        self.hair = self.hair.clamp(1, MAX_HAIR);
        let fix = |c: &mut String, d: &str| {
            if parse_hex(c).is_none() {
                *c = d.to_string();
            }
            *c = c.to_ascii_lowercase();
        };
        fix(&mut self.colors.skin, &defaults.skin);
        fix(&mut self.colors.hair, &defaults.hair);
        fix(&mut self.colors.eyes, &defaults.eyes);
        fix(&mut self.colors.shirt, &defaults.shirt);
        fix(&mut self.colors.undershirt, &defaults.undershirt);
        fix(&mut self.colors.pants, &defaults.pants);
        fix(&mut self.colors.shoes, &defaults.shoes);
        let valid_armor = |id: Option<u16>| id.filter(|i| (1..=MAX_ARMOR_ID).contains(i));
        self.armor.head = valid_armor(self.armor.head);
        self.armor.body = valid_armor(self.armor.body);
        self.armor.legs = valid_armor(self.armor.legs);
        self.accessories.retain(|id| *id > 0);
        self.accessories.truncate(10);
        self
    }

    /// Stable short key for caching a composed atlas.
    pub fn cache_key(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        // FNV-1a: tiny, deterministic, good enough for a cache key.
        let mut h: u64 = 0xcbf29ce484222325;
        for b in json.bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{h:016x}")
    }
}

/// Female body variants use the female torso row (measured: torso at (0,2) in `Player_4_3`).
pub fn is_female(variant: u8) -> bool {
    matches!(variant, 4..=7 | 9 | 11)
}

/// Variants to try, in order, for a body layer. Only variants 0, 4, 10 and 11 ship skin layers;
/// clothing variants inherit the base body of their sex (measured from the installed file list).
pub fn variant_chain(variant: u8) -> Vec<u8> {
    let mut chain = vec![variant];
    match variant {
        4..=7 | 9 => chain.push(4),
        11 => chain.push(10),
        _ => {}
    }
    chain.push(0);
    chain.dedup();
    chain
}

/// Hair strip frame for a body strip frame (hair strips cover the 14 walk frames).
pub fn hair_frame(strip_frame: u32) -> u32 {
    if strip_frame >= 6 { (strip_frame - 6).min(13) } else { 0 }
}

/// Bent walking-arm cells ordered from swung back to swung forward (measured hand x: 8,10,12,14).
const WALK_ARMS: [(u32, u32); 4] = [(4, 1), (3, 1), (5, 1), (6, 1)];

/// Walking arm cell for walk step 0–13 (strip frames 6–19). The swing follows a sine over the
/// 14-frame stride, forward extreme near strip frame 8–9 where the legs are widest (measured leg
/// widths: frames 8–9 and 14–15 are the widest). The back arm swings in opposite phase.
/// NOTE: the phase is inferred from the leg sheets, not verified against the game's renderer.
pub fn walk_arm_cell(step: u32, back: bool) -> (u32, u32) {
    // sin peaks at step 2.5 (strip frames 8–9) and bottoms out at step 9.5 (frames 15–16).
    let phase = (step as f64 + 1.0) / 14.0 * std::f64::consts::TAU;
    let s = phase.sin() * if back { -1.0 } else { 1.0 };
    let idx = if s > 0.55 { 3 } else if s > 0.0 { 2 } else if s > -0.55 { 1 } else { 0 };
    WALK_ARMS[idx]
}

/// One frame of the output atlas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pose {
    pub name: String,
    /// Frame index into the head/legs/helmet strips.
    pub strip_frame: u32,
    pub front_arm: (u32, u32),
    pub back_arm: (u32, u32),
    /// Extra vertical offset (px, + = down) for the legs.
    pub legs_dy: i32,
    /// Extra vertical offset (px, + = down) for everything above the legs.
    pub upper_dy: i32,
}

/// Every pose the companion animates, in atlas order.
pub fn poses() -> Vec<Pose> {
    let p = |name: &str, strip_frame, front_arm, back_arm| Pose {
        name: name.into(),
        strip_frame,
        front_arm,
        back_arm,
        legs_dy: 0,
        upper_dy: 0,
    };
    let mut list = vec![p("idle", 0, (2, 0), (2, 0))];
    for step in 0..14 {
        list.push(p(&format!("walk{step}"), 6 + step, walk_arm_cell(step, false), walk_arm_cell(step, true)));
    }
    list.push(p("jump", 5, (2, 1), (2, 0)));
    list.push(p("fall", 5, (2, 1), (2, 0)));
    // Item-use swing stages (classic use frames 1–4 for the legs/head strips).
    list.push(p("use1", 1, (3, 0), (2, 0)));
    list.push(p("use2", 2, (4, 0), (2, 0)));
    list.push(p("use3", 3, (5, 0), (2, 0)));
    list.push(p("use4", 4, (6, 0), (2, 0)));
    list.push(p("shoot", 3, (5, 0), (2, 0)));
    list.push(p("cast", 2, (4, 0), (2, 0)));
    // Idle/cursor poses. The sheets have no sitting frame: "sit"/"ride" are composed from the jump
    // legs (frame 5) with the upper body lowered 6 px — an approximation chosen by visual comparison
    // (see examples/terraria_pose_lab.rs).
    list.push(Pose { upper_dy: 6, ..p("sit", 5, (2, 0), (2, 0)) });
    list.push(Pose { upper_dy: 6, ..p("ride", 5, (5, 1), (2, 0)) });
    list.push(p("wave1", 0, (2, 1), (2, 0)));
    list.push(p("wave2", 0, (4, 0), (2, 0)));
    list.push(p("hug", 0, (5, 0), (5, 0)));
    // Idle extras (chosen with examples/terraria_pose_lab.rs): "sit2" alternates with "sit" to
    // swing the legs (walk-cycle legs, same lowered body); "nap" slumps lower with hands forward.
    list.push(Pose { upper_dy: 6, ..p("sit2", 9, (2, 0), (2, 0)) });
    list.push(Pose { upper_dy: 9, ..p("nap", 5, (5, 1), (2, 0)) });
    // Silksong Controls poses (chosen with examples/terraria_pose_lab.rs): dash lean, wall cling,
    // glide, down-strike (pogo) and the charged Needle lunge.
    list.push(Pose { upper_dy: 3, ..p("dash", 9, (5, 0), (2, 0)) });
    list.push(p("cling", 5, (2, 1), (2, 1)));
    list.push(p("glide", 5, (3, 0), (3, 0)));
    list.push(Pose { upper_dy: 2, ..p("pogo", 5, (6, 0), (2, 0)) });
    list.push(Pose { upper_dy: 4, ..p("lunge", 9, (5, 1), (2, 0)) });
    // Diagonal pogo (stride, arm swung down-forward), dive (both arms thrust down-forward) and
    // the dive's landing slam (crouched), also chosen with the pose lab.
    list.push(Pose { upper_dy: 3, ..p("diag", 9, (6, 0), (2, 1)) });
    list.push(Pose { upper_dy: 5, ..p("dive", 9, (6, 0), (6, 0)) });
    list.push(Pose { upper_dy: 6, ..p("slam", 1, (6, 0), (2, 0)) });
    list
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Body box inside a cell: Terraria's 20×42 player hitbox, horizontally centred and ending at
/// the feet (measured: legs end at y 53, head starts at y 12).
pub const BODY_BOX: Rect = Rect { x: 10, y: 12, w: 20, h: 42 };

/// A composed atlas: poses laid out left to right, straight-alpha RGBA.
#[derive(Debug, Clone)]
pub struct Rig {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub frames: Vec<String>,
    /// Hand centre (cell pixels, right-facing) for each pose, measured from the hand layer.
    pub hands: BTreeMap<String, [f32; 2]>,
    /// Layers that were requested but not found (e.g. an armour id with no sheet).
    pub missing: Vec<String>,
}

/// Something that can provide decoded textures (the real [`AssetStore`] or a test double).
pub trait TextureSource {
    fn get(&self, name: &str) -> Option<std::sync::Arc<Texture>>;
}

impl TextureSource for AssetStore {
    fn get(&self, name: &str) -> Option<std::sync::Arc<Texture>> {
        self.texture(name).ok()
    }
}

struct Canvas {
    w: u32,
    h: u32,
    px: Vec<u8>,
}

impl Canvas {
    fn new(w: u32, h: u32) -> Self {
        Self { w, h, px: vec![0; (w * h * 4) as usize] }
    }

    /// Draw a `CELL_W`×`CELL_H` region of `tex` at (`dx`,`dy`) using straight-alpha "over",
    /// multiplying colour by `tint` when given. Rows beyond the texture (short last strip frame)
    /// are skipped.
    fn blit(&mut self, tex: &Texture, sx: u32, sy: u32, dx: i32, dy: i32, tint: Option<[u8; 3]>) {
        for y in 0..CELL_H {
            let ty = sy + y;
            if ty >= tex.height {
                break;
            }
            let oy = dy + y as i32;
            if oy < 0 || oy >= self.h as i32 {
                continue;
            }
            for x in 0..CELL_W {
                let tx = sx + x;
                let ox = dx + x as i32;
                if tx >= tex.width || ox < 0 || ox >= self.w as i32 {
                    continue;
                }
                let si = ((ty * tex.width + tx) * 4) as usize;
                let sa = tex.rgba[si + 3] as u32;
                if sa == 0 {
                    continue;
                }
                let mut src = [tex.rgba[si], tex.rgba[si + 1], tex.rgba[si + 2]];
                if let Some(t) = tint {
                    for k in 0..3 {
                        src[k] = ((src[k] as u32 * t[k] as u32 + 127) / 255) as u8;
                    }
                }
                let di = ((oy as u32 * self.w + ox as u32) * 4) as usize;
                let da = self.px[di + 3] as u32;
                let out_a = sa + da * (255 - sa) / 255;
                for k in 0..3 {
                    let c = (src[k] as u32 * sa * 255 + self.px[di + k] as u32 * da * (255 - sa)) / (255 * out_a.max(1));
                    self.px[di + k] = c.min(255) as u8;
                }
                self.px[di + 3] = out_a as u8;
            }
        }
    }
}

/// Top row of opaque pixels in a strip frame, if any.
fn frame_top(tex: &Texture, frame: u32) -> Option<u32> {
    let y0 = frame * CELL_H;
    (0..CELL_H).find(|&y| {
        let ty = y0 + y;
        ty < tex.height && (0..tex.width.min(CELL_W)).any(|x| tex.rgba[((ty * tex.width + x) * 4 + 3) as usize] > 0)
    })
}

/// Vertical body offset per strip frame, measured from the head strip (negative = higher).
pub fn bob_offsets(head: Option<&Texture>) -> Vec<i32> {
    let Some(head) = head else { return vec![0; 20] };
    let base = frame_top(head, 0).map(|t| t as i32);
    (0..20).map(|f| match (base, frame_top(head, f)) {
        (Some(b), Some(t)) => t as i32 - b,
        _ => 0,
    })
    .collect()
}

/// Centre of opaque pixels of a grid cell (used to find the hand in the hand layer).
fn cell_center(tex: &Texture, col: u32, row: u32) -> Option<[f32; 2]> {
    let (mut sx, mut sy, mut n) = (0u64, 0u64, 0u64);
    for y in 0..CELL_H {
        for x in 0..CELL_W {
            let (tx, ty) = (col * CELL_W + x, row * CELL_H + y);
            if tx < tex.width && ty < tex.height && tex.rgba[((ty * tex.width + tx) * 4 + 3) as usize] > 0 {
                sx += x as u64;
                sy += y as u64;
                n += 1;
            }
        }
    }
    (n > 0).then(|| [sx as f32 / n as f32 + 0.5, sy as f32 / n as f32 + 0.5])
}

/// Find `Images/Player_<v>_<layer>` along the variant fallback chain.
fn player_layer(src: &dyn TextureSource, variant: u8, layer: u32) -> Option<std::sync::Arc<Texture>> {
    variant_chain(variant).into_iter().find_map(|v| src.get(&format!("Images/Player_{v}_{layer}")))
}

/// Compose every pose for `appearance` into one atlas.
pub fn compose(src: &dyn TextureSource, appearance: &Appearance) -> Result<Rig, AssetError> {
    compose_poses(src, appearance, &poses())
}

/// Extra rendering options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ComposeOptions {
    /// Draw the body-armour cell two rows below the front-arm frame (cols 2–6, rows 2–3) in front
    /// of everything. Vanilla sheets keep small sleeve cuffs there; resource packs such as
    /// "Waifu 2B" paint a dress into those cells so it renders in front of the body.
    /// Inferred from the sheets (see docs/custom-skin-and-voice-audit.md), not from game code.
    pub front_overlays: bool,
}

/// The front overlay cell for a front-arm cell, if the composite sheet has one.
pub fn front_overlay_cell(front_arm: (u32, u32)) -> Option<(u32, u32)> {
    ((2..=6).contains(&front_arm.0) && front_arm.1 < 2).then_some((front_arm.0, front_arm.1 + 2))
}

/// Compose an atlas for an explicit pose list (used by tools and tests).
pub fn compose_poses(src: &dyn TextureSource, appearance: &Appearance, list: &[Pose]) -> Result<Rig, AssetError> {
    compose_with(src, appearance, list, ComposeOptions::default())
}

/// Compose every pose with options (used for skins).
pub fn compose_skin(src: &dyn TextureSource, appearance: &Appearance, opts: ComposeOptions) -> Result<Rig, AssetError> {
    compose_with(src, appearance, &poses(), opts)
}

pub fn compose_with(src: &dyn TextureSource, appearance: &Appearance, list: &[Pose], opts: ComposeOptions) -> Result<Rig, AssetError> {
    let a = appearance.clone().sanitized();
    let c = |s: &str| parse_hex(s).unwrap_or([255, 255, 255]);
    let (skin, hair_c, eyes, shirt, under, pants, shoes) = (
        c(&a.colors.skin), c(&a.colors.hair), c(&a.colors.eyes), c(&a.colors.shirt),
        c(&a.colors.undershirt), c(&a.colors.pants), c(&a.colors.shoes),
    );
    let mut missing = Vec::new();
    let mut need = |name: String| -> Option<std::sync::Arc<Texture>> {
        let t = src.get(&name);
        if t.is_none() {
            missing.push(name);
        }
        t
    };

    let v = a.skin_variant;
    let lay = |n: u32| player_layer(src, v, n);
    let head = lay(layer::HEAD).ok_or_else(|| AssetError::NotFound(format!("Images/Player_{v}_0 (player head)")))?;
    let (eye_whites, eye_tex) = (lay(layer::EYE_WHITES), lay(layer::EYES));
    let (torso_skin, undershirt, shirt_t) = (lay(layer::TORSO_SKIN), lay(layer::UNDERSHIRT), lay(layer::SHIRT));
    let (arm_skin, arm_under, arm_hand, arm_shirt) = (lay(layer::ARM_SKIN), lay(layer::ARM_UNDERSHIRT), lay(layer::ARM_HAND), lay(layer::ARM_SHIRT));
    let (leg_skin, pants_t, shoes_t) = (lay(layer::LEG_SKIN), lay(layer::PANTS), lay(layer::SHOES));

    let helmet = a.armor.head.and_then(|id| need(format!("Images/Armor_Head_{id}")));
    let body_armor = a.armor.body.and_then(|id| need(format!("Images/Armor/Armor_{id}")));
    let leg_armor = a.armor.legs.and_then(|id| need(format!("Images/Armor_Legs_{id}")));
    let hair = match (helmet.is_some(), a.hair_under_helmet) {
        (true, HairUnderHelmet::Hide) => None,
        (true, HairUnderHelmet::Alt) => need(format!("Images/Player_HairAlt_{}", a.hair)),
        _ => need(format!("Images/Player_Hair_{}", a.hair)),
    };

    let bob = bob_offsets(Some(&head));
    let torso_row = if is_female(v) { 2 } else { 0 };
    let mut canvas = Canvas::new(CELL_W * list.len() as u32, CELL_H);
    let mut hands = BTreeMap::new();

    for (i, pose) in list.iter().enumerate() {
        let ox = (i as u32 * CELL_W) as i32;
        let f = pose.strip_frame;
        let dy = bob[f as usize] + pose.upper_dy;
        let strip_at = |c: &mut Canvas, t: &Option<std::sync::Arc<Texture>>, frame: u32, tint: Option<[u8; 3]>, y: i32| {
            if let Some(t) = t {
                c.blit(t, 0, frame * CELL_H, ox, y, tint);
            }
        };
        let legs = |c: &mut Canvas, t: &Option<std::sync::Arc<Texture>>, tint| strip_at(c, t, f, tint, pose.legs_dy);
        let upper = |c: &mut Canvas, t: &Option<std::sync::Arc<Texture>>, frame: u32, tint| strip_at(c, t, frame, tint, pose.upper_dy);
        let grid = |c: &mut Canvas, t: &Option<std::sync::Arc<Texture>>, cell: (u32, u32), tint: Option<[u8; 3]>| {
            if let Some(t) = t {
                c.blit(t, cell.0 * CELL_W, cell.1 * CELL_H, ox, dy, tint);
            }
        };
        let arm = |c: &mut Canvas, cell: (u32, u32)| {
            grid(c, &arm_skin, cell, Some(skin));
            if body_armor.is_some() {
                grid(c, &arm_hand, cell, Some(skin));
                grid(c, &body_armor, cell, None);
            } else {
                grid(c, &arm_under, cell, Some(under));
                grid(c, &arm_shirt, cell, Some(shirt));
                grid(c, &arm_hand, cell, Some(skin));
            }
        };

        // Back to front: back arm, legs, torso, head, hair, helmet, front arm.
        arm(&mut canvas, pose.back_arm);
        legs(&mut canvas, &leg_skin, Some(skin));
        if leg_armor.is_some() {
            legs(&mut canvas, &leg_armor, None);
        } else {
            legs(&mut canvas, &pants_t, Some(pants));
            legs(&mut canvas, &shoes_t, Some(shoes));
        }
        grid(&mut canvas, &torso_skin, (0, torso_row), Some(skin));
        if body_armor.is_some() {
            grid(&mut canvas, &body_armor, (0, torso_row), None);
        } else {
            grid(&mut canvas, &undershirt, (0, torso_row), Some(under));
            grid(&mut canvas, &shirt_t, (0, torso_row), Some(shirt));
        }
        upper(&mut canvas, &Some(head.clone()), f, Some(skin));
        upper(&mut canvas, &eye_whites, f, None);
        upper(&mut canvas, &eye_tex, f, Some(eyes));
        upper(&mut canvas, &hair, hair_frame(f), Some(hair_c));
        upper(&mut canvas, &helmet, f, None);
        arm(&mut canvas, pose.front_arm);
        if opts.front_overlays {
            if let Some(cell) = front_overlay_cell(pose.front_arm) {
                grid(&mut canvas, &body_armor, cell, None);
            }
        }

        if let Some(hand) = arm_hand.as_deref().and_then(|t| cell_center(t, pose.front_arm.0, pose.front_arm.1)) {
            hands.insert(pose.name.clone(), [hand[0], hand[1] + dy as f32]);
        }
    }

    Ok(Rig {
        width: canvas.w,
        height: canvas.h,
        rgba: canvas.px,
        frames: list.iter().map(|p| p.name.clone()).collect(),
        hands,
        missing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    /// In-memory texture source for synthetic sheets.
    #[derive(Default)]
    struct Fake(HashMap<String, Arc<Texture>>);

    impl TextureSource for Fake {
        fn get(&self, name: &str) -> Option<Arc<Texture>> {
            self.0.get(name).cloned()
        }
    }

    fn blank(w: u32, h: u32) -> Texture {
        Texture { width: w, height: h, rgba: vec![0; (w * h * 4) as usize] }
    }

    fn put(t: &mut Texture, x: u32, y: u32, rgba: [u8; 4]) {
        let i = ((y * t.width + x) * 4) as usize;
        t.rgba[i..i + 4].copy_from_slice(&rgba);
    }

    fn strip_tex() -> Texture {
        blank(CELL_W, CELL_H * 20)
    }

    fn grid_tex() -> Texture {
        blank(CELL_W * 9, CELL_H * 4)
    }

    fn atlas_px(rig: &Rig, frame: &str, x: u32, y: u32) -> [u8; 4] {
        let i = rig.frames.iter().position(|f| f == frame).unwrap() as u32;
        let o = ((y * rig.width + i * CELL_W + x) * 4) as usize;
        rig.rgba[o..o + 4].try_into().unwrap()
    }

    /// A minimal body: white head pixel at (20,12) in every frame (2 px higher on bob frames),
    /// white torso pixel at (20,30) in cell (0,0), white hand pixel per arm cell at (5+col,40).
    fn base_body() -> Fake {
        let mut head = strip_tex();
        for f in 0..20 {
            let lift = if matches!(f, 7..=9 | 14..=16) { 2 } else { 0 };
            put(&mut head, 20, f * CELL_H + 12 - lift, [255, 255, 255, 255]);
        }
        let mut torso = grid_tex();
        put(&mut torso, 20, 30, [255, 255, 255, 255]);
        let mut hand = grid_tex();
        for col in 2..7 {
            for row in 0..2 {
                put(&mut hand, col * CELL_W + 5 + col, row * CELL_H + 40, [255, 255, 255, 255]);
            }
        }
        let mut fake = Fake::default();
        fake.0.insert("Images/Player_0_0".into(), Arc::new(head));
        fake.0.insert("Images/Player_0_3".into(), Arc::new(torso));
        fake.0.insert("Images/Player_0_9".into(), Arc::new(hand));
        fake
    }

    #[test]
    fn tints_grayscale_layers_by_multiplying() {
        let rig = compose(&base_body(), &Appearance { colors: AppearanceColors { skin: "#804020".into(), ..Default::default() }, ..Default::default() }).unwrap();
        assert_eq!(atlas_px(&rig, "idle", 20, 12), [0x80, 0x40, 0x20, 255]); // head: white × skin
        assert_eq!(atlas_px(&rig, "idle", 20, 30), [0x80, 0x40, 0x20, 255]); // torso: white × skin
    }

    #[test]
    fn torso_and_arms_follow_the_measured_head_bob() {
        let rig = compose(&base_body(), &Appearance::default()).unwrap();
        // walk1 = strip frame 7, a bob frame: head and torso 2 px higher than when idle.
        assert_eq!(atlas_px(&rig, "walk1", 20, 10)[3], 255);
        assert_eq!(atlas_px(&rig, "walk1", 20, 28)[3], 255);
        assert_eq!(atlas_px(&rig, "walk1", 20, 30)[3], 0);
        assert_eq!(atlas_px(&rig, "walk0", 20, 30)[3], 255); // frame 6 is not a bob frame
        assert_eq!(bob_offsets(Some(&*base_body().0["Images/Player_0_0"]))[..10], [0, 0, 0, 0, 0, 0, 0, -2, -2, -2]);
    }

    #[test]
    fn pose_arm_cells_and_hand_anchors() {
        let rig = compose(&base_body(), &Appearance::default()).unwrap();
        // idle uses arm cell (2,0): its hand pixel sits at x = 5 + 2.
        assert_eq!(atlas_px(&rig, "idle", 7, 40)[3], 255);
        assert_eq!(rig.hands["idle"], [7.5, 40.5]);
        // Item-use stages walk through cells (3,0)..(6,0); jump raises the arm to (2,1).
        assert_eq!(rig.hands["use1"], [8.5, 40.5]);
        assert_eq!(rig.hands["use4"], [11.5, 40.5]);
        assert_eq!(rig.hands["jump"], [7.5, 40.5]);
    }

    #[test]
    fn layer_order_puts_front_arm_over_torso_and_back_arm_under_it() {
        let mut fake = base_body();
        // A red torso pixel and a blue hand pixel at the same spot in arm cell (2,0).
        let mut torso = grid_tex();
        put(&mut torso, 9, 41, [255, 0, 0, 255]);
        let mut hand = grid_tex();
        put(&mut hand, 2 * CELL_W + 9, 41, [0, 0, 255, 255]);
        fake.0.insert("Images/Player_0_3".into(), Arc::new(torso));
        fake.0.insert("Images/Player_0_9".into(), Arc::new(hand));
        let white_skin = Appearance { colors: AppearanceColors { skin: "#ffffff".into(), ..Default::default() }, ..Default::default() };
        let rig = compose(&fake, &white_skin).unwrap();
        // idle: front arm (2,0) is drawn last → blue wins.
        assert_eq!(atlas_px(&rig, "idle", 9, 41), [0, 0, 255, 255]);
        // use3: front arm moved to (5,0); the back arm stays at (2,0) *under* the torso → red wins.
        assert_eq!(atlas_px(&rig, "use3", 9, 41), [255, 0, 0, 255]);
    }

    #[test]
    fn semi_transparent_pixels_blend_over_lower_layers() {
        let mut fake = base_body();
        let mut eyes = strip_tex();
        put(&mut eyes, 20, 12, [0, 0, 0, 128]);
        fake.0.insert("Images/Player_0_1".into(), Arc::new(eyes));
        let rig = compose(&fake, &Appearance { colors: AppearanceColors { skin: "#ffffff".into(), ..Default::default() }, ..Default::default() }).unwrap();
        let px = atlas_px(&rig, "idle", 20, 12);
        assert_eq!(px[3], 255);
        assert!((126..=128).contains(&px[0]), "50% black over white ≈ 127, got {px:?}");
    }

    #[test]
    fn hair_uses_walk_indexed_frames_and_hides_under_helmet() {
        assert_eq!((0..20).map(hair_frame).collect::<Vec<_>>(), vec![0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
        let mut fake = base_body();
        let mut hair = blank(CELL_W, CELL_H * 14);
        for f in 0..14 {
            put(&mut hair, f + 2, f * CELL_H + 5, [255, 255, 255, 255]); // x encodes the hair frame
        }
        fake.0.insert("Images/Player_Hair_1".into(), Arc::new(hair));
        let rig = compose(&fake, &Appearance::default()).unwrap();
        assert_eq!(atlas_px(&rig, "idle", 2, 5)[3], 255); // hair frame 0
        assert_eq!(atlas_px(&rig, "walk3", 5, 5)[3], 255); // strip 9 → hair frame 3
        let mut helmet = strip_tex();
        put(&mut helmet, 30, 10, [9, 9, 9, 255]);
        fake.0.insert("Images/Armor_Head_7".into(), Arc::new(helmet));
        let helmeted = Appearance { armor: ArmorSlots { head: Some(7), ..Default::default() }, ..Default::default() };
        let rig = compose(&fake, &helmeted).unwrap();
        assert_eq!(atlas_px(&rig, "idle", 2, 5)[3], 0); // hair hidden
        assert_eq!(atlas_px(&rig, "idle", 30, 10), [9, 9, 9, 255]); // armour is not tinted
    }

    #[test]
    fn female_variants_use_the_female_torso_row_and_fall_back_to_base_layers() {
        let mut fake = base_body();
        let mut female_torso = grid_tex();
        put(&mut female_torso, 21, 2 * CELL_H + 30, [255, 255, 255, 255]);
        fake.0.insert("Images/Player_4_3".into(), Arc::new(female_torso));
        let rig = compose(&fake, &Appearance { skin_variant: 5, ..Default::default() }).unwrap();
        assert_eq!(atlas_px(&rig, "idle", 21, 30)[3], 255); // variant 5 → 4's torso, row 2
        assert_eq!(atlas_px(&rig, "idle", 20, 12)[3], 255); // head falls back to variant 0
        assert_eq!(variant_chain(5), vec![5, 4, 0]);
        assert_eq!(variant_chain(11), vec![11, 10, 0]);
        assert_eq!(variant_chain(0), vec![0]);
        assert!(is_female(4) && is_female(9) && !is_female(8) && !is_female(10));
    }

    #[test]
    fn missing_armor_is_reported_not_fatal_but_missing_head_is() {
        let rig = compose(&base_body(), &Appearance { armor: ArmorSlots { body: Some(77), ..Default::default() }, ..Default::default() }).unwrap();
        assert!(rig.missing.contains(&"Images/Armor/Armor_77".to_string()), "{:?}", rig.missing);
        assert!(compose(&Fake::default(), &Appearance::default()).is_err());
    }

    #[test]
    fn walk_arms_swing_through_all_four_cells_in_opposite_phase() {
        let front: Vec<_> = (0..14).map(|s| walk_arm_cell(s, false)).collect();
        let back: Vec<_> = (0..14).map(|s| walk_arm_cell(s, true)).collect();
        for cell in WALK_ARMS {
            assert!(front.contains(&cell), "front arm never uses {cell:?}");
        }
        // Forward extreme near strip frames 8–9 (steps 2–3), back extreme half a stride later.
        assert_eq!(front[2], (6, 1));
        assert_eq!(front[9], (4, 1));
        for s in 0..14 {
            assert_ne!(front[s as usize], back[s as usize], "arms coincide at step {s}");
        }
    }

    #[test]
    fn poses_cover_every_companion_animation() {
        let names: Vec<_> = poses().into_iter().map(|p| p.name).collect();
        for n in [
            "idle", "walk0", "walk13", "jump", "fall", "use1", "use2", "use3", "use4", "shoot", "cast", "sit", "ride",
            "wave1", "wave2", "hug", "sit2", "nap", "dash", "cling", "glide", "pogo", "lunge", "diag", "dive", "slam",
        ] {
            assert!(names.contains(&n.to_string()), "{n}");
        }
        assert_eq!(names.len(), 38);
    }

    /// Local-only: decode the real installed sheets and compose the atlas. Skips when Terraria
    /// isn't installed, so the suite never depends on (or contains) game files.
    #[test]
    fn real_install_sheets_decode_and_compose_when_present() {
        use crate::terraria::{locate, store::AssetStore};
        let Ok(install) = locate::locate(None) else {
            eprintln!("Terraria not installed; skipping real-asset check");
            return;
        };
        let cache = std::env::temp_dir().join(format!("tc-real-assets-{}", std::process::id()));
        let store = AssetStore::new(install, cache.clone());
        let head = store.texture("Images/Player_0_0").unwrap();
        assert_eq!((head.width, head.height), (40, 1118)); // 19 full frames + a 54 px last frame
        let torso = store.texture("Images/Player_0_3").unwrap();
        assert_eq!((torso.width, torso.height), (360, 224)); // 9×4 composite grid
        assert_eq!(bob_offsets(Some(&head))[6..17], [0, -2, -2, -2, 0, 0, 0, 0, -2, -2, -2]);
        let rig = compose(&store, &Appearance::default()).unwrap();
        assert!(rig.missing.is_empty(), "{:?}", rig.missing);
        assert_eq!(rig.frames.len(), poses().len());
        // The idle frame's opaque pixels sit inside the cell, with feet on row 53.
        let opaque_rows: Vec<u32> = (0..CELL_H).filter(|&y| (0..CELL_W).any(|x| rig.rgba[((y * rig.width + x) * 4 + 3) as usize] > 0)).collect();
        assert_eq!(*opaque_rows.last().unwrap(), BODY_BOX.y + BODY_BOX.h - 1);
        let _ = std::fs::remove_dir_all(cache);
    }

    #[test]
    fn sit_pose_lowers_only_the_upper_body() {
        let rig = compose(&base_body(), &Appearance::default()).unwrap();
        // Head pixel (20,12) in idle moves down 6 px in the sit pose.
        assert_eq!(atlas_px(&rig, "idle", 20, 12)[3], 255);
        assert_eq!(atlas_px(&rig, "sit", 20, 12)[3], 0);
        assert_eq!(atlas_px(&rig, "sit", 20, 18)[3], 255);
        assert_eq!(atlas_px(&rig, "sit", 20, 36)[3], 255); // torso (20,30) + 6
        let sit = poses().into_iter().find(|p| p.name == "sit").unwrap();
        assert_eq!((sit.strip_frame, sit.legs_dy, sit.upper_dy), (5, 0, 6));
    }

    #[test]
    fn appearance_sanitizes_and_keys_stably() {
        let bad = Appearance {
            skin_variant: 40,
            hair: 0,
            colors: AppearanceColors { skin: "red".into(), hair: "#ABCDEF".into(), ..Default::default() },
            armor: ArmorSlots { head: Some(0), body: Some(5000), legs: Some(3) },
            accessories: vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            ..Default::default()
        }
        .sanitized();
        assert_eq!(bad.skin_variant, MAX_VARIANT);
        assert_eq!(bad.hair, 1);
        assert_eq!(bad.colors.skin, AppearanceColors::default().skin);
        assert_eq!(bad.colors.hair, "#abcdef");
        assert_eq!(bad.armor, ArmorSlots { head: None, body: None, legs: Some(3) });
        assert_eq!(bad.accessories.len(), 10);
        assert_eq!(Appearance::default().cache_key(), Appearance::default().cache_key());
        assert_ne!(Appearance::default().cache_key(), Appearance { hair: 2, ..Default::default() }.cache_key());
        assert_eq!(parse_hex("#ff8000"), Some([255, 128, 0]));
        assert_eq!(parse_hex("ff8000"), None);
    }
}

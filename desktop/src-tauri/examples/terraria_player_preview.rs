//! Developer tool: compose the real player atlas from the local install and write magnified
//! previews for visual inspection.
//!
//!   cargo run --example terraria_player_preview -- <output dir outside the repo>
use desktop_lib::terraria::player::{compose, Appearance, AppearanceColors, ArmorSlots, CELL_H, CELL_W};
use desktop_lib::terraria::{locate, store::{encode_png, AssetStore}};
use std::path::PathBuf;

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("usage: terraria_player_preview <out dir>"));
    std::fs::create_dir_all(&out).unwrap();
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), out.join("cache"));
    let looks = [
        ("default", Appearance::default()),
        ("female_v4_hair5", Appearance {
            skin_variant: 4,
            hair: 5,
            colors: AppearanceColors { hair: "#3a2a1a".into(), shirt: "#c03040".into(), pants: "#304070".into(), ..Default::default() },
            ..Default::default()
        }),
        ("copper_armor", Appearance { armor: ArmorSlots { head: Some(1), body: Some(1), legs: Some(1) }, ..Default::default() }),
        ("variant10", Appearance { skin_variant: 10, hair: 20, ..Default::default() }),
    ];
    for (name, look) in looks {
        let rig = compose(&store, &look).expect("compose");
        println!("{name}: {} frames, missing {:?}", rig.frames.len(), rig.missing);
        println!("  hands: idle {:?} use1 {:?} use3 {:?} shoot {:?} cast {:?}", rig.hands.get("idle"), rig.hands.get("use1"), rig.hands.get("use3"), rig.hands.get("shoot"), rig.hands.get("cast"));
        // 4x magnified, checkerboard behind, a gray line under each cell's body box bottom (y=54).
        let s = 4;
        let (w, h) = (rig.width * s, rig.height * s);
        let mut img = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let src = (((y / s) * rig.width + x / s) * 4) as usize;
                let a = rig.rgba[src + 3] as u32;
                let bg = if ((x / 8) + (y / 8)) % 2 == 0 { 215 } else { 190 };
                let mut px = [0u8; 4];
                for k in 0..3 {
                    px[k] = ((rig.rgba[src + k] as u32 * a + bg * (255 - a)) / 255) as u8;
                }
                px[3] = 255;
                if x % (CELL_W * s) == 0 { px = [120, 120, 140, 255]; }
                if y / s == 54 && a == 0 { px = [255, 120, 120, 255]; }
                let i = ((y * w + x) * 4) as usize;
                img[i..i + 4].copy_from_slice(&px);
            }
        }
        std::fs::write(out.join(format!("rig_{name}.png")), encode_png(w, h, &img).unwrap()).unwrap();
        let _ = CELL_H;
    }
    println!("frames: {:?}", desktop_lib::terraria::player::poses().iter().map(|p| p.name.clone()).collect::<Vec<_>>());
}

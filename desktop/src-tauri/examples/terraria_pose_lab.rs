//! Developer tool: render candidate poses composed from the real sheets for visual comparison.
//!   cargo run --example terraria_pose_lab -- <output dir outside the repo>
use desktop_lib::terraria::player::{compose_poses, Appearance, Pose};
use desktop_lib::terraria::{locate, store::{encode_png, AssetStore}};
use std::path::PathBuf;

fn pose(name: &str, strip: u32, front: (u32, u32), back: (u32, u32), legs_dy: i32, upper_dy: i32) -> Pose {
    Pose { name: name.into(), strip_frame: strip, front_arm: front, back_arm: back, legs_dy, upper_dy }
}

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("out dir"));
    std::fs::create_dir_all(&out).unwrap();
    let store = AssetStore::new(locate::locate(None).unwrap(), out.join("cache"));
    let candidates = vec![
        pose("idle", 0, (2, 0), (2, 0), 0, 0),
        pose("dash", 9, (5, 0), (2, 0), 0, 3),
        pose("cling", 5, (2, 1), (2, 1), 0, 0),
        pose("glide", 5, (3, 0), (3, 0), 0, 0),
        pose("pogo", 5, (6, 0), (2, 0), 0, 2),
        pose("lunge", 9, (5, 1), (2, 0), 0, 4),
        // Diagonal pogo / dive candidates.
        pose("diagA", 5, (6, 0), (3, 0), 0, 3),
        pose("diagB", 9, (6, 0), (2, 1), 0, 3),
        pose("diveA", 9, (6, 0), (6, 0), 0, 5),
        pose("diveB", 5, (6, 0), (5, 0), 0, 5),
        pose("diveC", 13, (6, 0), (2, 1), 0, 5),
        pose("slamA", 1, (6, 0), (2, 0), 0, 6),
    ];
    let rig = compose_poses(&store, &Appearance::default(), &candidates).unwrap();
    let s = 4;
    let (w, h) = (rig.width * s, rig.height * s);
    let mut img = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let src = (((y / s) * rig.width + x / s) * 4) as usize;
            let a = rig.rgba[src + 3] as u32;
            let bg = if (x / (40 * s)) % 2 == 0 { 70 } else { 85 };
            let i = ((y * w + x) * 4) as usize;
            for k in 0..3 {
                img[i + k] = ((rig.rgba[src + k] as u32 * a + bg * (255 - a)) / 255) as u8;
            }
            img[i + 3] = 255;
            if y / s == 54 && a == 0 { img[i..i + 4].copy_from_slice(&[200, 80, 80, 255]); }
        }
    }
    std::fs::write(out.join("pose_lab.png"), encode_png(w, h, &img).unwrap()).unwrap();
    println!("{:?}", rig.frames);
}

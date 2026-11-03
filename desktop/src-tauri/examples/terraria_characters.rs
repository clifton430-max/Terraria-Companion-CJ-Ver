//! Developer tool: compose the roster characters' atlases from the real install and add-on packs.
//!   cargo run --example terraria_characters -- <output dir outside the repo>
use desktop_lib::terraria::player::Appearance;
use desktop_lib::terraria::skins::SkinId;
use desktop_lib::terraria_app::TerrariaAssets;
use std::path::PathBuf;

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("out dir"));
    std::fs::create_dir_all(&out).unwrap();
    let assets = TerrariaAssets::init(out.join("cache"));
    println!("add-ons: {:?}", assets.addon_info());
    for id in ["terrarian", "princess", "partygirl", "nurse", "zoologist", "goblin"] {
        let info = assets.character_rig(id, &Appearance::default(), SkinId::Default);
        println!("{id}: available={} reason={:?} frames={} missing={:?}", info.available, info.reason, info.frames.len(), info.missing);
        if let Some(path) = &info.path {
            let (status, png) = assets.serve(path);
            if status == 200 {
                std::fs::write(out.join(format!("{id}.png")), png).unwrap();
            }
        }
    }
    for p in ["/addon/moongirl/Images/NPC_396.png", "/addon/queenbee/Images/NPC_222.png", "/addonsound/yamete/Female_Hit_0.wav"] {
        let (status, body) = assets.serve(p);
        println!("{p} -> {status} ({} B)", body.len());
    }
}

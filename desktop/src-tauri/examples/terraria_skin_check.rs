//! Developer tool: list installed resource packs, compose the 2B skin from the local install and
//! write a 4x preview, and decode every voice clip (reports formats; writes nothing else).
//!
//!   cargo run --example terraria_skin_check -- <output dir outside the repo>
use desktop_lib::terraria::{locate, packs, player, skins, sound, store::{encode_png, AssetStore}};
use std::path::PathBuf;

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("usage: terraria_skin_check <out dir>"));
    std::fs::create_dir_all(&out).unwrap();
    let all = packs::discover(&locate::steam_libraries(), &locate::local_resource_pack_dirs());
    for p in &all {
        println!("pack {:<12} {:<20} by {:<14} workshop={} armor={:?}", p.id, p.name, p.author, p.workshop, packs::armor_overrides(p));
    }
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), out.join("cache"));
    if let Some((pack, armor)) = packs::find_2b(&all) {
        let src = packs::PackTextures { base: &store, content: pack.content() };
        for n in ["Images/Armor_Head_237", "Images/Armor/Armor_224", "Images/Armor_Legs_205"] {
            println!("  {n}: from pack = {:?}", src.resolve(n).is_some());
        }
        let rig = player::compose_skin(&src, &skins::waifu_2b_appearance(&armor), player::ComposeOptions { front_overlays: true }).unwrap();
        println!("2B rig: {} frames {}x{} missing {:?}", rig.frames.len(), rig.width, rig.height, rig.missing);
        let s = 4u32;
        let (w, h) = (rig.width * s, rig.height * s);
        let mut px = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let si = (((y / s) * rig.width + x / s) * 4) as usize;
                let a = rig.rgba[si + 3] as u32;
                let bg = if ((x / 16) + (y / 16)) % 2 == 0 { 70 } else { 90 };
                let di = ((y * w + x) * 4) as usize;
                for k in 0..3 {
                    px[di + k] = ((rig.rgba[si + k] as u32 * a + bg * (255 - a)) / 255) as u8;
                }
                px[di + 3] = 255;
            }
        }
        std::fs::write(out.join("2b_rig.png"), encode_png(w, h, &px).unwrap()).unwrap();
        println!("frames: {:?}", rig.frames);
    } else {
        println!("no 2B pack found");
    }
    if let Some(vp) = packs::find_voice_pack(&all) {
        println!("voice pack {} ({} voices)", vp.pack.name, vp.voices.len());
        for v in &vp.voices {
            let mut line = format!("  {:>6} {:<36}", v.id, v.label);
            for c in &v.clips {
                let f = packs::clip_file(&v.dir, c).unwrap();
                let bytes = std::fs::read(&f).unwrap();
                let info = if f.extension().is_some_and(|e| e == "wav") { sound::validate_wav(&bytes) } else { sound::xnb_to_wav(&bytes).map(|r| r.1) };
                match info {
                    Ok(i) => line += &format!(" {c}={:.2}s/{}Hz/{}b/{}ch[{}]", i.seconds(), i.sample_rate, i.bits, i.channels, f.extension().unwrap().to_string_lossy()),
                    Err(e) => line += &format!(" {c}=ERR({e})"),
                }
            }
            println!("{line}");
        }
    }
}

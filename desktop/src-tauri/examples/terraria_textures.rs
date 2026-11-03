//! Developer tool: decode textures from the local install and write 2x previews (no grid).
//!
//!   cargo run --example terraria_textures -- <output dir outside the repo> Images/NPC_4 Images/Item_757 ...
use desktop_lib::terraria::{locate, store::{encode_png, AssetStore}};
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let out = PathBuf::from(args.next().expect("usage: terraria_textures <out dir> <names...>"));
    std::fs::create_dir_all(&out).unwrap();
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), out.join("cache"));
    for name in args {
        match store.texture(&name) {
            Ok(t) => {
                println!("{name:<34} {:>4}x{:<4}", t.width, t.height);
                let s = 2u32;
                let (w, h) = (t.width * s, t.height * s);
                let mut img = vec![0u8; (w * h * 4) as usize];
                for y in 0..h {
                    for x in 0..w {
                        let src = (((y / s) * t.width + x / s) * 4) as usize;
                        let a = t.rgba[src + 3] as u32;
                        let bg = if ((x / 8) + (y / 8)) % 2 == 0 { 60 } else { 75 };
                        let i = ((y * w + x) * 4) as usize;
                        for k in 0..3 {
                            img[i + k] = ((t.rgba[src + k] as u32 * a + bg * (255 - a)) / 255) as u8;
                        }
                        img[i + 3] = 255;
                    }
                }
                std::fs::write(out.join(format!("{}.png", name.replace('/', "_"))), encode_png(w, h, &img).unwrap()).unwrap();
            }
            Err(e) => println!("{name:<34} ERROR {e}"),
        }
    }
}

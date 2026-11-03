//! Developer tool: several whole sheets side by side (1×, with a 2 px gap), for counting frames.
//!
//!   cargo run --example terraria_strip -- <out.png> <prefix> <ids...>
use desktop_lib::terraria::{locate, store::{encode_png, AssetStore}};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), std::env::temp_dir().join("tc_contact_cache"));
    let texs: Vec<_> = args[2..].iter().filter_map(|id| store.texture(&format!("{}{id}", args[1])).ok()).collect();
    let w: u32 = texs.iter().map(|t| t.width + 6).sum();
    let h: u32 = texs.iter().map(|t| t.height).max().unwrap_or(1);
    let mut img = vec![0u8; (w * h * 4) as usize];
    for (i, p) in img.chunks_mut(4).enumerate() {
        let (x, y) = (i as u32 % w, i as u32 / w);
        let v = if (y / 2) % 2 == 0 && x % 7 == 0 { 120 } else { 50 };
        p.copy_from_slice(&[v, v, v + 20, 255]);
    }
    let mut x0 = 0;
    for t in &texs {
        for y in 0..t.height {
            for x in 0..t.width {
                let s = ((y * t.width + x) * 4) as usize;
                let a = t.rgba[s + 3] as u32;
                let k = ((y * w + x0 + x) * 4) as usize;
                for c in 0..3 {
                    img[k + c] = ((t.rgba[s + c] as u32 * a + img[k + c] as u32 * (255 - a)) / 255) as u8;
                }
            }
        }
        x0 += t.width + 6;
    }
    std::fs::write(&args[0], encode_png(w, h, &img).unwrap()).unwrap();
}

//! Developer tool: every furniture style on a tile sheet as a labelled cell (style index), to
//! find which style is which material.
//!
//!   cargo run --example terraria_styles -- <out.png> <Images/Tiles_N> <h|v> <stride> <fw> <fh>
use desktop_lib::terraria::{locate, store::{encode_png, AssetStore}};

const DIGITS: [[u8; 5]; 10] = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1], [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), std::env::temp_dir().join("tc_contact_cache"));
    let t = store.texture(&a[1]).expect("texture");
    let horiz = a[2] == "h";
    let (stride, fw, fh): (u32, u32, u32) = (a[3].parse().unwrap(), a[4].parse().unwrap(), a[5].parse().unwrap());
    let n = if horiz { t.width / stride } else { t.height / stride };
    let cols = 10u32;
    let (cw, ch) = (fw * 2 + 4, fh * 2 + 12);
    let rows = n.div_ceil(cols);
    let (w, h) = (cols * cw, rows * ch);
    let mut img = vec![45u8; (w * h * 4) as usize];
    for p in img.chunks_mut(4) {
        p[3] = 255;
    }
    for i in 0..n {
        let (cx, cy) = ((i % cols) * cw, (i / cols) * ch);
        for (d, c) in i.to_string().chars().enumerate() {
            let g = DIGITS[c.to_digit(10).unwrap() as usize];
            for (ry, row) in g.iter().enumerate() {
                for rx in 0..3 {
                    if row >> (2 - rx) & 1 == 1 {
                        let k = (((cy + 2 + ry as u32) * w + cx + 2 + d as u32 * 4 + rx) * 4) as usize;
                        img[k..k + 3].copy_from_slice(&[255, 230, 80]);
                    }
                }
            }
        }
        let (sx0, sy0) = if horiz { (i * stride, 0) } else { (0, i * stride) };
        for y in 0..fh * 2 {
            for x in 0..fw * 2 {
                let (sx, sy) = (sx0 + x / 2, sy0 + y / 2);
                if sx >= t.width || sy >= t.height {
                    continue;
                }
                let s = ((sy * t.width + sx) * 4) as usize;
                let al = t.rgba[s + 3] as u32;
                let k = (((cy + 10 + y) * w + cx + x) * 4) as usize;
                for c in 0..3 {
                    img[k + c] = ((t.rgba[s + c] as u32 * al + img[k + c] as u32 * (255 - al)) / 255) as u8;
                }
            }
        }
    }
    std::fs::write(&a[0], encode_png(w, h, &img).unwrap()).unwrap();
    println!("{} styles", n);
}

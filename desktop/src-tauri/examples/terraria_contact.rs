//! Developer tool: a labelled contact sheet of many textures from the local install, for checking
//! which id shows what before using it (nothing is copied into the repo).
//!
//!   cargo run --example terraria_contact -- <out.png> <prefix> <ids or ranges...> [--top N] [--width N] [--cell N]
//!
//! e.g. `... /tmp/items.png Images/Item_ 1-120` or `... /tmp/npc.png Images/NPC_ 1-60 --top 60`.
//! `--top N` crops each texture to its top N pixels (the first frame of a vertical sheet).
use desktop_lib::terraria::{locate, store::{encode_png, AssetStore}};
use std::path::PathBuf;

// A 3×5 digit font for the labels.
const DIGITS: [[u8; 5]; 10] = [
    [7, 5, 5, 5, 7],
    [2, 6, 2, 2, 7],
    [7, 1, 7, 4, 7],
    [7, 1, 7, 1, 7],
    [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7],
    [7, 4, 7, 5, 7],
    [7, 1, 1, 1, 1],
    [7, 5, 7, 5, 7],
    [7, 5, 7, 1, 7],
];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = PathBuf::from(&args[0]);
    let prefix = &args[1];
    let mut ids: Vec<u32> = Vec::new();
    let mut top: Option<u32> = None;
    let mut width: Option<u32> = None;
    let (mut ox, mut oy) = (0u32, 0u32);
    let mut cell = 64u32;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--top" => {
                top = args[i + 1].parse().ok();
                i += 2;
                continue;
            }
            "--at" => {
                let (a, b) = args[i + 1].split_once(',').unwrap();
                ox = a.parse().unwrap();
                oy = b.parse().unwrap();
                i += 2;
                continue;
            }
            "--width" => {
                width = args[i + 1].parse().ok();
                i += 2;
                continue;
            }
            "--cell" => {
                cell = args[i + 1].parse().unwrap();
                i += 2;
                continue;
            }
            a => {
                if let Some((x, y)) = a.split_once('-') {
                    ids.extend(x.parse::<u32>().unwrap()..=y.parse::<u32>().unwrap());
                } else {
                    ids.push(a.parse().unwrap());
                }
            }
        }
        i += 1;
    }
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), std::env::temp_dir().join("tc_contact_cache"));
    let cols = 12u32;
    let label_h = 8u32;
    let ch = cell + label_h;
    let rows = (ids.len() as u32).div_ceil(cols);
    let (w, h) = (cols * cell, rows * ch);
    let mut img = vec![40u8; (w * h * 4) as usize];
    for p in img.chunks_mut(4) {
        p[3] = 255;
    }
    for (n, id) in ids.iter().enumerate() {
        let (cx, cy) = ((n as u32 % cols) * cell, (n as u32 / cols) * ch);
        // checker background
        for y in 0..cell {
            for x in 0..cell {
                let v = if ((x / 6) + (y / 6)) % 2 == 0 { 70 } else { 85 };
                let k = (((cy + label_h + y) * w + cx + x) * 4) as usize;
                img[k] = v;
                img[k + 1] = v;
                img[k + 2] = v;
            }
        }
        // label
        let s = id.to_string();
        for (d, c) in s.chars().enumerate() {
            let g = DIGITS[c.to_digit(10).unwrap() as usize];
            for (ry, row) in g.iter().enumerate() {
                for rx in 0..3 {
                    if row >> (2 - rx) & 1 == 1 {
                        let k = (((cy + 1 + ry as u32) * w + cx + 1 + d as u32 * 4 + rx) * 4) as usize;
                        img[k] = 255;
                        img[k + 1] = 230;
                        img[k + 2] = 80;
                    }
                }
            }
        }
        let Ok(t) = store.texture(&format!("{prefix}{id}")) else { continue };
        let th = top.map_or(t.height, |n| n.min(t.height.saturating_sub(oy)));
        let tw = width.map_or(t.width, |n| n.min(t.width.saturating_sub(ox)));
        let scale = (cell as f32 / tw.max(th) as f32).min(2.0);
        for y in 0..cell {
            for x in 0..cell {
                let (sx, sy) = ((x as f32 / scale) as u32, (y as f32 / scale) as u32);
                if sx >= tw || sy >= th {
                    continue;
                }
                let src = (((sy + oy) * t.width + sx + ox) * 4) as usize;
                let a = t.rgba[src + 3] as u32;
                if a == 0 {
                    continue;
                }
                let k = (((cy + label_h + y) * w + cx + x) * 4) as usize;
                for c in 0..3 {
                    img[k + c] = ((t.rgba[src + c] as u32 * a + img[k + c] as u32 * (255 - a)) / 255) as u8;
                }
            }
        }
    }
    std::fs::write(&out, encode_png(w, h, &img).unwrap()).unwrap();
    println!("wrote {} ({} textures)", out.display(), ids.len());
}

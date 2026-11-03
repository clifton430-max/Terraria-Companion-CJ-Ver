//! Developer tool: measure the player sprite sheets in the local Terraria install.
//!
//!   cargo run --example terraria_sheets -- <output dir outside the repo> [layer names...]
//!
//! Prints the opaque bounding box of every 40x56 cell (composite 9x4 sheets) or frame (vertical
//! strips) and writes magnified previews with a cell grid to the output directory. It reads the
//! game files in place and never writes inside the repository or the game folder.

use desktop_lib::terraria::{locate, store::AssetStore};
use std::path::PathBuf;

const CELL_W: u32 = 40;
const CELL_H: u32 = 56;

fn bbox(rgba: &[u8], width: u32, x0: u32, y0: u32, w: u32, h: u32) -> Option<(u32, u32, u32, u32)> {
    let (mut minx, mut miny, mut maxx, mut maxy) = (u32::MAX, u32::MAX, 0, 0);
    for y in y0..y0 + h {
        for x in x0..x0 + w {
            if rgba[((y * width + x) * 4 + 3) as usize] > 0 {
                minx = minx.min(x - x0);
                miny = miny.min(y - y0);
                maxx = maxx.max(x - x0);
                maxy = maxy.max(y - y0);
            }
        }
    }
    (minx != u32::MAX).then_some((minx, miny, maxx, maxy))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = PathBuf::from(args.get(1).expect("usage: terraria_sheets <out dir> [names]"));
    std::fs::create_dir_all(&out).unwrap();
    let install = locate::locate(None).expect("Terraria not found");
    println!("content: {}  version {:?}  build {:?}", install.content_dir.display(), install.version, install.build_id);
    let store = AssetStore::new(install, out.join("cache"));
    let defaults: Vec<String> = (0..=15).map(|i| format!("Images/Player_0_{i}")).chain(["Images/Player_Hair_1".into(), "Images/Armor/Armor_1".into(), "Images/Armor_Head_1".into(), "Images/Armor_Legs_1".into()]).collect();
    let names: Vec<String> = if args.len() > 2 { args[2..].to_vec() } else { defaults };

    for name in names {
        let tex = match store.texture(&name) {
            Ok(t) => t,
            Err(e) => {
                println!("{name}: {e}");
                continue;
            }
        };
        let cols = tex.width / CELL_W;
        let rows = tex.height / CELL_H;
        println!("\n{name} {}x{} → {cols} cols x {rows} rows of 40x56 (remainder h {})", tex.width, tex.height, tex.height % CELL_H);
        for r in 0..rows {
            let mut line = String::new();
            for c in 0..cols {
                match bbox(&tex.rgba, tex.width, c * CELL_W, r * CELL_H, CELL_W, CELL_H) {
                    Some((x0, y0, x1, y1)) => line += &format!(" [{c},{r}]x{x0}-{x1},y{y0}-{y1}"),
                    None => {}
                }
            }
            if !line.is_empty() {
                println!("  row {r}:{line}");
            }
        }
        // Magnified preview with a red cell grid, on a checkerboard.
        let s = 4u32;
        let (w, h) = (tex.width * s, tex.height * s);
        let mut img = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let src = (((y / s) * tex.width + x / s) * 4) as usize;
                let checker = if ((x / 8) + (y / 8)) % 2 == 0 { 205 } else { 180 };
                let a = tex.rgba[src + 3] as u32;
                for k in 0..3 {
                    img[i + k] = ((tex.rgba[src + k] as u32 * a + checker * (255 - a)) / 255) as u8;
                }
                img[i + 3] = 255;
                if x % (CELL_W * s) == 0 || y % (CELL_H * s) == 0 {
                    img[i..i + 4].copy_from_slice(&[255, 0, 0, 255]);
                }
            }
        }
        let file = out.join(format!("{}.png", name.replace('/', "_")));
        std::fs::write(&file, desktop_lib::terraria::store::encode_png(w, h, &img).unwrap()).unwrap();
    }
}

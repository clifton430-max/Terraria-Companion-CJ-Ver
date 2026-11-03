//! Developer tool: how often each 40×56 cell of the composite body sheets (`Images/Armor/Armor_N`)
//! has opaque pixels, across every installed sheet — used to infer which cells the game reads.
//!   cargo run --example terraria_composite_scan
use desktop_lib::terraria::{locate, store::AssetStore};
fn main() {
    let store = AssetStore::new(locate::locate(None).expect("Terraria not found"), std::env::temp_dir().join("tc-composite-scan"));
    let mut counts = [[0u32; 9]; 4];
    let mut sheets = 0;
    for id in 1..400 {
        let Ok(t) = store.texture(&format!("Images/Armor/Armor_{id}")) else { continue };
        if t.width != 360 || t.height != 224 {
            continue;
        }
        sheets += 1;
        for r in 0..4u32 {
            for c in 0..9u32 {
                let mut n = 0;
                for y in r * 56..r * 56 + 56 {
                    for x in c * 40..c * 40 + 40 {
                        if t.rgba[((y * 360 + x) * 4 + 3) as usize] > 0 {
                            n += 1;
                        }
                    }
                }
                if n > 20 {
                    counts[r as usize][c as usize] += 1;
                }
            }
        }
    }
    println!("{sheets} sheets; cells with >20 opaque px:");
    for (r, row) in counts.iter().enumerate() {
        println!("row {r}: {:?}", row);
    }
}

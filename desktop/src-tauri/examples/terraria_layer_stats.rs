//! Developer tool: compare layer brightness per composite cell (e.g. back-arm vs front-arm layers).
//!   cargo run --example terraria_layer_stats -- Images/Player_0_4 Images/Player_0_8 ...
use desktop_lib::terraria::{locate, store::AssetStore};
fn main() {
    let names: Vec<String> = std::env::args().skip(1).collect();
    let install = locate::locate(None).expect("Terraria not found");
    let store = AssetStore::new(install, std::env::temp_dir().join("tc-layer-stats"));
    for name in names {
        let t = store.texture(&name).unwrap();
        let (cols, rows) = (t.width / 40, t.height / 56);
        let mut line = format!("{name:<22}");
        for r in 0..rows.min(4) {
            for c in 0..cols {
                let (mut sum, mut n) = (0u64, 0u64);
                for y in r * 56..r * 56 + 56 {
                    for x in c * 40..c * 40 + 40 {
                        let i = ((y * t.width + x) * 4) as usize;
                        if t.rgba[i + 3] > 0 {
                            sum += t.rgba[i] as u64 + t.rgba[i + 1] as u64 + t.rgba[i + 2] as u64;
                            n += 1;
                        }
                    }
                }
                if n > 0 {
                    line += &format!(" [{c},{r}]avg{:>3}/{n}px", sum / (3 * n));
                }
            }
        }
        println!("{line}");
    }
}

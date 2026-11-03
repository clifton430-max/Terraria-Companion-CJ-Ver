//! Local-only access to the user's installed Terraria art.
//!
//! Assets are read from the user's own game install at runtime, decoded on demand and cached
//! under the user's Library cache folder. No game assets are bundled, committed or redistributed.

pub mod alpha;
pub mod locate;
pub mod store;
pub mod xnb;
pub mod player;
pub mod packs;
pub mod sound;
pub mod skins;
pub mod addons;

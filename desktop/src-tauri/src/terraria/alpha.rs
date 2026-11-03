//! Alpha conversion. XNA's content pipeline stores textures with premultiplied alpha; browser
//! canvases (and PNG) expect straight alpha.

/// Convert premultiplied RGBA8 to straight alpha in place. Fully transparent pixels become
/// (0,0,0,0) so they can never bleed colour at edges when scaled or tinted.
pub fn unpremultiply(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as u32;
        match a {
            0 => px[..3].fill(0),
            255 => {}
            _ => {
                for c in &mut px[..3] {
                    *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_pixels_are_unchanged() {
        let mut px = vec![10, 200, 30, 255];
        unpremultiply(&mut px);
        assert_eq!(px, vec![10, 200, 30, 255]);
    }

    #[test]
    fn semi_transparent_pixels_are_scaled_back_up() {
        let mut px = vec![64, 32, 0, 128, 100, 100, 100, 100];
        unpremultiply(&mut px);
        assert_eq!(px, vec![128, 64, 0, 128, 255, 255, 255, 100]);
    }

    #[test]
    fn transparent_edges_become_clean_zero() {
        // A stray colour value under alpha 0 (possible after filtering) must not survive.
        let mut px = vec![12, 34, 56, 0];
        unpremultiply(&mut px);
        assert_eq!(px, vec![0, 0, 0, 0]);
    }

    #[test]
    fn out_of_range_values_clamp() {
        // Invalid premultiplied data (channel > alpha) clamps rather than wrapping.
        let mut px = vec![200, 10, 10, 100];
        unpremultiply(&mut px);
        assert_eq!(px, vec![255, 26, 26, 100]);
    }
}

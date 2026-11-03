//! Decoder for XNA 4.0 `.xnb` texture files as shipped with Terraria.
//!
//! Supported: platform `w`/`m`/`x`, format version 5, LZX-compressed (flag 0x80) or uncompressed
//! bodies, a single `Texture2D` with SurfaceFormat 0 (`Color`, RGBA8). Every length field is
//! bounds-checked; malformed input returns an error, never panics.

use std::fmt;

/// Largest texture edge accepted (Terraria's biggest sheets are far smaller).
pub const MAX_DIMENSION: u32 = 8192;
/// Largest decompressed payload accepted.
pub const MAX_DECOMPRESSED: usize = 64 * 1024 * 1024;
const TEXTURE2D_READER: &str = "Microsoft.Xna.Framework.Content.Texture2DReader";
const FLAG_LZX: u8 = 0x80;
const FLAG_LZ4: u8 = 0x40;
/// XNA LZX frames decode to 32 KB unless a frame header says otherwise.
const DEFAULT_FRAME: usize = 0x8000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XnbError {
    NotXnb,
    UnsupportedPlatform(u8),
    UnsupportedVersion(u8),
    UnsupportedCompression(u8),
    Truncated(&'static str),
    Decompress(String),
    NotATexture(String),
    UnsupportedSurfaceFormat(i32),
    BadDimensions { width: u32, height: u32 },
}

impl fmt::Display for XnbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotXnb => write!(f, "not an XNB file"),
            Self::UnsupportedPlatform(p) => write!(f, "unsupported XNB platform {:?}", *p as char),
            Self::UnsupportedVersion(v) => write!(f, "unsupported XNB version {v}"),
            Self::UnsupportedCompression(flags) => write!(f, "unsupported XNB compression flags {flags:#04x}"),
            Self::Truncated(what) => write!(f, "truncated XNB ({what})"),
            Self::Decompress(e) => write!(f, "LZX decompression failed: {e}"),
            Self::NotATexture(reader) => write!(f, "XNB is not a Texture2D (reader {reader})"),
            Self::UnsupportedSurfaceFormat(s) => write!(f, "unsupported surface format {s} (only Color/0)"),
            Self::BadDimensions { width, height } => write!(f, "bad texture dimensions {width}x{height}"),
        }
    }
}

impl std::error::Error for XnbError {}

/// A decoded texture. `rgba` is row-major RGBA8 exactly as stored (premultiplied alpha);
/// see [`super::alpha::unpremultiply`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Texture {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize, what: &'static str) -> Result<&'a [u8], XnbError> {
        let end = self.pos.checked_add(n).ok_or(XnbError::Truncated(what))?;
        let slice = self.buf.get(self.pos..end).ok_or(XnbError::Truncated(what))?;
        self.pos = end;
        Ok(slice)
    }
    fn u8(&mut self, what: &'static str) -> Result<u8, XnbError> {
        Ok(self.take(1, what)?[0])
    }
    fn u32(&mut self, what: &'static str) -> Result<u32, XnbError> {
        Ok(u32::from_le_bytes(self.take(4, what)?.try_into().unwrap()))
    }
    fn i32(&mut self, what: &'static str) -> Result<i32, XnbError> {
        Ok(self.u32(what)? as i32)
    }
    /// .NET 7-bit encoded int (at most 5 bytes).
    fn varint(&mut self, what: &'static str) -> Result<u32, XnbError> {
        let mut value = 0u32;
        for shift in (0..35).step_by(7) {
            let byte = self.u8(what)?;
            value |= ((byte & 0x7f) as u32) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(XnbError::Truncated(what))
    }
    fn string(&mut self, what: &'static str) -> Result<String, XnbError> {
        let len = self.varint(what)? as usize;
        if len > 1024 {
            return Err(XnbError::Truncated(what));
        }
        Ok(String::from_utf8_lossy(self.take(len, what)?).into_owned())
    }
}

/// Undo XNA's LZX framing: a sequence of `[0xFF, frame_hi, frame_lo, block_hi, block_lo]` or
/// `[block_hi, block_lo]` headers (frame defaults to 32 KB), each followed by one LZX chunk.
pub fn decompress_lzx(data: &[u8], output_len: usize) -> Result<Vec<u8>, XnbError> {
    if output_len > MAX_DECOMPRESSED {
        return Err(XnbError::Decompress(format!("declared size {output_len} too large")));
    }
    let mut lzx = lzxd::Lzxd::new(lzxd::WindowSize::KB64);
    let mut out = Vec::with_capacity(output_len);
    let mut pos = 0usize;
    while out.len() < output_len {
        let header = data.get(pos..).ok_or(XnbError::Truncated("lzx frame header"))?;
        let (frame, block, used) = match header {
            [0xFF, fh, fl, bh, bl, ..] => (((*fh as usize) << 8) | *fl as usize, ((*bh as usize) << 8) | *bl as usize, 5),
            [bh, bl, ..] => (DEFAULT_FRAME, ((*bh as usize) << 8) | *bl as usize, 2),
            _ => return Err(XnbError::Truncated("lzx frame header")),
        };
        pos += used;
        if block == 0 || frame == 0 {
            return Err(XnbError::Decompress("zero-sized lzx frame".into()));
        }
        let frame = frame.min(output_len - out.len());
        let chunk = data.get(pos..pos + block).ok_or(XnbError::Truncated("lzx frame data"))?;
        let decoded = lzx.decompress_next(chunk, frame).map_err(|e| XnbError::Decompress(format!("{e:?}")))?;
        out.extend_from_slice(decoded);
        pos += block;
    }
    Ok(out)
}

/// Decode an XNB file containing a `Texture2D`.
pub fn decode_texture(file: &[u8]) -> Result<Texture, XnbError> {
    if file.len() < 10 || &file[0..3] != b"XNB" {
        return Err(XnbError::NotXnb);
    }
    let platform = file[3];
    if !matches!(platform, b'w' | b'm' | b'x') {
        return Err(XnbError::UnsupportedPlatform(platform));
    }
    if file[4] != 5 {
        return Err(XnbError::UnsupportedVersion(file[4]));
    }
    let flags = file[5];
    if flags & FLAG_LZ4 != 0 {
        return Err(XnbError::UnsupportedCompression(flags));
    }
    let total = u32::from_le_bytes(file[6..10].try_into().unwrap()) as usize;
    if total > file.len() || total < 10 {
        return Err(XnbError::Truncated("file size field"));
    }
    let payload = if flags & FLAG_LZX != 0 {
        let header = file.get(10..14).ok_or(XnbError::Truncated("decompressed size"))?;
        let out_len = u32::from_le_bytes(header.try_into().unwrap()) as usize;
        decompress_lzx(&file[14..total], out_len)?
    } else {
        file[10..total].to_vec()
    };
    parse_texture_payload(&payload)
}

fn parse_texture_payload(payload: &[u8]) -> Result<Texture, XnbError> {
    let mut r = Reader { buf: payload, pos: 0 };
    let readers = r.varint("reader count")?;
    if readers == 0 || readers > 32 {
        return Err(XnbError::NotATexture(format!("{readers} type readers")));
    }
    let mut first = String::new();
    for i in 0..readers {
        let name = r.string("reader name")?;
        r.i32("reader version")?;
        if i == 0 {
            first = name;
        }
    }
    r.varint("shared resource count")?;
    let type_id = r.varint("primary type id")?;
    if type_id != 1 || !first.starts_with(TEXTURE2D_READER) {
        return Err(XnbError::NotATexture(first));
    }
    let format = r.i32("surface format")?;
    if format != 0 {
        return Err(XnbError::UnsupportedSurfaceFormat(format));
    }
    let width = r.u32("width")?;
    let height = r.u32("height")?;
    let mips = r.u32("mip count")?;
    if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION || mips == 0 {
        return Err(XnbError::BadDimensions { width, height });
    }
    let size = r.u32("mip size")? as usize;
    let expected = width as usize * height as usize * 4;
    if size != expected {
        return Err(XnbError::Truncated("mip data size mismatch"));
    }
    let rgba = r.take(size, "pixel data")?.to_vec();
    Ok(Texture { width, height, rgba })
}

#[cfg(test)]
pub(crate) mod fixtures {
    //! Synthetic XNB/LZX builders for tests. No game data is used anywhere in the test suite.

    /// Texture2D payload (type readers + header + one mip) for the given RGBA pixels.
    pub fn texture_payload(width: u32, height: u32, rgba: &[u8], format: i32) -> Vec<u8> {
        let mut p = vec![1u8]; // one type reader
        let reader = b"Microsoft.Xna.Framework.Content.Texture2DReader, Microsoft.Xna.Framework.Graphics";
        p.push(reader.len() as u8 | 0x80);
        p.push((reader.len() >> 7) as u8);
        p.extend_from_slice(reader);
        p.extend_from_slice(&0i32.to_le_bytes());
        p.push(0); // shared resources
        p.push(1); // primary object uses reader 1
        p.extend_from_slice(&format.to_le_bytes());
        p.extend_from_slice(&width.to_le_bytes());
        p.extend_from_slice(&height.to_le_bytes());
        p.extend_from_slice(&1u32.to_le_bytes());
        p.extend_from_slice(&(rgba.len() as u32).to_le_bytes());
        p.extend_from_slice(rgba);
        p
    }

    pub fn xnb_uncompressed(payload: &[u8]) -> Vec<u8> {
        let mut f = b"XNBw\x05\x01".to_vec();
        f.extend_from_slice(&((10 + payload.len()) as u32).to_le_bytes());
        f.extend_from_slice(payload);
        f
    }

    /// Encode `data` as a genuine LZX stream made of one *uncompressed* block, split into XNA
    /// frames of up to 32 KB (each with the explicit 0xFF frame header).
    pub fn xnb_lzx(payload: &[u8]) -> Vec<u8> {
        let n = payload.len() as u32;
        // Bits, MSB first: E8 flag (0), block type 011, 24-bit block size, then 4 bits of padding
        // so the following align() lands on a word boundary.
        let bits: u32 = (0b0011 << 28) | (n << 4);
        let words = [(bits >> 16) as u16, bits as u16];
        let mut stream = Vec::new();
        for w in words {
            stream.extend_from_slice(&w.to_le_bytes());
        }
        for _ in 0..3 {
            stream.extend_from_slice(&1u32.to_le_bytes()); // R0..R2
        }
        let header_len = stream.len();
        stream.extend_from_slice(payload);

        // Frame the stream: the first chunk carries the block header plus up to 32 KB of data.
        let mut body = Vec::new();
        let mut offset = 0usize;
        let mut produced = 0usize;
        while produced < payload.len() {
            let frame = (payload.len() - produced).min(0x8000);
            let chunk_len = frame + if offset == 0 { header_len } else { 0 };
            body.push(0xFF);
            body.extend_from_slice(&(frame as u16).to_be_bytes());
            body.extend_from_slice(&(chunk_len as u16).to_be_bytes());
            body.extend_from_slice(&stream[offset..offset + chunk_len]);
            offset += chunk_len;
            produced += frame;
        }

        let mut f = b"XNBw\x05\x81".to_vec();
        f.extend_from_slice(&((14 + body.len()) as u32).to_le_bytes());
        f.extend_from_slice(&n.to_le_bytes());
        f.extend_from_slice(&body);
        f
    }

    pub fn gradient(width: u32, height: u32) -> Vec<u8> {
        (0..width * height)
            .flat_map(|i| [(i % 251) as u8, (i % 113) as u8, (i % 7) as u8 * 30, 255])
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    #[test]
    fn decodes_uncompressed_texture() {
        let px = gradient(3, 2);
        let tex = decode_texture(&xnb_uncompressed(&texture_payload(3, 2, &px, 0))).unwrap();
        assert_eq!((tex.width, tex.height), (3, 2));
        assert_eq!(tex.rgba, px);
    }

    #[test]
    fn decodes_lzx_texture_single_frame() {
        let px = gradient(16, 8);
        let tex = decode_texture(&xnb_lzx(&texture_payload(16, 8, &px, 0))).unwrap();
        assert_eq!(tex.rgba, px);
    }

    #[test]
    fn decodes_lzx_texture_spanning_multiple_32k_frames() {
        let px = gradient(128, 100); // 51,200 bytes of pixels → two LZX frames
        let file = xnb_lzx(&texture_payload(128, 100, &px, 0));
        let tex = decode_texture(&file).unwrap();
        assert_eq!((tex.width, tex.height), (128, 100));
        assert_eq!(tex.rgba, px);
    }

    #[test]
    fn rejects_non_xnb_and_unsupported_variants() {
        assert_eq!(decode_texture(b"PNG\x00\x00\x00\x00\x00\x00\x00"), Err(XnbError::NotXnb));
        let mut f = xnb_uncompressed(&texture_payload(1, 1, &[0; 4], 0));
        f[3] = b'q';
        assert_eq!(decode_texture(&f), Err(XnbError::UnsupportedPlatform(b'q')));
        let mut f = xnb_uncompressed(&texture_payload(1, 1, &[0; 4], 0));
        f[4] = 4;
        assert_eq!(decode_texture(&f), Err(XnbError::UnsupportedVersion(4)));
        let mut f = xnb_uncompressed(&texture_payload(1, 1, &[0; 4], 0));
        f[5] = 0x41;
        assert_eq!(decode_texture(&f), Err(XnbError::UnsupportedCompression(0x41)));
    }

    #[test]
    fn rejects_unsupported_surface_formats() {
        let f = xnb_uncompressed(&texture_payload(1, 1, &[0; 4], 4)); // DXT1
        assert_eq!(decode_texture(&f), Err(XnbError::UnsupportedSurfaceFormat(4)));
    }

    #[test]
    fn rejects_bad_dimensions_and_size_mismatch() {
        let f = xnb_uncompressed(&texture_payload(0, 1, &[], 0));
        assert!(matches!(decode_texture(&f), Err(XnbError::BadDimensions { .. })));
        let f = xnb_uncompressed(&texture_payload(9000, 1, &[0; 4], 0));
        assert!(matches!(decode_texture(&f), Err(XnbError::BadDimensions { .. })));
        let f = xnb_uncompressed(&texture_payload(2, 2, &[0; 4], 0)); // claims 2x2 with 1 pixel
        assert!(matches!(decode_texture(&f), Err(XnbError::Truncated(_))));
    }

    #[test]
    fn truncated_and_corrupt_files_error_instead_of_panicking() {
        let full = xnb_lzx(&texture_payload(16, 8, &gradient(16, 8), 0));
        for cut in [5, 11, 14, 20, full.len() / 2, full.len() - 1] {
            let mut f = full[..cut].to_vec();
            if f.len() >= 10 {
                let len = f.len() as u32;
                f[6..10].copy_from_slice(&len.to_le_bytes());
            }
            assert!(decode_texture(&f).is_err(), "cut at {cut} should fail");
        }
        let mut garbage = full.clone();
        for b in garbage.iter_mut().skip(20).step_by(3) {
            *b ^= 0x5a;
        }
        assert!(decode_texture(&garbage).is_err());
    }

    #[test]
    fn rejects_non_texture_content() {
        let mut p = texture_payload(1, 1, &[0; 4], 0);
        let reader = b"Microsoft.Xna.Framework.Content.SpriteFontReader";
        let mut q = vec![1u8, reader.len() as u8];
        q.extend_from_slice(reader);
        q.extend_from_slice(&0i32.to_le_bytes());
        q.extend_from_slice(&[0, 1]);
        p = [q, p.split_off(p.len() - 24)].concat();
        assert!(matches!(decode_texture(&xnb_uncompressed(&p)), Err(XnbError::NotATexture(_))));
    }
}

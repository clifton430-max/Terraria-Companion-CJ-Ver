//! Sound files from the local install and resource packs: XNA `SoundEffect` `.xnb` files are
//! converted to plain RIFF/WAVE (PCM only); existing `.wav` files are validated and passed through.
//! Malformed or unsupported input returns an error, never panics.

use super::xnb::{decompress_lzx, XnbError, MAX_DECOMPRESSED};
use std::fmt;

/// Largest sound file accepted (Terraria's longest effects are well under this).
pub const MAX_SOUND_BYTES: usize = 32 * 1024 * 1024;
const SOUND_EFFECT_READER: &str = "Microsoft.Xna.Framework.Content.SoundEffectReader";
const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_FLOAT: u16 = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundError {
    Xnb(XnbError),
    NotASound(String),
    /// e.g. ADPCM (2) or xWMA — not decodable by the WebView, so rejected up front.
    UnsupportedCodec(u16),
    Malformed(&'static str),
    TooLarge(usize),
}

impl fmt::Display for SoundError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Xnb(e) => write!(f, "{e}"),
            Self::NotASound(reader) => write!(f, "XNB is not a SoundEffect (reader {reader})"),
            Self::UnsupportedCodec(tag) => write!(f, "unsupported audio codec (format tag {tag})"),
            Self::Malformed(what) => write!(f, "malformed sound ({what})"),
            Self::TooLarge(n) => write!(f, "sound too large ({n} bytes)"),
        }
    }
}

impl std::error::Error for SoundError {}

impl From<XnbError> for SoundError {
    fn from(e: XnbError) -> Self {
        Self::Xnb(e)
    }
}

/// Basic facts about a PCM sound (for the audit and tests).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoundInfo {
    pub format_tag: u16,
    pub channels: u16,
    pub sample_rate: u32,
    pub bits: u16,
    pub data_len: u32,
}

impl SoundInfo {
    pub fn seconds(&self) -> f32 {
        let bytes_per_sec = self.sample_rate as f32 * self.channels as f32 * (self.bits as f32 / 8.0);
        if bytes_per_sec > 0.0 { self.data_len as f32 / bytes_per_sec } else { 0.0 }
    }
}

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    b.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}
fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn varint(b: &[u8], pos: &mut usize) -> Result<u32, SoundError> {
    let mut v = 0u32;
    for shift in (0..35).step_by(7) {
        let byte = *b.get(*pos).ok_or(SoundError::Malformed("varint"))?;
        *pos += 1;
        v |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            return Ok(v);
        }
    }
    Err(SoundError::Malformed("varint"))
}

fn check_format(fmt: &[u8]) -> Result<SoundInfo, SoundError> {
    let tag = u16_at(fmt, 0).ok_or(SoundError::Malformed("format"))?;
    let channels = u16_at(fmt, 2).ok_or(SoundError::Malformed("format"))?;
    let sample_rate = u32_at(fmt, 4).ok_or(SoundError::Malformed("format"))?;
    let bits = u16_at(fmt, 14).ok_or(SoundError::Malformed("format"))?;
    if tag != WAVE_FORMAT_PCM && tag != WAVE_FORMAT_FLOAT {
        return Err(SoundError::UnsupportedCodec(tag));
    }
    if channels == 0 || channels > 8 || sample_rate == 0 || bits == 0 {
        return Err(SoundError::Malformed("format values"));
    }
    Ok(SoundInfo { format_tag: tag, channels, sample_rate, bits, data_len: 0 })
}

/// Convert an XNB `SoundEffect` into a WAV file. Returns the WAV bytes and its format.
pub fn xnb_to_wav(file: &[u8]) -> Result<(Vec<u8>, SoundInfo), SoundError> {
    if file.len() > MAX_SOUND_BYTES {
        return Err(SoundError::TooLarge(file.len()));
    }
    if file.len() < 10 || &file[0..3] != b"XNB" {
        return Err(XnbError::NotXnb.into());
    }
    if !matches!(file[3], b'w' | b'm' | b'x') {
        return Err(XnbError::UnsupportedPlatform(file[3]).into());
    }
    if file[4] != 5 {
        return Err(XnbError::UnsupportedVersion(file[4]).into());
    }
    let flags = file[5];
    let body: Vec<u8> = if flags & 0x80 != 0 {
        let out_len = u32_at(file, 10).ok_or(SoundError::Malformed("decompressed size"))? as usize;
        if out_len > MAX_DECOMPRESSED {
            return Err(SoundError::TooLarge(out_len));
        }
        decompress_lzx(&file[14..], out_len)?
    } else if flags & !0x01 == 0 {
        file[10..].to_vec()
    } else {
        return Err(XnbError::UnsupportedCompression(flags).into());
    };

    let mut pos = 0usize;
    let readers = varint(&body, &mut pos)?;
    if readers == 0 || readers > 16 {
        return Err(SoundError::Malformed("reader count"));
    }
    let mut first_reader = String::new();
    for i in 0..readers {
        let len = varint(&body, &mut pos)? as usize;
        let name = body.get(pos..pos + len).ok_or(SoundError::Malformed("reader name"))?;
        if i == 0 {
            first_reader = String::from_utf8_lossy(name).into_owned();
        }
        pos += len + 4; // name + reader version
    }
    if !first_reader.starts_with(SOUND_EFFECT_READER) {
        return Err(SoundError::NotASound(first_reader));
    }
    let _shared = varint(&body, &mut pos)?;
    let _type_id = varint(&body, &mut pos)?;
    let fmt_len = u32_at(&body, pos).ok_or(SoundError::Malformed("format length"))? as usize;
    pos += 4;
    let fmt = body.get(pos..pos + fmt_len).ok_or(SoundError::Malformed("format"))?;
    pos += fmt_len;
    let mut info = check_format(fmt)?;
    let data_len = u32_at(&body, pos).ok_or(SoundError::Malformed("data length"))? as usize;
    pos += 4;
    let data = body.get(pos..pos + data_len).ok_or(SoundError::Malformed("sample data"))?;
    info.data_len = data_len as u32;

    let mut wav = Vec::with_capacity(44 + fmt_len + data_len);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&((4 + 8 + fmt_len + 8 + data_len) as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&(fmt_len as u32).to_le_bytes());
    wav.extend_from_slice(fmt);
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data_len as u32).to_le_bytes());
    wav.extend_from_slice(data);
    Ok((wav, info))
}

/// Check that `file` is a RIFF/WAVE the WebView can play (PCM or float); returns its format.
pub fn validate_wav(file: &[u8]) -> Result<SoundInfo, SoundError> {
    if file.len() > MAX_SOUND_BYTES {
        return Err(SoundError::TooLarge(file.len()));
    }
    if file.len() < 12 || &file[0..4] != b"RIFF" || &file[8..12] != b"WAVE" {
        return Err(SoundError::Malformed("not a RIFF/WAVE file"));
    }
    let mut pos = 12usize;
    let mut info: Option<SoundInfo> = None;
    while pos + 8 <= file.len() {
        let id = &file[pos..pos + 4];
        let len = u32_at(file, pos + 4).ok_or(SoundError::Malformed("chunk"))? as usize;
        let body = file.get(pos + 8..pos + 8 + len.min(file.len().saturating_sub(pos + 8)));
        match id {
            b"fmt " => info = Some(check_format(body.ok_or(SoundError::Malformed("fmt chunk"))?)?),
            b"data" => {
                let mut i = info.ok_or(SoundError::Malformed("data before fmt"))?;
                i.data_len = len.min(file.len() - (pos + 8)) as u32;
                return Ok(i);
            }
            _ => {}
        }
        pos = pos.checked_add(8 + len + (len & 1)).ok_or(SoundError::Malformed("chunk length"))?;
    }
    Err(SoundError::Malformed("no data chunk"))
}

#[cfg(test)]
pub mod test_support {
    /// A minimal uncompressed SoundEffect XNB with the given WAVEFORMATEX tag and samples.
    pub fn sound_xnb(tag: u16, samples: &[u8]) -> Vec<u8> {
        let mut body = vec![1u8];
        let reader = b"Microsoft.Xna.Framework.Content.SoundEffectReader";
        body.push(reader.len() as u8);
        body.extend_from_slice(reader);
        body.extend_from_slice(&0i32.to_le_bytes());
        body.push(0); // shared resources
        body.push(1); // type id
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&tag.to_le_bytes());
        fmt.extend_from_slice(&1u16.to_le_bytes()); // mono
        fmt.extend_from_slice(&48000u32.to_le_bytes());
        fmt.extend_from_slice(&96000u32.to_le_bytes());
        fmt.extend_from_slice(&2u16.to_le_bytes());
        fmt.extend_from_slice(&16u16.to_le_bytes());
        fmt.extend_from_slice(&0u16.to_le_bytes());
        body.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
        body.extend_from_slice(&fmt);
        body.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        body.extend_from_slice(samples);
        body.extend_from_slice(&[0; 12]); // loop start, loop length, duration
        let mut file = b"XNBw\x05\x00".to_vec();
        file.extend_from_slice(&((10 + body.len()) as u32).to_le_bytes());
        file.extend_from_slice(&body);
        file
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::sound_xnb;
    use super::*;

    #[test]
    fn converts_pcm_xnb_to_a_playable_wav() {
        let samples: Vec<u8> = (0..9600u32).map(|i| (i % 251) as u8).collect();
        let (wav, info) = xnb_to_wav(&sound_xnb(1, &samples)).unwrap();
        assert_eq!(info, SoundInfo { format_tag: 1, channels: 1, sample_rate: 48000, bits: 16, data_len: 9600 });
        assert!((info.seconds() - 0.1).abs() < 1e-4);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(validate_wav(&wav).unwrap(), info);
        assert_eq!(&wav[wav.len() - samples.len()..], &samples[..]);
    }

    #[test]
    fn rejects_unsupported_codecs_and_garbage() {
        assert_eq!(xnb_to_wav(&sound_xnb(2, &[0; 16])).unwrap_err(), SoundError::UnsupportedCodec(2));
        assert!(matches!(xnb_to_wav(b"not an xnb at all"), Err(SoundError::Xnb(XnbError::NotXnb))));
        let mut truncated = sound_xnb(1, &[0; 64]);
        truncated.truncate(truncated.len() - 40);
        assert!(xnb_to_wav(&truncated).is_err());
        assert!(validate_wav(b"RIFF\0\0\0\0WAVE").is_err());
        assert!(validate_wav(b"OggS........").is_err());
    }

    #[test]
    fn texture_xnbs_are_not_sounds() {
        let tex = crate::terraria::xnb::fixtures::xnb_uncompressed(&crate::terraria::xnb::fixtures::texture_payload(1, 1, &[0, 0, 0, 0], 0));
        assert!(matches!(xnb_to_wav(&tex), Err(SoundError::NotASound(_))));
    }
}

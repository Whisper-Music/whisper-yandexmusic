//! Нарезка m4a (AAC в MP4) на куски без перекодирования — для альбома из длинного видео по ссылке (linkset.rs).
//! YouTube отдаёт звук только в m4a, а ffmpeg у приложения нет (и тащить его ради нарезки незачем): кадры AAC
//! независимы, поэтому кусок — это просто кадры с нужным временем, переложенные в новый маленький MP4.
//! Читает symphonia (тот же разбор, что у плеера, — понимает и обычный, и «нарезанный» DASH-m4a YouTube),
//! пишет сам: ftyp + moov (одна звуковая дорожка mp4a/esds, таблицы stts/stsc/stsz/stco) + mdat.
//! Качество не меняется; граница куска — по кадру AAC (≈ 21–23 мс), этого не слышно.

use std::io::Write;
use std::path::{Path, PathBuf};
use symphonia::core::codecs::CODEC_TYPE_AAC;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Кусок: [start, end) в секундах → файл.
pub struct Part {
    pub start: f64,
    pub end: f64,
    pub path: PathBuf,
}

/// Накопленные кадры одного куска.
#[derive(Default)]
struct Acc {
    sizes: Vec<u32>,
    durs: Vec<u32>,
    data: Vec<u8>,
}

/// Разрезать src на куски (по возрастанию, не пересекаются). Возвращает длительность каждого куска в мс.
pub fn cut(src: &Path, parts: &[Part]) -> Result<Vec<u64>, String> {
    let file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut hint = Hint::new();
    hint.with_extension("m4a");
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("файл не открывается как m4a ({e})"))?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec == CODEC_TYPE_AAC).ok_or("в файле нет звука AAC")?;
    let tid = track.id;
    let cp = &track.codec_params;
    let sr = cp.sample_rate.ok_or("неизвестная частота")?;
    if !(8000..=96000).contains(&sr) {
        return Err("необычная частота звука — такой файл не нарезается".into());
    }
    let ch = cp.channels.map(|c| c.count()).unwrap_or(2).clamp(1, 8) as u16;
    let asc = cp.extra_data.clone().filter(|a| !a.is_empty() && a.len() <= 64).ok_or("нет описания звука (AudioSpecificConfig)")?;
    let tb = cp.time_base.ok_or("неизвестная шкала времени")?;
    let (num, den) = (tb.numer as u128, tb.denom.max(1) as u128);
    let samples = |d: u64| -> u32 {
        let s = if num == 1 && den == sr as u128 { d as u128 } else { d as u128 * sr as u128 * num / den };
        if s == 0 { 1024 } else { s.min(u32::MAX as u128) as u32 }
    };

    let mut out = Vec::with_capacity(parts.len());
    let mut p = 0usize;
    let mut acc = Acc::default();
    let flush = |acc: &mut Acc, i: usize, out: &mut Vec<u64>| -> Result<(), String> {
        if acc.sizes.is_empty() {
            return Err(format!("в куске {} нет звука — проверь время", i + 1));
        }
        let a = std::mem::take(acc);
        let total: u64 = a.durs.iter().map(|&d| d as u64).sum();
        write_m4a(&parts[i].path, sr, ch, &asc, &a)?;
        out.push(total * 1000 / sr as u64);
        Ok(())
    };
    loop {
        let pkt = match format.next_packet() {
            Ok(x) => x,
            Err(SymError::IoError(_)) | Err(SymError::ResetRequired) => break,
            Err(e) => return Err(e.to_string()),
        };
        if pkt.track_id() != tid {
            continue;
        }
        let t = (pkt.ts() as u128 * num) as f64 / den as f64;
        while p < parts.len() && t >= parts[p].end {
            flush(&mut acc, p, &mut out)?;
            p += 1;
        }
        if p == parts.len() {
            break;
        }
        if t >= parts[p].start {
            let b = pkt.buf();
            acc.sizes.push(b.len() as u32);
            acc.durs.push(samples(pkt.dur()));
            acc.data.extend_from_slice(b);
        }
    }
    // запись кончилась раньше последнего конца — последний кусок до конца файла
    if p < parts.len() {
        flush(&mut acc, p, &mut out)?;
        p += 1;
    }
    if p < parts.len() {
        return Err(format!("запись кончилась раньше куска {}", p + 1));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// запись MP4
// ---------------------------------------------------------------------------

fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(body.len() + 8);
    v.extend_from_slice(&((body.len() + 8) as u32).to_be_bytes());
    v.extend_from_slice(kind);
    v.extend_from_slice(body);
    v
}
fn full(kind: &[u8; 4], ver: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = vec![ver, (flags >> 16) as u8, (flags >> 8) as u8, flags as u8];
    b.extend_from_slice(body);
    bx(kind, &b)
}
/// Дескриптор MPEG-4 (esds): тег + длина в 4 байтах (так пишут все — и длина не зависит от содержимого).
fn desc(tag: u8, body: &[u8]) -> Vec<u8> {
    let n = body.len() as u32;
    let mut v = vec![tag, 0x80 | ((n >> 21) & 0x7F) as u8, 0x80 | ((n >> 14) & 0x7F) as u8, 0x80 | ((n >> 7) & 0x7F) as u8, (n & 0x7F) as u8];
    v.extend_from_slice(body);
    v
}
fn be32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_be_bytes());
}
fn be16(v: &mut Vec<u8>, x: u16) {
    v.extend_from_slice(&x.to_be_bytes());
}
const MATRIX: [u32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

/// moov для mdat, который начинается с байта `data_at` (с него и смещение единственного куска в stco).
fn moov(sr: u32, ch: u16, asc: &[u8], a: &Acc, data_at: u32) -> Vec<u8> {
    let dur: u64 = a.durs.iter().map(|&d| d as u64).sum();
    let dur32 = dur.min(u32::MAX as u64) as u32;

    let mut mvhd = Vec::new();
    for x in [0, 0, sr, dur32, 0x0001_0000] {
        be32(&mut mvhd, x);
    }
    be16(&mut mvhd, 0x0100);
    be16(&mut mvhd, 0);
    mvhd.extend_from_slice(&[0u8; 8]);
    for m in MATRIX {
        be32(&mut mvhd, m);
    }
    mvhd.extend_from_slice(&[0u8; 24]);
    be32(&mut mvhd, 2);

    let mut tkhd = Vec::new();
    for x in [0, 0, 1, 0, dur32] {
        be32(&mut tkhd, x);
    }
    tkhd.extend_from_slice(&[0u8; 8]);
    be16(&mut tkhd, 0); // слой
    be16(&mut tkhd, 0); // группа
    be16(&mut tkhd, 0x0100); // громкость
    be16(&mut tkhd, 0);
    for m in MATRIX {
        be32(&mut tkhd, m);
    }
    be32(&mut tkhd, 0);
    be32(&mut tkhd, 0);

    let mut mdhd = Vec::new();
    for x in [0, 0, sr, dur32] {
        be32(&mut mdhd, x);
    }
    be16(&mut mdhd, 0x55C4); // «und»
    be16(&mut mdhd, 0);

    let mut hdlr = Vec::new();
    be32(&mut hdlr, 0);
    hdlr.extend_from_slice(b"soun");
    hdlr.extend_from_slice(&[0u8; 12]);
    hdlr.extend_from_slice(b"SoundHandler\0");

    // esds: ES_Descriptor → DecoderConfigDescriptor (AAC, звук) → AudioSpecificConfig; SLConfig = 2
    let avg = if dur > 0 { (a.data.len() as u64 * 8 * sr as u64 / dur).min(u32::MAX as u64) as u32 } else { 0 };
    let max_frame = a.sizes.iter().copied().max().unwrap_or(0);
    let mut dcd = vec![0x40, 0x15];
    dcd.extend_from_slice(&max_frame.min(0xFF_FFFF).to_be_bytes()[1..]);
    be32(&mut dcd, avg);
    be32(&mut dcd, avg);
    dcd.extend_from_slice(&desc(0x05, asc));
    let mut es = vec![0, 1, 0]; // ES_ID = 1, без флагов
    es.extend_from_slice(&desc(0x04, &dcd));
    es.extend_from_slice(&desc(0x06, &[0x02]));
    let esds = full(b"esds", 0, 0, &desc(0x03, &es));

    let mut mp4a = vec![0u8; 6];
    be16(&mut mp4a, 1); // data_reference_index
    mp4a.extend_from_slice(&[0u8; 8]);
    be16(&mut mp4a, ch);
    be16(&mut mp4a, 16);
    be16(&mut mp4a, 0);
    be16(&mut mp4a, 0);
    be32(&mut mp4a, if sr <= 0xFFFF { sr << 16 } else { 0 });
    mp4a.extend_from_slice(&esds);
    let mut stsd = Vec::new();
    be32(&mut stsd, 1);
    stsd.extend_from_slice(&bx(b"mp4a", &mp4a));

    // stts: подряд одинаковые длительности — одной строкой (у AAC почти все по 1024)
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for &d in &a.durs {
        match runs.last_mut() {
            Some((n, v)) if *v == d => *n += 1,
            _ => runs.push((1, d)),
        }
    }
    let mut stts = Vec::new();
    be32(&mut stts, runs.len() as u32);
    for (n, d) in runs {
        be32(&mut stts, n);
        be32(&mut stts, d);
    }
    let n = a.sizes.len() as u32;
    let mut stsc = Vec::new();
    for x in [1, 1, n, 1] {
        be32(&mut stsc, x);
    }
    let mut stsz = Vec::new();
    be32(&mut stsz, 0);
    be32(&mut stsz, n);
    for &s in &a.sizes {
        be32(&mut stsz, s);
    }
    let mut stco = Vec::new();
    be32(&mut stco, 1);
    be32(&mut stco, data_at);

    let stbl = [
        full(b"stsd", 0, 0, &stsd),
        full(b"stts", 0, 0, &stts),
        full(b"stsc", 0, 0, &stsc),
        full(b"stsz", 0, 0, &stsz),
        full(b"stco", 0, 0, &stco),
    ]
    .concat();
    let mut dref = Vec::new();
    be32(&mut dref, 1);
    dref.extend_from_slice(&full(b"url ", 0, 1, &[]));
    let minf = [full(b"smhd", 0, 0, &[0, 0, 0, 0]), bx(b"dinf", &full(b"dref", 0, 0, &dref)), bx(b"stbl", &stbl)].concat();
    let mdia = [full(b"mdhd", 0, 0, &mdhd), full(b"hdlr", 0, 0, &hdlr), bx(b"minf", &minf)].concat();
    let trak = [full(b"tkhd", 0, 3, &tkhd), bx(b"mdia", &mdia)].concat();
    bx(b"moov", &[full(b"mvhd", 0, 0, &mvhd), bx(b"trak", &trak)].concat())
}

fn ftyp() -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(b"M4A ");
    be32(&mut b, 0);
    for c in [b"M4A ", b"mp42", b"isom"] {
        b.extend_from_slice(c);
    }
    bx(b"ftyp", &b)
}

fn write_m4a(path: &Path, sr: u32, ch: u16, asc: &[u8], a: &Acc) -> Result<(), String> {
    if a.data.len() as u64 > u32::MAX as u64 / 2 {
        return Err("кусок слишком большой".into());
    }
    let head = ftyp();
    // размер moov не зависит от смещения (stco — 4 байта), поэтому считаем его раз с нулём
    let moov_len = moov(sr, ch, asc, a, 0).len();
    let data_at = (head.len() + moov_len + 8) as u32;
    let mv = moov(sr, ch, asc, a, data_at);
    let tmp = path.with_extension("part");
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&head).and_then(|_| f.write_all(&mv)).map_err(|e| e.to_string())?;
    f.write_all(&((a.data.len() + 8) as u32).to_be_bytes()).and_then(|_| f.write_all(b"mdat")).map_err(|e| e.to_string())?;
    f.write_all(&a.data).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptor_length() {
        let d = desc(0x05, &[0x12, 0x10]);
        assert_eq!(d, vec![0x05, 0x80, 0x80, 0x80, 0x02, 0x12, 0x10]);
    }

    /// Собранный файл открывает тот же разбор, что у плеера, и в нём столько же кадров и та же длительность.
    #[test]
    fn written_file_reads_back() {
        // 44,1 кГц, стерео, AAC-LC; кадры — тишина AAC-LC (минимальный корректный кадр)
        let asc = [0x12, 0x10];
        let frame: [u8; 6] = [0x21, 0x00, 0x49, 0x90, 0x02, 0x19];
        let mut a = Acc::default();
        for _ in 0..200 {
            a.sizes.push(frame.len() as u32);
            a.durs.push(1024);
            a.data.extend_from_slice(&frame);
        }
        let dir = std::env::temp_dir().join(format!("m4acut-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("x.m4a");
        write_m4a(&p, 44100, 2, &asc, &a).unwrap();
        let file = std::fs::File::open(&p).unwrap();
        let mut hint = Hint::new();
        hint.with_extension("m4a");
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).unwrap();
        let mut format = probed.format;
        let t = format.tracks()[0].clone();
        assert_eq!(t.codec_params.codec, CODEC_TYPE_AAC);
        assert_eq!(t.codec_params.sample_rate, Some(44100));
        let mut n = 0;
        while let Ok(pkt) = format.next_packet() {
            assert_eq!(pkt.buf(), &frame);
            n += 1;
        }
        assert_eq!(n, 200);
        // а кусок из него режется обратно
        let q = dir.join("y.m4a");
        let ms = cut(&p, &[Part { start: 1.0, end: 2.0, path: q.clone() }]).unwrap();
        assert!((ms[0] as i64 - 1000).abs() < 50, "{ms:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Настоящий m4a с YouTube: M4A_FILE=<путь> cargo test --lib m4acut::tests::real_cut -- --ignored --nocapture
    /// Режет на три куска, и каждый кусок целиком декодируется (тем же декодером, что у своего движка).
    #[test]
    #[ignore]
    fn real_cut() {
        use symphonia::core::codecs::DecoderOptions;
        let src = PathBuf::from(std::env::var("M4A_FILE").expect("M4A_FILE"));
        let dir = std::env::temp_dir().join(format!("m4acut-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let parts: Vec<Part> = [(0.0, 5.0), (5.0, 10.0), (10.0, 1e9)].iter().enumerate()
            .map(|(i, &(s, e))| Part { start: s, end: e, path: dir.join(format!("{i}.m4a")) }).collect();
        let ms = cut(&src, &parts).unwrap();
        println!("куски, мс: {ms:?}");
        for p in &parts {
            let mss = MediaSourceStream::new(Box::new(std::fs::File::open(&p.path).unwrap()), Default::default());
            let mut hint = Hint::new();
            hint.with_extension("m4a");
            let mut f = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).unwrap().format;
            let t = f.tracks()[0].clone();
            let mut dec = symphonia::default::get_codecs().make(&t.codec_params, &DecoderOptions::default()).unwrap();
            let (mut ok, mut bad) = (0, 0);
            while let Ok(pkt) = f.next_packet() {
                if dec.decode(&pkt).is_ok() { ok += 1 } else { bad += 1 }
            }
            println!("{}: {} байт, кадров {ok}, ошибок {bad}", p.path.display(), std::fs::metadata(&p.path).unwrap().len());
            assert!(ok > 100 && bad == 0);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! Темп и тональность трека по звуку — для подбора следующего трека «Моей волны» (transitions.js: «Подбирать
//! по темпу и тональности»). Те же приёмы, что в студии (pages/studioinfo.js), только на Rust и без AudioBuffer:
//! edges.rs при замере краёв заодно собирает моно-сигнал на ~11 кГц и отдаёт его сюда.
//!   темп — огибающая атак (бас ~150 Гц + весь сигнал), автокорреляция с долями такта;
//!   тональность — хрома по спектру (до 150 окон через весь трек) и профили Крумхансла — Кесслер.
//! Это оценка: рядом — уверенность 0…1, по ней интерфейс решает, верить ли.

use serde::Serialize;

/// Частота, на которой считаем (edges.rs усредняет до неё).
pub const RATE: f64 = 11025.0;

#[derive(Serialize, Default, Debug, Clone)]
pub struct Tone {
    /// темп, BPM (0 — не понять)
    pub bpm: f64,
    pub bpm_sure: f64,
    /// тоника 0…11 (до = 0), -1 — не понять
    pub key: i32,
    pub minor: bool,
    pub key_sure: f64,
    /// по колесу Camelot: «8B» — до мажор, «8A» — ля минор (соседи на колесе звучат вместе)
    pub camelot: String,
}

pub fn analyze(x: &[f32], fs: f64) -> Tone {
    let mut t = Tone { key: -1, ..Default::default() };
    // темп — по середине трека, до 90 с: дольше — дольше считать, точнее почти не становится
    let take = x.len().min((fs * 90.0) as usize);
    let from = (x.len() - take) / 2;
    if let Some((bpm, sure)) = tempo(&x[from..from + take], fs) {
        t.bpm = bpm;
        t.bpm_sure = sure;
    }
    if let Some((k, minor, sure)) = key_of(x, fs) {
        t.key = k as i32;
        t.minor = minor;
        t.key_sure = sure;
        t.camelot = camelot(k, minor);
    }
    t
}

/// Колесо Camelot: мажор — «B», минор — «A»; соседние номера отличаются на квинту.
pub fn camelot(key: usize, minor: bool) -> String {
    let major = if minor { (key + 3) % 12 } else { key }; // параллельный мажор у минора — та же цифра
    format!("{}{}", (major * 7 + 7) % 12 + 1, if minor { "A" } else { "B" })
}

fn tempo(x: &[f32], sr: f64) -> Option<(f64, f64)> {
    let hop = ((sr / 172.0).round() as usize).max(32);
    let fr = sr / hop as f64;
    let n = x.len() / hop;
    if (n as f64) < fr * 8.0 {
        return None; // меньше 8 секунд — темп не понять
    }
    let a = (-2.0 * std::f64::consts::PI * 150.0 / sr).exp();
    let (mut lp, mut prev_l, mut prev_a) = (0.0f64, 0.0f64, 0.0f64);
    let mut on = vec![0.0f64; n];
    for (k, o) in on.iter_mut().enumerate() {
        let (mut el, mut ea) = (0.0, 0.0);
        for &v in &x[k * hop..(k + 1) * hop] {
            let v = v as f64;
            lp = a * lp + (1.0 - a) * v;
            el += lp * lp;
            ea += v * v;
        }
        let (l, aa) = ((el * 1e3).ln_1p(), (ea * 1e2).ln_1p());
        *o = 0.65 * (l - prev_l).max(0.0) + 0.35 * (aa - prev_a).max(0.0);
        prev_l = l;
        prev_a = aa;
    }
    // убрать медленные изменения громкости: из каждой точки — среднее за ~0,4 с вокруг
    let w = (fr * 0.2).round() as usize;
    let mut pre = vec![0.0f64; n + 1];
    for k in 0..n {
        pre[k + 1] = pre[k] + on[k];
    }
    let o: Vec<f64> = (0..n)
        .map(|k| {
            let (lo, hi) = (k.saturating_sub(w), (k + w).min(n - 1));
            (on[k] - (pre[hi + 1] - pre[lo]) / (hi - lo + 1) as f64).max(0.0)
        })
        .collect();
    // сгладить (~30 мс): удар попадает то в один шаг, то в соседний
    const K: [f64; 5] = [0.06, 0.24, 0.4, 0.24, 0.06];
    let o: Vec<f64> = (0..n)
        .map(|k| (0..5).filter_map(|j| (k + j).checked_sub(2).filter(|&q| q < n).map(|q| o[q] * K[j])).sum())
        .collect();
    let ac = |lag: f64| {
        let l0 = lag.floor() as usize;
        let f = lag - l0 as f64;
        if l0 + 1 >= n {
            return 0.0;
        }
        let mut s = 0.0;
        for k in 0..n - l0 - 1 {
            s += o[k] * (o[k + l0] * (1.0 - f) + o[k + l0 + 1] * f);
        }
        s / (n - l0) as f64
    };
    // доля и её кратные (такт из 2 и 4 долей), с лёгким предпочтением привычных 90–150 BPM
    let score = |bpm: f64| {
        let lag = 60.0 * fr / bpm;
        let s = ac(lag) + 0.5 * ac(lag * 2.0) + 0.25 * ac(lag * 4.0);
        let g = (bpm / 120.0).log2();
        s * (-0.5 * (g / 0.9).powi(2)).exp()
    };
    let (mut best, mut bs, mut sum, mut cnt) = (0.0, -1.0, 0.0, 0usize);
    let mut b = 60.0;
    while b <= 200.0 {
        let s = score(b);
        sum += s;
        cnt += 1;
        if s > bs {
            bs = s;
            best = b;
        }
        b += 0.5;
    }
    let mut b = best - 0.5;
    while b <= best + 0.5 {
        let s = score(b);
        if s > bs {
            bs = s;
            best = b;
        }
        b += 0.05;
    }
    let mean = sum / cnt as f64;
    let sure = if mean > 0.0 { ((bs / mean - 1.15) / 0.7).clamp(0.0, 1.0) } else { 0.0 };
    Some(((best * 10.0).round() / 10.0, sure))
}

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f64::consts::PI / len as f64;
        let (wr, wi) = (ang.cos(), ang.sin());
        for i in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (a, b) = (i + k, i + k + len / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let t = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = t;
            }
        }
        len <<= 1;
    }
}

const MAJOR: [f64; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR: [f64; 12] = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

fn corr(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    let (ma, mb) = (a.iter().sum::<f64>() / 12.0, b.iter().sum::<f64>() / 12.0);
    let (mut s, mut sa, mut sb) = (0.0, 0.0, 0.0);
    for i in 0..12 {
        let (x, y) = (a[i] - ma, b[i] - mb);
        s += x * y;
        sa += x * x;
        sb += y * y;
    }
    if sa > 0.0 && sb > 0.0 { s / (sa * sb).sqrt() } else { 0.0 }
}

fn key_of(x: &[f32], fs: f64) -> Option<(usize, bool, f64)> {
    const N: usize = 4096;
    if x.len() < N * 4 {
        return None;
    }
    let frames = (x.len() / N).min(150);
    let step = (x.len() - N) / frames;
    let (lo, hi) = ((65.0 * N as f64 / fs).ceil() as usize, ((2100.0 * N as f64 / fs).floor() as usize).min(N / 2 - 1));
    let pc: Vec<usize> = (0..N / 2)
        .map(|k| {
            let f = (k.max(1)) as f64 * fs / N as f64;
            ((12.0 * (f / 440.0).log2() + 69.0).round() as i64).rem_euclid(12) as usize
        })
        .collect();
    let win: Vec<f64> = (0..N).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (N - 1) as f64).cos()).collect();
    let mut chroma = [0.0f64; 12];
    let (mut re, mut im) = (vec![0.0; N], vec![0.0; N]);
    for fi in 0..frames {
        let at = fi * step;
        for i in 0..N {
            re[i] = x[at + i] as f64 * win[i];
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        for k in lo..=hi {
            chroma[pc[k]] += (re[k] * re[k] + im[k] * im[k]).sqrt();
        }
    }
    let (mut best, mut br, mut second) = ((0usize, false), -2.0f64, -2.0f64);
    for t in 0..12 {
        for (prof, minor) in [(&MAJOR, false), (&MINOR, true)] {
            let mut rot = [0.0; 12];
            for i in 0..12 {
                rot[i] = prof[(i + 12 - t) % 12];
            }
            let r = corr(&chroma, &rot);
            if r > br {
                second = br;
                br = r;
                best = (t, minor);
            } else if r > second {
                second = r;
            }
        }
    }
    let sure = ((br - 0.45) / 0.4).clamp(0.0, 1.0) * ((br - second) * 8.0 + 0.4).min(1.0);
    Some((best.0, best.1, sure))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    // щелчки бочки с заданным темпом поверх аккорда
    fn synth(bpm: f64, notes: &[f64], secs: f64) -> Vec<f32> {
        let n = (RATE * secs) as usize;
        let period = (60.0 / bpm * RATE) as usize;
        (0..n)
            .map(|i| {
                let t = i as f64 / RATE;
                let chord: f64 = notes.iter().map(|&f| (2.0 * PI * f * t).sin()).sum::<f64>() * 0.08;
                let ph = i % period;
                let kick = if ph < 600 { (2.0 * PI * 60.0 * ph as f64 / RATE).sin() * (-(ph as f64) / 120.0).exp() } else { 0.0 };
                (chord + kick * 0.8) as f32
            })
            .collect()
    }
    #[test]
    fn tempo_found() {
        for bpm in [92.0, 120.0, 128.0, 140.0] {
            // чистые удары: у ровных синусов энергия окна «дрожит» с частотой биений, это помеха теста, не музыки
            let x = synth(bpm, &[], 30.0);
            let (b, _) = tempo(&x, RATE).unwrap();
            assert!((b - bpm).abs() / bpm < 0.03, "{bpm} → {b}");
        }
    }
    #[test]
    fn key_found() {
        // до мажор (до, ми, соль + ре и фа в мелодии) и ля минор
        let c = synth(120.0, &[130.81, 261.63, 329.63, 392.0], 20.0);
        let t = analyze(&c, RATE);
        assert_eq!((t.key, t.minor), (0, false), "{t:?}");
        assert_eq!(t.camelot, "8B");
        let a = synth(120.0, &[110.0, 220.0, 261.63, 329.63], 20.0);
        let t = analyze(&a, RATE);
        assert_eq!((t.key, t.minor), (9, true), "{t:?}");
        assert_eq!(t.camelot, "8A");
    }
    #[test]
    fn camelot_wheel() {
        assert_eq!(camelot(7, false), "9B"); // соль мажор
        assert_eq!(camelot(2, false), "10B"); // ре мажор
        assert_eq!(camelot(4, true), "9A"); // ми минор
        assert_eq!(camelot(5, false), "7B"); // фа мажор
    }
}

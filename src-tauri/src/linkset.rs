//! Альбом по ссылке: длинное видео (сборник, концерт, альбом одним роликом) → треки по главам или паузам,
//! плейлист YouTube / SoundCloud → выбранные треки. Интерфейс — library/linkalbum.js; сохраняет он же, тем же
//! путём, что и перетащенный файл (studio.rs → drop_audio_local / drop_audio_archive по номеру из bg.rs).
//!
//! Шаги: link_probe — что по ссылке (длина, главы, треки плейлиста, музыка ли это), без скачивания;
//! link_download_long — длинная запись целиком (до 4 ч и 400 МБ) во временную папку, ответ — её номер (token);
//! link_silences — где в ней паузы (если глав нет); link_split — нарезка без перекодирования (m4a — m4acut.rs,
//! mp3 — studio.rs mp3_cut); link_download_list — выбранные треки плейлиста одним запуском yt-dlp.
//! Все ограничения yt-dlp — те же, что у одного трека (linkdl.rs): свой список сайтов, без конфигов, cookies,
//! ffmpeg и команд, адрес после `--`, только звук m4a/mp3, проверка каждого файла.

use crate::linkdl::{self, Mode, Source, BUSY, CANCEL};
use serde::{Deserialize, Serialize};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_http::reqwest::Url;

/// Ответ yt-dlp -J больше этого — не читаем (у одного видео ~0,5–1 МБ из-за списка форматов).
const MAX_JSON: usize = 40 * 1024 * 1024;
const PROBE_LIMIT: Duration = Duration::from_secs(120);
/// Кусок короче — не трек (паузы ищутся так, чтобы куски были не короче этого).
const MIN_PART: f64 = 40.0;
const MAX_PARTS: usize = 60;
/// Один кусок — как трек, который можно бросить в окно (studio.rs MAX_DROP)
const MAX_PART_BYTES: u64 = 100 * 1024 * 1024;

/// Снимает «занято» и при ошибке, и при панике.
struct Busy;
impl Busy {
    fn take() -> Result<Busy, String> {
        if BUSY.swap(true, Ordering::SeqCst) {
            return Err("Уже скачивается что-то по ссылке — подожди или отмени".into());
        }
        CANCEL.store(false, Ordering::SeqCst);
        Ok(Busy)
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ссылка на плейлист
// ---------------------------------------------------------------------------------------------------------------

/// Плейлист в ссылке → пересобранный адрес. YouTube: ?list=… (кроме бесконечных миксов RD… и личных WL/LL/LM),
/// SoundCloud: автор/sets/название. Остальное — None (каналы, «мои лайки» и прочее не берём).
pub fn check_list(raw: &str) -> Option<(String, Source)> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 2048 || s.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let s = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let u = Url::parse(&s).ok()?;
    if !matches!(u.scheme(), "https" | "http") || !u.username().is_empty() || u.password().is_some() || u.port().is_some_and(|p| p != 443 && p != 80) {
        return None;
    }
    let host = u.host_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase();
    let src = linkdl::host_source(&host)?;
    let segs: Vec<&str> = u.path_segments().map(|p| p.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    match src {
        Source::YouTube => {
            let list = u.query_pairs().find(|(k, _)| k == "list").map(|(_, v)| v.into_owned())?;
            let ok_path = host == "youtu.be" || matches!(segs.as_slice(), ["playlist"] | ["watch"]);
            let ok_id = (10..=64).contains(&list.len()) && list.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_');
            let personal = ["RD", "UL", "WL", "LL", "LM"].iter().any(|p| list.starts_with(p));
            (ok_path && ok_id && !personal).then(|| (format!("https://www.youtube.com/playlist?list={list}"), src))
        }
        Source::SoundCloud => match segs.as_slice() {
            [user, "sets", set] if linkdl::sc_name(user) && linkdl::sc_name(set) && !linkdl::SC_RESERVED.contains(user) => {
                Some((format!("https://soundcloud.com/{user}/sets/{set}"), src))
            }
            _ => None,
        },
        Source::Vk => None,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// что по ссылке
// ---------------------------------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Chapter {
    title: String,
    start: f64,
    end: f64,
}

#[derive(Serialize)]
pub struct ListItem {
    index: u32,
    title: String,
    duration: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    list: bool,
    url: String,
    source: &'static str,
    title: String,
    /// исполнитель: artist, а нет — автор канала без « - Topic»
    artist: String,
    album: String,
    duration: f64,
    chapters: Vec<Chapter>,
    items: Vec<ListItem>,
    /// сколько треков в плейлисте всего (показаны первые MAX_LIST·4)
    count: u32,
    music: bool,
    /// почему, похоже, не музыка (для вопроса «всё равно скачать?»)
    why: String,
}

const CATS: [(&str, &str); 15] = [
    ("Music", "Музыка"),
    ("Gaming", "Игры"),
    ("Education", "Образование"),
    ("People & Blogs", "Блоги"),
    ("Entertainment", "Развлечения"),
    ("Comedy", "Юмор"),
    ("News & Politics", "Новости и политика"),
    ("Howto & Style", "Хобби и стиль"),
    ("Science & Technology", "Наука и техника"),
    ("Film & Animation", "Фильмы и анимация"),
    ("Sports", "Спорт"),
    ("Travel & Events", "Путешествия"),
    ("Autos & Vehicles", "Транспорт"),
    ("Pets & Animals", "Животные"),
    ("Nonprofits & Activism", "Общественное"),
];

/// Слова, по которым видео похоже на музыку, когда сайт категорий не даёт (ВК) или плейлист без них.
fn musical_words(t: &str) -> bool {
    let t = t.to_lowercase();
    [" - ", " – ", " — ", "official", "lyric", "audio", "music", "remix", "cover", "feat", "ft.", "live", "клип", "песня", "музык",
     "ремикс", "кавер", "концерт", "альбом", "album", "ost", "soundtrack", "саундтрек", "mix", "микс", "playlist", "плейлист"]
        .iter()
        .any(|w| t.contains(w))
}
fn talky_words(t: &str) -> bool {
    let t = t.to_lowercase();
    ["podcast", "подкаст", "lecture", "лекция", "интервью", "interview", "стрим", "stream", "обзор", "review", "гайд", "guide",
     "tutorial", "урок", "прохождение", "walkthrough", "letsplay", "let's play", "новости", "news", "аудиокниг", "audiobook"]
        .iter()
        .any(|w| t.contains(w))
}

/// Музыка ли это — и почему нет.
fn music_of(v: &serde_json::Value, src: Source, list: bool) -> (bool, String) {
    let s = |k: &str| linkdl::s(v, k);
    let title = s("title");
    if talky_words(&title) {
        return (false, format!("по названию это больше похоже на разговорное видео («{}»)", title.chars().take(60).collect::<String>()));
    }
    match src {
        Source::SoundCloud => (true, String::new()),
        Source::YouTube => {
            if list {
                // у плоского списка категорий нет: альбомы YouTube Music (OLAK5uy_…) и « - Topic» — точно музыка
                let id = s("id");
                let music = id.starts_with("OLAK5uy_") || s("uploader").ends_with(" - Topic") || s("channel").ends_with(" - Topic") || musical_words(&title);
                return if music { (true, String::new()) } else { (false, "у плейлиста нет признаков музыки (это не альбом YouTube Music)".into()) };
            }
            let cats: Vec<String> = v.get("categories").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            let music = cats.iter().any(|c| c == "Music")
                || !s("track").is_empty()
                || !s("artist").is_empty()
                || s("uploader").ends_with(" - Topic")
                || s("webpage_url_domain") == "music.youtube.com";
            if music {
                return (true, String::new());
            }
            let why = match cats.first() {
                Some(c) => {
                    let ru = CATS.iter().find(|(en, _)| en == c).map(|(_, ru)| *ru).unwrap_or(c.as_str());
                    format!("на YouTube у видео категория «{ru}», а не «Музыка»")
                }
                None => "у видео на YouTube не указана категория «Музыка»".into(),
            };
            (false, why)
        }
        Source::Vk => {
            if musical_words(&title) {
                (true, String::new())
            } else {
                (false, "это видео ВКонтакте, и по названию не похоже на музыку".into())
            }
        }
    }
}

fn artist_of(v: &serde_json::Value) -> String {
    let a = linkdl::s(v, "artist");
    let a = if a.is_empty() { linkdl::s(v, "creator") } else { a };
    if !a.is_empty() {
        return a.split(',').next().unwrap_or(&a).trim().to_string();
    }
    let up = linkdl::s(v, "uploader");
    let up = if up.is_empty() { linkdl::s(v, "channel") } else { up };
    up.trim_end_matches(" - Topic").trim_end_matches("VEVO").trim().to_string()
}

/// Главы: только разумные (время по порядку, внутри записи, у каждой — название).
fn chapters_of(v: &serde_json::Value, dur: f64) -> Vec<Chapter> {
    let Some(a) = v.get("chapters").and_then(|c| c.as_array()) else { return Vec::new() };
    let mut out: Vec<Chapter> = Vec::new();
    for c in a.iter().take(MAX_PARTS * 2) {
        let start = c.get("start_time").and_then(|x| x.as_f64()).unwrap_or(-1.0);
        let end = c.get("end_time").and_then(|x| x.as_f64()).unwrap_or(-1.0);
        let title: String = linkdl::s(c, "title").chars().take(150).collect();
        if !(start >= 0.0 && end > start && (dur <= 0.0 || end <= dur + 2.0)) {
            continue;
        }
        if out.last().is_some_and(|p| start < p.end - 1.0) {
            continue;
        }
        out.push(Chapter { title, start, end });
    }
    // одна «глава» на всё видео — это не главы
    if out.len() < 2 { Vec::new() } else { out.into_iter().take(MAX_PARTS).collect() }
}

/// yt-dlp -J (без скачивания) → JSON.
fn dump_json(tool: &Path, url: &str, src: Source, list: bool) -> Result<serde_json::Value, String> {
    let proxy = crate::proxy::for_url(url);
    let mut a: Vec<String> = [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-cookies",
        "--no-cookies-from-browser",
        "--no-exec",
        "--no-cache-dir",
        "--use-extractors",
        src.extractors(),
        "--socket-timeout",
        "30",
        "--encoding",
        "utf-8",
        "--no-warnings",
        "--dump-single-json",
    ]
    .iter()
    .map(|x| x.to_string())
    .collect();
    if list {
        a.extend(["--flat-playlist", "--yes-playlist", "--playlist-items", "1:200"].map(String::from));
    } else {
        a.push("--no-playlist".into());
    }
    if let Some(p) = proxy {
        a.push("--proxy".into());
        a.push(p);
    }
    let mut cmd = Command::new(tool);
    cmd.args(&a).arg("--").arg(url).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for k in ["PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE"] {
        cmd.env_remove(k);
    }
    linkdl::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp не запустился: {e}"))?;
    let out = child.stdout.take().map(|o| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = BufReader::new(o).take(MAX_JSON as u64 + 1).read_to_end(&mut buf);
            buf
        })
    });
    let err = child.stderr.take().map(|e| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = BufReader::new(e).take(64 * 1024).read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    });
    let started = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if CANCEL.load(Ordering::SeqCst) || started.elapsed() > PROBE_LIMIT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if CANCEL.load(Ordering::SeqCst) { "отменено".into() } else { "сайт слишком долго не отвечает".into() });
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let body = out.and_then(|t| t.join().ok()).unwrap_or_default();
    let stderr = err.and_then(|t| t.join().ok()).unwrap_or_default();
    if body.len() > MAX_JSON {
        return Err("слишком большой ответ yt-dlp".into());
    }
    if !status.success() || body.is_empty() {
        let last = stderr.lines().rev().find(|l| l.contains("ERROR")).unwrap_or("").replace("ERROR:", "");
        let last: String = last.trim().chars().take(200).collect();
        return Err(if last.is_empty() { "yt-dlp не смог прочитать ссылку".into() } else { format!("yt-dlp: {last}") });
    }
    serde_json::from_slice(&body).map_err(|_| "yt-dlp ответил непонятно".to_string())
}

/// Что по ссылке: list = true — плейлист (адрес из check_list), иначе одно видео (адрес из check_url).
#[tauri::command]
pub async fn link_probe(app: AppHandle, url: String, list: bool) -> Result<Probe, String> {
    let (url, src) = if list { check_list(&url).ok_or("Это не ссылка на плейлист")? } else { linkdl::check_url(&url)? };
    let _busy = Busy::take()?;
    let tool = linkdl::ready_tool(&app).await?;
    let u = url.clone();
    let v = tauri::async_runtime::spawn_blocking(move || dump_json(&tool, &u, src, list)).await.map_err(|e| e.to_string())??;
    let dur = v.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0);
    let (music, why) = music_of(&v, src, list);
    let mut items = Vec::new();
    if list {
        for (i, e) in v.get("entries").and_then(|x| x.as_array()).map(|a| a.as_slice()).unwrap_or(&[]).iter().enumerate().take(200) {
            let title: String = linkdl::s(e, "title").chars().take(200).collect();
            items.push(ListItem {
                index: e.get("playlist_index").and_then(|x| x.as_u64()).map(|x| x as u32).unwrap_or(i as u32 + 1),
                title: if title.is_empty() { format!("Трек {}", i + 1) } else { title },
                duration: e.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0),
            });
        }
        if items.is_empty() {
            return Err("В плейлисте нет треков (или он закрыт)".into());
        }
    }
    let count = v.get("playlist_count").and_then(|x| x.as_u64()).map(|x| x as u32).unwrap_or(items.len() as u32);
    let title = linkdl::s(&v, "title");
    Ok(Probe {
        list,
        url,
        source: src.label(),
        album: { let a = linkdl::s(&v, "album"); if a.is_empty() { linkdl::strip_noise(&title) } else { a } },
        title,
        artist: artist_of(&v),
        duration: dur,
        chapters: if list { Vec::new() } else { chapters_of(&v, dur) },
        items,
        count,
        music,
        why,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// длинная запись: скачать, найти паузы, нарезать
// ---------------------------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Long {
    token: String,
    ext: &'static str,
    duration: f64,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
    item: u32,
}

fn token_dir(app: &AppHandle, token: &str) -> Result<PathBuf, String> {
    if token.len() != 16 || !token.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err("Запись не найдена — скачай заново".into());
    }
    let d = linkdl::work_root(app)?.join(token);
    if !d.is_dir() {
        return Err("Запись уже удалена — скачай заново".into());
    }
    Ok(d)
}
fn source_in(dir: &Path) -> Result<(PathBuf, &'static str), String> {
    for ext in ["m4a", "mp3"] {
        let p = dir.join(format!("source.{ext}"));
        if p.is_file() {
            return Ok((p, ext));
        }
    }
    Err("Запись уже удалена — скачай заново".into())
}

/// Скачать длинную запись целиком (до 4 ч, 400 МБ) — дальше её режет link_split.
#[tauri::command]
pub async fn link_download_long(app: AppHandle, url: String) -> Result<Long, String> {
    let (url, src) = linkdl::check_url(&url)?;
    let _busy = Busy::take()?;
    let tool = linkdl::ready_tool(&app).await?;
    let token = linkdl::rand_hex();
    let dir = linkdl::work_root(&app)?.join(&token);
    let (a, d) = (app.clone(), dir.clone());
    let r = tauri::async_runtime::spawn_blocking(move || {
        let mut got = linkdl::run_mode(&tool, &url, src, &d, Mode::Long, move |done, total, _| {
            let _ = a.emit("link-progress", Progress { done, total, item: 0 });
        })?;
        let (file, meta) = got.pop().ok_or("yt-dlp не оставил файла")?;
        let ext = linkdl::check_audio_max(&file, linkdl::MAX_LONG)?;
        std::fs::rename(&file, d.join(format!("source.{ext}"))).map_err(|e| e.to_string())?;
        Ok::<_, String>(Long { token, ext, duration: meta.duration })
    })
    .await
    .map_err(|e| e.to_string())?;
    if r.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    r.map_err(|e| format!("Не получилось скачать с {}: {e}", src.label()))
}

/// Где резать по паузам: середины тихих мест не короче 0,8 с, так чтобы куски были не короче MIN_PART.
/// «Тихо» — на 25 дБ тише обычной громкости записи (но не громче −35 дБ): у концертов тишина между песнями —
/// это шум зала, а не ноль.
fn split_points(w: &[f64], dur: f64) -> Vec<f64> {
    let win = crate::edges::WIN;
    let db: Vec<f64> = w.iter().map(|&e| crate::edges::db(e)).collect();
    let mut loud: Vec<f64> = db.iter().copied().filter(|&d| d > -70.0).collect();
    if loud.len() < 100 {
        return Vec::new();
    }
    loud.sort_by(|a, b| a.total_cmp(b));
    let median = loud[loud.len() / 2];
    let th = (median - 25.0).clamp(-60.0, -35.0);
    let min_run = (0.8 / win).ceil() as usize;
    let mut cands: Vec<(f64, usize)> = Vec::new();
    let mut i = 0;
    while i < db.len() {
        if db[i] < th {
            let j = (i..db.len()).find(|&k| db[k] >= th).unwrap_or(db.len());
            if j - i >= min_run {
                cands.push((((i + j) as f64 / 2.0) * win, j - i));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    let mut out: Vec<f64> = Vec::new();
    for (t, _) in cands {
        let last = out.last().copied().unwrap_or(0.0);
        if t - last >= MIN_PART && dur - t >= MIN_PART {
            out.push(t);
        }
    }
    out.truncate(MAX_PARTS - 1);
    out
}

/// Паузы в скачанной записи — предложение, где резать (интерфейс показывает список, его можно поправить).
#[tauri::command]
pub async fn link_silences(app: AppHandle, token: String) -> Result<Vec<f64>, String> {
    let dir = token_dir(&app, &token)?;
    let (src, ext) = source_in(&dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let f = std::fs::File::open(&src).map_err(|e| e.to_string())?;
        let (w, dur, _, _) = crate::edges::windows_of(Box::new(f), Some(ext))?;
        Ok(split_points(&w, dur))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct PartIn {
    title: String,
    start: f64,
    end: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Piece {
    entry: crate::bg::Entry,
    title: String,
    artist: String,
    /// альбом из описания трека (YouTube Music), у нарезки — пусто
    album: String,
    duration_ms: u64,
}

fn safe_name(t: &str) -> String {
    let s: String = t.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).take(120).collect();
    let s = s.trim().trim_matches('.').trim().to_string();
    if s.is_empty() { "Трек".into() } else { s }
}

/// Нарезать скачанную запись на треки. Куски — по возрастанию, не пересекаются, каждый от 1 с.
#[tauri::command]
pub async fn link_split(app: AppHandle, token: String, parts: Vec<PartIn>) -> Result<Vec<Piece>, String> {
    if parts.is_empty() || parts.len() > MAX_PARTS {
        return Err(format!("Треков должно быть от 1 до {MAX_PARTS}"));
    }
    let mut prev = 0.0f64;
    for (i, p) in parts.iter().enumerate() {
        if !(p.start.is_finite() && p.end.is_finite()) || p.start < prev - 0.05 || p.end - p.start < 1.0 || p.end > linkdl::MAX_LONG_SECONDS as f64 + 1.0 {
            return Err(format!("У трека {} неправильное время — начало должно идти после конца прошлого", i + 1));
        }
        prev = p.end;
    }
    let dir = token_dir(&app, &token)?;
    let (src, ext) = source_in(&dir)?;
    let out = dir.join(format!("parts-{}", linkdl::rand_hex()));
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let titles: Vec<String> = parts.iter().map(|p| p.title.chars().filter(|c| !c.is_control()).take(200).collect::<String>().trim().to_string()).collect();
    let paths: Vec<PathBuf> = titles.iter().enumerate().map(|(i, t)| out.join(format!("{:02} - {}.{ext}", i + 1, safe_name(t)))).collect();
    let spans: Vec<(f64, f64)> = parts.iter().map(|p| (p.start.max(0.0), p.end)).collect();
    let ps = paths.clone();
    let durs = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u64>, String> {
        if ext == "m4a" {
            let list: Vec<crate::m4acut::Part> = spans.iter().zip(&ps).map(|(&(s, e), p)| crate::m4acut::Part { start: s, end: e, path: p.clone() }).collect();
            crate::m4acut::cut(&src, &list)
        } else {
            let b = std::fs::read(&src).map_err(|e| e.to_string())?;
            let mut d = Vec::new();
            for (&(s, e), p) in spans.iter().zip(&ps) {
                let (bytes, a, z) = crate::studio::mp3_cut(&b, (s * 1000.0) as u64, (e * 1000.0) as u64)?;
                std::fs::write(p, &bytes).map_err(|e| e.to_string())?;
                d.push(z.saturating_sub(a));
            }
            Ok(d)
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let durs = match durs {
        Ok(d) => d,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&out);
            return Err(format!("Не получилось нарезать: {e}"));
        }
    };
    for (i, p) in paths.iter().enumerate() {
        if std::fs::metadata(p).map(|m| m.len()).unwrap_or(0) > MAX_PART_BYTES {
            let _ = std::fs::remove_dir_all(&out);
            return Err(format!("Трек {} больше 100 МБ — раздели его на части", i + 1));
        }
    }
    let entries = crate::bg::remember_files(&app, &paths);
    if entries.len() != paths.len() {
        return Err("Нарезанные файлы пропали — попробуй ещё раз".into());
    }
    Ok(entries
        .into_iter()
        .zip(titles)
        .zip(durs)
        .map(|((entry, title), duration_ms)| Piece { entry, title, artist: String::new(), album: String::new(), duration_ms })
        .collect())
}

/// Альбом сохранён — длинная запись (до 400 МБ) больше не нужна; не позвали — её через сутки уберёт sweep.
#[tauri::command(async)]
pub fn link_forget(app: AppHandle, token: String) -> Result<(), String> {
    if let Ok(d) = token_dir(&app, &token) {
        let _ = std::fs::remove_dir_all(d);
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------
// плейлист
// ---------------------------------------------------------------------------------------------------------------

/// Скачать выбранные треки плейлиста (номера из link_probe) — каждый проверяется, как трек по ссылке.
#[tauri::command]
pub async fn link_download_list(app: AppHandle, url: String, items: Vec<u32>) -> Result<Vec<Piece>, String> {
    let (url, src) = check_list(&url).ok_or("Это не ссылка на плейлист")?;
    let mut items: Vec<u32> = items.into_iter().filter(|&i| (1..=1000).contains(&i)).collect();
    items.sort_unstable();
    items.dedup();
    if items.is_empty() || items.len() > linkdl::MAX_LIST {
        return Err(format!("Выбери от 1 до {} треков", linkdl::MAX_LIST));
    }
    let sel = items.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
    let _busy = Busy::take()?;
    let tool = linkdl::ready_tool(&app).await?;
    let dir = linkdl::work_root(&app)?.join(linkdl::rand_hex());
    let (a, d) = (app.clone(), dir.clone());
    let r = tauri::async_runtime::spawn_blocking(move || {
        let got = linkdl::run_mode(&tool, &url, src, &d, Mode::List(&sel), move |done, total, item| {
            let _ = a.emit("link-progress", Progress { done, total, item });
        })?;
        let mut files = Vec::new();
        let mut metas = Vec::new();
        for (f, m) in got {
            // недоступный или странный трек плейлиста не роняет весь альбом — просто пропускается
            let Ok(ext) = linkdl::check_audio(&f) else {
                let _ = std::fs::remove_file(&f);
                continue;
            };
            let named = d.join(format!("{:03} - {}.{ext}", m.index, safe_name(&linkdl::file_stem(&m))));
            std::fs::rename(&f, &named).map_err(|e| e.to_string())?;
            files.push(named);
            metas.push(m);
        }
        if files.is_empty() {
            return Err("ни один трек не скачался".to_string());
        }
        Ok((files, metas))
    })
    .await
    .map_err(|e| e.to_string())?;
    let (files, metas) = match r {
        Ok(x) => x,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!("Не получилось скачать с {}: {e}", src.label()));
        }
    };
    let entries = crate::bg::remember_files(&app, &files);
    Ok(entries
        .into_iter()
        .zip(metas)
        .map(|(entry, m)| {
            let title = if !m.track.is_empty() { m.track.clone() } else { linkdl::strip_noise(&m.title) };
            let artist = if !m.artist.is_empty() {
                m.artist.split(',').next().unwrap_or(&m.artist).trim().to_string()
            } else {
                m.uploader.trim_end_matches(" - Topic").trim_end_matches("VEVO").trim().to_string()
            };
            Piece { entry, title, artist, album: m.album.clone(), duration_ms: (m.duration * 1000.0) as u64 }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playlists() {
        let ok = |u: &str| check_list(u).unwrap_or_else(|| panic!("{u}")).0;
        assert_eq!(ok("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"), "https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG");
        assert_eq!(ok("music.youtube.com/playlist?list=OLAK5uy_kXEbzYsYtHuQPzCKP1vDDH5ZOQmRCZh3M"), "https://www.youtube.com/playlist?list=OLAK5uy_kXEbzYsYtHuQPzCKP1vDDH5ZOQmRCZh3M");
        assert!(check_list("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG").is_some());
        assert_eq!(ok("https://soundcloud.com/artist-name/sets/my-album"), "https://soundcloud.com/artist-name/sets/my-album");
        for bad in [
            "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDjNQXAC9IVRw",   // бесконечный микс
            "https://www.youtube.com/playlist?list=WL",
            "https://www.youtube.com/playlist?list=LLxxxxxxxxxxxxxxxx",
            "https://www.youtube.com/@channel",
            "https://evil.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
            "https://soundcloud.com/discover/sets/x",
            "https://user:pw@www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
            "https://vk.com/video-1_2?list=abc",
        ] {
            assert!(check_list(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn music_detection() {
        let v = serde_json::json!({ "title": "Song", "categories": ["Music"] });
        assert!(music_of(&v, Source::YouTube, false).0);
        let v = serde_json::json!({ "title": "Как я прошёл игру", "categories": ["Gaming"] });
        let (m, why) = music_of(&v, Source::YouTube, false);
        assert!(!m && why.contains("Игры"), "{why}");
        let v = serde_json::json!({ "title": "Подкаст №5" });
        assert!(!music_of(&v, Source::SoundCloud, false).0);
        let v = serde_json::json!({ "title": "Artist - Track", "categories": ["Entertainment"], "track": "Track" });
        assert!(music_of(&v, Source::YouTube, false).0);
    }

    #[test]
    fn silence_split() {
        // 3 «песни» по 60 с громко, между ними — 2 с тишины
        let win = crate::edges::WIN;
        let mut w = Vec::new();
        for k in 0..3 {
            w.extend(vec![0.05; (60.0 / win) as usize]);
            if k < 2 {
                w.extend(vec![1e-9; (2.0 / win) as usize]);
            }
        }
        let dur = w.len() as f64 * win;
        let p = split_points(&w, dur);
        assert_eq!(p.len(), 2, "{p:?}");
        assert!((p[0] - 61.0).abs() < 0.2 && (p[1] - 123.0).abs() < 0.2, "{p:?}");
    }

    #[test]
    fn chapters_sane() {
        let v = serde_json::json!({ "chapters": [
            { "start_time": 0.0, "end_time": 100.0, "title": "Intro" },
            { "start_time": 100.0, "end_time": 250.0, "title": "Song" },
            { "start_time": 90.0, "end_time": 95.0, "title": "назад во времени" },
        ] });
        let c = chapters_of(&v, 250.0);
        assert_eq!(c.len(), 2);
        assert_eq!(c[1].title, "Song");
    }
}

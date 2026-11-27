//! Вывод на телевизор (DLNA / UPnP AV): Настройки → Звук → «Телевизор», страница — player/cast.js.
//! Ни от кого не зависит: телевизор находится в локальной сети (SSDP), трек ему отдаёт сам Whisper — маленький
//! HTTP-сервер на адресе этого компьютера в той же сети, а приложение остаётся пультом (AVTransport: Play,
//! Pause, Seek; RenderingControl: громкость). Звук идёт только из телевизора.
//!
//! Безопасность:
//!  - сервер работает, только пока идёт вывод на телевизор, слушает адрес интерфейса, через который виден
//!    телевизор (не 0.0.0.0), и отвечает только адресу самого телевизора;
//!  - адрес трека — /m/<случайный ключ 128 бит>.<расширение>, ключ новый для каждого трека;
//!  - отдаётся только текущий трек (и следующий — для кнопки «Далее» на пульте) из памяти — файлов с диска сервер
//!    не открывает;
//!  - описание и адреса управления берутся только с частных адресов сети (10/8, 172.16/12, 192.168/16,
//!    169.254/16) и только с того адреса, который ответил на поиск: чужой ответ не направит запросы вовне;
//!  - команды берут телевизор по номеру из последнего поиска, адреса со страницы не принимаются.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

// ---------- то, что не зависит от Tauri (проверяется тестами) ----------

/// Найденный телевизор (или колонка): что показать и куда слать команды.
#[derive(Clone, Debug)]
pub struct Renderer {
    pub name: String,
    pub model: String,
    pub ip: Ipv4Addr,
    /// AVTransport: адрес управления и тип службы (с версией — :1 или :2)
    pub avt: (String, String),
    /// RenderingControl (громкость) — не у всех
    pub rc: Option<(String, String)>,
}

/// Частная сеть: дальше этих адресов поиск и управление не ходят.
pub fn lan_ok(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local()
}

/// http://host:port/path → (ip, port, path). Только http и только IPv4-адрес числом.
pub fn split_url(url: &str) -> Option<(Ipv4Addr, u16, String)> {
    let rest = url.strip_prefix("http://")?;
    let (hp, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let (h, p) = match hp.rsplit_once(':') {
        Some((h, p)) => (h, p.parse().ok()?),
        None => (hp, 80),
    };
    Some((h.parse().ok()?, p, path))
}

/// Адрес из описания устройства → полный http-адрес на том же телевизоре (или None, если он ведёт куда-то ещё).
pub fn join_url(base: &str, rel: &str, ip: Ipv4Addr) -> Option<String> {
    let rel = rel.trim();
    let full = if rel.starts_with("http://") {
        rel.to_string()
    } else {
        let (bip, bport, bpath) = split_url(base)?;
        let path = if rel.starts_with('/') {
            rel.to_string()
        } else {
            let dir = &bpath[..bpath.rfind('/').map(|i| i + 1).unwrap_or(0)];
            format!("{}{}", if dir.is_empty() { "/" } else { dir }, rel)
        };
        format!("http://{bip}:{bport}{path}")
    };
    let (h, _, _) = split_url(&full)?;
    (h == ip).then_some(full)
}

/// Текст первого тега с этим именем (префикс пространства имён не важен: <u:RelTime> = <RelTime>).
pub fn tag(xml: &str, name: &str) -> Option<String> {
    let mut i = 0;
    while let Some(off) = xml[i..].find('<') {
        let at = i + off + 1;
        let end = xml[at..].find(['>', ' ', '/', '\t', '\r', '\n']).map(|e| at + e)?;
        let full = &xml[at..end];
        let local = full.rsplit(':').next().unwrap_or(full);
        if local == name && !full.starts_with('/') {
            let open_end = at + xml[at..].find('>')? + 1;
            if xml[..open_end].ends_with("/>") {
                return Some(String::new());
            }
            let close = xml[open_end..].find(&format!("</{full}>"))? + open_end;
            return Some(unescape(xml[open_end..close].trim()));
        }
        i = at;
    }
    None
}

/// Все блоки <name>…</name> (для списка служб).
fn blocks<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let (open, close) = (format!("<{name}>"), format!("</{name}>"));
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(a) = xml[i..].find(&open) {
        let s = i + a + open.len();
        let Some(b) = xml[s..].find(&close) else { break };
        out.push(&xml[s..s + b]);
        i = s + b + close.len();
    }
    out
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}
fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// Описание устройства (XML по адресу LOCATION) → Renderer. Нет AVTransport — это не плеер, не подходит.
pub fn parse_desc(xml: &str, location: &str, ip: Ipv4Addr) -> Option<Renderer> {
    let base = tag(xml, "URLBase").filter(|b| b.starts_with("http://")).unwrap_or_else(|| location.to_string());
    let (mut avt, mut rc) = (None, None);
    for s in blocks(xml, "service") {
        let (Some(st), Some(ctl)) = (tag(s, "serviceType"), tag(s, "controlURL")) else { continue };
        let Some(url) = join_url(&base, &ctl, ip) else { continue };
        if st.contains(":service:AVTransport:") && avt.is_none() {
            avt = Some((url, st));
        } else if st.contains(":service:RenderingControl:") && rc.is_none() {
            rc = Some((url, st));
        }
    }
    let clip = |s: String| s.chars().filter(|c| !c.is_control()).take(80).collect::<String>();
    Some(Renderer {
        name: clip(tag(xml, "friendlyName").unwrap_or_else(|| "Телевизор".into())),
        model: clip(tag(xml, "modelName").unwrap_or_default()),
        ip,
        avt: avt?,
        rc,
    })
}

/// SOAP-запрос службы UPnP (тело — аргументы действия по порядку).
pub fn soap_body(stype: &str, action: &str, args: &[(&str, String)]) -> String {
    let mut a = String::new();
    for (k, v) in args {
        a.push_str(&format!("<{k}>{}</{k}>", escape(v)));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
<s:Body><u:{action} xmlns:u=\"{stype}\">{a}</u:{action}></s:Body></s:Envelope>"
    )
}

/// Что показать на телевизоре.
#[derive(Clone, Default, Debug)]
pub struct Meta {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub dur: f64,
}

/// Описание трека для телевизора (DIDL-Lite): название, исполнитель, альбом, обложка, длительность.
/// id элемента — свой у каждого трека (ключ): с одинаковым id часть телевизоров не обновляет экран, и на нём
/// через раз оставалось прошлое название. Обложка — с нашего сервера по http (https Яндекса многие не открывают),
/// с пометкой DLNA JPEG_TN — без неё часть телевизоров картинку не берёт.
pub fn didl(id: &str, url: &str, mime: &str, m: &Meta, cover: Option<&str>) -> String {
    let art = cover
        .map(|c| format!("<upnp:albumArtURI dlna:profileID=\"JPEG_TN\">{}</upnp:albumArtURI>", escape(c)))
        .unwrap_or_default();
    let album = if m.album.is_empty() { String::new() } else { format!("<upnp:album>{}</upnp:album>", escape(&m.album)) };
    let d = if m.dur > 0.0 { format!(" duration=\"{}.000\"", hms(m.dur)) } else { String::new() };
    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" xmlns:dlna=\"urn:schemas-dlna-org:metadata-1-0/\">\
<item id=\"{id}\" parentID=\"0\" restricted=\"1\">\
<dc:title>{}</dc:title><dc:creator>{a}</dc:creator><upnp:artist role=\"Performer\">{a}</upnp:artist>{album}{art}\
<upnp:class>object.item.audioItem.musicTrack</upnp:class>\
<res protocolInfo=\"http-get:*:{mime}:{FEATURES}\"{d}>{}</res></item></DIDL-Lite>",
        escape(&m.title),
        escape(url),
        id = escape(id),
        a = escape(&m.artist),
    )
}

/// Ключ трека из адреса, который телевизор сейчас играет (GetPositionInfo → TrackURI): …/m/<ключ>.<расш>
pub fn token_of(uri: &str) -> Option<String> {
    let rest = uri.split("/m/").nth(1)?;
    let t = rest.split('.').next()?;
    (t.len() == 32 && t.bytes().all(|c| c.is_ascii_hexdigit())).then(|| t.to_string())
}
/// DLNA: перемотка по байтам (OP=01), поток, фоновая загрузка — так телевизоры охотнее перематывают.
const FEATURES: &str = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

pub fn hms(t: f64) -> String {
    let s = t.max(0.0) as u64;
    format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}
/// «0:03:12», «00:03:12.500», «NOT_IMPLEMENTED» → секунды.
pub fn secs(s: &str) -> f64 {
    let p: Vec<f64> = s.trim().split(':').map(|x| x.parse::<f64>().unwrap_or(f64::NAN)).collect();
    let v = match p.as_slice() {
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        [m, s] => m * 60.0 + s,
        _ => f64::NAN,
    };
    if v.is_finite() { v } else { 0.0 }
}

/// Тип файла по первым байтам (что отдать телевизору в Content-Type).
pub fn sniff(b: &[u8]) -> (&'static str, &'static str) {
    match b {
        [b'I', b'D', b'3', ..] => ("audio/mpeg", "mp3"),
        [0xFF, x, ..] if x & 0xE0 == 0xE0 => ("audio/mpeg", "mp3"),
        [b'f', b'L', b'a', b'C', ..] => ("audio/flac", "flac"),
        [b'O', b'g', b'g', b'S', ..] => ("audio/ogg", "ogg"),
        [b'R', b'I', b'F', b'F', ..] => ("audio/wav", "wav"),
        [_, _, _, _, b'f', b't', b'y', b'p', ..] => ("audio/mp4", "m4a"),
        _ => ("audio/mpeg", "mp3"),
    }
}

/// «bytes=100-», «bytes=100-199», «bytes=-500» → (начало, конец включительно).
pub fn range(h: &str, len: usize) -> Option<(usize, usize)> {
    if len == 0 {
        return None;
    }
    let r = h.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = r.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    let (s, e) = if a.is_empty() {
        let n: usize = b.parse().ok()?;
        (len.saturating_sub(n), len - 1)
    } else {
        let s: usize = a.parse().ok()?;
        let e = if b.is_empty() { len - 1 } else { b.parse::<usize>().ok()?.min(len - 1) };
        (s, e)
    };
    (s <= e && s < len).then_some((s, e))
}

/// Простой HTTP-запрос по локальной сети (без TLS): ответ с кодом и телом (≤ 2 МБ), chunked раскрывается.
pub fn http(method: &str, url: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    let (ip, port, path) = split_url(url).ok_or("неверный адрес устройства")?;
    if !lan_ok(ip) {
        return Err("устройство не в локальной сети".into());
    }
    let mut s = TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(ip), port), timeout).map_err(|e| format!("телевизор не отвечает ({e})"))?;
    s.set_read_timeout(Some(timeout)).ok();
    s.set_write_timeout(Some(timeout)).ok();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {ip}:{port}\r\nConnection: close\r\nUser-Agent: Whisper/1.0 UPnP/1.0 DLNADOC/1.50\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str(&format!("Content-Length: {}\r\n\r\n{body}", body.len()));
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    s.take(2 << 20).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    parse_response(&buf)
}

pub fn parse_response(buf: &[u8]) -> Result<(u16, String), String> {
    let head_end = buf.windows(4).position(|w| w == b"\r\n\r\n").ok_or("неполный ответ")?;
    let head = String::from_utf8_lossy(&buf[..head_end]);
    let code: u16 = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).ok_or("неверный ответ")?;
    let chunked = head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let mut body = &buf[head_end + 4..];
    let raw: Vec<u8> = if chunked {
        let mut out = Vec::new();
        loop {
            let Some(nl) = body.windows(2).position(|w| w == b"\r\n") else { break };
            let n = usize::from_str_radix(String::from_utf8_lossy(&body[..nl]).split(';').next().unwrap_or("").trim(), 16).unwrap_or(0);
            if n == 0 || nl + 2 + n > body.len() {
                break;
            }
            out.extend_from_slice(&body[nl + 2..nl + 2 + n]);
            body = &body[(nl + 4 + n).min(body.len())..];
        }
        out
    } else {
        body.to_vec()
    };
    Ok((code, String::from_utf8_lossy(&raw).into_owned()))
}

/// Действие UPnP; ошибка — с кодом UPnP из ответа (телевизоры отвечают 500 и <errorCode>).
pub fn soap(ctl: &(String, String), action: &str, args: &[(&str, String)]) -> Result<String, String> {
    let body = soap_body(&ctl.1, action, args);
    let act = format!("\"{}#{action}\"", ctl.1);
    let (code, resp) = http(
        "POST",
        &ctl.0,
        &[("Content-Type", "text/xml; charset=\"utf-8\""), ("SOAPAction", &act)],
        &body,
        Duration::from_secs(5),
    )?;
    if code == 200 {
        return Ok(resp);
    }
    let why = tag(&resp, "errorDescription").or_else(|| tag(&resp, "errorCode")).unwrap_or_else(|| format!("HTTP {code}"));
    Err(format!("телевизор не выполнил {action}: {why}"))
}

/// Поиск плееров в сети (SSDP M-SEARCH): адрес ответившего и LOCATION его описания.
pub fn ssdp(wait: Duration) -> Vec<(Ipv4Addr, String)> {
    let Ok(sock) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else { return vec![] };
    sock.set_multicast_ttl_v4(2).ok();
    sock.set_read_timeout(Some(Duration::from_millis(200))).ok();
    let dst = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(239, 255, 255, 250)), 1900);
    for st in ["urn:schemas-upnp-org:device:MediaRenderer:1", "urn:schemas-upnp-org:service:AVTransport:1"] {
        let msg = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n");
        for _ in 0..2 {
            let _ = sock.send_to(msg.as_bytes(), dst);
        }
    }
    let until = Instant::now() + wait;
    let mut out: Vec<(Ipv4Addr, String)> = Vec::new();
    let mut buf = [0u8; 2048];
    while Instant::now() < until {
        let Ok((n, from)) = sock.recv_from(&mut buf) else { continue };
        let IpAddr::V4(ip) = from.ip() else { continue };
        if !lan_ok(ip) {
            continue;
        }
        let txt = String::from_utf8_lossy(&buf[..n]);
        let loc = txt.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.trim().eq_ignore_ascii_case("location").then(|| v.trim().to_string())
        });
        // описание — только с того же адреса, что ответил
        if let Some(loc) = loc.filter(|l| split_url(l).is_some_and(|(h, _, _)| h == ip)) {
            if !out.iter().any(|(_, l)| *l == loc) {
                out.push((ip, loc));
            }
        }
    }
    out
}

/// Адрес этого компьютера в сети, через которую виден телевизор (пакет никуда не уходит — UDP connect).
pub fn local_ip_for(tv: Ipv4Addr) -> Option<Ipv4Addr> {
    let s = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    s.connect((tv, 9)).ok()?;
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

// ---------- раздача трека ----------

/// Файл трека для телевизора. Трек Яндекса качается в фоне: телевизор получает уже скачанное сразу и ждёт
/// остальное (раньше трек скачивался целиком, и только потом телевизор узнавал о нём — несколько секунд тишины
/// на каждом переключении). Скачанный и из архива — целиком сразу.
pub struct Body {
    data: Mutex<Vec<u8>>,
    cv: std::sync::Condvar,
    /// полный размер файла (известен заранее — Content-Length)
    pub total: usize,
    /// 0 — качается, 1 — готов, 2 — не скачался
    state: std::sync::atomic::AtomicU8,
    /// трек сменился — докачивать незачем
    pub cancel: AtomicBool,
}

impl Body {
    pub fn full(v: Vec<u8>) -> Arc<Body> {
        let total = v.len();
        Arc::new(Body { data: Mutex::new(v), cv: Default::default(), total, state: 1.into(), cancel: AtomicBool::new(false) })
    }
    pub fn loading(total: usize) -> Arc<Body> {
        Arc::new(Body {
            data: Mutex::new(Vec::with_capacity(total)),
            cv: Default::default(),
            total,
            state: 0.into(),
            cancel: AtomicBool::new(false),
        })
    }
    pub fn push(&self, b: &[u8]) {
        let mut d = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let room = self.total.saturating_sub(d.len());
        d.extend_from_slice(&b[..b.len().min(room)]);
        self.cv.notify_all();
    }
    pub fn finish(&self, ok: bool) {
        let d = self.data.lock().unwrap_or_else(|e| e.into_inner());
        self.state.store(if ok && d.len() == self.total { 1 } else { 2 }, SeqCst);
        self.cv.notify_all();
    }
    /// Байты с места pos (не больше max), как только они скачаются; None — файл не докачался или ждать дольше wait.
    pub fn read_at(&self, pos: usize, max: usize, wait: Duration) -> Option<Vec<u8>> {
        let mut d = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let until = Instant::now() + wait;
        loop {
            if d.len() > pos {
                return Some(d[pos..d.len().min(pos + max)].to_vec());
            }
            let now = Instant::now();
            if self.state.load(SeqCst) != 0 || now >= until {
                return None;
            }
            d = self.cv.wait_timeout(d, until - now).unwrap_or_else(|e| e.into_inner()).0;
        }
    }
}

pub struct Media {
    pub token: String,
    pub body: Arc<Body>,
    pub mime: &'static str,
    /// обложка, которую телевизор берёт у нас (/c/<token>.jpg): заглушка приложения или картинка не с Яндекса
    pub art: Option<Arc<Vec<u8>>>,
}

/// HTTP-сервер для одного телевизора: работает, пока не поднят stop.
pub struct Server {
    pub port: u16,
    pub ip: Ipv4Addr,
    pub tv: Ipv4Addr,
    /// текущий трек и следующий (для «Далее» на пульте) — не больше двух
    pub media: Arc<Mutex<Vec<Media>>>,
    stop: Arc<AtomicBool>,
}

impl Server {
    pub fn start(ip: Ipv4Addr, tv: Ipv4Addr) -> Result<Server, String> {
        let l = TcpListener::bind((ip, 0)).map_err(|e| format!("не удалось открыть порт для телевизора ({e})"))?;
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = l.local_addr().map_err(|e| e.to_string())?.port();
        let media: Arc<Mutex<Vec<Media>>> = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (m2, s2) = (media.clone(), stop.clone());
        std::thread::Builder::new()
            .name("whisper-dlna".into())
            .spawn(move || {
                while !s2.load(SeqCst) {
                    match l.accept() {
                        Ok((c, from)) => {
                            if from.ip() != IpAddr::V4(tv) {
                                continue; // только сам телевизор
                            }
                            let m = m2.clone();
                            let s3 = s2.clone();
                            let _ = std::thread::Builder::new().name("whisper-dlna-conn".into()).spawn(move || serve(c, &m, &s3));
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(60)),
                        Err(_) => std::thread::sleep(Duration::from_millis(200)),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Server { port, ip, tv, media, stop })
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, SeqCst);
    }
}

fn serve(mut c: TcpStream, media: &Mutex<Vec<Media>>, stop: &AtomicBool) {
    c.set_nonblocking(false).ok();
    c.set_read_timeout(Some(Duration::from_secs(10))).ok();
    c.set_write_timeout(Some(Duration::from_secs(30))).ok();
    // телевизоры держат соединение и шлют несколько запросов подряд (keep-alive)
    for _ in 0..32 {
        if stop.load(SeqCst) {
            return;
        }
        let mut head = Vec::with_capacity(1024);
        let mut b = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            match c.read(&mut b) {
                Ok(1) => head.push(b[0]),
                _ => return,
            }
            if head.len() > 8192 {
                return;
            }
        }
        let head = String::from_utf8_lossy(&head).into_owned();
        let mut lines = head.lines();
        let mut first = lines.next().unwrap_or("").split_whitespace();
        let (method, path) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
        let hdr = |name: &str| {
            head.lines().skip(1).find_map(|l| {
                let (k, v) = l.split_once(':')?;
                k.trim().eq_ignore_ascii_case(name).then(|| v.trim().to_string())
            })
        };
        let close = hdr("connection").is_some_and(|v| v.eq_ignore_ascii_case("close"));
        let got = {
            let list = media.lock().unwrap_or_else(|e| e.into_inner());
            list.iter().find_map(|m| {
                // /m/<ключ>.<расш> — трек, /c/<ключ>.jpg — обложка
                let tok = |p: &str| path.strip_prefix(p).and_then(|r| r.split('.').next()).is_some_and(|t| t == m.token);
                if tok("/m/") {
                    Some((m.body.clone(), m.mime))
                } else if tok("/c/") {
                    m.art.as_ref().map(|a| (Body::full(a.to_vec()), if a.starts_with(b"\x89PNG") { "image/png" } else { "image/jpeg" }))
                } else {
                    None
                }
            })
        };
        let ok = match (method, got) {
            ("GET" | "HEAD", Some((body, mime))) => {
                let len = body.total;
                let rg = hdr("range").and_then(|r| range(&r, len));
                let (s, e) = rg.unwrap_or((0, len.saturating_sub(1)));
                let n = if len == 0 { 0 } else { e - s + 1 };
                let status = if rg.is_some() { "206 Partial Content" } else { "200 OK" };
                let cr = if rg.is_some() { format!("Content-Range: bytes {s}-{e}/{len}\r\n") } else { String::new() };
                let h = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {n}\r\n{cr}Accept-Ranges: bytes\r\n\
transferMode.dlna.org: Streaming\r\ncontentFeatures.dlna.org: {FEATURES}\r\nCache-Control: no-store\r\n\
Connection: {}\r\n\r\n",
                    if close { "close" } else { "keep-alive" }
                );
                let mut ok = c.write_all(h.as_bytes()).is_ok();
                if ok && method == "GET" && n > 0 {
                    // отдаём по мере скачивания: нет ещё нужного места — ждём его (до 30 с)
                    let mut pos = s;
                    while pos <= e {
                        let Some(chunk) = body.read_at(pos, (e + 1 - pos).min(256 * 1024), Duration::from_secs(30)) else {
                            ok = false;
                            break;
                        };
                        if stop.load(SeqCst) || c.write_all(&chunk).is_err() {
                            ok = false;
                            break;
                        }
                        pos += chunk.len();
                    }
                }
                ok
            }
            _ => {
                let _ = c.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                false
            }
        };
        if !ok || close {
            return;
        }
    }
}

// ---------- команды ----------

#[derive(Serialize)]
pub struct Found {
    id: String,
    name: String,
    model: String,
    volume: bool,
}

#[derive(Serialize, Default)]
pub struct Status {
    /// PLAYING | PAUSED_PLAYBACK | STOPPED | TRANSITIONING | NO_MEDIA_PRESENT
    state: String,
    pos: f64,
    dur: f64,
    /// громкость телевизора 0…1 (-1 — не знаем)
    volume: f64,
    /// ключ трека, который телевизор играет сейчас (по TrackURI): сам перешёл на следующий — ключ следующего
    track: String,
}

struct Cast {
    id: String,
    dev: Renderer,
    server: Server,
    /// ключ текущего трека
    cur: String,
    /// следующий трек, уже переданный телевизору (SetNextAVTransportURI): (номер трека, ключ)
    next: Option<(String, String)>,
}

#[derive(Default)]
struct State {
    found: HashMap<String, Renderer>,
    cast: Option<Cast>,
}
/// Номер последнего запроса «включи трек на телевизоре» и замок: телевизору — по одному треку за раз (dlna_cast).
static CAST_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CAST_LOCK: Mutex<()> = Mutex::new(());

fn st() -> std::sync::MutexGuard<'static, State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

fn token() -> Result<String, String> {
    let mut r = [0u8; 16];
    getrandom::fill(&mut r).map_err(|e| format!("нет источника случайных чисел: {e}"))?;
    Ok(r.iter().map(|b| format!("{b:02x}")).collect())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Текущий телевизор (для действий): адреса управления.
fn current() -> Result<Renderer, String> {
    st().cast.as_ref().map(|c| c.dev.clone()).ok_or_else(|| "телевизор не подключён".into())
}

/// Найти телевизоры и колонки в сети (~3 с).
#[tauri::command]
pub async fn dlna_scan() -> Result<Vec<Found>, String> {
    blocking(|| {
        let hits = ssdp(Duration::from_millis(2600));
        let mut found = Vec::new();
        let mut map = HashMap::new();
        for (ip, loc) in hits {
            let Ok((200, xml)) = http("GET", &loc, &[], "", Duration::from_secs(3)) else { continue };
            let Some(r) = parse_desc(&xml, &loc, ip) else { continue };
            // у одного телевизора может быть несколько описаний — показываем один раз
            if found.iter().any(|f: &Found| f.name == r.name && map.get(&f.id).is_some_and(|x: &Renderer| x.ip == ip)) {
                continue;
            }
            let id = format!("{:x}", md5::compute(loc.as_bytes()));
            found.push(Found { id: id.clone(), name: r.name.clone(), model: r.model.clone(), volume: r.rc.is_some() });
            map.insert(id, r);
        }
        let mut s = st();
        // подключённый телевизор остаётся известным, даже если в этот раз не ответил
        if let Some(c) = s.cast.as_ref() {
            map.entry(c.id.clone()).or_insert_with(|| c.dev.clone());
        }
        s.found = map;
        Ok(found)
    })
    .await
}

/// Файл трека для телевизора: трек Яндекса качается в фоне (телевизор начинает с первых кусков), скачанный и из
/// архива — целиком.
async fn open_body(app: &AppHandle, kind: &str, id: &str, quality: Option<&str>) -> Result<Arc<Body>, String> {
    Ok(match kind {
        "ym" => {
            let url = crate::net::track_url_q(id, quality == Some("low")).await?;
            let mut resp = crate::net::open_media(&url).await?;
            match resp.content_length().filter(|&n| n > 0 && n <= 120 << 20) {
                Some(n) => {
                    let b = Body::loading(n as usize);
                    let bg = b.clone();
                    tauri::async_runtime::spawn(async move {
                        loop {
                            if bg.cancel.load(SeqCst) {
                                bg.finish(false);
                                break;
                            }
                            match resp.chunk().await {
                                Ok(Some(c)) => bg.push(&c),
                                Ok(None) => {
                                    bg.finish(true);
                                    break;
                                }
                                Err(_) => {
                                    bg.finish(false);
                                    break;
                                }
                            }
                        }
                    });
                    b
                }
                None => Body::full(crate::net::read_media(resp).await?),
            }
        }
        "local" => {
            let (mut f, _, _) = crate::download::open_local(app, id).ok_or("LOCAL: скачанный файл не найден")?;
            let mut v = Vec::new();
            f.read_to_end(&mut v).map_err(|e| e.to_string())?;
            Body::full(v)
        }
        "wa" => Body::full(crate::whisper::wa_track_bytes(id).await?),
        _ => return Err("неизвестный источник".into()),
    })
}

/// Обложка для телевизора — картинкой с нашего сервера (/c/<ключ>.jpg): обложку Яндекса (только avatars.yandex.net)
/// скачиваем сами — https с Яндекса многие телевизоры не открывают; своя (заглушка приложения) — как прислала
/// страница. Только JPEG/PNG и не больше 512 КБ.
async fn cover_bytes(cover: Option<String>, art: Option<Vec<u8>>) -> Option<Arc<Vec<u8>>> {
    let ok = |a: &Vec<u8>| a.len() <= 512 * 1024 && (a.starts_with(&[0xFF, 0xD8]) || a.starts_with(b"\x89PNG"));
    let cover = cover.filter(|c| {
        c.len() < 600 && (c.starts_with("https://avatars.yandex.net/") || c.starts_with("https://avatars.mds.yandex.net/"))
    });
    if let Some(c) = cover {
        if let Ok(b) = crate::net::fetch_media(&c).await {
            if ok(&b) {
                return Some(Arc::new(b));
            }
        }
    }
    art.filter(ok).map(Arc::new)
}

fn meta_of(title: String, artist: String, album: Option<String>, dur: f64) -> Meta {
    let cut = |s: String| s.chars().filter(|c| !c.is_control()).take(200).collect::<String>();
    Meta { title: cut(title), artist: cut(artist), album: cut(album.unwrap_or_default()), dur: if dur.is_finite() { dur.max(0.0) } else { 0.0 } }
}

/// Включить трек на телевизоре. kind/id — как у engine_load ("ym" | "local" | "wa"); key — номер трека в очереди
/// (у трека Яндекса — его номер): по нему узнаём следующий, который телевизор уже играет сам (кнопка «Далее» на
/// пульте или конец трека). cover — https-обложка Яндекса, art — своя картинка; start — с какого места.
/// Ответ — ключ трека (по нему страница видит, что телевизор перешёл дальше).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn dlna_cast(
    app: AppHandle,
    device: String,
    kind: String,
    id: String,
    key: Option<String>,
    quality: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    cover: Option<String>,
    art: Option<Vec<u8>>,
    dur: f64,
    start: f64,
) -> Result<String, String> {
    // Треки переключают быстрее, чем скачивается файл: прошлый запрос мог докачаться позже нового и поставить
    // телевизору свой трек и своё название поверх. Каждый запрос получает номер; телевизору отдаёт трек только
    // последний, и по одному за раз (CAST_LOCK).
    let my = CAST_GEN.fetch_add(1, SeqCst) + 1;
    let stale = || Err::<String, String>("устарело: включён другой трек".into());
    let dev = st().found.get(&device).cloned().ok_or("телевизор не найден — поищи ещё раз")?;
    let key = key.unwrap_or_else(|| format!("{kind}:{id}"));
    // телевизор уже сам играет этот трек как следующий (переданный заранее) — ничего не трогаем, только запоминаем
    if start <= 1.0 {
        if let Some(tok) = adopt(&device, &key).await {
            return Ok(tok);
        }
    }
    let body = open_body(&app, &kind, &id, quality.as_deref()).await?;
    let tok = token()?;
    let art = cover_bytes(cover, art).await;
    let meta = meta_of(title, artist, album, dur);
    if CAST_GEN.load(SeqCst) != my {
        body.cancel.store(true, SeqCst);
        return stale();
    }
    blocking(move || {
        let _one = CAST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if CAST_GEN.load(SeqCst) != my {
            body.cancel.store(true, SeqCst);
            return stale();
        }
        // тип файла — по первым байтам (ждём их, пока качается начало)
        let Some(head) = body.read_at(0, 16, Duration::from_secs(20)) else {
            body.cancel.store(true, SeqCst);
            return Err("трек не скачался — нет связи с Яндексом?".into());
        };
        let (mime, ext) = sniff(&head);
        // прошлый трек на этом телевизоре ещё стоит — сначала Stop: без него часть телевизоров (Samsung, LG) берёт
        // новый трек, но на экране оставляет прошлые название и обложку
        let switching = st()
            .cast
            .as_ref()
            .is_some_and(|c| c.id == device && !c.server.media.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
        if switching {
            let _ = soap(&dev.avt, "Stop", &[("InstanceID", "0".into())]);
        }
        // сервер — один на телевизор: тот же телевизор — тот же порт, другой — новый
        let (url, cover) = {
            let mut s = st();
            if s.cast.as_ref().is_none_or(|c| c.id != device) {
                s.cast = None;
                let ip = local_ip_for(dev.ip).ok_or("нет сети до телевизора")?;
                let server = Server::start(ip, dev.ip)?;
                s.cast = Some(Cast { id: device.clone(), dev: dev.clone(), server, cur: String::new(), next: None });
            }
            let c = s.cast.as_mut().expect("cast");
            let has_art = art.is_some();
            {
                // прошлый и заготовленный следующий больше не нужны — не докачиваем
                let mut list = c.server.media.lock().unwrap_or_else(|e| e.into_inner());
                for o in list.drain(..) {
                    o.body.cancel.store(true, SeqCst);
                }
                list.push(Media { token: tok.clone(), body, mime, art });
            }
            c.cur = tok.clone();
            c.next = None;
            let base = format!("http://{}:{}", c.server.ip, c.server.port);
            (format!("{base}/m/{tok}.{ext}"), has_art.then(|| format!("{base}/c/{tok}.jpg")))
        };
        let meta = didl(&tok, &url, mime, &meta, cover.as_deref());
        let set = |d: &Renderer| soap(&d.avt, "SetAVTransportURI", &[("InstanceID", "0".into()), ("CurrentURI", url.clone()), ("CurrentURIMetaData", meta.clone())]);
        if set(&dev).is_err() {
            // часть телевизоров не берёт новый трек, пока играет старый
            let _ = soap(&dev.avt, "Stop", &[("InstanceID", "0".into())]);
            set(&dev)?;
        }
        soap(&dev.avt, "Play", &[("InstanceID", "0".into()), ("Speed", "1".into())])?;
        if start > 1.0 {
            // перематывать можно, когда телевизор уже начал играть
            let until = Instant::now() + Duration::from_secs(8);
            while Instant::now() < until {
                let r = soap(&dev.avt, "GetTransportInfo", &[("InstanceID", "0".into())]).unwrap_or_default();
                if tag(&r, "CurrentTransportState").as_deref() == Some("PLAYING") {
                    break;
                }
                std::thread::sleep(Duration::from_millis(300));
            }
            let _ = soap(&dev.avt, "Seek", &[("InstanceID", "0".into()), ("Unit", "REL_TIME".into()), ("Target", hms(start))]);
        }
        Ok(tok)
    })
    .await
}

/// Телевизор уже играет заранее переданный следующий трек с этим номером? Тогда он становится текущим —
/// без Stop и новой загрузки (иначе трек начался бы заново). Ответ — его ключ.
async fn adopt(device: &str, key: &str) -> Option<String> {
    let (dev, tok) = {
        let s = st();
        let c = s.cast.as_ref().filter(|c| c.id == device)?;
        let (k, t) = c.next.as_ref()?;
        if k != key {
            return None;
        }
        (c.dev.clone(), t.clone())
    };
    let playing = blocking(move || {
        let p = soap(&dev.avt, "GetPositionInfo", &[("InstanceID", "0".into())])?;
        Ok(tag(&p, "TrackURI").and_then(|u| token_of(&u)))
    })
    .await
    .ok()
    .flatten()?;
    if playing != tok {
        return None;
    }
    let mut s = st();
    let c = s.cast.as_mut().filter(|c| c.id == device)?;
    {
        let mut list = c.server.media.lock().unwrap_or_else(|e| e.into_inner());
        for o in list.iter().filter(|m| m.token != tok) {
            o.body.cancel.store(true, SeqCst);
        }
        list.retain(|m| m.token == tok);
    }
    c.cur = tok.clone();
    c.next = None;
    Some(tok)
}

/// Следующий трек — телевизору заранее (SetNextAVTransportURI): кнопка «Далее» на пульте и переход без паузы.
/// after — ключ текущего трека (если телевизору уже включили другой, следующий не нужен). Не все телевизоры это
/// умеют — тогда ошибка, и всё работает как раньше: следующий включает приложение, когда этот доиграет.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn dlna_next(
    app: AppHandle,
    after: String,
    kind: String,
    id: String,
    key: String,
    quality: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    cover: Option<String>,
    art: Option<Vec<u8>>,
    dur: f64,
) -> Result<String, String> {
    let same = move |s: &State| s.cast.as_ref().is_some_and(|c| c.cur == after);
    {
        let s = st();
        if !same(&s) {
            return Err("устарело".into());
        }
        // этот же следующий уже передан
        if let Some((k, t)) = s.cast.as_ref().and_then(|c| c.next.as_ref()) {
            if *k == key {
                return Ok(t.clone());
            }
        }
    }
    let body = open_body(&app, &kind, &id, quality.as_deref()).await?;
    let art = cover_bytes(cover, art).await;
    let meta = meta_of(title, artist, album, dur);
    let tok = token()?;
    blocking(move || {
        let _one = CAST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let same = same;
        let Some(head) = body.read_at(0, 16, Duration::from_secs(20)) else {
            body.cancel.store(true, SeqCst);
            return Err("следующий трек не скачался".into());
        };
        let (mime, ext) = sniff(&head);
        let (dev, url, cover) = {
            let mut s = st();
            if !same(&s) {
                body.cancel.store(true, SeqCst);
                return Err("устарело".into());
            }
            let c = s.cast.as_mut().expect("cast");
            let has_art = art.is_some();
            {
                // прошлый заготовленный следующий (очередь поменялась) больше не нужен
                let mut list = c.server.media.lock().unwrap_or_else(|e| e.into_inner());
                let cur = c.cur.clone();
                for o in list.iter().filter(|m| m.token != cur) {
                    o.body.cancel.store(true, SeqCst);
                }
                list.retain(|m| m.token == cur);
                list.push(Media { token: tok.clone(), body, mime, art });
            }
            c.next = Some((key, tok.clone()));
            let base = format!("http://{}:{}", c.server.ip, c.server.port);
            (c.dev.clone(), format!("{base}/m/{tok}.{ext}"), has_art.then(|| format!("{base}/c/{tok}.jpg")))
        };
        let meta = didl(&tok, &url, mime, &meta, cover.as_deref());
        soap(&dev.avt, "SetNextAVTransportURI", &[("InstanceID", "0".into()), ("NextURI", url), ("NextURIMetaData", meta)])?;
        Ok(tok)
    })
    .await
}

#[tauri::command]
pub async fn dlna_play() -> Result<(), String> {
    let d = current()?;
    blocking(move || soap(&d.avt, "Play", &[("InstanceID", "0".into()), ("Speed", "1".into())]).map(|_| ())).await
}

#[tauri::command]
pub async fn dlna_pause() -> Result<(), String> {
    let d = current()?;
    blocking(move || soap(&d.avt, "Pause", &[("InstanceID", "0".into())]).map(|_| ())).await
}

#[tauri::command]
pub async fn dlna_seek(pos: f64) -> Result<(), String> {
    if !pos.is_finite() || pos < 0.0 {
        return Err("некорректная позиция".into());
    }
    let d = current()?;
    blocking(move || soap(&d.avt, "Seek", &[("InstanceID", "0".into()), ("Unit", "REL_TIME".into()), ("Target", hms(pos))]).map(|_| ())).await
}

/// Громкость телевизора 0…1.
#[tauri::command]
pub async fn dlna_volume(v: f64) -> Result<(), String> {
    let d = current()?;
    let rc = d.rc.ok_or("у телевизора нет управления громкостью")?;
    let n = (v.clamp(0.0, 1.0) * 100.0).round() as u32;
    blocking(move || {
        soap(&rc, "SetVolume", &[("InstanceID", "0".into()), ("Channel", "Master".into()), ("DesiredVolume", n.to_string())]).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn dlna_status() -> Result<Status, String> {
    let d = current()?;
    blocking(move || {
        let t = soap(&d.avt, "GetTransportInfo", &[("InstanceID", "0".into())])?;
        let p = soap(&d.avt, "GetPositionInfo", &[("InstanceID", "0".into())]).unwrap_or_default();
        let volume = d
            .rc
            .as_ref()
            .and_then(|rc| soap(rc, "GetVolume", &[("InstanceID", "0".into()), ("Channel", "Master".into())]).ok())
            .and_then(|r| tag(&r, "CurrentVolume")?.parse::<f64>().ok())
            .map(|v| (v / 100.0).clamp(0.0, 1.0))
            .unwrap_or(-1.0);
        Ok(Status {
            state: tag(&t, "CurrentTransportState").unwrap_or_default(),
            pos: tag(&p, "RelTime").map(|s| secs(&s)).unwrap_or(0.0),
            dur: tag(&p, "TrackDuration").map(|s| secs(&s)).unwrap_or(0.0),
            volume,
            track: tag(&p, "TrackURI").and_then(|u| token_of(&u)).unwrap_or_default(),
        })
    })
    .await
}

/// Отключить телевизор: остановить на нём звук и закрыть сервер.
#[tauri::command]
pub async fn dlna_stop() -> Result<(), String> {
    let c = st().cast.take();
    if let Some(c) = c {
        let d = c.dev.clone();
        for m in c.server.media.lock().unwrap_or_else(|e| e.into_inner()).drain(..) {
            m.body.cancel.store(true, SeqCst);       // треки больше не докачиваем
        }
        drop(c); // сервер закрывается
        let _ = blocking(move || soap(&d.avt, "Stop", &[("InstanceID", "0".into())]).map(|_| ())).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const DESC: &str = r#"<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0">
<device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>[TV] Гостиная &amp; кухня</friendlyName>
<modelName>UE55</modelName><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/upnp/control/RenderingControl1</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:2</serviceType><controlURL>AVTransport/control</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><controlURL>http://8.8.8.8/x</controlURL></service>
</serviceList></device></root>"#;
    #[test]
    fn desc() {
        let ip = Ipv4Addr::new(192, 168, 1, 50);
        let r = parse_desc(DESC, "http://192.168.1.50:9197/dmr/desc.xml", ip).unwrap();
        assert_eq!(r.name, "[TV] Гостиная & кухня");
        assert_eq!(r.avt.0, "http://192.168.1.50:9197/dmr/AVTransport/control");
        assert_eq!(r.avt.1, "urn:schemas-upnp-org:service:AVTransport:2");
        assert_eq!(r.rc.unwrap().0, "http://192.168.1.50:9197/upnp/control/RenderingControl1");
    }
    #[test]
    fn foreign_urls_rejected() {
        let ip = Ipv4Addr::new(192, 168, 1, 50);
        assert!(join_url("http://192.168.1.50:80/a", "http://192.168.1.51/x", ip).is_none());
        assert!(join_url("http://192.168.1.50:80/a", "http://evil.com/x", ip).is_none());
        assert!(!lan_ok(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(lan_ok(Ipv4Addr::new(10, 0, 0, 2)) && lan_ok(Ipv4Addr::new(172, 20, 1, 1)));
    }
    #[test]
    fn tags_and_times() {
        let r = r#"<s:Envelope><s:Body><u:GetPositionInfoResponse xmlns:u="x"><Track>1</Track><TrackDuration>0:03:12</TrackDuration>
<TrackMetaData/><RelTime>00:01:05.500</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>"#;
        assert_eq!(tag(r, "TrackMetaData").as_deref(), Some(""));
        assert_eq!(secs(&tag(r, "TrackDuration").unwrap()), 192.0);
        assert_eq!(secs(&tag(r, "RelTime").unwrap()), 65.5);
        assert_eq!(secs("NOT_IMPLEMENTED"), 0.0);
        assert_eq!(hms(3725.9), "1:02:05");
    }
    #[test]
    fn ranges() {
        assert_eq!(range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(range("bytes=-30", 100), Some((70, 99)));
        assert_eq!(range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(range("bytes=100-", 100), None);
    }
    #[test]
    fn chunked() {
        let r = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nHello\r\n6\r\n world\r\n0\r\n\r\n";
        assert_eq!(parse_response(r).unwrap(), (200, "Hello world".into()));
    }
    #[test]
    fn meta_escaped() {
        let m = Meta { title: "Rock & <Roll>".into(), artist: "A\"B".into(), album: "Альбом".into(), dur: 192.0 };
        let d = didl("k1", "http://192.168.1.2:5000/m/ab.mp3", "audio/mpeg", &m, Some("http://192.168.1.2:5000/c/ab.jpg"));
        assert!(d.contains("Rock &amp; &lt;Roll&gt;") && d.contains("duration=\"0:03:12.000\""));
        assert!(d.contains("<item id=\"k1\"") && d.contains("<upnp:album>Альбом</upnp:album>") && d.contains("dlna:profileID=\"JPEG_TN\""));
        assert_eq!(token_of("http://192.168.1.2:5000/m/0123456789abcdef0123456789abcdef.mp3").as_deref(), Some("0123456789abcdef0123456789abcdef"));
        assert!(token_of("http://x/m/../etc").is_none());
        let b = soap_body("urn:x:service:AVTransport:1", "SetAVTransportURI", &[("CurrentURIMetaData", d)]);
        assert!(b.contains("&lt;DIDL-Lite") && !b.contains("<DIDL-Lite"));
    }
    #[test]
    fn serves_ranges_only_with_token() {
        let lo = Ipv4Addr::LOCALHOST;
        let srv = Server::start(lo, lo).unwrap();
        *srv.media.lock().unwrap() =
            vec![Media { token: "abc".into(), body: Body::full((0..100u8).collect()), mime: "audio/mpeg", art: Some(Arc::new(vec![0xFF, 0xD8, 1])) }];
        let get = |path: &str, extra: &str| {
            let mut c = TcpStream::connect((lo, srv.port)).unwrap();
            c.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n{extra}\r\n").as_bytes()).unwrap();
            let mut v = Vec::new();
            c.read_to_end(&mut v).unwrap();
            v
        };
        let full = get("/m/abc.mp3", "");
        assert!(full.starts_with(b"HTTP/1.1 200") && full.ends_with(&[98, 99]));
        let part = get("/m/abc.mp3", "Range: bytes=10-12\r\n");
        assert!(part.starts_with(b"HTTP/1.1 206") && part.ends_with(&[10, 11, 12]));
        assert!(get("/m/zzz.mp3", "").starts_with(b"HTTP/1.1 404"));
        assert!(get("/../secret", "").starts_with(b"HTTP/1.1 404"));
        let art = get("/c/abc.jpg", "");
        assert!(art.starts_with(b"HTTP/1.1 200") && art.ends_with(&[0xFF, 0xD8, 1]));
        assert!(get("/c/zzz.jpg", "").starts_with(b"HTTP/1.1 404"));
    }
    #[test]
    fn serves_while_loading() {
        let b = Body::loading(6);
        b.push(&[1, 2, 3]);
        assert_eq!(b.read_at(1, 10, Duration::ZERO), Some(vec![2, 3]));
        let b2 = b.clone();
        let t = std::thread::spawn(move || b2.read_at(3, 10, Duration::from_secs(5)));
        std::thread::sleep(Duration::from_millis(50));
        b.push(&[4, 5, 6, 7]);         // лишний байт за размером файла отбрасывается
        assert_eq!(t.join().unwrap(), Some(vec![4, 5, 6]));
        b.finish(true);
        assert_eq!(b.read_at(6, 10, Duration::from_secs(5)), None);
    }
}

//! Модуль системного прокси для Tauri-приложения.
//! Читает настройки Internet Explorer (PAC-файл, ручной прокси, автоопределение)
//! и возвращает адрес прокси для given URL, чтобы yt-dlp и reqwest работали так же,
//! как браузер.
//
//! Windows умеет ходить в сеть тремя способами, и браузер (Chrome, Edge) понимает все три:
//! 1. Ручной прокси (ProxyEnable/ProxyServer из реестра)
//! 2. PAC-файл (AutoConfigURL)
//! 3. Автоопределение (WPAD)
//!
//! reqwest и yt-dlp читают только переменные окружения, поэтому здесь мы разбираем
//! PAC и выдаем готовый адрес «http://host:port», который можно отдать и reqwest,
//! и yt-dlp.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Получить адрес прокси для `url` — «http://host:port» или None, если прямой доступ.
///
/// Ответ запоминается на время запуска: разбор PAC — сетевой запрос, а не мгновенная функция.
/// Цена — смена прокси в системе подхранится после перезапуска приложения (так же ведут себя
/// браузеры и сам reqwest с переменными окружения).
#[cfg(windows)]
pub fn for_url(url: &str) -> Option<String> {
    let (scheme, host) = (scheme_of(url).to_ascii_lowercase(), host_of(url)?);
    let key = format!("{scheme}://{host}");
    if let Some(hit) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return hit.clone();
    }
    let found = resolve(url, &scheme, &host);
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(key, found.clone());
    found
}

/// В Linux и BSD прокси задают переменными окружения — их reqwest и yt-dlp читают сами.
#[cfg(not(windows))]
pub fn for_url(_url: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static C: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(windows)]
fn scheme_of(url: &str) -> &str {
    url.split_once("://").map(|(s, _)| s).filter(|s| !s.is_empty()).unwrap_or("https")
}

#[cfg(windows)]
fn host_of(url: &str) -> Option<String> {
    // IPv6: [::1]:8080/x — host should be [::1] (with brackets, for proxy config)
    // IPv4 or hostname: example.com:8080/x → host is example.com
    let after = url.split_once("://")?.1;
    let rest = after.split(['/', '?', '#']).next()?;
    if rest.starts_with('[') {
        // Find closing bracket, include it in the host
        let end = rest.find(']')?;
        Some(rest[..=end].to_ascii_lowercase())
    } else {
        // Strip auth and port: user:pass@host:port → host
        let host = rest.rsplit_once('@').map_or(rest, |(_, h)| h);
        let host = host.split(':').next()?;
        (!host.is_empty()).then_some(host.to_ascii_lowercase())
    }
}

/// Всё, что знает система: PAC (или автоопределение) → ручной прокси → переменные окружения.
#[cfg(windows)]
fn resolve(url: &str, scheme: &str, host: &str) -> Option<String> {
    use windows::Win32::Networking::WinHttp::{
        WinHttpGetIEProxyConfigForCurrentUser, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG,
    };

    let mut cfg = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    let ok = unsafe {
        WinHttpGetIEProxyConfigForCurrentUser(&mut cfg)
    };
    if ok.is_err() {
        // Настроек Internet Explorer нет вовле — пробуем переменные окружения
        return env_proxy(host);
    }
    let pac = nonempty(unsafe { take(cfg.lpszAutoConfigUrl) });
    let manual = nonempty(unsafe { take(cfg.lpszProxy) });
    let bypass = unsafe { take(cfg.lpszProxyBypass) };

    if pac.is_some() || cfg.fAutoDetect.as_bool() {
        // PAC решает про каждый адрес отдельно и умеет «напрямую» — спрашиваем у WinHTTP
        if let Some(found) = pac_lookup(url, pac.as_deref(), cfg.fAutoDetect.as_bool()) {
            return found;
        }
        // PAC не answered (например, до PAC-файла не достучались) — пробуем дальше
    }
    match manual {
        Some(_) if bypassed(host, &bypass) => None,
        Some(raw) => manual_proxy(&raw, scheme),
        None => env_proxy(host),
    }
}

/// PAC через WinHTTP: Some(proxy) — идти через него, Some(None) — PAC говорит «напрямую», None — не выšlo.
#[cfg(windows)]
fn pac_lookup(url: &str, pac: Option<&str>, autodetect: bool) -> Option<Option<String>> {
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::{
        WinHttpGetProxyForUrl, WinHttpOpen, WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL,
        WINHTTP_AUTOPROXY_OPTIONS, WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A,
        WINHTTP_PROXY_INFO, WINHTTP_ACCESS_TYPE_NO_PROXY,
    };

    let pac_w = pac.map(wide);
    let mut opts = WINHTTP_AUTOPROXY_OPTIONS::default();
    match &pac_w {
        Some(p) => {
            opts.dwFlags = WINHTTP_AUTOPROXY_CONFIG_URL;
            opts.lpszAutoConfigUrl = PCWSTR(p.as_ptr());
        }
        None if autodetect => {
            opts.dwFlags = WINHTTP_AUTOPROXY_AUTO_DETECT;
            opts.dwAutoDetectFlags = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
        }
        None => return None,
    }
    opts.fAutoLogonIfChallenged = true.into();

    let agent = wide("yandex-desktop (yt-dlp)");
    let url_w = wide(url);
    let session = unsafe { WinHttpOpen(PCWSTR(agent.as_ptr()), WINHTTP_ACCESS_TYPE_NO_PROXY, PCWSTR::null(), PCWSTR::null(), 0) };
    if session.is_null() {
        return None;
    }
    let mut info = WINHTTP_PROXY_INFO::default();
    let asked = unsafe { WinHttpGetProxyForUrl(session, PCWSTR(url_w.as_ptr()), &mut opts, &mut info) }.is_ok();
    // Session will be cleaned up when dropped (handles have cleanup)
    if !asked {
        return None;
    }
    let list = unsafe { take(info.lpszProxy) };
    let _ = unsafe { take(info.lpszProxyBypass) };
    if info.dwAccessType == WINHTTP_ACCESS_TYPE_NO_PROXY || list.trim().is_empty() {
        return Some(None);
    }
    // «proxy:8080;proxy2:8080» — первый и есть основной
    let first = list.split([';', ',', ' ']).find(|s| !s.trim().is_empty())?.trim();
    proxy_url(first, "http").map(Some)
}

/// Строку из WinHTTP освобождает вызывающий — ручное выделение, обычный String тут не подходит.
#[cfg(windows)]
unsafe fn take(p: windows::core::PWSTR) -> String {
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    if p.is_null() {
        return String::new();
    }
    let s = p.to_string().unwrap_or_default();
    let _ = GlobalFree(Some(HGLOBAL(p.as_ptr() as _)));
    s
}

#[cfg(windows)]
fn nonempty(s: String) -> Option<String> {
    let s = s.trim().to_string();
    (!s.is_empty()).then_some(s)
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Ручной прокси из реестра: «host:port» или «http=host:port;https=host:port» (как в окне настроек Windows).
#[cfg(windows)]
fn manual_proxy(raw: &str, scheme: &str) -> Option<String> {
    let (mut http, mut any) = (None, None);
    for part in raw.split([';', ',', ' ']) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (name, addr) = match part.split_once('=') {
            Some((n, a)) => (n.trim().to_ascii_lowercase(), a.trim()),
            None => (String::new(), part),
        };
        let Some(url) = proxy_url(addr, &name) else { continue };
        if name == scheme {
            return Some(url);
        }
        match name.as_str() {
            // запись без имени или SOCKS — прокси для всех протоколов
            "" | "socks" | "socks4" | "socks5" => {
                any.get_or_insert(url);
            }
            // HTTPS без своей записи идёт через HTTP-прокси; запись «https=» для HTTP не годится
            "http" => {
                http.get_or_insert(url);
            }
            _ => {}
        }
    }
    http.or(any)
}

/// «host:port» / «10.0.0.1:8080» / «http://host:port» → адрес со схемой (reqwest и yt-dlp ждут её).
#[cfg(windows)]
fn proxy_url(addr: &str, name: &str) -> Option<String> {
    let addr = addr.trim().trim_end_matches('/');
    if addr.is_empty() {
        return None;
    }
    let lower = addr.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("socks") {
        return Some(addr.to_string());
    }
    let prefix = match name {
        "socks" | "socks5" => "socks5://",
        "socks4" => "socks4://",
        // «https=host:port» — прокси для HTTPS-трафика, но сам он говорит по HTTP (CONNECT), не по TLS
        _ => "http://",
    };
    Some(format!("{prefix}{addr}"))
}

/// Список исключений Windows («<local>;*.corp.example;10.*»): такие адреса ходят напрямую.
#[cfg(windows)]
fn bypassed(host: &str, list: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    list.split(|c: char| c == ';' || c == ',')
        .flat_map(|p| p.split_whitespace())
        .filter(|p| !p.is_empty())
        .any(|p| {
            let p = p.to_ascii_lowercase();
            match p.as_str() {
                "<local>" => return !host.contains('.'),
                "*" => return true,
                _ => {}
            }
            let p = p.trim_start_matches("*.").trim_start_matches('.');
            if p.is_empty() {
                return false;
            }
            if let Some(lead) = p.strip_suffix('*') {
                // «10.*», «192.168.*» — совпадение по началу адреса
                return host.starts_with(lead.trim_end_matches('.'));
            }
            host == p || host.ends_with(&format!(".{p}"))
        })
}

/// Последний вариант — то, что читают обычные программы: HTTPS_PROXY/HTTP_PROXY/ALL_PROXY и NO_PROXY.
#[cfg(windows)]
fn env_proxy(host: &str) -> Option<String> {
    for key in ["NO_PROXY", "no_proxy"] {
        if let Ok(no) = std::env::var(key) {
            if bypassed(host, &no) {
                return None;
            }
        }
    }
    let get = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let raw = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
        .into_iter()
        .find_map(get)?;
    proxy_url(&raw, "")
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn host_from_url() {
        assert_eq!(host_of("https://github.com/yt-dlp/yt-dlp/releases?x=1").as_deref(), Some("github.com"));
        assert_eq!(host_of("https://SoundCloud.com/a/b").as_deref(), Some("soundcloud.com"));
        assert_eq!(host_of("https://user:pw@example.com:8443/x").as_deref(), Some("example.com"));
        assert_eq!(host_of("https://[::1]:8080/x").as_deref(), Some("[::1]"));
        assert!(host_of("github.com/x").is_none());
        assert_eq!(scheme_of("http://x"), "http");
        assert_eq!(scheme_of("x"), "https");
    }

    #[test]
    fn registry_format() {
        assert_eq!(manual_proxy("10.0.0.1:8080", "https").as_deref(), Some("http://10.0.0.1:8080"));
        assert_eq!(manual_proxy("http=10.0.0.1:8080;https=10.0.0.2:8443", "https").as_deref(), Some("http://10.0.0.2:8443"));
        assert_eq!(manual_proxy("http=10.0.0.1:8080;https=10.0.0.2:8443", "http").as_deref(), Some("http://10.0.0.1:8080"));
        // HTTPS без своей записи идёт через HTTP-прокси, SOCKS — для всех протоколов
        assert_eq!(manual_proxy("http=10.0.0.1:8080", "https").as_deref(), Some("http://10.0.0.1:8080"));
        assert_eq!(manual_proxy("socks=127.0.0.1:1080", "https").as_deref(), Some("socks5://127.0.0.1:1080"));
        assert_eq!(manual_proxy("https=proxy.example:3128", "http"), None);
        assert_eq!(manual_proxy("", "https"), None);
    }

    #[test]
    fn bypass_list() {
        assert!(bypassed("printer", "<local>"));
        assert!(!bypassed("github.com", "<local>"));
        assert!(bypassed("a.corp.example", "*.corp.example"));
        assert!(bypassed("corp.example", "*.corp.example"));
        assert!(bypassed("10.1.2.3", "10.*"));
        assert!(!bypassed("github.com", "*.corp.example"));
        assert!(bypassed("github.com", "*"));
    }
}
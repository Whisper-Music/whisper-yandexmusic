// Замеры скорости (perf.js). Включаются только переменной окружения WHISPER_PERF=<путь к файлу>:
// без неё команда сразу отвечает false, и страница больше ничего не шлёт — обычный запуск не тратит ни такта.
// Время в строках — от старта процесса, чтобы Rust и страница были на одной шкале.
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();
static MARKS: Mutex<Vec<(u128, &'static str)>> = Mutex::new(Vec::new());

fn ms() -> u128 {
    START.get_or_init(Instant::now).elapsed().as_millis()
}

fn path() -> Option<std::path::PathBuf> {
    std::env::var_os("WHISPER_PERF").filter(|v| !v.is_empty()).map(Into::into)
}

/// Самое начало run(): отсюда считается всё остальное.
pub fn start() {
    START.get_or_init(Instant::now);
    mark("rust:start");
}

/// Отметка на стороне Rust (запишется в файл с первой строкой от страницы).
pub fn mark(name: &'static str) {
    if path().is_none() {
        return;
    }
    let t = ms();
    if let Ok(mut m) = MARKS.lock() {
        m.push((t, name));
    }
}

/// false — замеры выключены; иначе { auto } — WHISPER_PERF_AUTO=1|2: страница сама прогоняет сценарий (perf.js).
/// Строка `!hide` / `!show` в тексте — спрятать окно в трей / показать, как это делают крестик и значок в трее
/// (замер возврата окна из трея). Работает только с WHISPER_PERF.
#[tauri::command]
pub fn perf_log(app: tauri::AppHandle, text: String) -> serde_json::Value {
    use tauri::Manager;
    let off = serde_json::Value::Bool(false);
    let Some(p) = path() else { return off };
    for line in text.lines() {
        match line.trim() {
            "!hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    crate::winstate::save(&app);
                    let _ = w.hide();
                    crate::power::enter(&app);
                }
            }
            "!show" => crate::shell::show_main(&app),
            _ => {}
        }
    }
    let t = ms();
    let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) else { return off };
    if let Ok(mut m) = MARKS.lock() {
        for (at, name) in m.drain(..) {
            let _ = writeln!(f, "{at}\trust\t{name}");
        }
    }
    for line in text.lines().take(500) {
        let _ = writeln!(f, "{t}\tjs\t{}", line.chars().take(2000).collect::<String>());
    }
    // "1" — весь сценарий, "2" — короткий опыт (perf.js); нет переменной — null
    let auto = std::env::var("WHISPER_PERF_AUTO").ok().filter(|v| matches!(v.as_str(), "1" | "2" | "3"));
    // WHISPER_PERF_CSS — имя опыта с CSS при запуске (список вариантов — perf.js, CSS_EXP)
    let css = std::env::var("WHISPER_PERF_CSS").ok().filter(|v| v.len() <= 20 && v.bytes().all(|b| b.is_ascii_lowercase()));
    serde_json::json!({ "auto": auto, "css": css })
}

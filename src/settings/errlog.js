// Журнал ошибок (Настройки → Данные → «Журнал ошибок»): что сломалось, чтобы пользователь мог прислать автору файлом.
// Подключён без defer, сразу после lsguard.js — ловит ошибки и тех скриптов, что грузятся раньше main.js.
//
// Пишет: необработанные ошибки и отклонённые промисы, console.error, неудачные команды Rust (main.js → invoke),
// объяснённые ошибки плеера (errinfo.js). Одинаковые подряд — одной строкой «×N». Последние MAX записей лежат
// в localStorage ym_errlog: ошибка перед вылетом переживает перезапуск. В резервную копию журнал не попадает.
// Перед записью из текста вырезается то, что похоже на секреты (токены, ключи, пароли), и имя пользователя в путях.
//
// window.errLog.add(kind, text, extra?) — записать; .report() → текст для файла; .count(); .clear(); .on(fn)
(() => {
  const KEY = "ym_errlog", MAX = 300, TEXT_MAX = 1500;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || "[]"); if (!Array.isArray(list)) list = []; } catch { list = []; }
  const started = Date.now();
  const subs = new Set();

  const clean = (s) => String(s ?? "")
    .replace(/\b((?:oauth|token|secret|passw\w*|api[_-]?key|authorization|cookie|session|k)\s*["'=:]\s*["']?)[^\s"'&,;}]+/gi, "$1***")
    .replace(/\b(OAuth|Bearer)\s+[\w.-]+/g, "$1 ***")
    .replace(/\by[0-3]_[\w-]{20,}/g, "***")                         // токены Яндекса
    .replace(/[A-Za-z0-9+_-]{40,}={0,2}/g, "***")                 // длинные ключи и base64
    .replace(/([\\/](?:Users|home)[\\/])[^\\/\s"']+/gi, "$1…")     // имя пользователя в путях
    .slice(0, TEXT_MAX);

  let saveT = 0;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} }, 500);
  };

  function add(kind, text, extra) {
    const t = clean(text) || "(без текста)";
    const x = extra ? clean(extra) : "";
    // та же ошибка недавно уже была (опрос сервера, повтор каждые N секунд) — счётчик, а не новая строка
    const same = list.slice(-10).reverse().find((e) => e.k === kind && e.t === t);
    if (same) { same.n = (same.n || 1) + 1; same.at = Date.now(); }
    else {
      list.push({ at: Date.now(), k: kind, t, ...(x ? { x } : {}) });
      if (list.length > MAX) list.splice(0, list.length - MAX);
    }
    save();
    for (const f of subs) try { f(); } catch {}
  }

  // стек — только первые строки и без адреса приложения: имя файла и строка, остальное шум
  const stack = (e) => String(e?.stack || "").split("\n").slice(1, 5).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, "")).join(" ← ");

  addEventListener("error", (ev) => {
    if (ev.error || ev.message) add("ошибка", ev.message || String(ev.error), [ev.filename && `${ev.filename.replace(/^.*\//, "")}:${ev.lineno}`, stack(ev.error)].filter(Boolean).join(" · "));
    else if (ev.target?.tagName && ev.target !== window) {                          // картинка, видео, скрипт не загрузились
      const src = ev.target.currentSrc || ev.target.src || "";
      if (ev.target.tagName !== "IMG") add("загрузка", `${ev.target.tagName.toLowerCase()} не загрузился`, src.slice(0, 200));
    }
  }, true);
  addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    add("промис", r?.message || String(r), stack(r));
  });
  const ce = console.error;
  console.error = (...a) => {
    try { add("console", a.map((v) => v instanceof Error ? v.message : typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })()).join(" "), a.find((v) => v instanceof Error) ? stack(a.find((v) => v instanceof Error)) : ""); } catch {}
    ce.apply(console, a);
  };

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  async function report() {
    let ver = "?";
    try { ver = await window.__TAURI__?.app?.getVersion?.() || "?"; } catch {}
    const de = document.documentElement;
    const head = [
      "Whisper Music — журнал ошибок",
      `Версия: ${ver}${window.__WEB__ ? " (вкладка браузера)" : ""}`,
      `Система: ${navigator.userAgent}`,
      `Язык: ${window.i18n?.lang || "ru"} · стиль: ${de.dataset.style || "?"} · анимации: ${de.dataset.anim || "?"}`,
      `Окно: ${innerWidth}×${innerHeight} · масштаб ${devicePixelRatio} · сеть: ${navigator.onLine ? "есть" : "нет"}`,
      `Сохранён: ${stamp(Date.now())} · работает ${Math.round((Date.now() - started) / 60000)} мин`,
      `Записей: ${list.length}`,
      "",
    ];
    const body = list.map((e) => `${stamp(e.at)}  [${e.k}] ${e.t}${e.n > 1 ? `  ×${e.n}` : ""}${e.x ? `\n                     ${e.x}` : ""}`);
    return head.concat(body.length ? body : ["Ошибок нет."]).join("\n") + "\n";
  }


  // ---------- карточка в настройках (Данные → «Журнал ошибок») ----------
  addEventListener("DOMContentLoaded", () => {
    const $l = (id) => document.getElementById(id);
    if (!$l("logCard")) return;
    const note = (t) => { $l("logNote").textContent = t; };
    const paint = () => {
      const n = list.length, last = list[n - 1];
      $l("logInfo").textContent = n ? `Записей: ${n} · последняя ${stamp(last.at).slice(5, 16)}` : "Ошибок нет";
      $l("logCopy").disabled = $l("logClear").disabled = !n;
    };
    subs.add(paint); paint();
    const day = () => stamp(Date.now()).slice(0, 10);
    $l("logSave").onclick = async () => {
      try {
        const bytes = new TextEncoder().encode(await report());
        const name = `Whisper — журнал ошибок ${day()}`;
        if (window.__WEB__) {
          const a = document.createElement("a"), url = URL.createObjectURL(new Blob([bytes], { type: "text/plain;charset=utf-8" }));
          a.href = url; a.download = `${name}.txt`; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          return note("Файл скачан — пришли его автору");
        }
        const path = await window.__TAURI__.core.invoke("export_save", bytes, { headers: { "x-file-name": encodeURIComponent(name), "x-file-ext": "txt" } });
        note(path ? "Сохранено — пришли этот файл автору" : ""); $l("logNote").title = path || "";
      } catch (e) { note("Не удалось сохранить: " + (e?.message || e)); }
    };
    $l("logCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(await report()); note("Скопировано — вставь в сообщение автору"); }
      catch { note("Не удалось скопировать — сохрани файлом"); }
    };
    $l("logClear").onclick = () => { window.errLog.clear(); note("Журнал очищен — повтори то, что ломалось, и сохрани заново"); };
  });

  window.errLog = {
    add,
    report,
    count: () => list.length,
    last: () => list[list.length - 1] || null,
    clear: () => { list = []; try { localStorage.removeItem(KEY); } catch {} for (const f of subs) try { f(); } catch {} },
    on: (f) => subs.add(f),
  };
})();

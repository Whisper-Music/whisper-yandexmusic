// Основа для всех: вызов команд Rust (invoke), $, отчёт ядру (wReport), динамический CSS (DynCss, перенос правил ползунков
// для Firefox), значки (ICON), форматы, проверка адресов картинок (safeUrl), чтение localStorage (lsJSON), заглушка обложки,
// признак сетевой ошибки, запросы к Яндекс Музыке (ym), помощники цветов и ползунков.
// ES-модуль, подключён ПЕРВЫМ из модулей: остальные модули могут пользоваться этим и при своей загрузке.
// Наружу — через window в конце (main.js и все остальные скрипты зовут это по имени).

const invoke = async (cmd, args) => {
  const pf = window.perfIpc, t0 = pf ? performance.now() : 0;      // замеры (perf.js): только при WHISPER_PERF
  try { const r = await window.__TAURI__.core.invoke(cmd, args); pf?.(cmd, args, t0, r); return r; }
  catch (e) { pf?.(cmd, args, t0, null, e); window.errLog?.add("команда", `${cmd}: ${e?.message || e}`); throw e instanceof Error ? e : new Error(String(e)); }
};

const OAUTH_URL =
  "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";
const $ = (s) => document.querySelector(s);
// Ядро Whisper (core/whisper-core.js): сообщаем ему, что случилось с плеером, — дальше оно само рассылает
// события модулям (Whisper.on("track"…)). Ядра может не быть (старая разметка) — тогда просто молчим.
const wReport = (p) => { try { window.Whisper?.player.report(p); } catch (e) { console.error("Whisper:", e); } };

// Динамический CSS (свои цвета, CSS своих тем) — без элементов <style>: CSP приложения запрещает
// встроенные стили (style-src без 'unsafe-inline', аудит F-11). На constructable stylesheets
// (document.adoptedStyleSheets) CSP не распространяется; где их нет (старый WebKitGTK) — <link> на blob:
// этого же приложения (style-src разрешает только 'self' и blob:). Подключаются после всех файлов .css;
// настройки пользователя (ccStyle) — всегда последними, после CSS своих тем.
//
// Firefox (браузерная версия, webmode.js): ползунки (#seek, громкость…) оформлены только для движков Chromium/WebKit
// (::-webkit-slider-thumb / -runnable-track), а Firefox такие правила выбрасывает целиком — полоса воспроизведения
// пропадала. Здесь те же правила переписываются на ::-moz-range-* — и для файлов .css, и для CSS своих тем.
const MOZ_RANGE = (() => { try { return CSS.supports("selector(::-moz-range-thumb)"); } catch { return false; } })();
function mozRange(css) {
  if (!css.includes("-webkit-slider")) return "";
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const conv = (s) => s.replace(/::-webkit-slider-runnable-track/g, "::-moz-range-track").replace(/::-webkit-slider-thumb/g, "::-moz-range-thumb");
  (function walk(src, wrap) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      let d = 1, j = open + 1;
      for (; j < src.length && d; j++) { if (src[j] === "{") d++; else if (src[j] === "}") d--; }
      const head = src.slice(i, open).replace(/^[\s;]+/, "").trim(), body = src.slice(open + 1, j - 1);
      if (head.startsWith("@")) { if (/^@(media|supports|layer|container)\b/.test(head)) walk(body, [...wrap, head]); }
      else if (head.includes("-webkit-slider")) {
        // правило целиком: Firefox выбросил его и с остальными селекторами списка
        const sel = head.split(",").map((s) => conv(s.trim())).filter((s) => s && !s.includes("::-webkit-")).join(", ");
        let decl = body.replace(/-webkit-appearance\s*:[^;}]*;?/g, "");
        if (sel.includes("-moz-range-thumb")) decl = decl.replace(/(^|;)\s*margin-top\s*:[^;}]*/g, "$1");   // бегунок Firefox ставит по центру сам
        if (sel) { let r = `${sel} { ${decl} }`; for (const w of [...wrap].reverse()) r = `${w} { ${r} }`; out.push(r); }
      }
      i = j;
    }
  })(css, []);
  return out.join("\n");
}
const DynCss = (() => {
  const sheets = new Map();
  const LAST = "ccStyle";
  const adopt = "adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype;
  const order = () => [...sheets.keys()].filter((k) => k !== LAST).concat(sheets.has(LAST) ? [LAST] : []);
  function sync() {
    if (adopt) document.adoptedStyleSheets = order().map((k) => sheets.get(k));
    else for (const k of order()) { const l = sheets.get(k); if (l !== document.head.lastElementChild) document.head.append(l); }
  }
  return {
    set(key, css) {
      css = String(css);
      if (MOZ_RANGE) css += "\n" + mozRange(css);
      let sh = sheets.get(key);
      if (adopt) {
        if (!sh) { sh = new CSSStyleSheet(); sheets.set(key, sh); sync(); }
        sh.replaceSync(String(css));
        return;
      }
      if (!sh) { sh = document.createElement("link"); sh.rel = "stylesheet"; sheets.set(key, sh); }
      const old = sh.href;
      sh.href = URL.createObjectURL(new Blob([String(css)], { type: "text/css" }));
      if (old.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(old), 5000);
      sync();
    },
    remove(key) {
      const sh = sheets.get(key);
      if (!sh) return;
      sheets.delete(key);
      if (adopt) sync();
      else { if (sh.href.startsWith("blob:")) URL.revokeObjectURL(sh.href); sh.remove(); }
    },
  };
})();
window.DynCss = DynCss;
// Firefox: те же правила из подключённых файлов .css. Место «mozRange» занимаем сразу — раньше CSS своих тем
if (MOZ_RANGE) {
  DynCss.set("mozRange", "");
  Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => fetch(l.href).then((r) => (r.ok ? r.text() : "")).catch(() => "")))
    .then((texts) => DynCss.set("mozRange", texts.map(mozRange).join("\n")));      // только переписанные правила
}
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
};
const SPK = '<path fill="currentColor" d="M3 9v6h4l5 4V5L7 9z"/>';
const WV = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
const vsvg = (inner) => `<svg viewBox="0 0 24 24" width="22" height="22">${SPK}${inner}</svg>`;
ICON.mute = vsvg(WV("M16 9l5 6M21 9l-5 6"));
ICON.low = vsvg(WV("M15.5 9a4 4 0 0 1 0 6"));
ICON.high = vsvg(WV("M15.5 9a4 4 0 0 1 0 6") + WV("M18.5 6.5a8 8 0 0 1 0 11"));
const svgp = (d) => `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="${d}"/></svg>`;
ICON.heart = svgp("M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z");
ICON.heartOn = svgp("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z");
ICON.shuffle = svgp("M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z");
ICON.repeat = svgp("M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z");
ICON.repeatOne = svgp("M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z");
ICON.more = svgp("M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z");
ICON.playNext = svgp("M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z");      // «Играть следующим» в меню трека
ICON.download = svgp("M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z");
ICON.got = svgp("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 5v6.6l2.3-2.3 1.4 1.4-4.7 4.7-4.7-4.7 1.4-1.4 2.3 2.3V7h2z");
// «Не нравится» — как у Яндекса: перечёркнутый круг
ICON.dislike = svgp("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z");
ICON.plus = svgp("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");
ICON.plAdd = svgp("M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z");
ICON.remove = svgp("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z");
ICON.toTop = svgp("M4 4h16v2H4zm8 3l-6 6h4v7h4v-7h4z");
ICON.toEnd = svgp("M4 18h16v2H4zm8-1l6-6h-4V4h-4v7H6z");
ICON.image = svgp("M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z");
ICON.grip = svgp("M9 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z");
const fmtTime = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };


const TRUSTED_SUFFIXES = ["yandex.net", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz"];
const hostTrusted = (h) => TRUSTED_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    return hostTrusted(u.hostname.toLowerCase()) ? u.href : "";
  } catch { return ""; }
}
function lsJSON(key, fallback, ok = () => true) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v != null && ok(v) ? v : fallback; }
  catch { return fallback; }
}
function mkImg(src, cls) {
  const im = document.createElement("img");
  im.alt = ""; if (cls) im.className = cls;
  im.loading = "lazy"; im.decoding = "async";      // обложки вне экрана не грузятся и не держат память, пока до них не долистали
  im.src = src || COVER_W;
  return im;
}
// Заглушка «W» для обложек: нет адреса обложки, нет сети или сервер не отдал картинку.
// Ловим ошибки всех картинок на странице (событие error не всплывает — слушаем на этапе перехвата).
const COVER_W = "assets/cover-w.svg";
document.addEventListener("error", (e) => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || im.closest("#settingsPage")) return;
  if ((im.getAttribute("src") || "") === COVER_W) return;          // сама заглушка не загрузилась — не зацикливаемся
  im.src = COVER_W;
}, true);

// Офлайн-режим: нет интернета или сервера Яндекс Музыки не отвечают (5xx) — показываем скачанное.
// Ответ 4xx — это не «нет связи», а обычная ошибка запроса. Сетевые ошибки приходят из reqwest (net.rs) текстом.
const isNetErr = (e) => {
  const m = String(e?.message || e);
  return !navigator.onLine || /^HTTP 5\d\d\b/.test(m)
    || /error sending request|connect|dns|timed? ?out|network|unreachable|failed to lookup|no route|resolve/i.test(m);
};


// Яндекс Музыка. Интерфейс называет только операцию и её параметры; адрес, метод, заголовки и токен
// знает Rust (src-tauri/src/net.rs, список OPS). Чтение и изменение данных аккаунта — разные команды
// (ym_read / ym_write) с разными разрешениями (capabilities/yandex-read.json и yandex-write.json).
const YM_WRITE = new Set(["like_add", "like_remove", "dislike_add", "dislike_remove", "artist_like_add", "artist_like_remove",
  "artist_dislike_add", "artist_dislike_remove", "rotor_feedback",
  "playlist_create", "playlist_rename", "playlist_change", "playlist_change_rel", "playlist_delete", "play_audio"]);
const strMap = (o) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : null);
async function ym(op, { id = null, query = null, form = null, json = null } = {}) {
  const body = await invoke(YM_WRITE.has(op) ? "ym_write" : "ym_read",
    { op, id: id == null ? null : String(id), query: strMap(query), form: strMap(form), json });
  return JSON.parse(body).result;
}

function fill(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
// Текст, который меняется часто (время трека): меняем данные готового текстового узла, а не textContent —
// textContent пересоздаёт узел, а это изменение структуры: браузер перепроверяет :has() у предков (в CSS тем тоже)
// и пересчитывает стили широко.
function setText(el, s) {
  if (!el) return;
  const n = el.firstChild;
  if (n && n.nodeType === 3 && !n.nextSibling) { if (n.data !== s) n.data = s; }
  else if (el.textContent !== s) el.textContent = s;
}
function fillAll() { document.querySelectorAll("input[type=range]").forEach(fill); }

function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function relLum(rgb) { return rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
function btnHi(h) { const c = hexRgb(h); return c ? "#" + c.map((v) => Math.round(v * 0.7 + 255 * 0.3).toString(16).padStart(2, "0")).join("") : h; }      // = --btn-hi в CSS
function onAccent(a, b) {
  const DARK = "#0b0618", ca = hexRgb(a), cb = hexRgb(b);
  if (!ca || !cb) return { color: DARK, shadow: "none" };
  const spots = [ca, cb, ca.map((v, i) => Math.round((v + cb[i]) / 2))].map(relLum);
  const cr = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const dark = Math.min(...spots.map((l) => cr(l, relLum(hexRgb(DARK))))), white = Math.min(...spots.map((l) => cr(l, 1)));
  const useDark = dark >= white, best = Math.max(dark, white);
  const shadow = best >= 4.5 ? "none" : useDark ? "0 0 5px rgba(255,255,255,.55)" : "0 1px 4px rgba(0,0,0,.75)";
  return { color: useDark ? DARK : "#ffffff", shadow };
}

export { invoke, $, wReport, OAUTH_URL, MOZ_RANGE, mozRange, DynCss, ICON, svgp, fmtTime, hostTrusted, safeUrl, lsJSON, mkImg, COVER_W,
  isNetErr, ym, fill, setText, fillAll, hexRgb, relLum, btnHi, onAccent };
// обычные скрипты (layout.js, ядро Whisper, boot.js…) и обращения window.X — берут это из window
Object.assign(window, { invoke, fmtTime });

// Телефон: тема, открытая из другого приложения, автоскачивание лайков и подсказка про устаревший WebView.
import { el } from "./sections.js";             // el(тег, класс, текст) — общий помощник мобильных модулей
import { isNetErr } from "../app/base.js";
import { showToast } from "../app/menu.js";
import { dlOk, dlOne, downloading, syncGot } from "../library/downloads.js";
import { syncBgVideo } from "../look/bg.js";
import { loadAllLikes } from "../pages/likes.js";
// ---------- тема из другого приложения ----------
// «Открыть с помощью → Whisper» или «Поделиться» на файле .wmt: MainActivity.kt копирует его в кэш и зовёт
// window.whisperIncoming() (или страница сама спрашивает при запуске). Файл забираем кусками по 1 МБ и ставим
// как «Загрузить тему…» (theme.js → window.wmtImport: тот же вопрос «Заменить стиль?», тот же тост)
let inBusy = false, inAgain = false;
async function incoming() {
  const A = window.WhisperAndroid;
  if (!A?.incoming || document.readyState === "loading") return;      // до загрузки страницы — позовёт DOMContentLoaded
  if (inBusy) { inAgain = true; return; }
  let info = null;
  try { info = JSON.parse(A.incoming() || "null"); } catch {}
  if (!info) return;
  inBusy = true;
  try {
    const name = String(info.name || "файл");
    if (info.error === "big") { showToast("Файл темы больше 64 МБ — такую тему не открыть", 5000); return; }
    if (info.error) { showToast(`Не удалось открыть «${name}»: ${info.error}`, 5000); return; }
    const size = Number(info.size) || 0, buf = new Uint8Array(size), STEP = 1 << 20;
    for (let o = 0; o < size; o += STEP) {
      const s = atob(A.incomingRead(o, STEP));
      if (!s) throw new Error("файл пропал из кэша");
      for (let k = 0; k < s.length; k++) buf[o + k] = s.charCodeAt(k);
    }
    // тема — текст с «#WMT» в начале или zip-архив (theme.wmt внутри проверит сам разбор)
    let head = new TextDecoder().decode(buf.subarray(0, 64));
    if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);        // метка UTF-8 в начале файла
    head = head.trimStart();
    const zip = buf[0] === 0x50 && buf[1] === 0x4b;
    if (!/^#WMT\b/.test(head) && !zip) { showToast(`«${name}» — не тема Whisper (.wmt)`, 5000); return; }
    if (typeof window.wmtImport !== "function") throw new Error("темы ещё не загрузились");
    await window.wmtImport(buf);
  } catch (e) {
    showToast("Не удалось открыть тему: " + (e?.message || e), 5000);
  } finally {
    try { A.incomingDone(); } catch {}
    inBusy = false;
    if (inAgain) { inAgain = false; incoming(); }
  }
}
if (window.isMobile) window.whisperIncoming = incoming;

// Приложение ушло в фон / вернулось (MainActivity.kt). В фоне страница для Chromium остаётся «видимой» — иначе он
// не грузит следующий трек, — поэтому видеообои останавливаем сами: в фоне их всё равно не видно.
if (window.isMobile) window.whisperBg = (bg) => {
  const v = document.getElementById("bgVideo");
  if (bg) { if (v && !v.paused) v.pause(); }
  else { try { syncBgVideo(); } catch {} }
};

// ---------- автоскачивание лайков (только телефон) ----------
// Выключатель в «Воспроизведение → Кэш»: все лайки сами скачиваются на телефон — без сети играют они (и «Моя волна»
// переходит на них). По умолчанию только по Wi-Fi (navigator.connection; тип не известен — не мешаем).
// Качает по одному треку тем же dlOne, что «Скачать лайки»; уже скачанные пропускает; новые лайки — через минуту.
const ADL_KEY = "ym_m_autodl";
let adl = { on: false, wifi: true };
try { adl = { ...adl, ...JSON.parse(localStorage.getItem(ADL_KEY) || "{}") }; } catch {}
let adlBusy = false, adlTimer = 0, adlNote = null;
const adlSave = () => { try { localStorage.setItem(ADL_KEY, JSON.stringify(adl)); } catch {} };
const adlNoWifi = () => {
  const c = navigator.connection;
  return adl.wifi && !!c?.type && !["wifi", "ethernet", "none", "unknown"].includes(c.type);
};
const adlSay = (s) => { if (adlNote) adlNote.textContent = s; };
async function adlRun() {
  if (!adl.on || adlBusy) return;
  try { if (offline || !navigator.onLine || bulk) return; } catch { return; }
  if (adlNoWifi()) { adlSay("Ждёт Wi-Fi — по мобильной сети лайки не скачиваются"); return; }
  adlBusy = true;
  let done = 0;
  try {
    const all = await loadAllLikes(() => {});
    if (!all) return;
    const todo = all.filter((t) => dlOk(t) && !got.has(String(t.id)) && !downloading.has(String(t.id)));
    if (!todo.length) { adlSay(`Все лайки скачаны (${all.length})`); return; }
    for (const t of todo) {
      if (!adl.on || offline || adlNoWifi() || bulk) break;
      adlSay(`Скачивается: ${done} из ${todo.length}`);
      try { await dlOne(t); done++; syncGot(); }
      catch (e) { if (isNetErr(e)) break; }
    }
    const left = all.filter((t) => dlOk(t) && !got.has(String(t.id))).length;
    adlSay(left ? `Скачано ${all.length - left} из ${all.length} — остальные докачаются позже` : `Все лайки скачаны (${all.length})`);
  } catch {} finally { adlBusy = false; }
}
const adlLater = (ms) => { clearTimeout(adlTimer); adlTimer = setTimeout(adlRun, ms); };
function autoDl() {
  const card = document.getElementById("cacheCard");
  if (card && !document.getElementById("mAutoDl")) {
    const sw = (id, text, on) => {
      const l = el("label", "switch"), i = el("input"); i.type = "checkbox"; i.id = id; i.checked = on;
      l.append(i, el("i"), el("span", "", text));
      return [l, i];
    };
    const [l1, c1] = sw("mAutoDl", "Автоскачивание лайков", adl.on);
    const [l2, c2] = sw("mAutoDlWifi", "Только по Wi-Fi", adl.wifi);
    l1.title = "Все лайки сами скачиваются на телефон — без интернета играют они. Займёт место в памяти";
    adlNote = el("p", "status");
    const paint = () => { l2.hidden = !adl.on; adlNote.hidden = !adl.on; };
    c1.onchange = () => { adl.on = c1.checked; adlSave(); paint(); if (adl.on) { adlSay("Скоро начнётся…"); adlLater(500); } };
    c2.onchange = () => { adl.wifi = c2.checked; adlSave(); adlLater(500); };
    paint();
    card.append(l1, l2, adlNote);
  }
  adlLater(15000);                                   // после запуска — когда лайки уже подгрузились
  setInterval(adlRun, 10 * 60000);
  window.addEventListener("online", () => adlLater(5000));
  navigator.connection?.addEventListener?.("change", () => adlLater(5000));
  window.Whisper?.on?.("like", () => adlLater(60000));   // новый лайк — скачается через минуту
}


// Интерфейс рисует встроенный браузер Android (Android System WebView), и он обновляется отдельно от приложения.
// Слишком старый (до Chrome 111) не понимает color-mix() — на нём пропадают яркие кнопки, «Играть» и т. п.
// Тогда сверху — подсказка обновить его в Google Play (закрыл — не показываем до следующей версии WebView).
function oldWebView() {
  if (CSS.supports?.("color", "color-mix(in srgb, red 50%, blue)")) return;
  const ver = (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || "?";
  try { if (localStorage.getItem("ym_m_oldwv") === ver) return; } catch {}
  const bar = document.createElement("div");
  bar.className = "m-oldwv";
  const txt = document.createElement("span");
  txt.textContent = `Встроенный браузер Android устарел (версия ${ver}), поэтому часть кнопок не видна. Обнови «Android System WebView» в Google Play.`;
  const go = document.createElement("button");
  go.className = "nav active"; go.textContent = "Обновить";
  go.onclick = () => window.__TAURI__.core.invoke("plugin:opener|open_url", { url: "https://play.google.com/store/apps/details?id=com.google.android.webview" }).catch(() => {});
  const x = document.createElement("button");
  x.className = "nav"; x.textContent = "✕"; x.title = "Скрыть";
  x.onclick = () => { bar.remove(); try { localStorage.setItem("ym_m_oldwv", ver); } catch {} };
  bar.append(txt, go, x);
  document.body.append(bar);
}

export { incoming, autoDl, oldWebView };

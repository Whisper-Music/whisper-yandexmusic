// Фон окна: картинки и видеообои (mp4/webm, в т.ч. из Wallpaper Engine) — выбор файла или папки, перетаскивание в окно,
// хранение в IndexedDB (IDB — общее хранилище: темы, фоны, статистика), подготовка картинки, выгрузка видео в трее.
// ES-модуль, подключён ПЕРЕД app/main.js: main.js при загрузке зовёт initBg и читает IDB. Поэтому при загрузке модуль
// только объявляет своё и вешает обработчики (свой $); cfg, bgUrls, applyCfg… из main.js — по имени внутри функций.
// Наружу — через window в конце (main.js, theme.js, backup.js, listenstats.js, webmode.js, mobile.js).
import { invoke } from "../app/base.js";
import { imageGuard, IMG_LIMITS } from "../app/imgguard.js";
import { showToast } from "../app/menu.js";
import { applyCfg, bgKey, bgKinds, bgPosters, bgUrls, curBg, curBgVideo, saveCfg } from "./config.js";
const $ = (s) => document.querySelector(s);

const IDB = {
  db: null,
  open() {
    return (this.db ||= new Promise((res, rej) => {
      const r = indexedDB.open("whisper-edition", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("kv", mode), rq = fn(t.objectStore("kv"));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  get: (k) => IDB.tx("readonly", (s) => s.get(k)),
  set: (k, v) => IDB.tx("readwrite", (s) => s.put(v, k)),
  del: (k) => IDB.tx("readwrite", (s) => s.delete(k)),
};
const bgNote = (m) => { $("#setNote").textContent = m || ""; };
function setBgBlob(blob, st = cfg.style) {
  if (bgUrls[st]) URL.revokeObjectURL(bgUrls[st]);
  if (bgPosters[st]) URL.revokeObjectURL(bgPosters[st]);
  bgUrls[st] = blob ? URL.createObjectURL(blob) : "";
  bgKinds[st] = !blob ? "" : /^video\//.test(blob.type) ? "video" : "image";
  bgPosters[st] = "";
  if (bgKinds[st] === "video") {
    const url = bgUrls[st];
    videoFrame(url).then((c) => new Promise((r) => c.toBlob(r, "image/jpeg", 0.8))).then((b) => {
      if (!b || bgUrls[st] !== url) return;
      bgPosters[st] = URL.createObjectURL(b);
      if (st === cfg.style) $("#drop").style.setProperty("--drop-img", `url("${bgPosters[st]}")`);
    }).catch(() => {});
  }
}

// ---------- видеообои (mp4 / webm, в т.ч. из Wallpaper Engine) ----------
// Видео играет только когда его реально видно. Пауза: окно свёрнуто или в трее, открыт полноэкранный плеер.
// В трее видео ещё и выгружается целиком — декодер и буферы кадров (у 4K это сотни МБ) освобождаются.
let bgUnloaded = false;
// окно ушло в трей (main.js, power-save): видеообои выгружаются полностью до показа окна
function bgUnload() { bgUnloaded = true; syncBgVideo(); }
function syncBgVideo() {
  const v = $("#bgVideo"), url = curBgVideo() && cfg.dyn !== true ? curBg() : "";
  if (!url || bgUnloaded) {
    v.hidden = true;
    if (v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); v.load(); }      // отпускаем декодер
    return;
  }
  v.hidden = false;
  if (v.getAttribute("src") !== url) { v.src = url; }
  const show = !document.hidden && $("#full").hidden;
  if (show) { if (v.paused) v.play().catch(() => {}); }
  else if (!v.paused) v.pause();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) bgUnloaded = false; syncBgVideo(); });
// Проверка при добавлении смотрит только первый кадр. Если дальше декодер сдался (длинное или тяжёлое видео, битый
// хвост файла, не хватило памяти), фон раньше просто оставался пустым без единого слова — теперь говорим почему.
{
  const v = $("#bgVideo");
  let said = "";
  const say = (why) => {
    const src = v.getAttribute("src") || "";
    if (!src || said === src) return;            // об одном и том же файле — один раз
    said = src;
    const msg = `Видеообои не показываются: ${why}. Подойдёт MP4 (H.264) или WebM (VP9), лучше не больше 1080p.`;
    bgNote(msg);
    if ($("#settingsPage").hidden) showToast(msg, 9000, { kind: "err" });
  };
  v.addEventListener("error", () => {
    const er = v.error; if (!er) return;
    console.warn("Видеообои:", er.code, er.message);
    say({ 2: "файл не дочитался", 3: "видео не декодируется — оно повреждено или слишком тяжёлое", 4: "этот формат или кодек окно не умеет" }[er.code] || "ошибка воспроизведения");
  });
  // ошибки нет, но и кадров нет: через 12 с после начала загрузки видео всё ещё пустое
  let wd = 0;
  v.addEventListener("loadstart", () => {
    clearTimeout(wd);
    wd = setTimeout(() => { if (!v.hidden && v.getAttribute("src") && v.readyState < 2 && !v.error) say("видео так и не открылось"); }, 12000);
  });
  v.addEventListener("loadeddata", () => clearTimeout(wd));
}
// первый кадр видео на холсте 320 px — для превью в настройках и подбора цветов
function videoFrame(url, side = 320) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    const done = (fn, x) => { clearTimeout(tm); v.removeAttribute("src"); v.load(); fn(x); };
    const tm = setTimeout(() => done(rej, new Error("timeout")), 15000);
    v.onerror = () => done(rej, new Error("decode"));
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => {
      const k = side / Math.max(v.videoWidth, v.videoHeight), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k));
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      done(res, c);
    };
  });
}
// формат по первым байтам: MP4/MOV (ftyp) и WebM/MKV (EBML)
function sniffVideo(b) {
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^avi[fs]$/.test(brand) || /^(heic|heix|mif1|msf1)$/.test(brand)) return null;     // это картинки в той же обёртке
    return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}
const VIDEO_MAX_BYTES = 500 * 1048576;
async function prepareVideo(f, type) {
  if (f.size > VIDEO_MAX_BYTES) throw new Error(`Видео «${f.name}» весит ${Math.round(f.size / 1048576)} МБ — больше лимита в ${VIDEO_MAX_BYTES / 1048576} МБ.`);
  const blob = f.type === type ? f : new Blob([f], { type });
  const url = URL.createObjectURL(blob);
  try {
    const c = await videoFrame(url, 64);       // проверяем, что движок окна умеет это видео декодировать
    if (!c) throw new Error();
  } catch {
    throw new Error(`Видео «${f.name}» не воспроизводится: скорее всего, кодек H.265/HEVC или другой редкий. Подойдёт MP4 (H.264) или WebM (VP9/AV1).`);
  } finally { URL.revokeObjectURL(url); }
  return { blob, info: "Видеообои применены. Звук у них всегда выключен; пока окно свёрнуто или в трее, видео не играет." };
}

// Из набора файлов (несколько выбранных или целая папка) выбираем фон.
// Папка Wallpaper Engine: читаем project.json и берём указанный в нём файл.
async function pickBgFromFiles(files) {
  files = [...files].filter(Boolean);
  if (!files.length) return null;
  const pj = files.find((f) => f.name.toLowerCase() === "project.json");
  if (pj) {
    let meta;
    try { meta = JSON.parse(await pj.text()); } catch { throw new Error("project.json повреждён — не получилось его прочитать."); }
    const type = String(meta?.type || "").toLowerCase();
    if (type && type !== "video") throw new Error(`Это обои Wallpaper Engine типа «${type}» — их показывает только сама программа. Подойдут обои типа «video» (с файлом .mp4 или .webm).`);
    const want = String(meta?.file || "").split(/[\\/]/).pop().toLowerCase();
    const hit = files.find((f) => f.name.toLowerCase() === want);
    if (hit) return hit;
    if (files.length === 1) throw new Error(`В project.json указан файл «${meta?.file}». Выбери его вместе с project.json или перетащи сюда всю папку обоев.`);
  }
  const media = files.filter((f) => f !== pj && !/\.(json|url|txt|pdf|html?)$/i.test(f.name));
  return media.find((f) => /^video\//.test(f.type) || /\.(mp4|webm|m4v|mov|mkv)$/i.test(f.name))
    || media.find((f) => /^image\//.test(f.type)) || media[0] || null;
}
// Папку обоев (кнопка) и перетаскивание в окно принимает Rust (bg.rs): если отдать папку странице,
// WebView2 каждый раз спрашивает «Отправить N файлов на этот сайт?». Rust присылает только список имён
// (папка обходится не глубже 3 уровней), а содержимое нужного файла читается по номеру — лишнее не грузится.
function nativeFiles(list) {
  return (Array.isArray(list) ? list : []).map((e) => ({
    name: String(e.name || ""), type: "", size: Number(e.size) || 0, _id: e.id,
    async text() { return new TextDecoder().decode(new Uint8Array(await invoke("bg_read", { id: this._id, kind: "text" }))); },
  }));
}
const BG_MIME = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
};
async function loadNativeBg(list) {
  try {
    const pick = await pickBgFromFiles(nativeFiles(list));
    if (!pick) return await loadBg(null);
    bgNote("Загружается…");
    const ext = (pick.name.split(".").pop() || "").toLowerCase();
    const lim = /^(mp4|m4v|mov|webm|mkv)$/.test(ext) ? VIDEO_MAX_BYTES : BG_MAX_BYTES;      // лимит проверяет и Rust до чтения файла
    if (pick.size > lim) throw new Error(`Файл «${pick.name}» весит ${Math.round(pick.size / 1048576)} МБ — больше лимита в ${lim / 1048576} МБ.`);
    const buf = await invoke("bg_read", { id: pick._id, kind: lim === VIDEO_MAX_BYTES ? "video" : "image" });      // потолок по сценарию держит и Rust
    return await loadBg(new File([buf], pick.name, { type: BG_MIME[ext] || "" }));
  } catch (e) { bgNote(e.message || "Не удалось прочитать файлы."); return false; }
}
async function loadBgFiles(files) {
  try { const f = await pickBgFromFiles(files); return await loadBg(f); }
  catch (e) { bgNote(e.message || "Не удалось прочитать файлы."); return false; }
}
function dataUrlToBlob(u) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error("bad data url");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] || "application/octet-stream" });
}

const BG_MAX_BYTES = IMG_LIMITS.maxBytes;
const BG_MAX_SIDE = 3840;
async function prepareBg(f) {
  const vt = sniffVideo(new Uint8Array(await f.slice(0, 16).arrayBuffer()));
  if (vt) return prepareVideo(f, vt);
  if (/^audio\//.test(f.type)) throw new Error("Звук как фон не поддерживается — выбери картинку, GIF или видео.");
  let g;
  try { g = imageGuard(new Uint8Array(await f.arrayBuffer())); }
  catch (e) { throw new Error(`«${f.name}»: ${e.message}`); }
  if (f.type !== g.type) f = new File([f], f.name, { type: g.type });
  let w = g.w, h = g.h;
  try { const bm = await createImageBitmap(f); w = bm.width; h = bm.height; bm.close(); }
  catch { throw new Error(`Не получилось открыть «${f.name}»: файл повреждён.`); }
  const flat = g.frames === 1 && ["image/jpeg", "image/png", "image/bmp"].includes(g.type);
  if (flat && Math.max(w, h) > BG_MAX_SIDE) {
    const k = BG_MAX_SIDE / Math.max(w, h), cw = Math.round(w * k), ch = Math.round(h * k);
    try {
      const small = await createImageBitmap(f, { resizeWidth: cw, resizeHeight: ch, resizeQuality: "high" });
      const c = document.createElement("canvas"); c.width = cw; c.height = ch;
      c.getContext("2d").drawImage(small, 0, 0); small.close();
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
      if (blob) return { blob, info: `Картинка ${w}×${h} очень большая — уменьшил до ${cw}×${ch}, на экране разницы не будет.` };
    } catch {}
  }
  return { blob: f, info: "" };
}
async function loadBg(f) {
  if (!f) { bgNote("Не получилось получить файл. Выбери его кнопкой или перетащи сам файл (не ссылку и не текст)."); return false; }
  const isVid = /^video\//.test(f.type) || /\.(mp4|webm|m4v|mov|mkv)$/i.test(f.name);
  if (!isVid && f.size > BG_MAX_BYTES) { bgNote(`Файл «${f.name}» весит ${Math.round(f.size / 1048576)} МБ — это больше лимита в ${BG_MAX_BYTES / 1048576} МБ. Выбери файл поменьше.`); return false; }
  const st = cfg.style;
  bgNote("Загружается…");
  let prep;
  try { prep = await prepareBg(f); }
  catch (e) { bgNote(e.message || "Не удалось прочитать файл."); return false; }
  setBgBlob(prep.blob, st);
  cfg.s[st].bg = "idb";
  applyCfg();
  let kept = true;
  try { await IDB.set(bgKey(st), prep.blob); }
  catch (e) {
    kept = false;
    bgNote(e?.name === "QuotaExceededError" ? "Фон применён, но на диске не хватает места, чтобы сохранить его: после перезапуска он пропадёт." : "Фон применён, но сохранить его не удалось: после перезапуска он пропадёт.");
  }
  if (saveCfg() && kept) bgNote(prep.info);
  return true;
}
async function clearBg(st = cfg.style) {
  setBgBlob(null, st); cfg.s[st].bg = "";
  try { await IDB.del(bgKey(st)); } catch {}
}
async function initBg() {
  try {
    if (cfg.bg) {
      const blob = cfg.bg === "idb" ? await IDB.get("bg") : dataUrlToBlob(cfg.bg);
      if (blob) { await IDB.set(bgKey(cfg.style), blob); cfg.s[cfg.style].bg = "idb"; }
      await IDB.del("bg");
    }
  } catch {}
  cfg.bg = "";
  // Сначала фон текущего стиля — как только он готов, интерфейс можно показывать (boot.js, «bg»);
  // фоны остальных стилей (с проверкой картинок это заметное время на больших обоях) догружаются уже после.
  let marked = false;
  const mark = () => { if (marked) return; marked = true; applyCfg(); window.bootMark?.("bg"); };
  const order = [cfg.style, ...Object.keys(cfg.s).filter((s) => s !== cfg.style)];
  for (const st of order) {           // встроенные и свои стили
    if (st !== cfg.style) mark();
    if (!cfg.s[st] || cfg.s[st].bg !== "idb") continue;
    let blob = null;
    try { blob = await IDB.get(bgKey(st)); } catch {}
    if (!blob) { cfg.s[st].bg = ""; continue; }
    try {
      if (sniffVideo(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))) setBgBlob(blob, st);      // видео: проверено при добавлении
      else { imageGuard(new Uint8Array(await blob.arrayBuffer())); setBgBlob(blob, st); }
    }
    catch (e) { console.warn(`Фон стиля ${st} отклонён:`, e?.message); cfg.s[st].bg = ""; try { await IDB.del(bgKey(st)); } catch {} }
  }
  if (saveCfg()) localStorage.removeItem("ym_cfg2");
  applyCfg();
  mark();          // boot.js: фон текущего стиля готов (если стиль один — только здесь)
}
$("#bgFile").onchange = async (e) => { const fs = [...e.target.files]; e.target.value = ""; await loadBgFiles(fs); };
$("#bgDirBtn").onclick = async (e) => {
  e.preventDefault(); e.stopPropagation();
  try { const list = await invoke("bg_dir_pick"); if (list) await loadNativeBg(list); }
  catch (er) { bgNote("Не удалось открыть папку: " + er.message); }
};
// Перетаскивание файла или папки в окно: события приходят из Rust (bg.rs). Пока тащим над страницей
// настроек — подсвечиваем зону; бросить можно в любое место настроек.
const drop = $("#drop");
const onSettings = () => !$("#settingsPage").hidden;
// На любой другой странице окна (Моя волна, Лайки…) картинка или видео тоже становятся фоном, а трек —
// открывает окно «что сделать с треком» (dropin.js): в архив, к себе в «Лайки», в альбом архива.
window.__TAURI__.event?.listen("bg-drag", (e) => {
  const over = !!e.payload?.over;
  drop.classList.toggle("over", over && onSettings());
  window.dropHint?.(over && !onSettings());               // dropin.js: подсказка поверх окна
});
window.__TAURI__.event?.listen("bg-drop", async (e) => {
  drop.classList.remove("over");
  window.dropHint?.(false);
  const files = e.payload?.files;
  if (window.wmtDrop?.(files)) return;          // файл темы .wmt (theme.js) — принимается на любой странице
  if (window.dropAudio?.(files)) return;        // трек (dropin.js) — на любой странице, и в настройках тоже
  if (onSettings()) { loadNativeBg(files); return; }
  const ok = await loadNativeBg(files);
  const note = $("#setNote").textContent;
  if (ok) showToast(note ? `Фон поставлен. ${note}` : "Фон поставлен — поменять или убрать его можно в «Настройках» → «Оформление»", 4500, { kind: "ok" });
  else showToast(note || "Не получилось поставить фон", 6000, { kind: "err" });
});
$("#bgReset").onclick = async () => { await clearBg(); applyCfg(); saveCfg(); };

export { IDB, videoFrame, bgNote, setBgBlob, syncBgVideo, bgUnload, sniffVideo, prepareVideo, loadBg, clearBg, initBg };

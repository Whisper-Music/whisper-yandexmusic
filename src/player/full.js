// Плеер на весь экран и текст песни (щелчок по обложке в плеере; источники текста — Яндекс и LRCLIB).
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет функции и вешает обработчики на разметку
// (свой $); queue, audio, togglePlay… из main.js — по имени внутри функций (модуль видит глобальную область обычных скриптов).
// Наружу — через window в конце файла (main.js, yandex.js, cli.js, mobile.js вызывают их по имени). Свои переменные
// (fullRun, fPeek…) снаружи не меняют: для этого fullResume, fullPeek, lyricsForget.
import { COVER_W, fill, fmtTime, invoke, setText } from "../app/base.js";
import { albumOf, cover, fillArtists } from "../app/list.js";
import { showToast } from "../app/menu.js";
import { navigate } from "../app/nav.js";
import { syncBgVideo } from "../look/bg.js";
import { showAlbum } from "../pages/artist.js";
import { togglePlay } from "./core.js";
import { toggleLike } from "./like.js";
const $ = (s) => document.querySelector(s);

let fullRun = false, fullSeq = 0, fLines = [], fIdx = -1, fDrag = false;
const lyricsCache = new Map();

function parseLrc(txt) {
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!times.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of times) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(":", ".")), text });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function lyricsSign(id, ts) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("p93jhgh689SBReK6ghtw62"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}${ts}`)));
  return btoa(String.fromCharCode(...sig));
}
// Запрос текста и сам файл текста по ссылке из ответа берёт Rust (net.rs, ym_lyrics).
async function lyricsRaw(id, fmt) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await lyricsSign(id, ts);
  return await invoke("ym_lyrics", { id: String(id), format: fmt, timeStamp: ts, sign });
}
async function fetchLyrics(id) {
  let body;
  try { body = await lyricsRaw(id, "LRC"); }
  catch { try { body = await lyricsRaw(id, "TEXT"); } catch { return { type: "none" }; } }
  const lines = parseLrc(body);
  if (lines.length >= 3) return { type: "lrc", lines };
  const text = body.replace(/\[[^\]]*\]/g, "").replace(/\r/g, "").trim();
  return text ? { type: "text", text } : { type: "none" };
}

// ---------- источники текста ----------
// Яндекс — основной; LRCLIB (lrclib.net, открытая база, часто с синхронизацией) — второй, запрос идёт через Rust
// (lyrics.rs). Если у выбранного источника текста нет, берётся другой; если текста нет нигде (или нет сети) —
// на весь экран показывается обложка.
const LYR_SRCS = ["yandex", "lrclib"];
const LYR_NAME = { yandex: "Яндекс", lrclib: "LRCLIB" };
let lyrPref = (() => { try { const v = localStorage.getItem("ym_lyr_src"); return LYR_SRCS.includes(v) ? v : "yandex"; } catch { return "yandex"; } })();
let lyrShown = "";            // источник, чей текст сейчас на экране
async function fetchLrclib(t) {
  const r = await invoke("lyrics_lrclib", {
    artist: (t.artists || []).map((a) => a?.name).filter(Boolean).join(", "),
    title: String(t.title || ""),
    album: t.albums?.[0]?.title || null,
    duration: t.durationMs ? t.durationMs / 1000 : null,
  });
  if (!r) return { type: "none" };
  if (r.synced) { const lines = parseLrc(r.synced); if (lines.length >= 3) return { type: "lrc", lines }; }
  if (r.plain && r.plain.trim()) return { type: "text", text: r.plain.replace(/\r/g, "").trim() };
  if (r.instrumental) return { type: "instr" };
  return { type: "none" };
}
async function lyricsFrom(t, src) {
  const key = String(t.id) + ":" + src;
  let res = lyricsCache.get(key);
  if (res) return res;
  try { res = src === "lrclib" ? await fetchLrclib(t) : await fetchLyrics(t.id); }
  catch (e) { console.warn("lyrics", src, e); return { type: "none", err: String(e?.message || e || "") }; }   // ошибку не кэшируем — можно повторить
  lyricsCache.set(key, res);
  if (lyricsCache.size > 120) lyricsCache.delete(lyricsCache.keys().next().value);
  return res;
}
// Почему не пришёл текст. Ошибки LRCLIB из lyrics.rs начинаются с причины («limit:», «timeout:», «net:», «http:»):
// раньше любая из них выглядела как «проверь интернет», хотя чаще всего интернет в порядке, а занят сам сервер.
function lyrErrText(src, err) {
  const n = LYR_NAME[src];
  if (!navigator.onLine) return `${n}: нет подключения к интернету`;
  if (/^limit:/.test(err)) return `${n} просит подождать — слишком много запросов. Попробуй через минуту`;
  if (/^timeout:/.test(err)) return `${n} долго не отвечает — попробуй ещё раз чуть позже`;
  if (/^net:/.test(err)) return `${n} сейчас недоступен — сервер не отвечает. Попробуй позже`;
  if (/^http:/.test(err)) return `${n}: сервер ответил ошибкой — попробуй позже`;
  return `${n}: не удалось получить текст — попробуй ещё раз`;
}
function paintLyrSrc() {
  for (const b of document.querySelectorAll("#fSrc [data-src]")) {
    b.classList.toggle("on", b.dataset.src === lyrShown);
  }
}
document.querySelectorAll("#fSrc [data-src]").forEach((b) => {
  b.onclick = () => {
    const t = queue[current];
    if (!t) return;
    const src = b.dataset.src;
    lyrPref = src;
    try { localStorage.setItem("ym_lyr_src", src); } catch {}
    loadFullLyrics(t, src);
  };
});

function setFullMode(m) {
  $("#full").dataset.mode = m;
  requestAnimationFrame(fitFull);
  paintFCover();
}
function fitFull() {
  const f = $("#full"), cv = $("#fCover");
  if (f.hidden) return;
  if (f.dataset.mode !== "cover") { cv.style.width = cv.style.height = ""; return; }
  const box = $("#fHead");
  const avail = box.clientHeight - $("#fTitles").offsetHeight - 22;
  const size = Math.max(120, Math.min(box.clientWidth, avail));
  cv.style.width = cv.style.height = size + "px";
}
window.addEventListener("resize", fitFull);

function renderLyrics(res) {
  const box = $("#fLyrics");
  box.innerHTML = ""; fLines = []; fIdx = -1;
  if (res.type === "lrc") {
    box.className = "flyrics synced";
    for (const l of res.lines) {
      const d = document.createElement("div");
      d.className = "ln"; d.textContent = l.text || "♪";
      d.onclick = () => { if (!needLoad) audio.currentTime = l.t; };
      box.append(d); fLines.push({ t: l.t, el: d });
    }
    setFullMode("lyrics");
  } else if (res.type === "text") {
    box.className = "flyrics plain";
    const p = document.createElement("div"); p.className = "ptext"; p.textContent = res.text;
    box.append(p); setFullMode("lyrics");
  } else if (res.type === "instr") {
    box.className = "flyrics"; box.innerHTML = '<div class="fstatus">Инструментальная композиция — без слов</div>';
    setFullMode("lyrics");
  } else { box.className = "flyrics"; setFullMode("cover"); }
}

// only — источник выбран кнопкой: показываем именно его, даже если там пусто (чтобы было видно, что текста нет).
// Иначе — сначала предпочитаемый источник, при пустом ответе — другой.
async function loadFullLyrics(t, only = null) {
  const my = ++fullSeq;
  fPeek = false;                 // новый трек — снова текст, если он есть
  const box = $("#fLyrics");
  // пока ищем — обложка на весь экран; текст появится, только если он нашёлся
  box.className = "flyrics"; box.innerHTML = "";
  fLines = []; fIdx = -1;
  setFullMode("cover");
  $("#fSrc").classList.add("busy");
  const order = only ? [only] : [lyrPref, ...LYR_SRCS.filter((s) => s !== lyrPref)];
  let res = { type: "none" }, src = order[0], err = "";
  for (const s of order) {
    const r = await lyricsFrom(t, s);
    if (my !== fullSeq || $("#full").hidden) return;
    err ||= r.err || "";
    if (r.type !== "none") { res = r; src = s; break; }
  }
  $("#fSrc").classList.remove("busy");
  lyrShown = res.type === "none" ? "" : src;
  // источник выбран вручную, а текста там нет — короткая подсказка поверх обложки
  if (res.type === "none" && only) showToast(err ? lyrErrText(only, err) : `У источника «${LYR_NAME[only]}» текста этой песни нет`, 3500);
  paintLyrSrc();
  renderLyrics(res);
}

function fillFull(t) {
  const big = cover(t, "800x800");
  $("#fCover").src = big;
  $("#fBg").style.backgroundImage = big ? `url("${cover(t, "400x400")}")` : "none";
  $("#fTitle").textContent = t.title;
  fillArtists($("#fArtist"), t);
  $("#fTCur").textContent = "0:00"; $("#fTDur").textContent = fmtTime((t.durationMs || 0) / 1000);
  loadFullLyrics(t);
}
function openFull() {
  const t = queue[current];
  if (!t) return;
  $("#full").hidden = false; syncBgVideo();      // плеер закрывает фон целиком — видеообои на паузу
  document.body.classList.add("full-open");      // styles.css: фон под плеером не анимируется (вместо body:has)
  fillFull(t);
  fLast = { cur: -1, dur: -1, tc: "", td: "" };
  if (!fullRun) { fullRun = true; requestAnimationFrame(fullFrame); }
}
function closeFull() { $("#full").hidden = true; document.body.classList.remove("full-open"); fullRun = false; fullSeq++; $("#fSrc").classList.remove("busy"); syncBgVideo(); }

let fLast = { cur: -1, dur: -1, tc: "", td: "" };
function fullFrame() {
  if (!fullRun) return;
  if (document.hidden) { fullRun = false; return; }          // окно скрыто в трей — цикл встаёт, вернётся при показе
  requestAnimationFrame(fullFrame);
  const t = queue[current];
  if (!t) return;
  const cur = needLoad ? resumePos : audio.currentTime || 0;
  const dur = audio.duration || (t.durationMs || 0) / 1000;
  if (cur === fLast.cur && dur === fLast.dur) return;      // на паузе ничего не меняется — и в DOM ничего не пишем
  fLast.cur = cur; fLast.dur = dur;
  if (!fDrag) { $("#fSeek").value = dur ? (cur / dur) * 1000 : 0; fill($("#fSeek")); }
  const tc = fmtTime(cur), td = fmtTime(dur);
  if (tc !== fLast.tc) { setText($("#fTCur"), tc); fLast.tc = tc; }
  if (td !== fLast.td) { setText($("#fTDur"), td); fLast.td = td; }
  if (!fLines.length) return;
  let lo = 0, hi = fLines.length - 1, idx = -1;
  const x = cur + 0.2;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (fLines[m].t <= x) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx === fIdx) return;
  fLines[fIdx]?.el.classList.remove("on");
  fIdx = idx;
  if (idx >= 0) {
    const el = fLines[idx].el, box = $("#fLyrics");
    el.classList.add("on");
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: document.documentElement.dataset.anim === "off" ? "auto" : "smooth" });
  }
}

$("#cover").onclick = openFull;
$("#cover").title = "Развернуть на весь экран";
// Обложка в развёрнутом плеере. Есть текст песни — обложка маленькая сбоку: щелчок показывает её крупно, как у трека
// без текста (режим «cover»), повторный щелчок — снова текст. Текста нет — щелчок открывает обложку на весь экран
// в просмотрщике (imgview.js, 1000×1000).
let fPeek = false;
$("#fCover").addEventListener("click", () => {
  const f = $("#full");
  if (f.dataset.mode === "lyrics") { fPeek = true; setFullMode("cover"); paintFCover(); return; }
  if (fPeek) { fPeek = false; setFullMode("lyrics"); paintFCover(); return; }
  const src = $("#fCover").currentSrc || $("#fCover").src;
  if (src && $("#fCover").getAttribute("src") !== COVER_W) window.imgView?.show?.(src, { square: true });
});
function paintFCover() {
  const cv = $("#fCover"), f = $("#full");
  cv.classList.add("zoomable");
  cv.title = f.dataset.mode === "lyrics" ? "Показать обложку крупно" : fPeek ? "Вернуться к тексту песни" : "Открыть обложку на весь экран";
}
$("#fClose").onclick = closeFull;
$("#fPlay").onclick = () => togglePlay();
$("#fNext").onclick = () => $("#next").click();
$("#fPrev").onclick = () => $("#prev").click();
$("#fLike").onclick = () => toggleLike(queue[current]);
$("#fTitle").onclick = () => { const id = albumOf(queue[current]); if (id) { closeFull(); navigate(() => showAlbum(id)); } };
$("#fArtist").addEventListener("click", closeFull, true);
$("#fSeek").addEventListener("pointerdown", () => { fDrag = true; });
window.addEventListener("pointerup", () => { fDrag = false; });
$("#fSeek").addEventListener("input", (e) => {
  fill(e.target);
  if (!needLoad && audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
});

// окно снова показали (из трея): цикл отрисовки встал, пока его не было видно (main.js, visibilitychange)
function fullResume() { if (!$("#full").hidden && !fullRun) { fullRun = true; fLast.cur = -1; requestAnimationFrame(fullFrame); } }
// режим «обложка крупно» поверх текста (mobile.js — свой переключатель текст ⇄ обложка)
function fullPeek(on) { fPeek = !!on; setFullMode(on ? "cover" : "lyrics"); }
// экономия памяти в трее (main.js, power-save)
function lyricsForget() { lyricsCache.clear(); }

export { openFull, closeFull, fillFull, setFullMode, fetchLyrics, fullResume, fullPeek, lyricsForget };

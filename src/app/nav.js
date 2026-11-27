// Навигация и шапка страницы: setHead, переключатели под заголовком (setChips), resetView, закладки закреплённых (renderTabs),
// navigate / goTop, кнопки бокового меню, значки «играет» (syncIcons), трей и кнопки под миниатюрой (thumbSync), экономия памяти
// в трее. transit — свойство window (его читает player/core.js).
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
import { fillAll, ICON, invoke, wReport } from "./base.js";
import { pinKey, renderRail, savePins, unpin, updatePinBtn } from "./pins.js";
import { loadDlDir } from "../library/downloads.js";
import { bgUnload } from "../look/bg.js";
import { LO } from "../look/lolitta.js";
import { artistCache, showAlbum, showArtist } from "../pages/artist.js";
import { updateArtistLikeBtn } from "../pages/artistprefs.js";
import { showLikes } from "../pages/likes.js";
import { showPlaylist } from "../pages/playlists.js";
import { showStats } from "../pages/stats.js";
import { showWave } from "../pages/wave.js";
import { setVizFull, togglePlay, vizStop } from "../player/core.js";
import { lyricsForget } from "../player/full.js";
import { isLiked, toggleLike } from "../player/like.js";
import { waveOrbitsSync } from "../player/viz.js";
import { setVol } from "../player/volume.js";
const $ = (s) => document.querySelector(s);

function setHead({ title = "", img = "", round = true, back = false, sub = null, pin = null, artistWave = null, artistLike = null }) {
  artistWaveItem = artistWave; $("#artistWaveBtn").hidden = !artistWave;
  artistLikeItem = artistLike; updateArtistLikeBtn();
  // обложка для колонки закреплённых: только постоянные ссылки (blob: своих обложек плейлистов живёт до перезапуска)
  const keepImg = /^https:\/\//.test(img) ? img : "";
  pinItem = pin ? { ...pin, img: keepImg } : null; updatePinBtn();
  if (pin && keepImg) {
    const p = pins.find((x) => x.type === pin.type && String(x.id) === String(pin.id));
    if (p && p.img !== keepImg) { p.img = keepImg; savePins(); renderRail(tabsActive); }
  }
  $("#title").textContent = title;
  const im = $("#headImg"); im.hidden = !img; if (img) im.src = img;
  im.classList.toggle("sq", !round);
  $("#back").hidden = !back;
  const s = $("#sub");
  s.hidden = !sub; s.textContent = "";
  if (sub) sub(s);
}
function setChips(items, active, onPick) {
  const c = $("#chips"); c.hidden = false;
  const dl = $("#dlAllBtn"); if (dl && c.contains(dl)) $("#pinBtn").before(dl);   // не стереть кнопку вместе с чипсами
  c.innerHTML = "";
  for (const [id, label] of items) {
    const b = document.createElement("button");
    b.className = "chip" + (id === active ? " active" : "");
    b.textContent = label;
    b.onclick = () => onPick(id);
    c.append(b);
  }
}
function resetView() {
  if (vizFullOn) setVizFull(false);
  vizStop();
  $("#stWrap").hidden = true; $("#waveInfo").hidden = true;
  $("#stations").hidden = true;
  document.querySelector(".main").classList.remove("wavemode");
  shown = []; $("#list").innerHTML = ""; $("#list").hidden = false;
  $("#more").hidden = true; $("#status").textContent = "";
  $("#chips").hidden = true; $("#lkFind").hidden = true; $("#lastAlbum").hidden = true; $("#similar").hidden = true;
  $("#wavePage").hidden = true; $("#settingsPage").hidden = true; $("#statsPage").hidden = true; $("#studioPage").hidden = true;
  document.querySelectorAll(".main > .kitpage").forEach((s) => { s.hidden = true; });     // страницы общих модулей (kit.page)
  $("#plPage").hidden = true; $("#plBar").hidden = true; $("#plRecs").hidden = true; $("#plCreateBtn").hidden = true;
  curPl = null; recArr.length = 0; $("#plRecList").innerHTML = "";
  dlCur = null; $("#dlAllBtn").hidden = true;
  $("#status").classList.remove("offmsg"); offlineShown = false;
  document.querySelector(".main").scrollTop = 0;
}
function setActive(id, page) {        // page — имя страницы для CSS, когда в боковой панели ничего не подсвечено (артист, альбом)
  document.querySelectorAll(".side .nav").forEach((b) => b.classList.toggle("active", b.id === id));
  document.querySelector(".main").dataset.page = page || id || "";
}
const roman = (n) => {
  n = +n; if (!n || n < 1 || n > 3999) return "";
  let r = "";
  for (const [v, t] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (n >= v) { r += t; n -= v; }
  return r;
};
function renderTabs(active) {
  tabsActive = active;
  const box = $("#tabs");
  box.innerHTML = "";
  box.classList.toggle("pins", pins.length > 0);
  const mk = (label, key, fn, onClose, sub) => {
    const d = document.createElement("div");
    d.className = "tab" + (active === key ? " active" : "");
    const t = document.createElement("span"); t.textContent = label; d.append(t);
    const sm = document.createElement("small"); sm.textContent = sub || ""; d.append(sm);
    if (onClose) {
      const x = document.createElement("i"); x.textContent = "✕"; x.title = "Открепить";
      x.onclick = (e) => { e.stopPropagation(); onClose(); };
      d.append(x);
    }
    d.insertAdjacentHTML("beforeend", `<span class="lodeco lo-tabbow" aria-hidden="true">${LO.bow2}</span>`);
    d.onclick = fn; box.append(d);
  };
  mk("Лайки", "likes", () => { likesQuery = ""; goTop(showLikes); }, null, "♥");
  for (const p of pins) {
    const open = p.type === "artist" ? () => showArtist(p.id) : p.type === "playlist" ? () => showPlaylist(p.id) : () => showAlbum(p.id);
    mk(p.title, pinKey(p.type, p.id), () => goTop(open), () => unpin(p.type, p.id), p.type === "artist" ? "♪" : p.type === "playlist" ? "♫" : roman(p.year) || "†");
  }
  // открытая закладка всегда в видимой части полосы (полоса прокручивается вбок, если закладки не помещаются)
  const on = box.querySelector(".tab.active");
  if (on) {
    const l = on.offsetLeft - box.offsetLeft, r = l + on.offsetWidth;
    if (l < box.scrollLeft) box.scrollLeft = l - 8;
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8;
  }
  renderRail(active);
}

var trayPlaying = null;
// Переход между треками (загрузка следующего, повтор после сбоя, дозагрузка волны). Всё это время для Rust
// музыка «играет»: иначе в трее режим экономии через 1,5 с замораживал страницу (TrySuspend) посреди загрузки
// следующего трека — и волна стояла, пока окно не откроешь и не нажмёшь «назад»/«вперёд» или не обновишь страницу.
window.transit = false;      // трек переключается (setTransit)
let transitT = 0;
function setTransit(on) {
  clearTimeout(transitT);
  transit = on;
  if (on) transitT = setTimeout(() => { transit = false; syncIcons(); }, 180000);     // страховка: не держим страницу бодрой вечно
  if (audio) syncIcons();
}
function syncIcons() {
  const playing = !audio.paused;
  const active = playing || transit;
  document.body.classList.toggle("is-playing", playing);
  $("#play").innerHTML = playing ? ICON.pause : ICON.play;
  $("#fPlay").innerHTML = playing ? ICON.pause : ICON.play;
  // у гостя комнаты кнопка волны управляет треком комнаты
  const ri = window.roomInfo?.(), waveOwn = wave.on || (!!ri && !ri.host && ri.follow);
  $("#waveBtn").innerHTML = waveOwn && playing ? ICON.pause : ICON.play;
  $("#waveBtn").classList.toggle("playing", waveOwn && playing);
  waveOrbitsSync();
  if (active !== trayPlaying) { trayPlaying = active; Promise.resolve(invoke("tray_playing", { playing: active })).catch(() => {}); }   // в трей — только при смене
  thumbSync();
  wReport({ playing });                   // Discord, мини-плеер, OBS, «Слушать вместе» узнают об этом от ядра (Whisper.player.watch)
}
// Кнопки под миниатюрой окна на панели задач Windows (thumbbar.rs): «В лайки», «Назад», «Пауза/Играть», «Вперёд».
// В Rust отправляется только изменившееся состояние.
var thumbKey = "";       // var: syncIcons может сработать раньше этой строки
function thumbSync() {
  const t = queue[current];
  const st = { has: !!t, playing: !!audio && !audio.paused, liked: !!t && isLiked(String(t.id)) };
  const k = JSON.stringify(st);
  if (k === thumbKey) return;
  thumbKey = k;
  Promise.resolve(invoke("thumbbar_state", st)).catch(() => {});
}
// окно ушло в трей: Rust переводит движок окна в режим экономии; здесь отпускаем то, что легко загрузить заново
window.__TAURI__.event?.listen("power-save", () => {
  bgUnload();
  lyricsForget(); artistCache.clear();
  if (audio?.paused && curBlob && !audioViz) { URL.revokeObjectURL(curBlob); curBlob = null; }
});
window.__TAURI__.event?.listen("tray-ctl", (e) => {
  if (e.payload === "prev") $("#prev").click();
  else if (e.payload === "next") $("#next").click();
  else if (e.payload === "toggle") togglePlay();
  else if (e.payload === "shuffle") { if (!$("#shuffleBtn").disabled) $("#shuffleBtn").click(); }      // из мини-плеера
  else if (e.payload === "repeat") $("#repeatBtn").click();
  // глобальные горячие клавиши (hotkeys.js / hotkeys.rs)
  else if (e.payload === "vol_up") setVol(volume + 0.05);
  else if (e.payload === "vol_down") setVol(volume - 0.05);
  else if (e.payload === "mute") $("#volBtn").click();
  else if (e.payload === "seek_fwd" || e.payload === "seek_back") {
    if (audio && !needLoad && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, audio.currentTime + (e.payload === "seek_fwd" ? 10 : -10)));
  } else if (e.payload === "like") { if (queue[current]) toggleLike(queue[current]); }
});

function navigate(fn) { if (view) hist.push(view); view = fn; fn(); }
function goTop(fn) { hist.length = 0; view = fn; fn(); }
$("#likes").onclick = () => { likesQuery = ""; goTop(showLikes); };
$("#wave").onclick = () => goTop(showWave);
$("#settingsBtn").onclick = () => goTop(showSettings);
$("#statsBtn").onclick = () => goTop(showStats);
$("#back").onclick = () => { const p = hist.pop(); if (p) { view = p; p(); } else goTop(showLikes); };

// «Лайки», поиск по ним, снимок и офлайн-вид — pages/likes.js
// страница «Статистика» и помощники форматов — pages/stats.js

// «Моя волна» и станции — pages/wave.js

function showSettings() {
  ++nav;
  setHead({ title: "Настройки" }); setActive("settingsBtn"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#settingsPage").hidden = false;
  fillAll();
  loadDlDir();
}

// страницы автора и альбома — pages/artist.js

// поиск — pages/search.js

export { setHead, setChips, resetView, setActive, roman, renderTabs, setTransit, syncIcons, thumbSync, navigate, goTop, showSettings };

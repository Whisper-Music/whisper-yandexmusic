// «Моя волна»: страница с кнопкой волны и «Сейчас играет», запуск и подгрузка волны, отзывы Яндексу (лайк, пропуск,
// дослушал), станции — жанры, настроения, закреплённые, волна по артисту. Конец очереди (onQueueEnd) — тоже здесь.
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё и вешает обработчики (свой $);
// wave, queue, ym, play… из main.js — по имени внутри функций. Наружу — через window в конце (main.js, sleep.js, cli.js).
import { wReport, ym } from "../app/base.js";
import { albumOf, fillArtists } from "../app/list.js";
import { showToast } from "../app/menu.js";
import { navigate, renderTabs, resetView, setActive, setHead, setTransit, syncIcons } from "../app/nav.js";
import { showAlbum } from "./artist.js";
import { artistBanned } from "./artistprefs.js";
import { applyViz, offlineFallback, play, showTrack, togglePlay } from "../player/core.js";
import { closeFull } from "../player/full.js";
const $ = (s) => document.querySelector(s);

// как lsJSON из main.js — того при загрузке модуля ещё нет
const lsList = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; } };

function setHint(text) { $("#waveHint").textContent = text; $("#waveHint").hidden = false; $("#nowplay").hidden = true; }
function showNow(t) {
  $("#npTitle").textContent = t.title;
  $("#npTitle").classList.toggle("link", !!albumOf(t));
  fillArtists($("#npArtist"), t);
  $("#nowplay").hidden = false; $("#waveHint").hidden = true;
}
$("#npTitle").onclick = () => { const id = albumOf(queue[current]); if (id) navigate(() => showAlbum(id)); };

function fitHead() {
  if (!document.querySelector(".main").classList.contains("wavemode")) return;
  const r = document.createRange();
  r.selectNodeContents($("#title"));
  const w = Math.ceil(r.getBoundingClientRect().width);
  document.documentElement.style.setProperty("--hw", Math.max(w, 176) + "px");
  fitStations();
}
window.addEventListener("resize", fitHead);
if (document.fonts) document.fonts.ready.then(fitHead);

// «Слушать вместе» (together.js): гость в комнате — страница волны показывает трек комнаты, а не свою волну
function inRoomNow() { return !!window.roomInfo?.(); }
function roomGuest() { const r = window.roomInfo?.(); return !!r && !r.host; }
function waveHead() {
  $("#title").textContent = roomGuest() ? "Слушать вместе" : "Моя волна";
  if ((wave.on || inRoomNow()) && queue[current]) showNow(queue[current]);
  else if (roomGuest()) setHint("Ожидается трек от ведущего…");
  else if (offline) setHint("Офлайн-режим — нажми, чтобы слушать скачанное");
  else setHint("Нажми, чтобы включить " + (wave.album ? `Мою волну по «${wave.album.title}»` : wave.name ? `волну «${wave.name}»` : "Мою волну"));
  updateStBtn();
}
// together.js зовёт при входе/выходе из комнаты и при «отошёл/вернулся к ведущему»
window.waveRefresh = () => {
  updateStBtn(); if (audio) syncIcons();
  if ($("#wavePage").hidden) return;
  if (roomGuest()) setStations(false);
  waveHead(); fitHead();
};
function showWave() {
  ++nav;
  setHead({ title: "Моя волна" }); setActive("wave"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#wavePage").hidden = false; $("#stWrap").hidden = false; $("#waveInfo").hidden = false;
  document.querySelector(".main").classList.add("wavemode");
  waveHead();
  syncIcons();
  applyViz();
  fitHead();
  requestAnimationFrame(fitHead);
}
function waveFeedback(type, t, extra = {}) {
  if (!wave.on || !wave.session || !t || t._room) return;      // трек из комнаты, вставленный в волну, — не волны
  ym("rotor_feedback", {
    id: wave.session,
    json: { event: { type, timestamp: new Date().toISOString(), trackId: String(t.id), ...extra }, batchId: wave.batch },
  }).catch(() => {});
}
function markHeard(t) {
  heard.add(String(t.id));
  if (heard.size > 600) heard.delete(heard.values().next().value);
  try { localStorage.setItem("ym_heard", JSON.stringify([...heard])); } catch {}
}
const trackList = (r) => (r.sequence || []).map((s) => s.track).filter(Boolean);

// Дозагрузка «Моей волны». Через несколько часов rotor-сессия Яндекса протухает (или сеть мигает) — раньше ошибка
// глотала молча, очередь не пополнялась и после последнего трека воспроизведение просто останавливалось.
// Теперь: продолжаем сессию → при ошибке/пустом ответе заводим новую сессию по тому же seed (до 3 попыток).
let waveMoreP = null;
function waveMore() {
  if (!wave.on) return Promise.resolve(false);
  return waveMoreP ||= waveMoreRun().finally(() => { waveMoreP = null; });
}
async function waveMoreRun() {
  wave.loading = true;
  const q = wave.queue;
  let added = 0;
  try {
    const have = new Set(q.map((t) => String(t.id)));
    for (let k = 0; k < 3 && !added; k++) {
      if (k) await new Promise((r) => setTimeout(r, 1500 * k));
      if (wave.queue !== q || !wave.on) return false;
      try {
        let r;
        if (wave.session && k === 0) {
          r = await ym("rotor_tracks", { id: wave.session, json: { queue: [String(q[q.length - 1].id)] } });
        } else {
          r = await ym("rotor_new", { json: { seeds: [wave.seed], includeTracksInResponse: true } });
          wave.session = r.radioSessionId;
        }
        wave.batch = r.batchId;
        const incoming = trackList(r).filter((t) => !have.has(String(t.id)) && !dislikedIds.has(String(t.id)) && !artistBanned(t));
        const fresh = incoming.filter((t) => !heard.has(String(t.id)));
        const add = fresh.length ? fresh : incoming;
        if (wave.queue !== q) return false;
        for (const t of add) have.add(String(t.id));
        q.push(...add);
        added = add.length;
      } catch {}
      if (!added) wave.session = null;        // сессия не отдала новых треков — в следующей попытке начнём новую
    }
  } finally { wave.loading = false; }
  if (added) wReport({ queue: true });
  return added > 0;
}

async function waveStart(autoplay = true) {
  const r = await ym("rotor_new", { json: { seeds: [wave.seed], includeTracksInResponse: true } });
  const session = r.radioSessionId;
  const okT = (t) => !dislikedIds.has(String(t.id)) && !artistBanned(t);       // и без авторов из «Не рекомендуются»
  let batch = r.batchId, tracks = trackList(r).filter(okT);
  // продолжаем от последнего присланного трека, а не от последнего подходящего: пачка могла целиком отсеяться
  let lastId = trackList(r).at(-1)?.id;
  let fresh = tracks.filter((t) => !heard.has(String(t.id)));
  for (let k = 0; k < 3 && fresh.length < 3 && lastId != null; k++) {
    const more = await ym("rotor_tracks", { id: session, json: { queue: [String(lastId)] } });
    batch = more.batchId;
    lastId = trackList(more).at(-1)?.id ?? lastId;
    const have = new Set(tracks.map((t) => String(t.id)));
    tracks = tracks.concat(trackList(more).filter((t) => okT(t) && !have.has(String(t.id))));
    fresh = tracks.filter((t) => !heard.has(String(t.id)));
  }
  if (!fresh.length) fresh = tracks;
  if (!fresh.length) throw new Error("волна не вернула треков");
  if (!autoplay && current !== -1) return;
  Object.assign(wave, { on: true, session, batch, queue: fresh, pos: -1 });
  playCtx = "wave";
  queue = fresh;
  if (autoplay) play(0);
  else { current = 0; needLoad = true; showTrack(fresh[0]); }
}

$("#waveBtn").onclick = async () => {
  if (roomGuest()) { window.roomCli?.waveBtn?.(); return; }     // гость: пауза/играть трек комнаты или «вернуться к ведущему»
  if (wave.on) { togglePlay(); return; }
  if (offline) {
    // волна без сети не загрузится: играет / ставится на паузу скачанное
    if (queue === offQueue && queue[current]) { togglePlay(); return; }
    if (!(await offlineFallback(queue.length, playSeq))) setHint("Офлайн-режим — скачанных треков пока нет");
    return;
  }
  try {
    if (wave.session && wave.queue.length) {
      wave.on = true; queue = wave.queue; playCtx = "wave";
      const next = wave.pos + 1;
      if (next >= queue.length) await waveMore();
      if (next < queue.length) { play(next); return; }
      wave.on = false;
    }
    await waveStart();
  } catch (e) { wave.on = false; setHint("Не удалось запустить: " + e.message); }
};

const GROUPS = [["genre", "Жанры"], ["subgenre", "Поджанры"], ["mood", "Настроение"], ["character", "Характер"], ["language", "Язык"]];
const stations = { loaded: false, groups: {}, tab: "genre" };
const GENRE_SKIP = new Set(["all", "other", "holiday", "fairytales", "poemsforchildren", "podcasts", "audiobooks", "fiction",
  "nonfictionliterature", "booksnotinrussian", "arabicpoetry", "islamicgenre"]);
const WAVE_SETTINGS = [["moodEnergy", "mood"], ["diversity", "character"], ["language", "language"]];

async function loadStations(force = false) {
  if (stations.loaded && !force) return;
  const [gr, ws] = await Promise.allSettled([ym("genres"), ym("wave_settings", { query: { language: "ru" } })]);
  const groups = {}; let seen = 0;
  const add = (type, seed, name) => { if (!name) return; (groups[type] ||= []).push({ seed, name: String(name) }); seen++; };
  const title = (g) => g?.titles?.ru?.title || g?.title;
  for (const g of gr.status === "fulfilled" && Array.isArray(gr.value) ? gr.value : []) {
    if (!g?.id || GENRE_SKIP.has(g.id) || g.showInMenu === false) continue;
    add("genre", `genre:${g.id}`, title(g));
    for (const s of Array.isArray(g.subGenres) ? g.subGenres : []) {
      if (s?.id && !GENRE_SKIP.has(s.id) && s.showInMenu !== false) add("subgenre", `genre:${s.id}`, title(s));
    }
  }
  const rest = ws.status === "fulfilled" ? ws.value?.settingRestrictions || {} : {};
  for (const [key, type] of WAVE_SETTINGS) {
    for (const v of rest[key]?.possibleValues || []) {
      if (!v?.unspecified && v?.serializedSeed) add(type, String(v.serializedSeed), v.name);
    }
  }
  if (!seen) throw (gr.reason || ws.reason || new Error("сервер вернул пустой список"));
  stations.groups = groups; stations.loaded = true;
  if (!groups[stations.tab]) stations.tab = GROUPS.map((g) => g[0]).find((t) => groups[t]) || Object.keys(groups)[0];
}
function stationsMessage(text, retry) {
  $("#stChips").innerHTML = "";
  const g = $("#stGrid"); g.innerHTML = "";
  const p = document.createElement("p"); p.className = "stmsg"; p.textContent = text; g.append(p);
  if (retry) { const b = document.createElement("button"); b.className = "pill"; b.textContent = "Повторить"; b.onclick = retry; g.append(b); }
}
async function openStationsList() {
  stationsMessage("Список загружается…");
  try { await loadStations(true); renderStations(); }
  catch (e) { stationsMessage("Не удалось загрузить список: " + e.message, openStationsList); }
  fitStations();
}
function renderStations() {
  const chips = $("#stChips"); chips.innerHTML = "";
  const mk = (label, active, fn) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : ""); b.textContent = label; b.onclick = fn; return b;
  };
  const known = new Set(GROUPS.map((g) => g[0]));
  const all = [...GROUPS, ...Object.keys(stations.groups).filter((t) => !known.has(t)).map((t) => [t, t])];
  for (const [type, label] of all) {
    if (stations.groups[type]) chips.append(mk(label, stations.tab === type, () => { stations.tab = type; renderStations(); }));
  }
  const grid = $("#stGrid"); grid.innerHTML = "";
  if (wave.seed !== DEFAULT_SEED) {
    const r = document.createElement("button");
    r.className = "pill reset"; r.textContent = "Обычная Моя волна"; r.onclick = () => pickStation(DEFAULT_SEED, "");
    grid.append(r);
  }
  // Закреплённые жанры и настроения — первой строкой на любой вкладке. Звёздочка появляется у пункта при
  // наведении (у закреплённого видна всегда): щелчок по ней закрепляет или открепляет, волну не переключает.
  const pill = (s, pinned) => {
    const b = document.createElement("button");
    b.className = "pill" + (s.seed === wave.seed ? " active" : "") + (pinned ? " pinned" : "");
    b.textContent = s.name; b.onclick = () => pickStation(s.seed, s.name);
    const on = stPinned(s.seed);
    const st = document.createElement("i");
    st.className = "ststar" + (on ? " on" : ""); st.textContent = on ? "★" : "☆";
    st.title = on ? "Открепить" : "Закрепить вверху списка";
    st.setAttribute("role", "button");
    st.onclick = (e) => { e.stopPropagation(); stPinToggle(s); renderStations(); fitStations(); };
    b.append(st);
    return b;
  };
  if (stPins.length) {
    for (const s of stPins) grid.append(pill(s, true));
    const br = document.createElement("i"); br.className = "stbreak"; grid.append(br);
  }
  for (const s of stations.groups[stations.tab] || []) grid.append(pill(s, false));
}
// закреплённые станции волны: [{ seed, name }], localStorage ym_wave_pins (свои у каждого аккаунта)
const stPins = lsList("ym_wave_pins")
  .filter((x) => x && typeof x.seed === "string" && /^[\w-]+:[\w.-]+$/.test(x.seed) && typeof x.name === "string" && x.name)
  .map((x) => ({ seed: x.seed, name: x.name.slice(0, 100) })).slice(0, 24);
const stPinned = (seed) => stPins.some((x) => x.seed === seed);
function stPinToggle(s) {
  const i = stPins.findIndex((x) => x.seed === s.seed);
  if (i >= 0) stPins.splice(i, 1);
  else if (stPins.length >= 24) return showToast("Закрепить можно не больше 24 — открепи что-нибудь", 4000);
  else stPins.push({ seed: s.seed, name: s.name });
  try { localStorage.setItem("ym_wave_pins", JSON.stringify(stPins)); } catch {}
}
function updateStBtn() {
  const r = window.roomInfo?.();
  $("#stWrap").classList.toggle("room", !!r && !r.host);
  $("#stWrap").classList.toggle("away", !!r && !r.host && !r.follow);
  if (r && !r.host) {
    // гость: вместо жанров — комната (жанр включил бы свою волну и увёл от ведущего)
    const lbl = document.createElement("span"); lbl.className = "lbl";
    lbl.textContent = r.follow ? `Комната ${r.code} · ты гость` : "⟲ Вернуться в комнату";
    $("#stBtn").replaceChildren(lbl);
    $("#stBtn").title = r.follow ? "Открыть окно «Слушать вместе»" : "";
    $("#stBtn").classList.remove("album");
    $("#stWrap").classList.remove("album", "has-reset");
    $("#stReset").hidden = true;
    return;
  }
  const open = !$("#stations").hidden;
  const label = wave.album ? `Моя волна по «${wave.album.title || "альбому"}»` : wave.name ? `${wave.name} · сменить` : "Жанры и настроения";
  const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = open ? "Закрыть список" : label;
  $("#stBtn").replaceChildren(lbl);
  $("#stBtn").title = open ? "" : label;
  $("#stBtn").classList.toggle("album", !!wave.album && !open);
  $("#stWrap").classList.toggle("album", !!wave.album);
  const custom = !!(wave.name || wave.album);
  $("#stReset").hidden = !custom;
  $("#stWrap").classList.toggle("has-reset", custom);
}
function setStations(open) { $("#stations").hidden = !open; updateStBtn(); if (open) fitStations(); }
function fitStations() {
  const box = $("#stations");
  if (box.hidden) return;
  const bottom = document.querySelector(".main").getBoundingClientRect().bottom;
  const room = bottom - box.getBoundingClientRect().top - 8;
  box.style.maxHeight = Math.max(240, Math.min(room, window.innerHeight * 0.5)) + "px";
}
window.addEventListener("resize", fitStations);

async function pickStation(seed, name) {
  Object.assign(wave, { seed, name, album: null, session: null, queue: [], pos: -1, on: false });
  try { localStorage.setItem("ym_wave_seed", JSON.stringify({ seed, name })); } catch {}
  setStations(false);
  try { await waveStart(); } catch (e) { wave.on = false; setHint("Не удалось запустить: " + e.message); }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { setStations(false); closeFull(); } });
document.addEventListener("click", (e) => {
  const path = e.composedPath();
  if (!$("#stations").hidden && !path.includes($("#stations")) && !path.includes($("#stBtn"))) setStations(false);
});
$("#artistWaveBtn").onclick = () => {
  const it = artistWaveItem; if (!it) return;
  showWave();
  pickStation("artist:" + it.id, it.name);
};
$("#stReset").onclick = () => pickStation(DEFAULT_SEED, "");

// Очередь кончилась. Альбом → «Моя волна по альбому»; трек из поиска → «Моя волна по треку»; любая другая очередь
// (лайки, плейлист, трек комнаты) → обычная Моя волна. Гость в комнате ничего не включает: следующий трек пришлёт ведущий.
async function onQueueEnd() {
  if (wave.on || roomGuest()) { setTransit(false); return; }
  const byTrack = playCtx === "search" && playAlbum?.track && playAlbum.id;
  if (!byTrack && (playCtx !== "album" || !playAlbum?.id)) {
    playAlbum = null;
    try { await waveStart(); } catch { wave.on = false; setTransit(false); }
    updateStBtn();
    return;
  }
  const al = playAlbum; playAlbum = null;
  const prev = { seed: wave.seed, name: wave.name, album: wave.album };
  // wave.album — только подпись «Моя волна по «…»» (кнопка, подсказка, Discord); для трека в нём track: true
  Object.assign(wave, { seed: (byTrack ? "track:" : "album:") + al.id, name: "",
    album: { id: al.id, title: al.title || "", ...(byTrack ? { track: true } : {}) }, session: null, queue: [], pos: -1, on: false });
  updateStBtn();
  try { await waveStart(); }
  catch { Object.assign(wave, prev, { on: false }); setTransit(false); }
  updateStBtn();
}
$("#stBtn").onclick = async () => {
  if (roomGuest()) { window.roomCli?.stBtn?.(); return; }
  const open = $("#stations").hidden;
  setStations(open);
  if (!open) return;
  if (stations.loaded) { renderStations(); fitStations(); } else await openStationsList();
};

export { setHint, showNow, fitHead, inRoomNow, roomGuest, waveHead, showWave, waveFeedback, markHeard, waveMore, waveStart, GROUPS,
  stations, loadStations, updateStBtn, setStations, pickStation, onQueueEnd };

// Поиск: окно под полем поиска — история и «Открывал», лучший результат и списки по типам (трек, артист, альбом).
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё и вешает обработчики (свой $);
// ym, renderList, navigate, queue… из main.js — по имени внутри функций (модуль видит глобальную область обычных
// скриптов). Снаружи ничего не зовут: поиск открывается щелчком и вводом в #search.
import { DynCss, ICON, isNetErr, mkImg, safeUrl, ym } from "../app/base.js";
import { albumInfo, albumOf, cover, fillArtists, renderAlbums, renderArtists, renderList } from "../app/list.js";
import { goTop, navigate, renderTabs, resetView, setActive, setChips, setHead } from "../app/nav.js";
import { suspectOffline } from "../app/offline.js";
import { openTrackMenu } from "../app/trackmenu.js";
import { syncGotRow } from "../library/downloads.js";
import { showAlbum, showArtist } from "./artist.js";
import { normQ, offlineNote, offlinePick, trackHay } from "./likes.js";
import { playAlbumById } from "./stats.js";
import { pickStation, showWave } from "./wave.js";
import { play } from "../player/core.js";
import { isLiked, setHeart, toggleLike } from "../player/like.js";
const $ = (s) => document.querySelector(s);
// как lsJSON из main.js — того при загрузке модуля ещё нет
const lsList = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; } };

// Окно поиска открывается сразу по клику в поле. Пустой запрос — вкладка «История»;
// при вводе — сверху «Лучший результат» (поле best из ответа /search?type=all), ниже список по выбранному фильтру.
const SEARCH_HIST_KEY = "ym_search_hist", SEARCH_HIST_MAX = 30;
const searchHist = lsList(SEARCH_HIST_KEY)
  .filter((x) => typeof x === "string" && x.trim())
  .map((x) => x.trim().slice(0, 200))
  .slice(0, SEARCH_HIST_MAX);
let searchQ = "", searchTab = "history";
const searchInput = $("#search");
const SEARCH_KEYS = { track: "tracks", artist: "artists", album: "albums" };
const BEST_LABEL = { track: "Трек", artist: "Артист", album: "Альбом" };
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function saveSearchHist() { try { localStorage.setItem(SEARCH_HIST_KEY, JSON.stringify(searchHist)); } catch {} }
function pushSearchHist(q) {
  q = String(q || "").trim().slice(0, 200);
  if (!q) return;
  const i = searchHist.findIndex((x) => x.toLowerCase() === q.toLowerCase());
  if (i >= 0) searchHist.splice(i, 1);
  searchHist.unshift(q);
  if (searchHist.length > SEARCH_HIST_MAX) searchHist.length = SEARCH_HIST_MAX;
  saveSearchHist();
}
const searchOpen = () => document.querySelector(".main").dataset.page === "search";

// «Открывал из поиска»: треки, альбомы и артисты, по которым кликнули в результатах, — карточками с обложкой
// над историей запросов. Хранится коротко: id, название, подпись, ссылка на обложку; у трека — сам трек без лишних полей
// (по нему его и включаем). Строку результата с её сущностью связывает searchPickOf (заполняет showSearch / renderBest).
const SEARCH_PICKS_KEY = "ym_search_picks", SEARCH_PICKS_MAX = 20;
const PICK_TYPES = ["track", "album", "artist"];
const searchPicks = lsList(SEARCH_PICKS_KEY)
  .filter((p) => p && PICK_TYPES.includes(p.type) && p.id != null && typeof p.title === "string")
  .slice(0, SEARCH_PICKS_MAX);
const searchPickOf = new WeakMap();          // li результата → { type, x }
function saveSearchPicks() { try { localStorage.setItem(SEARCH_PICKS_KEY, JSON.stringify(searchPicks)); } catch {} }
// трек — только то, что нужно, чтобы показать и включить его (как в ym_last)
const slimTrack = (t) => ({
  id: t.id, title: t.title, version: t.version, durationMs: t.durationMs, available: t.available, coverUri: t.coverUri,
  artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })),
  albums: (t.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title, coverUri: a.coverUri })),
});
function pushSearchPick(type, x) {
  if (!PICK_TYPES.includes(type) || x?.id == null) return;
  const artists = (x.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const artUri = type === "artist" ? x.cover?.uri || x.ogImage : null;
  const p = {
    type, id: String(x.id),
    title: String((type === "artist" ? x.name : x.title) || "").slice(0, 200),
    sub: type === "artist" ? "" : artists.slice(0, 200),
    img: (type === "artist" ? (artUri ? cover({ coverUri: artUri }, "200x200") : "") : cover(x, "200x200")) || "",
    at: Date.now(),
  };
  if (!p.title) return;
  if (type === "track") p.track = slimTrack(x);
  const i = searchPicks.findIndex((q) => q.type === type && String(q.id) === p.id);
  if (i >= 0) searchPicks.splice(i, 1);
  searchPicks.unshift(p);
  if (searchPicks.length > SEARCH_PICKS_MAX) searchPicks.length = SEARCH_PICKS_MAX;
  saveSearchPicks();
}
function openSearchPick(p) {
  if (p.type === "album") return navigate(() => showAlbum(p.id));
  if (p.type === "artist") return navigate(() => showArtist(p.id));
  if (!p.track) return;
  playSearchTrack(p.track);
}
// Трек из поиска играет один, а когда закончится — «Моя волна по треку» (onQueueEnd в wave.js, seed track:<id>).
// playAlbum здесь — подпись для кнопки волны ({ id, title, track: true }), ctx "search" переживает перезапуск (ym_last).
function playSearchTrack(x) {
  wave.on = false; queue = [x]; playCtx = "search";
  playAlbum = { id: String(x.id), title: x.title || "", track: true };
  play(0);
}

function searchChips(active) {
  setChips([["track", "Треки"], ["artist", "Артисты"], ["album", "Альбомы"], ["history", "История"]], active, (t) => {
    if (t === "history") return goTop(() => showSearch(searchQ, true));
    searchType = t;
    if (!searchQ) { searchInput.focus(); return; }      // без запроса фильтру нечего показывать — просто ставим курсор в поле
    goTop(() => showSearch(searchQ));
  });
}

// офлайн: поиск по скачанным трекам (название, версия, исполнители, альбом)
async function searchOffline(q, my) {
  const words = normQ(q).split(" ").filter(Boolean);
  const found = await offlinePick((t) => { const h = trackHay(t); return words.every((w) => h.includes(w)); });
  if (my !== nav) return;
  $("#chips").hidden = true;
  if (found.length) renderList(found);
  offlineNote(found.length ? `Офлайн-режим — найдено среди скачанных: ${found.length}` : "Офлайн-режим — среди скачанных ничего не найдено");
}
async function showSearch(q, historyTab = false) {
  const my = ++nav;
  searchQ = q;
  const tab = (searchTab = historyTab || !q ? "history" : searchType);
  setHead({ title: tab === "history" ? "Поиск" : "Поиск: " + q });
  setActive("search"); renderTabs(false); resetView();
  searchChips(tab);
  if (tab === "history") { renderSearchHist(); return; }
  if (offline) return searchOffline(q, my);

  $("#status").textContent = "Идёт поиск…";
  const type = searchType, key = SEARCH_KEYS[type];
  // type=all возвращает best — лучшее совпадение, которое Яндекс ставит первым; второй запрос — полный список по фильтру
  const [allR, listR] = await Promise.allSettled([
    ym("search", { query: { text: q, type: "all", page: 0 } }),
    ym("search", { query: { text: q, type, page: 0 } }),
  ]);
  if (my !== nav) return;
  const all = allR.status === "fulfilled" ? allR.value : null;
  const list = listR.status === "fulfilled" ? listR.value : null;
  if (!all && !list) {
    if (isNetErr(listR.reason) && (await suspectOffline())) { if (my === nav) searchOffline(q, my); return; }
    $("#status").textContent = "Ошибка: " + (listR.reason?.message || allR.reason?.message || "нет ответа");
    return;
  }

  let items = (list || all)?.[key]?.results || [];
  const best = all?.best;
  const bestOk = !!(best && BEST_LABEL[best.type] && best.result && best.result.id != null);
  if (bestOk && best.type === type) items = items.filter((x) => String(x.id) !== String(best.result.id));   // не дублируем его в списке

  if (type === "track") renderList(items, false, { play: playSearchTrack });
  else if (type === "artist") renderArtists(items);
  else renderAlbums(items, true);
  // строки результатов — по порядку те же items (у треков — по data-id): клик по строке попадёт в «Открывал»
  [...$("#list").children].forEach((li, k) => {
    const x = type === "track" ? items.find((t) => String(t.id) === li.dataset.id) : items[k];
    if (x) searchPickOf.set(li, { type, x });
  });
  if (bestOk) renderBest(best.type, best.result);
  $("#status").textContent = items.length || bestOk ? "" : "Ничего не найдено";
}

// карточка «Лучший результат» — первая строка списка, поэтому resetView убирает её вместе со списком
function renderBest(type, x) {
  const li = document.createElement("li");
  li.className = "best";
  searchPickOf.set(li, { type, x });
  const artUri = x.cover?.uri || x.ogImage;
  const imgUrl = type === "artist" ? (artUri ? cover({ coverUri: artUri }, "200x200") : "") : cover(x, "200x200");
  li.append(mkImg(imgUrl, type === "artist" ? "rnd" : ""));

  const body = document.createElement("div");
  body.className = "bbody";
  body.innerHTML = '<small class="blabel"></small><span class="t"></span><span class="a"></span>';
  body.querySelector(".blabel").textContent = "Лучший результат · " + BEST_LABEL[type];
  const tt = body.querySelector(".t"), sub = body.querySelector(".a");
  tt.textContent = type === "artist" ? x.name : x.title;
  li.append(body);

  const pb = document.createElement("button");
  pb.className = "bplay";
  pb.innerHTML = ICON.play;

  if (type === "track") {
    li.dataset.id = x.id;                                   // подсветка «играет» и сердечко обновляются вместе со списком
    if (String(x.id) === String(playingId)) li.classList.add("playing");
    fillArtists(sub, x);
    const albumId = albumOf(x);
    if (albumId) {
      tt.classList.add("link");
      tt.onclick = (e) => { e.stopPropagation(); navigate(() => showAlbum(albumId)); };
    }
    const start = () => playSearchTrack(x);
    li.onclick = start;
    pb.title = "Слушать";
    pb.onclick = (e) => { e.stopPropagation(); start(); };
    const hb = document.createElement("button");
    hb.className = "likebtn";
    setHeart(hb, isLiked(String(x.id)));
    hb.onclick = (e) => { e.stopPropagation(); toggleLike(x); };
    const mb = document.createElement("button");
    mb.className = "morebtn"; mb.title = "Ещё"; mb.innerHTML = ICON.more;
    mb.onclick = (e) => { e.stopPropagation(); openTrackMenu(x, mb, null); };
    li.append(pb, hb, mb);
    syncGotRow(li);
  } else if (type === "album") {
    fillArtists(sub, x);
    const info = albumInfo(x);
    if (info) sub.append(" · " + info);
    li.onclick = () => navigate(() => showAlbum(x.id));
    pb.title = "Слушать альбом";
    pb.onclick = (e) => { e.stopPropagation(); playAlbumById(x); };
    li.append(pb);
  } else {
    sub.textContent = "Артист";
    li.onclick = () => navigate(() => showArtist(x.id));
    pb.title = "Моя волна по артисту";
    pb.onclick = (e) => { e.stopPropagation(); goTop(showWave); pickStation("artist:" + x.id, x.name); };
    li.append(pb);
  }
  $("#list").prepend(li);
}

// «Открывал»: горизонтальная лента карточек (обложка, название, подпись) — над списком запросов
const PICK_LABEL = { track: "Трек", album: "Альбом", artist: "Артист" };
// Полоса прокрутки ленты «Открывал» — как у окна (.main): стили и свои темы оформляют только .main::-webkit-scrollbar-*,
// а своя у ленты была системной. Правила .main копируются на ленту (`.main .spicks::…`) — так подхватывается любая тема.
// Ширина вертикальной полосы становится высотой горизонтальной. Пересобирается при смене стиля или набора CSS.
let spicksKey = "";
function spicksScrollbar() {
  const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
  const key = (cfg?.style || "") + "|" + sheets.length;
  if (key === spicksKey) return;
  spicksKey = key;
  const out = [];
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }         // @media / @supports
      const sel = r.selectorText;
      if (!sel || !sel.includes(".main::-webkit-scrollbar")) continue;
      const parts = sel.split(",").filter((s) => s.includes(".main::-webkit-scrollbar")).map((s) => s.replace(/\.main::/g, ".main .spicks::"));
      let body = r.style.cssText;
      if (parts.some((s) => /\.spicks::-webkit-scrollbar\s*$/.test(s)) && r.style.width && !r.style.height) body += `height: ${r.style.width};`;
      out.push(`${parts.join(", ")} { ${body} }`);
    }
  };
  for (const s of sheets) { try { walk(s.cssRules); } catch {} }       // чужой лист без доступа к правилам — пропускаем
  DynCss.set("spicksScroll", out.join("\n"));
}

function searchPicksRow() {
  spicksScrollbar();
  const li = document.createElement("li");
  li.className = "histpicks";
  const head = document.createElement("small");
  head.className = "histhead"; head.textContent = "Открывал";
  const row = document.createElement("div");
  row.className = "spicks";
  for (const p of searchPicks) {
    const c = document.createElement("div");
    c.className = "spick" + (p.type === "artist" ? " artist" : "");
    c.tabIndex = 0; c.setAttribute("role", "button");
    c.title = [p.title, p.sub].filter(Boolean).join(" — ");
    const img = mkImg(safeUrl(p.img), p.type === "artist" ? "rnd" : "");
    const t = document.createElement("span"); t.className = "spt"; t.textContent = p.title;
    const s = document.createElement("span"); s.className = "sps";
    s.textContent = p.type === "track" ? p.sub || PICK_LABEL.track : p.type === "album" ? [PICK_LABEL.album, p.sub].filter(Boolean).join(" · ") : PICK_LABEL.artist;
    const x = document.createElement("button");
    x.className = "spx"; x.type = "button"; x.title = "Убрать"; x.textContent = "✕";
    x.onclick = (e) => {
      e.stopPropagation();
      const i = searchPicks.indexOf(p);
      if (i >= 0) searchPicks.splice(i, 1);
      saveSearchPicks(); renderSearchHist();
    };
    c.append(img, t, s, x);
    // открыл ещё раз — карточка встаёт первой (такой, какая есть: с той же обложкой и подписью)
    c.onclick = () => {
      const i = searchPicks.indexOf(p);
      if (i > 0) { searchPicks.splice(i, 1); searchPicks.unshift(p); p.at = Date.now(); saveSearchPicks(); }
      openSearchPick(p);
    };
    c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.onclick(); } };
    row.append(c);
  }
  // колёсико листает ленту вбок (вниз-вверх оно иначе пролистало бы всю страницу)
  row.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
    e.preventDefault(); row.scrollLeft += e.deltaY;
  }, { passive: false });
  li.append(head, row);
  return li;
}
function renderSearchHist() {
  const list = $("#list");
  list.innerHTML = "";
  if (!searchHist.length && !searchPicks.length) {
    $("#status").textContent = "История пуста. Сюда попадают запросы, подтверждённые Enter, и то, что ты включил или открыл из результатов.";
    return;
  }
  $("#status").textContent = "";
  if (searchPicks.length) list.append(searchPicksRow());
  if (searchHist.length) {
    const h = document.createElement("li");
    h.className = "histhead-li";
    h.innerHTML = '<small class="histhead">Искал</small>';
    list.append(h);
  }
  for (const q of searchHist) {
    const li = document.createElement("li");
    li.className = "histitem";
    li.innerHTML = `<span class="hico">${CLOCK_SVG}</span><span class="t"></span><button class="hdel" title="Удалить из истории">✕</button>`;
    li.querySelector(".t").textContent = q;
    li.onclick = () => { searchInput.value = q; pushSearchHist(q); goTop(() => showSearch(q)); };
    li.querySelector(".hdel").onclick = (e) => {
      e.stopPropagation();
      const i = searchHist.indexOf(q);
      if (i >= 0) searchHist.splice(i, 1);
      saveSearchHist(); renderSearchHist();
    };
    list.append(li);
  }
  const clr = document.createElement("li");
  clr.className = "histclear";
  clr.innerHTML = '<button class="nav">Очистить историю</button>';
  clr.querySelector("button").onclick = () => { searchHist.length = 0; searchPicks.length = 0; saveSearchHist(); saveSearchPicks(); renderSearchHist(); };
  list.append(clr);
}

// поле поиска: окно открывается по клику/фокусу, а не после первой буквы
function openSearch() {
  if (searchOpen()) return;
  const q = searchInput.value.trim();
  goTop(() => showSearch(q));
}
searchInput.addEventListener("focus", openSearch);
searchInput.addEventListener("click", openSearch);          // поле уже в фокусе, но открыт другой раздел
searchInput.oninput = () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  searchTimer = setTimeout(() => goTop(() => showSearch(q)), q ? 350 : 0);   // стёрли всё — сразу показываем историю
};
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    pushSearchHist(q);
    if (!(searchOpen() && q && q === searchQ && searchTab !== "history")) goTop(() => showSearch(q));   // те же результаты не перезапрашиваем
  } else if (e.key === "Escape") searchInput.blur();
});
// любое действие с результатом (включить, открыть, лайкнуть) сохраняет запрос в историю
$("#list").addEventListener("click", (e) => {
  if (!(searchOpen() && searchQ && searchTab !== "history")) return;
  const li = e.target.closest("li");
  if (!li || e.target.closest(".histitem, .histclear")) return;
  pushSearchHist(searchQ);
  // включил или открыл — в «Открывал»; лайк, «⋯» и переход по имени артиста в строке трека — не в счёт
  const p = searchPickOf.get(li);
  if (p && !e.target.closest(".likebtn, .morebtn, .art")) pushSearchPick(p.type, p.x);
}, true);

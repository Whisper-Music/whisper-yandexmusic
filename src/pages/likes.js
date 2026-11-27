// «Лайки»: вкладки (треки, авторы, «не рекомендуются», плейлисты), поиск по лайкам, загрузка всех лайков пачками,
// снимок в IndexedDB (likes:v1) для мгновенного открытия, кэш страниц (pagecache.js), офлайн-вид из скачанного.
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё и вешает обработчики (свой $);
// likes, likesTab, ym, renderList… из main.js — по имени внутри функций. Наружу — через window в конце.
import { invoke, isNetErr, lsJSON, ym } from "../app/base.js";
import { cover, renderArtists, renderList } from "../app/list.js";
import { renderTabs, resetView, setActive, setChips, setHead } from "../app/nav.js";
import { setOffline, suspectOffline } from "../app/offline.js";
import { backfillMeta, dlSetup, paintDlAll } from "../library/downloads.js";
import { IDB } from "../look/bg.js";
import { artistCache } from "./artist.js";
import { loadDislikedArtists, loadLikedArtists } from "./artistprefs.js";
import { showMyPlaylists } from "./playlists.js";
const $ = (s) => document.querySelector(s);

async function showLikes(tab = likesTab) {
  const my = ++nav;
  // «Не рекомендуются» — только когда такие авторы есть (или эта вкладка уже открыта: последнего вернули)
  likesTab = ["playlists", "artists", "banned"].includes(tab) ? tab : "likes";
  setHead({ title: "Лайки" }); setActive("likes"); renderTabs("likes"); resetView();
  $("#search").value = "";
  const chips = [["likes", "♥ Лайки"], ["artists", "★ Авторы"], ["playlists", "≡ Мои плейлисты"]];
  if (dislikedArtists.size || likesTab === "banned") chips.push(["banned", "⊘ Не рекомендуются"]);
  setChips(chips, likesTab, (t) => { if (t !== likesTab) { view = () => showLikes(t); view(); } });
  if (likesTab === "playlists") return showMyPlaylists(my);
  if (likesTab === "artists") return showLikedArtists(my);
  if (likesTab === "banned") return showBannedArtists(my);
  lkFindShow();
  if (offline) return showOfflineLikes(my);           // офлайн — только скачанные
  dlSetup({ key: "likes", label: "⤓ Скачать лайки", tracks: () => (likes.done ? likes.tracks : null), all: () => loadAllLikes(() => {}, () => false) });
  const t0 = performance.now();
  if (likes.done) { likesSrc = likes.tracks; renderLikes(); likesPerf = { src: "mem", ms: performance.now() - t0, at: Date.now() }; return; }
  likesSrc = [];
  // снимок с прошлого запуска (IndexedDB) — показываем сразу, свежий список подменит его, когда придёт
  const snap = await likesSnap();
  if (my !== nav) return;
  const drawn = snap?.tracks.length ? snap.tracks : null;
  if (drawn) {
    if (!likeTs.size) for (const t of drawn) if (t._lt) likeTs.set(String(t.id), t._lt);
    likesSrc = drawn; renderLikes(); $("#status").textContent = "";
    likesPerf = { src: "snap", ms: performance.now() - t0, at: Date.now() };
  } else { $("#status").textContent = "Загрузка…"; likesPerf = { src: "net", why: snap ? "empty" : "none", at: Date.now() }; }
  const perf = likesPerf;
  try {
    // Ушёл со страницы, пока грузится, — загрузка всё равно доводится до конца (рисовать перестаёт): иначе при
    // быстром уходе лайки не догружались никогда и снимок для следующего запуска не сохранялся.
    const acc = await fetchLikes((part, n, total) => {
      if (drawn || my !== nav) return;         // на экране снимок — догружаемое не дорисовываем по кускам
      likesSrc = likesSrc.concat(part);
      renderList(likesFilter(part), n > part.length, LK);
      lkFindCount();
      $("#status").textContent = n < total ? `Загружено ${n} из ${total}…` : "";
    }, () => false, snap);
    if (!acc) return;
    Object.assign(perf, likesNet, { full: performance.now() - t0 });
    if (perf.src === "net") perf.ms = perf.full;
    if (!likes.done) { likes.tracks = mergeLikesAdded(acc); likes.done = true; snapSave(); backfillMeta(acc); }
    if (my !== nav) return;
    likesSrc = likes.tracks;
    if (drawn) { if (!sameIds(drawn, likes.tracks)) redrawLikes(); else lkFindCount(true); }
    else if (likes.tracks !== acc || window.studioLikedList?.().length) redrawLikes(); else lkFindCount(true);
  } catch (e) {
    if (my !== nav) return;
    if (drawn && isNetErr(e)) { $("#status").textContent = "Нет связи — показаны лайки с прошлого запуска"; return; }
    if (isNetErr(e)) return showOfflineLikes(my);
    $("#status").textContent = "Ошибка: " + e.message;
  }
}

// «Лайки» → «Авторы»: лайкнутые авторы, свежие сверху. Прошлый список показываем сразу, свежий подменяет его.
async function showLikedArtists(my) {
  if (offline) { $("#status").textContent = "Офлайн-режим — список авторов появится, когда вернётся связь"; return; }
  const had = likedArtistsList;
  if (had) renderArtists(had); else $("#status").textContent = "Загрузка…";
  try {
    const list = await loadLikedArtists(true);
    if (my !== nav) return;
    if (!had || had.length !== list.length || had.some((a, i) => String(a.id) !== String(list[i].id))) { $("#list").innerHTML = ""; renderArtists(list); }
    $("#status").textContent = list.length ? "" : "Лайкнутых авторов пока нет — открой страницу автора и нажми «♡ Нравится»";
  } catch (e) {
    if (my !== nav) return;
    $("#status").textContent = had ? "" : isNetErr(e) ? "Нет связи — список авторов не загрузился" : "Ошибка: " + e.message;
  }
}

// «Лайки» → «Не рекомендуются»: авторы, которых волна пропускает. Вернуть — на странице автора («⊘ Не рекомендуется»).
async function showBannedArtists(my) {
  if (offline) { $("#status").textContent = "Офлайн-режим — список появится, когда вернётся связь"; return; }
  const had = dislikedArtistsList;
  if (had) renderArtists(had); else $("#status").textContent = "Загрузка…";
  try {
    const list = await loadDislikedArtists();
    if (my !== nav) return;
    if (!had || had.length !== list.length || had.some((a, i) => String(a.id) !== String(list[i].id))) { $("#list").innerHTML = ""; renderArtists(list); }
    $("#status").textContent = list.length ? "Эти авторы не попадаются в «Моей волне». Вернуть — на странице автора кнопкой «⊘ Не рекомендуется»"
      : "Таких авторов нет — на странице автора есть кнопка «⊘ Не рекомендовать»";
  } catch (e) {
    if (my !== nav) return;
    $("#status").textContent = had ? "" : isNetErr(e) ? "Нет связи — список не загрузился" : "Ошибка: " + e.message;
  }
}

// Новый лайк сразу появляется сверху открытой страницы «Лайки» (прокрутка не сбивается).
// Снятый лайк строку убирает: она рассыпается на пиксели (dust.js, toggleLike), в подсказке — «Вернуть».
const likesAdded = [];
const likesOpen = () => document.querySelector(".main").dataset.page === "likes" && likesTab === "likes" && !$("#list").hidden;
// Перерисовка с сохранением прокрутки: сразу рисуется столько строк, сколько было до низа экрана — иначе при
// прокрутке вглубь списка (первые 70 строк короче) окно отскакивало наверх после каждого лайка.
const keepScrollRows = (main) => Math.ceil((main.scrollTop + main.clientHeight) / 56) + 20;
function redrawLikes() {
  if (!likesOpen()) return;
  const main = document.querySelector(".main"), top = main.scrollTop;
  likesSrc = likes.tracks;
  renderLikes(keepScrollRows(main));
  main.scrollTop = top;
}

// ---------- поиск по лайкам ----------
// Ищет по названию (с версией), артистам и альбомам; без учёта регистра и «ё». Несколько слов — все должны найтись
// (в любом порядке). Включённый трек из найденного ставит в очередь только найденные треки.
const normQ = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const hayCache = new WeakMap();
function trackHay(t) {
  let h = hayCache.get(t);
  if (h === undefined) {
    h = normQ([t.title, t.version, ...(t.artists || []).map((a) => a.name), ...(t.albums || []).map((a) => a.title)].filter(Boolean).join(" "));
    hayCache.set(t, h);
  }
  return h;
}
function likesFilter(tracks) {
  const words = normQ(likesQuery).split(" ").filter(Boolean);
  if (!words.length) return tracks;
  return tracks.filter((t) => { const h = trackHay(t); return words.every((w) => h.includes(w)); });
}
// на экране строка может быть уже по-английски (i18n.js) — сравниваем с обоими вариантами
const isNothingFound = (s) => s === "Ничего не найдено" || s === window.i18n?.t("Ничего не найдено");
function lkFindCount(final = false) {
  const c = $("#lkFindCnt");
  if (!normQ(likesQuery)) { c.textContent = ""; return; }
  const n = shown.length;
  c.textContent = `${n} из ${likesSrc.length}`;
  if (!n && (final || likes.done)) $("#status").textContent = "Ничего не найдено";
  else if (isNothingFound($("#status").textContent)) $("#status").textContent = "";
}
function renderLikes(first) {
  renderList(likesFilter(withStudioLikes(likesSrc)), false, LK, first);
  lkFindCount(true);
}
// Лайкнутые версии из «Студии» (studio.js) — среди лайков Яндекса, по времени лайка: у лайков Яндекса оно
// приходит с сервера (timestamp, rememberLikes), у новых — момент нажатия, у версий — studio.rs (likedAt).
// Трек без известного времени (офлайн: скачанный, но не лайкнутый) — после всех версий.
const likeTs = new Map();
// studio.js: лайк версии изменился — перерисовать открытые «Лайки» как есть (и во время загрузки, и офлайн),
// не подменяя список, который сейчас показан
function likesStudioChanged() {
  if (!likesOpen()) return;
  const main = document.querySelector(".main"), top = main.scrollTop;
  renderLikes(keepScrollRows(main));
  main.scrollTop = top;
}
function withStudioLikes(list) {
  const st = window.studioLikedList?.() || [];
  if (!st.length) return list;
  st.sort((a, b) => b.at - a.at);
  const out = [];
  let k = 0;
  for (const t of list) {
    const ts = likeTs.get(String(t.id));
    while (k < st.length && (ts === undefined || st[k].at >= ts)) out.push(st[k++].raw);
    out.push(t);
  }
  while (k < st.length) out.push(st[k++].raw);
  return out;
}
function lkFindShow() {
  $("#lkFind").hidden = false;
  const inp = $("#lkFindIn");
  if (inp.value !== likesQuery) inp.value = likesQuery;
  $("#lkFindCnt").textContent = "";
}
let lkFindT = 0;
$("#lkFindIn").addEventListener("input", (e) => {
  clearTimeout(lkFindT);
  const v = e.target.value;
  lkFindT = setTimeout(() => {
    if (normQ(v) === normQ(likesQuery)) { likesQuery = v; return; }
    likesQuery = v;
    if (!likesOpen()) return;
    document.querySelector(".main").scrollTop = 0;
    if (isNothingFound($("#status").textContent)) $("#status").textContent = "";
    renderLikes();
  }, 120);
});
$("#lkFindIn").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    if (e.target.value) { e.target.value = ""; e.target.dispatchEvent(new Event("input")); }
    else e.target.blur();
  } else if (e.key === "Enter") {
    // Enter — включить первый найденный трек
    clearTimeout(lkFindT); likesQuery = e.target.value; renderLikes();
    $("#list li")?.click();
  }
});
// Лайки, поставленные во время загрузки списка (его номера уже были получены), — в начало.
function mergeLikesAdded(acc) {
  const have = new Set(acc.map((x) => String(x.id)));
  const extra = likesAdded.splice(0).filter((x) => likedIds.has(String(x.id)) && !have.has(String(x.id)));
  return extra.length ? [...extra.reverse(), ...acc] : acc;
}

// Список лайков (новые сверху) запоминается: без сети по нему расставляются сердечки и порядок скачанных треков.
function rememberLikes(lib) {
  const list = lib.library.tracks
    .slice()
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
  likedIds = new Set(list.map((t) => String(t.id)));
  likeTs.clear();
  for (const t of list) likeTs.set(String(t.id), Date.parse(t.timestamp) || 0);
  try { localStorage.setItem("ym_liked_ids", JSON.stringify(list.map((t) => String(t.id)))); } catch {}
  return list;
}

// ---------- снимок лайков (IndexedDB «likes:v1») ----------
// Первое открытие «Лайков» после запуска раньше ждало все треки с Яндекса (по 100 за запрос) — при тысячах лайков
// это секунды. Теперь: снимок прошлого запуска рисуется сразу, а с Яндекса берутся только список лайков и треки,
// которых в снимке нет. Описания в снимке старше суток — перезапрашиваются целиком (обложки, доступность).
// Снимок привязан к аккаунту (uid) и стирается при выходе (forgetAccountData).
const SNAP_KEY = "likes:v1", SNAP_FRESH = 24 * 3600e3;
let snapP = null, snapT = 0, likesAt = 0;
const likesSnap = () => (snapP ||= IDB.get(SNAP_KEY)
  .then((v) => (v && uid && String(v.uid) === String(uid) && Array.isArray(v.tracks) ? v : null))
  .catch(() => null));
// в снимке — трек без тяжёлых подробностей альбома и артиста; _lt — время лайка (порядок рядом с версиями студии)
const snapMin = (x) => ({
  ...x,
  albums: (x.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title, genre: a.genre, year: a.year, coverUri: a.coverUri, type: a.type })),
  artists: (x.artists || []).map((a) => ({ id: a.id, name: a.name, cover: a.cover, various: a.various })),
  _lt: likeTs.get(String(x.id)) || 0,
});
// Запись — через несколько секунд после последнего изменения и в свободную минуту: копирование тысяч треков
// в IndexedDB занимает главный поток на десятки миллисекунд и не должно совпасть с анимацией (dust.js, прокрутка).
function snapSave() {
  clearTimeout(snapT);
  snapT = setTimeout(() => {
    const run = () => {
      if (!likes.done || !uid) return;
      const v = { uid: String(uid), at: likesAt || Date.now(), tracks: likes.tracks.filter((t) => /^\d+$/.test(String(t?.id))).map(snapMin) };
      snapP = Promise.resolve(v);
      IDB.set(SNAP_KEY, v).catch(() => {});
    };
    window.requestIdleCallback ? requestIdleCallback(run, { timeout: 5000 }) : run();
  }, 4000);
}
const sameIds = (a, b) => a.length === b.length && a.every((t, i) => String(t.id) === String(b[i].id));

// ---------- кэш страниц: что показать в настройках (pagecache.js) ----------
// likesPerf — как открылись «Лайки» в последний раз: src mem (уже в памяти) | snap (снимок с диска) | net (с Яндекса,
// снимка нет или он пустой); ms — до первых строк на экране; need / total — сколько треков пришлось спросить у Яндекса.
let likesPerf = null, likesNet = {};
window.pageCache = {
  async info() {
    let snap = null, readMs = 0, bytes = 0;
    try { const t0 = performance.now(); snap = await IDB.get(SNAP_KEY); readMs = performance.now() - t0; } catch {}
    if (snap) { try { bytes = JSON.stringify(snap).length; } catch {} }
    return {
      snap: snap ? { count: snap.tracks?.length || 0, at: snap.at || 0, mine: !!uid && String(snap.uid) === String(uid), bytes, readMs } : null,
      fresh: SNAP_FRESH,
      last: likesPerf,
      mem: { likes: likes.done ? likes.tracks.length : 0, playlists: PL.full.size, artists: artistCache.size },
    };
  },
  // снимок стирается; список в памяти остаётся — до перезапуска «Лайки» откроются как раньше
  async clear() { clearTimeout(snapT); snapP = null; likesAt = 0; await IDB.del(SNAP_KEY); },
};
// треки по id пачками по 100, до трёх запросов одновременно; each(пачка, сколько всего готово) — по порядку
async function tracksByIds(ids, each, stale) {
  const parts = [];
  for (let i = 0; i < ids.length; i += 100) parts.push(ids.slice(i, i + 100));
  const run = (k) => { const p = ym("tracks", { form: { "track-ids": parts[k].join(",") } }); p.catch(() => {}); return p; };
  const inflight = parts.slice(0, 3).map((_, k) => run(k));
  let n = 0;
  const out = [];
  for (let k = 0; k < parts.length; k++) {
    const r = await inflight[k];
    if (k + 3 < parts.length) inflight.push(run(k + 3));
    if (stale?.()) return null;
    out.push(...r); n += r.length;
    each?.(r, n, ids.length);
  }
  return out;
}
// список лайков с Яндекса + описания треков (из снимка, что есть и не устарело; остальное — запросом)
async function fetchLikes(onPart, stale, snap) {
  const lib = await ym("likes");
  setOffline(false);
  const list = rememberLikes(lib);
  const have = new Map();
  const fresh = snap && Date.now() - (snap.at || 0) < SNAP_FRESH;
  if (fresh) for (const t of snap.tracks) have.set(String(t.id), t);
  const need = list.filter((x) => !have.has(String(x.id))).map((x) => `${x.id}:${x.albumId}`);
  const got = new Map();
  const res = await tracksByIds(need, (part, n, total) => {
    for (const t of part) got.set(String(t.id), t);
    onPart?.(part, n, total);
  }, stale);
  if (!res) return null;
  likesNet = { need: need.length, total: list.length, stale: !!snap && !fresh };
  if (!fresh) likesAt = Date.now(); else if (!likesAt) likesAt = snap.at;
  return list.map((x) => got.get(String(x.id)) || have.get(String(x.id))).filter(Boolean);
}

// ---------- офлайн: «Лайки» из скачанных треков ----------
// Описание трека берётся из индекса скачанного (сохраняется при скачивании); у старых загрузок
// его может не быть — тогда название и исполнители восстанавливаются из имени файла «Исполнитель — Название».
function offlineTrack(it) {
  const m = it.meta && typeof it.meta === "object" && it.meta.title ? it.meta : null;
  if (m) return { ...m, id: it.id };
  const name = String(it.name || it.id).replace(/ \(\d+\)$/, "");
  const k = name.indexOf(" — ");
  if (k < 0) return { id: it.id, title: name, artists: [] };
  return { id: it.id, title: name.slice(k + 3), artists: name.slice(0, k).split(", ").filter(Boolean).map((n) => ({ name: n })) };
}
async function offlineLikes() {
  let items = [];
  try { items = await invoke("downloaded_tracks"); } catch { return []; }
  got.clear(); for (const it of items) got.add(String(it.id));
  const rank = new Map(lsJSON("ym_liked_ids", [], Array.isArray).map((id, i) => [String(id), i]));
  // сначала лайкнутые — в порядке лайков, затем остальные скачанные — новые сверху
  items.sort((a, b) => {
    const ra = rank.get(String(a.id)), rb = rank.get(String(b.id));
    if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity) || 0;
    return (b.ts || 0) - (a.ts || 0);
  });
  // за скачанными — треки из кэша приложения (cache.js хранит их описание): без сети они играют так же
  const out = items.map(offlineTrack), seen = new Set(out.map((t) => String(t.id)));
  for (const t of window.appCache?.tracks?.() || []) if (!seen.has(String(t.id))) { seen.add(String(t.id)); out.push(t); }
  return out;
}
async function showOfflineLikes(my) {
  const [tracks, off] = await Promise.all([offlineLikes(), suspectOffline()]);
  if (my !== nav) return;
  offlineShown = true;
  dlCur = null; paintDlAll();
  likesSrc = tracks;
  renderLikes();
  if (tracks.length && normQ(likesQuery) && !shown.length) return;
  if (off) offlineNote(tracks.length ? `Офлайн-режим — скачанные треки: ${tracks.length}` : "Офлайн-режим — скачанных треков пока нет");
  else $("#status").textContent = tracks.length
    ? `Яндекс Музыка не отвечает — показаны скачанные треки (${tracks.length}).`
    : "Яндекс Музыка не отвечает, а скачанных треков пока нет.";
}
// Надпись для страницы, которой нужна сеть (только в офлайне). Когда связь вернётся, страница перерисуется (backOnline).
function offlineNote(text) {
  offlineShown = true;
  const s = $("#status");
  s.classList.add("offmsg");
  s.textContent = text;
}
// Скачанные треки, подходящие под условие (артист, альбом) — что можно показать на странице без сети.
async function offlinePick(test) {
  return (await offlineLikes()).filter(test);
}

async function loadAllLikes(onProgress, stale) {
  if (likes.done) return likes.tracks;
  const acc = await fetchLikes((part, n, total) => onProgress(n, total), stale, await likesSnap());
  if (!acc) return null;
  if (likes.done) return likes.tracks;          // пока грузили, лайки загрузила страница «Лайки»
  likes.tracks = mergeLikesAdded(acc); likes.done = true;
  snapSave();
  return likes.tracks;
}
const artistImg = (a) => (a?.cover?.uri ? cover({ coverUri: a.cover.uri }, "200x200") : "");

export { showLikes, redrawLikes, likesOpen, likesAdded, likeTs, rememberLikes, mergeLikesAdded, snapSave, keepScrollRows,
  likesStudioChanged, withStudioLikes, loadAllLikes, offlineLikes, offlineNote, offlinePick, tracksByIds, artistImg, normQ, trackHay };

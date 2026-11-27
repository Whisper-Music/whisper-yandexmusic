// Списки: строки треков (renderList — первые 70 сразу, остальное в свободное время; заготовка строки rowTpl), альбомы
// и артисты плиткой, обложки и подписи (cover, plural, fmtDate, albumInfo, fillArtists).
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
import { COVER_W, ICON, mkImg, safeUrl } from "./base.js";
import { navigate } from "./nav.js";
import { openTrackMenu } from "./trackmenu.js";
import { syncGotRow } from "../library/downloads.js";
import { showAlbum, showArtist } from "../pages/artist.js";
import { play } from "../player/core.js";
import { isLiked, setHeart, toggleLike } from "../player/like.js";
const $ = (s) => document.querySelector(s);

// в офлайне обложки не запрашиваются вовсе — сразу заглушка «W» (mkImg и обработчик ошибок картинок)
const cover = (t, size = "100x100") => (t?.coverUri && !offline ? safeUrl("https://" + String(t.coverUri).replace("%%", size)) : "");
const plural = (n, f) => { const m = n % 100, d = n % 10; return f[m > 10 && m < 20 ? 2 : d === 1 ? 0 : d > 1 && d < 5 ? 1 : 2]; };
function fmtDate(a) {
  const d = Date.parse(a.releaseDate);
  if (!isNaN(d)) return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  return a.year ? String(a.year) : "";
}
const albumTime = (a) => Date.parse(a.releaseDate) || (a.year ? Date.UTC(a.year, 0, 1) : 0);
const albumInfo = (a) =>
  [fmtDate(a), a.trackCount ? `${a.trackCount} ${plural(a.trackCount, ["трек", "трека", "треков"])}` : ""].filter(Boolean).join(" · ");

function fillArtists(el, t) {
  el.textContent = "";
  (t.artists || []).forEach((a, i) => {
    if (i) el.append(", ");
    const s = document.createElement("span");
    s.className = "art"; s.textContent = a.name;
    if (a.id) s.onclick = (e) => { e.stopPropagation(); navigate(() => showArtist(a.id)); };   // у трека, восстановленного из имени файла, номера артиста нет
    el.append(s);
  });
}
const albumOf = (t) => t?.albums?.[0]?.id;

// Длинные списки (лайки — тысячи строк) рисуются частями: первые ~70 строк сразу (это и есть первый экран),
// остальные — порциями между кадрами. Раньше все строки создавались за один раз — переход на «Лайки» и обратно
// подвисал на секунду. Номера и очередь (arr / shown) заполняются сразу целиком — клик, поиск по лайкам и счётчики
// работают как раньше; дорисовка прерывается, если список перерисовали заново.
// Дорисовка — в свободное время между кадрами (requestIdleCallback), порциями не дольше ~6 мс: раньше по 160 строк
// раз в 16 мс, и при тысячах лайков полсекунды подряд каждый кадр был занят — прокрутка дёргалась. Долистал до края
// раньше, чем дорисовалось, — следующая порция рисуется сразу (onListScroll). Длинный список (.biglist) не считает
// раскладку строк вне экрана (content-visibility, styles.css). Строка — копия заготовки (rowProto): одна разборка
// разметки на весь список, а не три на строку.
const LIST_FIRST = 70, LIST_SLICE_MS = 6, LIST_BIG = 300;
const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 120 }) : (f) => setTimeout(f, 16);
// first — сколько строк нарисовать сразу (redrawLikes: столько, чтобы вернуть прокрутку на место)
function renderList(tracks, append = false, opts = {}, first = LIST_FIRST) {
  const list = opts.target || $("#list");
  if (!append) { if (opts.target) opts.arr.length = 0; else shown = []; list.innerHTML = ""; list._rq = []; }
  const arr = opts.target ? opts.arr : shown;
  const q = list._rq || (list._rq = []);
  for (const t of tracks) q.push([t, arr.push(t) - 1, opts, arr]);
  list.classList.toggle("biglist", arr.length > LIST_BIG);
  pumpList(list, list.childElementCount < first ? first - list.childElementCount : 0);
}
function pumpList(list, budget, ms = 0) {
  const q = list._rq;
  if (!q?.length) return;
  const frag = document.createDocumentFragment();
  const t0 = performance.now();
  let n = 0;
  while (q.length && (n < budget || (ms && (n % 8 || performance.now() - t0 < ms)))) {
    const [t, i, opts, arr] = q.shift();
    // список уже другой (resetView, новый поиск, страницу сменили) — хвост старого не дорисовываем
    if (arr[i] !== t || (!opts.target && arr !== shown)) { q.length = 0; break; }
    frag.append(listRow(t, i, opts, arr)); n++;
  }
  if (n) list.appendChild(frag);
  if (q.length && !list._rp) {
    list._rp = true;
    // очередь берётся заново: если список перерисовали, у него уже своя (list._rq), хвост старой выброшен
    idle(() => { list._rp = false; pumpList(list, 0, LIST_SLICE_MS); });
  }
}
// прокрутка подошла к недорисованному краю — порция сразу, не дожидаясь свободной минуты
function onListScroll() {
  const main = document.querySelector(".main");
  if (main.scrollHeight - main.scrollTop - main.clientHeight > 1600) return;
  for (const l of document.querySelectorAll(".list")) if (l._rq?.length) pumpList(l, 0, 10);
}
document.querySelector(".main")?.addEventListener("scroll", onListScroll, { passive: true });
const rowProto = {};
function rowTpl(liked) {
  const k = liked ? "on" : "off";
  if (rowProto[k]) return rowProto[k];
  const li = document.createElement("li");
  li.innerHTML = '<img alt="" loading="lazy" decoding="async"><div><span class="t"></span><span class="a"></span></div>'
    + '<button class="likebtn"></button><button class="morebtn"></button>';
  setHeart(li.querySelector(".likebtn"), liked);
  const mb = li.querySelector(".morebtn");
  mb.title = "Ещё"; mb.innerHTML = ICON.more;
  return (rowProto[k] = li);
}
function listRow(t, i, opts, arr) {
    const liked = isLiked(String(t.id));
    const li = rowTpl(liked).cloneNode(true);
    li.dataset.id = t.id;
    if (String(t.id) === String(playingId)) li.classList.add("playing");
    if (opts.grip) li.prepend(opts.grip(li, i));
    const img = li.querySelector("img"), tt = li.querySelector(".t");
    img.src = cover(t) || COVER_W;
    tt.textContent = t.title;
    const albumId = albumOf(t);
    if (albumId && !opts.noAlbumLink) {
      tt.classList.add("link");
      tt.onclick = (e) => { e.stopPropagation(); navigate(() => showAlbum(albumId)); };
    }
    fillArtists(li.querySelector(".a"), t);
    // opts.play — своё «играть» у списка (поиск: один трек, дальше Моя волна по нему)
    li.onclick = opts.play ? () => opts.play(t, i, arr)
      : () => { wave.on = false; queue = arr; playCtx = opts.ctx || "other"; playAlbum = opts.album || null; play(i); };
    const hb = li.querySelector(".likebtn"), mb = li.querySelector(".morebtn");
    hb.onclick = (e) => { e.stopPropagation(); toggleLike(t); };
    mb.onclick = (e) => { e.stopPropagation(); openTrackMenu(t, mb, opts.menuCtx ? opts.menuCtx(i) : null); };
    if (opts.extra) li.insertBefore(opts.extra(t, li), hb);
    if (got.has(String(t.id))) syncGotRow(li);
    return li;
}

function entityItem({ img, round, title, subFn, onClick }) {
  const li = document.createElement("li");
  const body = document.createElement("div");
  body.innerHTML = '<span class="t"></span><span class="a"></span>';
  li.append(mkImg(safeUrl(img), round ? "rnd" : ""), body);
  li.querySelector(".t").textContent = title;
  subFn(li.querySelector(".a"));
  li.onclick = onClick;
  $("#list").appendChild(li);
}
function renderAlbums(items, withArtists = false) {
  for (const a of items) {
    entityItem({
      img: cover(a), title: a.title,
      subFn: (el) => {
        if (withArtists) { fillArtists(el, a); const x = albumInfo(a); if (x) el.append(" · " + x); }
        else el.textContent = albumInfo(a);
      },
      onClick: () => navigate(() => showAlbum(a.id)),
    });
  }
}
function renderArtists(items) {
  for (const a of items) {
    const u = a.cover?.uri || a.ogImage;
    entityItem({
      img: u ? cover({ coverUri: u }) : "", round: true, title: a.name,
      subFn: (el) => (el.textContent = "Артист"),
      onClick: () => navigate(() => showArtist(a.id)),
    });
  }
}

export { cover, plural, fmtDate, albumTime, albumInfo, fillArtists, albumOf, idle, renderList, pumpList, onListScroll, listRow, entityItem,
  renderAlbums, renderArtists };

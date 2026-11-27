// Страницы автора и альбома: треки, альбомы, «Последний альбом», похожие исполнители, офлайн-вид из скачанного.
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё; ym, setHead, renderList, nav… из main.js —
// по имени внутри функций. Наружу — через window в конце (main.js, share.js, listenstats.js).
import { isNetErr, ym } from "../app/base.js";
import { albumInfo, albumTime, cover, fillArtists, fmtDate, renderAlbums, renderList } from "../app/list.js";
import { navigate, renderTabs, resetView, setActive, setChips, setHead } from "../app/nav.js";
import { suspectOffline } from "../app/offline.js";
import { pinKey } from "../app/pins.js";
import { dlSetup } from "../library/downloads.js";
import { offlineNote, offlinePick } from "./likes.js";
import { fmtInt, plRu } from "./stats.js";
const $ = (s) => document.querySelector(s);

const artistCache = new Map();          // не больше 40 артистов в памяти: самый давний вылетает
const CACHE_MAX = 40;
async function loadAlbums(id) {
  const out = [];
  for (let p = 0; p < 5; p++) {
    const r = await ym("artist_albums", { id, query: { page: p, "page-size": 100, "sort-by": "year" } });
    out.push(...(r.albums || []));
    if (!r.pager || out.length >= r.pager.total) break;
  }
  return out.sort((a, b) => albumTime(b) - albumTime(a));
}
function loadArtist(id) {
  const key = String(id);
  if (artistCache.has(key)) { const v = artistCache.get(key); artistCache.delete(key); artistCache.set(key, v); return v; }
  if (artistCache.size >= CACHE_MAX) artistCache.delete(artistCache.keys().next().value);
  const p = Promise.all([
    ym("artist_brief", { id }).catch(() => null),
    loadAlbums(id).catch(() => []),
  ]).then(([info, albums]) => ({ info, albums }));
  p.catch(() => artistCache.delete(key));
  artistCache.set(key, p);
  return p;
}
function showLastAlbum(a) {
  const el = $("#lastAlbum");
  el.innerHTML = `<img alt="" /><small>Последний релиз</small><b></b><span></span>`;
  el.querySelector("img").src = cover(a, "200x200");
  el.querySelector("b").textContent = a.title;
  el.querySelector("span").textContent = fmtDate(a);
  el.onclick = () => navigate(() => showAlbum(a.id));
  el.hidden = false;
}

async function showArtist(id, tab = "tracks") {
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null, "artist"); renderTabs(pinKey("artist", id)); resetView();
  if (offline) return showArtistOffline(id, my);
  setChips([["tracks", "Треки"], ["albums", "Альбомы"]], tab, (t) => showArtist(id, t));

  loadArtist(id).then(({ info, albums }) => {
    if (my !== nav) return;
    const c = info?.artist?.cover?.uri;
    const name = info?.artist?.name || "Артист";
    const listeners = Number(info?.stats?.lastMonthListeners);
    setHead({
      title: name, img: c ? cover({ coverUri: c }, "200x200") : "", back: true,
      pin: info?.artist?.name ? { type: "artist", id, title: name } : null,
      artistWave: info?.artist?.name ? { id, name } : null,
      artistLike: info?.artist?.name ? { id, name, cover: info.artist.cover } : null,
      sub: Number.isFinite(listeners) && listeners > 0 ? (el) => { el.textContent = `${fmtInt(listeners)} ${plRu(listeners, "слушатель", "слушателя", "слушателей")} за месяц`; } : null,
    });
    if (tab === "albums") {
      renderAlbums(albums);
      $("#status").textContent = albums.length ? "" : "Альбомов нет";
    } else if (albums.length) showLastAlbum(albums[0]);
  }).catch(async (e) => {
    // вкладка «Треки» сама разберётся в loadMore; на «Альбомах» сеть нужна только здесь
    if (tab === "albums" && isNetErr(e) && (await suspectOffline()) && my === nav) showArtist(id, tab);
  });
  if (tab === "albums") return;

  let page = 0;
  const loadMore = async () => {
    try {
      const r = await ym("artist_tracks", { id, query: { page, "page-size": 50 } });
      if (my !== nav) return;
      renderList(r.tracks, page > 0); page++;
      $("#more").hidden = !(r.pager && page * 50 < r.pager.total);
      $("#status").textContent = r.tracks.length || page > 1 ? "" : "Треков нет";
    } catch (e) {
      if (page === 0 && isNetErr(e) && (await suspectOffline())) { if (my === nav) showArtist(id, tab); return; }
      if (my === nav) $("#status").textContent = "Ошибка: " + e.message;
    }
  };
  $("#more").onclick = loadMore;
  loadMore();
}
// офлайн: скачанные треки артиста, имя — из их описания
async function showArtistOffline(id, my) {
  const tracks = await offlinePick((t) => (t.artists || []).some((a) => String(a.id ?? "") === String(id)));
  if (my !== nav) return;
  const name = tracks[0]?.artists?.find((a) => String(a.id ?? "") === String(id))?.name;
  setHead({ title: name || "Артист", back: true });
  if (tracks.length) renderList(tracks);
  offlineNote(tracks.length ? `Офлайн-режим — скачанные треки артиста: ${tracks.length}` : "Офлайн-режим — страница артиста откроется, когда вернётся связь");
}

async function showAlbum(id) {
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null, "album"); renderTabs(pinKey("album", id)); resetView();
  if (offline) return showAlbumOffline(id, my);
  try {
    const a = await ym("album", { id });
    if (my !== nav) return;
    setHead({
      title: a.title, img: cover(a, "200x200"), round: false, back: true, pin: { type: "album", id: a.id, title: a.title, year: a.year },
      sub: (el) => {
        fillArtists(el, a);
        const x = albumInfo(a);
        if (x) el.append(" · " + x);
      },
    });
    const tracks = (a.volumes || []).flat();
    tracks.forEach((t) => {
      if (!t.coverUri) t.coverUri = a.coverUri;
      if (!t.albums?.length) t.albums = [{ id: a.id, title: a.title }];     // чтобы скачанный трек знал свой альбом (офлайн)
    });
    renderList(tracks, false, { noAlbumLink: true, ctx: "album", album: { id: a.id, title: a.title } });
    dlSetup({ key: "album:" + a.id, label: "⤓ Скачать альбом", tracks: () => tracks });
    $("#status").textContent = tracks.length ? "" : "Треков нет";
    loadSimilar(a, my);
  } catch (e) {
    if (isNetErr(e) && (await suspectOffline())) { if (my === nav) showAlbumOffline(id, my); return; }
    if (my === nav) $("#status").textContent = "Ошибка: " + e.message;
  }
}
// офлайн: скачанные треки этого альбома (альбом записан в описании скачанного трека)
async function showAlbumOffline(id, my) {
  const tracks = await offlinePick((t) => String(t.albums?.[0]?.id ?? "") === String(id));
  if (my !== nav) return;
  setHead({ title: tracks[0]?.albums?.[0]?.title || "Альбом", back: true, round: false });
  if (tracks.length) renderList(tracks, false, { noAlbumLink: true });
  offlineNote(tracks.length ? `Офлайн-режим — скачанные треки альбома: ${tracks.length}` : "Офлайн-режим — альбом откроется, когда вернётся связь");
}

async function loadSimilar(a, my) {
  try {
    const mainId = a.artists?.[0]?.id;
    if (!mainId) return;
    const { info, albums } = await loadArtist(mainId);
    let items = [], title = "Похожие альбомы";
    const sim = (info?.similarArtists || []).slice(0, 6);
    if (sim.length) {
      const res = await Promise.allSettled(sim.map((q) => ym("artist_albums", { id: q.id, query: { page: 0, "page-size": 20, "sort-by": "year" } })));
      for (const r of res) {
        if (r.status !== "fulfilled") continue;
        items.push(...(r.value.albums || []).slice().sort((x, y) => albumTime(y) - albumTime(x)).slice(0, 2));
      }
    }
    if (!items.length) { title = "Другие альбомы исполнителя"; items = albums; }
    items = items.filter((x, i, arr) => String(x.id) !== String(a.id) && arr.findIndex((y) => y.id === x.id) === i).slice(0, 12);
    if (my !== nav || !items.length) return;
    $("#simTitle").textContent = title;
    const grid = $("#simGrid"); grid.innerHTML = "";
    for (const x of items) {
      const c = document.createElement("div");
      c.className = "simcard";
      c.innerHTML = "<img alt=\"\" /><b></b><span></span>";
      c.querySelector("img").src = cover(x, "200x200");
      c.querySelector("b").textContent = x.title;
      c.querySelector("span").textContent = [(x.artists || []).map((q) => q.name).join(", "), x.year].filter(Boolean).join(" · ");
      c.onclick = () => navigate(() => showAlbum(x.id));
      grid.append(c);
    }
    $("#similar").hidden = false;
  } catch {}
}

export { artistCache, loadArtist, showArtist, showAlbum };

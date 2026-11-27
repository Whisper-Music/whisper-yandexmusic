// Страница «Статистика» по лайкам (время, жанры, исполнители, годы) и общие помощники для страниц статистики:
// форматы чисел и часов, названия жанров, карточки и значки (их же берёт pages/listenstats.js и консоль cli.js).
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё; likes, ym, setHead… из main.js — по имени
// внутри функций. Наружу — через window в конце.
import { isNetErr, mkImg, ym } from "../app/base.js";
import { cover } from "../app/list.js";
import { navigate, renderTabs, resetView, setActive, setHead } from "../app/nav.js";
import { suspectOffline } from "../app/offline.js";
import { showAlbum, showArtist } from "./artist.js";
import { artistImg, loadAllLikes } from "./likes.js";
import { loadStations, stations } from "./wave.js";
import { play } from "../player/core.js";
const $ = (s) => document.querySelector(s);

function computeStats(tracks) {
  const artists = new Map(), albums = new Map(), genres = new Map(), primary = new Map();
  let ms = 0, withDur = 0;
  for (const t of tracks) {
    if (!t) continue;
    const dur = Number.isFinite(t.durationMs) ? t.durationMs : 0;
    if (dur) { ms += dur; withDur++; }
    const arts = (t.artists || []).filter((a) => a && a.id != null && a.name);
    for (const a of arts) {
      const k = String(a.id), e = artists.get(k) || { id: a.id, name: a.name, count: 0, ms: 0, img: "" };
      e.count++; e.ms += dur;
      if (!e.img) e.img = artistImg(a) || cover(t, "200x200");
      artists.set(k, e);
    }
    if (arts[0]) { const k = String(arts[0].id), p = primary.get(k) || { id: arts[0].id, name: arts[0].name, count: 0, img: "" }; p.count++; primary.set(k, p); }
    const al = t.albums?.[0];
    if (al && al.id != null && al.title) {
      const k = String(al.id), e = albums.get(k) || { id: al.id, title: al.title, artist: al.artists?.[0]?.name || arts[0]?.name || "", artistId: al.artists?.[0]?.id ?? arts[0]?.id ?? null, count: 0, img: cover(al.coverUri ? al : t, "200x200") };
      e.count++; albums.set(k, e);
      if (typeof al.genre === "string" && al.genre) genres.set(al.genre, (genres.get(al.genre) || 0) + 1);
    }
  }
  const byCount = (a, b) => b.count - a.count || (b.ms || 0) - (a.ms || 0);
  for (const [k, p] of primary) p.img = artists.get(k)?.img || "";
  const primaryList = [...primary.values()].sort(byCount);
  return {
    total: tracks.length, ms, withDur,
    artists: [...artists.values()].filter((e) => e.count >= 2).sort(byCount).slice(0, 5),
    albums: [...albums.values()].filter((e) => e.count >= 2).sort(byCount).slice(0, 4),
    topGenre: [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    primary: primaryList, primaryTotal: primaryList.reduce((s, p) => s + p.count, 0),
  };
}
async function genreTitle(slug) {
  try {
    await loadStations();
    const hit = [...(stations.groups.genre || []), ...(stations.groups.subgenre || [])].find((x) => x.seed === "genre:" + slug);
    if (hit) return hit.name;
  } catch {}
  return slug.replace(/[-_]+/g, " ").replace(/^./, (ch) => ch.toUpperCase());
}
const fmtHM = (ms) => { const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? `${h} ч ${m % 60} мин` : `${m} мин`; };
const fmtInt = (n) => n.toLocaleString("ru-RU");
const plRu = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
function fmtHours(ms) {
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} мин`;
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r} ${plRu(r, "час", "часа", "часов")}` : `${String(r).replace(".", ",")} часа`;
}
const ICONS = {
  heart: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/></svg>',
  crown: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z"/></svg>',
};
function statCard(icon, label, value) {
  const d = document.createElement("div"); d.className = "card statcard";
  d.innerHTML = icon + '<div><small></small><b></b></div>';
  d.querySelector("small").textContent = label; d.querySelector("b").textContent = value;
  return d;
}
function donutColors() {
  return [
    "var(--accent)", "var(--accent2)",
    "color-mix(in srgb, var(--accent) 50%, var(--accent2))",
    "color-mix(in srgb, var(--accent) 55%, #fff)",
    "color-mix(in srgb, var(--accent2) 55%, #000)",
  ];
}
async function playAlbumById(al) {
  try {
    const a = await ym("album", { id: al.id });
    const tracks = (a.volumes || []).flat();
    tracks.forEach((t) => { if (!t.coverUri) t.coverUri = a.coverUri; });
    if (!tracks.length) return;
    wave.on = false; queue = tracks; playCtx = "album"; playAlbum = { id: a.id, title: a.title }; play(0);
  } catch (e) { $("#stNote").textContent = "Не удалось включить альбом: " + e.message; }
}
async function showStats() {
  const my = ++nav;
  setHead({ title: "Статистика" }); setActive("statsBtn"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#statsPage").hidden = false; $("#statsBody").hidden = true; $("#lsBody").hidden = true;
  // «Записывать статистику» включена — страница прослушиваний (listenstats.js); вкладка «Лайки» — как ниже
  if (window.lstatsShow && (await window.lstatsShow(my))) return;
  if (my !== nav) return;
  const note = $("#stNote");
  // офлайн: если лайки уже загружались в этом запуске — считаем по ним (без обложек), иначе надпись
  const offNote = () => { offlineShown = true; note.textContent = "Вы в офлайн-режиме — статистика появится, когда вернётся связь"; note.classList.add("offmsg"); };
  note.classList.remove("offmsg");
  if (offline && !likes.done) return offNote();
  note.textContent = "Понравившиеся треки загружаются…";
  let tracks;
  try { tracks = await loadAllLikes((n, total) => { note.textContent = `Понравившиеся треки загружаются: ${n} из ${total}…`; }, () => my !== nav); }
  catch (e) {
    if (isNetErr(e) && (await suspectOffline())) { if (my === nav) offNote(); return; }
    if (my === nav) note.textContent = "Ошибка: " + e.message;
    return;
  }
  if (!tracks || my !== nav) return;
  if (!tracks.length) { note.textContent = "Пока нет понравившихся треков — статистика считается по ним."; return; }
  if (offline) offlineShown = true;          // посчитано без сети — с обложками перерисуем, когда связь вернётся

  const s = computeStats(tracks);
  const genre = s.topGenre ? (offline ? s.topGenre.replace(/[-_]+/g, " ").replace(/^./, (ch) => ch.toUpperCase()) : await genreTitle(s.topGenre)) : null;
  if (my !== nav) return;

  const cards = $("#statCards"); cards.innerHTML = "";
  cards.append(statCard(ICONS.heart, "Понравившихся треков", fmtInt(s.total)));
  if (s.withDur) cards.append(statCard(ICONS.clock, "Длительность понравившихся", fmtHM(s.ms)));
  if (genre) cards.append(statCard(ICONS.star, "Любимый жанр", genre));

  const people = $("#stArtists"); people.innerHTML = "";
  s.artists.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "stperson";
    d.append(mkImg(a.img));
    d.insertAdjacentHTML("beforeend", '<div class="rank"><span></span></div><b class="nm"></b><span class="hrs"></span><span class="cnt"></span>');
    d.querySelector(".rank span").textContent = String(i + 1);
    if (i === 0) d.querySelector(".rank").insertAdjacentHTML("beforeend", ICONS.crown);
    d.querySelector(".nm").textContent = a.name; d.querySelector(".nm").title = a.name;
    d.querySelector(".hrs").textContent = fmtHours(a.ms);
    d.querySelector(".cnt").textContent = `${fmtInt(a.count)} ${plRu(a.count, "понравившийся трек", "понравившихся трека", "понравившихся треков")}`;
    d.onclick = () => navigate(() => showArtist(a.id));
    people.append(d);
  });
  $("#boxArtists").hidden = !s.artists.length;

  const grid = $("#stAlbums"); grid.innerHTML = "";
  for (const al of s.albums) {
    const d = document.createElement("div"); d.className = "stalbum";
    const pic = document.createElement("button"); pic.className = "stpic"; pic.title = "Играть альбом"; pic.setAttribute("aria-label", "Играть альбом");
    pic.append(mkImg(al.img));
    pic.insertAdjacentHTML("beforeend", '<span class="stplay"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>');
    pic.onclick = () => playAlbumById(al);
    const ttl = document.createElement("button"); ttl.className = "stlink ttl"; ttl.textContent = al.title; ttl.title = al.title;
    ttl.onclick = () => navigate(() => showAlbum(al.id));
    const sub = document.createElement("div"); sub.className = "stsub";
    if (al.artist) {
      const ab = document.createElement("button"); ab.className = "stlink art"; ab.textContent = al.artist; ab.title = al.artist;
      if (al.artistId != null) ab.onclick = () => navigate(() => showArtist(al.artistId)); else ab.disabled = true;
      sub.append(ab);
    }
    const cn = document.createElement("span"); cn.className = "cn"; cn.textContent = `${fmtInt(al.count)} понравившихся`; sub.append(cn);
    d.append(pic, ttl, sub);
    grid.append(d);
  }
  $("#boxAlbums").hidden = !s.albums.length;

  const svg = $("#stDonut"), legend = $("#stLegend"); svg.innerHTML = ""; legend.innerHTML = "";
  if (s.primary.length >= 2) {
    const top = s.primary.slice(0, 4), rest = s.primaryTotal - top.reduce((x, p) => x + p.count, 0), colors = donutColors();
    const parts = top.map((p, i) => ({ id: p.id, name: p.name, count: p.count, img: p.img, color: colors[i] }));
    if (rest > 0) parts.push({ name: "Другие", count: rest, color: "rgba(255,255,255,.28)", other: true });
    const R = 40, C = 2 * Math.PI * R;
    const box = $("#boxShare"); box.querySelector(".stcardhover")?.remove();
    const tip = document.createElement("div"); tip.className = "stcardhover"; tip.hidden = true; box.append(tip);
    const rings = [], rows = [];
    const focus = (i) => {
      rings.forEach((r, k) => { r.classList.toggle("hot", k === i); r.classList.toggle("dim", k !== i); });
      rows.forEach((r, k) => r.classList.toggle("hot", k === i));
      const p = parts[i];
      if (p.other) { tip.hidden = true; return; }
      tip.replaceChildren();
      if (p.img) tip.append(mkImg(p.img));
      const b = document.createElement("b"); b.textContent = p.name;
      const sm = document.createElement("small"); sm.textContent = `${fmtInt(p.count)} ${plRu(p.count, "понравившийся трек", "понравившихся трека", "понравившихся треков")}`;
      tip.append(b, sm); tip.hidden = false;
    };
    const blur = () => { rings.forEach((r) => r.classList.remove("hot", "dim")); rows.forEach((r) => r.classList.remove("hot")); tip.hidden = true; };
    const move = (e) => {
      if (tip.hidden) return;
      const br = box.getBoundingClientRect();
      let x = e.clientX - br.left + 16, y = e.clientY - br.top + 16;
      x = Math.max(8, Math.min(x, br.width - tip.offsetWidth - 8)); y = Math.max(8, Math.min(y, br.height - tip.offsetHeight - 8));
      tip.style.left = x + "px"; tip.style.top = y + "px";
    };
    let start = 0, pctLeft = 100;
    parts.forEach((p, i) => {
      const frac = p.count / s.primaryTotal, len = Math.max(0, frac * C - 1.2);
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("cx", 50); ring.setAttribute("cy", 50); ring.setAttribute("r", R);
      ring.setAttribute("stroke-dasharray", `${len} ${C - len}`); ring.setAttribute("stroke-dashoffset", -start * C);
      ring.style.stroke = p.color;
      svg.append(ring); rings.push(ring); start += frac;
      const pct = i === parts.length - 1 ? pctLeft : Math.round(frac * 100); pctLeft -= pct;
      const li = document.createElement("li");
      li.innerHTML = '<i class="dot"></i><span class="nm"></span><span class="pct"></span>';
      li.querySelector(".dot").style.background = p.color;
      li.querySelector(".nm").textContent = p.name; li.querySelector(".pct").textContent = pct + "%";
      legend.append(li); rows.push(li);
      for (const el of [ring, li]) { el.addEventListener("mouseenter", () => focus(i)); el.addEventListener("mouseleave", blur); el.addEventListener("mousemove", move); }
      if (!p.other && p.id != null) { ring.style.cursor = li.style.cursor = "pointer"; const go = () => navigate(() => showArtist(p.id)); ring.addEventListener("click", go); li.addEventListener("click", go); }
    });
    $("#stDonutNum").textContent = fmtInt(s.primaryTotal); $("#stDonutCap").textContent = "треков";
  }
  $("#boxShare").hidden = s.primary.length < 2;

  note.textContent = "";
  $("#statsBody").hidden = false;
}

export { showStats, playAlbumById, computeStats, fmtInt, plRu, fmtHM, fmtHours, genreTitle, ICONS, statCard };

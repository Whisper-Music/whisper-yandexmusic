// Отношение к авторам: лайк автора (★ на странице автора, вкладка «★ Авторы») и «Не рекомендовать автора» (волна пропускает
// его треки).
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
import { wReport, ym } from "../app/base.js";
import { showToast } from "../app/menu.js";
const $ = (s) => document.querySelector(s);

const saveLikedArtists = () => { try { localStorage.setItem("ym_liked_artists", JSON.stringify([...likedArtists])); } catch {} };
async function loadLikedArtists(force = false) {
  if (likedArtistsList && !force) return likedArtistsList;
  const r = await ym("likes_artists", { query: { "with-timestamps": "true" } });
  // с отметками времени Яндекс отдаёт { artist, timestamp }, без них — самих артистов; понимаем оба вида
  const list = (Array.isArray(r) ? r : []).map((x) => ({ ...(x?.artist || x), _ts: Date.parse(x?.timestamp) || 0 })).filter((a) => a.id != null && a.name);
  list.sort((a, b) => b._ts - a._ts);
  likedArtistsList = list;
  likedArtists.clear(); for (const a of list) likedArtists.add(String(a.id));
  saveLikedArtists();
  updateArtistLikeBtn();
  return list;
}
function updateArtistLikeBtn() {
  const b = $("#artistLikeBtn"), d = $("#artistDisBtn");
  b.hidden = d.hidden = !artistLikeItem;
  if (!artistLikeItem) return;
  const id = String(artistLikeItem.id), on = likedArtists.has(id), off = dislikedArtists.has(id);
  b.textContent = on ? "♥ Нравится" : "♡ Нравится";
  b.title = on ? "Убрать автора из лайков" : "Добавить автора в лайки: «Лайки» → «Авторы»";
  b.classList.toggle("active", on);
  d.textContent = off ? "⊘ Не рекомендуется" : "⊘ Не рекомендовать";
  d.title = off ? "Снова пускать автора в «Мою волну»" : "Автор больше не попадётся в «Моей волне»";
  d.classList.toggle("active", off);
}
async function toggleArtistLike(a) {
  const id = String(a.id), on = !likedArtists.has(id), wasOff = dislikedArtists.has(id);
  // лайк снимает «Не рекомендовать» (как у треков: лайк снимает «Не нравится»)
  const flip = (v) => {
    v ? likedArtists.add(id) : likedArtists.delete(id);
    if (v) dislikedArtists.delete(id); else if (wasOff) dislikedArtists.add(id);
    updateArtistLikeBtn();
  };
  flip(on);
  try {
    if (on && wasOff) await ym("artist_dislike_remove", { form: { "artist-ids": id } }).catch(() => {});
    await ym(on ? "artist_like_add" : "artist_like_remove", { form: { "artist-ids": id } });
    saveLikedArtists(); saveDislikedArtists();
    if (on && wasOff && dislikedArtistsList) dislikedArtistsList = dislikedArtistsList.filter((x) => String(x.id) !== id);
    if (likedArtistsList) {
      likedArtistsList = likedArtistsList.filter((x) => String(x.id) !== id);
      if (on) likedArtistsList.unshift({ id: a.id, name: a.name, cover: a.cover, _ts: Date.now() });
    }
  } catch (e) {
    flip(!on);
    showToast((on ? "Не удалось добавить автора в лайки: " : "Не удалось убрать автора из лайков: ") + e.message, 5000, { kind: "err" });
  }
}
$("#artistLikeBtn").onclick = () => { if (artistLikeItem) toggleArtistLike(artistLikeItem); };

// ---------- «Не рекомендовать автора» ----------
// Яндекс сам убирает такого автора из рекомендаций (и снимает его лайк), но волна всё равно иногда приносит его треки
// (совместные, сборники, уже собранная очередь) — поэтому волна ещё и сама их пропускает (artistBanned).
// Исключение — волна по самому этому автору: её включили нарочно.
const saveDislikedArtists = () => { try { localStorage.setItem("ym_disliked_artists", JSON.stringify([...dislikedArtists])); } catch {} };
async function loadDislikedArtists() {
  const r = await ym("dislikes_artists", { query: { "with-timestamps": "true" } });
  // как у лайков: с отметками времени — { artist, timestamp }, без них — сами артисты
  const all = (Array.isArray(r) ? r : []).map((x) => ({ ...(x?.artist || x), _ts: Date.parse(x?.timestamp) || 0 })).filter((a) => a.id != null);
  all.sort((a, b) => b._ts - a._ts);
  const list = all.filter((a) => a.name);                 // в списке — с именем; пропускает волна всех
  dislikedArtistsList = list;
  dislikedArtists.clear(); for (const a of all) dislikedArtists.add(String(a.id));
  saveDislikedArtists();
  updateArtistLikeBtn();
  return list;
}
const seedArtist = () => /^artist:(\d+)$/.exec(wave.seed || "")?.[1] || "";
// трек нельзя ставить в волну: у него есть автор из «Не рекомендуются» (кроме автора, по которому эта волна)
const artistBanned = (t) => { const s = seedArtist(); return (t?.artists || []).some((a) => a?.id != null && String(a.id) !== s && dislikedArtists.has(String(a.id))); };
// автор только что попал в «Не рекомендуются»: его треки впереди в волне убираются, играющий — переключается
function waveDropBanned() {
  if (!wave.on || queue !== wave.queue) return;
  let cut = false;
  for (let i = queue.length - 1; i > current; i--) if (artistBanned(queue[i])) { queue.splice(i, 1); cut = true; }
  if (cut) wReport({ queue: true });
  if (queue[current] && artistBanned(queue[current])) $("#next").click();     // «дальше» заодно скажет волне skip
}
async function toggleArtistDislike(a) {
  const id = String(a.id), off = !dislikedArtists.has(id), wasLiked = likedArtists.has(id), name = a.name || "Автор";
  const flip = (v) => {
    v ? dislikedArtists.add(id) : dislikedArtists.delete(id);
    if (v) likedArtists.delete(id); else if (wasLiked) likedArtists.add(id);
    updateArtistLikeBtn();
  };
  flip(off);
  if (off) waveDropBanned();
  try {
    await ym(off ? "artist_dislike_add" : "artist_dislike_remove", { form: { "artist-ids": id } });
    saveDislikedArtists(); saveLikedArtists();
    if (off && likedArtistsList) likedArtistsList = likedArtistsList.filter((x) => String(x.id) !== id);
    if (dislikedArtistsList) {
      dislikedArtistsList = dislikedArtistsList.filter((x) => String(x.id) !== id);
      if (off) dislikedArtistsList.unshift({ id: a.id, name: a.name, cover: a.cover, _ts: Date.now() });
    }
    if (off) showToast(`${name} больше не попадётся в «Моей волне»`, 5000, { kind: "ok", action: { label: "Отменить", fn: () => { if (dislikedArtists.has(id)) toggleArtistDislike(a); } } });
    else showToast(`${name} снова может попадаться в «Моей волне»`, 3500, { kind: "ok" });
  } catch (e) {
    flip(!off);
    showToast((off ? "Не удалось убрать автора из рекомендаций: " : "Не удалось вернуть автора: ") + e.message, 5000, { kind: "err" });
  }
}
$("#artistDisBtn").onclick = () => { if (artistLikeItem) toggleArtistDislike(artistLikeItem); };

export { saveLikedArtists, loadLikedArtists, updateArtistLikeBtn, toggleArtistLike, saveDislikedArtists, loadDislikedArtists, seedArtist,
  artistBanned, waveDropBanned, toggleArtistDislike };

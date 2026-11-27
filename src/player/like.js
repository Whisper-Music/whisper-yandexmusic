// Лайки и «Не нравится» трека: сердечки, загрузка списков с Яндекса, переключение; свои версии студии и треки по
// приглашению (isStudio, isShared).
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
import { ICON, wReport, ym } from "../app/base.js";
import { albumOf } from "../app/list.js";
import { showToast } from "../app/menu.js";
import { thumbSync } from "../app/nav.js";
import { loadDislikedArtists } from "../pages/artistprefs.js";
import { likesAdded, likesOpen, likeTs, redrawLikes, rememberLikes, snapSave } from "../pages/likes.js";
import { refreshPlayerBtns } from "./core.js";
const $ = (s) => document.querySelector(s);

function setHeart(b, on) {
  if (b.firstChild && b.classList.contains("on") === on) return;      // уже в нужном состоянии — не перерисовываем (в лайках тысячи строк)
  b.classList.toggle("on", on);
  b.innerHTML = on ? ICON.heartOn : ICON.heart;
  b.title = on ? "Убрать из лайков" : "В лайки";
}
// своя версия из «Студии» (studio.js): номер «studio-…», лайк у неё локальный — Яндекс о ней не знает
function isStudio(id) { return String(id).startsWith("studio-"); }
// версия, которой с тобой поделились (studio.js → studioOpenShared): «wa-<трек архива>», играет из Whisper Archive.
// Это не трек Яндекса — лайкать, скачивать и добавлять в плейлисты нечего
function isShared(id) { return String(id).startsWith("wa-"); }
function isLiked(id) { return isStudio(id) ? !!window.studioLiked?.(String(id)) : !isShared(id) && likedIds.has(String(id)); }
function refreshHearts() {
  document.querySelectorAll(".list li").forEach((li) => {
    const b = li.querySelector(".likebtn");
    if (b) setHeart(b, isLiked(String(li.dataset.id)));
  });
  const t = queue[current];
  setHeart($("#likeBtn"), !!t && isLiked(String(t.id)));
  setHeart($("#fLike"), !!t && isLiked(String(t.id)));
  refreshPlayerBtns();
  thumbSync();
  if (!t || String(t.id) === window.Whisper?.player.state().track?.id) wReport({ liked: !!t && isLiked(String(t.id)), disliked: !!t && dislikedIds.has(String(t.id)) });
}
async function loadLikedIds() {
  try {
    const lib = await ym("likes");
    rememberLikes(lib);
    refreshHearts();
  } catch {}
}
async function toggleLike(t) {
  if (!t) return;
  if (isStudio(t.id)) { await window.studioToggleLike?.(t); refreshHearts(); return; }
  if (isShared(t.id)) { showToast("Это чужая версия из Whisper Archive — лайкнуть её здесь нельзя", 3500); return; }
  const id = String(t.id), albumId = albumOf(t), was = likedIds.has(id);
  was ? likedIds.delete(id) : likedIds.add(id);
  if (!was) likeTs.set(id, Date.now());               // новый лайк — самый свежий (версии студии встают по времени)
  if (!was && dislikedIds.delete(id)) saveDislikes();       // лайк снимает «Не нравится» (Яндекс делает так же)
  refreshHearts();
  // снят на открытой странице «Лайки» — строка рассыпается на пиксели (dust.js); вернуть — кнопкой в подсказке
  const gone = was && likesOpen() ? [...document.querySelectorAll("#list li")].filter((li) => li.dataset.id === id) : [];
  if (gone.length) {
    for (const li of gone) window.rowDust ? window.rowDust(li) : li.remove();
    showToast(`«${t.title}» — убран из лайков`, 5000, { kind: "ok", action: { label: "Вернуть", fn: () => { if (!likedIds.has(id)) toggleLike(t); } } });
  }
  try {
    await ym(was ? "like_remove" : "like_add", { form: { "track-ids": albumId ? `${id}:${albumId}` : id } });
    if (was) likes.tracks = likes.tracks.filter((x) => String(x.id) !== id);
    else if (likes.done) { likes.tracks = [t, ...likes.tracks.filter((x) => String(x.id) !== id)]; redrawLikes(); }
    else likesAdded.push(t);              // лайки ещё грузятся — трек добавится, когда загрузка закончится
    snapSave();
  } catch (e) {
    was ? likedIds.add(id) : likedIds.delete(id);
    if (gone.length) redrawLikes();       // строка уже рассыпалась — вернуть её на место
    refreshHearts();
    $("#status").textContent = "Не удалось изменить лайк: " + e.message;
  }
}
$("#likeBtn").onclick = () => toggleLike(queue[current]);

function rememberDislikes(lib) {
  const ids = (lib?.library?.tracks || []).map((t) => String(t.id));
  dislikedIds = new Set(ids);
  try { localStorage.setItem("ym_disliked_ids", JSON.stringify(ids)); } catch {}
}
async function loadDislikedIds() {
  loadDislikedArtists().catch(() => {});        // заодно — авторы из «Не рекомендуются» (волна их пропускает)
  try { rememberDislikes(await ym("dislikes")); refreshPlayerBtns(); } catch {}
}
function saveDislikes() { try { localStorage.setItem("ym_disliked_ids", JSON.stringify([...dislikedIds])); } catch {} }
// «Не нравится»: трек уходит в дизлайки Яндекса (волна его больше не предложит), из лайков он убирается,
// а если он сейчас играет — сразу включается следующий.
async function toggleDislike(t) {
  if (!t || isStudio(t.id) || isShared(t.id)) return;     // у версий «Не нравится» нет
  const id = String(t.id), albumId = albumOf(t), was = dislikedIds.has(id), wasLiked = likedIds.has(id);
  const isCur = queue[current] && String(queue[current].id) === id;
  was ? dislikedIds.delete(id) : dislikedIds.add(id);
  if (!was && wasLiked) likedIds.delete(id);
  saveDislikes(); refreshHearts();
  if (!was && isCur) $("#next").click();
  try {
    await ym(was ? "dislike_remove" : "dislike_add", { form: { "track-ids": albumId ? `${id}:${albumId}` : id } });
    if (!was && wasLiked) { likes.tracks = likes.tracks.filter((x) => String(x.id) !== id); redrawLikes(); snapSave(); }
    if (!was) showToast(`«${t.title}» — не нравится`, 5000, { kind: "ok", action: { label: "Отменить", fn: () => { if (dislikedIds.has(id)) toggleDislike(t); } } });
  } catch (e) {
    was ? dislikedIds.add(id) : dislikedIds.delete(id);
    if (!was && wasLiked) likedIds.add(id);
    saveDislikes(); refreshHearts();
    $("#status").textContent = "Не удалось изменить «Не нравится»: " + e.message;
  }
}

export { setHeart, isStudio, isShared, isLiked, refreshHearts, loadLikedIds, toggleLike, rememberDislikes, loadDislikedIds, saveDislikes,
  toggleDislike };

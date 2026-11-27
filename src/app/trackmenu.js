// Меню трека («⋯» и правый щелчок): главное меню, авторы, «Добавить в плейлист», скорость воспроизведения
// (ползунок 0.5–2× и готовые значения; общая для всех треков, высота звука сохраняется).
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё; queue, isLiked, download… из main.js
// и модулей — по имени внутри функций. speed — свойство window: его читают yandex.js, cli.js, mascot.js.
// Наружу — через window в конце.
import { fill, ICON, wReport } from "./base.js";
import { cover } from "./list.js";
import { menuAlive, menuHead, menuItem, menuNote, menuReset, menuSep, openMenu, placeMenu, tmenu } from "./menu.js";
import { deleteDownload, downloadTrack } from "../library/downloads.js";
import { toggleArtistDislike } from "../pages/artistprefs.js";
import { plAddTrack, plCount, plCoverEl, plCoverFromTrack, plCreateDialog, plErr, plLoadList, plMoveTrack, plRemoveTrack } from "../pages/playlists.js";
import { isShared, isStudio } from "../player/like.js";
const $ = (s) => document.querySelector(s);

// ---------- скорость воспроизведения ----------
// Ползунок 0.5–2 и пять готовых значений. Скорость общая для всех треков и запоминается между запусками;
// высота звука сохраняется (preservesPitch). defaultPlaybackRate нужен, чтобы смена src её не сбрасывала.
const SPEEDS = [0.5, 1, 1.25, 1.5, 2], SPEED_MIN = 0.5, SPEED_MAX = 2, SPEED_STEP = 0.05;
const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round((+v || 1) / SPEED_STEP) * SPEED_STEP));
window.speed = (() => { try { return clampSpeed(localStorage.getItem("ym_speed") || 1); } catch { return 1; } })();
const fmtSpeed = (v) => (+v.toFixed(2)).toString().replace(".", ",") + "×";
function applySpeed(a) {
  if (!a) return;
  a.preservesPitch = true;
  a.defaultPlaybackRate = speed;
  if (a.playbackRate !== speed) a.playbackRate = speed;
}
function setSpeed(v) {
  speed = clampSpeed(v);
  try { localStorage.setItem("ym_speed", String(speed)); } catch {}
  applySpeed(audio);
  syncSpeedBadge();
  wReport({ rate: speed });               // время в Discord и мини-плеере — с новой скоростью (ядро: событие «rate»)
}
function syncSpeedBadge() {
  const b = $("#pMore");
  if (!b) return;
  b.classList.toggle("spd", speed !== 1);
  b.dataset.speed = speed !== 1 ? fmtSpeed(speed) : "";
  b.title = speed !== 1 ? `Ещё · скорость ${fmtSpeed(speed)}` : "Ещё";
}
function menuSpeed() {
  const box = document.createElement("div"); box.className = "mspeed";
  const head = document.createElement("div"); head.className = "mspeedhead";
  const lbl = document.createElement("span"); lbl.textContent = "Скорость";
  const val = document.createElement("b"); val.textContent = fmtSpeed(speed);
  head.append(lbl, val);
  const r = document.createElement("input");
  r.type = "range"; r.min = SPEED_MIN; r.max = SPEED_MAX; r.step = SPEED_STEP; r.value = speed;
  r.setAttribute("aria-label", "Скорость воспроизведения");
  const row = document.createElement("div"); row.className = "mspeedrow";
  const btns = SPEEDS.map((v) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "mspd"; b.textContent = fmtSpeed(v);
    b.onclick = (e) => { e.stopPropagation(); setSpeed(v); sync(); };
    row.append(b); return b;
  });
  const sync = () => {
    r.value = speed; fill(r); val.textContent = fmtSpeed(speed);
    btns.forEach((b, i) => b.classList.toggle("on", Math.abs(SPEEDS[i] - speed) < 1e-6));
  };
  r.oninput = () => { setSpeed(r.value); sync(); };
  r.onclick = (e) => e.stopPropagation();
  r.ondblclick = () => { setSpeed(1); sync(); };       // двойной клик по ползунку — обычная скорость
  box.append(head, r, row);
  tmenu.append(box);
  sync();
}

function openTrackMenu(t, btn, ctx = null) { openMenu(btn, () => trackMenuMain(t, ctx)); }
function trackMenuMain(t, ctx) {
  menuFilter = true;
  try { trackMenuBuild(t, ctx); } finally { menuFilter = false; }
  // скрытые пункты могли оставить разделитель последним
  let cut = false;
  while (tmenu.lastElementChild?.classList.contains("msep")) { tmenu.lastElementChild.remove(); cut = true; }
  if (cut) placeMenu();
}
function trackMenuBuild(t, ctx) {
  menuReset();
  const bottom = tmenuBtn?.id === "pMore";                       // меню нижней панели
  // своя версия из «Студии»: Яндекс о ней не знает — без плейлистов и скачивания, только пункты модулей
  // (архив, сама студия) и звук
  if (isStudio(t.id) || isShared(t.id)) {
    if (bottom) { menuSpeed(); menuSep(); }
    if (isStudio(t.id)) window.Whisper?.ui.trackMenu.build(t, ctx);     // у чужой версии пунктов модулей нет
    menuSep();
    if (window.eqOpen) menuItem(ICON.eq || "", "Эквалайзер", () => window.eqOpen());
    if (bottom) { window.outMenu?.(t, ctx); window.soundMenu?.(t, ctx); }
    placeMenu();
    return;
  }
  // сверху: «Слушать вместе» отдельным блоком (только в комнате, together.js), под ним — скорость
  const roomed = (window.Whisper?.ui.trackMenu.build(t, ctx, "top") || 0) > 0;     // core/together.js
  if (bottom) menuSpeed();
  if (roomed || bottom) menuSep();
  if (window.playNext && String(t.id) !== String(queue[current]?.id)) menuItem(ICON.playNext, "Играть следующим", () => window.playNext(t));
  menuItem(ICON.plAdd, "Добавить в плейлист", () => trackMenuPlaylists(t, ctx), { keep: true, arrow: true });
  window.Whisper?.ui.trackMenu.build(t, ctx);   // пункты общих модулей («Сохранить в архив», core/archive.js) — в одной группе с плейлистами
  if (ctx) {
    const p = PL.full.get(ctx.kind), n = p ? p.items.length : 0;
    if (ctx.index > 0) menuItem(ICON.toTop, "Переместить в начало", () => plMoveTrack(ctx.kind, ctx.index, 0, t));
    if (ctx.index < n - 1) menuItem(ICON.toEnd, "Переместить в конец", () => plMoveTrack(ctx.kind, ctx.index, n - 1, t));
    if (cover(t)) menuItem(ICON.image, "Сделать обложкой плейлиста", () => plCoverFromTrack(ctx.kind, t));
    menuItem(ICON.remove, "Удалить из плейлиста", () => plRemoveTrack(ctx.kind, ctx.index, t), { danger: true });
  }
  // «Не рекомендовать автора»: один автор — сразу, несколько (совместный трек) — выбор, кого именно
  const arts = (t.artists || []).filter((a) => a?.id != null && a.name);
  if (arts.length === 1) {
    const a = arts[0], off = dislikedArtists.has(String(a.id));
    menuItem(ICON.dislike, off ? "Снова рекомендовать автора" : "Не рекомендовать автора", () => toggleArtistDislike(a));
  } else if (arts.length > 1) menuItem(ICON.dislike, "Не рекомендовать автора", () => trackMenuArtists(t, ctx, arts), { keep: true, arrow: true });
  // звук одной группой: эквалайзер, устройство вывода, «Звук и формат»
  menuSep();
  if (window.eqOpen) menuItem(ICON.eq || "", "Эквалайзер", () => window.eqOpen());    // eq.js
  if (bottom) {                                                   // только в меню нижней панели:
    window.outMenu?.(t, ctx);                                      // устройство вывода (output.js)
    window.soundMenu?.(t, ctx);                                    // нормализация, качество, формат (sound.js)
  }
  // в самом низу — поделиться (share.js, slot "bottom") и скачать
  menuSep();
  window.Whisper?.ui.trackMenu.build(t, ctx, "bottom");
  menuItem(got.has(String(t.id)) ? ICON.got : ICON.download, got.has(String(t.id)) ? "Уже скачан" : "Скачать трек", () => downloadTrack(t));
  if (got.has(String(t.id))) menuItem(ICON.remove, "Удалить с диска", () => deleteDownload(t), { danger: true });
  placeMenu();
}
// у совместного трека — какого из авторов больше не рекомендовать (уже скрытого — вернуть)
function trackMenuArtists(t, ctx, arts) {
  menuReset();
  menuHead("Не рекомендовать автора", () => trackMenuMain(t, ctx));
  for (const a of arts.slice(0, 8)) {
    const off = dislikedArtists.has(String(a.id));
    menuItem(ICON.dislike, off ? `${a.name} — вернуть` : a.name, () => toggleArtistDislike(a));
  }
  menuNote("Автор больше не попадётся в «Моей волне»");
  placeMenu();
}
async function trackMenuPlaylists(t, ctx) {
  const seq = menuReset();
  menuHead("Добавить в плейлист", () => trackMenuMain(t, ctx));
  menuItem(ICON.plus, "Новый плейлист…", async () => {
    const pl = await plCreateDialog(`С треком «${t.title}»`);
    if (pl) plAddTrack(pl.kind, t);
  });
  const box = document.createElement("div"); box.className = "mscroll"; tmenu.append(box);
  const wait = menuNote("Плейлисты загружаются…", box);
  placeMenu();
  let list;
  try { list = await plLoadList(); }
  catch (e) { if (menuAlive(seq)) { wait.textContent = "Не удалось загрузить плейлисты: " + plErr(e); placeMenu(); } return; }
  if (!menuAlive(seq)) return;
  wait.remove();
  if (!list.length) menuNote("Плейлистов пока нет — создай первый кнопкой выше.", box);
  for (const p of list) {
    const b = menuItem("", p.title, () => plAddTrack(p.kind, t), { to: box });
    b.classList.add("mpl");
    b.prepend(plCoverEl(p, "mthumb"));
    const c = document.createElement("small"); c.textContent = plCount(p.trackCount); b.append(c);
    if (ctx && String(ctx.kind) === String(p.kind)) b.title = "Это текущий плейлист";
  }
  placeMenu();
}

export { openTrackMenu, trackMenuMain, trackMenuBuild, applySpeed, setSpeed, syncSpeedBadge, menuSpeed, clampSpeed, fmtSpeed };

// Закреплённые (кнопка «Закрепить», открепить) и колонка закреплённых сбоку с обложками (renderRail); прокрутка закладок колесом.
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
import { mkImg, safeUrl, ym } from "./base.js";
import { cover } from "./list.js";
import { goTop, renderTabs, roman } from "./nav.js";
import { loadArtist, showAlbum, showArtist } from "../pages/artist.js";
import { showLikes } from "../pages/likes.js";
import { plLoadList, plLocalCover, plYandexCover, showPlaylist } from "../pages/playlists.js";
const $ = (s) => document.querySelector(s);

const pinKey = (type, id) => type + ":" + id;
const isPinned = (type, id) => pins.some((p) => p.type === type && String(p.id) === String(id));
function savePins() { try { localStorage.setItem("ym_pins", JSON.stringify(pins)); } catch {} }
function updatePinBtn() {
  const pb = $("#pinBtn");
  pb.hidden = !pinItem;
  if (!pinItem) return;
  const on = isPinned(pinItem.type, pinItem.id);
  pb.textContent = on ? "✓ Закреплён" : "Закрепить";
  pb.classList.toggle("active", on);
}
function unpin(type, id) {
  const i = pins.findIndex((p) => p.type === type && String(p.id) === String(id));
  if (i >= 0) pins.splice(i, 1);
  savePins(); renderTabs(tabsActive); updatePinBtn();
}
$("#pinBtn").onclick = () => {
  if (!pinItem) return;
  if (isPinned(pinItem.type, pinItem.id)) return unpin(pinItem.type, pinItem.id);
  pins.push({ type: pinItem.type, id: pinItem.id, title: pinItem.title, year: pinItem.year, img: pinItem.img || "" });
  savePins(); renderTabs(tabsActive); updatePinBtn();
};

// ---------- закреплённые колонкой сбоку (Настройки → Интерфейс → Расположение → «Закреплённые: Сбоку») ----------
// Как папки в Telegram: узкая колонка с внешней стороны боковой панели — «Лайки» и закреплённое с обложками.
// Рисуется всегда (вместе с закладками), а показывает её layout.css только при data-ly-pins="side".
const RAIL_HEART = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 20.5 4.6 13.3a4.9 4.9 0 0 1 6.9-7l.5.5.5-.5a4.9 4.9 0 0 1 6.9 7z"/></svg>';
const railImgLoading = new Set();
// обложка закреплённого: своя обложка плейлиста → сохранённая → у Яндекса (и запоминаем её в закреплении)
async function pinImg(p) {
  if (p.type === "playlist") {
    let own = "";
    try { own = await plLocalCover(p.id); } catch {}
    if (own) return own;
  }
  if (p.img) return safeUrl(p.img);
  // в Яндекс ходим, только когда колонка видна (при закладках сверху обложки не нужны)
  if (offline || document.documentElement.getAttribute("data-ly-pins") !== "side") return "";
  const key = pinKey(p.type, p.id);
  if (railImgLoading.has(key)) return "";
  railImgLoading.add(key);
  let url = "";
  try {
    if (p.type === "artist") {
      const { info } = await loadArtist(p.id);
      const u = info?.artist?.cover?.uri || info?.artist?.ogImage;
      url = u ? cover({ coverUri: u }, "200x200") : "";
    } else if (p.type === "album") {
      url = cover(await ym("album", { id: p.id }), "200x200");
    } else if (p.type === "playlist") {
      const pl = (await plLoadList()).find((x) => String(x.kind) === String(p.id));
      url = pl ? plYandexCover(pl) : "";
    }
  } catch {} finally { railImgLoading.delete(key); }
  if (/^https:\/\//.test(url) && pins.includes(p)) { p.img = url; savePins(); }
  return url;
}
function renderRail(active) {
  const rail = $("#pinRail");
  if (!rail) return;
  const keepScroll = rail.scrollTop;
  rail.innerHTML = "";
  const mk = (label, key, fn, { onClose, glyph, html, round, p } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "prail" + (active === key ? " active" : "");
    b.title = label;
    const ic = document.createElement("span");
    ic.className = "prailic" + (round ? " rnd" : "");
    if (html) ic.innerHTML = html;
    else {
      const g = document.createElement("i"); g.textContent = glyph || "♪"; ic.append(g);
      if (p) pinImg(p).then((u) => { if (u && ic.isConnected) { ic.textContent = ""; ic.classList.add("img"); ic.append(mkImg(u)); } }).catch(() => {});
    }
    const t = document.createElement("span"); t.className = "prailtx"; t.textContent = label;
    b.append(ic, t);
    if (onClose) {
      const x = document.createElement("span");
      x.className = "prailx"; x.textContent = "✕"; x.title = "Открепить"; x.setAttribute("role", "button");
      x.onclick = (e) => { e.stopPropagation(); onClose(); };
      b.append(x);
    }
    b.onclick = fn;
    rail.append(b);
  };
  mk("Лайки", "likes", () => { likesQuery = ""; goTop(showLikes); }, { html: RAIL_HEART });
  for (const p of pins) {
    const open = p.type === "artist" ? () => showArtist(p.id) : p.type === "playlist" ? () => showPlaylist(p.id) : () => showAlbum(p.id);
    mk(p.title, pinKey(p.type, p.id), () => goTop(open), {
      onClose: () => unpin(p.type, p.id), p, round: p.type === "artist",
      glyph: p.type === "artist" ? "♪" : p.type === "playlist" ? "♫" : roman(p.year) || "†",
    });
  }
  rail.scrollTop = keepScroll;
  const on = rail.querySelector(".prail.active");
  if (on && (on.offsetTop < rail.scrollTop || on.offsetTop + on.offsetHeight > rail.scrollTop + rail.clientHeight)) on.scrollIntoView({ block: "nearest" });
}
// закладок больше, чем помещается: полоса прокрутки у них скрыта, поэтому их листает обычное колесо мыши
$("#tabs").addEventListener("wheel", (e) => {
  const box = e.currentTarget;
  if (box.scrollWidth <= box.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;      // тачпад листает вбок сам
  e.preventDefault();
  box.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
}, { passive: false });

export { pinKey, isPinned, savePins, updatePinBtn, unpin, renderRail, pinImg };
// обычные скрипты (layout.js) берут это из window
Object.assign(window, { renderRail });

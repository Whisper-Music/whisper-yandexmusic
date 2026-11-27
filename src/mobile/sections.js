// Телефон: нижняя панель с разделами, «Профиль», «Моя волна», свайпы между разделами, тосты и нажатие по строке трека.
import { logoutYandex } from "../app/login.js";
import { goTop, renderTabs, resetView, setActive, setHead } from "../app/nav.js";
const root = document.documentElement;
const opened = () => window.mobileOpened?.();

// ---------- нижняя панель: четыре раздела с подписями ----------
// Волна, Коллекция (лайки, плейлисты, авторы), Друзья, Профиль. Настройки — внутри профиля (кнопка #settingsBtn
// остаётся в разметке, её просто не видно), статистика и студия — тоже оттуда.
function navBar() {
  const lk = document.getElementById("likes");
  if (lk) lk.textContent = "Коллекция";
  // настройки и статистика — части профиля: пока открыты они, подсвечен «Профиль»
  const main = document.querySelector(".app > .main"), pr = document.getElementById("profile");
  if (!main || !pr) return;
  const mark = () => {
    const p = main.dataset.page;
    root.classList.toggle("m-inprofile", p === "settingsBtn" || p === "statsBtn" || p === "studioBtn" || p === "mprofile");
  };
  new MutationObserver(mark).observe(main, { attributes: true, attributeFilter: ["data-page"] });
  mark();
}

// ---------- «Профиль»: аккаунт, статистика и все настройки по разделам ----------
// На компьютере «Профиль» — окошко выбора (Whisper Archive / Яндекс / выйти, main.js). Здесь это страница раздела:
// строится один раз (section.kitpage — resetView в main.js сам прячет её при переходе на другую страницу).
const SET_TABS = [
  ["look", "Оформление", "Стиль, цвета, фон, темы, эффекты"],
  ["ui", "Интерфейс", "Язык, визуализатор, маскот, меню трека"],
  ["play", "Воспроизведение", "Переходы, режим сна, кэш"],
  ["out", "Звук", "Качество, нормализация, формат"],
  ["int", "Интеграции", "Whisper Archive"],
  ["data", "Данные", "Статистика, резервная копия, сброс"],
];
let profSec = null;
function profilePage() {
  const btn = document.getElementById("profile");
  const main = document.querySelector(".app > .main");
  if (!btn || !main) return;
  // перехватываем щелчок раньше обработчика main.js (тот открыл бы окошко выбора)
  btn.addEventListener("click", (e) => { e.stopImmediatePropagation(); e.preventDefault(); openProfile(); }, true);
}
function openProfile() {
  const main = document.querySelector(".app > .main");
  if (!main || typeof goTop !== "function") return;
  goTop(() => {
    setHead({ title: "Профиль" }); setActive("profile", "mprofile"); renderTabs(false); resetView();
    document.getElementById("list").hidden = true;
    if (!profSec) profSec = buildProfile(main);
    profSec.hidden = false;
    fillHero();
  });
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function row(icon, title, sub, fn, danger) {
  const b = el("button", "mprow" + (danger ? " danger" : "")); b.type = "button";
  if (icon) b.append(el("span", "mpico " + icon));
  const tx = el("span", "mptx"); tx.append(el("b", "", title)); if (sub) tx.append(el("small", "", sub));
  b.append(tx);
  if (!danger) b.append(el("span", "mpgo"));
  b.onclick = fn;
  return b;
}
function openSettings(tab, find) {
  document.getElementById("settingsBtn")?.click();
  requestAnimationFrame(() => {
    if (tab) document.querySelector(`#setTabs .chip[data-tab="${tab}"]`)?.click();
    if (find != null) { const f = document.getElementById("setFind"); if (f) { f.value = find; f.dispatchEvent(new Event("input", { bubbles: true })); } }
  });
}
function buildProfile(main) {
  const sec = el("section", "kitpage mprofile"); sec.id = "mProfilePage"; sec.hidden = true;
  const W = window.Whisper;
  // шапка: аватар и ник из Whisper Archive, карандаш — страница профиля архива (там и меняются ник и аватар)
  const hero = el("div", "mphero");
  const av = el("span", "mpav"), nm = el("b", "mpnick"), sb = el("small", "mpsub");
  const tx = el("span", "mptx"); tx.append(nm, sb);
  const pen = el("button", "mppen"); pen.type = "button"; pen.title = "Изменить профиль"; pen.setAttribute("aria-label", "Изменить профиль");
  pen.append(el("span", "mpico i-pen"));
  hero.append(av, tx, pen);
  hero.onclick = () => waOpen();          // и карандаш, и вся шапка — щелчок всплывает сюда
  sec.mpHero = { av, nm, sb };
  // плитки: статистика, архив, студия (если включена)
  const tiles = el("div", "mptiles");
  const tile = (id, icon, title) => {
    const src = document.getElementById(id);
    if (!src) return;
    const b = el("button", "card mptile"); b.type = "button"; b.dataset.src = id;
    b.append(el("span", "mpico " + icon), el("b", "", title));
    b.onclick = () => src.click();
    tiles.append(b);
  };
  tile("statsBtn", "i-stats", "Статистика");
  if (W?.modules?.waprofile) {
    const b = el("button", "card mptile"); b.type = "button"; b.dataset.src = "wa";
    b.append(el("span", "mpico i-wa"), el("b", "", "Мой архив"));
    b.onclick = () => waOpen();
    tiles.append(b);
  }
  tile("studioBtn", "i-studio", "Студия");
  // настройки: поиск (тот же, что на странице настроек) и разделы
  const h = el("h3", "mphead", "Настройки");
  const find = el("label", "mpfind");
  const inp = el("input"); inp.type = "search"; inp.placeholder = "Найти настройку"; inp.autocomplete = "off";
  inp.setAttribute("aria-label", "Найти настройку");
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && inp.value.trim()) { openSettings(null, inp.value.trim()); inp.value = ""; } });
  find.append(el("span", "mpico i-find"), inp);
  const sets = el("div", "card mpgroup");
  for (const [tab, title, sub] of SET_TABS) {
    if (!document.querySelector(`#setTabs .chip[data-tab="${tab}"]`)) continue;
    sets.append(row("i-" + tab, title, sub, () => openSettings(tab)));
  }
  sets.append(row("i-ya", "Яндекс ID", "Аккаунт Яндекса — откроется сайт", () => { try { window.__TAURI__.opener.openUrl("https://id.yandex.ru/"); } catch {} }));
  const out = row(null, "Выйти из Яндекса", null, () => { if (typeof logoutYandex === "function") logoutYandex(); }, true);
  sec.append(hero, tiles, h, find, sets, out);
  main.append(sec);
  return sec;
}
// архив подключён — его страница профиля; нет — окно входа (после входа шапка заполнится)
async function waOpen() {
  const W = window.Whisper;
  if (W?.modules?.archive?.connected?.() === false && typeof W.modules.archive.login === "function") {
    try { await W.modules.archive.login("Чтобы открыть профиль"); } catch {}
    fillHero(true);
    return;
  }
  W?.modules?.waprofile?.open();
}
// ник и аватар — те же команды, что у страницы профиля ядра (whisper/profile.rs); без архива поля пустые
let heroMe = null, heroAt = 0, heroAv = "";
async function fillHero(force) {
  const h = profSec?.mpHero;
  if (!h) return;
  const paint = (me) => {
    h.nm.textContent = me?.nickname || "";
    h.sb.textContent = me ? "Whisper Archive · Яндекс Музыка" : "Войди в Whisper Archive";
    h.av.textContent = "";
    h.av.classList.toggle("empty", !me);
    if (me) h.av.append(el("b", "", (String(me.nickname || "?").trim()[0] || "?").toUpperCase()));
    if (heroAv) { const i = el("img"); i.alt = ""; i.src = heroAv; h.av.append(i); }
  };
  paint(heroMe);
  if (!force && Date.now() - heroAt < 60000) return;
  heroAt = Date.now();
  const inv = window.__TAURI__.core.invoke;
  let me = null;
  try {
    if (await inv("wa_token_exists")) {
      const r = await inv("wa_my_profile");
      if (r.status >= 200 && r.status < 300) me = JSON.parse(r.body || "null");
    }
  } catch {}
  if ((me?.avatar || "") !== (heroMe?.avatar || "") || !me) {
    if (heroAv) { URL.revokeObjectURL(heroAv); heroAv = ""; }
    const m = /^\/api\/users\/([0-9a-f-]{36})\/avatar(?:\?v=([0-9a-f]{1,16}))?$/i.exec(String(me?.avatar || ""));
    if (m) { try { heroAv = URL.createObjectURL(new Blob([await inv("wa_image", { kind: "avatar", id: m[1], v: m[2] || null })])); } catch {} }
  }
  heroMe = me;
  paint(me);
}

// ---------- «Моя волна»: одна главная кнопка, остальное — коротко ----------
// «Жанры и настроения» — кнопка «Настроить волну» (лист снизу, mobile.css), «История прослушивания» — ссылкой
function wavePage() {
  // main.js возвращает надпись «Жанры и настроения», когда закрывают список или сбрасывают станцию, — меняем каждый раз
  const st = document.getElementById("stBtn");
  const name = () => { if (st && st.textContent.trim() === "Жанры и настроения") st.textContent = "Настроить волну"; };
  if (st) { name(); new MutationObserver(name).observe(st, { childList: true, characterData: true, subtree: true }); }
  const fix = () => { const s = document.querySelector("#waveQBtn span"); if (s && s.textContent !== "История") s.textContent = "История"; };
  fix(); setTimeout(fix, 1500);           // кнопку очереди модуль ядра ставит сам — может появиться позже
}

// ---------- тосты: над мини-плеером, во всю ширину (mobile.css) ----------
// Высота — по верху мини-плеера (или нижней панели, если плеер скрыт) в момент показа: у тем и на разных
// телефонах она разная. Нажатие по плашке (не по кнопке действия) — скрыть её сразу.
function toastSpot() {
  const t = document.querySelector("body > .toast") || document.querySelector(".toast");
  if (!t) return;
  const place = () => {
    if (t.hidden) return;
    const pl = document.querySelector(".app > .player"), nav = document.querySelector(".app > .side");
    const vis = (e) => { const r = e?.getBoundingClientRect(); return r && r.height > 20 && r.top < innerHeight ? r : null; };
    // открыт плеер на весь экран — внизу его кнопки: тост сверху, под строкой состояния
    const full = document.getElementById("full");
    if (full && !full.hidden) {
      const top = parseFloat(getComputedStyle(root).getPropertyValue("--sys-top")) || 0;
      t.style.setProperty("--m-toast-b", Math.round(innerHeight - top - 60 - t.offsetHeight) + "px");
      return;
    }
    const r = vis(pl) || vis(nav);
    if (r) t.style.setProperty("--m-toast-b", Math.round(innerHeight - r.top + 8) + "px");
  };
  new MutationObserver(place).observe(t, { attributes: true, attributeFilter: ["hidden"] });
  t.addEventListener("click", (e) => { if (!e.target.closest(".tact")) t.hidden = true; });
}

// ---------- строка трека: нажатие — играть ----------
// На компьютере название в строке ведёт в альбом, имя исполнителя — к исполнителю. На телефоне по строке целиком
// попадают пальцем, и вместо музыки открывалась чужая страница. Здесь любое место строки (кроме ♡ и «⋯») играет
// тот список, где строка: лайки, плейлист, альбом — с этого трека (li.onclick из main.js → renderList).
// К альбому и исполнителю — из плеера на весь экран (название и исполнитель там — ссылки).
function rowTap() {
  document.addEventListener("click", (e) => {
    const x = e.target.closest?.(".list li .t, .list li .a");
    if (!x) return;
    const li = x.closest("li");
    if (typeof li?.onclick !== "function") return;     // у строки нет «играть по нажатию» — как было
    e.stopPropagation(); e.preventDefault();
    li.click();
  }, true);
}

// Свайп влево-вправо по странице — соседний раздел нижней панели (Волна ↔ Коллекция ↔ Друзья ↔ Профиль).
// Не мешаем тому, что листается вбок само (ленты вкладок, ползунки, поля ввода), окнам и плееру на весь экран.
function swipes() {
  const ORDER = ["wave", "likes", "friendsBtn", "profile"];
  const main = document.querySelector(".app > .main");
  if (!main) return;
  let s = null;
  const sideways = (el) => {
    for (let n = el; n && n !== main; n = n.parentElement) {
      if (n.matches?.("input, textarea, select, [contenteditable], .chips, .lyseg, .plbar, .settabs, .eqpresets, .stations")) return true;
      if (n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  main.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    s = e.touches.length === 1 && !sideways(e.target) && !opened() ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.at;
    s = null;
    if (dt > 700 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
    let cur = ORDER.findIndex((id) => document.getElementById(id)?.classList.contains("active"));
    if (cur < 0 && root.classList.contains("m-inprofile")) cur = ORDER.indexOf("profile");   // настройки, статистика
    if (cur < 0) return;                           // открыт не раздел, а страница внутри (альбом, артист) — свайпом не уходим
    const next = ORDER[cur + (dx < 0 ? 1 : -1)];
    if (next) document.getElementById(next)?.click();
  }, { passive: true });
}

// «Назад» телефона (mobile/mobile.js) из настроек возвращает в профиль
if (window.isMobile) window.mobileProfile = openProfile;

export { navBar, profilePage, openProfile, wavePage, toastSpot, rowTap, swipes, el };

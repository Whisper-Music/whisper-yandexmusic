// Общие элементы интерфейса: всплывающее меню (меню трека и любые меню модулей — openMenu, menuItem, menuSep…),
// подсказка-тост внизу (showToast) и окно-диалог (modal). Ими пользуются почти все модули.
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке создаёт элементы меню и тоста и вешает обработчики (свой $).
// tmenuBtn и menuFilter — свойства window: их читают и пишут другие скрипты (tmenu.js, yandex.js, app/trackmenu.js).
// Наружу — через window в конце.
const $ = (s) => document.querySelector(s);

const tmenu = document.createElement("div");
tmenu.className = "tmenu"; tmenu.hidden = true;
document.body.append(tmenu);
window.tmenuBtn = null;      // кнопка, у которой открыто меню (свойство window: её читают tmenu.js, yandex.js, trackmenu.js)
let menuSeq = 0;
// меню по правому щелчку (tmenu.js) открывается у курсора, а не у «⋯» справа: точку кладут в window.menuPoint
// прямо перед щелчком по «⋯», openMenu её забирает, placeMenu ставит меню от неё (и при перестройке — подменю)
let menuAt = null;
function closeTrackMenu() {
  if (tmenu.hidden) return;
  menuSeq++;
  tmenu.hidden = true; tmenu.textContent = "";
  tmenuBtn?.classList.remove("open"); tmenuBtn = null; menuAt = null;
}
function openMenu(btn, build) {
  const pt = window.menuPoint; window.menuPoint = null;
  if (tmenuBtn === btn) return closeTrackMenu();
  closeTrackMenu();
  menuAt = pt || null;
  tmenuBtn = btn; btn.classList.add("open"); tmenu.hidden = false;
  build(menuSeq);
}
function menuReset() { tmenu.textContent = ""; return ++menuSeq; }
const menuAlive = (seq) => !tmenu.hidden && seq === menuSeq;
// пункты меню трека, которые пользователь скрыл (Интерфейс → «Меню трека», tmenu.js): пока строится главное меню,
// такой пункт не попадает в меню — вызывающему отдаётся кнопка вне документа (на неё можно ставить disabled и т.п.)
window.menuFilter = false;   // включает trackMenuMain (app/trackmenu.js)
function menuItem(icon, text, fn, { keep = false, arrow = false, danger = false, to = tmenu } = {}) {
  const b = document.createElement("button");
  if (menuFilter && window.tmenuHidden?.(text)) return b;
  b.className = "mi" + (danger ? " danger" : "");
  b.innerHTML = icon || ""; const s = document.createElement("span"); s.className = "mt"; s.textContent = text; b.append(s);
  if (arrow) b.insertAdjacentHTML("beforeend", '<i class="miarrow">›</i>');
  b.onclick = (e) => { e.stopPropagation(); if (!keep) closeTrackMenu(); fn(); };
  to.append(b);
  return b;
}
function menuHead(text, back) {
  const h = document.createElement("div"); h.className = "mhead";
  const b = document.createElement("button"); b.className = "mback"; b.textContent = "←"; b.title = "Назад";
  b.onclick = (e) => { e.stopPropagation(); back(); };
  const s = document.createElement("b"); s.textContent = text;
  h.append(b, s); tmenu.append(h);
}
function menuNote(text, to = tmenu) { const p = document.createElement("p"); p.className = "mnote"; p.textContent = text; to.append(p); return p; }
// разделитель не ставится первым и два подряд (пункты в меню добавляются по условиям)
function menuSep() {
  const last = tmenu.lastElementChild;
  if (!last || last.classList.contains("msep")) return;
  const i = document.createElement("hr"); i.className = "msep"; tmenu.append(i);
}
function placeMenu() {
  if (tmenu.hidden || !tmenuBtn) return;
  const m = tmenu.getBoundingClientRect();
  if (menuAt) {
    // у курсора: вправо-вниз от него, у края окна — влево / вверх
    const left = menuAt.x + m.width + 8 <= innerWidth ? menuAt.x : Math.max(8, menuAt.x - m.width);
    const top = menuAt.y + m.height + 8 <= innerHeight ? menuAt.y : Math.max(8, menuAt.y - m.height);
    tmenu.style.left = left + "px"; tmenu.style.top = top + "px";
    return;
  }
  const r = tmenuBtn.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8));
  const below = r.bottom + 6 + m.height <= innerHeight - 8;
  const top = below ? r.bottom + 6 : Math.max(8, r.top - m.height - 6);
  tmenu.style.left = left + "px"; tmenu.style.top = top + "px";
}
document.addEventListener("pointerdown", (e) => { if (!tmenu.hidden && !tmenu.contains(e.target) && !tmenuBtn?.contains(e.target)) closeTrackMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTrackMenu(); });
window.addEventListener("resize", closeTrackMenu);
document.addEventListener("scroll", (e) => { if (!tmenu.contains(e.target)) closeTrackMenu(); }, true);

const toast = document.createElement("div");
toast.className = "toast"; toast.hidden = true;
toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite");
document.body.append(toast);
let toastTimer = 0;
// Подсказка — во внутреннем углу между боковой панелью и плеером (там, где они сходятся), а не посреди окна:
// так она не закрывает список и обложку. Место меряем на каждый показ — у тем и «Расположения» панели где угодно.
// Плеер не снизу, боковая панель спрятана или узкое окно — переменные снимаются, и CSS ставит её по центру.
function placeToast() {
  const vars = ["--toast-l", "--toast-r", "--toast-b", "--toast-t", "--toast-w"];
  const clear = () => vars.forEach((v) => toast.style.removeProperty(v));
  const side = document.querySelector(".app > .side") || document.querySelector(".side");
  const pl = document.querySelector(".player");
  if (!side || !pl || innerWidth < 700) return clear();
  const rs = side.getBoundingClientRect(), rp = pl.getBoundingClientRect();
  const shown = (r) => r.width > 40 && r.height > 40;
  if (!shown(rs) || !shown(rp) || rp.top < innerHeight * 0.5 || rs.bottom < innerHeight * 0.5) return clear();
  const gap = 12, onRight = rs.left + rs.width / 2 > innerWidth / 2;
  const room = onRight ? rs.left - gap * 2 : innerWidth - rs.right - gap * 2;
  if (room < 260) return clear();
  const set = (k, v) => toast.style.setProperty(k, v);
  set("--toast-b", Math.round(innerHeight - rp.top + gap) + "px");
  set("--toast-t", "none");
  set("--toast-w", Math.round(Math.min(560, room)) + "px");
  if (onRight) { set("--toast-l", "auto"); set("--toast-r", Math.round(innerWidth - rs.left + gap) + "px"); }
  else { set("--toast-l", Math.round(rs.right + gap) + "px"); set("--toast-r", "auto"); }
}
addEventListener("resize", () => { if (!toast.hidden) placeToast(); });
function showToast(text, ms = 3500, { kind = "", action = null } = {}) {
  toast.textContent = "";
  toast.className = "toast" + (kind ? " " + kind : "");
  if (kind) { const ic = document.createElement("i"); ic.className = "tico"; ic.textContent = kind === "ok" ? "✓" : "✕"; toast.append(ic); }
  const s = document.createElement("span"); s.textContent = text; toast.append(s);
  if (action) {
    const b = document.createElement("button"); b.className = "tact"; b.textContent = action.label;
    b.onclick = () => { toast.hidden = true; clearTimeout(toastTimer); action.fn(); };
    toast.append(b);
  }
  try { placeToast(); } catch {}
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}
const hideToast = () => { clearTimeout(toastTimer); toast.hidden = true; };

function modal({ title, text = "", input = null, check = null, ok = "Готово", danger = false }) {
  closeTrackMenu();
  return new Promise((resolve) => {
    const wrap = document.createElement("div"); wrap.className = "login modal";
    const box = document.createElement("form"); box.className = "panel login-box modalbox"; box.noValidate = true;
    const h = document.createElement("h2"); h.textContent = title; box.append(h);
    if (text) { const p = document.createElement("p"); p.textContent = text; box.append(p); }
    let inp = null, cb = null;
    if (input) {
      inp = document.createElement("input"); inp.type = "text"; inp.className = "field";
      inp.maxLength = input.max || 100; inp.placeholder = input.placeholder || ""; inp.value = input.value || "";
      box.append(inp);
    }
    if (check) {
      const l = document.createElement("label"); l.className = "switch";
      cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!check.checked;
      const sp = document.createElement("span"); sp.textContent = check.label;
      l.append(cb, document.createElement("i"), sp); box.append(l);
    }
    const err = document.createElement("p"); err.className = "status"; box.append(err);
    const row = document.createElement("div"); row.className = "row";
    const no = document.createElement("button"); no.type = "button"; no.className = "nav"; no.textContent = "Отмена";
    const yes = document.createElement("button"); yes.type = "submit"; yes.className = "nav active" + (danger ? " danger" : ""); yes.textContent = ok;
    row.append(no, yes); box.append(row);
    const done = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    no.onclick = () => done(null);
    wrap.onpointerdown = (e) => { if (e.target === wrap) done(null); };
    box.onsubmit = (e) => {
      e.preventDefault();
      if (inp && !inp.value.trim()) { err.textContent = input.empty || "Введи название"; inp.focus(); return; }
      done({ value: inp ? inp.value.trim() : "", checked: cb ? cb.checked : false });
    };
    wrap.append(box); document.body.append(wrap);
    (inp || yes).focus(); inp?.select();
  });
}

export { tmenu, closeTrackMenu, openMenu, menuReset, menuAlive, menuItem, menuHead, menuNote, menuSep, placeMenu, toast, showToast,
  hideToast, modal };
// обычные скрипты (layout.js, ядро Whisper, boot.js…) и обращения window.X — берут это из window
Object.assign(window, { closeTrackMenu, showToast });

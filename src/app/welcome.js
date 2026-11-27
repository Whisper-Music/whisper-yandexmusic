// Знакомство при первом запуске и «Что нового».
// Знакомство — 3–4 шага поверх окна входа: стиль, вход в Яндекс, где темы, Ctrl+K. Только для нового человека (ещё не
// входил и не проходил знакомство: localStorage ym_welcome, ym_uid); открыть заново — window.welcomeOpen().
// «Что нового» — карточка в углу после обновления (версии новее ym_seen_version) и окно со всей историей
// (window.whatsNew: версия под «Профилем» #sideVer, кнопка в Настройках → Приложение → «Обновления», пункт командной
// строки). Тексты — app/changes.js.
import { CHANGES } from "./changes.js";
import { showLogin } from "./login.js";

const SEEN_KEY = "ym_seen_version", WELCOME_KEY = "ym_welcome", TIP_KEY = "ym_palette_tip";
const t = (s) => window.i18n?.t?.(s) ?? s;
const lang = () => (window.i18n?.lang === "en" ? "en" : "ru");
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (cls, text, fn) => { const b = mk("button", cls, text); b.type = "button"; b.onclick = fn; return b; };
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
// «1.10.0» новее «1.9.2»
function cmp(a, b) {
  const x = String(a).split(".").map((n) => parseInt(n, 10) || 0), y = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}
const fmtDate = (d) => (d ? d.split("-").reverse().join(".") : "");
async function appVersion() {
  // во вкладке браузерной версии ответа может не быть вовсе — ждём недолго
  const ask = Promise.resolve(window.__TAURI__?.app?.getVersion?.()).catch(() => null);
  const v = await Promise.race([ask, new Promise((r) => setTimeout(() => r(null), 1500))]);
  if (v) return String(v);
  return CHANGES[0].v;
}

// ---------- изменения: одна версия ----------
function versionEl(c) {
  const sec = mk("section", "wnver");
  sec.dataset.noi18n = "";                          // тексты уже на нужном языке (changes.js)
  const h = mk("h4");
  h.append(mk("b", "", c.v));
  if (c.title) h.append(mk("span", "wntitle", c.title[lang()] || c.title.ru));
  if (c.date) h.append(mk("small", "", fmtDate(c.date)));
  const ul = mk("ul");
  for (const s of c[lang()] || c.ru) ul.append(mk("li", "", s));
  sec.append(h, ul);
  return sec;
}

// ---------- окно со всей историей ----------
function openHistory() {
  document.querySelector(".wncard")?.remove();
  const list = mk("div", "wnlist");
  for (const c of CHANGES) list.append(versionEl(c));
  window.openDetails?.({ title: t("Что нового"), sub: t("Изменения по версиям"), body: list });
}

// ---------- карточка после обновления ----------
function showCard(list, cur) {
  document.querySelector(".wncard")?.remove();
  const card = mk("div", "panel wncard");
  card.setAttribute("role", "dialog");
  const head = mk("div", "wnhead");
  head.append(mk("b", "", `${t("Что нового в")} ${cur}`), btn("wnx", "✕", () => card.remove()));
  head.lastChild.title = t("Закрыть");
  const body = mk("div", "wnbody");
  for (const c of list.slice(0, 3)) body.append(versionEl(c));
  const row = mk("div", "row");
  row.append(btn("nav", t("Все изменения"), openHistory), btn("nav active", t("Хорошо"), () => card.remove()));
  card.append(head, body, row);
  document.body.append(card);
}

// ---------- знакомство ----------
const STYLES = [["neon", "Неон"], ["royal", "Королевский"], ["steam", "Стимпанк"], ["lolitta", "Lolitta"]];
let wlc = null;
const loggedIn = () => !!window.uid && !!document.getElementById("login")?.classList.contains("hidden");

function openWelcome(at = 0) {
  if (wlc) return;
  const wrap = mk("div", "login modal wlc");
  const box = mk("div", "panel login-box modalbox wlcbox");
  box.setAttribute("role", "dialog");
  wrap.append(box);
  let step = at, waitLogin = null;

  const finish = () => {
    ls.set(WELCOME_KEY, "1"); ls.set(TIP_KEY, "1");         // про Ctrl+K рассказали — отдельная подсказка не нужна
    waitLogin?.disconnect();
    window.removeEventListener("keydown", onKey, true);
    wrap.remove(); wlc = null;
  };
  const onKey = (e) => {
    if (wrap.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (e.key === "Enter" && !e.target.closest?.("button")) { e.preventDefault(); next(); }
  };
  // вход: прячем знакомство, окно входа приложения — сверху; вошёл (окно входа скрылось) — продолжаем с тем
  function login() {
    const lg = document.getElementById("login");
    wrap.classList.add("hidden");
    if (lg?.classList.contains("hidden")) showLogin();
    waitLogin?.disconnect();
    waitLogin = new MutationObserver(() => {
      if (!lg.classList.contains("hidden")) return;
      waitLogin.disconnect(); waitLogin = null;
      wrap.classList.remove("hidden");
      step = 2; paint();
    });
    waitLogin.observe(lg, { attributes: true, attributeFilter: ["class"] });
  }

  const steps = [
    () => {
      const grid = mk("div", "wlcstyles");
      const mark = () => grid.querySelectorAll(".wlcstyle").forEach((b) => b.classList.toggle("on", b.dataset.style === document.documentElement.dataset.style));
      for (const [id, name] of STYLES) {
        const card = document.querySelector(`.stylecard[data-style="${id}"]`);
        const b = btn("wlcstyle", "", () => { card?.click(); mark(); });
        b.dataset.style = id;
        b.append(mk("span", `sprev sp-${id}`), mk("b", "", card?.querySelector(".scname")?.textContent || name));
        grid.append(b);
      }
      mark();
      return { title: t("Привет! Это Whisper"), text: t("Клиент Яндекс Музыки, который можно переодеть как угодно. Начни со стиля — сменить его можно в любой момент."), body: grid };
    },
    () => (loggedIn()
      ? { title: t("Вход в Яндекс Музыку"), text: t("Ты уже вошёл — лайки, Моя волна и плейлисты на месте.") }
      : { title: t("Вход в Яндекс Музыку"), text: t("Лайки, Моя волна и плейлисты берутся из твоего аккаунта. Пароль вводится на странице Яндекса — приложение его не видит."),
          body: btn("nav active wlcbig", t("Войти"), login) }),
    () => ({ title: t("Темы"), text: t("Кроме встроенных стилей есть «Библиотека тем» — темы сообщества и артистов. Она в Настройках → Оформление, а файл темы .wmt можно просто перетащить в окно."),
      body: window.themeLibOpen ? btn("nav wlcbig", t("Открыть библиотеку"), () => { finish(); window.themeLibOpen(); }) : null }),
    ...(window.isMobile ? [] : [() => {
      const ul = mk("ul", "wlckeys");
      for (const [k, s] of [["Ctrl+K", "Командная строка: любая настройка, страница, команда или трек"], ["F1", "Все клавиши"], ["", "Что изменилось — Настройки → Приложение → «Что нового…»"]]) {
        const li = mk("li");
        if (k) li.append(mk("kbd", "", k));
        li.append(mk("span", "", t(s)));
        ul.append(li);
      }
      return { title: t("Всё под рукой"), body: ul };
    }]),
  ];
  const next = () => { if (step < steps.length - 1) { step++; paint(); } else finish(); };

  function paint() {
    const s = steps[step]();
    box.textContent = "";
    const dots = mk("div", "wlcdots");
    steps.forEach((_, i) => dots.append(mk("i", i === step ? "on" : "")));
    box.append(dots, mk("h2", "", s.title));
    if (s.text) box.append(mk("p", "wlctext", s.text));
    if (s.body) box.append(s.body);
    const row = mk("div", "row wlcnav");
    row.append(step > 0 ? btn("nav", t("Назад"), () => { step--; paint(); }) : btn("nav wlcskip", t("Пропустить"), finish));
    row.append(btn("nav active", step < steps.length - 1 ? t("Дальше") : t("Начать"), next));
    box.append(row);
    row.lastChild.focus();
  }

  window.addEventListener("keydown", onKey, true);
  document.body.append(wrap);
  wlc = wrap;
  paint();
}

// ---------- при запуске ----------
// Новый человек — знакомство; обновился — карточка «Что нового» с версиями после той, что видел. Во вкладке
// браузерной версии — ничего: окно приложения уже всё показало (вкладка — копия его настроек).
async function start() {
  const cur = await appVersion();
  const ver = document.getElementById("sideVer");      // версия под «Профилем» — кнопка «Что нового»
  if (ver) ver.textContent = "v" + cur;
  if (window.__WEB__) return;
  const seen = ls.get(SEEN_KEY);
  const fresh = !ls.get(WELCOME_KEY) && !ls.get("ym_uid");
  ls.set(SEEN_KEY, cur);
  if (fresh) { setTimeout(() => openWelcome(), 400); return; }
  ls.set(WELCOME_KEY, "1");
  // первый запуск с «Что нового» (seen ещё нет) — показываем только текущую версию
  const list = CHANGES.filter((c) => cmp(c.v, cur) <= 0 && (seen ? cmp(c.v, seen) > 0 : cmp(c.v, cur) === 0));
  if (list.length) setTimeout(() => showCard(list, cur), 2500);
}
if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });

document.addEventListener("click", (e) => { if (e.target.closest?.("#updHistory, #sideVer")) openHistory(); });
window.whatsNew = openHistory;
window.welcomeOpen = openWelcome;

export { openHistory, openWelcome };

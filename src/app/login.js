// Вход в Яндекс: токен в хранилище (keyring), перенос старого токена, вход через браузер и вручную, «Профиль» (Whisper Archive /
// Яндекс ID / выйти), выход и забывание данных аккаунта, плашка «нужна подписка Плюс», первая страница (startPage).
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце. Порядок запуска (есть токен → startPage…) — в конце main.js.
import { invoke, OAUTH_URL, ym } from "./base.js";
import { modal, showToast } from "./menu.js";
import { goTop } from "./nav.js";
import { IDB } from "../look/bg.js";
import { showWave } from "../pages/wave.js";
import { restorePlayer } from "../player/core.js";
import { loadDislikedIds, loadLikedIds } from "../player/like.js";
const $ = (s) => document.querySelector(s);

const LEGACY_TOKEN_KEY = "ym_token";
async function tokenExists() {
  try { return !!(await invoke("token_exists")); } catch { return null; }
}
async function migrateLegacyToken() {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return "";
  try {
    await invoke("token_store", { token: legacy });
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return "";
  } catch (e) {
    const m = String(e?.message || e);
    console.error("Перенос старого токена не удался:", m);
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}
    return /неправильно/i.test(m)
      ? "Сохранённый токен из старой версии повреждён и удалён — войди заново."
      : "Не удалось перенести токен из старой версии в системное хранилище (" + m + "). Из соображений безопасности он удалён — войди заново.";
  }
}

// Плашка в заголовке окна: подписка Яндекс Плюс не активна (нет Плюса — не работают часть функций и качество).
// Состояние берём из /account/status: result.plus.hasPlus. Нет поля — ничего не показываем.
const PLUS_URL = "https://plus.yandex.ru/";
function updatePlusNotice(st) {
  const el = $("#plusNotice");
  if (!el) return;
  const has = st?.plus?.hasPlus;
  const inactive = has === false;
  el.hidden = !inactive;
  if (inactive) {
    $("#plusNoticeText").textContent = "Подписка Яндекс Плюс не активна. Проверьте оплату или оформите подписку";
    el.title = "Открыть страницу Яндекс Плюса";
  }
}
$("#plusNotice")?.addEventListener("click", () => { try { window.__TAURI__.opener.openUrl(PLUS_URL); } catch {} });
async function refreshPlusNotice() {
  if (!uid || offline) return;
  try { updatePlusNotice(await ym("account_status")); } catch {}
}
setInterval(refreshPlusNotice, 30 * 60 * 1000);
{
  let lastFocusCheck = 0;
  window.addEventListener("focus", () => { if (Date.now() - lastFocusCheck > 5 * 60 * 1000) { lastFocusCheck = Date.now(); refreshPlusNotice(); } });
}

async function finishLogin() {
  try {
    const st = await ym("account_status");
    uid = st.account.uid;
    updatePlusNotice(st);
  } catch (e) {
    if (/^HTTP 40[13]/.test(String(e?.message))) { try { await invoke("token_clear"); } catch {} }
    throw e;
  }
  localStorage.setItem("ym_uid", uid);
  warnPlainSecrets();
}
// Linux без «связки ключей» (Secret Service): токены лежат в файле открытым текстом (права 0600).
// Не молчим об этом (аудит F-08). Как только связка ключей появится, Rust сам перенесёт токен туда.
let plainWarned = false;
async function warnPlainSecrets() {
  if (plainWarned) return;
  let b = null;
  try { b = await invoke("secret_backend"); } catch { return; }
  if (b?.ym !== "file" && b?.wa !== "file") return;
  plainWarned = true;
  showToast("Нет системной связки ключей: токен сохранён в файл в папке настроек (открытым текстом, доступ только у тебя). "
    + "Установи GNOME Keyring, KWallet или KeePassXC — токен переедет туда сам.", 15000, { kind: "err" });
}
window.warnPlainSecrets = warnPlainSecrets;
function showLogin(msg = "") { $("#login").classList.remove("hidden"); $("#loginErr").textContent = msg; }
// первая страница после запуска и входа — выбранная в «Интерфейс → Панели → Стартовая страница» (panels.js,
// localStorage ym_start: wave | likes | stats | studio | last), по умолчанию «Моя волна».
// Кнопки «Статистика» и «Студия» получают обработчики в своих модулях (после main.js) — до DOMContentLoaded ждём.
let domReady = false;
document.addEventListener("DOMContentLoaded", () => { domReady = true; });
function startPage() {
  let p = "wave";
  try { p = localStorage.getItem("ym_start") || "wave"; if (p === "last") p = localStorage.getItem("ym_start_last") || "wave"; } catch {}
  const id = { likes: "likes", stats: "statsBtn", studio: "studioBtn", friends: "friendsBtn" }[p];
  if (!id) return goTop(showWave);
  const go = () => {
    const b = $("#" + id);
    // кнопку спрятали (глазик в «Панелях», модуль выключен) — значит, и страницы этой нет: тогда «Моя волна»
    if (b && !b.hidden && !b.classList.contains("sidehide") && getComputedStyle(b).display !== "none") b.click();
    else goTop(showWave);
  };
  if (domReady) go(); else document.addEventListener("DOMContentLoaded", go, { once: true });
}
function afterLogin() { $("#login").classList.add("hidden"); startPage(); restorePlayer(); loadLikedIds(); loadDislikedIds(); }

$("#oauthBtn").onclick = async () => {
  const btn = $("#oauthBtn");
  btn.disabled = true;
  $("#loginErr").textContent = "Войди в аккаунт Яндекса в открывшемся окне — оно закроется само.";
  try {
    await invoke("yandex_login");
    await finishLogin();
    $("#loginErr").textContent = "";
    afterLogin();
  } catch (e) {
    const m = String(e?.message || e);
    if (/not found/i.test(m)) { $("#manual").open = true; showLogin("В этой сборке нет автоматического входа: обнови Rust-часть (auth.rs, net.rs) или войди вручную по токену ниже."); }
    else if (/закрыто|уже открыто/.test(m)) showLogin(m + ".");
    else showLogin("Не удалось войти: " + m);
  } finally { btn.disabled = false; }
};

$("#getToken").onclick = (e) => { e.preventDefault(); window.__TAURI__.opener.openUrl(OAUTH_URL); };
$("#loginBtn").onclick = async () => {
  try {
    await invoke("token_store", { token: $("#tokenInput").value });
    $("#tokenInput").value = "";
    await finishLogin();
    afterLogin();
  } catch (e) { showLogin("Не удалось войти: " + (e?.message || e)); }
};
// «Профиль»: выбор — Whisper Archive (страница в приложении, core/profile.js) или Яндекс (сайт id.yandex.ru в браузере);
// там же — «Выйти из Яндекса»
$("#profile").onclick = () => {
  if (document.querySelector(".modal")) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const wrap = el("div", "login modal");
  const box = el("div", "panel login-box modalbox prochoose");
  box.append(el("h2", "", "Профиль"));
  const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const opt = (icon, title, sub, fn) => {
    const b = el("button", "addopt"); b.type = "button";
    const i = el("span", "addico", icon), tx = el("span");
    tx.append(el("b", "", title), el("small", "", sub));
    b.append(i, tx);
    b.onclick = () => { close(); fn(); };
    return b;
  };
  const list = el("div", "addopts");
  if (window.Whisper?.modules?.waprofile) list.append(opt("W", "Whisper Archive", "Здесь, в приложении: альбомы, лайки, друзья, ник и аватар", () => window.Whisper.modules.waprofile.open()));
  list.append(opt("Я", "Яндекс", "Откроется сайт Яндекс ID в браузере", () => { try { window.__TAURI__.opener.openUrl("https://id.yandex.ru/"); } catch {} }));
  const row = el("div", "row");
  const out = el("button", "nav danger", "Выйти из Яндекса"); out.type = "button"; out.onclick = () => { close(); logoutYandex(); };
  const no = el("button", "nav", "Отмена"); no.type = "button"; no.onclick = close;
  row.append(out, no);
  box.append(list, row);
  wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
  document.addEventListener("keydown", onKey, true);
  wrap.append(box); document.body.append(wrap);
  list.querySelector("button")?.focus();
};
// выход из аккаунта — только после подтверждения в окне (Esc, «Отмена» или клик мимо окна — остаёмся)
async function logoutYandex() {
  const ok = await modal({
    title: "Выйти из аккаунта?",
    text: "Вход будет сброшен на этом компьютере. Чтобы снова слушать музыку, нужно будет войти в Яндекс заново.",
    ok: "Выйти", danger: true,
  });
  if (!ok) return;
  // token_clear удаляет токен из системного хранилища и cookies Яндекса (иначе Яндекс пускал бы в аккаунт без пароля)
  try { await invoke("token_clear"); }
  catch (e) { showToast("Не удалось удалить токен из системного хранилища: " + (e?.message || e) + ". Выход не выполнен — попробуй ещё раз.", 6000, { kind: "err" }); return; }   // не делаем вид, что вышли
  await forgetAccountData();
  location.reload();
}
// Всё, что относится к аккаунту: очередь и место в треке, лайки, закладки, станция волны, «уже слышал», история
// прослушивания и поиска, свои обложки плейлистов. Настройки приложения, стили и скачанные треки остаются.
const ACCOUNT_KEYS = ["ym_uid", "ym_last", "ym_liked_ids", "ym_pins", "ym_heard", "ym_wave_seed", "ym_wave_pins", "ym_liked_artists", "ym_disliked_artists", "ym_search_hist", "ym_search_picks", "ym_history"];
async function forgetAccountData() {
  for (const k of [...ACCOUNT_KEYS, LEGACY_TOKEN_KEY]) { try { localStorage.removeItem(k); } catch {} }
  try {
    await IDB.tx("readwrite", (s) => {
      const r = s.openCursor();
      r.onsuccess = () => { const c = r.result; if (!c) return; if (/^(plcover|likes):/.test(String(c.key))) c.delete(); c.continue(); };
      return null;
    });
  } catch {}
}

export { tokenExists, migrateLegacyToken, updatePlusNotice, refreshPlusNotice, finishLogin, warnPlainSecrets, showLogin, startPage,
  afterLogin, logoutYandex, forgetAccountData };
// обычные скрипты (layout.js, ядро Whisper, boot.js…) и обращения window.X — берут это из window
Object.assign(window, { warnPlainSecrets });

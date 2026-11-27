// Командная строка (Ctrl+K): одно поле посреди экрана — страницы, настройки, стили, действия, команды консоли и треки.
// Ищет сразу по всему; Enter — выполнить выбранное, ↑/↓ — выбрать, Tab — дополнить, Esc — закрыть.
// Команды — те же, что у консоли (look/cli.js, cliKit.CMDS): «vol 50», «sleep 30», «next»… Их вывод — здесь же, под списком.
// Настройки — из look/settings/setpage.js (settingsIndex), переход — window.openSetting (подсветит нужную строку).
// Треки, альбомы, исполнители — поиск Яндекса (cliKit.searchApi) с задержкой, пока печатают.
import { cliKit } from "../look/cli.js";
import { settingsIndex } from "../settings/setpage.js";
import { navigate } from "./nav.js";
import { showToast } from "./menu.js";
import { showAlbum, showArtist } from "../pages/artist.js";
import { openFull } from "../player/full.js";
import { openColorEditor } from "../look/colors.js";

const RECENT_KEY = "ym_palette_recent", TIP_KEY = "ym_palette_tip";
const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const t = (s) => window.i18n?.t?.(s) ?? s;      // подписи, которые собираются в JS (на экране их переведёт i18n.js)

let wrap = null, inp, list, hint, out, items = [], shown = [], sel = 0, found = [], findSeq = 0, findTimer = 0, lastFound = "";

// ---------- что можно найти ----------
const PAGES = [["wave", "Моя волна"], ["likes", "Лайки"], ["statsBtn", "Статистика"], ["studioBtn", "Студия"],
  ["friendsBtn", "Друзья"], ["settingsBtn", "Настройки"], ["profile", "Профиль"]];
// i18n-off — слова, по которым ещё находится пункт; на экран не выводятся
const SEEK = {
  page: "страница раздел открыть", style: "стиль тема оформление", full: "обложка текст песни караоке", eq: "частоты басы звук eq",
  colors: "цвет панели кнопки палитра", add: "ссылка youtube soundcloud файл с компьютера", keys: "горячие клавиши сочетания f1 клавиатура",
  news: "что нового изменения версии обновление история changelog", tour: "знакомство обучение подсказки первый запуск помощь"
};
// i18n-on
const ACTIONS = [
  ["Плеер на весь экран", SEEK.full, () => openFull()],
  ["Эквалайзер", SEEK.eq, () => window.eqOpen?.(), () => !!window.eqOpen],
  ["Тонкая настройка цветов", SEEK.colors, () => openColorEditor()],
  ["Добавить трек…", SEEK.add, () => window.addTrack?.(), () => !!window.addTrack],
  ["Список клавиш", SEEK.keys, () => window.kbHelp?.(), () => !!window.kbHelp],
  ["Что нового", SEEK.news, () => window.whatsNew?.(), () => !!window.whatsNew],
  ["Знакомство с приложением", SEEK.tour, () => window.welcomeOpen?.(), () => !!window.welcomeOpen],
];
const shownEl = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none";

function collect() {
  const all = [];
  for (const [id, fb] of PAGES) {
    const b = document.getElementById(id);
    if (!shownEl(b)) continue;
    const title = b.textContent.replace(/\s+/g, " ").trim() || fb;
    all.push({ kind: "page", tag: t("Страница"), title, keys: norm(`${title} ${fb} ${SEEK.page}`), boost: 30, run: () => b.click() });
  }
  for (const [title, extra, run, ok] of ACTIONS) {
    if (ok && !ok()) continue;
    all.push({ kind: "action", tag: t("Действие"), title: t(title), keys: norm(t(title) + " " + title + " " + extra), boost: 20, run });
  }
  for (const c of document.querySelectorAll(".stylecard[data-style]")) {
    const name = c.querySelector(".scname")?.textContent.trim() || c.dataset.style;
    const auth = c.querySelector(".scauth")?.textContent.trim() || "";
    all.push({ kind: "style", tag: t("Стиль"), title: name, sub: auth, keys: norm(`${name} ${auth} ${c.dataset.style} ${SEEK.style}`), boost: 10, run: () => c.click() });
  }
  for (const s of settingsIndex()) {
    all.push({ kind: "setting", tag: s.tab ? `${t("Настройки")} · ${s.tab}` : t("Настройки"), title: s.title, sub: s.sub || "", keys: s.text, boost: s.sub ? 4 : 8,
      run: () => window.openSetting?.(s.el) });
  }
  for (const c of cliKit.CMDS || []) {
    if (c.hidden) continue;
    const usage = `${c.names[0]} ${c.args}`.trim();
    all.push({ kind: "cmd", tag: t("Команда"), title: usage, sub: t(c.help), keys: norm(`${c.names.join(" ")} ${c.args} ${c.help} ${t(c.help)} ${c.group}`), boost: 0, cmd: c,
      keep: true, run: () => (c.args ? fill(c.names[0] + " ") : exec(c.names[0])) });
  }
  return all;
}

// ---------- подбор ----------
function score(it, q, ws) {
  if (!ws.every((w) => it.keys.includes(w))) return -1;
  const ti = norm(it.title);
  let s = it.boost;
  if (ti === q) s += 200; else if (ti.startsWith(q)) s += 100; else if (ti.includes(q)) s += 50;
  const parts = ti.split(/[\s«»"(),.·:—-]+/);
  for (const w of ws) if (parts.some((p) => p.startsWith(w))) s += 15;
  return s;
}
const recent = () => { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(r) ? r.filter((x) => typeof x === "string").slice(0, 6) : []; } catch { return []; } };
function remember(it) {
  const key = it.kind + ":" + it.title;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...recent().filter((k) => k !== key)].slice(0, 6))); } catch {}
}
// первое слово — точное имя команды консоли: «vol 50» выполнится как есть
const typedCmd = (text) => { const w = text.trim().split(/\s+/)[0]; return w ? cliKit.find?.(w) || null : null; };

function update() {
  const raw = inp.value, q = norm(raw), ws = q ? q.split(" ") : [];
  const cmd = typedCmd(raw);
  if (!q) {
    const keys = recent(), rec = keys.map((k) => items.find((it) => it.kind + ":" + it.title === k)).filter(Boolean);
    shown = [...rec.map((it) => ({ ...it, tag: t("Недавнее") })), ...items.filter((it) => it.kind === "page" && !rec.includes(it))];
  } else {
    shown = items.map((it) => [it, score(it, q, ws)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([it]) => it);
    if (cmd) {
      const usage = `${cmd.names[0]} ${cmd.args}`.trim();
      shown = shown.filter((it) => it.cmd !== cmd);
      shown.unshift({ kind: "cmd", tag: t("Команда"), title: raw.trim(), sub: `${usage} — ${t(cmd.help)}`, cmd, run: () => exec(raw.trim()) });
    }
    if (q.length >= 3 && !cmd) shown.push(...found);
  }
  sel = Math.min(sel, Math.max(0, shown.length - 1));
  paint();
  paintHint(raw, cmd);
  if (q.length >= 3 && !cmd && q !== lastFound) { clearTimeout(findTimer); findTimer = setTimeout(() => search(raw.trim()), 380); }
  if (q.length < 3 && found.length) { found = []; lastFound = ""; }
}

function paintHint(raw, cmd) {
  hint.textContent = "";
  if (cmd) {
    hint.append(mk("b", "", `${cmd.names[0]} ${cmd.args}`.trim()), ` — ${t(cmd.help)}`);
    if (cmd.names.length > 1) hint.append(mk("span", "cpaldim", ` · ${t("Также")}: ${cmd.names.slice(1).join(", ")}`));
  } else if (!raw.trim()) {
    hint.append(t("Например"), " ", mk("b", "", "vol 50"), ", ", mk("b", "", "sleep 30"), " ", t("или"), " ", mk("b", "", t("Затемнение")));
  } else if (!shown.length) {
    hint.append(t("Ничего не нашлось"), " · ", mk("b", "", "help"), " — ", t("все команды"));
  } else {
    const it = shown[sel];
    if (it?.cmd && it.cmd.args) hint.append(mk("b", "", it.title));
  }
}

function paint() {
  list.textContent = "";
  let last = "";
  shown.forEach((it, i) => {
    const li = mk("li", "cpalrow" + (i === sel ? " on" : ""));
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === sel ? "true" : "false");
    const tag = mk("span", "cpaltag", it.tag);
    if (it.tag === last) tag.classList.add("same");
    last = it.tag;
    const main = mk("span", "cpalmain");
    main.append(mk("span", "cpaltitle", it.title));
    if (it.sub) main.append(mk("span", "cpalsub", it.sub));
    if (it.kind === "track" || it.kind === "cmd") main.dataset.noi18n = "";      // названия треков и имена команд — как есть
    li.append(tag, main);
    li.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
    li.onclick = () => { sel = i; choose(); };
    list.append(li);
  });
  mark();
}
function mark() {
  [...list.children].forEach((li, i) => { li.classList.toggle("on", i === sel); li.setAttribute("aria-selected", i === sel ? "true" : "false"); });
  list.children[sel]?.scrollIntoView({ block: "nearest" });
  if (inp.value.trim() && !typedCmd(inp.value)) paintHint(inp.value, null);
}

// ---------- треки, альбомы, исполнители ----------
async function search(q) {
  const my = ++findSeq;
  lastFound = norm(q);
  let r = null;
  try { r = await cliKit.searchApi(q, "all"); } catch { return; }
  if (my !== findSeq || !wrap) return;
  const tracks = (r?.tracks?.results || []).slice(0, 5), albums = (r?.albums?.results || []).slice(0, 2), artists = (r?.artists?.results || []).slice(0, 2);
  const by = (x) => cliKit.artistsOf?.(x) || "";
  found = [
    ...tracks.map((tr, i) => ({ kind: "track", tag: t("Трек"), title: tr.title + (tr.version ? ` (${tr.version})` : ""), sub: by(tr), run: () => cliKit.playList(tracks, i) })),
    ...albums.map((al) => ({ kind: "album", tag: t("Альбом"), title: al.title, sub: [by(al), al.year].filter(Boolean).join(" · "), run: () => navigate(() => showAlbum(al.id)) })),
    ...artists.map((ar) => ({ kind: "artist", tag: t("Исполнитель"), title: ar.name, run: () => navigate(() => showArtist(ar.id)) })),
  ];
  update();
}

// ---------- выполнить ----------
function fill(text) { inp.value = text; inp.focus(); inp.setSelectionRange(text.length, text.length); update(); }
async function exec(text) {
  out.hidden = false;
  try { await cliKit.exec(text, out); } catch (e) { cliKit.err?.(String(e?.message || e)); }
  out.scrollTop = out.scrollHeight;
  if (wrap) { inp.value = ""; update(); }
}
function choose() {
  const it = shown[sel];
  if (!it) { const raw = inp.value.trim(); if (raw) exec(raw); return; }
  if (it.kind !== "track" && it.kind !== "album" && it.kind !== "artist" && !it.cmd) remember(it);
  const r = it.run?.();
  if (!it.keep && !it.cmd) close();
  return r;
}

// ---------- окно ----------
function build() {
  wrap = mk("div", "login modal cpal");
  const box = mk("div", "panel login-box modalbox cpalbox");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", t("Командная строка"));
  const row = mk("div", "cpalin");
  row.append(mk("span", "cpalps", "›"));
  inp = mk("input", "search cpalinput");
  inp.type = "text"; inp.autocomplete = "off"; inp.spellcheck = false;
  inp.placeholder = t("Страница, настройка, команда или трек…");
  inp.setAttribute("role", "combobox"); inp.setAttribute("aria-expanded", "true");
  row.append(inp, mk("kbd", "cpalkbd", "Esc"));
  hint = mk("div", "cpalhint");
  list = mk("ul", "cpallist"); list.setAttribute("role", "listbox");
  out = mk("div", "cpalout"); out.hidden = true; out.setAttribute("role", "log"); out.dataset.noi18n = "";
  box.append(row, hint, list, out);
  wrap.append(box);
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  inp.addEventListener("input", () => { sel = 0; update(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (inp.value) { inp.value = ""; update(); } else close(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); e.stopPropagation();
      if (shown.length) { sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length; mark(); }
    } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); choose(); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const it = shown[sel];
      if (it?.cmd) fill(it.cmd.names[0] + " "); else if (it) fill(it.title);
    } else e.stopPropagation();                      // клавиши окна (Пробел, M, L…) — не здесь
  });
}
function openPalette(text = "") {
  if (wrap?.isConnected) { inp.focus(); inp.select(); return; }
  if (!wrap) build();
  items = collect();
  found = []; lastFound = ""; sel = 0; out.textContent = ""; out.hidden = true;
  inp.value = text;
  document.body.append(wrap);
  update();
  inp.focus();
}
function close() {
  if (!wrap?.isConnected) return;
  clearTimeout(findTimer); findSeq++;
  wrap.remove();
}

// Ctrl+K — открыть/закрыть, откуда угодно (и из полей ввода); поверх другого окна не открываем
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== "KeyK") return;
  e.preventDefault(); e.stopPropagation();
  if (wrap?.isConnected) return close();
  if (document.querySelector(".modal:not(.hidden)") || !document.getElementById("login")?.classList.contains("hidden")) return;
  openPalette();
}, true);
window.openPalette = openPalette;                   // меню и подсказки модулей

// Новичку — один раз подсказать, что такое есть (через минуту после первого запуска с этим модулем)
if (!window.isMobile) setTimeout(() => {
  try { if (localStorage.getItem(TIP_KEY)) return; localStorage.setItem(TIP_KEY, "1"); } catch { return; }
  if (!document.getElementById("login")?.classList.contains("hidden")) return;
  showToast("Ctrl+K — командная строка: найдёт любую настройку, страницу, команду или трек", 8000, { action: { label: "Открыть", fn: () => openPalette() } });
}, 60_000);

export { openPalette };

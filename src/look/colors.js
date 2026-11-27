// «Тонкая настройка цветов» (Оформление → Цвета → «Тонкая настройка…», правый щелчок → «Цвета этого места…»).
// ES-модуль: подключён в index.html ПЕРЕД app/main.js. Пока main.js — обычный скрипт, связь такая:
//   * сюда — общие переменные и функции main.js (cfg, DynCss, baseOf, sty, fill, saveCfg, applyCfg, hexRgb, relLum) прямо
//     по имени: модуль видит глобальную область обычных скриптов. Трогать их можно только внутри функций — при загрузке
//     модуля main.js ещё не выполнялся;
//   * отсюда — в конце файла через window: applyCustom (main.js → applyCfg), openColorEditor (tmenu.js),
//     CC_ITEMS (theme.js — ключи colorOverrides). Когда main.js станет модулем, это превратится в export.
// Каждый параметр хранится отдельно для каждого стиля в cfg.s[стиль].cc. Пусто — «авто»: цвет берётся из основного/второго.
// css: { all | neon | royal | steam | lolitta: [[селекторы, объявления с $ вместо цвета], ...] } — для стиля берётся свой список, иначе all.
import { DynCss, fill, hexRgb, relLum } from "../app/base.js";
import { applyCfg, baseOf, saveCfg, sty } from "./config.js";
const PANEL = "color-mix(in srgb, $ calc(var(--panel-a) * 100%), transparent)";
const BALL = "radial-gradient(circle at 35% 30%, color-mix(in srgb, $ 55%, #fff), $ 60%, color-mix(in srgb, $ 70%, #000))";
const FRAMED = ["royal", "steam", "lolitta"];      // в этих стилях у кнопок есть настоящая рамка (border)
const bordered = (sel, notActive) => Object.fromEntries([
  ["all", [[notActive, "box-shadow: inset 0 0 0 1px $"]]],
  ...FRAMED.map((st) => [st, [[sel, "border-color: $"]]]),
]);
const SIDE_NAV = ".side .nav:not(.active)", SIDE_ACT = ".side .nav.active";
const BTN = ".main .nav:not(.active):not(.danger), .chip:not(.active), .pill:not(.active), .round, .modalbox .nav:not(.active):not(.danger)";
const BTN_ALL = ".main .nav:not(.danger), .chip, .pill, .round, .modalbox .nav:not(.danger)";
const BTN_ACT = ".main .nav.active:not(.danger), .chip.active, .pill.active, .stations .pill.active, .modalbox .nav.active:not(.danger), .login-box .nav.active:not(.danger)";
const PLAY = ".player .playbtn, .fbtns .playbtn, .wavebtn, .best .bplay, .stalbum .stplay";
const SEEK_TRACK = { all: "rgba(255,255,255,.16)", steam: "rgba(255,255,255,.12)", lolitta: "color-mix(in srgb, var(--accent2) 22%, transparent)" };
const VOL_TRACK = { all: "rgba(255,255,255,.16)", steam: "rgba(255,255,255,.12)", lolitta: "color-mix(in srgb, var(--accent) 30%, transparent)" };
const VOL_FILL = { all: "var(--accent)", lolitta: "var(--l-lo)" };
const inkOn = (hex) => { const c = hexRgb(String(hex).slice(0, 7)); return c && relLum(c) > 0.4 ? "#2a1218" : "#fff7f7"; };

const CC_GROUPS = [
  { name: "Текст", items: [
    { k: "text", label: "Основной текст", vars: ["--text"], probe: ["body", "color"] },
    { k: "muted", label: "Второстепенный текст", vars: ["--muted"], probe: [".sub, .status, .muted, .swatch", "color"] },
    { k: "heading", label: "Заголовки", css: { all: [["#title, .main h2, .main h3, .card h3", "color: $; -webkit-text-fill-color: $"]] }, probe: ["#title", "color"] },
  ] },
  { name: "Фон окна", items: [
    { k: "winBg", label: "Фон окна (когда нет обоев)", css: { all: [["body", "background: $"]] }, probe: ["body", "background-color"] },
  ] },
  { name: "Верхняя панель", items: [
    { k: "tabBg", label: "Фон вкладок", css: { all: [[".tab:not(.active)", "background: $"]], royal: [[".tab:not(.active)::after", "background: $"]], steam: [[".tab:not(.active)::after", "background: $"]] }, probe: [".tab:not(.active)", "background-color"] },
    { k: "tabText", label: "Текст вкладок", css: { all: [[".tab:not(.active)", "color: $"]] }, probe: [".tab:not(.active)", "color"] },
    { k: "tabBorder", label: "Обводка", fb: "accent2", css: {
      all: [[".tab", "border-color: $"]],
      royal: [[".tab::before", "background: $"], [".tabs", "background: linear-gradient($, $) top / 100% 5px no-repeat"]],
      steam: [[".tab::before, .tab:hover::before, .tab.active::before", "background: $"],
              [".tabs", "background: linear-gradient($, $) 0 3px / 100% 1px no-repeat, linear-gradient(color-mix(in srgb, $ 45%, transparent), color-mix(in srgb, $ 45%, transparent)) 0 7px / 100% 1px no-repeat"]],
      lolitta: [[":root", "--l-edge-c: $"]],
    } },
    { k: "tabActBg", label: "Фон активной вкладки", css: { all: [[".tab.active", "background: $"]], royal: [[".tab.active::after", "background: $"]], steam: [[".tab.active::after", "background: $"]] }, probe: [".tab.active", "background-color"] },
    { k: "tabActText", label: "Текст активной вкладки", css: { all: [[".tab.active", "color: $"]] }, probe: [".tab.active", "color"] },
    { k: "titleBarBg", label: "Полоса заголовка окна", css: { all: [[".titlebar", "background: $"]] }, probe: [".titlebar", "background-color"] },
  ] },
  { name: "Боковая панель", items: [
    { k: "sideBg", label: "Фон панели", css: { all: [[".side", "background: " + PANEL]], steam: [[".side::before", "background: " + PANEL]] } },
    { k: "sideBorder", label: "Обводка панели", fb: "accent", css: { all: [[".side", "border-color: $"]], steam: [[".side::before", "border-color: $"]], royal: [[".side", "border-color: $"], [".side::before", "border-color: color-mix(in srgb, $ 55%, transparent)"]] } },
    { k: "navBg", label: "Фон кнопок", css: { all: [[SIDE_NAV, "background: $"]] }, probe: [SIDE_NAV, "background-color"], extra: SIDE_NAV + ":hover { filter: brightness(1.15); }" },
    { k: "navText", label: "Текст и значки кнопок", css: { all: [[SIDE_NAV, "color: $"]], steam: [[SIDE_NAV, "color: $"], [SIDE_NAV + "::before", "background: $"]], lolitta: [[SIDE_NAV, "color: $"], [SIDE_NAV + "::before", "background: $"]] }, probe: [SIDE_NAV, "color"] },
    { k: "navBorder", label: "Обводка кнопок", fb: "accent", css: bordered(".side .nav", SIDE_NAV) },
    { k: "navActBg", label: "Фон активной кнопки", fb: "accent2", css: { all: [[SIDE_ACT, "background: $"]] } },
    { k: "navActText", label: "Текст активной кнопки", css: { all: [[SIDE_ACT, "color: $"]], steam: [[SIDE_ACT, "color: $"], [SIDE_ACT + "::before", "background: $"]], lolitta: [[SIDE_ACT, "color: $"], [SIDE_ACT + "::before", "background: $"]] }, probe: [SIDE_ACT, "color"] },
    { k: "searchBg", label: "Фон поиска", css: { all: [[".search", "background: $"]], steam: [[".search", "background: var(--search-ic) 12px center / 16px 16px no-repeat, $"]], lolitta: [[".side .search", "background: var(--l-search) 16px center / 18px 18px no-repeat, $"]] }, probe: [".search", "background-color"] },
    { k: "searchText", label: "Текст поиска", css: { all: [[".search, .lkfindcnt", "color: $"], [".search::placeholder", "color: color-mix(in srgb, $ 62%, transparent)"]] }, probe: [".search", "color"],
      // выбран только фон поиска — текст сам становится тёмным на светлом фоне и светлым на тёмном
      gen: (cc) => cc.searchBg && !cc.searchText && /^#[0-9a-f]{6}/i.test(cc.searchBg)
        ? `.search, .lkfindcnt { color: ${inkOn(cc.searchBg)} !important; } .search::placeholder { color: color-mix(in srgb, ${inkOn(cc.searchBg)} 62%, transparent) !important; }` : "" },
  ] },
  { name: "Кнопки в окне", note: "Чипы, «Показать ещё», «Закрепить», кнопки в окнах", items: [
    { k: "btnBg", label: "Фон кнопок", css: { all: [[BTN, "background: $"]] }, extra: ".main .nav:not(.active):not(.danger):hover, .chip:not(.active):hover, .pill:not(.active):hover, .round:hover { filter: brightness(1.15); }" },
    { k: "btnText", label: "Текст кнопок", css: { all: [[BTN, "color: $"]] }, probe: [".main .nav:not(.active)", "color"] },
    { k: "btnBorder", label: "Обводка кнопок", fb: "accent", css: bordered(BTN_ALL, BTN) },
    { k: "btnActBg", label: "Фон выбранной кнопки", fb: "accent2", css: { all: [[BTN_ACT, "background: $"]] } },
    { k: "btnActText", label: "Текст выбранной кнопки", css: { all: [[BTN_ACT, "color: $; text-shadow: none"]] }, fb: "onAccent" },
  ] },
  { name: "Нижняя панель", items: [
    { k: "plBg", label: "Фон панели", css: { all: [[".player", "background: " + PANEL]], steam: [[".player::before", "background: " + PANEL]] } },
    { k: "plBorder", label: "Обводка панели", fb: "accent", css: { all: [[".player", "border-color: $"]], steam: [[".player::before", "border-color: $"]], royal: [[".player", "border-color: $"], [".player::before", "border-color: color-mix(in srgb, $ 55%, transparent)"]] } },
    { k: "plTitle", label: "Название трека", css: { all: [["#pTitle", "color: $"]] }, probe: ["#pTitle", "color"] },
    { k: "plArtist", label: "Исполнитель и время", css: { all: [["#pArtist, #pArtist a, .player .time", "color: $"]] }, probe: ["#pArtist", "color"] },
    { k: "plIcons", label: "Значки кнопок", css: { all: [[".player .ctrls button:not(.playbtn):not(.on), #volBtn, #pMore, .player #disBtn:not(.on), .player #sleepBtn:not(.on), .pinfo .likebtn:not(.on)", "color: $"]] }, probe: ["#prev", "color"] },
    { k: "plModeOn", label: "Включённые повтор и перемешивание", fb: "accent2", css: { all: [[".modebtn.on", "color: $"]] } },
  ] },
  { name: "Кнопка «Пуск» и «Моя волна»", items: [
    { k: "playBg", label: "Фон кнопки", fb: "accent2", css: { all: [[PLAY, "background: " + BALL]] } },
    { k: "playIcon", label: "Значок", fb: "onAccent", css: { all: [[PLAY, "color: $; text-shadow: none"]] } },
  ] },
  { name: "Полоса воспроизведения", items: [
    { k: "seekFill", label: "Пройденная часть", fb: "accent2", gen: (cc, st) => !cc.seekFill && !cc.seekTrack ? "" :
      `#seek::-webkit-slider-runnable-track, #fSeek::-webkit-slider-runnable-track { background: linear-gradient(90deg, ${cc.seekFill || "var(--accent2)"} var(--p, 0%), ${cc.seekTrack || SEEK_TRACK[st] || SEEK_TRACK.all} var(--p, 0%)) !important; }` },
    { k: "seekTrack", label: "Оставшаяся часть", gen: () => "" },
    { k: "seekThumb", label: "Ползунок", css: { all: [["#seek::-webkit-slider-thumb, #fSeek::-webkit-slider-thumb", "background: $"]] }, probe: ["#seek", "color"], fb: "#ffffff" },
  ] },
  { name: "Громкость", items: [
    { k: "volFill", label: "Уровень громкости", fb: "accent", gen: (cc, st) => !cc.volFill ? "" :
      `#vol::-webkit-slider-runnable-track { background: linear-gradient(90deg, ${cc.volFill} var(--p, 0%), ${VOL_TRACK[st] || VOL_TRACK.all} var(--p, 0%)) !important; }` },
  ] },
  { name: "Лайки", items: [
    { k: "like", label: "Цвет лайка", fb: "accent2", css: { all: [[".likebtn.on", "color: $"]] },
      gen: (cc, st) => st === "lolitta" && cc.like ? `.list .likebtn.on { background: ${BALL.replaceAll("$", cc.like)} !important; color: ${inkOn(cc.like)} !important; }` : "" },
  ] },
  { name: "Список треков", items: [
    { k: "rowHover", label: "Подсветка строки при наведении", fb: "accent", css: { all: [[".list li:hover", "background: color-mix(in srgb, $ 18%, transparent)"]] } },
    { k: "rowTitle", label: "Название трека", css: { all: [[".list .t", "color: $"]] }, probe: [".list .t", "color"] },
    { k: "rowArtist", label: "Исполнитель", css: { all: [[".list .a, .list .a a", "color: $"]] }, probe: [".list .a", "color"] },
  ] },
  { name: "Средняя панель", note: "Основная область со списками и страницами", items: [
    { k: "mainBg", label: "Фон средней панели", css: { all: [[".main", "background: $"]] }, probe: [".main", "background-color"] },
    { k: "listBg", label: "Фон списка треков", css: { all: [[".main .list:not(:empty), .qbody .list", "background: $"]] }, probe: [".main .list", "background-color"] },
    { k: "titleBg", label: "Фон заголовка страницы", css: { all: [[".head h2", "background: $; -webkit-text-fill-color: currentColor"]] } },
  ] },
  { name: "Меню и окна", note: "Меню трека, подсказки, окна-диалоги, панель очереди", items: [
    { k: "menuBg", label: "Фон", css: { all: [[".tmenu, .toast, .modalbox, .login-box, .qpanel, .stations", "background: $"]] }, probe: [".tmenu", "background-color"] },
    { k: "menuText", label: "Текст", css: { all: [[".tmenu, .tmenu button, .toast, .modalbox, .login-box, .qpanel, .stations", "color: $"]] }, probe: [".tmenu", "color"] },
  ] },
  { name: "Карточки и блоки", note: "Блоки настроек, статистики, альбомов", items: [
    { k: "cardBg", label: "Фон", css: { all: [[".card, .lastAlbum, .simcard, .stylecard", "background: " + PANEL]] }, probe: [".card", "background-color"] },
    { k: "cardBorder", label: "Обводка", css: { all: [[".card, .lastAlbum, .simcard, .stylecard", "border-color: $"]] }, probe: [".card", "border-top-color"] },
  ] },
  { name: "Переключатели и ползунки", note: "В настройках", items: [
    { k: "ctl", label: "Цвет включённого", fb: "accent", css: { all: [[".switch input:checked + i", "background: $"]] },
      gen: (cc) => cc.ctl ? `.settings input[type=range]::-webkit-slider-runnable-track { background: linear-gradient(90deg, ${cc.ctl} var(--p, 0%), rgba(255,255,255,.16) var(--p, 0%)) !important; }` : "" },
  ] },
  { name: "Визуализатор", items: [
    { k: "vizA", label: "Первый цвет", fb: "accent" },
    { k: "vizB", label: "Второй цвет", fb: "accent2" },
  ] },
  { name: "Свечение", only: "neon", note: "Только в неоновом стиле", items: [
    { k: "glow", label: "Цвет свечения", fb: "accent2", css: { neon: [[":root", "--glow-c: $; --btn-glow: $"]] } },
  ] },
];
const CC_ITEMS = CC_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g })));
// «Сразу для всех»: один цвет записывается во все перечисленные места (их потом можно поправить по отдельности)
const CC_BULK = [
  { label: "Фон всех панелей", note: "Верхняя полоса, боковая, средняя и нижняя панели, меню и окна", keys: ["titleBarBg", "sideBg", "mainBg", "plBg", "menuBg"] },
  { label: "Обводка всех панелей", note: "Верхняя, боковая, нижняя панели и карточки", keys: ["tabBorder", "sideBorder", "plBorder", "cardBorder"] },
  { label: "Фон всех кнопок", note: "Вкладки, кнопки боковой панели и кнопки в окне", keys: ["tabBg", "navBg", "btnBg"] },
  { label: "Текст и значки всех кнопок", note: "Вкладки, боковая панель, кнопки в окне, значки плеера", keys: ["tabText", "navText", "btnText", "plIcons"] },
  { label: "Обводка всех кнопок", note: "Кнопки боковой панели и кнопки в окне", keys: ["navBorder", "btnBorder"] },
  { label: "Фон выбранных кнопок", note: "Активная вкладка, активная кнопка боковой панели, выбранная кнопка в окне", keys: ["tabActBg", "navActBg", "btnActBg"] },
  { label: "Текст выбранных кнопок", note: "Активная вкладка, активная кнопка боковой панели, выбранная кнопка в окне", keys: ["tabActText", "navActText", "btnActText"] },
];
const ccOf = (st = cfg.style) => (cfg.s[st].cc ||= {});

function ccCss(st) {
  // Настройки пользователя главнее любых правил стиля, в том числе своих тем с !important:
  // повтор :root поднимает силу селектора (специфичность), а сам блок подключается последним (applyCustom).
  const cc = ccOf(st), pre = `:root:root:root:root[data-style="${st}"]`, out = [], base = baseOf(st);      // свой стиль настраивается как его основа
  const scope = (sel) => sel.split(",").map((x) => x.trim()).map((x) => (x === ":root" ? pre : `${pre} ${x}`)).join(", ");
  // Обводка, которой у стиля нет (толщина 0, как у окон Windows 98), — тогда выбранный цвет рисуется рамкой в 1px
  const noBorder = (sel) => sel.split(",").some((x) => {
    let el = null;
    try { el = document.querySelector(x.trim().replace(/::?(before|after)$/, "")); } catch {}
    return el && st === cfg.style && parseFloat(getComputedStyle(el).borderTopWidth) === 0 && !/::?(before|after)$/.test(x.trim());
  });
  for (const it of CC_ITEMS) {
    if (it.group.only && it.group.only !== base) continue;
    const v = cc[it.k];
    if (it.gen) { const g = it.gen(cc, base); if (g) out.push(g.replace(/(^|\})\s*([^{}]+)\{/g, (m, b, sel) => `${b}\n${scope(sel)} {`)); }
    if (!v) continue;
    if (it.vars) out.push(`${pre} { ${it.vars.map((n) => `${n}: ${v} !important`).join("; ")}; }`);
    const rules = it.css && (it.css[base] || it.css.all);
    for (const [sel, decl0] of rules || []) {
      const decl = /^border-color:/.test(decl0) && noBorder(sel) ? decl0 + "; border-style: solid; border-width: 1px" : decl0;
      const d = decl.replaceAll("$", v).split(/;\s*/).filter(Boolean).map((x) => x + " !important").join("; ");
      out.push(`${scope(sel)} { ${d}; }`);
    }
    if (it.extra) out.push(it.extra.replace(/^([^{]+)\{/, (m, sel) => scope(sel) + " {"));
  }
  return out.join("\n");
}
function applyCustom() {
  DynCss.set("ccStyle", "");                 // обводки проверяем по виду стиля без старых настроек
  DynCss.set("ccStyle", ccCss(cfg.style));   // DynCss держит этот блок последним — после CSS своих тем
}

// что показать в пипетке у «авто»-параметра: реальный цвет элемента, если его можно прочитать, иначе — основной/второй
function toHex(c) {
  const m = /rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:[,/]\s*([\d.]+))?/.exec(c || "");
  if (!m || (m[4] !== undefined && +m[4] < 0.35)) return null;
  return "#" + [m[1], m[2], m[3]].map((x) => Math.round(+x).toString(16).padStart(2, "0")).join("");
}
function ccAuto(it) {
  const st = sty();
  if (it.probe) {
    const [sel, prop] = it.probe, el = document.querySelector(sel);
    if (el) { const h = toHex(getComputedStyle(el).getPropertyValue(prop)); if (h) return h; }
  }
  if (it.fb === "onAccent") return getComputedStyle(document.documentElement).getPropertyValue("--on-accent").trim() || "#ffffff";
  if (it.fb && it.fb[0] === "#") return it.fb;
  if (it.vars) { const h = getComputedStyle(document.documentElement).getPropertyValue(it.vars[0]).trim(); if (/^#[0-9a-f]{6}$/i.test(h)) return h; }
  return it.fb === "accent" ? st.accent : st.accent2;
}

// focus — ключ из CC_GROUPS: окно откроется сразу на этой строке (правый щелчок → «Цвета этого места…», tmenu.js)
let ccFocus = null;
function openColorEditor(focus) {
  if (document.querySelector(".ccmodal")) { if (typeof focus === "string") ccFocus?.(focus); return; }
  const wrap = document.createElement("div"); wrap.className = "login modal ccmodal";
  const box = document.createElement("div"); box.className = "panel login-box modalbox ccbox";
  const h = document.createElement("h2"); h.textContent = "Тонкая настройка цветов";
  const p = document.createElement("p"); p.className = "ccnote";
  const styleName = { neon: "Неон", royal: "Королевский", steam: "Стимпанк", lolitta: "Lolitta" }[cfg.style] || cfg.themes.find((t) => t.id === cfg.style)?.name || cfg.style;
  p.textContent = `Для стиля «${styleName}». Блёклые кружки — «авто»: цвет берётся из основного и второго. Изменения видны сразу.`;
  const scroll = document.createElement("div"); scroll.className = "ccscroll";
  const cc = ccOf();
  const rows = {};      // k -> { show(v), it, sync() } — строки отдельных мест
  const bulks = [];     // строки раздела «Сразу для всех»
  const alphaOf = (v) => (/^#[0-9a-f]{8}$/i.test(v || "") ? Math.round((parseInt(v.slice(7), 16) / 255) * 100) : 100);
  const dotsOf = (dots, keys) => dots.replaceChildren(...keys.filter((k) => cc[k]).slice(0, 6).map((k) => { const i = document.createElement("i"); i.style.background = cc[k]; return i; }));
  // одна строка: название, «авто», пипетка, непрозрачность, ✕
  // onSet(v) — выбран цвет (#rrggbb или #rrggbbaa), onClear() — вернуть «авто»
  const makeRow = (label, autoHex, onSet, onClear) => {
    const row = document.createElement("label"); row.className = "ccrow";
    const lb = document.createElement("span"); lb.textContent = label;
    const auto = document.createElement("small");
    const inp = document.createElement("input"); inp.type = "color";
    const al = document.createElement("input"); al.type = "range"; al.min = "0"; al.max = "100"; al.className = "ccalpha";
    al.title = "Непрозрачность: влево — прозрачнее";
    const pct = document.createElement("output"); pct.className = "ccpct";
    const compose = () => { const a = +al.value; return a >= 100 ? inp.value : inp.value + Math.round((a / 100) * 255).toString(16).padStart(2, "0"); };
    // onSet пересобирает весь блок «Тонкой настройки» (DynCss + замеры) — не чаще раза за кадр, иначе пипетка лагает
    let raf = 0;
    const put = () => {
      pct.textContent = al.value + "%"; fill(al); row.classList.add("set"); auto.textContent = "авто";
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; onSet(compose()); });
    };
    inp.addEventListener("input", put);
    al.addEventListener("input", put);
    // отпустили — досылаем последний цвет сразу (кадр мог ещё не наступить) и пишем на диск
    const done = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; onSet(compose()); } saveCfg(); };
    inp.addEventListener("change", done);
    al.addEventListener("change", done);
    const clr = document.createElement("button"); clr.type = "button"; clr.className = "ccclr"; clr.title = "Вернуть «авто»"; clr.textContent = "✕";
    clr.onclick = (e) => { e.preventDefault(); onClear(); saveCfg(); };
    // v — сохранённый цвет или пусто («авто»); hint — подпись вместо «авто» (например «разные»)
    const show = (v, hint) => {
      row.classList.toggle("set", !!v);
      auto.textContent = hint || "авто";
      row.classList.toggle("mixed", !!hint);
      inp.value = (v || autoHex()).slice(0, 7);
      al.value = alphaOf(v); pct.textContent = al.value + "%"; fill(al);
    };
    // пипетка — первая в строке-<label>: щелчок по названию открывает её; ползунок прозрачности — сразу за ней
    row.append(lb, auto, inp, al, pct, clr);
    return { row, show };
  };
  const refreshBulk = () => bulks.forEach((b) => b.sync());

  const groups = CC_GROUPS.filter((g) => !g.only || g.only === baseOf());
  const shown = new Set(groups.flatMap((g) => g.items.map((it) => it.k)));
  const itemOf = (k) => CC_ITEMS.find((it) => it.k === k);

  // «Сразу для всех»: один цвет — во все места своей группы (все панели, все кнопки…)
  {
    const d = document.createElement("details"); d.className = "ccgrp ccbulk"; d.open = true;
    const sm = document.createElement("summary");
    const nm = document.createElement("span"); nm.textContent = "Сразу для всех";
    const n = document.createElement("small"); n.textContent = "Один цвет сразу во все места. Потом любое из них можно поправить отдельно ниже";
    sm.append(nm, n);
    const box2 = document.createElement("div"); box2.className = "ccrows";
    for (const b of CC_BULK) {
      const keys = b.keys.filter((k) => shown.has(k));
      if (!keys.length) continue;
      const first = itemOf(keys[0]);
      const r = makeRow(b.label, () => ccAuto(first),
        (v) => { for (const k of keys) { cc[k] = v; rows[k]?.show(v); } applyCfg(); syncAllDots(); },
        () => { for (const k of keys) delete cc[k]; applyCfg(); for (const k of keys) rows[k]?.show(); syncAllDots(); r.show(); });
      if (b.note) r.row.title = b.note;
      const sync = () => {
        const vals = keys.map((k) => cc[k] || "");
        const same = vals.every((v) => v === vals[0]);
        if (same) r.show(vals[0]);
        else { const v = vals.find(Boolean) || ""; r.show(v, "разные"); }
      };
      bulks.push({ sync });
      sync();
      box2.append(r.row);
    }
    d.append(sm, box2); scroll.append(d);
  }

  const groupDots = [];
  const syncAllDots = () => groupDots.forEach(([dots, keys]) => dotsOf(dots, keys));
  for (const g of groups) {
    const d = document.createElement("details"); d.className = "ccgrp";
    const sm = document.createElement("summary");
    const nm = document.createElement("span"); nm.textContent = g.name;
    const dots = document.createElement("span"); dots.className = "ccdots";
    sm.append(nm, dots);
    if (g.note) { const n = document.createElement("small"); n.textContent = g.note; sm.append(n); }
    const box2 = document.createElement("div"); box2.className = "ccrows";
    const keys = g.items.map((it) => it.k);
    for (const it of g.items) {
      const r = makeRow(it.label, () => ccAuto(it),
        (v) => { cc[it.k] = v; applyCfg(); dotsOf(dots, keys); refreshBulk(); },
        () => { delete cc[it.k]; applyCfg(); r.show(); dotsOf(dots, keys); refreshBulk(); });
      r.show(cc[it.k]);
      rows[it.k] = r;
      box2.append(r.row);
    }
    groupDots.push([dots, keys]);
    dotsOf(dots, keys);
    d.append(sm, box2); scroll.append(d);
  }
  const row = document.createElement("div"); row.className = "row";
  const reset = document.createElement("button"); reset.className = "nav"; reset.textContent = "Сбросить всё";
  const ok = document.createElement("button"); ok.className = "nav active"; ok.textContent = "Готово";
  reset.onclick = () => {
    for (const k of Object.keys(cc)) delete cc[k];
    applyCfg(); saveCfg();
    Object.values(rows).forEach((r) => r.show());
    syncAllDots(); refreshBulk();
  };
  row.append(reset, ok);
  box.append(h, p, scroll, row);
  const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); ccFocus = null; };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  ok.onclick = close;
  wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
  wrap.append(box); document.body.append(wrap);
  // открыть раздел с нужной строкой, остальные свернуть, строку — в середину и подсветить
  ccFocus = (k) => {
    const r = rows[k]?.row;
    if (!r) return false;
    scroll.querySelectorAll("details.ccgrp").forEach((d) => { d.open = d.contains(r); });
    r.scrollIntoView({ block: "center" });
    r.classList.remove("ccflash"); void r.offsetWidth; r.classList.add("ccflash");
    return true;
  };
  if (!(typeof focus === "string" && ccFocus(focus))) scroll.querySelector("details")?.setAttribute("open", "");
}
document.getElementById("ccBtn").onclick = () => openColorEditor();

export { applyCustom, openColorEditor, CC_ITEMS };

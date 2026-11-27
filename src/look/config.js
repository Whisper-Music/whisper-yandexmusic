// Настройки оформления: встроенные стили (STYLE_DEF), cfg (localStorage ym_cfg3) — загрузка, сохранение, применение
// (applyCfg: цвета, свечение, прозрачность, фон, Lolitta), возможности своих тем (ручка громкости, кнопки темы, эффекты),
// ползунки и переключатели вкладки «Оформление», «Исходный вид стиля», «Сбросить всё».
// ES-модуль, подключён сразу после app/base.js. При загрузке читает cfg и вешает обработчики; первый applyCfg()
// зовёт main.js (ему нужен фон и прочее, что объявлено позже). cfg и dynPal — свойства window: их пишут и другие.
// Наружу — через window в конце.
import { btnHi, fill, fillAll, hexRgb, invoke, onAccent, relLum } from "../app/base.js";
import { modal, showToast } from "../app/menu.js";
import { winDragFrom } from "../app/window.js";
import { bgNote, clearBg, loadBg, syncBgVideo } from "./bg.js";
import { applyCustom } from "./colors.js";
import { dynUpdate, pickPalette } from "./dynbg.js";
import { applyViz } from "../player/core.js";
import { setVol } from "../player/volume.js";
const $ = (s) => document.querySelector(s);

const STYLE_DEF = {
  neon:  { accent: "#a66bff", accent2: "#ffffff", glow: 22, panel: 70, dim: 10, bg: "" },
  royal: { accent: "#c9a24b", accent2: "#8b1e2d", glow: 6, panel: 92, dim: 10, bg: "" },
  steam: { accent: "#c58a4b", accent2: "#8c4f24", glow: 4, panel: 90, dim: 10, bg: "" },
  lolitta: { accent: "#e2aab4", accent2: "#8c4a5c", glow: 4, panel: 94, dim: 10, bg: "" },
};
const STYLE_KEYS = ["accent", "accent2", "glow", "panel", "dim"];
// Свои стили из файлов .wmt (theme.js). У каждого есть «основа» — один из встроенных стилей:
// от неё берётся поведение, которое задаётся не CSS, а кодом (цвета Lolitta, отступы визуализатора и т.п.).
const BUILTIN = Object.keys(STYLE_DEF);
const themeReady = new Set();         // свои стили, чьи CSS уже подключены
const baseOf = (st = cfg.style) => (BUILTIN.includes(st) ? st : cfg.themes?.find((t) => t.id === st)?.base || "neon");
const styleDef = (st) => STYLE_DEF[st] || STYLE_DEF[baseOf(st)];
// Что умеет стиль — от этого зависит, какие настройки показывать. Свой стиль задаёт это в файле темы
// (settings whisper-music → features, заполняет theme.js); не задал — как у его основы.
//   glow — есть свечение (ползунок «Свечение»), animations — есть анимации (галочка «Анимации интерфейса»),
//   panelOpacity — панели могут быть прозрачными (ползунок «Прозрачность панелей»),
//   pinHide — работает режим «Скрывать закреплённые» (у стиля со своей раскладкой "layout": "fixed" — никогда),
//   mascot — по стилю может гулять маскот (карточка «Маскот»; false — кот не рисуется, выбор пользователя хранится).
const themeFeatures = {};
// Возможности своих тем сверх CSS (settings whisper-music, разбирает theme.js → setFeatures):
// volKnob — громкость ручкой, layoutFixed — тема сама задаёт расположение, buttons — [[имя, действие], …].
const themeHooks = {};
const hook = (k, st = cfg.style) => themeHooks[st]?.[k];
function feature(name, st = cfg.style) {
  const f = themeFeatures[st]?.[name];
  if (typeof f === "boolean") return f;
  return name === "glow" ? baseOf(st) === "neon" : true;
}
// style: "neon" — первый стиль, который видит новый пользователь (и после «Сбросить оформление»)
const VIZ_STYLES = ["circle", "bars"];
const freshCfg = () => ({ style: "neon", blur: 6, viz: true, vizStyle: "bars", anim: true, bg: "", themes: [], s: Object.fromEntries(Object.keys(STYLE_DEF).map((k) => [k, { ...STYLE_DEF[k], cc: {} }])) });
function loadCfg() {
  let saved = null, old = null;
  try { saved = JSON.parse(localStorage.getItem("ym_cfg3") || "null"); } catch {}
  try { old = JSON.parse(localStorage.getItem("ym_cfg2") || "null"); } catch {}
  const c = freshCfg();
  if (saved) {
    for (const k of ["style", "blur", "viz", "vizStyle", "bg", "anim", "dyn", "dynColors"]) if (saved[k] !== undefined) c[k] = saved[k];
    for (const st of Object.keys(STYLE_DEF)) {
      Object.assign(c.s[st], saved.s?.[st] || {});
      if (saved.s?.[st]?.dim === undefined && saved.dim !== undefined) c.s[st].dim = saved.dim;
    }
    // свои стили: список (сами файлы лежат в IndexedDB) и их настройки
    c.themes = (Array.isArray(saved.themes) ? saved.themes : [])
      .filter((t) => t && /^[a-z0-9][a-z0-9-]{0,47}$/.test(t.id) && !STYLE_DEF[t.id] && typeof t.name === "string")
      .slice(0, 50)
      .map((t) => ({ id: t.id, name: t.name.slice(0, 60), base: STYLE_DEF[t.base] ? t.base : "neon", desc: String(t.desc || "").slice(0, 120) }));
    for (const t of c.themes) c.s[t.id] = { ...STYLE_DEF[t.base], cc: {}, ...(saved.s?.[t.id] || {}) };
  } else if (old) {
    for (const k of ["blur", "viz", "bg"]) if (old[k] !== undefined) c[k] = old[k];
    for (const k of STYLE_KEYS) if (old[k] !== undefined) c.s.neon[k] = old[k];
  }
  if (!c.s[c.style]) c.style = "neon";
  if (!VIZ_STYLES.includes(c.vizStyle)) c.vizStyle = "bars";        // по умолчанию — столбцами
  return c;
}
window.cfg = loadCfg();      // свойство window: его читают все и заменяет «Сбросить всё»
const bgUrls = { neon: "", royal: "", steam: "", lolitta: "" };
const bgKinds = { neon: "", royal: "", steam: "", lolitta: "" };      // "image" | "video"
const bgPosters = { neon: "", royal: "", steam: "", lolitta: "" };    // кадр из видео — для превью в настройках
const bgKey = (st) => "bg:" + st;
const sty = () => cfg.s[cfg.style];
const curBg = () => bgUrls[cfg.style] || "";
const curBgVideo = () => bgKinds[cfg.style] === "video";

function loInk(st) {
  const r = document.documentElement.style;
  const NAMES = ["--lo-on-btn", "--lo-on-tab", "--lo-on-tabbg", "--lo-on-act", "--lo-on-tabact", "--lo-ink", "--lo-on-mid", "--lo-on-l2"];
  const A = hexRgb(st.accent), B = hexRgb(st.accent2);
  if (baseOf() !== "lolitta" || !A || !B) {
    for (const n of NAMES) { r.removeProperty(n); r.removeProperty(n + "-sh"); }
    for (const n of ["--lo-ic", "--lo-title", "--l-btn", "--l-btn2", "--l-tab", "--l-tab2"]) r.removeProperty(n);
    return;
  }
  const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const cr = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const H = hexRgb, W = [255, 255, 255], DARK = "#2a1218", LIGHT = "#fff6f7";
  const pick = (bgs, cands, t = 4.5) => {
    let best = cands[0], bv = -1;
    for (const c of cands) { const v = Math.min(...bgs.map((b) => cr(b, H(c)))); if (v >= t) return { c, v }; if (v > bv) { best = c; bv = v; } }
    return { c: best, v: bv };
  };
  const set = (name, p) => {
    r.setProperty(name, p.c);
    r.setProperty(name + "-sh", p.v >= 4.5 ? "none" : relLum(H(p.c)) > 0.35 ? "0 1px 2px rgba(30,8,15,.9), 0 0 6px rgba(30,8,15,.6)" : "0 0 4px rgba(255,255,255,.9), 0 1px 0 rgba(255,255,255,.7)");
  };
  const darken = (base, p, maxLum, C = B) => { let c = mix(C, H(base), p); while (relLum(c) > maxLum && p > 0) { p = Math.max(0, p - 0.04); c = mix(C, H(base), p); } return c; };
  const btn = [darken("#2a1218", 0.6, 0.06), darken("#1c0b10", 0.42, 0.035)];          // кнопки — от вторичного
  const tab = [darken("#2a1218", 0.45, 0.06, A), darken("#1c0b10", 0.3, 0.035, A)];    // вкладки верхней панели — от основного
  r.setProperty("--l-btn", hex(btn[0])); r.setProperty("--l-btn2", hex(btn[1]));
  r.setProperty("--l-tab", hex(tab[0])); r.setProperty("--l-tab2", hex(tab[1]));
  if (relLum(A) < 0.18) r.setProperty("--lo-title", hex(mix(A, H("#fff8f6"), 0.4))); else r.removeProperty("--lo-title");
  const act = [mix(B, W, 0.55), mix(B, W, 0.85)];
  const light = mix(A, H("#fbf0f0"), 0.5), lights = [mix(light, W, 0.55), light, mix(A, H("#f1d8d9"), 0.72)];
  const hi = mix(A, H("#fff8f6"), 0.4), lo = mix(A, H("#4a2430"), 0.65), ink = mix(A, H("#24100f"), 0.45);
  const l2hi = mix(B, H("#fff3f4"), 0.5), l2lo = mix(B, H("#12060a"), 0.62);
  set("--lo-on-btn", pick(btn, ["#f9eaec", LIGHT, DARK]));
  set("--lo-on-tab", pick(btn, [hex(hi), "#f9eaec", LIGHT, DARK]));
  set("--lo-on-tabbg", pick(tab, [hex(hi), "#f9eaec", LIGHT, DARK]));
  set("--lo-on-act", pick(act, [LIGHT, DARK]));
  set("--lo-on-tabact", pick([mix(A, W, 0.75), A], [hex(ink), DARK, LIGHT]));
  set("--lo-ink", pick(lights, [hex(ink), DARK, LIGHT]));
  set("--lo-on-mid", pick([A, lo], [LIGHT, DARK], 1.8));
  set("--lo-on-l2", pick([l2hi, B, l2lo], [LIGHT, DARK], 1.8));
  if (Math.min(...btn.map((b) => cr(b, A))) < 2.2) r.setProperty("--lo-ic", r.getPropertyValue("--lo-on-btn"));
  else r.removeProperty("--lo-ic");
}

window.dynPal = null;     // цвета обложки для динамического фона (look/dynbg.js)

// Динамический фон: основные цвета берутся из обложки (dynPal), пока пользователь не выбрал их сам —
// тогда фон по обложке остаётся, а цвета — свои (cfg.dynColors = false). Сохранённые цвета стиля не трогаются.
function dynColorsOn() { return cfg.dyn === true && cfg.dynColors !== false; }      // объявление функции: applyCfg зовут и раньше этой строки
function applyCfg() {
  const r = document.documentElement.style, base = baseOf();
  const st = dynColorsOn() && dynPal ? { ...sty(), accent: dynPal.accent, accent2: dynPal.accent2 } : sty();
  document.body.classList.toggle("dyn-on", cfg.dyn === true);
  document.documentElement.classList.toggle("dyn-on", cfg.dyn === true);     // для :root.dyn-on в styles.css (вместо :root:has)
  // свой стиль, чей CSS ещё не подключён (идёт загрузка при старте), временно показывается как его основа
  document.documentElement.dataset.style = BUILTIN.includes(cfg.style) || themeReady.has(cfg.style) ? cfg.style : base;
  document.documentElement.dataset.base = base;
  // стиль без анимаций (features.animations = false) — анимации выключены, как если бы сняли галочку
  document.documentElement.dataset.anim = cfg.anim === false || !feature("animations") ? "off" : "on";
  r.setProperty("--accent", st.accent);
  r.setProperty("--accent2", st.accent2);
  const oa = onAccent(btnHi(st.accent2), st.accent2);      // кнопки залиты вторичным цветом — текст на них подбираем под него
  r.setProperty("--on-accent", oa.color);
  r.setProperty("--on-accent-shadow", base === "neon" ? oa.shadow : "none");
  r.setProperty("--glow", (base === "neon" || !BUILTIN.includes(cfg.style) ? st.glow : STYLE_DEF[cfg.style].glow) + "px");
  r.setProperty("--panel-a", st.panel / 100);
  r.setProperty("--dim", st.dim / 100);
  r.setProperty("--bgblur", cfg.blur + "px");
  loInk(st);
  const vid = curBgVideo();
  const img = curBg() && !vid ? `url("${curBg()}")` : "none";
  r.setProperty("--bg-image", img);
  const prev = vid ? bgPosters[cfg.style] : curBg();
  $("#drop").style.setProperty("--drop-img", prev ? `url("${prev}")` : "none");
  syncBgVideo();
  applyCustom();
  applyViz();
  applyHooks();
  saveBoot();
}
// ---------- возможности своих тем: ручка громкости, своя раскладка, кнопки-действия ----------
// Кнопки темы: settings whisper-music → "buttons": { "power": "wave", … }. Приложение создаёт их всегда
// (#thBtns > button.thbtn[data-th="power"]), а где они стоят и как выглядят — решает CSS темы.
// Действие нажимает обычную кнопку приложения, поэтому работает так же и так же отключается.
const TH_ACTIONS = {
  wave: ["#waveBtn", "Моя волна"], play: ["#play", "Пуск/пауза"], next: ["#next", "Следующий"], prev: ["#prev", "Предыдущий"],
  like: ["#likeBtn", "В лайки"], dislike: ["#disBtn", "Не нравится"], mute: ["#volBtn", "Выключить звук"],
  shuffle: ["#shuffleBtn", "Случайный порядок"], repeat: ["#repeatBtn", "Повтор"], full: ["#cover", "Обложка на весь экран"],
  sleep: ["#sleepBtn", "Режим сна"], more: ["#pMore", "Ещё"],
  "page:wave": ["#wave", "Моя волна"], "page:likes": ["#likes", "Лайки"], "page:stats": ["#statsBtn", "Статистика"],
  "page:settings": ["#settingsBtn", "Настройки"], "page:profile": ["#profile", "Профиль"],
  "vol-up": [null, "Громче"], "vol-down": [null, "Тише"],
  // окно: у окна нет системной рамки — тема, которая убирает .titlebar, обязана дать эти кнопки сама (themeguard.js)
  close: ["#wClose", "Закрыть"], minimize: ["#wMin", "Свернуть"], maximize: ["#wMax", "Развернуть"], drag: [null, "Перетащить окно"],
};
const thState = {
  wave: () => $("#waveBtn").classList.contains("playing"),
  play: () => document.body.classList.contains("is-playing"),
  like: () => $("#likeBtn").classList.contains("on"),
  dislike: () => $("#disBtn").classList.contains("on"),
  mute: () => volume === 0,
  shuffle: () => $("#shuffleBtn").classList.contains("on"),
  repeat: () => $("#repeatBtn").classList.contains("on"),
};
let thKey = "", thObs = null;
function renderThemeButtons(list) {
  const key = JSON.stringify(list);
  if (key === thKey) return;
  thKey = key;
  let box = $("#thBtns");
  if (!list.length) { box?.remove(); thObs?.disconnect(); thObs = null; return; }
  if (!box) { box = document.createElement("div"); box.id = "thBtns"; box.className = "thbtns"; document.body.append(box); }
  box.replaceChildren(...list.map(([name, act]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "thbtn"; b.dataset.th = name; b.dataset.act = act;
    b.title = TH_ACTIONS[act][1]; b.setAttribute("aria-label", TH_ACTIONS[act][1]);
    // «drag» — не щелчок: окно начинает двигаться, когда мышь сдвинули с зажатой кнопкой (как за заголовок)
    if (act === "drag") b.addEventListener("mousedown", (e) => { if (e.button === 0) winDragFrom(e); });
    b.onclick = () => {
      if (act === "drag") return;
      if (act === "vol-up") return setVol(volume + 0.05);
      if (act === "vol-down") return setVol(volume - 0.05);
      const el = $(TH_ACTIONS[act][0]);
      if (el && !el.disabled) el.click();
    };
    return b;
  }));
  // состояние кнопок (.on): следим за классами тех элементов, по которым оно видно
  if (!thObs) {
    thObs = new MutationObserver(thSync);
    for (const el of [document.body, $("#waveBtn"), $("#likeBtn"), $("#disBtn"), $("#shuffleBtn"), $("#repeatBtn"), ...document.querySelectorAll(".side .nav")])
      if (el) thObs.observe(el, { attributes: true, attributeFilter: ["class", "disabled"] });
  }
  thSync();
}
function thSync() {
  const box = document.getElementById("thBtns");
  if (!box) return;
  for (const b of box.children) {
    const act = b.dataset.act, src = TH_ACTIONS[act]?.[0] && $(TH_ACTIONS[act][0]);
    const on = act.startsWith("page:") ? !!src?.classList.contains("active") : !!thState[act]?.();
    b.classList.toggle("on", on);
    b.disabled = !!src?.disabled;
  }
}
function applyHooks() {
  const de = document.documentElement, kn = !!hook("volKnob"), vb = $("#volBtn");
  de.toggleAttribute("data-vol-knob", kn);
  if (kn) { vb.setAttribute("role", "slider"); vb.setAttribute("aria-valuemin", "0"); vb.setAttribute("aria-valuemax", "100"); vb.setAttribute("aria-valuenow", String(Math.round(volume * 100))); }
  else ["role", "aria-valuemin", "aria-valuemax", "aria-valuenow"].forEach((a) => vb.removeAttribute(a));
  window.layoutLock?.(!!hook("layoutFixed"));
  // «Скрывать закреплённые» и маскот — только там, где стиль их выдерживает (features.pinHide / features.mascot).
  // Стиль, который сам задаёт раскладку ("layout": "fixed"), закреплённые не прячет: режим просто не применится.
  // Маскот у такого стиля (и у стиля-консоли) тоже выключен — кот ходит по верху обычной нижней панели, а её
  // там переделали или нет вовсе; автор может вернуть кота явным "mascot": true.
  const catSet = themeFeatures[cfg.style]?.mascot;
  const pinOk = feature("pinHide") && !hook("layoutFixed");
  const catOk = typeof catSet === "boolean" ? catSet : !hook("layoutFixed") && !hook("console");
  window.layoutNoPinHide?.(!pinOk);
  window.mascotAllowed?.(catOk);
  const phc = $("#pinHideCard"), mcc = $("#mascotCard");
  if (phc) phc.style.display = pinOk ? "" : "none";
  if (mcc) mcc.style.display = catOk ? "" : "none";
  renderThemeButtons(hook("buttons") || []);
  applyThemeEffects(hook("effects") || []);
  window.themeFxApply?.();                            // события, курсор, слой украшений и частицы темы (themefx.js)
  window.cliMount?.(hook("console") || null);          // стиль-консоль (cli.js)
}
// Эффекты темы (settings whisper-music → "effects" или пометка data-fx-… в CSS, разбирает theme.js): на <html> —
// data-fx-<имя>="on|off", по нему CSS темы включает снег, гирлянду и т. п. Выбор пользователя — cfg.s[стиль].fx
// (окно «Настроить тему…», theme.js). Эффект — «показывать или нет», а не «двигается ли»: эффектом может быть и
// неподвижное украшение (снеговик, гирлянда), у которого при выключенных анимациях тема показывает застывшую копию.
// Движение тема по-прежнему включает под :root[data-anim="on"].
const themeFx = (k, def, st = cfg.style) => { const s = cfg.s[st]; const v = s?.fx?.[k] ?? s?.opts?.[k]; return typeof v === "boolean" ? v : def; };
const themeFxSet = (st, k, on) => { const s = cfg.s[st]; if (!s) return; (s.fx ||= {})[k] = !!on; applyCfg(); saveCfg(); };
function applyThemeEffects(list) {
  const de = document.documentElement;
  // applyCfg зовут часто (пипетка цвета): атрибуты трогаем, только когда они реально меняются
  const want = new Map(list.map((o) => ["data-fx-" + o.k, themeFx(o.k, o.def) ? "on" : "off"]));
  for (const a of [...de.attributes]) if (/^data-(fx|opt)-/.test(a.name) && !want.has(a.name)) de.removeAttribute(a.name);
  for (const [n, v] of want) if (de.getAttribute(n) !== v) de.setAttribute(n, v);
}
// Снимок для следующего запуска (boot.js): какой стиль на <html> и какой цвет фона показать под «шторкой»,
// пока стиль собирается. Пишется, только когда стиль уже собран целиком (свой стиль — после подключения его CSS).
var bootSaveT = 0;        // var: applyCfg (а с ним saveBoot) зовут и раньше этой строки
function saveBoot() {
  clearTimeout(bootSaveT);
  bootSaveT = setTimeout(() => {
    const root = document.documentElement;
    if (root.classList.contains("booting") || root.dataset.style !== cfg.style) return;
    let bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || /^rgba\([^)]*,\s*0\)$/.test(bg) || bg === "transparent") bg = "";
    const accent = getComputedStyle(root).getPropertyValue("--accent").trim();      // цвет индикатора загрузки
    try { localStorage.setItem("ym_boot", JSON.stringify({ style: cfg.style, base: root.dataset.base || "", bg, accent })); } catch {}
  }, 300);
}
window.saveBoot = saveBoot;
function saveCfg() {
  try { localStorage.setItem("ym_cfg3", JSON.stringify(cfg)); $("#setNote").textContent = ""; return true; }
  catch { $("#setNote").textContent = "Не удалось сохранить настройки: закончилось место в хранилище приложения."; return false; }
}
const SLIDERS = [["#cAccent", "accent"], ["#cAccent2", "accent2"], ["#cGlow", "glow", 1], ["#cPanel", "panel", 1], ["#cDim", "dim", 1], ["#cBlur", "blur", 1]];
const getv = (k) => (STYLE_KEYS.includes(k) ? sty()[k] : cfg[k]);
const setv = (k, v) => { if (STYLE_KEYS.includes(k)) sty()[k] = v; else cfg[k] = v; };
function syncControls() {
  for (const [id, k] of SLIDERS) $(id).value = getv(k);
  if (dynColorsOn() && dynPal) { $("#cAccent").value = dynPal.accent; $("#cAccent2").value = dynPal.accent2; }      // видно, какие цвета сейчас взяты из обложки
  $("#cViz").checked = cfg.viz;
  syncVizStyles();
  $("#cAnim").checked = cfg.anim !== false;
  $("#cDyn").checked = cfg.dyn === true;
  // цвета можно выбрать всегда: при динамическом фоне свой выбор просто заменяет цвета обложки
  document.querySelectorAll("#cAccent, #cAccent2").forEach((el) => {
    el.disabled = false;
    el.title = dynColorsOn() ? "Сейчас цвета берутся из обложки — выбери свой, и он заменит их (фон останется)" : "";
  });
  syncColorReset();
  $("#paletteBtn").disabled = dynColorsOn();
  $("#paletteBtn").title = dynColorsOn() ? "Пока включён динамический фон, цвета берутся из обложки" : "";
  // ползунки и галочки — только для того, что у стиля есть (feature)
  const glow = feature("glow"), panels = feature("panelOpacity"), anim = feature("animations");
  $("#cGlow").closest("label").style.display = glow ? "" : "none";
  $("#cPanel").closest("label").style.display = panels ? "" : "none";
  $("#cAnim").closest("label").style.display = anim ? "" : "none";
  // карточка видна всегда: в ней кнопка «Настроить тему…» (эффекты и интро любой установленной темы, theme.js)
  document.querySelectorAll(".stylecard").forEach((b) => b.classList.toggle("on", b.dataset.style === cfg.style));
  // под списком стилей (в компактном виде): «Автор · Название» выбранного стиля
  const sel = document.querySelector(".stylecard.on"), cap = $("#styleCap");
  if (cap) cap.textContent = sel ? [sel.querySelector(".scauth")?.textContent, sel.querySelector(".scname")?.textContent].filter(Boolean).join(" · ") : "";
  fillAll();
}
// свой цвет при динамическом фоне: фон по обложке остаётся, цвета интерфейса — выбранные
function manualColors() {
  if (!dynColorsOn()) return;
  cfg.dynColors = false;
  syncControls();
  showToast("Цвета выбраны вручную, фон по обложке остался", 6000, { kind: "ok", action: { label: "Вернуть цвета обложки", fn: () => { cfg.dynColors = true; saveCfg(); applyCfg(); syncControls(); } } });
}
// «Цвета темы»: основной и второй цвета — как задумал автор стиля (встроенного или из файла .wmt).
// Остальные настройки стиля (свечение, прозрачность, «Тонкая настройка») не трогаются.
function themeColors(st = cfg.style) {
  if (STYLE_DEF[st]) return { accent: STYLE_DEF[st].accent, accent2: STYLE_DEF[st].accent2 };
  return window.wmtDefaultColors?.(st) || null;
}
function syncColorReset() {
  const b = $("#colorReset");
  if (!b) return;
  const d = themeColors(), s = sty();
  const same = !!d && !dynColorsOn() && s.accent?.toLowerCase() === d.accent.toLowerCase() && s.accent2?.toLowerCase() === d.accent2.toLowerCase();
  b.disabled = !d || same;
  b.title = !d ? "Цвета темы пока не загружены"
    : same ? "Сейчас и так стоят цвета темы"
    : dynColorsOn() ? "Вернуть цвета темы вместо цветов обложки (фон по обложке останется)"
    : "Вернуть основной и второй цвета, которые заданы в теме";
}
$("#colorReset")?.addEventListener("click", () => {
  const d = themeColors();
  if (!d) return;
  const s = sty(), prev = { accent: s.accent, accent2: s.accent2 }, wasDyn = dynColorsOn();
  if (wasDyn) cfg.dynColors = false;
  s.accent = d.accent; s.accent2 = d.accent2;
  applyCfg(); saveCfg(); syncControls();
  showToast("Цвета темы возвращены", 5000, { kind: "ok", action: { label: "Отменить", fn: () => {
    Object.assign(sty(), prev);
    if (wasDyn) cfg.dynColors = true;
    applyCfg(); saveCfg(); syncControls();
  } } });
});
// Пока водишь по палитре или тянешь ползунок, событий input — сотни в секунду, а полный applyCfg каждый раз
// пересобирал «Тонкую настройку» (DynCss дважды + замеры getComputedStyle), трогал фон, визуализатор и кнопки темы.
// Отсюда и лаг выбора цвета. Теперь: не чаще раза за кадр и только переменные (applyLive); полностью — по change.
let liveRaf = 0, cpickT = 0;
function applyLive() {
  const r = document.documentElement.style, base = baseOf();
  const st = dynColorsOn() && dynPal ? { ...sty(), accent: dynPal.accent, accent2: dynPal.accent2 } : sty();
  r.setProperty("--accent", st.accent);
  r.setProperty("--accent2", st.accent2);
  const oa = onAccent(btnHi(st.accent2), st.accent2);
  r.setProperty("--on-accent", oa.color);
  r.setProperty("--on-accent-shadow", base === "neon" ? oa.shadow : "none");
  r.setProperty("--glow", (base === "neon" || !BUILTIN.includes(cfg.style) ? st.glow : STYLE_DEF[cfg.style].glow) + "px");
  r.setProperty("--panel-a", st.panel / 100);
  r.setProperty("--dim", st.dim / 100);
  r.setProperty("--bgblur", cfg.blur + "px");
  loInk(st);
}
for (const [id, key, num] of SLIDERS) {
  const el = $(id);
  el.addEventListener("input", () => {
    if (key === "accent" || key === "accent2") manualColors();
    setv(key, num ? +el.value : el.value);
    // плавный переход цветов динамического фона (1,2 с) здесь только мешает: цвет отставал бы от курсора
    document.documentElement.classList.add("cpick");
    clearTimeout(cpickT);       // change может и не прийти (палитру закрыли Esc) — снимаем сами через секунду тишины
    cpickT = setTimeout(() => document.documentElement.classList.remove("cpick"), 1000);
    if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; applyLive(); });
  });
  el.addEventListener("change", () => {
    cancelAnimationFrame(liveRaf); liveRaf = 0;
    document.documentElement.classList.remove("cpick");
    applyCfg(); saveCfg(); syncColorReset();                                                          // на диск — когда отпустил
  });
}
document.querySelectorAll("input[type=range]").forEach((el) => el.addEventListener("input", () => fill(el)));
document.querySelectorAll(".stylecard").forEach((b) => (b.onclick = () => { cfg.style = b.dataset.style; applyCfg(); saveCfg(); syncControls(); }));

// фон окна, видеообои и IDB — look/bg.js
// «Исходный вид стиля»: текущий стиль — как задумано. Свой (.wmt) — как в его файле (фон из темы, цвета, эффекты:
// theme.js → wmtResetStyle), встроенный — как в STYLE_DEF и без своего фона. Остальные стили и общие настройки не трогаются.
async function resetStyle(st = cfg.style) {
  const custom = !BUILTIN.includes(st);
  const card = document.querySelector(`.stylecard[data-style="${CSS.escape(st)}"]`);
  const name = card?.querySelector(".scname")?.textContent || card?.querySelector("b")?.textContent || st;
  const ok = await modal({
    title: "Вернуть исходный вид стиля?",
    text: custom
      ? `Стиль «${name}» станет таким, как в его файле темы: фон из темы, цвета, свечение, затемнение, прозрачность панелей и эффекты. Свой фон и подобранные цвета у этого стиля пропадут.`
      : `Стиль «${name}» станет таким, каким был изначально: цвета, свечение, затемнение и прозрачность панелей, без своего фона.`,
    ok: "Вернуть", danger: true,
  });
  if (!ok) return;
  try {
    if (custom) await window.wmtResetStyle(st);
    else { await clearBg(st); cfg.s[st] = { ...STYLE_DEF[st], cc: {} }; }
  } catch (e) { showToast("Не удалось вернуть исходный вид: " + (e?.message || e), 6000, { kind: "err" }); return; }
  applyCfg(); saveCfg(); syncControls();
  showToast(`Стиль «${name}» — снова в исходном виде`, 3500, { kind: "ok" });
}
window.resetStyle = resetStyle;
$("#styleRestore").onclick = () => resetStyle();
$("#cfgReset").onclick = async () => {
  if (!(await modal({ title: "Сбросить оформление?", text: "Стиль, цвета, фон и визуализатор вернутся к начальным. Загруженные темы останутся.", ok: "Сбросить", danger: true }))) return;
  const keep = cfg.style, themes = cfg.themes;
  for (const st of Object.keys(cfg.s)) await clearBg(st);
  cfg = freshCfg(); cfg.themes = themes;
  for (const t of themes) cfg.s[t.id] = { ...STYLE_DEF[t.base], cc: {} };
  cfg.style = cfg.s[keep] ? keep : "neon";
  await window.wmtRestoreDefaults?.();        // свои стили: цвета и фон — снова как в их файлах .wmt
  applyCfg(); saveCfg(); syncControls();
};
$("#cViz").onchange = (e) => { cfg.viz = e.target.checked; syncVizStyles(); applyViz(); saveCfg(); };
// список стилей визуализатора виден только когда визуализатор включён
var VIZ_NOTE = { circle: "Неровные круги вокруг кнопки: дышат с басом и вздрагивают на каждую долю.", bars: "Столбцы разной высоты по частотам: слева и справа от кнопки, бас ближе к центру." };
function syncVizStyles() {
  $("#vizStyles").hidden = !cfg.viz;
  document.querySelectorAll(".vizopt").forEach((b) => b.classList.toggle("active", b.dataset.viz === cfg.vizStyle));
  $("#vizNote").textContent = VIZ_NOTE[cfg.vizStyle] || "";
}
document.querySelectorAll(".vizopt").forEach((b) => (b.onclick = () => { cfg.vizStyle = b.dataset.viz; syncVizStyles(); saveCfg(); }));
$("#cAnim").onchange = (e) => { cfg.anim = e.target.checked; applyCfg(); saveCfg(); };
$("#cDyn").onchange = (e) => { cfg.dyn = e.target.checked; if (cfg.dyn) cfg.dynColors = true; saveCfg(); syncControls(); dynUpdate(queue[current], true); };


function sniffImage(b) {
  const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8) return ["image/jpeg", "jpg"];
  if (b[0] === 0x89 && at(1, "PNG")) return ["image/png", "png"];
  if (at(0, "BM")) return ["image/bmp", "bmp"];
  if (at(0, "GIF8")) return ["image/gif", "gif"];
  if (at(0, "RIFF") && at(8, "WEBP")) return ["image/webp", "webp"];
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return ["image/avif", "avif"];
  return null;
}
$("#deskBtn").onclick = async () => {
  const btn = $("#deskBtn");
  btn.disabled = true;
  bgNote("Беру обои с рабочего стола…");
  try {
    let buf;
    try { buf = await invoke("desktop_wallpaper"); }
    catch (e) {
      const m = String(e?.message || e);
      throw new Error(/not found/i.test(m) ? "В этой сборке ещё нет функции обоев рабочего стола: обнови Rust-часть (desktop.rs)." : m);
    }
    const bytes = new Uint8Array(buf);
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("Не удалось распознать формат обоев рабочего стола. Выбери картинку вручную.");
    if (!(await loadBg(new File([bytes], "desktop-wallpaper." + kind[1], { type: kind[0] })))) return;
    const r = await pickPalette();
    if (r.ok && !r.mono) bgNote("Готово: фон с рабочего стола применён, цвета подобраны.");
  } catch (e) { bgNote(e.message || "Не удалось взять обои рабочего стола."); }
  finally { btn.disabled = false; }
};


export { STYLE_DEF, STYLE_KEYS, BUILTIN, themeReady, baseOf, styleDef, themeFeatures, themeHooks, hook, feature, freshCfg, loadCfg, bgUrls,
  bgKinds, bgPosters, bgKey, sty, curBg, curBgVideo, loInk, dynColorsOn, applyCfg, TH_ACTIONS, thSync, applyHooks, themeFx, themeFxSet,
  applyThemeEffects, saveBoot, saveCfg, syncControls, manualColors, themeColors, syncColorReset, applyLive, resetStyle, syncVizStyles };
// обычные скрипты (layout.js, ядро Whisper, boot.js…) и обращения window.X — берут это из window
Object.assign(window, { saveBoot, resetStyle });

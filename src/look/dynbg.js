// Динамический фон (обложка трека на весь фон, «аура» из её цветов) и подбор палитры по картинке
// (Оформление → «Цвета по фону», цвета обложки для динамического фона).
// ES-модуль, подключён ПЕРЕД app/main.js: main.js ещё при загрузке рисует трек (showTrack → dynUpdate). Поэтому при
// загрузке модуль ничего из main.js не трогает — cfg, $, curBg, sty, invoke… берёт по имени только внутри функций.
// dynPal — переменная main.js (var): модуль её записывает, main.js и yandex.js читают. Наружу — через window в конце.
// Обложка трека скачивается через Rust (fetch_bytes) и превращается в blob: — так её можно и показать, и
// разобрать на цвета (картинку с чужого адреса холст прочитать не даёт). Слоёв обложки два: новая плавно
// проявляется поверх старой. Над ними — «аура» из цветов обложки, лёгкое зерно и виньетка (styles.css, .dynbg).
import { $, invoke } from "../app/base.js";
import { cover } from "../app/list.js";
import { syncBgVideo, videoFrame } from "./bg.js";
import { applyCfg, curBg, curBgVideo, dynColorsOn, saveCfg, sty } from "./config.js";
let dynKey = "", dynSeq = 0, dynFront = 0;     // dynPal (цвета обложки) объявлен в main.js: его читают applyCfg и yandex.js
const dynCache = new Map();      // coverUri → { url, soft, echo, pal }
// Размытая и подкрашенная копия обложки — один раз на маленьком холсте, а не CSS-фильтром blur в каждом кадре.
// Уменьшение до side px уже размывает; затем коробочное размытие в пикселях (работает везде, в т.ч. в WebKitGTK,
// где у холста нет ctx.filter) и увеличение до out px, чтобы при растяжке на всё окно не было «ступенек».
function boxBlur(d, w, h, r) {
  const t = new Float32Array(d.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = -r; k <= r; k++) s += d[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c];
    t[(y * w + x) * 4 + c] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = -r; k <= r; k++) s += t[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c];
    d[(y * w + x) * 4 + c] = s / n;
  }
}
async function dynSoft(img, side, out, r, sat, bri) {
  const a = document.createElement("canvas"); a.width = a.height = side;
  const g = a.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, side, side);
  const id = g.getImageData(0, 0, side, side), d = id.data;
  for (let i = 0; i < d.length; i += 4) {                 // насыщенность и яркость — как filter: saturate() brightness()
    const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, (L + (d[i + c] - L) * sat) * bri));
  }
  boxBlur(d, side, side, r); boxBlur(d, side, side, r);
  g.putImageData(id, 0, 0);
  const b = document.createElement("canvas"); b.width = b.height = out;
  const h = b.getContext("2d", { willReadFrequently: true });
  h.imageSmoothingQuality = "high";
  h.drawImage(a, 0, 0, out, out);
  const id2 = h.getImageData(0, 0, out, out);
  boxBlur(id2.data, out, out, Math.max(1, Math.round(out / side)));      // сглаживаем швы после увеличения
  h.putImageData(id2, 0, 0);
  const blob = await new Promise((res) => b.toBlob(res, "image/png"));
  return blob ? URL.createObjectURL(blob) : "";
}
const dynRevoke = (v) => { for (const u of [v.url, v.soft, v.echo]) if (u) URL.revokeObjectURL(u); };
async function dynArt(t) {
  const key = String(t.coverUri || "");
  let it = dynCache.get(key);
  if (it) { dynCache.delete(key); dynCache.set(key, it); return it; }          // свежие — в конец
  const src = cover(t, "1000x1000");      // крупная: темы могут показывать обложку большой и чёткой (клякса в «Мелке»)
  if (!src) return null;
  const buf = await invoke("fetch_bytes", { url: src });
  const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
  let pal = null, soft = "", echo = "";
  try { pal = await paletteFrom(url); } catch {}
  try {
    const img = new Image(); img.src = url; await img.decode();
    soft = await dynSoft(img, 40, 160, 2, 1.5, 0.72);       // большие «дышащие» слои: сильное размытие
    echo = await dynSoft(img, 72, 216, 1, 1.4, 1);          // «эхо» обложки: размытие помягче
  } catch {}
  it = { url, soft: soft || url, echo: echo || url, pal };
  dynCache.set(key, it);
  while (dynCache.size > 16) { const [k, v] = dynCache.entries().next().value; if (v.url === dynShownUrl()) break; dynRevoke(v); dynCache.delete(k); }
  return it;
}
const dynLayers = () => document.querySelectorAll("#dynBg .dyn-l");
const dynShownUrl = () => dynLayers()[dynFront]?.dataset.url || "";
function dynShow(it) {
  const box = $("#dynBg"), ls = dynLayers();
  if (dynShownUrl() !== it.url) {
    const next = ls[1 - dynFront];
    next.style.backgroundImage = `url("${it.soft}")`; next.dataset.url = it.url;
    // перезапуск «дыхания», чтобы новая обложка начинала с того же кадра
    next.classList.remove("on"); void next.offsetWidth; next.classList.add("on");
    ls[dynFront].classList.remove("on");
    dynFront = 1 - dynFront;
    const [art, echo] = box.querySelectorAll(".dyn-art i");
    if (art) art.style.backgroundImage = `url("${it.url}")`;
    if (echo) echo.style.backgroundImage = `url("${it.echo}")`;
  }
  box.classList.add("ready");
  const p = it.pal;
  if (p) {
    box.style.setProperty("--dyn-a", p.accent); box.style.setProperty("--dyn-b", p.accent2);
    // и для всего окна: темы могут рисовать цветом обложки вне фона (например, клякса в «Мелке»)
    document.documentElement.style.setProperty("--dyn-a", p.accent); document.documentElement.style.setProperty("--dyn-b", p.accent2);
    dynPal = { accent: p.accent, accent2: p.accent2 };
    if (dynColorsOn()) { $("#cAccent").value = p.accent; $("#cAccent2").value = p.accent2; }
  }
  applyCfg();
}
async function dynUpdate(t, force = false) {
  const my = ++dynSeq;
  if (cfg.dyn !== true) {
    $("#dynBg").classList.remove("ready");
    if (dynPal || force) { dynPal = null; dynKey = ""; applyCfg(); }
    syncBgVideo();
    return;
  }
  syncBgVideo();
  // нет обложки (трек из файла) или офлайн (обложку не качаем) — остаётся прежний фон
  if (!t?.coverUri || offline) { if (force) applyCfg(); return; }
  const key = String(t.coverUri);
  if (key === dynKey && !force) return;
  try {
    const it = await dynArt(t);
    if (my !== dynSeq || !it) return;
    dynKey = key;
    dynShow(it);
  } catch { if (force) applyCfg(); }
}

// ---------- палитра по картинке ----------
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hsl2hex(h, s, l) {
  s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
async function paletteFrom(src) {
  let img;
  if (curBgVideo() && src === curBg()) img = await videoFrame(src, 160);           // видеообои — берём кадр
  else { img = new Image(); img.src = src; await img.decode(); }
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const bins = Array.from({ length: 24 }, (_, i) => ({ h: i * 15 + 7.5, w: 0, s: 0 }));
  let sumS = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    sumS += s; n++;
    const w = s * (1 - Math.abs(2 * l - 1));
    const b = bins[Math.floor(h / 15) % 24];
    b.w += w; b.s += s * w;
  }
  if (!n || sumS / n < 0.1) return { accent: "#e8e8f4", accent2: "#9a9ab4", mono: true };
  const sorted = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const first = sorted[0];
  const dist = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
  const second = sorted.find((b) => b !== first && dist(b.h, first.h) >= 45 && b.w >= first.w * 0.25);
  const sat = (b) => Math.min(0.95, Math.max(0.6, b.s / b.w));
  return {
    accent: hsl2hex(first.h, sat(first), 0.64),
    accent2: second ? hsl2hex(second.h, sat(second), 0.62) : hsl2hex((first.h + 45) % 360, 0.8, 0.66),
  };
}
async function pickPalette() {
  const note = $("#setNote");
  if (!curBg()) { note.textContent = "Сначала загрузи фон: цвета подбираются по нему."; return { ok: false }; }
  try {
    const p = await paletteFrom(curBg());
    sty().accent = p.accent; sty().accent2 = p.accent2;
    $("#cAccent").value = p.accent; $("#cAccent2").value = p.accent2;
    applyCfg(); saveCfg();
    note.textContent = p.mono ? "Фон почти без цвета, поэтому палитра получилась сдержанной серебристой." : "Цвета подобраны по фону.";
    return { ok: true, mono: !!p.mono };
  } catch { note.textContent = "Не удалось разобрать изображение."; return { ok: false }; }
}
document.getElementById("paletteBtn").onclick = pickPalette;

export { dynUpdate, pickPalette };

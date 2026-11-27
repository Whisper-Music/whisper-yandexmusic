// Громкость (ползунок, кнопка-ручка, колесо, Ctrl+стрелки), полоса воспроизведения, rangeGrab — щелчок и перетаскивание
// ползунков по точке под курсором. seekDrag — свойство window: его читают player/core.js и mobile.js.
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце. rangeGrab для #seek и #fSeek зовёт main.js.
import { fill, ICON, wReport } from "../app/base.js";
import { hook, thSync } from "../look/config.js";
import { outVol } from "./core.js";
const $ = (s) => document.querySelector(s);

let lastVol = parseFloat(localStorage.getItem("ym_lastvol")) || 0.8;
function setVol(v) {
  volume = Math.max(0, Math.min(1, v));
  try { localStorage.setItem("ym_vol", String(volume)); } catch {}
  if (audio) audio.volume = outVol();
  const pct = Math.round(volume * 100);
  $("#vol").value = pct; fill($("#vol"));
  $("#volVal").textContent = pct;
  $("#volBtn").innerHTML = ICON[volume === 0 ? "mute" : volume < 0.5 ? "low" : "high"];
  document.documentElement.style.setProperty("--vol", String(volume));      // громкость числом 0…1 — для CSS тем (ручка громкости)
  if (hook("volKnob")) $("#volBtn").setAttribute("aria-valuenow", String(pct));
  thSync();
  wReport({ volume });
}
$("#vol").addEventListener("input", (e) => setVol(e.target.value / 100));
$("#volBtn").onclick = () => { if (knob.moved) { knob.moved = false; return; } if (volume > 0) { lastVol = volume; try { localStorage.setItem("ym_lastvol", String(lastVol)); } catch {} setVol(0); } else setVol(lastVol || 0.5); };
// Громкость ручкой (тема с controls.volume = "knob"): тянуть вверх/вправо — громче, вниз/влево — тише;
// короткий щелчок без движения — как раньше, выключить/вернуть звук. Стрелки — по 5 %.
const knob = { y: 0, x: 0, v: 0, id: null, moved: false };
$("#volBtn").addEventListener("pointerdown", (e) => {
  if (!hook("volKnob") || e.button !== 0) return;
  Object.assign(knob, { y: e.clientY, x: e.clientX, v: volume, id: e.pointerId, moved: false });
  e.currentTarget.setPointerCapture(e.pointerId);
});
$("#volBtn").addEventListener("pointermove", (e) => {
  if (knob.id !== e.pointerId) return;
  const d = knob.y - e.clientY + (e.clientX - knob.x);
  if (!knob.moved && Math.abs(d) < 4) return;
  knob.moved = true;
  setVol(knob.v + d / 160);
});
const knobEnd = (e) => { if (knob.id === e.pointerId) knob.id = null; };
$("#volBtn").addEventListener("pointerup", knobEnd);
$("#volBtn").addEventListener("pointercancel", (e) => { knobEnd(e); knob.moved = false; });
$("#volBtn").addEventListener("keydown", (e) => {
  if (!hook("volKnob")) return;
  const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
  if (d) { e.preventDefault(); e.stopPropagation(); setVol(volume + d); }
});
$("#volWrap").addEventListener("wheel", (e) => { e.preventDefault(); setVol(volume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
// Окно громкости открыто (наведение или фокус) — html.vol-open: плеер встаёт над «Очередью», ручка размера панели
// не ловит курсор (styles.css, layout.css). Не html:has(.player .volwrap:hover…): с ним каждое изменение внутри
// плеера (время раз в секунду) пересчитывало стили всего окна — в «Лайках» ~70 мс.
(() => {
  const w = $("#volWrap");
  let hov = false, foc = false;
  const upd = () => document.documentElement.classList.toggle("vol-open", hov || foc);
  w.addEventListener("pointerenter", () => { hov = true; upd(); });
  w.addEventListener("pointerleave", () => { hov = false; upd(); });
  w.addEventListener("focusin", () => { foc = true; upd(); });
  w.addEventListener("focusout", (e) => { if (!w.contains(e.relatedTarget)) { foc = false; upd(); } });
})();
$("#seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });
// Перемотка щелчком. У <input type=range> щелчок по самому кружку не двигает его — это начало перетаскивания,
// а кружок стоит ровно там, куда только что щёлкнули: повторный щелчок рядом «не срабатывал», пока трек его не
// отодвинет (секунды). Поэтому щелчок и перетаскивание считаем сами: значение — по точке под курсором,
// а события input/change — те же, что у обычного ползунка (на них уже подписаны плеер, «Слушать вместе» и т. д.).
window.seekDrag = false;              // идёт перетаскивание ползунка — ontimeupdate (player/core.js) его не трогает
function rangeGrab(el) {
  const at = (e) => {
    const r = el.getBoundingClientRect(), th = 14;                // ширина кружка: середина его — на краях дорожки
    const k = Math.min(1, Math.max(0, (e.clientX - r.left - th / 2) / Math.max(1, r.width - th)));
    return Math.round(+el.min + k * (+el.max - +el.min));
  };
  const put = (e) => {
    const v = at(e);
    if (+el.value === v) return;
    el.value = v; fill(el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || el.disabled) return;
    e.preventDefault();                                             // свой жест вместо встроенного перетаскивания
    el.focus({ preventScroll: true });
    try { el.setPointerCapture(e.pointerId); } catch {}
    seekDrag = true;
    put(e);
    const move = (ev) => put(ev);
    const up = () => {
      seekDrag = false;
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  });
}

export { setVol, rangeGrab };

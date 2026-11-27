// Кнопки окна без рамки (свернуть, развернуть, закрыть), перетаскивание за заголовок, значок «развернуть / восстановить».
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце. Первый syncMax() зовёт main.js.
import { ICON, invoke } from "./base.js";
const $ = (s) => document.querySelector(s);

ICON.winMax = '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.2" y="2.2" width="7.6" height="7.6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
ICON.winRestore = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3.6 3.6V2.2h6.2v6.2H8.4M2.2 3.6h6.2v6.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
const win = (cmd) => Promise.resolve(invoke(cmd)).catch(() => {});
async function syncMax() {
  try {
    const m = await invoke("win_is_max");
    $("#wMax").innerHTML = m ? ICON.winRestore : ICON.winMax;
    $("#wMax").title = m ? "Свернуть в окно" : "Развернуть";
  } catch {}
}
$("#wMin").onclick = () => win("win_minimize");
$("#wMax").onclick = async () => { await win("win_toggle_max"); syncMax(); };
$("#wClose").onclick = () => win("win_close");
// Перетаскивание начинаем не сразу по нажатию, а при первом движении мыши с зажатой кнопкой.
// В Linux (GTK) окно, которое уже «тащат», забирает себе мышь, и второй щелчок двойного клика
// до страницы не доходил — разворот по двойному щелчку не работал. В Windows поведение то же, что было.
$("#titlebar").addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  if (e.detail === 2) { win("win_toggle_max"); return; }
  winDragFrom(e);
});
// Начать перетаскивание окна с этого нажатия: заголовок, кнопка темы «drag», аварийная полоса (themeguard.js)
function winDragFrom(e) {
  const x0 = e.screenX, y0 = e.screenY;
  const move = (m) => {
    if (!(m.buttons & 1)) return stop();
    if (Math.abs(m.screenX - x0) + Math.abs(m.screenY - y0) < 3) return;
    stop(); win("win_drag");
  };
  const stop = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);
}
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(syncMax, 120); });

export { win, syncMax, winDragFrom };

// Порядок воспроизведения: перемешивание, повтор, следующий и предыдущий трек (nextIndex / prevIndex), кнопки режимов.
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
import { ICON, wReport } from "../app/base.js";
const $ = (s) => document.querySelector(s);

const modesActive = () => !wave.on && (playCtx === "likes" || playCtx === "album" || playCtx === "playlist");
const effRepeat = () => (modesActive() ? repeat : repeat === 2 ? 2 : 0);
function buildOrder() {
  order = queue.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const k = order.indexOf(current);
  if (k > 0) [order[0], order[k]] = [order[k], order[0]];
  ordPos = 0; orderFor = queue;
}
function nextIndex(auto) {
  if (auto && effRepeat() === 2) return current;
  // ведущий комнаты с галочкой «Ставить в очередь»: предложенный трек встаёт сразу за текущим (together.js)
  window.roomTake?.();
  if (!modesActive()) return current + 1;
  if (shuffle) {
    if (orderFor !== queue || order.length !== queue.length || order[ordPos] !== current) buildOrder();
    if (ordPos + 1 < order.length) return order[ordPos + 1];
    if (repeat === 1) { buildOrder(); return order.length > 1 ? order[1] : current; }
    return -1;
  }
  if (current + 1 < queue.length) return current + 1;
  return repeat === 1 ? 0 : -1;
}
function prevIndex() {
  if (modesActive() && shuffle && orderFor === queue && order.length === queue.length && order[ordPos] === current) {
    return ordPos > 0 ? order[ordPos - 1] : current;
  }
  if (modesActive() && repeat === 1 && current === 0) return queue.length - 1;
  return current - 1;
}
function saveModes() { try { localStorage.setItem("ym_modes", JSON.stringify({ shuffle, repeat })); } catch {} }
function updateModes() {
  const on = modesActive(), sh = $("#shuffleBtn"), rp = $("#repeatBtn"), er = effRepeat();
  sh.disabled = !on;
  rp.disabled = false;
  sh.classList.toggle("on", on && shuffle);
  rp.classList.toggle("on", er > 0);
  sh.innerHTML = ICON.shuffle;
  rp.innerHTML = er === 2 ? ICON.repeatOne : ICON.repeat;
  sh.title = on ? (shuffle ? "Случайный порядок: включён" : "Случайный порядок") : "Случайный порядок доступен только в альбомах и лайках";
  rp.title = on ? ["Повтор выключен", "Повтор всего списка", "Повтор трека"][repeat] : er === 2 ? "Повтор трека: включён" : "Повтор трека";
  wReport({ modes: { available: on, shuffle: on && shuffle, repeat: er } });
}
$("#shuffleBtn").onclick = () => { shuffle = !shuffle; if (shuffle) buildOrder(); saveModes(); updateModes(); };
$("#repeatBtn").onclick = () => { repeat = modesActive() ? (repeat + 1) % 3 : repeat === 2 ? 0 : 2; saveModes(); updateModes(); };

export { modesActive, effRepeat, buildOrder, nextIndex, prevIndex, saveModes, updateModes };
// обычные скрипты (layout.js, ядро Whisper, boot.js…) и обращения window.X — берут это из window
Object.assign(window, { updateModes });

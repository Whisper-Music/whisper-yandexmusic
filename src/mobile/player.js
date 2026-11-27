// Телефон: мини-плеер (линия трека, плеер на «Моей волне»), плеер на весь экран (подписанные кнопки, режимы,
// путь к альбому и обратно), жесты плеера и связь, пропавшая посреди трека.
import { el } from "./sections.js";             // el(тег, класс, текст) — общий помощник мобильных модулей
import { showToast } from "../app/menu.js";
import { suspectOffline } from "../app/offline.js";
import { offlineFallback } from "../player/core.js";
import { closeFull, fullPeek, openFull, setFullMode } from "../player/full.js";
const root = document.documentElement;

// ---------- мини-плеер — сам линия трека ----------
// Как мини-вид на компьютере (layout.css, data-ly-ui="super"): заполнение идёт по всей панели. Нажатия по панели
// остаются кнопкам и открытию плеера, а перематывать — тянуть за верхний край (полоса .mgrab над панелью).
function seekBar() {
  const player = document.querySelector(".app > .player"), seek = document.getElementById("seek");
  if (!player || !seek) return;
  const grab = document.createElement("div");
  grab.className = "mgrab";
  const tip = document.createElement("b");
  grab.append(tip);
  player.append(grab);
  const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  let on = false;
  const at = (e) => {
    const r = player.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    seek.value = Math.round(+seek.min + k * (seek.max - seek.min));
    seek.style.setProperty("--p", k * 100 + "%");
    tip.textContent = mmss(k * (audio?.duration || 0));
    tip.style.left = k * 100 + "%";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
  };
  grab.addEventListener("pointerdown", (e) => {
    if (seek.disabled || !audio?.duration) return;
    on = true; try { seekDrag = true; } catch {}
    grab.setPointerCapture?.(e.pointerId);
    player.classList.add("m-seeking");
    at(e);
    e.preventDefault();
  });
  grab.addEventListener("pointermove", (e) => { if (on) at(e); });
  const end = () => {
    if (!on) return;
    on = false; try { seekDrag = false; } catch {}
    player.classList.remove("m-seeking");
    seek.dispatchEvent(new Event("change", { bubbles: true }));
  };
  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
  // свайп по плееру (следующий/предыдущий трек) и открытие плеера на весь экран — не отсюда
  for (const ev of ["touchstart", "touchend", "click"]) grab.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== "click" });
}

// ---------- из плеера на весь экран к альбому или автору — и обратно ----------
// Название и исполнитель в плеере на весь экран — ссылки (main.js: закрыть плеер → navigate к альбому/автору).
// «Назад» на открытой так странице возвращает не на прошлую страницу приложения, а в тот же плеер — в том же
// виде (обложка или текст песни). Страницу узнаём по номеру перехода main.js (nav): ушли дальше — уже не она.
function backToFull() {
  const full = document.getElementById("full");
  if (!full) return;
  let from = null;          // { mode, nav } — откуда и на какой странице
  full.addEventListener("click", (e) => {
    if (!e.target.closest("#fTitle, #fArtist .art")) return;
    const mode = full.dataset.mode || "cover";
    from = { mode, nav: -1 };
    setTimeout(() => { try { if (from) from.nav = nav; } catch { from = null; } }, 0);   // navigate() уже прошёл
  }, true);
  document.getElementById("back")?.addEventListener("click", () => {
    let cur = -2;
    try { cur = nav; } catch {}
    if (!from || from.nav !== cur) { from = null; return; }
    const mode = from.mode; from = null;
    setTimeout(() => {
      try { openFull(); if (mode !== (full.dataset.mode || "cover")) setFullMode(mode); } catch {}
    }, 0);
  }, true);                 // до обработчика main.js: он сразу сменит номер перехода
}

// ---------- «Случайный порядок» и «Повтор» в плеере на весь экран ----------
// Это те же кнопки нижней панели (#shuffleBtn, #repeatBtn — в мини-плеере их не видно): копия повторяет их вид
// и состояние (включена, недоступна в волне) и нажимает оригинал. ♡ переезжает к названию — справа от него.
function fullModes() {
  const box = document.querySelector("#full .fbtns"), sh = document.getElementById("shuffleBtn"), rp = document.getElementById("repeatBtn");
  if (!box || !sh || !rp || box.querySelector(".mfmode")) return;
  const mk = (src, id) => {
    const b = el("button", "modebtn mfmode"); b.type = "button"; b.id = id;
    const sync = () => {
      b.innerHTML = src.innerHTML; b.disabled = src.disabled; b.title = src.title;
      b.classList.toggle("on", src.classList.contains("on"));
    };
    sync();
    new MutationObserver(sync).observe(src, { attributes: true, childList: true, subtree: true });
    b.onclick = (e) => { e.stopPropagation(); src.click(); };
    return b;
  };
  box.prepend(mk(sh, "fShuffle"));
  box.append(mk(rp, "fRepeat"));
  const like = document.getElementById("fLike"), titles = document.getElementById("fTitles");
  if (like && titles) titles.append(like);
}

// ---------- связь пропала посреди трека ----------
// Трек из сети (Яндекс, архив) при обрыве не выдаёт ошибку — плеер просто ждёт данных, и волна молча стоит.
// Если позиция не двигается 10 с, а плеер не на паузе, проверяем связь (main.js suspectOffline): её нет —
// переходим на скачанное и кэш (offlineFallback: следующий такой трек в очереди или все скачанные).
function stallGuard() {
  let lastT = -1, since = 0, busy = false;
  setInterval(async () => {
    let a = null, local = false, loading = false;
    try { a = audio; local = curLocal; loading = !!loadAt; } catch { return; }
    if (!a || a.paused || a._native || local || loading || busy) { since = 0; lastT = -1; return; }
    if (a.currentTime !== lastT) { lastT = a.currentTime; since = 0; return; }
    since += 2000;
    if (since < 10000) return;
    busy = true; since = 0;
    try {
      const seq = playSeq;
      if (await suspectOffline() && seq === playSeq) await offlineFallback(current, seq);
    } catch {} finally { busy = false; }
  }, 2000);
}

// ---------- мини-плеер на «Моей волне» ----------
// открыта «Моя волна» и играет она — пуск/пауза уже есть большой кнопкой на экране, в мини-плеере её прячем
// (html.m-wavehere, mobile.css). wave — переменная main.js; #waveBtn меняется при каждой смене состояния
function waveHere() {
  const main = document.querySelector(".app > .main"), wb = document.getElementById("waveBtn");
  if (!main) return;
  const upd = () => {
    let on = false;
    try { on = typeof wave === "object" && !!wave?.on; } catch {}
    root.classList.toggle("m-wavehere", main.dataset.page === "wave" && on);
  };
  new MutationObserver(upd).observe(main, { attributes: true, attributeFilter: ["data-page"] });
  if (wb) new MutationObserver(upd).observe(wb, { attributes: true, childList: true });
  upd();
  // невидимые «назад» и «вперёд»: нажатие слева от большой кнопки — предыдущий трек, справа — следующий
  // (те же #prev / #next мини-плеера: нет предыдущего — кнопка выключена, и ничего не происходит)
  const stage = wb?.closest(".stage");
  if (!stage) return;
  stage.addEventListener("click", (e) => {
    if (main.dataset.page !== "wave" || wb.contains(e.target) || e.target.closest("button, a, input, label, .stwrap, .stations")) return;
    const r = wb.getBoundingClientRect(), pad = r.height * 0.6;
    if (e.clientY < r.top - pad || e.clientY > r.bottom + pad) return;     // только на уровне кнопки, не по всему экрану
    const b = document.getElementById(e.clientX < r.left ? "prev" : e.clientX > r.right ? "next" : "");
    if (b && !b.disabled) b.click();
  });
}

// ---------- плеер на весь экран: подписанные кнопки внизу ----------
// Очередь, Караоке (текст песни), Слушать вместе, Сон, «Ещё» — те же кнопки приложения, только крупно и с подписью;
// в мини-плеере их нет (там — лайк, пуск и следующий)
function fullActions() {
  const wrap = document.querySelector("#full .fwrap");
  if (!wrap || wrap.querySelector(".mfacts")) return;
  const box = el("div", "mfacts");
  const act = (icon, title, fn) => {
    const b = el("button", "mfact"); b.type = "button";
    b.append(el("span", "mpico " + icon), el("span", "", title));
    b.onclick = (e) => { e.stopPropagation(); fn(b); };
    box.append(b);
    return b;
  };
  act("i-queue", "Очередь", () => { closeFullSafe(); window.qToggle?.(); });
  const kar = act("i-lyrics", "Караоке", lyricsToggle);
  // текст на экране — кнопка подсвечена (режим меняют и сама кнопка, и щелчок по обложке, и main.js при смене трека)
  const full = document.getElementById("full");
  const mark = () => { const on = full?.dataset.mode === "lyrics"; kar.classList.toggle("on", on); kar.setAttribute("aria-pressed", on ? "true" : "false"); };
  if (full) { mark(); new MutationObserver(mark).observe(full, { attributes: true, attributeFilter: ["data-mode"] }); }
  act("i-together", "Вместе", () => { closeFullSafe(); document.getElementById("togetherBtn")?.click(); });
  act("i-sleep", "Сон", () => { closeFullSafe(); document.getElementById("sleepBtn")?.click(); });
  act("i-more", "Ещё", (b) => {
    const m = document.getElementById("pMore");
    if (!m || m.disabled) return;
    closeFullSafe(); m.click();
  });
  wrap.append(box);
}
const closeFullSafe = () => { try { if (typeof closeFull === "function") closeFull(); } catch {} };
// текст песни ⇄ обложка. Текста нет — так и говорим (щелчок по обложке тогда открыл бы картинку на весь экран)
function lyricsToggle() {
  const f = document.getElementById("full"), box = document.getElementById("fLyrics");
  if (!f) return;
  try {
    if (f.dataset.mode === "lyrics") { fullPeek(true); return; }
    if (box && box.childElementCount) { fullPeek(false); return; }
  } catch {}
  try { showToast("У этой песни нет текста", 2500); } catch {}
}

// ---------- жесты плеера ----------
// мини-плеер: влево — следующий, вправо — предыдущий; плеер на весь экран: вниз — свернуть. Кнопки остаются.
function playerSwipes() {
  const swipe = (node, fn) => {
    if (!node) return;
    let s = null;
    node.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      s = e.touches.length === 1 && !e.target.closest("input, button, .flyrics.synced, .flyrics.plain") ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
    }, { passive: true });
    node.addEventListener("touchend", (e) => {
      if (!s) return;
      const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.at;
      s = null;
      if (dt < 700) fn(dx, dy);
    }, { passive: true });
  };
  swipe(document.querySelector(".app > .player"), (dx, dy) => {
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
    document.getElementById(dx < 0 ? "next" : "prev")?.click();
  });
  swipe(document.getElementById("full"), (dx, dy) => {
    if (dy > 90 && dy > Math.abs(dx) * 2) closeFullSafe();
  });
}

export { seekBar, backToFull, fullModes, stallGuard, waveHere, fullActions, playerSwipes };

// prefetch.js — следующий трек загружается заранее, пока играет текущий (Rust: cache.rs cache_prefetch).
// Переключение на него играет с диска (ymlocal://, как кэш) — без запросов к Яндексу и без ожидания сети:
// по замерам ~250 мс против секунды и больше у трека из сети (с визуализатором трек из сети ещё и качался целиком).
// Что следующее — Whisper.queue.upcoming(1): лайки, альбомы, плейлисты (с перемешиванием — тоже), «Моя волна».
// Гость «Слушать вместе» — то, что ведущий включит следующим (together.js → next: ведущий шлёт его в состоянии комнаты).
// Не качаем: скачанные, уже в кэше, свои версии студии, треки из Whisper Archive (играют из архива), без сети, кэш выключен.
// Загруженные заранее и не дослушанные Rust держит не больше 4 — старые уходят сами.
// Выключатель — карточка «Кэш» (#pfOn, localStorage ym_prefetch; по умолчанию включено).
import { invoke } from "../app/base.js";
(() => {
  const W = window.Whisper;
  if (!W) return;
  const KEY = "ym_prefetch";
  let on = true;
  try { on = localStorage.getItem(KEY) !== "0"; } catch {}
  const failed = new Map();         // id → когда не вышло (повторяем не раньше чем через 10 минут)
  let busy = false, timer = 0;

  async function candidate() {
    const tg = W.modules.together, ri = tg?.info?.();
    if (ri && !ri.host) return ri.follow ? (await tg.next?.()) || null : null;
    return W.queue.upcoming(1)[0]?.track || null;
  }
  function skip(t) {
    const raw = t.raw || t, id = String(raw.id ?? "");
    if (!/^\d{1,20}$/.test(id) || raw.waShared) return true;                 // не трек Яндекса или играет из архива ведущего
    if (typeof got !== "undefined" && got.has(id)) return true;                // скачан
    if (window.appCache?.has(id) || window.studioReplacement?.(id)) return true;
    if (Date.now() - (failed.get(id) || 0) < 600000) return true;
    // есть в Whisper Archive — плеер возьмёт его оттуда (Whisper.sources), кэш не понадобится
    try { const a = W.modules.archive; if (a?.enabled?.() && a.lookup?.(W.to("track", raw))?.id) return true; } catch {}
    return false;
  }
  async function run() {
    timer = 0;
    if (!on || busy || !navigator.onLine || (typeof offline !== "undefined" && offline)) return;
    if (!window.appCache?.enabled?.()) return;
    // текущий трек ещё грузится (или играет потоком из сети и не догружен) — не отнимаем у него канал:
    // на слабом соединении вторая загрузка заставляла плеер замолкать посреди трека
    if (W.player.media().loading || window.appCache.streaming?.()) return soon(3000);
    let t = null;
    try { t = await candidate(); } catch {}
    if (!t || skip(t)) return;
    const raw = t.raw || t, id = String(raw.id);
    busy = true;
    const t0 = performance.now();
    try {
      const ok = await invoke("cache_prefetch", { id, low: window.ymQuality?.() === "low" });
      if (ok) await window.appCache.remember(id, raw);
      else failed.set(id, Date.now());          // Rust сказал «не нужен» (скачан, кэш выключили) — не спрашиваем по кругу
      window.perfMark?.("prefetch", `${id} ${ok ? "на диске" : "не нужен"} за ${Math.round(performance.now() - t0)} мс`);
    } catch (e) {
      failed.set(id, Date.now()); if (failed.size > 200) failed.delete(failed.keys().next().value);
      window.perfMark?.("prefetch", `${id} ошибка: ${e?.message || e}`);
    }
    busy = false;
    // пока качали, следующий мог смениться (переставили очередь, ведущий сменил трек) — проверим ещё раз
    soon(1500);
  }
  function soon(ms = 3000) { clearTimeout(timer); timer = setTimeout(run, ms); }

  // звук пошёл — через пару секунд берёмся за следующий (сам трек к этому времени уже буферизован)
  W.on("audible", () => soon(2500));
  // очередь поменялась (подгрузилась волна, «играть следующим», перестановка) — следующий мог стать другим
  W.on("queue", () => { if (W.player.state().track) soon(3000); });
  // гость: ведущий прислал новое состояние — узнаём о его следующем треке без смены своего
  W.on("room", () => soon(3000));

  const box = document.getElementById("pfOn");
  if (box) {
    box.checked = on;
    box.onchange = () => {
      on = box.checked;
      try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
      if (on) soon(500);
    };
  }
})();

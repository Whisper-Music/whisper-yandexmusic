// Офлайн-режим — только когда недоступно всё: и Яндекс Музыка, и Whisper Archive (если в нём есть вход).
// Сбой одного запроса сам по себе офлайн не включает: сначала тихая проверка обоих (suspectOffline).
// В офлайне: плашка в заголовке окна, плеер играет скачанное (play → offlineFallback), «Лайки» — только скачанные,
// страницы, которым нужна сеть, показывают «Офлайн-режим», обложки не грузятся. Раз в минуту связь проверяется
// молча; когда вернулась — открытая страница перерисовывается. В обычном режиме ни одна из этих надписей не видна.
// ES-модуль, подключён после app/config.js. offline, resumeOnNet, offlineShown — свойства window: их читают и пишут
// main.js и модули. Наружу — через window в конце.
import { invoke, isNetErr, ym } from "./base.js";
import { showToast } from "./menu.js";
import { paintDlAll } from "../library/downloads.js";
import { play } from "../player/core.js";
import { loadDislikedIds, loadLikedIds } from "../player/like.js";
const $ = (s) => document.querySelector(s);

window.offline = false;
let offlineTimer = 0;
window.resumeOnNet = false;        // трек не загрузился из-за сети и замены из скачанного не нашлось — включим его, когда связь вернётся
window.offlineShown = false;       // открытая страница нарисована в офлайн-виде — перерисовать, когда связь вернётся
const PROBE_MS = 60000;
function setOffline(on) {
  if (offline === on) return;
  offline = on;
  document.body.classList.toggle("offline", on);
  const n = document.getElementById("offlineNotice");
  if (n) n.hidden = !on;
  clearInterval(offlineTimer);
  if (on) {
    offlineTimer = setInterval(probeOnline, PROBE_MS);
    showToast("Нет связи с Яндекс Музыкой и архивом — офлайн-режим: доступны скачанные треки", 5000);
    // открытая страница из сети (лайки, альбом, артист, плейлист, поиск, статистика) — сразу в офлайн-вид
    const pg = document.querySelector(".main")?.dataset.page ?? "";
    if (!offlineShown && ["likes", "album", "artist", "search", "statsBtn", ""].includes(pg) && typeof view === "function") setTimeout(() => view(), 0);
  }
  if (typeof paintDlAll === "function") paintDlAll();
}
// Есть ли связь хоть с чем-то: Яндекс ответил (любым статусом, кроме 5xx) или архив ответил на /auth/me.
async function reachable() {
  if (!navigator.onLine) return false;
  if (!uid) return true;
  try { await ym("account_status"); return true; } catch (e) { if (!isNetErr(e)) return true; }
  try {
    if (await invoke("wa_token_exists")) {
      const r = await invoke("wa_me");
      if (r && r.status > 0 && r.status < 500) return true;
    }
  } catch {}
  return false;
}
// Запрос не прошёл из-за сети — проверяем, нет ли связи совсем. true — включён (или уже был) офлайн.
let suspectP = null;
function suspectOffline() {
  if (offline) return Promise.resolve(true);
  return (suspectP ||= reachable()
    .then((ok) => { if (!ok) setOffline(true); return !ok; })
    .finally(() => { suspectP = null; }));
}
let probing = false;
async function probeOnline() {
  if (!offline || probing) return;
  probing = true;
  let ok = false;
  try { ok = await reachable(); } finally { probing = false; }
  if (ok) backOnline();
}
function backOnline() {
  if (!offline) return;
  setOffline(false);
  showToast("Связь восстановлена", 3500, { kind: "ok" });
  loadLikedIds(); loadDislikedIds();
  // страница была нарисована в офлайн-виде (скачанные лайки, «Офлайн-режим») — открываем её заново, уже из сети
  if (offlineShown && typeof view === "function") { offlineShown = false; view(); }
  // плеер стоял на треке, который не смог загрузиться без сети, — включаем его
  if (resumeOnNet && needLoad && queue[current]) {
    resumeOnNet = false;
    const p = resumePos; resumePos = 0;
    $("#status").textContent = "";
    play(current, p);
  }
}
// система сообщила об обрыве — сразу в офлайн, не дожидаясь, пока сломается загрузка следующего трека
window.addEventListener("offline", () => setOffline(true));
// связь появилась — проверяем через пару секунд (сразу после подключения DNS и маршруты ещё не готовы)
window.addEventListener("online", () => setTimeout(probeOnline, 2000));
document.getElementById("offlineNotice")?.addEventListener("click", probeOnline);

export { PROBE_MS, setOffline, reachable, suspectOffline, probeOnline, backOnline };

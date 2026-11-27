// Скачанные треки: скачать / удалить трек, отметки «скачан» в списках, «Скачать альбом» / «Скачать лайки» (кнопка
// в ряду #chips), папка загрузок в настройках.
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет функции и вешает обработчики (свой $);
// got, queue, invoke, showToast… из main.js — по имени внутри функций. Наружу — через window в конце.
import { ICON, invoke, isNetErr } from "../app/base.js";
import { menuItem, menuNote, menuReset, modal, openMenu, placeMenu, showToast } from "../app/menu.js";
import { play, refreshPlayerBtns } from "../player/core.js";
const $ = (s) => document.querySelector(s);

const downloading = new Set();
function syncGotRow(li) {
  const on = got.has(String(li.dataset.id));
  li.classList.toggle("got", on);
  let m = li.querySelector(".gotmark");
  if (on && !m) {
    m = document.createElement("span");
    m.className = "gotmark"; m.title = "Скачан"; m.innerHTML = ICON.got;
    li.insertBefore(m, li.querySelector(".recadd, .likebtn"));
  } else if (!on && m) m.remove();
}
function syncGot() {
  document.querySelectorAll(".list li").forEach(syncGotRow);
  refreshPlayerBtns();
  if (typeof paintDlAll === "function") paintDlAll();
}
async function loadGot() {
  try { const ids = await invoke("downloaded_ids"); got.clear(); for (const i of ids) got.add(String(i)); syncGot(); } catch {}
  if (likes.done) backfillMeta(likes.tracks);
}
// Краткое описание трека — сохраняется вместе со скачанным файлом, чтобы показать его в списке без сети.
const trackMin = (x) => ({
  id: x.id, title: x.title, version: x.version || undefined, coverUri: x.coverUri, durationMs: x.durationMs,
  artists: (x.artists || []).map((a) => ({ id: a.id, name: a.name })),
  albums: (x.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title })),
  r128: r128Min(x),               // громкость для нормализации (sound.js) — работает и без сети
});
function r128Min(x) {
  const r = x?.r128;
  return r && Number.isFinite(r.i) ? { i: r.i, tp: Number.isFinite(r.tp) ? r.tp : 0 } : undefined;
}
// Трекам, скачанным до появления офлайн-режима, описание дописывается, когда их данные есть под рукой (раз за запуск).
const metaSent = new Set();
function backfillMeta(tracks) {
  const items = [];
  for (const t of tracks || []) {
    const id = String(t?.id ?? "");
    if (!id || !got.has(id) || metaSent.has(id) || !t.title) continue;
    metaSent.add(id); items.push({ id, meta: trackMin(t) });
  }
  if (items.length) invoke("downloaded_meta", { items }).catch(() => {});
}
window.addEventListener("focus", loadGot);

async function downloadTrack(t, force = false) {
  if (!t) return;
  const id = String(t.id);
  if (downloading.has(id)) return showToast("Этот трек уже скачивается…");
  if (got.has(id) && !force) {
    return showToast(`«${t.title}» уже скачан`, 6000, { kind: "ok", action: { label: "Скачать ещё раз", fn: () => downloadTrack(t, true) } });
  }
  refreshPlayerBtns();
  showToast(`«${t.title}» скачивается…`, 0);
  try {
    const path = await dlOne(t);
    syncGot();
    showToast(`Сохранено: ${path}`, 5000, { kind: "ok" });
  } catch (e) {
    const why = window.errExplain?.(e, { track: t });
    showToast(why ? `«${t.title}» не скачался — ${why.where}: ${why.text}` : "Не удалось скачать: " + e.message, 8000, { kind: "err" });
  } finally { refreshPlayerBtns(); }
}
// «Удалить с диска»: файл и запись в списке скачанных стирает Rust (download_delete) — только из папки загрузок.
// Трек сейчас играет с диска — Windows не даст стереть открытый файл, поэтому сначала переключаем его на поток
// Яндекса с того же места (без сети так нельзя — тогда просим включить другой трек).
async function deleteDownload(t) {
  if (!t) return;
  const id = String(t.id);
  if (!got.has(id)) return;
  if (downloading.has(id)) return showToast("Трек ещё скачивается — подожди немного");
  const ok = await modal({ title: "Удалить с диска?", text: `Файл «${t.title}» удалится из папки загрузок. Трек останется в Яндекс Музыке — его можно будет скачать снова.`, ok: "Удалить", danger: true });
  if (!ok) return;
  const playingHere = curLocal && String(queue[current]?.id) === id;
  if (playingHere && (offline || !navigator.onLine)) return showToast("Трек сейчас играет с диска, а сети нет — включи другой трек и удали этот", 6000);
  got.delete(id); syncGot();
  if (playingHere) {
    const pos = audio ? audio.currentTime : 0, paused = !audio || audio.paused;
    await play(current, pos, false, paused);
    await new Promise((r) => setTimeout(r, 400));       // движок отпускает файл
  }
  try {
    try { await invoke("download_delete", { id }); }
    catch { await new Promise((r) => setTimeout(r, 1200)); await invoke("download_delete", { id }); }
    metaSent.delete(id);
    showToast(`«${t.title}» удалён с диска`, 3500, { kind: "ok" });
  } catch (e) {
    got.add(id); syncGot();
    showToast(`«${t.title}» не удалился: ${e?.message || e}`, 7000, { kind: "err" });
  }
}
// Один трек на диск. Файл называется «Исполнители — Название»; ссылку на файл Rust берёт сам по id.
async function dlOne(t) {
  const id = String(t.id);
  const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const name = artists ? `${artists} — ${t.title}` : String(t.title || id);
  downloading.add(id);
  try {
    const path = await invoke("download_track", { name, id, meta: trackMin(t) });
    got.add(id); metaSent.add(id);
    return path;
  } finally { downloading.delete(id); }
}

// ---------- «Скачать альбом» / «Скачать лайки» ----------
// Кнопка в шапке страницы. Качает по два трека сразу, уже скачанные пропускает; повторное нажатие — остановить.
// Пока идёт скачивание, можно уходить на другие страницы — прогресс виден на кнопке, когда вернёшься.
// var: syncGot/resetView могут сработать раньше этих строк
// dlCur ({ key, label, tracks(), all() } — для открытой страницы) и bulk ({ key, done, total, fail, stop }) — переменные
// main.js (var): их сбрасывает main.js при переходах, читает mobile.js
const dlOk = (t) => t?.id != null && t.available !== false;
function dlSetup(cfg) { dlCur = cfg; paintDlAll(); }
function paintDlAll() {
  const b = $("#dlAllBtn");
  if (!b) return;
  if (!dlCur || offline) { b.hidden = true; return; }
  // Лайки — в ряд с вкладками «Лайки / Мои плейлисты», справа; остальное (альбомы) — в шапке рядом с «Закрепить»
  const chips = $("#chips");
  if (dlCur.key === "likes" && !chips.hidden) { if (b.parentNode !== chips) chips.append(b); }
  else if (b.nextElementSibling !== $("#pinBtn")) $("#pinBtn").before(b);
  b.hidden = false;
  const running = !!bulk && bulk.key === dlCur.key;
  b.classList.toggle("busy", running);
  if (running) {
    b.textContent = `Скачано ${bulk.done} из ${bulk.total} · ✕`;
    b.title = "Остановить скачивание";
    return;
  }
  const list = dlCur.tracks?.();
  const all = !!list?.length && list.every((t) => !dlOk(t) || got.has(String(t.id)));
  b.classList.toggle("done", all);
  b.textContent = all ? "✓ Скачано" : dlCur.label;
  b.title = all ? "Все треки уже на диске" : "Скачать все треки, которых ещё нет на диске";
}
$("#dlAllBtn").onclick = async () => {
  const cur = dlCur;
  if (!cur) return;
  if (bulk) {
    if (bulk.key === cur.key) { bulk.stop = true; $("#dlAllBtn").textContent = "Останавливается…"; }
    else showToast("Уже идёт скачивание — дождись его или останови", 3500);
    return;
  }
  const btn = $("#dlAllBtn");
  let list;
  try { list = cur.tracks?.() || (await cur.all()); }
  catch (e) { showToast("Не удалось получить список треков: " + e.message, 5000); return; }
  list = (list || []).filter(dlOk);
  const need = (arr) => arr.filter((t) => !got.has(String(t.id)) && !downloading.has(String(t.id)));
  if (!need(list).length) { showToast("Всё уже скачано", 3000, { kind: "ok" }); paintDlAll(); return; }
  if (list.length <= 10) return dlBulk(cur, need(list));
  // Сколько скачать: первые 10 / 50 / 100 / 200 сверху списка (в лайках — самые новые) или все.
  // Уже скачанные среди них пропускаются — справа видно, сколько реально осталось.
  openMenu(btn, () => {
    menuReset();
    menuNote("Сколько скачать — с начала списка");
    const opt = (label, part) => {
      const k = need(part).length;
      const it = menuItem(k ? ICON.download : ICON.got, label, () => { if (k) dlBulk(cur, need(part)); });
      const s = document.createElement("small"); s.className = "mosub";
      s.textContent = k ? (k < part.length ? `ещё ${k}` : "") : "скачано";
      it.querySelector(".mt")?.after(s);
      if (!k) it.disabled = true;
    };
    for (const n of [10, 50, 100, 200]) if (n < list.length) opt(`Первые ${n}`, list.slice(0, n));
    opt(`Все (${list.length})`, list);
    placeMenu();
  });
};
async function dlBulk(cur, todo) {
  if (bulk || !todo.length) return;
  const job = bulk = { key: cur.key, done: 0, total: todo.length, fail: 0, stop: false, net: false };
  paintDlAll();
  const q = todo.slice();
  const worker = async () => {
    while (q.length && !job.stop) {
      const t = q.shift();
      try { await dlOne(t); }
      catch (e) { job.fail++; if (isNetErr(e)) { job.stop = true; job.net = true; } }
      job.done++;
      syncGot();
    }
  };
  await Promise.all([worker(), worker()]);
  bulk = null;
  paintDlAll(); syncGot();
  const ok = job.done - job.fail;
  if (job.net) showToast(`Связь пропала — скачано ${ok} из ${job.total}. Нажми ещё раз, когда связь вернётся`, 6000);
  else if (job.stop) showToast(`Скачивание остановлено: ${ok} из ${job.total}`, 4000);
  else if (job.fail) showToast(`Скачано ${ok} из ${job.total}, не удалось: ${job.fail}`, 6000);
  else showToast(`Скачано треков: ${ok}`, 4000, { kind: "ok" });
};

// ---------- папка загрузок (Воспроизведение → «Скачивание треков») ----------
function showDlDir(info) {
  if (!info) return;
  $("#dlPath").textContent = info.path; $("#dlPath").title = info.path;
  $("#dlReset").disabled = !info.custom;
}
async function loadDlDir() {
  try { showDlDir(await invoke("download_dir_get")); $("#dlNote").textContent = ""; }
  catch (e) { $("#dlPath").textContent = "—"; $("#dlNote").textContent = "Не удалось узнать папку: " + e.message; }
}
$("#dlPick").onclick = async () => {
  try { const r = await invoke("download_dir_pick"); if (r) showDlDir(r); $("#dlNote").textContent = ""; }
  catch (e) { $("#dlNote").textContent = "Не удалось выбрать папку: " + e.message; }
};
$("#dlReset").onclick = async () => {
  try { showDlDir(await invoke("download_dir_reset")); $("#dlNote").textContent = ""; }
  catch (e) { $("#dlNote").textContent = "Не удалось сбросить папку: " + e.message; }
};
$("#dlOpen").onclick = async () => {
  try { await invoke("download_dir_open"); }
  catch (e) { $("#dlNote").textContent = "Не удалось открыть папку: " + e.message; }
};

export { downloading, dlOk, dlOne, dlSetup, paintDlAll, downloadTrack, deleteDownload, loadGot, syncGot, syncGotRow, trackMin, r128Min,
  backfillMeta, loadDlDir };

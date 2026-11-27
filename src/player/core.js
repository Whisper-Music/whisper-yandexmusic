// Ядро плеера: включить трек (play — откуда брать звук: скачанный, кэш, архив, Яндекс; повторы и офлайн-запасной путь),
// показать трек в нижней панели (showTrack, смена обложки), сохранить место, сторож зависаний, звуковой граф
// (makeAudio, анализатор для визуализатора), громкость с нормализацией (outVol), визуализатор на весь экран,
// кнопки «Играть / дальше / назад».
// ES-модуль, подключён ПЕРЕД app/main.js. При загрузке только объявляет своё и вешает обработчики (свой $); audio, queue,
// current, needLoad… — переменные main.js, их модуль пишет по имени внутри функций. curLocal, curFromWa, loadAt,
// loadPos, vizFullOn — свойства window: их читают другие скрипты (yandex.js, sound.js, mobile.js, keynav.js).
// Наружу — через window в конце.
import { COVER_W, fill, fmtTime, ICON, invoke, isNetErr, setText, wReport } from "../app/base.js";
import { albumOf, cover, fillArtists } from "../app/list.js";
import { navigate, setTransit, syncIcons } from "../app/nav.js";
import { backOnline, setOffline, suspectOffline } from "../app/offline.js";
import { applySpeed } from "../app/trackmenu.js";
import { syncMax } from "../app/window.js";
import { backfillMeta, r128Min, syncGot } from "../library/downloads.js";
import { dynUpdate } from "../look/dynbg.js";
import { showAlbum } from "../pages/artist.js";
import { offlineLikes } from "../pages/likes.js";
import { fitHead, markHeard, onQueueEnd, showNow, updateStBtn, waveFeedback, waveHead, waveMore, waveStart } from "../pages/wave.js";
import { fillFull, fullResume } from "./full.js";
import { isLiked, isStudio, refreshHearts } from "./like.js";
import { buildOrder, effRepeat, nextIndex, prevIndex, updateModes } from "./modes.js";
import { orbReset, vizFrame, waveOrbitsSync } from "./viz.js";
const $ = (s) => document.querySelector(s);

function refreshPlayerBtns() {
  const b = $("#disBtn"), t = queue[current];
  b.disabled = !t;
  $("#pMore").disabled = !t;
  const on = !!t && dislikedIds.has(String(t.id));
  if (!b.firstChild) b.innerHTML = ICON.dislike;
  b.classList.toggle("on", on);
  b.title = on ? "Убрать из «Не нравится»" : "Не нравится";
}

// Прямая ссылка на MP3: download-info, адрес файла и подпись (MD5 по протоколу Яндекса) получает Rust (net.rs).
// Качество — из настроек «Звук» (sound.js): лучшее (MP3 320) или экономное.
async function directLink(id) {
  return await invoke("ym_track_url", { id: String(id), quality: window.ymQuality?.() || "high" });
}
// подсветка играющей строки: трогаем только прошлую и новую, а не все строки списка (в «Лайках» их тысячи)
function markPlaying() {
  const id = String(playingId);
  document.querySelectorAll(".list li.playing").forEach((li) => { if (li.dataset.id !== id) li.classList.remove("playing"); });
  document.querySelectorAll(`.list li[data-id="${CSS.escape(id)}"]`).forEach((li) => li.classList.add("playing"));
}

// Смена обложки в плеере. Если стиль задаёт анимации .cover.flip-out / .flip-in (Королевский — «монета»),
// старая обложка уходит на ребро, подменяется (новая к этому моменту уже загружена) и выходит с ребра.
// Анимаций нет (другой стиль, выключены «Анимации интерфейса») — картинка меняется сразу.
let coverSeq = 0;
const newAnims = (el, before) => el.getAnimations?.().filter((a) => !before.includes(a)) || [];
// getAnimations() заставляет браузер сразу пересчитать стили (а showTrack только что поменял строки списка, название,
// сердечки) — в «Лайках» это 55–90 мс прямо внутри play(), до запуска звука. Поэтому обложка меняется в начале
// следующего кадра: пересчёт стилей там нужен в любом случае, и play() его больше не ждёт.
let coverWant = "", coverRaf = 0;
function swapCover(src) {
  if (document.hidden) {
    if (coverRaf) { cancelAnimationFrame(coverRaf); coverRaf = 0; }
    ++coverSeq; const el = $("#cover"); el.classList.remove("flip-out", "flip-in"); el.src = src || COVER_W; return;
  }
  coverWant = src;            // несколько смен за кадр (быстро листают) — берётся последняя
  if (!coverRaf) coverRaf = requestAnimationFrame(() => { coverRaf = 0; swapCoverNow(coverWant); });
}
async function swapCoverNow(src) {
  src = src || COVER_W;           // нет обложки (или офлайн) — сразу заглушка, без запроса
  const el = $("#cover"), my = ++coverSeq;
  el.classList.remove("flip-out", "flip-in");
  if (!el.getAttribute("src") || el.getAttribute("src") === src || document.hidden || !el.getAnimations) { el.src = src; return; }
  const before = el.getAnimations();
  el.classList.add("flip-out");
  const out = newAnims(el, before);
  if (!out.length) { el.classList.remove("flip-out"); el.src = src; return; }
  const pre = new Image(); pre.src = src;
  await Promise.all([
    Promise.all(out.map((a) => a.finished)).catch(() => {}),
    Promise.race([pre.decode().catch(() => {}), new Promise((r) => setTimeout(r, 600))]),
  ]);
  if (my !== coverSeq) return;
  el.src = src;
  el.classList.remove("flip-out");
  const b2 = el.getAnimations();
  el.classList.add("flip-in");
  const inn = newAnims(el, b2);
  await Promise.all(inn.map((a) => a.finished)).catch(() => {});
  if (my === coverSeq) el.classList.remove("flip-in");
}
// клик по «Моей волне» — анимация «оттиска», если стиль её задаёт (Королевский: .wavebtn.stamp)
$("#waveBtn").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const b = e.currentTarget;
  b.classList.remove("stamp"); void b.offsetWidth; b.classList.add("stamp");
});
$("#waveBtn").addEventListener("animationend", (e) => { if (e.target === e.currentTarget && e.animationName.endsWith("royalStamp")) e.currentTarget.classList.remove("stamp"); });

function showTrack(t, pos = 0) {
  // замеры (perf.js): сколько занимает каждый шаг — пишется, только когда замеры включены
  const pm = window.perfMark, ps = [];
  let pt0 = pm ? performance.now() : 0;
  const step = pm ? (n) => { const x = performance.now(); ps.push(`${n} ${Math.round(x - pt0)}`); pt0 = x; } : () => {};
  playingId = t.id; markPlaying(); step("строки");
  const pt = $("#pTitle");
  pt.textContent = t.title;
  pt.classList.toggle("link", !!albumOf(t));
  fillArtists($("#pArtist"), t); step("название");
  swapCover(cover(t)); step("обложка");
  dynUpdate(t); step("фон");
  const dur = (t.durationMs || 0) / 1000;
  $("#tCur").textContent = fmtTime(pos); $("#tDur").textContent = fmtTime(dur);
  $("#seek").value = dur ? (pos / dur) * 1000 : 0; fill($("#seek"));
  if (wave.on || window.roomInfo?.()) showNow(t);
  else if (!$("#wavePage").hidden) waveHead();         // волна выключилась — не оставлять наверху старое название
  step("время");
  refreshHearts(); step("сердечки");
  updateModes(); step("режимы");
  if (!$("#full").hidden) fillFull(t);
  // в конце: к этому моменту обложка, цвета и режимы уже новые — модули (Discord, мини-плеер, OBS) берут их отсюда
  wReport({ track: t, position: pos, liked: isLiked(String(t.id)), disliked: dislikedIds.has(String(t.id)), queue: true });
  step("модули");
  if (pm) pm("showTrack", ps.join(" · "));
}

function saveLast(pos = 0) {
  if (needLoad || !queue[current]) return;
  const min = (x) => ({
    id: x.id, title: x.title, coverUri: x.coverUri, durationMs: x.durationMs,
    artists: (x.artists || []).map((a) => ({ id: a.id, name: a.name })),
    albums: (x.albums || []).slice(0, 1).map((a) => ({ id: a.id })),
    r128: r128Min(x),
  });
  try { localStorage.setItem("ym_last", JSON.stringify({ q: queue.slice(current, current + 50).map(min), pos: Math.floor(pos), ctx: playCtx, album: playAlbum, wave: wave.on ? { seed: wave.seed, name: wave.name, album: wave.album } : null })); } catch {}
}
window.addEventListener("pagehide", () => saveLast(audio ? audio.currentTime : 0));

function togglePlay() {
  if (needLoad) { const p = resumePos; resumePos = 0; play(current, p); return; }
  audio.paused ? audio.play() : audio.pause();
}

async function restorePlayer() {
  try {
    const saved = JSON.parse(localStorage.getItem("ym_last") || "null");
    if (saved?.q?.length && current === -1) {
      queue = saved.q; current = 0; wave.on = false; playCtx = saved.ctx || "other"; playAlbum = saved.album || null;
      const sw = saved.wave;
      if (saved.ctx === "wave" && sw && typeof sw.seed === "string" && /^[\w-]+:[\w.-]+$/.test(sw.seed)) {
        const al = sw.album && /^\d+$/.test(String(sw.album.id)) ? { id: sw.album.id, title: String(sw.album.title || "").slice(0, 200) } : null;
        Object.assign(wave, { on: true, seed: sw.seed, name: typeof sw.name === "string" ? sw.name.slice(0, 100) : "", album: al, session: null, batch: null, queue, pos: 0 });
        playCtx = "wave"; playAlbum = null;
      }
      resumePos = saved.pos || 0; needLoad = true;
      showTrack(queue[0], resumePos);
      // перезапуск ради параллакса (themefx.js → gpuRestart): трек играл — играет дальше с того же места
      let resume = false;
      try { resume = localStorage.getItem("ym_gpu_resume") === "1"; localStorage.removeItem("ym_gpu_resume"); } catch {}
      if (resume) setTimeout(() => { if (needLoad && current === 0) togglePlay(); }, 0);
      window.perfMark?.("player:restored");
      // страница волны уже нарисована (startPage идёт раньше) — с прежней подписью: волна по жанру, альбому или
      // «для сна» (она в ym_wave_seed не пишется) после перезапуска играла, а кнопка говорила «Жанры и настроения»
      updateStBtn();
      if (!$("#wavePage").hidden) { waveHead(); fitHead(); }
      return;
    }
  } catch {}
  if (current === -1) { try { await waveStart(false); } catch {} }
  if (!queue.length) $("#pTitle").textContent = "Ничего не играет";
}

let playFail = 0;       // подряд неудачных загрузок трека
// hold — загрузить трек, но не включать (гость «Слушать вместе», пока ведущий сам ещё грузит этот трек)
async function play(i, resumeAt = 0, isRetry = false, hold = false) {
  if (i < 0) return;
  setTransit(true);
  loadAt = Date.now(); loadPos = resumeAt;
  if (i >= queue.length && wave.on && !isRetry) {
    const seq0 = playSeq;
    if (!(await waveMore())) {
      if (seq0 !== playSeq) return;
      // волна не подгрузилась из-за сети — переходим на скачанное
      if (offline || !navigator.onLine) { setOffline(true); if (await offlineFallback(queue.length - 1, playSeq)) return; }
      if (seq0 === playSeq) { loadAt = 0; setTransit(false); }
      return;
    }
  }
  if (i >= queue.length) { loadAt = 0; setTransit(false); return; }
  current = i; needLoad = false;
  const t = queue[i];
  window.perfMark?.("play:start", `${t.id}${isRetry ? " повтор" : ""}`);
  const pf0 = window.perfMark ? performance.now() : 0;
  showTrack(t, resumeAt);
  if (pf0) window.perfMark?.("play:showTrack", `${Math.round(performance.now() - pf0)} мс`);
  if (shuffle) {
    if (orderFor !== queue || order.length !== queue.length) buildOrder();
    else { const k = order.indexOf(i); if (k >= 0) ordPos = k; }
  }
  saveLast(resumeAt);
  if (!isRetry) wReport({ started: t });  // трек включили — история прослушивания (core/queue.js) слушает событие «start»
  if (wave.on) {
    wave.pos = i; markHeard(t);
    if (!isRetry) waveFeedback("trackStarted", t);
    if (queue.length - i <= 3) waveMore();
  }
  const my = ++playSeq;
  // эксклюзивный режим (engine.js / engine.rs) или телевизор (cast.js / dlna.rs): плеер — не <audio>, без звукового графа
  const tv = !!window.cast?.on();
  const nat = tv || !!window.engine?.on();
  const wantViz = nat ? false : vizWanted();
  // DJ-переход (transitions.js): прошлый трек не обрывается — доигрывает и затихает на своём плеере, а этот
  // загружается в новый (входит тихо, громкость поднимает transitions.js). В эксклюзивном режиме оба трека
  // смешивает engine.rs (engine_dj), а прошлый плеер просто отпускается
  if (audio && !!audio._native === nat && window.xfTail?.(audio)) audio = null;
  if (!audio || audioViz !== wantViz || !!audio._native !== nat || !!audio._cast !== tv) {
    const old = audio;
    if (old) { old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load(); }
    audio = makeAudio(wantViz, nat); audioViz = wantViz;
    if (!wantViz) {
      // визуализатор больше не нужен: звуковой граф засыпает (не крутит аудиопоток вхолостую),
      // а целиком скачанный прошлый трек освобождается из памяти
      if (actx && actx.state === "running") actx.suspend().catch(() => {});
      if (curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }
    }
  }
  // Прошлый трек замолкает сразу, а не когда загрузится новый: иначе при сбое загрузки он продолжал играть
  // (или снова включался кнопкой «Играть»), хотя в плеере уже название и обложка нового.
  if (!audio.paused) audio.pause();
  resumeOnNet = false;
  curLocal = false; curFromWa = false; curCache = false;      // флаги прошлого трека не должны влиять на разбор ошибки этого
  try {
    // Скачанный трек играет с диска (ymlocal://, Rust отдаёт файл кусками) — без единого запроса в сеть.
    // Иначе источники ядра (Whisper.sources — Whisper Archive, core/archive.js): трек есть в архиве — играет поток оттуда
    // (wa://, кусками), иначе версия Яндекса.
    // Кэш приложения (cache.js / cache.rs): тот же ymlocal://, Rust сам ищет трек сначала среди скачанных, потом в кэше.
    // Скачанный главнее архива; кэш — после архива (версия из архива, если она есть, выбрана пользователем),
    // а без интернета — сразу.
    // своя замена трека (перетащили свой файл и связали с этим треком — dropin.js / studio.js): на этом компьютере
    // вместо трека Яндекса играет она, главнее скачанного, архива и кэша. У гостя «Слушать вместе» — нет (_room)
    const rep = !t._room && !isStudio(t.id) ? window.studioReplacement?.(String(t.id)) || "" : "";
    const localId = rep || String(t.id);
    const LOCAL_URL = LOCAL_BASE + "track/" + encodeURIComponent(localId);
    const inCache = !rep && !got.has(String(t.id)) && !!window.appCache?.has(String(t.id));
    // своя версия из «Студии» (studio.js, studio-…) — файл на диске, как скачанный. Чужая (гость «Слушать вместе»:
    // её нет в своём списке студии, studioHas) — у нас её нет: играет то, чем поделился ведущий (источники ядра, архив)
    const studio = !!rep || (isStudio(t.id) && !t._room && window.studioHas?.(String(t.id)) !== false);
    // без сети (или уже известно, что Яндекс и архив недоступны — офлайн-режим) кэш играет сразу, без попыток сети
    let local = studio || got.has(String(t.id)) || (inCache && (!navigator.onLine || offline)) ? LOCAL_URL : "";
    // интернета нет совсем — не ждём таймаутов сетевых запросов, сразу к скачанному
    if (!local && !navigator.onLine) throw new Error("network: нет подключения к интернету");
    if (local && !inCache && !studio) backfillMeta([t]);
    const wa = local ? null : (await window.Whisper?.sources.resolve(t, queue[i + 1])) || null;
    if (my !== playSeq) return;
    if (!local && !wa && inCache) local = LOCAL_URL;
    curCache = !!local && inCache;
    wReport({ source: curCache ? "cache" : local ? "local" : wa ? wa.source : "provider" });     // печать «WA» на обложке и т.п.
    curFromWa = !!wa; curLocal = !!local;
    window.perfMark?.("play:src", `${curCache ? "cache" : local ? "local" : wa ? wa.source : "provider"}${audio._native ? " движок" : ""}${wantViz ? " визуализатор" : ""}`);
    let src = null;
    if (audio._native) {
      // свой движок сам берёт файл по номеру: скачанный, из архива или у Яндекса (в выбранном качестве)
      audio.setTrack(
        local ? { kind: "local", id: localId }
          : wa ? { kind: "wa", id: String(wa.id) }
          : { kind: "ym", id: String(t.id), quality: window.ymQuality?.() || "high" },
        resumeAt, (t.durationMs || 0) / 1000);
    } else if (local || wa) {
      if (curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }
      audio.crossOrigin = "anonymous";       // свои протоколы отдают CORS — визуализатор может анализировать поток
      src = local || wa.url;
      if (wantViz) await ctxReady();
    } else {
      audio.removeAttribute("crossorigin");   // файлы Яндекса отдаются без CORS
      src = await directLink(t.id);
      if (my !== playSeq) return;
      // телефон: не ждать весь файл — куски в MediaSource, звук после первого (mobile/stream.js)
      const part = wantViz && window.mobileStream ? (await ctxReady(), window.mobileStream(audio, src, (t.durationMs || 0) / 1000)) : null;
      if (part) src = part;
      else if (wantViz) {
        const buf = await invoke("fetch_bytes", { url: src });
        if (my !== playSeq) return;
        if (curBlob) URL.revokeObjectURL(curBlob);
        src = curBlob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
        await ctxReady();
      }
    }
    if (src !== null) audio.src = src;
    if (!wa && !wantViz && curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }   // файл прошлого трека больше не нужен
    const seekResume = () => { if (resumeAt) audio.addEventListener("loadedmetadata", () => { audio.currentTime = resumeAt; }, { once: true }); };
    seekResume();
    // звук не должен «мелькнуть» на системном устройстве, пока переключается выбранное (output.js)
    if (audio._sinkP) { await audio._sinkP; if (my !== playSeq) return; }
    window.normApply?.();           // усиление нормализации для этого трека (sound.js)
    // загрузить без звука: файл уже буферизуется, play() потом стартует почти мгновенно
    // (если за время загрузки ведущий уже включил трек — не держим, играем сразу)
    if (hold && !window.roomWantsPlay?.()) {
      if (my !== playSeq) return;
      if (!audio._native) audio.preload = "auto";
      playFail = 0; loadAt = 0; setTransit(false);
      return;
    }
    window.perfMark?.("play:call");
    try { await audio.play(); playFail = 0; }
    catch (err) {
      if (my !== playSeq) return;
      // скачанный файл не открылся (удалён или не читается) — забываем его и играем трек обычным путём
      if (local && err?.name === "NotSupportedError") {
        curLocal = false;
        if (curCache) { curCache = false; window.appCache?.forget(String(t.id)); }       // файл кэша повреждён
        else { got.delete(String(t.id)); syncGot(); }
        return play(i, resumeAt);
      }
      // свой движок: файл из архива не скачался (нет доступа, архив недоступен) — сразу версия Яндекса
      if (wa && audio._native && err?.name === "Error") {
        curFromWa = false; wReport({ source: "provider" });
        audio.setTrack({ kind: "ym", id: String(t.id), quality: window.ymQuality?.() || "high" }, resumeAt, (t.durationMs || 0) / 1000);
        await audio.play();
        if (my !== playSeq) return;
        playFail = 0; loadAt = 0; setTransit(false);
        return;
      }
      if (!wa || err?.name !== "NotSupportedError") throw err;
      // поток из архива не заиграл — берём файл целиком, а если и это не вышло, играет версия Яндекса
      let b = null;
      try { b = await wa.blob?.(); } catch {}
      if (my !== playSeq) return;
      audio.removeAttribute("crossorigin");
      if (b) audio.src = curBlob = URL.createObjectURL(b);
      else {
        curFromWa = false; wReport({ source: "provider" });
        let url = await directLink(t.id);
        if (my !== playSeq) return;
        // с визуализатором звук идёт через звуковой граф: файл Яндекса (без CORS) там молчит — берём его целиком, как в обычном пути
        if (wantViz) {
          const buf = await invoke("fetch_bytes", { url });
          if (my !== playSeq) return;
          url = curBlob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
        }
        audio.src = url;
      }
      seekResume();
      await audio.play();
    }
    if (my !== playSeq) return;
    playFail = 0; loadAt = 0; setTransit(false);
    if (/повторная попытка|перезапускается|Нет связи|Нет интернета/.test($("#status").textContent)) { $("#status").textContent = ""; $("#status").title = ""; }
    if (offline && !curLocal && !curFromWa) backOnline();      // трек загрузился из сети — значит, связь есть
    window.soundRefresh?.();        // «Сведения о формате», если вкладка «Звук» открыта
  } catch (e) {
    if (my !== playSeq) return;
    // эксклюзивный режим не удался (устройство занято, формат не тот) — engine.js уже вернулся в общий режим,
    // играем этот же трек обычным путём
    if (e?.name === "EngineFallback") return play(i, resumeAt, true);
    const net = !curLocal && !curFromWa && isNetErr(e);
    // где проблема (errinfo.js): Яндекс, сеть, устройство, декодер, файл, архив — показываем вместо сырого текста
    const why = window.errExplain?.(e, { local: curLocal, wa: curFromWa, native: !!audio?._native, media: audio?.error, track: t });
    $("#status").title = why ? why.raw : "";
    // Сбой загрузки (ссылка протухла, сеть мигнула): два повтора с новой ссылкой, потом в волне — следующий трек.
    // Уже известно, что сети нет, — не повторяем, сразу ищем замену среди скачанного.
    if (!curLocal && !(net && (offline || !navigator.onLine)) && ++playFail <= 2) {
      $("#status").textContent = `Не удалось загрузить трек${why ? ` (${why.short})` : ""} — повторная попытка…`;
      setTimeout(() => { if (my === playSeq) play(i, resumeAt, true); }, playFail * 2000);
      return;
    }
    playFail = 0;
    if (!curLocal && wave.on && !net && i + 1 < queue.length) {
      $("#status").textContent = `«${t.title}» не загрузился${why ? ` (${why.where}: ${why.text})` : ""} — пропущен`;
      play(i + 1);
      return;
    }
    if (net) {
      await suspectOffline();          // офлайн включится, только если недоступен и архив
      if (my !== playSeq) return;
      if (await offlineFallback(i, my)) return;
      if (my !== playSeq) return;
    }
    // Ничего не играет: плеер очищается, а «Играть» заново загружает именно этот трек (а не включает прошлый).
    stopForRetry(resumeAt);
    if (net) {
      resumeOnNet = true;
      $("#status").textContent = `Нет связи с Яндекс Музыкой — «${t.title}» не скачан, а скачанных треков нет. Он включится, когда связь вернётся.`;
    } else $("#status").textContent = why ? `«${t.title}» не играет — ${why.where}: ${why.text}` : "Не удалось воспроизвести: " + e.message;
  }
}
function stopForRetry(pos = 0) {
  loadAt = 0;
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  if (curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }
  needLoad = true; resumePos = pos;
  setTransit(false);
}
// Без сети: вместо трека, которого нет на диске, — ближайший следующий скачанный из текущей очереди;
// таких нет — очередь из всех скачанных (лайкнутые первыми, как «Лайки» без сети). Волна при этом ставится на паузу:
// её очередь сохраняется, и кнопка «Моя волна» продолжит её, когда связь вернётся.
window.offQueue = null;        // список скачанного, когда сеть пропала (его проверяет и pages/wave.js)
async function offlineFallback(i, my) {
  for (let k = i + 1; k < queue.length; k++) {
    const id = String(queue[k].id);
    if (got.has(id) || window.appCache?.has(id)) {           // скачанный или из кэша приложения (cache.js)
      $("#status").textContent = offline ? "" : "Трек не загрузился — играет следующий скачанный";
      play(k);
      return true;
    }
  }
  if (queue === offQueue) return false;           // уже играем скачанное и оно кончилось — не крутимся по кругу
  const tracks = await offlineLikes();
  if (my !== playSeq || !tracks.length) return false;
  if (wave.on) { wave.on = false; updateStBtn(); }
  playCtx = "likes"; playAlbum = null;
  queue = offQueue = tracks;
  $("#status").textContent = offline ? "" : `Трек не загрузился — играют скачанные треки (${tracks.length})`;
  play(0);
  return true;
}
// Адрес скачанных треков по правилам Tauri: http://ymlocal.localhost/… в Windows, ymlocal://localhost/… в Linux и macOS.
const LOCAL_BASE = (() => {
  try { return window.__TAURI__.core.convertFileSrc("", "ymlocal").replace(/\/?$/, "/"); } catch { return "ymlocal://localhost/"; }
})();
window.curLocal = false;           // текущий трек играет из скачанного файла (ymlocal://)

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// Звуковой граф визуализатора. actx.resume() может не завершиться никогда (сменилось или пропало устройство вывода,
// система поспала) — раньше play() ждал его вечно. Ждём 4 с; не проснулся — пересоздаём граф с новым плеером.
async function ctxReady() {
  if (!actx || actx.state === "running") return true;
  await Promise.race([actx.resume().catch(() => {}), sleepMs(4000)]);
  if (actx.state === "running") return true;
  // вызывается из play() до того, как плееру дали адрес трека, — старый плеер просто выбрасываем
  const old = audio;
  try { actx.close(); } catch {}
  actx = null; analyser = null;
  if (old) { old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load(); }
  audio = makeAudio(true); audioViz = true;
  await Promise.race([actx.resume().catch(() => {}), sleepMs(4000)]);
  return actx.state === "running";
}

// Сторож воспроизведения — последняя линия обороны, что бы ни было причиной:
// * трек не начал играть за 30 с (запрос завис, audio.play() не вернулся) — пробуем заново со свежей ссылкой;
// * трек играл и встал (позиция не двигается 20 с, хотя не на паузе) — перезапускаем с того же места.
// Две неудачи подряд — в волне идём к следующему треку.
window.loadAt = 0; window.loadPos = 0;
let wdPos = -1, wdAt = 0;
function recoverPlayback(stalled) {
  const i = current, t = queue[i];
  if (!t) return;
  const pos = stalled ? audio.currentTime || 0 : loadPos;
  if (++playFail <= 2) {
    $("#status").textContent = stalled ? "Трек перестал грузиться — перезапускается…" : "Трек не загружается — повторная попытка…";
    play(i, pos, true);
    return;
  }
  playFail = 0;
  if (wave.on || i + 1 < queue.length) {
    $("#status").textContent = `«${t.title}» не загрузился — пропущен`;
    const n = nextIndex(false);
    if (n >= 0) { play(n); return; }
  }
  stopForRetry(pos);        // «Играть» загрузит этот трек заново, а не включит прошлый
  $("#status").textContent = `«${t.title}» не загрузился — нажми «Играть», чтобы повторить.`;
}
setInterval(() => {
  if (!audio || needLoad || current < 0 || !queue[current]) return;
  const now = Date.now();
  if (transit) {
    if (loadAt && now - loadAt > 30000) { loadAt = 0; recoverPlayback(false); }
    return;
  }
  if (audio.paused || audio.ended || audio.seeking) { wdAt = 0; wdPos = -1; return; }
  const p = audio.currentTime;
  if (p !== wdPos || !wdAt) { wdPos = p; wdAt = now; return; }
  if (now - wdAt > 20000) { wdAt = 0; wdPos = -1; recoverPlayback(true); }
}, 5000);

// Громкость плеера: громкость пользователя × приглушение нормализации (sound.js). Когда трек идёт через звуковой граф,
// нормализация работает узлом усиления, и плеер играет с громкостью пользователя.
// Свой движок (эксклюзивный режим) — цифровая громкость: нормализация может и поднимать (до ×4), без графа.
function outVol(a = audio) {
  // × «плавный переход» на стыке треков (transitions.js): конец затихает или начало входит тише
  const v = volume * (window.normElK ? window.normElK(a) : 1) * (window.xfK ? window.xfK(a) : 1);
  return Math.max(0, Math.min(a?._native ? 4 : 1, v));
}
function makeAudio(useViz, nat = false) {
  const a = nat && window.cast?.on() ? window.cast.create() : nat && window.engine ? window.engine.create() : new Audio();
  if (a._native) useViz = false;
  a.volume = volume;
  applySpeed(a);
  a.onplay = syncIcons;
  // конец трека: браузер сначала шлёт pause, потом ended. Этот pause — не остановка: ended сразу включит следующий
  // трек, а сообщи мы в Rust «не играет» — в трее страницу заморозило бы раньше, чем следующий трек загрузится.
  a.onpause = () => { if (!a.ended) syncIcons(); };
  a.onplaying = () => {
    applySpeed(a);
    if (a === audio) {
      loadAt = 0; wdPos = -1; wdAt = 0; if (transit) setTransit(false);
      window.perfMark?.("play:audible");
      wReport({ audible: true });         // звук пошёл — «Слушать вместе»: ведущий сообщает старт, гость догоняет (core/together.js)
    }
  };
  a.onseeked = () => { if (a === audio) wReport({ seek: a.currentTime }); };
  a.onended = () => {
    if (a !== audio) return;
    setTransit(true);
    if (effRepeat() === 2) { a.currentTime = 0; a.play(); return; }
    if (wave.on) waveFeedback("trackFinished", queue[current], { totalPlayedSeconds: Math.round(a.duration) });
    const n = nextIndex(true);
    if (n >= queue.length && wave.on) {
      // очередь волны кончилась раньше, чем успела пополниться — ждём подгрузку, а не останавливаемся
      const cur = current;
      $("#status").textContent = "Следующие треки волны загружаются…";
      waveMore().then((ok) => {
        if (a !== audio || current !== cur) return;
        if (ok && cur + 1 < queue.length) { $("#status").textContent = ""; play(cur + 1); return; }
        suspectOffline().then((off) => {
          if (a !== audio || current !== cur) return;
          if (!off) { setTransit(false); $("#status").textContent = "Не удалось получить следующие треки волны — нажми «Играть», чтобы повторить."; return; }
          // без сети волна не пополнится — играем скачанное
          const seq = playSeq;
          offlineFallback(cur, seq).then((ok2) => {
            if (ok2 || seq !== playSeq) return;
            setTransit(false);
            $("#status").textContent = "Офлайн-режим: скачанных треков нет — волна продолжится, когда связь вернётся.";
          });
        });
      });
      return;
    }
    if (n >= 0 && n < queue.length) play(n); else onQueueEnd();
  };
  a.ontimeupdate = () => {
    if (a === audio && a.duration) {
      if (!seekDrag) { $("#seek").value = (a.currentTime / a.duration) * 1000; fill($("#seek")); }   // не вырывать ползунок из-под руки
      setText($("#tCur"), fmtTime(a.currentTime));
      setText($("#tDur"), fmtTime(a.duration));
      if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveLast(a.currentTime); }
    }
  };
  if (useViz) {
    actx ||= new AudioContext();
    if (!analyser) {
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.35;      // меньше сглаживания — удары не «размазываются»
      analyser.connect(window.normNode ? window.normNode() : actx.destination);      // → усиление нормализации (sound.js) → динамики
      freq = new Uint8Array(analyser.frequencyBinCount);
    }
    a._src = actx.createMediaElementSource(a);
    a._src.connect(window.eqInput ? window.eqInput() : analyser);      // источник → эквалайзер → анализатор → динамики
  }
  a.volume = outVol(a);           // с учётом нормализации (без графа она приглушает через громкость плеера)
  if (!a._native) window.outBind?.(a);   // выбранное устройство вывода (output.js); свой движок открывает его сам
  return a;
}

const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
// анализ звука нужен, когда визуализатор включён и его видно (играет волна или открыта страница волны)
// Звуковой граф (Web Audio) нужен ещё и эквалайзеру (eq.js): с ним трек идёт через фильтры. Без визуализатора
// и с выключенным эквалайзером граф не создаётся вовсе — звук играет напрямую, без лишней работы.
// консольный визуализатор (cli.js → visual, cat vibe) тоже просит анализ звука: window.cliVizOn
// подъём тихих треков нормализацией (sound.js) тоже работает узлом усиления в графе
// в эксклюзивном режиме графа нет: звук идёт мимо страницы
function vizWanted() {
  if (window.engine?.on()) return false;
  return (cfg.viz && (wave.on || !$("#wavePage").hidden)) || !!window.eqActive?.() || !!window.cliVizOn || !!window.normWantsGraph?.();
}
function applyViz() {
  waveOrbitsSync();
  $("#viz").hidden = !cfg.viz;
  $("#vizFsBtn").hidden = !cfg.viz;
  if (!cfg.viz && vizFullOn) setVizFull(false);
  document.querySelector(".stage").classList.toggle("viz", cfg.viz);
  if ($("#wavePage").hidden) return;
  if (cfg.viz) { vizStart(); ensureVizAudio(); } else vizStop();
}
// Раньше анализ подключался только при старте СЛЕДУЮЩЕГО трека, поэтому сразу после включения визуализатор
// просто переливался. Теперь уже играющий трек незаметно переводится на анализируемый плеер с той же позиции.
let vizSwapSeq = 0;
let curCache = false;           // текущий трек играет из кэша приложения (cache.js), а не из скачанных
window.curFromWa = false;          // текущий трек играет из Whisper Archive (поток wa:// или, запасной путь, файл в curBlob)
async function ensureVizAudio() {
  if (!vizWanted() || audioViz || needLoad || !audio || !audio.src || current < 0 || !queue[current]) return;
  const my = ++vizSwapSeq, seq = playSeq, t = queue[current];
  let na = null;
  try {
    // Трек из архива: тот же поток wa:// (с CORS — его можно анализировать), ничего не качаем; если играл файл
    // целиком (запасной путь) — берём его. Брать трек у Яндекса нельзя — заиграла бы другая версия.
    // Скачанный трек (ymlocal://) — тот же файл с диска, тоже с CORS.
    const stream = (curFromWa || curLocal) && !curBlob ? audio.currentSrc || audio.src : "";
    let blob = curFromWa ? curBlob : null;
    if (!curFromWa && !curLocal) {
      const url = await directLink(t.id);
      const buf = await invoke("fetch_bytes", { url });
      if (my !== vizSwapSeq || seq !== playSeq || audioViz || !vizWanted()) return;
      blob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    }
    na = makeAudio(true);
    if (stream) na.crossOrigin = "anonymous";
    na.src = stream || blob;
    await new Promise((res, rej) => { na.addEventListener("loadedmetadata", res, { once: true }); na.addEventListener("error", () => rej(new Error("decode")), { once: true }); });
    if (my !== vizSwapSeq || seq !== playSeq || audioViz) throw new Error("stale");
    await Promise.race([actx.resume(), sleepMs(4000)]);
    if (actx.state !== "running") throw new Error("audio context");
    const old = audio, wasPlaying = !old.paused;
    na.currentTime = old.currentTime || 0;
    if (curBlob && curBlob !== blob) URL.revokeObjectURL(curBlob);
    curBlob = blob; audio = na; audioViz = true; na = null;
    window.normApply?.();           // теперь усиление делает узел графа, громкость плеера — без приглушения
    if (wasPlaying) await audio.play();
    old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load();
    syncIcons();
  } catch {
    if (na) { na.pause(); na._src?.disconnect(); na.removeAttribute("src"); na.load(); }
  }
}
function vizStart() { if (!viz.run) { viz.run = true; viz.lastDraw = 0; requestAnimationFrame(vizFrame); } }
// окно спрятано в трей или свёрнуто — циклы отрисовки останавливаются полностью; при показе — снова запускаются
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (!$("#wavePage").hidden || vizFullOn) applyViz();
  fullResume();
});
function vizStop() { viz.run = false; orbReset(); }

// ---------- визуализатор на весь экран: панели прячутся, остаются фон и визуализатор ----------
window.vizFullOn = false;      // applyViz и keynav.js читают по имени
let vfIdleT = 0;
function vfPoke() {                                  // показать кнопку выхода и курсор, через пару секунд снова спрятать
  const el = $("#vizFull");
  el.classList.remove("idle");
  clearTimeout(vfIdleT);
  vfIdleT = setTimeout(() => el.classList.add("idle"), 2200);
}
async function setVizFull(on) {
  if (on === vizFullOn || (on && (!cfg.viz || $("#wavePage").hidden))) return;
  vizFullOn = on;
  document.body.classList.toggle("vizfull-on", on);
  $("#vizFull").hidden = !on;
  viz.peaks.fill(0);
  if (on) {
    // кнопки «плей» в этом режиме нет — если ничего не играет, продолжаем трек, на котором остановились
    if (!audio || audio.paused || needLoad) {
      if (queue[current]) togglePlay(); else $("#waveBtn").click();      // совсем пусто — запускаем Мою волну
    }
    vizStart(); ensureVizAudio(); vfPoke();
  } else clearTimeout(vfIdleT);
  try { await invoke("win_set_fullscreen", { on }); } catch {}      // нет команды в Rust — просто на всё окно
  syncMax();
}
$("#vizFsBtn").onclick = () => setVizFull(true);
$("#vizFsExit").onclick = () => setVizFull(false);
$("#vizFull").addEventListener("mousemove", vfPoke);
$("#vizFull").addEventListener("dblclick", () => setVizFull(false));
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, [contenteditable]")) return;
  if (vizFullOn) {
    if (e.key === "Escape") setVizFull(false);
    else if (e.key === " ") { e.preventDefault(); togglePlay(); vfPoke(); }
    else if (e.code === "KeyF") setVizFull(false);
  } else if (e.code === "KeyF" && !$("#wavePage").hidden && $("#full").hidden) setVizFull(true);
});

$("#pTitle").onclick = () => { const id = albumOf(queue[current]); if (id) navigate(() => showAlbum(id)); };
$("#play").onclick = togglePlay;
$("#next").onclick = () => {
  if (wave.on) waveFeedback("skip", queue[current], { totalPlayedSeconds: Math.round(audio.currentTime) });
  const n = nextIndex(false);
  if (n >= 0 && (n < queue.length || wave.on)) play(n); else onQueueEnd();
};
$("#prev").onclick = () => {
  if (!needLoad && audio.currentTime > 3) { audio.currentTime = 0; return; }
  const n = prevIndex();
  if (n >= 0) play(n);
};

export { refreshPlayerBtns, directLink, markPlaying, swapCover, showTrack, saveLast, togglePlay, restorePlayer, play, stopForRetry,
  offlineFallback, ctxReady, recoverPlayback, outVol, makeAudio, vizWanted, applyViz, ensureVizAudio, vizStart, vizStop, setVizFull,
  vfPoke, LOCAL_BASE, sleepMs, rgba };

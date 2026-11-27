// «Студия» (кнопка под «Настройками»): свои версии треков. Пока одна функция — обрезка.
// Трек берётся играющий или из меню «⋯» → «Обрезать в студии». Файл трека отдаёт Rust (studio.rs, studio_source):
// по нему рисуется волна и слушается отрезок (Web Audio, отдельно от плеера). Сохранённая версия — mp3 на диске
// с номером «studio-…»: плеер играет её как скачанный трек, лайк у неё локальный (main.js → isLiked / toggleLike),
// в архив она уходит своим файлом (yandex.js → archiveSave → studio_to_archive), а «Поделиться» кладёт её
// в отдельный приватный альбом архива и копирует ссылку-приглашение (studioshare.js). Сводка о треке — studioinfo.js.
import { $, COVER_W, ICON, invoke, lsJSON, mkImg } from "../app/base.js";
import { cover } from "../app/list.js";
import { modal, showToast, toast } from "../app/menu.js";
import { goTop, renderTabs, resetView, setActive, setHead } from "../app/nav.js";
import { openTrackMenu } from "../app/trackmenu.js";
import { likesStudioChanged } from "./likes.js";
import { isStudio, refreshHearts, setHeart } from "../player/like.js";
import { loadInfo, paintInfo } from "./studioinfo.js";
import { saveShared, share, shareSetup, sharedAll, sharing } from "./studioshare.js";
(() => {
  const $s = (id) => document.getElementById(id);
  const page = $s("studioPage");
  if (!page) return;
  const W = window.Whisper;
  const MIN_LEN = 1;                                // секунды; столько же проверяет Rust
  const ICO = {
    cut: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.6 7.6 20 18M8.6 16.4 20 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4" stroke="currentColor" stroke-width="1.8"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  };
  const err = (e) => String(e?.message || e || "ошибка");
  const toast = (t, ms, o) => showToast(t, ms, o);

  // ---------- время ----------
  const fmt = (s, dec = true) => {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${(dec ? r.toFixed(1) : Math.floor(r).toString()).padStart(dec ? 4 : 2, "0")}`;
  };
  // «1:23.4», «83.4», «1:23» — секунды; иначе NaN
  const parse = (v) => {
    const m = /^\s*(?:(\d{1,3}):)?(\d{1,4}(?:[.,]\d{1,3})?)\s*$/.exec(String(v));
    return m ? (+(m[1] || 0)) * 60 + parseFloat(m[2].replace(",", ".")) : NaN;
  };
  const lenText = (s) => (s < 60 ? `${s.toFixed(1).replace(".", ",")} с` : fmt(s, false));

  // ---------- версии ----------
  let items = [];
  let filter = "all";
  const byId = (id) => items.find((x) => x.id === id);
  // трек для плеера и очереди — в том же виде, что треки Яндекса (обложка, исполнители — от исходника)
  const toRaw = (it) => ({
    id: it.id, title: it.title, durationMs: it.durationMs,
    artists: Array.isArray(it.meta?.artists) ? it.meta.artists : [],
    coverUri: it.meta?.coverUri || undefined,
    albums: Array.isArray(it.meta?.albums) ? it.meta.albums : [],
    studio: { src: it.srcId, from: it.startMs, to: it.endMs },
  });
  window.studioLiked = (id) => !!byId(id)?.liked;
  // лайкнутые версии для страницы «Лайки» (main.js → withStudioLikes): трек и время лайка, мс
  // (у версий, лайкнутых до того, как время стало записываться, — время сохранения)
  // замена трека (origin «replace») — не отдельный трек: в «Лайках» не появляется, лайк ставится самому треку Яндекса
  window.studioLikedList = () => items.filter((x) => x.liked && x.origin !== "replace").map((x) => ({ raw: toRaw(x), at: (x.likedAt || x.created || 0) * 1000 }));
  const likesRedraw = () => { if (typeof likesStudioChanged === "function") likesStudioChanged(); };
  // версии изменились — синхронизация через архив (libsync.js) отправит это чуть позже одной пачкой
  const synced = () => window.libsyncPoke?.();
  window.studioToggleLike = async (t) => {
    const it = byId(String(t?.id));
    if (!it) return;
    const want = !it.liked;
    it.liked = want; it.likedAt = want ? Math.floor(Date.now() / 1000) : 0;
    paintList(); refreshHearts();
    try { Object.assign(it, await invoke("studio_update", { id: it.id, liked: want })); synced(); }
    catch (e) { it.liked = !want; toast("Не удалось изменить лайк: " + err(e), 5000); }
    paintList(); refreshHearts(); likesRedraw();
  };
  // своя ли это версия (main.js → play: своя играет с диска; чужая — из комнаты или архива). Пока список не загружен —
  // null: «не знаю», и плеер пробует диск, как раньше
  let loaded = false;
  window.studioHas = (id) => (loaded ? !!byId(String(id)) : null);
  async function loadItems() {
    try { items = await invoke("studio_list"); } catch { items = []; }
    loaded = true;
    paintList(); refreshHearts();
    if (items.some((x) => x.liked)) likesRedraw();
  }
  // libsync.js: из архива пришли треки или лайки с другого устройства — перечитать список с диска
  window.studioReload = async () => {
    const had = items.some((x) => x.liked);
    await loadItems();
    if (had && !items.some((x) => x.liked)) likesRedraw();
  };

  // ---------- страница ----------
  function show() {
    ++nav;
    setHead({ title: "Студия" }); setActive("studioBtn"); renderTabs(false); resetView();
    $("#list").hidden = true; page.hidden = false;
    paintEditor(); paintList();
    requestAnimationFrame(draw);
  }
  $s("studioBtn").onclick = () => goTop(show);

  // ---------- включить / выключить (Настройки → Интерфейс → «Панели») ----------
  // Выключена — нет кнопки в боковой панели и «Обрезать в студии» в меню трека. Сохранённые версии остаются:
  // они в очереди, истории и лайках и по-прежнему играют. По умолчанию выключена: нужна не всем — включают сами.
  const ON_KEY = "ym_studio_on";
  let enabled = (() => { try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; } })();
  function applyOn() {
    document.documentElement.classList.toggle("no-studio", !enabled);
    const cb = $s("stuOn"); if (cb) cb.checked = enabled;
    if (!enabled && !page.hidden) { stopPreview(); $("#likes")?.click(); }      // открыта сама студия — уходим в лайки
  }
  $s("stuOn")?.addEventListener("change", (e) => {
    enabled = e.target.checked;
    try { localStorage.setItem(ON_KEY, enabled ? "1" : "0"); } catch {}
    applyOn();
  });
  window.addEventListener("storage", (e) => { if (e.key === ON_KEY) { enabled = e.newValue === "1"; applyOn(); } });
  // открыть студию с треком (меню «⋯», консоль)
  window.studioOpen = (raw) => { if (!enabled) return; goTop(show); if (raw) take(raw); };

  // ---------- редактор ----------
  // ed: { t — трек, buf — AudioBuffer, dur, a, b — границы в секундах, peaks — Float32Array (макс. по столбцам) }
  let ed = null, loadSeq = 0, actx = null;
  const prev = { node: null, from: 0, at: 0, raf: 0 };
  const canPick = (raw) => raw && !isStudio(raw.id) && /^\d{1,15}(:|$)/.test(String(raw.id));
  // Контекст для прослушивания отрезка живёт только пока отрезок играет: открытый AudioContext держит устройство
  // вывода, и эксклюзивный режим своего движка (engine.rs) не смог бы его занять. Разбор файла — без устройства.
  function ctx() {
    if (!actx || actx.state === "closed") actx = new AudioContext();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  const decode = (ab) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(ab);
  async function take(raw) {
    if (!canPick(raw)) { toast("Обрезать можно только трек Яндекс Музыки"); return; }
    const my = ++loadSeq;
    stopPreview();
    const playing = String(queue[current]?.id) === String(raw.id);
    const at = playing && audio ? audio.currentTime || 0 : 0;
    ed = { t: raw, buf: null, dur: (raw.durationMs || 0) / 1000, a: 0, b: 0, peaks: null, loading: true, error: "" };
    paintEditor();
    try {
      let ab = await invoke("studio_source", { trackId: String(raw.id) });
      if (!(ab instanceof ArrayBuffer)) ab = new Uint8Array(ab).buffer;
      const buf = await decode(ab);
      if (my !== loadSeq) return;
      ed.buf = buf; ed.dur = buf.duration; ed.peaks = peaksOf(buf, 1200); ed.loading = false;
      ed.a = Math.min(at, Math.max(0, buf.duration - MIN_LEN));
      ed.b = Math.min(buf.duration, ed.a + 30);
      loadInfo(ed, () => my === loadSeq);
    } catch (e) {
      if (my !== loadSeq) return;
      ed.loading = false; ed.error = "Не удалось загрузить трек: " + err(e);
    }
    paintEditor(); draw();
  }

  function peaksOf(buf, n) {
    const out = new Float32Array(n), chs = Math.min(2, buf.numberOfChannels), len = buf.length;
    const step = Math.max(1, Math.floor(len / n / 64));       // не каждую выборку: на волну хватает и так
    for (let c = 0; c < chs; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        let m = out[i];
        const s = Math.floor((i * len) / n), e = Math.floor(((i + 1) * len) / n);
        for (let k = s; k < e; k += step) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; }
        out[i] = m;
      }
    }
    let mx = 0; for (const v of out) if (v > mx) mx = v;
    if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
    return out;
  }
  const cv = $s("stuCanvas"), wave = $s("stuWave");
  function draw() {
    if (!cv || page.hidden) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!ed?.peaks) return;
    const cs = getComputedStyle(page);
    const on = cs.getPropertyValue("--accent").trim() || "#a66bff", off = cs.getPropertyValue("--muted").trim() || "#888";
    const n = ed.peaks.length, bars = Math.max(1, Math.floor(w / 3)), mid = h / 2;
    for (let i = 0; i < bars; i++) {
      const p0 = Math.floor((i * n) / bars), p1 = Math.max(p0 + 1, Math.floor(((i + 1) * n) / bars));
      let m = 0; for (let k = p0; k < p1; k++) if (ed.peaks[k] > m) m = ed.peaks[k];
      const t = ((i + 0.5) / bars) * ed.dur, inSel = t >= ed.a && t <= ed.b;
      const bh = Math.max(1.5, m * (h - 8));
      g.globalAlpha = inSel ? 1 : 0.45;
      g.fillStyle = inSel ? on : off;
      g.fillRect(i * 3, mid - bh / 2, 2, bh);
    }
    g.globalAlpha = 1;
    paintSel();
  }
  const xOf = (t) => (ed?.dur ? (t / ed.dur) * 100 : 0);
  function paintSel() {
    if (!ed) return;
    const sel = $s("stuSel"), ha = wave.querySelector('[data-h="a"]'), hb = wave.querySelector('[data-h="b"]');
    sel.style.left = xOf(ed.a) + "%"; sel.style.width = Math.max(0, xOf(ed.b) - xOf(ed.a)) + "%";
    ha.style.left = xOf(ed.a) + "%"; hb.style.left = xOf(ed.b) + "%";
    const head = $s("stuHead");
    head.hidden = !prev.node;
    if (prev.node) head.style.left = xOf(prevPos()) + "%";
    if (document.activeElement !== $s("stuA")) $s("stuA").value = fmt(ed.a);
    if (document.activeElement !== $s("stuB")) $s("stuB").value = fmt(ed.b);
    $s("stuLen").textContent = lenText(ed.b - ed.a);
  }
  function setRange(a, b, keep) {
    if (!ed?.buf) return;
    a = Math.max(0, Math.min(a, ed.dur)); b = Math.max(0, Math.min(b, ed.dur));
    if (b - a < MIN_LEN) {
      if (keep === "a") b = Math.min(ed.dur, a + MIN_LEN), a = Math.min(a, b - MIN_LEN);
      else a = Math.max(0, b - MIN_LEN), b = Math.max(b, a + MIN_LEN);
    }
    ed.a = Math.round(a * 10) / 10; ed.b = Math.round(b * 10) / 10;
    draw();
  }
  function paintEditor() {
    const has = !!ed, ok = !!ed?.buf;
    $s("stuEmpty").hidden = has;
    $s("stuEditor").hidden = !has;
    const cur = queue[current];
    $s("stuTake").hidden = !canPick(cur) || String(cur?.id) === String(ed?.t?.id);
    $s("stuTake").textContent = has ? "Взять играющий трек" : "Обрезать играющий трек";
    if (!has) return;
    const t = ed.t;
    const im = $s("stuCover"); im.src = cover(t, "200x200") || COVER_W;
    $s("stuTitle").textContent = t.title || "Без названия";
    $s("stuArtist").textContent = (t.artists || []).map((a) => a.name).join(", ");
    $s("stuState").textContent = ed.loading ? "Загружаю трек…" : ed.error;
    $s("stuState").hidden = !ed.loading && !ed.error;
    wave.classList.toggle("busy", !ok);
    for (const id of ["stuPlay", "stuTail", "stuSave", "stuA", "stuB", "stuName", "stuFromNow", "stuToNow"]) $s(id).disabled = !ok;
    if (!$s("stuName").dataset.for || $s("stuName").dataset.for !== String(t.id)) {
      $s("stuName").value = `${t.title || "Трек"} (обрезка)`; $s("stuName").dataset.for = String(t.id);
    }
    paintPlayBtn();
    paintInfo(ed);
  }

  // перетаскивание: ближняя граница едет за курсором, щелчок мимо — переносит ближнюю границу туда
  let drag = null;
  wave.addEventListener("pointerdown", (e) => {
    if (!ed?.buf || e.button !== 0) return;
    const r = wave.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * ed.dur;
    const hit = e.target.closest?.(".stuh")?.dataset.h;
    const which = hit || (Math.abs(t - ed.a) <= Math.abs(t - ed.b) ? "a" : "b");
    drag = { which, id: e.pointerId };
    wave.setPointerCapture(e.pointerId);
    moveTo(e);
    e.preventDefault();
  });
  function moveTo(e) {
    const r = wave.getBoundingClientRect(), t = ((e.clientX - r.left) / Math.max(1, r.width)) * ed.dur;
    if (drag.which === "a") setRange(t, ed.b, "a"); else setRange(ed.a, t, "b");
  }
  wave.addEventListener("pointermove", (e) => { if (drag && e.pointerId === drag.id) moveTo(e); });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  wave.addEventListener("pointerup", endDrag);
  wave.addEventListener("pointercancel", endDrag);
  // колесо — точная подгонка ближней к курсору границы (по 0,1 с; с Shift — по секунде)
  wave.addEventListener("wheel", (e) => {
    if (!ed?.buf) return;
    e.preventDefault();
    const r = wave.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * ed.dur;
    const d = (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 1 : 0.1);
    if (Math.abs(t - ed.a) <= Math.abs(t - ed.b)) setRange(ed.a + d, ed.b, "a"); else setRange(ed.a, ed.b + d, "b");
  }, { passive: false });
  for (const [id, k] of [["stuA", "a"], ["stuB", "b"]]) {
    const inp = $s(id);
    inp.addEventListener("change", () => {
      const v = parse(inp.value);
      if (!isFinite(v)) { inp.value = fmt(ed[k]); return; }
      k === "a" ? setRange(v, ed.b, "a") : setRange(ed.a, v, "b");
      inp.value = fmt(ed[k]);
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 1 : 0.1);
      k === "a" ? setRange(ed.a + d, ed.b, "a") : setRange(ed.a, ed.b + d, "b");
      inp.value = fmt(ed[k]);
    });
  }
  // «с текущего места» — позиция прослушивания отрезка или плеера, если играет тот же трек
  const nowPos = () => (prev.node ? prevPos() : String(queue[current]?.id) === String(ed?.t?.id) && audio ? audio.currentTime || 0 : NaN);
  $s("stuFromNow").onclick = () => { const p = nowPos(); if (isFinite(p)) setRange(p, Math.max(ed.b, p + MIN_LEN), "a"); else toast("Включи прослушивание, чтобы взять текущее место"); };
  $s("stuToNow").onclick = () => { const p = nowPos(); if (isFinite(p)) setRange(Math.min(ed.a, p - MIN_LEN), p, "b"); else toast("Включи прослушивание, чтобы взять текущее место"); };

  // ---------- прослушивание отрезка ----------
  const prevPos = () => prev.from + (actx ? actx.currentTime - prev.at : 0);
  function playPreview(from, to) {
    stopPreview();
    if (!ed?.buf) return;
    if (window.Whisper?.player.state().playing) W.player.pause();       // плеер замолкает, чтобы не играть поверх
    const c = ctx(), n = c.createBufferSource();
    n.buffer = ed.buf; n.connect(c.destination);
    n.onended = () => { if (prev.node === n) stopPreview(); };
    prev.node = n; prev.from = from; prev.at = c.currentTime;
    n.start(0, from, Math.max(0.05, to - from));
    const tick = () => { if (!prev.node) return; paintSel(); prev.raf = requestAnimationFrame(tick); };
    tick(); paintPlayBtn();
  }
  function stopPreview() {
    const n = prev.node;
    prev.node = null; cancelAnimationFrame(prev.raf);
    if (n) { n.onended = null; try { n.stop(); } catch {} n.disconnect(); }
    if (actx && actx.state !== "closed") { const c = actx; actx = null; c.close().catch(() => {}); }
    paintPlayBtn();
    if (ed) paintSel();
  }
  function paintPlayBtn() {
    const b = $s("stuPlay");
    b.innerHTML = (prev.node ? ICO.stop : ICON.play) + `<span>${prev.node ? "Стоп" : "Послушать"}</span>`;
  }
  $s("stuPlay").onclick = () => (prev.node ? stopPreview() : playPreview(ed.a, ed.b));
  $s("stuTail").onclick = () => playPreview(Math.max(ed.a, ed.b - 3), ed.b);
  // обычный плеер заиграл — прослушивание отрезка останавливается
  W?.on("playstate", (p) => { if (p?.playing && prev.node) stopPreview(); });
  W?.on("track", () => { if (!page.hidden) paintEditor(); paintPlaying(); });
  $s("stuTake").onclick = () => take(queue[current]);
  $s("stuClose").onclick = () => { stopPreview(); ++loadSeq; ed = null; paintEditor(); };

  // ---------- сохранение ----------
  const metaOf = (t) => ({
    srcTitle: String(t.title || "").slice(0, 200),
    artists: (t.artists || []).slice(0, 6).filter((a) => a?.name).map((a) => ({ id: a.id != null ? String(a.id).slice(0, 30) : undefined, name: String(a.name).slice(0, 120) })),
    coverUri: t.coverUri ? String(t.coverUri).slice(0, 300) : undefined,
    albums: t.albums?.[0] ? [{ id: t.albums[0].id != null ? String(t.albums[0].id).slice(0, 30) : undefined, title: String(t.albums[0].title || "").slice(0, 200) }] : [],
  });
  $s("stuSave").onclick = async () => {
    if (!ed?.buf) return;
    const b = $s("stuSave"), name = $s("stuName").value.trim();
    if (!name) { $s("stuName").focus(); toast("Дай версии название"); return; }
    b.disabled = true;
    try {
      const it = await invoke("studio_save", {
        trackId: String(ed.t.id), startMs: Math.round(ed.a * 1000), endMs: Math.round(ed.b * 1000), title: name, meta: metaOf(ed.t),
      });
      items.unshift(it); filter = "all"; paintList(); synced();
      toast(`«${it.title}» — в «Моих версиях»`, 3500, { kind: "ok", action: { label: "Слушать", fn: () => playItem(it.id) } });
    } catch (e) { toast("Не удалось сохранить: " + err(e), 6000); }
    b.disabled = false;
  };

  // ---------- «Мои версии» ----------
  const list = $s("stuList");
  const shown = () => (filter === "liked" ? items.filter((x) => x.liked) : items);
  // dropin.js: перетащенный трек лёг в студию (сразу с лайком) — в список, в «Лайки», и можно включить
  // своя замена трека Яндекса (перетащенный файл, связанный с треком): номер её файла или "" (main.js → play)
  window.studioReplacement = (trackId) => {
    const src = String(trackId ?? "").split(":")[0];
    return (src && items.find((x) => x.origin === "replace" && x.srcId === src)?.id) || "";
  };
  window.studioAdd = (it) => {
    if (!it?.id || byId(it.id)) return;
    // у трека одна замена — прошлую Rust уже удалил (drop_audio_local)
    if (it.origin === "replace") items = items.filter((x) => !(x.origin === "replace" && x.srcId === it.srcId));
    items.unshift(it);
    paintList(); refreshHearts(); likesRedraw(); synced();
  };
  window.studioPlay = (id) => playItem(String(id));
  function playItem(id) {
    const arr = shown().some((x) => x.id === id) ? shown() : items;
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return;
    stopPreview();
    W.queue.play(arr.map(toRaw), i);
  }
  function paintList() {
    for (const c of $s("stuFilter").querySelectorAll(".chip")) c.classList.toggle("active", c.dataset.f === filter);
    const nl = items.filter((x) => x.liked).length;
    $s("stuFilter").querySelector('[data-f="liked"]').textContent = nl ? `Любимые · ${nl}` : "Любимые";
    const arr = shown();
    list.textContent = "";
    $s("stuNone").hidden = arr.length > 0;
    $s("stuNone").textContent = items.length ? "Любимых версий пока нет — нажми ♥ у версии." : "Здесь появятся твои версии треков.";
    for (const it of arr) {
      const raw = toRaw(it), li = document.createElement("li");
      li.dataset.id = it.id;
      const im = mkImg(cover(raw), "art");
      const tx = document.createElement("div"); tx.className = "txt";
      const t = document.createElement("div"); t.className = "t"; t.textContent = it.title;
      const a = document.createElement("div"); a.className = "a";
      const who = raw.artists.map((x) => x.name).join(", ");
      // свой файл (перетащили в окно, dropin.js) — без отрезка, с форматом
      const what = it.origin === "replace" ? `замена · ${String(it.ext || "mp3").toUpperCase()}` : it.origin === "import" ? `свой файл · ${String(it.ext || "mp3").toUpperCase()}` : `${fmt(it.startMs / 1000, false)}–${fmt(it.endMs / 1000, false)}`;
      a.textContent = [who, what].filter(Boolean).join(" · ");
      tx.append(t, a);
      const dur = document.createElement("span"); dur.className = "dur"; dur.textContent = fmt(it.durationMs / 1000, false);
      const lk = document.createElement("button"); lk.className = "likebtn";
      setHeart(lk, it.liked);
      lk.onclick = (e) => { e.stopPropagation(); window.studioToggleLike(raw); };
      const mo = document.createElement("button"); mo.className = "morebtn"; mo.title = "Ещё"; mo.innerHTML = ICO.more;
      mo.onclick = (e) => { e.stopPropagation(); openTrackMenu(raw, mo); };
      li.append(im, tx, dur, lk, mo);
      li.onclick = () => playItem(it.id);
      li.oncontextmenu = (e) => { e.preventDefault(); openTrackMenu(raw, mo); };
      list.append(li);
    }
    paintPlaying();
  }
  function paintPlaying() {
    const id = String(queue[current]?.id || "");
    for (const li of list.querySelectorAll("li")) li.classList.toggle("playing", li.dataset.id === id);
  }
  for (const c of $s("stuFilter").querySelectorAll(".chip")) c.onclick = () => { filter = c.dataset.f; paintList(); };

  async function rename(it) {
    const r = await modal({ title: "Название версии", input: { value: it.title, placeholder: "Название", max: 200 }, ok: "Сохранить" });
    if (!r) return;
    try { Object.assign(it, await invoke("studio_update", { id: it.id, title: r.value })); paintList(); syncQueue(it); synced(); }
    catch (e) { toast("Не удалось переименовать: " + err(e), 5000); }
  }
  // переименованная версия в очереди — с новым названием (в плеере обновится со следующим включением)
  function syncQueue(it) {
    for (const q of queue) if (String(q?.id) === it.id) q.title = it.title;
  }
  async function remove(it) {
    const text = window.libsyncActive?.()
      ? `«${it.title}» удалится с диска и с других устройств (синхронизация через архив). Копия в альбоме архива (если есть) останется.`
      : `«${it.title}» удалится с диска. Копия в архиве (если есть) останется.`;
    const r = await modal({ title: "Удалить версию?", text, ok: "Удалить", danger: true });
    if (!r) return;
    const cur = String(queue[current]?.id ?? "").split(":")[0];
    if (cur === it.id || (it.origin === "replace" && cur === it.srcId)) { toast("Эта версия сейчас играет — включи другой трек и удали её"); return; }
    try {
      await invoke("studio_delete", { id: it.id });
      items = items.filter((x) => x.id !== it.id);
      const sh = sharedAll(); if (sh[it.id]) { delete sh[it.id]; saveShared(sh); }
      paintList(); synced();
    } catch (e) { toast("Не удалось удалить: " + err(e), 5000); }
  }
  async function exportFile(it) {
    try { const p = await invoke("studio_export", { id: it.id }); if (p) toast("Сохранено: " + p, 4000, { kind: "ok" }); }
    catch (e) { toast("Не удалось сохранить файл: " + err(e), 5000); }
  }

  // ---------- меню «⋯» ----------
  W?.ui.trackMenu.add({
    id: "studio",
    build(t, m) {
      const raw = t?.raw || t, id = String(raw?.id || "");
      if (isStudio(id)) {
        const it = byId(id);
        if (!it) return false;
        m.item(ICO.share, sharing.has(id) ? "Готовлю ссылку…" : "Поделиться через архив", () => share(it));
        m.item(ICO.edit, "Переименовать…", () => rename(it));
        m.item(ICO.file, "Сохранить файл…", () => exportFile(it));
        if (enabled && (it.origin || "cut") === "cut") m.item(ICO.cut, "Открыть исходник в студии", () => window.studioOpen({ ...raw, id: it.srcId, title: it.meta?.srcTitle || raw.title, durationMs: 0, studio: undefined }));
        m.item(ICO.del, "Удалить версию", () => remove(it), { danger: true });
        return true;
      }
      // у трека Яндекса есть своя замена (перетащенный файл) — её можно убрать, трек снова зазвучит как на Яндексе
      const rep = window.studioReplacement(id), repIt = rep && byId(rep);
      if (repIt) m.item(ICO.del, "Убрать свою замену", () => remove(repIt));
      if (!enabled || !canPick(raw)) return !!repIt;
      m.item(ICO.cut, "Обрезать в студии", () => window.studioOpen(raw));
      return true;
    },
  });

  window.addEventListener("resize", () => { if (!page.hidden) draw(); });
  // стиль сменился (цвета волны берутся из --accent / --muted)
  new MutationObserver(() => { if (!page.hidden) draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  shareSetup({ toRaw, stopPreview });     // studioshare.js: версия → трек и остановка прослушивания
  applyOn();
  loadItems();
})();

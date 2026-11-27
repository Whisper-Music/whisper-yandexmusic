// linkalbum.js — альбом по ссылке (Rust — linkset.rs поверх linkdl.rs). Зовёт linkadd.js перед обычным скачиванием:
//   * плейлист YouTube / SoundCloud → выбрать треки → скачать → в новый альбом Whisper Archive, в новый плейлист
//     Яндекс Музыки (файлы — на этом компьютере, в плейлисте их показывает library/pllocal.js) или все в «Лайки»;
//   * длинное видео (сборник, концерт, альбом одним роликом: длиннее 20 минут или с главами) → предложить разделить:
//     по главам из описания, а нет глав — по паузам между песнями; список кусков можно поправить (название, начало,
//     убрать, добавить) → нарезка без перекодирования → туда же: альбом в архиве, плейлист Яндекса или «Лайки»;
//   * по ссылке, похоже, не музыка (категория YouTube, слова в названии) → спросить «всё равно скачать?».
// Сохраняет тем же путём, что перетащенный файл: drop_audio_local / drop_audio_archive по номеру файла (bg.rs).
import { invoke } from "../app/base.js";
import { hideToast, modal, showToast } from "../app/menu.js";
import { navigate } from "../app/nav.js";
import { plCreate, plErr, showPlaylist } from "../pages/playlists.js";
import { plLocalAdd } from "./pllocal.js";

const W = window.Whisper;
const err = (e) => String(e?.message || e || "ошибка").replace(/^Error:\s*/, "");
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const LONG = 20 * 60;               // длиннее — предлагаем разделить
const ONE_MAX = 3600;               // одним треком — не длиннее часа (linkdl.rs)
const MAX_LONG = 4 * 3600;
const LIST_MAX = 50;
// «1 трек», «3 трека», «5 треков»
const plTracks = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "трек" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "трека" : "треков"}`;
const cancelAct = { label: "Отменить", fn: () => invoke("link_cancel").catch(() => {}) };

// 75 → «1:15», 3725 → «1:02:05»
function fmt(sec) {
  const s = Math.max(0, Math.round(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
// «1:15», «1:02:05», «75» → секунды; не время — NaN
function parseTime(t) {
  const p = String(t || "").trim().split(":");
  if (!p.length || p.length > 3 || p.some((x) => !/^\d{1,3}(?:[.,]\d+)?$/.test(x))) return NaN;
  return p.reduce((a, x) => a * 60 + parseFloat(x.replace(",", ".")), 0);
}

// ход скачивания — в подсказке внизу (как у одного трека в linkadd.js). src — сайт («YouTube»); без него — разбор ссылки.
// Строки целиком, без склейки: так их переводит словарь (i18n/en.js).
async function withProgress(src, fn, count = 0) {
  let last = 0;
  showToast(src ? `Скачивается с ${src}…` : "Проверка ссылки…", 0, { action: cancelAct });
  const un = await window.__TAURI__?.event?.listen("link-progress", (e) => {
    const p = e.payload || {};
    if (p.stage === "update") return showToast("Обновляется yt-dlp…", 0, { action: cancelAct });
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    if (!src) return;
    const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
    const t = count && p.item
      ? (pct ? `Скачивается с ${src}: трек ${p.item} из ${count}, ${pct}%` : `Скачивается с ${src}: трек ${p.item} из ${count}`)
      : (pct ? `Скачивается с ${src}: ${pct}%` : `Скачивается с ${src}…`);
    showToast(t, 0, { action: cancelAct });
  });
  try { return await fn(); } finally { try { un?.(); } catch {} }
}

// окно с выбором из нескольких кнопок → значение выбранной (null — закрыли)
function choose({ title, text, options }) {
  return new Promise((resolve) => {
    const wrap = el("div", "login modal");
    const box = el("div", "panel login-box modalbox lachoose");
    box.append(el("h2", "", title));
    if (text) box.append(el("p", "lanote", text));
    const list = el("div", "laopts");
    const done = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); resolve(v); };
    for (const o of options) {
      const b = el("button", "dropopt");
      b.type = "button";
      b.append(el("b", "", o.label));
      if (o.note) b.append(el("small", "", o.note));
      b.onclick = () => done(o.value);
      list.append(b);
    }
    const row = el("div", "row");
    const no = el("button", "nav", "Отмена"); no.type = "button"; no.onclick = () => done(null);
    row.append(no);
    box.append(list, row);
    wrap.append(box);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    wrap.onpointerdown = (e) => { if (e.target === wrap) done(null); };
    document.body.append(wrap);
    list.querySelector("button")?.focus();
  });
}

// обложка нового альбома: заливка цветами стиля с названием (как у dropin.js)
async function plainCover(title) {
  const S = 600, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), cs = getComputedStyle(document.documentElement);
  const gr = g.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, cs.getPropertyValue("--accent").trim() || "#a66bff"); gr.addColorStop(1, cs.getPropertyValue("--accent2").trim() || "#e060ff");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.fillStyle = "#fff"; g.font = "600 40px system-ui, sans-serif"; g.textBaseline = "middle";
  let t = String(title || "Альбом");
  while (t.length > 1 && g.measureText(t).width > S - 80) t = t.slice(0, -2).trimEnd() + "…";
  g.fillText(t, 40, S * 0.83);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : null;
}

// ---------- окно альбома: треки, название, исполнитель, куда сохранить ----------
// mode "split": rows = [{ title, start }] (концы — начало следующего, у последнего — конец записи), можно править время
// и добавлять треки; mode "list": rows = [{ index, title, duration }] — только выбор и названия.
function albumDialog({ mode, probe, rows, duration, note }) {
  return new Promise((resolve) => {
    const split = mode === "split";
    const wrap = el("div", "login modal");
    const box = el("form", "panel login-box modalbox labox"); box.noValidate = true;
    box.append(el("h2", "", split ? "Разделить на треки" : "Треки плейлиста"));
    // название и длина — отдельными узлами от подсказки: подсказку переводит словарь, название — нет
    const what = el("p", "lanote lawhat");
    what.append(el("b", "", `«${probe.title}»`), el("span", "", split ? fmt(duration)
      : probe.count > rows.length ? `первые ${rows.length} из ${probe.count}` : plTracks(rows.length)));
    box.append(what);
    const hint = split ? note : `Можно взять до ${LIST_MAX} треков за раз.`;
    if (hint) box.append(el("p", "lanote", hint));

    const meta = el("div", "lameta");
    const albF = el("input", "field"); albF.maxLength = 75; albF.value = (probe.album || probe.title || "").slice(0, 75); albF.placeholder = "Название альбома";
    const artF = el("input", "field"); artF.maxLength = 120; artF.value = probe.artist || ""; artF.placeholder = "Исполнитель";
    for (const f of [albF, artF]) f.spellcheck = false;
    const l1 = el("label", "lalab", "Альбом"), l2 = el("label", "lalab", "Исполнитель");
    l1.append(albF); l2.append(artF);
    meta.append(l1, l2);

    const head = el("div", "lahead");
    const all = el("input"); all.type = "checkbox"; all.checked = true; all.title = "Выбрать все";
    head.append(all, el("span", "", split ? "Начало и название" : "Название"), el("span", "ladur", "Длина"));
    const list = el("div", "lalist");
    const items = rows.map((r) => ({ ...r, on: true }));
    if (!split) items.forEach((x, i) => { x.on = i < LIST_MAX; });

    const ends = () => {
      const sorted = [...items].sort((a, b) => a.start - b.start);
      return new Map(sorted.map((x, i) => [x, (sorted[i + 1]?.start ?? duration)]));
    };
    function paint() {
      list.replaceChildren();
      const E = split ? ends() : null;
      const order = split ? [...items].sort((a, b) => a.start - b.start) : items;
      for (const x of order) {
        const r = el("div", "larow" + (x.on ? "" : " off"));
        const cb = el("input"); cb.type = "checkbox"; cb.checked = x.on;
        cb.onchange = () => { x.on = cb.checked; r.classList.toggle("off", !x.on); count(); };
        r.append(cb);
        if (split) {
          const st = el("input", "field latime"); st.value = fmt(x.start); st.title = "Начало трека (мин:сек или ч:мин:сек)";
          st.onchange = () => {
            const v = parseTime(st.value);
            if (!Number.isFinite(v) || v < 0 || v >= duration - 1) { st.value = fmt(x.start); st.classList.add("bad"); setTimeout(() => st.classList.remove("bad"), 900); return; }
            x.start = v; paint();
          };
          r.append(st);
        }
        const ti = el("input", "field latitle"); ti.value = x.title; ti.maxLength = 200; ti.spellcheck = false;
        ti.oninput = () => { x.title = ti.value; };
        r.append(ti);
        const len = split ? E.get(x) - x.start : x.duration;
        r.append(el("span", "ladur", len > 0 ? fmt(len) : ""));
        if (split && items.length > 1) {
          const del = el("button", "laxdel", "✕"); del.type = "button"; del.title = "Убрать границу — трек сольётся с предыдущим";
          del.onclick = () => { items.splice(items.indexOf(x), 1); if (!items.some((y) => y.start === 0)) items.sort((a, b) => a.start - b.start)[0].start = 0; paint(); count(); };
          r.append(del);
        }
        list.append(r);
      }
    }
    const add = el("button", "nav laadd", "+ Добавить трек"); add.type = "button"; add.hidden = !split;
    add.onclick = () => {
      // новая граница — посередине самого длинного куска
      const E = ends();
      let best = null;
      for (const x of items) if (!best || E.get(x) - x.start > E.get(best) - best.start) best = x;
      if (!best || E.get(best) - best.start < 4) return;
      items.push({ title: `Трек ${items.length + 1}`, start: Math.round((best.start + E.get(best)) / 2), on: true });
      paint(); count();
    };

    // куда
    const arch = W?.modules?.archive;
    const canArch = !!arch?.connected?.();
    const canYa = !!window.uid;
    let dest = canArch ? "archive" : canYa ? "yandex" : "likes";
    const where = el("div", "dropwhere lawhere");
    const opt = (v, label, small, ok = true) => {
      const b = el("button", "dropopt" + (dest === v ? " on" : "")); b.type = "button"; b.disabled = !ok;
      b.append(el("b", "", label), el("small", "", small));
      b.onclick = () => { dest = v; for (const o of where.children) o.classList.toggle("on", o === b); };
      return b;
    };
    where.append(
      opt("archive", "Новый альбом в Whisper Archive", canArch ? "Слушать с любого устройства и делиться" : "Сначала войди в архив: Настройки → Интеграции", canArch),
      opt("yandex", "Новый плейлист в Яндекс Музыке", canYa ? "Треки хранятся на этом компьютере и видны в плейлисте в приложении" : "Сначала войди в Яндекс", canYa),
      opt("likes", "Все в «Лайки»", "Каждый трек — отдельно, с названием альбома в сведениях"),
    );

    const msg = el("p", "status addmsg");
    const row = el("div", "row");
    const no = el("button", "nav", "Отмена"); no.type = "button";
    const go = el("button", "nav active", "Сохранить"); go.type = "submit";
    row.append(no, go);
    box.append(meta, head, list, add, el("h4", "", "Куда"), where, msg, row);
    wrap.append(box);

    function count() {
      const n = items.filter((x) => x.on).length;
      go.textContent = n ? `Сохранить: ${plTracks(n)}` : "Сохранить";
      go.disabled = !n || (!split && n > LIST_MAX);
      all.checked = n === items.length;
      msg.textContent = !split && n > LIST_MAX ? `За раз — не больше ${LIST_MAX} треков` : "";
    }
    all.onchange = () => { for (const x of items) x.on = all.checked; paint(); count(); };

    const close = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape" && !go.disabled) { e.stopPropagation(); close(null); } };
    document.addEventListener("keydown", onKey, true);
    no.onclick = () => close(null);
    box.onsubmit = (e) => {
      e.preventDefault();
      const album = albF.value.trim();
      if (dest !== "likes" && !album) { msg.textContent = dest === "yandex" ? "Дай плейлисту название" : "Дай альбому название"; albF.focus(); return; }
      let picked;
      if (split) {
        const E = ends();
        picked = [...items].sort((a, b) => a.start - b.start).filter((x) => x.on)
          .map((x, i) => ({ title: x.title.trim() || `Трек ${i + 1}`, start: x.start, end: E.get(x) }));
        const bad = picked.find((p) => p.end - p.start < 1);
        if (bad) { msg.textContent = `«${bad.title}» короче секунды — поправь время`; return; }
      } else {
        picked = items.filter((x) => x.on).map((x) => ({ index: x.index, title: x.title.trim() || `Трек ${x.index}` }));
      }
      close({ album, artist: artF.value.trim(), dest, parts: picked });
    };
    document.body.append(wrap);
    paint(); count();
    go.focus();
  });
}

// ---------- сохранение ----------
// по одному: архиву нельзя больше двух загрузок сразу и 30 за 10 минут (core/rust/whisper/upload.rs) — ждём и пробуем снова
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function toArchive(pieces, { album, artist }) {
  let albumId = null;
  const cover = await plainCover(album);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const who = p.artist || artist;
    const args = { pick: p.entry.id, fileName: who ? `${who} - ${p.title}` : p.title, albumId, albumTitle: albumId ? null : album, coverUrl: null, coverBytes: albumId ? null : cover };
    for (let tries = 0; ; tries++) {
      showToast(`В архив: трек ${i + 1} из ${pieces.length}…`, 0);
      let r;
      try { r = await invoke("drop_audio_archive", args); }
      catch (e) {
        if (/подожд|несколько минут|два трека/i.test(err(e)) && tries < 12) { showToast(`Архив просит подождать — продолжение через минуту (готово ${i} из ${pieces.length})`, 0); await sleep(60000); continue; }
        throw e;
      }
      if (r.status < 200 || r.status >= 300) {
        let m = ""; try { const b = JSON.parse(r.body || "null"); m = b?.message || b?.title || ""; } catch {}
        throw new Error(r.status === 401 || r.status === 403 ? "Архив не принял вход — войди заново (Настройки → Интеграции)" : `Архив ответил ${r.status}${m ? ": " + m : ""}`);
      }
      await W.modules.archive?.remember?.(null, r).catch(() => {});
      if (!albumId) {
        // новый альбом: его номер — в ответе; нет — ищем свежий альбом с таким названием
        try { const b = JSON.parse(r.body || "null"); albumId = String(b?.id || b?.albumId || b?.album?.id || "") || null; } catch {}
        if (!/^[0-9a-f-]{36}$/i.test(albumId || "")) {
          const mine = await W.modules.archive.albums().catch(() => []);
          albumId = mine.filter((a) => a.title === album).map((a) => a.id).pop() || null;
          if (!albumId && i < pieces.length - 1) throw new Error("альбом создан, но не нашёлся — остальные треки добавь в него вручную");
        }
      }
      break;
    }
  }
}
async function toLikes(pieces, { album, artist, link }) {
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    showToast(`В «Лайки»: трек ${i + 1} из ${pieces.length}…`, 0);
    const who = p.artist || artist;
    const meta = { artists: who ? [{ name: who.slice(0, 120) }] : [], albums: album ? [{ title: album.slice(0, 200) }] : [] };
    const it = await invoke("drop_audio_local", { pick: p.entry.id, title: p.title, meta, duration: p.durationMs || null, replaces: null, liked: true, link });
    window.studioAdd?.(it);
  }
}
// плейлист Яндекса: сам плейлист — на сервере Яндекса (личный), файлы — свои треки на этом компьютере (studio.rs);
// где какой трек стоит, помнит pllocal.js. Каждый трек записывается сразу — оборвётся на середине, готовое останется.
async function toYandex(pieces, { album, artist, link }) {
  let pl;
  try { pl = await plCreate(album.slice(0, 100), false); }
  catch (e) { throw new Error("не удалось создать плейлист: " + plErr(e)); }
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    showToast(`В плейлист: трек ${i + 1} из ${pieces.length}…`, 0);
    const who = p.artist || artist;
    const meta = { artists: who ? [{ name: who.slice(0, 120) }] : [], albums: album ? [{ title: album.slice(0, 200) }] : [] };
    const it = await invoke("drop_audio_local", { pick: p.entry.id, title: p.title, meta, duration: p.durationMs || null, replaces: null, liked: false, link });
    window.studioAdd?.(it);
    plLocalAdd(pl.kind, [it.id]);
  }
  return pl;
}
async function save(pieces, choice, link) {
  const n = plTracks(pieces.length);
  if (choice.dest === "yandex") {
    const pl = await toYandex(pieces, { ...choice, link });
    showToast(`Готово: ${n} в плейлисте «${pl.title}» в Яндекс Музыке`, 8000,
      { kind: "ok", action: { label: "Открыть", fn: () => navigate(() => showPlaylist(pl.kind)) } });
    return;
  }
  if (choice.dest === "archive") await toArchive(pieces, choice);
  else await toLikes(pieces, { ...choice, link });
  showToast(choice.dest === "archive" ? `Готово: ${n} в альбоме «${choice.album}» в Whisper Archive` : `Готово: ${n} в «Лайках»`, 6000, { kind: "ok" });
}

// ---------- маршрут ссылки ----------
// "single" — дальше обычное скачивание одного трека (linkadd.js), "done" — всё сделано здесь, "cancel" — передумали.
export async function routeLink(chk) {
  let list = !chk.url;
  if (chk.url && chk.list) {
    const v = await choose({
      title: "В ссылке есть плейлист",
      options: [
        { value: "one", label: "Только этот трек", note: "Как обычно — один трек" },
        { value: "list", label: "Весь плейлист", note: "Выбрать треки и собрать альбом" },
      ],
    });
    if (!v) return "cancel";
    list = v === "list";
  }
  const probe = await withProgress("", () => invoke("link_probe", { url: list ? chk.list : chk.url, list }));
  hideToast();
  if (!probe.music) {
    const ok = await modal({ title: "Похоже, это не музыка", text: `${probe.why}. Всё равно скачать?`, ok: "Скачать" });
    if (!ok) return "cancel";
  }
  if (list) return listFlow(probe);
  const dur = probe.duration || 0;
  if (dur <= LONG && probe.chapters.length < 2) return "single";
  if (dur > MAX_LONG) throw new Error(`Запись длиннее 4 часов (${fmt(dur)}) — такие не скачиваются`);
  const opts = [{
    value: "split", label: "Разделить на треки",
    note: probe.chapters.length >= 2 ? `По главам из описания: ${probe.chapters.length}` : "По паузам между песнями — список можно будет поправить",
  }];
  if (dur <= ONE_MAX) opts.push({ value: "one", label: "Одним треком", note: fmt(dur) });
  const v = await choose({ title: "Длинная запись", text: `«${probe.title}» · ${fmt(dur)}`, options: opts });
  if (!v) return "cancel";
  if (v === "one") return "single";
  return splitFlow(chk.url, probe);
}

async function splitFlow(url, probe) {
  const long = await withProgress(probe.source, () => invoke("link_download_long", { url }));
  const duration = long.duration || probe.duration;
  let rows, note = "";
  if (probe.chapters.length >= 2) {
    rows = probe.chapters.map((c, i) => ({ title: c.title || `Трек ${i + 1}`, start: c.start }));
  } else {
    showToast("Поиск пауз между песнями…", 0);
    const pts = await invoke("link_silences", { token: long.token }).catch(() => []);
    rows = [0, ...pts].map((s, i) => ({ title: `Трек ${i + 1}`, start: s }));
    note = pts.length ? `По паузам нашлось: ${plTracks(pts.length + 1)}. Проверь границы и дай названия.` : "Пауз между песнями не нашлось — добавь треки и впиши, где каждый начинается.";
  }
  hideToast();
  rows[0].start = 0;
  const choice = await albumDialog({ mode: "split", probe, rows, duration, note });
  if (!choice) { invoke("link_forget", { token: long.token }).catch(() => {}); return "cancel"; }
  showToast("Нарезка на треки…", 0);
  const pieces = await invoke("link_split", { token: long.token, parts: choice.parts });
  await save(pieces, choice, url);
  invoke("link_forget", { token: long.token }).catch(() => {});
  return "done";
}

async function listFlow(probe) {
  const rows = probe.items.map((x) => ({ index: x.index, title: x.title, duration: x.duration }));
  const choice = await albumDialog({ mode: "list", probe, rows });
  if (!choice) return "cancel";
  // название из плейлиста («Исполнитель - Песня (Official Video)») хуже того, что разобрал yt-dlp, — берём его, только если поправили
  const orig = new Map(probe.items.map((x) => [x.index, x.title]));
  const titles = new Map(choice.parts.filter((p) => p.title !== orig.get(p.index)).map((p) => [p.index, p.title]));
  const pieces = await withProgress(probe.source, () => invoke("link_download_list", { url: probe.url, items: choice.parts.map((p) => p.index) }), choice.parts.length);
  // номер трека — из имени файла «NNN - …» (linkset.rs)
  for (const p of pieces) {
    const n = parseInt(String(p.entry?.name || "").slice(0, 3), 10);
    if (titles.has(n)) p.title = titles.get(n);
  }
  if (pieces.length < choice.parts.length) showToast(`Скачалось ${pieces.length} из ${choice.parts.length} — недоступные пропущены`, 4000);
  if (!choice.album && pieces[0]?.album) choice.album = pieces[0].album;
  await save(pieces, choice, probe.url);
  return "done";
}

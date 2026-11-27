// Плейлисты: список «Мои плейлисты», страница плейлиста (обложки, переименование, удаление, порядок треков
// перетаскиванием, рекомендации), добавление и удаление треков, запросы к API плейлистов Яндекса.
// ES-модуль, подключён ПЕРЕД app/main.js (main.js может открыть плейлисты ещё при запуске — «Лайки» → «Плейлисты»).
// При загрузке только объявляет функции и вешает обработчики на разметку (свой $); PL, curPl, queue, ym… из main.js —
// по имени внутри функций (модуль видит глобальную область обычных скриптов). Наружу — через window в конце.
import { fill, ICON, isNetErr, mkImg, safeUrl, ym } from "../app/base.js";
import { imageGuard, IMG_LIMITS } from "../app/imgguard.js";
import { albumOf, cover, plural, renderList } from "../app/list.js";
import { closeTrackMenu, hideToast, menuItem, menuNote, menuReset, modal, openMenu, placeMenu, showToast } from "../app/menu.js";
import { goTop, navigate, renderTabs, resetView, setActive, setHead } from "../app/nav.js";
import { suspectOffline } from "../app/offline.js";
import { pinKey, savePins } from "../app/pins.js";
import { IDB } from "../look/bg.js";
import { plLocalAdd, plLocalForget, plLocalMerge, plLocalRemove } from "../library/pllocal.js";
import { offlineNote, showLikes } from "./likes.js";
import { fmtHours } from "./stats.js";
import { play } from "../player/core.js";
const $ = (s) => document.querySelector(s);

const kindOk = (k) => /^\d{1,12}$/.test(String(k));
const plCount = (n) => { n = Number(n) || 0; return `${n} ${plural(n, ["трек", "трека", "треков"])}`; };
const plName = (kind) => (PL.full.get(String(kind)) || PL.list?.find((p) => String(p.kind) === String(kind)))?.title || "плейлист";

function plErr(e) {
  const m = String(e?.message || e);
  if (/^HTTP 40[13]/.test(m)) return "нет доступа — попробуй выйти и войти снова";
  if (/^HTTP 404/.test(m)) return "плейлист не найден — возможно, его удалили";
  if (/^HTTP (409|412)|revision/i.test(m)) return "плейлист изменился на другом устройстве — обнови страницу и повтори";
  if (/^HTTP 5\d\d/.test(m)) return "сервер Яндекса не ответил, попробуй ещё раз";
  return m.replace(/^HTTP \d+: /, "").slice(0, 160);
}

async function plLoadList(force = false) {
  if (PL.list && !force) return PL.list;
  return (PL.loading ||= ym("playlists")
    .then((r) => (PL.list = (Array.isArray(r) ? r : []).filter((p) => p && kindOk(p.kind) && typeof p.title === "string")))
    .finally(() => { PL.loading = null; }));
}
function plUpsert(p) {
  if (!PL.list || !p || !kindOk(p.kind)) return;
  const i = PL.list.findIndex((x) => String(x.kind) === String(p.kind));
  const meta = { kind: p.kind, title: p.title, trackCount: p.trackCount, revision: p.revision, cover: p.cover, ogImage: p.ogImage, durationMs: p.durationMs, visibility: p.visibility };
  for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
  if (i >= 0) Object.assign(PL.list[i], meta); else PL.list.unshift(meta);
}

async function plFetch(kind) {
  kind = String(kind);
  const p = await ym("playlist", { id: kind });
  const raw = Array.isArray(p.tracks) ? p.tracks : [];
  const items = raw.map((x) => ({ id: String(x.id ?? x.track?.id), albumId: x.albumId ?? albumOf(x.track) }));
  const list = raw.map((x) => x.track || null);
  const missing = list.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  for (let s = 0; s < missing.length; s += 100) {
    const part = missing.slice(s, s + 100);
    try {
      const got = await ym("tracks", { form: { "track-ids": part.map((i) => items[i].albumId ? `${items[i].id}:${items[i].albumId}` : items[i].id).join(",") } });
      const byId = new Map((got || []).map((t) => [String(t.id), t]));
      for (const i of part) list[i] = byId.get(items[i].id) || null;
    } catch {}
  }
  for (let i = 0; i < list.length; i++) {
    if (!list[i]) list[i] = { id: items[i].id, title: "Трек недоступен", artists: [], albums: items[i].albumId ? [{ id: items[i].albumId }] : [] };
    if (!items[i].albumId) items[i].albumId = albumOf(list[i]);
  }
  const full = { ...p, kind, tracks: undefined, items, list };
  PL.full.set(kind, full);
  plUpsert(full);
  return full;
}

let plChangeTail = "/change";
async function plChangeRaw(kind, revision, ops) {
  try {
    return await ym(plChangeTail === "/change" ? "playlist_change" : "playlist_change_rel", { id: kind, form: { kind, revision, diff: JSON.stringify(ops) } });
  } catch (e) {
    if (plChangeTail === "/change" && /^HTTP 404/.test(e.message)) { plChangeTail = "/change-relative"; return plChangeRaw(kind, revision, ops); }
    throw e;
  }
}
async function plChange(kind, build) {
  kind = String(kind);
  let p = PL.full.get(kind) || await plFetch(kind);
  for (let attempt = 0; ; attempt++) {
    const { ops, apply } = build(p);
    let r;
    try { r = await plChangeRaw(kind, p.revision ?? 0, ops); }
    catch (e) {
      if (attempt === 0 && /^HTTP 4(00|09|12)/.test(e.message)) { p = await plFetch(kind); continue; }
      throw e;
    }
    apply(p);
    if (r && typeof r === "object") {
      if (Number.isFinite(r.revision)) p.revision = r.revision; else p.revision = (p.revision || 0) + 1;
      for (const k of ["title", "cover", "durationMs", "ogImage"]) if (r[k] !== undefined) p[k] = r[k];
      if (Array.isArray(r.tracks) && r.tracks.map((x) => String(x.id ?? x.track?.id)).join() !== p.items.map((x) => x.id).join()) p = await plFetch(kind);
    }
    p.trackCount = p.items.length;
    plUpsert(p);
    if (curPl === kind) plRenderTracks();
    return p;
  }
}

function trackRef(t) {
  const albumId = albumOf(t);
  if (!t?.id || !albumId) throw new Error("у этого трека нет альбома — Яндекс не даёт добавить такой трек в плейлист");
  return { id: String(t.id), albumId: String(albumId) };
}
const plTrackIndex = (p, index, id) => (p.items[index]?.id === String(id) ? index : p.items.findIndex((x) => x.id === String(id)));

async function plAddTrack(kind, t, { at = null, force = false, verb = "добавлен в" } = {}) {
  kind = String(kind);
  const name = () => plName(kind);
  showToast(`«${t.title}» добавляется в «${name()}»…`, 0);
  try {
    const ref = trackRef(t);
    const cur = PL.full.get(kind) || await plFetch(kind);
    if (!force && cur.items.some((x) => x.id === ref.id)) {
      hideToast();
      const ok = await modal({ title: "Трек уже в плейлисте", text: `«${t.title}» уже есть в «${name()}». Добавить ещё раз?`, ok: "Добавить ещё раз" });
      if (!ok) { showToast(`Ничего не изменилось: «${t.title}» уже был в «${name()}»`, 4000); return false; }
    }
    let pos = 0;
    await plChange(kind, (p) => {
      pos = at == null ? p.items.length : Math.max(0, Math.min(at, p.items.length));
      return { ops: [{ op: "insert", at: pos, tracks: [ref] }], apply: (q) => { q.items.splice(pos, 0, ref); q.list.splice(pos, 0, t); } };
    });
    const here = curPl === kind;
    showToast(`«${t.title}» ${verb} «${name()}»${here ? ` · ${pos + 1}-е место` : ""}`, 5000,
      { kind: "ok", action: here ? null : { label: "Открыть", fn: () => navigate(() => showPlaylist(kind)) } });
    if (here) flashRow(pos);
    return true;
  } catch (e) {
    showToast(`Не удалось добавить «${t.title}» в «${name()}»: ${plErr(e)}`, 7000, { kind: "err" });
    return false;
  }
}

async function plRemoveTrack(kind, index, t) {
  kind = String(kind);
  let at = index;
  try {
    await plChange(kind, (p) => {
      at = plTrackIndex(p, index, t.id);
      if (at < 0) throw new Error("этого трека в плейлисте уже нет");
      return { ops: [{ op: "delete", from: at, to: at + 1 }], apply: (q) => { q.items.splice(at, 1); q.list.splice(at, 1); } };
    });
    showToast(`«${t.title}» удалён из «${plName(kind)}»`, 7000,
      { kind: "ok", action: { label: "Вернуть", fn: () => plAddTrack(kind, t, { at, force: true, verb: "возвращён в" }) } });
  } catch (e) {
    showToast(`Не удалось удалить «${t.title}» из «${plName(kind)}»: ${plErr(e)}`, 7000, { kind: "err" });
  }
}

async function plMoveTrack(kind, from, to, t) {
  kind = String(kind);
  if (from === to) return;
  try {
    let dst = to;
    await plChange(kind, (p) => {
      const i = plTrackIndex(p, from, t.id);
      if (i < 0) throw new Error("этого трека в плейлисте уже нет");
      const ref = { id: p.items[i].id, albumId: p.items[i].albumId }, tr = p.list[i];
      if (!ref.albumId) throw new Error("у трека нет альбома — Яндекс не даёт его переставить");
      dst = Math.max(0, Math.min(to, p.items.length - 1));
      return {
        ops: [{ op: "delete", from: i, to: i + 1 }, { op: "insert", at: dst, tracks: [ref] }],
        apply: (q) => { q.items.splice(i, 1); q.list.splice(i, 1); q.items.splice(dst, 0, ref); q.list.splice(dst, 0, tr); },
      };
    });
    showToast(`Порядок сохранён: «${t.title}» теперь ${dst + 1}-й`, 3500, { kind: "ok" });
    if (curPl === kind) flashRow(dst);
  } catch (e) {
    showToast(`Не удалось переставить «${t.title}»: ${plErr(e)}`, 7000, { kind: "err" });
    if (curPl === kind) plRenderTracks();
  }
}

// свой трек убрать из плейлиста: только запись о месте — файл остаётся в «Моих версиях» студии
function plLocalDrop(kind, id, t) {
  kind = String(kind);
  const at = plLocalMerge(kind, PL.full.get(kind)?.list || []).list.findIndex((x) => String(x.id) === String(id));
  plLocalRemove(kind, id);
  if (curPl === kind) plRenderTracks();
  showToast(`«${t.title}» убран из «${plName(kind)}». Файл остался в «Моих версиях»`, 6000,
    { kind: "ok", action: { label: "Вернуть", fn: () => { plLocalAdd(kind, [String(id)], Math.max(0, at)); if (curPl === kind) plRenderTracks(); } } });
}

async function plCreate(title, isPublic) {
  const r = await ym("playlist_create", { form: { title, visibility: isPublic ? "public" : "private" } });
  if (!r || !kindOk(r.kind)) throw new Error("сервер вернул неожиданный ответ");
  if (PL.list) plUpsert({ ...r, trackCount: r.trackCount || 0 });
  return r;
}
async function plCreateDialog(text = "") {
  const r = await modal({ title: "Новый плейлист", text, input: { placeholder: "Название плейлиста", max: 100 }, check: { label: "Публичный — виден другим в твоём профиле", checked: false }, ok: "Создать" });
  if (!r) return null;
  try {
    const pl = await plCreate(r.value, r.checked);
    showToast(`Плейлист «${pl.title}» создан`, 5000, { kind: "ok", action: curPl ? null : { label: "Открыть", fn: () => navigate(() => showPlaylist(pl.kind)) } });
    if (!curPl && !$("#plPage").hidden) renderPlGrid();
    return pl;
  } catch (e) { showToast("Не удалось создать плейлист: " + plErr(e), 7000, { kind: "err" }); return null; }
}
async function plRename(kind) {
  kind = String(kind);
  const old = plName(kind);
  const r = await modal({ title: "Название плейлиста", input: { value: old, placeholder: "Название плейлиста", max: 100 }, ok: "Сохранить" });
  if (!r || r.value === old) return;
  try {
    const res = await ym("playlist_rename", { id: kind, form: { value: r.value } });
    const p = PL.full.get(kind);
    const title = res?.title || r.value;
    if (p) { p.title = title; if (Number.isFinite(res?.revision)) p.revision = res.revision; }
    plUpsert({ kind, title, revision: res?.revision });
    if (curPl === kind && p) plRenderHead(p);
    showToast(`Название изменено: «${old}» → «${title}»`, 5000, { kind: "ok" });
  } catch (e) { showToast("Не удалось переименовать плейлист: " + plErr(e), 7000, { kind: "err" }); }
}
async function plDelete(kind) {
  kind = String(kind);
  const name = plName(kind);
  const ok = await modal({ title: "Удалить плейлист?", text: `«${name}» будет удалён из твоей Яндекс Музыки на всех устройствах. Треки останутся в каталоге и в лайках.`, ok: "Удалить", danger: true });
  if (!ok) return;
  try {
    await ym("playlist_delete", { id: kind });
    PL.full.delete(kind);
    plLocalForget(kind);
    if (PL.list) PL.list = PL.list.filter((p) => String(p.kind) !== kind);
    const pi = pins.findIndex((p) => p.type === "playlist" && String(p.id) === kind);
    if (pi >= 0) { pins.splice(pi, 1); savePins(); }
    try { await IDB.del(plCoverKey(kind)); } catch {}
    PL.covers.delete(kind);
    showToast(`Плейлист «${name}» удалён`, 5000, { kind: "ok" });
    likesTab = "playlists"; goTop(showLikes);
  } catch (e) { showToast("Не удалось удалить плейлист: " + plErr(e), 7000, { kind: "err" }); }
}

const plCoverKey = (kind) => `plcover:${uid}:${kind}`;
async function plLocalCover(kind) {
  kind = String(kind);
  if (PL.covers.has(kind)) return PL.covers.get(kind);
  let url = "";
  try {
    const v = await IDB.get(plCoverKey(kind));
    if (v instanceof Blob) url = URL.createObjectURL(v);
    else if (typeof v === "string") url = safeUrl(v);
  } catch {}
  PL.covers.set(kind, url);
  return url;
}
async function plSetLocalCover(kind, value) {
  kind = String(kind);
  const old = PL.covers.get(kind);
  if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
  PL.covers.set(kind, value instanceof Blob ? URL.createObjectURL(value) : value || "");
  if (value) await IDB.set(plCoverKey(kind), value); else await IDB.del(plCoverKey(kind));
}
function plYandexCover(p, size = "200x200") {
  const c = p?.cover;
  const u = (c?.type === "pic" && c.uri) || c?.itemsUri?.[0] || c?.uri || p?.ogImage;
  return u ? cover({ coverUri: u }, size) : "";
}
function plCoverEl(p, cls) {
  const box = document.createElement("span"); box.className = "plcover " + (cls || "");
  const fill = (url) => {
    box.textContent = "";
    const items = p.cover?.type === "mosaic" ? (p.cover.itemsUri || []).slice(0, 4) : [];
    if (url) box.append(mkImg(url));
    else if (items.length === 4) { box.classList.add("mosaic"); for (const u of items) box.append(mkImg(cover({ coverUri: u }, "100x100"))); }
    else { const y = plYandexCover(p); if (y) box.append(mkImg(y)); else box.insertAdjacentHTML("beforeend", '<i class="plnone">♫</i>'); }
  };
  const known = PL.covers.get(String(p.kind));
  fill(known || "");
  if (known === undefined) plLocalCover(p.kind).then((u) => { if (u) { box.classList.remove("mosaic"); fill(u); } });
  return box;
}
async function plCoverFromFile(kind, f) {
  if (!f) return;
  try {
    if (f.size > IMG_LIMITS.maxBytes) throw new Error(`файл больше ${IMG_LIMITS.maxBytes / 1048576} МБ`);
    imageGuard(new Uint8Array(await f.arrayBuffer()));
    const bm = await createImageBitmap(f).catch(() => { throw new Error("файл повреждён или это не картинка"); });
    const side = Math.min(bm.width, bm.height), out = Math.min(600, side);
    const c = document.createElement("canvas"); c.width = c.height = out;
    c.getContext("2d").drawImage(bm, (bm.width - side) / 2, (bm.height - side) / 2, side, side, 0, 0, out, out);
    bm.close();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("не удалось обработать картинку");
    await plSetLocalCover(kind, blob);
    plCoverChanged(kind, "Обложка плейлиста обновлена (видна в этом приложении)");
  } catch (e) { showToast("Не удалось поставить обложку: " + (e?.message || e), 7000, { kind: "err" }); }
}
async function plCoverFromTrack(kind, t) {
  try { await plSetLocalCover(kind, cover(t, "600x600")); plCoverChanged(kind, `Обложка плейлиста — от «${t.title}»`); }
  catch (e) { showToast("Не удалось поставить обложку: " + (e?.message || e), 7000, { kind: "err" }); }
}
async function plCoverReset(kind) {
  try { await plSetLocalCover(kind, null); plCoverChanged(kind, "Обложка Яндекса возвращена"); }
  catch (e) { showToast("Не удалось сбросить обложку: " + (e?.message || e), 7000, { kind: "err" }); }
}
function plCoverChanged(kind, msg) {
  showToast(msg, 4000, { kind: "ok" });
  const p = PL.full.get(String(kind));
  if (curPl === String(kind) && p) plRenderHead(p);
}
function plCoverMenu(btn) {
  const kind = curPl;
  openMenu(btn, () => {
    menuReset();
    menuItem(ICON.image, "Загрузить картинку…", () => { const i = $("#plCoverFile"); i.value = ""; i.click(); });
    if (PL.covers.get(kind)) menuItem(ICON.remove, "Вернуть обложку Яндекса", () => plCoverReset(kind));
    menuNote("Своя обложка видна только в этом приложении: загрузить её в Яндекс Музыку через API нельзя. Ещё можно взять обложку трека: «⋯» → «Сделать обложкой плейлиста».");
    placeMenu();
  });
}
$("#plCoverFile").onchange = (e) => { if (curPl) plCoverFromFile(curPl, e.target.files[0]); };

async function showMyPlaylists(my) {
  setHead({ title: "Мои плейлисты" });
  if (offline) return offlineNote("Офлайн-режим — плейлисты откроются, когда вернётся связь");
  $("#plCreateBtn").hidden = false;
  $("#plPage").hidden = false; $("#list").hidden = true;
  $("#status").textContent = PL.list ? "" : "Загрузка…";
  if (PL.list) renderPlGrid();
  try { await plLoadList(true); if (my === nav) renderPlGrid(); }
  catch (e) {
    if (isNetErr(e) && !PL.list && (await suspectOffline())) { if (my === nav) { $("#plCreateBtn").hidden = true; offlineNote("Офлайн-режим — плейлисты откроются, когда вернётся связь"); } return; }
    if (my === nav) $("#status").textContent = "Не удалось загрузить плейлисты: " + plErr(e);
  }
}
function renderPlGrid() {
  const g = $("#plGrid"); g.innerHTML = "";
  const list = PL.list || [];
  $("#status").textContent = list.length ? "" : "Плейлистов пока нет. Создай первый — кнопка «Создать плейлист» справа вверху.";
  for (const p of list) {
    const c = document.createElement("div");
    c.className = "simcard plcard"; c.tabIndex = 0; c.dataset.kind = String(p.kind);
    c.append(plCoverEl(p, "big"));
    const b = document.createElement("b"); b.textContent = p.title;
    const s = document.createElement("span"); s.textContent = plCount(p.trackCount) + (p.visibility === "private" ? " · личный" : "");
    c.append(b, s);
    c.onclick = () => navigate(() => showPlaylist(p.kind));
    c.onkeydown = (e) => { if (e.key === "Enter") c.click(); };
    g.append(c);
  }
}

async function showPlaylist(kind) {
  kind = String(kind);
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null); renderTabs(pinKey("playlist", kind)); resetView();
  curPl = kind;
  if (!kindOk(kind)) { $("#status").textContent = "Неверный плейлист"; return; }
  if (offline) return showPlaylistOffline(kind);
  try {
    const p = await plFetch(kind);
    if (my !== nav) return;
    plRenderHead(p);
    $("#plBar").hidden = false;
    plRenderTracks();
    plLoadRecs(kind, my);
  } catch (e) {
    if (isNetErr(e) && (await suspectOffline())) { if (my === nav) showPlaylistOffline(kind); return; }
    if (my === nav) { setHead({ title: "Плейлист", back: true }); $("#status").textContent = "Не удалось открыть плейлист: " + plErr(e); }
  }
}
// офлайн: если плейлист уже открывали в этом запуске — его скачанные треки, иначе надпись
function showPlaylistOffline(kind) {
  const p = PL.full.get(kind);
  setHead({ title: p?.title || "Плейлист", back: true });
  const list = plLocalMerge(kind, p?.list || []).list.filter((t) => t && (got.has(String(t.id)) || /^studio-/.test(String(t.id))));
  if (list.length) renderList(list);
  offlineNote(list.length ? `Офлайн-режим — скачанные треки плейлиста: ${list.length}` : "Офлайн-режим — плейлист откроется, когда вернётся связь");
}
function plRenderHead(p) {
  const local = PL.covers.get(p.kind);
  const all = plLocalMerge(p.kind, p.list).list;
  setHead({
    title: p.title, img: local || plYandexCover(p), round: false, back: true,
    pin: { type: "playlist", id: p.kind, title: p.title },
    sub: (el) => {
      const ms = all.reduce((s, t) => s + (Number.isFinite(t.durationMs) ? t.durationMs : 0), 0);
      el.textContent = [plCount(all.length), ms ? fmtHours(ms) : "", p.visibility === "private" ? "личный" : "публичный"].filter(Boolean).join(" · ");
    },
  });
  if (local === undefined) plLocalCover(p.kind).then((u) => { if (u && curPl === p.kind) { $("#headImg").src = u; $("#headImg").hidden = false; } });
}
function plRenderTracks() {
  const p = PL.full.get(curPl);
  if (!p) return;
  plRenderHead(p);
  const kind = p.kind;
  // свои треки (library/pllocal.js) — между треками Яндекса; у них в меню и перетаскивании свой номер: yIdx = -1
  const { list, yIdx } = plLocalMerge(kind, p.list);
  plMap = yIdx;
  renderList(list, false, {
    ctx: "playlist",
    menuCtx: (i) => (yIdx[i] >= 0 ? { kind, index: yIdx[i] } : { kind, local: String(list[i].id) }),
    grip: (li, i) => (yIdx[i] >= 0 ? plGrip(li, i) : plGripOff()),
  });
  $("#status").textContent = list.length ? "" : "В плейлисте пока нет треков. Добавь их из рекомендаций ниже или у любого трека: «⋯» → «Добавить в плейлист».";
  $("#plPlay").disabled = !list.length;
  if (recArr.length) { const have = new Set(p.items.map((x) => x.id)); plShowRecs(recArr.filter((t) => !have.has(String(t.id)))); }
}
function flashRow(i) {
  const d = plMap ? plMap.indexOf(i) : i;      // номер в Яндексе → строка страницы (свои треки между ними)
  const li = $("#list").children[d < 0 ? i : d];
  if (!li) return;
  li.scrollIntoView({ block: "nearest", behavior: document.documentElement.dataset.anim === "off" ? "auto" : "smooth" });
  li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
}
$("#plCreateBtn").onclick = () => plCreateDialog();
$("#plPlay").onclick = () => { if (curPl && shown.length) { wave.on = false; queue = shown; playCtx = "playlist"; playAlbum = null; play(shuffle ? Math.floor(Math.random() * shown.length) : 0); } };
$("#plRename").onclick = () => curPl && plRename(curPl);
$("#plCoverBtn").onclick = (e) => curPl && plCoverMenu(e.currentTarget);
$("#plDelete").onclick = () => curPl && plDelete(curPl);

async function plLoadRecs(kind, my) {
  $("#plRecs").hidden = false; $("#plRecNote").textContent = "Рекомендации подбираются…"; $("#plRecList").innerHTML = "";
  try {
    const r = await ym("playlist_recs", { id: kind });
    if (my !== nav) return;
    const p = PL.full.get(kind), have = new Set(p ? p.items.map((x) => x.id) : []);
    const tracks = (r?.tracks || []).filter((t) => t && t.id != null && !have.has(String(t.id)));
    recArr.length = 0;
    plShowRecs(tracks);
  } catch (e) { if (my === nav) $("#plRecNote").textContent = "Не удалось получить рекомендации: " + plErr(e); }
}
function plShowRecs(tracks) {
  const kind = curPl;
  $("#plRecNote").textContent = tracks.length ? "" : "Яндекс пока не подобрал рекомендации — добавь в плейлист ещё несколько треков и нажми «Обновить».";
  renderList(tracks, false, {
    target: $("#plRecList"), arr: recArr,
    extra: (t, li) => {
      const b = document.createElement("button");
      b.className = "recadd"; b.title = "Добавить в этот плейлист"; b.innerHTML = ICON.plus;
      b.onclick = async (e) => {
        e.stopPropagation(); b.disabled = true;
        if (await plAddTrack(kind, t)) li.classList.add("added"); else b.disabled = false;
      };
      return b;
    },
  });
}
$("#plRecsMore").onclick = () => curPl && plLoadRecs(curPl, nav);

// номера строк страницы → номера в плейлисте Яндекса (свои треки — -1); ставит plRenderTracks
let plMap = null;
// studio.js дочитал свои треки с диска — открытый плейлист перерисовать, чтобы они появились
window.plLocalRefresh = () => { if (curPl && PL.full.get(curPl) && !$("#plBar").hidden) plRenderTracks(); };
// свой трек Яндекс не переставит: вместо ручки — пустое место той же ширины
function plGripOff() {
  const g = document.createElement("span");
  g.className = "grip off"; g.title = "Свой трек: лежит на этом компьютере, порядок Яндекса его не касается";
  return g;
}
function plGrip(li, from) {
  const g = document.createElement("span");
  g.className = "grip"; g.title = "Перетащи, чтобы изменить порядок"; g.innerHTML = ICON.grip;
  g.onclick = (e) => e.stopPropagation();
  g.onpointerdown = (e) => plDragStart(e, li, from);
  return g;
}
function plDragStart(e, li, from) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  closeTrackMenu();
  const rows = [...$("#list").children], main = document.querySelector(".main");
  let slot = from, lastY = e.clientY, raf = 0, done = false;
  li.classList.add("dragging"); document.body.classList.add("pl-drag");
  const mark = () => {
    rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
    if (slot === from || slot === from + 1) return;
    if (slot < rows.length) rows[slot].classList.add("drop-before"); else rows[rows.length - 1].classList.add("drop-after");
  };
  const compute = () => {
    slot = rows.length;
    for (let k = 0; k < rows.length; k++) { const r = rows[k].getBoundingClientRect(); if (lastY < r.top + r.height / 2) { slot = k; break; } }
    mark();
  };
  const tick = () => {
    const r = main.getBoundingClientRect(), edge = 56;
    const dy = lastY < r.top + edge ? -14 : lastY > r.bottom - edge ? 14 : 0;
    if (dy) { main.scrollTop += dy; compute(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const move = (ev) => { lastY = ev.clientY; compute(); };
  const finish = (apply) => {
    if (done) return; done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    document.removeEventListener("keydown", key, true);
    rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
    li.classList.remove("dragging"); document.body.classList.remove("pl-drag");
    const to = slot > from ? slot - 1 : slot;
    // строки страницы → места в плейлисте Яндекса: свои треки между ними не считаются
    const yFrom = plMap ? plMap[from] : from;
    const yTo = plMap ? plMap.slice(0, slot).filter((v, k) => v >= 0 && k !== from).length : to;
    if (apply && to !== from && curPl && yFrom >= 0 && yTo !== yFrom) plMoveTrack(curPl, yFrom, yTo, shown[from]);
  };
  const up = () => finish(true), cancel = () => finish(false);
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(false); } };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  document.addEventListener("keydown", key, true);
}

export { plAddTrack, plRemoveTrack, plMoveTrack, plLocalDrop, plCreate, plCreateDialog, plLoadList, plFetch, plErr, plCount, plCoverEl, plCoverFromTrack,
  plLocalCover, plYandexCover, showMyPlaylists, showPlaylist };

// pllocal.js — свои треки в плейлисте Яндекса. Яндекс хранит в плейлисте только свои треки, а нарезка видео и треки
// по ссылке лежат на этом компьютере (studio.rs, «Мои версии»). Здесь запоминается, какие свои треки стоят в каком
// плейлисте и на каком месте; страница плейлиста (playlists.js) вставляет их между треками Яндекса.
// Хранится в localStorage ym_pl_local { "<uid>": { "<kind>": [{ id: "studio-…", at }] } } — попадает в резервную копию;
// на другие устройства не переносится (там нет и самих файлов, пока их не привезёт синхронизация libsync.js).
const KEY = "ym_pl_local";
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
const me = () => String(window.uid || "");
const okId = (id) => /^studio-[0-9a-f]{32}$/.test(String(id));

// свои треки плейлиста по порядку: [{ id, at }]
function plLocalGet(kind) {
  const l = read()[me()]?.[String(kind)];
  return Array.isArray(l) ? l.filter((x) => x && okId(x.id) && Number.isFinite(x.at)).sort((a, b) => a.at - b.at) : [];
}
function save(kind, list) {
  const all = read(), u = me();
  if (!u) return;
  all[u] ||= {};
  if (list.length) all[u][String(kind)] = list.map(({ id, at }) => ({ id, at })); else delete all[u][String(kind)];
  write(all);
}
// ids встают подряд с места at (по умолчанию — в конец)
function plLocalAdd(kind, ids, at = null) {
  const list = plLocalGet(kind);
  // «в конец» — большое число: место после всех треков Яндекса, сколько бы их ни добавили потом
  let pos = at ?? 1e9 + list.length;
  for (const id of ids) if (okId(id) && !list.some((x) => x.id === id)) list.push({ id, at: pos++ });
  list.sort((a, b) => a.at - b.at);
  save(kind, list);
}
function plLocalRemove(kind, id) { save(kind, plLocalGet(kind).filter((x) => x.id !== String(id))); }
function plLocalForget(kind) { save(kind, []); }

// треки Яндекса + свои → { list, yIdx }: yIdx[i] — номер в плейлисте Яндекса или -1 у своего трека.
// Свой трек, которого больше нет на диске (удалили в «Студии»), не показывается.
function plLocalMerge(kind, yList) {
  const raw = (id) => window.studioRaw?.(id) || null;
  const locals = plLocalGet(kind).map((x) => ({ ...x, t: raw(x.id) })).filter((x) => x.t);
  const list = [], yIdx = [];
  let y = 0, l = 0;
  while (y < yList.length || l < locals.length) {
    if (l < locals.length && (locals[l].at <= list.length || y >= yList.length)) { list.push(locals[l++].t); yIdx.push(-1); }
    else { list.push(yList[y]); yIdx.push(y++); }
  }
  return { list, yIdx, locals: locals.length };
}

export { plLocalAdd, plLocalForget, plLocalGet, plLocalMerge, plLocalRemove };

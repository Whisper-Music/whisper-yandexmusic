// «Студия» → «Поделиться через архив»: версия уходит в свой приватный альбом Whisper Archive, ссылка-приглашение —
// в буфер обмена; по такой ссылке (whisper://wa/… → share.js) версия открывается и играет из архива.
// Само студийное (версия → трек, остановка прослушивания) studio.js отдаёт через shareSetup — без обратного import.
import { invoke, lsJSON } from "../app/base.js";
import { showToast } from "../app/menu.js";
const W = window.Whisper;
const SHARED_KEY = "ym_studio_shared";            // id версии → { album, url }: второй раз не загружаем
const err = (e) => String(e?.message || e || "ошибка");
const toast = (t, ms, o) => showToast(t, ms, o);
let toRaw = (it) => it, stopPreview = () => {};
function shareSetup(o) { ({ toRaw, stopPreview } = o); }

// ---------- поделиться через архив ----------
// Версия загружается в свой приватный альбом (название — как у версии, обложка — от исходного трека),
// сервер выдаёт ссылку-приглашение на него. Слушать по ссылке можно в браузере и в Whisper.
const sharedAll = () => lsJSON(SHARED_KEY, {}, (v) => v && typeof v === "object" && !Array.isArray(v));
const saveShared = (v) => { try { localStorage.setItem(SHARED_KEY, JSON.stringify(v)); } catch {} };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sharing = new Set();
const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.pointerEvents = "none";
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); return ok;
  }
};
const bodyOf = (r) => { try { return r?.body ? JSON.parse(r.body) : null; } catch { return null; } };
const httpErr = (r, what) => {
  const b = bodyOf(r), m = b?.message || b?.error || b?.title;
  if (r.status === 401 || r.status === 403) return "архив не принял вход — войди заново (Настройки → Интеграции)";
  return `${what}: сервер ответил ${r.status}${m ? " — " + String(m).slice(0, 160) : ""}`;
};
async function share(it) {
  if (sharing.has(it.id)) return;
  let token = false;
  try { token = await invoke("wa_token_exists"); } catch {}
  if (!token) { toast("Чтобы делиться версиями, войди в Whisper Archive: Настройки → Интеграции", 6000); return; }
  sharing.add(it.id);
  toast("Подготовка ссылки…", 2500);
  try {
    const sh = sharedAll();
    let album = UUID.test(sh[it.id]?.album || "") ? sh[it.id].album : "";
    if (!album) {
      const raw = toRaw(it);
      const args = { fileName: it.title, albumId: null, albumTitle: it.title.slice(0, 75), coverUrl: null, coverBytes: null };
      const cu = W.cover(W.to("track", raw), 800);
      if (cu) args.coverUrl = cu;
      else args.coverBytes = await plainCover(it.title);
      const r = await invoke("studio_to_archive", { id: it.id, ...args });
      if (r.status < 200 || r.status >= 300) throw new Error(httpErr(r, "Не удалось загрузить в архив"));
      const b = bodyOf(r);
      album = String(b?.id ?? b?.albumId ?? b?.album?.id ?? "");
      if (!UUID.test(album)) throw new Error("архив не вернул номер альбома");
      sh[it.id] = { album }; saveShared(sh);
    }
    const r = await invoke("wa_album_share", { id: album });
    if (r.status === 404) { const s2 = sharedAll(); delete s2[it.id]; saveShared(s2); throw new Error("альбом этой версии в архиве удалён — нажми «Поделиться» ещё раз"); }
    if (r.status < 200 || r.status >= 300) throw new Error(httpErr(r, "Не удалось получить ссылку"));
    let url = String(bodyOf(r)?.url || "");
    if (!/^https:\/\//.test(url)) throw new Error("архив не вернул ссылку");
    // приглашение ведёт не на страницу альбома, а на выбор «слушать в приложении / на сайте» (share.html, /s/v/…)
    if (/\/invite\/[A-Za-z0-9_-]+$/.test(url)) url += "?to=version";
    const s3 = sharedAll(); s3[it.id] = { album }; saveShared(s3);      // ссылку (в ней ключ) не храним — сервер выдаст ту же
    if (await copyText(url)) toast("Ссылка на версию скопирована — отправь её другу", 4000, { kind: "ok" });
    else toast(url, 10000);
  } catch (e) { toast("Не получилось поделиться: " + err(e), 7000); }
  sharing.delete(it.id);
}
// ---------- открыть версию, которой поделились (ссылка whisper://wa/… или /s/v/… → share.js) ----------
// Ключ приглашения отдаётся архиву один раз (wa_invite_open): сервер запоминает доступ для твоего ключа (лайк альбома),
// дальше трек играет из архива как обычно (core/archive.js, waShared). Номер в плеере — «wa-<трек>»: это не трек
// Яндекса (main.js: без лайка, «Не нравится», плейлистов и скачивания).
const durSec = (v) => {
  if (typeof v === "number" && isFinite(v)) return v > 36000 ? v / 1000 : v;
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(String(v || ""));
  return m ? (+(m[1] || 0)) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]) : 0;
};
let openingShared = 0;
window.studioOpenShared = async (albumId, key) => {
  if (!UUID.test(String(albumId || "")) || !/^[A-Za-z0-9_-]{20,200}$/.test(String(key || ""))) return;
  const my = ++openingShared;
  let token = false;
  try { token = await invoke("wa_token_exists"); } catch {}
  if (!token) {
    toast("Чтобы слушать версию в приложении, войди в Whisper Archive: Настройки → Интеграции. Или открой ссылку в браузере", 8000);
    return;
  }
  toast("Открытие версии…", 2000);
  try {
    const r = await invoke("wa_invite_open", { id: albumId, key });
    if (my !== openingShared) return;
    if (r.status === 404 || r.status === 403) throw new Error("ссылка устарела или её отозвали — попроси прислать новую");
    if (r.status < 200 || r.status >= 300) throw new Error(httpErr(r, "архив не открыл версию"));
    const a = bodyOf(r) || {};
    const list = (Array.isArray(a.tracks) ? a.tracks : []).filter((x) => UUID.test(String(x?.id || "")));
    if (!list.length) throw new Error("в альбоме версии нет треков");
    const author = String(a.author || "").slice(0, 120);
    const raws = list.map((x) => ({
      id: "wa-" + String(x.id).toLowerCase(),
      title: String(x.title || a.title || "Версия").slice(0, 200),
      artists: author ? [{ name: author }] : [],
      durationMs: Math.round(durSec(x.duration) * 1000),
      waShared: String(x.id).toLowerCase(),                 // core/archive.js: играет файл архива по этому номеру
      waAlbum: albumId,
    }));
    stopPreview();
    W.queue.play(raws, 0);
    toast(author ? `«${raws[0].title}» от ${author} — играет из Whisper Archive` : `«${raws[0].title}» — играет из Whisper Archive`, 4000, { kind: "ok" });
  } catch (e) { if (my === openingShared) toast("Не удалось открыть версию: " + err(e), 7000); }
};

// обложка для альбома, если у исходного трека её нет: заливка цветами стиля с названием
async function plainCover(title) {
  const S = 600, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), cs = getComputedStyle(document.documentElement);
  const gr = g.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, cs.getPropertyValue("--accent").trim() || "#a66bff"); gr.addColorStop(1, cs.getPropertyValue("--accent2").trim() || "#e060ff");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.fillStyle = "#fff"; g.font = "600 40px system-ui, sans-serif"; g.textBaseline = "middle";
  let t = String(title || "Версия");
  while (t.length > 1 && g.measureText(t).width > S - 80) t = t.slice(0, -2).trimEnd() + "…";
  g.fillText(t, 40, S * 0.83);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : null;
}

export { share, sharing, sharedAll, saveShared, shareSetup };

// main.js — общее состояние приложения и порядок запуска. Всё остальное разнесено по модулям (index.html: блок
// <script type="module"> перед этим файлом): app/ — основа, меню, навигация, вход; player/ — плеер; pages/ — страницы;
// look/ — оформление; library/ — скачанное и свои треки; settings/ — настройки. Модули выполняются раньше и при загрузке
// только объявляют своё, поэтому всё, что нужно сделать при запуске с готовым состоянием, — здесь, внизу.
//
import { $, ICON, lsJSON } from "./base.js";
import { migrateLegacyToken, showLogin, startPage, tokenExists, warnPlainSecrets } from "./login.js";
import { syncIcons } from "./nav.js";
import { openTrackMenu, syncSpeedBadge } from "./trackmenu.js";
import { syncMax } from "./window.js";
import { loadGot } from "../library/downloads.js";
import { initBg } from "../look/bg.js";
import { applyCfg, syncControls } from "../look/config.js";
import { loDecor } from "../look/lolitta.js";
import { makeAudio, refreshPlayerBtns, restorePlayer } from "../player/core.js";
import { loadDislikedIds, loadLikedIds, setHeart, toggleDislike } from "../player/like.js";
import { updateModes } from "../player/modes.js";
import { rangeGrab, setVol } from "../player/volume.js";
window.perfMark?.("main:start");

// Общее состояние — свойства window (main.js тоже модуль, его let не видно снаружи): модули и обычные скрипты
// читают и пишут их просто по имени — queue, current, audio… Новую общую переменную заводи здесь так же.
window.uid = localStorage.getItem("ym_uid");
window.shown = [];
window.queue = [];
window.current = -1;
window.playingId = null;
window.searchTimer = null;
window.searchType = "track";
window.nav = 0;
window.view = null;
window.hist = [];
window.likes = { done: false, tracks: [] };
window.likedIds = new Set(lsJSON("ym_liked_ids", [], Array.isArray).map(String));      // последний известный список — сердечки работают и без сети
window.dislikedIds = new Set(lsJSON("ym_disliked_ids", [], Array.isArray).map(String));   // «Не нравится» — тоже запоминается
window.playCtx = "other"; window.shuffle = false; window.repeat = 0; window.order = []; window.ordPos = 0; window.orderFor = null;
{ const m = lsJSON("ym_modes", {}, (v) => typeof v === "object"); shuffle = !!m.shuffle; repeat = [0, 1, 2].includes(m.repeat) ? m.repeat : 0; }
window.LK = { ctx: "likes" };
window.got = new Set();
window.PL = { list: null, loading: null, full: new Map(), covers: new Map() };
window.curPl = null;
window.likesTab = "likes";
window.likesQuery = ""; window.likesSrc = [];     // поиск по лайкам: строка запроса и полный список, по которому ищем
window.recArr = [];
window.pins = lsJSON("ym_pins", [], Array.isArray)
  .filter((p) => p && typeof p === "object" && /^\d+$/.test(String(p.id)) && typeof p.title === "string")
  .slice(0, 50)
  .map((p) => ({ type: ["artist", "playlist"].includes(p.type) ? p.type : "album", id: p.id, title: p.title.slice(0, 200), year: Number.isFinite(p.year) ? p.year : undefined }));
window.tabsActive = false; window.pinItem = null;
window.DEFAULT_SEED = "user:onyourwave";
window.wave = { on: false, session: null, batch: null, loading: false, queue: [], pos: -1, seed: DEFAULT_SEED, name: "", album: null };
window.artistWaveItem = null;
// лайки авторов: номера — в памяти и в localStorage ym_liked_artists (кнопка на странице автора знает ответ сразу),
// сам список — у Яндекса (likes_artists), «Лайки» → «Авторы»
window.artistLikeItem = null; window.likedArtistsList = null;
window.likedArtists = new Set(lsJSON("ym_liked_artists", [], Array.isArray).map(String));
// «Не рекомендовать автора»: номера — так же в памяти и в localStorage ym_disliked_artists, список — у Яндекса
// (dislikes_artists), «Лайки» → «Не рекомендуются». Волна такого автора пропускает сама (artistBanned).
window.dislikedArtistsList = null;
window.dislikedArtists = new Set(lsJSON("ym_disliked_artists", [], Array.isArray).map(String));
window.playAlbum = null;
window.heard = new Set(lsJSON("ym_heard", [], Array.isArray).filter((x) => typeof x === "string" || typeof x === "number").slice(-600));
{ const sv = lsJSON("ym_wave_seed", null, (v) => typeof v === "object"); if (typeof sv?.seed === "string" && /^[\w-]+:[\w.-]+$/.test(sv.seed)) { wave.seed = sv.seed; wave.name = typeof sv.name === "string" ? sv.name.slice(0, 100) : ""; } }
window.savedVol = parseFloat(localStorage.getItem("ym_vol"));
window.audio = null; window.audioViz = false; window.volume = savedVol >= 0 && savedVol <= 1 ? savedVol : 0.8; window.playSeq = 0; window.curBlob = null;
window.actx = null; window.analyser = null; window.freq = null;
window.needLoad = false; window.resumePos = 0; window.lastSave = 0;
window.viz = {
  run: false, bass: 0, mid: 0, sm: new Float32Array(128), skip: false,
  last: 0, kick: 0, eAvg: 0, ePrev: 0, lastBeat: 0,            // такт: всплеск баса относительно среднего уровня
  bars: new Float32Array(64), peaks: new Float32Array(64),     // столбцы и их «шапки», которые медленно опускаются
};

// «Скачать альбом / лайки» (library/downloads.js): данные открытой страницы и идущее скачивание
window.dlCur = null;       // { key, label, tracks(): массив или null, all(): Promise<массив> }
window.bulk = null;        // { key, done, total, fail, stop }

// ---------- запуск ----------
applyCfg(); syncControls();          // оформление (look/config.js) — до первой отрисовки
initBg();                            // фон (look/bg.js)
$("#disBtn").onclick = () => toggleDislike(queue[current]);
// «⋯» в нижней панели: то же меню, что у треков в списках, для играющего трека
$("#pMore").innerHTML = ICON.more;
$("#pMore").onclick = (e) => { e.stopPropagation(); const t = queue[current]; if (t) openTrackMenu(t, e.currentTarget); };
syncSpeedBadge();
refreshPlayerBtns();
rangeGrab($("#seek")); rangeGrab($("#fSeek"));
syncMax();
loDecor();

audio = makeAudio(false);
setVol(volume);
updateModes(); setHeart($("#likeBtn"), false); setHeart($("#fLike"), false);
syncIcons();
window.perfMark?.("main:end");
(async () => {
  loadGot();
  const migMsg = await migrateLegacyToken();
  const has = await tokenExists();
  if (has === null) showLogin("Не найдены команды хранилища токена: обнови Rust-часть (auth.rs и net.rs).");
  else if (has && uid) { startPage(); restorePlayer(); loadLikedIds(); loadDislikedIds(); warnPlainSecrets(); }
  else showLogin(migMsg);
})();


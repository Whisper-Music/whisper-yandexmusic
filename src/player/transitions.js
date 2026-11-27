// Переходы между треками (Настройки → Воспроизведение → «Переходы между треками»; Rust — edges.rs).
//   «Пропускать тишину» — тишина в начале трека перематывается, а на тишине в конце сразу включается следующий;
//   «Плавные переходы» — громкость на стыке выравнивается: следующий начинается тихо — конец этого плавно
//   затихает до его уровня; начинается громко после тихого конца — следующий входит с уровня этого конца
//   и за пару секунд поднимается до своей громкости. Без наложения треков: один плеер, меняется только громкость.
//   «DJ-переход» — с наложением: за N секунд до конца звучащей части включается следующий трек (с начала его звука),
//   а этот доигрывает на отдельном плеере и затихает (window.xfTail — его забирает core.js → play()). Громкости —
//   по равной мощности (cos/sin), чтобы на стыке не было провала. В эксклюзивном режиме (свой движок, engine.js)
//   треки смешивает engine.rs (engine_dj): план перехода engine.js забирает через xfTakeNativeDj.
//   «Подбирать волну по темпу» — пока играет трек «Моей волны», из ближайших уже пришедших (до 4) следующим
//   ставится тот, чей темп отличается не больше чем на 6 % (или вдвое — половинный/двойной темп), лучше всего —
//   ещё и в соседней тональности по колесу Camelot. Подходящего нет — порядок волны не трогаем.
// Где тишина и насколько громко звучат края — audio_edges: Rust декодирует трек целиком (Яндекс — в экономном
// качестве, громкость та же). Следующий трек меряется заранее, пока играет этот.
// Громкость: main.js → outVol() умножает на window.xfK(a). Во «Слушать вместе» у гостя выключено — он идёт за ведущим.
import { invoke } from "../app/base.js";
import { outVol } from "./core.js";
import { isShared, isStudio } from "./like.js";
import { effRepeat, modesActive } from "./modes.js";
(() => {
  const KEY = "ym_xfade";
  const $x = (id) => document.getElementById(id);
  const DJ_LEN = 8;          // длина наложения по умолчанию, с
  const djLenOf = (v) => (Number.isFinite(+v) ? Math.max(2, Math.min(15, Math.round(+v))) : DJ_LEN);
  let st = (() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return { silence: !!v.silence, smooth: !!v.smooth, dj: !!v.dj, djLen: djLenOf(v.djLen), match: !!v.match }; }
    catch { return { silence: false, smooth: false, dj: false, djLen: DJ_LEN, match: false }; }
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  const DIFF = 4;          // разница громкости на стыке, дБ, меньше которой ничего не делаем
  const MAX = 12;          // сильнее не приглушаем и не поднимаем
  const FADE_OUT = 5, FADE_IN = 2.5;   // с
  const lin = (db) => Math.pow(10, db / 20);

  // ---------- замеры ----------
  const edges = new Map();       // id → замер | Promise | null (не вышло)
  function kindOf(t) {
    const id = String(t?.id ?? "");
    if (!id || t._room || isShared(id)) return null;       // чужая версия по ссылке, трек комнаты — не наш файл
    const rep = !isStudio(id) && window.studioReplacement?.(id);      // своя замена трека (studio.js) — меряем её файл
    if (rep) return { kind: "local", id: rep };
    if (isStudio(id) || got.has(id) || window.appCache?.has(id)) return { kind: "local", id };
    return /^\d+$/.test(id) ? { kind: "ym", id } : null;
  }
  function measure(t) {
    const src = kindOf(t);
    if (!src) return null;
    const v = edges.get(src.id);
    if (v !== undefined) return v instanceof Promise ? null : v;
    if (edges.size > 300) edges.delete(edges.keys().next().value);
    edges.set(src.id, invoke("audio_edges", src).then((e) => { edges.set(src.id, e); return e; }).catch(() => { edges.set(src.id, null); return null; }));
    return null;
  }

  // следующий трек — без побочных действий nextIndex() (очередь комнаты, перестройка перемешивания)
  function peekNext() {
    if (current < 0 || !queue[current]) return null;
    if (effRepeat() === 2) return null;             // повтор трека — стыка нет
    if (!modesActive()) return queue[current + 1] || null;
    if (shuffle && order.length === queue.length && order[ordPos] === current) return queue[order[ordPos + 1]] || null;
    return queue[current + 1] || (repeat === 1 ? queue[0] : null) || null;
  }
  const active = () => {
    if (!st.silence && !st.smooth && !st.dj && !st.match) return false;
    // телевизор (cast.js) — без переходов: пока он 3–6 с загружает трек, перемотку («пропустить тишину» в начале)
    // он отвергает, а то и останавливается совсем, так и не начав играть следующий
    if (audio?._cast) return false;
    const r = window.roomInfo?.();
    return !(r && !r.host);
  };

  // ---------- громкость ----------
  let k = 1, fired = "", fadeIn = null, curId = "", nextPlan = null;
  // DJ-переход: djK — вход нового трека (0 → 1); tail — доигрывающий прошлый; armed — переход запущен, ждём play()
  let djK = 1, djIn = null, tail = null, armed = null;
  // пока audio ещё нет (play() как раз создаёт новый плеер) — это и есть входящий трек: стартует с djK, а не с полной
  window.xfK = (a) => {
    if (tail && a === tail.el) return 1;
    if (!active()) return 1;
    if (!audio) return djK;
    return a === audio ? k * djK : 1;
  };
  const djOn = () => st.dj && !!audio && !audio._cast;      // телевизор (cast.js) играет один трек — наложения нет
  // эксклюзивный режим: смешивает engine.rs — план перехода забирает engine.js (xfTakeNativeDj) при загрузке нового
  let nativeDj = null;
  window.xfTakeNativeDj = () => {
    const p = nativeDj;
    nativeDj = null;
    return p && performance.now() - p.t < 8000 ? p : null;
  };
  const setK = (v) => {
    v = Math.max(lin(-MAX), Math.min(1, v));
    if (Math.abs(v - k) < 0.002) return;
    k = v;
    try { if (audio) audio.volume = outVol(audio); } catch {}
  };

  function tick() {
    if (!active() || !audio || current < 0) { if (k !== 1) setK(1); return; }
    const t = queue[current];
    if (!t) return;
    const id = String(t.id);
    if (id !== curId) onTrack();
    const e = measure(t);
    const dur = audio.duration, pos = audio.currentTime || 0;
    // DJ-переход: вход этого трека — по синусу за время наложения. До проверки замера: раньше громкость поднималась
    // только при готовом замере краёв, и если он не готов или не удался (свой файл, архив, ошибка декодера), трек
    // так и играл с громкостью 0 — полоска шла, звука не было. Без замера вход считается от начала файла.
    // (в эксклюзивном режиме громкостями обоих треков управляет engine.rs — здесь только ждём конца наложения)
    if (djIn && djIn.id === id && !audio.paused) {
      const s0 = e && typeof e === "object" ? e.start || 0 : 0;
      const p = Math.max(0, Math.min(1, (pos - s0) / djIn.len));
      if (!djIn.native) { djK = Math.sin((p * Math.PI) / 2); try { audio.volume = outVol(audio); } catch {} }
      if (p >= 1) { djIn = null; djK = 1; }
    }
    if (!e || !isFinite(dur) || !dur || audio.paused) return;
    const nx = peekNext();
    if (pos > 3 && nx) measure(nx);               // следующий меряем заранее

    // тишина в начале: перематываем (и после «повтора» трека — тоже); после DJ-перехода — всегда: следующий входит сразу звуком
    if ((st.silence || (djIn && djIn.id === id && !djIn.native)) && e.start > 0 && pos < e.start - 0.15 && !audio.seeking) { audio.currentTime = e.start; return; }
    const end = (st.silence || djOn()) && e.end < dur - 0.3 ? e.end : dur;
    waveMatch(e, id, pos, end);

    // DJ-переход: до конца звучащей части осталось время наложения — включаем следующий (тем же путём, что и конец
    // трека: обратная связь волны, повтор, очередь), а этот заберёт xfTail и доиграет сам
    if (djOn() && nx && fired !== id && !tail) {
      const len = Math.min(st.djLen, Math.max(2, (end - e.start) / 4));
      if (end - pos <= len && pos - e.start > len) {
        fired = id;
        const ne = edges.get(kindOf(nx)?.id ?? String(nx.id));
        armed = { id, len, start: ne && typeof ne === "object" ? ne.start || 0 : 0 };
        try { audio.onended?.(); } catch (err) { armed = null; console.warn(err); }
        return;
      }
    }

    // вход следующего трека после тихого конца прошлого
    if (fadeIn && fadeIn.id === id) {
      const rel = pos - (st.silence ? e.start : 0);
      setK(lin(-fadeIn.db * Math.max(0, 1 - rel / FADE_IN)));
      if (rel >= FADE_IN) fadeIn = null;
    } else if (st.smooth && nx && !djOn()) {
      // конец этого трека: следующий начинается тише — затихаем до его уровня
      const ne = edges.get(kindOf(nx)?.id ?? String(nx.id));       // своя замена — под номером её файла
      const left = end - pos;
      if (ne && typeof ne === "object" && left <= FADE_OUT + 1) {
        const diff = ne.head_db - e.tail_db;
        nextPlan = diff > DIFF ? { id: String(nx.id), db: Math.min(MAX, diff) } : null;
        if (diff < -DIFF) {
          const span = Math.min(FADE_OUT, (end - (st.silence ? e.start : 0)) * 0.2);
          setK(lin(Math.max(-MAX, diff) * Math.max(0, Math.min(1, 1 - left / span))));
        } else if (k !== 1) setK(1);
      }
    }

    // тишина в конце: сразу следующий (тем же путём, что и конец трека)
    if (st.silence && end < dur && pos >= end && fired !== id) {
      fired = id;
      try { audio.onended?.(); } catch (err) { console.warn(err); }
    }
  }
  // ---------- волна: следующий трек — по темпу и тональности (tone.rs) ----------
  const MATCH_N = 4, TEMPO_TOL = 0.06, SURE = 0.3;
  let matched = "";
  const known = (t) => {                     // замер: объект, null (нет / не вышло) или undefined (ещё меряется)
    const src = kindOf(t);
    if (!src) return null;
    const v = edges.get(src.id);
    return v instanceof Promise ? undefined : v || null;
  };
  const tempoGap = (a, b) => (a.bpm > 0 && b.bpm > 0 && a.bpm_sure >= SURE && b.bpm_sure >= SURE
    ? Math.min(...[1, 2, 0.5].map((r) => Math.abs(b.bpm * r - a.bpm) / a.bpm)) : 1);
  // соседи на колесе Camelot: та же цифра (параллельная тональность) или ±1 при той же букве
  function keyOk(a, b) {
    if (!a.camelot || !b.camelot || a.key_sure < SURE || b.key_sure < SURE) return false;
    const na = parseInt(a.camelot, 10), nb = parseInt(b.camelot, 10);
    if (a.camelot.slice(-1) !== b.camelot.slice(-1)) return na === nb;
    const d = Math.abs(na - nb);
    return d <= 1 || d === 11;
  }
  function waveMatch(e, id, pos, end) {
    if (!st.match || !wave.on || matched === id || pos < 4) return;
    const late = end - pos < (djOn() ? st.djLen : 0) + 15;     // дальше тянуть нельзя — решаем по тому, что есть
    const up = (window.Whisper?.queue?.upcoming?.(MATCH_N) || []).filter((x) => x.track);
    if (up.length < 2) { if (late) matched = id; return; }
    const ms = up.map((x) => (measure(x.track), known(x.track)));
    if (ms.includes(undefined) && !late) return;
    matched = id;
    let best = -1, bestKey = false;
    ms.forEach((m, i) => {
      if (!m || tempoGap(e, m) > TEMPO_TOL) return;
      const k = keyOk(e, m);
      if (best < 0 || (k && !bestKey)) { best = i; bestKey = k; }
    });
    if (best > 0) {
      window.Whisper.queue.move(best, 0);
      console.info(`Волна: следующим — «${up[best].track.title}» (${ms[best].bpm} BPM, ${ms[best].camelot || "?"})`);
    }
  }

  // сменился трек: громкость — как задумано для стыка (или обычная)
  function onTrack() {
    const t = queue[current];
    curId = t ? String(t.id) : "";
    fired = "";
    fadeIn = st.smooth && !djIn && nextPlan && nextPlan.id === curId ? nextPlan : null;
    nextPlan = null;
    k = 1;
    if (djIn && !djIn.id) djIn.id = curId;            // переход начался — запоминаем, какой трек входит
    else if (djIn && djIn.id !== curId) { djIn = null; djK = 1; }      // переключили дальше вручную — обычная громкость
    if (fadeIn) setK(lin(-fadeIn.db)); else try { if (audio) audio.volume = outVol(audio); } catch {}
    if (t && active()) measure(t);
  }
  window.Whisper?.on?.("track", () => { if (queue[current] && String(queue[current].id) !== curId) onTrack(); });
  setInterval(tick, 100);

  // ---------- DJ-переход: прошлый трек доигрывает на своём плеере ----------
  // core.js → play() перед загрузкой следующего трека спрашивает xfTail(audio): если переход запущен здесь (armed) —
  // плеер отдаётся сюда (обработчики снимаются: он больше не «текущий») и затихает, а play() создаёт новый.
  // Файл прошлого трека целиком (curBlob — визуализатор, архив) живёт, пока плеер доигрывает.
  window.xfTail = (el) => {
    const a = armed;
    armed = null;
    if (!a || !el || el.paused || !st.dj || el._cast) return false;
    stopTail();
    // входящий трек — уже текущий: play() сначала показывает его (showTrack → событие «track» → onTrack), а потом
    // зовёт xfTail. Пустой id здесь onTrack уже не заполнил бы — громкость нового так и оставалась 0 (полоска шла,
    // звука не было), поэтому номер берём сразу
    const inId = String(queue[current]?.id ?? "");
    for (const ev of ["onplay", "onpause", "onplaying", "onended", "ontimeupdate", "onseeked", "onerror", "onwaiting", "onstalled"]) el[ev] = null;
    if (el._native) {
      // эксклюзивный режим: прошлый доигрывает внутри движка, новый engine.js загрузит через engine_dj
      el._detach?.();
      tail = { el, native: true, blob: null, len: a.len, t0: performance.now() };
      nativeDj = { len: a.len, start: a.start, t: performance.now() };
      djIn = { id: inId, len: a.len, native: true };
      djK = 1;
      return true;
    }
    tail = { el, blob: curBlob || null, len: a.len, t0: performance.now(), base: el.volume, vol0: volume || 1 };
    curBlob = null;
    djIn = { id: inId, len: a.len };
    djK = 0;
    return true;
  };
  function stopTail() {
    const t = tail;
    if (!t) return;
    tail = null;
    try { t.el.pause(); t.el._src?.disconnect(); t.el.removeAttribute("src"); t.el.load(); } catch {}
    if (t.blob) setTimeout(() => URL.revokeObjectURL(t.blob), 1000);
  }
  setInterval(() => {
    const t = tail;
    if (!t) return;
    const p = (performance.now() - t.t0) / (t.len * 1000);
    // поставили на паузу или трек кончился раньше — хвост не нужен
    if (p >= 1 || t.el.ended || (audio && audio.paused && !transit)) return stopTail();
    if (t.native) return;
    try { t.el.volume = Math.max(0, Math.min(1, t.base * Math.cos((p * Math.PI) / 2) * (volume / t.vol0))); } catch {}
  }, 50);

  // ---------- настройки ----------
  function paint() {
    if ($x("xfSilence")) $x("xfSilence").checked = st.silence;
    if ($x("xfSmooth")) $x("xfSmooth").checked = st.smooth;
    if ($x("xfDj")) $x("xfDj").checked = st.dj;
    if ($x("xfDjLen")) $x("xfDjLen").value = st.djLen;
    if ($x("xfDjLenV")) $x("xfDjLenV").textContent = `${st.djLen} с`;
    if ($x("xfDjRow")) $x("xfDjRow").style.display = st.dj ? "" : "none";       // [hidden] у .slide перебивает её display
    if ($x("xfMatch")) $x("xfMatch").checked = st.match;
  }
  $x("xfSilence")?.addEventListener("change", (e) => { st.silence = e.target.checked; save(); if (active() && queue[current]) measure(queue[current]); });
  $x("xfSmooth")?.addEventListener("change", (e) => { st.smooth = e.target.checked; save(); if (!st.smooth) { fadeIn = nextPlan = null; setK(1); } });
  $x("xfDj")?.addEventListener("change", (e) => { st.dj = e.target.checked; save(); paint(); if (!st.dj) { armed = djIn = null; djK = 1; } });
  $x("xfMatch")?.addEventListener("change", (e) => { st.match = e.target.checked; save(); matched = ""; });
  $x("xfDjLen")?.addEventListener("input", (e) => { st.djLen = djLenOf(e.target.value); save(); paint(); });
  paint();
  window.xfState = () => ({ tail: !!tail, armed: !!armed, djIn: !!djIn, djK, matched });      // для проверок (tests/web)
  window.xfPrefs = { get: () => ({ ...st }), set: (p) => { st = { ...st, ...p }; save(); paint(); } };
})();

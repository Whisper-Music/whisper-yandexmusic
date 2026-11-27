// Вывод на телевизор (DLNA / UPnP; Rust — dlna.rs): Настройки → Звук → «Телевизор».
//
// Как и свой движок (engine.js), это «плеер» со свойствами и событиями <audio>: core.js (makeAudio) создаёт его, пока
// выбран телевизор, и дальше работает как с обычным — очередь, «Далее», перемотка, история, Discord и т. п. не знают,
// что звук идёт из телевизора. Трек задаётся источником и номером (setTrack); файл берёт Rust и сам отдаёт его
// телевизору по локальной сети, а приложение — пульт: Play / Pause / Seek и громкость.
// Состояние телевизора опрашивается раз в секунду: пауза и запуск с пульта телевизора видны и здесь; трек доиграл
// (телевизор остановился у конца) — ended, как у обычного плеера. Остановили раньше конца — это пауза.
// Громкость: меняется только ползунком громкости приложения — нормализация и переходы громкость телевизора не трогают.
import { COVER_W, invoke, lsJSON } from "../app/base.js";
import { showToast } from "../app/menu.js";
import { play } from "./core.js";
(() => {
  const KEY = "ym_cast";
  const $c = (id) => document.getElementById(id);
  let dev = null;                    // { id, name, model, volume } — подключённый телевизор
  let found = [], scanning = false, scanned = false;
  let last = lsJSON(KEY, { name: "" }, (v) => v && typeof v === "object");
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ name: dev?.name || last.name || "" })); } catch {} };

  const coverOf = (t) => (t?.coverUri ? "https://" + String(t.coverUri).replace("%%", "400x400") : null);
  // Нет обложки Яндекса (свой трек, из архива) — телевизору та же заглушка, что в приложении (assets/cover-w.svg):
  // SVG телевизоры не показывают, поэтому один раз рисуем её в JPEG 400×400; отдаёт её телевизору Rust (/c/…).
  let artP = null;
  const placeholderArt = () => (artP ||= new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 400;
        c.getContext("2d").drawImage(im, 0, 0, 400, 400);
        c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(Array.from(new Uint8Array(a))), () => res(null)) : res(null)), "image/jpeg", 0.9);
      } catch { res(null); }
    };
    im.onerror = () => res(null);
    im.src = COVER_W;
  }).then((v) => { if (!v) artP = null; return v; }));
  const artistOf = (t) => (Array.isArray(t?.artists) ? t.artists.map((a) => a?.name).filter(Boolean).join(", ") : "");

  class CastAudio extends EventTarget {
    constructor() {
      super();
      this._native = true; this._cast = true;
      this._track = null; this._meta = null; this._loaded = false; this._req = 0;
      this._pos = 0; this._at = 0; this._start = 0; this._dur = NaN; this._vol = 1; this._uv = null;
      this.paused = true; this.ended = false; this.seeking = false; this.readyState = 0; this.error = null;
      this.crossOrigin = null; this.preservesPitch = true; this.defaultPlaybackRate = 1; this.sinkId = "";
      this.onplay = this.onpause = this.onplaying = this.onended = this.ontimeupdate = this.onseeked = null;
      this._poll = null; this._tick = null; this._busy = false; this._sawPlay = false;
    }
    _emit(type) {
      try { this["on" + type]?.call(this, new Event(type)); } catch (e) { console.error(e); }
      this.dispatchEvent(new Event(type));
    }
    get src() { return this._track ? `cast:${this._track.kind}/${this._track.id}` : ""; }
    set src(v) { if (!v) this._unload(); }
    get currentSrc() { return this.src; }
    get duration() { return this._dur; }
    // между опросами позиция идёт сама — ползунок не дёргается раз в секунду
    get currentTime() {
      if (!this._loaded || this.paused || this.seeking) return this._pos;
      const t = this._pos + (performance.now() - this._at) / 1000;
      return this._dur > 0 ? Math.min(t, this._dur) : t;
    }
    set currentTime(t) {
      t = Math.max(0, Number(t) || 0);
      if (!this._loaded) { this._start = t; this._pos = t; return; }
      if (Math.abs(t - this.currentTime) < 0.5) return;
      this._pos = t; this._at = performance.now(); this.seeking = true; this.ended = false;
      this._want = t; this._seekAt = performance.now();
      // Перетаскивание ползунка (особенно пальцем) — десятки перемоток в секунду. Телевизор выполняет их по одной,
      // а пока догружает место впереди, следующие отвергает — и вперёд не перематывалось. Поэтому: пауза 200 мс
      // после последнего движения, одна команда за раз, и в конце — именно последнее место.
      clearTimeout(this._seekT);
      this._seekT = setTimeout(() => this._seekRun(), 200);
    }
    async _seekRun() {
      if (this._seekBusy) return;
      this._seekBusy = true;
      try {
        for (let tries = 0; tries < 6 && this._want !== null; tries++) {
          const t = this._want; this._want = null;
          try { await invoke("dlna_seek", { pos: t }); }
          catch (e) {
            // «Transition not available» — телевизор ещё занят прошлой перемоткой: повтор чуть позже
            console.warn("Телевизор:", e);
            if (this._want === null) this._want = t;
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      } finally {
        this._want = null; this._seekBusy = false;
        this.seeking = false; this._at = performance.now(); this._seekAt = performance.now();
        this._emit("seeked"); this._emit("timeupdate");
      }
    }
    get volume() { return this._vol; }
    // громкость телевизора — за ползунком приложения (window.volume), а не за каждым множителем громкости
    set volume(v) {
      this._vol = Math.max(0, Math.min(1, Number(v) || 0));
      const u = Math.max(0, Math.min(1, Number(window.volume) || 0));
      if (this._uv === null) { this._uv = u; return; }
      if (Math.abs(u - this._uv) < 0.005) return;
      this._uv = u;
      if (!dev?.volume) return;
      clearTimeout(this._volT);
      this._volT = setTimeout(() => invoke("dlna_volume", { v: u }).catch(() => {}), 150);
    }
    get playbackRate() { return 1; }
    set playbackRate(v) { if (Number(v) !== 1) showToast("На телевизоре скорость не меняется", 4000); }
    setSinkId() { return Promise.resolve(); }
    setTrack(tr, start = 0, durHint = 0) {
      this._unload();
      const t = queue[current];
      this._track = tr; this._start = start; this._pos = start; this.ended = false; this.error = null;
      this._dur = durHint > 0 ? durHint : NaN;
      this._meta = { title: String(t?.title || "Трек"), artist: artistOf(t), cover: coverOf(t) };
    }
    play() {
      if (!this._track) return Promise.reject(Object.assign(new Error("нет трека"), { name: "NotSupportedError" }));
      if (!this._loaded) return this._load();
      if (!this.paused) return Promise.resolve();
      this.paused = false; this._at = performance.now(); this._emit("play");
      return invoke("dlna_play").then(() => this._emit("playing"), (e) => { this.paused = true; this._emit("pause"); throw new Error(String(e)); });
    }
    pause() {
      if (this.paused) return;
      this._pos = this.currentTime;
      this.paused = true;
      if (this._loaded) invoke("dlna_pause").catch(() => {});
      this._emit("pause");
    }
    load() { if (!this._track) this._unload(); }
    removeAttribute(name) { if (name === "src") this._unload(); }
    _unload() {
      this._req++;
      clearInterval(this._poll); clearInterval(this._tick); this._poll = this._tick = null;
      this._loaded = false; this._track = null; this.paused = true; this.readyState = 0; this._sawPlay = false;
    }
    async _load() {
      const my = ++this._req, tr = this._track, m = this._meta || {};
      if (!dev) throw Object.assign(new Error("телевизор не подключён"), { name: "Error" });
      this.paused = false; this._emit("play");
      try {
        const art = m.cover ? null : await placeholderArt();
        if (my !== this._req) throw Object.assign(new Error("устарело"), { name: "AbortError" });
        await invoke("dlna_cast", {
          device: dev.id, kind: tr.kind, id: tr.id, quality: tr.quality || null,
          title: m.title || "", artist: m.artist || "", cover: m.cover || null, art,
          dur: this._dur > 0 ? this._dur : 0, start: this._start || 0,
        });
      } catch (e) {
        // «устарело» — Rust уже отдал телевизору трек новее (dlna.rs, CAST_GEN): этот запрос просто отменён
        if (my !== this._req || /^устарело/.test(String(e?.message || e))) throw Object.assign(new Error("устарело"), { name: "AbortError" });
        this.paused = true;
        const msg = String(e?.message || e);
        this.error = Object.assign(new Error(msg.replace(/^LOCAL:\s*/, "")), { name: /^LOCAL:/.test(msg) ? "NotSupportedError" : "Error" });
        if (this.error.name !== "NotSupportedError") {
          showToast(`Телевизор не включил трек: ${this.error.message}`, 9000, { kind: "err", action: { label: "Отключить", fn: () => off() } });
        }
        this._emit("pause");
        this._emit("error");
        throw this.error;
      }
      if (my !== this._req) throw Object.assign(new Error("устарело"), { name: "AbortError" });
      this._loaded = true; this.readyState = 4; this._pos = this._start || 0; this._at = performance.now();
      this._emit("loadedmetadata");
      if (this.paused) invoke("dlna_pause").catch(() => {});        // пауза нажата, пока телевизор загружал
      else this._emit("playing");
      this._tick = setInterval(() => { if (!this.paused) this._emit("timeupdate"); }, 250);
      this._poll = setInterval(() => this._status(my), 1000);
    }
    async _status(my) {
      if (this._busy || my !== this._req) return;
      this._busy = true;
      let s = null;
      try { s = await invoke("dlna_status"); } catch {}
      this._busy = false;
      if (!s || my !== this._req || this.seeking) return;
      // телевизор ещё не дошёл до нового места после перемотки — его старое место не возвращает ползунок назад
      if (performance.now() - (this._seekAt || 0) < 3000 && Math.abs(s.pos - this.currentTime) > 3) s.pos = 0;
      if (s.dur > 0) this._dur = s.dur;
      const state = s.state;
      if (state === "PLAYING") {
        this._sawPlay = true;
        if (s.pos > 0 || this._pos < 2) { this._pos = s.pos; this._at = performance.now(); }
        if (this.paused) { this.paused = false; this._emit("play"); this._emit("playing"); }     // включили с пульта
      } else if (state === "PAUSED_PLAYBACK") {
        if (s.pos > 0) this._pos = s.pos;
        if (!this.paused) { this.paused = true; this._emit("pause"); }
      } else if ((state === "STOPPED" || state === "NO_MEDIA_PRESENT") && this._sawPlay && !this.paused
        // часть телевизоров на время перемотки вперёд (догружают это место) отвечает STOPPED — это не «остановили с пульта»
        && performance.now() - (this._seekAt || 0) > 6000) {
        const at = this.currentTime;
        // остановился у конца — трек доиграл; раньше — остановили с пульта: это пауза
        if (this._dur > 0 && at >= this._dur - 4) {
          this._sawPlay = false;
          this._pos = this._dur; this.ended = true; this.paused = true;
          this._emit("pause"); this._emit("ended");
        } else {
          this._pos = at; this.paused = true; this._loaded = false;   // «Играть» загрузит трек заново с этого места
          this._start = at;
          clearInterval(this._poll); clearInterval(this._tick);
          this._emit("pause");
        }
      }
    }
  }

  window.cast = { on: () => !!dev, device: () => dev, create: () => new CastAudio() };

  // ---------- подключение ----------
  // трек переезжает с того же места; на паузе — остаётся на паузе
  function moveTrack() {
    if (current < 0 || !queue[current]) return;
    const pos = audio?.currentTime || 0, was = !!audio && !audio.paused;
    play(current, pos, true, !was);
  }
  function pick(d) {
    if (dev?.id === d.id) return;
    dev = d; save(); paint();
    showToast(`Звук идёт на «${d.name}»`, 4000, { kind: "ok" });
    moveTrack();
  }
  async function off() {
    if (!dev) return;
    const pos = audio?.currentTime || 0, was = !!audio && !audio.paused;
    dev = null; paint();
    await invoke("dlna_stop").catch(() => {});
    if (current >= 0 && queue[current]) play(current, pos, true, !was);
  }
  async function scan() {
    if (scanning) return;
    scanning = true; paint();
    try { found = await invoke("dlna_scan"); }
    catch (e) { found = []; console.warn("Поиск телевизоров:", e); }
    scanning = false; scanned = true; paint();
  }

  // ---------- карточка «Телевизор» ----------
  function paint() {
    const box = $c("castList");
    if (box) {
      box.textContent = "";
      const list = dev && !found.some((f) => f.id === dev.id) ? [dev, ...found] : found;
      for (const d of list) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "outdev"; b.setAttribute("role", "radio");
        const on = dev?.id === d.id;
        b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
        const dot = document.createElement("i"); dot.className = "odot";
        const t = document.createElement("span"); t.className = "olbl"; t.textContent = d.name;
        t.setAttribute("data-noi18n", "");
        b.append(dot, t);
        if (d.model && d.model !== d.name) { const s = document.createElement("small"); s.textContent = d.model; s.setAttribute("data-noi18n", ""); b.append(s); }
        b.onclick = () => (on ? off() : pick(d));
        box.append(b);
      }
    }
    const btn = $c("castScan");
    if (btn) { btn.disabled = scanning; btn.textContent = scanning ? "Ищу…" : "Найти телевизоры"; }
    if ($c("castOff")) $c("castOff").hidden = !dev;
    const note = $c("castNote");
    if (note) {
      note.textContent = scanning ? "Ищу телевизоры в сети…"
        : dev ? `Играет на «${dev.name}». Пауза и перемотка — здесь, звук — из телевизора.`
        : found.length ? "Выбери, куда вывести звук."
        : scanned ? "Ничего не нашлось. Телевизор включён и в той же сети? Если Windows спрашивала про доступ к сети — разреши его Whisper."
        : last.name ? `В прошлый раз — «${last.name}». Нажми «Найти», чтобы подключиться снова.` : "";
    }
    document.documentElement.classList.toggle("casting", !!dev);
  }
  $c("castScan")?.addEventListener("click", scan);
  $c("castOff")?.addEventListener("click", off);
  paint();
  window.castOff = off;
})();

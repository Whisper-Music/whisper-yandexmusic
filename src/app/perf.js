// Замеры скорости: запуск, смена трека, переходы по страницам, возврат окна из трея.
// Работает, только если приложение запущено с WHISPER_PERF=<файл> (perf.rs): иначе первый же ответ Rust — false,
// и модуль сам выключается (обёртка invoke снимается, наблюдатели отключаются).
// Строки в файле: <мс от старта процесса>\tjs\t<мс страницы>\t<что>\t<подробности>
(() => {
  // window.__TAURI__.core — пространство имён модуля (только для чтения): оборачиваем __TAURI_INTERNALS__.invoke,
  // через который идут все вызовы core.invoke
  const core = window.__TAURI_INTERNALS__;
  if (!core?.invoke || window.__WEB__) { window.perfMark = null; return; }
  const orig = core.invoke;
  const now = () => Math.round(performance.now());
  let on = null, buf = [], lastIn = 0, lastInKind = "", playAt = 0, lfN = 0, lfSum = 0;
  const put = (what, extra = "") => { if (on !== false) buf.push(`${now()}\t${what}\t${extra}`); };
  const since = () => (lastIn ? ` · от нажатия ${now() - lastIn} мс (${lastInKind})` : "");
  window.perfMark = (what, extra = "") => {
    if (on === false) return;
    if (what === "play:start") playAt = performance.now();
    if (what === "play:audible" && playAt) extra += ` · от play() ${Math.round(performance.now() - playAt)} мс${since()}`;
    put(what, extra);
  };
  // каждая команда Rust: сколько ждали ответа (для ym_read / ym_write — ещё и какая операция Яндекса)
  const wrapped = function (cmd, args, opt) {
    if (cmd === "perf_log") return orig.call(this, cmd, args, opt);
    const t0 = performance.now();
    const tag = args?.op ? `${cmd}:${args.op}` : cmd;
    const done = (ok) => { const ms = Math.round(performance.now() - t0); if (ms >= 2 || !ok) put("ipc", `${tag} ${ms} мс${ok ? "" : " ОШИБКА"}`); };
    const p = orig.call(this, cmd, args, opt);
    p.then(() => done(true), () => done(false));
    return p;
  };
  try { core.invoke = wrapped; } catch {}
  if (core.invoke !== wrapped) try { Object.defineProperty(core, "invoke", { value: wrapped, configurable: true, writable: true }); } catch {}
  // обёртку внутреннего invoke Tauri поставить не всегда выходит — тогда меряет обёртка invoke в main.js
  if (core.invoke !== wrapped) {
    const size = (r) => (typeof r === "string" ? r.length : r?.byteLength ?? 0);      // объекты не меряем — сам замер стоил бы времени
    window.perfIpc = (cmd, args, t0, r, err) => {
      const ms = Math.round(performance.now() - t0);
      if (ms >= 5 || err) put("ipc", `${args?.op ? cmd + ":" + args.op : cmd} ${ms} мс · ${Math.round(size(r) / 1024)} КБ${err ? " ОШИБКА" : ""}`);
    };
  }

  // долгие кадры (> 50 мс) — то, что «подвешивает» интерфейс; с long-animation-frame видно, чей скрипт
  let lt = null;
  const src = (s) => `${(s.sourceURL || "").split("/").pop() || "?"}${s.sourceFunctionName ? ":" + s.sourceFunctionName : ""}${s.invoker ? " [" + s.invoker + "]" : ""} ${Math.round(s.duration)}`;
  try {
    lt = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        lfN++; lfSum += e.duration;
        const sc = (e.scripts || []).filter((s) => s.duration >= 10).sort((a, b) => b.duration - a.duration).slice(0, 4).map(src).join("; ");
        const st = e.styleAndLayoutStart ? ` · стили/раскладка ${Math.round(e.startTime + e.duration - e.styleAndLayoutStart)}` : "";
        put("longframe", `${Math.round(e.duration)} мс (блок ${Math.round(e.blockingDuration || 0)})${st}${since()} · ${sc}`);
      }
    });
    lt.observe({ type: "long-animation-frame", buffered: true });
  } catch {
    try {
      lt = new PerformanceObserver((l) => { for (const e of l.getEntries()) put("longtask", `${Math.round(e.duration)} мс${since()}`); });
      lt.observe({ type: "longtask", buffered: true });
    } catch {}
  }
  let pt = null;
  try {
    pt = new PerformanceObserver((l) => { for (const e of l.getEntries()) put("paint", `${e.name} ${Math.round(e.startTime)}`); });
    pt.observe({ type: "paint", buffered: true });
  } catch {}

  // готовность частей запуска (boot.js): "bg" — фоны (main.js), "themes" — CSS своих тем (theme.js)
  const bm = window.bootMark;
  if (bm) window.bootMark = (k) => { put("boot:" + k); bm(k); };

  const input = (kind) => (e) => { if (e.isTrusted) { lastIn = performance.now(); lastInKind = kind + ":" + (e.target?.closest?.("[id]")?.id || e.target?.tagName || ""); } };
  addEventListener("pointerdown", input("click"), true);
  addEventListener("keydown", input("key"), true);

  // смена страницы: от нажатия до data-page и до первой перерисовки списка после неё
  let pageAt = 0;
  const watch = () => {
    const main = document.querySelector(".main"), list = document.querySelector("#list");
    if (main) new MutationObserver(() => {
      pageAt = performance.now();
      put("page", `${main.dataset.page || "?"}${since()}`);
      requestAnimationFrame(() => requestAnimationFrame(() => put("page:frame", `${main.dataset.page || "?"} кадр через ${Math.round(performance.now() - pageAt)} мс${since()}`)));
    }).observe(main, { attributes: true, attributeFilter: ["data-page"] });
    let lAt = 0;
    if (list) new MutationObserver(() => {
      const t = performance.now();
      if (t - lAt < 300) return;        // одна перерисовка — одна строка
      lAt = t;
      requestAnimationFrame(() => put("list", `${list.children.length} строк${since()}`));
    }).observe(list, { childList: true });
  };
  document.addEventListener("DOMContentLoaded", () => {
    const n = performance.getEntriesByType("navigation")[0];
    put("dom", n ? `responseEnd ${Math.round(n.responseEnd)} · DOMContentLoaded ${Math.round(n.domContentLoadedEventEnd)}` : "");
    watch();
  }, { once: true });
  addEventListener("load", () => {
    const n = performance.getEntriesByType("navigation")[0];
    put("load", n ? `loadEnd ${Math.round(n.loadEventEnd || performance.now())}` : "");
    const res = performance.getEntriesByType("resource");
    const sum = res.reduce((s, r) => s + (r.duration || 0), 0);
    const top = res.slice().sort((a, b) => b.duration - a.duration).slice(0, 8)
      .map((r) => `${r.name.split("/").pop()} ${Math.round(r.duration)}`).join(", ");
    put("resources", `${res.length} файлов, сумма ${Math.round(sum)} мс; дольше всех: ${top}`);
  }, { once: true });

  // окно вернули (из трея, из свёрнутого): сколько до первого кадра
  document.addEventListener("visibilitychange", () => {
    put("vis", document.visibilityState);
    if (document.visibilityState !== "visible") return;
    const t0 = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => put("vis:frame", `${Math.round(performance.now() - t0)} мс`)));
  });

  const flush = async () => {
    if (on === false) return;
    const m = performance.memory;
    if (m) put("mem", `${Math.round(m.usedJSHeapSize / 1048576)} МБ JS`);
    const text = `${now()}\tflush\t\n` + buf.join("\n");
    buf = [];
    let r = false;
    try { r = await orig.call(core, "perf_log", { text }); } catch {}
    if (on === null) {
      on = !!r;
      if (r?.css && CSS_EXP[r.css]) { expCss(CSS_EXP[r.css]); put("css", r.css); }
      if (r?.auto) setTimeout(() => loadMods().then(() => (r.auto === "2" ? quick() : r.auto === "3" ? paintExp() : r.auto === "4" ? vizExp() : r.auto === "5" ? smoke() : r.auto === "6" ? webOpen() : auto())), 6000);
    }
    if (!on) {
      // замеры не включены — убираем всё, что поставили
      try { if (core.invoke === wrapped) core.invoke = orig; } catch {}
      window.perfIpc = null; window.perfMark = null;
      lt?.disconnect(); pt?.disconnect(); clearInterval(timer); buf = [];
    }
  };
  // WHISPER_PERF_AUTO=1: сценарий сам — страницы, потом треки из «Лайков» (не волна: не шлём Яндексу отзывы о пропусках).
  // Звук на время прогона — 0, потом прежняя громкость; в конце пауза.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = (sel, label) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!el || el.hidden) { put("auto:skip", label); return false; }
    lastIn = performance.now(); lastInKind = "auto:" + label;
    el.click();
    return true;
  };
  // функции модулей: perf.js — обычный скрипт (грузится раньше всех), import ему недоступен — берём через import()
  const M = {};
  const MODS = ["app/base.js", "app/imgguard.js", "app/list.js", "app/login.js", "app/menu.js", "app/nav.js", "app/offline.js", "app/pins.js", "app/trackmenu.js", "app/window.js", "library/downloads.js", "look/bg.js", "look/colors.js", "look/config.js", "look/dynbg.js", "look/lolitta.js", "pages/artist.js", "pages/artistprefs.js", "pages/likes.js", "pages/playlists.js", "pages/stats.js", "pages/wave.js", "player/core.js", "player/full.js", "player/like.js", "player/modes.js", "player/viz.js", "player/volume.js"];
  async function loadMods() { for (const p of MODS) Object.assign(M, await import("/" + p)); }

  async function auto() {
    put("auto:begin");
    const v0 = typeof volume === "number" ? volume : null;
    try {
      for (const [sel, label, ms] of [["#likes", "лайки", 5000], ["#settingsBtn", "настройки", 3000], ["#statsBtn", "статистика", 3000],
        ["#wave", "волна", 3000], ["#likes", "лайки снова", 4000], ["#settingsBtn", "настройки снова", 3000], ["#likes", "лайки 3", 4000]]) {
        tap(sel, label); await wait(ms);
      }
      if (v0 !== null) M.setVol(0);
      const rows = document.querySelectorAll("#list li");
      tap(rows[0], "трек 1"); await wait(8000);
      for (let k = 2; k <= 6; k++) { tap("#next", "следующий " + k); await wait(8000); }
      tap("#prev", "предыдущий"); await wait(8000);
      tap(rows[Math.min(rows.length - 1, 30)], "трек из середины"); await wait(8000);
      // треки из сети: очередь из лайков, которых нет ни в скачанных, ни в кэше (первый — без загрузки заранее)
      const pool = (typeof likes !== "undefined" ? likes.tracks || [] : [])
        .filter((t) => !got.has(String(t.id)) && !window.appCache?.has(String(t.id))).slice(0, 5);
      put("auto:net", `${pool.length} треков из сети`);
      if (pool.length) {
        lastIn = performance.now(); lastInKind = "auto:сеть 1";
        window.Whisper.queue.play(pool, 0); await wait(12000);
        for (let k = 2; k <= pool.length; k++) { tap("#next", "сеть " + k); await wait(12000); }
      }
      // Опыт: что даёт долгий кадр раз в секунду, пока трек играет. По 8 с на каждый вариант CSS — сколько долгих кадров.
      if (audio?.paused) { tap(rows[1], "трек для опыта"); await wait(4000); }
      // (CSS: стекло, фон, анимации, визуализатор, contain — проверено, не влияет). Здесь — что делается по ходу трека.
      let tu = null;
      const EXP = [
        ["база (лайки)", null, null],
        ["без обновления времени", () => { tu = audio.ontimeupdate; audio.ontimeupdate = null; }, () => { audio.ontimeupdate = tu; }],
        ["страница волны", () => tap("#wave", "волна"), null],
        ["настройки", () => tap("#settingsBtn", "настройки"), null],
        ["лайки снова", () => tap("#likes", "лайки"), null],
        ["пауза", () => audio.pause(), () => audio.play()],
        ["база снова", null, null],
      ];
      for (const [name, on, off] of EXP) {
        try { on?.(); } catch {}
        await wait(2000);
        const n0 = lfN, s0 = lfSum;
        await wait(8000);
        put("exp", `${name}: ${lfN - n0} долгих кадров, всего ${Math.round(lfSum - s0)} мс за 8 с`);
        try { off?.(); } catch {}
      }
    } catch (e) { put("auto:error", String(e?.message || e)); }
    try { if (audio && !audio.paused) audio.pause(); } catch {}
    try { restoreViz?.(); } catch {}
    if (v0 !== null) M.setVol(v0);
    put("auto:done");
    flush();
  }

  // WHISPER_PERF_AUTO=2: короткий опыт — что именно в обновлении времени даёт долгий кадр раз в секунду в «Лайках»
  async function quick() {
    put("auto:begin", "короткий опыт");
    const v0 = typeof volume === "number" ? volume : null;
    try {
      tap("#likes", "лайки"); await wait(5000);
      if (v0 !== null) M.setVol(0);
      tap(document.querySelectorAll("#list li")[1], "трек"); await wait(5000);
      const orig = audio.ontimeupdate;
      const only = (text, seek) => () => {
        const a = audio;
        if (!a.duration) return;
        if (seek) { M.$("#seek").value = (a.currentTime / a.duration) * 1000; M.fill(M.$("#seek")); }
        if (text) { const tc = M.fmtTime(a.currentTime); if (M.$("#tCur").textContent !== tc) M.$("#tCur").textContent = tc; }
      };
      const EXP = [
        ["база", null, null],
        ["только текст времени", () => { audio.ontimeupdate = only(true, false); }, () => { audio.ontimeupdate = orig; }],
        ["только ползунок", () => { audio.ontimeupdate = only(false, true); }, () => { audio.ontimeupdate = orig; }],
        ["список скрыт", () => M.DynCss?.set("perfexp", "#list{display:none!important}"), () => M.DynCss?.remove("perfexp")],
        ["строки content-visibility", () => M.DynCss?.set("perfexp", ".list li{content-visibility:auto;contain-intrinsic-size:auto 56px}"), () => M.DynCss?.remove("perfexp")],
        ["плеер contain strict", () => M.DynCss?.set("perfexp", ".player{contain:strict}"), () => M.DynCss?.remove("perfexp")],
        ["время contain + плеер contain", () => M.DynCss?.set("perfexp", "#tCur,#tDur{display:inline-block;contain:strict;width:5ch;height:1.4em}.seekrow,.pcenter{contain:layout style paint}"), () => M.DynCss?.remove("perfexp")],
        ["база снова", null, null],
      ];
      for (const [name, on1, off] of EXP) {
        try { on1?.(); } catch {}
        await wait(2000);
        const n0 = lfN, s0 = lfSum;
        await wait(8000);
        put("exp", `${name}: ${lfN - n0} долгих кадров, всего ${Math.round(lfSum - s0)} мс за 8 с`);
        try { off?.(); } catch {}
      }
    } catch (e) { put("auto:error", String(e?.message || e)); }
    try { if (audio && !audio.paused) audio.pause(); } catch {}
    try { restoreViz?.(); } catch {}
    if (v0 !== null) M.setVol(v0);
    put("auto:done");
    flush();
  }

  // Опыты с CSS: WHISPER_PERF_CSS=<имя> — при запуске; в paintExp — на возврате из трея и на смене трека.
  // <link> на blob: (CSP: style-src 'self' blob:), а не adoptedStyleSheets — их перезаписывает DynCss.
  const CSS_EXP = {
    nobd: "*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
    nobg: "#bg,#dynBg,#bgVideo,#dim{display:none!important}",
    noanim: "*,*::before,*::after{animation:none!important;transition:none!important}",
    noshadow: "*,*::before,*::after{box-shadow:none!important;text-shadow:none!important;filter:none!important}",
    cv: ".list li{content-visibility:auto;contain-intrinsic-size:auto 56px}",
    contain: ".player,.side,.head,.tabs{contain:layout style paint}.list li{contain:layout style paint}",
  };
  let expLink = null;
  function expCss(css) {
    if (expLink) { URL.revokeObjectURL(expLink.href); expLink.remove(); expLink = null; }
    if (!css) return;
    expLink = document.createElement("link"); expLink.rel = "stylesheet";
    expLink.href = URL.createObjectURL(new Blob([css], { type: "text/css" }));
    document.head.append(expLink);
  }
  const rust = (cmd) => orig.call(core, "perf_log", { text: cmd }).catch(() => {});
  // WHISPER_PERF_AUTO=3: отрисовка — возврат окна из трея (сразу и через 40 с) и смена трека, с разными CSS
  async function paintExp() {
    put("auto:begin", "отрисовка");
    const v0 = typeof volume === "number" ? volume : null;
    const frameAfter = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      tap("#likes", "лайки"); await wait(5000);
      if (v0 !== null) M.setVol(0);
      const rows = document.querySelectorAll("#list li");
      tap(rows[1], "трек"); await wait(5000);
      const tray = async (name, stay, css) => {
        expCss(css || ""); await wait(1500);
        await rust("!hide"); await wait(stay);
        const n0 = lfN, s0 = lfSum, t0 = performance.now();
        await rust("!show");
        // кадр после показа: visibilitychange → два кадра
        await new Promise((r) => { if (!document.hidden) r(); else document.addEventListener("visibilitychange", r, { once: true }); });
        await frameAfter();
        const fr = Math.round(performance.now() - t0);
        await wait(3000);
        put("exp", `трей ${name}: первый кадр через ${fr} мс · долгих кадров ${lfN - n0}, всего ${Math.round(lfSum - s0)} мс`);
      };
      await tray("сразу", 3000, "");
      await tray("сразу без стекла", 3000, CSS_EXP.nobd);
      await tray("сразу без фона", 3000, CSS_EXP.nobg);
      await tray("сразу без теней и фильтров", 3000, CSS_EXP.noshadow);
      await tray("через 40 с", 40000, "");
      expCss("");
      const sw = async (name, css) => {
        expCss(css || ""); await wait(1500);
        let n = 0, s = 0, worst = 0;
        for (let k = 0; k < 3; k++) {
          const n0 = lfN, s0 = lfSum;
          tap("#next", "следующий"); await wait(1500);
          n += lfN - n0; s += lfSum - s0; worst = Math.max(worst, lfSum - s0);
          await wait(3000);
        }
        put("exp", `смена трека ${name}: долгих кадров ${n} за 3 смены, всего ${Math.round(s)} мс, худшая ${Math.round(worst)} мс`);
      };
      await sw("база", "");
      await sw("без стекла", CSS_EXP.nobd);
      await sw("строки content-visibility", CSS_EXP.cv);
      await sw("contain", CSS_EXP.contain);
      await sw("без анимаций", CSS_EXP.noanim);
      await sw("без теней и фильтров", CSS_EXP.noshadow);
      await sw("база снова", "");
      expCss("");
    } catch (e) { put("auto:error", String(e?.message || e)); }
    try { if (audio && !audio.paused) audio.pause(); } catch {}
    try { restoreViz?.(); } catch {}
    if (v0 !== null) M.setVol(v0);
    put("auto:done");
    flush();
  }

  // WHISPER_PERF_AUTO=4: сколько основного потока занимает визуализатор на «Моей волне», пока играет трек
  async function vizExp() {
    put("auto:begin", "визуализатор");
    let restoreViz = null;
    const v0 = typeof volume === "number" ? volume : null;
    try {
      let n = 0, ms = 0, worst = 0;
      if (typeof vizFrame === "function") {
        const o = vizFrame;
        // глобальная функция main.js: requestAnimationFrame(vizFrame) внутри берёт её по имени — заменяем обёрткой
        vizFrame = function (ts) { const t0 = performance.now(); try { return o(ts); } finally { const d = performance.now() - t0; n++; ms += d; if (d > worst) worst = d; } };
      }
      tap("#wave", "волна"); await wait(3000);
      if (v0 !== null) M.setVol(0);
      // визуализатор на время замера включаем без saveCfg — выбор пользователя не трогаем
      const was = { viz: cfg.viz, st: cfg.vizStyle };
      restoreViz = () => { cfg.viz = was.viz; cfg.vizStyle = was.st; M.applyViz(); };
      cfg.viz = true; M.applyViz();
      const pool = (typeof likes !== "undefined" ? likes.tracks || [] : []).filter((t) => got.has(String(t.id))).slice(0, 3);
      put("auto:viz", `визуализатор был ${was.viz ? "включён" : "выключен"}, треков с диска ${pool.length}`);
      if (pool.length) window.Whisper.queue.play(pool, 0); else M.$("#waveBtn").click();
      await wait(6000);
      for (const st of ["bars", "circle"]) {
        cfg.vizStyle = st; await wait(1000);
        const n0 = n, m0 = ms, l0 = lfN, s0 = lfSum, sec = 10; worst = 0;
        await wait(sec * 1000);
        const k = n - n0;
        put("exp", `${st}: кадров ${k} (${(k / sec).toFixed(0)}/с), в среднем ${(k ? (ms - m0) / k : 0).toFixed(2)} мс, худший ${worst.toFixed(1)} мс, всего ${Math.round(ms - m0)} мс за ${sec} с · долгих кадров ${lfN - l0}, ${Math.round(lfSum - s0)} мс · играет ${audio && !audio.paused} · audioViz ${typeof audioViz !== "undefined" ? audioViz : "?"}`);
      }
    } catch (e) { put("auto:error", String(e?.message || e)); }
    try { if (audio && !audio.paused) audio.pause(); } catch {}
    try { restoreViz?.(); } catch {}
    if (v0 !== null) M.setVol(v0);
    put("auto:done");
    flush();
  }

  // AUTO=5 — проверка после переноса кода в модули: открыть вынесенное, закрыть, выписать ошибки из журнала (errlog.js)
  // WHISPER_PERF_AUTO=6: открыть браузерную версию — адрес вкладки Rust пишет в файл WHISPER_WEB_URL (tests/web, Playwright)
  function webOpen() { put("auto:begin", "web"); document.getElementById("webBtn")?.click(); flush(); }

  async function smoke() {
    put("auto:begin", "smoke");
    const n0 = window.errLog?.count() || 0;
    const esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const checks = [
      ["выгрузки модулей", async () => { const miss = [
        "invoke", "$", "wReport", "OAUTH_URL", "MOZ_RANGE", "mozRange", "DynCss", "ICON", "svgp", "fmtTime", "hostTrusted", "safeUrl", "lsJSON", "mkImg",
        "COVER_W", "isNetErr", "ym", "fill", "setText", "fillAll", "hexRgb", "relLum", "btnHi", "onAccent", "STYLE_DEF", "STYLE_KEYS", "BUILTIN", "themeReady",
        "baseOf", "styleDef", "themeFeatures", "themeHooks", "hook", "feature", "freshCfg", "loadCfg", "bgUrls", "bgKinds", "bgPosters", "bgKey", "sty",
        "curBg", "curBgVideo", "loInk", "dynColorsOn", "applyCfg", "TH_ACTIONS", "thSync", "applyHooks", "themeFx", "themeFxSet", "applyThemeEffects",
        "saveBoot", "saveCfg", "syncControls", "manualColors", "themeColors", "syncColorReset", "applyLive", "resetStyle", "syncVizStyles", "cfg", "dynPal",
        "PROBE_MS", "setOffline", "reachable", "suspectOffline", "probeOnline", "backOnline", "offline", "resumeOnNet", "offlineShown", "tmenu",
        "closeTrackMenu", "openMenu", "menuReset", "menuAlive", "menuItem", "menuHead", "menuNote", "menuSep", "placeMenu", "toast", "showToast", "hideToast",
        "modal", "tmenuBtn", "menuFilter", "openTrackMenu", "trackMenuMain", "trackMenuBuild", "applySpeed", "setSpeed", "syncSpeedBadge", "menuSpeed",
        "clampSpeed", "fmtSpeed", "speed", "applyCustom", "openColorEditor", "CC_ITEMS", "IDB", "videoFrame", "bgNote", "setBgBlob", "syncBgVideo", "bgUnload",
        "sniffVideo", "prepareVideo", "loadBg", "clearBg", "initBg", "vizFrame", "waveOrbitsSync", "orbReset", "dynUpdate", "pickPalette", "openFull",
        "closeFull", "fillFull", "setFullMode", "fetchLyrics", "fullResume", "fullPeek", "lyricsForget", "plAddTrack", "plRemoveTrack", "plMoveTrack",
        "plCreateDialog", "plLoadList", "plFetch", "plErr", "plCount", "plCoverEl", "plCoverFromTrack", "plLocalCover", "plYandexCover", "showMyPlaylists",
        "showPlaylist", "downloading", "dlOk", "dlOne", "dlSetup", "paintDlAll", "downloadTrack", "deleteDownload", "loadGot", "syncGot", "syncGotRow",
        "trackMin", "r128Min", "backfillMeta", "loadDlDir", "showStats", "playAlbumById", "computeStats", "fmtInt", "plRu", "fmtHM", "fmtHours", "genreTitle",
        "ICONS", "statCard", "artistCache", "loadArtist", "showArtist", "showAlbum", "setHint", "showNow", "fitHead", "inRoomNow", "roomGuest", "waveHead",
        "showWave", "waveFeedback", "markHeard", "waveMore", "waveStart", "GROUPS", "stations", "loadStations", "updateStBtn", "setStations", "pickStation",
        "onQueueEnd", "waveRefresh", "showLikes", "redrawLikes", "likesOpen", "likesAdded", "likeTs", "rememberLikes", "mergeLikesAdded", "snapSave",
        "keepScrollRows", "likesStudioChanged", "withStudioLikes", "loadAllLikes", "offlineLikes", "offlineNote", "offlinePick", "tracksByIds", "artistImg",
        "normQ", "trackHay", "pageCache", "LO", "loDecor", "win", "syncMax", "winDragFrom", "setVol", "rangeGrab", "seekDrag", "modesActive", "effRepeat",
        "buildOrder", "nextIndex", "prevIndex", "saveModes", "updateModes", "setHeart", "isStudio", "isShared", "isLiked", "refreshHearts", "loadLikedIds",
        "toggleLike", "rememberDislikes", "loadDislikedIds", "saveDislikes", "toggleDislike", "setHead", "setChips", "resetView", "setActive", "roman",
        "renderTabs", "setTransit", "syncIcons", "thumbSync", "navigate", "goTop", "showSettings", "transit", "pinKey", "isPinned", "savePins", "updatePinBtn",
        "unpin", "renderRail", "pinImg", "saveLikedArtists", "loadLikedArtists", "updateArtistLikeBtn", "toggleArtistLike", "saveDislikedArtists",
        "loadDislikedArtists", "seedArtist", "artistBanned", "waveDropBanned", "toggleArtistDislike", "cover", "plural", "fmtDate", "albumTime", "albumInfo",
        "fillArtists", "albumOf", "idle", "renderList", "pumpList", "onListScroll", "listRow", "entityItem", "renderAlbums", "renderArtists", "tokenExists",
        "migrateLegacyToken", "updatePlusNotice", "refreshPlusNotice", "finishLogin", "warnPlainSecrets", "showLogin", "startPage", "afterLogin",
        "logoutYandex", "forgetAccountData", "refreshPlayerBtns", "directLink", "markPlaying", "swapCover", "showTrack", "saveLast", "togglePlay",
        "restorePlayer", "play", "stopForRetry", "offlineFallback", "ctxReady", "recoverPlayback", "outVol", "makeAudio", "vizWanted", "applyViz",
        "ensureVizAudio", "vizStart", "vizStop", "setVizFull", "vfPoke", "LOCAL_BASE", "sleepMs", "rgba", "offQueue", "curLocal", "loadAt", "curFromWa",
        "vizFullOn"].filter((k) => !(k in M) && !(k in window)); return miss.length ? "нет: " + miss.join(", ") : true; }],
      ["мои плейлисты", async () => { M.goTop(() => M.showLikes("playlists")); await wait(2500); const ok = !document.getElementById("plPage").hidden; tap("#wave", "волна"); await wait(500); return ok; }],
      ["скачанное", async () => { await M.loadGot(); M.syncGot(); M.paintDlAll(); await M.loadDlDir(); return !!document.getElementById("dlPath").textContent; }],
      ["поиск", async () => { const i = document.getElementById("search"); i.focus(); i.value = "Кино"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await wait(2500); const ok = document.querySelector(".main").dataset.page === "search" && document.querySelectorAll("#list li").length > 0; i.value = ""; i.blur(); tap("#wave", "волна"); await wait(400); return ok; }],
      ["фон", async () => { M.syncBgVideo(); const n = await new Promise((r) => { const q = M.IDB.open ? M.IDB.open() : null; Promise.resolve(q).then(() => r(true), () => r(false)); }); return n; }],
      ["статистика", async () => { M.goTop(M.showStats); await wait(3000); const ok = !document.getElementById("statsPage").hidden && (!document.getElementById("statsBody").hidden || !document.getElementById("lsBody").hidden || !!document.getElementById("stNote")?.textContent); tap("#wave", "волна"); await wait(400); return ok; }],
      ["автор", async () => { const a = queue[current]?.artists?.[0]?.id; if (!a) return "нет трека"; M.navigate(() => M.showArtist(a)); await wait(3000); const ok = document.querySelectorAll("#list li").length > 0; tap("#wave", "волна"); await wait(400); return ok; }],
      ["плеер: играть и пауза", async () => { const v = volume; M.setVol(0); const was = audio && !audio.paused; if (!was) M.togglePlay(); await wait(4000); const ok = !!audio && !audio.paused; if (!was) M.togglePlay(); await wait(300); M.setVol(v); return ok && (was || audio.paused); }],
      ["лайки", async () => { M.goTop(() => M.showLikes("likes")); await wait(3000); const ok = document.querySelectorAll("#list li").length > 0; tap("#wave", "волна"); await wait(400); return ok; }],
      ["меню трека и скорость", async () => { const t = queue[current]; if (!t) return "нет трека"; M.openTrackMenu(t, document.getElementById("pMore")); await wait(300); const n = M.tmenu.querySelectorAll("button").length; const sp = speed; M.setSpeed(1.25); const ok1 = speed === 1.25; M.setSpeed(sp); M.closeTrackMenu(); return n > 3 && ok1 && M.tmenu.hidden; }],
      ["тост и диалог", async () => { M.showToast("проверка", 800); const a = !M.toast.hidden; M.hideToast(); const p = M.modal({ title: "проверка" }); await wait(200); const has = !!document.querySelector(".modalbox"); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(200); return a && M.toast.hidden && has; }],
      ["станции", async () => { tap("#wave", "волна"); await wait(500); M.setStations(true); await wait(1500); const ok = !document.getElementById("stations").hidden; M.setStations(false); return ok; }],
      ["динамический фон", async () => { await M.dynUpdate(queue[current], true); return true; }],
      ["цвета", async () => { M.openColorEditor("btnBg"); await wait(400); const ok = !!document.querySelector(".ccmodal .ccrow"); esc(); await wait(200); return ok && !document.querySelector(".ccmodal"); }],
      ["плеер на весь экран", async () => { M.openFull(); await wait(600); const open = !document.getElementById("full").hidden; M.closeFull(); await wait(200); return open && document.getElementById("full").hidden; }],
      ["визуализатор", async () => { const was = cfg.viz; cfg.viz = true; M.applyViz(); await wait(1500); const ok = typeof window.vizFrame === "function" && (!document.getElementById("wavePage").hidden ? viz.run : true); cfg.viz = was; M.applyViz(); return ok; }],
      // консоль: обычная команда, скрытая (cli-eggs.js) и снятие «вечеринки» при выходе (cliKit.exit); историю команд возвращаем как была
      ["консоль", async () => { if (!window.cliMount || document.body.classList.contains("cli-on")) return true; const h = localStorage.getItem("ym_cli_hist");
        const cmd = async (c) => { const i = document.getElementById("cliIn"); i.value = c; i.form.requestSubmit(); await wait(150); };
        window.cliMount({}); await cmd("help"); await cmd("fortune"); await cmd("party"); const cli = document.getElementById("cli");
        const ok = !!cli.querySelector(".cl.hd") && [...cli.querySelectorAll(".cl.hl")].some((d) => d.textContent.startsWith("» ")) && cli.classList.contains("party");
        await cmd("clear"); window.cliMount(null); const off = !document.body.classList.contains("cli-on") && !cli.classList.contains("party");
        if (h === null) localStorage.removeItem("ym_cli_hist"); else localStorage.setItem("ym_cli_hist", h); return ok && off; }],
      // студия (выключена по умолчанию — проверяем модули): сводка по звуку на синтетическом треке и «Поделиться»
      ["студия: сводка и поделиться", async () => { const [inf, shr] = await Promise.all([import("/pages/studioinfo.js"), import("/pages/studioshare.js")]);
        const sr = 22050, b = new AudioBuffer({ length: sr * 4, sampleRate: sr, numberOfChannels: 1 }), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / sr) * (i % (sr / 2) < 800 ? 1 : 0.2);   // такт 120 BPM
        const r = inf.studioAnalyze(b); inf.paintInfo(null);
        return !!r && isFinite(r.rmsDb) && typeof shr.share === "function" && typeof window.studioOpenShared === "function" ? true : "сводка: " + JSON.stringify(r); }],
      // командная строка (Ctrl+K): команда консоли с выводом в окне, стиль по названию, закрытие по Esc
      ["командная строка", async () => { if (!window.openPalette) return "нет openPalette"; window.openPalette("vol"); await wait(200);
        const i = document.querySelector(".cpalinput"), key = (k) => i.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
        const cmd = document.querySelector(".cpalrow .cpaltitle")?.textContent === "vol"; key("Enter"); await wait(300);
        const out = document.querySelectorAll(".cpalout .cl").length >= 2;
        i.value = "lolitta"; i.dispatchEvent(new Event("input")); await wait(150);
        const style = [...document.querySelectorAll(".cpalrow .cpaltitle")].some((e) => /lolitta/i.test(e.textContent));
        i.value = ""; key("Escape"); await wait(100); const closed = !document.querySelector(".cpal");
        return cmd && out && style && closed ? true : JSON.stringify({ cmd, out, style, closed }); }],
      // «Что нового» (история версий) и знакомство: открыть, пройти все шаги кнопкой «Дальше», закрыться
      ["что нового и знакомство", async () => { if (!window.whatsNew || !window.welcomeOpen) return "нет whatsNew/welcomeOpen";
        window.whatsNew(); await wait(200); const vers = document.querySelectorAll(".dtwrap .wnver").length;
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await wait(150);
        document.querySelector(".dtwrap .dtx")?.click(); await wait(100);
        window.welcomeOpen(); await wait(150); const opened = !!document.querySelector(".wlc"); let n = 0;
        while (document.querySelector(".wlc") && n++ < 8) { document.querySelector(".wlcnav .nav.active")?.click(); await wait(120); }
        const ok = vers >= 5 && opened && !document.querySelector(".wlc") && !document.querySelector(".dtwrap");
        return ok ? true : JSON.stringify({ vers, opened, n }); }],
    ];
    for (const [name, fn] of window.perfSmoke ? checks.concat(window.perfSmoke) : checks) {
      let r; try { r = await fn(); } catch (e) { r = "ошибка: " + (e?.message || e); }
      put("smoke", `${name}: ${r === true ? "ok" : r === false ? "НЕ ТАК" : r}`);
    }
    // всё с начала этого запуска — и ошибки при загрузке модулей
    const fresh = (window.errLog?.list?.() || []).filter((e) => e.at >= performance.timeOrigin).map((e) => `[${e.k}] ${e.t}${e.n > 1 ? " ×" + e.n : ""}`);
    put("smoke:errors", fresh.length ? fresh.join(" ¦ ") : "нет");
    put("auto:done");
    flush();
  }

  const timer = setInterval(() => { if (buf.length || on === null) flush(); }, 2000);
  setTimeout(flush, 300);
  addEventListener("pagehide", flush);
  window.perfFlush = flush;
})();

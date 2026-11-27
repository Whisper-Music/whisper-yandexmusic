// Телефон (Android; iOS — позже). Подключён без defer, сразу после boot.js: класс html.mobile должен стоять
// до первой отрисовки (раскладку под телефон делает mobile.css), а подмена invoke — до main.js.
// На компьютере файл ничего не делает. Признак для остального кода — window.isMobile.
// Здесь — только то, что нужно ДО main.js и en.js (признак, invoke, отступы, «Назад», словарь «как на компьютере»);
// остальное для телефона — ES-модули mobile/*.js, их запускает mobile/start.js (window.mobileStart).
(() => {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") && !window.__WEB__;
  window.isMobile = mobile;
  if (!mobile) return;
  const root = document.documentElement;
  root.classList.add("mobile");

  // Команд только для компьютера (трей, кнопки окна, WASAPI, мини-плеер…) в мобильной сборке нет (lib.rs, cfg(desktop)).
  // Тех, что страница зовёт сама при запуске и не ждёт ответа, — тихо «выполняем» здесь, чтобы не сыпались ошибки.
  // Остальные отвечают ошибкой, как и раньше, — их кнопки на телефоне спрятаны (mobile.css).
  const QUIET = {
    app_ready: null, engine_available: false, win_is_max: false, web_active: false,
    tray_playing: null, tray_lang: null, tray_icon: null, tray_mode: null, thumbbar_state: null,
    mini_state: null, obs_state: null, obs_theme: null, discord_update: null, hotkeys_set: null,
    audio_devices_unlock: null, audio_endpoints: [], system_fonts: [],
  };
  // Свойства window.__TAURI__.core — только для чтения (геттеры), поэтому подменяем сам объект __TAURI__ копией,
  // в которой core.invoke — наш. Не вышло (объект закрыт) — ничего страшного: те команды просто ответят ошибкой.
  try {
    const T = window.__TAURI__;
    const real = T?.core?.invoke;
    if (real) {
      const invoke = (cmd, args, opts) => (cmd in QUIET ? Promise.resolve(QUIET[cmd]) : real(cmd, args, opts));
      window.__TAURI__ = { ...T, core: { ...T.core, invoke } };
    }
  } catch {}

  // Отступы от строки состояния и полоски жестов. Приложение рисуется под ними (edge-to-edge), а старые WebView
  // в env(safe-area-inset-*) отдают 0 — размеры сообщает сама Android-часть (MainActivity.kt): "top,right,bottom,left"
  // в CSS-пикселях. Нет её (другая сборка) — запас под обычную строку состояния.
  const insets = (s) => {
    const [t, r, b, l] = String(s || "").split(",").map((n) => Math.max(0, Math.min(200, +n || 0)));
    root.style.setProperty("--sys-top", t + "px");
    root.style.setProperty("--sys-right", r + "px");
    root.style.setProperty("--sys-bottom", b + "px");
    root.style.setProperty("--sys-left", l + "px");
  };
  window.whisperInsets = insets;
  const askInsets = () => { try { if (window.WhisperAndroid) insets(window.WhisperAndroid.insets()); } catch {} };
  if (window.WhisperAndroid) askInsets(); else insets("24,0,0,0");
  window.addEventListener("resize", askInsets);
  // всё остальное для телефона — mobile/start.js (window.mobileStart): слушатель ставим здесь, раньше всех, чтобы
  // порядок был прежним — раньше обработчиков DOMContentLoaded у i18n.js, layout.js и стартовой страницы (login.js)
  document.addEventListener("DOMContentLoaded", () => { askInsets(); window.mobileStart?.(); });

  // Кнопка «Назад» телефона: Android-часть (MainActivity.kt) спрашивает window.whisperBack(). Своей истории
  // у страницы нет (navigate() в main.js ведёт свою): закрываем то, что открыто поверх (как Esc), или идём на
  // предыдущую страницу приложения (#back) — "true"; ничего такого нет — "bg", приложение уходит в фон
  // (музыка играет дальше, а не закрывается вместе с ним).
  const opened = () =>
    document.querySelector("#full:not([hidden]), #vizFull:not([hidden]), .tmenu:not([hidden]), .modal:not(.hidden), .login.modal:not(.hidden)");
  window.mobileOpened = opened;          // mobile/sections.js (свайпы) — то же «что открыто поверх»
  window.whisperBack = () => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) { a.blur(); return true; }
    if (opened()) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
    const back = document.getElementById("back");
    if (back && !back.hidden) { back.click(); return true; }
    // настройки открываются из профиля — «Назад» возвращает в профиль
    if (document.querySelector(".main")?.dataset.page === "settingsBtn" && window.mobileProfile) { window.mobileProfile(); return true; }
    return "bg";
  };

  // ---------- надписи «как на компьютере» ----------
  // Код и разметка общие с компьютером: «удалить с диска», «правый щелчок», «Ctrl+Shift+M». На телефоне
  // такие куски подменяются на лету (текст и подсказки), и в русском, и в английском словаре — так что и
  // i18n.js, переводя уже подменённую строку, находит перевод. Порядок важен: сначала длинные куски.
  // i18n-off — правила замены слов: русские подстановки видны только в русском интерфейсе
  const RU = [
    [/ ?\((?:или )?(?:Esc|Ctrl\+[^)]*|Alt\+[^)]*)\)/g, ""],
    [/Ctrl\+Shift\+M или д(войной щелчок)/g, "Д$1"],
    [/\. Esc — закончить/g, ""],
    [/Esc — выйти · Пробел — пауза/g, "«Назад» — выйти"],
    [/Esc или щелчок — закрыть/g, "Нажми, чтобы закрыть"],
    [/Ctrl\+Shift\+Backspace вернёт/g, "зажми экран тремя пальцами на 2 секунды — вернётся"],
    [/— Ctrl\+Shift\+Backspace/g, "— зажми экран тремя пальцами на 2 секунды"],
    [/Тяни границы мышью; колесо — точнее \(с Shift — по секунде\)/g, "Тяни границы пальцем"],
    [/Перетащи файл сюда или выбери/g, "Нажми, чтобы выбрать файл"],
    [/ — или перетащи файл ниже/g, " — или выбери файл ниже"],
    [/ или перетащи (?:файл \/ папку Wallpaper Engine|сюда всю папку обоев|сам файл \(не ссылку и не текст\))/g, ""],
    [/Щелчок или любая клавиша пропускают/g, "Нажатие пропускает"],
    [/щелчок или клавиша пропускают/g, "нажатие пропускает"],
    [/Правый щелчок/g, "Долгое нажатие"], [/правым щелчком/g, "долгим нажатием"], [/по правому щелчку/g, "по долгому нажатию"],
    [/Двойной щелчок/g, "Двойное нажатие"], [/двойной щелчок/g, "двойное нажатие"],
    [/Щелчок/g, "Нажатие"], [/щелчок/g, "нажатие"], [/Щёлкни/g, "Нажми"],
    [/при наведении/g, "при касании"], [/При наведении/g, "При касании"],
    [/(?:этом|другом) компьютере/g, (m) => (m.startsWith("эт") ? "этом телефоне" : "другом устройстве")],
    // \b в JS не видит границу у кириллицы — поэтому «дальше не буква»
    [/компьютер(е|а|ом|у)?(?![а-яё])/g, "телефон$1"],
    [/Обновить и перезапустить/g, "Скачать и установить"],
    [/с диска/g, "с телефона"], [/на диске/g, "на телефоне"], [/на диск(?![а-яё])/g, "на телефон"],
  ];
  const EN = [
    [/ ?\((?:or )?(?:Esc|Ctrl\+[^)]*|Alt\+[^)]*)\)/g, ""],
    [/Ctrl\+Shift\+M or d(ouble-click)/g, "D$1"],
    [/\. Esc - finish/g, ""],
    [/Ctrl\+Shift\+Backspace/g, "hold three fingers on the screen for 2 seconds"],
    [/(?:a click|A click) or (?:any )?key skips/g, (m) => (m[0] === "A" ? "A tap skips" : "a tap skips")],
    [/Right-click(ing)?/g, (m, g) => (g ? "Long-pressing" : "Long-press")], [/right-click/g, "long-press"],
    [/Double-click/g, "Double-tap"], [/double-click/g, "double-tap"],
    [/\bClick(ing)?\b/g, (m, g) => (g ? "Tapping" : "Tap")], [/\bclick(ing)?\b/g, (m, g) => (g ? "tapping" : "tap")],
    [/on hover/gi, (m) => (m[0] === "O" ? "On touch" : "on touch")],
    [/(?:this|your) computer/g, "this phone"], [/(?:another|other) computers?/g, (m) => (m.endsWith("s") ? "other devices" : "another device")],
    [/disk space/g, "storage space"], [/from disk/g, "from the phone"], [/on disk/g, "on the phone"],
  ];
  const fix = (rules, s) => rules.reduce((a, [re, to]) => a.replace(re, to), s);
  const fixRu = (s) => fix(RU, s), fixEn = (s) => fix(EN, s);
  // i18n-on
  window.mobileText = fixRu;
  // словарь en.js ещё не загружен (mobile.js — раньше него): ловим каждую запись, подменяем английский текст
  // и кладём перевод и под «телефонную» русскую строку
  {
    const wrap = (v) => (typeof v === "string" ? fixEn(v) : typeof v === "function" ? (...a) => { const r = v(...a); return typeof r === "string" ? fixEn(r) : r; } : v);
    const d = {};
    window.I18N_EN = new Proxy(d, {
      set(t, k, v) {
        const w = wrap(v);
        t[k] = w;
        if (typeof k === "string") { const m = fixRu(k); if (m !== k && !(m in t)) t[m] = w; }
        return true;
      },
    });
  }
  // страница: текст и подсказки (кроме названий треков, текста песни и полей ввода — как у i18n.js)
})();

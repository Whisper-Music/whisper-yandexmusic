// Запуск без «мигания» стилей.
// Стиль собирается по частям: встроенная основа (чаще всего «Неон»), потом фон из IndexedDB, потом CSS своей темы
// из .wmt (тоже из IndexedDB). На медленном компьютере было видно, как интерфейс сначала рисуется «Неоном»
// и перекрашивается. Поэтому:
// * этот файл подключён в <head> без defer — работает до первой отрисовки: ставит на <html> стиль прошлого запуска
//   и прячет интерфейс (класс booting) под цветом фона этой темы (снимок ym_boot сохраняет main.js — saveBoot);
// * main.js и theme.js отмечают готовность (bootMark): фон загружен, свои темы подключены;
// * само окно показывается сразу (app_ready с цветом шторки) — пока под шторкой собирается стиль;
// * когда всё готово — шторка уходит и проявляется интерфейс.
// Что-то сломалось или очень долго — через 4 с интерфейс показывается в любом случае (а окно — через 5 с, Rust).
(() => {
  const root = document.documentElement;
  root.classList.add("booting");
  let bootBg = "#0b0618";           // = цвет шторки по умолчанию (styles.css, html.booting)
  try {
    const b = JSON.parse(localStorage.getItem("ym_boot") || "null");
    if (b && typeof b === "object") {
      if (typeof b.style === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(b.style)) root.dataset.style = b.style;
      if (typeof b.base === "string" && /^[a-z]{1,16}$/.test(b.base)) root.dataset.base = b.base;
      // только цвет: #rgb / #rrggbb(aa) или rgb()/rgba() из getComputedStyle
      const color = (v) => typeof v === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim());
      if (color(b.bg)) { root.style.setProperty("--boot-bg", b.bg.trim()); bootBg = b.bg.trim(); }
      if (color(b.accent)) root.style.setProperty("--boot-accent", b.accent.trim());      // цвет индикатора загрузки
    }
  } catch {}
  // Окно — на экран сразу, шторкой в цвете стиля (Rust ставит этот цвет фоном движка до первой отрисовки).
  // Скрытое окно WebView2 не готовит к показу: раньше после показа ещё ~0,7 с не было ни кадра. Теперь эта подготовка
  // идёт, пока грузятся скрипты и стиль, а интерфейс под шторкой проявляется, когда всё готово (finish ниже).
  try { window.__TAURI__?.core?.invoke("app_ready", { bg: bootBg }); } catch {}

  const need = new Set(["bg", "themes"]);
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    // шрифты темы (из .wmt) ещё догружаются — подождать их, но не дольше 0,6 с.
    // Без requestAnimationFrame: окно могло не показаться (первый вызов app_ready не прошёл), а у скрытого окна
    // кадров нет — колбэк не пришёл бы. Второй app_ready ниже — на этот случай (уже показанное окно он не трогает).
    const fonts = document.fonts?.ready || Promise.resolve();
    Promise.race([fonts, new Promise((r) => setTimeout(r, 600))]).then(() => {
      root.classList.remove("booting");
      window.perfMark?.("boot:ready", [...need].join(",") || "всё готово");
      try { window.__TAURI__?.core?.invoke("app_ready"); } catch {}
      try { window.saveBoot?.(); } catch {}
    });
  }
  // main.js: "bg" — фоны стилей загружены (initBg); theme.js: "themes" — CSS своих тем подключены
  window.bootMark = (k) => { need.delete(k); if (!need.size) finish(); };
  setTimeout(finish, 4000);
})();

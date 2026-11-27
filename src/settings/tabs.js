// Вкладки настроек (Оформление / Интерфейс / Воспроизведение / Звук / Приложение / Интеграции / Данные).
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце.
const $ = (s) => document.querySelector(s);

// ---------- вкладки настроек: Оформление / Интерфейс / Воспроизведение / Звук / Приложение / Интеграции ----------
// Карточки остаются прямыми детьми .settings (на это опираются стили и темы); видна вкладка из data-tab.
// Два столбца: карточки вкладки идут в порядке разметки, первая карточка правого столбца помечена .colbreak.
// Карточка без data-tab (её добавил другой модуль) попадает в «Интеграции».
(() => {
  const page = $("#settingsPage"), TABS = ["look", "ui", "play", "out", "app", "int", "data"];
  const OLD = { player: "play", services: "int" };      // вкладки до перестановки
  let tab = "look";
  try { let v = localStorage.getItem("ym_set_tab"); v = OLD[v] || v; if (TABS.includes(v)) tab = v; } catch {}
  function setTab(t) {
    tab = t; page.dataset.tab = t;
    for (const c of page.children) if (c.classList.contains("card") && !c.dataset.tab) c.dataset.tab = "int";
    document.querySelectorAll("#setTabs .chip").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    try { localStorage.setItem("ym_set_tab", t); } catch {}
  }
  document.querySelectorAll("#setTabs .chip").forEach((b) => { b.onclick = () => { setTab(b.dataset.tab); document.querySelector(".main").scrollTop = 0; }; });
  new MutationObserver(() => setTab(tab)).observe(page, { childList: true });
  setTab(tab);
})();

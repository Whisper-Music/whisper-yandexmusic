// Телефон: запуск всего мобильного — по порядку, как раньше в mobile.js. На компьютере не делает ничего.
import { mobileWords, styleRescue } from "./words.js";
import { navBar, profilePage, rowTap, swipes, toastSpot, wavePage } from "./sections.js";
import { backToFull, fullActions, fullModes, playerSwipes, seekBar, stallGuard, waveHere } from "./player.js";
import { autoDl, incoming, oldWebView } from "./extras.js";
// зовёт mobile/mobile.js по DOMContentLoaded (его слушатель — первый, как и раньше)
if (window.isMobile) window.mobileStart = () => {
  // плеер внизу маленький: по названию трека, как и по обложке, открывается плеер на весь экран
  document.querySelector(".player .meta")?.addEventListener("click", () => document.getElementById("cover")?.click());
  // окно входа: на телефоне страница Яндекса открывается прямо здесь, а не в отдельном окне
  const p = document.querySelector("#login .login-box > p");
  if (p) p.textContent = "Нажми кнопку и войди в аккаунт Яндекса. После входа приложение откроется само, копировать ничего не нужно.";
  // карточки Discord и OBS модули ядра вставляют сами и позже; :has() в CSS старые WebView не понимают —
  // прячем по выключателю внутри
  const settings = document.querySelector(".settings");
  const hideDesk = () => ["dcOn", "obsOn"].forEach((id) => document.getElementById(id)?.closest(".card")?.classList.add("m-hide"));
  hideDesk();
  if (settings) new MutationObserver(hideDesk).observe(settings, { childList: true });
  oldWebView();
  // настройки: вкладки всегда сверху; «Приложения» на телефоне нет — была открыта она, переходим на первую
  const sp = document.getElementById("settingsPage");
  if (sp) sp.dataset.tabs = "top";
  // «Обновления» живут во вкладке «Приложение», которой на телефоне нет, — переносим в «Данные»
  const upd = document.getElementById("updCard");
  if (upd) { upd.dataset.tab = "data"; upd.classList.remove("colbreak"); }
  const appTab = document.querySelector('#setTabs .chip[data-tab="app"]');
  if (appTab?.classList.contains("active")) document.querySelector("#setTabs .chip:not([data-tab=\"app\"])")?.click();
  navBar();
  profilePage();
  wavePage();
  fullActions();
  swipes();
  playerSwipes();
  waveHere();
  incoming();                             // приложение открыли файлом темы (из Telegram и т. п.)
  rowTap();
  fullModes();
  stallGuard();
  autoDl();
  toastSpot();
  backToFull();
  seekBar();
  styleRescue();
  mobileWords();
  // «Моя волна по артисту» — на странице автора короткой кнопкой со значком (mobile.css), подпись покороче
  const aw = document.getElementById("artistWaveBtn");
  if (aw) { aw.textContent = "Моя волна"; aw.title = "Моя волна по артисту"; }
  // режим сна: выключить телефон приложение не может — по истечении времени только останавливаем музыку
  // (строку выбора прячем, по умолчанию там «Выключить компьютер»)
  const slAct = document.getElementById("slAct");
  if (slAct) {
    const r = slAct.closest(".lyrow") || slAct; r.style.display = "none";
    if (slAct.querySelector('.chip.active[data-v="off"]')) slAct.querySelector('.chip[data-v="stop"]')?.click();
  }
};

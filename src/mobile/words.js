// Телефон: надписи «как на компьютере» на экране (щелчок → нажатие, диск → телефон…) и аварийный выход из стиля.
// Правила замены и словарь живут в mobile/mobile.js (window.mobileText) — он грузится раньше en.js.
const fixRu = (s) => window.mobileText(s);

function mobileWords() {
  const SKIP = "script, style, textarea, input, [contenteditable], [data-noi18n], #cli, .list li .t, .list li .a, .tartists, #fLyrics, .qpanel li .t, .qpanel li .a";
  const ATTRS = ["title", "placeholder", "aria-label"];
  const HIT = /диск|компьютер|щелч|Щелч|Щёлкни|Ctrl\+|Alt\+|Esc|наведени|перетащи|мышью|перезапустить/i;
  const doText = (n) => { const s = n.data; if (HIT.test(s) && !n.parentElement?.closest(SKIP)) { const v = fixRu(s); if (v !== s) n.data = v; } };
  const doAttr = (el, a) => { const s = el.getAttribute(a); if (s && HIT.test(s)) { const v = fixRu(s); if (v !== s) el.setAttribute(a, v); } };
  const walk = (root) => {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || root.matches(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) doText(n);
      else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
    }
  };
  walk(document.body);
  new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === "childList") r.addedNodes.forEach(walk);
      else if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") doAttr(r.target, r.attributeName);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// ---------- аварийный выход из сломанного стиля ----------
// На компьютере — Ctrl+Shift+Backspace (theme.js). Здесь клавиатуры нет: три пальца на экране 2 секунды
// отправляют то же сочетание.
function styleRescue() {
  let t = 0;
  const stop = () => { clearTimeout(t); t = 0; };
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 3) return stop();
    stop();
    t = setTimeout(() => {
      t = 0;
      navigator.vibrate?.(40);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, shiftKey: true, bubbles: true }));
    }, 2000);
  }, { passive: true, capture: true });
  for (const ev of ["touchend", "touchcancel"]) document.addEventListener(ev, (e) => { if (e.touches.length < 3) stop(); }, { passive: true, capture: true });
}

export { mobileWords, styleRescue };

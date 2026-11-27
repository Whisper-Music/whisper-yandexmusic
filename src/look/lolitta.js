// Украшения стиля Lolitta: банты, жемчуг, розы (.lodeco) — SVG-заготовки и расстановка.
// ES-модуль, подключён перед app/main.js (блок модулей в index.html). При загрузке только объявляет своё и вешает обработчики
// (свой $); переменные main.js — по имени внутри функций. Наружу — через window в конце. Первый loDecor() зовёт main.js.
const $ = (s) => document.querySelector(s);

const LO = (() => {
  const P = (cx, cy, r) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="url(#loP)"/>`;
  const bow = `<svg viewBox="0 0 100 86"><g fill="url(#loG)" stroke="var(--l-lo)" stroke-width="1" stroke-linejoin="round">
    <path d="M47 43C44 56 36 68 24 82L33.5 79L38 86C45 71 50 57 52.5 44Z"/><path d="M53 43C56 56 64 68 76 82L66.5 79L62 86C55 71 50 57 47.5 44Z"/>
    <path d="M50 37C42 22 22 6 8 12C-2 18 3 38 18 45C29 49 41 45 50 41Z"/><path d="M50 37C58 22 78 6 92 12C102 18 97 38 82 45C71 49 59 45 50 41Z"/></g>
    <g fill="var(--l-lo)" opacity=".5"><path d="M50 39C38 30 22 23 13 26C20 34 35 41 50 41Z"/><path d="M50 39C62 30 78 23 87 26C80 34 65 41 50 41Z"/><path d="M48 46C46 58 40 68 32 78L36 77C42 68 47 58 49.5 47Z"/><path d="M52 46C54 58 60 68 68 78L64 77C58 68 53 58 50.5 47Z"/></g>
    <g fill="none" stroke="var(--l-hi)" stroke-width="1.7" stroke-linecap="round" opacity=".95"><path d="M43 29C34 19 20 11 11 16"/><path d="M57 29C66 19 80 11 89 16"/></g>
    <rect x="42.5" y="31" width="15" height="15.5" rx="5" fill="url(#loG)" stroke="var(--l-lo)"/>
    <path d="M46 35Q50 33 54 35" fill="none" stroke="var(--l-hi)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const rose = `<svg viewBox="0 0 60 60"><g fill="var(--l-lo)" stroke="var(--l-deep)" stroke-width=".5" stroke-opacity=".5"><path d="M30 31C40 33 51 40 58 53C45 52 35 45 30 31Z"/><path d="M30 31C20 35 10 43 3 56C16 53 26 45 30 31Z"/></g>
    <g fill="none" stroke="var(--l-hi)" stroke-width=".8" opacity=".7"><path d="M34 35C42 40 49 45 54 51"/><path d="M26 36C18 41 12 47 7 53"/></g>
    <circle cx="30" cy="29" r="18" fill="url(#loR)" stroke="var(--l-lo)" stroke-width=".9"/>
    <g fill="none" stroke="var(--l-lo)" stroke-width="1.3" stroke-linecap="round"><path d="M13 31C12 19 23 11 33 12C25 15 19 21 19 29"/><path d="M47 27C48 39 38 47 27 46C35 43 41 37 41 29"/><path d="M24 44C17 42 13 36 13 31"/><path d="M36 13C42 15 47 20 47 27"/><path d="M23 29a7 7 0 1 1 7 7a5 5 0 1 1 -5 -5a3 3 0 1 1 3 3"/></g>
    <g fill="none" stroke="var(--l-hi)" stroke-width="1.1" stroke-linecap="round" opacity=".85"><path d="M16 26C18 18 25 14 31 14"/><path d="M44 32C42 40 36 44 29 44"/></g></svg>`;
  const corner = `<svg viewBox="0 0 64 64"><g fill="none" stroke="url(#loG)" stroke-width="1.9" stroke-linecap="round">
    <path d="M5 60C5 28 28 5 60 5"/><path d="M5 45C5 29 12 17 22 12C29 9 34 14 31 18.5C29 21.5 24.5 20.5 24.5 17"/><path d="M45 5C29 5 17 12 12 22C9 29 14 34 18.5 31C21.5 29 20.5 24.5 17 24.5"/></g>
    <path d="M23 23C30 20 37 25 35 33C28 35 22 30 23 23Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".7"/>
    <path d="M25 25L32 31" stroke="var(--l-hi)" stroke-width=".8"/>${P(6, 6, 4.2)}${P(60, 5, 2.6)}${P(5, 60, 2.6)}${P(14, 14, 2)}</svg>`;
  const gem = `<svg viewBox="0 0 22 14"><path d="M1 7L11 1L21 7L11 13Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".8"/><path d="M11 1L11 13M1 7H21" stroke="var(--l-hi)" stroke-width=".5" opacity=".8"/>${P(11, 7, 2.3)}</svg>`;
  let ring = "";
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; ring += P(45 + 40 * Math.cos(a), 56 + 44 * Math.sin(a), 3.4); }
  const cameo = `<svg viewBox="0 0 90 106">${ring}
    <ellipse cx="45" cy="56" rx="35.5" ry="39.5" fill="none" stroke="url(#loG)" stroke-width="4.5"/>
    <ellipse cx="45" cy="56" rx="32" ry="36" fill="var(--l-lo)" stroke="var(--l-deep)" stroke-width="1" stroke-opacity=".4"/>
    <ellipse cx="45" cy="56" rx="32" ry="36" fill="url(#loV)"/>
    <clipPath id="loCamClip"><ellipse cx="45" cy="56" rx="32" ry="36"/></clipPath>
    <g clip-path="url(#loCamClip)"><path transform="translate(23 21) scale(.82)" fill="var(--l-pearl)" opacity=".95" d="M14 76C16 68 18 62 18 56C12 54 8 48 9 40C4 36 2 28 6 22C9 14 18 10 26 12C32 6 42 8 44 16C48 20 49 26 47 30C47 33 48 35 51 38L48 40C49 42 48 43 47 44C48 45 48 47 46 48C46 51 44 53 41 53C38 54 36 54 35 55C35 60 37 66 41 70C44 73 45 76 46 78Z"/>
    <path transform="translate(23 21) scale(.82)" d="M10 76C18 72 34 72 48 78" fill="none" stroke="var(--l-pearl)" stroke-width="2.4" stroke-dasharray="1 2.6" stroke-linecap="round"/></g>
    <svg x="33" y="0" width="24" height="21" viewBox="0 0 100 86">${bow.replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
    ${P(45, 102.5, 3.4)}</svg>`;
  let star = "";
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 34 : 38.5; star += `${i ? "L" : "M"}${(40 + r * Math.cos(a)).toFixed(1)} ${(40 + r * Math.sin(a)).toFixed(1)}`; }
  const medal = `<svg viewBox="0 0 80 80"><path d="${star}Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".8"/>
    <circle cx="40" cy="40" r="30" fill="var(--l-deep)" stroke="var(--l-hi)" stroke-width="1.6"/>
    <circle cx="40" cy="40" r="26.5" fill="url(#loM)"/><circle cx="40" cy="40" r="26.5" fill="none" stroke="var(--l-pearl)" stroke-width=".8" stroke-dasharray="1 2.2" opacity=".8"/>${P(40, 3.5, 2.6)}${P(40, 76.5, 2.6)}${P(3.5, 40, 2.6)}${P(76.5, 40, 2.6)}
    <path d="M67 2L69 10L77 12L69 14L67 22L65 14L57 12L65 10Z" fill="#fff" opacity=".95"/><circle cx="67" cy="12" r="4" fill="#fff" opacity=".35"/></svg>`;
  const defs = `<svg width="0" height="0" class="lo-defs" aria-hidden="true"><defs>
    <linearGradient id="loG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="lgs-l-hi"/><stop offset=".55" class="lgs-l-mid"/><stop offset="1" class="lgs-l-lo"/></linearGradient>
    <linearGradient id="loG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="lgs-l2-hi"/><stop offset=".55" class="lgs-l2-mid"/><stop offset="1" class="lgs-l2-lo"/></linearGradient>
    <radialGradient id="loR" cx=".42" cy=".38" r=".7"><stop offset="0" class="lgs-l-hi"/><stop offset=".55" class="lgs-l-mid"/><stop offset="1" class="lgs-l-lo"/></radialGradient>
    <radialGradient id="loP" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".45" class="lgs-l-pearl"/><stop offset="1" class="lgs-l-lo"/></radialGradient>
    <radialGradient id="loV" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="loM" cx=".5" cy=".3" r=".8"><stop offset="0" class="lgs-l-mid"/><stop offset=".6" class="lgs-l-lo"/><stop offset="1" class="lgs-l-btn"/></radialGradient>
  </defs></svg>`;
  const bow2 = bow.replaceAll("url(#loG)", "url(#loG2)");
  return { bow, bow2, rose, corner, gem, cameo, medal, defs };
})();
function loDecor() {
  document.body.insertAdjacentHTML("afterbegin", LO.defs);
  const box = (cls, html) => { const d = document.createElement("div"); d.className = "lodeco " + cls; d.setAttribute("aria-hidden", "true"); d.innerHTML = html; return d; };
  const i = (cls, svg = "") => `<i class="${cls}">${svg}</i>`;
  const corners = (list) => list.map((c) => i("lo-c " + c, LO.corner)).join("");
  document.querySelector(".side").append(box("lo-side",
    corners(["tl", "tr"]) + i("lo-pearls") + i("lo-rose rl", LO.rose) + i("lo-rose rr", LO.rose) + i("lo-bowb", LO.bow)));
  document.querySelector(".side .spacer").append(box("lo-cameo", i("lo-cam", LO.cameo) + i("lo-bowl", LO.bow) + i("lo-bowr", LO.bow)));
  document.querySelector(".player").append(box("lo-player",
    corners(["tl", "tr", "bl", "br"]) + i("lo-pearls") + i("lo-rose rl", LO.rose) + i("lo-rose rr", LO.rose) + i("lo-rose rt", LO.rose) + i("lo-bowt", LO.bow)));
  document.querySelector(".cols").append(box("lo-frame",
    corners(["tl", "tr", "bl", "br"]) + ["t", "b", "l", "r"].map((s) => i("lo-gem " + s, LO.gem)).join("") + i("lo-bowtr", LO.bow)));
  document.querySelector(".head").prepend(box("lo-medal", LO.medal + '<span class="lo-mi"></span>'));
  $("#waveBtn").after(box("lo-hearts", "<i></i>".repeat(8)));
}

export { LO, loDecor };

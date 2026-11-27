// Визуализатор: отрисовка на холсте (столбики снизу, круг вокруг «Моей волны») и орбиты вокруг кнопки волны.
// Звуковой граф, включение и выключение (applyViz, vizStart, ensureVizAudio) и полноэкранный режим — в main.js.
// ES-модуль, подключён ПЕРЕД app/main.js: main.js зовёт waveOrbitsSync и orbReset ещё при своей загрузке. Поэтому
// при загрузке модуль ничего не трогает, а viz, analyser, cfg, $ и прочее из main.js берёт по имени только внутри функций.
// Наружу — через window в конце файла.
// Орбиты вокруг кнопки «Моя волна» (#waveOrbits, их рисует CSS стиля — например, Неон).
// Пока волна играет — у слоя класс .on, а вращения (@keyframes neonSpin) ускоряются через playbackRate:
// так скорость меняется плавно, без скачка фазы, как было бы при смене animation-duration.
import { $ } from "../app/base.js";
import { baseOf, dynColorsOn, sty } from "../look/config.js";
import { rgba } from "./core.js";
function waveOrbitsSync() {
  const o = $("#waveOrbits");
  if (!o) return;
  const on = $("#waveBtn").classList.contains("playing");
  o.classList.toggle("on", on);
  if ($("#wavePage").hidden || getComputedStyle(o).display === "none") return;
  const rate = on ? 2.4 : 1;
  for (const a of o.getAnimations?.({ subtree: true }) || []) {
    if (/(^|-)neonSpin$/.test(a.animationName || "") && a.playbackRate !== rate) {
      if (a.updatePlaybackRate) a.updatePlaybackRate(rate); else a.playbackRate = rate;
    }
  }
}
// (состояние — в viz: vizStop может сработать раньше, чем объявлен кэш vz)
// такт для орбит: --kick (0…1) на .stage и ударная волна на каждый удар бочки (только при живом анализаторе)
function orbReset() {
  if (viz.orbKick !== undefined) { $(".stage")?.style.removeProperty("--kick"); viz.orbKick = undefined; }
  if (viz.orbLive) { $("#waveOrbits")?.classList.remove("beats"); viz.orbLive = false; }
}
function orbBeat(live) {
  const k = live ? Math.round(viz.kick * 40) / 40 : 0;
  if (k !== viz.orbKick) { viz.orbKick = k; vz.stage.style.setProperty("--kick", k); }
  if (live !== viz.orbLive) { viz.orbLive = live; vz.orb.classList.toggle("beats", live); }
  if (live && viz.beatNow) {
    viz.orbN = (viz.orbN + 1) % 2 || 0;
    const r = vz.orb.children[3 + viz.orbN];
    r?.animate?.([
      { opacity: 0.95, scale: 1, borderWidth: "3px" },
      { opacity: 0, scale: 1.85 + viz.kick * 0.25, borderWidth: "0.5px" },
    ], { duration: 950, easing: "cubic-bezier(.1, .6, .3, 1)" });
  }
}

// Кэш визуализатора: холсты, контексты, градиенты и таблицы синусов создаются один раз,
// а не 60 раз в секунду — меньше работы процессору и сборщику мусора.
const vz = { cv: null, g: null, cvF: null, gF: null, key: "", br: 56, grad: null, glow: null, bgrad: null, floor: null,
  N: 120, cos: null, sin: null, uIdx: null, pts: null };
function vzTables() {
  const N = vz.N; vz.cos = new Float32Array(N); vz.sin = new Float32Array(N); vz.uIdx = new Uint8Array(N); vz.pts = new Float32Array(N * 2);
  for (let j = 0; j < N; j++) {
    const th = (j / N) * Math.PI * 2;
    vz.cos[j] = Math.cos(th); vz.sin[j] = Math.sin(th);
    vz.uIdx[j] = Math.floor((Math.abs(th - Math.PI) / Math.PI) * 127);
  }
}
function vizFrame(ts) {
  if (!viz.run) return;
  if (document.hidden) { viz.run = false; return; }        // окно скрыто — цикл останавливается совсем (вернётся по visibilitychange)
  requestAnimationFrame(window.vizFrame);      // через window: замер perf.js подменяет vizFrame обёрткой
  const live = audioViz && analyser && audio && !audio.paused;
  // не чаще ~60 кадров/с, пока играет, и ~30 в простое — на мониторах 120–165 Гц больше не рисуем лишнего
  if (ts - (viz.lastDraw || 0) < (live ? 13 : 30)) return;
  viz.lastDraw = ts;
  const full = vizFullOn;
  const cv = full ? (vz.cvF ||= $("#vizFullCv")) : (vz.cv ||= $("#viz")), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const g = full ? (vz.gF ||= cv.getContext("2d")) : (vz.g ||= cv.getContext("2d"));
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    vz.br = ($("#waveBtn").offsetWidth || 112) / 2;          // размер кнопки меняется только вместе с размером холста
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  // динамический фон — визуализатор в цветах обложки (они главнее и своих цветов визуализатора)
  const dp = dynColorsOn() && dynPal ? dynPal : null;
  const A = dp ? dp.accent : sty().cc?.vizA || sty().accent, B = dp ? dp.accent2 : sty().cc?.vizB || sty().accent2;
  const key = `${full}|${cfg.vizStyle}|${cfg.style}|${document.documentElement.dataset.anim}|${w}x${h}|${A}|${B}`;
  const fresh = key !== vz.key;
  if (fresh) {
    vz.key = key; vz.br = ($("#waveBtn").offsetWidth || 112) / 2;      // стиль мог поменять размер кнопки
    // отступ визуализатора от кнопки: стиль или тема может задать его переменной --viz-gap на .stage (Неону нужно место под орбиты)
    vz.stage = $(".stage"); vz.orb = $("#waveOrbits");
    vz.gapCss = parseFloat(getComputedStyle(vz.stage).getPropertyValue("--viz-gap"));
    vz.orbOn = !!vz.orb && document.documentElement.dataset.anim === "on" && getComputedStyle(vz.orb).display !== "none";
    if (!vz.orbOn) orbReset();
  }

  let bass = 0, mid = 0;
  if (live) {
    analyser.getByteFrequencyData(freq);
    for (let k = 1; k <= 6; k++) bass += freq[k];
    for (let k = 7; k <= 40; k++) mid += freq[k];
    bass /= 6 * 255; mid /= 34 * 255;
  }
  const dt = Math.min(0.1, Math.max(0.001, (ts - (viz.last || ts)) / 1000)) || 0.016; viz.last = ts;
  const k60 = dt * 60;                                           // поправка на частоту кадров
  const ease = (cur, target, up, down) => cur + (target - cur) * (1 - Math.pow(1 - (target > cur ? up : down), k60));

  // такт: энергия самого низа (бочка, 40–170 Гц) против её среднего за последние ~полсекунды
  if (live) {
    const e = (freq[1] + freq[2] + freq[3] + freq[4]) / (4 * 255);
    viz.eAvg += (e - viz.eAvg) * (1 - Math.pow(0.95, k60));
    if (e > viz.eAvg * 1.18 + 0.03 && e - viz.ePrev > 0.015 && ts - viz.lastBeat > 200) { viz.kick = 1; viz.lastBeat = ts; viz.beatNow = true; window.themeFxBeat?.(); }
    viz.ePrev = e;
  }
  viz.kick *= Math.exp(-dt * 6.5);

  viz.bass = ease(viz.bass, bass, 0.75, 0.16);
  viz.mid = ease(viz.mid, mid, 0.35, 0.15);
  for (let k = 0; k < 128; k++) {
    const target = live ? freq[1 + Math.floor(Math.pow(k / 127, 1.7) * 150)] / 255 : 0;
    viz.sm[k] = ease(viz.sm[k], target, 0.6, 0.14);
  }

  if (!full && vz.orbOn) orbBeat(live);                          // орбиты Неона дышат в такт
  const t = ts / 1000, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, N = vz.N, RINGS = 5;
  if (full) {                                        // на весь экран — свои, более лёгкие варианты, чтобы фон было видно
    if (cfg.vizStyle === "bars") drawBarsBottom(g, w, h, t, live, ease, fresh, A, B); else drawOrbit(g, w, h, t, live, A, B);
    viz.beatNow = false; return;
  }
  viz.beatNow = false;
  const br = vz.br;
  if (cfg.vizStyle === "bars") { drawBars(g, w, h, t, br, live, ease, fresh, A, B); return; }
  if (!vz.cos) vzTables();
  const gap = Number.isFinite(vz.gapCss) ? vz.gapCss : baseOf() === "steam" || baseOf() === "lolitta" ? 28 : 14;
  const inner = Math.min(br + gap, R * 0.5), outer = Math.max(inner + 20, R * 0.76);
  if (fresh) {
    vz.grad = g.createLinearGradient(0, 0, w, h);
    vz.grad.addColorStop(0, A); vz.grad.addColorStop(1, B);
    vz.glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.92);    // радиус не больше половины меньшей стороны — подсветка не упирается в края
    vz.glow.addColorStop(0, rgba(A, 1)); vz.glow.addColorStop(1, rgba(A, 0));
  }
  const grad = vz.grad;
  g.globalAlpha = 0.1 + viz.bass * 0.25 + viz.kick * 0.18;         // яркость подсветки — через прозрачность, градиент тот же
  g.fillStyle = vz.glow; g.fillRect(0, 0, w, h);

  g.globalCompositeOperation = "lighter";
  const cs = vz.cos, sn = vz.sin, ui = vz.uIdx, pts = vz.pts, wob = 0.7 + viz.mid * 1.6;
  for (let i = 0; i < RINGS; i++) {
    const base = (inner + ((outer - inner) * i) / (RINGS - 1)) * (1 + viz.bass * (0.08 - i * 0.012) + viz.kick * (0.075 - i * 0.01));
    const room = Math.max(R - 16 - base, 4);
    const p1 = t * 0.5 + i * 1.3, p2 = -t * 0.7 + i * 2.1, p3 = t * 0.9 + i * 0.7, amp = R * 0.13 * (1 - i * 0.1), floorDev = -(base - br - 6);
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const s = viz.sm[(ui[j] + i * 9) % 128];
      const noise = 0.05 * Math.sin(2 * th + p1) + 0.04 * Math.sin(3 * th + p2) + 0.03 * Math.sin(5 * th + p3);
      let dev = base * noise * wob + s * amp;
      if (dev > 0) dev = room * Math.tanh(dev / room);
      else if (dev < floorDev) dev = floorDev;
      const r = base + dev;
      pts[j * 2] = cx + cs[j] * r; pts[j * 2 + 1] = cy + sn[j] * r;
    }
    const path = new Path2D();
    path.moveTo((pts[(N - 1) * 2] + pts[0]) / 2, (pts[(N - 1) * 2 + 1] + pts[1]) / 2);
    for (let j = 0; j < N; j++) {
      const a = j * 2, b = ((j + 1) % N) * 2;
      path.quadraticCurveTo(pts[a], pts[a + 1], (pts[a] + pts[b]) / 2, (pts[a + 1] + pts[b + 1]) / 2);
    }
    path.closePath();
    if (i === 0) { g.globalAlpha = 0.07; g.fillStyle = grad; g.fill(path); }
    g.strokeStyle = grad;
    g.globalAlpha = 0.05; g.lineWidth = 18; g.stroke(path);
    g.globalAlpha = 0.12; g.lineWidth = 7; g.stroke(path);
    g.globalAlpha = Math.min(1, 0.6 - i * 0.07 + viz.kick * 0.3); g.lineWidth = 1.6 + viz.kick * 0.8; g.stroke(path);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

// уровень k-го столбца из n: частоты по логарифмической шкале, бас — k = 0
const BAR_BINS = 340;                                                      // ~15 кГц при fftSize 1024
function barLevel(k, n, t, live) {
  if (!live) return 0.035 + 0.025 * Math.sin(t * 1.4 + k * 0.55);         // в тишине — лёгкая рябь
  const lo = Math.floor(Math.pow(BAR_BINS, k / n)), hi = Math.max(lo + 1, Math.floor(Math.pow(BAR_BINS, (k + 1) / n)));
  let v = 0;
  for (let b = lo; b < hi && b < freq.length; b++) v = Math.max(v, freq[b]);
  v = Math.min(1, (v / 255) * (0.85 + (k / n) * 0.55));                   // верха тише — немного подтягиваем
  return Math.pow(v, 1.6) + viz.kick * 0.12 * (1 - k / n);
}
// Столбцы, свечения и «шапки» собираются в общие контуры и рисуются одним вызовом.
// Режим смешивания «lighter» складывает цвета, порядок не важен, а фигуры не пересекаются — картинка та же.

// весь экран, «Столбцами»: эквалайзер вдоль нижнего края, столбцы растут снизу вверх,
// бас в центре, высокие к краям; занимает только нижнюю треть — остальной экран отдан фону
function drawBarsBottom(g, w, h, t, live, ease, fresh, A, B) {
  const half = w / 2 - 6, n = Math.max(16, Math.min(64, Math.floor(half / 15))), step = half / n, bw = Math.max(3, step * 0.58);
  const base = h, maxH = h * 0.32;
  if (fresh) {
    vz.floor = g.createLinearGradient(0, h, 0, h - h * 0.22);              // лёгкое свечение у пола, дышит с басом
    vz.floor.addColorStop(0, rgba(A, 1)); vz.floor.addColorStop(1, rgba(A, 0));
    vz.bgrad = g.createLinearGradient(0, base - maxH, 0, base);             // к верху столбец становится прозрачнее
    vz.bgrad.addColorStop(0, rgba(B, 0.35)); vz.bgrad.addColorStop(0.55, rgba(A, 0.8)); vz.bgrad.addColorStop(1, rgba(A, 0.95));
  }
  g.globalAlpha = 0.10 + viz.bass * 0.12 + viz.kick * 0.10;
  g.fillStyle = vz.floor; g.fillRect(0, h - h * 0.22, w, h * 0.22);
  g.globalCompositeOperation = "lighter";
  const glowP = new Path2D(), capP = new Path2D();
  g.fillStyle = vz.bgrad;
  for (let k = 0; k < n; k++) {
    viz.bars[k] = ease(viz.bars[k], barLevel(k, n, t, live), 0.65, 0.18);
    const hh = Math.max(3, Math.min(1, viz.bars[k]) * maxH);
    viz.peaks[k] = Math.max(hh, viz.peaks[k] - maxH * 0.5 / 60 * (live ? 1 : 3));
    const barP = new Path2D();
    for (let d = -1; d <= 1; d += 2) {
      const x = w / 2 + d * (k * step + step / 2) - bw / 2;
      glowP.roundRect(x - 3, base - hh - 3, bw + 6, hh + 3, [(bw + 6) / 2, (bw + 6) / 2, 0, 0]);
      barP.roundRect(x, base - hh, bw, hh, [bw / 2, bw / 2, 0, 0]);
      if (live) capP.rect(x, base - viz.peaks[k] - 7, bw, 2);
    }
    g.globalAlpha = 0.6 + Math.min(0.4, viz.bars[k] * 0.5); g.fill(barP);
  }
  g.globalAlpha = 0.1; g.fill(glowP);
  if (live) { g.globalAlpha = 0.75; g.fillStyle = B; g.fill(capP); }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

// весь экран, «Круговой» → «Орбита»: пустой центр (сквозь него видно фон), вокруг — тонкие лучи-частоты,
// на каждую долю от кольца расходится тонкая волна, всё медленно вращается
function drawOrbit(g, w, h, t, live, A, B) {
  const cx = w / 2, cy = h / 2, m = Math.min(w, h);
  const r0 = m * 0.15 * (1 + viz.bass * 0.05 + viz.kick * 0.06), L = m * 0.19;
  g.globalCompositeOperation = "lighter";
  viz.ripples ||= [];
  if (viz.beatNow) { viz.ripples.push(t); if (viz.ripples.length > 6) viz.ripples.shift(); }
  while (viz.ripples.length && t - viz.ripples[0] >= 1.8) viz.ripples.shift();
  g.strokeStyle = A;
  for (const b of viz.ripples) {
    const age = (t - b) / 1.8, r = r0 + age * m * 0.42;
    g.globalAlpha = Math.pow(1 - age, 2) * 0.32; g.lineWidth = 1.2 + (1 - age) * 1.5;
    g.beginPath(); g.arc(cx, cy, Math.min(r, m * 0.5 - 4), 0, Math.PI * 2); g.stroke();
  }
  const N = 160, rot = t * 0.035, path = new Path2D();
  for (let j = 0; j < N; j++) {
    const u = (j <= N / 2 ? j : N - j) / (N / 2);
    const s = viz.sm[Math.min(127, Math.floor(u * 110))];
    const len = 2 + Math.pow(s, 1.25) * L + viz.kick * 5;
    const th = rot + (j / N) * Math.PI * 2 - Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
    path.moveTo(cx + c * (r0 + 6), cy + sn * (r0 + 6));
    path.lineTo(cx + c * (r0 + 6 + len), cy + sn * (r0 + 6 + len));
  }
  const rg = g.createRadialGradient(cx, cy, r0, cx, cy, r0 + L * 0.9);
  rg.addColorStop(0, A); rg.addColorStop(1, B);
  g.strokeStyle = rg; g.lineCap = "round";
  g.globalAlpha = 0.14; g.lineWidth = 6; g.stroke(path);
  g.globalAlpha = 0.9; g.lineWidth = 2; g.stroke(path);
  g.strokeStyle = A;
  g.globalAlpha = 0.55 + viz.kick * 0.45; g.lineWidth = 1.5 + viz.kick * 2;
  g.beginPath(); g.arc(cx, cy, r0, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.18; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, r0 * 0.9, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.lineCap = "butt";
}

// столбцы разной высоты: зеркально слева и справа от кнопки и вверх-вниз от средней линии; бас — у кнопки
function drawBars(g, w, h, t, br, live, ease, fresh, A, B) {
  const cy = h / 2, gapC = br + (Number.isFinite(vz.gapCss) ? vz.gapCss : 14), side = w / 2 - gapC - 6;
  if (side < 30) return;
  const n = Math.max(8, Math.min(64, Math.floor(side / 10))), step = side / n, bw = Math.max(2, step * 0.6);
  const maxH = Math.max(10, Math.min(h / 2 - 10, side * 0.9));            // никогда не выходит за холст
  if (fresh) {
    vz.glow = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.min(w, h) * 0.46);
    vz.glow.addColorStop(0, rgba(A, 1)); vz.glow.addColorStop(1, rgba(A, 0));
    vz.bgrad = g.createLinearGradient(0, cy - maxH, 0, cy + maxH);
    vz.bgrad.addColorStop(0, B); vz.bgrad.addColorStop(0.5, A); vz.bgrad.addColorStop(1, B);
  }
  g.globalAlpha = 0.08 + viz.bass * 0.2 + viz.kick * 0.15;
  g.fillStyle = vz.glow; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";
  const glowP = new Path2D(), capP = new Path2D();
  g.fillStyle = vz.bgrad;
  for (let k = 0; k < n; k++) {
    viz.bars[k] = ease(viz.bars[k], barLevel(k, n, t, live), 0.65, 0.18);
    const hh = Math.max(2, Math.min(1, viz.bars[k]) * maxH);
    viz.peaks[k] = Math.max(hh, viz.peaks[k] - maxH * 0.6 * (1 / 60) * (live ? 1 : 3));
    const barP = new Path2D(), p = Math.min(maxH, viz.peaks[k] + 4);
    for (let d = -1; d <= 1; d += 2) {
      const x = w / 2 + d * (gapC + k * step + step / 2) - bw / 2;
      glowP.roundRect(x - 2, cy - hh - 2, bw + 4, hh * 2 + 4, (bw + 4) / 2);      // мягкое свечение
      barP.roundRect(x, cy - hh, bw, hh * 2, bw / 2);
      if (live) { capP.rect(x, cy - p - 1.5, bw, 1.5); capP.rect(x, cy + p, bw, 1.5); }
    }
    g.globalAlpha = 0.55 + Math.min(0.45, viz.bars[k] * 0.6); g.fill(barP);
  }
  g.globalAlpha = 0.12; g.fill(glowP);
  if (live) { g.globalAlpha = 0.7; g.fillStyle = B; g.fill(capP); }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

export { vizFrame, waveOrbitsSync, orbReset };
// обычные скрипты (layout.js, ядро Whisper, boot.js…) и обращения window.X — берут это из window
Object.assign(window, { vizFrame });

// Скрытые команды консоли (пасхалки): visual, cat, cowsay, fortune, vinyl, matrix, party, piano, metro, tap, sudo, fetch…
// Их нет в help и в Tab; список — в docs/THEMES.md («Консоль → Скрытые команды»). Сама консоль — look/cli.js:
// отсюда только регистрируем команды в cliKit.CMDS и пользуемся её выводом и живым блоком.
import { $, ym } from "../app/base.js";
import { fmtHM, plRu } from "../pages/stats.js";
import { ensureVizAudio } from "../player/core.js";
import { cliKit } from "./cli.js";
(() => {
  const { CMDS, artistsOf, cols, curT, cut, dim, err, find, line, liveStart, liveStop, ok } = cliKit;

  // ---------- скрытые команды (пасхалки) ----------
  // Работают в любой консольной теме, но не видны в help и в дополнении по Tab — их находят сами
  // или читают в docs/THEMES.md («Консоль → Скрытые команды»). help <имя> по ним всё же отвечает.
  const egg = (names, args, help, fn) => CMDS.push({ names: names.split(" "), args, help, group: "Скрытые", hidden: true, fn });
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const art = (text, cls = "") => line(text, "art" + (cls ? " " + cls : ""));
  const isPlaying = () => !!(audio && !audio.paused && curT());
  const userName = () => (cliKit.ps?.textContent.split("@")[0] || "user").replace(/[^\p{L}\p{N}_.-]/gu, "") || "user";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // --- звук для piano / metro: свой маленький AudioContext, музыку приложения не трогает ---
  let pctx = null;
  function synth() { pctx ||= new AudioContext(); if (pctx.state === "suspended") pctx.resume(); return pctx; }
  function tone(f, t0, dur, type = "triangle", amp = 1) {
    const c = synth(), o = c.createOscillator(), g = c.createGain();
    const peak = 0.2 * amp * clamp(typeof volume === "number" ? volume : 0.8, 0.15, 1);
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // visual — аудиовизуализатор из символов
  const BLK = " ▁▂▃▄▅▆▇█";
  let tbuf = null;
  egg("visual vis", "[bars|wave|line|off]", "аудиовизуализатор из символов: столбики, осциллограф или одна строка", (a) => {
    const mode = String(a[0] || "bars").toLowerCase();
    if (mode === "off" || mode === "stop") return liveStop();
    if (!["bars", "wave", "line"].includes(mode)) return err("Варианты: visual bars | visual wave | visual line");
    if (!isPlaying()) dim("Сейчас тишина — включи трек, и столбики оживут.");
    dim("Esc или Ctrl+C — остановить.");
    const H = mode === "line" ? 1 : 8;
    const cw = mode === "bars" ? 3 : 1;                          // столбик — «██ »
    const W = clamp(Math.floor((cols() * 0.92) / cw), 12, mode === "bars" ? 40 : 110);
    const lvl = new Float32Array(W), peak = new Float32Array(W);
    liveStart(30, (n, t) => {
      const on = !!(audioViz && analyser && freq && audio && !audio.paused);
      if (mode === "wave") {
        const rows = Array.from({ length: H }, () => Array(W).fill(" "));
        let get;
        if (on) {
          if (!tbuf || tbuf.length !== analyser.fftSize) tbuf = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(tbuf);
          const span = tbuf.length / 2;
          get = (x) => (tbuf[Math.floor((x / W) * span)] - 128) / 128;
        } else get = (x) => Math.sin((x / W) * Math.PI * 4 + t * 2) * 0.12;
        let prev = null;
        for (let x = 0; x < W; x++) {
          const v = clamp(get(x) * 1.8, -1, 1);
          const y = Math.round(((1 - v) / 2) * (H - 1));
          if (prev !== null) for (let yy = Math.min(prev, y) + 1; yy < Math.max(prev, y); yy++) rows[yy][x] = "│";
          rows[y][x] = "•"; prev = y;
        }
        return rows.map((r) => r.join("")).join("\n");
      }
      if (on) analyser.getByteFrequencyData(freq);
      const maxBin = Math.min(freq?.length || 512, 360);          // примерно до 15 кГц
      for (let x = 0; x < W; x++) {
        let v;
        if (on) {
          // квадратичная шкала: басам и серединке достаётся больше столбиков, чем верхам
          const b0 = Math.floor(2 + (maxBin - 2) * (x / W) ** 2), b1 = Math.max(b0 + 1, Math.floor(2 + (maxBin - 2) * ((x + 1) / W) ** 2));
          let s = 0;
          for (let b = b0; b < b1; b++) s = Math.max(s, freq[b]);
          v = clamp((s / 255) ** 1.6 * (0.9 + 0.6 * (x / W)), 0, 1);  // верхи тише — чуть подтягиваем
        } else v = 0.05 + 0.04 * Math.sin(x * 0.45 + t * 2.5);
        lvl[x] = v > lvl[x] ? v : lvl[x] * 0.8 + v * 0.2;            // быстрый подъём, плавное падение
        peak[x] = Math.max(lvl[x], peak[x] - 0.01);
      }
      if (mode === "line") return Array.from(lvl, (v) => BLK[clamp(Math.round(v * 8), 1, 8)]).join("");
      const rows = [];
      for (let r = 0; r < H; r++) {
        let s = "";
        for (let x = 0; x < W; x++) {
          const u = lvl[x] * H * 8 - (H - 1 - r) * 8;
          let ch = u >= 8 ? "█" : u <= 0 ? " " : BLK[clamp(Math.round(u), 1, 8)];
          if (ch === " " && peak[x] > 0.06 && Math.min(H - 1, Math.floor(peak[x] * H)) === H - 1 - r) ch = "▔";
          s += ch + ch + " ";
        }
        rows.push(s.trimEnd());
      }
      return rows.join("\n");
    }, { onStop: () => { window.cliVizOn = false; } });
    // анализ звука нужен и консоли: main.js → vizWanted() смотрит на cliVizOn и переводит трек на анализируемый плеер
    window.cliVizOn = true;
    try { if (typeof ensureVizAudio === "function") ensureVizAudio(); } catch {}
  });

  // cat — котик
  const CATS = [
    " /\\_/\\\n( o.o )\n > ^ <",
    "   /\\_/\\\n  ( o o )\n  (  =  )___\n   (\")(\")___)~",
    "      z\n    z\n  /\\_/\\\n ( -.- )\n /     \\\n(_)---(_)",
    "  /\\_/\\  \n ( =^.^= )\n  )     (  //\n (__\\_/__)//",
    "  /\\_/\\\n ( ^.^ )\n  \\ ~ /\n  /   \\\n (_| |_)",
  ];
  const CAT_PHONES = "    /\\_/\\    ♪\n ◖ ( ^ω^ ) ◗\n    (\") (\")   ♫";
  egg("cat meow мяу", "[имя|vibe]", "котик; cat vibe — котик качается под музыку", (a) => {
    const arg = String(a[0] || "").toLowerCase();
    if (arg === "vibe" || arg === "dance") {
      const F = [
        "   /\\_/\\  ♪\n  ( ^.^ )\n  />   <\\",
        "    /\\_/\\\n   ( ^o^ )  ♫\n   \\>   </",
        "   /\\_/\\\n  ( ^.^ )  ♪\n  />   <\\",
        "  /\\_/\\\n ( ^o^ )   ♫\n \\>   </",
      ];
      const SLEEP = ["  /\\_/\\   z\n ( -.- )\n (\")(\")", "  /\\_/\\    Z\n ( -.- )  z\n (\")(\")"];
      dim("Esc — котик отдыхает.");
      let step = 0, lastHit = 0, avg = 0;
      liveStart(20, (n, t) => {
        if (!isPlaying()) return SLEEP[Math.floor(t) % 2];
        let hit = false;
        if (audioViz && analyser && freq) {
          analyser.getByteFrequencyData(freq);
          const bass = (freq[1] + freq[2] + freq[3] + freq[4]) / 4;
          avg = avg * 0.92 + bass * 0.08;
          hit = bass > avg * 1.15 && bass > 90 && t - lastHit > 0.25;
        } else hit = t - lastHit > 0.5;                             // звук не анализируется — просто в ритме 120
        if (hit) { lastHit = t; step++; }
        return F[step % F.length];
      }, { onStop: () => { window.cliVizOn = false; } });
      window.cliVizOn = true;
      try { if (typeof ensureVizAudio === "function") ensureVizAudio(); } catch {}
      return;
    }
    if (a[0]) dim(`cat: ${a[0]}: нет такого файла. Держи котика вместо него:`);
    art(isPlaying() && Math.random() < 0.5 ? CAT_PHONES : pick(CATS), "hl");
    dim(pick(["мяу", "мрр", "мяу?", "*мурчит*", "мяу. play?", "*требует лайк треку*"]));
  });

  // cowsay — говорит, правда, кот
  function bubble(text, w = 40) {
    const words = String(text).replace(/\s+/g, " ").trim().split(" ");
    const rows = [];
    let cur = "";
    for (const wd of words) {
      if (!cur) cur = wd.slice(0, w);
      else if ((cur + " " + wd).length <= w) cur += " " + wd;
      else { rows.push(cur); cur = wd.slice(0, w); }
    }
    if (cur) rows.push(cur);
    const m = Math.max(...rows.map((r) => r.length));
    const body = rows.length === 1 ? [`< ${rows[0]} >`] : rows.map((r, i) => (i === 0 ? "/ " : i === rows.length - 1 ? "\\ " : "| ") + r.padEnd(m) + (i === 0 ? " \\" : i === rows.length - 1 ? " /" : " |"));
    return [" " + "_".repeat(m + 2), ...body, " " + "-".repeat(m + 2)].join("\n");
  }
  egg("cowsay catsay", "[текст]", "кот (да, кот) говорит текст; без текста — что играет", (a) => {
    const t = curT();
    const text = a.join(" ").trim() || (t ? `Сейчас играет: ${t.title} — ${artistsOf(t)}` : pick(FORTUNES));
    art(bubble(text) + "\n      \\\n       \\   /\\_/\\\n          ( o.o )\n           > ^ <   мууу? то есть мяу.");
  });

  // fortune — случайный музыкальный факт
  const FORTUNES = [
    "Ля первой октавы = 440 Гц. Этот стандарт настройки закреплён в ISO 16.",
    "Октава — это ровно вдвое большая частота.",
    "В равномерной темперации соседние полутоны отличаются в ¹²√2 ≈ 1,0595 раза.",
    "На стандартном фортепиано 88 клавиш: 52 белые и 36 чёрных.",
    "Pianoforte — «тихо-громко»: так назвали инструмент, который умел и то и другое.",
    "Скрипичный ключ — это ключ соль: его завиток обводит линейку с соль первой октавы.",
    "У до мажора и ля минора нет знаков при ключе.",
    "Одна и та же нота у скрипки и флейты звучит по-разному из-за обертонов.",
    "120 BPM — ровно две доли в секунду.",
    "Компакт-диск хранит звук как 44 100 отсчётов в секунду по 16 бит.",
    "Чтобы записать звук до 20 кГц, частота дискретизации должна быть больше 40 кГц (теорема Котельникова).",
    "Человек слышит примерно от 20 Гц до 20 кГц, а с возрастом верхняя граница опускается.",
    "Метроном с привычной шкалой ударов в минуту запатентовал Иоганн Мельцель в 1815 году.",
    "Tab дополняет команды. Но не все.",
    "Если долго слушать тишину, тишина начинает слушать тебя. Включи что-нибудь: wave.",
    "Лайк — лучший способ сказать треку «спасибо». Команда like.",
  ];
  egg("fortune", "", "случайный музыкальный факт", () => line("» " + pick(FORTUNES), "hl"));

  // vinyl — крутящаяся пластинка
  egg("vinyl spin", "", "пластинка крутится, пока играет трек", () => {
    const R = 5;
    dim("Esc — снять иглу.");
    let ang = 0, last = 0;
    liveStart(24, (n, t) => {
      const on = isPlaying();
      ang += on ? (t - last) * 3.5 : 0;                            // 33⅓ об/мин ≈ 3,5 рад/с
      last = t;
      const rows = [];
      for (let y = -R; y <= R; y++) {
        let s = "";
        for (let x = -2 * R - 1; x <= 2 * R + 1; x++) {
          const dx = x / 2, d = Math.hypot(dx, y);
          if (d > R + 0.35) { s += " "; continue; }
          if (d < 0.7) { s += "●"; continue; }
          if (d < 1.9) { s += "o"; continue; }
          const sec = (((Math.atan2(y, dx) - ang) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          s += sec < 0.45 ? "▓" : sec < 0.9 ? "▒" : d > R - 0.4 ? "█" : "░";
        }
        rows.push(s.trimEnd());
      }
      const tr = curT();
      rows.push("", tr ? `${on ? "♪" : "⏸"} ${cut(tr.title, 30)} — ${cut(artistsOf(tr), 24)}  ·  33⅓` : "⏸ пластинка пуста — включи трек");
      return rows.join("\n");
    });
  });

  // matrix — «цифровой дождь», только из нот
  egg("matrix", "", "цифровой дождь из нот и нулей", () => {
    dim("Esc — проснуться.");
    const W = clamp(cols() - 2, 20, 120), H = 14, CH = "01♪♫♩♯♭ABCDEFG";
    const head = Array.from({ length: W }, () => -Math.random() * H * 2);
    const len = Array.from({ length: W }, () => 4 + Math.floor(Math.random() * 9));
    const sp = Array.from({ length: W }, () => 0.25 + Math.random() * 0.6);
    const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => pick(CH)));
    liveStart(20, () => {
      const rows = [];
      for (let x = 0; x < W; x++) {
        head[x] += sp[x];
        if (head[x] - len[x] > H) { head[x] = -Math.random() * H; len[x] = 4 + Math.floor(Math.random() * 9); sp[x] = 0.25 + Math.random() * 0.6; }
        if (Math.random() < 0.08) grid[Math.floor(Math.random() * H)][x] = pick(CH);
      }
      for (let y = 0; y < H; y++) {
        let s = "";
        for (let x = 0; x < W; x++) { const k = head[x] - y; s += k >= 0 && k < len[x] ? grid[y][x] : " "; }
        rows.push(s);
      }
      return rows.join("\n");
    });
  });

  // party — радужная консоль
  let partyTimer = 0;
  cliKit.exit.push(() => { clearTimeout(partyTimer); cliKit.el?.classList.remove("party"); });
  egg("party", "[off]", "радужная консоль на 30 секунд", (a) => {
    clearTimeout(partyTimer);
    if (/^(off|stop|0)$/i.test(a[0] || "")) { cliKit.el.classList.remove("party"); return dim("Вечеринка окончена."); }
    cliKit.el.classList.add("party");
    ok(pick(["★ ПАТИ ★", "♪ ♫ ♪ ♫", "Громче!", "Танцуют все!"]));
    partyTimer = setTimeout(() => cliKit.el.classList.remove("party"), 30000);
  });

  // piano — сыграть ноты
  const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, h: 11, до: 0, ре: 2, ми: 4, фа: 5, соль: 7, ля: 9, си: 11 };
  function parseNote(tok, oct) {
    const m = /^(до|ре|ми|фа|соль|ля|си|[a-h])(#|♯|диез|b|♭|бемоль)?(\d)?$/i.exec(tok);
    if (!m) return null;
    const acc = m[2] ? (/^(#|♯|диез)$/i.test(m[2]) ? 1 : -1) : 0;
    const o = m[3] != null ? +m[3] : oct;
    const name = m[1].toLowerCase();
    return { midi: 12 * (o + 1) + SEMI[name] + acc, oct: o, label: m[1].toUpperCase() + (acc > 0 ? "♯" : acc < 0 ? "♭" : "") + o };
  }
  egg("piano", "[темп] <ноты>", "сыграть ноты: piano c e g c5 · piano до ми соль · piano 200 c d e - e d c", (a) => {
    let bpm = 180, toks = a.slice();
    if (toks[0] && /^\d+$/.test(toks[0])) bpm = clamp(+toks.shift(), 40, 600);
    if (!toks.length) toks = "c4 e4 g4 c5 - g4 e4 c4".split(" ");
    if (toks.length > 64) return err("Не больше 64 нот за раз.");
    const c = synth(), beat = 60 / bpm;
    let t = c.currentTime + 0.05, oct = 4;
    const shown = [];
    for (const tok of toks.flatMap((x) => x.split(","))) {
      if (!tok) continue;
      if (/^(-|\.|_|пауза)$/i.test(tok)) { shown.push("·"); t += beat; continue; }
      const nt = parseNote(tok, oct);
      if (!nt) return err(`piano: непонятная нота «${tok}». Пример: c d e f# g a bb c5 или до ре ми.`);
      oct = nt.oct;
      tone(440 * 2 ** ((nt.midi - 69) / 12), t, Math.max(0.25, beat * 1.6));
      shown.push(nt.label);
      t += beat;
    }
    ok("♪ " + shown.join(" "));
  });

  // metro — метроном
  egg("metro metronome", "[bpm] [доли]", "метроном: metro 120 · metro 90 3 · metro off", (a) => {
    if (/^(off|stop)$/i.test(a[0] || "")) return liveStop();
    const bpm = clamp(parseInt(a[0] || "100", 10) || 100, 30, 300), beats = clamp(parseInt(a[1] || "4", 10) || 4, 1, 12);
    const c = synth();
    let next = c.currentTime + 0.1, k = 0;
    const times = [];
    dim("Esc — стоп.");
    liveStart(30, () => {
      while (next < c.currentTime + 0.12) {
        const down = k % beats === 0;
        tone(down ? 1760 : 1100, next, 0.05, "square", down ? 0.55 : 0.35);
        times.push([next, k % beats]); next += 60 / bpm; k++;
      }
      while (times.length > 1 && times[1][0] <= c.currentTime) times.shift();
      const cur = times[0] && times[0][0] <= c.currentTime ? times[0][1] : -1;
      return Array.from({ length: beats }, (_, i) => (i === cur ? "●" : "○")).join(" ") + `   ${bpm} BPM · ${beats}/4`;
    });
  });

  // tap — узнать темп, отстукивая пробелом
  egg("tap bpm", "", "отстучи такт пробелом или Enter — консоль посчитает BPM", () => {
    const taps = [];
    let bpmNow = 0, flash = 0;
    dim("Стучи пробелом или Enter в такт. Esc — готово.");
    liveStart(20, () => {
      const t = performance.now();
      const mark = t - flash < 120 ? "●" : "○";
      return taps.length < 2 ? `${mark}  ожидание ударов…` : `${mark}  ${bpmNow} BPM  (${taps.length} ударов)`;
    }, {
      onKey: (e) => {
        if ((e.key !== " " && e.key !== "Enter") || cliKit.inp.value.trim()) return false;
        const t = performance.now();
        if (taps.length && t - taps[taps.length - 1] > 2500) taps.length = 0;   // долгая пауза — считаем заново
        taps.push(t); if (taps.length > 12) taps.shift();
        flash = t;
        if (taps.length >= 2) bpmNow = Math.round((60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0]));
        return true;
      },
      onStop: () => { if (bpmNow) ok(`Темп: ${bpmNow} BPM. metro ${bpmNow} — метроном в этом темпе.`); },
    });
  });

  // coffee / tea — 418
  egg("coffee tea кофе чай", "", "перерыв на чашку", () => {
    const S = ["   (  )   (\n    )  (   )\n   (  )  (", "    )  (   (\n   (  )   )\n    )  (  )", "   (   )  )\n    ) (  (\n   (   )  )"];
    const CUP = "\n  .---------.\n  |         |]\n  \\         /\n   `-------'";
    ok("418: это чайник, а не кофеварка. Чашка налита.");
    liveStart(4, (n) => (n > 16 ? false : S[n % S.length] + CUP));
  });

  // vim / nano / emacs
  egg("vim vi nano emacs", "", "редактор", () => dim("Выходить из vim не придётся — его здесь нет. А из консоли выходят командой gui."));

  // rm — нельзя
  egg("rm del format", "", "ничего не удаляет", (a) => {
    if (a.join(" ").includes("/") || a.some((x) => /^-\w*r/.test(x))) { err("Хорошая попытка. Вместо этого — котик:"); return art(pick(CATS), "hl"); }
    err("rm: отказано в доступе. Музыку здесь только слушают.");
  });

  // sudo — с правами суперпользователя (нет)
  egg("sudo", "<команда>", "выполнить команду «от имени администратора»", async (a) => {
    if (!a.length) return dim("usage: sudo <команда>");
    dim(`[sudo] пароль для ${userName()}: ********`);
    if (/^(rm|del|format)$/i.test(a[0])) return err(`${userName()} нет в файле sudoers. Об этом инциденте будет доложено котику.`);
    if (a[0].toLowerCase() === "sudo") return err("sudo sudo? Ты и так главный.");
    const c = find(a[0]);
    if (!c) return err(`sudo: ${a[0]}: команда не найдена`);
    dim(pick(["Ладно, на этот раз без пароля.", "Принято, шеф.", "С правами суперпользователя!"]));
    await c.fn(a.slice(1));
  });

  // привет
  egg("hello hi привет", "", "поздороваться", () => {
    const h = new Date().getHours();
    ok(`${h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"}, ${userName()}!`);
    dim(isPlaying() ? "Хороший трек, кстати." : pick(["Может, wave?", "Включить что-нибудь? search <запрос>", "Котик тоже здоровается: cat"]));
  });

  async function accountName() {
    try { const st = await ym("account_status"); return st?.account?.login || st?.account?.displayName || st?.account?.uid || null; } catch { return null; }
  }
  const sessionTime = () => fmtHM(Date.now() - performance.timeOrigin);

  egg("whoami", "", "кто я", async () => {
    const n = await accountName();
    line(n || userName(), "hl");
    dim(`${likedIds.size} ${plRu(likedIds.size, "трек", "трека", "треков")} в лайках`);
  });
  egg("uptime", "", "сколько открыт клиент", () => line(`up ${sessionTime()} · в очереди ${queue?.length || 0} · сейчас ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`));
  egg("ping", "", "проверить связь с Яндекс Музыкой", async () => {
    const t0 = performance.now();
    try { await ym("account_status"); ok(`pong · ${Math.round(performance.now() - t0)} мс`); }
    catch (e) { err("ping: нет ответа (" + (e?.message || e) + ")"); }
  });

  // fetch — карточка в духе neofetch
  egg("fetch neofetch", "", "карточка клиента в духе neofetch", async () => {
    const logo = [
      " __        __ ",
      " \\ \\      / / ",
      "  \\ \\ /\\ / /  ",
      "   \\ V  V /   ",
      "    \\_/\\_/    ",
      "              ",
      "  ~ whisper ~ ",
      "              ",
      "              ",
      "              ",
    ];
    const n = (await accountName()) || userName();
    const t = curT();
    let ver = "";
    try { ver = (await window.__TAURI__?.app?.getVersion?.()) || ""; } catch {}
    const styleName = (cfg.themes || []).find((x) => x.id === cfg.style)?.name || cfg.style;
    const info = [
      `${n}@whisper`,
      "-".repeat(n.length + 8),
      `Клиент: Whisper Edition${ver ? " " + ver : ""}`,
      `Стиль: ${styleName}`,
      `Трек: ${t ? cut(t.title + " — " + artistsOf(t), 44) : "—"}`,
      `Громкость: ${Math.round(volume * 100)}% · ${speed}×`,
      `Лайков: ${likedIds.size}`,
      `Очередь: ${queue?.length || 0}`,
      `Сессия: ${sessionTime()}`,
      "",
    ];
    art(logo.map((l, i) => l + "  " + (info[i] ?? "")).join("\n"), "fetch");
    const sw = line("", "art");
    sw.append(" ".repeat(16));
    for (const c of ["sw1", "sw2", "sw3", "sw4"]) { const s = document.createElement("span"); s.className = c; s.textContent = "███"; sw.append(s); }
  });
})();

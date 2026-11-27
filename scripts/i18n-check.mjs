// Строки интерфейса без перевода: node scripts/i18n-check.mjs [--all] [--out файл]
// Собирает русские строки из src/*.html и src/**/*.js (как их увидит i18n.js: пробелы схлопнуты, ${…} → {},
// разметка внутри строк разрезана на куски) и сравнивает со словарём src/i18n/en.js.
// --all — все строки, а не только непереведённые; --out — записать список в файл (по строке на ключ).
// Консоль (cli.js, cli-eggs.js) и сообщения формата .wmt (core/wmt.js — для авторов тем) не переводятся; замеры (perf.js),
// подсказки ролей ядра и его сообщения для разработчиков (core/whisper-core.js, core/embed.js) — тоже.
// Не для экрана внутри файла (синонимы поиска, текст журнала, правила замены слов) — между строками-комментариями
// «// i18n-off» и «// i18n-on»: строки оттуда в список не попадают.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const SKIP = new Set([path.join("app", "perf.js"), path.join("core", "whisper-core.js"), path.join("core", "embed.js"), path.join("look", "cli.js"), path.join("look", "cli-eggs.js"), path.join("core", "wmt.js"), path.join("i18n", "en.js"), path.join("i18n", "i18n.js"), "webstart.html", "bridge.html"]);
const CY = /[А-Яа-яЁё]/;
const norm = (s) => s.replace(/\s+/g, " ").trim();
const args = process.argv.slice(2);
const all = args.includes("--all"), outAt = args.indexOf("--out");

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!["rust", "docs", "node_modules"].includes(f.name)) walk(p); }
    else if (/\.(js|html)$/.test(f.name) && !SKIP.has(path.relative(root, p))) files.push(p);
  }
})(root);

// Строки JS по порядку: "…", '…' и `…` — в шаблоне ${ … } → {}, а строки внутри ${ } (и вложенные шаблоны
// вроде `${why ? ` (${why.text})` : ""}`) — отдельными строками. Регулярка тут не годится: вложенный шаблон рвал строку.
function literals(t) {
  const out = [];
  let i = 0;
  const quoted = (q) => {                     // i — на открывающей кавычке
    let j = i + 1, s = "";
    while (j < t.length && t[j] !== q && t[j] !== "\n") { if (t[j] === "\\") { s += t[j] + (t[j + 1] ?? ""); j += 2; } else s += t[j++]; }
    i = j + 1; return s;
  };
  const tpl = () => {                         // i — на открывающей обратной кавычке
    let s = ""; i++;
    while (i < t.length && t[i] !== "`") {
      if (t[i] === "\\") { s += t[i] + (t[i + 1] ?? ""); i += 2; }
      else if (t[i] === "$" && t[i + 1] === "{") {
        i += 2; let d = 1;
        while (i < t.length && d) {
          const c = t[i];
          if (c === '"' || c === "'") out.push(quoted(c));
          else if (c === "`") out.push(tpl());
          else if (c === "/" && regexAt()) regex();
          else { if (c === "{") d++; else if (c === "}") d--; i++; }
        }
        s += "{}";
      } else s += t[i++];
    }
    i++; return s;
  };
  // регулярка /…/ — пропустить (в ней бывают кавычки: /[",\n]/); «/» — деление, если перед ним значение
  const regex = () => {
    let j = i + 1, cls = false;
    while (j < t.length && t[j] !== "\n") {
      if (t[j] === "\\") j += 2;
      else if (t[j] === "[") { cls = true; j++; }
      else if (t[j] === "]") { cls = false; j++; }
      else if (t[j] === "/" && !cls) break;
      else j++;
    }
    i = j + 1;
  };
  const regexAt = () => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(t[k])) k--;
    if (k < 0 || /[(,=:[!&|?{};+\-*%<>~^]/.test(t[k])) return true;
    return /\b(return|typeof|case|in|of|void|delete|throw|else|do)$/.test(t.slice(Math.max(0, k - 7), k + 1));
  };
  // "…" + "…" (и шаблоны) подряд — одна строка, как она и выйдет на экран
  const joined = () => {
    let s = t[i] === "`" ? tpl() : quoted(t[i]);
    for (;;) {
      let k = i;
      while (k < t.length && /\s/.test(t[k])) k++;
      if (t[k] !== "+") break;
      k++;
      while (k < t.length && /\s/.test(t[k])) k++;
      if (t[k] !== '"' && t[k] !== "'" && t[k] !== "`") {
        // "…(" + e.message + "). …" — выражение между строками → {}
        let d = 0, e = k;
        for (; e < t.length; e++) {
          const ch = t[e];
          if ("([{".includes(ch)) d++;
          else if (")]}".includes(ch)) { if (!d) break; d--; }
          else if (!d && (ch === "," || ch === ";" || ch === "\n" || ch === "?" || ch === ":" || ch === "+" || ch === "'" || ch === '"' || ch === "`")) break;
        }
        if (t[e] !== "+") break;
        k = e + 1;
        while (k < t.length && /\s/.test(t[k])) k++;
        if (t[k] !== '"' && t[k] !== "'" && t[k] !== "`") break;
        s += "{}";
      }
      i = k;
      s += t[i] === "`" ? tpl() : quoted(t[i]);
    }
    return s;
  };
  while (i < t.length) {
    const c = t[i];
    if (c === "/" && t[i + 1] === "/") { while (i < t.length && t[i] !== "\n") i++; }          // комментарий до конца строки
    else if (c === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); i = e < 0 ? t.length : e + 2; }
    else if (c === '"' || c === "'" || c === "`") out.push(joined());
    else if (c === "/" && regexAt()) regex();
    else i++;
  }
  return out;
}

const unesc = (s) => s.replace(/\\n/g, "\n").replace(/\\(["'`\\])/g, "$1").replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));

const found = new Map();   // ключ → файл
function add(raw, file, js) {
  // подсказки в разметке внутри строки JS (`<button title="…">`)
  if (js && raw.includes("<")) {
    const ar = /\s(?:title|placeholder|aria-label|alt)="([^"]*)"/g; let a;
    while ((a = ar.exec(raw))) if (CY.test(a[1])) add(a[1], file, false);
  }
  // разметка внутри строки — отдельные текстовые узлы
  for (let part of raw.split(/<[^>]*>/)) {
    if (!CY.test(part)) continue;
    part = part.replace(/&nbsp;/g, " ").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&mdash;/g, "—").replace(/&amp;/g, "&");
    let k = norm(part);
    // "На паузе · " + artist → "На паузе · {}"; ", " + x — склейка в JS
    if (js && raw === part) {
      if (/[\s·:—–(«]$/.test(part) && !/\{\}$/.test(k)) k += /\s$/.test(part) ? " {}" : "{}";
      if (/^[\s·—–)»,.]/.test(part) && !/^\{\}/.test(k)) k = (/^\s/.test(part) ? "{} " : "{}") + k;
    }
    if (k.length > 400 || k.length < 2) continue;      // одна буква — значок или единица («Я», «ч»): не фраза
    if (!found.has(k)) found.set(k, path.relative(root, file));
  }
}

for (const f of files) {
  let t = fs.readFileSync(f, "utf8");
  if (f.endsWith(".html")) {
    t = t.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
    let m; const re = />([^<>]+)</g;
    while ((m = re.exec(t))) add(m[1], f, false);
    const ar = /\s(?:title|placeholder|aria-label|alt)="([^"]*)"/g;
    while ((m = ar.exec(t))) add(m[1], f, false);
    continue;
  }
  // строки JS: куски «// i18n-off … // i18n-on», комментарии (их пропускает literals) и console.* не в счёт
  t = t.replace(/^[ \t]*\/\/ i18n-off\b[\s\S]*?^[ \t]*\/\/ i18n-on\b.*$/gm, "");
  t = t.replace(/\/\*[\s\S]*?\*\//g, "");
  // console.*, замеры (perfMark, step) и записи журнала ошибок (errLog.add) — не экран
  const lines = t.split("\n").filter((l) => !/console\.(log|warn|error|debug)|perfMark\?*\.?\(|\bstep\("|errLog\?*\.add\(/.test(l));
  t = lines.join("\n");
  for (const s of literals(t)) if (CY.test(s)) add(unesc(s), f, true);
}

let dict = {};
const dp = path.join(root, "i18n", "en.js");
if (fs.existsSync(dp)) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(dp, "utf8"), ctx);
  dict = ctx.window.I18N_EN || {};
}
const has = (k) => Object.prototype.hasOwnProperty.call(dict, k);
const list = [...found].filter(([k]) => all || !has(k));
const text = list.map(([k, f]) => `${f}\t${k}`).join("\n");
if (outAt >= 0) fs.writeFileSync(args[outAt + 1], text + "\n");
else if (list.length) console.log(text);
const miss = [...found.keys()].filter((k) => !has(k)).length;
console.error(`строк: ${found.size}, без перевода: ${miss}, в словаре: ${Object.keys(dict).length}`);

// Перед тестами: запустить собранное приложение в режиме автотеста и дождаться адреса браузерной версии.
// Уже открытое приложение закрываем: второй экземпляр просто отдал бы запуск первому.
// Настройки пользователя тесты не меняют: вкладка получает их копию, а приложение потом закрывается, не забирая их назад.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXE = path.join(ROOT, "src-tauri", "target", "release", process.platform === "win32" ? "yandex-desktop.exe" : "yandex-desktop");
const OUT = path.join(import.meta.dirname, "out");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function closeRunning() {
  try {
    if (process.platform === "win32") execSync("taskkill /IM yandex-desktop.exe /F", { stdio: "ignore" });
    else execSync("pkill -x yandex-desktop", { stdio: "ignore" });
  } catch {}                       // не было запущено
}

export default async function setup() {
  if (!fs.existsSync(EXE)) throw new Error(`Нет сборки ${EXE} — сначала npm run build (или scripts/smoke.ps1 -Build)`);
  closeRunning();
  await sleep(800);
  fs.mkdirSync(OUT, { recursive: true });
  const urlFile = path.join(OUT, "url.txt");
  fs.rmSync(urlFile, { force: true });
  const app = spawn(EXE, [], {
    env: { ...process.env, WHISPER_PERF: path.join(OUT, "perf.log"), WHISPER_PERF_AUTO: "6", WHISPER_WEB_URL: urlFile },
    stdio: "ignore",
  });
  const t0 = Date.now();
  for (;;) {
    const url = fs.existsSync(urlFile) ? fs.readFileSync(urlFile, "utf8").trim() : "";
    if (/^http:\/\/127\.0\.0\.1:\d+\/__web\/start\?k=/.test(url)) { process.env.WHISPER_TEST_URL = url; break; }
    if (app.exitCode !== null) throw new Error("Приложение закрылось, не открыв браузерную версию (журнал — tests/web/out/perf.log)");
    if (Date.now() - t0 > 90_000) { app.kill(); throw new Error("За 90 с приложение не открыло браузерную версию (журнал — tests/web/out/perf.log)"); }
    await sleep(500);
  }
  return async () => { app.kill(); closeRunning(); };
}

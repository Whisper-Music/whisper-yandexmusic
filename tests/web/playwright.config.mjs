// Автотесты интерфейса через браузерную версию (webmode.rs): setup.mjs запускает собранное приложение, оно само
// открывает «Браузерную версию» (WHISPER_PERF_AUTO=6) и пишет адрес вкладки в файл, а Playwright открывает её в Edge.
// Запуск: npm run test:web (сначала собрать: npm run build или scripts/smoke.ps1 -Build). Снимки стилей —
// app.spec.mjs-snapshots/, обновить: npm run test:web:update. Отчёт и снимки прогона — tests/web/out/ (не в git).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  outputDir: "out/results",
  globalSetup: "./setup.mjs",
  workers: 1,                      // приложение одно — тесты по очереди, на одной вкладке
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" } },
  reporter: [["list"], ["html", { outputFolder: "out/report", open: "never" }]],
  use: {
    channel: process.env.WHISPER_TEST_BROWSER || "msedge",   // Edge есть в любой Windows — качать браузер не нужно
    headless: !process.env.WHISPER_TEST_SHOW,               // WHISPER_TEST_SHOW=1 — смотреть, как идут тесты
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] },   // тесты играют треки — без звука в колонках
    locale: "ru-RU",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

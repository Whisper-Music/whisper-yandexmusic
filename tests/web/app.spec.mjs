// Интерфейс во вкладке браузерной версии: запуск без ошибок, основные страницы, четыре встроенных стиля (снимки).
// Данные — настоящие (твой аккаунт Яндекса, лайки, обои), поэтому снимки — только настроек: обои на время снимка
// спрятаны, плеер закрыт маской. Изменил вид настроек или свои цвета стиля — обнови снимки: npm run test:web:update.
import { test, expect } from "@playwright/test";

const STYLES = ["neon", "royal", "steam", "lolitta"];
const TABS = ["look", "ui"];          // вкладки настроек для снимков: в остальных — размеры кэша, статистика и т. п.
const BAD = /SyntaxError|ReferenceError|TypeError|is not defined|is not a function/;

test.describe.configure({ mode: "serial" });

/** @type {import("@playwright/test").Page} */
let page;
const errors = [], logs = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e?.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await page.goto(process.env.WHISPER_TEST_URL);
  await page.waitForFunction(() => document.documentElement.classList.contains("webmode") && window.Whisper && document.getElementById("wave"), null, { timeout: 60_000 });
});

test.afterAll(async () => { await page?.close(); });

const nav = (id) => page.locator(`#${id}`).click();
const masks = () => [page.locator(".player")];
// обои и слои эффектов — на всё окно (маска закрыла бы весь снимок) и у каждого свои: на время снимков прячем их
// (style из JS — CSSOM, CSP это разрешает), под ними остаётся цвет фона стиля
const BG = ["#bg", "#dim", "#fxLayer", "#fxCanvas"];
const bgHide = (on) => page.evaluate(([ids, on]) => ids.forEach((id) => { const e = document.querySelector(id); if (e) e.style.visibility = on ? "hidden" : ""; }), [BG, on]);

test("запуск без ошибок", async ({}, info) => {
  await page.waitForTimeout(3000);                 // модули и первые запросы
  const journal = await page.evaluate(() => (window.errLog?.list?.() || []).map((e) => `[${e.k}] ${e.t}`));
  await info.attach("журнал ошибок приложения", { body: journal.join("\n") || "пусто", contentType: "text/plain" });
  await info.attach("console.error", { body: logs.join("\n") || "пусто", contentType: "text/plain" });
  expect(errors, "необработанные ошибки страницы").toEqual([]);
  expect(logs.filter((l) => BAD.test(l)), "ошибки JS в консоли").toEqual([]);
});

test("страницы открываются", async ({}, info) => {
  await nav("wave");
  await expect(page.locator("#wavePage")).toBeVisible();
  await info.attach("волна", { body: await page.screenshot(), contentType: "image/png" });

  await nav("likes");
  await expect(page.locator("#list li").first()).toBeVisible();
  await info.attach("лайки", { body: await page.screenshot(), contentType: "image/png" });

  await nav("statsBtn");
  await expect(page.locator("#statsPage")).toBeVisible();

  await nav("settingsBtn");
  await expect(page.locator("#settingsPage")).toBeVisible();

  await page.locator("#search").fill("Кино");
  await page.locator("#search").press("Enter");
  await expect(page.locator("#list li").first()).toBeVisible();
  await info.attach("поиск", { body: await page.screenshot(), contentType: "image/png" });
});

test("меню трека открывается и закрывается", async () => {
  await nav("likes");
  const row = page.locator("#list li").first();
  await expect(row).toBeVisible();
  await row.hover();
  await row.locator(".morebtn").click();
  await expect(page.locator(".tmenu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tmenu")).toBeHidden();
});

test("командная строка (Ctrl+K)", async ({}, info) => {
  await nav("likes");
  await page.keyboard.press("Control+K");
  const input = page.locator(".cpalinput");
  await expect(input).toBeFocused();
  await input.fill("vol");
  await expect(page.locator(".cpalrow").first()).toContainText("vol");
  await input.press("Enter");
  await expect(page.locator(".cpalout .cl").nth(1)).toBeVisible();          // команда выполнилась: строка команды + ответ
  await input.fill("громк");
  await page.waitForTimeout(500);
  await info.attach("командная строка", { body: await page.screenshot({ path: "tests/web/out/palette.png" }), contentType: "image/png" });
  await input.fill("lolitta");
  await expect(page.locator(".cpalrow").first()).toContainText(/lolitta/i);
  await input.press("Enter");                                                 // стиль по названию — окно закрывается
  await expect(page.locator(".cpal")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-style", "lolitta");
  await page.keyboard.press("Control+K");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cpal")).toHaveCount(0);
  expect(errors, "ошибки в командной строке").toEqual([]);
});

test("«Что нового» и знакомство", async ({}, info) => {
  await page.evaluate(() => window.whatsNew());
  expect(await page.locator(".dtwrap .wnver").count()).toBeGreaterThan(4);
  await info.attach("что нового", { body: await page.screenshot({ path: "tests/web/out/whatsnew.png" }), contentType: "image/png" });
  await page.locator(".dtwrap .dtx").click();
  await expect(page.locator(".dtwrap")).toHaveCount(0);
  await page.evaluate(() => window.welcomeOpen());
  await expect(page.locator(".wlc")).toBeVisible();
  await info.attach("знакомство", { body: await page.screenshot({ path: "tests/web/out/welcome.png" }), contentType: "image/png" });
  for (let i = 0; i < 8 && (await page.locator(".wlc").count()); i++) await page.locator(".wlcnav .nav.active").click();
  await expect(page.locator(".wlc")).toHaveCount(0);
  expect(errors, "ошибки в «Что нового» / знакомстве").toEqual([]);
});

test("DJ-переход: следующий трек входит поверх прошлого", async () => {
  test.setTimeout(150_000);
  await nav("likes");
  await page.evaluate(() => window.xfPrefs.set({ dj: true, djLen: 4 }));
  await page.evaluate(() => document.querySelector("#list li").click());      // строка целиком (название ведёт в альбом)
  await page.waitForFunction(() => window.audio && !window.audio.paused && window.audio.duration > 40, null, { timeout: 40_000 });
  const first = await page.evaluate(() => window.current);
  // ближе к концу: края трека (audio_edges) меряются, пока он играет; переход — за 4 с до конца звучащей части
  await page.evaluate(() => { window.audio.currentTime = window.audio.duration - 25; });
  await page.waitForFunction(() => window.xfState().tail, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.current), "следующий трек уже включён").not.toBe(first);
  await page.waitForFunction(() => !window.xfState().tail, null, { timeout: 20_000 });       // прошлый затих и выключился
  expect(await page.evaluate(() => !window.audio.paused), "новый играет").toBe(true);
  await page.evaluate(() => { window.audio.pause(); window.xfPrefs.set({ dj: false }); });
  expect(errors, "ошибки при DJ-переходе").toEqual([]);
});

for (const style of STYLES) {
  test(`стиль ${style}`, async ({}, info) => {
    await nav("settingsBtn");
    await page.locator('#setTabs .chip[data-tab="look"]').click();
    await page.locator(`.stylecard[data-style="${style}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("data-style", style);
    await page.waitForTimeout(800);                // шрифты и картинки стиля
    await bgHide(true);
    try {
      for (const tab of TABS) {
        await page.locator(`#setTabs .chip[data-tab="${tab}"]`).click();
        await page.waitForTimeout(300);
        await expect(page).toHaveScreenshot(`${style}-${tab}.png`, { mask: masks() });
      }
    } finally { await bgHide(false); }
    await nav("wave");
    await expect(page.locator("#wavePage")).toBeVisible();
    await info.attach(`${style}: волна`, { body: await page.screenshot(), contentType: "image/png" });
    expect(errors, "ошибки после смены стиля").toEqual([]);
  });
}

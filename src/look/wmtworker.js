// Разбор тем .wmt в отдельном потоке (theme.js → openThemeBg). Распаковка архива, разбор текста и JSON, base64 старых
// тем — это десятки миллисекунд на тему, и при запуске они стояли прямо перед показом интерфейса. DOM здесь не нужен:
// тот же core/wmt.js, что и на странице. Обратно уходят данные темы без методов (их возвращает theme.js → revive),
// байты ресурсов — без копирования (transfer).
importScripts("../core/wmt.js");

self.onmessage = async ({ data: { id, input } }) => {
  try {
    const th = await self.WMT.open(input);
    const assets = [...th.assets.entries()];
    const moved = [];
    for (const [, a] of assets) if (a.bytes?.buffer && !moved.includes(a.bytes.buffer)) moved.push(a.bytes.buffer);
    self.postMessage({
      id,
      th: {
        version: th.version, preamble: th.preamble, manifest: th.manifest, tokens: th.tokens, sections: th.sections,
        archive: th.archive, assets, bg: th.background?.name ?? null,
      },
    }, moved);
  } catch (e) {
    // ошибка самой темы (битый файл) — как на странице; theme.js решает, что с ней делать
    self.postMessage({ id, err: String(e?.message || e), line: e?.line || 0, wmt: e?.name === "WmtError" });
  }
};

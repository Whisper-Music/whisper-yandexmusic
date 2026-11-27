# Yandex Music — Whisper Edition

Неофициальный десктопный клиент Яндекс Музыки на **Tauri 2** (Rust + системный WebView: WebView2 в Windows,
WebKitGTK в Linux). Фронтенд — **чистый JS/CSS/HTML без сборщика и фреймворков**. Свои темы оформления — файлы `.wmt`.
Автор — Вадим. Версия — одна, в `package.json` (сейчас 1.2.x): `npm run version X.Y.Z` (scripts/set-version.mjs) сам
переносит её в `src-tauri/Cargo.toml`, `Cargo.lock` и `package-lock.json`; `tauri.conf.json` берёт её из package.json
(`"version": "../package.json"`). Руками в Cargo.toml и tauri.conf.json версию не меняй.
Новая версия — ещё и запись сверху в `src/app/changes.js` (её покажет «Что нового» после обновления).

## Язык и стиль

- Интерфейс, комментарии, документация, сообщения коммитов — **по-русски**. Тексты в UI — простые и дружелюбные,
  на «ты», без канцелярита («Нажми, чтобы…», «Не удалось сохранить: …»).
- Комментарии объясняют **почему**, а не что; коротко, по-человечески. Стиль комментариев в файле сохраняй.
- Код плотный: короткие функции, `const $ = (s) => document.querySelector(s)`, однострочники там, где читаемо.
  Не переписывай чужой код «под себя» без причины.
- Новую самостоятельную функцию удобнее делать **отдельным модулем** `src/<папка>/<имя>.js` (+ `<имя>.css`) — ES-модулем с
  `export` (см. «Скрипты, модули и общее состояние»); `main.js` — только состояние и запуск.

## Архитектура: модули и папки — держим так

Код разнесён по папкам и небольшим модулям — **это обязательная архитектура, а не разовая уборка**. Всё новое пиши так же:

- **Своё место для каждой функции.** Новая возможность — свой файл в папке по смыслу (`app/` основа, `player/`, `pages/`,
  `look/`, `library/`, `settings/`, `mobile/`, `web/`, `windows/`), а не дописка в чужой большой файл. `main.js` — только общее
  состояние и запуск. Ядро `src/core` — только общее для всех приложений Whisper, правится отдельным коммитом в whisper-core.
- **Размер.** Файл перерос ~500 строк JS или ~400 строк CSS, или в нём смешались разные темы — дели по разделам: рядом файлом
  с понятным именем (`cli.js` + `cli-eggs.js`, `studio.js` + `studioshare.js` + `studioinfo.js`) или папкой с нумерацией
  для CSS (`look/styles/`, `look/layout/`, `mobile/styles/`).
- **Связи — через `import`/`export`** (правила — «Скрипты, модули и общее состояние»). Обратный `import` (A ↔ B) не заводи:
  то, что модулю-помощнику нужно от главного, тот отдаёт ему функцией настройки (`shareSetup({ … })`) или объектом (`cliKit`).
  `window` — только для обычных скриптов и `window.X` из Rust/Android/ядра; общее состояние — свойства window из main.js.
- **CSS делится только подряд**, по границам правил: файлы подключаются в index.html в том же порядке (порядок = сила
  правил). Переносить блок выше/ниже можно, только если у него нет общих селекторов с правилами, через которые он переносится.
- **После переноса** — `node --check` (модуль — копией в `.mjs`), `npm run test:web`, `scripts/smoke.ps1 -Build` (все проверки ok,
  `smoke:errors нет`), обнови index.html, описание в «Структуре» ниже и, если новый модуль экспортирует то, что проверяет
  perf.js, — список `MODS` в нём. Новую заметную возможность — добавь проверкой в smoke (perf.js → `smoke()`).

## Запуск и сборка

```bash
git submodule update --init   # ядро Whisper (src/core) — подмодуль, без него приложение не соберётся
npm install
npm run tauri dev      # разработка
npm run build          # установщик для себя (Windows: …_x64-setup.exe; Linux — см. README): без подписи обновлений
npm run tauri build    # как в CI: с .sig для latest.json — нужен ключ TAURI_SIGNING_PRIVATE_KEY
```

- `npm run build` = `tauri build --config src-tauri/tauri.local.conf.json` (`createUpdaterArtifacts: false`): ни ключа, ни
  `.sig` рядом с установщиком. Выпуски собирает только CI (release.yml): там подписи нужны — из них tauri-action собирает
  `latest.json`, сами `.sig` в выпуск не выкладываются (`uploadUpdaterSignatures: false`).
- Release-профиль в Cargo.toml облегчён (без LTO, 16 частей) — полный LTO включает CI переменными `CARGO_PROFILE_RELEASE_*`.
- Всё из `src/` (frontendDist) Tauri встраивает в exe и в release сжимает brotli в один поток. `build.rs` (check_frontend)
  останавливает release-сборку, если в `src/` есть папка `target`/`node_modules` или файлов больше 100 МБ (в dev —
  предупреждение). Крейт проверки ядра `src/core/rust/check` после `cargo check` оставляет такую `target` — удаляй её.

- Проверка — три уровня (после правок — все, что задевают):
  * `node --check src/файл.js` — синтаксис (ES-модуль — копией в `.mjs`);
  * `scripts/smoke.ps1 -Build` — сборка и прогон в окне (WHISPER_PERF_AUTO=5, perf.js → `smoke()`): страницы, плеер,
    меню, консоль, студия… В конце `smoke:errors нет`. Новая заметная возможность — добавь свою проверку в `smoke()`;
  * `npm run test:web` — Playwright (tests/web): приложение само открывает браузерную версию (WHISPER_PERF_AUTO=6,
    адрес — в файл WHISPER_WEB_URL, webmode.rs), тесты идут во вкладке Edge: запуск без ошибок, страницы, меню трека,
    снимки настроек в 4 встроенных стилях (`tests/web/app.spec.mjs-snapshots`, обои прячутся, плеер — маской).
    Нужна сборка (`npm run build` или smoke.ps1 -Build); запущенное приложение тест закрывает. Настройки не меняются:
    вкладка работает с копией, а приложение закрывается, не забирая её. Вид поменялся нарочно (стиль, карточки
    «Оформления»/«Интерфейса», свои темы в списке) — `npm run test:web:update` и посмотри новые снимки глазами.
    Отчёт со снимками страниц — tests/web/out/report (`npx playwright show-report tests/web/out/report`).
  После правок JS достаточно перезапуска dev, после Rust — пересборка.
- CI: `.github/workflows/release.yml` (выпуски, подпись обновлений; job `virustotal` — .exe/.msi/.apk черновика в VirusTotal,
  ключ — секрет `VT_API_KEY`, ссылки на отчёты дописываются в описание выпуска между `<!-- vt:start -->` и `<!-- vt:end -->`
  вместе с предупреждением о ложных срабатываниях на неподписанный установщик; без ключа шаг пропускается),
  `security.yml` (аудит зависимостей; `src-tauri/deny.toml`, `.cargo/audit.toml`).

## Структура

```
src/                      фронтенд (без сборки, файлы отдаются как есть). В корне — только страницы (index.html, mini.html,
                          notifywin.html, bridge.html, webstart.html) и favicon.png; остальное — по папкам:
                            app/      запуск и общее: main.js (общее состояние и порядок запуска — ~90 строк), base (invoke, $, DynCss, ICON,
                                      ym, lsJSON, safeUrl…), offline, menu (меню, тосты, modal), trackmenu (меню трека, скорость), nav
                                      (setHead, navigate/goTop, закладки, значки «играет», трей), pins (закреплённые, колонка сбоку), list
                                      (renderList, строки, альбомы/артисты), login (вход, «Профиль», выход), window (кнопки окна),
                                      boot.js, lsguard.js, perf.js, imgguard.js, yandex.js
                            player/   звук и очередь: core (play, showTrack, звуковой граф, кнопки плеера), volume (громкость, ползунки),
                                      modes (перемешивание, повтор, следующий/предыдущий), like (лайк и «не нравится» трека), full (плеер
                                      на весь экран, текст песни), viz (отрисовка визуализатора), sleep, eq, output, engine, sound,
                                      devprofile, transitions, prefetch, cache, plays
                            pages/    страницы: wave («Моя волна», станции), likes («Лайки», снимок, офлайн), playlists, search,
                                      artist (автор и альбом), artistprefs (лайк автора, «не рекомендовать»), stats («Статистика» по лайкам
                                      + форматы чисел), listenstats, studio(+info), pagecache
                            look/     оформление: styles/ (01-base … 11-extras — бывший styles.css, см. «Прочее»), config (cfg, встроенные стили, applyCfg, возможности тем, вкладка «Оформление»),
                                      colors («Тонкая настройка цветов»), bg (фон, видеообои, IDB), dynbg (динамический фон, палитра), lolitta
                                      (украшения), theme*, themefx, themelib, themeguard, wmtworker, layout, panels, mascot, dust, imgview,
                                      uifont, cli
                            settings/ настройки и служебное: tabs (вкладки настроек), setpage, details, backup, hotkeys, keynav, notify,
                                      update, traymini, tmenu, errinfo, errlog
                            library/  свои треки и выгрузки: downloads (скачанное, «Скачать альбом/лайки», папка загрузок),
                                      share, dropin, linkadd, linkalbum (альбом по ссылке), libsync, listexport
                            web/      браузерная версия; windows/ — мини-плеер и окно уведомлений
                            mobile/   телефон: mobile.js (обычный, ранний — признак isMobile, invoke, отступы, «Назад», словарь
                                      «как на компьютере»), модули words, sections (нижняя панель, профиль, свайпы), player,
                                      extras (тема извне, автоскачивание, старый WebView), start (запуск по DOMContentLoaded —
                                      его зовёт mobile.js: window.mobileStart), mobilemedia (уведомление плеера Android); styles/01…06 — бывший
                                      mobile.css по разделам (общее, списки, плеер, волна и профиль, настройки, страницы);
                                      где в комментариях «mobile.css» — это они
                            i18n/     i18n.js + en.js; assets/ — картинки (cover-w.svg, tray-mono.png)
                          Ниже файлы названы без папки. Пути в JS (картинки, new Worker) — от index.html; importScripts
                          в воркере — от файла воркера.
  core/                   ЯДРО Whisper — ПОДМОДУЛЬ git (репозиторий Whisper-Music/whisper-core, общий с Whisper VK).
                          Правки ядра — коммит в whisper-core, потом в приложении `git add src/core` (см. ниже)
  core/whisper-core.js    ядро: шина событий, сущности, провайдер и
                          возможности, Whisper.player / Whisper.queue, роли интерфейса для тем. Подробно — src/core/docs/CORE.md
  core/queue.js/.css      ОБЩИЙ модуль «Очередь и история» (клавиша Q) — только через Whisper.*, без переменных main.js
  core/together.js        ОБЩИЙ модуль «Слушать вместе» (комнаты через сервер архива): плеер — Whisper.player
                          (playTrack/reload/media/setRate), трек для сервера — provider.toRoom/fromRoom; стили — core/together.css
                          (сразу после styles.css; в styles.css — только гость на «Моей волне» и затемнённые кнопки)
  core/archive.js/.css    ОБЩИЙ модуль Whisper Archive: источник звука «archive» (Whisper.sources), вход, карточка
                          в «Интеграциях», «Сохранить в архив» (Whisper.ui.trackMenu; файл трека — provider.archiveSave)
  core/friends.js/.css    ОБЩИЙ модуль «Друзья» (kit.page("friends") — кнопка #friendsBtn): список, заявки, поиск, профиль друга
  core/profile.js/.css    ОБЩИЙ свой профиль Whisper Archive (kit.page("waprofile", { btn: kit.profileButton(), bind: false });
                          Whisper.ui.kit отдаёт модулям ТОЛЬКО функции — строку или число в provide модуль не увидит):
                          аватар (сменить/убрать), никнейм (раз в час), место, свои и лайкнутые альбомы (послушать), друзья.
                          Открывает main.js: кнопка «Профиль» → окно выбора «Whisper Archive» (эта страница) / «Яндекс»
                          (id.yandex.ru в браузере) / «Выйти из Яндекса» (logoutYandex). Rust — whisper/profile.rs (wa_my_*),
                          сервер — /api/app/me (AppProfileController: по API-ключу только лицо; устройства и синхронизация —
                          только на сайте, кнопка «Устройства — на сайте ↗»)
  core/wmt.js             ОБЩИЙ формат .wmt: разбор/сборка (без зависимостей; браузер и Node 18+)
  core/theme-css.js       ОБЩИЙ движок CSS тем: привязка к стилю, фильтр безопасности (cssSafe), роли, tokens, OBS
  core/rust/whisper/      ОБЩИЙ Whisper Archive на Rust (подключён из src-tauri/src/lib.rs через #[path]): mod (ключ,
                          альбомы), auth (вход по почте), upload (загрузка в архив), stream (протокол wa://), rooms
  core/docs/              CORE.md (ядро целиком), WMT-FORMAT.md (формат .wmt)
  yandex.js               Яндекс в ядре: роли разметки (Whisper.ui.define), провайдер «yandex», привязка плеера main.js,
                          операции с очередью (upcoming/remove/move/«играть следующим» — у main.js свой порядок
                          перемешивания), набор интерфейса для общих модулей (Whisper.ui.provide: toast, confirm, меню трека…)
  index.html              вся разметка: окно, страницы, настройки, плеер
  boot.js                 первым, БЕЗ defer: стиль прошлого запуска и «шторка» до первой отрисовки
  i18n.js + i18n/en.js    язык интерфейса (Интерфейс → карточка «Язык / Language» #langCard под маскотом, localStorage ym_lang), БЕЗ defer,
                          после lsguard.js; также в mini.html и notifywin.html. Код пишется по-русски, при английском
                          i18n.js подменяет текст на экране по словарю (см. «Язык интерфейса» ниже)
  webmode.js/.css, webstate.js, webshim.js, bridge.html/js, webstart.html/js — браузерная версия (Rust — webmode.rs),
                          см. «Браузерная версия» ниже
  main.js                 общее состояние (queue, current, audio, wave, likes, PL…) и порядок запуска; остальное — модули
  look/styles/*.css       общее оформление + встроенные стили (:root[data-style="neon|royal|steam|lolitta"]), 20 файлов по порядку
  theme.js / theme.css    свои темы в этом приложении: загрузка, хранение, фон, сохранение в файл, карточки стилей
  wmtworker.js            разбор сохранённых тем .wmt в Web Worker (theme.js → openThemeBg → revive); не запустился —
                          разбор на странице. Воркеры — только из своих файлов (CSP worker-src 'self'), DOM и __TAURI__ им не видны
  themelib.js/.css        «Библиотека тем» (репозиторий Whisper-Music/whisper-themes). Новая версия ВКЛЮЧЁННОЙ своей темы —
                          тост «Вышла новая версия темы… · Обновить» (через 20 с после запуска и при смене стиля; index.json —
                          не чаще раза в 6 ч; про одну версию — один раз, localStorage ym_theme_upd { id: версия })
  listexport.js           экспорт лайков и плейлистов: правый щелчок → «Экспорт» (tmenu.js → exportItem) → TXT («Исполнитель -
                          Название» — импорт Яндекса, TuneMyMusic, Soundiiz), CSV (колонки TuneMyMusic), JSON (все данные);
                          файл пишет Rust export_save (export.rs, общий с PDF статистики; заголовки x-file-name / x-file-ext)
  themefx.js              «живые» темы: события для CSS (.w-tap, body.ev-*, --tap-x/y), курсор (--mx/--my/--mpx/--mpy),
                          слой украшений #fxLayer, частицы на холсте #fxCanvas. Настройки разбирает theme.js → setHooks
                          (themeHooks[id].events/pointer/layer/particles), применяет main.js → applyHooks → themeFxApply;
                          бит — main.js (детектор визуализатора) → window.themeFxBeat
  core/discord.js/.css    ОБЩИЙ модуль Discord Rich Presence (Rust — core/rust/discord.rs); карточку в «Интеграциях» ставит сам
  core/obs.js/.css        ОБЩИЙ виджет «Сейчас играет» для OBS (Rust — core/rust/obs.rs, страница — core/rust/obs/widget.*);
                          цвета и секции whisper-obs стиля берёт из kit.accentColors / kit.obsTheme (yandex.js)
  cli.js                  консоль вместо интерфейса (тема с "console"): вывод, команды, строка состояния; cliKit — для cli-eggs.js
  cli-eggs.js             скрытые команды консоли (visual, cat, piano, metro, party…): регистрирует их в cliKit.CMDS,
                          живой блок и вывод берёт у cli.js; таймеры/классы, которые надо снять при выходе, — в cliKit.exit
  palette.js/.css         (app/) командная строка, Ctrl+K: одно поле посреди экрана — страницы, действия, стили, настройки
                          (settings/setpage.js → settingsIndex, переход — window.openSetting), команды консоли (cliKit.CMDS;
                          выполняет cliKit.exec — вывод в окне), треки/альбомы/исполнители (cliKit.searchApi). Подсказка под
                          полем — по введённому; недавнее — localStorage ym_palette_recent; разовый совет — ym_palette_tip.
                          Новая заметная возможность — добавь её сюда (PAGES / ACTIONS) или командой в cli.js — так её найдут
  welcome.js/.css         (app/) знакомство при первом запуске (стиль → вход → где темы → Ctrl+K; только новому человеку:
                          нет ym_welcome и ym_uid; заново — window.welcomeOpen) и «Что нового»: карточка в углу после
                          обновления (версии новее ym_seen_version), окно всей истории — window.whatsNew (версия «v1.2.5» под
                          «Профилем» — #sideVer, скрыта в свёрнутой панели/мини-виде/на телефоне; кнопка #updHistory
                          в «Обновлениях», пункт командной строки). Во вкладке браузерной версии само не показывается
  changes.js              (app/) история изменений по версиям: { v, date, title?, ru: [...], en: [...] } — НОВАЯ ВЕРСИЯ =
                          НОВАЯ ЗАПИСЬ СВЕРХУ (коротко, на «ты», про заметное человеку). Тексты двуязычные, i18n-off
  hotkeys.js/.css         ГЛОБАЛЬНЫЕ сочетания (регистрирует Rust, работают в свёрнутом окне)
  keynav.js               навигация клавиатурой ВНУТРИ окна (стрелки, Пробел, Ctrl+F, F1 — список клавиш)
  imgview.js              аватарка артиста / обложка альбома на весь экран (щелчок по #headImg)
  details.js/.css         общее окно «Подробнее» для настроек: window.openDetails(…) (см. «Настройки»)
  setpage.js/.css         страница настроек: поиск (Ctrl+F), window.openSetting(…), вкладки сверху/слева
  dust.js                 «распад на пиксели»: window.rowDust(li) — строка, убранная из лайков (main.js → toggleLike на
                          открытой странице «Лайки», в подсказке «Вернуть»), перерисовывается на холст (фон, обложка, текст)
                          и разлетается квадратиками; анимации выключены — строка просто убирается
  ползунки #seek/#fSeek   щелчок и перетаскивание считает main.js (rangeGrab): значение по точке под курсором, события
                          input/change как у обычного ползунка; пока тянут — seekDrag, ontimeupdate ползунок не трогает
  uifont.js               шрифт интерфейса из установленных в системе (Оформление → Шрифт)
  transitions.js          «Пропускать тишину» и «Плавные переходы» (localStorage ym_xfade). Rust edges.rs (audio_edges) декодирует
                          трек (symphonia; Яндекс — в экономном качестве) → { dur, start, end, head_db, tail_db }; следующий
                          меряется заранее. Тишина: перемотка к start, на end — audio.onended(). Переход — множитель громкости
                          window.xfK(a) в outVol() (main.js): конец затихает до уровня начала следующего или следующий входит
                          с уровня конца и за 2,5 с поднимается. У гостя «Слушать вместе» — выключено.
                          DJ-переход (st.dj, djLen 2–15 с): за djLen до конца звучащей части — audio.onended(), core.js play() отдаёт
                          старый плеер в window.xfTail (доигрывает и затихает по cos, новый входит по sin). Эксклюзивный режим —
                          смешивает engine.rs: engine_dj (второй декодер в том же потоке WASAPI, Cmd::Mix), план — xfTakeNativeDj,
                          старый NativeAudio — _detach (больше не шлёт команд); «DJ: …» — откат на engine_load. Телевизор — без наложения.
                          «Волна по темпу и тональности» (st.match): edges.rs заодно считает tone.rs { bpm, bpm_sure, key, minor,
                          key_sure, camelot }; из ближайших 4 треков волны следующим ставится темп ±6 % (или ×2/½) и соседняя тональность
                          по Camelot (Whisper.queue.move); подходящего нет — порядок волны не трогается
  cast.js                 вывод на телевизор (DLNA/UPnP; Rust — dlna.rs, только std + md5/getrandom): карточка #castCard (Звук).
                          window.cast.create() — плеер-пульт с интерфейсом <audio> (_native, _cast), core.js makeAudio выбирает его,
                          пока выбран телевизор. dlna_scan (SSDP, только частные адреса, описание — с ответившего адреса),
                          dlna_cast (трек целиком в память → HTTP-сервер на адресе интерфейса до телевизора, отвечает только
                          телевизору, /m/<ключ 128 бит>; Range), dlna_play/pause/seek/volume/status/stop. Состояние опрашивается
                          раз в секунду: STOPPED у конца — ended, раньше — пауза. Громкость телевизора — только за ползунком приложения
  sleep, eq, output, engine, sound — режим сна, эквалайзер, устройство вывода, свой WASAPI-движок, качество/нормализация
                          (sleep.js → window.sleepActive() → kit.sleeping: «Засыпает · …» в Discord; в комнате — «Слушает вместе · …»)
  layout.js, layout/*.css режимы «Расположения» (без defer), колонка и скрытие закреплённых (см. «Расположение и закреплённые»);
                          CSS — look/layout/01…05 (стороны, закреплённые, панели, мини-вид, время и карточка); где в
                          комментариях «layout.css» — это они
  mascot, listenstats, traymini, update, imgguard — маскот, статистика, трей, автообновление, заглушки картинок
  plays.js                отчёты Яндексу о прослушиваниях (/play-audio, op play_audio, uid подставляет Rust) — при ЛЮБОМ
                          источнике звука (Яндекс, архив, скачанный, «Слушать вместе»), чтобы автор получал своё;
                          неотправленное ждёт в localStorage ym_plays_pending (в резервную копию не попадает);
                          гость «Слушать вместе» с треком, которого нет на его Яндексе (waShared), отчёт не шлёт
  cache.js                кэш приложения (Rust — cache.rs, папка app_cache_dir/tracks): популярные (дослушаны 3 раза)
                          и проигранные треки текущего плейлиста; играет тем же ymlocal:// (download::open_local
                          смотрит в кэш, если трек не скачан), window.appCache.has(id); карточка «Кэш» во «Воспроизведении»
                          Популярность трека затухает вдвое за 400 прослушиваний ДРУГИХ треков (не по часам); популярные
                          держат ≤70% лимита, свободное занимают, но трек плейлиста/волны вытесняет их до этой доли
  linkadd.js              «Добавить трек»: по ссылке (YouTube, SoundCloud, видео/клипы ВК) или с компьютера (audio_pick).
                          Одно окно window.addTrack: поле для ссылки + зона «Перетащи файл сюда или выбери» (щелчок —
                          audio_pick; брошенный файл идёт обычным bg-drop → dropin.js, окно закрывается). Открывают: меню
                          пустого места «Лайков» (tmenu.js addTrackItem), кнопка в #linkCard («Приложение»), а ссылка с этих
                          сайтов, вставленная в поиск (или Enter) или Ctrl+V в окне, — window.linkAdd(url): то же окно со ссылкой в поле.
                          Rust — linkdl.rs: check_url (хосты + только один трек, адрес пересобирается), yt-dlp с GitHub
                          (SHA2-256SUMS, app_local_data_dir/tools, сам обновляется раз в 7 дней), запуск с --ignore-config
                          --no-plugin-dirs --no-exec --downloader native --use-extractors <сайт>, только m4a/mp3 без видео,
                          ≤100 МБ, ≤1 ч; check_audio (ftyp/ID3, нет hdlr «vide», symphonia декодирует) → bg::remember_one →
                          dropin.js dropAudio (то же окно, что при перетаскивании). Без ffmpeg: постобработки нет вовсе.
                          Настоящая загрузка: cargo test --lib linkdl::tests::real_download -- --ignored --nocapture
                          Ссылка едет с файлом (entry.link) → drop_audio_local(link) → Item.source { site, url, id }
                          (linkdl::source_info: youtube | soundcloud | vk-video; без ссылки — «file»)
  linkalbum.js/.css       альбом по ссылке (Rust — linkset.rs + m4acut.rs). linkadd.js перед скачиванием зовёт routeLink(chk):
                          link_check отдаёт и плейлист (chk.list: YouTube ?list=, кроме миксов RD… и личных WL/LL/LM;
                          SoundCloud автор/sets/…) → «только этот трек / весь плейлист»; link_probe (yt-dlp -J, без скачивания)
                          → длина, главы, треки, music/why (категория YouTube, « - Topic», слова в названии) → «Похоже, это не
                          музыка — всё равно скачать?». Длиннее 20 мин или с главами → «Разделить на треки / Одним треком»
                          (одним — до часа): link_download_long (Mode::Long: до 4 ч, 400 МБ, token — папка в кэше linkdl),
                          главы, а без них — link_silences (edges::windows_of, паузы ≥0,8 с на 25 дБ тише записи, куски ≥40 с);
                          окно: начало/название/галочка у каждого трека, «+ Добавить трек»; link_split режет без перекодирования
                          (m4a — m4acut.rs: кадры AAC в новый MP4 ftyp+moov+mdat; mp3 — studio::mp3_cut) → bg::remember_files.
                          Плейлист: выбор ≤50 → link_download_list (Mode::List, «--playlist-items 1,3»; недоступные пропускаются).
                          Сохранение — как у перетащенного файла: «Новый альбом в Whisper Archive» (drop_audio_archive, первый
                          создаёт альбом, остальные — в него; при лимите архива ждёт минуту) или «Все в «Лайки»»
                          (drop_audio_local с альбомом в meta). После нарезки — link_forget(token)
  libsync.js              синхронизация своих треков (всё из студии: по ссылке, свои файлы, обрезки, замены) через
                          Whisper Archive — на телефоне и другом ПК те же треки на тех же местах в «Лайках» (likedAt).
                          Сервер — /api/library/{service} (service = "yandex"; описание — docs/LIBRARY-SYNC.md в репозитории
                          архива), Rust — ядро whisper/library.rs (wa_lib_list, wa_lib_changes, upload_file/download_file) и
                          studio.rs (studio_lib_upload, studio_lib_restore — тот же key studio-…, studio_update(likedAt)).
                          Порядок: забрать (since=rev) → применить → отправить пачками по 100 → догрузить файлы. Состояние —
                          localStorage ym_libsync { rev, sent, bad, uid } (в резервную копию НЕ попадает — backup.js SKIP),
                          выключатель #lsOn (ym_libsync_on) в #linkCard. Запуск: через 8 с после старта, window.libsyncPoke
                          (studio.js после лайка, добавления, переименования, удаления) и раз в 5 минут
  pagecache.js            карточка «Кэш страниц» там же: снимок «Лайков» (IndexedDB likes:v1 — main.js snapSave/likesSnap,
                          window.pageCache.info/clear): размер, возраст описаний, чтение с диска, как открылись «Лайки»
                          в последний раз (likesPerf: память / снимок / Яндекс), что в памяти (PL.full, artistCache)
  share.js                «Поделиться» в меню трека; ссылки whisper://track|album|artist и music.yandex.* открываются
                          в приложении (deeplink.rs → событие open-link, вставка в поиск, Ctrl+V в окне)
  mini.html/js/css        отдельное окно мини-плеера
  themeguard.js           защита от «странных» стилей: проверяет обязательный минимум (окно, пауза, настройки) у своих
                          стилей, иначе — аварийная панель / встроенный стиль; «Не показывать» — localStorage ym_tguard
  devprofile.js           профили устройств вывода: громкость, нормализация, режим вывода, эквалайзер — свои у каждого
                          устройства, переключаются сами (хуки: soundPrefs, eqState/eqSetState, engineSetMode(excl, quiet),
                          событие whisper:output из output.js)
  errinfo.js              понятные ошибки: window.errExplain(e, ctx) → где проблема (Яндекс, сеть, устройство, декодер,
                          файл, архив) и что делать; исходный текст — в title строки состояния; последняя — window.errLast
  errlog.js               журнал ошибок, БЕЗ defer, после lsguard.js: window.onerror, unhandledrejection, console.error,
                          неудачные invoke (main.js), errExplain (errinfo.js) → window.errLog; последние 300 — localStorage
                          ym_errlog (в копию не попадает); секреты и имя пользователя в путях вырезаются. Карточка #logCard
                          (Данные): «Сохранить файл…» (export_save, txt), «Скопировать», «Очистить»
  lsguard.js              БЕЗ defer, сразу после boot.js: замечает повреждённые записи localStorage до main.js (window.__lsCheck)
  notify.js/.css          свои уведомления, как в Telegram (не системные): приглашение в комнату и «подмигнуть»; общие
                          модули зовут kit.notify → window.sysNotify → notify_show (notify.rs). Окно notifywin.html/js/css
                          (метка "notify", capabilities/notify.json): прозрачное, поверх всех, без панели задач и без фокуса,
                          карточки стопкой (≤3) в углу рабочей области монитора главного окна; высоту сообщает notify_layout,
                          пустое — уничтожается. Звук: Windows — PlaySound (notify.rs chime_wav), Linux — главное окно
                          (тот же WAV в notify.js). Настройки — Приложение → Уведомления: выключатель + «Подробная
                          настройка…» (виды, «даже когда окно открыто», звук, текст full|short|none, угол tl|tr|bl|br);
                          localStorage ym_notify; по умолчанию — только когда окно свёрнуто или в фоне
  backup.js/.css          резервная копия .wbak (настройки, закреплённые, темы, фоны, статистика; токенов нет — список
                          исключений SECRET_RE/SKIP), автокопии настроек и восстановление; Настройки → Приложение
  studio.js/.css          «Студия» (кнопка #studioBtn под «Настройками», страница #studioPage): обрезка трека без
                          перекодирования (studio.rs режет mp3 по кадрам), «Мои версии» с номерами studio-<32 hex> — играют
                          как скачанные (download::open_local → studio::open), лайк локальный (main.js isStudio/isLiked,
                          window.studioLiked/studioToggleLike), в архив — archiveSave → studio_to_archive, «Поделиться» —
                          свой приватный альбом + wa_album_share (ссылка-приглашение; ym_studio_shared). Лайкнутые версии
                          видны в «Лайках» (main.js withStudioLikes — по времени лайка: likeTs от Яндекса / likedAt версии).
                          Выключается в Настройки → Приложение (ym_studio_on, класс html.no-studio). «Слушать вместе»:
                          гостям — studio_room_cache (yandex.js roomCache), у гостя трек комнаты (_room) не ищется на диске.
                          Прослушивание версии plays.js засчитывает исходнику (raw.studio.src). Своя ли версия — window.studioHas
                          (чужая studio-… на диске не ищется). provider.localOnly (yandex.js) — ведущий делится версией сразу.
                          Ссылка: /invite/{ключ}?to=version → сайт /s/v/{альбом}#k=… (выбор «в приложении / на сайте») →
                          whisper://wa/{альбом}?k=… (deeplink.rs) → share.js → studioOpenShared → wa_invite_open (ядро: лайк альбома
                          с cookie приглашения = доступ для ключа). Такие треки в плеере — «wa-<трек архива>» с waShared
                          (main.js isShared: без лайка, плейлистов, скачивания; в комнату не раздаются)
  studioshare.js          «Поделиться через архив» и открытие версии по ссылке (window.studioOpenShared); от studio.js
                          получает toRaw/stopPreview через shareSetup (без обратного import)
  studioinfo.js           сводка о треке в студии (loadInfo / paintInfo — карточка #stuInfo) и по звуку: studioAnalyze(AudioBuffer) → темп (BPM, автокорреляция
                          огибающей атак), тональность (хрома + профили Крумхансла), громкость (RMS, пик); формат файла —
                          studio_info (studio.rs: кодек, битрейт, VBR, частота, каналы, размер, с диска или с Яндекса)
  dropin.js/.css          перетаскивание в окно на ЛЮБОЙ странице (bg.rs → main.js bg-drop: .wmt → theme.js, трек → dropin.js,
                          картинка/видео → фон, вне настроек — с тостом). Трек: окно «Что сделать с треком» — поиск похожего
                          трека Яндекса (теги ID3/FLAC + имя файла, score); «В «Лайки»» / «Просто сохранить» (studio.rs
                          drop_audio_local): с выбранным треком — его ЗАМЕНА (origin "replace", src_id = трек; одна на трек;
                          main.js play → window.studioReplacement: играет файл, главнее скачанного/архива/кэша; лайк — самому
                          треку Яндекса, в «Лайках» второй копии нет; «Убрать свою замену» в меню трека), без трека — свой трек
                          (origin "import", liked по выбору, своё расширение ext); или «В Whisper Archive» (drop_audio_archive:
                          в свой/новый альбом; с выбранным треком файл зовётся «Исполнитель - Название» и подменяет версию
                          Яндекса через core/archive.js — W.modules.archive.remember/albums/playing). Файл читает Rust по номеру
                          из списка перетаскивания (bg::read_picked), в JS — только чтобы послушать (bg_read kind "audio")
  cache.js/.css           кэш (Rust — cache.rs): популярные, текущий плейлист и последние N треков «Моей волны»
                          (wave_max, по умолчанию 20; context.type "radio"); полоса занятого места по видам
src-tauri/
  src/lib.rs              регистрация модулей и команд (generate_handler!), трей, окно
  src/*.rs                net (запросы к Яндексу), auth/secret (токен в keyring), download, engine (WASAPI),
                          theme/themelib, hotkeys,
                          fonts (список шрифтов), desktop (обои), power (экономия в трее), update,
                          apkupdate (телефон: те же update_check/update_install — APK последнего выпуска с GitHub в кэш,
                          ставит система через мост MainActivity.installUpdate; карточка «Обновления» на телефоне — во «Данных»),
                          mixer (Windows: имя и значок приложения у звуковых сеансов WebView2 в микшере громкости), …
                          backup (файл .wbak через диалог; автокопии в <папка настроек>/backups: settings, downloaded,
                          downloads — последние 8; download.rs сам восстанавливает из них повреждённый индекс и папки)
  src/whisper_host.rs     что приложение даёт общему Rust ядра (src/core/rust: whisper/, discord.rs, obs.rs): хранилище
                          ключа, heavy_slot, app_origin, подпись ключа, приложение Discord и кнопка, обложки для OBS —
                          единственное своё у приложения
  src/whisper_yandex.rs   Whisper Archive и Яндекс: wa_save_track (скачать трек с Яндекса → whisper::upload)
  build.rs                СПИСОК КОМАНД (AppManifest) — без строки здесь команда не вызывается
  capabilities/*.json     права окон на команды (default.json — главное окно)
  tauri.conf.json         окно, CSP, сборка
scripts/
  check-commands.mjs      каждая команда Tauri — в lib.rs (generate_handler), build.rs (COMMANDS), capabilities (allow-*)
                          и в git (permissions/autogenerated); нет разрешений на удалённые команды. Запускает CI (security.yml)
  check-themes.mjs        проверка репозитория библиотеки тем перед публикацией (Node, разбор — src/core/wmt.js);
                          заодно — предупреждения о производительности (бесконечные анимации не transform/opacity, плавный SMIL в SVG)
docs/
  CORE.md, WMT-FORMAT.md  ссылки: сами документы — в ядре, src/core/docs/
  THEMES.md               гайд по темам для пользователей
  examples/*.wmt          примеры: terminal, retro-tv (архив, своя раскладка), chalk, night-sky (старый вид с base64),
                          new-year (архив: эффекты, частицы из картинки темы, снег через transform — образец «лёгкой» темы)
```

## Правила, о которые легко споткнуться

### CSP (`tauri.conf.json`)
`default-src 'none'; script-src 'self'; style-src 'self' blob:; img-src 'self' data: blob: https://*.yandex.net https://*.yandex.ru …;
connect-src 'self' ipc: http://ipc.localhost; font-src 'self' data: blob:`.

- **Нельзя** `<style>`, атрибут `style="…"` в разметке, `setAttribute("style", …)`, инлайн-обработчики `onclick="…"`,
  `eval`, внешние скрипты.
- **Можно** `el.style.prop = …` / `el.style.setProperty(…)` из JS (CSSOM).
- **Динамический CSS — только через `window.DynCss`** (main.js): `DynCss.set("ключ", cssText)` / `DynCss.remove("ключ")`.
  Это adoptedStyleSheets (или `<link>` на blob: в старом WebKitGTK); подключается после всех .css, после CSS тем,
  а `ccStyle` («Тонкая настройка цветов») — всегда последним.
- Страница **сама в сеть не ходит** (`connect-src` — только IPC). Все запросы — через Rust-команды (`invoke("ym_read", …)` и т. п.).
  Картинки — только с доменов Яндекса (`safeUrl()` в main.js).

### Скрипты, модули и общее состояние
- Почти все `.js` приложения — **ES-модули** (`<script type="module">` в `<head>`), сборщика нет: браузер грузит файлы как есть.
  **Обычными скриптами остались** (их порядок важен, `import` им недоступен): ранние без defer — `app/boot.js`, `mobile/mobile.js`,
  `app/lsguard.js`, `settings/errlog.js`, `app/perf.js`, `i18n/en.js`, `i18n/i18n.js`, `look/layout.js`; с defer — всё ядро `core/*.js`
  и `web/webstate.js` (он же в bridge.html/webstart.html); отдельные окна — `windows/mini.js`, `notifywin.js`.
- **Общей глобальной области больше нет.** Раньше все `.js` были классическими скриптами и видели верхние `let/const/function`
  друг друга по имени — теперь нет: верхние имена модуля видны только ему самому. Функция или `const` из другого файла —
  **только через `import`**; без него будет ReferenceError (часто — уже в работе, при первом вызове). Без `import` и без
  `window.` по имени доступны лишь свойства `window`: общее состояние из `app/main.js` и то, что модуль отдал через
  `Object.assign(window, …)` для обычных скриптов. Где ниже в описаниях написано «main.js → функция», функция теперь в одном
  из модулей `app/`, `player/`, `pages/`, `look/`, `library/`, `settings/` — ищи её по `export { … имя … }`.
- **Между модулями — `import`/`export`.** Модуль в конце пишет `export { … };`, кто пользуется — `import { … } from "../app/base.js";`
  (путь относительно файла, с `.js`). Импортированное имя только читается: присвоить ему нельзя — для этого у модуля-хозяина функция.
- **`window` — только для обычных скриптов.** Имена, которые берут layout.js, ядро, boot.js или код вида `window.X`, модуль
  дополнительно отдаёт строкой `Object.assign(window, { … })` (рядом с export, с комментарием, кому). Новое имя туда — только если
  его правда зовёт обычный скрипт. `perf.js` берёт функции модулей через `import()` (список `MODS` в нём — новый модуль добавь туда).
- **Общее состояние — свойства window**, заводятся в `app/main.js`: `window.queue = []`, `window.current = -1`… Все (модули и обычные
  скрипты) читают и пишут их просто по имени — `queue`, `current`, `audio`, `wave`, `cfg`… Новую общую переменную заводи там так же;
  своя переменная модуля, которую пишут снаружи, — тоже свойство window (`window.speed = …`) или сеттер (`fullPeek`, `bgUnload`).
- **Порядок выполнения.** Модули выполняются после обычных defer-скриптов перед ними, а между собой — по графу import: модуль, который
  импортируют, выполнится раньше. main.js импортирует почти всё, поэтому его тело (состояние и запуск) идёт ПОСЛЕ модулей. Отсюда
  правила: при загрузке модуль только объявляет своё и вешает обработчики; состояние main.js и чужие `const`/`let` — только внутри
  функций (чужие `function` при загрузке звать можно — они готовы сразу, `const` до выполнения хозяина бросит ReferenceError);
  что нужно сделать при запуске с готовым состоянием — в main.js, внизу.
- Код модуля — строгий режим: присвоить необъявленному имени нельзя (только свойствам window из main.js).
- Новый модуль: `<папка>/x.js` с `export`, `<script type="module" src="<папка>/x.js"></script>` в index.html (перед main.js — если
  не импортируется никем; импортируемому строка не обязательна, но пусть будет — так видно все модули), CSS — `<link>` там же или
  файлом в `look/styles/`. Проверка — `node --check` (для модуля — скопируй в `.mjs`) и `scripts/smoke.ps1 -Build`
  (WHISPER_PERF_AUTO=5: perf.js открывает страницы и выписывает ошибки из журнала).

### Ядро Whisper (`core/whisper-core.js`, src/core/docs/CORE.md)
- `src/core` — **подмодуль** (whisper-core): после `git pull` приложения — `git submodule update --init`. Правишь файл в
  `src/core` → это правка ядра для ВСЕХ приложений: коммит и push внутри `src/core` (репозиторий whisper-core), затем в
  приложении `git add src/core && git commit` (приложение запоминает версию ядра). Взять свежее ядро —
  `git submodule update --remote src/core`. Ничего про Яндекс в `src/core` не клади — для этого `yandex.js`, `whisper_*.rs`.
- Порядок: ядро (`core/*.js` — обычные defer-скрипты) выполняется раньше модулей, которые стоят после него в index.html; модули
  между собой — по графу import (см. «Скрипты, модули и общее состояние»). `look/theme.js` стоит после `app/yandex.js` (роли нужны
  при запуске), перед ним — `core/wmt.js` и `core/theme-css.js`.
- Ядро **не знает** о Яндексе и разметке — ничего специфичного туда не клади: оно копируется в другие приложения (Whisper VK).
- Плеер сообщает ядру о себе через `wReport({ track | playing | volume | liked | disliked | seek | rate | modes | queue | started })`
  (`app/base.js`) — в `showTrack` (в конце) и `play()` (`started`, история) — `player/core.js`, `syncIcons` — `app/nav.js`,
  `setVol` — `player/volume.js`, `setSpeed` — `app/trackmenu.js`, `updateModes` — `player/modes.js`, `refreshHearts` —
  `player/like.js`, при дозагрузке волны — `pages/wave.js`; правки очереди в `yandex.js` — `report({ queue: true })`.
- Источник звука вместо сервиса — `Whisper.sources.register(...)`; play() спрашивает `Whisper.sources.resolve` и шлёт
  `wReport({ source })`. Пункт в меню «⋯» от модуля — `Whisper.ui.trackMenu.add(...)` (`app/trackmenu.js` зовёт `trackMenu.build`).
- Общие модули (`src/core/*`) не трогают переменные main.js: всё нужное — через `Whisper.*`, роли и `Whisper.ui.kit`.
  Не хватает возможности — добавь её в ядро (и привязку в `yandex.js`), а не обращайся к main.js напрямую.
  Новое место, где меняется трек/состояние/очередь, — добавь `wReport`.
- Новый модуль лучше писать на `Whisper.on("track" | "playstate" | "volume" | "like" | "queue" | "seek" | "rate" | "modes", fn)`
  и `Whisper.player.*` / `Whisper.queue.*`, а не на глобальные переменные main.js. Модуль, который отправляет «что играет»
  наружу, — на `Whisper.player.watch(fn(force))` + `Whisper.player.state()` (так сделаны traymini, obs, discord, together).
  Крючков `window.miniPush` / `window.discordPush` main.js больше не вызывает (они оставлены только как «отправь заново»).
- Новый элемент интерфейса, похожий на существующий (ещё один поиск, кнопка плеера, вид списка), — добавь его
  селектор в нужную роль в `yandex.js` (`W.ui.define`). Иначе общие темы его не увидят. Новые общие роли — в `VOCAB` ядра и в docs/CORE.md.
- Темы: `@@ css whisper-core` (по ролям `[data-w="…"]`) подключается перед `@@ css whisper-music`. Роли разворачивает
  `Whisper.ui.resolve` (core/theme-css.js, `scopeCss`).

### Новая Rust-команда — в четырёх местах
1. `src-tauri/src/<модуль>.rs` — `#[tauri::command] pub async fn имя(…) -> Result<…, String>`; тяжёлое — в `tauri::async_runtime::spawn_blocking`.
   Команда без `async` выполняется в главном потоке приложения (окно, трей, все IPC — по очереди за ней). Трогает диск,
   системное хранилище или сеть — `async` или `#[tauri::command(async)]` (так сделаны кэш, скачанные, студия, автокопии).
   Без `async` — только то, что работает с окном, треем и меню, и мгновенное.
2. `src-tauri/src/lib.rs` — `mod <модуль>;` и `<модуль>::имя` в `generate_handler![…]`.
3. `src-tauri/build.rs` — `"имя"` в `COMMANDS`.
4. `src-tauri/capabilities/default.json` (или нужный файл) — `"allow-имя"` (дефисы вместо `_`).
5. Новая библиотека — `Cargo.toml` с комментарием «зачем» (так оформлены все зависимости).

Вызов из JS: `await invoke("имя", { аргументы })` (обёртка — `import { invoke } from "../app/base.js"`) или `window.__TAURI__.core.invoke`.

### Страницы и шапка (`app/nav.js`, `app/list.js`, `app/offline.js` — брать через import)
- Навигация: `navigate(fn)` — с историей «Назад», `goTop(fn)` — раздел из бокового меню. Защита от гонок: `const my = ++nav; … if (my !== nav) return;`.
- `setHead({ title, img, round, back, pin, artistWave, sub })` — шапка страницы; `resetView()` прячет всё страничное.
- `renderList(tracks, append, opts)` — строки треков `#list li` (`.t`, `.a`, `.likebtn`, `.morebtn`, `li.playing`).
- `setChips(items, active, onPick)` — переключатели под заголовком (`#chips`).
- Кнопки шапки с классом `.pin` (`#artistWaveBtn`, `#dlAllBtn`, `#pinBtn`, `#plCreateBtn`) прижаты вправо одной группой:
  `margin-left: auto` у первой видимой, `.head .pin:not([hidden]) ~ .pin { margin-left: -6px }` у остальных.
  «Скачать лайки» живёт в ряду `#chips` справа (переносит `paintDlAll()`).
- Офлайн: `offline`, `isNetErr()`, `suspectOffline()`, `offlinePick()` — страницы умеют показывать скачанное.

### Настройки (`#settingsPage`)
- Вкладки: `look` Оформление, `ui` Интерфейс, `play` Воспроизведение, `out` Звук, `app` Приложение, `int` Интеграции,
  `data` Данные. Карточка — прямой ребёнок `.settings`: `<div class="card" id="…" data-tab="…">`. Без `data-tab` попадает в «Интеграции».
  Первые дети `.settings` — шапка `#setTop` (поиск `#setFind` + вкладки `#setTabs`) и `#setFindEmpty`; это не карточки.
- Два столбца (CSS columns, ≥1100px): карточки идут **в порядке разметки**, правый столбец начинается с карточки `.colbreak`
  (одна на вкладку). Баланс высоты столбцов подбирается переносом `.colbreak`.
- Сейчас: Оформление — Стиль, Цвета и шрифт (#colorCard; шрифт — блок #fontCard внутри, под цветами) | Фон (размытие, затемнение, прозрачность панелей), Эффекты и анимации (свечение, анимации, «Настроить тему…» — эффекты и интро тем).
  Интерфейс — Расположение (вид, сторона, время, закреплённые, «Вкладки настроек» #setTabsPos; свёрнутые боковая/нижняя
  панели в настройках не выбираются — только перетаскиванием края), Панели (#stuCard: «Скрывать закреплённые» #pinHideCard,
  список кнопок боковой панели — panels.js, ym_side; галочка в строке — стартовая страница, одна на список: localStorage
  ym_start wave|likes|stats|studio, main.js → startPage()) | Визуализатор, Маскот, Язык, Меню трека (#tmCard, tmenu.js, ym_tmenu.
  Системное меню WebView не показывается нигде, кроме полей ввода и выделенного текста; всё прочее в окне — общее pageMenu
  («Назад», «Настройки», последние стили); модуль со своим меню зовёт preventDefault. Правый щелчок по строке
  с .morebtn и по .player (#pMore) — меню у курсора (window.menuPoint перед щелчком по «⋯» → openMenu → menuAt в placeMenu),
  на пустом месте «Моей волны» — своё меню (обои, визуализатор; якорь .ctxanchor), «Лайков» (likesOpen()) — «Скачать лайки»
  (жмёт #dlAllBtn), «Добавить трек…» (bg.rs → audio_pick → dropin.js dropAudio) и последние стили, настроек (#settingsPage,
  вся страница с шапкой) — импорт настроек (жмёт #bkLoad / #bkAutoBtn), язык (чипы #langSeg) и последние стили, на боковой
  панели — «Переставить кнопки» (panels.js → window.sideEdit: html.side-edit, тянуть мышью, «Готово»/Esc; пока тянут, соседи
  сдвигаются только transform-ом, порядок в разметке меняется один раз при отпускании), стартовая страница
  (window.sidePanel) и последние стили кружками (recentRow; ym_recent_styles, переключает щелчок по .stylecard), скрытые пункты — main.js → menuItem спрашивает window.tmenuHidden(подпись), пока строится главное меню;
  новый пункт меню, который можно прятать, — добавь в ITEMS tmenu.js).
  Воспроизведение — Режим сна, Переходы между треками (#xfCard) | Скачивание треков, Кэш. Звук — Устройство вывода, Профили | Вывод и качество (#modeCard: режим + качество потока),
  Нормализация, Сведения о формате. Приложение — Трей, Уведомления | Горячие клавиши, Обновления. Данные — Статистика (запись и очистка),
  Резервная копия | Сброс.
- **Мелочь — не отдельной карточкой.** Одиночный выключатель кладём строкой в близкую по смыслу карточку.
- **«Подробнее» — одно правило:** зависимые опции (2–3 строки) — прямо под своим выключателем (маскот, вид визуализатора);
  всё, что больше, — в общем окне `openDetails({ title, sub, body, adopt, foot, wide, escape, onClose })` (details.js).
  Кнопка с многоточием («Настроить…», «Выбрать…») всегда открывает это окно. Так сделаны уведомления, горячие клавиши, шрифт
  (adopt #fontBox), волна для сна (adopt #slStations), автокопии. Свои окна остались у «Тонкой настройки цветов» и у общих модулей ядра (Discord).
- **Поиск и переходы** (setpage.js): поиск по всем вкладкам — заголовки, подписи, `title` и синонимы `SYN` по id карточки
  (новой карточке — id и, если надо, синонимы); Ctrl+F на странице настроек — свой поиск. `window.openSetting("#id")` — открыть
  вкладку, прокрутить и подсветить настройку. Вкладки сверху или слева — `page.dataset.tabs`, localStorage `ym_set_tabs`.
  «Трей» (traymini.js): щелчок — меню или мини-плеер (ym_tray), цвет значка app|black|white|style (ym_tray_icon; картинку
  64×64 рисует страница на холсте → tray_icon в lib.rs; style — по --accent/--accent2, перерисовывается при их смене).
  «Боковая панель»: кнопки «Статистика» (listenstats.js, ym_stats_btn, html.no-statsbtn) и «Студия» (studio.js,
  ym_studio_on — по умолчанию ВЫКЛЮЧЕНА, включается только "1"). Интеграции — Whisper Archive (вставляет core/archive.js первой, через kit.settingsCard в yandex.js) | Discord, OBS.
- Настройки оформления — `cfg` (localStorage `ym_cfg3`, `saveCfg()`, `applyCfg()`, `syncControls()`), значения стиля — `cfg.s[стиль]`.
  Отдельные модули хранят своё под своими ключами (`ym_font`, `ym_hotkeys`, …).

### Расположение и закреплённые (`layout.js` / `look/layout/*.css`)
- Режимы — атрибуты на `<html>`, хранятся в localStorage `ym_layout`: `data-ly-side` (left|right), `data-ly-sb` (full|mini),
  `data-ly-pl` (full|mini), `data-ly-time` (always|hover), `data-ly-pins` (top|side), `data-ly-pinhide` (off|on),
  `data-ly-ui` (normal|super — мини-вид: боковая — плавающая колонка значков, плеер — плитка с обложкой + «таблетка»,
  «⋮» (#smMore) → столбик .pright, `html.sm-open`; layout.js на это время ставит sb=mini, pins=top и переносит
  #likeBtn/#disBtn в .ctrls, перемешивание/повтор — в .pright, по меткам-комментариям возвращает; Ctrl+Shift+M или
  двойной щелчок по пустому месту .side/.player — `window.layoutToggleSuper()`);
  служебные: `data-ly-sw`/`data-ly-ph` (свой размер панелей), `data-ly-sbw` (s|xs — узкая боковая панель, по замеру ширины).
  Переключатели — `.lyseg[data-k="…"] .chip[data-v="…"]` (сами подхватываются), чекбокс `#pinHide`. `window.layoutSet(k, v)`.
  Тема с `"layout": "fixed"` → `layoutLock(true)`: действуют значения по умолчанию, выбор пользователя сохраняется.
  Тема с `features.pinHide: false` (или с `"layout": "fixed"`) → `layoutNoPinHide(true)`: `data-ly-pinhide="off"`, карточка
  `#pinHideCard` скрыта; `features.mascot: false` (а при `"layout": "fixed"` или `console` — если не задано явное `"mascot": true`) → `mascotAllowed(false)`, карточка `#mascotCard` скрыта (main.js → applyHooks).
- Закреплённые: массив `pins` в main.js (localStorage `ym_pins`, `{ type, id, title, year, img }`; `img` — постоянная https-ссылка
  на обложку, запоминается в `setHead` и при первой подгрузке). Рисуются **двумя элементами**: `renderTabs()` — закладки `#tabs .tab`,
  в конце зовёт `renderRail()` — колонку `#pinRail .prail` (`.prailic` обложка, `.prailtx` подпись, `.prailx` открепить).
  Колонка рисуется всегда, видна только при `data-ly-pins="side"`; обложки (`pinImg()`) грузятся, только когда колонка видна.
- Колонка — с внешней стороны боковой панели (сетка `.app`: `"rail side main"` / `"main side rail"`), ширина `--rw` на `.app`.
  Подгонка под стили — по **основе** (`html:root[data-base="royal|lolitta"]`), а не по `data-style`: свои темы — копии правил
  стиля на момент сохранения, колонки в них может не быть. В роли `sidebar` (yandex.js) колонка вместе с `.side`.
- «Скрывать закреплённые» (`data-ly-pinhide="on"`): закладки схлопываются по `max-height`, колонка — по ширине ячейки
  (`--rwx`, @property, ячейка `side` = `--sw + --rwx`, у `.side` отступ `--rwx`). Показаны — класс `.pinpeek-on` на `<html>`:
  сверху — по `pointermove` (курсор выше поиска, кроме `.tbctl`), сбоку — невидимая полоса `.pinpeek` в отступе окна.
  Своего оформления у режима нет — не добавляй подложек и отступов, иначе ломается вид стилей.

### Язык интерфейса (i18n.js, src/i18n/en.js)
- Строки в коде и разметке — **по-русски, как раньше**. При `ym_lang = "en"` i18n.js переводит текстовые узлы и атрибуты
  `title / placeholder / aria-label / alt` (MutationObserver — и то, что код дорисует потом). По-русски наблюдатель выключен.
- Словарь `src/i18n/en.js`: ключ — строка как на экране (пробелы схлопнуты), `{}` — переменная часть, `{1} {2}` — другой порядок,
  значение-функция (может вернуть `null` = «не переводить»). Короткие шаблоны («{} с», «{} из {}») — через `num(…)`: только
  для чисел, иначе ловят названия треков. `«{}»` в кавычках не переводится (это название). Склонения — `pl(one, many)`.
- **Новая строка интерфейса → добавь перевод в en.js.** Проверка: `node scripts/i18n-check.mjs` (без перевода; `--all` — все).
  Не переводятся: cli.js, cli-eggs.js, core/wmt.js, синонимы поиска setpage.js, подсказки ролей ядра (для авторов тем).
- Не сравнивай `textContent` с русским текстом — на экране он может быть английским (пример — `isNothingFound` в main.js).
- Не переводятся (SKIP в i18n.js): строки треков `.list li .t/.a`, очередь, текст песни, поля ввода, `[data-noi18n]`, консоль.
- Текст не в разметке (трей, уведомления системы, холст) — `window.i18n.t("…")`; язык — `i18n.lang`, смена — `i18n.on(fn)`.
  Меню трея и кнопки под миниатюрой — Rust: `tray_lang` (lib.rs, `thumbbar::EN`). Discord-статус пока по-русски (discord.rs).

### Браузерная версия (webmode.rs, webmode.js)
- Настройки → Приложение → «Браузерная версия» (#webCard): «Открыть в браузере». Окно отдаёт localStorage и IndexedDB
  (webstate.js → web_state_put / web_blob_put), Rust поднимает сервер на 127.0.0.1:47817…47824, открывает в браузере
  `/__web/start?k=<ключ>` (ключ → cookie `wk`, HttpOnly, SameSite=Strict), прячет окно и открывает в нём **bridge.html**.
- Во вкладке index.html получает первым скриптом **webshim.js** (вставляет сервер): `window.__TAURI__` поверх HTTP —
  `invoke` → POST /__web/ipc → событие «web-call» → bridge.js зовёт настоящую команду → `web_reply`; события Rust —
  SSE /__web/events (список EVENTS в webmode.rs — **новое событие для страницы добавь туда**); `convertFileSrc` →
  /__proto/ymlocal|wa/…; `win_*`, `app_ready`, `engine_available` отвечает сам шим. Признак — `window.__WEB__`, `html.webmode`.
- Назад: «Вернуться в приложение» (над «Профилем» и в #webCard) или «Открыть» в трее/повторный запуск (show_main →
  webmode::leave). Вкладка отдаёт настройки (и сама раз в 20 с, если что-то менялось), bridge.js забирает → web_finish →
  окно снова index.html. Вкладка показывает «Whisper снова в окне» (.webgone).
- Не работает во вкладке: эксклюзивный WASAPI, кнопки окна, перетаскивание файлов через окно Tauri. Очередь и место в
  треке не переносятся (вкладка стартует как при запуске). Новые данные в localStorage/IndexedDB переносятся сами.
- Вкладка может быть **Firefox**: правила `::-webkit-slider-*` он выбрасывает, поэтому main.js (`mozRange`, `MOZ_RANGE`)
  копирует их в `::-moz-range-*` — из файлов .css (ключ DynCss «mozRange») и из всего, что идёт через DynCss.set (темы).
  Отдельных правил для Firefox писать не нужно. Значок вкладки — favicon.png. «Вернуться в приложение» закрывает вкладку
  (`window.close()`; работает, пока у вкладки одна запись в истории — не делай pushState/hash-навигацию).
- POST к серверу — только с `Origin` этого адреса и заголовком `X-Whisper: 1`; Host проверяется; команды `web_*` из
  вкладки не вызываются; bridge.html/mini.html/notifywin.html сервер не отдаёт.

### Клавиатура
- Глобальные сочетания (Ctrl+Alt+…) — `hotkeys.js` + `hotkeys.rs`. Внутри окна — `keynav.js`; занятые клавиши:
  стрелки, Enter, Home/End/PgUp/PgDn, Пробел, Ctrl+←/→/↑/↓, Shift+←/→, M, L, Ctrl+F, Ctrl+K (командная строка, app/palette.js),
  Alt+←/Backspace, F1, Menu/Shift+F10;
  Q — очередь (core/queue.js), F — визуализатор на весь экран (main.js), Ctrl+Shift+Backspace — аварийный сброс стиля (theme.js).
- Обработчики клавиш не срабатывают в полях ввода (`input, textarea, [contenteditable]`) и при открытом `.modal`.

### Мелкие возможности — где что живёт
- **Лайки авторов**: кнопка `#artistLikeBtn` на странице автора (`setHead({ artistLike })`), вкладка «Лайки» → «★ Авторы»
  (`showLikedArtists`). Операции net.rs — `likes_artists`, `artist_like_add`, `artist_like_remove`; номера — `likedArtists`
  (localStorage `ym_liked_artists`).
- **Закреплённые жанры волны**: звёздочка `.ststar` на пункте списка (`renderStations`), `stPins` — localStorage `ym_wave_pins`.
- **Режим сна — своя громкость** (sleep.js, `#slVol`): пока режим включён, громкость запоминается в `ym_sleep.vol`,
  обычная ждёт в `ym_sleep.prev` и возвращается после сна (или при следующем запуске).
- **Статистика прослушиваний** (listenstats.js): исполнители — плотный список (треков, прослушиваний, время, доля), кольца `donut()` (жанры, время суток), плитки по дням
  `.lstile` с цифрами, «кто ты по жанрам» (`WHO`, открывается с 40 часов за всё время), «Скачать PDF» — открытка на
  холсте → JPEG → одностраничный PDF (`pdfFromJpeg`), файл пишет Rust `export_save` (export.rs, общий для PDF / TXT / CSV / JSON).
- **«Цвета этого места…»** в меню по правому щелчку (tmenu.js: таблица `CC_AT` селектор → ключ `CC_GROUPS`) открывает
  «Тонкую настройку цветов» на нужной строке: `openColorEditor(ключ)`. Новый ключ в `CC_GROUPS` — добавь строку в `CC_AT`.
- **Меню по правому щелчку**: линия (`menuSep`) — только между крупными группами; перед подзаголовком (`menuNote`) линию прячет CSS.
  На странице прослушиваний первый пункт общего меню — «Скачать статистику (PDF)» (`window.lstatsPdf`).
- **Меню трека**: пункты модулей со `slot: "bottom"` (share.js — «Поделиться») встают внизу, перед «Скачать трек».
- **Мини-вид**: таблетка плеера сама является линией трека — `#seek` растянут на всю `.pcenter` под кнопками (layout.css).
- **Видеообои**: ошибки `#bgVideo` после добавления (не декодируется, не открылось за 12 с) показываются в `#setNote`/тосте.

### Прочее
- Бывший `styles.css` — `src/look/styles/01-base.css … 11-extras.css`, подключены в index.html строго по номерам: это тот же
  файл, нарезанный по темам, порядок = сила правил (04a/04b, 09a…09i — бывшие смешанные 04 и 09: перенесённые блоки не
  пересекаются по селекторам с теми, через которые перенесены, поэтому вид не изменился). Новое правило — в файл по теме (стиль Неон — 03-neon.css,
  Стимпанк — 06-steam.css, Lolitta — 07-lolitta.css, Королевский — 02-royal.css / 05-royal-anim.css, остальное — по шапке
  файла); новый файл — со следующим номером или буквой (09j-…), строка `<link>` — на его место в index.html. Там, где ниже написано «styles.css», имеются в виду эти файлы.
- Параметры WebView2 — одни на все окна, через переменную `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (lib.rs → `webview_args()`,
  до Builder): там повторён список Tauri (`msWebOOUI,msPdfOOUI,msSmartScreenProtection`) + `AudioServiceOutOfProcess` — звук
  играет браузерный процесс WebView2 (потомок приложения), иначе «Захват звука приложения» в OBS слышит тишину.
  И `--disable-gpu-rasterization`: содержимое рисует процессор, кадр собирает видеокарта — первый кадр интерфейса
  при запуске на ~0,6 с раньше (видеокарта долго готовилась рисовать содержимое), процессор во время игры не дороже.
  Кроме тем с курсором (`--mx`/`--my`/`--mpx`/`--mpy`): параллакс так дёргается, поэтому themefx.js → `gpu_raster(on)` (shell.rs)
  ставит метку `%APPDATA%\ya\gpu-raster`, и со следующего запуска флага нет. Метка НЕ снимается при смене темы: кто хоть раз
  включил параллакс-тему, тот дальше всегда запускается с видеокартой (иначе тема, включённая не при запуске, лагала).
  Ответ true — тост с кнопкой «Перезапустить» → `gpu_raster({ on, restart: true })` → app.restart(); перед этим страница
  сохраняет ym_last и ym_gpu_resume (играло — core.js restorePlayer продолжит воспроизведение).
- Трек из поиска (pages/search.js → playSearchTrack) играет один, `playCtx = "search"`, `playAlbum = { id, title, track: true }`;
  когда кончится — wave.js onQueueEnd включает «Мою волну по треку» (seed `track:<id>`), как «по альбому» после альбома.
- Свои полосы прокрутки стили и темы задают только `.main::-webkit-scrollbar-*`. Горизонтальная лента «Открывал» в истории
  поиска (`.spicks`) копирует эти правила себе (search.js → spicksScrollbar, DynCss «spicksScroll»; ширина → высота).
  `scrollbar-width` на таких элементах не ставь: с ним Chromium игнорирует `::-webkit-scrollbar`.
- Запуск: окно показывается сразу — boot.js первым же скриптом зовёт `app_ready({ bg })` с цветом шторки (winstate.rs ставит
  его фоном движка, чтобы не мелькнул белый), интерфейс под шторкой проявляется, когда стиль готов. Свои темы при запуске —
  только текущая, остальные подключаются потом (theme.js). Трей: рисование стоит сразу, а память и кэши отдаются через
  30 с (power.rs, LOW_AFTER) — быстро спрятал и открыл окно, оно не рисуется с нуля.
- `[hidden]` перебивается `display:` в CSS классов — в своих блоках добавляй `#блок [hidden] { display: none !important; }`.
- Учитывай все 4 встроенных стиля: у `royal`/`steam` квадратные углы и рамки, у `lolitta` декор и свои переменные (`--l-*`),
  `:root[data-anim="off"]` — анимации выключены.
- Цвета в CSS — через переменные (`var(--accent)`, `var(--accent2)`, `var(--text)`, `var(--muted)`), а не числами.
- `--accent`/`--accent2` зарегистрированы (`@property … <color>`, styles.css): `getComputedStyle` отдаёт их как `rgb(…)`,
  а не `#rrggbb` — нужен hex (Rust, `#rrggbb`-проверки) — переводи сам.
- Частицы (themefx.js) рисуются готовыми спрайтами (форма + цвет + размер + свечение — один раз), одним setTransform,
  стирается только область прошлого кадра, плотность ≤ 1,5; при тяжёлых кадрах `quality` снижает число частиц.
  Не возвращай shadowBlur и drawImage(SVG) в покадровый цикл — это и было «съедает FPS».
- «↺ Исходный вид стиля» (Оформление → Фон, и раздел «Исходный вид» в «Настроить тему…»): main.js → `resetStyle(st)` —
  свой стиль заново из файла в IndexedDB (theme.js → `wmtResetStyle`: defaultsFrom + applyThemeBg — фон, цвета, cc, fx),
  встроенный — `STYLE_DEF` без фона. Трогает только этот стиль; «Сбросить всё» (`#cfgReset`) — все стили и общие настройки.
- Формат .wmt: строгое описание — src/core/docs/WMT-FORMAT.md (подмодуль whisper-core, раздел 5: effects, layer, particles,
  события и курсор), гайд для авторов — docs/THEMES.md. Новое в settings / CSS темы — правь оба (и коммить подмодуль отдельно).
- Длинные списки (main.js renderList): первые 70 строк сразу, остальное — в свободное время (requestIdleCallback, ≤6 мс)
  и при прокрутке к краю (onListScroll); строка — клон заготовки rowTpl; > 300 строк — `.list.biglist` с
  content-visibility: auto (не для .playing / :hover / .flash / .dragging). Перерисовка с сохранением прокрутки —
  renderList(…, first = keepScrollRows(main)), иначе окно отскакивает наверх.
- Производительность: бесконечные анимации `box-shadow` / `text-shadow` / `background-position` / зарегистрированных
  свойств (`@property`) считает основной поток и каждый кадр перерисовывает элемент (и стекло `.panel` с backdrop-filter
  под ним) — в встроенных стилях им задан `steps(…)` ~15–20 шагов/с. Плавно на 60 кадрах — только `transform`/`opacity`.
- `:has()` на `html` / `:root` / `body` не пиши: любое изменение внутри (даже время трека раз в секунду) заставляет
  пересчитать стили всего окна — в «Лайках» это ~70 мс на каждое изменение. Нужен признак на корне — класс из JS
  (`html.vol-open`, `:root.dyn-on`, `body.full-open`). Часто меняющийся текст — `setText(el, s)` (main.js): меняет
  данные текстового узла, а не `textContent` (тот пересоздаёт узел — это изменение структуры).
- Синхронные `getAnimations()`, `getComputedStyle`, `getBoundingClientRect` сразу после правок DOM заставляют
  пересчитать стили/раскладку посреди кода (смена обложки так стоила 55–90 мс внутри play()). Такое — в
  `requestAnimationFrame` или до правок.
- Замеры скорости: `WHISPER_PERF=<файл>` (perf.rs, perf.js) — запуск, смена трека, страницы, долгие кадры с виновником,
  команды Rust; `WHISPER_PERF_AUTO=1` — приложение само прогоняет сценарий (громкость 0, в конце пауза), `=2` — короткий
  опыт. Без переменной всё выключено и ничего не тратит.

---

## Формат темы `.wmt` — шпаргалка

Полное описание — `docs/WMT-FORMAT.md`, гайд с примерами — `docs/THEMES.md`. Здесь — всё нужное для работы.
Код: `src/core/wmt.js` (формат), `src/core/theme-css.js` (привязка CSS, безопасность, tokens, OBS — общее ядро),
`src/theme.js` (применение в этом приложении), `src/core/obs.js` (виджет).

### Два вида файла
- **Текст** (UTF-8): секции `@@`. Фона нет.
- **Архив** = zip, переименованный в `.wmt` (определяется по `PK\x03\x04`):
  `theme.wmt` (обязательно) + `background.<jpg|jpeg|png|webp|gif|avif|bmp|mp4|webm|m4v|mov>` + любые файлы
  (`preview.png`, `font.woff2`…). Файлы доступны как `"asset:имя"` в JSON и `url(asset:имя)` в CSS.
  Можно в подпапке (берётся папка с `theme.wmt`); только stored/deflate, без zip64.
- Лимиты: файл ≤ 64 МБ, распаковано ≤ 80 МБ, видеофон ≤ 48 МБ; имя ресурса `[A-Za-z0-9._-]{1,100}`.

### Текст темы
```
#WMT 1                         ← первая непустая строка; «#WMT 1.2» ок (дробная часть — совместимые дополнения)
# комментарии до первой секции

@@ manifest                    ← ровно одна, JSON
@@ tokens                      ← ≤1, JSON
@@ css whisper-core            ← CSS по ролям [data-w="search"] — для всех приложений Whisper (docs/CORE.md)
@@ settings whisper-music      ← JSON
@@ css whisper-music           ← CSS
@@ settings whisper-obs        ← JSON (виджет OBS)
@@ css whisper-obs             ← CSS (виджет OBS)
@@ settings whisper-intro      ← JSON { "name", "duration" (с, 0.3…10) } — интро при запуске
@@ css whisper-intro           ← CSS интро (обычно body::before/after); подключается только на время интро, выключается
@@ asset имя base64|text       ← устаревшее: ресурс внутри текста (файл в архиве главнее)
```
Секция длится до следующей строки с `@@`. Строка внутри секции не может начинаться с `@@`. Неизвестные секции пропускаются.
JSON-секции — JSONC: `//`, `/* */`, лишняя запятая. Ошибки показываются с номером строки.

### manifest
```jsonc
{ "id": "midnight-gold",   // [a-z0-9][a-z0-9-]{0,47}; не neon/royal/steam/lolitta; тот же id при загрузке = обновление
  "name": "Полночное золото", "author": "Вадим" /* ≤40, «Автор · Название» */, "description": "…", "version": "1.0",
  "base": "royal",          // neon | royal | steam | lolitta (неизвестное = neon)
  "apps": ["whisper-music"], "created": "2026-10-17T10:00:00Z", "preview": "asset:preview.png" }
```
Основа даёт то, что сделано кодом: `neon` — свечение (ползунок есть только у него); `steam` — отступ кругового
визуализатора; `lolitta` — банты/жемчуг/розы (`.lodeco`), подбор контрастного текста, отступ визуализатора; `royal` — ничего.
Плюс подгонка из layout.css по `data-base`: `royal`/`lolitta` — вид колонки закреплённых, `steam`/`lolitta` — ужатые кнопки
со значками в узкой боковой панели.
**id — признак темы:** файл с тем же id заменяет установленную тему (и сбрасывает `cfg.s[id]`). Если автор другой (без автора
у обеих — название), theme.js сначала спрашивает (`otherTheme()` / `window.wmtOtherTheme`; отказ — `importSafe` → `null`),
а библиотека показывает «Заменить…» (состояние `conflict` в themelib.js) вместо «Включить»/«Обновить». В библиотеке id уникален
на весь `index.json` (дубль пропускается). Для чужих тем — id с ником автора (`nick-name`).
Перед публикацией в whisper-themes: `node scripts/check-themes.mjs ../whisper-themes [--new присланная.wmt]` — дубли id, пути,
id в файле ≠ в списке, битые темы, файлы вне списка; с `--new` — свободен ли id присланной темы.

### tokens (общие для всех приложений Whisper)
```jsonc
{ "color":   { "accent": "#c9a24b", "accent2": "#8b1e2d",      // строго #rrggbb — стартовые значения, пользователь меняет
               "text": "#eadfc6", "muted": "#a39579", "background": "#0e0b09" },  // любой цвет CSS, применяются как есть
  "effects": { "glow": 6 /*0–48 px*/, "panelOpacity": 0.92 /*0.2–1*/, "dim": 0.1 /*0–0.85*/, "backgroundBlur": 6 },
  "font":    { "body": "Tahoma, sans-serif", "display": "Georgia, serif" } }   // display → --font-display
```
Значения CSS без `; { } < > \ url( expression`, ≤300 символов. `text/muted/font/background` применяются ПОСЛЕ CSS темы
(главнее её переменных). Числа вне диапазона обрезаются.

### settings whisper-music
```jsonc
{ "features": { "glow": false, "panelOpacity": false, "animations": false,  // скрыть настройки; нет поля — как у основы
                "pinHide": false, "mascot": false },  // нет «Скрывать закреплённые» / маскота (выбор пользователя хранится)
  "colorOverrides": { "heading": "#f0e2b6", "mainBg": "#ffffff59" },        // #rrggbb / #rrggbbaa; главнее CSS темы, даже !important
  "controls": { "volume": "knob" },   // #volBtn — ручка; громкость в CSS: var(--vol) 0…1
  "layout": "fixed",                  // режимы «Расположения» не применяются, «Скрывать закреплённые» скрыта сама
  "buttons": { "power": "wave" },     // ≤16; имя [a-z][a-z0-9-]{0,23} → #thBtns > button.thbtn[data-th="power"], .on — включено
  "console": { "prompt": "user@whisper:~$", "banner": "Привет!\nhelp — команды" } }  // или "console": true
```
- **Эффекты темы** (снег, гирлянда…) — пометка в CSS `:root[data-fx-snow="on"] …` и/или `"effects": { "snow": { "label", "hint",
  "default" } }` (≤12; `"options"` — старое имя, читается так же). theme.js → `setHooks` собирает список (`themeHooks[id].effects`,
  подписи без label — `FX_NAMES`), main.js → `applyThemeEffects` ставит на `<html>` `data-fx-<имя>="on|off"` (только выбор пользователя;
  движение темы включают под `data-anim="on"`), выбор — `cfg.s[стиль].fx` (`themeFx` / `themeFxSet`). Выключатели и интро — окно «Настроить тему…» (`#thSetBtn` в
  #fxCard, theme.js → `openThemeSetup(id)`: выбор темы, эффекты, интро; сводка под кнопкой — `paintIntro`). Пример — docs/examples/new-year.wmt.
- **Живые темы** (themefx.js, docs/THEMES.md «Живые темы»): события и курсор включаются сами, если CSS темы упоминает
  `.ev-` / `.w-tap` / `--tap-` или `--mx` / `--my` / `--mpx` / `--mpy`; `"layer": { "count": ≤64, "place": "front|back" }` — `#fxLayer i`
  с `--i --r1 --r2 --r3`; `"particles": { имя: { on, from, shape, count, rate, colors, size, speed, direction, spread, gravity, drag,
  life, spin, sway, fade, glow, blend } }` (≤8 стаек, ≤500 частиц на экране, границы — `particleSpec` в theme.js); каждая стайка — ещё и эффект (выключатель).
  Картинки частиц — `window.wmtAssetUrl(id, имя)` (theme.js). Новое событие для тем — добавь `ev("имя")` и `burst("имя")` в themefx.js
  и в списки `P_ON` (theme.js) и таблицу в THEMES.md.
- Действия `buttons`: `wave play next prev like dislike shuffle repeat mute vol-up vol-down full sleep more
  page:wave page:likes page:stats page:settings page:profile close minimize maximize drag`. Кнопка темы просто нажимает
  кнопку приложения (и так же `:disabled`); `drag` тянет окно (main.js → `winDragFrom`).
- **Обязательный минимум** (`themeguard.js`): окно (закрыть, свернуть, перетащить), «Играть/пауза», настройки. Доступно —
  видна кнопка приложения, ИЛИ кнопка темы с этим действием, ИЛИ консоль. Иначе — аварийная панель (popover, инлайн
  `!important`), спрятана и она — встроенный стиль. `check-themes.mjs` предупреждает о том же заранее (по CSS).
- Ключи `colorOverrides` (= «Тонкая настройка цветов», список — `CC_GROUPS` в main.js): `text muted heading winBg
  tabBg tabText tabBorder tabActBg tabActText titleBarBg sideBg sideBorder navBg navText navBorder navActBg navActText
  searchBg searchText btnBg btnText btnBorder btnActBg btnActText plBg plBorder plTitle plArtist plIcons plModeOn
  playBg playIcon seekFill seekTrack seekThumb volFill like rowHover rowTitle rowArtist mainBg listBg titleBg
  menuBg menuText cardBg cardBorder ctl vizA vizB glow`.
- Консоль: `#cli`, `.cli-out`, строки `.cl` (`.cmd .err .dim .ok .hl .hd .banner`, `.cl.art`, `.cl.live`), `.cli.party`,
  `.cli-status`, `.cli-in`, `.cli-ps`. Текст — `accent`, подсветка — `accent2`. Выход — `gui` или Ctrl+Shift+Backspace.

### css whisper-music — как привязывается
Пишется как будто тема единственная; core/theme-css.js сам префиксует:
- `.panel {…}` → `:root[data-style="<id>"] .panel {…}`; `:root {…}` / `html {…}` → переменные стиля;
- `:root[data-anim="off"] .x` → `:root[data-style="<id>"][data-anim="off"] .x`; внутри `@media/@supports/@container/@layer` так же;
- `@keyframes`, `@font-face` — подключаются, имена тихо делаются уникальными; `@property` и `@import` — нет.
- **Безопасность** (core/theme-css.js, `cssSafe`): проверка после раскрытия `\`-экранирования и без комментариев. Нельзя `@import`,
  `expression(`, `javascript:`, `behavior:`, `-moz-binding`, `image-set/cross-fade/element/paint/src(`, `url()` куда-либо,
  кроме `asset:` этой темы (→ blob:), `data:` и `#якорей`. Небезопасное правило выкидывается целиком.
- Порядок: CSS приложения → CSS темы → tokens → `colorOverrides`/«Тонкая настройка» (последней, главнее всего).

**Переменные:** `--accent --accent2 --text --muted --glow (px) --glow-c --panel-a (0–1) --on-accent --btn-fill
--font-display --vol (0–1) --kick (0–1, на .stage при визуализаторе) --viz-gap (задаёт тема на .stage, px)`.

**Основные селекторы:** `.titlebar` (`.tbctl button`), `.tabs .tab(.active)`, `#pinRail .prail(.active)` (закреплённые сбоку:
`.prailic(.rnd .img)`, `.prailtx`, `.prailx`; ширина — `body > .app { --rw }`; в теме начинать с `#pinRail` — подгонка основы сильнее `.pinrail`;
режимы — `:root[data-ly-pins="top|side"]`, `[data-ly-pinhide="on"]`, `:root.pinpeek-on`), `.side .nav(.active)`, `.search`,
`.main[data-page="likes|wave|settingsBtn|…"]`, `.head h2`/`#title`, `#headImg`, `.chip(.active)`, `.list li(.playing)` (`.t .a`),
`.likebtn(.on) .morebtn`, `.player` (`.pinfo .pcenter .pright .seekrow .ctrls .volwrap .playbtn .modebtn.on`), `#seek #vol`,
`.wavebtn` (`.stamp` при нажатии), `.waveorbits` (5×`<i>`, скрыт по умолчанию; `.on`, `.beats`), `.stage`, `.card`, `.stylecard`,
`.tmenu`, `.toast`, `.login-box .modalbox`, `.qpanel`, `.panel`, `#bg #dim` (обои — не прятать!), `#thBtns .thbtn`.

**События для анимаций:** смена трека — `.player .cover` получает `.flip-out` → (ждёт конца анимации) → `.flip-in`;
«Моя волна» — `.wavebtn.stamp`; волна играет — `.waveorbits.on` (анимации `neonSpin` внутри ×2.4); смена страницы —
`.main[data-page]` (своё имя анимации на каждую страницу, чтобы перезапускалась); анимации — только под `:root[data-anim="on"]`.

**Перестройка интерфейса целиком** (пример `retro-tv.wmt`): `"layout": "fixed"`; сетка — `body > .app { grid-template-… }`;
разобрать плеер — `.player, .player > .pcenter, .player > .pright { display: contents; }`; у `.panel` есть `backdrop-filter` —
он становится containing block для absolute/fixed, выносишь — ставь `backdrop-filter: none`; `.qpanel` — задать
`top/bottom/right` с `!important`; свободный декор — `.app::before/::after`, `body::before/::after`;
обои можно «вписать»: `#bg, #dim { inset: …; border-radius: … }`; пиксельный шрифт — кратные размеры, без дробного letter-spacing.

### Виджет OBS (`whisper-obs`)
```jsonc
@@ settings whisper-obs
{ "layout": "card",               // card | compact | bar — вид по умолчанию
  "layouts": ["card", "compact"], // необязательно: какие виды стиль умеет
  "opacity": 0.55 }               // фон 0…1 ("size" — устаревшее, размеры стандартные)
```
**Размеры стандартные для всех стилей** (источник OBS / поле `#w`): card 640×220 / 616×196, compact 480×120 / 456×96,
bar 560×60 / 536×36 — задаёт widget.html; тема раскладывает всё внутри поля, `#w` не растягивает (подсказка — obs.js `SIZES`).
CSS без привязки к стилю, после встроенного. Разметка: `#w.w[data-base][data-layout][data-playing][data-empty][data-paused-hidden]`
→ `.w-bg`, `.w-art > img.w-cover`, `.w-info` (`.w-title .w-artist .w-bar > i .w-time > .w-cur .w-dur`), `.w-eq > i×4`,
`.w-play > i` (скрыт; включать `display: grid`), `.w-viz > i×32` (скрыт; «живой» визуализатор, у `i` — `--i --h --lv`),
`.w-deco > i×6` (скрыт; слой inset:0, у `i` есть ::before/::after).
Переменные на `#w`: `--a --b --alpha --p --cover --beat`. Ресурсы `url(asset:…)` встраиваются (≤1,5 МБ каждый);
`@import`, `url(http…)`, `image-set` вырезаются. Перекрыть встроенные виды — селекторами через `#w`.

### Интро (`whisper-intro`)
Заставка при запуске (ASCII, Madk1d, lazzy2wice). theme.js → `playIntro()`: CSS секции привязывается к стилю
(`TC.introCss`) и ставится в `DynCss("wmt-intro")` на `duration` (+0,3 с), потом снимается; щелчок или клавиша —
сразу. Не показывается: выключено (Оформление → «Эффекты и анимации» → «Настроить тему…»; localStorage `ym_intro` `{ on, off: [id] }`), анимации
выключены, `prefers-reduced-motion`. Пока идёт — `html.intro-on`. Интро в `css whisper-music` выключить нельзя —
в новых темах только отдельной секцией. Подробно — WMT-FORMAT.md, раздел 5б.

### Как в приложении
- «Сохранить стиль в файл…» — выгружает правила текущего стиля уже без привязки (архив, если есть фон).
- «Загрузить тему…» / перетащить файл в окно; тот же `id` → обновление (другой автор → сначала вопрос «Заменить стиль?»).
  Хранение — IndexedDB (`theme:<id>`), список — `cfg.themes`.
- «Библиотека тем» — `themelib.rs` качает `index.json`, `previews/<папка>/<id>.*`, `themes/<папка>/<id>.wmt`
  (папки `whisper`, `community`, `artists`) из ветки `main` репозитория Whisper-Music/whisper-themes.
- Чтение в JS: `const th = await WMT.open(bytes); th.manifest; th.tokens; th.css("whisper-music"); th.settings(app);
  th.background; th.asset("asset:x")`. Сборка: `WMT.pack({…})` (архив) / `WMT.serialize({…})` (текст).

### Минимальная тема
```
#WMT 1
@@ manifest
{ "id": "mint", "name": "Мята", "base": "neon" }
@@ tokens
{ "color": { "accent": "#3fb8af", "accent2": "#ff6f59" } }
```

### Частые ошибки в темах
- Цвета числами в CSS → настройки цветов не действуют. Пиши `var(--accent)`.
- Спрятаны `#bg` / `body { background: … !important }` → пользователь не может поставить обои.
- Правило не срабатывает → встроенное сильнее: уточни селектор или `!important` (но `colorOverrides` всё равно главнее).
- Кнопки `buttons` не видно → им нужны размер и место в CSS.
- Сломан вид окна → **Ctrl+Shift+Backspace**.

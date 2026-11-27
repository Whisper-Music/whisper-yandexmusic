// Телефон: трек Яндекса по кускам для звукового графа (визуализатор, эквалайзер, усиление нормализации).
// Файлы Яндекса отдаются без CORS, и в граф их можно пустить только своим адресом. На компьютере трек для этого
// скачивается целиком (fetch_bytes) и играет из blob — на мобильном интернете это 10 МБ ожидания перед звуком,
// а иногда и сторож «трек не загружается — повторная попытка». Здесь куски (Rust fetch_range) складываются в
// MediaSource: звук идёт после первого куска, остальное докачивается, пока трек играет.
// Перемотка за скачанное — докачка с этого места (MP3 — грубо по доле файла, сдвиг метки времени — timestampOffset).
// window.mobileStream(audio, url, durSec) → адрес blob: для audio.src, или null — MediaSource нет / не понимает MP3.
import { invoke } from "../app/base.js";

const FIRST = 256 * 1024, NEXT = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mobileStream(el, src, durSec) {
  if (!window.isMobile || !window.MediaSource?.isTypeSupported?.("audio/mpeg")) return null;
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  const alive = () => el.src === url;          // сменился трек или плеер — качать дальше незачем
  let total = 0, jump = null;
  const inBuf = (sb, t) => { for (let i = 0; i < sb.buffered.length; i++) if (sb.buffered.start(i) <= t + 0.25 && sb.buffered.end(i) > t + 0.5) return true; return false; };

  ms.addEventListener("sourceopen", async () => {
    let sb;
    try { sb = ms.addSourceBuffer("audio/mpeg"); sb.mode = "sequence"; } catch { return; }
    if (durSec > 0) try { ms.duration = durSec; } catch {}
    const idle = () => (sb.updating ? new Promise((r) => sb.addEventListener("updateend", r, { once: true })) : null);
    // перемотка туда, где ещё ничего нет: качаем с этого места
    const onSeek = () => { if (alive() && !inBuf(sb, el.currentTime)) jump = el.currentTime; };
    el.addEventListener("seeking", onSeek);
    let off = 0, fails = 0;
    try {
      while (alive()) {
        if (jump !== null && total) {
          const t = jump; jump = null;
          const dur = durSec > 0 ? durSec : el.duration;
          off = Math.max(0, Math.min(total - 1, Math.floor((t / dur) * total)));
          await idle();
          try { sb.abort(); sb.timestampOffset = t; } catch {}
        }
        if (total && off >= total) {
          // всё скачано: конец потока (перемотка в пропуск откроет его снова — appendBuffer)
          await idle();
          if (ms.readyState === "open") try { ms.endOfStream(); } catch {}
          while (alive() && jump === null) await sleep(500);
          continue;
        }
        let buf;
        try {
          buf = new Uint8Array(await invoke("fetch_range", { url: src, start: off, len: off ? NEXT : FIRST }));
          fails = 0;
        } catch (e) {
          if (++fails > 4) throw e;
          await sleep(1000 * fails);
          continue;
        }
        if (!alive()) break;
        const n = buf.length - 8;
        total = Number(new DataView(buf.buffer, buf.byteOffset + n, 8).getBigUint64(0)) || total;
        if (n <= 0) { off = total || off; continue; }
        const part = buf.subarray(0, n);
        // буфер MediaSource для звука ~12 МБ: уже сыгранное браузер убирает сам, а если места нет — ждём, пока трек
        // доиграет часть скачанного
        for (;;) {
          await idle();
          if (!alive()) break;
          try { sb.appendBuffer(part); await idle(); break; }
          catch (e) {
            if (e?.name !== "QuotaExceededError") throw e;
            const t = el.currentTime;
            try { if (t > 30) { sb.remove(0, t - 20); await idle(); } } catch {}
            await sleep(3000);
          }
        }
        if (jump === null) off += n;
      }
    } catch (e) {
      console.warn("Поток трека:", e?.message || e);
      if (alive() && ms.readyState === "open") try { ms.endOfStream("network"); } catch {}
    } finally {
      el.removeEventListener("seeking", onSeek);
      if (!alive()) URL.revokeObjectURL(url);
    }
  }, { once: true });
  return url;
}

window.mobileStream = mobileStream;

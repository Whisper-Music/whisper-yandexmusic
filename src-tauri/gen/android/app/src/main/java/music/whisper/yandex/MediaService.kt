package music.whisper.yandex

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Музыка в фоне и уведомление плеера.
 *
 * Звук играет страница (WebView), а не эта служба: служба нужна, чтобы Android не выгружал приложение, пока оно
 * свёрнуто (foreground service, тип mediaPlayback), и чтобы было уведомление с обложкой, кнопками и перемоткой —
 * в шторке, на экране блокировки и для кнопок наушников (MediaSession). Что играет, сообщает страница
 * (mobilemedia.js → WhisperAndroid.media(json) → update), а нажатия уходят обратно через onAction (MainActivity.kt
 * → window.whisperMediaAction в странице). Служба живёт, пока есть трек; закрыли приложение из списка недавних — уходит.
 */
class MediaService : Service() {
  data class State(
    val title: String,
    val artist: String,
    val album: String,
    val cover: String,
    val durationMs: Long,
    val positionMs: Long,
    val playing: Boolean,
  )

  companion object {
    private const val CHANNEL = "whisper_playback"
    private const val NOTIFY_ID = 1
    private const val ACT = "music.whisper.yandex.media."

    /** Нажатия в уведомлении и с наушников: (действие, позиция в мс для "seek"). Ставит MainActivity. */
    @Volatile var onAction: ((String, Long) -> Unit)? = null
    @Volatile private var instance: MediaService? = null
    @Volatile private var last: State? = null

    fun update(ctx: Context, s: State) {
      last = s
      val svc = instance
      if (svc != null) svc.show(s)
      else ContextCompat.startForegroundService(ctx, Intent(ctx, MediaService::class.java))
    }

    fun stop(ctx: Context) {
      last = null
      ctx.stopService(Intent(ctx, MediaService::class.java))
    }
  }

  private lateinit var session: MediaSessionCompat
  /** Обложки последних треков (адрес → картинка): «назад» и повтор — сразу, без загрузки. */
  private val covers = object : LinkedHashMap<String, Bitmap>(8, 0.75f, true) {
    override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Bitmap>?) = size > 6
  }
  private var coverLoading = ""
  private var coverFailed = ""
  private var coverAsked = 0L
  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  private var foreground = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL, "Сейчас играет", NotificationManager.IMPORTANCE_LOW)
      ch.description = "Трек, кнопки и перемотка в шторке и на экране блокировки"
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    session = MediaSessionCompat(this, "Whisper").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = act("play")
        override fun onPause() = act("pause")
        override fun onStop() = act("pause")
        override fun onSkipToNext() = act("next")
        override fun onSkipToPrevious() = act("prev")
        override fun onSeekTo(pos: Long) = act("seek", pos)
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACT + "prev" -> act("prev")
      ACT + "toggle" -> act(if (last?.playing == true) "pause" else "play")
      ACT + "next" -> act("next")
    }
    // startForegroundService обязывает показать уведомление за несколько секунд — даже если трек ещё не пришёл
    last?.let { show(it) } ?: goForeground(build(State("Whisper", "", "", "", 0, 0, false)))
    return START_NOT_STICKY
  }

  // приложение смахнули из списка недавних — страницы (а значит, и звука) больше нет
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  override fun onDestroy() {
    instance = null
    session.isActive = false
    session.release()
    super.onDestroy()
  }

  private fun act(a: String, pos: Long = 0) {
    onAction?.invoke(a, pos)
  }

  /** Что сейчас в метаданных сессии — повторно не отправляем (магнитола на каждое изменение заново тянет картинку). */
  private var metaKey = ""

  fun show(s: State) {
    val playing = s.playing
    val art = covers[s.cover]
    loadCover(s)
    // Магнитола (Bluetooth AVRCP) берёт обложку, когда узнаёт о новом треке, и позже за ней обычно не возвращается.
    // Поэтому новый трек объявляем вместе с обложкой: ждём её до 2 с (она грузится — loadCover), потом — без неё.
    val waiting = art == null && s.cover == coverLoading && System.currentTimeMillis() - coverAsked < 2000
    val key = listOf(s.title, s.artist, s.album, s.cover, art != null, s.durationMs / 1000).joinToString("\u0001")
    if (!waiting && key != metaKey) {
      metaKey = key
      session.setMetadata(
        MediaMetadataCompat.Builder()
          .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, s.cover + "|" + s.title)
          .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
          .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
          .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ARTIST, s.artist)
          .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
          .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, s.title)
          .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, s.artist)
          .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, s.album)
          .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (s.durationMs > 0) s.durationMs else -1)
          // картинка — одна (ALBUM_ART; по нему же её находят и Android, и магнитолы): каждая копия едет в метаданных
          // целиком, а у них предел ~1 МБ
          .also { b -> art?.let { b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) } }
          .build()
      )
    }
    if (waiting) main.postDelayed({ last?.takeIf { it.cover == s.cover }?.let { show(it) } }, 2100)
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO
        )
        .setState(
          if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          s.positionMs, if (playing) 1f else 0f
        )
        .build()
    )
    goForeground(build(s))
  }

  private fun goForeground(n: Notification) {
    if (!foreground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIFY_ID, n)
      }
      foreground = true
    } else {
      getSystemService(NotificationManager::class.java).notify(NOTIFY_ID, n)
    }
  }

  private fun pending(action: String, code: Int): PendingIntent =
    PendingIntent.getService(
      this, code, Intent(this, MediaService::class.java).setAction(ACT + action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  private fun build(s: State): Notification {
    val open = PendingIntent.getActivity(
      this, 0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(s.title.ifEmpty { "Whisper" })
      .setContentText(s.artist)
      .setLargeIcon(covers[s.cover])
      .setSubText(s.album.ifEmpty { null })
      .setContentIntent(open)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .addAction(android.R.drawable.ic_media_previous, "Предыдущий", pending("prev", 1))
      .addAction(
        if (s.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (s.playing) "Пауза" else "Играть", pending("toggle", 2)
      )
      .addAction(android.R.drawable.ic_media_next, "Следующий", pending("next", 3))
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
  }

  /**
   * Обложка — только https (адреса картинок Яндекса и архива); грузится один раз на трек, в отдельном потоке,
   * и ужимается до 320 px: метаданные сессии (и магнитола по Bluetooth) не принимают картинки больше ~1 МБ.
   */
  private fun loadCover(s: State) {
    val url = s.cover
    if (url == coverLoading || url == coverFailed || covers.containsKey(url) || !url.startsWith("https://")) return
    coverLoading = url
    coverAsked = System.currentTimeMillis()
    thread(isDaemon = true) {
      val bmp = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 6000
        c.readTimeout = 6000
        c.inputStream.use { BitmapFactory.decodeStream(it) }?.let { b ->
          val k = 320f / maxOf(b.width, b.height)
          if (k < 1f) Bitmap.createScaledBitmap(b, (b.width * k).toInt().coerceAtLeast(1), (b.height * k).toInt().coerceAtLeast(1), true) else b
        }
      } catch (_: Exception) {
        null
      }
      main.post {
        if (bmp != null) covers[url] = bmp else coverFailed = url      // не скачалась — без обложки, без новых попыток
        if (coverLoading == url) coverLoading = ""
        last?.let { st -> if (st.cover == url) show(st) }
      }
    }
  }
}

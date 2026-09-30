package expo.modules.crewhousenet

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// "Hand my screen to…": one still of the phone's screen, after the phone's own consent dialog, every time. Nothing is
// kept running: the capture stops as soon as the still is written. The still goes to the app's cache, and the app sends
// it only when the person picks who gets it.
class CrewhouseScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CrewhouseScreen")

    // Resolves the still's file:// address, or "" when the person said no or no picture came.
    AsyncFunction("frame") { promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve("")
      if (!ScreenFrame.begin { promise.resolve(it) }) return@AsyncFunction promise.reject(CodedException("busy", "busy", null))
      // Only the newest still is ever on the phone: the last one goes before the next is taken.
      context.cacheDir.listFiles { f -> f.name.startsWith("crewhouse-screen-") }?.forEach { it.delete() }
      context.startActivity(Intent(context, ScreenFrameActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}

/** The one capture in flight: who hears its answer, exactly once. */
internal object ScreenFrame {
  private var waiting: ((String) -> Unit)? = null
  @Synchronized fun begin(answer: (String) -> Unit): Boolean { if (waiting != null) return false; waiting = answer; return true }
  @Synchronized fun end(uri: String) { waiting?.invoke(uri); waiting = null }
}

/** Invisible: shows the phone's "start recording or casting?" dialog and hands a yes to the service. */
class ScreenFrameActivity : Activity() {
  private var handed = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState != null) return
    startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(), ASK)
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    handed = resultCode == RESULT_OK && data != null
    if (handed) startForegroundService(ScreenFrameService.intent(this, resultCode, data!!)) else ScreenFrame.end("")
    finish()
    overridePendingTransition(0, 0)
  }

  // Left without an answer (Home pressed over the dialog, or the system took it away): the ask is over, so the next
  // one can start.
  override fun onDestroy() {
    super.onDestroy()
    if (!handed && !isChangingConfigurations) ScreenFrame.end("")
  }

  private companion object { const val ASK = 1 }
}

/** The capture itself. Android 14 and later lets a screen capture start only inside a screen-capture service. */
class ScreenFrameService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var reader: ImageReader? = null
  private var done = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    foreground()
    val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
    @Suppress("DEPRECATION") val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
    val p = data?.let { runCatching { getSystemService(MediaProjectionManager::class.java).getMediaProjection(code, it) }.getOrNull() }
    if (p == null) { finish(""); return START_NOT_STICKY }
    projection = p
    p.registerCallback(object : MediaProjection.Callback() { override fun onStop() { finish("") } }, main)
    val m = resources.displayMetrics
    val r = ImageReader.newInstance(m.widthPixels, m.heightPixels, PixelFormat.RGBA_8888, 2)
    reader = r
    display = p.createVirtualDisplay("crewhouse-still", m.widthPixels, m.heightPixels, m.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, main)
    // The consent dialog is still leaving the screen; the still is the first picture after it has gone.
    main.postDelayed({ r.setOnImageAvailableListener({ take(it) }, main); take(r) }, SETTLE_MS)
    main.postDelayed({ finish("") }, GIVE_UP_MS)
    return START_NOT_STICKY
  }

  private fun take(r: ImageReader) {
    val image = runCatching { r.acquireLatestImage() }.getOrNull() ?: return
    val uri = runCatching {
      val plane = image.planes[0]
      val padded = Bitmap.createBitmap(plane.rowStride / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888)
      padded.copyPixelsFromBuffer(plane.buffer)
      val still = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
      val file = File(cacheDir, "crewhouse-screen-${System.currentTimeMillis()}.png")
      file.outputStream().use { still.compress(Bitmap.CompressFormat.PNG, 100, it) }
      "file://${file.absolutePath}"
    }.getOrDefault("")
    image.close()
    finish(uri)
  }

  private fun finish(uri: String) {
    if (done) return // stopping the capture calls back here once more
    done = true
    main.removeCallbacksAndMessages(null)
    reader?.setOnImageAvailableListener(null, null)
    display?.release(); display = null
    projection?.stop(); projection = null
    reader?.close(); reader = null
    ScreenFrame.end(uri)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun foreground() {
    val channel = "Hand my screen"
    getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(channel, channel, NotificationManager.IMPORTANCE_LOW))
    val icon = resources.getIdentifier("chief_glyph", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon
    val n = Notification.Builder(this, channel).setContentTitle("Taking one picture of your screen").setSmallIcon(icon).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(ID, n)
  }

  companion object {
    private const val ID = 0x5C4E
    private const val SETTLE_MS = 400L
    private const val GIVE_UP_MS = 6000L
    private const val EXTRA_CODE = "crewhouse.code"
    private const val EXTRA_DATA = "crewhouse.data"

    fun intent(context: Context, code: Int, data: Intent): Intent =
      Intent(context, ScreenFrameService::class.java).putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, data)
  }
}

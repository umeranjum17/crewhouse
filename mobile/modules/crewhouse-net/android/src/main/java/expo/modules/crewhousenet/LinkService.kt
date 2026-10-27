package expo.modules.crewhousenet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

// The phone's link to its computer, kept open while the app is closed (no push credential needed): a foreground service
// with the ongoing "Crewhouse is connected" line, running the app's own link code (mobile/src/news.ts, the `CrewhouseLink`
// task) so a Chief reply, a finished job or a card for the person shows as a notification. On while paired, again after
// a reboot or an update, and restarted by the phone if it kills the app; off when the phone is unpaired.
// React Native's HeadlessJsTaskService is not used: it holds a wake lock for as long as its task runs, here forever.
class LinkService : Service(), HeadlessJsTaskEventListener {
  private var task = 0
  private var jobs: HeadlessJsTaskContext? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    running = true
    val notice = notice(this, last)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) startForeground(ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
      else startForeground(ID, notice)
    } catch (e: IllegalStateException) {
      // Android 12+ refuses it from the background (a restart after the phone killed the app) unless the person let the app
      // run in the background (CrewhouseNetModule `stayOn`): stop quietly; opening the app starts it again.
      running = false; stopSelf(); return START_NOT_STICKY
    }
    run() // (re)run the task, which holds the link on the grant kept now
    return START_STICKY
  }

  /** The app's JS, started headless when nothing else started it (after a reboot, or the phone killing the app). */
  private fun run() {
    val host = (application as ReactApplication).reactHost ?: return
    host.currentReactContext?.let { begin(it); return }
    host.addReactInstanceEventListener(object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) { host.removeReactInstanceEventListener(this); begin(context) }
    })
    host.start()
  }

  /** A running task keeps the JS timers going while the app is closed; a new one replaces the last (a new pairing). */
  private fun begin(context: ReactContext) { UiThreadUtil.runOnUiThread {
    val j = HeadlessJsTaskContext.getInstance(context)
    if (jobs !== j) { jobs?.removeTaskEventListener(this); j.addTaskEventListener(this); jobs = j }
    val old = task
    task = j.startTask(HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true))
    if (old != 0 && j.isTaskRunning(old)) j.finishTask(old)
  } }

  override fun onHeadlessJsTaskStart(taskId: Int) {}

  // The task ends itself only when this phone has no grant: nothing to hold.
  override fun onHeadlessJsTaskFinish(taskId: Int) { if (taskId == task) keep(this, false) }

  override fun onDestroy() {
    running = false
    jobs?.let { if (it.isTaskRunning(task)) it.finishTask(task); it.removeTaskEventListener(this) }
    super.onDestroy()
  }

  companion object {
    private const val TASK = "CrewhouseLink"
    private const val CHANNEL = "link"
    private const val ID = 7712
    private const val PREFS = "crewhouse.link"
    private var last = "Connecting to your computer…"
    private var running = false

    /** On (kept on across reboots) or off. */
    fun keep(context: Context, on: Boolean) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", on).apply()
      val intent = Intent(context, LinkService::class.java)
      if (on) context.startForegroundService(intent) else context.stopService(intent)
    }

    /** Its ongoing line says how the link is, while it runs. */
    fun say(context: Context, words: String) {
      if (words == last) return
      last = words
      if (running) context.getSystemService(NotificationManager::class.java).notify(ID, notice(context, words))
    }

    fun wanted(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on", false)

    private fun notice(context: Context, words: String): Notification {
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Connection to your computer", NotificationManager.IMPORTANCE_MIN))
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE) }
      val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName).takeIf { it != 0 } ?: context.applicationInfo.icon
      return Notification.Builder(context, CHANNEL).setSmallIcon(icon).setContentTitle(words).setContentIntent(open).setOngoing(true).setShowWhen(false).build()
    }
  }
}

/** After a reboot or an update of the app: the link comes back without the app being opened. */
class LinkStarter : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED) && LinkService.wanted(context)) LinkService.keep(context, true)
  }
}

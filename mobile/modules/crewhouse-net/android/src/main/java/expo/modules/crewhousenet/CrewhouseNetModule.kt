package expo.modules.crewhousenet

import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.NetworkInterface

// This phone's own IPv4 addresses on interfaces that are up: the app tells from them whether it is on the home Wi-Fi
// and whether Tailscale is on (a 100.64.0.0/10 address). No permission needed; nothing leaves the phone.
// Also the link service (LinkService.kt), and a `network` event when the phone joins a network, to dial again at once.
class CrewhouseNetModule : Module() {
  private var watch: ConnectivityManager.NetworkCallback? = null
  private val connectivity get() = appContext.reactContext?.getSystemService(ConnectivityManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("CrewhouseNet")
    Events("network")
    AsyncFunction<List<String>>("addresses") {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .mapNotNull { it.hostAddress }
    }
    Function("keepLink") { on: Boolean -> appContext.reactContext?.let { LinkService.keep(it, on) }; Unit }
    // The phone's own "Let app always run in background?", asked once news is allowed: without it Android won't let the link
    // service come back after it kills the app, and Doze holds the link's network. True when already allowed.
    Function("stayOn") {
      val context = appContext.reactContext ?: return@Function false
      if (context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)) return@Function true
      appContext.currentActivity?.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
      false
    }
    Function("linkWords") { words: String -> appContext.reactContext?.let { LinkService.say(it, words) }; Unit }
    OnStartObserving {
      watch = object : ConnectivityManager.NetworkCallback() { override fun onAvailable(network: Network) { sendEvent("network", emptyMap<String, Any>()) } }
      connectivity?.registerDefaultNetworkCallback(watch!!)
    }
    OnStopObserving { watch?.let { connectivity?.unregisterNetworkCallback(it) }; watch = null }
  }
}

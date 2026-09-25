package expo.modules.crewhousenet

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.NetworkInterface

// This phone's own IPv4 addresses on interfaces that are up: the app tells from them whether it is on the home Wi-Fi
// and whether Tailscale is on (a 100.64.0.0/10 address). No permission needed; nothing leaves the phone.
class CrewhouseNetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CrewhouseNet")
    AsyncFunction<List<String>>("addresses") {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .mapNotNull { it.hostAddress }
    }
  }
}

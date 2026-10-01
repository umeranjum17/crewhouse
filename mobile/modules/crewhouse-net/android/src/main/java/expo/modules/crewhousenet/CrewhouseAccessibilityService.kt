package expo.modules.crewhousenet

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import io.github.umeranjum17.byokit.overlay.ByokitAccessibility

/** "Write it here": Crewhouse's own accessibility service only hands itself to @byokit/overlay, which reads and fills
 *  the focused box when the person asks (the kit's examples/expo/modules/a11y-demo). */
class CrewhouseAccessibilityService : AccessibilityService() {
  override fun onServiceConnected() = ByokitAccessibility.attach(this)

  override fun onUnbind(intent: Intent?): Boolean {
    ByokitAccessibility.detach(this)
    return super.onUnbind(intent)
  }

  // A service the system kills without unbinding never reaches onUnbind: let go here too (the kit's README).
  override fun onDestroy() {
    ByokitAccessibility.detach(this)
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}
}

package expo.modules.crewhousenet

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// "Ask Crewhouse", in the menu over text picked in any app: opens the app's share screen with those words in the box
// (crewhouse://share, mobile/App.tsx). Nothing is read from the other app but the words the person picked, and nothing
// is sent until they pick who gets them and tap Send.
class AskActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val words = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.take(MAX).orEmpty()
    if (words.isNotBlank()) {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("crewhouse://share?text=${Uri.encode(words)}"))
        .setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    finish()
  }

  private companion object { const val MAX = 4000 }
}

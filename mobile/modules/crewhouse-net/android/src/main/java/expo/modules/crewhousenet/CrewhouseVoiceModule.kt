package expo.modules.crewhousenet

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Speaking to Chief: the phone's on-device recognizer (Android 12 and later) turns speech into words for the message
// box. Without its voice pack the phone's own speech service hears instead (it may use the network, as the keyboard's
// mic does). The words go nowhere until the person taps send.
class CrewhouseVoiceModule : Module() {
  private var ear: SpeechRecognizer? = null

  private fun onDevice(context: Context) = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  override fun definition() = ModuleDefinition {
    Name("CrewhouseVoice")

    AsyncFunction("canHear") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      onDevice(context) || SpeechRecognizer.isRecognitionAvailable(context)
    }

    // Listens until the person pauses (or stop), then resolves what was heard: "" for nothing. Fails `blocked` without the
    // microphone, `unready` when neither the on-device pack nor the phone's speech service can hear the language.
    AsyncFunction("hear") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) return@AsyncFunction promise.resolve("")
      ear?.destroy()
      listen(context, tries(context), promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { ear?.stopListening() }.runOnQueue(Queues.MAIN)
  }

  // What to try, in order: each recognizer (on-device, then the system one) in the phone's own language, then in en-US
  // when that language is English: a phone set to en-AE has no pack for it, and the speech service fails before it listens.
  private fun tries(context: Context): List<Pair<Boolean, String>> {
    val mine = Locale.getDefault()
    val tags = listOf(mine.toLanguageTag()) + if (mine.language == "en" && mine.toLanguageTag() != "en-US") listOf("en-US") else emptyList()
    return listOf(true, false).filter { !it || onDevice(context) }.flatMap { local -> tags.map { local to it } }
  }

  // One listen with the first of `left`; a failure to hear (no pack) moves on to the next. Hearing nothing in a language
  // (the service takes en-AE and returns no words) is tried once more in the next language, `again` being that one step.
  private fun listen(context: Context, left: List<Pair<Boolean, String>>, promise: Promise, again: Boolean = true) {
    val (local, tag) = left.first()
    val r = if (local) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
    ear = r
    var settled = false
    fun end(words: String?, error: Int? = null) {
      if (settled) return
      settled = true
      r.destroy()
      if (ear === r) ear = null
      when (error) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> promise.reject(CodedException("blocked", "blocked", null))
        // Nothing was said: "didn't catch that" is right. Any other failure is the phone not being set up to hear.
        null, SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
          val next = left.drop(1).dropWhile { it.second == tag }
          if (words.isNullOrEmpty() && again && next.isNotEmpty()) listen(context, next, promise, false) else promise.resolve(words.orEmpty())
        }
        else ->
          if (left.size > 1) listen(context, left.drop(1), promise)
          else promise.reject(CodedException("unready", "unready", null))
      }
    }
    r.setRecognitionListener(object : RecognitionListener {
      override fun onResults(b: Bundle?) = end(b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull())
      override fun onError(error: Int) = end(null, error)
      override fun onReadyForSpeech(b: Bundle?) {}
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(db: Float) {}
      override fun onBufferReceived(b: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onPartialResults(b: Bundle?) {}
      override fun onEvent(type: Int, b: Bundle?) {}
    })
    r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag).putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, tag))
  }
}

package expo.modules.crewhousenet

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Speaking to Chief: the phone's on-device recognizer (Android 12 and later), never an online one, turns speech into
// words for the message box. No sound leaves the phone, and the words go nowhere until the person taps send.
class CrewhouseVoiceModule : Module() {
  private var ear: SpeechRecognizer? = null

  override fun definition() = ModuleDefinition {
    Name("CrewhouseVoice")

    AsyncFunction("canHear") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    }

    // Listens until the person pauses (or stop), then resolves what was heard: "" for nothing. Fails `blocked` without the
    // microphone, `unready` without the phone's voice pack for its language.
    AsyncFunction("hear") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction promise.resolve("")
      ear?.destroy()
      val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
      ear = r
      var settled = false
      fun end(words: String?, error: Int? = null) {
        if (settled) return
        settled = true
        r.destroy()
        if (ear === r) ear = null
        when (error) {
          SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> promise.reject(CodedException("blocked", "blocked", null))
          // No voice pack for the phone's language yet: saying "didn't catch that" would never come right.
          SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> promise.reject(CodedException("unready", "unready", null))
          else -> promise.resolve(words.orEmpty())
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
      r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { ear?.stopListening() }.runOnQueue(Queues.MAIN)
  }
}

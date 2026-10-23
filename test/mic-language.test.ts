import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The phone's voice module (Kotlin) can't run here, so this pins what the on-device failure on a phone set to en-AE
// depends on: the recogniser intent carries an explicit language, the phone's own first and en-US next for English, and
// every on-device attempt is followed by the system speech service.
const kt = readFileSync(new URL('../mobile/modules/crewhouse-net/android/src/main/java/expo/modules/crewhousenet/CrewhouseVoiceModule.kt', import.meta.url), 'utf8')

test('the recogniser is told its language: the phone\'s own, then en-US for an English variant', () => {
  assert.match(kt, /putExtra\(RecognizerIntent\.EXTRA_LANGUAGE, tag\)/)
  assert.match(kt, /putExtra\(RecognizerIntent\.EXTRA_LANGUAGE_PREFERENCE, tag\)/)
  assert.match(kt, /mine\.language == "en" && mine\.toLanguageTag\(\) != "en-US"\) listOf\("en-US"\)/)
})

test('no pack on-device moves on to the system speech service before the person is told', () => {
  assert.match(kt, /listOf\(true, false\)\.filter \{ !it \|\| onDevice\(context\) \}\.flatMap \{ local -> tags\.map/)
  assert.match(kt, /if \(left\.size > 1\) listen\(context, left\.drop\(1\), promise\)\s*\n\s*else promise\.reject\(CodedException\("unready"/)
  assert.match(kt, /createSpeechRecognizer\(context\)/)
})

test('words that come back empty in one language get one more listen in the next', () => {
  assert.match(kt, /val next = left\.drop\(1\)\.dropWhile \{ it\.second == tag \}/)
  assert.match(kt, /words\.isNullOrEmpty\(\) && again && next\.isNotEmpty\(\)\) listen\(context, next, promise, false\)/)
})

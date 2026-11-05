# Voice with Chief: in and out

What a person can do by voice in Chief's chat, in the web app and the installed app (PWA), on a phone or a computer:

- **Voice in (the mic).** Tap the mic in Chief's box and speak; while it listens the mic is a stop button and the empty
  box says "Listening…". What was heard lands in the box after what is already there, and nothing is sent until the
  person taps send. Where the browser can record, the mic records and the clip goes to the computer the person paired
  with, where Hex writes it down (`POST /api/transcribe`, `src/transcribe.ts`; "Writing it down…" in the box until the
  words land): no cloud service hears it, and neither the clip nor crewd's copy of it is kept. With no Hex or no speech
  model on that computer the person reads the one command to run, with Copy. Where the browser can't record, today's
  recognizers hear: on a device with its own recognizer the words are heard there; otherwise the browser's online one
  hears, and the app says so first (`VOICE_WORDS.online`). Safari, so every iPad and iPhone browser, can't say where it
  hears, so it counts as online. Talk below still uses those recognizers.
- **Voice out (Talk).** With the box empty, Talk (the waveform) starts a call: Listening, then what was said is sent once
  the person stops, Chief's reply is read aloud a sentence at a time with that line marked green in the thread, then
  Listening again (never while reading). Voice holds the device's own voices and the speed. Stop ends it ("Call ended.").
  Talk shows only where the browser has a voice of its own. The call itself is [voice-call.md](voice-call.md).

Code: `web/src/voice.ts`, `useVoice`/`useCall`/`CallPanel` in `web/src/parts.tsx`. The native phone app has the mic
(`Mic` in `mobile/App.tsx`: the phone's own recognizer, else its system speech service when the on-device pack is missing) but reads nothing aloud: Talk is the web app's.

## Drive and witness

The mic on Hex: `bash scripts/verify/voice-hex.sh <out-dir> hex` (`done-done run voice-hex`; `npm run build:web` first). The
stub engine, but a real Hex install and speech model (`~/.local/bin/hex`, or `CREWHOUSE_HEX`) and real local inference; the
one stand-in is the microphone, Chromium's fake capture device playing whisper.cpp's public `samples/jfk.wav` once. Its
`transcript.txt` has the box's exact words at 390 and 1440, day and night, `person messages at crewd: []`, and Hex's helper
going when crewd alone is stopped; `pwa/voice-hex-{day,night}-{390,1440}.png` are the captures. `bash
scripts/verify/voice-hex.sh <out-dir> missing` (`done-done run voice-hex-missing`) runs with no Hex, for
`pwa/voice-hex-day-390.png`: the install words. `test/transcribe.test.ts` and the last test in `test/voice-call.test.ts`
hold both refusals with no Hex at all, so CI needs none.

Everything else: `bash scripts/verify/voice.sh <out-dir>` (`npm run build:web` first; needs chromium, xvfb-run, ImageMagick). Its own
stub-engine lab (`CREWHOUSE_STUB_GOLDEN=1`: "hi" and "i want to market my app" get Chief's scripted replies), the app
installed from Settings, everything after that in the installed app's own window. No microphone or speaker: the device's
ears and voices are `scripts/verify/voice-device.js` (a browser that can't record, so its recognizers hear), fed words as text, and each sentence read aloud is logged as text
(`ctl.said`). `ctl.hold()` keeps the reading going so the call can be captured mid-sentence in every look.

What it proves, in `transcript.txt`: the heard words were not in crewd before send (`sent-only-on-tap false`); the
line being read has its green mark (`reading 2px solid …`); what was read aloud, sentence by sentence, with the voice
and speed; crewd's thread holds `hi` and `i want to market my app` once each with Chief's replies; and, before the
stand-in loads, what this host's own Chromium offers (`host-as-is`) and what its mic does with no microphone (`host-mic`).

## Capture

All in the installed app (`pwa/`), each at 390 and 1440, day and night: `voice-mic-listening-*` (the mic on),
`voice-heard-in-box-*` (the words in the box), `voice-call-listening-*`, `voice-call-speaking-*` (Chief being read, the
line marked), `voice-call-voice-*` (voice and speed). Then at 390, day: `voice-call-ended-day-390.png`,
`voice-host-as-is-day-390.png`, `voice-host-mic-day-390.png` ("I can't hear a microphone on this computer."), and on a
recognizer shaped like Safari's `voice-safari-online-day-390.png` (the online line) and `voice-safari-heard-day-390.png`.
`test/voice-call.test.ts` drives the same loops, Stop, no microphone, no recognizer and the Safari shape.

Not covered: a live microphone; Hex on macOS (its install line is its README's, unproved here); a real phone's installed
app (the journey runs the installed app in Chromium on this computer); a real voice heard by a real recognizer and real sound out (no microphone or speaker on the host, and
Linux Chromium has no voice of its own); a real iPad or iPhone (the Safari leg is its shape, from WebKit's
`SpeechRecognition.idl`, which has no `available()`); the native app's mic; a live model.

# Voice with Chief: in and out

What a person can do by voice in Chief's chat, in the web app and the installed app (PWA), on a phone or a computer:

- **Voice in (the mic).** Tap the mic in Chief's box and speak; while it listens the mic is a stop button and the empty
  box says "Listening…". What was heard lands in the box after what is already there, and nothing is sent until the
  person taps send. On a device with its own recognizer the words are heard there; otherwise the browser's online one
  hears, and the app says so first (`VOICE_WORDS.online`). Safari, so every iPad and iPhone browser, can't say where it
  hears, so it counts as online.
- **Voice out (Talk).** With the box empty, Talk (the waveform) starts a call: Listening, then what was said is sent once
  the person stops, Chief's reply is read aloud a sentence at a time with that line marked green in the thread, then
  Listening again (never while reading). Voice holds the device's own voices and the speed. Stop ends it ("Call ended.").
  Talk shows only where the browser has a voice of its own. The call itself is [voice-call.md](voice-call.md).

Code: `web/src/voice.ts`, `useVoice`/`useCall`/`CallPanel` in `web/src/parts.tsx`. The native phone app has the mic
(`Mic` in `mobile/App.tsx`, the phone's own recognizer) but reads nothing aloud: Talk is the web app's.

## Drive and witness

`bash scripts/verify/voice.sh <out-dir>` (`npm run build:web` first; needs chromium, xvfb-run, ImageMagick). Its own
stub-engine lab (`CREWHOUSE_STUB_GOLDEN=1`: "hi" and "i want to market my app" get Chief's scripted replies), the app
installed from Settings, everything after that in the installed app's own window. No microphone or speaker: the device's
ears and voices are `scripts/verify/voice-device.js`, fed words as text, and each sentence read aloud is logged as text
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

Not covered: a real voice heard by a real recognizer and real sound out (no microphone or speaker on the host, and
Linux Chromium has no voice of its own); a real iPad or iPhone (the Safari leg is its shape, from WebKit's
`SpeechRecognition.idl`, which has no `available()`); the native app's mic; a live model.

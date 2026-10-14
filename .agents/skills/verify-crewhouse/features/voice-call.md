# Talk with Chief (a hands-free call)

In Chief's chat with an empty box, Talk (the waveform in the send slot, tooltip "Talk with Chief") starts a call
when this browser can hear on the device and has a voice of its own (`canHear()` and a `localService` voice;
otherwise there is no Talk). The call takes the box's place: Listening (the words as they come), Chief is thinking,
Chief is speaking (his new reply read a sentence at a time, the line being read marked green in the thread), then
Listening again; it never listens while it reads. Voice and speed sit under Voice, kept per device
(`localStorage` `crewhouse.voice`). Stop ends it anywhere ("Call ended."); two silent turns end it ("Call ended. I
didn't hear anything."); a send that fails puts the words back in the box with Retry; no microphone says "I can't
hear a microphone on this computer. Type instead." Code: `web/src/voice.ts`, `useCall`/`CallPanel` in
`web/src/parts.tsx`.

## Drive

1. The gate: `node --test test/voice-call.test.ts` (real stub crewd with `CREWHOUSE_STUB_GOLDEN=1`, the built
   app, a real Chromium; only the device's ears and voice are stand-ins). It checks the turn order, the voice and
   speed used, that only the device's own voices are offered, Stop, and the no-microphone line.
2. Shots of every state: onboard, open `#/chief?day|night`, add the test's stand-in device with
   `Page.addScriptToEvaluateOnNewDocument` before loading (a recognizer you feed words to, `SpeechSynthesis` with
   two local voices), and hold the send (wrap `fetch` for `POST …/messages`) to shoot Thinking. Say
   `i want to market my app` (golden: a two-sentence reply). States: idle, listening (no words, then words),
   thinking, speaking, Voice open, ended; at 390 and 1440, day and night, beside the approved mocks.
3. The installed app: open it as an app window (`chromium --app=<url>`; the page reports
   `matchMedia('(display-mode: standalone)')`) and run the same call there.
4. A recording with sound: Chromium with `--enable-speech-dispatcher` and a speech-dispatcher whose audio goes to
   a private null sink (never a speaker, never the default sink); record its monitor with `parec`.

## Known

- Linux Chromium has device voices only with `--enable-speech-dispatcher` and a running speech-dispatcher, so
  Talk is usually hidden on Linux. There its on-device recognizer could not hear (Chromium 151: `start()` gives
  `audio-capture`; `start(track)` reaches SODA, which logs "No voiced samples"), so a recording on Linux needs
  stand-in ears. Its speech-dispatcher voice may report a sentence's end only once another is queued; `speak()`
  moves on after a deadline (2 s + 100 ms a character at speed 1), so the call doesn't hang.
- iPad Safari has no on-device recognizer, so no Talk there (by design: no voice leaves the device).
- A live-model call (Claude) belongs to the release readiness check; the stub's golden replies cover the loop.

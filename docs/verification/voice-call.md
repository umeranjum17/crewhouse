# Talk with Chief (a hands-free call)

With Chief's box empty, Talk (the waveform in the send slot, "Talk with Chief") shows only when the browser can
hear (on the device, else its online recognizer, which the call says first) and has a voice of its own. The call takes the box's place: Listening (words as they come),
Chief is thinking, Chief is speaking (a sentence at a time, the line being read marked green), Listening again,
never listening while it reads. Voice and speed sit under Voice, kept per device (`crewhouse.voice`). Stop ends it
("Call ended."); two silent turns, a failed send (words back in the box) and no microphone each say so. Code:
`web/src/voice.ts`, `useCall`/`CallPanel` in `web/src/parts.tsx`.

## Drive

1. `node --test test/voice-call.test.ts`: stub crewd with `CREWHOUSE_STUB_GOLDEN=1`, the built app and a real
   Chromium; only the device's ears and voice stand in. Turn order, voice and speed used, own voices only, Stop,
   no microphone.
2. Every state: `look-check.mjs web --init scripts/verify/voice-device.js` (ears fed by `ctl.heard(words, final)`, two
   local voices) with `--then` clicking `.send.talk` and feeding `i want to market my app` (golden: two sentences);
   slugs `call-idle|listening|speaking|voice` pair with the approved mocks. Thinking needs the send held (wrap
   `fetch` for `POST …/messages`). Also at 390 and 1440, and in an app window (`chromium --app=<url>`, standalone).
3. Sound: Chromium `--enable-speech-dispatcher` with a speech-dispatcher playing into a private null sink (never
   a speaker or the default sink), recorded from its monitor with `parec`.

## Known

- Linux Chromium has device voices only with `--enable-speech-dispatcher`, so Talk is usually hidden there. Its
  on-device recognizer could not hear (151: `start()` gives `audio-capture`; with a track SODA logs "No voiced
  samples"), and its voice may report a sentence's end only once another is queued; `speak()` moves on after a
  deadline so the call doesn't hang. Safari (every iPad and iPhone browser) has no availability check, so it listens as the online recognizer, with its line.
- A live-model call belongs to the release readiness check; the stub's golden replies cover the loop.

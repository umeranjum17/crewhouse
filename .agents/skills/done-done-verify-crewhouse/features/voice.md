# Voice with Chief

Part of the crewhouse verification map. Source: `docs/verification/voice.md`.

## How to get to it (user POV)

In Chief's chat, tap the mic and speak: the words wait in the box until send. With the box empty, tap Talk: what you say
is sent when you stop, Chief's reply is read aloud a sentence at a time with that line marked, then it listens again
until Stop.

## Driving it

1. Needs a built web app (`npm run build:web`), chromium, xvfb-run and ImageMagick; no microphone or speaker.
2. Run `bash scripts/verify/voice.sh <out>` (its own stub-engine lab, the app installed from Settings; the device's ears
   and voices are `scripts/verify/voice-device.js`, fed words as text, each sentence read aloud logged as text).
3. Capture: `pwa/voice-{mic-listening,heard-in-box,call-listening,call-speaking,call-voice}-{day,night}-{390,1440}.png`,
   `pwa/voice-call-ended-day-390.png`, `pwa/voice-host-{as-is,mic}-day-390.png`, `pwa/voice-safari-{online,heard}-day-390.png`;
   `transcript.txt`; the step record `steps.json`.
4. It proves: nothing is sent by speaking, the line being read is marked, what was read aloud, each said thing reached
   crewd once, and a Safari-shaped recognizer hears with the online line.

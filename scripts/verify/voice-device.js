// A stand-in device for voice with Chief (docs/verification/voice-call.md, voice.md), loaded before the app boots
// (look-check.mjs --init, pwa-shell.mjs `inject`): a microphone you feed words to (window.ctl.heard(words, final)) and two of
// the device's own voices that read each sentence in 3 s, every sentence logged in ctl.said ("words @voice xspeed"),
// so the read-out is captured as text and nothing plays. ctl.hold() keeps every timer of 2 s or more (the reading among
// them, and the call's own deadline for a sentence) waiting until ctl.go(), so a capture can catch the call mid-sentence.
// The mic is a tone that plays while a person is "speaking", and the words Hex would write down come back from a stand-in
// for POST /api/transcribe: Hex itself is proved by voice-hex.sh. Headless Chromium has no voices of its own, so without
// this there is no Talk to look at.
(() => {
  const ctl = window.ctl = { heard: null, said: [], held: null };
  const timer = window.setTimeout;
  window.setTimeout = (f, ms, ...a) => (ctl.held && ms >= 2000 ? (ctl.held.push(() => f(...a)), 0) : timer(f, ms, ...a));
  ctl.hold = () => { ctl.held ||= []; };
  ctl.go = () => { const h = ctl.held ?? []; ctl.held = null; h.forEach((f) => f()); };
  const mic = { getUserMedia: async () => { // the mic opens: ctl.heard now has someone to speak to
    const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(), d = c.createMediaStreamDestination();
    g.gain.value = 0; o.connect(g).connect(d); o.start();
    ctl.heard = (words, final) => { ctl.words = words; g.gain.value = 0.5; timer(() => { g.gain.value = 0; if (final) document.querySelector('.mic.on')?.click(); }, 300); }; // final: a tap on the mic ends a voice note; a call ends on the pause
    return d.stream;
  } };
  Object.defineProperty(navigator, 'mediaDevices', { value: mic });
  const real = window.fetch;
  window.fetch = (u, o) => (String(u).endsWith('/api/transcribe') ? Promise.resolve(Response.json({ text: ctl.words ?? '' })) : real(u, o));
  const voices = [{ name: 'Daniel', lang: 'en-GB', localService: true, default: true }, { name: 'Samantha', lang: 'en-US', localService: true }];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => voices, addEventListener() {}, cancel() {},
    speak(u) { ctl.said.push(`${u.text.trim()} @${u.voice?.name} x${u.rate}`); setTimeout(() => u.onend(), 3000); } } });
})();

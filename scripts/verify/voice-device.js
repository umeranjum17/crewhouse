// A stand-in device for voice with Chief (docs/verification/voice-call.md, voice.md), loaded before the app boots
// (look-check.mjs --init, pwa-shell.mjs `inject`): ears you feed words to (window.ctl.heard(words, final)) and two of
// the device's own voices that read each sentence in 3 s, every sentence logged in ctl.said ("words @voice xspeed"),
// so the read-out is captured as text and nothing plays. ctl.hold() keeps every timer of 2 s or more (the reading among
// them, and the call's own deadline for a sentence) waiting until ctl.go(), so a capture can catch the call mid-sentence.
// Headless Chromium has no voices of its own, so without this there is no Talk to look at.
(() => {
  const ctl = window.ctl = { heard: null, said: [], held: null };
  const timer = window.setTimeout;
  window.setTimeout = (f, ms, ...a) => (ctl.held && ms >= 2000 ? (ctl.held.push(() => f(...a)), 0) : timer(f, ms, ...a));
  ctl.hold = () => { ctl.held ||= []; };
  ctl.go = () => { const h = ctl.held ?? []; ctl.held = null; h.forEach((f) => f()); };
  window.SpeechRecognition = class {
    static available = async () => 'available'; static install = async () => true;
    start() { ctl.heard = (words, final) => { this.onresult({ results: [[{ transcript: words }]] }); if (final) this.onend(); }; }
    stop() { timer(() => this.onend(), 0); }
  };
  const voices = [{ name: 'Daniel', lang: 'en-GB', localService: true, default: true }, { name: 'Samantha', lang: 'en-US', localService: true }];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => voices, addEventListener() {}, cancel() {},
    speak(u) { ctl.said.push(`${u.text.trim()} @${u.voice?.name} x${u.rate}`); setTimeout(() => u.onend(), 3000); } } });
})();

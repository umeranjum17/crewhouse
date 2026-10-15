// A stand-in device for Talk with Chief (docs/verification/voice-call.md), loaded before the app boots (look-check.mjs --init):
// ears you feed words to (window.ctl.heard(words, final)) and two of the device's own voices that read each sentence
// in 3 s. Headless Chromium has no voices of its own, so without this there is no Talk to look at.
(() => {
  const ctl = window.ctl = { heard: null };
  window.SpeechRecognition = class {
    static available = async () => 'available'; static install = async () => true;
    start() { ctl.heard = (words, final) => { this.onresult({ results: [[{ transcript: words }]] }); if (final) this.onend(); }; }
    stop() { setTimeout(() => this.onend(), 0); }
  };
  const voices = [{ name: 'Daniel', lang: 'en-GB', localService: true, default: true }, { name: 'Samantha', lang: 'en-US', localService: true }];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => voices, addEventListener() {}, cancel() {}, speak(u) { setTimeout(() => u.onend(), 3000); } } });
})();

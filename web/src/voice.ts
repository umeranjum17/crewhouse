// Speaking to Chief: the browser's own recognizer turns speech into words for the message box. It listens on this
// device when it can; where it has no on-device recognizer (Android Chrome in a PWA, for one), its online recognizer
// does instead, and the app says so before it listens (the words are `VOICE_WORDS` in adapter.ts). Nothing is sent
// by speaking: the words go nowhere until the person taps send.
const Heard = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
const lang = () => navigator.language || 'en-US';
const want = (local: boolean) => ({ langs: [lang()], processLocally: local });

/** `device`: this browser's own recognizer, on this device; `online`: its online one (its service hears the audio);
 *  `none`: neither can hear here. */
export type Ears = 'device' | 'online' | 'none';

/** Whether the browser can recognize speech this way, perhaps after fetching its voice pack once. An error from the
 *  check (the browser doesn't know this option) counts as no. A recognizer with no check at all (Safari, so every
 *  iPad and iPhone browser) can't say where it hears, so it counts as the online one. */
async function offers(local: boolean): Promise<boolean> {
  if (Heard && !Heard.available) return !local;
  try { return !!Heard && (await Heard.available(want(local))) !== 'unavailable'; } catch { return false; }
}

/** The recognizer this browser should listen with: on this device first, else the online one, else none. */
export async function ears(): Promise<Ears> {
  return (await offers(true)) ? 'device' : (await offers(false)) ? 'online' : 'none';
}

/** Listens until the person pauses (or `stop()`), then gives what was heard ('' for nothing) with `route`'s recognizer;
 *  `heard` gets the words so far while they speak. It fails `blocked` when the microphone isn't allowed, `nomic` when
 *  none can be opened, `offline` when the online recognizer can't be reached, `unready` when the voice pack can't be
 *  fetched or there is no recognizer at all. */
export function hear(route: Ears, heard?: (words: string) => void): { words: Promise<string>; stop: () => void } {
  let r: any = null, stopped = false;
  const words = (async () => {
    if (route === 'none') throw new Error('unready');
    if (route === 'device' && (await Heard.available(want(true))) !== 'available' && !(await Heard.install(want(true)).catch(() => false))) throw new Error('unready');
    if (stopped) return '';
    r = new Heard();
    Object.assign(r, { lang: lang(), processLocally: route === 'device', interimResults: !!heard, continuous: false });
    return new Promise<string>((done, fail) => {
      let said = '';
      r.onresult = (e: any) => { said = [...e.results].map((x: any) => x[0].transcript).join(' ').trim(); heard?.(said); };
      r.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fail(new Error('blocked')); else if (e.error === 'audio-capture') fail(new Error('nomic')); else if (e.error === 'network') fail(new Error('offline')); };
      r.onend = () => done(said);
      r.start();
    });
  })();
  return { words, stop: () => { stopped = true; r?.stop(); } };
}

// Reading Chief's replies aloud: only this device's own voices (never an online one), a sentence at a time, so a call
// can show the one being read and Stop cuts in between.
const synth: SpeechSynthesis | undefined = globalThis.speechSynthesis;

/** This device's own voices in the person's language, its default first, once the browser has listed them (none
 *  where it has no voice of its own). */
export async function voices(): Promise<SpeechSynthesisVoice[]> {
  if (synth && !synth.getVoices().length) await new Promise((r) => { synth.addEventListener('voiceschanged', r, { once: true }); setTimeout(r, 1000); });
  const own = synth?.getVoices().filter((v) => v.localService) ?? [], l = (x: string) => x.split(/[-_]/)[0].toLowerCase();
  const mine = own.filter((v) => l(v.lang) === l(lang()));
  return (mine.length ? mine : own).sort((a, b) => Number(!!b.default) - Number(!!a.default));
}

/** Reads `text` aloud, each sentence with `how()`'s voice and speed at its start (a change lands on the next one), and
 *  tells `reading` the sentence as it starts. `done` settles once all is read or `stop()` cuts it short. */
export function speak(text: string, how: () => { voice?: SpeechSynthesisVoice; rate: number }, reading: (s: string) => void) {
  let stopped = false;
  const done = (async () => {
    for (const s of text.match(/[^.!?\n]+[.!?]*/g) ?? []) {
      if (stopped) return;
      if (!s.trim()) continue;
      reading(s.trim());
      const h = how();
      await new Promise<void>((r) => { // Chromium on Linux may only say a sentence ended once another is queued: a deadline
        const late = setTimeout(() => { synth?.cancel(); r(); }, 2000 + (s.length * 100) / h.rate);
        synth?.speak(Object.assign(new SpeechSynthesisUtterance(s), { ...h, onend: () => { clearTimeout(late); r(); }, onerror: () => { clearTimeout(late); r(); } }));
      });
    }
  })();
  return { done, stop: () => { stopped = true; synth?.cancel(); } };
}

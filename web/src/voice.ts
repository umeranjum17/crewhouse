// Speaking to Chief: the browser's own recognizer, on this device only (never its online one), turns speech into
// words for the message box. No sound leaves the device, and the words go nowhere until the person taps send.
const Heard = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
const want = () => ({ langs: [navigator.language || 'en-US'], processLocally: true });

/** Whether this browser can hear on this device, perhaps after fetching its voice pack once. */
export async function canHear(): Promise<boolean> {
  try { return !!Heard?.available && (await Heard.available(want())) !== 'unavailable'; } catch { return false; }
}

/** Listens until the person pauses (or `stop()`), then gives what was heard ('' for nothing); `heard` gets the words
 *  so far while they speak. It fails `blocked` when the microphone isn't allowed, `nomic` when none can be opened, `unready`
 *  when the voice pack can't be fetched. */
export function hear(heard?: (words: string) => void): { words: Promise<string>; stop: () => void } {
  let r: any = null, stopped = false;
  const words = (async () => {
    if ((await Heard.available(want())) !== 'available' && !(await Heard.install(want()).catch(() => false))) throw new Error('unready');
    if (stopped) return '';
    r = new Heard();
    Object.assign(r, { lang: want().langs[0], processLocally: true, interimResults: !!heard, continuous: false });
    return new Promise<string>((done, fail) => {
      let said = '';
      r.onresult = (e: any) => { said = [...e.results].map((x: any) => x[0].transcript).join(' ').trim(); heard?.(said); };
      r.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fail(new Error('blocked')); else if (e.error === 'audio-capture') fail(new Error('nomic')); };
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
  const own = synth?.getVoices().filter((v) => v.localService) ?? [], lang = (l: string) => l.split(/[-_]/)[0].toLowerCase();
  const mine = own.filter((v) => lang(v.lang) === lang(want().langs[0]));
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
      await new Promise((r) => synth?.speak(Object.assign(new SpeechSynthesisUtterance(s), { ...how(), onend: r, onerror: r })));
    }
  })();
  return { done, stop: () => { stopped = true; synth?.cancel(); } };
}

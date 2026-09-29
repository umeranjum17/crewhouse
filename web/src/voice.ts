// Speaking to Chief: the browser's own recognizer, on this device only (never its online one), turns speech into
// words for the message box. No sound leaves the device, and the words go nowhere until the person taps send.
const Heard = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
const want = () => ({ langs: [navigator.language || 'en-US'], processLocally: true });

/** Whether this browser can hear on this device, perhaps after fetching its voice pack once. */
export async function canHear(): Promise<boolean> {
  try { return !!Heard?.available && (await Heard.available(want())) !== 'unavailable'; } catch { return false; }
}

/** Listens until the person pauses (or `stop()`), then gives what was heard ('' for nothing). It fails `blocked`
 *  when the microphone isn't allowed, `unready` when the voice pack can't be fetched. */
export function hear(): { words: Promise<string>; stop: () => void } {
  let r: any = null, stopped = false;
  const words = (async () => {
    if ((await Heard.available(want())) !== 'available' && !(await Heard.install(want()).catch(() => false))) throw new Error('unready');
    if (stopped) return '';
    r = new Heard();
    Object.assign(r, { lang: want().langs[0], processLocally: true, interimResults: false, continuous: false });
    return new Promise<string>((done, fail) => {
      let said = '';
      r.onresult = (e: any) => { said = [...e.results].map((x: any) => x[0].transcript).join(' ').trim(); };
      r.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fail(new Error('blocked')); };
      r.onend = () => done(said);
      r.start();
    });
  })();
  return { words, stop: () => { stopped = true; r?.stop(); } };
}
